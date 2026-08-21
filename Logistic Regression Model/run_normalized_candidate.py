"""Train and evaluate normalized Rook probability candidates without publishing one.

The script keeps the newest games as a final chronological holdout, excludes
terminal rounds, and only uses pregame strength values derived from earlier
games. Team-frequency weights are computed from the fitting partition only.
It never reads from or writes to Firebase and never replaces the app runtime.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np
from scipy.optimize import minimize


CURRENT_FEATURE_NAMES: Tuple[str, ...] = (
    "diff",
    "round_idx",
    "momentum",
    "bid_amount",
    "bidding_team_sign",
    "point_delta",
    "abs_diff",
    "abs_momentum",
    "diff_x_round",
    "point_delta_x_round",
    "bid_x_team",
    "diff_x_point_delta",
    "momentum_x_round",
    "lead_sign",
)

SYMMETRIC_FEATURE_NAMES: Tuple[str, ...] = (
    "diff",
    "momentum",
    "bidding_team_sign",
    "point_delta",
    "diff_x_round",
    "point_delta_x_round",
    "bid_x_team",
    "momentum_x_round",
    "lead_sign",
    "diff_x_abs_diff",
    "momentum_x_abs_momentum",
    "diff_x_score_sum",
    "lead_sign_x_score_sum",
    "target_pressure_diff",
    "diff_x_bid",
    "bidder_sign_x_abs_point_delta",
    "bidder_sign_x_round",
)

STRENGTH_FEATURE_NAMES: Tuple[str, ...] = (
    "team_prior_rate_diff",
    "team_prior_log_odds_diff",
    "team_rate_diff_x_confidence",
    "team_history_log_count_diff",
    "player_elo_diff",
    "elo_expected_centered",
)

DECAYED_STRENGTH_FEATURE_NAMES: Tuple[str, ...] = (
    "team_prior_log_odds_diff_x_evidence_decay",
    "team_rate_diff_x_confidence_x_evidence_decay",
    "team_history_log_count_diff_x_evidence_decay",
    "player_elo_log_odds_x_evidence_decay",
    "elo_expected_centered_x_evidence_decay",
)

L2_GRID: Tuple[float, ...] = (1e-5, 1e-4, 1e-3, 1e-2, 1e-1)
CALIBRATION_MIN_SLOPE = 0.75
CALIBRATION_MAX_SLOPE = 1.25
CALIBRATION_MAX_ABS_INTERCEPT = 0.25
ROUND_LOG_LOSS_SELECTION_TOLERANCE = 0.001


def sigmoid(values: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(values, -60.0, 60.0)))


def logit(value: float) -> float:
    clipped = min(1.0 - 1e-6, max(1e-6, float(value)))
    return math.log(clipped / (1.0 - clipped))


def finite_float(value: object, fallback: float = 0.0) -> float:
    try:
        number = float(value)
        return number if math.isfinite(number) else fallback
    except (TypeError, ValueError):
        return fallback


@dataclass(frozen=True)
class CandidateSpec:
    name: str
    state_family: str
    include_strength: bool
    fit_intercept: bool
    representation_target: Optional[int] = None
    minimum_representation_weight: float = 0.5
    decay_strength: bool = False
    game_balanced_training: bool = False

    @property
    def feature_names(self) -> Tuple[str, ...]:
        state_names = CURRENT_FEATURE_NAMES if self.state_family == "current" else SYMMETRIC_FEATURE_NAMES
        if not self.include_strength:
            return state_names
        strength_names = DECAYED_STRENGTH_FEATURE_NAMES if self.decay_strength else STRENGTH_FEATURE_NAMES
        return state_names + strength_names


@dataclass
class RoundDataset:
    current_x: np.ndarray
    symmetric_x: np.ndarray
    strength_x: np.ndarray
    decayed_strength_x: np.ndarray
    y: np.ndarray
    game_index: np.ndarray
    round_index: np.ndarray
    rows_by_game: Dict[int, np.ndarray]

    def matrix(self, spec: CandidateSpec) -> np.ndarray:
        state_x = self.current_x if spec.state_family == "current" else self.symmetric_x
        if not spec.include_strength:
            return state_x
        strength_x = self.decayed_strength_x if spec.decay_strength else self.strength_x
        return np.column_stack((state_x, strength_x))


@dataclass
class LogisticModel:
    feature_names: Tuple[str, ...]
    mean: np.ndarray
    scale: np.ndarray
    coefficients_scaled: np.ndarray
    intercept_scaled: float
    fit_intercept: bool
    converged: bool
    iterations: int

    def predict_logits(self, x: np.ndarray) -> np.ndarray:
        normalized = (x - self.mean) / self.scale
        return self.intercept_scaled + normalized @ self.coefficients_scaled

    def raw_parameters(self) -> Tuple[float, np.ndarray]:
        coefficients = self.coefficients_scaled / self.scale
        intercept = self.intercept_scaled - float(np.sum(self.coefficients_scaled * self.mean / self.scale))
        return intercept, coefficients


@dataclass(frozen=True)
class PlattScaler:
    slope: float = 1.0
    intercept: float = 0.0
    accepted: bool = False
    base_log_loss: float = 0.0
    calibrated_log_loss: float = 0.0

    def calibrate_logits(self, logits: np.ndarray) -> np.ndarray:
        return sigmoid((self.slope * logits) + self.intercept)


def make_current_features(
    round_index: int,
    diff: float,
    momentum: float,
    bid_amount: float,
    bidding_team_sign: float,
    point_delta: float,
) -> np.ndarray:
    round_f = float(round_index)
    lead_sign = 1.0 if diff > 0 else (-1.0 if diff < 0 else 0.0)
    return np.asarray(
        [
            diff,
            round_f,
            momentum,
            bid_amount,
            bidding_team_sign,
            point_delta,
            abs(diff),
            abs(momentum),
            diff * round_f,
            point_delta * round_f,
            bid_amount * bidding_team_sign,
            diff * point_delta,
            momentum * round_f,
            lead_sign,
        ],
        dtype=np.float64,
    )


def make_symmetric_features(
    round_index: int,
    us_total: float,
    dem_total: float,
    diff: float,
    momentum: float,
    bid_amount: float,
    bidding_team_sign: float,
    point_delta: float,
) -> np.ndarray:
    round_f = float(round_index)
    lead_sign = 1.0 if diff > 0 else (-1.0 if diff < 0 else 0.0)
    score_sum = us_total + dem_total
    target_pressure_diff = max(0.0, us_total - 400.0) - max(0.0, dem_total - 400.0)
    return np.asarray(
        [
            diff,
            momentum,
            bidding_team_sign,
            point_delta,
            diff * round_f,
            point_delta * round_f,
            bid_amount * bidding_team_sign,
            momentum * round_f,
            lead_sign,
            diff * abs(diff),
            momentum * abs(momentum),
            diff * score_sum,
            lead_sign * score_sum,
            target_pressure_diff,
            diff * bid_amount,
            bidding_team_sign * abs(point_delta),
            bidding_team_sign * round_f,
        ],
        dtype=np.float64,
    )


def make_strength_features(game: Dict) -> np.ndarray:
    strength = game.get("pregameStrength") or {}
    us_rate = finite_float(strength.get("usTeamPriorWinRate"), 0.5)
    dem_rate = finite_float(strength.get("demTeamPriorWinRate"), 0.5)
    us_games = max(0.0, finite_float(strength.get("usTeamPriorGames"), 0.0))
    dem_games = max(0.0, finite_float(strength.get("demTeamPriorGames"), 0.0))
    rate_diff = us_rate - dem_rate
    confidence = min(1.0, math.log1p(min(us_games, dem_games)) / math.log(13.0))
    return np.asarray(
        [
            rate_diff,
            logit(us_rate) - logit(dem_rate),
            rate_diff * confidence,
            math.log1p(us_games) - math.log1p(dem_games),
            finite_float(strength.get("playerEloDiff"), 0.0),
            finite_float(strength.get("eloExpectedUsWin"), 0.5) - 0.5,
        ],
        dtype=np.float64,
    )


def make_decayed_strength_features(strength_features: np.ndarray, round_index: int) -> np.ndarray:
    evidence_decay = 0.5 ** max(0, int(round_index))
    player_elo_log_odds = strength_features[4] * math.log(10.0) / 400.0
    return np.asarray(
        [
            strength_features[1] * evidence_decay,
            strength_features[2] * evidence_decay,
            strength_features[3] * evidence_decay,
            player_elo_log_odds * evidence_decay,
            strength_features[5] * evidence_decay,
        ],
        dtype=np.float64,
    )


def extract_round_dataset(games: List[Dict]) -> RoundDataset:
    current_rows: List[np.ndarray] = []
    symmetric_rows: List[np.ndarray] = []
    strength_rows: List[np.ndarray] = []
    decayed_strength_rows: List[np.ndarray] = []
    labels: List[float] = []
    game_indexes: List[int] = []
    round_indexes: List[int] = []
    rows_by_game_lists: Dict[int, List[int]] = {}

    for game_index, game in enumerate(games):
        winner = game.get("winner")
        if winner not in {"us", "dem"}:
            continue
        label = 1.0 if winner == "us" else 0.0
        game_strength = make_strength_features(game)
        previous_diff = 0.0
        rounds = sorted(
            game.get("rounds") or [],
            key=lambda item: int(finite_float(item.get("roundIndex"), 0.0)),
        )

        for fallback_index, round_obj in enumerate(rounds):
            round_index = max(0, int(finite_float(round_obj.get("roundIndex"), fallback_index)))
            totals = round_obj.get("runningTotals") or {}
            us_total = finite_float(totals.get("us"), 0.0)
            dem_total = finite_float(totals.get("dem"), 0.0)
            diff = us_total - dem_total
            momentum = 0.0 if fallback_index == 0 else diff - previous_diff
            previous_diff = diff

            if bool(round_obj.get("terminal")):
                continue

            bid_amount = finite_float(round_obj.get("bidAmount"), 0.0)
            bidding_team = str(round_obj.get("biddingTeam") or "").strip().lower()
            bidding_team_sign = 1.0 if bidding_team == "us" else (-1.0 if bidding_team == "dem" else 0.0)
            us_points = finite_float(round_obj.get("usPoints"), 0.0)
            dem_points = finite_float(round_obj.get("demPoints"), 0.0)
            point_delta = us_points - dem_points

            current_rows.append(make_current_features(
                round_index,
                diff,
                momentum,
                bid_amount,
                bidding_team_sign,
                point_delta,
            ))
            symmetric_rows.append(make_symmetric_features(
                round_index,
                us_total,
                dem_total,
                diff,
                momentum,
                bid_amount,
                bidding_team_sign,
                point_delta,
            ))
            strength_rows.append(game_strength)
            decayed_strength_rows.append(make_decayed_strength_features(game_strength, round_index))
            labels.append(label)
            game_indexes.append(game_index)
            round_indexes.append(round_index)
            rows_by_game_lists.setdefault(game_index, []).append(len(labels) - 1)

    if not current_rows:
        raise ValueError("The normalized dataset contains no nonterminal training observations.")

    return RoundDataset(
        current_x=np.vstack(current_rows),
        symmetric_x=np.vstack(symmetric_rows),
        strength_x=np.vstack(strength_rows),
        decayed_strength_x=np.vstack(decayed_strength_rows),
        y=np.asarray(labels, dtype=np.float64),
        game_index=np.asarray(game_indexes, dtype=np.int64),
        round_index=np.asarray(round_indexes, dtype=np.int64),
        rows_by_game={
            game_index: np.asarray(rows, dtype=np.int64)
            for game_index, rows in rows_by_game_lists.items()
        },
    )


def rows_for_games(dataset: RoundDataset, game_indexes: Sequence[int]) -> np.ndarray:
    chunks = [dataset.rows_by_game[index] for index in game_indexes if index in dataset.rows_by_game]
    return np.concatenate(chunks) if chunks else np.empty(0, dtype=np.int64)


def representation_game_weights(
    games: List[Dict],
    fit_game_indexes: Sequence[int],
    target_games: Optional[int],
    minimum_weight: float,
) -> Tuple[Dict[int, float], Dict[str, object]]:
    if target_games is None:
        return ({index: 1.0 for index in fit_game_indexes}, {
            "enabled": False,
            "targetGames": None,
            "minimumWeight": 1.0,
            "gamesBelowFullWeight": 0,
            "minimumObservedWeight": 1.0,
            "maximumTeamFrequency": 0,
        })

    team_counts: Dict[str, int] = {}
    for game_index in fit_game_indexes:
        game = games[game_index]
        for side in ("us", "dem"):
            team_id = ((game.get("teams") or {}).get(side) or {}).get("teamId")
            if team_id:
                team_counts[team_id] = team_counts.get(team_id, 0) + 1

    game_weights: Dict[int, float] = {}
    for game_index in fit_game_indexes:
        game = games[game_index]
        counts = []
        for side in ("us", "dem"):
            team_id = ((game.get("teams") or {}).get(side) or {}).get("teamId")
            if team_id and team_id in team_counts:
                counts.append(team_counts[team_id])
        maximum_frequency = max(counts, default=0)
        raw_weight = math.sqrt(target_games / maximum_frequency) if maximum_frequency > target_games else 1.0
        game_weights[game_index] = min(1.0, max(minimum_weight, raw_weight))

    observed = list(game_weights.values()) or [1.0]
    return game_weights, {
        "enabled": True,
        "targetGames": target_games,
        "minimumWeight": minimum_weight,
        "gamesBelowFullWeight": sum(weight < 1.0 for weight in observed),
        "minimumObservedWeight": min(observed),
        "medianObservedWeight": float(np.median(observed)),
        "maximumTeamFrequency": max(team_counts.values(), default=0),
    }


def fit_logistic(
    x: np.ndarray,
    y: np.ndarray,
    sample_weights: np.ndarray,
    feature_names: Tuple[str, ...],
    l2: float,
    fit_intercept: bool,
) -> LogisticModel:
    if x.shape[0] == 0:
        raise ValueError("Cannot fit a model with no observations.")
    weights = np.asarray(sample_weights, dtype=np.float64)
    weights = np.where(np.isfinite(weights) & (weights > 0), weights, 1.0)
    weights /= weights.mean()

    if fit_intercept:
        mean = np.average(x, axis=0, weights=weights)
        centered = x - mean
    else:
        mean = np.zeros(x.shape[1], dtype=np.float64)
        centered = x
    scale = np.sqrt(np.average(centered ** 2, axis=0, weights=weights))
    scale = np.where(scale > 1e-12, scale, 1.0)
    x_scaled = centered / scale
    parameter_count = x.shape[1] + (1 if fit_intercept else 0)
    initial = np.zeros(parameter_count, dtype=np.float64)

    def objective(parameters: np.ndarray) -> Tuple[float, np.ndarray]:
        if fit_intercept:
            intercept = parameters[0]
            coefficients = parameters[1:]
        else:
            intercept = 0.0
            coefficients = parameters
        logits = intercept + x_scaled @ coefficients
        losses = np.logaddexp(0.0, logits) - (y * logits)
        normalizer = float(weights.sum())
        value = float(np.sum(weights * losses) / normalizer + 0.5 * l2 * np.sum(coefficients ** 2))
        errors = weights * (sigmoid(logits) - y)
        gradient_coefficients = (x_scaled.T @ errors) / normalizer + l2 * coefficients
        if fit_intercept:
            gradient = np.concatenate(([float(errors.sum() / normalizer)], gradient_coefficients))
        else:
            gradient = gradient_coefficients
        return value, gradient

    result = minimize(
        fun=lambda parameters: objective(parameters)[0],
        x0=initial,
        jac=lambda parameters: objective(parameters)[1],
        method="L-BFGS-B",
        options={"maxiter": 2000, "ftol": 1e-12, "gtol": 1e-8},
    )
    if not np.all(np.isfinite(result.x)):
        raise ValueError("Logistic optimization produced non-finite parameters.")

    if fit_intercept:
        intercept_scaled = float(result.x[0])
        coefficients_scaled = np.asarray(result.x[1:], dtype=np.float64)
    else:
        intercept_scaled = 0.0
        coefficients_scaled = np.asarray(result.x, dtype=np.float64)

    return LogisticModel(
        feature_names=feature_names,
        mean=mean,
        scale=scale,
        coefficients_scaled=coefficients_scaled,
        intercept_scaled=intercept_scaled,
        fit_intercept=fit_intercept,
        converged=bool(result.success),
        iterations=int(result.nit),
    )


def binary_log_loss(y: np.ndarray, probabilities: np.ndarray, weights: Optional[np.ndarray] = None) -> float:
    clipped = np.clip(probabilities, 1e-12, 1.0 - 1e-12)
    losses = -(y * np.log(clipped) + (1.0 - y) * np.log(1.0 - clipped))
    return float(np.average(losses, weights=weights))


def brier_score(y: np.ndarray, probabilities: np.ndarray, weights: Optional[np.ndarray] = None) -> float:
    return float(np.average((probabilities - y) ** 2, weights=weights))


def accuracy(y: np.ndarray, probabilities: np.ndarray, weights: Optional[np.ndarray] = None) -> float:
    correct = ((probabilities >= 0.5) == (y >= 0.5)).astype(np.float64)
    return float(np.average(correct, weights=weights))


def expected_calibration_error(y: np.ndarray, probabilities: np.ndarray, bins: int = 10) -> float:
    total = len(y)
    if total == 0:
        return 0.0
    error = 0.0
    edges = np.linspace(0.0, 1.0, bins + 1)
    for index in range(bins):
        if index == bins - 1:
            mask = (probabilities >= edges[index]) & (probabilities <= edges[index + 1])
        else:
            mask = (probabilities >= edges[index]) & (probabilities < edges[index + 1])
        if np.any(mask):
            error += (float(mask.sum()) / total) * abs(float(probabilities[mask].mean() - y[mask].mean()))
    return error


def metric_bundle(
    dataset: RoundDataset,
    rows: np.ndarray,
    probabilities: np.ndarray,
) -> Dict[str, object]:
    y = dataset.y[rows]
    game_ids = dataset.game_index[rows]
    counts = {int(game): int(np.sum(game_ids == game)) for game in np.unique(game_ids)}
    game_balance_weights = np.asarray([1.0 / counts[int(game)] for game in game_ids], dtype=np.float64)
    return {
        "samples": int(len(rows)),
        "games": len(counts),
        "roundWeighted": {
            "accuracy": accuracy(y, probabilities),
            "logLoss": binary_log_loss(y, probabilities),
            "brierScore": brier_score(y, probabilities),
            "expectedCalibrationError": expected_calibration_error(y, probabilities),
        },
        "gameBalanced": {
            "accuracy": accuracy(y, probabilities, game_balance_weights),
            "logLoss": binary_log_loss(y, probabilities, game_balance_weights),
            "brierScore": brier_score(y, probabilities, game_balance_weights),
        },
    }


def fit_platt_scaler(logits: np.ndarray, y: np.ndarray, allow_intercept: bool) -> PlattScaler:
    base_probabilities = sigmoid(logits)
    base_loss = binary_log_loss(y, base_probabilities)
    initial = np.asarray([1.0, 0.0] if allow_intercept else [1.0], dtype=np.float64)
    l2 = 1e-3

    def objective(parameters: np.ndarray) -> Tuple[float, np.ndarray]:
        slope = parameters[0]
        intercept = parameters[1] if allow_intercept else 0.0
        calibrated_logits = slope * logits + intercept
        probabilities = sigmoid(calibrated_logits)
        losses = np.logaddexp(0.0, calibrated_logits) - (y * calibrated_logits)
        value = float(losses.mean() + 0.5 * l2 * ((slope - 1.0) ** 2))
        errors = probabilities - y
        gradient = [float(np.mean(errors * logits) + l2 * (slope - 1.0))]
        if allow_intercept:
            gradient.append(float(errors.mean()))
        return value, np.asarray(gradient, dtype=np.float64)

    result = minimize(
        fun=lambda parameters: objective(parameters)[0],
        x0=initial,
        jac=lambda parameters: objective(parameters)[1],
        method="L-BFGS-B",
        options={"maxiter": 1000, "ftol": 1e-12, "gtol": 1e-8},
    )
    slope = float(result.x[0])
    intercept = float(result.x[1]) if allow_intercept else 0.0
    calibrated_probabilities = sigmoid((slope * logits) + intercept)
    calibrated_loss = binary_log_loss(y, calibrated_probabilities)
    accepted = bool(
        np.isfinite(slope)
        and np.isfinite(intercept)
        and CALIBRATION_MIN_SLOPE <= slope <= CALIBRATION_MAX_SLOPE
        and abs(intercept) <= CALIBRATION_MAX_ABS_INTERCEPT
        and calibrated_loss < base_loss
    )
    if not accepted:
        slope, intercept, calibrated_loss = 1.0, 0.0, base_loss
    return PlattScaler(
        slope=slope,
        intercept=intercept,
        accepted=accepted,
        base_log_loss=base_loss,
        calibrated_log_loss=calibrated_loss,
    )


def runtime_probabilities(runtime: Dict, current_x: np.ndarray) -> np.ndarray:
    coefficients = np.asarray(
        [finite_float((runtime.get("coefficients") or {}).get(name), 0.0) for name in CURRENT_FEATURE_NAMES],
        dtype=np.float64,
    )
    raw_logits = finite_float(runtime.get("intercept"), 0.0) + current_x @ coefficients
    raw_probabilities = sigmoid(raw_logits)
    calibration = runtime.get("calibration") or {}
    calibrated_logits = (
        finite_float(calibration.get("slope"), 1.0)
        * np.log(np.clip(raw_probabilities, 1e-6, 1.0 - 1e-6) / np.clip(1.0 - raw_probabilities, 1e-6, 1.0))
        + finite_float(calibration.get("intercept"), 0.0)
    )
    return sigmoid(calibrated_logits)


def split_game_indexes(
    game_count: int,
    fit_fraction: float,
    selection_fraction: float,
    calibration_fraction: float,
) -> Dict[str, List[int]]:
    fit_end = int(game_count * fit_fraction)
    selection_end = fit_end + int(game_count * selection_fraction)
    calibration_end = selection_end + int(game_count * calibration_fraction)
    if fit_end < 2 or selection_end <= fit_end or calibration_end <= selection_end or calibration_end >= game_count:
        raise ValueError("The chronological split leaves an empty partition.")
    return {
        "fit": list(range(0, fit_end)),
        "selection": list(range(fit_end, selection_end)),
        "calibration": list(range(selection_end, calibration_end)),
        "test": list(range(calibration_end, game_count)),
    }


def rolling_origin_folds(
    development_game_indexes: Sequence[int],
    block_games: int,
    fold_count: int = 3,
) -> List[Dict[str, List[int]]]:
    ordered = list(development_game_indexes)
    block = max(10, min(block_games, len(ordered) // (fold_count + 1)))
    initial_fit_count = len(ordered) - ((fold_count + 1) * block)
    if initial_fit_count < 50:
        raise ValueError("Not enough development games for rolling-origin model selection.")

    folds: List[Dict[str, List[int]]] = []
    for fold_index in range(fold_count):
        fit_end = initial_fit_count + (fold_index * block)
        calibration_end = fit_end + block
        validation_end = calibration_end + block
        folds.append({
            "fit": ordered[:fit_end],
            "calibration": ordered[fit_end:calibration_end],
            "validation": ordered[calibration_end:validation_end],
        })
    return folds


def date_range(games: List[Dict], indexes: Sequence[int]) -> Dict[str, Optional[str]]:
    timestamps = [games[index].get("completedAt") for index in indexes if games[index].get("completedAt")]
    return {
        "start": min(timestamps) if timestamps else None,
        "end": max(timestamps) if timestamps else None,
    }


def build_specs() -> List[CandidateSpec]:
    specs = [
        CandidateSpec("normalized_current_v1", "current", False, True),
        CandidateSpec(
            "normalized_current_v1_game_balanced",
            "current",
            False,
            True,
            game_balanced_training=True,
        ),
        CandidateSpec("normalized_current_v1_plus_strength", "current", True, True),
        CandidateSpec("symmetric_state_v2", "symmetric", False, False),
        CandidateSpec(
            "symmetric_state_v2_game_balanced",
            "symmetric",
            False,
            False,
            game_balanced_training=True,
        ),
        CandidateSpec("symmetric_state_v2_plus_strength", "symmetric", True, False),
        CandidateSpec(
            "normalized_current_v1_plus_decayed_strength",
            "current",
            True,
            True,
            decay_strength=True,
        ),
        CandidateSpec(
            "symmetric_state_v2_plus_decayed_strength",
            "symmetric",
            True,
            False,
            decay_strength=True,
        ),
    ]
    for target in (8, 16, 32):
        specs.append(CandidateSpec(
            f"normalized_current_v1_rep_t{target}",
            "current",
            False,
            True,
            representation_target=target,
        ))
        specs.append(CandidateSpec(
            f"normalized_current_v1_rep_t{target}_game_balanced",
            "current",
            False,
            True,
            representation_target=target,
            game_balanced_training=True,
        ))
        specs.append(CandidateSpec(
            f"symmetric_state_v2_rep_t{target}",
            "symmetric",
            False,
            False,
            representation_target=target,
        ))
        specs.append(CandidateSpec(
            f"symmetric_state_v2_rep_t{target}_game_balanced",
            "symmetric",
            False,
            False,
            representation_target=target,
            game_balanced_training=True,
        ))
        specs.append(CandidateSpec(
            f"normalized_current_v1_plus_decayed_strength_rep_t{target}",
            "current",
            True,
            True,
            representation_target=target,
            decay_strength=True,
        ))
        specs.append(CandidateSpec(
            f"symmetric_state_v2_plus_decayed_strength_rep_t{target}",
            "symmetric",
            True,
            False,
            representation_target=target,
            decay_strength=True,
        ))
    return specs


def fit_candidate(
    spec: CandidateSpec,
    games: List[Dict],
    dataset: RoundDataset,
    fit_games: Sequence[int],
    l2: float,
) -> Tuple[LogisticModel, Dict[str, object]]:
    rows = rows_for_games(dataset, fit_games)
    game_weights, weight_audit = representation_game_weights(
        games,
        fit_games,
        spec.representation_target,
        spec.minimum_representation_weight,
    )
    row_counts = {
        int(game_index): len(dataset.rows_by_game.get(int(game_index), ()))
        for game_index in fit_games
    }
    row_weights = np.asarray([
        game_weights[int(index)]
        / (row_counts.get(int(index), 1) if spec.game_balanced_training else 1)
        for index in dataset.game_index[rows]
    ], dtype=np.float64)
    model = fit_logistic(
        dataset.matrix(spec)[rows],
        dataset.y[rows],
        row_weights,
        spec.feature_names,
        l2,
        spec.fit_intercept,
    )
    return model, weight_audit


def paired_game_bootstrap(
    dataset: RoundDataset,
    rows: np.ndarray,
    baseline_probabilities: np.ndarray,
    candidate_probabilities: np.ndarray,
    seed: int,
    samples: int = 5000,
) -> Dict[str, float]:
    game_ids = np.unique(dataset.game_index[rows])
    baseline_losses = []
    candidate_losses = []
    for game_id in game_ids:
        mask = dataset.game_index[rows] == game_id
        labels = dataset.y[rows][mask]
        baseline_losses.append(binary_log_loss(labels, baseline_probabilities[mask]))
        candidate_losses.append(binary_log_loss(labels, candidate_probabilities[mask]))
    differences = np.asarray(baseline_losses) - np.asarray(candidate_losses)
    rng = np.random.default_rng(seed)
    indexes = rng.integers(0, len(differences), size=(samples, len(differences)))
    bootstrap_means = differences[indexes].mean(axis=1)
    return {
        "metric": "game-mean log loss improvement; positive favors candidate",
        "observedImprovement": float(differences.mean()),
        "ci95Lower": float(np.percentile(bootstrap_means, 2.5)),
        "ci95Upper": float(np.percentile(bootstrap_means, 97.5)),
        "bootstrapProbabilityCandidateIsBetter": float(np.mean(bootstrap_means > 0.0)),
        "bootstrapSamples": samples,
    }


def model_artifact(model: LogisticModel, scaler: PlattScaler, l2: float) -> Dict[str, object]:
    intercept, coefficients = model.raw_parameters()
    return {
        "featureSet": list(model.feature_names),
        "intercept": intercept,
        "coefficients": {
            name: float(value) for name, value in zip(model.feature_names, coefficients)
        },
        "fitIntercept": model.fit_intercept,
        "l2": l2,
        "optimizerConverged": model.converged,
        "optimizerIterations": model.iterations,
        "calibration": {
            "type": "platt",
            "slope": scaler.slope,
            "intercept": scaler.intercept,
            "accepted": scaler.accepted,
            "baseCalibrationLogLoss": scaler.base_log_loss,
            "calibratedCalibrationLogLoss": scaler.calibrated_log_loss,
        },
    }


def training_data_sha256(payload: Mapping[str, object]) -> str:
    """Return a stable fingerprint of only the data that can affect fitting.

    Export metadata such as ``generatedAt`` must not change a model ID when the
    normalized games themselves are identical.
    """

    canonical_payload = {
        "schemaVersion": int(payload.get("schemaVersion", 0)),
        "games": payload.get("games") or [],
    }
    canonical_bytes = json.dumps(
        canonical_payload,
        ensure_ascii=False,
        separators=(",", ":"),
        sort_keys=True,
    ).encode("utf-8")
    return hashlib.sha256(canonical_bytes).hexdigest()


def main() -> None:
    script_directory = Path(__file__).resolve().parent
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default=str(script_directory / "generated" / "games_normalized_v2.json"))
    parser.add_argument("--output", default=str(script_directory / "generated" / "candidate_training_report_v2.json"))
    parser.add_argument("--runtime", default=str(script_directory.parent / "js" / "model_runtime_v1.json"))
    parser.add_argument("--fit-frac", type=float, default=0.65)
    parser.add_argument("--selection-frac", type=float, default=0.10)
    parser.add_argument("--calibration-frac", type=float, default=0.10)
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    input_path = Path(args.input).resolve()
    output_path = Path(args.output).resolve()
    runtime_path = Path(args.runtime).resolve()
    input_bytes = input_path.read_bytes()
    payload = json.loads(input_bytes)
    if int(payload.get("schemaVersion", 0)) != 2:
        raise ValueError("Expected normalized training schema version 2.")
    games = sorted(
        payload.get("games") or [],
        key=lambda game: (str(game.get("completedAt") or ""), str(game.get("gameId") or "")),
    )
    stable_training_sha256 = training_data_sha256(payload)
    raw_snapshot_sha256 = hashlib.sha256(input_bytes).hexdigest()
    dataset = extract_round_dataset(games)
    splits = split_game_indexes(
        len(games),
        args.fit_frac,
        args.selection_frac,
        args.calibration_frac,
    )
    split_rows = {name: rows_for_games(dataset, indexes) for name, indexes in splits.items()}
    specs = build_specs()
    development_games = splits["fit"] + splits["selection"]
    model_selection_folds = rolling_origin_folds(
        development_games,
        block_games=len(splits["selection"]),
        fold_count=3,
    )

    selection_results: List[Dict[str, object]] = []
    selected_l2_by_name: Dict[str, float] = {}
    calibration_policy_by_name: Dict[str, str] = {}
    for spec in specs:
        x = dataset.matrix(spec)
        grid_results = []
        for l2 in L2_GRID:
            fold_results = []
            for fold_index, fold in enumerate(model_selection_folds):
                model, weight_audit = fit_candidate(spec, games, dataset, fold["fit"], l2)
                calibration_rows = rows_for_games(dataset, fold["calibration"])
                validation_rows = rows_for_games(dataset, fold["validation"])
                calibration_logits = model.predict_logits(x[calibration_rows])
                scaler = fit_platt_scaler(
                    calibration_logits,
                    dataset.y[calibration_rows],
                    allow_intercept=spec.fit_intercept,
                )
                validation_logits = model.predict_logits(x[validation_rows])
                raw_validation_probabilities = sigmoid(validation_logits)
                calibrated_validation_probabilities = scaler.calibrate_logits(validation_logits)
                fold_results.append({
                    "fold": fold_index + 1,
                    "fitGames": len(fold["fit"]),
                    "calibrationGames": len(fold["calibration"]),
                    "validationGames": len(fold["validation"]),
                    "validationMetricsRaw": metric_bundle(
                        dataset,
                        validation_rows,
                        raw_validation_probabilities,
                    ),
                    "validationMetricsCalibrated": metric_bundle(
                        dataset,
                        validation_rows,
                        calibrated_validation_probabilities,
                    ),
                    "calibrationAccepted": scaler.accepted,
                    "calibrationSlope": scaler.slope,
                    "calibrationIntercept": scaler.intercept,
                    "optimizerConverged": model.converged,
                    "weightAudit": weight_audit,
                })
            calibrated_mean_game_log_loss = float(np.mean([
                result["validationMetricsCalibrated"]["gameBalanced"]["logLoss"]
                for result in fold_results
            ]))
            calibrated_mean_game_brier = float(np.mean([
                result["validationMetricsCalibrated"]["gameBalanced"]["brierScore"]
                for result in fold_results
            ]))
            calibrated_mean_round_log_loss = float(np.mean([
                result["validationMetricsCalibrated"]["roundWeighted"]["logLoss"]
                for result in fold_results
            ]))
            raw_mean_game_log_loss = float(np.mean([
                result["validationMetricsRaw"]["gameBalanced"]["logLoss"]
                for result in fold_results
            ]))
            raw_mean_game_brier = float(np.mean([
                result["validationMetricsRaw"]["gameBalanced"]["brierScore"]
                for result in fold_results
            ]))
            raw_mean_round_log_loss = float(np.mean([
                result["validationMetricsRaw"]["roundWeighted"]["logLoss"]
                for result in fold_results
            ]))
            calibration_fold_wins = sum(
                result["validationMetricsCalibrated"]["gameBalanced"]["logLoss"]
                < result["validationMetricsRaw"]["gameBalanced"]["logLoss"]
                and result["validationMetricsCalibrated"]["roundWeighted"]["logLoss"]
                < result["validationMetricsRaw"]["roundWeighted"]["logLoss"]
                for result in fold_results
            )
            use_platt = (
                calibration_fold_wins >= 2
                and calibrated_mean_game_log_loss < raw_mean_game_log_loss
                and calibrated_mean_round_log_loss < raw_mean_round_log_loss
            )
            calibration_policy = "platt" if use_platt else "identity"
            chosen_mean = {
                "gameBalancedLogLoss": calibrated_mean_game_log_loss if use_platt else raw_mean_game_log_loss,
                "gameBalancedBrierScore": calibrated_mean_game_brier if use_platt else raw_mean_game_brier,
                "roundWeightedLogLoss": calibrated_mean_round_log_loss if use_platt else raw_mean_round_log_loss,
            }
            grid_results.append({
                "l2": l2,
                "calibrationPolicy": calibration_policy,
                "calibrationFoldWins": calibration_fold_wins,
                "rollingOriginMeanRaw": {
                    "gameBalancedLogLoss": raw_mean_game_log_loss,
                    "gameBalancedBrierScore": raw_mean_game_brier,
                    "roundWeightedLogLoss": raw_mean_round_log_loss,
                },
                "rollingOriginMeanCalibrated": {
                    "gameBalancedLogLoss": calibrated_mean_game_log_loss,
                    "gameBalancedBrierScore": calibrated_mean_game_brier,
                    "roundWeightedLogLoss": calibrated_mean_round_log_loss,
                },
                "rollingOriginMeanChosenPolicy": chosen_mean,
                "folds": fold_results,
            })
        best_round_log_loss = min(
            result["rollingOriginMeanChosenPolicy"]["roundWeightedLogLoss"]
            for result in grid_results
        )
        for result in grid_results:
            result["withinRoundLogLossGuardrail"] = bool(
                result["rollingOriginMeanChosenPolicy"]["roundWeightedLogLoss"]
                <= best_round_log_loss + ROUND_LOG_LOSS_SELECTION_TOLERANCE
            )
        grid_results.sort(key=lambda result: (
            not result["withinRoundLogLossGuardrail"],
            result["rollingOriginMeanChosenPolicy"]["gameBalancedLogLoss"],
            result["rollingOriginMeanChosenPolicy"]["gameBalancedBrierScore"],
            result["rollingOriginMeanChosenPolicy"]["roundWeightedLogLoss"],
        ))
        selected_l2_by_name[spec.name] = float(grid_results[0]["l2"])
        calibration_policy_by_name[spec.name] = str(grid_results[0]["calibrationPolicy"])
        selection_results.append({
            "name": spec.name,
            "stateFamily": spec.state_family,
            "includesPregameStrength": spec.include_strength,
            "strengthEvidenceDecay": spec.decay_strength,
            "representationTarget": spec.representation_target,
            "gameBalancedTraining": spec.game_balanced_training,
            "fitIntercept": spec.fit_intercept,
            "selectedL2": grid_results[0]["l2"],
            "selectedCalibrationPolicy": grid_results[0]["calibrationPolicy"],
            "bestRollingOriginMean": grid_results[0]["rollingOriginMeanChosenPolicy"],
            "grid": grid_results,
        })

    best_round_log_loss = min(
        result["bestRollingOriginMean"]["roundWeightedLogLoss"]
        for result in selection_results
    )
    for result in selection_results:
        result["withinRoundLogLossGuardrail"] = bool(
            result["bestRollingOriginMean"]["roundWeightedLogLoss"]
            <= best_round_log_loss + ROUND_LOG_LOSS_SELECTION_TOLERANCE
        )
    selection_results.sort(key=lambda result: (
        not result["withinRoundLogLossGuardrail"],
        result["bestRollingOriginMean"]["gameBalancedLogLoss"],
        result["bestRollingOriginMean"]["gameBalancedBrierScore"],
        result["bestRollingOriginMean"]["roundWeightedLogLoss"],
    ))
    selected_name = str(selection_results[0]["name"])
    final_fit_games = development_games
    final_results: List[Dict[str, object]] = []
    final_models: Dict[str, Tuple[LogisticModel, PlattScaler]] = {}

    for spec in specs:
        l2 = selected_l2_by_name[spec.name]
        model, weight_audit = fit_candidate(spec, games, dataset, final_fit_games, l2)
        x = dataset.matrix(spec)
        calibration_logits = model.predict_logits(x[split_rows["calibration"]])
        attempted_scaler = fit_platt_scaler(
            calibration_logits,
            dataset.y[split_rows["calibration"]],
            allow_intercept=spec.fit_intercept,
        )
        if calibration_policy_by_name[spec.name] == "platt":
            scaler = attempted_scaler
        else:
            base_calibration_loss = binary_log_loss(
                dataset.y[split_rows["calibration"]],
                sigmoid(calibration_logits),
            )
            scaler = PlattScaler(
                slope=1.0,
                intercept=0.0,
                accepted=False,
                base_log_loss=base_calibration_loss,
                calibrated_log_loss=base_calibration_loss,
            )
        test_logits = model.predict_logits(x[split_rows["test"]])
        raw_probabilities = sigmoid(test_logits)
        calibrated_probabilities = scaler.calibrate_logits(test_logits)
        final_models[spec.name] = (model, scaler)
        final_results.append({
            "name": spec.name,
            "selectedBeforeTest": spec.name == selected_name,
            "calibrationPolicySelectedByRollingOrigin": calibration_policy_by_name[spec.name],
            "attemptedFinalCalibration": {
                "slope": attempted_scaler.slope,
                "intercept": attempted_scaler.intercept,
                "acceptedOnFinalCalibrationPartition": attempted_scaler.accepted,
                "baseLogLoss": attempted_scaler.base_log_loss,
                "calibratedLogLoss": attempted_scaler.calibrated_log_loss,
            },
            "testMetricsRaw": metric_bundle(dataset, split_rows["test"], raw_probabilities),
            "testMetricsCalibrated": metric_bundle(dataset, split_rows["test"], calibrated_probabilities),
            "weightAuditFinalFit": weight_audit,
            "model": model_artifact(model, scaler, l2),
        })

    runtime = json.loads(runtime_path.read_text())
    test_current_x = dataset.current_x[split_rows["test"]]
    baseline_probabilities = runtime_probabilities(runtime, test_current_x)
    baseline_metrics = metric_bundle(dataset, split_rows["test"], baseline_probabilities)

    selected_spec = next(spec for spec in specs if spec.name == selected_name)
    selected_model, selected_scaler = final_models[selected_name]
    selected_logits = selected_model.predict_logits(dataset.matrix(selected_spec)[split_rows["test"]])
    selected_probabilities = selected_scaler.calibrate_logits(selected_logits)
    selected_metrics = metric_bundle(dataset, split_rows["test"], selected_probabilities)
    bootstrap = paired_game_bootstrap(
        dataset,
        split_rows["test"],
        baseline_probabilities,
        selected_probabilities,
        args.seed,
    )

    selected_round_metrics = selected_metrics["roundWeighted"]
    baseline_round_metrics = baseline_metrics["roundWeighted"]
    selected_game_metrics = selected_metrics["gameBalanced"]
    baseline_game_metrics = baseline_metrics["gameBalanced"]
    passes_point_estimates = (
        selected_round_metrics["logLoss"] < baseline_round_metrics["logLoss"]
        and selected_round_metrics["brierScore"] <= baseline_round_metrics["brierScore"]
        and selected_game_metrics["logLoss"] < baseline_game_metrics["logLoss"]
        and selected_game_metrics["brierScore"] <= baseline_game_metrics["brierScore"]
    )
    promotion_ready = passes_point_estimates and bootstrap["ci95Lower"] > 0.0

    # Once the model family, regularization, and calibration policy have been
    # locked and the untouched holdout has been scored, refit the deployable
    # state model on every valid game.  This artifact is deliberately separate
    # from the holdout artifact above: it learns from the holdout only after the
    # reported evaluation is complete and must never be used to recalculate
    # those test metrics.
    deployment_model, deployment_weight_audit = fit_candidate(
        selected_spec,
        games,
        dataset,
        list(range(len(games))),
        selected_l2_by_name[selected_name],
    )
    deployment_artifact = model_artifact(
        deployment_model,
        selected_scaler,
        selected_l2_by_name[selected_name],
    )

    output = {
        "schemaVersion": 2,
        "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "purpose": "experimental candidate training; production runtime is not replaced",
        "safety": {
            "firebaseRead": False,
            "firebaseMutated": False,
            "productionRuntimeReplaced": False,
            "terminalRoundsExcluded": True,
            "rawIdentitiesPresent": False,
            "outcomeBasedSampleWeighting": False,
        },
        "data": {
            "normalizedInput": str(input_path),
            "normalizedInputSha256": stable_training_sha256,
            "trainingDataSha256": stable_training_sha256,
            "rawSnapshotSha256": raw_snapshot_sha256,
            "fingerprintExcludesExportMetadata": True,
            "logicalGames": len(games),
            "nonTerminalRoundObservations": int(len(dataset.y)),
            "quarantinedGames": len(payload.get("quarantine") or []),
        },
        "split": {
            "method": "rolling-origin model selection inside development data, then final calibration and untouched chronological test",
            "selectionCriterion": "protect round-level log loss within 0.001 of the best rolling-origin result, then minimize game-balanced log loss and Brier score; calibration is used only when it improves both round- and game-weighted log loss in at least two folds",
            "roundLogLossSelectionTolerance": ROUND_LOG_LOSS_SELECTION_TOLERANCE,
            "modelSelectionFolds": [
                {
                    "fold": index + 1,
                    "fitGames": len(fold["fit"]),
                    "calibrationGames": len(fold["calibration"]),
                    "validationGames": len(fold["validation"]),
                    "fitDateRange": date_range(games, fold["fit"]),
                    "calibrationDateRange": date_range(games, fold["calibration"]),
                    "validationDateRange": date_range(games, fold["validation"]),
                }
                for index, fold in enumerate(model_selection_folds)
            ],
            **{
                name: {
                    "games": len(indexes),
                    "observations": int(len(split_rows[name])),
                    "dateRange": date_range(games, indexes),
                }
                for name, indexes in splits.items()
            },
        },
        "calibrationGuardrails": {
            "minimumSlope": CALIBRATION_MIN_SLOPE,
            "maximumSlope": CALIBRATION_MAX_SLOPE,
            "maximumAbsoluteIntercept": CALIBRATION_MAX_ABS_INTERCEPT,
            "rationale": "reject large corrections estimated from a small, correlated calibration block",
        },
        "selectionResults": selection_results,
        "selectedCandidate": {
            "name": selected_name,
            "selectedWithoutTestLabels": True,
            "testMetricsCalibrated": selected_metrics,
            "versusCurrentRuntime": {
                "roundLogLossImprovement": baseline_round_metrics["logLoss"] - selected_round_metrics["logLoss"],
                "roundBrierImprovement": baseline_round_metrics["brierScore"] - selected_round_metrics["brierScore"],
                "roundAccuracyChange": selected_round_metrics["accuracy"] - baseline_round_metrics["accuracy"],
                "gameBalancedLogLossImprovement": baseline_game_metrics["logLoss"] - selected_game_metrics["logLoss"],
                "gameBalancedBrierImprovement": baseline_game_metrics["brierScore"] - selected_game_metrics["brierScore"],
                "gameBalancedAccuracyChange": selected_game_metrics["accuracy"] - baseline_game_metrics["accuracy"],
                "pairedGameBootstrap": bootstrap,
            },
        },
        "currentProductionRuntimeBaseline": {
            "modelId": runtime.get("modelId"),
            "testMetrics": baseline_metrics,
        },
        "deploymentRefit": {
            "createdOnlyAfterUntouchedTestEvaluation": True,
            "mustNotBeUsedForReportedTestMetrics": True,
            "fitGames": len(games),
            "fitRoundObservations": int(len(dataset.y)),
            "selectedModelName": selected_name,
            "selectedL2": selected_l2_by_name[selected_name],
            "calibrationParametersSource": (
                "locked pre-test calibration policy and final calibration partition"
                if selected_scaler.accepted
                else "identity calibration selected by rolling-origin validation"
            ),
            "weightAudit": deployment_weight_audit,
            "model": deployment_artifact,
        },
        "allCandidateTestResults": final_results,
        "promotionGate": {
            "status": "pass" if promotion_ready else "hold",
            "requiresRoundAndGameBalancedLogLossAndBrierImprovement": passes_point_estimates,
            "requiresPositivePairedGameBootstrapLowerBound": bootstrap["ci95Lower"] > 0.0,
            "recommendation": (
                "Candidate cleared the offline gate; perform app-level replay and runtime compatibility tests before publishing."
                if promotion_ready
                else "Keep the candidate experimental; do not replace the production runtime from this run."
            ),
        },
    }

    output_path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    output_path.write_text(json.dumps(output, indent=2) + "\n")
    os.chmod(output_path, 0o600)
    print(json.dumps({
        "reportPath": str(output_path),
        "selectedCandidate": selected_name,
        "testGames": len(splits["test"]),
        "testObservations": int(len(split_rows["test"])),
        "currentRuntime": baseline_round_metrics,
        "candidate": selected_round_metrics,
        "promotionGate": output["promotionGate"]["status"],
        "productionRuntimeReplaced": False,
        "firebaseMutated": False,
    }, indent=2))


if __name__ == "__main__":
    main()
