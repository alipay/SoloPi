"""Durable, platform-independent laboratory scheduler. No device or model execution here."""
import contextlib
import hashlib
import json
import os
import secrets
import sqlite3
import time
import uuid
from pathlib import Path

TERMINAL = {'success', 'failed', 'stopped'}
CASE_TERMINAL = TERMINAL | {'skipped', 'cancelled'}

def encoded(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(',', ':'), allow_nan=False)

class Error(Exception):
    def __init__(self, code, message, status=400):
        self.code, self.status = code, status
        super().__init__(message)

# One definition is used by HTTP, CLI and MCP. JSON schemas are intentionally strict.
OPERATIONS = {
    'health': {'type': 'object', 'properties': {}, 'additionalProperties': False},
    'resources': {'type': 'object', 'properties': {}, 'additionalProperties': False},
    'submit': {'type': 'object', 'properties': {
        'requestId': {'type': 'string', 'minLength': 1}, 'caseIds': {'type': 'array', 'items': {'type': 'string'}, 'minItems': 1, 'uniqueItems': True},
        'requirements': {'type': 'object'}, 'options': {'type': 'object'}, 'source': {'type': 'object'},
        'target': {'type': 'string'}, 'taskName': {'type': 'string'}}, 'required': ['requestId', 'caseIds'], 'additionalProperties': False},
    'status': {'type': 'object', 'properties': {'jobId': {'type': 'string'}}, 'required': ['jobId'], 'additionalProperties': False},
    'list': {'type': 'object', 'properties': {'after': {'type': 'integer', 'minimum': 0}, 'limit': {'type': 'integer', 'minimum': 1, 'maximum': 100}}, 'additionalProperties': False},
    'stop': {'type': 'object', 'properties': {'jobId': {'type': 'string'}}, 'required': ['jobId'], 'additionalProperties': False},
    'artifacts': {'type': 'object', 'properties': {'jobId': {'type': 'string'}}, 'required': ['jobId'], 'additionalProperties': False},
}

def validate(schema, value, path='arguments'):
    kind = schema.get('type')
    valid = {'object': isinstance(value, dict), 'array': isinstance(value, list), 'string': isinstance(value, str),
             'integer': isinstance(value, int) and not isinstance(value, bool), 'boolean': isinstance(value, bool)}
    if kind and not valid.get(kind, False):
        raise Error('INVALID_ARGUMENT', path + ': expected ' + kind)
    if kind == 'object':
        if any(k not in value for k in schema.get('required', [])):
            raise Error('INVALID_ARGUMENT', path + ': required fields missing')
        props = schema.get('properties', {})
        if schema.get('additionalProperties') is False and set(value) - set(props):
            raise Error('INVALID_ARGUMENT', path + ': unknown fields')
        for key in set(value) & set(props):
            validate(props[key], value[key], path + '.' + key)
    if kind == 'string' and len(value.strip()) < schema.get('minLength', 0):
        raise Error('INVALID_ARGUMENT', path + ': empty string')
    if kind == 'array':
        if len(value) < schema.get('minItems', 0) or (schema.get('uniqueItems') and len(set(map(encoded, value))) != len(value)):
            raise Error('INVALID_ARGUMENT', path + ': empty or duplicate items')
        for item in value:
            validate(schema.get('items', {}), item, path + '[]')
    if kind == 'integer' and not schema.get('minimum', value) <= value <= schema.get('maximum', value):
        raise Error('INVALID_ARGUMENT', path + ': outside range')

class Store:
    def __init__(self, root, config, clock=time.time):
        self.root, self.config, self.clock = Path(root), config, clock
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / 'lab.sqlite3'
        with self.db() as db:
            db.executescript('''
CREATE TABLE IF NOT EXISTS nodes(id TEXT PRIMARY KEY, heartbeat REAL NOT NULL, capacity INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS groups(id TEXT PRIMARY KEY, node TEXT NOT NULL, definition TEXT NOT NULL, enabled INTEGER NOT NULL, owner TEXT);
CREATE TABLE IF NOT EXISTS devices(serial TEXT PRIMARY KEY, group_id TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS jobs(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE NOT NULL, principal TEXT NOT NULL,
 request_id TEXT NOT NULL, digest TEXT NOT NULL, request TEXT NOT NULL, state TEXT NOT NULL, node TEXT, group_id TEXT,
 lease TEXT, task_id TEXT, report TEXT, detail TEXT, updated REAL NOT NULL, UNIQUE(principal,request_id));
CREATE TABLE IF NOT EXISTS artifacts(id TEXT PRIMARY KEY, job_id TEXT NOT NULL, name TEXT NOT NULL, size INTEGER NOT NULL,
 sha256 TEXT NOT NULL, metadata TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS outbox(id TEXT PRIMARY KEY, job_id TEXT NOT NULL, target TEXT NOT NULL, payload TEXT NOT NULL,
 state TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0, due REAL NOT NULL, error TEXT);
''')
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=30, isolation_level=None)
        db.row_factory = sqlite3.Row
        try:
            db.execute('BEGIN IMMEDIATE')
            yield db
            db.commit()
        except BaseException:
            db.rollback()
            raise
        finally:
            db.close()

    def recover_deliveries(self):
        with self.db() as db:
            # A lost POST response can duplicate delivery; stable event IDs are mandatory.
            db.execute("UPDATE outbox SET state='pending' WHERE state='sending'")

    def configure_group(self, definition):
        if not isinstance(definition, dict) or not all(isinstance(definition.get(k), str) and definition[k].strip() for k in ('id', 'nodeId')):
            raise Error('INVALID_GROUP', 'id and nodeId are required')
        devices = definition.get('devices')
        if not isinstance(devices, dict) or not devices or set(devices) - {'phone', 'glasses'}:
            raise Error('INVALID_GROUP', 'Explicit phone/glasses devices required')
        serials = [v.get('serial') for v in devices.values() if isinstance(v, dict)]
        if len(serials) != len(devices) or any(not isinstance(s, str) or not s.strip() for s in serials) or len(set(serials)) != len(serials):
            raise Error('INVALID_GROUP', 'Every role needs a distinct non-empty serial')
        with self.db() as db:
            old = db.execute('SELECT * FROM groups WHERE id=?', (definition['id'],)).fetchone()
            if old and old['owner']:
                raise Error('GROUP_BUSY', 'Cannot change a leased group', 409)
            for serial in serials:
                row = db.execute('SELECT group_id FROM devices WHERE serial=?', (serial,)).fetchone()
                if row and row[0] != definition['id']:
                    raise Error('DEVICE_CONFLICT', 'Physical serial belongs to another group', 409)
            db.execute('INSERT INTO groups(id,node,definition,enabled) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET node=excluded.node,definition=excluded.definition,enabled=excluded.enabled',
                       (definition['id'], definition['nodeId'], encoded(definition), int(definition.get('enabled', True))))
            db.execute('DELETE FROM devices WHERE group_id=?', (definition['id'],))
            db.executemany('INSERT INTO devices VALUES(?,?)', [(s, definition['id']) for s in serials])
        return {'configured': True, 'groupId': definition['id']}

    def heartbeat(self, node, capacity):
        if not isinstance(capacity, int) or isinstance(capacity, bool) or not 1 <= capacity <= 100:
            raise Error('INVALID_CAPACITY', 'capacity must be 1..100')
        with self.db() as db:
            db.execute('INSERT INTO nodes VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET heartbeat=excluded.heartbeat,capacity=excluded.capacity', (node, self.clock(), capacity))
        return {'accepted': True}

    def call(self, operation, args, actor):
        if actor.get('role') not in ('user', 'admin'):
            raise Error('FORBIDDEN', 'User credentials required', 403)
        if operation not in OPERATIONS:
            raise Error('UNKNOWN_OPERATION', operation, 404)
        validate(OPERATIONS[operation], args)
        if operation == 'submit':
            return self.submit(args, actor)
        if operation == 'health':
            return {'service': 'solopi-lab', 'apiVersion': 'v1', 'ready': True}
        if operation == 'resources':
            with self.db() as db:
                rows = db.execute('SELECT g.*,n.heartbeat,n.capacity FROM groups g LEFT JOIN nodes n ON g.node=n.id').fetchall()
                return {'groups': [{'groupId': r['id'], 'nodeId': r['node'], 'enabled': bool(r['enabled']), 'busy': bool(r['owner']),
                    'online': r['heartbeat'] is not None and self.clock() - r['heartbeat'] < self.config.get('heartbeatTTL', 30),
                    'attributes': json.loads(r['definition']).get('attributes', {})} for r in rows]}
        with self.db() as db:
            if operation == 'list':
                sql = 'SELECT * FROM jobs WHERE seq>?'
                params = [args.get('after', 0)]
                if actor['role'] != 'admin':
                    sql += ' AND principal=?'; params.append(actor['id'])
                rows = db.execute(sql + ' ORDER BY seq LIMIT ?', (*params, args.get('limit', 50) + 1)).fetchall()
                page = rows[:args.get('limit', 50)]
                return {'jobs': [self.public(db, r) for r in page], 'nextAfter': page[-1]['seq'] if len(rows) > len(page) else None}
            job = self.owned(db, args['jobId'], actor)
            if operation == 'stop':
                if job['state'] == 'queued':
                    self.finish(db, job, 'stopped', {'reason': 'cancelled-before-dispatch'})
                elif job['state'] not in TERMINAL:
                    db.execute("UPDATE jobs SET state='stop_requested',updated=? WHERE id=?", (self.clock(), job['id']))
                job = db.execute('SELECT * FROM jobs WHERE id=?', (job['id'],)).fetchone()
            if operation == 'artifacts':
                return {'jobId': job['id'], 'artifacts': self.artifacts(db, job['id'])}
            return self.public(db, job)

    def owned(self, db, job_id, actor):
        job = db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone()
        if not job or (actor['role'] != 'admin' and job['principal'] != actor['id']):
            raise Error('NOT_FOUND', 'Job not found', 404)
        return job

    def artifacts(self, db, job_id):
        return [{**dict(r), 'metadata': json.loads(r['metadata']), 'downloadPath': '/v1/artifacts/' + r['id']} for r in db.execute('SELECT * FROM artifacts WHERE job_id=? ORDER BY id', (job_id,))]

    def public(self, db, row):
        return {**{k: row[k] for k in ('id', 'seq', 'state', 'node', 'group_id', 'task_id', 'updated')},
                'request': json.loads(row['request']), 'report': json.loads(row['report']) if row['report'] else None,
                'detail': json.loads(row['detail']) if row['detail'] else None,
                'deliveries': [dict(r) for r in db.execute('SELECT id,target,state,attempts,error FROM outbox WHERE job_id=?', (row['id'],))]}

    def submit(self, request, actor):
        if len(request['caseIds']) > 100 or any(not s.strip() for s in request['caseIds']):
            raise Error('INVALID_SELECTION', 'Use 1..100 explicit non-empty case IDs')
        if request.get('target') and request['target'] not in actor.get('targets', []):
            raise Error('FORBIDDEN_TARGET', 'Delivery target is not permitted', 403)
        if request.get('target') and request['target'] not in self.config.get('targets', {}):
            raise Error('UNKNOWN_TARGET', 'Configure the delivery target first')
        if not isinstance(request.get('requirements', {}), dict) or len(request['requestId']) > 200:
            raise Error('INVALID_ARGUMENT', 'Bounded request ID and object requirements required')
        target = self.config.get('targets', {}).get(request.get('target'), {})
        source = request.get('source', {})
        if any(not isinstance(source.get(k), str) or not source[k].strip() for k in target.get('requiredSourceFields', [])) or any(source.get(k) != v for k,v in target.get('sourceEquals', {}).items()):
            raise Error('SOURCE_SCOPE_MISMATCH', 'Source context differs from the permitted delivery scope', 403)
        options = request.get('options', {})
        if set(options) - {'startOptions', 'performanceOptions', 'stress', 'expectedSelectionRevision'}:
            raise Error('INVALID_OPTIONS', 'Only declared execution options accepted; devices come from the lease')
        if 'startOptions' in options:
            validate({'type':'object','properties':{k:{'type':'boolean'} for k in ('keepScreenAwake','recordPhoneScreen','recordGlassesScreen','showPhoneScreen','showGlassesScreen')},'additionalProperties':False}, options['startOptions'])
        if 'stress' in options:
            stress = options['stress']
            if not isinstance(stress, dict) or stress.get('mode') not in ('rounds','duration') or not isinstance(stress.get('value'),int) or isinstance(stress.get('value'),bool) or not 1 <= stress['value'] <= 100000:
                raise Error('INVALID_STRESS', 'Explicit rounds/duration and positive bounded value required')
        digest = hashlib.sha256(encoded(request).encode()).hexdigest()
        with self.db() as db:
            old = db.execute('SELECT * FROM jobs WHERE principal=? AND request_id=?', (actor['id'], request['requestId'])).fetchone()
            if old:
                if old['digest'] != digest:
                    raise Error('REQUEST_CONFLICT', 'requestId already binds different content', 409)
                return {**self.public(db, old), 'deduplicated': True}
            queued = db.execute("SELECT count(*) FROM jobs WHERE principal=? AND state='queued'", (actor['id'],)).fetchone()[0]
            if queued >= self.config.get('maxQueuedPerPrincipal',100):
                raise Error('QUEUE_LIMIT', 'Principal queued-job limit reached', 429)
            job_id = str(uuid.uuid4())
            db.execute('INSERT INTO jobs(id,principal,request_id,digest,request,state,updated) VALUES(?,?,?,?,?,?,?)',
                       (job_id, actor['id'], request['requestId'], digest, encoded(request), 'queued', self.clock()))
            return self.public(db, db.execute('SELECT * FROM jobs WHERE id=?', (job_id,)).fetchone())

    def claim(self, node):
        with self.db() as db:
            n = db.execute('SELECT * FROM nodes WHERE id=?', (node,)).fetchone()
            if not n or self.clock() - n['heartbeat'] >= self.config.get('heartbeatTTL', 30):
                return {'assignment': None}
            busy = db.execute('SELECT count(*) FROM groups WHERE node=? AND owner IS NOT NULL', (node,)).fetchone()[0]
            if busy >= n['capacity']:
                return {'assignment': None}
            groups = db.execute('SELECT * FROM groups WHERE node=? AND enabled=1 AND owner IS NULL ORDER BY id', (node,)).fetchall()
            for job in db.execute("SELECT * FROM jobs WHERE state='queued' ORDER BY seq").fetchall():
                request = json.loads(job['request']); required = request.get('requirements', {})
                for group in groups:
                    definition = json.loads(group['definition'])
                    attributes = {**definition.get('attributes', {}), 'nodeId': node, 'groupId': group['id']}
                    if not all(attributes.get(k) == v for k, v in required.items()):
                        continue
                    lease = secrets.token_urlsafe(32)
                    db.execute('UPDATE groups SET owner=? WHERE id=?', (job['id'], group['id']))
                    db.execute("UPDATE jobs SET state='leased',node=?,group_id=?,lease=?,updated=? WHERE id=?", (node, group['id'], lease, self.clock(), job['id']))
                    return {'assignment': {'jobId': job['id'], 'lease': lease, 'request': request, 'group': definition}}
            return {'assignment': None}

    def leased(self, db, node, job_id, lease):
        job = db.execute('SELECT * FROM jobs WHERE id=? AND node=?', (job_id, node)).fetchone()
        if not job or not isinstance(lease, str) or not secrets.compare_digest(job['lease'] or '', lease):
            raise Error('STALE_LEASE', 'Job/node/lease mismatch', 409)
        return job

    def progress(self, node, data):
        with self.db() as db:
            job = self.leased(db, node, data.get('jobId'), data.get('lease'))
            if job['state'] in TERMINAL:
                return {'accepted': True, 'state': job['state']}
            if data.get('taskId'):
                if job['task_id'] and job['task_id'] != data['taskId']:
                    raise Error('TASK_CONFLICT', 'Original taskId is immutable', 409)
                if not isinstance(data['taskId'], str):
                    raise Error('INVALID_TASK_ID', 'Expected string')
                db.execute('UPDATE jobs SET task_id=? WHERE id=?', (data['taskId'], job['id']))
            state = data.get('state', 'running')
            if state not in ('running', 'needs_reconciliation'):
                raise Error('INVALID_STATE', 'Only running or needs_reconciliation accepted')
            if job['state'] == 'stop_requested':
                state = 'stop_requested'
            db.execute('UPDATE jobs SET state=?,detail=?,updated=? WHERE id=?', (state, encoded(data.get('detail', {})), self.clock(), job['id']))
            return {'accepted': True, 'state': state}

    def control(self, node, data):
        with self.db() as db:
            job = self.leased(db, node, data.get('jobId'), data.get('lease'))
            return {'state': job['state'], 'taskId': job['task_id']}

    def complete(self, node, data):
        with self.db() as db:
            job = self.leased(db, node, data.get('jobId'), data.get('lease'))
            if job['state'] in TERMINAL:
                if job['report'] != encoded(data.get('report')):
                    raise Error('REPORT_CONFLICT', 'Terminal report is immutable', 409)
                return {'accepted': True, 'state': job['state']}
            report = data.get('report', {})
            if report.get('status') not in TERMINAL or report.get('id') != job['task_id'] or not report.get('finishedAt'):
                raise Error('INVALID_REPORT', 'Authoritative original terminal task required')
            group = json.loads(db.execute('SELECT definition FROM groups WHERE id=?', (job['group_id'],)).fetchone()[0])
            devices = report.get('devices', {})
            if any(devices.get(role, {}).get('serial') != target['serial'] for role, target in group['devices'].items()):
                raise Error('REPORT_DEVICE_MISMATCH', 'Report devices differ from leased physical devices')
            cases = report.get('cases', [])
            actual = [c.get('caseId') or c.get('id') for c in cases]
            request = json.loads(job['request'])
            stress = bool(request.get('options', {}).get('stress'))
            # Repeated stress occurrences retain baseCaseId; never treat an incomplete run as complete.
            if stress:
                actual = [c.get('sourceCaseId') or c.get('baseCaseId') or c.get('caseId') or c.get('id') for c in cases]
            if (not stress and len(actual) != len(request['caseIds'])) or not cases or set(actual) != set(request['caseIds']) or any(c.get('status') not in (CASE_TERMINAL | {'pending'} if report['status']=='stopped' else CASE_TERMINAL) for c in cases):
                raise Error('REPORT_SELECTION_MISMATCH', 'Terminal case set differs from requested selection')
            if report.get('status') != 'stopped' and int(report.get('completed', -1)) < int(report.get('total', len(cases))):
                raise Error('REPORT_INCOMPLETE', 'Report aggregate still has unresolved cases')
            self.finish(db, job, report['status'], report)
            return {'accepted': True, 'state': report['status']}

    def finish(self, db, job, state, report):
        db.execute('UPDATE jobs SET state=?,report=?,updated=? WHERE id=?', (state, encoded(report), self.clock(), job['id']))
        if job['task_id']:
            db.execute('UPDATE jobs SET detail=? WHERE id=?', (encoded({'artifactState':'pending'}),job['id']))
        db.execute('UPDATE groups SET owner=NULL WHERE id=? AND owner=?', (job['group_id'], job['id']))
        request = json.loads(job['request'])
        target = request.get('target')
        if target:
            event = {'specversion': '1.0', 'type': 'solopi.lab.job.finished', 'source': self.config.get('instanceId', 'solopi-lab'),
                     'id': job['id'] + ':finished', 'subject': job['id'], 'data': {'jobId': job['id'], 'taskId': job['task_id'], 'status': state, 'source': request.get('source', {})}}
            db.execute("INSERT OR IGNORE INTO outbox(id,job_id,target,payload,state,due) VALUES(?,?,?,?, 'pending',?)", (event['id'], job['id'], target, encoded(event), self.clock()))

    def assignments(self, node):
        with self.db() as db:
            rows = db.execute("SELECT j.*,g.definition FROM jobs j JOIN groups g ON j.group_id=g.id WHERE j.node=? AND j.state NOT IN ('success','failed','stopped')", (node,)).fetchall()
            return {'assignments': [{'jobId': r['id'], 'lease': r['lease'], 'request': json.loads(r['request']), 'group': json.loads(r['definition'])} for r in rows]}

    def cancel_unsubmitted(self, node, data):
        with self.db() as db:
            job = self.leased(db, node, data.get('jobId'), data.get('lease'))
            if job['state'] != 'stop_requested' or job['task_id']:
                raise Error('INVALID_STATE', 'Only an unsubmitted, explicitly stopped lease may be cancelled')
            self.finish(db, job, 'stopped', {'reason': 'Node confirmed no submission was attempted'})
            return {'accepted': True}

    def artifact_status(self, node, data):
        if data.get('state') not in ('pending', 'delivered', 'failed'):
            raise Error('INVALID_STATE', 'Invalid artifact delivery state')
        with self.db() as db:
            job = self.leased(db, node, data.get('jobId'), data.get('lease'))
            detail = json.loads(job['detail']) if job['detail'] else {}
            detail.update({'artifactState': data['state'], 'artifactErrors': data.get('errors', [])})
            db.execute('UPDATE jobs SET detail=? WHERE id=?', (encoded(detail), job['id']))
            return {'accepted': True}

    def reject_unsubmitted(self, node, data):
        with self.db() as db:
            job = self.leased(db, node, data.get('jobId'), data.get('lease'))
            receipt = data.get('receipt', {})
            if job['task_id'] or job['state'] not in ('leased', 'stop_requested') or receipt.get('submitted') is not False:
                raise Error('INVALID_RECEIPT', 'An explicit pre-submission refusal is required')
            self.finish(db, job, 'stopped' if job['state']=='stop_requested' else 'failed', {'submitted': False, 'errorCode': receipt.get('errorCode'), 'error': str(receipt.get('error',''))[:2000]})
            return {'accepted': True}
