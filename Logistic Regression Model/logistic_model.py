"""Logistic regression inference for score-difference win probability."""

from dataclasses import dataclass
import math


def _sigmoid(z: float) -> float:
    """Numerically stable sigmoid."""
    if z >= 0:
        return 1.0 / (1.0 + math.exp(-z))
    exp_z = math.exp(z)
    return exp_z / (1.0 + exp_z)


@dataclass(frozen=True)
class TrainedLogisticModel:
    intercept: float
    coeff_diff: float
    coeff_round: float
    coeff_mom: float

    def logisticProb(self, diff: float, roundIdx: float, momentum: float) -> float:
        """Compute logistic probability using trained coefficients."""
        z = (
            self.intercept
            + self.coeff_diff * diff
            + self.coeff_round * roundIdx
            + self.coeff_mom * momentum
        )
        return _sigmoid(z)
