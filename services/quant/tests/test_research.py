from datetime import date

import numpy as np
import pandas as pd
import pytest
from fastapi.testclient import TestClient
from quant.api import app
from quant.backtest import BacktestConfig, backtest
from quant.derivatives import greeks, option_candidate
from quant.features import FEATURES, dataset, features, validate_candles
from quant.registry import checked_id, load, promotion_reasons, save
from quant.training import infer, train
from quant.validation import probability_metrics, walk_forward, wilson


def candles(n=900):
    rng = np.random.default_rng(123)
    close = 100 * np.exp(np.cumsum(rng.normal(0.0004, 0.014, n)))
    opening = np.r_[close[0], close[:-1]]
    return pd.DataFrame(
        {
            "timestamp": pd.date_range("2020-01-01", periods=n, freq="B", tz="UTC"),
            "open": opening,
            "high": np.maximum(opening, close) * 1.01,
            "low": np.minimum(opening, close) * 0.99,
            "close": close,
            "volume": rng.integers(10000, 90000, n),
        }
    )


def test_features_cannot_see_future():
    raw = candles()
    first = features(raw)
    changed = raw.copy()
    changed.loc[500:, ["open", "high", "low", "close"]] *= 10
    pd.testing.assert_frame_equal(first.iloc[:500], features(changed).iloc[:500])
    pd.testing.assert_frame_equal(first.iloc[:500], features(raw.iloc[:500]))
    assert first.iloc[:20].isna().any(axis=1).all()


def test_label_executes_at_next_open():
    raw = candles()
    data = dataset(raw, horizon=5, costs_bps=30)
    index = int(raw.index[raw.timestamp == data.iloc[0].timestamp][0])
    expected = raw.close.iloc[index + 5] / raw.open.iloc[index + 1] - 1 - 0.003
    assert data.iloc[0].forward_return == pytest.approx(expected)
    assert data.label_end.notna().all()


@pytest.mark.parametrize("column,value", [("close", 0), ("volume", -1), ("high", np.nan)])
def test_rejects_corruption(column, value):
    data = candles(60)
    data.loc[1, column] = value
    with pytest.raises(ValueError):
        validate_candles(data)


def test_purged_splits_preserve_holdout():
    for fold in walk_forward(900):
        assert fold.train_end + 5 <= fold.calibration_start
        assert fold.calibration_end + 5 <= fold.test_start
        assert fold.test_end <= 900 - 126
    with pytest.raises(ValueError):
        walk_forward(100)


def test_calibration_and_no_selection_are_honest():
    metrics = probability_metrics([0, 1, 0, 1], [0.3, 0.4, 0.5, 0.6], threshold=0.9)
    assert metrics["precision"] is None
    assert metrics["selected"] == 0
    assert metrics["coverage"] == 0
    interval = wilson(9, 10)
    assert interval[0] < 0.6 < interval[1]


def test_real_training_round_trip_and_promotion_rejection(tmp_path):
    raw = candles()
    model, report = train(raw)
    prediction = infer(model, raw)
    assert 0 <= prediction["probability"] <= 1
    assert set(prediction["features"]) == set(FEATURES)
    assert report["final"]["samples"] == 126
    artifact = save(tmp_path, model, report)
    restored, _ = load(tmp_path, artifact["model_id"])
    assert infer(restored, raw)["probability"] == prediction["probability"]
    assert "60 forward paper sessions are required" in promotion_reasons(report)
    with pytest.raises(ValueError):
        checked_id("../../malicious")
    (tmp_path / artifact["model_id"] / "model.joblib").write_bytes(b"tampered")
    with pytest.raises(ValueError, match="integrity"):
        load(tmp_path, artifact["model_id"])


def test_backtest_waits_for_next_bar_and_includes_costs():
    raw = candles(80)
    p = np.zeros(80)
    p[30] = 0.9
    result = backtest(raw, p, np.full(80, 1.5))
    assert result["trades"][0]["entry_index"] == 31
    assert result["fees_and_slippage_included"]
    free = backtest(raw, p, np.full(80, 1.5), BacktestConfig(fee_bps=0, slippage_bps=0))
    assert result["return"] < free["return"]


def test_both_stop_and_target_in_one_bar_uses_stop():
    raw = candles(4)
    raw.loc[:, ["open", "close"]] = 100
    raw.loc[:, "high"] = 110
    raw.loc[:, "low"] = 90
    result = backtest(raw, [0.9, 0, 0, 0], [1, 1, 1, 1])
    assert result["trades"][0]["reason"] == "STOP"
    assert result["trades"][0]["pnl"] < 0


def test_put_call_parity_and_units():
    call = greeks(100, 100, 0.5, 0.2, 0.05)
    put = greeks(100, 100, 0.5, 0.2, 0.05, "PUT")
    assert call["price"] - put["price"] == pytest.approx(100 - 100 * np.exp(-0.05 * 0.5))
    assert call["delta"] - put["delta"] == pytest.approx(1)
    assert call["theta"] < 0
    assert call["vega"] > 0
    with pytest.raises(ValueError):
        greeks(100, 100, 0, 0.2, 0.05)


def test_options_can_abstain():
    result = option_candidate(
        {
            "expiry": "2026-09-09",
            "premium": 100,
            "lot_size": 50,
            "ask": 105,
            "bid": 95,
            "open_interest": 10,
            "volume": 1,
        },
        date(2026, 9, 8),
        0.9,
    )
    assert result["status"] == "NO_TRADE"


def test_ml_endpoint_requires_a_service_credential():
    client = TestClient(app)
    assert client.get("/health").status_code == 200
    assert client.post("/score", json={}).status_code == 401
