import os
import tempfile
import unittest
from datetime import date
from pathlib import Path


class CfaStoreTest(unittest.TestCase):
    def setUp(self) -> None:
        self.tmp = tempfile.TemporaryDirectory()
        os.environ["TOOLKIT_DATA"] = self.tmp.name
        import importlib
        import cfa.store as store

        importlib.reload(store)
        self.store = store
        self.today = date(2026, 9, 15)

    def tearDown(self) -> None:
        self.tmp.cleanup()

    def _state(self, **kwargs):
        state = self.store._default_state(self.today)
        state.update(kwargs)
        if "readings" not in kwargs:
            state["readings"] = [
                self.store._blank_reading(
                    i, self.today, complete_through=self.store.SEED_COMPLETE_THROUGH
                )
                for i in range(1, self.store.READING_COUNT + 1)
            ]
        return self.store._normalize_state(state, self.today)

    def test_page_table_complete(self):
        self.assertEqual(len(self.store.READING_PAGES), self.store.READING_COUNT + 1)
        self.assertEqual(self.store.READING_PAGES[1], 14)
        self.assertEqual(self.store.READING_PAGES[15], 9)
        self.assertEqual(self.store.READING_PAGES[27], 9)
        self.assertEqual(self.store.READING_PAGES[28], 30)
        self.assertEqual(self.store.READING_PAGES[47], 5)
        self.assertEqual(self.store.READING_PAGES[93], 9)

    def test_default_completes_through_15(self):
        state = self.store._default_state(self.today)
        done = [r for r in state["readings"] if r["page"] >= r["pages"]]
        left = [r for r in state["readings"] if r["page"] < r["pages"]]
        self.assertEqual([r["n"] for r in done], list(range(1, 16)))
        self.assertEqual(left[0]["n"], 16)
        self.assertEqual(left[0]["page"], 0)
        self.assertEqual(left[0]["pages"], 7)

    def test_migrate_old_chapters_marks_1_to_15(self):
        raw = {
            "planVersion": 3,
            "startedOn": "2026-08-16",
            "revisionStart": "2026-10-24",
            "chapters": [
                {
                    "id": "c001",
                    "n": 1,
                    "progress": 100,
                    "completedOn": "2026-08-23",
                    "updatedOn": "2026-08-23",
                },
                {"id": "c008", "n": 8, "progress": 0},
                {"id": "c016", "n": 16, "progress": 0},
            ],
            "offDays": [{"date": "2026-11-10", "reason": ""}],
        }
        state = self.store._normalize_state(raw, self.today)
        self.assertEqual(state["planVersion"], 5)
        self.assertEqual(state["readings"][0]["id"], "r001")
        self.assertEqual(state["readings"][0]["page"], 14)
        self.assertEqual(state["readings"][0]["completedOn"], "2026-08-23")
        self.assertEqual(state["readings"][7]["page"], 18)
        self.assertEqual(state["readings"][15]["page"], 0)
        self.assertEqual(state["readings"][15]["pages"], 7)
        self.assertEqual(state["offDays"][0]["date"], "2026-11-10")
        self.assertEqual(state["pagesPerHour"], 5.0)
        self.assertEqual(state["weekdayHours"], 3.0)
        self.assertEqual(state["weekendHours"], 6.0)

    def test_revision_window_excludes_exam_day(self):
        state = self._state(revisionStart="2026-10-24")
        stats = self.store.compute_stats(state, self.today)
        self.assertEqual(stats["examDate"], "2026-11-17")
        self.assertEqual(stats["revisionStart"], "2026-10-24")
        self.assertEqual(stats["revisionEnd"], "2026-11-16")
        self.assertEqual(stats["revisionDays"], 24)
        self.assertEqual(stats["prepEnd"], "2026-10-23")
        plan = self.store.compute_plan(state, self.today)
        by_date = {d["date"]: d for d in plan}
        self.assertEqual(by_date["2026-11-16"]["kind"], "revision")
        self.assertEqual(by_date["2026-11-17"]["kind"], "exam")
        self.assertEqual(by_date["2026-11-17"]["items"], [])
        self.assertTrue(all(d["kind"] != "revision" or d["date"] < "2026-11-17" for d in plan))

    def test_weekday_weekend_page_capacity(self):
        state = self._state()
        tue = date(2026, 9, 15)
        sat = date(2026, 9, 19)
        self.assertEqual(tue.weekday(), 1)
        self.assertEqual(sat.weekday(), 5)
        self.assertEqual(self.store._day_capacity(tue, state), 15)
        self.assertEqual(self.store._day_capacity(sat, state), 30)
        self.assertEqual(self.store._day_hours(tue, state), 3.0)
        self.assertEqual(self.store._day_hours(sat, state), 6.0)

    def test_plan_fills_pages_not_equal_chapters(self):
        state = self._state()
        plan = self.store.compute_plan(state, self.today)
        first = next(d for d in plan if d["kind"] == "prep")
        self.assertEqual(first["date"], "2026-09-15")
        self.assertEqual(first["capacity"], 15)
        self.assertEqual(first["pages"], 15)
        # Reading 16 (7) + 17 (7) + first page of 18
        self.assertEqual(
            [(it["n"], it["pagesFrom"], it["pagesTo"]) for it in first["items"]],
            [(16, 1, 7), (17, 1, 7), (18, 1, 1)],
        )
        sat = next(d for d in plan if d["date"] == "2026-09-19")
        self.assertEqual(sat["kind"], "prep")
        self.assertEqual(sat["capacity"], 30)
        self.assertEqual(sat["pages"], 30)

    def test_excluded_days_are_skipped(self):
        state = self._state(offDays=[{"date": "2026-09-15", "reason": ""}])
        plan = self.store.compute_plan(state, self.today)
        by_date = {d["date"]: d for d in plan}
        self.assertEqual(by_date["2026-09-15"]["kind"], "off")
        self.assertEqual(by_date["2026-09-15"]["items"], [])
        wed = by_date["2026-09-16"]
        self.assertEqual(wed["kind"], "prep")
        self.assertEqual(
            [(it["n"], it["pagesFrom"], it["pagesTo"]) for it in wed["items"]],
            [(16, 1, 7), (17, 1, 7), (18, 1, 1)],
        )

    def test_partial_page_progress_continues(self):
        state = self._state()
        state["readings"][15]["page"] = 4  # reading 16, 7 pages, 4 done
        state["readings"][15]["progress"] = 57
        plan = self.store.compute_plan(state, self.today)
        first = next(d for d in plan if d["kind"] == "prep")
        self.assertEqual(first["items"][0]["n"], 16)
        self.assertEqual(first["items"][0]["pagesFrom"], 5)
        self.assertEqual(first["items"][0]["pagesTo"], 7)

    def test_custom_pace(self):
        state = self._state(pagesPerHour=4, weekdayHours=2, weekendHours=5)
        tue = date(2026, 9, 15)
        sat = date(2026, 9, 19)
        self.assertEqual(self.store._day_capacity(tue, state), 8)
        self.assertEqual(self.store._day_capacity(sat, state), 20)
        plan = self.store.compute_plan(state, self.today)
        first = next(d for d in plan if d["kind"] == "prep")
        self.assertEqual(first["pages"], 8)

    def test_infeasible_pace_does_not_dump_on_last_day(self):
        state = self._state(pagesPerHour=1, weekdayHours=1, weekendHours=1)
        stats = self.store.compute_stats(state, self.today)
        self.assertFalse(stats["feasible"])
        self.assertIsNone(stats["finishOn"])
        self.assertGreater(stats["unscheduledPages"], 0)
        self.assertGreater(stats["suggestPagesPerHour"] or 0, 1)
        plan = self.store.compute_plan(state, self.today)
        prep = [d for d in plan if d["kind"] == "prep"]
        last = prep[-1]
        self.assertEqual(last["date"], "2026-10-27")
        self.assertLessEqual(last["pages"], last["capacity"])
        remaining = self.store._remaining_pages(state["readings"])
        scheduled = sum(d["pages"] for d in prep)
        self.assertEqual(scheduled + stats["unscheduledPages"], remaining)
        self.assertLess(scheduled, remaining)

    def test_feasible_pace_reports_finish_date(self):
        state = self._state(pagesPerHour=5, weekdayHours=3, weekendHours=6)
        stats = self.store.compute_stats(state, self.today)
        self.assertTrue(stats["feasible"])
        self.assertIsNotNone(stats["finishOn"])
        self.assertLess(stats["finishOn"], stats["revisionStart"])
        self.assertEqual(stats["unscheduledPages"], 0)
        plan = self.store.compute_plan(state, self.today)
        last_work = [d for d in plan if d["kind"] == "prep" and d["pages"]][-1]
        self.assertEqual(last_work["date"], stats["finishOn"])
        self.assertLessEqual(last_work["pages"], last_work["capacity"])

    def test_slow_realistic_hours_are_infeasible(self):
        state = self._state(pagesPerHour=1, weekdayHours=3, weekendHours=6)
        outlook = self.store.compute_pace_outlook(state, self.today)
        self.assertFalse(outlook["feasible"])
        self.assertGreater(outlook["unscheduledPages"], 50)
        self.assertGreaterEqual(outlook["suggestPagesPerHour"], 4.5)

    def test_revision_start_cannot_be_exam_day(self):
        state = self.store._normalize_state({"revisionStart": "2026-11-17"}, self.today)
        self.assertLessEqual(state["revisionStart"], "2026-11-16")

    def test_books_metadata(self):
        state = self._state()
        books = self.store._book_summaries(state["readings"])
        self.assertEqual(books[0]["from"], 1)
        self.assertEqual(books[0]["to"], 26)
        self.assertEqual(books[0]["done"], 15)
        self.assertEqual(books[1]["from"], 27)
        self.assertEqual(books[3]["to"], 93)

    def test_v4_picks_up_new_page_table(self):
        raw = {
            "planVersion": 4,
            "readings": [
                {"n": 16, "pages": 7, "page": 0},
                {"n": 27, "pages": 1, "page": 0},
                {"n": 47, "pages": 1, "page": 0},
            ],
        }
        state = self.store._normalize_state(raw, self.today)
        self.assertEqual(state["readings"][26]["pages"], 9)
        self.assertEqual(state["readings"][46]["pages"], 5)
        self.assertEqual(state["readings"][15]["pages"], 7)

    def test_custom_page_count_persists(self):
        saved = self.store.get_state()
        saved["readings"][15]["pages"] = 20
        saved["readings"][15]["page"] = 4
        again = self.store.save_state({"readings": saved["readings"]})
        self.assertEqual(again["planVersion"], 5)
        self.assertEqual(again["readings"][15]["pages"], 20)
        self.assertEqual(again["readings"][15]["page"], 4)
        loaded = self.store.get_state()
        self.assertEqual(loaded["readings"][15]["pages"], 20)
        self.assertEqual(loaded["readings"][15]["page"], 4)

    def test_save_roundtrip_pace(self):
        saved = self.store.save_state(
            {
                "pagesPerHour": 6,
                "weekdayHours": 2.5,
                "weekendHours": 7,
            }
        )
        self.assertEqual(saved["pagesPerHour"], 6.0)
        self.assertEqual(saved["weekdayHours"], 2.5)
        self.assertEqual(saved["weekendHours"], 7.0)
        path = Path(self.tmp.name) / "cfa" / "state.json"
        self.assertTrue(path.is_file())
        loaded = self.store.get_state()
        self.assertEqual(loaded["pagesPerHour"], 6.0)
        self.assertEqual(loaded["readings"][14]["page"], loaded["readings"][14]["pages"])
        self.assertEqual(loaded["readings"][15]["page"], 0)

    def test_no_prep_assignments_on_revision_days(self):
        state = self._state()
        plan = self.store.compute_plan(state, self.today)
        for day in plan:
            if day["kind"] in {"revision", "exam", "off"}:
                self.assertEqual(day["items"], [])


if __name__ == "__main__":
    unittest.main()
