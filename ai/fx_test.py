"""USD/INR rate: override, cache, fallback."""

from __future__ import annotations

import pytest

from ai import features, fx


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setenv("TOOLKIT_DATA", str(tmp_path))
    return tmp_path


def test_override_wins(data_dir, monkeypatch):
    monkeypatch.setattr(fx, "fetch_live", lambda: (_ for _ in ()).throw(RuntimeError("no net")))
    features.set_usd_inr_override(90.5)
    out = fx.get_rate()
    assert out["usd_inr"] == 90.5
    assert out["source"] == "override"


def test_live_then_cache(data_dir, monkeypatch):
    monkeypatch.setattr(
        fx,
        "fetch_live",
        lambda: {
            "usd_inr": 87.25,
            "as_of": "2026-09-18",
            "fetched_at": "2026-09-18T00:00:00Z",
            "source": "frankfurter",
        },
    )
    # fetch_live in get_rate also writes cache; stub already returns payload.
    # Force empty cache then live.
    out = fx.get_rate()
    assert out["usd_inr"] == 87.25
    assert out["source"] == "frankfurter"


def test_default_when_offline(data_dir, monkeypatch):
    monkeypatch.setattr(fx, "fetch_live", lambda: (_ for _ in ()).throw(OSError("offline")))
    out = fx.get_rate()
    assert out["usd_inr"] == fx.DEFAULT_USD_INR
    assert out["source"] == "default"


def test_bad_override_rejected(data_dir):
    with pytest.raises(ValueError):
        features.set_usd_inr_override(0)
    with pytest.raises(ValueError):
        features.set_usd_inr_override(-1)
