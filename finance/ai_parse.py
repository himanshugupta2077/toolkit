"""
Voice/text/image → structured Ledger entry via DeepSeek (OpenAI-compatible API).

- Model: deepseek-v4-flash (thinking disabled for speed/cost)
- Surgical: only produces entry dicts; writing goes through sync.add_entry
- Docs: finance/ai_docs/*.md loaded as system context
- Receipts: multimodal image_url when supported; OCR (tesseract) fallback
"""

from __future__ import annotations

import base64
import json
import os
import re
import shutil
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any

from finance import sync as finance_sync

# Shared usage log lives at repo root (also used by future AI modules)
import sys as _sys

_REPO_ROOT = Path(__file__).resolve().parent.parent
if str(_REPO_ROOT) not in _sys.path:
    _sys.path.insert(0, str(_REPO_ROOT))
import ai_usage  # noqa: E402

AI_DOCS_DIR = Path(__file__).resolve().parent / "ai_docs"
# Module tag for shared AI usage log (phone AI status view)
AI_MODULE = "finance"
AI_ACTION = "Ledger update"
AI_ACTION_RECEIPT = "Receipt ledger"
DOC_FILES = (
    "SHEET_OVERVIEW.md",
    "PARSE_TASK.md",
    "EXAMPLES.md",
)
IMAGE_DOC_FILES = (
    "SHEET_OVERVIEW.md",
    "PARSE_TASK.md",
    "IMAGE_PARSE.md",
    "IMAGE_EXAMPLES.md",
)

DEFAULT_MODEL = "deepseek-v4-flash"
DEFAULT_BASE_URL = "https://api.deepseek.com"
DEFAULT_TIMEOUT_SEC = 60.0
MAX_RETRIES = 2
# Receipt uploads
MAX_RECEIPT_IMAGES = 8
MAX_IMAGE_BYTES = 8 * 1024 * 1024  # per image, before compress
MAX_TOTAL_IMAGE_BYTES = 24 * 1024 * 1024
# OpenAI-compatible vision: max edge ~1280 keeps tokens down
RECEIPT_MAX_EDGE = 1280

# Cache docs + mtime so edits hot-reload without restart thrash
_docs_cache: str | None = None
_docs_mtimes: tuple[float, ...] | None = None
_image_docs_cache: str | None = None
_image_docs_mtimes: tuple[float, ...] | None = None


class AIParseError(Exception):
    """User-visible parse/API failure."""

    def __init__(self, message: str, *, status: str = "error"):
        super().__init__(message)
        self.status = status


def _api_key() -> str:
    key = (
        os.environ.get("DEEPSEEK_API_KEY")
        or os.environ.get("DEEPSEEK_KEY")
        or ""
    ).strip()
    if not key:
        raise AIParseError(
            "DEEPSEEK_API_KEY is not set. Export it before using Update Ledger.",
            status="config",
        )
    return key


def _base_url() -> str:
    return (os.environ.get("DEEPSEEK_BASE_URL") or DEFAULT_BASE_URL).rstrip("/")


def _model() -> str:
    return (os.environ.get("DEEPSEEK_MODEL") or DEFAULT_MODEL).strip() or DEFAULT_MODEL


def _timeout() -> float:
    try:
        return float(os.environ.get("DEEPSEEK_TIMEOUT_SEC") or DEFAULT_TIMEOUT_SEC)
    except ValueError:
        return DEFAULT_TIMEOUT_SEC


def _doc_mtimes(names: tuple[str, ...]) -> tuple[float, ...]:
    out: list[float] = []
    for name in names:
        p = AI_DOCS_DIR / name
        try:
            out.append(p.stat().st_mtime if p.is_file() else 0.0)
        except OSError:
            out.append(0.0)
    return tuple(out)


def _load_docs(
    names: tuple[str, ...],
    *,
    fallback: str,
) -> str:
    parts: list[str] = []
    for name in names:
        p = AI_DOCS_DIR / name
        if not p.is_file():
            continue
        try:
            text = p.read_text(encoding="utf-8").strip()
        except OSError:
            continue
        if text:
            parts.append(f"### {name}\n\n{text}")
    if not parts:
        parts.append(fallback)
    return "\n\n---\n\n".join(parts)


def load_system_docs(*, force: bool = False) -> str:
    """Load AI reference docs (cached; reloads when files change)."""
    global _docs_cache, _docs_mtimes
    mtimes = _doc_mtimes(DOC_FILES)
    if not force and _docs_cache is not None and _docs_mtimes == mtimes:
        return _docs_cache

    _docs_cache = _load_docs(
        DOC_FILES,
        fallback=(
            "You extract finance Ledger JSON from speech. "
            "Return only valid JSON with an entries array."
        ),
    )
    _docs_mtimes = mtimes
    return _docs_cache


def load_image_system_docs(*, force: bool = False) -> str:
    """Docs for receipt / screenshot parsing (includes IMAGE_PARSE)."""
    global _image_docs_cache, _image_docs_mtimes
    mtimes = _doc_mtimes(IMAGE_DOC_FILES)
    if (
        not force
        and _image_docs_cache is not None
        and _image_docs_mtimes == mtimes
    ):
        return _image_docs_cache

    _image_docs_cache = _load_docs(
        IMAGE_DOC_FILES,
        fallback=(
            "You extract exactly one finance Ledger JSON entry from "
            "receipt screenshots and an optional user note. "
            "Return only valid JSON with an entries array of length 0 or 1."
        ),
    )
    _image_docs_mtimes = mtimes
    return _image_docs_cache


def build_user_prompt(
    transcript: str,
    *,
    types: list[str],
    categories: list[str],
    accounts: list[str],
    today: str,
    timezone: str,
) -> str:
    return (
        f"Today (local): {today}\n"
        f"Timezone: {timezone}\n\n"
        f"ALLOWED TYPES:\n{json.dumps(types, ensure_ascii=False)}\n\n"
        f"ALLOWED CATEGORIES:\n{json.dumps(categories, ensure_ascii=False)}\n\n"
        f"ALLOWED ACCOUNTS:\n{json.dumps(accounts, ensure_ascii=False)}\n\n"
        f"TRANSCRIPT:\n{transcript.strip()}\n\n"
        "Return ONLY the JSON object described in PARSE_TASK.md."
    )


def build_receipt_text_prompt(
    *,
    note: str,
    ocr_blocks: list[str],
    types: list[str],
    categories: list[str],
    accounts: list[str],
    today: str,
    timezone: str,
    image_count: int,
) -> str:
    ocr_section = ""
    if ocr_blocks:
        parts = []
        for i, block in enumerate(ocr_blocks, 1):
            parts.append(f"--- image {i} OCR ---\n{block.strip()}")
        ocr_section = "\n\nOCR TEXT (noisy):\n" + "\n\n".join(parts)
    note_s = (note or "").strip() or "(none)"
    return (
        f"Today (local): {today}\n"
        f"Timezone: {timezone}\n"
        f"Images attached: {image_count}\n\n"
        f"ALLOWED TYPES:\n{json.dumps(types, ensure_ascii=False)}\n\n"
        f"ALLOWED CATEGORIES:\n{json.dumps(categories, ensure_ascii=False)}\n\n"
        f"ALLOWED ACCOUNTS:\n{json.dumps(accounts, ensure_ascii=False)}\n\n"
        f"USER NOTE (typed and/or voice):\n{note_s}\n"
        f"{ocr_section}\n\n"
        "Return ONLY the JSON object from IMAGE_PARSE.md. "
        "Exactly one entry max — multiple images are the same purchase."
    )


def _receipt_mode() -> str:
    """auto | vision | ocr — how to send receipt images to the model."""
    mode = (os.environ.get("DEEPSEEK_RECEIPT_MODE") or "auto").strip().lower()
    if mode in {"auto", "vision", "ocr"}:
        return mode
    return "auto"


def _sniff_image_mime(data: bytes, filename: str = "", content_type: str = "") -> str:
    ct = (content_type or "").split(";")[0].strip().lower()
    if ct in {"image/jpeg", "image/jpg", "image/png", "image/webp", "image/gif"}:
        return "image/jpeg" if ct == "image/jpg" else ct
    if data[:3] == b"\xff\xd8\xff":
        return "image/jpeg"
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "image/png"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "image/webp"
    if data[:6] in (b"GIF87a", b"GIF89a"):
        return "image/gif"
    ext = Path(filename or "").suffix.lower()
    return {
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".png": "image/png",
        ".webp": "image/webp",
        ".gif": "image/gif",
        ".heic": "image/jpeg",
        ".heif": "image/jpeg",
    }.get(ext, "image/jpeg")


def _image_suffix(mime: str, filename: str = "") -> str:
    ext = Path(filename or "").suffix.lower()
    if ext in {".jpg", ".jpeg", ".png", ".webp", ".gif", ".heic", ".heif", ".bmp"}:
        return ext if ext != ".jpeg" else ".jpg"
    return {
        "image/png": ".png",
        "image/webp": ".webp",
        "image/gif": ".gif",
        "image/bmp": ".bmp",
    }.get(mime, ".jpg")


def _normalize_image_bytes(
    data: bytes,
    mime: str,
    *,
    filename: str = "",
) -> tuple[bytes, str]:
    """
    Convert to JPEG + optional downscale via ffmpeg.
    Improves OCR and multimodal compatibility (HEIC/WebP/PNG screenshots).
    """
    if not data:
        return data, mime
    if not shutil.which("ffmpeg"):
        return data, mime

    # Already small JPEG — leave as-is
    if mime == "image/jpeg" and len(data) < 120_000:
        return data, mime

    suffix = _image_suffix(mime, filename)
    src = dest = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            src = f.name
        dest = src + ".out.jpg"
        cmd = [
            "ffmpeg",
            "-y",
            "-hide_banner",
            "-loglevel",
            "error",
            "-i",
            src,
            "-vf",
            f"scale='min({RECEIPT_MAX_EDGE},iw)':-2",
            "-q:v",
            "3",
            dest,
        ]
        subprocess.run(cmd, check=True, capture_output=True, timeout=60)
        out = Path(dest).read_bytes()
        if out and out[:3] == b"\xff\xd8\xff":
            return out, "image/jpeg"
    except Exception:
        pass
    finally:
        for p in (src, dest):
            if p:
                try:
                    os.unlink(p)
                except OSError:
                    pass
    return data, mime


def _tessdata_dir() -> str | None:
    """Project eng pack wins; else None (system default)."""
    local = _REPO_ROOT / "data" / "tessdata"
    if (local / "eng.traineddata").is_file():
        return str(local)
    return None


def _ocr_image_bytes(data: bytes, mime: str) -> str:
    """OCR one image with system tesseract (best-effort). Note is never required."""
    if not data or not shutil.which("tesseract"):
        return ""
    # Prefer JPEG for tesseract reliability
    data, mime = _normalize_image_bytes(data, mime)
    suffix = _image_suffix(mime)
    path = None
    try:
        with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as f:
            f.write(data)
            path = f.name
        tessdir = _tessdata_dir()
        base = ["tesseract", path, "stdout", "--psm", "6"]
        if tessdir:
            base.extend(["--tessdata-dir", tessdir])
        # eng first when project pack present
        langs = ["eng"] if tessdir else ["eng", "afr", "osd"]
        for lang in langs:
            cmd = base + ["-l", lang]
            try:
                r = subprocess.run(
                    cmd,
                    capture_output=True,
                    text=True,
                    timeout=60,
                )
            except (subprocess.TimeoutExpired, OSError):
                continue
            if r.returncode == 0 and (r.stdout or "").strip():
                return r.stdout.strip()
        # Last try: no -l (system default)
        try:
            cmd = ["tesseract", path, "stdout", "--psm", "6"]
            if tessdir:
                cmd.extend(["--tessdata-dir", tessdir, "-l", "eng"])
            r = subprocess.run(cmd, capture_output=True, text=True, timeout=60)
            if r.returncode == 0:
                return (r.stdout or "").strip()
        except (subprocess.TimeoutExpired, OSError):
            pass
        return ""
    except Exception:
        return ""
    finally:
        if path:
            try:
                os.unlink(path)
            except OSError:
                pass


def prepare_receipt_images(
    images: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """
    Normalize uploaded images.

    Each item: {data: bytes, filename?: str, content_type?: str}
    Returns: [{data, mime, filename, ocr}]
    """
    if not images:
        raise AIParseError("At least one image is required", status="empty")
    if len(images) > MAX_RECEIPT_IMAGES:
        raise AIParseError(
            f"Too many images (max {MAX_RECEIPT_IMAGES})",
            status="validation",
        )

    prepared: list[dict[str, Any]] = []
    total = 0
    for i, item in enumerate(images):
        raw = item.get("data") or b""
        if not isinstance(raw, (bytes, bytearray)):
            raise AIParseError(f"Image {i + 1} is not binary data", status="validation")
        raw = bytes(raw)
        if not raw:
            raise AIParseError(f"Image {i + 1} is empty", status="empty")
        if len(raw) > MAX_IMAGE_BYTES:
            raise AIParseError(
                f"Image {i + 1} is larger than {MAX_IMAGE_BYTES // (1024 * 1024)}MB",
                status="validation",
            )
        total += len(raw)
        if total > MAX_TOTAL_IMAGE_BYTES:
            raise AIParseError("Images total size is too large", status="validation")
        fname = str(item.get("filename") or f"image{i + 1}")
        mime = _sniff_image_mime(
            raw,
            filename=fname,
            content_type=str(item.get("content_type") or ""),
        )
        data, mime = _normalize_image_bytes(raw, mime, filename=fname)
        prepared.append(
            {
                "data": data,
                "mime": mime,
                "filename": fname,
                "ocr": "",
            }
        )
    return prepared


def _strip_code_fences(text: str) -> str:
    s = (text or "").strip()
    if s.startswith("```"):
        s = re.sub(r"^```(?:json)?\s*", "", s, flags=re.IGNORECASE)
        s = re.sub(r"\s*```$", "", s)
    return s.strip()


def _extract_json_object(text: str) -> dict[str, Any]:
    s = _strip_code_fences(text)
    try:
        data = json.loads(s)
        if isinstance(data, dict):
            return data
        if isinstance(data, list):
            return {"entries": data, "confidence": "medium", "raw_summary": ""}
    except json.JSONDecodeError:
        pass

    # Last resort: first {...} block
    start = s.find("{")
    end = s.rfind("}")
    if start >= 0 and end > start:
        try:
            data = json.loads(s[start : end + 1])
            if isinstance(data, dict):
                return data
        except json.JSONDecodeError as e:
            raise AIParseError(f"Model returned invalid JSON: {e}") from e
    raise AIParseError("Model returned no JSON object")


def _is_vision_unsupported_error(exc: BaseException) -> bool:
    msg = str(exc).lower()
    needles = (
        "image_url",
        "image input",
        "multimodal",
        "vision",
        "does not support",
        "not support image",
        "unsupported content",
        "invalid content",
        "unknown variant",
        "content type",
        "only text",
        "text-only",
        "invalid_request_error",
    )
    # Only treat as vision-unsupported when the message looks image-related
    imagey = any(
        x in msg
        for x in (
            "image",
            "vision",
            "multimodal",
            "image_url",
            "media",
            "content part",
            "content_part",
        )
    )
    if not imagey:
        return False
    return any(n in msg for n in needles) or "400" in msg


def _call_deepseek(
    system: str,
    user: str | list[dict[str, Any]],
    *,
    action: str = AI_ACTION,
) -> tuple[str, dict[str, Any]]:
    """
    Chat completion; thinking disabled. Returns (content, meta).

    `user` may be a plain string or OpenAI multimodal content parts list.
    """
    try:
        from openai import OpenAI
    except ImportError as e:
        raise AIParseError(
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
                temperature=0.1,
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
                "action": action,
            }
            if not content:
                raise AIParseError("Model returned empty content")
            return content, meta
        except AIParseError:
            raise
        except Exception as e:
            last_err = e
            msg = str(e).lower()
            # Let caller fall back to OCR on vision-unsupported endpoints
            if _is_vision_unsupported_error(e):
                raise AIParseError(
                    f"DeepSeek vision unsupported: {e}",
                    status="vision_unsupported",
                ) from e
            # Retry transient failures
            if attempt < MAX_RETRIES and any(
                x in msg for x in ("timeout", "429", "rate", "503", "502", "connection")
            ):
                time.sleep(0.6 * (attempt + 1))
                continue
            raise AIParseError(f"DeepSeek API error: {e}") from e

    raise AIParseError(f"DeepSeek API error: {last_err}")


def _b64_data_url(data: bytes, mime: str) -> str:
    b64 = base64.b64encode(data).decode("ascii")
    return f"data:{mime};base64,{b64}"


def _build_vision_user_content(
    *,
    text_prompt: str,
    prepared: list[dict[str, Any]],
) -> list[dict[str, Any]]:
    """OpenAI-compatible multimodal user content: images + text."""
    parts: list[dict[str, Any]] = []
    for img in prepared:
        parts.append(
            {
                "type": "image_url",
                "image_url": {
                    "url": _b64_data_url(img["data"], img["mime"]),
                },
            }
        )
    parts.append({"type": "text", "text": text_prompt})
    return parts


def _coerce_entry_raw(raw: dict[str, Any]) -> dict[str, Any]:
    """Map model fields → sync.add_entry payload (source set by caller)."""
    out: dict[str, Any] = {
        "amount": raw.get("amount"),
        "type": raw.get("type"),
        "category": raw.get("category"),
        "from_account": raw.get("from_account") or raw.get("fromAccount"),
        "to_account": raw.get("to_account") or raw.get("toAccount"),
        "include_in_budget": raw.get("include_in_budget", raw.get("includeInBudget")),
        "notes": raw.get("notes") or "",
    }
    date_v = raw.get("date")
    time_v = raw.get("time")
    if date_v and str(date_v).lower() not in {"null", "none", ""}:
        out["date"] = str(date_v).strip()
    if time_v and str(time_v).lower() not in {"null", "none", ""}:
        out["time"] = str(time_v).strip()
    return out


def parse_transcript(
    transcript: str,
    *,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Parse transcript into validated entry dicts (not yet written to sheet).

    Returns:
      {
        ok, entries: [normalized raw payloads], parsed, meta, error?
      }
    """
    text = (transcript or "").strip()
    if not text:
        raise AIParseError("Empty transcript", status="empty")

    opts = options or finance_sync.options_payload()
    types = list(opts.get("types") or finance_sync.TYPES)
    categories = list(opts.get("categories") or finance_sync.CATEGORIES)
    accounts = list(opts.get("accounts") or finance_sync.ACCOUNTS)
    today = str(opts.get("today") or finance_sync.today_iso())
    timezone = str(opts.get("timezone") or finance_sync.DEFAULT_TZ)

    system = (
        "You are a precise finance parser for a personal Indian Rupee ledger. "
        "Follow the documentation below exactly. Output ONLY valid JSON.\n\n"
        + load_system_docs()
    )
    user = build_user_prompt(
        text,
        types=types,
        categories=categories,
        accounts=accounts,
        today=today,
        timezone=timezone,
    )

    try:
        content, meta = _call_deepseek(system, user, action=AI_ACTION)
    except AIParseError as e:
        # Log failed API attempts so cost/status UI still shows them
        ai_usage.log_call(
            module=AI_MODULE,
            action=AI_ACTION,
            model=_model(),
            provider="deepseek",
            ok=False,
            error=str(e),
        )
        raise

    # Successful HTTP completion — always count tokens/cost (parse outcome separate)
    ai_usage.log_from_meta(meta, module=AI_MODULE, action=AI_ACTION, ok=True)

    return _finalize_parsed(
        content,
        meta,
        empty_error="No transactions found in speech",
        max_entries=None,
    )


def _finalize_parsed(
    content: str,
    meta: dict[str, Any],
    *,
    empty_error: str,
    max_entries: int | None,
) -> dict[str, Any]:
    parsed = _extract_json_object(content)

    entries_raw = parsed.get("entries")
    if entries_raw is None and any(k in parsed for k in ("amount", "type", "category")):
        entries_raw = [parsed]
    if not isinstance(entries_raw, list):
        raise AIParseError("JSON missing entries array")

    if parsed.get("error") and not entries_raw:
        return {
            "ok": False,
            "entries": [],
            "parsed": parsed,
            "meta": meta,
            "error": str(parsed.get("error")),
            "status": "no_entries",
        }

    if not entries_raw:
        return {
            "ok": False,
            "entries": [],
            "parsed": parsed,
            "meta": meta,
            "error": str(parsed.get("error") or empty_error),
            "status": "no_entries",
        }

    if max_entries is not None and len(entries_raw) > max_entries:
        entries_raw = entries_raw[:max_entries]
        parsed = dict(parsed)
        parsed["entries"] = entries_raw
        parsed["truncated"] = True

    payloads: list[dict[str, Any]] = []
    for i, item in enumerate(entries_raw):
        if not isinstance(item, dict):
            raise AIParseError(f"entries[{i}] is not an object")
        payloads.append(_coerce_entry_raw(item))

    return {
        "ok": True,
        "entries": payloads,
        "parsed": parsed,
        "meta": meta,
        "status": "parsed",
    }


def parse_receipt(
    images: list[dict[str, Any]],
    note: str = "",
    *,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Parse receipt/screenshot image(s) + optional note → validated entry payload(s).

    Note is always optional. Always at most **one** entry.
    Flow: OCR (best-effort) → multimodal DeepSeek; if vision unsupported → OCR/text.
    """
    prepared = prepare_receipt_images(images)
    note_text = (note or "").strip()  # optional — never required

    opts = options or finance_sync.options_payload()
    types = list(opts.get("types") or finance_sync.TYPES)
    categories = list(opts.get("categories") or finance_sync.CATEGORIES)
    accounts = list(opts.get("accounts") or finance_sync.ACCOUNTS)
    today = str(opts.get("today") or finance_sync.today_iso())
    timezone = str(opts.get("timezone") or finance_sync.DEFAULT_TZ)

    system = (
        "You are a precise finance parser for a personal Indian Rupee ledger. "
        "Follow the documentation below exactly. Output ONLY valid JSON. "
        "This request is a receipt/screenshot upload: return at most ONE entry. "
        "User note is optional — extract from the image(s) when the note is empty. "
        "For notes: always include the app/merchant if visible (Blinkit, Zepto, Amazon, "
        "Swiggy, Zomato, etc.) plus ordered/purchased item names when readable. "
        "Format: 'Merchant: item1, item2'. Never use vague notes like 'Grocery order'.\n\n"
        + load_image_system_docs()
    )

    mode = _receipt_mode()

    def _run_ocr_blocks() -> list[str]:
        blocks: list[str] = []
        for img in prepared:
            text = _ocr_image_bytes(img["data"], img["mime"])
            img["ocr"] = text
            if text:
                blocks.append(text)
        return blocks

    def _call_and_finalize(user: str | list[dict[str, Any]], *, path: str) -> dict[str, Any]:
        try:
            content, meta = _call_deepseek(
                system, user, action=AI_ACTION_RECEIPT
            )
        except AIParseError as e:
            ai_usage.log_call(
                module=AI_MODULE,
                action=AI_ACTION_RECEIPT,
                model=_model(),
                provider="deepseek",
                ok=False,
                error=str(e),
            )
            raise
        meta = dict(meta)
        meta["receipt_path"] = path
        meta["image_count"] = len(prepared)
        ai_usage.log_from_meta(
            meta, module=AI_MODULE, action=AI_ACTION_RECEIPT, ok=True
        )
        result = _finalize_parsed(
            content,
            meta,
            empty_error="No transaction found in the image",
            max_entries=1,
        )
        result["receipt_path"] = path
        return result

    # OCR always runs first (helps text fallback; optional hint for vision)
    ocr_blocks = _run_ocr_blocks()
    text_prompt = build_receipt_text_prompt(
        note=note_text,
        ocr_blocks=ocr_blocks,
        types=types,
        categories=categories,
        accounts=accounts,
        today=today,
        timezone=timezone,
        image_count=len(prepared),
    )

    # --- Vision path (images + optional note/OCR text) ---
    if mode in {"auto", "vision"}:
        vision_user = _build_vision_user_content(
            text_prompt=text_prompt, prepared=prepared
        )
        try:
            return _call_and_finalize(vision_user, path="vision")
        except AIParseError as e:
            if mode == "vision" or e.status != "vision_unsupported":
                raise
            # auto → OCR/text path below

    # --- Text path (OCR + optional note; note never required) ---
    if mode == "ocr" or mode == "auto":
        if not ocr_blocks and not note_text:
            # Images were present but unreadable — do not demand a note
            raise AIParseError(
                "Could not read text from the image. "
                "Try a clearer screenshot, or optionally add a short note with the amount.",
                status="empty",
            )
        return _call_and_finalize(text_prompt, path="ocr")

    raise AIParseError("Receipt parse failed", status="error")


def parse_and_save_receipt(
    images: list[dict[str, Any]],
    note: str = "",
    *,
    source: str = "ai",
    note_id: str | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Full path: receipt image(s) + note → append **one** Ledger row.
    Never rebuilds dashboards.
    """
    result = parse_receipt(images, note, options=options)
    if not result.get("ok"):
        return result

    snippet = (note or "").strip().replace("\n", " ")
    if len(snippet) > 120:
        snippet = snippet[:117] + "..."

    # Hard guarantee: single row per receipt request
    payloads = list(result.get("entries") or [])[:1]
    if not payloads:
        return {
            "ok": False,
            "entries": [],
            "parsed": result.get("parsed"),
            "meta": result.get("meta"),
            "error": "No entry to save",
            "status": "no_entries",
            "receipt_path": result.get("receipt_path"),
        }

    try:
        saved = apply_entries(
            payloads,
            source=source,
            note_id=note_id,
            transcript_snippet=snippet or None,
        )
    except ValueError as e:
        return {
            "ok": False,
            "entries": [],
            "parsed": result.get("parsed"),
            "meta": result.get("meta"),
            "error": str(e),
            "status": "validation",
            "receipt_path": result.get("receipt_path"),
        }

    return {
        "ok": True,
        "entries": saved,
        "parsed": result.get("parsed"),
        "meta": result.get("meta"),
        "status": "saved",
        "receipt_path": result.get("receipt_path"),
    }


def apply_entries(
    payloads: list[dict[str, Any]],
    *,
    source: str = "ai",
    note_id: str | None = None,
    transcript_snippet: str | None = None,
) -> list[dict[str, Any]]:
    """
    Write each payload via finance_sync.add_entry (JSONL + one Ledger row).
    source: 'ai' | 'manual'
    """
    saved: list[dict[str, Any]] = []
    for raw in payloads:
        body = dict(raw)
        body["source"] = source
        if note_id and not body.get("notes"):
            # keep empty notes ok; optional tag only if empty and we want linkage
            pass
        if note_id:
            body["note_id"] = note_id
        if transcript_snippet and source == "ai":
            # Prefer model notes; if empty, use short snippet
            if not str(body.get("notes") or "").strip():
                body["notes"] = transcript_snippet[:120]
        entry = finance_sync.add_entry(body)
        saved.append(entry)
    return saved


def parse_and_save(
    transcript: str,
    *,
    source: str = "ai",
    note_id: str | None = None,
    options: dict[str, Any] | None = None,
) -> dict[str, Any]:
    """
    Full path: parse transcript → append Ledger row(s).
    Never rebuilds dashboards.
    """
    result = parse_transcript(transcript, options=options)
    if not result.get("ok"):
        return result

    snippet = (transcript or "").strip().replace("\n", " ")
    if len(snippet) > 120:
        snippet = snippet[:117] + "..."

    try:
        saved = apply_entries(
            result["entries"],
            source=source,
            note_id=note_id,
            transcript_snippet=snippet,
        )
    except ValueError as e:
        return {
            "ok": False,
            "entries": [],
            "parsed": result.get("parsed"),
            "meta": result.get("meta"),
            "error": str(e),
            "status": "validation",
        }

    return {
        "ok": True,
        "entries": saved,
        "parsed": result.get("parsed"),
        "meta": result.get("meta"),
        "status": "saved",
    }


def status_payload() -> dict[str, Any]:
    """Health/config for UI (never exposes API key)."""
    key_set = bool(
        (os.environ.get("DEEPSEEK_API_KEY") or os.environ.get("DEEPSEEK_KEY") or "").strip()
    )
    docs_ok = all((AI_DOCS_DIR / n).is_file() for n in DOC_FILES)
    image_docs_ok = all((AI_DOCS_DIR / n).is_file() for n in IMAGE_DOC_FILES)
    return {
        "enabled": key_set,
        "model": _model(),
        "base_url": _base_url(),
        "thinking": "disabled",
        "docs_dir": str(AI_DOCS_DIR),
        "docs_loaded": docs_ok,
        "image_docs_loaded": image_docs_ok,
        "receipt_mode": _receipt_mode(),
        "tesseract": bool(shutil.which("tesseract")),
        "max_receipt_images": MAX_RECEIPT_IMAGES,
        "api_key_set": key_set,
    }
