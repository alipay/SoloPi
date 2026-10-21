import json
from pathlib import Path
import tempfile
import unittest

from solopi_harness.trustbench_effects_v2 import digest
from solopi_harness.trustbench_effects_v2_audit import audit, evidence_dir, normalized_hashes


class PortableEffectsAuditTests(unittest.TestCase):
    def test_relocation_ignores_original_host(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            name = '01-delete-unchanged-direct'
            slot = dict(scene='delete', inject=False, arm='direct',
                        runDir='/unavailable/author/path/' + name)
            self.assertEqual(evidence_dir(root, slot, 1), root / name)

    def test_wrong_slot_path_rejected(self):
        slot = dict(scene='delete', inject=False, arm='direct', runDir='/host/wrong')
        with self.assertRaises(ValueError):
            evidence_dir(Path('/evidence'), slot, 1)

    def test_symlink_escape_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / 'root'
            root.mkdir()
            name = '01-delete-unchanged-direct'
            (root / name).symlink_to(Path(directory), target_is_directory=True)
            slot = dict(scene='delete', inject=False, arm='direct', runDir=name)
            with self.assertRaises(ValueError):
                evidence_dir(root, slot, 1)

    def test_hash_keys_portable_but_not_ambiguous(self):
        self.assertEqual(normalized_hashes({'/old/slot/action.json': 'abc'}),
                         normalized_hashes({'/new/slot/action.json': 'abc'}))
        with self.assertRaises(ValueError):
            normalized_hashes({'/one/slot/a.json': 'a', '/two/slot/a.json': 'a'})

    def test_pending_not_counted_and_index_mismatch_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            protocol = root / 'protocol.json'
            slot = dict(scene='delete', repetition=1, inject=False, arm='direct')
            protocol.write_text(json.dumps(dict(protocolId='test', schedule=[slot])))
            (root / 'results.json').write_text(json.dumps(dict(
                protocolSha256=digest(protocol), slots=[slot])))
            report = audit(root, protocol)
            self.assertEqual(report['validSlots'], 0)
            self.assertEqual(report['pendingSlots'], [1])
            index = root / 'index.json'
            index.write_text(json.dumps(report))
            self.assertTrue(audit(root, protocol, index)['expectedIndexVerified'])
            report['resultsSha256'] = 'wrong'
            index.write_text(json.dumps(report))
            with self.assertRaises(ValueError):
                audit(root, protocol, index)

    def test_missing_results_fails(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaises(FileNotFoundError):
                audit(Path(directory), Path(directory) / 'protocol.json')
