import tempfile
import unittest
from pathlib import Path
from unittest import mock
from solopi_harness import solopi_ai as c


class ReobserveTests(unittest.TestCase):
    def run_case(self, enabled=True, same_id=False, twice=False, transport='solopi_guarded', changed=False):
        args=c.build_parser().parse_args(['verify-run','--plan','plan.json','--artifacts','artifacts'] +
                                       (['--agent-reobserve-stale'] if enabled else []))
        initial={'observationId':'old','page':{}}
        fresh={'observationId':'old' if same_id else 'fresh','page':{}}
        if changed:fresh['page']={'text':'Object B'}
        action={'type':'act','action':{'type':'back'}}
        provider=mock.Mock()
        provider.decide.side_effect=[action,action if twice else {'type':'blocked','reason':'target disappeared'}]
        step=dict(id='test',goal='test goal',allowedActions=['back'],budget={'maxSteps':3})
        segment=dict(segmentId='test',dynamicStep=step)
        stale={'receipt':{'status':'rejected','errorCode':'stale_observation'}}
        with tempfile.TemporaryDirectory() as tmp, \
             mock.patch.object(c,'command_agent_session_start',return_value=({'session':{'sessionId':'s'},'observation':initial},0)), \
             mock.patch.object(c,'command_agent_observe',return_value=({'success':True,'observation':fresh},0)) as observe, \
             mock.patch.object(c,'command_agent_query',return_value=({},0)), \
             mock.patch.object(c,'command_agent_mutation',return_value=({},0)):
            adapter=c.SoloPiVerificationAdapter(args,mock.Mock(),Path(tmp),Path(tmp)/'events.jsonl',provider)
            adapter.action_transport=transport
            adapter._perform_agent_action=mock.Mock(return_value=(stale,2))
            result=adapter._execute_dynamic(segment,{'id':'scene','targetAppPackage':'app'},[])
            return result,provider,observe.call_count,adapter._perform_agent_action.call_count

    def test_redecides_using_fresh_observation_without_replaying_old_action(self):
        result,provider,observes,actions=self.run_case()
        self.assertEqual((observes,actions),(1,1))
        self.assertEqual(provider.decide.call_args_list[1].args[0]['observation']['observationId'],'fresh')
        self.assertFalse(result['agentDone'])

    def test_recovery_is_opt_in(self):
        result,provider,observes,actions=self.run_case(enabled=False)
        self.assertEqual((observes,actions,provider.decide.call_count),(0,1,1))
        self.assertEqual(result['reason'],'agent_action_failed')

    def test_same_observation_cannot_authorize_recovery(self):
        result,provider,observes,actions=self.run_case(same_id=True)
        self.assertEqual(provider.decide.call_count,1)
        self.assertEqual(result['reason'],'agent_reobserve_failed')

    def test_second_stale_rejection_does_not_loop(self):
        result,provider,observes,actions=self.run_case(twice=True)
        self.assertEqual((observes,actions,provider.decide.call_count),(1,2,2))
        self.assertEqual(result['reason'],'agent_action_failed')

    def test_direct_transport_never_uses_recovery(self):
        _,provider,observes,actions=self.run_case(transport='host_direct_adb')
        self.assertEqual((observes,actions,provider.decide.call_count),(0,1,1))

    def test_changed_context_stops_before_another_model_call_or_action(self):
        result,provider,observes,actions=self.run_case(changed=True)
        self.assertEqual((observes,actions,provider.decide.call_count),(1,1,1))
        self.assertEqual(result['reason'],'agent_context_review_required')

    def test_context_comparison_preserves_business_fields_and_structure(self):
        previous={'page':{'nodeId':'old','text':'A','children':[{'text':'units'}]}}
        same={'page':{'nodeId':'new','text':'A','children':[{'text':'units'}]}}
        self.assertTrue(c.agent_reobserve_context_equivalent(previous,same))
        same['page']['children'][0]['text']='boxes'
        self.assertFalse(c.agent_reobserve_context_equivalent(previous,same))
        self.assertFalse(c.agent_reobserve_context_equivalent({},{}))
