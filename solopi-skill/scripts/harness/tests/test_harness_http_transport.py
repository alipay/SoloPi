import json
import socket
import sys
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import test_fastpath_cli as cli_fixtures

solopi_ai = cli_fixtures.solopi_ai


class HarnessHttpTransportTests(unittest.TestCase):
    def setUp(self):
        self.requests = []
        self.responses = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def do_GET(self):
                # Synthetic loopback fixture: never logs request/query contents.
                owner.requests.append(self.client_address)
                reply = owner.responses.pop(0) if owner.responses else {}
                body = reply.get("body", b'{"success":true}')
                self.send_response(reply.get("status", 200))
                self.send_header("Content-Length", str(len(body) + reply.get("missing", 0)))
                if reply.get("location"):
                    self.send_header("Location", reply["location"])
                if reply.get("close"):
                    self.send_header("Connection", "close")
                self.end_headers()
                self.wfile.write(body)
                self.wfile.flush()
                if reply.get("missing"):
                    self.connection.shutdown(socket.SHUT_RDWR)
                if reply.get("close") or reply.get("missing"):
                    self.close_connection = True

            def log_message(self, *args):
                pass

            def handle(self):
                try:
                    super().handle()
                except (ConnectionResetError, BrokenPipeError):
                    # Deliberate client rejection closes unread synthetic bodies.
                    pass

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.server.daemon_threads = True
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.clients = []
        self.addCleanup(self.cleanup)

    def cleanup(self):
        for client in self.clients:
            client.close()
        self.server.shutdown()
        self.thread.join(timeout=2)
        self.server.server_close()

    def client(self, mode="keep-alive"):
        client = solopi_ai.HarnessHttpClient(self.server.server_port, 1, mode)
        self.clients.append(client)
        return client

    def query(self, client):
        return client.get("agent", {"type": "observe", "ownerToken": "private-token"})

    def test_keep_alive_reuses_socket_while_close_is_comparable(self):
        for mode, expected in (("keep-alive", 1), ("close", 2)):
            with self.subTest(mode=mode):
                client = self.client(mode)
                self.assertTrue(self.query(client)["success"])
                self.assertTrue(self.query(client)["success"])
                self.assertEqual(expected, len(set(self.requests[-2:])))
                self.assertEqual(expected, client.summary()["connectionsOpened"])
                self.assertEqual(2 - expected, client.summary()["reusedRequests"])
                self.assertEqual(0, client.summary()["automaticRetries"])
                client.close()

    def test_truncated_response_is_not_retried_and_next_natural_request_reconnects(self):
        self.responses = [{"missing": 20}, {}]
        client = self.client()
        with self.assertRaises(solopi_ai.CliError):
            self.query(client)
        self.assertEqual(1, len(self.requests))
        self.assertTrue(self.query(client)["success"])
        self.assertEqual(2, len(self.requests))
        self.assertEqual(2, len(set(self.requests)))
        self.assertEqual(1, client.summary()["failures"])

    def test_explicit_server_close_is_respected(self):
        self.responses = [{"close": True}, {}]
        client = self.client()
        self.query(client)
        self.query(client)
        self.assertEqual(2, len(set(self.requests)))
        self.assertEqual(1, client.summary()["serverClosedConnections"])
        self.assertEqual(0, client.summary()["failures"])

    def test_redirect_is_never_followed_and_errors_do_not_expose_owner_or_body(self):
        client = self.client()
        for reply in ({"status": 302, "location": "http://127.0.0.1:1/private-token"},
                      {"body": b'private-token-account'}, {"body": b'[]'},
                      {"body": b'\xff'}):
            with self.subTest(reply=reply):
                self.responses = [reply]
                previous = len(self.requests)
                with self.assertRaises(solopi_ai.CliError) as raised:
                    self.query(client)
                self.assertEqual(previous + 1, len(self.requests))
                encoded = json.dumps(vars(raised.exception))
                self.assertNotIn("private-token", encoded)
                self.assertNotIn("127.0.0.1", encoded)
        self.assertEqual(4, client.summary()["connectionsOpened"])

    def test_fixed_loopback_bypasses_proxy_and_resets_timeout_after_probe(self):
        client = self.client()
        with mock.patch.dict("os.environ", {"http_proxy": "http://127.0.0.1:1", "no_proxy": ""}):
            client.get("harness", {"type": "capabilities"}, timeout=0.25)
            self.assertEqual(0.25, client._connection.sock.gettimeout())
            self.query(client)
            self.assertEqual(1, client._connection.sock.gettimeout())
        self.assertEqual(1, client.summary()["connectionsOpened"])

    def test_peer_disconnect_never_replays_a_request(self):
        client = self.client()
        self.query(client)
        with mock.patch.object(client._connection, "getresponse", side_effect=solopi_ai.http.client.RemoteDisconnected()):
            with self.assertRaises(solopi_ai.CliError):
                self.query(client)
        self.assertIsNone(client._connection)
        self.assertEqual(2, client.summary()["requests"])
        self.assertEqual(1, client.summary()["connectionsOpened"])
        self.assertEqual(0, client.summary()["automaticRetries"])


if __name__ == "__main__":
    unittest.main()
