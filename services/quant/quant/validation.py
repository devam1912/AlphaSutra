from __future__ import annotations

import math
from dataclasses import asdict, dataclass

import numpy as np
from sklearn.metrics import brier_score_loss, roc_auc_score


@dataclass(frozen=True)
class Fold:
    train_start: int
    train_end: int
    calibration_start: int
    calibration_end: int
    test_start: int
    test_end: int


def walk_forward(
    n: int,
    horizon: int = 5,
    min_train: int = 252,
    calibration: int = 63,
    test: int = 63,
    final_holdout: int = 126,
) -> list[Fold]:
    if min(n, horizon, min_train, calibration, test, final_holdout) <= 0:
        raise ValueError("All split sizes must be positive")
    stop = n - final_holdout
    folds = []
    train_end = min_train
    while train_end + horizon * 2 + calibration + test <= stop:
        cal_start = train_end + horizon
        cal_end = cal_start + calibration
        test_start = cal_end + horizon
        folds.append(Fold(0, train_end, cal_start, cal_end, test_start, test_start + test))
        train_end += test
    if not folds:
        raise ValueError(
            "Insufficient history for purged walk-forward validation and final holdout"
        )
    return folds


def wilson(wins: int, total: int, z: float = 1.96) -> list[float] | None:
    if total == 0:
        return None
    p = wins / total
    denominator = 1 + z * z / total
    center = (p + z * z / (2 * total)) / denominator
    width = z * math.sqrt(p * (1 - p) / total + z * z / (4 * total * total)) / denominator
    return [max(0, center - width), min(1, center + width)]


def probability_metrics(labels, probabilities, threshold: float = 0.8) -> dict:
    y = np.asarray(labels, dtype=int)
    p = np.asarray(probabilities, dtype=float)
    if len(y) == 0 or y.shape != p.shape or not np.isfinite(p).all():
        raise ValueError("Empty or malformed predictions")
    if not np.isin(y, [0, 1]).all() or ((p < 0) | (p > 1)).any():
        raise ValueError("Invalid labels or probabilities")
    selected = p >= threshold
    count = int(selected.sum())
    wins = int(y[selected].sum())
    bins = []
    for left in np.arange(0, 1, 0.1):
        mask = (p >= left) & (p < left + 0.1 if left < 0.89 else p <= 1)
        if mask.any():
            bins.append(
                {
                    "lower": round(float(left), 1),
                    "count": int(mask.sum()),
                    "predicted": float(p[mask].mean()),
                    "observed": float(y[mask].mean()),
                }
            )
    return {
        "samples": len(y),
        "directional_accuracy": float(((p >= 0.5) == y).mean()),
        "brier": float(brier_score_loss(y, p)),
        "auc": float(roc_auc_score(y, p)) if len(np.unique(y)) == 2 else None,
        "precision": wins / count if count else None,
        "recall": wins / int(y.sum()) if y.sum() else None,
        "selected": count,
        "coverage": count / len(y),
        "precision_interval": wilson(wins, count),
        "calibration": bins,
        "threshold": threshold,
    }


def performance(returns, benchmark=None) -> dict:
    r = np.asarray(returns, dtype=float)
    if len(r) < 2 or not np.isfinite(r).all() or (r <= -1).any():
        raise ValueError("At least two finite daily returns above -100% required")
    curve = np.cumprod(1 + r)
    peaks = np.maximum.accumulate(np.r_[1.0, curve])[1:]
    drawdown = curve / peaks - 1
    std = float(r.std(ddof=1))
    downside = float(np.sqrt(np.mean(np.minimum(r, 0) ** 2)))
    losses = float(-r[r < 0].sum())
    result = {
        "return": float(curve[-1] - 1),
        "max_drawdown": float(-drawdown.min()),
        "sharpe": float(r.mean() / std * np.sqrt(252)) if std else None,
        "sortino": float(r.mean() / downside * np.sqrt(252)) if downside else None,
        "profit_factor": float(r[r > 0].sum() / losses) if losses else None,
        "expectancy": float(r.mean()),
        "volatility": std * np.sqrt(252),
        "equity_curve": curve.tolist(),
    }
    if benchmark is not None:
        b = np.asarray(benchmark, dtype=float)
        if b.shape != r.shape or not np.isfinite(b).all() or (b <= -1).any():
            raise ValueError("Benchmark must align to every evaluated session")
        result["benchmark_return"] = float(np.prod(1 + b) - 1)
        result["alpha"] = result["return"] - result["benchmark_return"]
    return result


def serialize_fold(fold: Fold) -> dict:
    return asdict(fold)
