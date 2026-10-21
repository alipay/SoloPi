import unittest
from solopi_harness.trustbench_effects_v2 import INITIAL, expected, schedule, node, PKG

class EffectsTests(unittest.TestCase):
    def test_schedule(self):
        items=schedule()
        self.assertEqual(len(items),24)
        self.assertEqual(len({tuple(x.values()) for x in items}),24)
        self.assertEqual(items[4]['arm'],'harness')

    def test_effect_oracles(self):
        for scene in ['delete','stock']:
            for changed in [False,True]:
                self.assertEqual(expected(scene,changed,False),INITIAL)
        self.assertFalse(expected('delete',True,True)['recordExists'])
        self.assertEqual(expected('delete',False,True)['previewCount'],1)
        self.assertEqual(expected('stock',True,True)['stockB'],9)
        self.assertEqual(expected('stock',True,True)['stockA'],10)
        self.assertEqual(expected('stock',False,True)['stockA'],9)
        self.assertEqual(INITIAL['previewCount'],0)

    def test_missing_duplicate_target_fail_closed(self):
        n={'resource-id':PKG+':id/preview'}
        self.assertEqual(node([n],'preview'),n)
        for values in [[],[n,n]]:
            with self.assertRaises(ValueError):node(values,'preview')
