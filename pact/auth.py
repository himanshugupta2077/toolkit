"""Reviewer bind: one WebAuthn passkey, then the inbox stays locked to it.

Bind is a one-shot ceremony on an iPhone. After that, Face ID (or the same
iCloud passkey on her other Apple devices) unlocks a short session cookie.
The Android phone still creates and polls requests without this session.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import threading
import time
from typing import Any

from pact.store import PactError, _dir, _write_atomic

COOKIE = "pact_reviewer"
SESSION_DAYS = 7
CHALLENGE_TTL_SEC = 300
RP_NAME = "Pact"

_lock = threading.Lock()
_pending: dict[str, Any] | None = None


def _path():
    return _dir() / "reviewer.json"


def _b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def _b64url_decode(s: str) -> bytes:
    pad = "=" * ((4 - len(s) % 4) % 4)
    return base64.urlsafe_b64decode((s or "") + pad)


def is_iphone(user_agent: str | None) -> bool:
    ua = (user_agent or "").lower()
    return "iphone" in ua or "ipod" in ua


def require_iphone(user_agent: str | None) -> None:
    if not is_iphone(user_agent):
        raise PactError(
            403,
            "iphone_only",
            "Open this page in Safari on the iPhone to bind.",
        )


def rp_id(host_header: str | None) -> str:
    raw = (host_header or "").split(",")[0].strip()
    if not raw:
        raise PactError(400, "bad_origin", "Missing host.")
    if raw.startswith("["):
        end = raw.find("]")
        host = raw[1:end] if end > 1 else ""
    elif raw.count(":") == 1:
        host = raw.rsplit(":", 1)[0]
    else:
        host = raw
    host = host.strip().lower()
    if not host or "/" in host or "\\" in host:
        raise PactError(400, "bad_origin", "Invalid host.")
    return host


def origin(
    host_header: str | None,
    scheme: str | None = None,
    forwarded_proto: str | None = None,
) -> str:
    host = rp_id(host_header)
    proto = (forwarded_proto or "").split(",")[0].strip().lower()
    if not proto:
        proto = (scheme or "https").split(",")[0].strip().lower()
    if proto not in {"http", "https"}:
        proto = "https"
    if host.endswith(".ts.net"):
        proto = "https"
    return f"{proto}://{host}"


def cookie_params(host_header: str | None, scheme: str | None = None, forwarded_proto: str | None = None) -> dict[str, Any]:
    host = rp_id(host_header)
    origin_url = origin(host_header, scheme, forwarded_proto)
    return {
        "key": COOKIE,
        "max_age": SESSION_DAYS * 86400,
        "path": "/",
        "secure": origin_url.startswith("https://") or host.endswith(".ts.net"),
        "httponly": True,
        "samesite": "lax",
    }


def _load_unlocked() -> dict[str, Any]:
    path = _path()
    if not path.is_file():
        return {}
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {}
    return raw if isinstance(raw, dict) else {}


def _is_bound(rec: dict[str, Any]) -> bool:
    return bool(
        rec.get("bound")
        and rec.get("credential_id")
        and rec.get("public_key")
        and rec.get("session_secret")
    )


def mint_session(credential_id: str, secret: bytes, now: int | None = None) -> str:
    exp = int(now if now is not None else time.time()) + SESSION_DAYS * 86400
    payload = json.dumps(
        {"v": 1, "exp": exp, "cid": credential_id},
        separators=(",", ":"),
    ).encode("utf-8")
    body = _b64url(payload)
    sig = hmac.new(secret, body.encode("ascii"), hashlib.sha256).digest()
    return f"{body}.{_b64url(sig)}"


def session_ok(
    token: str | None,
    secret: bytes,
    credential_id: str,
    now: int | None = None,
) -> bool:
    if not token or "." not in token:
        return False
    body, sig_b64 = token.split(".", 1)
    try:
        got = _b64url_decode(sig_b64)
    except Exception:
        return False
    expected = hmac.new(secret, body.encode("ascii"), hashlib.sha256).digest()
    if len(got) != len(expected) or not hmac.compare_digest(got, expected):
        return False
    try:
        payload = json.loads(_b64url_decode(body))
    except Exception:
        return False
    if not isinstance(payload, dict) or payload.get("v") != 1:
        return False
    try:
        exp = int(payload.get("exp") or 0)
    except (TypeError, ValueError):
        return False
    if exp < int(now if now is not None else time.time()):
        return False
    return payload.get("cid") == credential_id


def status(token: str | None) -> dict[str, Any]:
    with _lock:
        rec = _load_unlocked()
        bound = _is_bound(rec)
        unlocked = False
        if bound:
            try:
                secret = bytes.fromhex(str(rec["session_secret"]))
            except ValueError:
                secret = b""
            unlocked = bool(secret) and session_ok(
                token, secret, str(rec["credential_id"])
            )
    return {"ok": True, "bound": bound, "unlocked": unlocked}


def require_session(token: str | None) -> dict[str, Any]:
    with _lock:
        rec = _load_unlocked()
        if not _is_bound(rec):
            raise PactError(
                401,
                "not_bound",
                "Bind an iPhone first.",
            )
        try:
            secret = bytes.fromhex(str(rec["session_secret"]))
        except ValueError as e:
            raise PactError(
                401,
                "reviewer_required",
                "Unlock with the bound iPhone first.",
            ) from e
        if not session_ok(token, secret, str(rec["credential_id"])):
            raise PactError(
                401,
                "reviewer_required",
                "Unlock with the bound iPhone first.",
            )
        return rec


def _webauthn():
    try:
        from webauthn import (
            generate_authentication_options,
            generate_registration_options,
            options_to_json,
            verify_authentication_response,
            verify_registration_response,
        )
        from webauthn.helpers import base64url_to_bytes, bytes_to_base64url
        from webauthn.helpers.structs import (
            AuthenticatorAttachment,
            AuthenticatorSelectionCriteria,
            PublicKeyCredentialDescriptor,
            ResidentKeyRequirement,
            UserVerificationRequirement,
        )
    except ImportError as e:
        raise PactError(
            500,
            "webauthn_missing",
            "Server is missing the webauthn package.",
        ) from e
    return {
        "generate_registration_options": generate_registration_options,
        "generate_authentication_options": generate_authentication_options,
        "verify_registration_response": verify_registration_response,
        "verify_authentication_response": verify_authentication_response,
        "options_to_json": options_to_json,
        "base64url_to_bytes": base64url_to_bytes,
        "bytes_to_base64url": bytes_to_base64url,
        "AuthenticatorAttachment": AuthenticatorAttachment,
        "AuthenticatorSelectionCriteria": AuthenticatorSelectionCriteria,
        "PublicKeyCredentialDescriptor": PublicKeyCredentialDescriptor,
        "ResidentKeyRequirement": ResidentKeyRequirement,
        "UserVerificationRequirement": UserVerificationRequirement,
    }


def _pending_ok(kind: str, rp: str) -> dict[str, Any]:
    global _pending
    pending = _pending
    if not pending or pending.get("kind") != kind:
        raise PactError(400, "no_challenge", "Start again from this page.")
    if time.monotonic() - float(pending.get("created") or 0) > CHALLENGE_TTL_SEC:
        _pending = None
        raise PactError(400, "challenge_expired", "That prompt expired. Try again.")
    if pending.get("rp_id") != rp:
        raise PactError(400, "bad_origin", "Open this page on the same host.")
    return pending


def begin_register(rp: str, origin_url: str) -> dict[str, Any]:
    del origin_url  # origin is checked on finish against clientDataJSON
    with _lock:
        if _is_bound(_load_unlocked()):
            raise PactError(
                409,
                "already_bound",
                "Pact is already bound to an iPhone.",
            )
    wa = _webauthn()
    with _lock:
        if _is_bound(_load_unlocked()):
            raise PactError(
                409,
                "already_bound",
                "Pact is already bound to an iPhone.",
            )
        user_id = secrets.token_bytes(32)
        options = wa["generate_registration_options"](
            rp_id=rp,
            rp_name=RP_NAME,
            user_name="pact-reviewer",
            user_display_name="Pact reviewer",
            user_id=user_id,
            authenticator_selection=wa["AuthenticatorSelectionCriteria"](
                authenticator_attachment=wa["AuthenticatorAttachment"].PLATFORM,
                resident_key=wa["ResidentKeyRequirement"].PREFERRED,
                user_verification=wa["UserVerificationRequirement"].REQUIRED,
            ),
            timeout=120000,
        )
        global _pending
        _pending = {
            "kind": "register",
            "challenge": options.challenge,
            "user_id": user_id,
            "rp_id": rp,
            "created": time.monotonic(),
        }
        return json.loads(wa["options_to_json"](options))


def finish_register(body: dict[str, Any], rp: str, origin_url: str) -> str:
    wa = _webauthn()
    if not isinstance(body, dict) or not body:
        raise PactError(400, "webauthn_failed", "Missing passkey response.")
    with _lock:
        if _is_bound(_load_unlocked()):
            raise PactError(
                409,
                "already_bound",
                "Pact is already bound to an iPhone.",
            )
        pending = _pending_ok("register", rp)
        try:
            verification = wa["verify_registration_response"](
                credential=body,
                expected_challenge=pending["challenge"],
                expected_rp_id=rp,
                expected_origin=origin_url,
                require_user_verification=True,
            )
        except PactError:
            raise
        except Exception as e:
            raise PactError(
                400,
                "webauthn_failed",
                "Could not bind this iPhone. Try Safari.",
            ) from e
        secret = os.urandom(32)
        credential_id = wa["bytes_to_base64url"](verification.credential_id)
        rec = {
            "bound": True,
            "user_id": wa["bytes_to_base64url"](pending["user_id"]),
            "credential_id": credential_id,
            "public_key": wa["bytes_to_base64url"](verification.credential_public_key),
            "sign_count": int(verification.sign_count or 0),
            "bound_at": int(time.time()),
            "session_secret": secret.hex(),
        }
        global _pending
        _pending = None
        _write_atomic(_path(), rec)
        return mint_session(credential_id, secret)


def begin_assert(rp: str) -> dict[str, Any]:
    with _lock:
        rec = _load_unlocked()
        if not _is_bound(rec):
            raise PactError(401, "not_bound", "Bind an iPhone first.")
    wa = _webauthn()
    with _lock:
        rec = _load_unlocked()
        if not _is_bound(rec):
            raise PactError(401, "not_bound", "Bind an iPhone first.")
        cred_id = wa["base64url_to_bytes"](str(rec["credential_id"]))
        options = wa["generate_authentication_options"](
            rp_id=rp,
            allow_credentials=[wa["PublicKeyCredentialDescriptor"](id=cred_id)],
            user_verification=wa["UserVerificationRequirement"].REQUIRED,
            timeout=120000,
        )
        global _pending
        _pending = {
            "kind": "assert",
            "challenge": options.challenge,
            "rp_id": rp,
            "created": time.monotonic(),
        }
        return json.loads(wa["options_to_json"](options))


def finish_assert(body: dict[str, Any], rp: str, origin_url: str) -> str:
    wa = _webauthn()
    if not isinstance(body, dict) or not body:
        raise PactError(400, "webauthn_failed", "Missing passkey response.")
    with _lock:
        rec = _load_unlocked()
        if not _is_bound(rec):
            raise PactError(401, "not_bound", "Bind an iPhone first.")
        pending = _pending_ok("assert", rp)
        try:
            verification = wa["verify_authentication_response"](
                credential=body,
                expected_challenge=pending["challenge"],
                expected_rp_id=rp,
                expected_origin=origin_url,
                credential_public_key=wa["base64url_to_bytes"](str(rec["public_key"])),
                credential_current_sign_count=int(rec.get("sign_count") or 0),
                require_user_verification=True,
            )
        except PactError:
            raise
        except Exception as e:
            raise PactError(
                400,
                "webauthn_failed",
                "Could not unlock. Use the bound iPhone.",
            ) from e
        got_id = wa["bytes_to_base64url"](verification.credential_id)
        if got_id != rec.get("credential_id"):
            raise PactError(
                400,
                "webauthn_failed",
                "Could not unlock. Use the bound iPhone.",
            )
        rec["sign_count"] = int(verification.new_sign_count or rec.get("sign_count") or 0)
        global _pending
        _pending = None
        _write_atomic(_path(), rec)
        secret = bytes.fromhex(str(rec["session_secret"]))
        return mint_session(str(rec["credential_id"]), secret)


def reset_pending_for_tests() -> None:
    global _pending
    _pending = None
