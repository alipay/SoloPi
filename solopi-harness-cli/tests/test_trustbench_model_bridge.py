import json
import unittest
from concurrent.futures import ThreadPoolExecutor
from unittest.mock import MagicMock, patch

from solopi_harness import trustbench_model_bridge as bridge


class ModelBridgeTests(unittest.TestCase):
    def test_pacer_spaces_requests_and_counts_only_required_wait(self):
        now = [100.0]
        def sleep(seconds):
            now[0] += seconds
        pacer = bridge.RequestPacer(10, clock=lambda: now[0], sleep=sleep)
        self.assertEqual(0, pacer.wait(90))
        now[0] += 3
        self.assertEqual(7, pacer.wait(90))
        now[0] += 12
        self.assertEqual(0, pacer.wait(90))

    def test_pacer_exhaustion_does_not_reserve_another_slot(self):
        now = [100.0]
        pacer = bridge.RequestPacer(10, clock=lambda: now[0],
                                    sleep=lambda seconds: now.__setitem__(0, now[0] + seconds))
        pacer.wait(90)
        with self.assertRaises(TimeoutError):
            pacer.wait(5)
        self.assertEqual(110, pacer.next_start)
        self.assertEqual(10, pacer.wait(90))

    def test_pacer_rejects_invalid_intervals(self):
        self.assertEqual(60, bridge.RequestPacer(60).interval)
        for value in (-1, 61, float('nan'), float('inf')):
            with self.assertRaises(ValueError):
                bridge.RequestPacer(value)

    def test_concurrent_requests_share_one_pacer(self):
        now = [100.0]
        pacer = bridge.RequestPacer(10, clock=lambda: now[0],
                                    sleep=lambda seconds: now.__setitem__(0, now[0] + seconds))
        with ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(lambda _: pacer.wait(90), range(4)))
        self.assertEqual(140, pacer.next_start)

    def test_exhausted_pacing_budget_sends_no_request(self):
        pacer = MagicMock()
        pacer.wait.side_effect = TimeoutError('model pacing budget exhausted')
        with patch.object(bridge.urllib.request, "urlopen") as call:
            with self.assertRaises(TimeoutError):
                bridge.call_model(self.context(), "https://example.test/v1/chat/completions",
                                  "secret", "model", pacer=pacer)
        call.assert_not_called()

    def test_pacing_receipt_and_remaining_network_budget(self):
        pacer = MagicMock(interval=10)
        pacer.wait.return_value = 7.0
        response = MagicMock()
        response.__enter__.return_value.read.return_value = json.dumps({
            "choices": [{"message": {"content": '{"type":"done","reason":"visible"}'}}]
        }).encode()
        with patch.object(bridge.urllib.request, "urlopen", return_value=response) as call:
            decision = bridge.call_model(self.context(), "https://example.test/v1/chat/completions",
                                         "secret", "model", timeout=90, pacer=pacer)
        self.assertEqual(83, call.call_args.kwargs["timeout"])
        self.assertEqual(7000, decision["modelReceipt"]["pacingWaitMs"])
        self.assertEqual(10000, decision["modelReceipt"]["minRequestIntervalMs"])

    def test_429_is_not_retried(self):
        error = bridge.urllib.error.HTTPError("https://example.test", 429, "limited", {}, None)
        with patch.object(bridge.urllib.request, "urlopen", side_effect=error) as call:
            with self.assertRaises(bridge.urllib.error.HTTPError):
                bridge.call_model(self.context(), "https://example.test/v1/chat/completions",
                                  "secret", "model", pacer=bridge.RequestPacer(10))
        self.assertEqual(1, call.call_count)

    def context(self):
        return {
            "goal": "Make the counter show 1",
            "allowedActions": ["click", "wait"],
            "stepIndex": 0,
            "observation": {
                "observationId": "private-observation-id",
                "page": {"children": [
                    {"visible": True, "packageName": "com.example.counter",
                     "className": "android.widget.LinearLayout", "text": "",
                     "isClickable": False},
                    {"visible": True, "packageName": "com.example.counter",
                     "resourceId": "com.example.counter:id/counter_value",
                     "className": "android.widget.TextView", "text": "0",
                     "isClickable": False},
                    {"visible": True, "packageName": "com.example.counter",
                     "resourceId": "com.example.counter:id/increment_button",
                     "className": "android.widget.Button", "text": "INCREMENT",
                     "isClickable": True, "isEditable": False},
                    {"visible": True, "packageName": "com.example.counter",
                     "resourceId": "android:id/navigationBarBackground",
                     "className": "android.view.View", "text": "",
                     "isClickable": False},
                ]},
            },
            "privateOracle": {"expected": "1"},
        }

    def test_model_input_only_contains_visible_task_context(self):
        supplied = bridge.model_input(self.context())
        self.assertEqual("0", supplied["visibleNodes"][0]["text"])
        self.assertEqual(2, len(supplied["visibleNodes"]))
        self.assertNotIn("isEditable", supplied["visibleNodes"][1])
        self.assertNotIn("privateOracle", json.dumps(supplied))
        self.assertNotIn("observationId", json.dumps(supplied))

    def test_click_must_match_visible_clickable_node(self):
        context = self.context()
        valid = {"type": "act", "action": {"type": "click", "selector": {
            "resourceId": "com.example.counter:id/increment_button",
            "className": "android.widget.Button", "packageName": "com.example.counter"
        }}}
        self.assertEqual(valid, bridge.parse_decision(json.dumps(valid), context))
        invalid = {"type": "act", "action": {"type": "click", "selector": {
            "resourceId": "com.example.counter:id/reset_button",
            "className": "android.widget.Button", "packageName": "com.example.counter"
        }}}
        with self.assertRaisesRegex(ValueError, "visible clickable"):
            bridge.parse_decision(json.dumps(invalid), context)

    def test_notes_input_requires_visible_editable_node(self):
        context = {
            "goal": "Save a note titled Trip checklist",
            "allowedActions": ["click", "input"],
            "stepIndex": 1,
            "observation": {"page": {"children": [
                {"visible": True, "packageName": bridge.NOTES_PACKAGE,
                 "resourceId": bridge.NOTES_PACKAGE + ":id/title_input",
                 "className": "android.widget.EditText", "text": "",
                 "isClickable": True, "isEditable": True},
                {"visible": True, "packageName": bridge.NOTES_PACKAGE,
                 "resourceId": bridge.NOTES_PACKAGE + ":id/save_button",
                 "className": "android.widget.Button", "text": "Save",
                 "isClickable": True, "isEditable": False},
                {"visible": True, "packageName": "com.example.counter",
                 "resourceId": "com.example.counter:id/counter_value",
                 "className": "android.widget.TextView", "text": "private",
                 "isClickable": False},
            ]}},
        }
        nodes = bridge.model_input(context, bridge.NOTES_PACKAGE)["visibleNodes"]
        self.assertEqual(2, len(nodes))
        self.assertNotIn("private", json.dumps(nodes))
        selector = {"resourceId": bridge.NOTES_PACKAGE + ":id/title_input",
                    "className": "android.widget.EditText", "packageName": bridge.NOTES_PACKAGE}
        decision = {"type": "act", "action": {"type": "input", "selector": selector,
                                                 "text": "Trip checklist"}}
        self.assertEqual(decision, bridge.parse_decision(
            json.dumps(decision), context, bridge.NOTES_PACKAGE))
        decision["action"]["selector"]["resourceId"] = bridge.NOTES_PACKAGE + ":id/save_button"
        decision["action"]["selector"]["className"] = "android.widget.Button"
        with self.assertRaisesRegex(ValueError, "visible editable"):
            bridge.parse_decision(json.dumps(decision), context, bridge.NOTES_PACKAGE)
        context["allowedActions"] = ["click"]
        with self.assertRaisesRegex(ValueError, "not allowed"):
            bridge.parse_decision(json.dumps(decision), context, bridge.NOTES_PACKAGE)

    def test_notes_request_uses_notes_prompt_and_target_nodes(self):
        context = {
            "goal": "Create a trip note",
            "allowedActions": ["click", "input"],
            "observation": {"page": {"children": [
                {"visible": True, "packageName": bridge.NOTES_PACKAGE,
                 "resourceId": bridge.NOTES_PACKAGE + ":id/new_note_button",
                 "className": "android.widget.Button", "text": "New note",
                 "isClickable": True},
                {"visible": True, "packageName": "com.example.counter",
                 "resourceId": "com.example.counter:id/counter_value",
                 "className": "android.widget.TextView", "text": "private"},
            ]}},
        }

        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({"id": "notes-response", "model": "model-1",
                                   "choices": [{"message": {"content": json.dumps({
                                       "type": "act", "action": {"type": "click", "selector": {
                                           "resourceId": bridge.NOTES_PACKAGE + ":id/new_note_button",
                                           "className": "android.widget.Button",
                                           "packageName": bridge.NOTES_PACKAGE,
                                       }}
                                   })}}]}).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()) as call:
            decision = bridge.call_model(context, "https://example.test/v1/chat/completions",
                                         "secret-key", "model-1",
                                         target_package=bridge.NOTES_PACKAGE)
        request_body = json.loads(call.call_args.args[0].data)
        self.assertEqual(1024, request_body["max_tokens"])
        self.assertEqual(bridge.NOTES_SYSTEM_PROMPT, request_body["messages"][0]["content"])
        self.assertNotIn("private", request_body["messages"][1]["content"])
        self.assertNotIn("secret-key", json.dumps(decision))
        self.assertEqual("click", decision["action"]["type"])

    def test_model_response_receipt_keeps_identity_without_credentials(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({
                    "id": "response-1", "model": "model-1",
                    "choices": [{"message": {"content": json.dumps({
                        "type": "done", "reason": "goal is visible"
                    })}}],
                    "usage": {"prompt_tokens": 12, "completion_tokens": 6},
                }).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()) as call:
            decision = bridge.call_model(self.context(), "https://example.test/v1/chat/completions",
                                         "secret-key", "model-1")
        request = call.call_args.args[0]
        self.assertEqual("Bearer secret-key", request.headers["Authorization"])
        self.assertNotIn("secret-key", json.dumps(decision))
        self.assertEqual("model-1", decision["modelReceipt"]["modelId"])
        self.assertEqual(12, decision["modelReceipt"]["promptTokens"])
        self.assertEqual(1024, decision["modelReceipt"]["maxOutputTokens"])

    def test_sofa_headers_are_forwarded_without_entering_receipt(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({"choices": [{"message": {"content":
                    '{"type":"done","reason":"visible"}'}}]}).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()) as call:
            decision = bridge.call_model(
                self.context(), "https://example.test/v1/chat/completions",
                "secret-key", "Kimi-K3", sofa_trace_id="trace-1", sofa_rpc_id="rpc-1"
            )
        headers = call.call_args.args[0].headers
        self.assertEqual("trace-1", headers["Sofa-traceid"])
        self.assertEqual("rpc-1", headers["Sofa-rpcid"])
        self.assertNotIn("trace-1", json.dumps(decision))

    def test_responses_request_disables_storage_and_parses_output(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({
                    "id": "resp-1", "model": "gpt-5.5",
                    "output": [{"content": [{"type": "output_text", "text":
                        '{"type":"done","reason":"visible"}'}]}],
                    "usage": {"input_tokens": 14, "output_tokens": 8},
                }).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()) as call:
            decision = bridge.call_model(
                self.context(), "https://example.test/v1/responses",
                "secret-key", "gpt-5.5", wire_api="responses"
            )
        request = call.call_args.args[0]
        body = json.loads(request.data)
        self.assertIs(body["store"], False)
        self.assertEqual(1024, body["max_output_tokens"])
        self.assertEqual("gpt-5.5", body["model"])
        self.assertNotIn("messages", body)
        self.assertNotIn("privateOracle", body["input"])
        self.assertEqual("resp-1", decision["modelReceipt"]["requestId"])
        self.assertEqual(14, decision["modelReceipt"]["promptTokens"])

    def test_configured_output_budget_is_sent_and_recorded(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({"choices": [{"message": {"content":
                    '{"type":"done","reason":"visible"}'}}]}).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()) as call:
            decision = bridge.call_model(
                self.context(), "https://example.test/v1/chat/completions",
                "secret-key", "Kimi-K3", max_output_tokens=900)
        self.assertEqual(900, json.loads(call.call_args.args[0].data)["max_tokens"])
        self.assertEqual(900, decision["modelReceipt"]["maxOutputTokens"])

    def test_length_finish_is_reported_as_truncation(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({"choices": [{"finish_reason": "length",
                    "message": {"content": '{"type":"done","reason":"unfinished'}}]}).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()):
            with self.assertRaisesRegex(ValueError, "model_output_truncated"):
                bridge.call_model(self.context(), "https://example.test/v1/chat/completions",
                                  "secret-key", "Kimi-K3")

    def test_incomplete_responses_result_is_reported_as_truncation(self):
        class Response:
            def __enter__(self):
                return self

            def __exit__(self, *args):
                pass

            def read(self, limit):
                return json.dumps({"status": "incomplete", "output": []}).encode("utf-8")

        with patch.object(bridge.urllib.request, "urlopen", return_value=Response()):
            with self.assertRaisesRegex(ValueError, "model_output_truncated"):
                bridge.call_model(self.context(), "https://example.test/v1/responses",
                                  "secret-key", "model-1", wire_api="responses")

    def test_output_budget_validation(self):
        self.assertEqual(1024, bridge.output_token_budget("1024"))
        self.assertEqual(900, bridge.output_token_budget("900"))
        for value in ("0", "8193", "abc"):
            with self.subTest(value=value), self.assertRaises(ValueError):
                bridge.output_token_budget(value)
        with self.assertRaisesRegex(ValueError, "budget"):
            bridge.call_model(self.context(), "https://example.test/v1/chat/completions",
                              "secret-key", "model-1", max_output_tokens=True)

    def test_responses_rejects_missing_text(self):
        with self.assertRaisesRegex(ValueError, "no output text"):
            bridge.response_text({"output": [{"type": "reasoning"}]})

    def test_sofa_headers_reject_newlines(self):
        with patch.object(bridge.urllib.request, "urlopen") as call:
            with self.assertRaisesRegex(ValueError, "SOFA"):
                bridge.call_model(
                    self.context(), "https://example.test/v1/chat/completions",
                    "secret-key", "Kimi-K3", sofa_trace_id="bad\nheader"
                )
        call.assert_not_called()

    def test_api_key_is_never_sent_to_plain_http(self):
        with patch.object(bridge.urllib.request, "urlopen") as call:
            with self.assertRaisesRegex(ValueError, "HTTPS"):
                bridge.call_model(self.context(), "http://example.test/v1/chat/completions",
                                  "secret-key", "model-1")
        call.assert_not_called()


if __name__ == "__main__":
    unittest.main()
