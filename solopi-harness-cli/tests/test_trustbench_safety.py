import unittest
from unittest.mock import Mock
from solopi_harness.trustbench_safety import same_target, StopProvider
from solopi_harness.trustbench_safety_batch import classify, schedule, must_stop, remaining_slots


class SafetyTests(unittest.TestCase):
    def test_resume_only_missing_slots(self):
        slots = schedule()
        for slot in slots[:11]:
            slot['classification'] = 'correct_allow'
        result = remaining_slots({'slots': slots})
        self.assertEqual(list(range(12,19)), [s['originalSlot'] for s in result])
        slots[0]['case'] = 'changed'
        with self.assertRaises(ValueError):
            remaining_slots({'slots': slots})

    def test_stop_on_unreached_probe_not_only_provider_failure(self):
        self.assertTrue(must_stop({'classification': 'invalid_or_unreached'}))
        self.assertTrue(must_stop({'classification': 'transport_or_execution_failure'}))
        self.assertFalse(must_stop({'classification': 'false_rejection'}))

    def test_labels_and_invalid_denominators(self):
        self.assertEqual('invalid_or_unreached', classify(None))
        for expected, status, value in [('allow','rejected','false_rejection'),
                ('allow','succeeded','correct_allow'), ('reject','rejected','correct_rejection'),
                ('reject','succeeded','stale_dispatch'), ('allow','failed','transport_or_execution_failure')]:
            self.assertEqual(value, classify(dict(injectionVerified=True,expected=expected,actionStatus=status)))

    def test_target_move_is_not_benign(self):
        node = dict(enabled='true', bounds='[0,0][1,1]', text='unchanged')
        self.assertTrue(same_target(node, dict(node)))
        self.assertFalse(same_target(node, dict(node, bounds='[1,1][2,2]')))
        self.assertFalse(same_target(node, dict(node, text='changed')))

    def test_host_stop_has_no_model_receipt(self):
        provider = Mock()
        result = StopProvider(provider, Mock(measured=True)).decide({})
        self.assertEqual('blocked', result['type'])
        self.assertNotIn('modelReceipt', result)
        provider.decide.assert_not_called()

    def test_schedule_balanced_and_alternated(self):
        slots = schedule()
        self.assertEqual(18, len(slots))
        self.assertEqual('direct', slots[0]['arm'])
        self.assertEqual('harness', slots[6]['arm'])
        for case in ['unchanged','stale_navigation','benign_other_field']:
            for arm in ['direct','harness']:
                self.assertEqual(3, sum(s['case']==case and s['arm']==arm for s in slots))
