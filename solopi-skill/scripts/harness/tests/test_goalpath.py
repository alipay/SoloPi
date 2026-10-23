import copy
import io
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest import mock

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import goalpath, goalpath_runtime


PACKAGE = "com.example.app"


def condition(text="Finished"):
    return {"selector": {"resourceId": "status"}, "field": "text", "equals": text}


def policy(**overrides):
    step = {"instructions": "Follow the goal, choose one action or abstain.", "stopWhen": condition(),
            "inputData": {"query": "天气"}}
    step.update(overrides)
    return {"schemaVersion": goalpath.POLICY_SCHEMA, "targetPackage": PACKAGE, "steps": {"task": step}}


def node(node_id, text="", **overrides):
    result = {"nodeId": node_id, "packageName": PACKAGE, "className": "android.widget.Button",
              "resourceId": "id/" + node_id, "text": text,
              "visible": True, "isVisibleToUser": True, "isEnabled": True, "isClickable": True,
              "isEditable": False, "isPassword": False,
              "nodeBound": {"left": 10, "top": 10, "right": 110, "bottom": 80}}
    result.update(overrides)
    return result


def context(children=None, **overrides):
    result = {"stepId": "task", "goal": "打开搜索后输入天气，随后返回首页。", "allowedActions": ["click"],
              "ownerToken": "private-owner", "sessionId": "private-session", "history": [],
              "observation": {"observationId": "observation-current", "page": {
                  "packageName": PACKAGE, "visible": True, "isVisibleToUser": True,
                  "nodeBound": {"left": 0, "top": 0, "right": 1080, "bottom": 2400}, "children": children or [
                      node("search", "搜索"), node("cancel", "取消"),
                      node("status", "Ready", resourceId="status", isClickable=False)]}}}
    result.update(overrides)
    return result


def laya_answer(request, selected="candidate_0"):
    choices = request["questions"]["action"]["criteria"]
    return {"answers": {"action": {"choice": selected,
                                    "probs": {key: 1.0 if key == selected else 0.0 for key in choices}}}}


def llm_request():
    return {"schemaVersion": "solopi.ai.goalpath-choice/v1", "goal": "Open search", "instructions": "Choose safely",
            "history": [], "pageText": ["Search"], "pageTextTruncated": False,
            "candidates": {"candidate_0": {"label": "Search", "operation": "click"}}}


def completion(content='{"choice":"candidate_0"}', **overrides):
    result = {"model": "qwen-test", "choices": [{"finish_reason": "stop", "message": {
        "role": "assistant", "content": content}}], "usage": {"prompt_tokens": 40, "completion_tokens": 7, "total_tokens": 47}}
    result.update(overrides)
    return result


class GoalPathTests(unittest.TestCase):
    def test_effect_feedback_is_bounded_and_does_not_turn_failure_into_progress(self):
        item = {"action": {"type": "click"}, "status": "succeeded", "effect": "NO_VISIBLE_CHANGE"}
        self.assertEqual("NO_VISIBLE_CHANGE", goalpath._history([item])[0]["effect"])
        for invalid in ("PASSED", {"ownerToken": "private"}, None):
            changed = {**item, "effect": invalid}
            if invalid is None:
                self.assertNotIn("effect", goalpath._history([changed])[0])
            else:
                with self.assertRaises((ValueError, TypeError)):
                    goalpath._history([changed])
        with self.assertRaises(ValueError):
            goalpath._history([{**item, "status": "failed"}])

    def llm(self, response=None, local_policy=None):
        self.predictor = mock.Mock(return_value=response or {"choice": "candidate_0"})
        # Mock attributes are otherwise manufactured on access.
        self.predictor.model = "injected-test"
        return goalpath.GoalPathDecisionProvider(local_policy or policy(), mode="llm", llm_predictor=self.predictor)

    def test_generic_candidates_derive_clickable_parent_label_without_selectors(self):
        source = context([node("parent", "", children=[node("label", "更多", isClickable=False)]), node("other", "我的")])
        before = copy.deepcopy(source)
        result = self.llm().decide(source)
        self.assertEqual({"type": "click", "nodeId": "parent"}, result["action"])
        features = self.predictor.call_args.args[0]["candidates"]["candidate_0"]
        self.assertEqual("更多", features["label"])
        self.assertNotIn("children", features)
        self.assertEqual(before, source)
        raw = json.dumps(self.predictor.call_args.args[0])
        for secret in ("private-owner", "private-session", "nodeId", "resourceId", "observation-current"):
            self.assertNotIn(secret, raw)

    def test_roles_values_selected_and_limited_context_are_observed_not_invented(self):
        source = context([node("container", "Search group", isClickable=False, children=[
            node("query", "old", className="android.widget.EditText", isEditable=True,
                 isSelected=True, description="Search input")])], allowedActions=["input"])
        result = self.llm().decide(source)
        item = self.predictor.call_args.args[0]["candidates"]["candidate_0"]
        self.assertEqual(("textbox", "old", True, ["Search group"]),
                         (item["role"], item["value"], item["selected"], item["parents"]))
        self.assertNotIn("checked", item)
        self.assertEqual({"type": "input", "nodeId": "query", "text": "天气"}, result["action"])

    def test_no_input_candidates_without_frozen_data(self):
        result = self.llm(local_policy=policy(inputData={})).decide(
            context([node("query", isEditable=True)], allowedActions=["input"]))
        self.assertEqual("no_candidates", result["reason"])
        self.predictor.assert_not_called()

    def test_page_text_includes_disabled_status_but_excludes_hidden_foreign_password_subtrees(self):
        source = context([
            node("search", "Search", description="Search"),
            node("loading", "正在努力加载", isClickable=False, isEnabled=False),
            node("duplicate", "正在努力加载", isClickable=False),
            node("hidden", "hidden-value", isVisibleToUser=False),
            node("foreign", "foreign-value", packageName="other.app"),
            node("password", "password-value", isPassword=True, children=[node("child", "nested-password")]),
            node("unknown", "unknown-value", isPassword=None, isEditable=True,
                 children=[node("unknown-child", "nested-unknown")]),
            node("offscreen", "offscreen-value", nodeBound={"left": 0, "top": 2500, "right": 100, "bottom": 2600})])
        result = self.llm().decide(source)
        request = self.predictor.call_args.args[0]
        self.assertEqual(["Search", "正在努力加载"], request["pageText"])
        self.assertFalse(request["pageTextTruncated"])
        self.assertEqual({"count": 2, "truncated": False}, result["modelReceipt"]["pageTextSummary"])
        self.assertNotIn("pageText", result["modelReceipt"])

    def test_page_text_has_deterministic_bounds_and_explicit_truncation(self):
        source = context([node("text-%d" % i, "status-%d" % i, isClickable=False) for i in range(66)],
                         allowedActions=["wait"])
        self.llm().decide(source)
        request = self.predictor.call_args.args[0]
        self.assertEqual(["status-%d" % i for i in range(64)], request["pageText"])
        self.assertTrue(request["pageTextTruncated"])
        self.llm().decide(context([node("long", "x" * 129, isClickable=False)], allowedActions=["wait"]))
        request = self.predictor.call_args.args[0]
        self.assertEqual(["x" * 128], request["pageText"])
        self.assertTrue(request["pageTextTruncated"])

    def test_input_cannot_be_invented_by_model(self):
        result = self.llm({"choice": "candidate_0", "text": "send money"}).decide(context())
        self.assertEqual("invalid_llm_response", result["reason"])
        self.assertNotIn("action", result)

    def test_unknown_password_state_blocks_input_on_older_device_contract(self):
        for password in (None, "false", 0):
            provider = self.llm()
            result = provider.decide(context([node("query", "", isEditable=True, isPassword=password)],
                                               allowedActions=["click", "input"]))
            self.assertEqual("input_password_state_unavailable", result["reason"])
            self.predictor.assert_not_called()

    def test_ready_page_gate_rejects_same_package_permission_dialog_for_all_backends(self):
        for mode in ("rules", "laya", "llm", "hybrid"):
            laya = mock.Mock(); llm = mock.Mock(); llm.model = "test"
            kwargs = {"laya_predictor": laya} if mode in {"laya", "hybrid"} else {}
            if mode in {"llm", "hybrid"}:
                kwargs["llm_predictor"] = llm
            provider = goalpath.GoalPathDecisionProvider(policy(readyWhen=condition("Ready")), mode=mode, **kwargs)
            result = provider.decide(context([node("allow", "允许"), node("deny", "拒绝")]))
            self.assertEqual("page_not_ready", result["reason"])
            laya.assert_not_called(); llm.assert_not_called()

    def test_scroll_back_wait_are_frozen_choices_filtered_by_allowed_actions(self):
        for selected, action in [("candidate_0", {"type": "scroll", "nodeId": "list", "direction": "up", "distance": 60}),
                                 ("candidate_1", {"type": "scroll", "nodeId": "list", "direction": "down", "distance": 60}),
                                 ("candidate_2", {"type": "back"}),
                                 ("candidate_3", {"type": "wait", "durationMs": 500})]:
            with self.subTest(selected=selected):
                result = self.llm({"choice": selected}).decide(context([node("list", "", isScrollable=True)],
                    allowedActions=["scroll", "back", "wait"]))
                self.assertEqual(action, result["action"])

    def test_hidden_disabled_foreign_unknown_and_password_nodes_never_become_candidates(self):
        source = context([node("disabled", "Pay", isEnabled=False), node("hidden", "Pay", visible=False),
                          node("foreign", "Pay", packageName="other.package"), node("unknown", "Pay", isEnabled=None),
                          node("password", "secret-value", isPassword=True, isEditable=True), node("okay", "Search"),
                          node("hidden-parent", "", visible=False, children=[node("hidden-child", "Pay")])])
        result = self.llm().decide(source)
        self.assertEqual("okay", result["action"]["nodeId"])
        self.assertEqual(1, len(result["modelReceipt"]["candidates"]))
        self.assertNotIn("secret-value", json.dumps(self.predictor.call_args.args[0]))

    def test_deny_labels_applies_to_every_backend_and_parent_child_labels(self):
        source = context([node("pay", "", children=[node("pay-label", "确认付款", isClickable=False)]), node("back", "返回")])
        local_policy = policy(denyLabels=["确认付款"])
        for mode in ("rules", "laya", "llm", "hybrid"):
            kwargs = {"laya_predictor": laya_answer} if mode in {"laya", "hybrid"} else {}
            if mode in {"llm", "hybrid"}:
                kwargs["llm_predictor"] = lambda _: {"choice": "candidate_0"}
            provider = goalpath.GoalPathDecisionProvider(local_policy, mode=mode, **kwargs)
            result = provider.decide({**source, "goal": "返回"})
            self.assertEqual("back", result["action"]["nodeId"])

    def test_all_backends_get_identical_generic_candidate_digest_and_rules_do_not_leak(self):
        local_policy = policy(rules=[{"action": "click", "selector": {"resourceId": "id/cancel"}}])
        source = context()
        results, requests = [], []
        def callback(request):
            requests.append(request)
            return {"choice": "candidate_0"}
        for mode in ("rules", "laya", "llm", "hybrid"):
            kwargs = {"laya_predictor": laya_answer} if mode in {"laya", "hybrid"} else {}
            if mode in {"llm", "hybrid"}:
                kwargs["llm_predictor"] = callback
            results.append(goalpath.GoalPathDecisionProvider(local_policy, mode=mode, **kwargs).decide(source))
        self.assertEqual(1, len({r["modelReceipt"]["requestDigest"] for r in results}))
        self.assertEqual("cancel", results[0]["action"]["nodeId"])
        for result in results[1:]:
            self.assertEqual("search", result["action"]["nodeId"])
        self.assertNotIn("id/cancel", json.dumps(requests))

    def test_configured_rules_can_use_when_and_frozen_input(self):
        p = policy(rules=[{"when": condition("Input"), "action": "input", "selector": {"resourceId": "id/query"}, "inputKey": "query"}])
        provider = goalpath.GoalPathDecisionProvider(p)
        source = context([node("status", "Input", resourceId="status", isClickable=False), node("query", isEditable=True)], allowedActions=["input"])
        self.assertEqual("天气", provider.decide(source)["action"]["text"])
        source["observation"]["page"]["children"][0]["text"] = "Other"
        self.assertEqual("rules_no_unique_match", provider.decide(source)["reason"])

    def test_private_child_id_rule_resolves_nearest_clickable_parent_and_context(self):
        source = context([node("group-a", "", resourceId="group-a", isClickable=False, children=[
            node("parent-a", "", resourceId="shared-container", children=[
                node("label-a", "服务", resourceId="stable-label", isClickable=False)])]),
            node("group-b", "", resourceId="group-b", isClickable=False, children=[
                node("parent-b", "", resourceId="shared-container", children=[
                    node("label-b", "服务", resourceId="stable-label", isClickable=False)])])])
        p = policy(rules=[{"action": "click", "selector": {"resourceId": "stable-label"}}])
        self.assertEqual("rules_no_unique_match", goalpath.GoalPathDecisionProvider(p).decide(source)["reason"])
        p["steps"]["task"]["rules"][0]["ancestorSelector"] = {"resourceId": "group-b"}
        result = goalpath.GoalPathDecisionProvider(p).decide(source)
        self.assertEqual({"type": "click", "nodeId": "parent-b"}, result["action"])
        self.assertEqual(2, len(result["modelReceipt"]["candidates"]))

    def test_raw_visibility_metadata_and_viewport_are_required_even_to_stop(self):
        provider = self.llm()
        source = context([node("status", "Finished", resourceId="status")])
        source["observation"]["page"]["children"][0].pop("isVisibleToUser")
        self.assertEqual("visibility_metadata_unavailable", provider.decide(source)["reason"])
        source = context(); source["observation"]["page"].pop("nodeBound")
        self.assertEqual("viewport_bounds_unavailable", provider.decide(source)["reason"])
        self.predictor.assert_not_called()

    def test_offscreen_and_clipped_centers_cannot_be_clicked_or_end_work(self):
        source = context([node("offscreen", "Danger", isVisibleToUser=False),
                          node("outside", "Danger", nodeBound={"left": 1080, "top": 0, "right": 1200, "bottom": 100}),
                          node("clipped", "Danger", nodeBound={"left": -150, "top": 0, "right": 50, "bottom": 100}),
                          node("status", "Finished", resourceId="status", isVisibleToUser=False), node("safe", "Search")])
        result = self.llm().decide(source)
        self.assertEqual("safe", result["action"]["nodeId"])
        self.assertEqual(1, len(result["modelReceipt"]["candidates"]))

    def test_candidate_overflow_blocks_without_answer_based_truncation(self):
        result = self.llm(local_policy=policy(maxCandidates=1)).decide(context())
        self.assertEqual("too_many_candidates", result["reason"])
        self.predictor.assert_not_called()

    def test_duplicate_node_ids_and_cyclic_trees_block_before_model(self):
        source = context([node("same", "A"), node("same", "B")])
        provider = self.llm()
        self.assertEqual("ambiguous_node_id", provider.decide(source)["reason"])
        source = context()
        source["observation"]["page"]["children"].append(source["observation"]["page"])
        self.assertEqual("invalid_observation_or_history", provider.decide(source)["reason"])
        self.predictor.assert_not_called()

    def test_hidden_or_ambiguous_stop_condition_cannot_end_exploration(self):
        for children in [[node("status", "Finished", resourceId="status", visible=False), node("search", "Search")],
                         [node("s1", "Finished", resourceId="status"), node("s2", "Finished", resourceId="status")]]:
            result = self.llm().decide(context(children))
            self.assertNotEqual("done", result["type"])

    def test_stop_condition_can_read_disabled_nodes_and_does_not_pass_oracle(self):
        provider = self.llm()
        result = provider.decide(context([node("status", "Finished", resourceId="status", isEnabled=False)]))
        self.assertEqual("done", result["type"])
        self.assertNotIn("passed", json.dumps(result))
        self.predictor.assert_not_called()

    def test_multi_step_click_input_back_then_done_uses_actual_success_history(self):
        p = policy(minCompletedActions=3)
        choices = iter(["candidate_0", "candidate_1", "candidate_0"])
        requests = []
        def predictor(request):
            requests.append(request)
            return {"choice": next(choices)}
        provider = goalpath.GoalPathDecisionProvider(p, mode="llm", llm_predictor=predictor)
        history = []
        pages = [[node("search", "搜索")], [node("query", "", isEditable=True)], [node("back", "返回")]]
        for children, allowed in zip(pages, [["click"], ["click", "input"], ["click"]]):
            result = provider.decide(context(children, allowedActions=allowed, history=copy.deepcopy(history)))
            self.assertEqual("act", result["type"])
            history.append({"action": result["action"], "label": "Executed target", "status": "succeeded"})
        self.assertEqual(["click", "input", "click"], [h["action"]["type"] for h in history])
        terminal = context([node("status", "Finished", resourceId="status")], history=history)
        self.assertEqual("done", provider.decide(terminal)["type"])
        self.assertEqual([0, 1, 2], [len(x["history"]) for x in requests])
        self.assertNotIn("nodeId", json.dumps(requests))
        self.assertEqual("succeeded", requests[-1]["history"][-1]["status"])

    def test_rejected_history_does_not_count_towards_minimum_or_claim_success(self):
        p = policy(minCompletedActions=1)
        source = context([node("status", "Finished", resourceId="status")], history=[{
            "action": {"type": "click", "nodeId": "old", "text": "untrusted"}, "label": "Search",
            "status": "rejected", "errorCode": "stale_observation"}])
        result = self.llm(local_policy=p).decide(source)
        self.assertEqual("act", result["type"])
        history = self.predictor.call_args.args[0]["history"]
        self.assertEqual("rejected", history[0]["status"])
        self.assertNotIn("untrusted", json.dumps(history))

    def test_completed_action_count_survives_history_window_and_rejections(self):
        provider = self.llm(local_policy=policy(minCompletedActions=1))
        history = [{"action": {"type": "click"}, "status": "succeeded"}] + [
            {"action": {"type": "click"}, "status": "rejected", "errorCode": "stale_observation"} for _ in range(8)]
        source = context([node("status", "Finished", resourceId="status")], history=history)
        self.assertEqual("done", provider.decide(source)["type"])
        source["history"] = history[-8:]
        source["completedActionCount"] = 1
        self.assertEqual("done", provider.decide(source)["type"])
        source["completedActionCount"] = True
        self.assertEqual("invalid_completed_action_count", provider.decide(source)["reason"])

    def test_laya_refusal_escalates_to_llm_with_same_goal_history_and_candidates(self):
        received = []
        def laya(request):
            received.append(request)
            return laya_answer(request, "abstain")
        def llm(request):
            received.append(request)
            return {"choice": "candidate_1"}
        result = goalpath.GoalPathDecisionProvider(policy(), mode="hybrid", laya_predictor=laya, llm_predictor=llm).decide(context())
        self.assertEqual("cancel", result["action"]["nodeId"])
        receipt = result["modelReceipt"]
        self.assertTrue(receipt["fallbackUsed"])
        self.assertEqual("laya_abstained", receipt["fallbackReason"])
        self.assertEqual(["laya", "llm"], [a["backend"] for a in receipt["attempts"]])
        self.assertEqual(received[1]["goal"], json.loads(received[0]["state"])["goal"])
        for field in ("history", "pageText", "pageTextTruncated"):
            self.assertEqual(received[1][field], json.loads(received[0]["state"])[field])
        for key, candidate in received[1]["candidates"].items():
            self.assertEqual(goalpath.compact_candidate(candidate), received[0]["questions"]["action"]["criteria"][key])

    def test_uncalibrated_threshold_routes_but_does_not_claim_accuracy(self):
        def laya(request):
            return {"answers": {"action": {"choice": "candidate_0", "probs": {
                "candidate_0": .5, "candidate_1": .4, "abstain": .1}}}}
        llm = mock.Mock(return_value={"choice": "candidate_1"}); llm.model = "test"
        provider = goalpath.GoalPathDecisionProvider(policy(minMargin=.2), mode="hybrid", laya_predictor=laya, llm_predictor=llm)
        result = provider.decide(context())
        self.assertEqual("uncertain_laya_choice", result["modelReceipt"]["fallbackReason"])
        self.assertEqual("uncalibrated-routing-only", result["modelReceipt"]["probabilityInterpretation"])

    def test_confident_laya_does_not_call_llm(self):
        llm = mock.Mock(); llm.model = "test"
        result = goalpath.GoalPathDecisionProvider(policy(), mode="hybrid", laya_predictor=laya_answer, llm_predictor=llm).decide(context())
        self.assertEqual("act", result["type"])
        self.assertFalse(result["modelReceipt"]["fallbackUsed"])
        llm.assert_not_called()

    def test_malformed_output_cannot_escape_candidate_map(self):
        for response in [{"choice": "node-999"}, {"choice": ["candidate_0"]}, {"choice": "candidate_0", "action": {"type": "back"}},
                         {"choice": "candidate_0", "reason": "extra"}, {"choice": "abstain"}]:
            result = self.llm(response).decide(context())
            self.assertEqual("blocked", result["type"])
            self.assertNotIn("action", result)

    def test_predictor_exception_is_redacted_and_policy_input_is_detached(self):
        p = policy(); provider = self.llm(local_policy=p)
        p["steps"]["task"]["stopWhen"] = condition("Ready")
        self.predictor.side_effect = ValueError("http://secret.example/?ownerToken=private")
        result = provider.decide(context())
        self.assertEqual("llm_unavailable", result["reason"])
        self.assertNotIn("secret", json.dumps(result))

    def test_foreign_page_and_invalid_history_never_call_predictors(self):
        provider = self.llm(); source = context(); source["observation"]["page"]["packageName"] = "foreign.app"
        self.assertEqual("target_package_mismatch", provider.decide(source)["reason"])
        source = context(history=[{"action": {"type": "click"}, "status": "proposed"}])
        self.assertEqual("invalid_observation_or_history", provider.decide(source)["reason"])
        self.predictor.assert_not_called()

    def test_policy_does_not_accept_preselected_candidates_or_unknown_actions(self):
        for kwargs in [{"candidateSelectors": []}, {"exactText": "Search"}, {"maxCandidates": True},
                       {"rules": [{"action": "shell"}]}, {"rules": [{"action": ["click"]}]},
                       {"rules": [{"action": "input", "selector": {"text": "q"}, "inputKey": []}]}]:
            with self.subTest(kwargs=kwargs), self.assertRaises(goalpath.ModelDeploymentError):
                goalpath.GoalPathDecisionProvider(policy(**kwargs))


class GoalPathRuntimeTests(unittest.TestCase):
    def predictor(self):
        return goalpath_runtime.LoopbackOpenAIPredictor("http://127.0.0.1:5820/v1", "qwen-test")

    def response(self, value):
        response = io.BytesIO(value if isinstance(value, bytes) else json.dumps(value).encode())
        response.status = 200
        return response

    def test_openai_contract_is_strict_nonstreaming_no_thinking_and_captures_usage(self):
        predictor = self.predictor()
        predictor.opener = mock.Mock()
        predictor.opener.open.return_value = self.response(completion())
        self.assertEqual({"choice": "candidate_0"}, predictor(llm_request()))
        request = predictor.opener.open.call_args.args[0]
        self.assertEqual("http://127.0.0.1:5820/v1/chat/completions", request.full_url)
        body = json.loads(request.data)
        self.assertFalse(body["stream"])
        self.assertFalse(body["chat_template_kwargs"]["enable_thinking"])
        self.assertEqual(0, body["temperature"])
        schema = body["response_format"]["json_schema"]["schema"]
        self.assertEqual(["candidate_0", "abstain"], schema["properties"]["choice"]["enum"])
        self.assertFalse(schema["additionalProperties"])
        self.assertEqual(47, predictor.last_metadata["usage"]["total_tokens"])
        self.assertIn("elapsedMs", predictor.last_metadata)
        self.assertEqual(llm_request(), json.loads(body["messages"][1]["content"]))

    def test_page_text_request_schema_rejects_unbounded_or_noncanonical_data_before_http(self):
        for change in ({"pageText": ["x"] * 65}, {"pageText": ["x" * 129]}, {"pageText": "text"},
                       {"pageText": [None]}, {"pageText": ["duplicate", "duplicate"]},
                       {"pageTextTruncated": 1}, {"pageTextTruncated": None}):
            with self.subTest(change=change):
                predictor = self.predictor(); predictor.opener = mock.Mock()
                with self.assertRaisesRegex(ValueError, "GoalPath LLM request failed"):
                    predictor({**llm_request(), **change})
                predictor.opener.open.assert_not_called()

    def test_loopback_url_rejects_external_dns_credentials_redirect_targets_and_encoded_paths(self):
        for endpoint in ["http://localhost:5820/v1", "http://example.com:5820/v1", "https://127.0.0.1:5820/v1",
                         "http://127.0.0.1/v1", "http://u:p@127.0.0.1:5820/v1", "http://127.0.0.1:5820/v1?secret=x",
                         "http://127.0.0.1:5820/%76%31", "http://2130706433:5820/v1", "file:///tmp/model"]:
            with self.subTest(endpoint=endpoint), self.assertRaises(goalpath.ModelDeploymentError):
                goalpath_runtime.LoopbackOpenAIPredictor(endpoint, "test")
        predictor = goalpath_runtime.LoopbackOpenAIPredictor("http://[::1]:5820/v1/chat/completions", "test")
        self.assertTrue(any(isinstance(h, goalpath_runtime._NoRedirect) for h in predictor.opener.handlers))

    def test_duplicate_keys_nonfinite_unknown_actions_and_truncated_completions_rejected(self):
        for answer in [completion('{"choice":"candidate_0","choice":"abstain"}'),
                       completion('{"choice":"candidate_0","action":"back"}'),
                       completion('{"choice":NaN}'), completion('```json\n{"choice":"candidate_0"}\n```'),
                       completion('{"choice":"candidate_9"}'),
                       completion(choices=[{"finish_reason": "length", "message": {"role": "assistant", "content": '{"choice":"candidate_0"}'}}])]:
            predictor = self.predictor(); predictor.opener = mock.Mock()
            predictor.opener.open.return_value = self.response(answer)
            with self.assertRaisesRegex(ValueError, "GoalPath LLM request failed"):
                predictor(llm_request())

    def test_response_limit_and_errors_never_echo_private_payload(self):
        predictor = self.predictor(); predictor.opener = mock.Mock()
        predictor.opener.open.return_value = self.response(b"x" * (goalpath_runtime.MAX_RESPONSE_BYTES + 1))
        with self.assertRaisesRegex(ValueError, "GoalPath LLM request failed"):
            predictor(llm_request())
        predictor.opener.open.side_effect = ValueError("credential=private")
        with self.assertRaises(ValueError) as error:
            predictor(llm_request())
        self.assertNotIn("private", str(error.exception))
        self.assertNotIn("private", json.dumps(predictor.last_metadata))

    def test_usage_is_preserved_in_provider_receipt_but_remote_extra_fields_are_not(self):
        predictor = self.predictor(); predictor.opener = mock.Mock()
        predictor.opener.open.return_value = self.response(completion(private_data="not-for-evidence"))
        provider = goalpath.GoalPathDecisionProvider(policy(), mode="llm", llm_predictor=predictor)
        result = provider.decide(context())
        self.assertEqual("qwen-test", result["modelReceipt"]["model"])
        self.assertEqual(47, result["modelReceipt"]["attempts"][0]["usage"]["total_tokens"])
        self.assertNotIn("not-for-evidence", json.dumps(result))

    def test_capacity_checks_option_head_and_state_without_silent_truncation(self):
        class Tokenizer:
            mask_token = "<mask>"
            def __call__(self, value, add_special_tokens=False):
                return {"input_ids": list(range(len(value)))}
        agent = SimpleNamespace(tok=Tokenizer(), cfg={"head_max_len": 128, "max_len": 256})
        request = {"state": "goal", "questions": {"action": {"instructions": "Go", "criteria": {
            "candidate_0": "Search | click", "abstain": "None"}}}}
        good = goalpath_runtime.check_laya_capacity(agent, request)
        self.assertTrue(good["verifiedNoTruncation"])
        for field in ("option", "head", "instruction", "state"):
            with self.subTest(field=field):
                bad = copy.deepcopy(request)
                agent.cfg = {"head_max_len": 128, "max_len": 256}
                if field == "option":
                    bad["questions"]["action"]["criteria"]["candidate_0"] = "x" * 49
                elif field == "head":
                    agent.cfg["head_max_len"] = 32
                elif field == "instruction":
                    bad["questions"]["action"]["instructions"] = "x" * 120
                else:
                    bad["state"] = "x" * 256
                self.assertFalse(goalpath_runtime.check_laya_capacity(agent, bad)["verifiedNoTruncation"])

    def test_capacity_overflow_is_distinct_and_routes_to_llm_without_calling_model(self):
        def over_capacity(request):
            raise goalpath.LayaCapacityError({"verifiedNoTruncation": False})
        llm = lambda _: {"choice": "candidate_0"}
        result = goalpath.GoalPathDecisionProvider(policy(), mode="hybrid", laya_predictor=over_capacity,
                                                   llm_predictor=llm).decide(context())
        self.assertEqual("act", result["type"])
        self.assertEqual("laya_token_budget_exceeded", result["modelReceipt"]["fallbackReason"])
        result = goalpath.GoalPathDecisionProvider(policy(), mode="laya", laya_predictor=over_capacity).decide(context())
        self.assertEqual("blocked", result["type"])
        self.assertEqual("laya_token_budget_exceeded", result["reason"])

    def test_http_laya_without_capacity_evidence_is_not_silently_used(self):
        from solopi_harness.fastpath import LoopbackLayaPredictor
        predictor = LoopbackLayaPredictor("http://127.0.0.1:5820/predict")
        predictor.opener = mock.Mock()
        provider = goalpath.GoalPathDecisionProvider(policy(), mode="laya", laya_predictor=predictor)
        self.assertEqual("laya_capacity_unverified", provider.decide(context())["reason"])
        predictor.opener.open.assert_not_called()

    def test_expanded_mlx_context_changes_only_in_memory_and_records_original_limits(self):
        from solopi_harness import fastpath_runtime
        original = {"head_max_len": 256, "max_len": 1024}
        loaded = mock.Mock()
        loaded.agent = SimpleNamespace(cfg=original, encoder_cfg={"max_position_embeddings": 8192})
        loaded.metadata = {"checkpointDigest": "unchanged"}
        loaded.model_digest = "unchanged"
        with mock.patch.object(fastpath_runtime, "LocalMlxPredictor", return_value=loaded):
            predictor = goalpath_runtime.GoalPathMlxPredictor(Path("unused-local-model"))
        self.assertEqual({"head_max_len": 256, "max_len": 1024}, original)
        self.assertEqual({"head_max_len": 1024, "max_len": 2048}, predictor.agent.cfg)
        self.assertEqual("unchanged", predictor.model_digest)
        with mock.patch.object(goalpath_runtime, "check_laya_capacity", return_value={"verifiedNoTruncation": False}):
            with self.assertRaises(goalpath.LayaCapacityError):
                predictor({})
        loaded.assert_not_called()


if __name__ == "__main__":
    unittest.main()
