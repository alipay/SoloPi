"""Tree/image binding and local-file boundaries; no model, device or service."""

import builtins
import copy
import hashlib
import json
import os
from pathlib import Path
import stat
import struct
import sys
import tempfile
import unittest
from unittest import mock
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import visual_observation as visual
from solopi_harness import goalpath


PACKAGE = "com.example.app"


def png(width=12, height=20, row_count=None, truncate_zlib=False):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = (b"\x00" + b"\x20\x40\x60" * width) * (height if row_count is None else row_count)
    compressed = zlib.compress(rows)
    if truncate_zlib:
        compressed = compressed[:-4]
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", compressed) + chunk(b"IEND", b""))


def bounds(left=0, top=0, right=12, bottom=20):
    return {"left": left, "top": top, "right": right, "bottom": bottom}


def observation(identifier="before", text="Search", window_id=7):
    return {"observationId": identifier, "createdAt": 42, "signature": "untrusted-cached-signature",
            "page": {"nodeId": "root", "packageName": PACKAGE, "nodeBound": bounds(),
                     "isVisibleToUser": True, "isEnabled": True, "isClickable": False,
                     "children": [{"nodeId": "button", "packageName": PACKAGE,
                                   "nodeBound": bounds(1, 1, 11, 8), "text": text,
                                   "description": "open search", "className": "android.widget.Button",
                                   "isVisibleToUser": True, "isEnabled": True,
                                   "isClickable": True, "isPassword": False}]},
            "visualContext": {"screenWidth": 12, "screenHeight": 20, "rotation": 0,
                              "foregroundPackage": PACKAGE, "windowId": window_id,
                              "windows": [{"id": window_id, "type": 1, "layer": 0,
                                           "active": True, "focused": True,
                                           "packageName": PACKAGE, "bounds": bounds()}]}}


def android_rect_capture():
    # Root, target button and visualContext copied from pilot-internal-v2's
    # controlled-icon/normal agent-transcript.json observation (2026-10-19).
    # This minimal tree slice retains the actual Rect serialization, coordinates,
    # node semantics and two real windows; session/path/timing data are omitted.
    return {
        "observationId": "android-rect-before",
        "page": {
            "visible": True, "isPassword": False, "description": "",
            "className": "android.widget.FrameLayout", "type": "AccessibilityNodeTree",
            "isChecked": False, "isVisibleToUser": True, "isWebView": False,
            "depth": 1, "isEditable": False,
            "nodeBound": {"bottom": 2400, "empty": False, "left": 0, "right": 1080, "stability": 0, "top": 0},
            "children": [{
                "resourceId": "com.solopi.fastpath.demo:id/visual_b2",
                "visible": True, "isPassword": False, "description": "",
                "className": "android.widget.Button", "type": "AccessibilityNodeTree",
                "isChecked": False, "isVisibleToUser": True, "isWebView": False,
                "depth": 7, "isEditable": False,
                "nodeBound": {"bottom": 959, "empty": False, "left": 63, "right": 1017, "stability": 0, "top": 733},
                "isScrollable": False, "isEnabled": True, "isSelected": False,
                "isClickable": True, "text": "", "id": "-4294967127",
                "packageName": "com.solopi.fastpath.demo", "nodeId": "node-17", "isFocusable": True,
            }],
            "isScrollable": False, "isEnabled": True, "isSelected": False,
            "isClickable": False, "text": "", "id": "-2147483650",
            "packageName": "com.solopi.fastpath.demo", "nodeId": "node-1", "isFocusable": False,
        },
        "visualContext": {
            "screenWidth": 1080, "screenHeight": 2400, "rotation": 0,
            "foregroundPackage": "com.solopi.fastpath.demo", "windowId": 8435,
            "windows": [
                {"focused": False, "bounds": {"top": 0, "left": 0, "bottom": 132, "right": 1080},
                 "active": False, "id": 7022, "packageName": "com.android.systemui", "type": 3, "layer": 1},
                {"focused": True, "bounds": {"top": 0, "left": 0, "bottom": 2400, "right": 1080},
                 "active": True, "id": 8435, "packageName": "com.solopi.fastpath.demo", "type": 1, "layer": 0},
            ],
        },
    }


def android_offscreen_node():
    # Exact non-child fields from validation/reset-diagnostic-start.json node-31.
    # Accessibility clipping preserves the offscreen top beyond the clipped
    # bottom; this clickable node is explicitly invisible and cannot be targeted.
    return {
        "className": "android.widget.Button", "depth": 6, "description": "", "id": "-4294967093",
        "isChecked": False, "isClickable": True, "isEditable": False, "isEnabled": True,
        "isFocusable": True, "isPassword": False, "isScrollable": False, "isSelected": False,
        "isVisibleToUser": False, "isWebView": False,
        "nodeBound": {"bottom": 2337, "empty": True, "left": 63, "right": 1017, "stability": 0, "top": 2567},
        "nodeId": "node-31", "packageName": "com.solopi.fastpath.demo",
        "resourceId": "com.solopi.fastpath.demo:id/reset_button", "text": "返回场景选择",
        "type": "AccessibilityNodeTree", "visible": False,
    }


class VisualObservationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name).resolve()
        self.artifacts = self.root / "artifacts"
        self.artifacts.mkdir()
        self.paths = []

    def screenshot(self, path):
        self.paths.append(path)
        self.assertTrue(path.is_file())
        self.assertEqual(b"", path.read_bytes())
        path.write_bytes(png())

    def capture(self, before=None, after=None, **kwargs):
        return visual.capture_visual_observation(
            before or observation(), kwargs.pop("observe", lambda: after or observation("after")),
            kwargs.pop("screenshot", self.screenshot), kwargs.pop("artifacts", self.artifacts),
            kwargs.pop("target_package", PACKAGE), **kwargs)

    def assert_code(self, code, call):
        with self.assertRaises(visual.VisualObservationError) as failure:
            call()
        self.assertEqual(code, failure.exception.code)
        self.assertEqual(code, str(failure.exception))
        self.assertIsNone(failure.exception.__cause__)

    def test_stable_pair_binds_new_observation_and_original_png(self):
        before, after = observation(), observation("after")
        after["createdAt"] = 999
        after["page"]["children"][0]["timestamp"] = 999
        saved = copy.deepcopy(before)
        fresh, metadata = self.capture(before, after)
        self.assertEqual(after, fresh)
        self.assertEqual(saved, before)
        self.assertEqual(visual.SCHEMA_VERSION, metadata["schemaVersion"])
        self.assertEqual(("after", 1, 12, 20, 0), (metadata["observationId"], metadata["attempts"],
                         metadata["width"], metadata["height"], metadata["rotation"]))
        path = Path(metadata["imagePath"])
        self.assertTrue(path.is_absolute())
        self.assertTrue(path.is_relative_to(self.artifacts))
        self.assertEqual(png(), path.read_bytes())
        self.assertEqual(hashlib.sha256(png()).hexdigest(), metadata["sha256"])
        self.assertEqual(64, len(metadata["treeFingerprint"]))
        self.assertEqual(0o600, stat.S_IMODE(path.stat().st_mode))
        self.assertEqual(0o700, stat.S_IMODE(path.parent.stat().st_mode))
        self.assertNotIn("Search", json.dumps(metadata))

    def test_changed_tree_retries_and_preserves_both_original_images(self):
        observations = iter([observation("changed", "Settings"), observation("stable", "Settings")])
        fresh, metadata = self.capture(observe=lambda: next(observations))
        self.assertEqual(("stable", 2), (fresh["observationId"], metadata["attempts"]))
        self.assertEqual(2, len(self.paths))
        self.assertTrue(all(path.read_bytes() == png() for path in self.paths))

    def test_actual_android_fastjson_rect_fixture_captures_without_geometry_changes(self):
        before = android_rect_capture()
        original = copy.deepcopy(before)
        after = copy.deepcopy(before)
        after["observationId"] = "android-rect-after"
        raw = png(1080, 2400)  # Generated image; dimensions match the real observation.
        fresh, metadata = self.capture(before, after, target_package="com.solopi.fastpath.demo",
                                       screenshot=lambda path: path.write_bytes(raw))
        self.assertEqual(after, fresh)
        self.assertEqual(original, before)
        self.assertEqual((1080, 2400, 1), (metadata["width"], metadata["height"], metadata["attempts"]))
        self.assertEqual(raw, Path(metadata["imagePath"]).read_bytes())
        self.assertEqual(hashlib.sha256(raw).hexdigest(), metadata["sha256"])
        self.assertEqual(visual._snapshot(after, "com.solopi.fastpath.demo")[0], metadata["treeFingerprint"])
        self.assertEqual({"bottom": 959, "empty": False, "left": 63, "right": 1017, "stability": 0, "top": 733},
                         fresh["page"]["children"][0]["nodeBound"])

    def test_rect_metadata_changes_still_invalidate_tree_image_binding(self):
        before = observation()
        before["page"]["children"][0]["nodeBound"].update(empty=False, stability=0)
        for change in (lambda box: box.update(stability=1), lambda box: box.pop("empty"),
                       lambda box: box.pop("stability")):
            with self.subTest(change=change):
                after = copy.deepcopy(before)
                after["observationId"] = "after"
                change(after["page"]["children"][0]["nodeBound"])
                self.assert_code("visual_observation_unstable", lambda: self.capture(before, after, max_attempts=1))

    def test_actual_invisible_clipped_rect_captures_but_never_enters_candidates(self):
        before = android_rect_capture()
        before["page"]["children"].append(android_offscreen_node())
        original = copy.deepcopy(before)
        after = copy.deepcopy(before)
        after["observationId"] = "after"
        raw = png(1080, 2400)
        fresh, metadata = self.capture(before, after, target_package="com.solopi.fastpath.demo",
                                       screenshot=lambda path: path.write_bytes(raw))
        self.assertEqual(original, before)
        self.assertEqual(android_offscreen_node(), fresh["page"]["children"][-1])
        predictor = mock.Mock(return_value={"choice": "abstain"})
        predictor.model = "offline-fixture"
        policy = {"schemaVersion": goalpath.POLICY_SCHEMA, "targetPackage": "com.solopi.fastpath.demo",
                  "steps": {"task": {"instructions": "Choose one eligible control.",
                    "stopWhen": {"selector": {"resourceId": "com.solopi.fastpath.demo:id/page_state"},
                                 "field": "text", "equals": "DETAIL"}}}}
        provider = goalpath.GoalPathDecisionProvider(policy, mode="llm", llm_predictor=predictor,
                                                    visual_observations=True, include_unlabeled=True)
        result = provider.decide({"stepId": "task", "goal": "Open order details", "allowedActions": ["click"],
                                  "observation": fresh, "visual": metadata})
        predictor.assert_called_once()
        self.assertEqual(1, len(predictor.call_args.args[0]["candidates"]))
        self.assertEqual(["node-17"], [item["action"]["nodeId"] for item in result["modelReceipt"]["candidates"].values()])
        self.assertNotIn("返回场景选择", json.dumps(predictor.call_args.args[0], ensure_ascii=False))

    def test_invisible_clipped_rect_remains_in_fingerprint_and_cannot_claim_visibility(self):
        before = android_rect_capture()
        before["page"]["children"].append(android_offscreen_node())
        after = copy.deepcopy(before)
        after["observationId"] = "after"
        after["page"]["children"][-1]["nodeBound"]["top"] += 1
        self.assert_code("visual_observation_unstable", lambda: self.capture(before, after, max_attempts=1,
            target_package="com.solopi.fastpath.demo", screenshot=lambda path: path.write_bytes(png(1080, 2400))))
        for change in (lambda node: node.update(isVisibleToUser=True, visible=True),
                       lambda node: node["nodeBound"].pop("empty"),
                       lambda node: node["nodeBound"].update(empty=False),
                       lambda node: node["nodeBound"].update(top=32769)):
            with self.subTest(change=change):
                invalid = copy.deepcopy(before)
                change(invalid["page"]["children"][-1])
                self.assert_code("visual_invalid_geometry", lambda: self.capture(before=invalid,
                    target_package="com.solopi.fastpath.demo"))

    def test_rect_optional_metadata_is_typed_and_empty_matches_geometry(self):
        for extras in ({}, {"empty": False}, {"stability": 0}, {"stability": 1}, {"empty": False, "stability": 0}):
            with self.subTest(extras=extras):
                self.assertEqual((0, 0, 12, 20), visual._bounds(dict(bounds(), **extras), nonempty=True))
        self.assertEqual((1, 1, 1, 8), visual._bounds(dict(bounds(1, 1, 1, 8), empty=True, stability=0)))
        for extras in ({"empty": True}, {"empty": 0}, {"empty": "false"}, {"empty": None},
                       {"stability": True}, {"stability": -1}, {"stability": 2}, {"stability": "0"},
                       {"stability": 0.0}, {"stability": None}, {"unknown": 0}):
            with self.subTest(extras=extras):
                source = observation()
                source["page"]["nodeBound"].update(extras)
                self.assert_code("visual_invalid_geometry", lambda: self.capture(before=source))
        self.assertEqual([], self.paths)

    def test_rect_metadata_cannot_bypass_coordinate_or_nonempty_checks(self):
        changes = ({"left": True}, {"top": 0.0}, {"right": "12"}, {"bottom": None},
                   {"left": -32769}, {"right": 32769}, {"left": 13}, {"top": 21},
                   {"right": 0, "empty": True}, {"bottom": 0, "empty": True})
        for changed in changes:
            with self.subTest(changed=changed):
                source = observation()
                source["page"]["nodeBound"].update({"empty": False, "stability": 0, **changed})
                self.assert_code("visual_invalid_geometry", lambda: self.capture(before=source))
        source = observation()
        source["page"]["nodeBound"].update(empty=False, stability=0)
        del source["page"]["nodeBound"]["top"]
        self.assert_code("visual_invalid_geometry", lambda: self.capture(before=source))
        source = observation()
        source["page"]["nodeBound"].update(empty=False, stability=0, right=13)
        self.assert_code("visual_window_mismatch", lambda: self.capture(before=source))
        self.assertEqual([], self.paths)

    def test_repeated_change_is_bounded_and_retains_all_images(self):
        values = iter(observation(str(index), "Changed-%d" % index) for index in range(3))
        self.assert_code("visual_observation_unstable", lambda: self.capture(observe=lambda: next(values)))
        self.assertEqual(3, len(self.paths))
        self.assertTrue(all(path.exists() for path in self.paths))

    def test_same_package_window_replacement_retries_instead_of_binding_old_pixels(self):
        values = iter([observation("replaced", window_id=8), observation("stable", window_id=8)])
        fresh, metadata = self.capture(observe=lambda: next(values))
        self.assertEqual(8, fresh["visualContext"]["windowId"])
        self.assertEqual(2, metadata["attempts"])

    def test_semantics_geometry_visibility_node_identity_and_context_all_matter(self):
        changes = [lambda node: node.update(text="Changed"),
                   lambda node: node.update(nodeId="recycled"),
                   lambda node: node.update(isEnabled=False),
                   lambda node: node.update(isVisibleToUser=False),
                   lambda node: node.update(nodeBound=bounds(2, 1, 11, 8)),
                   lambda node: node.update(description="Different description")]
        for change in changes:
            with self.subTest(change=change):
                after = observation("after")
                change(after["page"]["children"][0])
                self.assert_code("visual_observation_unstable", lambda: self.capture(after=after, max_attempts=1))
        after = observation("after")
        after["visualContext"]["rotation"] = 2
        self.assert_code("visual_observation_unstable", lambda: self.capture(after=after, max_attempts=1))
        after = observation("after")
        after["context"] = {"dialog": "new"}
        self.assert_code("visual_observation_unstable", lambda: self.capture(after=after, max_attempts=1))

    def test_missing_physical_context_or_foreground_package_is_rejected_before_capture(self):
        for field in (None, "screenWidth", "screenHeight", "foregroundPackage", "windowId", "rotation", "windows"):
            source = observation()
            if field is None:
                source.pop("visualContext")
            else:
                source["visualContext"].pop(field)
            with self.subTest(field=field):
                self.assert_code("visual_context_unavailable", lambda: self.capture(before=source))
        self.assertEqual([], self.paths)

    def test_foreign_foreground_or_page_never_gets_bound(self):
        for field in ("page", "visualContext"):
            after = observation("after")
            after[field]["packageName" if field == "page" else "foregroundPackage"] = "another.app"
            self.assert_code("visual_target_package_mismatch", lambda: self.capture(after=after))

    def test_missing_window_identity_and_inactive_window_are_rejected(self):
        for change in (lambda value: value.update(windowId=8),
                       lambda value: value["windows"][0].update(active=False),
                       lambda value: value["windows"][0].update(type=2)):
            source = observation()
            change(source["visualContext"])
            self.assert_code("visual_window_mismatch", lambda: self.capture(before=source))

    def test_same_observation_id_is_not_fresh(self):
        self.assert_code("visual_observation_not_fresh", lambda: self.capture(after=observation()))

    def test_corrupt_and_truncated_png_are_rejected_and_retained(self):
        for raw in (b"not a PNG", png()[:-8], png().replace(b"IDAT", b"IDAX", 1)):
            with self.subTest(raw=raw[:16]):
                self.assert_code("visual_invalid_png", lambda: self.capture(screenshot=lambda path: path.write_bytes(raw)))
        images = list(self.artifacts.glob("visual-*/*.png"))
        self.assertEqual(3, len(images))

    def test_valid_chunk_crcs_cannot_hide_missing_scanlines_or_zlib_trailer(self):
        for raw in (png(row_count=1), png(truncate_zlib=True)):
            with self.subTest(image_sha256=hashlib.sha256(raw).hexdigest()):
                self.assert_code("visual_invalid_png", lambda: self.capture(
                    screenshot=lambda path: path.write_bytes(raw)))

    def test_png_dimensions_must_match_device_screen(self):
        self.assert_code("visual_image_dimensions_mismatch", lambda: self.capture(
            screenshot=lambda path: path.write_bytes(png(10, 10))))

    def test_encoded_size_and_declared_pixel_limits_reject_before_decoding(self):
        def too_large(path):
            with path.open("wb") as stream:
                stream.truncate(visual.MAX_IMAGE_BYTES + 1)
        self.assert_code("visual_image_size_limit", lambda: self.capture(screenshot=too_large))
        raw = png()
        with mock.patch.object(visual, "MAX_IMAGE_PIXELS", 100):
            self.assert_code("visual_image_size_limit", lambda: visual._validate_png(raw, visual._pillow()))

    def test_missing_pillow_is_explicit_and_does_not_capture(self):
        original_import = builtins.__import__
        def no_pillow(name, *args, **kwargs):
            if name == "PIL":
                raise ImportError("private-path-secret")
            return original_import(name, *args, **kwargs)
        with mock.patch("builtins.__import__", side_effect=no_pillow):
            self.assert_code("visual_pillow_unavailable", self.capture)
        self.assertEqual([], self.paths)

    def test_process_wide_truncated_image_fallback_is_rejected_without_changing_it(self):
        from PIL import ImageFile
        with mock.patch.object(ImageFile, "LOAD_TRUNCATED_IMAGES", True):
            self.assert_code("visual_decoder_not_strict", self.capture)
            self.assertTrue(ImageFile.LOAD_TRUNCATED_IMAGES)
        self.assertEqual([], self.paths)

    def test_callback_failures_hide_sensitive_messages(self):
        secret = "private-token\nprivate/path"
        def fail(*args):
            raise RuntimeError(secret)
        self.assert_code("visual_screenshot_failed", lambda: self.capture(screenshot=fail))
        self.assert_code("visual_observe_failed", lambda: self.capture(observe=fail))

    def test_symlink_artifact_root_and_parent_traversal_are_rejected(self):
        link = self.root / "link"
        link.symlink_to(self.artifacts, target_is_directory=True)
        self.assert_code("visual_invalid_artifacts", lambda: self.capture(artifacts=link))
        self.assert_code("visual_invalid_artifacts", lambda: self.capture(
            artifacts=self.artifacts / ".." / "artifacts"))

    def test_callback_cannot_replace_capture_with_symlink_or_hardlink(self):
        outside = self.root / "outside.png"
        outside.write_bytes(png())
        def replace(path, hard=False):
            path.unlink()
            if hard:
                os.link(outside, path)
            else:
                path.symlink_to(outside)
        for hard in (False, True):
            self.assert_code("visual_capture_path_changed", lambda: self.capture(
                screenshot=lambda path: replace(path, hard)))
        self.assertEqual(png(), outside.read_bytes())

    def test_existing_capture_directory_is_never_reused_or_overwritten(self):
        with mock.patch.object(visual.secrets, "token_hex", return_value="fixed"):
            self.capture()
            self.assert_code("visual_capture_failed", self.capture)
        self.assertEqual(1, len(self.paths))

    def test_invalid_attempts_and_duplicate_node_ids_are_rejected(self):
        for attempts in (0, 4, True, "3"):
            self.assert_code("visual_invalid_configuration", lambda: self.capture(max_attempts=attempts))
        source = observation()
        source["page"]["children"][0]["nodeId"] = "root"
        self.assert_code("visual_invalid_observation", lambda: self.capture(before=source))

    def test_observe_callback_mutation_does_not_change_captured_before_tree(self):
        source = observation()
        def mutate():
            source["observationId"] = "after"
            source["page"]["children"][0]["text"] = "Mutated"
            return source
        self.assert_code("visual_observation_unstable", lambda: self.capture(
            before=source, observe=mutate, max_attempts=1))


if __name__ == "__main__":
    unittest.main()
