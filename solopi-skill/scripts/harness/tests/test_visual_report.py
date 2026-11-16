"""Offline reports preserve whole-frame evidence without executing UI text."""

import sys
from pathlib import Path
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src" / "solopi_harness"))
import visual_report


class VisualReportTests(unittest.TestCase):
    def test_hostile_page_text_and_filename_are_inert_local_evidence(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / 'frame "<img onerror=alert(1)>.png'
            image.write_bytes(b"original-frame")
            report = {"status": "not_tested", "pageText": "</pre><script>alert(1)</script>"}
            target = visual_report.export_report(report, root)
            text = target.read_text()
            self.assertNotIn("<script>", text)
            self.assertIn("&lt;script&gt;", text)
            self.assertIn("%22%3Cimg%20onerror%3Dalert%281%29%3E.png", text)
            self.assertIn('href="timing.json"', text)
            self.assertIn("height:auto", text)
            self.assertEqual(b"original-frame", image.read_bytes())

    def test_external_symlink_is_omitted_and_existing_report_is_preserved(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            root = parent / "attempt"
            root.mkdir()
            external = parent / "outside.png"
            external.write_bytes(b"outside")
            (root / "leak.png").symlink_to(external)
            target = visual_report.export_report({"status": "failed"}, root)
            self.assertNotIn("leak.png", target.read_text())
            original = target.read_bytes()
            with self.assertRaises(FileExistsError):
                visual_report.export_report({"status": "passed"}, root)
            self.assertEqual(original, target.read_bytes())

    def test_custom_desktop_title_is_escaped(self):
        with tempfile.TemporaryDirectory() as directory:
            target = visual_report.export_report({"status": "passed"}, directory,
                                                 title="Desktop </title><script>alert(1)</script>")
            text = target.read_text()
            self.assertNotIn("<script>", text)
            self.assertEqual(2, text.count("Desktop &lt;/title&gt;&lt;script&gt;alert(1)&lt;/script&gt;"))


if __name__ == "__main__":
    unittest.main()
