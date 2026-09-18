"""Repo root + runtime data dir.

Laptop: ./data (gitignored).
VPS: TOOLKIT_DATA=/var/lib/toolkit so ProtectSystem=strict can keep /opt/toolkit read-only.
"""

from __future__ import annotations

import os
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def data_root() -> Path:
    raw = (os.environ.get("TOOLKIT_DATA") or "").strip()
    return Path(raw) if raw else ROOT / "data"
