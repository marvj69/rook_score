import importlib.util
import sys
import unittest
from pathlib import Path

import numpy as np


MODULE_PATH = Path(__file__).resolve().parent.parent / "Logistic Regression Model" / "run_normalized_candidate.py"
SPEC = importlib.util.spec_from_file_location("rook_normalized_candidate", MODULE_PATH)
MODULE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = MODULE
SPEC.loader.exec_module(MODULE)

REPLAY_MODULE_PATH = (
    Path(__file__).resolve().parent.parent
    / "Logistic Regression Model"
    / "run_engine_replay.py"
)
REPLAY_SPEC = importlib.util.spec_from_file_location(
    "rook_engine_replay_tests", REPLAY_MODULE_PATH
)
REPLAY_MODULE = importlib.util.module_from_spec(REPLAY_SPEC)
sys.modules[REPLAY_SPEC.name] = REPLAY_MODULE
REPLAY_SPEC.loader.exec_module(REPLAY_MODULE)


class TrainingModelTests(unittest.TestCase):
    def test_training_fingerprint_ignores_export_metadata(self):
        game = {"gameId": "game_one", "winner": "us", "rounds": []}
        first = {
            "schemaVersion": 2,
            "generatedAt": "2026-01-01T00:00:00Z",
            "source": {"projectId": "first"},
            "games": [game],
        }
        second = {
            "schemaVersion": 2,
            "generatedAt": "2026-02-01T00:00:00Z",
            "source": {"projectId": "second"},
            "games": [game],
        }
        changed = {**second, "games": [{**game, "winner": "dem"}]}

        self.assertEqual(
            MODULE.training_data_sha256(first), MODULE.training_data_sha256(second)
        )
        self.assertNotEqual(
            MODULE.training_data_sha256(first), MODULE.training_data_sha256(changed)
        )

    def test_symmetric_features_are_exact_negatives_after_side_swap(self):
        original = MODULE.make_symmetric_features(
            round_index=2,
            us_total=310,
            dem_total=190,
            diff=120,
            momentum=35,
            bid_amount=130,
            bidding_team_sign=1,
            point_delta=45,
        )
        swapped = MODULE.make_symmetric_features(
            round_index=2,
            us_total=190,
            dem_total=310,
            diff=-120,
            momentum=-35,
            bid_amount=130,
            bidding_team_sign=-1,
            point_delta=-45,
        )
        np.testing.assert_allclose(swapped, -original)

    def test_terminal_round_is_excluded(self):
        game = {
            "winner": "us",
            "pregameStrength": {},
            "rounds": [
                {
                    "roundIndex": 0,
                    "biddingTeam": "us",
                    "bidAmount": 120,
                    "usPoints": 125,
                    "demPoints": 55,
                    "runningTotals": {"us": 125, "dem": 55},
                    "terminal": False,
                },
                {
                    "roundIndex": 1,
                    "biddingTeam": "dem",
                    "bidAmount": 130,
                    "usPoints": 180,
                    "demPoints": -130,
                    "runningTotals": {"us": 305, "dem": -75},
                    "terminal": True,
                },
            ],
        }
        dataset = MODULE.extract_round_dataset([game])
        self.assertEqual(len(dataset.y), 1)
        self.assertEqual(dataset.round_index.tolist(), [0])

    def test_representation_weights_ignore_outcomes(self):
        games = [
            {
                "winner": "us" if index % 2 else "dem",
                "teams": {
                    "us": {"teamId": "team_frequent"},
                    "dem": {"teamId": f"team_{index}"},
                },
            }
            for index in range(16)
        ]
        indexes = list(range(len(games)))
        first, _ = MODULE.representation_game_weights(games, indexes, 8, 0.5)
        reversed_games = [
            {**game, "winner": "dem" if game["winner"] == "us" else "us"}
            for game in games
        ]
        second, _ = MODULE.representation_game_weights(reversed_games, indexes, 8, 0.5)
        self.assertEqual(first, second)
        self.assertTrue(all(weight == np.sqrt(0.5) for weight in first.values()))

    def test_library_player_context_uses_only_prior_game_outcomes(self):
        def game(winner):
            return {
                "winner": winner,
                "finalScore": {"us": 510, "dem": 390},
                "teams": {
                    "us": {"teamId": "team_ab", "playerIds": ["a", "b"]},
                    "dem": {"teamId": "team_cd", "playerIds": ["c", "d"]},
                },
                "provenance": {"libraryIds": ["library_one"]},
                "rounds": [],
            }

        original = REPLAY_MODULE.build_library_contexts([game("us"), game("us")])
        target_flipped = REPLAY_MODULE.build_library_contexts([game("us"), game("dem")])

        self.assertEqual(original[0], target_flipped[0])
        self.assertEqual(original[1], target_flipped[1])
        self.assertTrue(all(player.games == 0 for player in original[0].us_players))
        self.assertTrue(all(player.games == 1 for player in original[1].us_players))
        self.assertTrue(all(player.wins == 1 for player in original[1].us_players))

    def test_player_win_prior_is_exactly_antisymmetric(self):
        strong = REPLAY_MODULE.PlayerSnapshot(10, 8, 0, 0, 0, 0, 0, 0, 0)
        weak = REPLAY_MODULE.PlayerSnapshot(10, 2, 0, 0, 0, 0, 0, 0, 0)
        original = REPLAY_MODULE.LibraryGameContext(
            0,
            "library_one",
            (strong, strong),
            (weak, weak),
            REPLAY_MODULE.TeamRecord(),
            REPLAY_MODULE.TeamRecord(),
        )
        swapped = REPLAY_MODULE.LibraryGameContext(
            0,
            "library_one",
            original.dem_players,
            original.us_players,
            original.dem_team,
            original.us_team,
        )
        signal = REPLAY_MODULE.player_win_signal(original, 12.0)
        swapped_signal = REPLAY_MODULE.player_win_signal(swapped, 12.0)
        self.assertAlmostEqual(swapped_signal, -signal, places=12)

    def test_opponent_adjusted_rating_is_prior_only_and_side_symmetric(self):
        def game(us_players, dem_players, winner):
            return {
                "winner": winner,
                "teams": {
                    "us": {"playerIds": list(us_players)},
                    "dem": {"playerIds": list(dem_players)},
                },
                "provenance": {"libraryIds": ["library_one"]},
            }

        history = game(("a", "b"), ("c", "d"), "us")
        target = game(("a", "b"), ("c", "d"), "us")
        flipped_target_outcome = game(("a", "b"), ("c", "d"), "dem")
        swapped_target = game(("c", "d"), ("a", "b"), "dem")

        original = REPLAY_MODULE.build_library_bradley_terry_signals(
            [history, target], 0.05
        )[(1, "library_one")]
        outcome_flipped = REPLAY_MODULE.build_library_bradley_terry_signals(
            [history, flipped_target_outcome], 0.05
        )[(1, "library_one")]
        swapped = REPLAY_MODULE.build_library_bradley_terry_signals(
            [history, swapped_target], 0.05
        )[(1, "library_one")]

        self.assertGreater(original, 0)
        self.assertAlmostEqual(outcome_flipped, original, places=12)
        self.assertAlmostEqual(swapped, -original, places=12)


if __name__ == "__main__":
    unittest.main()
