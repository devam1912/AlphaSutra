from __future__ import annotations

import hashlib

import numpy as np
import pandas as pd

VERSION = "ohlcv-v1"
FEATURES = [
    "return_1",
    "return_3",
    "return_5",
    "return_10",
    "return_20",
    "sma_distance",
    "ema_distance",
    "rsi",
    "atr_fraction",
    "volatility",
    "relative_volume",
    "volume_z",
    "high_distance",
    "low_distance",
    "gap",
]


def validate_candles(frame: pd.DataFrame) -> pd.DataFrame:
    required = {"timestamp", "open", "high", "low", "close", "volume"}
    if not required.issubset(frame.columns):
        raise ValueError(f"Missing columns: {sorted(required - set(frame.columns))}")
    data = frame.copy()
    data["timestamp"] = pd.to_datetime(data.timestamp, utc=True, errors="raise")
    if data.timestamp.isna().any() or data.timestamp.duplicated().any():
        raise ValueError("Missing or duplicate candle timestamps")
    if not data.timestamp.is_monotonic_increasing:
        raise ValueError("Candles must be strictly chronological")
    values = data[["open", "high", "low", "close", "volume"]].to_numpy(dtype=float)
    if not np.isfinite(values).all():
        raise ValueError("Nonfinite candle value")
    if (values[:, :4] <= 0).any() or (values[:, 4] < 0).any():
        raise ValueError("Prices must be positive and volume nonnegative")
    if (
        (data.high < data[["open", "close", "low"]].max(axis=1))
        | (data.low > data[["open", "close", "high"]].min(axis=1))
    ).any():
        raise ValueError("Invalid OHLC envelope")
    return data.reset_index(drop=True)


def features(frame: pd.DataFrame) -> pd.DataFrame:
    """Row t is available only after candle t closes; enter at t+1 or later."""
    data = validate_candles(frame)
    close = data.close.astype(float)
    previous = close.shift(1)
    output = pd.DataFrame(index=data.index)
    for horizon in [1, 3, 5, 10, 20]:
        output[f"return_{horizon}"] = close.pct_change(horizon, fill_method=None)
    output["sma_distance"] = close / close.rolling(20).mean() - 1
    output["ema_distance"] = close / close.ewm(span=20, adjust=False, min_periods=20).mean() - 1
    change = close.diff()
    gain = change.clip(lower=0).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    loss = (-change.clip(upper=0)).ewm(alpha=1 / 14, adjust=False, min_periods=14).mean()
    output["rsi"] = (100 - 100 / (1 + gain / loss.replace(0, np.nan))) / 100
    output.loc[(loss == 0) & (gain > 0), "rsi"] = 1.0
    output.loc[(loss == 0) & (gain == 0), "rsi"] = 0.5
    true_range = pd.concat(
        [data.high - data.low, (data.high - previous).abs(), (data.low - previous).abs()], axis=1
    ).max(axis=1)
    output["atr_fraction"] = true_range.rolling(14).mean() / close
    output["volatility"] = output.return_1.rolling(20).std() * np.sqrt(252)
    volume_mean = data.volume.rolling(20).mean()
    volume_std = data.volume.rolling(20).std()
    output["relative_volume"] = data.volume / volume_mean.replace(0, np.nan)
    output["volume_z"] = (data.volume - volume_mean) / volume_std.replace(0, np.nan)
    output.loc[volume_std == 0, "volume_z"] = 0
    output["high_distance"] = close / data.high.rolling(20).max() - 1
    output["low_distance"] = close / data.low.rolling(20).min() - 1
    output["gap"] = data.open / previous - 1
    return output[FEATURES].replace([np.inf, -np.inf], np.nan)


def dataset(frame: pd.DataFrame, horizon: int = 5, costs_bps: int = 30) -> pd.DataFrame:
    if not 1 <= horizon <= 60 or not 0 <= costs_bps <= 1000:
        raise ValueError("Invalid label horizon or costs")
    data = validate_candles(frame)
    result = features(data)
    # The open after signal creation is the first executable price.
    entry = data.open.shift(-1)
    result["forward_return"] = data.close.shift(-horizon) / entry - 1 - costs_bps / 10_000
    result["label"] = (result.forward_return > 0).astype(int)
    result["timestamp"] = data.timestamp
    result["label_end"] = data.timestamp.shift(-horizon)
    return result.dropna().reset_index(drop=True)


def dataset_hash(frame: pd.DataFrame) -> str:
    normalized = validate_candles(frame).to_json(
        orient="split", date_format="iso", double_precision=15
    )
    return hashlib.sha256(normalized.encode()).hexdigest()


def regime(frame: pd.DataFrame) -> dict:
    data = validate_candles(frame)
    f = features(data).dropna()
    if len(f) < 30:
        return {"regime": "DATA_UNAVAILABLE", "reason": "Insufficient completed benchmark candles"}
    last = f.iloc[-1]
    if last.volatility > 0.35:
        name = "HIGH_VOLATILITY"
    elif last.return_20 > 0.06 and last.sma_distance > 0.02:
        name = "STRONG_BULL"
    elif last.return_20 < -0.06 and last.sma_distance < -0.02:
        name = "STRONG_BEAR"
    elif last.sma_distance > 0.01:
        name = "BULL"
    elif last.sma_distance < -0.01:
        name = "BEAR"
    else:
        name = "SIDEWAYS"
    return {
        "regime": name,
        "volatility": float(last.volatility),
        "as_of": data.timestamp.iloc[-1].isoformat(),
        "version": VERSION,
    }
