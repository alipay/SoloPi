"""Bind a bounded local PNG to a fresh Android observation, without acting.

The screenshot callback writes PNG bytes to an already reserved private file.
Visual context is device evidence, never inferred from root-node dimensions.
"""

from __future__ import annotations

import copy
import hashlib
import io
import json
import os
from pathlib import Path
import re
import secrets
import stat
import warnings

try:
    from .strict_png import validate_png
except ImportError:
    from strict_png import validate_png


SCHEMA_VERSION = "solopi.ai.visual-observation/v1"
MAX_IMAGE_BYTES = 16 * 1024 * 1024
MAX_IMAGE_PIXELS = 16_000_000
MAX_TREE_BYTES = 4 * 1024 * 1024
MAX_TREE_NODES = 10_000
MAX_TREE_DEPTH = 100
_VOLATILE = frozenset({"observationId", "createdAt", "timestamp", "timestamps", "capturedAt", "observedAt"})
_PACKAGE = re.compile(r"[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)+\Z")


class VisualObservationError(ValueError):
    """A fixed error category; page data and callback exceptions never escape."""

    def __init__(self, code: str):
        self.code = code
        super().__init__(code)


def _integer(value, minimum, maximum):
    return type(value) is int and minimum <= value <= maximum


def _text(value, maximum=256):
    return isinstance(value, str) and 0 < len(value) <= maximum and not any(ord(c) < 32 for c in value)


def _bounds(value, nonempty=False, invisible=False):
    coordinates = {"left", "top", "right", "bottom"}
    # Code security: Fastjson exports Rect.isEmpty() and Parcelable.getStability()
    # alongside coordinates. Accept only those known metadata fields, validate
    # their types/meaning, and keep the original object in the tree fingerprint.
    # Parcelable stability (LOCAL=0, VINTF=1) says nothing about UI stability.
    if (not isinstance(value, dict) or not coordinates <= set(value)
            or set(value) - coordinates - {"empty", "stability"}
            or any(not _integer(value[key], -32768, 32768) for key in coordinates)
            or "empty" in value and type(value["empty"]) is not bool
            or "stability" in value and not _integer(value["stability"], 0, 1)):
        raise VisualObservationError("visual_invalid_geometry")
    left, top, right, bottom = (value[key] for key in ("left", "top", "right", "bottom"))
    empty = left >= right or top >= bottom
    # Android accessibility clipping can invert an offscreen Rect. It is usable
    # only as retained tree evidence when visibility is explicitly false and
    # Rect.isEmpty() explicitly agrees; it never defines a viewport or target.
    clipped = invisible and value.get("empty") is True
    if ((left > right or top > bottom) and not clipped or nonempty and empty
            or "empty" in value and value["empty"] != empty):
        raise VisualObservationError("visual_invalid_geometry")
    return left, top, right, bottom


def _canonical(value, depth=0, seen=None, budget=None):
    """Retain node semantics and unknown context fields, excluding clock/IDs of observations."""
    if depth > MAX_TREE_DEPTH:
        raise VisualObservationError("visual_tree_limit")
    if seen is None:
        seen, budget = set(), [MAX_TREE_BYTES]
    budget[0] -= 1
    if budget[0] < 0:
        raise VisualObservationError("visual_tree_limit")
    if value is None or type(value) in {bool, int}:
        return value
    if isinstance(value, str):
        budget[0] -= len(value)
        if budget[0] < 0:
            raise VisualObservationError("visual_tree_limit")
        return value
    if type(value) not in {dict, list} or id(value) in seen:
        raise VisualObservationError("visual_invalid_observation")
    seen.add(id(value))
    try:
        if isinstance(value, list):
            return [_canonical(item, depth + 1, seen, budget) for item in value]
        if any(not isinstance(key, str) for key in value):
            raise VisualObservationError("visual_invalid_observation")
        return {key: _canonical(item, depth + 1, seen, budget)
                for key, item in value.items() if key not in _VOLATILE}
    finally:
        seen.remove(id(value))


def _snapshot(observation, target_package):
    if not isinstance(observation, dict) or not _text(observation.get("observationId"), 160):
        raise VisualObservationError("visual_invalid_observation")
    page, context = observation.get("page"), observation.get("visualContext")
    if not isinstance(page, dict):
        raise VisualObservationError("visual_invalid_observation")
    if page.get("packageName") != target_package:
        raise VisualObservationError("visual_target_package_mismatch")
    # Code security: missing physical-screen/window evidence never falls back to
    # page bounds or a host guess; older device payloads explicitly fail closed.
    if not isinstance(context, dict):
        raise VisualObservationError("visual_context_unavailable")
    width, height, rotation = (context.get(key) for key in ("screenWidth", "screenHeight", "rotation"))
    if (not _integer(width, 1, 16384) or not _integer(height, 1, 16384)
            or width * height > MAX_IMAGE_PIXELS or not _integer(rotation, 0, 3)
            or not _integer(context.get("windowId"), 0, 2147483647)
            or not _text(context.get("foregroundPackage"))):
        raise VisualObservationError("visual_context_unavailable")
    if context["foregroundPackage"] != target_package:
        raise VisualObservationError("visual_target_package_mismatch")
    windows = context.get("windows")
    if not isinstance(windows, list) or not 1 <= len(windows) <= 128:
        raise VisualObservationError("visual_context_unavailable")
    ids, target = set(), None
    for window in windows:
        if (not isinstance(window, dict) or not _integer(window.get("id"), 0, 2147483647)
                or window["id"] in ids or not _integer(window.get("type"), 1, 100)
                or not _integer(window.get("layer"), -2147483648, 2147483647)
                or type(window.get("active")) is not bool or type(window.get("focused")) is not bool
                or (window.get("packageName") is not None and not _text(window["packageName"]))):
            raise VisualObservationError("visual_context_unavailable")
        ids.add(window["id"])
        _bounds(window.get("bounds"), nonempty=True)
        if window["id"] == context["windowId"]:
            target = window
    if (target is None or target.get("packageName") != target_package or target["type"] != 1
            or target["active"] is not True or target["focused"] is not True):
        raise VisualObservationError("visual_window_mismatch")
    viewport = _bounds(page.get("nodeBound"), nonempty=True)
    window_bounds = _bounds(target["bounds"], nonempty=True)
    if (viewport[0] < 0 or viewport[1] < 0 or viewport[2] > width or viewport[3] > height
            or window_bounds[0] > viewport[0] or window_bounds[1] > viewport[1]
            or window_bounds[2] < viewport[2] or window_bounds[3] < viewport[3]):
        raise VisualObservationError("visual_window_mismatch")
    nodes, node_ids = [(page, 0)], set()
    while nodes:
        node, depth = nodes.pop()
        if (not isinstance(node, dict) or not _text(node.get("nodeId"), 160)
                or node["nodeId"] in node_ids or depth > MAX_TREE_DEPTH
                or len(node_ids) >= MAX_TREE_NODES):
            raise VisualObservationError("visual_invalid_observation")
        node_ids.add(node["nodeId"])
        if type(node.get("isVisibleToUser")) is not bool or type(node.get("isEnabled")) is not bool:
            raise VisualObservationError("visual_invalid_observation")
        _bounds(node.get("nodeBound"), nonempty=node["isVisibleToUser"], invisible=not node["isVisibleToUser"])
        children = node.get("children", [])
        if not isinstance(children, list):
            raise VisualObservationError("visual_invalid_observation")
        nodes.extend((child, depth + 1) for child in children)
    value = {"page": page, "visualContext": context}
    for key in ("context", "targetContext"):
        if key in observation:
            value[key] = observation[key]
    encoded = json.dumps(_canonical(value), ensure_ascii=False, allow_nan=False,
                         sort_keys=True, separators=(",", ":")).encode("utf-8")
    if len(encoded) > MAX_TREE_BYTES:
        raise VisualObservationError("visual_tree_limit")
    return hashlib.sha256(encoded).hexdigest(), width, height, rotation


def _pillow():
    try:
        from PIL import Image, ImageFile
    except ImportError:
        raise VisualObservationError("visual_pillow_unavailable") from None
    if ImageFile.LOAD_TRUNCATED_IMAGES:
        raise VisualObservationError("visual_decoder_not_strict")
    return Image


def _validate_png(raw, image_module):
    if not raw or len(raw) > MAX_IMAGE_BYTES:
        raise VisualObservationError("visual_image_size_limit")
    if not raw.startswith(b"\x89PNG\r\n\x1a\n"):
        raise VisualObservationError("visual_invalid_png")
    if len(raw) >= 24 and raw[12:16] == b"IHDR":
        declared_width, declared_height = int.from_bytes(raw[16:20], "big"), int.from_bytes(raw[20:24], "big")
        if (declared_width > 16384 or declared_height > 16384
                or declared_width * declared_height > MAX_IMAGE_PIXELS):
            raise VisualObservationError("visual_image_size_limit")
    # Code security: verify encoded PNG and decoded allocation before model use;
    # no global Pillow flags change, and no permissive truncated-image fallback.
    try:
        validate_png(raw, max_bytes=MAX_IMAGE_BYTES, max_pixels=MAX_IMAGE_PIXELS, max_dimension=16384)
        with warnings.catch_warnings():
            warnings.simplefilter("error", image_module.DecompressionBombWarning)
            with image_module.open(io.BytesIO(raw)) as image:
                width, height = image.size
                if (image.format != "PNG" or getattr(image, "n_frames", 1) != 1
                        or width <= 0 or height <= 0 or max(width, height) > 16384
                        or width * height > MAX_IMAGE_PIXELS):
                    raise VisualObservationError("visual_image_size_limit")
                image.verify()
            with image_module.open(io.BytesIO(raw)) as image:
                image.load()
    except VisualObservationError:
        raise
    except Exception:
        raise VisualObservationError("visual_invalid_png") from None
    return width, height


def _identity(info):
    return info.st_dev, info.st_ino


def _private_directory(artifacts):
    supplied = Path(artifacts)
    if ".." in supplied.parts or supplied.is_symlink():
        raise VisualObservationError("visual_invalid_artifacts")
    root = supplied.resolve(strict=True)
    if not root.is_dir():
        raise VisualObservationError("visual_invalid_artifacts")
    flags = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
    root_fd = os.open(root, flags)
    try:
        name = "visual-" + secrets.token_hex(12)
        # Code security: a private exclusively-created directory and openat files
        # prevent overwriting existing captures or following an image symlink.
        os.mkdir(name, mode=0o700, dir_fd=root_fd)
        folder_fd = os.open(name, flags, dir_fd=root_fd)
        folder = root / name
        if _identity(folder.stat(follow_symlinks=False)) != _identity(os.fstat(folder_fd)):
            os.close(folder_fd)
            raise VisualObservationError("visual_invalid_artifacts")
        return folder, folder_fd
    finally:
        os.close(root_fd)


def _read_capture(folder, folder_fd, name, screenshot):
    if (folder.is_symlink() or _identity(folder.stat(follow_symlinks=False))
            != _identity(os.fstat(folder_fd))):
        raise VisualObservationError("visual_invalid_artifacts")
    path = folder / name
    flags = os.O_RDWR | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    image_fd = os.open(name, flags, mode=0o600, dir_fd=folder_fd)
    try:
        before = os.fstat(image_fd)
        try:
            screenshot(path)
        except Exception:
            raise VisualObservationError("visual_screenshot_failed") from None
        after = os.stat(name, dir_fd=folder_fd, follow_symlinks=False)
        # Code security: retain the original inode and read from its descriptor;
        # a callback cannot replace it with a symlink, hardlink, or another file.
        if (not stat.S_ISREG(after.st_mode) or after.st_nlink != 1
                or _identity(before) != _identity(after) or path.is_symlink()
                or path.resolve(strict=True) != path
                or _identity(folder.stat(follow_symlinks=False)) != _identity(os.fstat(folder_fd))):
            raise VisualObservationError("visual_capture_path_changed")
        if not 0 < after.st_size <= MAX_IMAGE_BYTES:
            raise VisualObservationError("visual_image_size_limit")
        os.lseek(image_fd, 0, os.SEEK_SET)
        with os.fdopen(os.dup(image_fd), "rb") as stream:
            raw = stream.read(MAX_IMAGE_BYTES + 1)
        if len(raw) != after.st_size or len(raw) > MAX_IMAGE_BYTES:
            raise VisualObservationError("visual_image_size_limit")
        os.fchmod(image_fd, 0o600)
        return path, raw
    finally:
        os.close(image_fd)


def capture_visual_observation(observation, observe, screenshot, artifacts,
                               target_package, max_attempts=3):
    """Return ``(fresh_observation, metadata)`` after equal tree/image/tree context.

    ``observe()`` supplies a new real observation. ``screenshot(Path)`` writes an
    original PNG into the reserved file. At most three captures are attempted;
    changed and invalid captures stay in the private artifacts subdirectory.
    All failures expose only ``VisualObservationError.code`` and a fixed message.
    """
    folder_fd = None
    try:
        if (not callable(observe) or not callable(screenshot)
                or not isinstance(target_package, str) or len(target_package) > 256
                or not _PACKAGE.fullmatch(target_package) or not _integer(max_attempts, 1, 3)):
            raise VisualObservationError("visual_invalid_configuration")
        before = copy.deepcopy(observation)
        before_snapshot = _snapshot(before, target_package)
        image_module = _pillow()
        folder, folder_fd = _private_directory(artifacts)
        for attempt in range(1, max_attempts + 1):
            path, raw = _read_capture(folder, folder_fd, "%02d.png" % attempt, screenshot)
            width, height = _validate_png(raw, image_module)
            try:
                after = copy.deepcopy(observe())
            except Exception:
                raise VisualObservationError("visual_observe_failed") from None
            after_snapshot = _snapshot(after, target_package)
            if after["observationId"] == before["observationId"]:
                raise VisualObservationError("visual_observation_not_fresh")
            if before_snapshot != after_snapshot:
                before, before_snapshot = after, after_snapshot
                continue
            if (width, height) != after_snapshot[1:3]:
                raise VisualObservationError("visual_image_dimensions_mismatch")
            return after, {"schemaVersion": SCHEMA_VERSION, "observationId": after["observationId"],
                           "imagePath": str(path), "sha256": hashlib.sha256(raw).hexdigest(),
                           "width": width, "height": height, "treeFingerprint": after_snapshot[0],
                           "attempts": attempt, "rotation": after_snapshot[3]}
        raise VisualObservationError("visual_observation_unstable")
    except VisualObservationError:
        raise
    except Exception:
        # Code security: never propagate local paths, raw page data, decoder text,
        # callback failures, or filesystem exception details into reports/logs.
        raise VisualObservationError("visual_capture_failed") from None
    finally:
        if folder_fd is not None:
            os.close(folder_fd)
