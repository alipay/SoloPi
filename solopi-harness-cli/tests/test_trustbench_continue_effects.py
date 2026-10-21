import json
import runpy
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch
from solopi_harness.trustbench_effects_run import schedule


class ContinuationTests(unittest.TestCase):
    def check(self,slots,**extra):
        module=runpy.run_path(str(Path(__file__).resolve().parents[2]/'tools/trustbench_continue_effects.py'))
        fn=module['checked_prefix']
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            (root/'results.json').write_text(json.dumps(dict(slots=slots,**extra)))
            with patch.dict(fn.__globals__,audit=lambda *args:{'validSlots':4}):
                return fn(root,root/'protocol.json',root/'audit.json')

    def prefix(self):
        slots=schedule()
        for s in slots[:4]:s['status']='recorded'
        return slots

    def test_only_twenty_unattempted_positions_remain(self):
        result,count=self.check(self.prefix())
        self.assertEqual(count,4)
        self.assertEqual(len(result['slots'][count:]),20)

    def test_failed_or_running_slot_cannot_be_retried(self):
        for status in ['running','unavailable','recorded']:
            slots=self.prefix();slots[4]['status']=status
            with self.assertRaises(ValueError):self.check(slots)

    def test_nonprefix_or_stopped_source_rejected(self):
        slots=self.prefix();slots[0].pop('status');slots[4]['status']='recorded'
        with self.assertRaises(ValueError):self.check(slots)
        with self.assertRaises(ValueError):self.check(self.prefix(),stopped=True)
