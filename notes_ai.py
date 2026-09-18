"""Optional DeepSeek titles for Voice notes.

If DEEPSEEK_API_KEY is set, a transcript is titled after Whisper.
If the key is missing, callers keep the existing auto title — transcription
never depends on this.
"""

from __future__ import annotations

import json
import os
import re
import time
from typing import Any

import ai_usage
from ai.features import VOICE_NOTE_TITLE, is_on as feature_on
from ai.prompts import apply_system, apply_user_template, render_template

AI_MODULE = "voice"
AI_ACTION = "Note title"

DEFAULT_MODEL = "deepseek-v4-flash"
DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_TIMEOUT_SEC = 20.0
MAX_RETRIES = 1
MAX_TITLE_LEN = 120
MAX_TRANSCRIPT_CHARS = 6000

_PLACEHOLDER_RE = re.compile(
    r"^Note \d{4}-\d{2}-\d{2}(?:[ T]\d{2}:\d{2}(?::\d{2})?)?\s*$"
)

SYSTEM = """You write a short title for a personal voice memo.

Rules:
- 3 to 8 words
- Name the actual topic, not filler (um, okay, hello, mic check) unless that is all there is
- No quotes, no trailing period, no emoji, no prefix like "Title:"
- Same language as the transcript (English or Hindi)
- Output ONLY the title text
"""

USER_TEMPLATE = "Transcript:\n\n{transcript}"


def system_prompt() -> str:
    return apply_system(VOICE_NOTE_TITLE, SYSTEM)


class TitleError(Exception):
    def __init__(self, message: str, *, status: str = "error"):
        super().__init__(message)
        self.status = status


def _api_key() -> str:
    return (
        os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_KEY") or ""
    ).strip()


def is_enabled() -> bool:
    return bool(_api_key()) and feature_on(VOICE_NOTE_TITLE)


def _base_url() -> str:
    return (os.environ.get("DEEPSEEK_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _model() -> str:
    return (os.environ.get("DEEPSEEK_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _timeout() -> float:
    try:
        return float(os.environ.get("DEEPSEEK_TIMEOUT_SEC") or DEFAULT_TIMEOUT_SEC)
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


def status_payload() -> dict[str, Any]:
    key = bool(_api_key())
    return {
        "enabled": is_enabled(),
        "model": _model(),
        "base_url": _base_url(),
        "thinking": "disabled",
        "api_key_set": key,
        "feature_on": feature_on(VOICE_NOTE_TITLE),
    }


def is_placeholder_title(title: str) -> bool:
    t = (title or "").strip()
    if not t:
        return True
    return bool(_PLACEHOLDER_RE.match(t))


def default_title(created: str) -> str:
    stamp = (created or "")[:16].replace("T", " ")
    return f"Note {stamp}" if stamp else "Note"


def resolve_title(
    *,
    user_title: str = "",
    existing_title: str = "",
    existing_source: str | None = None,
    transcript: str = "",
    created: str = "",
) -> tuple[str, str]:
    """Pick (title, source) without failing the note if DeepSeek is off/down.

    source is user | ai | auto.
    """
    user = sanitize_title(user_title)
    if user:
        return user, "user"
    existing = (existing_title or "").strip()
    source = (existing_source or "").strip() or None
    if source == "user" and existing:
        return existing, "user"
    if existing and not is_placeholder_title(existing) and source != "ai":
        return existing, "user"
    generated = title_from_transcript(transcript) if (transcript or "").strip() else None
    if generated:
        return generated, "ai"
    if existing and not is_placeholder_title(existing):
        return existing, source or "auto"
    return default_title(created), "auto"


def sanitize_title(raw: str, *, max_len: int = MAX_TITLE_LEN) -> str:
    s = (raw or "").strip()
    if not s:
        return ""
    s = s.splitlines()[0].strip()
    s = s.strip(" \t\"'`“”‘’")
    s = re.sub(r"\s+", " ", s)
    if s.lower().startswith("title:"):
        s = s[6:].strip().strip("\"'`“”")
    s = s.rstrip(" .")
    if len(s) > max_len:
        s = s[: max_len - 1].rstrip() + "…"
    return s


def parse_title_from_model(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*```$", "", s)
        s = s.strip()
    if s.startswith("{"):
        try:
            data = json.loads(s)
            if isinstance(data, dict) and data.get("title"):
                s = str(data.get("title"))
        except json.JSONDecodeError:
            pass
    return sanitize_title(s)


def _clip_transcript(text: str) -> str:
    s = (text or "").strip()
    if len(s) <= MAX_TRANSCRIPT_CHARS:
        return s
    head = MAX_TRANSCRIPT_CHARS - 900
    return s[:head].rstrip() + "\n…\n" + s[-800:].lstrip()


def _user_prompt(transcript: str) -> str:
    tmpl = apply_user_template(VOICE_NOTE_TITLE, USER_TEMPLATE)
    return render_template(tmpl, {"transcript": _clip_transcript(transcript)})


def _call_deepseek(system: str, user: str) -> tuple[str, dict[str, Any]]:
    try:
        from openai import OpenAI
    except ImportError as e:
        raise TitleError(
            "Python package 'openai' is missing in the whisper venv. "
            "Run: ./whisper/.venv/bin/pip install openai",
            status="config",
        ) from e

    client = OpenAI(
        api_key=_api_key(),
        base_url=_base_url(),
        timeout=_timeout(),
    )
    model = _model()
    last_err: Exception | None = None

    for attempt in range(MAX_RETRIES + 1):
        t0 = time.perf_counter()
        try:
            response = client.chat.completions.create(
                model=model,
                messages=[
                    {"role": "system", "content": system},
                    {"role": "user", "content": user},
                ],
                stream=False,
                temperature=0.2,
                extra_body={"thinking": {"type": "disabled"}},
            )
            content = (response.choices[0].message.content or "").strip()
            usage = getattr(response, "usage", None)
            tok = ai_usage.extract_usage(usage)
            cost = ai_usage.estimate_cost_usd(
                model=model,
                prompt_tokens=tok["prompt_tokens"],
                completion_tokens=tok["completion_tokens"],
                cache_hit_tokens=tok["cache_hit_tokens"],
                cache_miss_tokens=tok["cache_miss_tokens"],
            )
            meta = {
                "model": model,
                "provider": "deepseek",
                "latency_sec": round(time.perf_counter() - t0, 3),
                "attempt": attempt + 1,
                "prompt_tokens": tok["prompt_tokens"],
                "completion_tokens": tok["completion_tokens"],
                "cache_hit_tokens": tok["cache_hit_tokens"],
                "cache_miss_tokens": tok["cache_miss_tokens"],
                "total_tokens": tok["total_tokens"],
                "cost_usd": cost,
                "action": AI_ACTION,
            }
            if not content:
                raise TitleError("Model returned empty content")
            return content, meta
        except TitleError:
            raise
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            if attempt < MAX_RETRIES and any(
                x in msg for x in ("timeout", "429", "rate", "503", "502", "connection")
            ):
                time.sleep(0.5 * (attempt + 1))
                continue
            raise TitleError(f"DeepSeek API error: {e}") from e

    raise TitleError(f"DeepSeek API error: {last_err}")


def title_from_transcript(transcript: str) -> str | None:
    """Return a short title, or None if disabled / failed / empty."""
    if not is_enabled():
        return None
    text = (transcript or "").strip()
    if not text:
        return None
    try:
        content, meta = _call_deepseek(system_prompt(), _user_prompt(text))
    except TitleError as e:
        ai_usage.log_call(
            module=AI_MODULE,
            action=AI_ACTION,
            model=_model(),
            provider="deepseek",
            ok=False,
            error=str(e),
        )
        return None

    title = parse_title_from_model(content)
    ai_usage.log_from_meta(meta, module=AI_MODULE, action=AI_ACTION, ok=True)
    return title or None
