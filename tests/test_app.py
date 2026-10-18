import unittest

from app import MusicStats, STATS_FILE


class MusicStatsTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.stats = MusicStats(STATS_FILE)

    def test_import_counts_match_media_monkey_export(self):
        self.assertEqual(self.stats.summary["tracks"], 9961)
        self.assertEqual(self.stats.summary["plays"], 95953)
        self.assertEqual(self.stats.summary["albums"], 629)
        self.assertEqual(self.stats.summary["genres"], 375)

    def test_list_queries_support_time_sorting_and_pagination(self):
        result = self.stats.query(
            "artists",
            sort="listening_ms",
            order="desc",
            page=1,
            page_size=3,
        )
        self.assertEqual(result["page_size"], 3)
        self.assertEqual(result["items"][0]["name"], "John Williams")
        self.assertGreaterEqual(
            result["items"][0]["listening_ms"],
            result["items"][1]["listening_ms"],
        )

    def test_track_time_is_length_times_play_counter(self):
        docks = max(
            (
                song
                for song in self.stats.songs
                if song["artist"] == "Matt Uelmen" and song["title"] == "Docks"
            ),
            key=lambda song: song["plays"],
        )
        self.assertEqual(docks["plays"], 176)
        self.assertEqual(docks["listening_ms"], docks["length_ms"] * docks["plays"])

    def test_dashboard_contains_catalog_date_warning(self):
        self.assertIn("not a timestamp", self.stats.metadata()["date_note"])
        self.assertTrue(self.stats.dashboard()["years"])


if __name__ == "__main__":
    unittest.main()
