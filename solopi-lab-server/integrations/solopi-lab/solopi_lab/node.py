"""Node journal: submit once, observe original task, never retry an unknown write."""
import concurrent.futures
import contextlib
import json
import os
import sqlite3
import subprocess
import tempfile
import threading
import time
from pathlib import Path
from .core import Error, TERMINAL, encoded
from .transport import Client

class Node:
    def __init__(self, root, config, client=None):
        self.root, self.config = Path(root), config
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.path = self.root / 'node.sqlite3'
        self.client = client or Client(config['endpoint'], config, timeout=config.get('requestTimeout',10))
        with self.db() as db:
            db.executescript('''CREATE TABLE IF NOT EXISTS executions(job TEXT PRIMARY KEY, assignment TEXT NOT NULL,
 state TEXT NOT NULL, task TEXT, receipt TEXT, error TEXT);
CREATE TABLE IF NOT EXISTS uploaded(job TEXT NOT NULL, path TEXT NOT NULL, signature TEXT NOT NULL, receipt TEXT NOT NULL,
 PRIMARY KEY(job,path));
CREATE TABLE IF NOT EXISTS transfer_attempts(job TEXT PRIMARY KEY,attempts INTEGER NOT NULL DEFAULT 0);''')
        os.chmod(self.path, 0o600)

    @contextlib.contextmanager
    def db(self):
        db = sqlite3.connect(self.path, timeout=30)
        db.row_factory = sqlite3.Row
        try:
            yield db
            db.commit()
        except BaseException:
            db.rollback(); raise
        finally: db.close()

    def save(self, job, state, task=None, receipt=None, error=None):
        with self.db() as db:
            db.execute('UPDATE executions SET state=?,task=coalesce(?,task),receipt=coalesce(?,receipt),error=? WHERE job=?',
                       (state, task, encoded(receipt) if receipt is not None else None, error, job))

    def cli(self, args, timeout=None):
        if getattr(self,'stop_event',None) is not None and self.stop_event.is_set() and args[:2] != ['tasks','stop']:
            raise Error('NODE_STOPPING','Node is stopping; no new executor operation will be started')
        command = self.config.get('solopiCommand')
        if not isinstance(command, list) or not command or not all(isinstance(s, str) for s in command):
            raise Error('EXECUTOR_MISSING', 'Configure a fixed solopiCommand argv array')
        # No shell, no log of args or stderr. Keep bulky CLI results outside process memory until bounded.
        with tempfile.TemporaryFile() as out, tempfile.TemporaryFile() as err:
            result = subprocess.run([*command, *args, '--json'], stdin=subprocess.DEVNULL, stdout=out, stderr=err,
                                    timeout=timeout or self.config.get('commandTimeout', 30), check=False)
            if out.tell() > 32 * 1024 * 1024:
                raise Error('EXECUTOR_OUTPUT_LIMIT', 'Use task-scoped reports instead of unbounded CLI output')
            out.seek(0)
            try: payload = json.load(out)
            except Exception: raise Error('EXECUTOR_INVALID_RESPONSE', 'Executor did not return JSON') from None
            if result.returncode and not (args[:3] == ['tools','call','submit_task'] and payload.get('submitted') is False):
                raise Error('EXECUTOR_FAILED', 'Executor failed; inspect original task before retry')
            return payload

    def submit(self, assignment):
        request, group = assignment['request'], assignment['group']
        args = {'caseIds': request['caseIds'], 'taskName': request.get('taskName', 'Lab ' + assignment['jobId']),
                **request.get('options', {}), 'devices': group['devices']}
        with tempfile.TemporaryDirectory(prefix='submit-', dir=self.root) as temp:
            path = Path(temp) / 'arguments.json'; path.write_text(encoded(args)); os.chmod(path, 0o600)
            return self.cli(['tools', 'call', 'submit_task', '--file', str(path)])

    def accept(self, assignment):
        with self.db() as db:
            db.execute('INSERT OR IGNORE INTO executions(job,assignment,state) VALUES(?,?,?)',
                       (assignment['jobId'], encoded(assignment), 'assigned'))

    def synchronize(self):
        self.client.call('heartbeat', {'capacity': self.config.get('capacity', 1)}, node=True)
        # Recover claims whose HTTP response was lost. An absent local journal never authorizes replay.
        remote = self.client.call('assignments', node=True)['assignments']
        with self.db() as db:
            for a in remote:
                db.execute('INSERT OR IGNORE INTO executions(job,assignment,state,error) VALUES(?,?,?,?)',
                           (a['jobId'], encoded(a), 'needs_reconciliation', 'Recovered remote lease without a local submission journal'))

    def process(self, job_id):
        with self.db() as db:
            row = db.execute('SELECT * FROM executions WHERE job=?', (job_id,)).fetchone()
        assignment = json.loads(row['assignment']); auth = {k: assignment[k] for k in ('jobId', 'lease')}
        control = self.client.call('control', auth, node=True)
        if control['state'] in TERMINAL:
            if row['state'] == 'uploading' and row['receipt']:
                self.deliver_artifacts(assignment, json.loads(row['receipt']))
            else:
                self.save(job_id, 'settled')
            return
        state, task_id = row['state'], row['task']
        if state == 'uploading' and row['receipt']:
            report = json.loads(row['receipt'])
            if not self.complete_report(assignment, report): return
            self.deliver_artifacts(assignment, report)
            return
        if state in ('submitting', 'needs_reconciliation') or (state == 'assigned' and control['state'] not in ('leased', 'stop_requested')):
            self.save(job_id, 'needs_reconciliation', error='Submission outcome unknown; do not replay')
            self.client.call('progress', {**auth, 'state': 'needs_reconciliation', 'detail': {'reason': 'Node submission needs reconciliation'}}, node=True)
            return
        if state == 'assigned':
            if control['state'] == 'stop_requested':
                # No submission was attempted, but the server still requires an explicit no-submit receipt.
                self.client.call('cancel_unsubmitted', auth, node=True)
                self.save(job_id, 'settled'); return
            self.save(job_id, 'submitting')  # durable before the external side effect
            try:
                receipt = self.submit(assignment)
                if receipt.get('submitted') is False:
                    self.client.call('reject_unsubmitted', {**auth,'receipt':receipt}, node=True)
                    self.save(job_id, 'settled', receipt=receipt)
                    return
                task_id = receipt.get('taskId')
                if receipt.get('submitted') is not True or not isinstance(task_id, str) or not task_id:
                    raise Error('SUBMISSION_UNKNOWN', 'No authoritative taskId; reconcile before retry')
                self.save(job_id, 'submitted', task=task_id, receipt=receipt)
            except Exception:
                self.save(job_id, 'needs_reconciliation', error='No authoritative submission receipt; original execution may exist')
                self.client.call('progress', {**auth, 'state': 'needs_reconciliation', 'detail': {'reason': 'Submission not acknowledged; no automatic resubmission'}}, node=True)
                return
        self.client.call('progress', {**auth, 'taskId': task_id, 'state': 'running'}, node=True)
        if control['state'] == 'stop_requested':
            self.cli(['tasks', 'stop', task_id])
        response = self.cli(['tasks', 'show', task_id])
        report = response.get('task', response)
        if report.get('id') != task_id:
            raise Error('TASK_CONFLICT', 'Executor returned another task')
        if report.get('status') not in TERMINAL:
            self.client.call('progress',{**auth,'taskId':task_id,'state':'running','detail':{'progress':{k:report[k] for k in ('status','completed','total','currentCaseName') if k in report}}},node=True)
            return
        report = compact_report(report)
        # Keep the report locally before completion. Artifact retry must not keep devices occupied.
        self.save(job_id, 'uploading', task=task_id, receipt=report)
        self.complete_report(assignment, report)
        # Uploads run on a separate pool; completion must not occupy a device execution slot.

    def complete_report(self, assignment, report):
        auth = {k:assignment[k] for k in ('jobId','lease')}
        try:
            self.client.call('complete',{**auth,'report':report},node=True)
            return True
        except Error as error:
            if error.code not in ('INVALID_REPORT','REPORT_DEVICE_MISMATCH','REPORT_SELECTION_MISMATCH','REPORT_INCOMPLETE'):
                raise
            self.save(assignment['jobId'],'needs_reconciliation',error=error.code)
            self.client.call('progress',{**auth,'state':'needs_reconciliation','detail':{'reportValidationError':error.code}},node=True)
            return False

    def deliver_artifacts(self, assignment, report):
        errors = self.upload_artifacts(assignment, report)
        auth = {k: assignment[k] for k in ('jobId', 'lease')}
        with self.db() as db:
            db.execute('INSERT INTO transfer_attempts(job,attempts) VALUES(?,1) ON CONFLICT(job) DO UPDATE SET attempts=attempts+1', (assignment['jobId'],))
            attempts = db.execute('SELECT attempts FROM transfer_attempts WHERE job=?', (assignment['jobId'],)).fetchone()[0]
        exhausted = attempts >= self.config.get('artifactAttempts', 5)
        self.client.call('artifact_status', {**auth, 'state': ('failed' if exhausted else 'pending') if errors else 'delivered', 'errors': errors}, node=True)
        if not errors or exhausted:
            self.save(assignment['jobId'], 'settled', error='Artifact delivery failed; inspect artifactErrors' if errors else None)

    def upload_artifacts(self, assignment, report):
        roots = [Path(v).resolve() for v in self.config.get('artifactRoots', [])]
        errors, candidates = [], []
        def collect(value, trail, case_id):
            if isinstance(value, dict):
                for key, v in value.items(): collect(v, trail + [str(key)], case_id)
            elif isinstance(value, list):
                for i, v in enumerate(value): collect(v, trail + [str(i)], case_id)
            elif isinstance(value, str) and Path(value).is_absolute():
                path = Path(value).resolve()
                if path.is_dir(): return  # runDir is an identity, not a downloadable file
                if path.is_file() and any(path.is_relative_to(root) for root in roots):
                    candidates.append((path, {'caseId': case_id, 'field': '.'.join(trail)}))
                else:
                    errors.append({'caseId': case_id, 'field': '.'.join(trail), 'reason': 'Artifact missing or outside configured roots'})
        # Only authoritative artifact fields, not arbitrary paths in step outputs or caller input.
        for case in report.get('cases', []):
            collect(case.get('artifacts', {}), ['artifacts'], case.get('caseId') or case.get('id'))
        if report.get('reportPackagePath'):
            collect(report['reportPackagePath'], ['reportPackagePath'], None)
        for path, metadata in candidates:
            if getattr(self, 'stop_event', None) is not None and self.stop_event.is_set():
                errors.append({'reason':'Node stopping; retry delivery after restart'})
                break
            key = str(path) + ':' + encoded(metadata)
            stat = path.stat(); signature = str(stat.st_size) + ':' + str(stat.st_mtime_ns)
            with self.db() as db:
                old = db.execute('SELECT signature FROM uploaded WHERE job=? AND path=?', (assignment['jobId'], key)).fetchone()
            if old and old['signature'] == signature: continue
            try:
                receipt = self.client.upload(assignment, path, metadata)
                with self.db() as db:
                    db.execute('INSERT INTO uploaded VALUES(?,?,?,?) ON CONFLICT(job,path) DO UPDATE SET signature=excluded.signature,receipt=excluded.receipt',
                               (assignment['jobId'], key, signature, encoded(receipt)))
            except Exception:
                errors.append({'caseId': metadata['caseId'], 'field': metadata['field'], 'reason': 'Upload not acknowledged'})
        return errors

    def reconcile(self, job_id, task_id, reason):
        if not reason.strip(): raise Error('EVIDENCE_REQUIRED', 'Record an operator reconciliation reason')
        with self.db() as db:
            row = db.execute('SELECT * FROM executions WHERE job=?', (job_id,)).fetchone()
        if not row or row['state'] not in ('submitting', 'needs_reconciliation'):
            raise Error('INVALID_STATE', 'Only unknown submissions may be reconciled')
        assignment = json.loads(row['assignment'])
        response = self.cli(['tasks', 'show', task_id]); report = response.get('task', response)
        stress = assignment['request'].get('options',{}).get('stress')
        actual = {(c.get('sourceCaseId') or c.get('baseCaseId') or c.get('caseId') or c.get('id')) if stress else (c.get('caseId') or c.get('id')) for c in report.get('cases', [])}
        devices = report.get('devices', {})
        if report.get('id') != task_id or actual != set(assignment['request']['caseIds']) or any(devices.get(role, {}).get('serial') != d['serial'] for role, d in assignment['group']['devices'].items()):
            raise Error('RECONCILIATION_MISMATCH', 'Real task identity, case set and device serials must match')
        self.save(job_id, 'submitted', task=task_id, receipt={'reconciliationReason': reason, 'taskId': task_id})
        return {'reconciled': True, 'jobId': job_id, 'taskId': task_id}

    def run(self, stop):
        capacity = self.config.get('capacity', 1)
        self.stop_event = stop
        transfers = concurrent.futures.ThreadPoolExecutor(max_workers=2)
        pool = concurrent.futures.ThreadPoolExecutor(max_workers=capacity)
        active, uploading = {}, {}
        try:
            while not stop.is_set():
                try:
                    # Claim and journal immediately; synchronize afterwards so new claims are not treated as lost.
                    self.client.call('heartbeat', {'capacity': capacity}, node=True)
                    assignment = self.client.call('claim', node=True).get('assignment')
                    if assignment: self.accept(assignment)
                    self.synchronize()
                    for key, future in list(active.items()) + list(uploading.items()):
                        if future.done():
                            try: future.result()
                            except Exception:
                                # Errors remain local, independent of coordinator availability.
                                with self.db() as db:
                                    db.execute('UPDATE executions SET error=? WHERE job=?', ('Step not acknowledged; inspect original task, no submission replay', key))
                                    failed = db.execute('SELECT * FROM executions WHERE job=?',(key,)).fetchone()
                                try:
                                    a=json.loads(failed['assignment']); auth={k:a[k] for k in ('jobId','lease')}
                                    if failed['state']=='uploading':
                                        self.client.call('artifact_status',{**auth,'state':'failed','errors':[{'reason':'Delivery step interrupted; original test is not rerun'}]},node=True)
                                    else:
                                        self.client.call('progress',{**auth,'state':'needs_reconciliation' if failed['state']=='submitting' else 'running','detail':{'lastNodeError':'Step not acknowledged; inspect node journal and original task'}},node=True)
                                except Exception:
                                    pass
                            active.pop(key, None); uploading.pop(key, None)
                    with self.db() as db:
                        pending = list(db.execute("SELECT job,state FROM executions WHERE state NOT IN ('settled','needs_reconciliation')"))
                    for row in pending:
                        key = row['job']
                        if key in active or key in uploading: continue
                        if row['state'] == 'uploading':
                            if len(uploading) < 2: uploading[key] = transfers.submit(self.process, key)
                        elif len(active) < capacity:
                            active[key] = pool.submit(self.process, key)
                except Exception:
                    # Offline does not free any leased devices or authorize a second execution.
                    pass
                stop.wait(self.config.get('pollSeconds', 2))
        finally:
            pool.shutdown(wait=True, cancel_futures=True)
            transfers.shutdown(wait=True, cancel_futures=True)
            with self.db() as db:
                rows = db.execute("SELECT job,task FROM executions WHERE task IS NOT NULL AND state!='settled'").fetchall()
            # Bound shutdown to one concurrent CLI stop per known owned task. Unknown tasks stay quarantined.
            def halt(row):
                try: self.cli(['tasks', 'stop', row['task']], timeout=10)
                except Exception: pass
            with concurrent.futures.ThreadPoolExecutor(max_workers=max(1, len(rows))) as stops:
                list(stops.map(halt, rows))


def compact_report(report):
    """Keep authoritative identities and artifacts, not duplicated prompts/model payloads."""
    keep = ('id','name','status','startedAt','finishedAt','completed','total','devices','reportPackagePath',
            'taskType','stress','startOptions','executionProvenance','summary','caseRevision')
    result = {key: report[key] for key in keep if key in report}
    if not result.get('reportPackagePath') and report.get('reportPackage', {}).get('path'):
        result['reportPackagePath'] = report['reportPackage']['path']
    keys = ('id','caseId','sourceCaseId','baseCaseId','caseName','status','startedAt','endedAt','artifacts')
    result['cases'] = [{**{k: c[k] for k in keys if k in c}, 'error': str(c.get('error', ''))[:2000]} for c in report.get('cases', [])]
    return result
