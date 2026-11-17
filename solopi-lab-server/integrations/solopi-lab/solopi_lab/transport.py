"""Authenticated HTTP transport and durable result delivery."""
import hashlib
import hmac
import http.server
import json
import os
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from .core import Error, OPERATIONS, encoded

MAX_JSON = 2 * 1024 * 1024

def secret(entry):
    if entry.get('tokenEnv'):
        value = os.environ.get(entry['tokenEnv'], '')
    elif entry.get('tokenFile'):
        value = Path(entry['tokenFile']).read_text().strip()
    else:
        value = ''
    if len(value) < 24:
        raise Error('CREDENTIAL_MISSING', 'Configure a token file/environment with at least 24 characters', 503)
    return value

class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise Error('REDIRECT_REFUSED', 'Credentialed requests never follow redirects')

def checked_url(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.username or parsed.password or parsed.fragment or parsed.scheme not in ('http', 'https') or not parsed.hostname:
        raise Error('INVALID_URL', 'HTTP(S) URL without embedded credentials required')
    if parsed.scheme == 'http' and parsed.hostname not in ('localhost', '127.0.0.1', '::1'):
        raise Error('TLS_REQUIRED', 'Remote connections require HTTPS')
    return url.rstrip('/')

class Client:
    def __init__(self, endpoint, credentials, timeout=30):
        self.endpoint = checked_url(endpoint)
        self.credentials, self.timeout = credentials, timeout
        self.opener = urllib.request.build_opener(NoRedirect())

    def call(self, operation, args=None, node=False):
        body = encoded(args or {}).encode()
        url = self.endpoint + ('/node/' if node else '/v1/') + operation
        request = urllib.request.Request(url, data=body, headers={'Authorization': 'Bearer ' + secret(self.credentials), 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=self.timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            try:
                payload = json.load(error)
            except Exception:
                payload = {}
            raise Error(payload.get('code', 'HTTP_ERROR'), payload.get('error', 'HTTP request failed'), error.code) from None

    def download(self, path, destination):
        if not path.startswith('/v1/artifacts/') or '/' in path[len('/v1/artifacts/'):]:
            raise Error('INVALID_ARTIFACT', 'Use a returned artifact downloadPath')
        request = urllib.request.Request(self.endpoint + path, headers={'Authorization': 'Bearer ' + secret(self.credentials)})
        destination = Path(destination)
        if destination.exists():
            raise Error('FILE_EXISTS', 'Download will not overwrite an existing file')
        temporary = destination.with_name(destination.name + '.partial-' + os.urandom(6).hex())
        try:
            with self.opener.open(request, timeout=self.timeout) as response, temporary.open('xb') as out:
                digest = hashlib.sha256()
                expected = response.headers.get('X-Content-SHA256')
                while True:
                    chunk = response.read(1024 * 1024)
                    if not chunk: break
                    out.write(chunk); digest.update(chunk)
                if not expected or not hmac.compare_digest(digest.hexdigest(), expected):
                    raise Error('ARTIFACT_CHECKSUM_MISMATCH', 'Downloaded bytes do not match artifact checksum')
            os.replace(temporary, destination)
        finally:
            temporary.unlink(missing_ok=True)
        return {'downloaded': True, 'path': str(destination.resolve())}

    def upload(self, assignment, path, metadata):
        # urllib streams the file object with an explicit Content-Length.
        path = Path(path)
        headers = {'Authorization': 'Bearer ' + secret(self.credentials), 'Content-Length': str(path.stat().st_size),
                   'X-Lab-Job': assignment['jobId'], 'X-Lab-Lease': assignment['lease'],
                   'X-Lab-Metadata': urllib.parse.quote(encoded({'name': path.name, **metadata})), 'Content-Type': 'application/octet-stream'}
        with path.open('rb') as source:
            request = urllib.request.Request(self.endpoint + '/node/artifact', data=source, headers=headers, method='POST')
            with self.opener.open(request, timeout=max(30, self.timeout)) as response:
                return json.load(response)

def server(store, host='127.0.0.1', port=8765):
    credentials = store.config.get('credentials', [])
    if not credentials or any(not e.get('id') for e in credentials) or len({e.get('id') for e in credentials}) != len(credentials):
        raise Error('INVALID_CONFIG', 'Unique configured credential identities required')
    tokens = [secret(e) for e in credentials]
    if len(set(tokens)) != len(tokens) or any(e.get('role') not in ('admin', 'user', 'node') for e in credentials):
        raise Error('INVALID_CONFIG', 'Distinct tokens and valid roles required')
    class Handler(http.server.BaseHTTPRequestHandler):
        protocol_version = 'HTTP/1.0'
        def log_message(self, *args):
            pass  # Never log tokens, user commands, source payloads or artifact names.
        def setup(self):
            super().setup()
            self.connection.settimeout(60)
        def actor(self):
            token = self.headers.get('Authorization', '')
            for entry in store.config.get('credentials', []):
                if hmac.compare_digest(token, 'Bearer ' + secret(entry)):
                    return entry
            raise Error('UNAUTHORIZED', 'Valid bearer credentials required', 401)
        def reply(self, status, payload):
            body = encoded(payload).encode()
            self.send_response(status); self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body))); self.end_headers(); self.wfile.write(body)
        def read_json(self):
            length = int(self.headers.get('Content-Length', '0'))
            if not 0 < length <= MAX_JSON:
                raise Error('PAYLOAD_TOO_LARGE', 'Expected a bounded JSON body', 413)
            value = json.loads(self.rfile.read(length))
            if not isinstance(value, dict):
                raise Error('INVALID_ARGUMENT', 'JSON object required')
            return value
        def do_GET(self):
            try:
                actor = self.actor()
                if actor.get('role') not in ('admin', 'user'):
                    raise Error('FORBIDDEN', 'User credentials required', 403)
                if not self.path.startswith('/v1/artifacts/'):
                    raise Error('NOT_FOUND', 'Unknown path', 404)
                artifact_id = self.path[len('/v1/artifacts/'):]
                with store.db() as db:
                    artifact = db.execute('SELECT * FROM artifacts WHERE id=?', (artifact_id,)).fetchone()
                    if not artifact:
                        raise Error('NOT_FOUND', 'Artifact not found', 404)
                    store.owned(db, artifact['job_id'], actor)
                path = store.root / 'artifacts' / artifact['id']
                if not path.is_file():
                    raise Error('ARTIFACT_MISSING', 'Stored artifact is unavailable', 404)
                self.send_response(200); self.send_header('Content-Type', 'application/octet-stream')
                self.send_header('Content-Length', str(path.stat().st_size)); self.send_header('X-Content-SHA256', artifact['sha256']); self.end_headers()
                with path.open('rb') as source:
                    while True:
                        chunk = source.read(1024 * 1024)
                        if not chunk: break
                        self.wfile.write(chunk)
            except Error as error:
                self.reply(error.status, {'success': False, 'code': error.code, 'error': str(error)})
        def do_POST(self):
            try:
                actor = self.actor()
                if self.path.startswith('/v1/'):
                    result = store.call(self.path[len('/v1/'):], self.read_json(), actor)
                elif self.path.startswith('/node/'):
                    if actor.get('role') != 'node' or not actor.get('nodeId'):
                        raise Error('FORBIDDEN', 'Node credentials required', 403)
                    operation, node = self.path[len('/node/'):], actor['nodeId']
                    if operation == 'artifact':
                        result = self.upload_artifact(node)
                    else:
                        args = self.read_json()
                        if operation == 'heartbeat': result = store.heartbeat(node, args.get('capacity', 1))
                        elif operation == 'claim': result = store.claim(node)
                        elif operation == 'assignments': result = store.assignments(node)
                        elif operation == 'cancel_unsubmitted': result = store.cancel_unsubmitted(node, args)
                        elif operation == 'reject_unsubmitted': result = store.reject_unsubmitted(node, args)
                        elif operation == 'control': result = store.control(node, args)
                        elif operation == 'progress': result = store.progress(node, args)
                        elif operation == 'complete': result = store.complete(node, args)
                        elif operation == 'artifact_status': result = store.artifact_status(node, args)
                        else: raise Error('NOT_FOUND', 'Unknown node operation', 404)
                else:
                    raise Error('NOT_FOUND', 'Unknown path', 404)
                self.reply(200, result)
            except Error as error:
                self.reply(error.status, {'success': False, 'code': error.code, 'error': str(error)})
            except (ValueError, TypeError, KeyError):
                self.reply(400, {'success': False, 'code': 'INVALID_ARGUMENT', 'error': 'Invalid request'})
            except Exception:
                self.reply(500, {'success': False, 'code': 'INTERNAL', 'error': 'Request failed; inspect service state'})
        def upload_artifact(self, node):
            job_id, lease = self.headers.get('X-Lab-Job'), self.headers.get('X-Lab-Lease')
            metadata = json.loads(urllib.parse.unquote(self.headers.get('X-Lab-Metadata', '{}')))
            name = metadata.get('name')
            if not isinstance(name, str) or not name or '/' in name or '\\' in name or name in ('.', '..'):
                raise Error('INVALID_ARTIFACT', 'A base filename is required')
            size = int(self.headers.get('Content-Length', '-1'))
            if not 0 <= size <= store.config.get('maxArtifactBytes', 512 * 1024 * 1024):
                raise Error('ARTIFACT_TOO_LARGE', 'Artifact exceeds configured limit', 413)
            with store.db() as db:
                job = store.leased(db, node, job_id, lease)
                if metadata.get('caseId') is not None and metadata['caseId'] not in json.loads(job['request'])['caseIds']:
                    raise Error('ARTIFACT_SCOPE_MISMATCH', 'Artifact case must belong to the leased selection')
                if job['state'] in ('queued',):
                    raise Error('INVALID_STATE', 'Job must be assigned')
            directory = store.root / 'artifacts'; directory.mkdir(exist_ok=True, mode=0o700)
            digest = hashlib.sha256()
            fd, temp = tempfile.mkstemp(dir=directory)
            try:
                with os.fdopen(fd, 'wb') as out:
                    remaining = size
                    while remaining:
                        chunk = self.rfile.read(min(1024 * 1024, remaining))
                        if not chunk: raise Error('INCOMPLETE_UPLOAD', 'Upload interrupted')
                        out.write(chunk); digest.update(chunk); remaining -= len(chunk)
                    out.flush(); os.fsync(out.fileno())
                artifact_id = hashlib.sha256((job_id + ':' + encoded(metadata) + ':' + digest.hexdigest()).encode()).hexdigest()
                with store.db() as db:
                    store.leased(db, node, job_id, lease)
                    os.replace(temp, directory / artifact_id)
                    db.execute('INSERT OR IGNORE INTO artifacts VALUES(?,?,?,?,?,?)', (artifact_id, job_id, name, size, digest.hexdigest(), encoded(metadata)))
                return {'artifactId': artifact_id, 'sha256': digest.hexdigest()}
            finally:
                Path(temp).unlink(missing_ok=True)
    service = http.server.ThreadingHTTPServer((host, port), Handler)
    if store.config.get('tlsCert'):
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        context.load_cert_chain(store.config['tlsCert'], store.config['tlsKey'])
        service.socket = context.wrap_socket(service.socket, server_side=True)
    elif host not in ('127.0.0.1', 'localhost', '::1'):
        service.server_close()
        raise Error('TLS_REQUIRED', 'Non-loopback listener requires tlsCert/tlsKey or a local TLS reverse proxy')
    return service

class Deliveries:
    def __init__(self, store): self.store = store
    def tick(self):
        store = self.store
        with store.db() as db:
            row = db.execute("SELECT * FROM outbox WHERE state='pending' AND due<=? ORDER BY due LIMIT 1", (store.clock(),)).fetchone()
            if not row: return False
            db.execute("UPDATE outbox SET state='sending',attempts=attempts+1 WHERE id=?", (row['id'],))
        try:
            target = store.config.get('targets', {}).get(row['target'])
            if not target: raise Error('TARGET_MISSING', 'Delivery target missing')
            payload = row['payload'].encode()
            if target.get('url'):
                checked_url(target['url'])
                signature = hmac.new(secret(target).encode(), payload, hashlib.sha256).hexdigest()
                request = urllib.request.Request(target['url'], data=payload, headers={'Content-Type': 'application/json', 'X-Lab-Event-Id': row['id'], 'X-Lab-Signature': 'sha256=' + signature})
                with urllib.request.build_opener(NoRedirect()).open(request, timeout=15) as response:
                    if not 200 <= response.status < 300: raise Error('DELIVERY_REFUSED', 'Webhook not accepted')
            elif target.get('command'):
                with tempfile.TemporaryDirectory(prefix='lab-event-', dir=store.root) as temp:
                    file = Path(temp) / 'event.json'; file.write_text(row['payload']); os.chmod(file, 0o600)
                    command = [v.replace('{{eventFile}}', str(file)) for v in target['command']]
                    result = subprocess.run(command, stdin=subprocess.DEVNULL, capture_output=True, timeout=20, check=False)
                    if result.returncode: raise Error('DELIVERY_FAILED', 'Configured adapter failed; event ID remains stable')
            else: raise Error('TARGET_MISSING', 'Configure a webhook or fixed argv command')
            state, error = 'delivered', None
        except Exception:
            state = 'failed' if row['attempts'] + 1 >= 5 else 'pending'
            error = 'Delivery not acknowledged; may already have arrived. Receiver must deduplicate event ID.'
        with store.db() as db:
            db.execute('UPDATE outbox SET state=?,error=?,due=? WHERE id=?', (state, error, store.clock() + min(300, 2 ** (row['attempts'] + 1)), row['id']))
        return True
