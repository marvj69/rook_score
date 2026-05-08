"""Enhanced logistic modeling with CV tuning, calibration, and holdout reporting."""

from __future__ import annotations

import argparse
import itertools
import json
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Tuple

import numpy as np


FEATURE_NAMES: Tuple[str, ...] = (
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


@dataclass(frozen=True)
class FeatureLogisticModel:
    feature_names: Tuple[str, ...]
    intercept: float
    coefficients: Tuple[float, ...]

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        weights = np.asarray(self.coefficients, dtype=np.float64)
        logits = self.intercept + x @ weights
        return sigmoid(logits)


@dataclass(frozen=True)
class PlattScaler:
    slope: float = 1.0
    intercept: float = 0.0

    def calibrate(self, probs: np.ndarray) -> np.ndarray:
        clipped = np.clip(probs, 1e-6, 1.0 - 1e-6)
        logits = np.log(clipped / (1.0 - clipped))
        return sigmoid(self.slope * logits + self.intercept)


@dataclass
class RoundDataset:
    x: np.ndarray
    y: np.ndarray
    game_index: np.ndarray
    round_index: np.ndarray
    diff: np.ndarray
    momentum: np.ndarray
    row_indices_by_game: Dict[int, np.ndarray]


def sigmoid(z: np.ndarray) -> np.ndarray:
    return 1.0 / (1.0 + np.exp(-np.clip(z, -60.0, 60.0)))


def safe_float(value: object) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def safe_round_index(round_obj: Dict, fallback: int) -> int:
    try:
        value = round_obj.get("roundIndex")
        if value is None:
            return fallback
        return max(0, int(value))
    except (TypeError, ValueError):
        return fallback


def normalize_bidding_team(value: object) -> str:
    if not isinstance(value, str):
        return ""
    normalized = value.strip().lower()
    if normalized in {"us", "dem"}:
        return normalized
    return ""


def parse_timestamp(value: Optional[str]) -> datetime:
    if not value:
        return datetime.min.replace(tzinfo=timezone.utc)
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return datetime.min.replace(tzinfo=timezone.utc)


def make_feature_vector(
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


def extract_round_dataset(game_data: List[Dict]) -> RoundDataset:
    x_rows: List[np.ndarray] = []
    y_rows: List[float] = []
    game_rows: List[int] = []
    round_rows: List[int] = []
    diff_rows: List[float] = []
    momentum_rows: List[float] = []
    row_indices_by_game: Dict[int, List[int]] = {}

    for game_index, game in enumerate(game_data):
        label = 1.0 if game.get("winner") == "us" else 0.0
        previous_diff = 0.0
        rounds = sorted(
            enumerate(game.get("rounds", [])),
            key=lambda item: (safe_round_index(item[1], item[0]), item[0]),
        )

        for fallback_index, round_obj in rounds:
            round_index = safe_round_index(round_obj, fallback_index)
            totals = round_obj.get("runningTotals", {})
            us_total = safe_float(totals.get("us"))
            dem_total = safe_float(totals.get("dem"))

            diff = us_total - dem_total
            momentum = 0.0 if round_index == 0 else diff - previous_diff
            previous_diff = diff

            bid_amount = safe_float(round_obj.get("bidAmount"))
            bidding_team = normalize_bidding_team(round_obj.get("biddingTeam"))
            bidding_team_sign = 1.0 if bidding_team == "us" else (-1.0 if bidding_team == "dem" else 0.0)

            us_points = safe_float(round_obj.get("usPoints"))
            dem_points = safe_float(round_obj.get("demPoints"))
            point_delta = us_points - dem_points

            x_rows.append(
                make_feature_vector(
                    round_index=round_index,
                    diff=diff,
                    momentum=momentum,
                    bid_amount=bid_amount,
                    bidding_team_sign=bidding_team_sign,
                    point_delta=point_delta,
                )
            )
            y_rows.append(label)
            game_rows.append(game_index)
            round_rows.append(round_index)
            diff_rows.append(diff)
            momentum_rows.append(momentum)

            row_id = len(y_rows) - 1
            row_indices_by_game.setdefault(game_index, []).append(row_id)

    x = np.vstack(x_rows) if x_rows else np.empty((0, len(FEATURE_NAMES)), dtype=np.float64)
    y = np.asarray(y_rows, dtype=np.float64)
    game_index = np.asarray(game_rows, dtype=np.int64)
    round_index = np.asarray(round_rows, dtype=np.int64)
    diff = np.asarray(diff_rows, dtype=np.float64)
    momentum = np.asarray(momentum_rows, dtype=np.float64)
    row_map = {g: np.asarray(rows, dtype=np.int64) for g, rows in row_indices_by_game.items()}

    return RoundDataset(
        x=x,
        y=y,
        game_index=game_index,
        round_index=round_index,
        diff=diff,
        momentum=momentum,
        row_indices_by_game=row_map,
    )


def rows_for_games(row_indices_by_game: Dict[int, np.ndarray], game_indices: Sequence[int]) -> np.ndarray:
    chunks = [row_indices_by_game[g] for g in game_indices if g in row_indices_by_game]
    if not chunks:
        return np.empty(0, dtype=np.int64)
    return np.concatenate(chunks)


def fit_logistic_regression(
    x: np.ndarray,
    y: np.ndarray,
    feature_names: Sequence[str],
    lr: float,
    epochs: int,
    l2: float,
) -> FeatureLogisticModel:
    if x.size == 0:
        raise ValueError("Cannot fit logistic regression with no samples.")

    n_samples = float(x.shape[0])
    means = x.mean(axis=0)
    stds = x.std(axis=0)
    stds = np.where(stds > 0.0, stds, 1.0)
    x_norm = (x - means) / stds

    weights = np.zeros(x.shape[1], dtype=np.float64)
    bias = 0.0

    for _ in range(epochs):
        logits = bias + x_norm @ weights
        probs = sigmoid(logits)
        errors = probs - y
        grad_w = (x_norm.T @ errors) / n_samples + l2 * weights
        grad_b = float(errors.mean())
        weights -= lr * grad_w
        bias -= lr * grad_b

    coeff_raw = weights / stds
    intercept_raw = bias - float(np.sum((weights * means) / stds))

    return FeatureLogisticModel(
        feature_names=tuple(feature_names),
        intercept=float(intercept_raw),
        coefficients=tuple(float(v) for v in coeff_raw),
    )


def log_loss(y_true: np.ndarray, probs: np.ndarray) -> float:
    clipped = np.clip(probs, 1e-12, 1.0 - 1e-12)
    return float(-(y_true * np.log(clipped) + (1.0 - y_true) * np.log(1.0 - clipped)).mean())


def brier_score(y_true: np.ndarray, probs: np.ndarray) -> float:
    return float(np.mean((probs - y_true) ** 2))


def accuracy(y_true: np.ndarray, probs: np.ndarray) -> float:
    return float(np.mean((probs >= 0.5) == (y_true >= 0.5)))


def metric_bundle(y_true: np.ndarray, probs: np.ndarray) -> Dict[str, float]:
    return {
        "accuracy": accuracy(y_true, probs),
        "logLoss": log_loss(y_true, probs),
        "brierScore": brier_score(y_true, probs),
    }


def timestamp_range(game_data: List[Dict], game_indices: Sequence[int]) -> Dict[str, Optional[str]]:
    timestamps = [game_data[i].get("timestamp") for i in game_indices if game_data[i].get("timestamp")]
    if not timestamps:
        return {"start": None, "end": None}
    ordered = sorted(timestamps)
    return {"start": ordered[0], "end": ordered[-1]}


def split_games_by_timestamp(
    game_data: List[Dict],
    train_frac: float,
    calib_frac: float,
) -> Tuple[List[int], List[int], List[int]]:
    ordered_indices = sorted(range(len(game_data)), key=lambda i: parse_timestamp(game_data[i].get("timestamp")))
    n_games = len(ordered_indices)

    train_n = max(1, int(n_games * train_frac))
    calib_n = max(1, int(n_games * calib_frac))
    if train_n + calib_n >= n_games:
        calib_n = max(1, n_games - train_n - 1)
        if train_n + calib_n >= n_games:
            train_n = max(1, n_games - 2)
            calib_n = 1

    train_games = ordered_indices[:train_n]
    calib_games = ordered_indices[train_n : train_n + calib_n]
    test_games = ordered_indices[train_n + calib_n :]
    if not test_games and calib_games:
        test_games = [calib_games.pop()]
    elif not test_games and train_games:
        test_games = [train_games.pop()]

    return train_games, calib_games, test_games


def stratified_game_folds(
    game_data: List[Dict],
    game_indices: Sequence[int],
    folds: int,
    seed: int,
) -> List[Tuple[int, ...]]:
    if len(game_indices) < 2:
        raise ValueError("Need at least 2 games to create CV folds.")

    effective_folds = max(2, min(folds, len(game_indices)))
    us_games = [g for g in game_indices if game_data[g].get("winner") == "us"]
    dem_games = [g for g in game_indices if game_data[g].get("winner") != "us"]

    rng = np.random.default_rng(seed)
    rng.shuffle(us_games)
    rng.shuffle(dem_games)

    buckets: List[List[int]] = [[] for _ in range(effective_folds)]
    for i, game_idx in enumerate(us_games):
        buckets[i % effective_folds].append(game_idx)
    for i, game_idx in enumerate(dem_games):
        buckets[i % effective_folds].append(game_idx)

    non_empty = [tuple(bucket) for bucket in buckets if bucket]
    if len(non_empty) < 2:
        midpoint = len(game_indices) // 2
        return [tuple(game_indices[:midpoint]), tuple(game_indices[midpoint:])]
    return non_empty


def cv_row_splits(
    dataset: RoundDataset,
    game_data: List[Dict],
    game_indices: Sequence[int],
    folds: int,
    seed: int,
) -> List[Tuple[np.ndarray, np.ndarray]]:
    buckets = stratified_game_folds(game_data, game_indices, folds, seed)
    all_games = list(game_indices)
    splits: List[Tuple[np.ndarray, np.ndarray]] = []

    for val_games in buckets:
        val_set = set(val_games)
        train_games = [g for g in all_games if g not in val_set]
        train_rows = rows_for_games(dataset.row_indices_by_game, train_games)
        val_rows = rows_for_games(dataset.row_indices_by_game, val_games)
        if train_rows.size == 0 or val_rows.size == 0:
            continue
        splits.append((train_rows, val_rows))

    if len(splits) < 2:
        raise ValueError("Unable to build enough CV splits from the provided data.")
    return splits


def parse_float_grid(value: str) -> List[float]:
    return [float(part.strip()) for part in value.split(",") if part.strip()]


def parse_int_grid(value: str) -> List[int]:
    return [int(part.strip()) for part in value.split(",") if part.strip()]


def tune_hyperparameters(
    dataset: RoundDataset,
    game_data: List[Dict],
    train_games: Sequence[int],
    cv_folds: int,
    seed: int,
    lr_grid: Sequence[float],
    epochs_grid: Sequence[int],
    l2_grid: Sequence[float],
) -> Tuple[Dict[str, float], List[Dict[str, float]], int]:
    splits = cv_row_splits(dataset, game_data, train_games, cv_folds, seed)
    results: List[Dict[str, float]] = []

    for lr, epochs, l2 in itertools.product(lr_grid, epochs_grid, l2_grid):
        fold_losses: List[float] = []
        fold_accs: List[float] = []
        for train_rows, val_rows in splits:
            model = fit_logistic_regression(
                dataset.x[train_rows],
                dataset.y[train_rows],
                FEATURE_NAMES,
                lr=lr,
                epochs=epochs,
                l2=l2,
            )
            probs = model.predict_proba(dataset.x[val_rows])
            fold_losses.append(log_loss(dataset.y[val_rows], probs))
            fold_accs.append(accuracy(dataset.y[val_rows], probs))

        results.append(
            {
                "learningRate": float(lr),
                "epochs": int(epochs),
                "l2": float(l2),
                "cvLogLoss": float(np.mean(fold_losses)),
                "cvAccuracy": float(np.mean(fold_accs)),
            }
        )

    results.sort(key=lambda item: item["cvLogLoss"])
    best = results[0]
    return best, results, len(splits)


def fit_platt_scaler(
    raw_probs: np.ndarray,
    y_true: np.ndarray,
    lr: float = 0.05,
    epochs: int = 4000,
    l2: float = 1e-3,
) -> PlattScaler:
    if raw_probs.size < 20:
        return PlattScaler()

    clipped = np.clip(raw_probs, 1e-6, 1.0 - 1e-6)
    logits = np.log(clipped / (1.0 - clipped))

    slope = 1.0
    intercept = 0.0
    n_samples = float(len(logits))

    for _ in range(epochs):
        z = slope * logits + intercept
        probs = sigmoid(z)
        errors = probs - y_true
        grad_slope = float((errors * logits).sum() / n_samples + l2 * slope)
        grad_intercept = float(errors.mean())
        slope -= lr * grad_slope
        intercept -= lr * grad_intercept

    return PlattScaler(slope=float(slope), intercept=float(intercept))


def select_platt_scaler(raw_probs: np.ndarray, y_true: np.ndarray) -> Tuple[PlattScaler, Dict[str, object]]:
    candidate = fit_platt_scaler(raw_probs, y_true)
    base_log_loss = log_loss(y_true, raw_probs)
    calibrated_probs = candidate.calibrate(raw_probs)
    calibrated_log_loss = log_loss(y_true, calibrated_probs)

    if calibrated_log_loss <= base_log_loss:
        return (
            candidate,
            {
                "usedCalibrated": True,
                "baseLogLoss": base_log_loss,
                "calibratedLogLoss": calibrated_log_loss,
            },
        )

    return (
        PlattScaler(),
        {
            "usedCalibrated": False,
            "baseLogLoss": base_log_loss,
            "calibratedLogLoss": calibrated_log_loss,
        },
    )


def out_of_fold_raw_predictions(
    dataset: RoundDataset,
    game_data: List[Dict],
    game_indices: Sequence[int],
    cv_folds: int,
    seed: int,
    learning_rate: float,
    epochs: int,
    l2: float,
) -> Tuple[np.ndarray, np.ndarray]:
    splits = cv_row_splits(dataset, game_data, game_indices, cv_folds, seed)
    oof_probs: List[np.ndarray] = []
    oof_labels: List[np.ndarray] = []

    for train_rows, val_rows in splits:
        model = fit_logistic_regression(
            dataset.x[train_rows],
            dataset.y[train_rows],
            FEATURE_NAMES,
            lr=learning_rate,
            epochs=epochs,
            l2=l2,
        )
        oof_probs.append(model.predict_proba(dataset.x[val_rows]))
        oof_labels.append(dataset.y[val_rows])

    return np.concatenate(oof_probs), np.concatenate(oof_labels)


def per_round_metrics(round_index: np.ndarray, y_true: np.ndarray, probs: np.ndarray) -> List[Dict]:
    results: List[Dict] = []
    for round_value in sorted(int(v) for v in np.unique(round_index)):
        mask = round_index == round_value
        if not np.any(mask):
            continue
        y_slice = y_true[mask]
        p_slice = probs[mask]
        results.append(
            {
                "roundIndex": round_value,
                "samples": int(mask.sum()),
                "accuracy": accuracy(y_slice, p_slice),
                "logLoss": log_loss(y_slice, p_slice),
                "brierScore": brier_score(y_slice, p_slice),
            }
        )
    return results


def reliability_bins(y_true: np.ndarray, probs: np.ndarray, num_bins: int = 10) -> List[Dict]:
    bins = np.linspace(0.0, 1.0, num_bins + 1)
    output: List[Dict] = []
    for i in range(num_bins):
        lower = bins[i]
        upper = bins[i + 1]
        if i == num_bins - 1:
            mask = (probs >= lower) & (probs <= upper)
        else:
            mask = (probs >= lower) & (probs < upper)
        if not np.any(mask):
            continue
        y_slice = y_true[mask]
        p_slice = probs[mask]
        output.append(
            {
                "binStart": float(lower),
                "binEnd": float(upper),
                "samples": int(mask.sum()),
                "avgPredictedProb": float(p_slice.mean()),
                "actualUsWinRate": float(y_slice.mean()),
            }
        )
    return output


def final_round_accuracy(dataset: RoundDataset, rows: np.ndarray, probs: np.ndarray) -> Optional[float]:
    if rows.size == 0:
        return None

    final_by_game: Dict[int, Tuple[int, float, float]] = {}
    for pos, row_id in enumerate(rows):
        game_idx = int(dataset.game_index[row_id])
        round_idx = int(dataset.round_index[row_id])
        prob = float(probs[pos])
        y_val = float(dataset.y[row_id])
        existing = final_by_game.get(game_idx)
        if existing is None or round_idx > existing[0]:
            final_by_game[game_idx] = (round_idx, prob, y_val)

    if not final_by_game:
        return None
    correct = sum((entry[1] >= 0.5) == (entry[2] == 1.0) for entry in final_by_game.values())
    return correct / len(final_by_game)


def build_predictions_by_game(
    game_data: List[Dict],
    dataset: RoundDataset,
    raw_probs_all: np.ndarray,
    calibrated_probs_all: np.ndarray,
) -> List[Dict]:
    predictions: List[Dict] = []
    for game_idx, game in enumerate(game_data):
        rows = dataset.row_indices_by_game.get(game_idx, np.empty(0, dtype=np.int64))
        if rows.size > 0:
            sorted_rows = rows[np.argsort(dataset.round_index[rows])]
        else:
            sorted_rows = rows

        round_predictions: List[Dict] = []
        for row_id in sorted_rows:
            round_predictions.append(
                {
                    "roundIndex": int(dataset.round_index[row_id]),
                    "diff": float(dataset.diff[row_id]),
                    "momentum": float(dataset.momentum[row_id]),
                    "probUsWinRaw": float(raw_probs_all[row_id]),
                    "probUsWin": float(calibrated_probs_all[row_id]),
                }
            )

        final_prob = round_predictions[-1]["probUsWin"] if round_predictions else None
        predicted_winner = None if final_prob is None else ("us" if final_prob >= 0.5 else "dem")

        predictions.append(
            {
                "gameIndex": game_idx,
                "timestamp": game.get("timestamp"),
                "usTeamName": game.get("usTeamName"),
                "demTeamName": game.get("demTeamName"),
                "actualWinner": game.get("winner"),
                "predictedWinnerFromFinalRound": predicted_winner,
                "finalRoundProbUsWin": final_prob,
                "roundPredictions": round_predictions,
            }
        )

    return predictions


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--input", default="games_extracted_saved_only.json")
    parser.add_argument("--output", default="model_output.json")
    parser.add_argument("--runtime-output", default=None)
    parser.add_argument("--train-frac", type=float, default=0.70)
    parser.add_argument("--calib-frac", type=float, default=0.15)
    parser.add_argument("--cv-folds", type=int, default=5)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--lr-grid", default="0.03,0.05,0.1")
    parser.add_argument("--epochs-grid", default="4000,7000")
    parser.add_argument("--l2-grid", default="1e-5,1e-4,1e-3,1e-2")
    args = parser.parse_args()

    input_path = Path(args.input)
    output_path = Path(args.output)
    if args.runtime_output:
        runtime_output_path = Path(args.runtime_output)
    else:
        repo_root = Path(__file__).resolve().parent.parent
        runtime_output_path = repo_root / "js" / "model_runtime_v1.json"

    data = json.loads(input_path.read_text())
    game_data = data["gameData"]
    dataset = extract_round_dataset(game_data)

    train_games, calib_games, test_games = split_games_by_timestamp(
        game_data=game_data,
        train_frac=args.train_frac,
        calib_frac=args.calib_frac,
    )

    lr_grid = parse_float_grid(args.lr_grid)
    epochs_grid = parse_int_grid(args.epochs_grid)
    l2_grid = parse_float_grid(args.l2_grid)

    best_params, tuning_results, actual_cv_folds = tune_hyperparameters(
        dataset=dataset,
        game_data=game_data,
        train_games=train_games,
        cv_folds=args.cv_folds,
        seed=args.seed,
        lr_grid=lr_grid,
        epochs_grid=epochs_grid,
        l2_grid=l2_grid,
    )

    train_rows = rows_for_games(dataset.row_indices_by_game, train_games)
    calib_rows = rows_for_games(dataset.row_indices_by_game, calib_games)
    test_rows = rows_for_games(dataset.row_indices_by_game, test_games)

    holdout_model = fit_logistic_regression(
        dataset.x[train_rows],
        dataset.y[train_rows],
        FEATURE_NAMES,
        lr=best_params["learningRate"],
        epochs=int(best_params["epochs"]),
        l2=best_params["l2"],
    )

    if calib_rows.size > 0:
        calib_raw = holdout_model.predict_proba(dataset.x[calib_rows])
        holdout_scaler, holdout_calibration_decision = select_platt_scaler(calib_raw, dataset.y[calib_rows])
    else:
        holdout_scaler = PlattScaler()
        holdout_calibration_decision = {
            "usedCalibrated": False,
            "baseLogLoss": 0.0,
            "calibratedLogLoss": 0.0,
        }

    if test_rows.size > 0:
        test_raw = holdout_model.predict_proba(dataset.x[test_rows])
        test_calibrated = holdout_scaler.calibrate(test_raw)
        test_y = dataset.y[test_rows]
        test_round_idx = dataset.round_index[test_rows]

        holdout_evaluation = {
            "testMetricsRaw": metric_bundle(test_y, test_raw),
            "testMetricsCalibrated": metric_bundle(test_y, test_calibrated),
            "finalRoundAccuracyRaw": final_round_accuracy(dataset, test_rows, test_raw),
            "finalRoundAccuracyCalibrated": final_round_accuracy(dataset, test_rows, test_calibrated),
            "calibrationSetDecision": holdout_calibration_decision,
            "perRoundMetricsRaw": per_round_metrics(test_round_idx, test_y, test_raw),
            "perRoundMetricsCalibrated": per_round_metrics(test_round_idx, test_y, test_calibrated),
            "reliabilityCalibrated": reliability_bins(test_y, test_calibrated, num_bins=10),
        }
    else:
        holdout_evaluation = {
            "testMetricsRaw": None,
            "testMetricsCalibrated": None,
            "finalRoundAccuracyRaw": None,
            "finalRoundAccuracyCalibrated": None,
            "calibrationSetDecision": holdout_calibration_decision,
            "perRoundMetricsRaw": [],
            "perRoundMetricsCalibrated": [],
            "reliabilityCalibrated": [],
        }

    train_plus_cal_games = train_games + calib_games
    train_plus_cal_rows = rows_for_games(dataset.row_indices_by_game, train_plus_cal_games)
    production_model = fit_logistic_regression(
        dataset.x[train_plus_cal_rows],
        dataset.y[train_plus_cal_rows],
        FEATURE_NAMES,
        lr=best_params["learningRate"],
        epochs=int(best_params["epochs"]),
        l2=best_params["l2"],
    )

    oof_probs, oof_labels = out_of_fold_raw_predictions(
        dataset=dataset,
        game_data=game_data,
        game_indices=train_plus_cal_games,
        cv_folds=args.cv_folds,
        seed=args.seed + 17,
        learning_rate=best_params["learningRate"],
        epochs=int(best_params["epochs"]),
        l2=best_params["l2"],
    )
    production_scaler, production_calibration_decision = select_platt_scaler(oof_probs, oof_labels)

    raw_probs_all = production_model.predict_proba(dataset.x)
    calibrated_probs_all = production_scaler.calibrate(raw_probs_all)
    predictions_by_game = build_predictions_by_game(
        game_data=game_data,
        dataset=dataset,
        raw_probs_all=raw_probs_all,
        calibrated_probs_all=calibrated_probs_all,
    )

    output = {
        "featureSet": list(FEATURE_NAMES),
        "split": {
            "method": "timestamp",
            "trainGames": len(train_games),
            "calibrationGames": len(calib_games),
            "testGames": len(test_games),
            "trainTimestampRange": timestamp_range(game_data, train_games),
            "calibrationTimestampRange": timestamp_range(game_data, calib_games),
            "testTimestampRange": timestamp_range(game_data, test_games),
        },
        "hyperparameterSearch": {
            "cvFolds": actual_cv_folds,
            "learningRateGrid": lr_grid,
            "epochsGrid": epochs_grid,
            "l2Grid": l2_grid,
            "bestParams": best_params,
            "allResultsSorted": tuning_results,
        },
        "holdoutEvaluation": holdout_evaluation,
        "productionModel": {
            "intercept": production_model.intercept,
            "coefficients": {
                feature: coefficient
                for feature, coefficient in zip(production_model.feature_names, production_model.coefficients)
            },
            "calibration": {
                "type": "platt",
                "slope": production_scaler.slope,
                "intercept": production_scaler.intercept,
                "oofDecision": production_calibration_decision,
            },
        },
        "summary": {
            "games": len(game_data),
            "roundSamples": int(len(dataset.y)),
            "overallRoundMetricsCalibrated": metric_bundle(dataset.y, calibrated_probs_all),
        },
        "predictionsByGame": predictions_by_game,
    }

    output_path.write_text(json.dumps(output, indent=2))

    runtime_model = {
        "schemaVersion": 1,
        "modelId": f"prod-{output['summary']['games']}g-{output['summary']['roundSamples']}r",
        "featureSet": list(FEATURE_NAMES),
        "intercept": production_model.intercept,
        "coefficients": {
            feature: coefficient
            for feature, coefficient in zip(production_model.feature_names, production_model.coefficients)
        },
        "calibration": {
            "type": "platt",
            "slope": production_scaler.slope,
            "intercept": production_scaler.intercept,
        },
        "metadata": {
            "generatedAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
            "games": int(output["summary"]["games"]),
            "roundSamples": int(output["summary"]["roundSamples"]),
        },
    }
    runtime_output_path.parent.mkdir(parents=True, exist_ok=True)
    runtime_output_path.write_text(json.dumps(runtime_model, indent=2))

    print(f"Saved output to: {output_path}")
    print(f"Saved runtime model to: {runtime_output_path}")
    print("Best params:", best_params)
    print("Holdout (calibrated):", holdout_evaluation["testMetricsCalibrated"])
    print("Overall (calibrated):", output["summary"]["overallRoundMetricsCalibrated"])


if __name__ == "__main__":
    main()
