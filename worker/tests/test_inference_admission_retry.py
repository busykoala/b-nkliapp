from email.message import Message
from io import BytesIO
import urllib.error
from unittest.mock import patch

import pytest

from benchly.imagery.client import _request_json
from benchly.imagery.providers import ProviderDelay


def admission_error(status=429, retry_after="2"):
    headers = Message()
    headers["Retry-After"] = retry_after
    return urllib.error.HTTPError("https://inference.example/v1/chat/completions", status, "busy", headers, None)


@pytest.mark.parametrize("status", [429, 503])
def test_inference_waits_for_short_admission_delay(status):
    with patch("benchly.imagery.client.urllib.request.urlopen", side_effect=[admission_error(status), BytesIO(b'{"ok":true}')]), \
            patch("benchly.imagery.client.time.sleep") as sleep:
        assert _request_json("https://inference.example", retry_throttled=True) == {"ok": True}
        sleep.assert_called_once_with(2)


def test_inference_admission_wait_has_a_deadline():
    with patch("benchly.imagery.client.urllib.request.urlopen", side_effect=admission_error()), \
            patch("benchly.imagery.client.time.monotonic", side_effect=[0, 61]), \
            patch("benchly.imagery.client.time.sleep") as sleep:
        with pytest.raises(ProviderDelay, match="429"):
            _request_json("https://inference.example", retry_throttled=True)
        sleep.assert_not_called()


def test_long_inference_retry_after_is_not_shortened():
    with patch("benchly.imagery.client.urllib.request.urlopen", side_effect=admission_error(retry_after="600")), \
            patch("benchly.imagery.client.time.sleep") as sleep:
        with pytest.raises(ProviderDelay):
            _request_json("https://inference.example", retry_throttled=True)
        sleep.assert_not_called()


def test_external_provider_rate_limit_still_defers_the_job():
    with patch("benchly.imagery.client.urllib.request.urlopen", side_effect=admission_error()), \
            patch("benchly.imagery.client.time.sleep") as sleep:
        with pytest.raises(ProviderDelay):
            _request_json("https://imagery-provider.example")
        sleep.assert_not_called()
