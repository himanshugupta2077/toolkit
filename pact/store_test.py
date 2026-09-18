import os
import tempfile
import unittest
from pathlib import Path


class PactStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["TOOLKIT_DATA"] = self.tmp.name
        import pact.store as store

        self.store = store

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _create(self, **kwargs):
        body = {
            "device_id": "device-123456",
            "package_name": "com.instagram.android",
            "app_label": "Instagram",
            "minutes": 10,
            "comment": "Need to reply once",
        }
        body.update(kwargs)
        return self.store.create_request(body)

    def test_create_and_approve(self):
        created = self._create()
        self.assertEqual(created["status"], "pending")
        self.assertEqual(created["minutes"], 10)
        self.assertEqual(created["kind"], "app")
        self.assertEqual(created["target_id"], "com.instagram.android")
        approved = self.store.approve(created["id"])
        self.assertEqual(approved["status"], "approved")
        self.assertTrue(approved["live"])
        self.assertGreater(approved["expires_at_ms"], approved["decided_at_ms"])

    def test_minutes_cap(self):
        with self.assertRaises(self.store.PactError) as ctx:
            self._create(minutes=16)
        self.assertEqual(ctx.exception.error, "invalid_minutes")

    def test_comment_required(self):
        with self.assertRaises(self.store.PactError) as ctx:
            self._create(comment="   ")
        self.assertEqual(ctx.exception.error, "comment_required")

    def test_once_per_app_per_day(self):
        self._create()
        with self.assertRaises(self.store.PactError) as ctx:
            self._create(comment="again")
        self.assertEqual(ctx.exception.error, "already_requested_today")

    def test_other_app_same_day_ok(self):
        self._create()
        other = self._create(package_name="com.google.android.youtube", app_label="YouTube")
        self.assertEqual(other["status"], "pending")

    def test_settings_separate_from_app(self):
        self._create()
        settings = self._create(
            kind="settings",
            target_id="settings",
            package_name="pact.settings",
            app_label="Pact settings",
            comment="Need to change Instagram limit",
        )
        self.assertEqual(settings["kind"], "settings")
        self.assertEqual(settings["target_id"], "settings")

    def test_group_request(self):
        created = self._create(
            kind="group",
            target_id="abc-def-123",
            app_label="Social",
            comment="Need the group for 10",
        )
        self.assertEqual(created["kind"], "group")
        self.assertEqual(created["target_id"], "abc-def-123")
        self.assertEqual(created["package_name"], "group.abc-def-123")

    def test_approve_custom_minutes(self):
        created = self._create(minutes=5)
        approved = self.store.approve(created["id"], {"minutes": 30})
        self.assertEqual(approved["minutes"], 30)
        self.assertEqual(approved["requested_minutes"], 5)
        self.assertTrue(approved["live"])

    def test_approve_custom_minutes_cap(self):
        created = self._create()
        with self.assertRaises(self.store.PactError) as ctx:
            self.store.approve(created["id"], {"minutes": 241})
        self.assertEqual(ctx.exception.error, "invalid_minutes")

    def test_deny(self):
        created = self._create()
        denied = self.store.deny(created["id"])
        self.assertEqual(denied["status"], "denied")
        self.assertFalse(denied["live"])

    def test_writes_under_data_root(self):
        self._create()
        path = Path(self.tmp.name) / "pact" / "requests.json"
        self.assertTrue(path.is_file())


if __name__ == "__main__":
    unittest.main()
