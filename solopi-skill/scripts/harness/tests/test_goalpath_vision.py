import base64
import copy
import hashlib
import io
import json
import os
from pathlib import Path
import struct
import ssl
import sys
import tempfile
import unittest
from unittest import mock
import urllib.error
import urllib.request
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import goalpath_vision as vision


def png_bytes(width=16, height=12):
    def chunk(name, data):
        return struct.pack(">I", len(data)) + name + data + struct.pack(">I", zlib.crc32(name + data) & 0xFFFFFFFF)
    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    pixels = (b"\0" + b"\x12\x34\x56" * width) * height
    return vision.PNG_SIGNATURE + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(pixels)) + chunk(b"IEND", b"")


def completion(content='{"choice":"candidate_0"}', **overrides):
    result = {"model": "reported-model", "choices": [{"finish_reason": "stop", "message": {
        "role": "assistant", "content": content}}],
        "usage": {"prompt_tokens": 50, "completion_tokens": 6, "total_tokens": 56}}
    result.update(overrides)
    return result


class GoalPathVisionTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.path = Path(self.directory.name).resolve() / "private-capture.png"
        self.png = png_bytes()
        self.path.write_bytes(self.png)
        self.env = mock.patch.dict(os.environ, {"GOALPATH_TEST_KEY": "unit-test-secret-value"})
        self.env.start()
        self.addCleanup(self.env.stop)

    def request(self):
        return {"schemaVersion": "solopi.ai.goalpath-choice/v1", "goal": "Open search", "instructions": "Choose safely",
            "history": [{"action": "click", "status": "succeeded", "effect": "NO_VISIBLE_CHANGE", "label": "Search"}],
            "pageText": ["Search", "Loading"], "pageTextTruncated": False,
            "candidates": {"candidate_0": {"label": "Search", "operation": "click", "visualBounds": [0, 0, 8, 6]},
                           "candidate_1": {"label": "Wait", "operation": "wait"}},
            "visual": {"schemaVersion": vision.VISUAL_SCHEMA, "observationId": "private-observation-id",
                       "imagePath": str(self.path), "sha256": hashlib.sha256(self.png).hexdigest(),
                       "width": 16, "height": 12, "treeFingerprint": "a" * 64, "attempts": 1}}

    def predictor(self, result=None, raw=None, **kwargs):
        predictor = vision.GoalPathVisionPredictor("https://api.openai.com/v1", "test-vision-model",
                                                   api_key_env="GOALPATH_TEST_KEY", **kwargs)
        response = io.BytesIO(raw if raw is not None else json.dumps(result or completion()).encode("utf-8"))
        response.status = 200
        predictor.opener = mock.Mock()
        predictor.opener.open.return_value = response
        return predictor

    def assert_invalid(self, predictor, request):
        with self.assertRaisesRegex(ValueError, "^GoalPath vision request failed$") as raised:
            predictor(request)
        for secret in (str(self.path), "unit-test-secret-value", "private-observation-id"):
            self.assertNotIn(secret, str(raised.exception))
            self.assertNotIn(secret, json.dumps(predictor.last_metadata))
        return predictor

    def test_inline_image_candidate_bounds_and_strict_choice_contract(self):
        predictor = self.predictor()
        request = self.request()
        original = copy.deepcopy(request)
        self.assertEqual({"choice": "candidate_0"}, predictor(request))
        predictor.opener.open.assert_called_once()
        message = predictor.opener.open.call_args.args[0]
        self.assertEqual("https://api.openai.com/v1/chat/completions", message.full_url)
        self.assertEqual("POST", message.method)
        self.assertEqual("Bearer unit-test-secret-value", message.get_header("Authorization"))
        self.assertEqual("application/json", message.get_header("Content-type"))
        self.assertEqual(30.0, predictor.opener.open.call_args.kwargs["timeout"])
        body = json.loads(message.data)
        self.assertEqual(("test-vision-model", 0, False), (body["model"], body["temperature"], body["stream"]))
        self.assertEqual(128, body["max_tokens"])
        self.assertEqual(128, predictor.metadata["maxOutputTokens"])
        content = body["messages"][1]["content"]
        self.assertEqual(["text", "image_url"], [item["type"] for item in content])
        encoded = content[1]["image_url"]["url"]
        self.assertTrue(encoded.startswith("data:image/png;base64,"))
        self.assertEqual(self.png, base64.b64decode(encoded.split(",", 1)[1]))
        public = json.loads(content[0]["text"])
        self.assertEqual(request["candidates"], public["candidates"])
        self.assertEqual({"width": 16, "height": 12, "boundsCoordinateSpace": "source-image-pixels"}, public["visual"])
        schema = body["response_format"]["json_schema"]["schema"]
        self.assertEqual(["candidate_0", "candidate_1", "abstain"], schema["properties"]["choice"]["enum"])
        self.assertFalse(schema["additionalProperties"])
        self.assertTrue(body["response_format"]["json_schema"]["strict"])
        self.assertEqual(original, request)
        self.assertEqual(self.png, self.path.read_bytes())
        for private in (str(self.path), "private-observation-id", "a" * 64, "unit-test-secret-value", "imagePath", "resourceId", "sessionToken"):
            self.assertNotIn(private, message.data.decode("utf-8"))
        meta = predictor.last_metadata
        self.assertEqual((1, 1, "completed"), (meta["requestCount"], meta["imageCount"], meta["status"]))
        self.assertEqual(128, meta["maxOutputTokens"])
        self.assertEqual({"prompt_tokens": 50, "completion_tokens": 6, "total_tokens": 56}, meta["usage"])
        self.assertEqual(meta["imageEvidence"]["sourceSha256"], meta["imageEvidence"]["uploadedSha256"])
        self.assertEqual("identity", meta["imageEvidence"]["transform"])
        self.assertGreaterEqual(meta["elapsedMs"], 0)

    def test_text_only_uses_identical_model_text_and_candidates_but_sends_no_image(self):
        image = self.predictor(max_output_tokens=2048)
        text = self.predictor(include_image=False, max_output_tokens=2048)
        request = self.request()
        self.assertEqual(image(request), text(request))
        image_body = json.loads(image.opener.open.call_args.args[0].data)
        text_body = json.loads(text.opener.open.call_args.args[0].data)
        self.assertEqual(image_body["model"], text_body["model"])
        self.assertEqual((2048, 2048), (image_body["max_tokens"], text_body["max_tokens"]))
        self.assertEqual(image_body["messages"][0], text_body["messages"][0])
        self.assertEqual(image_body["messages"][1]["content"][:1], text_body["messages"][1]["content"])
        self.assertNotIn("data:image", json.dumps(text_body))
        self.assertEqual((1, 0), (text.last_metadata["requestCount"], text.last_metadata["imageCount"]))
        self.assertIsNone(text.last_metadata["imageEvidence"]["uploadedSha256"])
        self.assertTrue(text.requires_visual_observation)

    def test_output_token_budget_boundaries_and_failure_receipts(self):
        for budget in (1, 2048, 4096):
            with self.subTest(budget=budget):
                predictor = self.predictor(max_output_tokens=budget)
                predictor(self.request())
                self.assertEqual(budget, json.loads(predictor.opener.open.call_args.args[0].data)["max_tokens"])
                self.assertEqual(budget, predictor.metadata["maxOutputTokens"])
                self.assertEqual(budget, predictor.last_metadata["maxOutputTokens"])
                invalid = self.request()
                invalid["visual"]["sha256"] = "0" * 64
                self.assert_invalid(predictor, invalid)
                self.assertEqual(budget, predictor.last_metadata["maxOutputTokens"])
                self.assertEqual(0, predictor.last_metadata["requestCount"])

    def test_text_only_still_rejects_invalid_screenshot_evidence(self):
        request = self.request()
        request["visual"]["sha256"] = "0" * 64
        predictor = self.assert_invalid(self.predictor(include_image=False), request)
        predictor.opener.open.assert_not_called()
        self.assertEqual(0, predictor.last_metadata["requestCount"])

    def test_abstain_is_an_explicit_valid_response(self):
        self.assertEqual({"choice": "abstain"}, self.predictor(completion('{"choice":"abstain"}'))(self.request()))

    def test_invalid_choice_extra_action_duplicate_fields_and_non_json_fail_closed(self):
        for content in ('{"choice":"candidate_2"}', '{"choice":0}', '{"choice":"candidate_0","action":{"type":"back"}}',
                        '{"choice":"candidate_0","choice":"abstain"}', '{"choice":NaN}',
                        '```json\n{"choice":"candidate_0"}\n```', 'https://example.com/image.png', 'null', '[]'):
            with self.subTest(content=content):
                predictor = self.assert_invalid(self.predictor(completion(content)), self.request())
                predictor.opener.open.assert_called_once()
                self.assertEqual("unavailable_or_invalid_response", predictor.last_metadata["status"])
                self.assertEqual("reported-model", predictor.last_metadata["reportedModel"])
                self.assertEqual(56, predictor.last_metadata["usage"]["total_tokens"])

    def test_incomplete_tool_and_refusal_completions_are_rejected(self):
        bad_messages = [{"finish_reason": "length"}, {"finish_reason": "tool_calls"},
                        {"message": {"role": "assistant", "content": '{"choice":"candidate_0"}', "tool_calls": [{"id": "bad"}]}},
                        {"message": {"role": "assistant", "content": '{"choice":"candidate_0"}', "refusal": "denied"}},
                        {"message": {"role": "assistant", "content": [{"type": "text", "text": "candidate_0"}]}},
                        {"message": {"role": "user", "content": '{"choice":"candidate_0"}'}}]
        for changed in bad_messages:
            result = completion()
            result["choices"][0].update(changed)
            with self.subTest(changed=changed):
                predictor = self.assert_invalid(self.predictor(result), self.request())
                self.assertEqual(56, predictor.last_metadata["usage"]["total_tokens"])
        for changed in ([], [{}, {}], None):
            self.assert_invalid(self.predictor(completion(choices=changed)), self.request())

    def test_bounded_strict_response_json_and_usage(self):
        for raw in (b"x" * (vision.MAX_RESPONSE_BYTES + 1), b'{"choices":[],"choices":[]}', b'\xff', b'{"value":NaN}'):
            self.assert_invalid(self.predictor(raw=raw), self.request())
        predictor = self.predictor(completion(usage={"prompt_tokens": True, "completion_tokens": -1,
                                                  "total_tokens": 99, "secret": "unit-test-secret-value"},
                                             model="unit-test-secret-value", raw_response="unit-test-secret-value"))
        predictor(self.request())
        self.assertEqual({"total_tokens": 99}, predictor.last_metadata["usage"])
        self.assertNotIn("unit-test-secret-value", json.dumps(predictor.last_metadata))

    def test_no_retry_and_no_remote_error_or_credentials_in_exception_or_receipt(self):
        predictor = self.predictor()
        predictor.opener.open.side_effect = urllib.error.URLError("unit-test-secret-value private-capture.png")
        self.assert_invalid(predictor, self.request())
        predictor.opener.open.assert_called_once()
        self.assertEqual(1, predictor.last_metadata["requestCount"])
        self.assertEqual(1, predictor.last_metadata["imageCount"])
        predictor = self.predictor()
        predictor.opener.open.return_value.status = 429
        self.assert_invalid(predictor, self.request())
        predictor.opener.open.assert_called_once()

    def test_credentials_are_read_per_call_and_never_persisted(self):
        predictor = self.predictor()
        request = self.request()
        predictor(request)
        os.environ["GOALPATH_TEST_KEY"] = "rotated-unit-test-key"
        response = io.BytesIO(json.dumps(completion()).encode("utf-8"))
        response.status = 200
        predictor.opener.open.return_value = response
        predictor(request)
        self.assertEqual("Bearer rotated-unit-test-key", predictor.opener.open.call_args.args[0].get_header("Authorization"))
        self.assertNotIn("rotated-unit-test-key", json.dumps(predictor.metadata))
        self.assertNotIn("rotated-unit-test-key", json.dumps(predictor.last_metadata))
        self.assertFalse(any("secret" in str(value) for key, value in vars(predictor).items() if key != "opener"))
        for value in ("", "has spaces", "line\nbreak", "unicode-密钥"):
            os.environ["GOALPATH_TEST_KEY"] = value
            predictor = self.assert_invalid(self.predictor(), request)
            predictor.opener.open.assert_not_called()
        del os.environ["GOALPATH_TEST_KEY"]
        self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()

    def test_png_hash_dimensions_and_decode_validation(self):
        for field, value in (("sha256", "0" * 64), ("sha256", "SHA256"), ("width", 17), ("height", 11),
                             ("width", True), ("height", 0), ("width", 16_000_001), ("attempts", 0),
                             ("attempts", True), ("attempts", 4), ("treeFingerprint", "not-a-digest"),
                             ("schemaVersion", "wrong")):
            request = self.request()
            request["visual"][field] = value
            with self.subTest(field=field, value=value):
                self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()
        request = self.request()
        request["visual"].update(width=4001, height=4001)
        self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()
        for data in (b"not-png", self.png[:24], self.png[:-15], self.png[:40] + b"corrupt" + self.png[47:]):
            self.path.write_bytes(data)
            request = self.request()
            request["visual"]["sha256"] = hashlib.sha256(data).hexdigest()
            with self.subTest(data_length=len(data)):
                self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()

    def test_local_paths_only_no_traversal_symlinks_or_mislabeled_files(self):
        alias = self.path.parent / "linked.png"
        alias.symlink_to(self.path)
        renamed = self.path.with_suffix(".jpg")
        renamed.write_bytes(self.png)
        for path in ("private-capture.png", "https://example.com/capture.png", "data:image/png;base64,AA==",
                     str(self.path.parent / "missing.png"), str(alias), str(renamed),
                     str(self.path.parent / ".." / self.path.parent.name / self.path.name)):
            request = self.request()
            request["visual"]["imagePath"] = path
            with self.subTest(path=path):
                self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()

    def test_image_byte_budget_checked_before_full_decode(self):
        with mock.patch.object(vision, "MAX_IMAGE_BYTES", len(self.png) - 1):
            self.assert_invalid(self.predictor(), self.request()).opener.open.assert_not_called()

    def test_pillow_is_optional_until_validating_visual_observation(self):
        with mock.patch.dict(sys.modules, {"PIL": None}):
            predictor = self.predictor()
            self.assert_invalid(predictor, self.request()).opener.open.assert_not_called()

    def test_unknown_sensitive_fields_in_nested_request_are_rejected(self):
        cases = []
        for key in ("ownerToken", "resourceId", "image_url", "action", "nodeId"):
            request = self.request()
            request["candidates"]["candidate_0"][key] = "private-value"
            cases.append(request)
        request = self.request()
        request["history"][0]["sessionToken"] = "private-value"
        cases.append(request)
        request = self.request()
        request["visual"]["url"] = "https://example.com/capture.png"
        cases.append(request)
        request = self.request()
        request["ownerToken"] = "private-value"
        cases.append(request)
        for request in cases:
            self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()

    def test_candidate_indices_and_bounds_cannot_escape_current_screen(self):
        for bounds in ([-1, 0, 8, 6], [0, 0, 17, 6], [0, 0, 8, 13], [8, 0, 8, 6],
                       [0, 0, True, 6], [0, 0, 8.0, 6], [0, 0, 8], "0,0,8,6"):
            request = self.request()
            request["candidates"]["candidate_0"]["visualBounds"] = bounds
            self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()
        for candidates in ({}, {"candidate_1": {"label": "x", "operation": "click"}},
                           {"candidate_0": {"label": "x", "operation": "shell"}},
                           {"candidate_0": {"label": "x", "operation": "click", "selected": 1}}):
            request = self.request()
            request["candidates"] = candidates
            self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()

    def test_semantic_request_and_history_budgets_are_strict(self):
        for field, value in (("goal", ""), ("instructions", "x" * 4097), ("pageText", ["same", "same"]),
                             ("pageText", ["x"] * 65), ("pageText", ["x" * 129]),
                             ("pageTextTruncated", 0), ("history", [{}] * 9)):
            request = self.request()
            request[field] = value
            self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()
        for item in ({"action": "click", "status": "failed", "effect": "UI_CHANGED"},
                     {"action": "click", "status": "succeeded", "effect": "PASSED"},
                     {"action": {"type": "click"}, "status": "succeeded"}):
            request = self.request()
            request["history"] = [item]
            self.assert_invalid(self.predictor(), request).opener.open.assert_not_called()
        with mock.patch.object(vision, "MAX_REQUEST_BYTES", 10):
            self.assert_invalid(self.predictor(), self.request()).opener.open.assert_not_called()

    def test_endpoint_allowlist_and_literal_loopback(self):
        for endpoint, hosts, expected in (("https://api.openai.com/v1", ("api.openai.com",), "https://api.openai.com/v1/chat/completions"),
                ("https://vision.example:8443/chat/completions", ("vision.example",), "https://vision.example:8443/chat/completions"),
                ("http://127.0.0.1:8080/v1/", (), "http://127.0.0.1:8080/v1/chat/completions"),
                ("http://[::1]:8080/v1/chat/completions", (), "http://[::1]:8080/v1/chat/completions")):
            predictor = vision.GoalPathVisionPredictor(endpoint, "test-model", allowed_hosts=hosts)
            self.assertEqual(expected, predictor.endpoint)
        for endpoint in ("https://unlisted.example/v1", "http://api.openai.com:80/v1", "http://localhost:8080/v1",
                "http://127.0.0.1/v1", "http://127.0.0.1:0/v1", "http://127.0.0.1:65536/v1", "http://2130706433:8080/v1",
                "http://0177.0.0.1:8080/v1", "http://0x7f.0.0.1:8080/v1", "http://127.0.0.1.nip.io:8080/v1",
                "http://[::ffff:127.0.0.1]:8080/v1", "https://api.openai.com/v1?key=secret", "https://api.openai.com/v1?",
                "https://api.openai.com/v1#", "https://unit-test-secret-value@api.openai.com/v1", "https://api.openai.com./v1",
                "https://api.openai.com/../v1", "https://api.openai.com/v1/%2e%2e", "https://api.openai.com\\@evil.example/v1",
                "https://api.openai.com/v1\n", "ftp://api.openai.com/v1", "https://127.0.0.1/v1", "https://[broken/v1", None):
            with self.subTest(endpoint=endpoint), self.assertRaisesRegex(ValueError, "^GoalPath vision request failed$"):
                vision.GoalPathVisionPredictor(endpoint, "test-model")

    def test_invalid_configuration(self):
        for kwargs in ({"allowed_hosts": "api.openai.com"}, {"allowed_hosts": ["*.openai.com"]},
                {"allowed_hosts": ["api.openai.com", "api.openai.com"]}, {"allowed_hosts": ["127.0.0.1"]},
                {"model": ""}, {"timeout": True}, {"timeout": float("inf")}, {"timeout": 0}, {"timeout": 121},
                {"api_key_env": "BAD\nKEY"}, {"include_image": 1},
                *({"max_output_tokens": value} for value in (True, False, 0, -1, 4097, 1.0, "128", None, float("inf")))):
            options = {"model": "test-model", **kwargs}
            with self.subTest(kwargs=kwargs), self.assertRaisesRegex(ValueError, "^GoalPath vision request failed$"):
                vision.GoalPathVisionPredictor("https://api.openai.com/v1", **options)

    def test_proxy_and_redirects_disabled_without_altering_default_tls(self):
        original = urllib.request.build_opener
        with mock.patch.object(vision.urllib.request, "build_opener", wraps=original) as build:
            predictor = vision.GoalPathVisionPredictor("https://api.openai.com/v1", "test-model")
        args = build.call_args.args
        self.assertEqual({}, args[0].proxies)
        self.assertIsInstance(args[1], vision._NoRedirect)
        with self.assertRaises(urllib.error.URLError):
            args[1].redirect_request(None, None, 302, "moved", {}, "https://evil.example/v1")
        tls = [handler for handler in predictor.opener.handlers if isinstance(handler, urllib.request.HTTPSHandler)]
        self.assertEqual(1, len(tls))
        if tls[0]._context is not None:
            self.assertEqual(ssl.CERT_REQUIRED, tls[0]._context.verify_mode)
            self.assertTrue(tls[0]._context.check_hostname)
        self.assertEqual("none", predictor.metadata["retryPolicy"])

    def test_https_handler_rejects_private_dns_answers_before_dispatch(self):
        handler = vision._PublicHTTPSHandler()
        request = urllib.request.Request("https://api.openai.com/v1/chat/completions")
        for address in ("127.0.0.1", "10.0.0.1", "169.254.169.254", "::1", "::ffff:127.0.0.1", "224.0.0.1"):
            answers = [(2, 1, 6, "", (address, 443))]
            with self.subTest(address=address), mock.patch.object(vision.socket, "getaddrinfo", return_value=answers), \
                    mock.patch.object(urllib.request.HTTPSHandler, "https_open") as dispatch:
                with self.assertRaises(ValueError):
                    handler.https_open(request)
                dispatch.assert_not_called()
        public = [(2, 1, 6, "", ("8.8.8.8", 443))]
        with mock.patch.object(vision.socket, "getaddrinfo", return_value=public), \
                mock.patch.object(urllib.request.HTTPSHandler, "https_open", return_value="response") as dispatch:
            self.assertEqual("response", handler.https_open(request))
            dispatch.assert_called_once_with(request)
        with mock.patch.object(vision.socket, "getaddrinfo", return_value=[]), \
                mock.patch.object(urllib.request.HTTPSHandler, "https_open") as dispatch:
            with self.assertRaises(ValueError):
                handler.https_open(request)
            dispatch.assert_not_called()


if __name__ == "__main__":
    unittest.main()
