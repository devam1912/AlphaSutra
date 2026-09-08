# Model validation and the 90% aspiration

No training recipe can promise 90% future accuracy. Define the event and holding
period before fitting. The current label is positive next-open to horizon-close
return after a configured round-trip cost allowance. It is not probability of
hitting a target before a stop and must never be advertised as that probability.

## Reproducible training

Install Python 3.12, run `uv sync`, then use the repository environment:

```powershell
$env:PYTHONPATH='services/quant'
.venv/Scripts/python.exe -m quant.cli train data/adjusted-daily.csv --horizon 5 --threshold 0.8
```

Linux/macOS: `PYTHONPATH=services/quant uv run python -m quant.cli train data/adjusted-daily.csv`.
CSV columns are timestamp, open, high, low, close, volume. Use one instrument per
file, chronological completed daily candles, UTC timestamps and documented
corporate-action adjustment. At least approximately 550 daily observations are
needed; prefer several years spanning bull, bear and volatile periods.

Artifacts go to ignored `artifacts/<model-id>/`. Models, data and real keys never
belong in Git. The report includes a dataset SHA-256, feature definition, seed,
label, cost assumptions, training/calibration cutoffs and evaluation intervals.
Save the Git commit and data provider license alongside production research runs.

## Avoid leakage

Features at t use only candles through t. Execution begins at the next open.
Warmup and unavailable forward labels are discarded. Chronological expanding
windows have a horizon-sized embargo between training, calibration and test.
Preprocessors fit on training only; sigmoid calibration fits on the subsequent
calibration period. The last 126 labelled samples are excluded from research folds.
The final model is frozen before final holdout evaluation.

Do not repeatedly tune thresholds against the final period. Pre-register a
research plan, track all attempted variants and reserve a new holdout when the
old one has influenced decisions. Overlapping five-day labels are dependent;
reported Wilson intervals are descriptive, not a valid independent-trades proof.
Use block bootstrap and multiple-testing controls before commercial claims.

## What the report measures

Directional accuracy, selected-signal precision and recall, coverage, ROC-AUC,
Brier score, reliability bins and precision intervals are recorded. Zero selected
signals have null precision, not 100%. A probability is a model estimate, not
certainty. Class imbalance can make raw accuracy misleading; compare base rates.

A single-symbol daily backtest uses delayed entries, ATR stops, conservative
stop-first handling of ambiguous bars, slippage and fees. It reports drawdown,
Sharpe, Sortino, expectancy, profit factor, equity curve and same-symbol passive
benchmark. It is not a multi-asset portfolio or NIFTY benchmark backtest.
Daily bar simulation cannot reproduce intrabar liquidity or gap paths exactly.

## Promotion and forward evidence

Training creates a CHALLENGER. It does not replace a champion. Promotion checks
sample count, selected precision, calibration and at least 60 forward paper
sessions with positive net expectancy and bounded drawdown. Champion comparisons
must cover the same period and label. Store independent forward-paper validation
as `paper_validation` with sessions, net_expectancy and max_drawdown only after
operator review; this repository does not fabricate or auto-approve that evidence.

The registry uses local operator-owned artifacts, integrity hashes, an exclusive
promotion lock, compare-and-swap champion expectation and append-only event
history. The rollback function permits only the previous approved artifact.
Never load uploaded pickle/joblib files. Compromised artifact storage can execute
code during loading; use a restricted deployment identity and protected volumes.

## Research work still required

Obtain licensed, adjusted, point-in-time prices; historical universe membership;
news publication AND first-availability timestamps; and properly lagged
fundamentals. Data import cannot independently establish adjustment quality.
Train models across instruments only with grouped time splits. Current training
is one security at a time. Add a true NIFTY total-return benchmark, regime-stratified
forward evaluation and statistical uncertainty over independent trades before
making performance claims. Never immediately retrain weights after one loss.
