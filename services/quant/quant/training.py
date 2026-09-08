from __future__ import annotations

from dataclasses import asdict

import numpy as np
import pandas as pd
from sklearn.calibration import CalibratedClassifierCV
from sklearn.ensemble import HistGradientBoostingClassifier
from sklearn.frozen import FrozenEstimator
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler

from quant.backtest import BacktestConfig, backtest
from quant.features import FEATURES, VERSION, dataset, dataset_hash, features, validate_candles
from quant.validation import probability_metrics, walk_forward


def estimator(kind: str = "logistic"):
    if kind == "logistic":
        return make_pipeline(StandardScaler(), LogisticRegression(max_iter=1000, random_state=42))
    if kind == "boosting":
        return HistGradientBoostingClassifier(
            max_iter=100,
            max_leaf_nodes=15,
            l2_regularization=1,
            random_state=42,
            early_stopping=False,
        )
    raise ValueError("Unknown baseline")


def fit_calibrated(train: pd.DataFrame, calibration: pd.DataFrame, kind: str):
    if min(train.label.nunique(), calibration.label.nunique()) < 2:
        raise ValueError("Training and calibration each require both outcomes")
    model = estimator(kind)
    model.fit(train[FEATURES], train.label)
    calibrated = CalibratedClassifierCV(FrozenEstimator(model), method="sigmoid")
    calibrated.fit(calibration[FEATURES], calibration.label)
    return calibrated


def train(
    frame: pd.DataFrame,
    horizon: int = 5,
    threshold: float = 0.8,
    kind: str = "logistic",
    costs_bps: int = 30,
) -> tuple[object, dict]:
    if not 0.5 <= threshold <= 0.99:
        raise ValueError("Threshold must be chosen before evaluation")
    raw = validate_candles(frame)
    data = dataset(raw, horizon, costs_bps)
    folds = walk_forward(len(data), horizon=horizon)
    outcomes, probabilities, reports = [], [], []
    for fold in folds:
        training = data.iloc[fold.train_start : fold.train_end]
        calibration = data.iloc[fold.calibration_start : fold.calibration_end]
        testing = data.iloc[fold.test_start : fold.test_end]
        if training.label_end.max() >= calibration.timestamp.min():
            raise ValueError("Training label overlaps calibration period")
        if calibration.label_end.max() >= testing.timestamp.min():
            raise ValueError("Calibration label overlaps test period")
        model = fit_calibrated(training, calibration, kind)
        p = model.predict_proba(testing[FEATURES])[:, 1]
        outcomes.extend(testing.label.tolist())
        probabilities.extend(p.tolist())
        reports.append(
            {"split": asdict(fold), "metrics": probability_metrics(testing.label, p, threshold)}
        )
    # The final 126 samples are never used by the expanding-window research folds.
    final_start = len(data) - 126
    cal_end = final_start - horizon
    cal_start = cal_end - 63
    training = data.iloc[: cal_start - horizon]
    calibration = data.iloc[cal_start:cal_end]
    final = data.iloc[final_start:]
    if training.label_end.max() >= calibration.timestamp.min():
        raise ValueError("Final training leakage")
    if calibration.label_end.max() >= final.timestamp.min():
        raise ValueError("Final calibration leakage")
    model = fit_calibrated(training, calibration, kind)
    final_p = model.predict_proba(final[FEATURES])[:, 1]
    report = {
        "feature_version": VERSION,
        "features": FEATURES,
        "dataset_version": dataset_hash(raw),
        "kind": kind,
        "seed": 42,
        "horizon": horizon,
        "costs_bps": costs_bps,
        "label": "next_open_to_horizon_close_positive_after_costs",
        "training_end": training.timestamp.max().isoformat(),
        "calibration_end": calibration.timestamp.max().isoformat(),
        "final_start": final.timestamp.min().isoformat(),
        "final_end": final.timestamp.max().isoformat(),
        "folds": reports,
        "walk_forward": probability_metrics(outcomes, probabilities, threshold),
        "final": probability_metrics(final.label, final_p, threshold),
        "base_rate": float(training.label.mean()),
        "status": "CHALLENGER",
        "threshold": threshold,
        "warning": "Overlapping labels are dependent; Wilson intervals are descriptive only",
    }
    final_rows = raw[raw.timestamp >= final.timestamp.min()].reset_index(drop=True)
    by_time = dict(zip(final.timestamp, final_p, strict=True))
    aligned = [float(by_time.get(t, 0.0)) for t in final_rows.timestamp]
    full_features = features(raw)
    final_atr = (
        (full_features.atr_fraction * raw.close)
        .loc[raw.timestamp >= final.timestamp.min()]
        .to_numpy()
    )
    report["backtest"] = backtest(
        final_rows,
        aligned,
        final_atr,
        BacktestConfig(horizon=horizon, threshold=threshold, fee_bps=costs_bps // 2),
        benchmark=final_rows.close.pct_change().fillna(0).to_numpy(),
    )
    report["backtest"]["benchmark_scope"] = "same security buy and hold; not a NIFTY benchmark"
    return model, report


def infer(model, frame: pd.DataFrame) -> dict:
    data = validate_candles(frame)
    values = features(data)
    if values.empty or values.iloc[-1].isna().any():
        raise ValueError("Insufficient or invalid feature history")
    p = float(model.predict_proba(values.iloc[[-1]][FEATURES])[0, 1])
    if not np.isfinite(p):
        raise ValueError("Nonfinite model output")
    return {
        "probability": p,
        "features": values.iloc[-1].to_dict(),
        "as_of": data.timestamp.iloc[-1].isoformat(),
        "feature_version": VERSION,
    }
