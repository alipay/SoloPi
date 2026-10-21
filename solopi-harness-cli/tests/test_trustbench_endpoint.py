import os
import unittest
from unittest.mock import patch
from solopi_harness.trustbench_endpoint import model_endpoint


class EndpointTest(unittest.TestCase):
    def test_explicit_https(self):
        with patch.dict(os.environ, {'TRUSTBENCH_MODEL_ENDPOINT': 'https://example.com/v1/chat/completions'}):
            self.assertEqual('https://example.com/v1/chat/completions', model_endpoint())

    def test_missing_or_unsafe(self):
        for value in ('', 'http://example.com/v1', 'https://u:p@example.com/v1',
                      'https://example.com/v1?key=x', 'https://example.com/v1#key',
                      'https://model-provider.example.invalid/v1'):
            with self.subTest(value=value), patch.dict(os.environ, {'TRUSTBENCH_MODEL_ENDPOINT': value}):
                with self.assertRaises(ValueError):
                    model_endpoint()
