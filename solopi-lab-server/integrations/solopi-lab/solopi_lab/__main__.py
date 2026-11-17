import argparse
import contextlib
import json
import os
import signal
import sys
import threading
from pathlib import Path
from . import __version__
from .core import Store, Error, OPERATIONS, encoded
from .transport import Client, Deliveries, server
from .node import Node

@contextlib.contextmanager
def single_instance(root, name):
    root = Path(root); root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (root / (name + '.lock')).open('a+b')
    try:
        if os.name == 'nt':
            import msvcrt
            lock.seek(0); lock.write(b'0'); lock.flush(); lock.seek(0)
            msvcrt.locking(lock.fileno(), msvcrt.LK_NBLCK, 1)
        else:
            import fcntl
            fcntl.flock(lock.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
    except OSError:
        lock.close(); raise Error('ALREADY_RUNNING', 'One process per role/state directory is permitted') from None
    try: yield
    finally: lock.close()

def mcp(client, incoming=sys.stdin, outgoing=sys.stdout):
    # MCP newline-delimited stdio transport. No diagnostics on stdout.
    for line in incoming:
        message = None
        try:
            message = json.loads(line)
            if not isinstance(message, dict): raise ValueError('Object required')
            if 'id' not in message: continue
            method = message.get('method')
            if method == 'initialize':
                result = {'protocolVersion': '2024-11-05', 'capabilities': {'tools': {}}, 'serverInfo': {'name': 'solopi-lab', 'version': __version__}}
            elif method == 'ping': result = {}
            elif method == 'tools/list':
                result = {'tools': [{'name': 'lab_' + name, 'description': name + ' laboratory operation; execution is asynchronous', 'inputSchema': schema} for name, schema in OPERATIONS.items()]}
            elif method == 'tools/call':
                params = message.get('params', {}); name = params.get('name', '')
                if not name.startswith('lab_') or name[4:] not in OPERATIONS:
                    raise Error('UNKNOWN_OPERATION', 'Unknown tool')
                try:
                    value = client.call(name[4:], params.get('arguments', {}))
                    result = {'content': [{'type': 'text', 'text': encoded(value)}], 'isError': False}
                except Error as error:
                    result = {'content': [{'type': 'text', 'text': encoded({'code': error.code, 'error': str(error)})}], 'isError': True}
            else:
                outgoing.write(encoded({'jsonrpc': '2.0', 'id': message.get('id'), 'error': {'code': -32601, 'message': 'Method not found'}}) + '\n'); outgoing.flush(); continue
            response = {'jsonrpc': '2.0', 'id': message['id'], 'result': result}
        except Exception:
            response = {'jsonrpc': '2.0', 'id': message.get('id') if isinstance(message, dict) else None, 'error': {'code': -32600, 'message': 'Invalid request'}}
        outgoing.write(encoded(response) + '\n'); outgoing.flush()

def main(argv=None):
    parser = argparse.ArgumentParser(prog='solopi-lab', description='Generic lab coordinator, node, JSON CLI and stdio MCP')
    parser.add_argument('--version', action='version', version=__version__)
    parser.add_argument('--config', type=Path, required=True)
    sub = parser.add_subparsers(dest='command', required=True)
    co = sub.add_parser('coordinator'); co.add_argument('--root', type=Path, required=True); co.add_argument('--host', default='127.0.0.1'); co.add_argument('--port', type=int, default=8765)
    no = sub.add_parser('node'); no.add_argument('--root', type=Path, required=True)
    group = sub.add_parser('group-set'); group.add_argument('--root', type=Path, required=True); group.add_argument('--file', type=Path, required=True)
    call = sub.add_parser('call'); call.add_argument('operation', choices=list(OPERATIONS)); call.add_argument('--file', type=Path)
    sub.add_parser('mcp')
    download = sub.add_parser('download'); download.add_argument('download_path'); download.add_argument('--output', type=Path, required=True)
    rec = sub.add_parser('node-reconcile'); rec.add_argument('--root', type=Path, required=True); rec.add_argument('--job-id', required=True); rec.add_argument('--task-id', required=True); rec.add_argument('--reason', required=True)
    arguments = parser.parse_args(argv)
    try:
        config = json.loads(arguments.config.read_text())
        if arguments.command == 'call':
            result = Client(config['endpoint'], config).call(arguments.operation, json.loads(arguments.file.read_text()) if arguments.file else {})
        elif arguments.command == 'download': result = Client(config['endpoint'], config).download(arguments.download_path, arguments.output)
        elif arguments.command == 'mcp': mcp(Client(config['endpoint'], config)); return 0
        elif arguments.command == 'group-set':
            with single_instance(arguments.root, 'configuration'):
                # Local operator configuration, not a remote model-callable operation.
                result = Store(arguments.root, config).configure_group(json.loads(arguments.file.read_text()))
        elif arguments.command == 'node-reconcile':
            with single_instance(arguments.root, 'node'):
                result = Node(arguments.root, config).reconcile(arguments.job_id, arguments.task_id, arguments.reason)
        else:
            stop = threading.Event()
            for sig in (signal.SIGTERM, signal.SIGINT): signal.signal(sig, lambda *_: stop.set())
            with single_instance(arguments.root, arguments.command):
                if arguments.command == 'node': Node(arguments.root, config).run(stop)
                else:
                    store = Store(arguments.root, config)
                    store.recover_deliveries()
                    service = server(store, arguments.host, arguments.port)
                    thread = threading.Thread(target=service.serve_forever, daemon=True); thread.start()
                    deliveries = Deliveries(store)
                    try:
                        while not stop.wait(0.5): deliveries.tick()
                    finally:
                        service.shutdown(); service.server_close(); thread.join(timeout=5)
            result = {'stopped': True}
        print(encoded(result)); return 0
    except Error as error:
        print(encoded({'success': False, 'code': error.code, 'error': str(error)})); return 1
    except Exception:
        print(encoded({'success': False, 'code': 'LOCAL_ERROR', 'error': 'Operation failed; check config, connectivity and original task state'})); return 1

if __name__ == '__main__': sys.exit(main())
