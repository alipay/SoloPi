import copy
import hashlib
import io
from pathlib import Path
import struct
import sys
import tempfile
import unittest
from unittest import mock
import zlib

sys.dont_write_bytecode = True
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))
from solopi_harness import goalpath_vision, strict_png as png


def chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def make_png(width=16, height=12, depth=8, color=2, interlace=0, *, decoded=None,
             compressed=None, idat_parts=None, prefix=b"", suffix=b"", palette=None):
    header = struct.pack(">IIBBBBB", width, height, depth, color, 0, 0, interlace)
    if decoded is None:
        decoded = b"".join((bytes([row % 5]) + b"\0" * (length - 1)) * rows
                            for row, (rows, length) in enumerate(png._scanlines(width, height, depth, color, interlace)))
    if compressed is None:
        compressed = zlib.compress(decoded)
    if palette is None:
        palette = chunk(b"PLTE", b"\0\0\0\xff\xff\xff") if color == 3 else b""
    if idat_parts is None:
        idat_parts = [compressed]
    return (png.PNG_SIGNATURE + chunk(b"IHDR", header) + palette + prefix
            + b"".join(chunk(b"IDAT", part) for part in idat_parts) + suffix + chunk(b"IEND", b""))


class StrictPNGTests(unittest.TestCase):
    def assert_invalid(self, raw, **kwargs):
        with self.assertRaises(png.StrictPNGError) as raised:
            png.validate_png(raw, **kwargs)
        self.assertEqual("invalid_png", str(raised.exception))

    def test_adb_rgb_rgba_and_png_standard_color_bit_depths(self):
        for color, depths in png._DEPTHS.items():
            for depth in sorted(depths):
                with self.subTest(color=color, depth=depth):
                    raw = make_png(depth=depth, color=color)
                    self.assertEqual((16, 12), png.validate_png(raw))
        # Android screencap normally emits noninterlaced RGBA8. Representative
        # header, multi-IDAT streaming, sRGB ancillary data and exact pixels.
        pixels = (b"\0" + b"\x12\x34\x56\xff" * 1080) * 2400
        compressed = zlib.compress(pixels)
        raw = make_png(width=1080, height=2400, color=6, decoded=pixels,
                       idat_parts=[compressed[start:start + 16384] for start in range(0, len(compressed), 16384)],
                       prefix=chunk(b"sRGB", b"\0"))
        self.assertEqual((1080, 2400), png.validate_png(raw))
        from PIL import Image
        with Image.open(io.BytesIO(raw)) as image:
            image.load()
            self.assertEqual((18, 52, 86, 255), image.getpixel((1079, 2399)))

    def test_adam7_small_and_odd_geometries(self):
        for width, height in ((1, 1), (1, 9), (9, 1), (2, 2), (7, 11), (17, 19)):
            for color, depth in ((0, 1), (2, 8), (3, 2), (4, 16), (6, 8)):
                with self.subTest(width=width, height=height, color=color, depth=depth):
                    self.assertEqual((width, height), png.validate_png(make_png(width, height, depth, color, interlace=1)))

    def test_rejects_partial_pixels_even_when_zlib_and_chunk_crc_are_valid(self):
        for decoded in ((b"\0" + b"\x12\x34\x56" * 16), b"", b"\0" * (12 * (16 * 3 + 1) - 1)):
            self.assert_invalid(make_png(decoded=decoded))

    def test_rejects_truncated_zlib_trailer_even_when_pixels_decode(self):
        decoded = (b"\0" + b"\x12\x34\x56" * 16) * 12
        compressed = zlib.compress(decoded)
        for trim in (1, 2, 4, 8):
            with self.subTest(trim=trim):
                self.assert_invalid(make_png(compressed=compressed[:-trim]))

    def test_crc_and_file_structure_are_independent_of_pillow(self):
        valid = make_png()
        variants = [valid[:-1], valid[:-12], valid + b"extra", valid[:30] + bytes([valid[30] ^ 1]) + valid[31:]]
        header = chunk(b"IHDR", struct.pack(">IIBBBBB", 16, 12, 8, 2, 0, 0, 0))
        variants.extend((png.PNG_SIGNATURE + chunk(b"tEXt", b"x") + valid[8:],
                         png.PNG_SIGNATURE + header + valid[8:],
                         make_png(prefix=chunk(b"ABCD", b"unknown-critical")),
                         make_png(prefix=chunk(b"abcd", b"reserved-bit-invalid")),
                         make_png(prefix=chunk(b"acTL", struct.pack(">II", 1, 0))),
                         valid[:-12] + chunk(b"IEND", b"bad")))
        for raw in variants:
            with self.subTest(length=len(raw)):
                self.assert_invalid(raw)

    def test_split_idat_can_include_empty_chunks_but_cannot_restart_or_have_trailing_data(self):
        compressed = zlib.compress((b"\0" + b"\0" * 48) * 12)
        parts = [b""] + [compressed[start:start + 1] for start in range(len(compressed))] + [b""]
        self.assertEqual((16, 12), png.validate_png(make_png(idat_parts=parts)))
        self.assert_invalid(make_png(compressed=compressed + b"trailing"))
        self.assert_invalid(make_png(compressed=compressed + zlib.compress(b"")))
        self.assert_invalid(make_png(idat_parts=[compressed, b"extra"]))
        separated = make_png(idat_parts=[compressed[:5]])[:-12] + chunk(b"tEXt", b"note") + chunk(b"IDAT", compressed[5:]) + chunk(b"IEND", b"")
        self.assert_invalid(separated)

    def test_scanline_filter_and_exact_decoded_budget(self):
        length = 16 * 3 + 1
        for decoded in (b"\x05" + b"\0" * (length * 12 - 1), b"\0" * (length * 12) + b"extra"):
            self.assert_invalid(make_png(decoded=decoded))
        # More Adam7 rows than indicated by the individual pass geometry fail.
        plans = png._scanlines(7, 11, 8, 6, 1)
        decoded = b"\0" * (sum(rows * length for rows, length in plans) + 1)
        self.assert_invalid(make_png(7, 11, 8, 6, 1, decoded=decoded))

    def test_limits_invalid_headers_and_palette_requirements(self):
        valid = make_png()
        self.assert_invalid(valid, max_bytes=len(valid) - 1)
        self.assert_invalid(valid, max_pixels=191)
        self.assert_invalid(valid, max_dimension=15)
        for kwargs in ({"max_bytes": True}, {"max_pixels": 0}, {"max_dimension": 16385}):
            self.assert_invalid(valid, **kwargs)
        for raw in (b"", bytearray(valid), None):
            self.assert_invalid(raw)
        for width, height, depth, color, compression, filtering, interlace in (
                (0, 12, 8, 2, 0, 0, 0), (16, 0, 8, 2, 0, 0, 0), (16385, 1, 8, 2, 0, 0, 0),
                (4001, 4001, 8, 2, 0, 0, 0), (16, 12, 4, 2, 0, 0, 0), (16, 12, 8, 1, 0, 0, 0),
                (16, 12, 8, 2, 1, 0, 0), (16, 12, 8, 2, 0, 1, 0), (16, 12, 8, 2, 0, 0, 2)):
            header = chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, depth, color, compression, filtering, interlace))
            self.assert_invalid(png.PNG_SIGNATURE + header + valid[33:])
        self.assert_invalid(make_png(depth=1, color=3, palette=b""))
        self.assert_invalid(make_png(depth=1, color=3, palette=chunk(b"PLTE", b"\0" * 9)))
        self.assert_invalid(make_png(color=0, palette=chunk(b"PLTE", b"\0" * 6)))
        self.assert_invalid(make_png(palette=chunk(b"PLTE", b"\0" * 5)))

    def test_decompression_is_bounded_for_valid_and_bomb_inputs(self):
        original = png.zlib.decompressobj
        calls = []
        class Decoder:
            def __init__(self):
                self.inner = original()
            def decompress(self, data, max_length):
                calls.append((len(data), max_length))
                return self.inner.decompress(data, max_length)
            def __getattr__(self, name):
                return getattr(self.inner, name)
        valid = make_png(width=512, height=512, color=6)
        bomb = make_png(width=1, height=1, compressed=zlib.compress(b"\0" * 4_000_000))
        with mock.patch.object(png.zlib, "decompressobj", side_effect=Decoder):
            self.assertEqual((512, 512), png.validate_png(valid))
            valid_calls = len(calls)
            self.assert_invalid(bomb)
        self.assertGreater(valid_calls, 1)
        self.assertTrue(all(0 < limit <= png.DECODE_BLOCK_BYTES and size <= png.DECODE_BLOCK_BYTES for size, limit in calls))
        # A claimed one-pixel RGB frame permits four decoded scanline bytes;
        # one extra sentinel byte detects millions of compressed excess bytes.
        self.assertEqual(5, calls[-1][1])

    def test_transport_rejects_pillow_permissive_inputs_before_http(self):
        for raw in (make_png(decoded=b"\0" + b"\x12\x34\x56" * 16),
                    make_png(compressed=zlib.compress((b"\0" + b"\0" * 48) * 12)[:-2])):
            with tempfile.TemporaryDirectory() as folder:
                path = Path(folder).resolve() / "frame.png"
                path.write_bytes(raw)
                visual = {"schemaVersion": goalpath_vision.VISUAL_SCHEMA, "observationId": "frame",
                    "imagePath": str(path), "sha256": hashlib.sha256(raw).hexdigest(), "width": 16, "height": 12,
                    "treeFingerprint": "a" * 64, "attempts": 1}
                request = {"schemaVersion": "solopi.ai.goalpath-choice/v1", "goal": "Search", "instructions": "Choose",
                    "history": [], "pageText": [], "pageTextTruncated": False,
                    "candidates": {"candidate_0": {"label": "Search", "operation": "click"}}, "visual": visual}
                predictor = goalpath_vision.GoalPathVisionPredictor("https://api.openai.com/v1", "test")
                predictor.opener = mock.Mock()
                with self.assertRaisesRegex(ValueError, "^GoalPath vision request failed$"):
                    predictor(copy.deepcopy(request))
                predictor.opener.open.assert_not_called()


if __name__ == "__main__":
    unittest.main()
