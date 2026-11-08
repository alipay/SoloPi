import contextlib
import importlib.util
import io
import tempfile
import unittest
from pathlib import Path
from unittest import mock


SCRIPT = Path(__file__).resolve().parents[1] / 'examples/fastpath/android-demo/fixture_pipe_probe.py'
SPEC = importlib.util.spec_from_file_location('fixture_pipe_probe', SCRIPT)
probe = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(probe)


class CleanupTest(unittest.TestCase):
    def test_unconfirmed_cleanup_waits_for_explicit_retry_and_keeps_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            evidence = Path(directory) / 'evidence'
            evidence.write_text('synthetic evidence')
            session = mock.Mock()
            session.owner_token = 'private-owner-token'
            session.close.side_effect = [RuntimeError('private-owner-token'), {'cleanupConfirmed': True}]
            commands = iter(['not-enter', ''])

            def read_command():
                self.assertTrue(evidence.exists())
                self.assertEqual(session.close.call_count, 1)
                return next(commands)

            with contextlib.redirect_stdout(io.StringIO()) as output:
                probe.cleanup_until_confirmed(session, directory, read_command=read_command)
            self.assertEqual(session.close.call_count, 2)
            self.assertTrue(evidence.exists())
            self.assertNotIn(session.owner_token, output.getvalue())
            self.assertIn('cleanup_confirmed=false', output.getvalue())
            self.assertIn('cleanup_confirmed=true', output.getvalue())
            self.assertIn('in-memory recovery capability will be lost', output.getvalue())
            session.act.assert_not_called()

    def test_eof_and_interrupt_do_not_initiate_another_cleanup(self):
        session = mock.Mock()
        session.close.side_effect = [{'cleanupConfirmed': False}, {'cleanupConfirmed': True}]
        reads = iter([EOFError(), KeyboardInterrupt(), ''])
        sleeps = []

        def read_command():
            self.assertEqual(session.close.call_count, 1)
            value = next(reads)
            if isinstance(value, BaseException):
                raise value
            return value

        with contextlib.redirect_stdout(io.StringIO()):
            probe.cleanup_until_confirmed(session, '/private/evidence', read_command=read_command,
                                          sleep=lambda seconds: sleeps.append(seconds))
        self.assertEqual(sleeps, [1])
        self.assertEqual(session.close.call_count, 2)
        session.act.assert_not_called()

    def test_confirmed_cleanup_does_not_request_input(self):
        session = mock.Mock()
        session.close.return_value = {'cleanupConfirmed': True}
        read_command = mock.Mock(side_effect=AssertionError('unexpected prompt'))
        with contextlib.redirect_stdout(io.StringIO()):
            probe.cleanup_until_confirmed(session, '/private/evidence', read_command=read_command)
        read_command.assert_not_called()
        session.close.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
