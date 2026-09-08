from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from quant.features import validate_candles
from quant.validation import performance


@dataclass(frozen=True)
class BacktestConfig:
    initial_cash: float = 1_000_000
    allocation_cap: float = 0.7
    position_cap: float = 0.15
    risk_per_trade: float = 0.005
    fee_bps: int = 15
    slippage_bps: int = 5
    horizon: int = 5
    threshold: float = 0.8
    reward_risk: float = 2.0


def backtest(frame: pd.DataFrame, probabilities, atr, config=None, benchmark=None):
    """One-symbol long-only daily replay. Never uses a signal on its formation bar."""
    config = config or BacktestConfig()
    data = validate_candles(frame)
    p, ranges = np.asarray(probabilities), np.asarray(atr)
    if len(data) < 2 or len(p) != len(data) or len(ranges) != len(data):
        raise ValueError("Prediction, ATR and candle rows must align")
    if not np.isfinite(p).all() or ((p < 0) | (p > 1)).any():
        raise ValueError("Invalid probability")
    if not np.isfinite(ranges).all() or (ranges <= 0).any():
        raise ValueError("ATR must be positive and finite")
    if not (0 < config.position_cap <= config.allocation_cap <= 0.7):
        raise ValueError("Invalid allocation limits")
    if not (0 < config.risk_per_trade <= 0.01 and config.initial_cash > 0):
        raise ValueError("Invalid capital or risk budget")
    if not (0 <= config.fee_bps <= 1000 and 0 <= config.slippage_bps <= 1000):
        raise ValueError("Invalid execution costs")
    cash = config.initial_cash
    position = None
    trades, equity = [], []
    fee_rate, slip = config.fee_bps / 10000, config.slippage_bps / 10000
    for index, (_, row) in enumerate(data.iterrows()):
        if position is None and index > 0 and p[index - 1] >= config.threshold:
            entry = float(row.open) * (1 + slip)
            distance = 2 * float(ranges[index - 1])
            quantity = int(
                min(
                    cash * config.risk_per_trade / distance,
                    cash * config.position_cap / (entry * (1 + fee_rate)),
                )
            )
            if quantity > 0 and entry > distance:
                paid = quantity * entry * (1 + fee_rate)
                cash -= paid
                position = {
                    "entry": entry,
                    "stop": entry - distance,
                    "target": entry + config.reward_risk * distance,
                    "quantity": quantity,
                    "paid": paid,
                    "entry_index": index,
                }
        if position:
            reason, exit_price = None, None
            if row.open <= position["stop"]:
                reason, exit_price = "GAP_STOP", float(row.open)
            elif row.low <= position["stop"]:
                # Without intrabar paths, assume the stop occurs first if both are touched.
                reason, exit_price = "STOP", position["stop"]
            elif row.high >= position["target"]:
                reason, exit_price = "TARGET", position["target"]
            elif index - position["entry_index"] + 1 >= config.horizon or index == len(data) - 1:
                reason, exit_price = "TIME", float(row.close)
            if exit_price is not None:
                fill = exit_price * (1 - slip)
                proceeds = fill * position["quantity"] * (1 - fee_rate)
                cash += proceeds
                trades.append(
                    {
                        **position,
                        "exit": fill,
                        "exit_index": index,
                        "reason": reason,
                        "pnl": proceeds - position["paid"],
                    }
                )
                position = None
        equity.append(cash + (position["quantity"] * float(row.close) if position else 0))
    returns = np.diff(np.r_[config.initial_cash, equity]) / np.r_[config.initial_cash, equity[:-1]]
    report = performance(returns, benchmark)
    report["trades"] = trades
    report["fees_and_slippage_included"] = True
    report["scope"] = "single_symbol_daily_long_only"
    report["win_rate"] = sum(t["pnl"] > 0 for t in trades) / len(trades) if trades else None
    return report
