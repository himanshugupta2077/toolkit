import json
import os
import tempfile
import unittest
from pathlib import Path


class PactAuthTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["TOOLKIT_DATA"] = self.tmp.name
        import pact.auth as auth
        import pact.store as store

        auth.reset_pending_for_tests()
        self.auth = auth
        self.store = store

    def tearDown(self) -> None:
        self.auth.reset_pending_for_tests()
        self.tmp.cleanup()

    def _write_reviewer(self, **extra):
        rec = {
            "bound": True,
            "user_id": "u" * 16,
            "credential_id": "cred-1",
            "public_key": "pk-1",
            "sign_count": 0,
            "bound_at": 1,
            "session_secret": os.urandom(32).hex(),
        }
        rec.update(extra)
        path = Path(self.tmp.name) / "pact" / "reviewer.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(rec), encoding="utf-8")
        return rec

    def test_session_roundtrip(self):
        secret = os.urandom(32)
        token = self.auth.mint_session("cred-1", secret, now=1_000_000)
        self.assertTrue(self.auth.session_ok(token, secret, "cred-1", now=1_000_001))
        self.assertFalse(self.auth.session_ok(token, secret, "other", now=1_000_001))
        self.assertFalse(self.auth.session_ok(token + "x", secret, "cred-1", now=1_000_001))
        self.assertFalse(self.auth.session_ok(None, secret, "cred-1", now=1_000_001))

    def test_session_expiry(self):
        secret = os.urandom(32)
        now = 1_000_000
        token = self.auth.mint_session("cred-1", secret, now=now)
        later = now + self.auth.SESSION_DAYS * 86400 + 2
        self.assertFalse(self.auth.session_ok(token, secret, "cred-1", now=later))

    def test_status_unbound(self):
        st = self.auth.status(None)
        self.assertFalse(st["bound"])
        self.assertFalse(st["unlocked"])

    def test_status_bound_locked(self):
        self._write_reviewer()
        st = self.auth.status(None)
        self.assertTrue(st["bound"])
        self.assertFalse(st["unlocked"])

    def test_status_bound_unlocked(self):
        rec = self._write_reviewer()
        secret = bytes.fromhex(rec["session_secret"])
        token = self.auth.mint_session(rec["credential_id"], secret)
        st = self.auth.status(token)
        self.assertTrue(st["bound"])
        self.assertTrue(st["unlocked"])

    def test_require_session(self):
        rec = self._write_reviewer()
        with self.assertRaises(self.store.PactError) as ctx:
            self.auth.require_session(None)
        self.assertEqual(ctx.exception.error, "reviewer_required")
        self.assertEqual(ctx.exception.status, 401)
        secret = bytes.fromhex(rec["session_secret"])
        token = self.auth.mint_session(rec["credential_id"], secret)
        out = self.auth.require_session(token)
        self.assertEqual(out["credential_id"], "cred-1")

    def test_require_session_not_bound(self):
        with self.assertRaises(self.store.PactError) as ctx:
            self.auth.require_session("nope")
        self.assertEqual(ctx.exception.error, "not_bound")

    def test_iphone_only(self):
        self.assertTrue(self.auth.is_iphone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0)"))
        self.assertFalse(self.auth.is_iphone("Mozilla/5.0 (Linux; Android 14)"))
        self.assertFalse(self.auth.is_iphone("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)"))
        with self.assertRaises(self.store.PactError) as ctx:
            self.auth.require_iphone("Mozilla/5.0 (X11; Linux x86_64)")
        self.assertEqual(ctx.exception.error, "iphone_only")
        self.auth.require_iphone("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)")

    def test_rp_id_and_origin(self):
        self.assertEqual(self.auth.rp_id("toolkit.tailf7a628.ts.net"), "toolkit.tailf7a628.ts.net")
        self.assertEqual(self.auth.rp_id("127.0.0.1:8000"), "127.0.0.1")
        origin = self.auth.origin("toolkit.tailf7a628.ts.net", "http", "http")
        self.assertEqual(origin, "https://toolkit.tailf7a628.ts.net")
        params = self.auth.cookie_params("toolkit.tailf7a628.ts.net", "http", None)
        self.assertTrue(params["secure"])
        self.assertTrue(params["httponly"])
        self.assertEqual(params["samesite"], "lax")
        self.assertEqual(params["path"], "/")

    def test_begin_register_already_bound(self):
        self._write_reviewer()
        with self.assertRaises(self.store.PactError) as ctx:
            self.auth.begin_register("toolkit.tailf7a628.ts.net", "https://toolkit.tailf7a628.ts.net")
        self.assertEqual(ctx.exception.error, "already_bound")

    def test_begin_assert_not_bound(self):
        with self.assertRaises(self.store.PactError) as ctx:
            self.auth.begin_assert("toolkit.tailf7a628.ts.net")
        self.assertEqual(ctx.exception.error, "not_bound")

    def test_reviewer_file_under_data_root(self):
        rec = self._write_reviewer()
        path = Path(self.tmp.name) / "pact" / "reviewer.json"
        self.assertTrue(path.is_file())
        self.assertTrue(rec["bound"])


if __name__ == "__main__":
    unittest.main()
