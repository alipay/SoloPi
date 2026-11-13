import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import native_report


class NativeReportTests(unittest.TestCase):
    def test_report_escapes_page_text_and_only_embeds_run_local_pngs(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            image = root / "screen-0001-012345abcdef.png"
            image.write_bytes(b"test")
            report = {"status": "<script>alert(1)</script>", "scenarios": [], "evidence": [
                {"type": "screenshot", "content": {"path": str(image)}},
                {"type": "screenshot", "content": {"path": "https://example.org/private.png"}},
                {"type": "screenshot", "content": {"path": str(root.parent / image.name)}}]}
            output = native_report.export_report(report, root).read_text()
            self.assertNotIn("<script>", output)
            self.assertIn("&lt;script&gt;", output)
            self.assertEqual(1, output.count("<img "))
            self.assertNotIn("https://example.org", output)


if __name__ == "__main__":
    unittest.main()
