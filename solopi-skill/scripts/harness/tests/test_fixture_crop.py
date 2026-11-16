import base64
import hashlib
import io
import tempfile
import time
import unittest
from pathlib import Path

from PIL import Image
from solopi_harness import desktop_control, virtual_desktop


class FixtureCropTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.owner = virtual_desktop.VirtualDesktopSession(
            {'deviceId': 'device', 'appId': 'com.solopi.fastpath.replyfixture', 'controlPackage': 'test', 'controlPort': 23343},
            Path(self.tmp.name) / 'owner', desktop_control.cli_args)
        self.target = {'resourceId': 'com.solopi.fastpath.demo:id/chat_image_content', 'description': 'fixture:image:m1',
                       'packageName': 'com.solopi.fastpath.replyfixture', 'isVisibleToUser': True, 'isPassword': False,
                       'isEnabled': True, 'nodeBound': {'left': 2, 'top': 3, 'right': 6, 'bottom': 7}}
        self.owner.current = {'observationId': 'obs', 'screenWidth': 10, 'screenHeight': 10, 'windowId': 1,
                              'windows': [{'id': 1, 'layer': 1, 'bounds': {'left': 0, 'top': 0, 'right': 10, 'bottom': 10}}],
                              'page': {'children': [self.target]}}
        self.owner.current_frame_at = time.monotonic()
        image = Image.new('RGB', (10, 10), 'red')
        for x in range(2, 6):
            for y in range(3, 7): image.putpixel((x, y), (0, 255, 0))
        out = io.BytesIO()
        image.save(out, format='PNG')
        self.raw = out.getvalue()
        (self.owner.root / 'frame.png').write_bytes(self.raw)
        self.owner.evidence = [{'observationId': 'obs', 'screenshot': 'frame.png', 'sha256': hashlib.sha256(self.raw).hexdigest()}]
        self.value = {'observationId': 'obs', 'messageId': 'm1'}

    def test_crop_contains_only_bound_target(self):
        result = self.owner.fixture_crop(self.value)
        with Image.open(io.BytesIO(base64.b64decode(result['imageData']))) as image:
            self.assertEqual(image.size, (4, 4))
            self.assertEqual(set(image.getdata()), {(0, 255, 0)})

    def test_wrong_identity_duplicate_obscured_stale_and_tamper_are_rejected(self):
        for change, expected in [
            (lambda: self.value.update(messageId='other'), 'fixture_image_unconfirmed'),
            (lambda: self.owner.current['page']['children'].append(dict(self.target)), 'fixture_image_unconfirmed'),
            (lambda: self.owner.current['windows'].append({'id': 2, 'layer': 2, 'bounds': {'left': 1, 'top': 1, 'right': 8, 'bottom': 8}}), 'fixture_image_unconfirmed'),
            (lambda: setattr(self.owner, 'current_frame_at', time.monotonic() - 31), 'stale_observation'),
            (lambda: (self.owner.root / 'frame.png').write_bytes(b'tampered'), 'virtual_screenshot_hash_mismatch'),
        ]:
            with self.subTest(expected=expected):
                self.setUp()
                change()
                with self.assertRaisesRegex(virtual_desktop.Error, expected): self.owner.fixture_crop(self.value)

    def test_other_application_cannot_crop(self):
        self.owner.config['appId'] = 'com.tencent.mm'
        with self.assertRaisesRegex(virtual_desktop.Error, 'fixture_unavailable'): self.owner.fixture_crop(self.value)


if __name__ == '__main__': unittest.main()
