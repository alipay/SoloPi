"""Bounded structural and pixel-stream validation for one complete PNG frame.

Pillow can decode a PNG whose IDAT omits rows or the zlib trailer. This check
therefore validates the encoded stream independently before optional Pillow
decoding. It supports standard PNG colors, bit depths and Adam7 geometry,
including the RGB/RGBA PNG files produced by Android ``screencap -p``.
"""
from __future__ import annotations

import struct
import zlib


PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_BYTES = 16 * 1024 * 1024
MAX_PIXELS = 16_000_000
MAX_DIMENSION = 16384
MAX_CHUNKS = 65536
DECODE_BLOCK_BYTES = 64 * 1024
_DEPTHS = {0: {1, 2, 4, 8, 16}, 2: {8, 16}, 3: {1, 2, 4, 8}, 4: {8, 16}, 6: {8, 16}}
_CHANNELS = {0: 1, 2: 3, 3: 1, 4: 2, 6: 4}
_ADAM7 = ((0, 0, 8, 8), (4, 0, 8, 8), (0, 4, 4, 8), (2, 0, 4, 4),
          (0, 2, 2, 4), (1, 0, 2, 2), (0, 1, 1, 2))


class StrictPNGError(ValueError):
    """No decoder messages, image contents or local paths in validation errors."""

    def __init__(self):
        super().__init__("invalid_png")


def _require(condition):
    if not condition:
        raise StrictPNGError()


def _scanlines(width, height, bit_depth, color, interlace):
    bits = bit_depth * _CHANNELS[color]
    if interlace == 0:
        return [(height, (width * bits + 7) // 8 + 1)]
    result = []
    for x, y, dx, dy in _ADAM7:
        pass_width = max(0, (width - x + dx - 1) // dx)
        pass_height = max(0, (height - y + dy - 1) // dy)
        if pass_width and pass_height:
            result.append((pass_height, (pass_width * bits + 7) // 8 + 1))
    return result


class _PixelRows:
    """Inspect row filters while retaining only row counters and one block."""

    def __init__(self, plans):
        self.plans, self.plan, self.row, self.offset = plans, 0, 0, 0
        self.remaining = sum(rows * length for rows, length in plans)

    def consume(self, output):
        position = 0
        _require(len(output) <= self.remaining)
        self.remaining -= len(output)
        while position < len(output):
            _require(self.plan < len(self.plans))
            rows, length = self.plans[self.plan]
            if self.offset == 0:
                _require(output[position] <= 4)
            count = min(length - self.offset, len(output) - position)
            position += count
            self.offset += count
            if self.offset == length:
                self.offset = 0
                self.row += 1
                if self.row == rows:
                    self.plan += 1
                    self.row = 0


def _validate(raw, max_bytes, max_pixels, max_dimension):
    _require(type(raw) is bytes and len(raw) <= max_bytes and raw.startswith(PNG_SIGNATURE))
    position, count = len(PNG_SIGNATURE), 0
    width = height = bit_depth = color = interlace = None
    idat, palette, seen_idat, closed_idat, ended = [], False, False, False, False
    while position < len(raw):
        count += 1
        _require(count <= MAX_CHUNKS and len(raw) - position >= 12)
        length = struct.unpack_from(">I", raw, position)[0]
        end = position + 12 + length
        _require(length <= max_bytes and end <= len(raw))
        kind = raw[position + 4:position + 8]
        _require(all(65 <= value <= 90 or 97 <= value <= 122 for value in kind) and 65 <= kind[2] <= 90)
        payload = memoryview(raw)[position + 8:position + 8 + length]
        stored_crc = struct.unpack_from(">I", raw, position + 8 + length)[0]
        # Code security: CRC and exact chunk boundaries are checked independently
        # of Pillow; no malformed IDAT or ancillary chunk reaches image upload.
        _require(zlib.crc32(payload, zlib.crc32(kind)) & 0xFFFFFFFF == stored_crc)
        if count == 1:
            _require(kind == b"IHDR" and length == 13)
            width, height, bit_depth, color, compression, filtering, interlace = struct.unpack(">IIBBBBB", payload)
            _require(1 <= width <= max_dimension and 1 <= height <= max_dimension
                     and width * height <= max_pixels and color in _DEPTHS and bit_depth in _DEPTHS[color]
                     and compression == 0 and filtering == 0 and interlace in (0, 1))
        elif kind == b"IHDR":
            raise StrictPNGError()
        elif kind == b"PLTE":
            _require(not palette and not seen_idat and color in (2, 3, 6)
                     and 0 < length <= 768 and length % 3 == 0
                     and (color != 3 or length // 3 <= 1 << bit_depth))
            palette = True
        elif kind == b"IDAT":
            _require(not closed_idat and (color != 3 or palette))
            seen_idat = True
            idat.append((position + 8, length))
        elif kind == b"IEND":
            _require(seen_idat and length == 0 and end == len(raw))
            ended = True
            break
        else:
            # A single static screenshot cannot contain APNG frames, unknown
            # critical chunks, or an IDAT sequence split by ancillary data.
            _require(kind not in (b"acTL", b"fcTL", b"fdAT") and kind[0] & 32 != 0)
            if seen_idat:
                closed_idat = True
        position = end
    _require(ended and width is not None)
    rows = _PixelRows(_scanlines(width, height, bit_depth, color, interlace))
    decoder = zlib.decompressobj()
    # Code security: every inflate call has a fixed maximum output, including
    # a one-byte overflow sentinel. Never allocate the claimed decoded image or
    # call unbounded decompress/flush on an attacker-controlled compressed blob.
    for start, length in idat:
        for offset in range(0, length, DECODE_BLOCK_BYTES):
            pending = memoryview(raw)[start + offset:start + min(length, offset + DECODE_BLOCK_BYTES)]
            while pending:
                _require(not decoder.eof)
                limit = min(DECODE_BLOCK_BYTES, rows.remaining + 1)
                output = decoder.decompress(pending, limit)
                rows.consume(output)
                _require(not decoder.unused_data)
                tail = decoder.unconsumed_tail
                _require(not tail or len(tail) < len(pending) or bool(output))
                pending = tail
    _require(decoder.eof and not decoder.unused_data and not decoder.unconsumed_tail
             and rows.remaining == 0 and rows.plan == len(rows.plans))
    return width, height


def validate_png(raw: bytes, *, max_bytes=MAX_BYTES, max_pixels=MAX_PIXELS, max_dimension=MAX_DIMENSION):
    """Return ``(width, height)`` for a complete bounded single-frame PNG.

    This checks CRC, chunk ordering, color/bit-depth constraints, all scanline
    lengths and filter bytes, and a complete zlib stream with no trailing data.
    RGB/RGBA, grayscale, palette and Adam7 encodings share the same bounded path.
    All failures use ``StrictPNGError('invalid_png')`` without decoder details.
    """
    try:
        _require(all(type(value) is int and 1 <= value <= ceiling for value, ceiling in
                     ((max_bytes, MAX_BYTES), (max_pixels, MAX_PIXELS), (max_dimension, MAX_DIMENSION))))
        return _validate(raw, max_bytes, max_pixels, max_dimension)
    except StrictPNGError:
        raise
    except Exception:
        raise StrictPNGError() from None
