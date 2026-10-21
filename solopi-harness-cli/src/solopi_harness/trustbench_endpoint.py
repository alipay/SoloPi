"""Explicit, credential-free endpoint configuration for new live experiments."""
import os
from urllib.parse import urlsplit


def model_endpoint():
    value = os.environ.get('TRUSTBENCH_MODEL_ENDPOINT', '')
    url = urlsplit(value)
    if (url.scheme != 'https' or not url.hostname or url.username or url.password
            or url.query or url.fragment or url.hostname.endswith('.invalid')):
        raise ValueError('set TRUSTBENCH_MODEL_ENDPOINT to an authorized HTTPS chat-completions URL without credentials, query or fragment')
    return value
