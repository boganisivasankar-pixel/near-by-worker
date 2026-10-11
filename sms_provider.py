"""Small replaceable SMS verification adapter; credentials are read only from environment."""

import base64
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen


class SmsProviderNotConfigured(Exception):
    pass


class SmsProviderError(Exception):
    pass


class TwilioVerifyProvider:
    def __init__(self, account_sid, auth_token, verify_service_sid):
        self.account_sid = account_sid
        self.auth_token = auth_token
        self.verify_service_sid = verify_service_sid

    @classmethod
    def from_environment(cls):
        provider_name = os.environ.get("SMS_PROVIDER", "").strip().lower()
        if provider_name != "twilio":
            raise SmsProviderNotConfigured

        account_sid = os.environ.get("TWILIO_ACCOUNT_SID", "").strip()
        auth_token = os.environ.get("TWILIO_AUTH_TOKEN", "").strip()
        service_sid = os.environ.get("TWILIO_VERIFY_SERVICE_SID", "").strip()
        if not account_sid or not auth_token or not service_sid:
            raise SmsProviderNotConfigured
        return cls(account_sid, auth_token, service_sid)

    def _post(self, resource, fields):
        url = (
            "https://verify.twilio.com/v2/Services/"
            f"{quote(self.verify_service_sid, safe='')}/{resource}"
        )
        credentials = base64.b64encode(
            f"{self.account_sid}:{self.auth_token}".encode("utf-8")
        ).decode("ascii")
        request = Request(
            url,
            data=urlencode(fields).encode("ascii"),
            headers={
                "Authorization": f"Basic {credentials}",
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
            method="POST",
        )
        try:
            with urlopen(request, timeout=12) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except (HTTPError, URLError, TimeoutError, ValueError, OSError):
            raise SmsProviderError from None
        if not isinstance(payload, dict):
            raise SmsProviderError
        return payload

    def send_code(self, phone):
        payload = self._post("Verifications", {"To": phone, "Channel": "sms"})
        if payload.get("status") not in {"pending", "approved"}:
            raise SmsProviderError
        return payload.get("sid")

    def verify_code(self, phone, code):
        payload = self._post("VerificationCheck", {"To": phone, "Code": code})
        return payload.get("status") == "approved"
