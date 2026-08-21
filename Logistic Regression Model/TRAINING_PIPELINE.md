# Rook probability training pipeline

This pipeline builds a private, normalized training snapshot and evaluates new
probability candidates without changing the live app model.

## Run it

```sh
npm run training:normalize:live
npm run training:candidate
npm run training:replay
npm run training:test
```

Or run the complete read-only export, training, replay, and verification flow:

```sh
npm run training:run
```

Generated artifacts are written with owner-only permissions under
`Logistic Regression Model/generated/`. That directory is ignored by Git.
Model IDs use a canonical hash of the normalized games, excluding export-time
metadata, so an identical dataset produces the same content fingerprint.

## Normalization guarantees

- Firebase is queried with the read-only Firestore `documents:runQuery` method.
- No Firebase documents are updated or deleted.
- Duplicate cloud-library copies are collapsed only in the derived dataset.
- Raw account IDs, player names, and team names are excluded. Snapshot-local
  opaque IDs retain the relationships needed for team-aware modeling.
- Numeric strings and bidding-team capitalization are canonicalized.
- Legacy starting totals are inferred only when the first round arithmetic
  proves them; invalid games are quarantined instead of assigned an outcome.
- The final round is marked terminal and excluded from training because the app
  does not need a probability after the winner is already known.

## Team treatment

Three separate mechanisms are evaluated. They must not be conflated:

1. **Representation weighting** limits how much a frequently observed exact
   team can dominate fitting. For a team frequency `n`, the soft weight is
   `max(minimumWeight, min(1, sqrt(targetGames / n)))`. It depends only on team
   frequency inside the fitting fold, never on wins or losses.
2. **Smoothed player strength** averages each side's player win log-odds under
   a symmetric Beta prior. It is library-local and chronological: a game's own
   outcome is applied only after its probability has been recorded.
3. **Opponent-adjusted player strength** fits a regularized Bradley-Terry
   rating from that library's earlier complete four-player games. This keeps a
   strong player from receiving the same credit for beating strong and weak
   opposition. Unseen players remain neutral.

Exact-team win rate, recent form, score margin, bid-make rate, set-force rate,
and other candidate additions remain experimental unless they beat the
prior-only rolling validation gate. They are not added merely because they
sound predictive.

Weighting a game by the team's observed win percentage is prohibited because
the label would leak into the fitting objective and produce overconfident
probabilities.

## Evaluation and promotion

Model choice and regularization use three rolling-origin backtests. A later
calibration block and the newest 15% of games remain outside model selection.
The engine replay also reconstructs the complete legacy runtime—state model,
saved-score buckets, and local calibration—using only games already available
inside each source library. The final test excludes terminal rounds and
reports accuracy, log loss, Brier score, calibration error, equal-round
metrics, and equal-game metrics.

The substantial-effect gate requires all of the following before a runtime
candidate is written:

- lower round- and game-balanced log loss and Brier score;
- at least 8% relative round log-loss and Brier improvement;
- at least 2.5 percentage points more round accuracy;
- lower round- and game-balanced log loss in every chronological validation
  replay block; and
- at least 90% paired logical-game bootstrap probability that the candidate is
  better.

The 95% bootstrap interval is always reported as a separate uncertainty check;
it is not hidden when it crosses zero. App replay and JavaScript/Python runtime
parity tests are required after the offline gate passes.

## Evaluation artifact versus deployment refit

Holdout metrics use a model trained only on the earlier development games. The
candidate trainer then locks the selected model family and hyperparameters and
performs a separate deployment refit on all valid games. `run_engine_replay.py`
combines that all-data state model with the selected player hierarchy and
writes `generated/model_runtime_v2_candidate.json` only when the engine gate
passes. The all-data artifact must never be used to recalculate or advertise
the earlier holdout metrics.

The checked-in v2 runtime disables the legacy saved-score bucket blend and the
legacy global personalization fit. Those layers hurt the chronological replay;
the new library-local player hierarchy replaces them. The v1 runtime remains
checked in as a rollback and comparison baseline.
