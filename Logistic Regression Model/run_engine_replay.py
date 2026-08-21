"""Replay deployable Rook win-probability engines on chronological libraries.

This evaluator is deliberately stricter than a random train/test split.  Every
player/team signal is calculated from games already present in the target
source library before the predicted game.  Duplicate cloud copies remain one
logical game and library-context observations are down-weighted so a widely
shared game cannot dominate the result.

The script is offline and read-only: it never connects to Firebase and never
replaces the production runtime model.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import math
import os
import sys
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Deque, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

import numpy as np
from scipy.optimize import minimize


PLAYER_ALPHA_GRID: Tuple[float, ...] = (1.0, 2.0, 4.0, 6.0, 8.0, 12.0, 20.0)
PLAYER_COEFFICIENT_GRID: Tuple[float, ...] = (0.25, 0.5, 0.75, 1.0, 1.25, 1.5, 2.0)
PLAYER_HALF_LIFE_GRID: Tuple[Optional[float], ...] = (None, 1.0, 2.0, 4.0, 8.0)
ADD_ON_COEFFICIENT_GRID: Tuple[float, ...] = (0.0, 0.25, 0.5, 0.75, 1.0, 1.5, 2.0)
MARGIN_SHRINKAGE_GRID: Tuple[float, ...] = (4.0, 8.0, 16.0)
BRADLEY_TERRY_L2_GRID: Tuple[float, ...] = (0.05, 0.1, 0.25, 0.5, 1.0)
BRADLEY_TERRY_COEFFICIENT_GRID: Tuple[float, ...] = (
    0.025, 0.05, 0.075, 0.1, 0.15, 0.2, 0.25, 0.3, 0.4
)
HIERARCHICAL_ROUND_LOG_LOSS_TOLERANCE = 0.001
RECENT_WINDOW = 12


def load_candidate_module(script_directory: Path):
    module_path = script_directory / "run_normalized_candidate.py"
    spec = importlib.util.spec_from_file_location("rook_normalized_candidate_replay", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"Unable to load candidate module from {module_path}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def finite_float(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


def scalar_logit(probability: float) -> float:
    clipped = min(1.0 - 1e-6, max(1e-6, finite_float(probability, 0.5)))
    return math.log(clipped / (1.0 - clipped))


def sigmoid(values: np.ndarray) -> np.ndarray:
    clipped = np.clip(values, -60.0, 60.0)
    return 1.0 / (1.0 + np.exp(-clipped))


@dataclass
class PlayerRecord:
    games: int = 0
    wins: float = 0.0
    robust_margin_sum: float = 0.0
    bid_attempts: int = 0
    bids_made: float = 0.0
    defense_attempts: int = 0
    sets_forced: float = 0.0
    recent_results: Deque[float] = field(default_factory=lambda: deque(maxlen=RECENT_WINDOW))


@dataclass
class TeamRecord:
    games: int = 0
    wins: float = 0.0


@dataclass(frozen=True)
class PlayerSnapshot:
    games: int
    wins: float
    robust_margin_sum: float
    bid_attempts: int
    bids_made: float
    defense_attempts: int
    sets_forced: float
    recent_games: int
    recent_wins: float


@dataclass(frozen=True)
class LibraryGameContext:
    game_index: int
    library_id: str
    us_players: Tuple[PlayerSnapshot, ...]
    dem_players: Tuple[PlayerSnapshot, ...]
    us_team: TeamRecord
    dem_team: TeamRecord


def snapshot_player(record: Optional[PlayerRecord]) -> PlayerSnapshot:
    safe = record or PlayerRecord()
    return PlayerSnapshot(
        games=safe.games,
        wins=safe.wins,
        robust_margin_sum=safe.robust_margin_sum,
        bid_attempts=safe.bid_attempts,
        bids_made=safe.bids_made,
        defense_attempts=safe.defense_attempts,
        sets_forced=safe.sets_forced,
        recent_games=len(safe.recent_results),
        recent_wins=float(sum(safe.recent_results)),
    )


def snapshot_team(record: Optional[TeamRecord]) -> TeamRecord:
    safe = record or TeamRecord()
    return TeamRecord(games=safe.games, wins=safe.wins)


def side_player_ids(game: Mapping[str, object], side: str) -> Tuple[str, ...]:
    teams = game.get("teams") if isinstance(game.get("teams"), Mapping) else {}
    side_obj = teams.get(side) if isinstance(teams, Mapping) else {}
    raw_ids = side_obj.get("playerIds") if isinstance(side_obj, Mapping) else []
    if not isinstance(raw_ids, list):
        return ()
    return tuple(sorted(str(item) for item in raw_ids if item))


def side_team_id(game: Mapping[str, object], side: str) -> str:
    teams = game.get("teams") if isinstance(game.get("teams"), Mapping) else {}
    side_obj = teams.get(side) if isinstance(teams, Mapping) else {}
    value = side_obj.get("teamId") if isinstance(side_obj, Mapping) else None
    return str(value) if value else ""


def build_library_contexts(games: Sequence[Mapping[str, object]]) -> List[LibraryGameContext]:
    """Capture prior-only identity records before updating each library."""

    player_records: Dict[str, Dict[str, PlayerRecord]] = defaultdict(dict)
    team_records: Dict[str, Dict[str, TeamRecord]] = defaultdict(dict)
    contexts: List[LibraryGameContext] = []

    for game_index, game in enumerate(games):
        provenance = game.get("provenance") if isinstance(game.get("provenance"), Mapping) else {}
        raw_libraries = provenance.get("libraryIds") if isinstance(provenance, Mapping) else []
        library_ids = sorted({str(item) for item in raw_libraries or [] if item})
        us_player_ids = side_player_ids(game, "us")
        dem_player_ids = side_player_ids(game, "dem")
        us_team_id = side_team_id(game, "us")
        dem_team_id = side_team_id(game, "dem")

        for library_id in library_ids:
            library_players = player_records[library_id]
            library_teams = team_records[library_id]
            contexts.append(LibraryGameContext(
                game_index=game_index,
                library_id=library_id,
                us_players=tuple(snapshot_player(library_players.get(pid)) for pid in us_player_ids),
                dem_players=tuple(snapshot_player(library_players.get(pid)) for pid in dem_player_ids),
                us_team=snapshot_team(library_teams.get(us_team_id)),
                dem_team=snapshot_team(library_teams.get(dem_team_id)),
            ))

        winner = str(game.get("winner") or "").lower()
        if winner not in {"us", "dem"}:
            continue
        final_score = game.get("finalScore") if isinstance(game.get("finalScore"), Mapping) else {}
        us_final = finite_float(final_score.get("us"), 0.0)
        dem_final = finite_float(final_score.get("dem"), 0.0)
        margin_by_side = {
            "us": math.tanh((us_final - dem_final) / 400.0),
            "dem": math.tanh((dem_final - us_final) / 400.0),
        }
        round_stats = {
            "us": {"bidAttempts": 0, "bidsMade": 0, "defenseAttempts": 0, "setsForced": 0},
            "dem": {"bidAttempts": 0, "bidsMade": 0, "defenseAttempts": 0, "setsForced": 0},
        }
        for round_obj in game.get("rounds") or []:
            bidding_side = str(round_obj.get("biddingTeam") or "").lower()
            if bidding_side not in {"us", "dem"}:
                continue
            defending_side = "dem" if bidding_side == "us" else "us"
            bidder_points = finite_float(round_obj.get(f"{bidding_side}Points"), 0.0)
            made_bid = bidder_points >= 0.0
            round_stats[bidding_side]["bidAttempts"] += 1
            round_stats[bidding_side]["bidsMade"] += int(made_bid)
            round_stats[defending_side]["defenseAttempts"] += 1
            round_stats[defending_side]["setsForced"] += int(not made_bid)

        for library_id in library_ids:
            library_players = player_records[library_id]
            library_teams = team_records[library_id]
            for side, player_ids, team_id in (
                ("us", us_player_ids, us_team_id),
                ("dem", dem_player_ids, dem_team_id),
            ):
                side_won = 1.0 if winner == side else 0.0
                for player_id in player_ids:
                    record = library_players.setdefault(player_id, PlayerRecord())
                    record.games += 1
                    record.wins += side_won
                    record.robust_margin_sum += margin_by_side[side]
                    record.bid_attempts += round_stats[side]["bidAttempts"]
                    record.bids_made += round_stats[side]["bidsMade"]
                    record.defense_attempts += round_stats[side]["defenseAttempts"]
                    record.sets_forced += round_stats[side]["setsForced"]
                    record.recent_results.append(side_won)
                if team_id:
                    team_record = library_teams.setdefault(team_id, TeamRecord())
                    team_record.games += 1
                    team_record.wins += side_won

    return contexts


def beta_log_odds(wins: float, games: int, alpha: float) -> float:
    rate = (wins + alpha) / (games + (2.0 * alpha))
    return scalar_logit(rate)


def mean_or_zero(values: Iterable[float]) -> float:
    items = list(values)
    return float(sum(items) / len(items)) if items else 0.0


def player_win_signal(context: LibraryGameContext, alpha: float) -> float:
    us = mean_or_zero(beta_log_odds(item.wins, item.games, alpha) for item in context.us_players)
    dem = mean_or_zero(beta_log_odds(item.wins, item.games, alpha) for item in context.dem_players)
    return us - dem


def recent_player_signal(context: LibraryGameContext, alpha: float = 3.0) -> float:
    us = mean_or_zero(
        beta_log_odds(item.recent_wins, item.recent_games, alpha) for item in context.us_players
    )
    dem = mean_or_zero(
        beta_log_odds(item.recent_wins, item.recent_games, alpha) for item in context.dem_players
    )
    return us - dem


def player_margin_signal(context: LibraryGameContext, shrinkage: float) -> float:
    us = mean_or_zero(
        item.robust_margin_sum / (item.games + shrinkage) for item in context.us_players
    )
    dem = mean_or_zero(
        item.robust_margin_sum / (item.games + shrinkage) for item in context.dem_players
    )
    return us - dem


def player_bid_signal(context: LibraryGameContext, alpha: float = 3.0) -> float:
    us = mean_or_zero(
        beta_log_odds(item.bids_made, item.bid_attempts, alpha) for item in context.us_players
    )
    dem = mean_or_zero(
        beta_log_odds(item.bids_made, item.bid_attempts, alpha) for item in context.dem_players
    )
    return us - dem


def player_defense_signal(context: LibraryGameContext, alpha: float = 3.0) -> float:
    us = mean_or_zero(
        beta_log_odds(item.sets_forced, item.defense_attempts, alpha) for item in context.us_players
    )
    dem = mean_or_zero(
        beta_log_odds(item.sets_forced, item.defense_attempts, alpha) for item in context.dem_players
    )
    return us - dem


def team_win_signal(context: LibraryGameContext, alpha: float) -> float:
    return (
        beta_log_odds(context.us_team.wins, context.us_team.games, alpha)
        - beta_log_odds(context.dem_team.wins, context.dem_team.games, alpha)
    )


def build_library_bradley_terry_signals(
    games: Sequence[Mapping[str, object]],
    l2: float,
) -> Dict[Tuple[int, str], float]:
    """Fit prior-only, opponent-adjusted player ratings within each library.

    Each target game's rating is calculated before that result is appended.
    Player effects use team-average encoding (+/- 0.5) and a zero-centered L2
    prior, which preserves exact side-swap symmetry and gives unseen players a
    neutral rating.
    """

    histories: Dict[str, List[Tuple[float, Tuple[str, ...], Tuple[str, ...]]]] = defaultdict(list)
    result: Dict[Tuple[int, str], float] = {}
    safe_l2 = max(1e-6, finite_float(l2, 0.1))

    for game_index, game in enumerate(games):
        provenance = game.get("provenance") if isinstance(game.get("provenance"), Mapping) else {}
        library_ids = sorted({str(item) for item in provenance.get("libraryIds") or [] if item})
        us_players = side_player_ids(game, "us")
        dem_players = side_player_ids(game, "dem")

        for library_id in library_ids:
            history = histories[library_id]
            signal = 0.0
            if history and len(us_players) == 2 and len(dem_players) == 2:
                player_ids = sorted({
                    player_id
                    for _, prior_us, prior_dem in history
                    for player_id in prior_us + prior_dem
                })
                player_index = {player_id: index for index, player_id in enumerate(player_ids)}
                matrix = np.zeros((len(history), len(player_ids)), dtype=np.float64)
                labels = np.zeros(len(history), dtype=np.float64)
                for row_index, (label, prior_us, prior_dem) in enumerate(history):
                    labels[row_index] = label
                    for player_id in prior_us:
                        matrix[row_index, player_index[player_id]] += 0.5
                    for player_id in prior_dem:
                        matrix[row_index, player_index[player_id]] -= 0.5

                def objective(coefficients: np.ndarray) -> Tuple[float, np.ndarray]:
                    logits = matrix @ coefficients
                    probabilities = sigmoid(logits)
                    value = float(
                        np.sum(np.logaddexp(0.0, logits) - (labels * logits))
                        + (0.5 * safe_l2 * np.sum(coefficients ** 2))
                    )
                    gradient = (matrix.T @ (probabilities - labels)) + (safe_l2 * coefficients)
                    return value, gradient

                fitted = minimize(
                    fun=lambda coefficients: objective(coefficients)[0],
                    x0=np.zeros(len(player_ids), dtype=np.float64),
                    jac=lambda coefficients: objective(coefficients)[1],
                    method="L-BFGS-B",
                    options={"maxiter": 300, "ftol": 1e-10, "gtol": 1e-7},
                )
                coefficients = fitted.x if np.all(np.isfinite(fitted.x)) else np.zeros(len(player_ids))
                signal = (
                    sum(0.5 * coefficients[player_index[player_id]] for player_id in us_players if player_id in player_index)
                    - sum(0.5 * coefficients[player_index[player_id]] for player_id in dem_players if player_id in player_index)
                )
            result[(game_index, library_id)] = float(signal)

        if len(us_players) == 2 and len(dem_players) == 2:
            label = 1.0 if str(game.get("winner") or "").lower() == "us" else 0.0
            for library_id in library_ids:
                histories[library_id].append((label, us_players, dem_players))

    return result


def round_decay(round_indexes: np.ndarray, half_life: Optional[float]) -> np.ndarray:
    if half_life is None:
        return np.ones_like(round_indexes, dtype=np.float64)
    return np.power(0.5, np.asarray(round_indexes, dtype=np.float64) / half_life)


def contexts_by_game(contexts: Sequence[LibraryGameContext]) -> Dict[int, List[LibraryGameContext]]:
    result: Dict[int, List[LibraryGameContext]] = defaultdict(list)
    for context in contexts:
        result[context.game_index].append(context)
    return result


def expanded_predictions(
    candidate_module,
    dataset,
    rows: np.ndarray,
    base_probabilities: np.ndarray,
    context_lookup: Mapping[int, Sequence[LibraryGameContext]],
    signal_function,
    coefficient: float,
    half_life: Optional[float],
) -> Dict[str, np.ndarray]:
    labels: List[float] = []
    probabilities: List[float] = []
    round_weights: List[float] = []
    game_weights: List[float] = []
    logical_game_ids: List[int] = []

    row_position = {int(row): position for position, row in enumerate(rows)}
    rows_by_game: Dict[int, List[int]] = defaultdict(list)
    for row in rows:
        rows_by_game[int(dataset.game_index[row])].append(int(row))

    for game_index, game_rows in rows_by_game.items():
        contexts_for_game = list(context_lookup.get(game_index) or [])
        if not contexts_for_game:
            contexts_for_game = [None]
        context_count = len(contexts_for_game)
        game_round_count = len(game_rows)
        for context in contexts_for_game:
            static_signal = signal_function(context) if context is not None else 0.0
            for row in game_rows:
                position = row_position[row]
                base_logit = scalar_logit(base_probabilities[position])
                decay = float(round_decay(np.asarray([dataset.round_index[row]]), half_life)[0])
                probabilities.append(float(sigmoid(np.asarray([
                    base_logit + (coefficient * decay * static_signal)
                ]))[0]))
                labels.append(float(dataset.y[row]))
                round_weights.append(1.0 / context_count)
                game_weights.append(1.0 / (context_count * game_round_count))
                logical_game_ids.append(game_index)

    return {
        "labels": np.asarray(labels, dtype=np.float64),
        "probabilities": np.asarray(probabilities, dtype=np.float64),
        "roundWeights": np.asarray(round_weights, dtype=np.float64),
        "gameWeights": np.asarray(game_weights, dtype=np.float64),
        "gameIds": np.asarray(logical_game_ids, dtype=np.int64),
    }


def weighted_ece(labels: np.ndarray, probabilities: np.ndarray, weights: np.ndarray, bins: int = 10) -> float:
    total_weight = float(weights.sum())
    if total_weight <= 0:
        return 0.0
    result = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for index in range(bins):
        if index == bins - 1:
            mask = (probabilities >= edges[index]) & (probabilities <= edges[index + 1])
        else:
            mask = (probabilities >= edges[index]) & (probabilities < edges[index + 1])
        if np.any(mask):
            bucket_weight = float(weights[mask].sum())
            predicted = float(np.average(probabilities[mask], weights=weights[mask]))
            observed = float(np.average(labels[mask], weights=weights[mask]))
            result += (bucket_weight / total_weight) * abs(predicted - observed)
    return result


def replay_metrics(candidate_module, expanded: Mapping[str, np.ndarray]) -> Dict[str, object]:
    labels = expanded["labels"]
    probabilities = expanded["probabilities"]
    round_weights = expanded["roundWeights"]
    game_weights = expanded["gameWeights"]
    return {
        "libraryContextObservations": int(len(labels)),
        "logicalGames": int(len(np.unique(expanded["gameIds"]))),
        "roundWeighted": {
            "accuracy": candidate_module.accuracy(labels, probabilities, round_weights),
            "logLoss": candidate_module.binary_log_loss(labels, probabilities, round_weights),
            "brierScore": candidate_module.brier_score(labels, probabilities, round_weights),
            "expectedCalibrationError": weighted_ece(labels, probabilities, round_weights),
        },
        "gameBalanced": {
            "accuracy": candidate_module.accuracy(labels, probabilities, game_weights),
            "logLoss": candidate_module.binary_log_loss(labels, probabilities, game_weights),
            "brierScore": candidate_module.brier_score(labels, probabilities, game_weights),
        },
    }


def base_probabilities_for_model(model, scaler, matrix: np.ndarray) -> np.ndarray:
    return scaler.calibrate_logits(model.predict_logits(matrix))


def artifact_probabilities(candidate_module, artifact: Mapping[str, object], matrix: np.ndarray) -> np.ndarray:
    feature_names = tuple(str(item) for item in artifact.get("featureSet") or [])
    coefficients = np.asarray([
        finite_float((artifact.get("coefficients") or {}).get(name), 0.0) for name in feature_names
    ])
    raw_logits = finite_float(artifact.get("intercept"), 0.0) + (matrix @ coefficients)
    calibration = artifact.get("calibration") or {}
    return sigmoid(
        finite_float(calibration.get("slope"), 1.0) * raw_logits
        + finite_float(calibration.get("intercept"), 0.0)
    )


def bucket_score(diff: float) -> int:
    value = finite_float(diff, 0.0)
    if value == 0.0:
        return 0
    sign = -1 if value < 0 else 1
    band = min(math.ceil(abs(value) / 20.0) * 20, 180)
    return int(sign * band)


def build_current_empirical_table(games: Sequence[Mapping[str, object]], game_indexes: Sequence[int]):
    table: Dict[str, Dict[str, float]] = {}
    for game_index in game_indexes:
        game = games[game_index]
        winner = str(game.get("winner") or "").lower()
        if winner not in {"us", "dem"}:
            continue
        for fallback_index, round_obj in enumerate(game.get("rounds") or []):
            totals = round_obj.get("runningTotals") if isinstance(round_obj.get("runningTotals"), Mapping) else {}
            diff = finite_float(totals.get("us"), 0.0) - finite_float(totals.get("dem"), 0.0)
            key = f"{fallback_index}|{bucket_score(diff)}"
            counts = table.setdefault(key, {"us": 1.0, "dem": 1.0})
            counts[winner] += 1.0
    return table


def fit_current_personalization(
    candidate_module,
    games: Sequence[Mapping[str, object]],
    game_indexes: Sequence[int],
    runtime: Mapping[str, object],
) -> Tuple[float, float, bool]:
    logits: List[float] = []
    labels: List[float] = []
    game_samples = 0

    for game_index in game_indexes:
        game = games[game_index]
        winner = str(game.get("winner") or "").lower()
        rounds = sorted(
            game.get("rounds") or [],
            key=lambda item: int(finite_float(item.get("roundIndex"), 0.0)),
        )
        if winner not in {"us", "dem"} or not rounds:
            continue
        previous_diff = 0.0
        used = False
        for fallback_index, round_obj in enumerate(rounds):
            round_index = max(0, int(finite_float(round_obj.get("roundIndex"), fallback_index)))
            totals = round_obj.get("runningTotals") if isinstance(round_obj.get("runningTotals"), Mapping) else {}
            us_total = finite_float(totals.get("us"), 0.0)
            dem_total = finite_float(totals.get("dem"), 0.0)
            diff = us_total - dem_total
            momentum = 0.0 if fallback_index == 0 else diff - previous_diff
            previous_diff = diff
            bidding_team = str(round_obj.get("biddingTeam") or "").lower()
            bidding_sign = 1.0 if bidding_team == "us" else (-1.0 if bidding_team == "dem" else 0.0)
            features = candidate_module.make_current_features(
                round_index,
                diff,
                momentum,
                finite_float(round_obj.get("bidAmount"), 0.0),
                bidding_sign,
                finite_float(round_obj.get("usPoints"), 0.0)
                - finite_float(round_obj.get("demPoints"), 0.0),
            )
            probability = float(candidate_module.runtime_probabilities(runtime, features.reshape(1, -1))[0])
            logits.append(scalar_logit(probability))
            labels.append(1.0 if winner == "us" else 0.0)
            used = True
        if used:
            game_samples += 1

    if game_samples < 10 or len(logits) < 60:
        return 1.0, 0.0, False

    xs = np.asarray(logits, dtype=np.float64)
    ys = np.asarray(labels, dtype=np.float64)
    slope = 1.0
    intercept = 0.0
    learning_rate = 0.03
    l2 = 1e-3
    for _ in range(1600):
        probabilities = sigmoid((slope * xs) + intercept)
        errors = probabilities - ys
        gradient_slope = float(np.mean(errors * xs) + (l2 * slope))
        gradient_intercept = float(np.mean(errors))
        slope -= learning_rate * gradient_slope
        intercept -= learning_rate * gradient_intercept

    base_probabilities = sigmoid(xs)
    personalized_probabilities = sigmoid((slope * xs) + intercept)
    base_loss = candidate_module.binary_log_loss(ys, base_probabilities)
    personalized_loss = candidate_module.binary_log_loss(ys, personalized_probabilities)
    accepted = bool(
        math.isfinite(slope)
        and math.isfinite(intercept)
        and 0.25 <= slope <= 3.5
        and abs(intercept) <= 2.5
        and base_loss - personalized_loss >= 1e-4
    )
    return (slope, intercept, True) if accepted else (1.0, 0.0, False)


def expanded_current_complete_engine_predictions(
    candidate_module,
    games: Sequence[Mapping[str, object]],
    dataset,
    rows: np.ndarray,
    runtime: Mapping[str, object],
    context_lookup: Mapping[int, Sequence[LibraryGameContext]],
) -> Dict[str, np.ndarray]:
    library_games: Dict[str, List[int]] = defaultdict(list)
    for game_index, game in enumerate(games):
        provenance = game.get("provenance") if isinstance(game.get("provenance"), Mapping) else {}
        for library_id in provenance.get("libraryIds") or []:
            library_games[str(library_id)].append(game_index)

    labels: List[float] = []
    probabilities: List[float] = []
    round_weights: List[float] = []
    game_weights: List[float] = []
    logical_game_ids: List[int] = []
    rows_by_game: Dict[int, List[int]] = defaultdict(list)
    for row in rows:
        rows_by_game[int(dataset.game_index[row])].append(int(row))

    cached_history: Dict[Tuple[int, str], Tuple[Mapping[str, Mapping[str, float]], float, float]] = {}
    for game_index, game_rows in rows_by_game.items():
        contexts_for_game = list(context_lookup.get(game_index) or [])
        if not contexts_for_game:
            contexts_for_game = [None]
        context_count = len(contexts_for_game)
        game_round_count = len(game_rows)
        for context in contexts_for_game:
            library_id = context.library_id if context is not None else ""
            cache_key = (game_index, library_id)
            if cache_key not in cached_history:
                prior_games = [index for index in library_games.get(library_id, []) if index < game_index]
                empirical_table = build_current_empirical_table(games, prior_games)
                slope, intercept, _ = fit_current_personalization(
                    candidate_module, games, prior_games, runtime
                )
                cached_history[cache_key] = (empirical_table, slope, intercept)
            empirical_table, slope, intercept = cached_history[cache_key]

            for row in game_rows:
                base_probability = float(candidate_module.runtime_probabilities(
                    runtime, dataset.current_x[row].reshape(1, -1)
                )[0])
                personalized_probability = float(sigmoid(np.asarray([
                    (slope * scalar_logit(base_probability)) + intercept
                ]))[0])
                symmetric_row = dataset.symmetric_x[row]
                current_diff = float(symmetric_row[0])
                round_index = int(dataset.round_index[row])
                counts = empirical_table.get(
                    f"{round_index}|{bucket_score(current_diff)}",
                    {"us": 1.0, "dem": 1.0},
                )
                empirical_probability = counts["us"] / (counts["us"] + counts["dem"])
                observations = (counts["us"] - 1.0) + (counts["dem"] - 1.0)
                beta = min(1.0, math.log(observations + 1.0) / math.log(31.0))
                probability = (beta * empirical_probability) + ((1.0 - beta) * personalized_probability)

                probabilities.append(probability)
                labels.append(float(dataset.y[row]))
                round_weights.append(1.0 / context_count)
                game_weights.append(1.0 / (context_count * game_round_count))
                logical_game_ids.append(game_index)

    return {
        "labels": np.asarray(labels, dtype=np.float64),
        "probabilities": np.asarray(probabilities, dtype=np.float64),
        "roundWeights": np.asarray(round_weights, dtype=np.float64),
        "gameWeights": np.asarray(game_weights, dtype=np.float64),
        "gameIds": np.asarray(logical_game_ids, dtype=np.int64),
    }


def paired_logical_game_bootstrap(
    baseline: Mapping[str, np.ndarray],
    candidate: Mapping[str, np.ndarray],
    seed: int = 42,
    samples: int = 10000,
) -> Dict[str, float]:
    if not (
        np.array_equal(baseline["labels"], candidate["labels"])
        and np.array_equal(baseline["gameIds"], candidate["gameIds"])
    ):
        raise ValueError("Paired replay arrays do not describe the same observations.")
    differences = []
    for game_id in np.unique(baseline["gameIds"]):
        mask = baseline["gameIds"] == game_id
        labels = baseline["labels"][mask]
        weights = baseline["gameWeights"][mask]
        baseline_loss = candidate_module_binary_log_loss(
            labels, baseline["probabilities"][mask], weights
        )
        candidate_loss = candidate_module_binary_log_loss(
            labels, candidate["probabilities"][mask], weights
        )
        differences.append(baseline_loss - candidate_loss)
    observed = np.asarray(differences, dtype=np.float64)
    rng = np.random.default_rng(seed)
    indexes = rng.integers(0, len(observed), size=(samples, len(observed)))
    bootstrapped = observed[indexes].mean(axis=1)
    return {
        "metric": "logical-game mean log loss improvement; positive favors candidate",
        "observedImprovement": float(observed.mean()),
        "ci95Lower": float(np.percentile(bootstrapped, 2.5)),
        "ci95Upper": float(np.percentile(bootstrapped, 97.5)),
        "bootstrapProbabilityCandidateIsBetter": float(np.mean(bootstrapped > 0.0)),
        "bootstrapSamples": samples,
    }


def candidate_module_binary_log_loss(
    labels: np.ndarray,
    probabilities: np.ndarray,
    weights: np.ndarray,
) -> float:
    clipped = np.clip(probabilities, 1e-12, 1.0 - 1e-12)
    losses = -(labels * np.log(clipped) + (1.0 - labels) * np.log(1.0 - clipped))
    return float(np.average(losses, weights=weights))


def metric_sort_key(metrics: Mapping[str, object]) -> Tuple[float, float]:
    game = metrics["gameBalanced"]
    return float(game["logLoss"]), float(game["brierScore"])


def mean_fold_summary(fold_metrics: Sequence[Mapping[str, object]]) -> Dict[str, float]:
    return {
        "meanGameBalancedLogLoss": float(np.mean([
            metric["gameBalanced"]["logLoss"] for metric in fold_metrics
        ])),
        "meanGameBalancedBrierScore": float(np.mean([
            metric["gameBalanced"]["brierScore"] for metric in fold_metrics
        ])),
        "meanRoundWeightedLogLoss": float(np.mean([
            metric["roundWeighted"]["logLoss"] for metric in fold_metrics
        ])),
    }


def main() -> None:
    script_directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(script_directory / "generated" / "games_normalized_v2.json"))
    parser.add_argument("--candidate-report", default=str(script_directory / "generated" / "candidate_training_report_v2.json"))
    parser.add_argument("--runtime", default=str(script_directory.parent / "js" / "model_runtime_v1.json"))
    parser.add_argument("--output", default=str(script_directory / "generated" / "engine_replay_report_v2.json"))
    parser.add_argument(
        "--runtime-candidate-output",
        default=str(script_directory / "generated" / "model_runtime_v2_candidate.json"),
    )
    args = parser.parse_args()

    candidate_module = load_candidate_module(script_directory)
    payload = json.loads(Path(args.input).read_text())
    games = sorted(
        payload.get("games") or [],
        key=lambda game: (str(game.get("completedAt") or ""), str(game.get("gameId") or "")),
    )
    dataset = candidate_module.extract_round_dataset(games)
    splits = candidate_module.split_game_indexes(len(games), 0.65, 0.10, 0.10)
    split_rows = {
        name: candidate_module.rows_for_games(dataset, indexes) for name, indexes in splits.items()
    }
    contexts = build_library_contexts(games)
    context_lookup = contexts_by_game(contexts)

    report = json.loads(Path(args.candidate_report).read_text())
    selected_name = str(report["selectedCandidate"]["name"])
    selected_result = next(
        item for item in report["allCandidateTestResults"] if item["name"] == selected_name
    )
    selected_artifact = selected_result["model"]
    if tuple(selected_artifact["featureSet"]) != candidate_module.SYMMETRIC_FEATURE_NAMES:
        raise ValueError("Engine replay currently requires the selected symmetric v2 state model.")

    selected_spec = next(spec for spec in candidate_module.build_specs() if spec.name == selected_name)
    selected_l2 = float(selected_artifact["l2"])
    development_games = splits["fit"] + splits["selection"]
    folds = candidate_module.rolling_origin_folds(
        development_games,
        block_games=len(splits["selection"]),
        fold_count=3,
    )

    fold_base: List[Tuple[Mapping[str, Sequence[int]], np.ndarray, np.ndarray]] = []
    for fold in folds:
        model, _ = candidate_module.fit_candidate(
            selected_spec, games, dataset, fold["fit"], selected_l2
        )
        validation_rows = candidate_module.rows_for_games(dataset, fold["validation"])
        probabilities = sigmoid(model.predict_logits(dataset.matrix(selected_spec)[validation_rows]))
        fold_base.append((fold, validation_rows, probabilities))

    search_results: List[Dict[str, object]] = []
    for alpha in PLAYER_ALPHA_GRID:
        for coefficient in PLAYER_COEFFICIENT_GRID:
            for half_life in PLAYER_HALF_LIFE_GRID:
                fold_metrics = []
                for _, rows, base_probabilities in fold_base:
                    expanded = expanded_predictions(
                        candidate_module,
                        dataset,
                        rows,
                        base_probabilities,
                        context_lookup,
                        lambda context, a=alpha: player_win_signal(context, a),
                        coefficient,
                        half_life,
                    )
                    fold_metrics.append(replay_metrics(candidate_module, expanded))
                mean_game_log_loss = float(np.mean([
                    metric["gameBalanced"]["logLoss"] for metric in fold_metrics
                ]))
                mean_game_brier = float(np.mean([
                    metric["gameBalanced"]["brierScore"] for metric in fold_metrics
                ]))
                search_results.append({
                    "alpha": alpha,
                    "coefficient": coefficient,
                    "roundHalfLife": half_life,
                    "meanGameBalancedLogLoss": mean_game_log_loss,
                    "meanGameBalancedBrierScore": mean_game_brier,
                    "folds": fold_metrics,
                })
    search_results.sort(key=lambda item: (
        item["meanGameBalancedLogLoss"], item["meanGameBalancedBrierScore"]
    ))
    selected_player = search_results[0]

    player_alpha = float(selected_player["alpha"])
    player_coefficient = float(selected_player["coefficient"])
    player_half_life = selected_player["roundHalfLife"]

    def selected_player_signal(context: LibraryGameContext) -> float:
        return player_coefficient * player_win_signal(context, player_alpha)

    def evaluate_add_on(name: str, parameters: Mapping[str, object], add_on_function) -> Dict[str, object]:
        fold_metrics = []
        for _, rows, base_probabilities in fold_base:
            expanded = expanded_predictions(
                candidate_module,
                dataset,
                rows,
                base_probabilities,
                context_lookup,
                lambda context: selected_player_signal(context) + add_on_function(context),
                1.0,
                player_half_life,
            )
            fold_metrics.append(replay_metrics(candidate_module, expanded))
        return {
            "name": name,
            "parameters": dict(parameters),
            **mean_fold_summary(fold_metrics),
            "folds": fold_metrics,
            "signalFunction": add_on_function,
        }

    add_on_results: List[Dict[str, object]] = [
        evaluate_add_on("none", {}, lambda _context: 0.0)
    ]
    for alpha in (2.0, 4.0, 8.0, 12.0):
        for coefficient in ADD_ON_COEFFICIENT_GRID[1:]:
            add_on_results.append(evaluate_add_on(
                "exact_team_win_rate",
                {"alpha": alpha, "coefficient": coefficient},
                lambda context, a=alpha, c=coefficient: c * team_win_signal(context, a),
            ))
    for shrinkage in MARGIN_SHRINKAGE_GRID:
        for coefficient in ADD_ON_COEFFICIENT_GRID[1:]:
            add_on_results.append(evaluate_add_on(
                "robust_player_score_margin",
                {"shrinkageGames": shrinkage, "coefficient": coefficient},
                lambda context, s=shrinkage, c=coefficient: c * player_margin_signal(context, s),
            ))
    for coefficient in ADD_ON_COEFFICIENT_GRID[1:]:
        add_on_results.append(evaluate_add_on(
            "player_bid_make_rate",
            {"alpha": 3.0, "coefficient": coefficient},
            lambda context, c=coefficient: c * player_bid_signal(context, 3.0),
        ))
        add_on_results.append(evaluate_add_on(
            "player_set_force_rate",
            {"alpha": 3.0, "coefficient": coefficient},
            lambda context, c=coefficient: c * player_defense_signal(context, 3.0),
        ))
        add_on_results.append(evaluate_add_on(
            "recent_player_win_rate",
            {"windowGames": RECENT_WINDOW, "alpha": 3.0, "coefficient": coefficient},
            lambda context, c=coefficient: c * recent_player_signal(context, 3.0),
        ))
    bradley_terry_signal_sets: Dict[float, Dict[Tuple[int, str], float]] = {}
    for l2 in BRADLEY_TERRY_L2_GRID:
        bradley_terry_signals = build_library_bradley_terry_signals(games, l2)
        bradley_terry_signal_sets[l2] = bradley_terry_signals
        for coefficient in BRADLEY_TERRY_COEFFICIENT_GRID:
            add_on_results.append(evaluate_add_on(
                "opponent_adjusted_player_rating",
                {"l2": l2, "coefficient": coefficient},
                lambda context, signals=bradley_terry_signals, c=coefficient: (
                    c * signals.get((context.game_index, context.library_id), 0.0)
                ),
            ))

    add_on_results.sort(key=lambda item: (
        item["meanGameBalancedLogLoss"], item["meanGameBalancedBrierScore"]
    ))
    no_add_on = next(item for item in add_on_results if item["name"] == "none")
    best_add_on = add_on_results[0]
    fold_wins = sum(
        candidate_metric["gameBalanced"]["logLoss"]
        < baseline_metric["gameBalanced"]["logLoss"]
        for candidate_metric, baseline_metric in zip(best_add_on["folds"], no_add_on["folds"])
    )
    add_on_selected = bool(
        best_add_on["name"] != "none"
        and fold_wins >= 2
        and best_add_on["meanGameBalancedLogLoss"]
        < no_add_on["meanGameBalancedLogLoss"] - 1e-4
    )
    selected_add_on = best_add_on if add_on_selected else no_add_on

    hierarchical_results: List[Dict[str, object]] = []
    for alpha in PLAYER_ALPHA_GRID:
        for player_coefficient_candidate in PLAYER_COEFFICIENT_GRID:
            for l2, bradley_terry_signals in bradley_terry_signal_sets.items():
                for rating_coefficient in BRADLEY_TERRY_COEFFICIENT_GRID:
                    signal_function = lambda context, a=alpha, pc=player_coefficient_candidate, signals=bradley_terry_signals, rc=rating_coefficient: (
                        (pc * player_win_signal(context, a))
                        + (rc * signals.get((context.game_index, context.library_id), 0.0))
                    )
                    fold_metrics = []
                    for _, rows, base_probabilities in fold_base:
                        expanded = expanded_predictions(
                            candidate_module,
                            dataset,
                            rows,
                            base_probabilities,
                            context_lookup,
                            signal_function,
                            1.0,
                            None,
                        )
                        fold_metrics.append(replay_metrics(candidate_module, expanded))
                    hierarchical_results.append({
                        "alpha": alpha,
                        "playerCoefficient": player_coefficient_candidate,
                        "opponentAdjustedL2": l2,
                        "opponentAdjustedCoefficient": rating_coefficient,
                        **mean_fold_summary(fold_metrics),
                        "folds": fold_metrics,
                        "signalFunction": signal_function,
                    })

    best_hierarchical_round_loss = min(
        result["meanRoundWeightedLogLoss"] for result in hierarchical_results
    )
    for result in hierarchical_results:
        result["withinRoundLogLossGuardrail"] = bool(
            result["meanRoundWeightedLogLoss"]
            <= best_hierarchical_round_loss + HIERARCHICAL_ROUND_LOG_LOSS_TOLERANCE
        )
    hierarchical_results.sort(key=lambda result: (
        not result["withinRoundLogLossGuardrail"],
        result["meanGameBalancedLogLoss"],
        result["meanGameBalancedBrierScore"],
        result["meanRoundWeightedLogLoss"],
    ))
    selected_hierarchical = hierarchical_results[0]

    test_rows = split_rows["test"]
    candidate_base = artifact_probabilities(
        candidate_module,
        selected_artifact,
        dataset.symmetric_x[test_rows],
    )
    runtime = json.loads(Path(args.runtime).read_text())
    validation_replay_blocks = []
    for fold_index, (_, validation_rows, validation_base) in enumerate(fold_base):
        current_validation_expanded = expanded_current_complete_engine_predictions(
            candidate_module,
            games,
            dataset,
            validation_rows,
            runtime,
            context_lookup,
        )
        candidate_validation_expanded = expanded_predictions(
            candidate_module,
            dataset,
            validation_rows,
            validation_base,
            context_lookup,
            selected_hierarchical["signalFunction"],
            1.0,
            None,
        )
        current_validation_metrics = replay_metrics(
            candidate_module, current_validation_expanded
        )
        candidate_validation_metrics = replay_metrics(
            candidate_module, candidate_validation_expanded
        )
        validation_replay_blocks.append({
            "fold": fold_index + 1,
            "currentCompleteEngine": current_validation_metrics,
            "candidateHierarchicalEngine": candidate_validation_metrics,
            "roundLogLossImprovement": (
                current_validation_metrics["roundWeighted"]["logLoss"]
                - candidate_validation_metrics["roundWeighted"]["logLoss"]
            ),
            "gameBalancedLogLossImprovement": (
                current_validation_metrics["gameBalanced"]["logLoss"]
                - candidate_validation_metrics["gameBalanced"]["logLoss"]
            ),
        })
    validation_blocks_won = sum(
        block["roundLogLossImprovement"] > 0.0
        and block["gameBalancedLogLossImprovement"] > 0.0
        for block in validation_replay_blocks
    )
    production_base = candidate_module.runtime_probabilities(runtime, dataset.current_x[test_rows])
    neutral = lambda _context: 0.0
    production_expanded = expanded_predictions(
        candidate_module, dataset, test_rows, production_base, context_lookup, neutral, 0.0, None
    )
    production_complete_expanded = expanded_current_complete_engine_predictions(
        candidate_module,
        games,
        dataset,
        test_rows,
        runtime,
        context_lookup,
    )
    candidate_base_expanded = expanded_predictions(
        candidate_module, dataset, test_rows, candidate_base, context_lookup, neutral, 0.0, None
    )
    player_expanded = expanded_predictions(
        candidate_module,
        dataset,
        test_rows,
        candidate_base,
        context_lookup,
        lambda context: player_win_signal(context, float(selected_player["alpha"])),
        float(selected_player["coefficient"]),
        selected_player["roundHalfLife"],
    )
    augmented_expanded = expanded_predictions(
        candidate_module,
        dataset,
        test_rows,
        candidate_base,
        context_lookup,
        selected_hierarchical["signalFunction"],
        1.0,
        None,
    )
    production_metrics = replay_metrics(candidate_module, production_expanded)
    production_complete_metrics = replay_metrics(candidate_module, production_complete_expanded)
    candidate_base_metrics = replay_metrics(candidate_module, candidate_base_expanded)
    player_metrics = replay_metrics(candidate_module, player_expanded)
    augmented_metrics = replay_metrics(candidate_module, augmented_expanded)
    bootstrap = paired_logical_game_bootstrap(
        production_complete_expanded,
        augmented_expanded,
        seed=42,
        samples=10000,
    )
    baseline_round = production_complete_metrics["roundWeighted"]
    candidate_round = augmented_metrics["roundWeighted"]
    baseline_game = production_complete_metrics["gameBalanced"]
    candidate_game = augmented_metrics["gameBalanced"]
    relative_round_log_loss_improvement = (
        (baseline_round["logLoss"] - candidate_round["logLoss"]) / baseline_round["logLoss"]
    )
    relative_round_brier_improvement = (
        (baseline_round["brierScore"] - candidate_round["brierScore"])
        / baseline_round["brierScore"]
    )
    passes_point_estimates = bool(
        candidate_round["accuracy"] > baseline_round["accuracy"]
        and candidate_round["logLoss"] < baseline_round["logLoss"]
        and candidate_round["brierScore"] < baseline_round["brierScore"]
        and candidate_game["logLoss"] < baseline_game["logLoss"]
        and candidate_game["brierScore"] < baseline_game["brierScore"]
    )
    vast_point_estimate = bool(
        relative_round_log_loss_improvement >= 0.08
        and relative_round_brier_improvement >= 0.08
        and candidate_round["accuracy"] - baseline_round["accuracy"] >= 0.025
    )
    promotion_ready = bool(
        passes_point_estimates
        and vast_point_estimate
        and validation_blocks_won == len(validation_replay_blocks)
        and bootstrap["bootstrapProbabilityCandidateIsBetter"] >= 0.90
    )

    deployment_refit = report.get("deploymentRefit")
    if not isinstance(deployment_refit, Mapping):
        raise ValueError("Candidate report is missing the post-evaluation deployment refit.")
    deployment_artifact = deployment_refit.get("model")
    if not isinstance(deployment_artifact, Mapping):
        raise ValueError("Candidate report deployment refit is missing its model artifact.")
    if tuple(deployment_artifact.get("featureSet") or ()) != candidate_module.SYMMETRIC_FEATURE_NAMES:
        raise ValueError("Deployment refit does not use the selected symmetric v2 feature set.")

    generated_at = datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
    normalized_sha256 = str(report.get("data", {}).get("normalizedInputSha256") or "")
    runtime_candidate_path = Path(args.runtime_candidate_output).resolve()
    runtime_candidate = {
        "schemaVersion": 2,
        "modelId": (
            f"prod-{len(games)}g-{len(dataset.y)}r-"
            f"{normalized_sha256[:8] or 'unknown'}-hier-v2"
        ),
        "featureSet": list(deployment_artifact["featureSet"]),
        "intercept": finite_float(deployment_artifact.get("intercept"), 0.0),
        "coefficients": {
            name: finite_float((deployment_artifact.get("coefficients") or {}).get(name), 0.0)
            for name in deployment_artifact["featureSet"]
        },
        "calibration": {
            "type": "platt",
            "slope": finite_float(
                (deployment_artifact.get("calibration") or {}).get("slope"), 1.0
            ),
            "intercept": finite_float(
                (deployment_artifact.get("calibration") or {}).get("intercept"), 0.0
            ),
        },
        "hierarchicalPlayerPrior": {
            "type": "beta-plus-bradley-terry",
            "betaAlpha": float(selected_hierarchical["alpha"]),
            "playerWinLogOddsCoefficient": float(
                selected_hierarchical["playerCoefficient"]
            ),
            "opponentAdjustedL2": float(
                selected_hierarchical["opponentAdjustedL2"]
            ),
            "opponentAdjustedCoefficient": float(
                selected_hierarchical["opponentAdjustedCoefficient"]
            ),
            "optimizer": "cyclic-coordinate-newton",
            "maximumSweeps": 60,
            "convergenceTolerance": 1e-8,
        },
        "metadata": {
            "generatedAt": generated_at,
            "games": len(games),
            "roundSamples": int(len(dataset.y)),
            "normalizedInputSha256": normalized_sha256,
            "empiricalBlendEnabled": False,
            "legacyPersonalizationEnabled": False,
            "selection": (
                "rolling-origin state model plus library-local hierarchical player prior; "
                "state coefficients refit on all valid games after holdout evaluation"
            ),
        },
    }

    output = {
        "schemaVersion": 2,
        "generatedAt": generated_at,
        "purpose": "chronological, library-local replay; production runtime is not replaced",
        "safety": {
            "firebaseRead": False,
            "firebaseMutated": False,
            "productionRuntimeReplaced": False,
            "futureGameOutcomesUsedForPriorFeatures": False,
            "rawIdentitiesPresent": False,
        },
        "data": {
            "logicalGames": len(games),
            "sourceLibraries": len({context.library_id for context in contexts}),
            "libraryGameContexts": len(contexts),
            "testGames": len(splits["test"]),
            "testRoundObservations": int(len(test_rows)),
        },
        "selection": {
            "method": "three rolling-origin folds; player hyperparameters selected before test",
            "criterion": "lowest mean game-balanced log loss, then Brier score",
            "selectedPlayerPrior": {
                key: selected_player[key]
                for key in ("alpha", "coefficient", "roundHalfLife", "meanGameBalancedLogLoss", "meanGameBalancedBrierScore")
            },
            "topPlayerPriorCandidates": [
                {
                    key: item[key]
                    for key in ("alpha", "coefficient", "roundHalfLife", "meanGameBalancedLogLoss", "meanGameBalancedBrierScore")
                }
                for item in search_results[:20]
            ],
            "selectedAddOn": {
                "name": selected_add_on["name"],
                "parameters": selected_add_on["parameters"],
                "selected": add_on_selected,
                "foldWinsVersusPlayerOnly": fold_wins,
                **{
                    key: selected_add_on[key]
                    for key in (
                        "meanGameBalancedLogLoss",
                        "meanGameBalancedBrierScore",
                        "meanRoundWeightedLogLoss",
                    )
                },
            },
            "topAddOnCandidates": [
                {
                    "name": item["name"],
                    "parameters": item["parameters"],
                    **{
                        key: item[key]
                        for key in (
                            "meanGameBalancedLogLoss",
                            "meanGameBalancedBrierScore",
                            "meanRoundWeightedLogLoss",
                        )
                    },
                }
                for item in add_on_results[:20]
            ],
            "selectedHierarchicalPrior": {
                key: selected_hierarchical[key]
                for key in (
                    "alpha",
                    "playerCoefficient",
                    "opponentAdjustedL2",
                    "opponentAdjustedCoefficient",
                    "meanGameBalancedLogLoss",
                    "meanGameBalancedBrierScore",
                    "meanRoundWeightedLogLoss",
                    "withinRoundLogLossGuardrail",
                )
            },
            "hierarchicalRoundLogLossTolerance": HIERARCHICAL_ROUND_LOG_LOSS_TOLERANCE,
            "topHierarchicalCandidates": [
                {
                    key: item[key]
                    for key in (
                        "alpha",
                        "playerCoefficient",
                        "opponentAdjustedL2",
                        "opponentAdjustedCoefficient",
                        "meanGameBalancedLogLoss",
                        "meanGameBalancedBrierScore",
                        "meanRoundWeightedLogLoss",
                        "withinRoundLogLossGuardrail",
                    )
                }
                for item in hierarchical_results[:20]
            ],
            "chronologicalValidationReplay": {
                "blocksWon": validation_blocks_won,
                "blocksEvaluated": len(validation_replay_blocks),
                "requiresRoundAndGameBalancedLogLossImprovement": True,
                "blocks": validation_replay_blocks,
            },
        },
        "test": {
            "currentProductionBase": production_metrics,
            "currentProductionCompleteEngine": production_complete_metrics,
            "normalizedCandidateBase": candidate_base_metrics,
            "normalizedCandidatePlusPlayerPrior": player_metrics,
            "normalizedCandidatePlusSelectedHierarchicalPrior": augmented_metrics,
            "versusCurrentProductionBase": {
                "roundAccuracyChange": (
                    augmented_metrics["roundWeighted"]["accuracy"]
                    - production_metrics["roundWeighted"]["accuracy"]
                ),
                "roundLogLossImprovement": (
                    production_metrics["roundWeighted"]["logLoss"]
                    - augmented_metrics["roundWeighted"]["logLoss"]
                ),
                "roundBrierImprovement": (
                    production_metrics["roundWeighted"]["brierScore"]
                    - augmented_metrics["roundWeighted"]["brierScore"]
                ),
                "gameBalancedLogLossImprovement": (
                    production_metrics["gameBalanced"]["logLoss"]
                    - augmented_metrics["gameBalanced"]["logLoss"]
                ),
            },
            "versusCurrentCompleteEngine": {
                "roundAccuracyChange": candidate_round["accuracy"] - baseline_round["accuracy"],
                "roundLogLossImprovement": baseline_round["logLoss"] - candidate_round["logLoss"],
                "roundLogLossRelativeImprovement": relative_round_log_loss_improvement,
                "roundBrierImprovement": baseline_round["brierScore"] - candidate_round["brierScore"],
                "roundBrierRelativeImprovement": relative_round_brier_improvement,
                "roundExpectedCalibrationErrorImprovement": (
                    baseline_round["expectedCalibrationError"]
                    - candidate_round["expectedCalibrationError"]
                ),
                "gameBalancedLogLossImprovement": (
                    baseline_game["logLoss"] - candidate_game["logLoss"]
                ),
                "pairedGameBootstrap": bootstrap,
            },
        },
        "promotionGate": {
            "status": "pass" if promotion_ready else "hold",
            "pointEstimatesImproveAccuracyLogLossAndBrier": passes_point_estimates,
            "substantialEffectThresholdMet": vast_point_estimate,
            "substantialEffectDefinition": "at least 8% relative round log-loss and Brier improvement plus 2.5 percentage points accuracy",
            "pairedBootstrapCiLowerBoundPositive": bootstrap["ci95Lower"] > 0.0,
            "minimumBootstrapProbability": 0.90,
            "bootstrapProbabilityThresholdMet": (
                bootstrap["bootstrapProbabilityCandidateIsBetter"] >= 0.90
            ),
            "allChronologicalValidationBlocksWon": (
                validation_blocks_won == len(validation_replay_blocks)
            ),
            "recommendation": (
                "Offline gate passed; implement the candidate behind runtime compatibility tests before publishing."
                if promotion_ready
                else "Keep the production engine unchanged and collect more future games or improve the candidate."
            ),
        },
        "runtimeCandidate": {
            "written": promotion_ready,
            "path": str(runtime_candidate_path) if promotion_ready else None,
            "modelId": runtime_candidate["modelId"],
            "fitGames": int(deployment_refit.get("fitGames") or 0),
            "fitRoundObservations": int(
                deployment_refit.get("fitRoundObservations") or 0
            ),
            "usesUntouchedTestOnlyAfterEvaluation": True,
            "mustNotBeUsedForReportedTestMetrics": True,
        },
    }

    if promotion_ready:
        runtime_candidate_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        runtime_candidate_path.write_text(json.dumps(runtime_candidate, indent=2) + "\n")
        os.chmod(runtime_candidate_path, 0o600)

    output_path = Path(args.output).resolve()
    output_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_path.write_text(json.dumps(output, indent=2) + "\n")
    os.chmod(output_path, 0o600)
    print(json.dumps({
        "reportPath": str(output_path),
        "selectedPlayerPrior": output["selection"]["selectedPlayerPrior"],
        "currentProductionBase": production_metrics["roundWeighted"],
        "currentProductionCompleteEngine": production_complete_metrics["roundWeighted"],
        "candidatePlusPlayerPrior": player_metrics["roundWeighted"],
        "selectedAddOn": output["selection"]["selectedAddOn"],
        "selectedHierarchicalPrior": output["selection"]["selectedHierarchicalPrior"],
        "candidatePlusSelectedHierarchicalPrior": augmented_metrics["roundWeighted"],
        "pairedGameBootstrap": bootstrap,
        "promotionGate": output["promotionGate"]["status"],
        "runtimeCandidatePath": (
            str(runtime_candidate_path) if promotion_ready else None
        ),
        "productionRuntimeReplaced": False,
        "firebaseMutated": False,
    }, indent=2))


if __name__ == "__main__":
    main()
