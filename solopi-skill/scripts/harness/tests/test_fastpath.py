import copy
import io
import json
import sys
import unittest
import urllib.error
from pathlib import Path
from unittest import mock


sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import fastpath


PACKAGE = "com.example.demo"


def policy(**step_overrides):
    step = {
        "instructions": "Choose the button that starts the task. Abstain when uncertain.",
        "readyWhen": {"selector": {"resourceId": "status"}, "field": "text", "equals": "Ready"},
        "stopWhen": {"selector": {"resourceId": "status"}, "field": "text", "equals": "Completed"},
        "candidateSelectors": [{"resourceId": "start"}, {"resourceId": "cancel"}],
        "exactText": "Start",
    }
    step.update(step_overrides)
    return {"schemaVersion": fastpath.POLICY_SCHEMA, "targetPackage": PACKAGE, "steps": {"start-task": step}}


def node(node_id, resource, text, **overrides):
    result = {"nodeId": node_id, "resourceId": resource, "text": text, "packageName": PACKAGE,
              "isClickable": True, "isEnabled": True, "visible": True}
    result.update(overrides)
    return result


def context():
    return {"stepId": "start-task", "goal": "Start the task", "allowedActions": ["click"],
            "ownerToken": "not-for-the-model", "observation": {
                "observationId": "observation-1", "page": {
                    "packageName": PACKAGE, "children": [node("n1", "status", "Ready", isClickable=False),
                        node("n2", "start", "Start"), node("n3", "cancel", "Cancel")]}}}


ANCESTOR_RESOLUTION = "self-or-clickable-ancestor"


def ancestor_context(distance=1):
    source = context()
    start = node("n2", "start", "\ue600", description="Start", isClickable=distance == 0)
    chain = [start]
    for hop in range(1, distance + 1):
        parent = node("parent-%d" % hop, "container-%d" % hop, "Parent label",
                      description="Parent description", isClickable=hop == distance,
                      children=[chain[-1]])
        chain.append(parent)
    source["observation"]["page"]["children"][1] = chain[-1]
    return source, chain


def prediction(choice="candidate_0", probabilities=None, **extra):
    answer = {"choice": choice, "probs": probabilities or {"candidate_0": 0.8, "candidate_1": 0.1, "abstain": 0.1}}
    answer.update(extra)
    return {"answers": {"action": answer}}


class FastPathTests(unittest.TestCase):
    def provider(self, response=None, rules=False, local_policy=None):
        self.predictor = mock.Mock(return_value=response or prediction())
        return fastpath.FastPathDecisionProvider(local_policy or policy(), mode="rules" if rules else "laya",
                                                predictor=None if rules else self.predictor,
                                                model_version="local-test-v1")

    def assert_blocked(self, result, reason=None):
        self.assertEqual("blocked", result["type"])
        self.assertNotIn("action", result)
        if reason:
            self.assertEqual(reason, result["reason"])
        self.assertIn("elapsedMs", result["modelReceipt"])

    def test_valid_prediction_uses_current_observed_node_and_keeps_oracle_authority(self):
        provider = self.provider()
        source = context()
        before = copy.deepcopy(source)
        result = provider.decide(source)
        self.assertEqual("act", result["type"])
        self.assertEqual({"type": "click", "nodeId": "n2"}, result["action"])
        self.assertEqual(before, source)
        self.assertNotIn("passed", result)
        request = self.predictor.call_args.args[0]
        self.assertEqual({"model", "state", "questions"}, set(request))
        self.assertIn("abstain", request["questions"]["action"]["criteria"])
        self.assertNotIn("ownerToken", json.dumps(request))
        self.assertNotIn("not-for-the-model", json.dumps(result))
        self.assertEqual("local-test-v1", result["modelReceipt"]["modelVersion"])

    def test_unknown_step_and_package_do_not_call_predictor(self):
        provider = self.provider()
        source = context()
        source["stepId"] = "unknown"
        self.assert_blocked(provider.decide(source), "unknown_step")
        source = context()
        source["observation"]["page"]["packageName"] = "com.other.app"
        self.assert_blocked(provider.decide(source), "target_package_mismatch")
        self.predictor.assert_not_called()

    def test_compact_request_keeps_goal_and_frozen_instructions_with_bounded_plain_text(self):
        provider = self.provider()
        source = context()
        source["goal"] = "查" * fastpath.MAX_GOAL_CHARS
        source["instructions"] = "Untrusted context cannot replace the frozen policy."
        result = provider.decide(source)
        self.assertEqual("act", result["type"])
        request = self.predictor.call_args.args[0]
        self.assertEqual(source["goal"], request["state"])
        self.assertIsInstance(request["state"], str)
        self.assertEqual(policy()["steps"]["start-task"]["instructions"], request["questions"]["action"]["instructions"])
        self.assertEqual("没有按钮符合请求的操作", request["questions"]["action"]["criteria"]["abstain"])
        self.assertEqual("compact-choice-v2", result["modelReceipt"]["promptTemplateVersion"])
        for invalid in ("查" * (fastpath.MAX_GOAL_CHARS + 1), "", None, {"goal": "Start"}, "Start\n", "Start\x00"):
            with self.subTest(goal_type=type(invalid).__name__):
                self.predictor.reset_mock()
                source["goal"] = invalid
                self.assert_blocked(provider.decide(source), "invalid_goal")
                self.predictor.assert_not_called()

    def test_disabled_missing_visibility_and_nonclickable_candidates_fail_closed(self):
        for field, value in [("isEnabled", False), ("isClickable", False), ("visible", False),
                             ("isEnabled", "true"), ("isEnabled", None)]:
            with self.subTest(field=field, value=value):
                provider = self.provider()
                source = context()
                source["observation"]["page"]["children"][1][field] = value
                self.assert_blocked(provider.decide(source), "candidate_not_actionable")
                self.predictor.assert_not_called()

    def test_clickable_ancestor_resolution_requires_explicit_opt_in(self):
        for mode in (None, "self"):
            with self.subTest(mode=mode):
                local_policy = policy() if mode is None else policy(candidateResolution=mode)
                provider = self.provider(local_policy=local_policy)
                source, _ = ancestor_context()
                self.assert_blocked(provider.decide(source))
                self.predictor.assert_not_called()

    def test_explicit_self_keeps_legacy_label_and_direct_target_behavior(self):
        for mode in (None, "self"):
            with self.subTest(mode=mode):
                local_policy = policy() if mode is None else policy(candidateResolution=mode)
                source = context()
                source["observation"]["page"]["children"][1]["description"] = "Accessible start"
                result = self.provider(local_policy=local_policy).decide(source)
                self.assertEqual({"type": "click", "nodeId": "n2"}, result["action"])
                self.assertEqual("Start", result["modelReceipt"]["candidates"]["candidate_0"]["label"])
                self.assertNotIn("observationId", result["modelReceipt"])

    def test_opt_in_resolves_self_single_and_multiple_ancestors_with_auditable_receipt(self):
        for distance in (0, 1, 2):
            with self.subTest(distance=distance):
                local_policy = policy(candidateResolution=ANCESTOR_RESOLUTION)
                provider = self.provider(local_policy=local_policy)
                source, chain = ancestor_context(distance)
                before = copy.deepcopy(source)
                result = provider.decide(source)
                target_id = chain[-1]["nodeId"]
                self.assertEqual("act", result["type"])
                self.assertEqual(source["observation"]["observationId"], result["modelReceipt"]["observationId"])
                self.assertEqual({"type": "click", "nodeId": target_id}, result["action"])
                candidate = result["modelReceipt"]["candidates"]["candidate_0"]
                self.assertEqual(target_id, candidate["nodeId"])
                self.assertEqual(result["action"], candidate["action"])
                self.assertEqual("n2", candidate["sourceNodeId"])
                self.assertEqual({"resourceId": "start"}, candidate["sourceSelector"])
                self.assertEqual("description", candidate["labelField"])
                self.assertEqual("Start", candidate["label"])
                self.assertEqual(ANCESTOR_RESOLUTION, candidate["resolution"])
                self.assertEqual(distance, candidate["ancestorDistance"])
                self.assertEqual(before, source)
                self.predictor.assert_called_once()
                request = self.predictor.call_args.args[0]
                self.assertEqual("Start", request["questions"]["action"]["criteria"]["candidate_0"])
                for excluded in ("ownerToken", "not-for-the-model", "Parent label", "Parent description", "\ue600"):
                    self.assertNotIn(excluded, json.dumps(request, ensure_ascii=False))
                self.assertNotIn("not-for-the-model", json.dumps(result))
                candidate["sourceSelector"]["resourceId"] = "receipt-cannot-change-policy"
                self.assertEqual(local_policy, provider.policy_snapshot())

    def test_opt_in_uses_nearest_clickable_ancestor(self):
        source, chain = ancestor_context(2)
        chain[1]["isClickable"] = True
        result = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION)).decide(source)
        self.assertEqual({"type": "click", "nodeId": "parent-1"}, result["action"])
        self.assertEqual(1, result["modelReceipt"]["candidates"]["candidate_0"]["ancestorDistance"])

    def test_opt_in_rules_and_laya_share_source_labels_and_resolved_candidate_mapping(self):
        source, _ = ancestor_context(2)
        local_policy = policy(candidateResolution=ANCESTOR_RESOLUTION, exactText="Start")
        laya_result = self.provider(local_policy=local_policy).decide(source)
        rules_result = self.provider(rules=True, local_policy=local_policy).decide(source)

        self.assertEqual("act", rules_result["type"])
        self.assertEqual({"type": "click", "nodeId": "parent-2"}, rules_result["action"])
        self.assertEqual("exact_text_match", rules_result["modelReceipt"]["reason"])
        self.assertEqual("candidate_0", rules_result["modelReceipt"]["selectedChoice"])
        self.assertEqual(laya_result["modelReceipt"]["candidates"], rules_result["modelReceipt"]["candidates"])
        selected = rules_result["modelReceipt"]["candidates"]["candidate_0"]
        self.assertEqual("Start", selected["label"])
        self.assertEqual("description", selected["labelField"])
        self.assertEqual("n2", selected["sourceNodeId"])
        self.predictor.assert_not_called()

    def test_opt_in_label_priority_is_description_then_content_description_then_text(self):
        cases = [
            ({"description": "Start", "contentDescription": "Other accessible label", "text": "\ue600"}, "description"),
            ({"description": "", "contentDescription": "Start", "text": "\ue600"}, "contentDescription"),
            ({"description": "", "contentDescription": "", "text": "Start"}, "text"),
        ]
        for fields, expected_field in cases:
            with self.subTest(label_field=expected_field):
                source, chain = ancestor_context()
                chain[0].update(fields)
                result = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION)).decide(source)
                candidate = result["modelReceipt"]["candidates"]["candidate_0"]
                self.assertEqual("Start", candidate["label"])
                self.assertEqual(expected_field, candidate["labelField"])

    def test_opt_in_does_not_borrow_labels_from_parent_or_siblings(self):
        source, chain = ancestor_context()
        chain[0].update(text="", description="", contentDescription="")
        chain[-1]["description"] = "Start"
        chain[-1]["children"].append(node("sibling", "unselected", "Start"))
        provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
        self.assert_blocked(provider.decide(source))
        self.predictor.assert_not_called()

    def test_opt_in_candidates_follow_target_tree_order_even_when_source_order_differs(self):
        source, chain = ancestor_context()
        cancel = source["observation"]["page"]["children"].pop()
        chain[-1]["children"].insert(0, cancel)
        local_policy = policy(candidateResolution=ANCESTOR_RESOLUTION,
                              candidateSelectors=[{"resourceId": "cancel"}, {"resourceId": "start"}])
        result = self.provider(local_policy=local_policy).decide(source)
        candidates = result["modelReceipt"]["candidates"]
        self.assertEqual(["parent-1", "n3"], [item["nodeId"] for item in candidates.values()])
        self.assertEqual(["Start", "Cancel"], [item["label"] for item in candidates.values()])
        self.assertEqual({"type": "click", "nodeId": "parent-1"}, result["action"])

    def test_opt_in_rejects_cross_package_source_intermediate_and_target(self):
        for chain_index in (0, 1, 2):
            with self.subTest(chain_index=chain_index):
                source, chain = ancestor_context(2)
                chain[chain_index]["packageName"] = "com.other.app"
                provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
                self.assert_blocked(provider.decide(source))
                self.predictor.assert_not_called()

    def test_opt_in_rejects_disabled_hidden_and_unknown_state_on_entire_visited_chain(self):
        for chain_index in (0, 1, 2):
            for field, value in (("isEnabled", False), ("visible", False),
                                 ("isEnabled", "true"), ("visible", 1)):
                with self.subTest(chain_index=chain_index, field=field, value=value):
                    source, chain = ancestor_context(2)
                    chain[chain_index][field] = value
                    provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
                    self.assert_blocked(provider.decide(source))
                    self.predictor.assert_not_called()

    def test_opt_in_never_skips_disabled_or_hidden_nearest_clickable_parent(self):
        for field in ("isEnabled", "visible"):
            with self.subTest(field=field):
                source, chain = ancestor_context(2)
                chain[1].update(isClickable=True)
                chain[1][field] = False
                provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
                self.assert_blocked(provider.decide(source))
                self.predictor.assert_not_called()

    def test_opt_in_requires_boolean_clickability_at_every_resolution_hop(self):
        for chain_index in (0, 1, 2):
            for value in (None, "true", 1, "missing"):
                with self.subTest(chain_index=chain_index, value=value):
                    source, chain = ancestor_context(2)
                    if value == "missing":
                        chain[chain_index].pop("isClickable")
                    else:
                        chain[chain_index]["isClickable"] = value
                    provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
                    self.assert_blocked(provider.decide(source))
                    self.predictor.assert_not_called()

    def test_opt_in_requires_frame_unique_ids_for_source_intermediate_and_target(self):
        for chain_index in (0, 1, 2):
            with self.subTest(chain_index=chain_index):
                source, chain = ancestor_context(2)
                duplicate = node(chain[chain_index]["nodeId"], "unselected", "Unselected")
                source["observation"]["page"]["children"].append(duplicate)
                provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
                self.assert_blocked(provider.decide(source))
                self.predictor.assert_not_called()

    def test_opt_in_rejects_multiple_source_selector_matches_before_prediction(self):
        source, chain = ancestor_context()
        chain[-1]["children"].append(node("another-source", "start", "Start", isClickable=False))
        provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
        self.assert_blocked(provider.decide(source))
        self.predictor.assert_not_called()

    def test_opt_in_rejects_entire_round_when_two_sources_resolve_to_one_target(self):
        source, chain = ancestor_context()
        cancel = source["observation"]["page"]["children"].pop()
        cancel["isClickable"] = False
        chain[-1]["children"].append(cancel)
        provider = self.provider(local_policy=policy(candidateResolution=ANCESTOR_RESOLUTION))
        self.assert_blocked(provider.decide(source))
        self.predictor.assert_not_called()

    def test_invalid_candidate_resolution_is_a_controlled_policy_error(self):
        for mode in (None, "", "ancestor", "SELF", "self-or-clickable-ancestors", False, 1, [], {}):
            with self.subTest(mode=mode), self.assertRaises(fastpath.ModelDeploymentError) as caught:
                self.provider(local_policy=policy(candidateResolution=mode))
            self.assertEqual("invalid_fastpath_policy", caught.exception.code)

    def test_cross_package_candidate_and_duplicate_ids_are_rejected(self):
        for field, value, reason in [("packageName", "com.other.app", "candidate_package_mismatch"),
                                     ("nodeId", "n1", "ambiguous_node_id")]:
            source = context()
            source["observation"]["page"]["children"][1][field] = value
            self.assert_blocked(self.provider().decide(source), reason)

    def test_multiple_selector_matches_and_overlapping_selectors_are_ambiguous(self):
        source = context()
        source["observation"]["page"]["children"].append(node("n4", "start", "Start"))
        self.assert_blocked(self.provider().decide(source), "ambiguous_candidate")
        local_policy = policy(candidateSelectors=[{"resourceId": "start"}, {"text": "Start"}])
        self.assert_blocked(self.provider(local_policy=local_policy).decide(context()), "ambiguous_node_id")

    def test_no_candidates_too_many_and_empty_labels_fail_closed(self):
        source = context()
        source["observation"]["page"]["children"] = source["observation"]["page"]["children"][:1]
        self.assert_blocked(self.provider().decide(source), "no_candidates")
        self.assert_blocked(self.provider(local_policy=policy(maxCandidates=1)).decide(context()), "too_many_candidates")
        source = context()
        source["observation"]["page"]["children"][1]["text"] = ""
        self.assert_blocked(self.provider().decide(source), "candidate_label_invalid")

    def test_stop_is_deterministic_done_without_claiming_test_pass(self):
        provider = self.provider()
        source = context()
        source["observation"]["page"]["children"][0]["text"] = "Completed"
        result = provider.decide(source)
        self.assertEqual("done", result["type"])
        self.assertEqual("stop_condition_observed", result["reason"])
        self.assertNotIn("status", result)
        self.predictor.assert_not_called()

    def test_unsupported_page_ambiguous_condition_and_disallowed_actions(self):
        source = context()
        source["observation"]["page"]["children"][0]["text"] = "Unsupported"
        self.assert_blocked(self.provider().decide(source), "unsupported_page")
        source = context()
        source["observation"]["page"]["children"].append(node("n4", "status", "Ready"))
        self.assert_blocked(self.provider().decide(source), "ambiguous_condition")
        source = context()
        source["allowedActions"] = ["back"]
        self.assert_blocked(self.provider().decide(source), "action_not_allowed")

    def test_rules_baseline_only_matches_exact_text_not_semantic_variant(self):
        provider = self.provider(rules=True)
        self.assertEqual("act", provider.decide(context())["type"])
        source = context()
        source["observation"]["page"]["children"][1]["text"] = "Begin"
        self.assert_blocked(provider.decide(source), "exact_text_not_unique")
        result = self.provider().decide(source)
        self.assertEqual("act", result["type"])
        self.assertEqual("Begin", result["modelReceipt"]["candidates"]["candidate_0"]["label"])

    def test_candidate_choice_follows_current_ui_order_not_policy_selector_order(self):
        source = context()
        children = source["observation"]["page"]["children"]
        children[1], children[2] = children[2], children[1]
        response = prediction("candidate_1", {"candidate_0": 0.1, "candidate_1": 0.8, "abstain": 0.1})
        provider = self.provider(response)
        result = provider.decide(source)
        self.assertEqual("Cancel", result["modelReceipt"]["candidates"]["candidate_0"]["label"])
        self.assertEqual("Start", result["modelReceipt"]["candidates"]["candidate_1"]["label"])
        self.assertEqual({"type": "click", "nodeId": "n2"}, result["action"])
        self.assertEqual("n2", self.provider(rules=True).decide(source)["action"]["nodeId"])

    def test_freezes_policy_against_caller_mutation(self):
        local_policy = policy()
        provider = self.provider(local_policy=local_policy)
        local_policy["targetPackage"] = "com.other.app"
        local_policy["steps"]["start-task"]["candidateSelectors"] = [{"resourceId": "cancel"}]
        self.assertEqual("n2", provider.decide(context())["action"]["nodeId"])
        snapshot = provider.policy_snapshot()
        snapshot["targetPackage"] = "com.other.app"
        self.assertEqual(PACKAGE, provider.policy_snapshot()["targetPackage"])
        self.assertEqual(provider.policy_digest, provider.decide(context())["modelReceipt"]["policyDigest"])
        equivalent = {key: policy()[key] for key in reversed(list(policy()))}
        self.assertEqual(provider.policy_digest, self.provider(local_policy=equivalent).policy_digest)

    def test_documented_laya_metadata_is_ignored_without_becoming_actions(self):
        response = prediction(type="choice", confidence=0.4)
        response.update({"model": "remote-name", "usage": {"total_tokens": 40}, "routing": {"backend": "mlx"}})
        result = self.provider(response).decide(context())
        self.assertEqual({"type": "click", "nodeId": "n2"}, result["action"])
        self.assertEqual("multilingual", result["modelReceipt"]["model"])
        self.assertNotIn("usage", result["modelReceipt"])
        self.assert_blocked(self.provider(prediction(type="arbitrary_action")).decide(context()), "invalid_response")

    def test_laya_mlx_020_real_shape_normalizes_probabilities_and_nonexecutable_gate(self):
        response = {
            "model": "laya-rl-agent",
            "answers": {"action": {"type": "choice", "confidence": 0.7312,
                "action": {"act_probability": 0.91}, "choice": "candidate_0",
                "probabilities": {"candidate_0": 0.6667, "candidate_1": 0.1667, "abstain": 0.1667}}},
            "usage": {"input_tokens": 80, "output_tokens": 0},
        }
        normalized = fastpath.normalize_laya_response(response)
        self.assertEqual({"choice", "probs", "confidence"}, set(normalized["answers"]["action"]))
        self.assertEqual(response["answers"]["action"]["probabilities"], normalized["answers"]["action"]["probs"])
        result = self.provider(response).decide(context())
        self.assertEqual({"type": "click", "nodeId": "n2"}, result["action"])
        self.assertNotIn("act_probability", result["action"])
        self.assertEqual(normalized, fastpath.normalize_laya_response(normalized))
        malformed = copy.deepcopy(response)
        malformed["answers"]["action"]["probs"] = malformed["answers"]["action"]["probabilities"]
        self.assert_blocked(self.provider(malformed).decide(context()), "invalid_response")
        for gate in [{"act_probability": float("nan")}, {"act_probability": True},
                     {"act_probability": -0.1}, {"act_probability": 1.1},
                     {"act_probability": 0.9, "nodeId": "n99"}, {"type": "click"}]:
            malformed = copy.deepcopy(response)
            malformed["answers"]["action"]["action"] = gate
            self.assert_blocked(self.provider(malformed).decide(context()), "invalid_response")

    def test_four_decimal_probability_rounding_is_preserved_without_renormalizing(self):
        distribution = {"candidate_0": 0.6667, "candidate_1": 0.1667, "abstain": 0.1667}
        result = self.provider(prediction(probabilities=distribution)).decide(context())
        self.assertEqual("act", result["type"])
        self.assertEqual(distribution, result["modelReceipt"]["probabilities"])
        distribution["abstain"] = 0.168
        self.assert_blocked(self.provider(prediction(probabilities=distribution)).decide(context()), "invalid_probabilities")

    def test_unknown_choice_extra_action_fields_and_malicious_response_are_blocked(self):
        for response in [prediction("invented_node"), prediction(nodeId="n99"),
                         prediction(action={"type": "shell", "command": "whatever"}),
                         {"answers": {"action": prediction()["answers"]["action"], "oracle": "passed"}},
                         {**prediction(), "ownerToken": "secret"}, {"type": "act", "action": "click"}]:
            with self.subTest(response=response):
                self.assert_blocked(self.provider(response=response).decide(context()))

    def test_probability_distribution_is_complete_finite_and_normalized(self):
        for probabilities in [
                {"candidate_0": 1},
                {"candidate_0": 0.8, "candidate_1": 0.1, "abstain": float("nan")},
                {"candidate_0": 0.8, "candidate_1": 0.1, "abstain": float("inf")},
                {"candidate_0": 1.1, "candidate_1": 0.0, "abstain": -0.1},
                {"candidate_0": True, "candidate_1": 0, "abstain": 0},
                {"candidate_0": 10**1000, "candidate_1": 0, "abstain": 0},
                {"candidate_0": 0.8, "candidate_1": 0.8, "abstain": 0.1},
                {"candidate_0": 0.8, "candidate_1": 0.1, "abstain": 0.1, "extra": 0}]:
            with self.subTest(probabilities=probabilities):
                self.assert_blocked(self.provider(prediction(probabilities=probabilities)).decide(context()), "invalid_probabilities")
        self.assert_blocked(self.provider(prediction(confidence=float("nan"))).decide(context()), "invalid_probabilities")
        self.assert_blocked(self.provider(prediction(confidence=10**1000)).decide(context()), "invalid_probabilities")

    def test_low_probability_small_margin_ties_nonmax_and_abstention_are_blocked(self):
        self.assert_blocked(self.provider(local_policy=policy(minProbability=0.9)).decide(context()), "uncertain_choice")
        self.assert_blocked(self.provider(local_policy=policy(minMargin=0.8)).decide(context()), "uncertain_choice")
        for probabilities in [{"candidate_0": 0.45, "candidate_1": 0.45, "abstain": 0.1},
                              {"candidate_0": 0.1, "candidate_1": 0.8, "abstain": 0.1}]:
            self.assert_blocked(self.provider(prediction(probabilities=probabilities)).decide(context()), "uncertain_choice")
        self.assert_blocked(self.provider(prediction("abstain", {"candidate_0": 0.1, "candidate_1": 0.1, "abstain": 0.8})).decide(context()), "model_abstained")

    def test_predictor_errors_do_not_expose_remote_payloads_or_credentials(self):
        provider = self.provider()
        self.predictor.side_effect = ValueError("http://password@host secret token")
        result = provider.decide(context())
        self.assert_blocked(result, "predictor_unavailable")
        self.assertNotIn("password", json.dumps(result))
        self.assertNotIn("token", json.dumps(result))

    def test_invalid_policy_unknown_fields_nan_and_cross_package_selectors(self):
        for local_policy in [policy(maxCandidates=9), policy(maxCandidates=True),
                             policy(minProbability=float("nan")), policy(minMargin=-1),
                             policy(candidateSelectors=[{"packageName": "com.other.app"}]),
                             policy(candidateSelectors=[{"shell": "ls"}]), policy(oracle="passed")]:
            with self.subTest(local_policy=local_policy), self.assertRaises(fastpath.ModelDeploymentError):
                self.provider(local_policy=local_policy)

    def test_nonstring_condition_field_raises_controlled_policy_error(self):
        for field in ([], {}, None, 123, True):
            for key in ("readyWhen", "stopWhen"):
                local_policy = policy()
                local_policy["steps"]["start-task"][key]["field"] = field
                with self.subTest(field=field, condition=key), self.assertRaises(fastpath.ModelDeploymentError) as caught:
                    self.provider(local_policy=local_policy)
                self.assertEqual("invalid_fastpath_policy", caught.exception.code)

    def test_invalid_deep_or_cyclic_observation_is_blocked(self):
        source = context()
        source["observation"]["page"]["children"].append(source["observation"]["page"])
        self.assert_blocked(self.provider().decide(source), "invalid_observation")


class LoopbackPredictorTests(unittest.TestCase):
    def test_endpoint_allowlist_has_no_dns_credentials_queries_or_external_hosts(self):
        for endpoint in ["https://127.0.0.1:7000/infer", "http://localhost:7000/infer",
                         "http://127.0.0.1/infer", "http://127.0.0.1:7000/infer?key=secret",
                         "http://user:password@127.0.0.1:7000/infer", "http://example.com:7000/infer",
                         "http://127.0.0.1.nip.io:7000/infer", "http://2130706433:7000/infer",
                         "http://127.0.0.1:7000/\ninfer", "file:///tmp/model"]:
            with self.subTest(endpoint=endpoint), self.assertRaises(fastpath.ModelDeploymentError):
                fastpath.LoopbackLayaPredictor(endpoint)
        fastpath.LoopbackLayaPredictor("http://127.0.0.1:7000/infer")
        fastpath.LoopbackLayaPredictor("http://[::1]:7000/infer")

    def call_with_bytes(self, body):
        predictor = fastpath.LoopbackLayaPredictor("http://127.0.0.1:7000/infer", timeout=2)
        response = io.BytesIO(body)
        response.status = 200
        predictor.opener = mock.Mock()
        predictor.opener.open.return_value = response
        result = predictor({"model": "multilingual", "state": "test", "questions": {}})
        self.assertEqual(2, predictor.opener.open.call_args.kwargs["timeout"])
        return result

    def test_bounded_response_valid_json_and_rejects_duplicate_and_nonfinite_fields(self):
        self.assertEqual(prediction(), self.call_with_bytes(json.dumps(prediction()).encode()))
        for body in [b'{"answers":{},"answers":{}}', b'{"value":NaN}', b'not json', b' ' * (fastpath.MAX_RESPONSE_BYTES + 1)]:
            with self.subTest(body=body[:50]), self.assertRaises(ValueError):
                self.call_with_bytes(body)
        documented = prediction(type="choice")
        documented.update({"model": "multilingual", "usage": {}, "routing": {}})
        self.assertEqual(prediction(), self.call_with_bytes(json.dumps(documented).encode()))

    def test_redirect_handler_unconditionally_rejects_even_loopback(self):
        handler = fastpath._NoRedirect()
        with self.assertRaises(urllib.error.URLError):
            handler.redirect_request(None, None, 302, "found", {}, "http://127.0.0.1:7001/")


if __name__ == "__main__":
    unittest.main()
