# Research jobs and automated paper execution

The API writes a tenant-owned job into MongoDB with an idempotency record in
one transaction. A scheduler dispatches this durable outbox to Redis/BullMQ.
The worker handles bounded retries, records sanitized failure codes and marks
terminal failures inactive. An account may have one active job of each kind.
Job submission is limited to five requests per minute per authenticated account.

History jobs fetch five years of daily data. Raw provider data remains unadjusted.
Training requires approved adjustment and exact correspondence to the imported
exchange session calendar. This deliberately fails when the data supply is not
ready. Scoring requires the latest completed session, a tenant-owned model and a
fresh executable quote. All slow numerical work runs behind the private worker.

Challenger results are labelled RESEARCH_ONLY. A high model probability alone
never authorizes automated execution. The current stock model estimates forward
returns, not target-before-stop success. ATR determines invalidation distance;
position sizing and portfolio risk then determine whether any lot can be traded.
No-trade decisions and unavailable-data outcomes are retained.

An approved champion is an operator-controlled model record. Do not manually
change a MongoDB status to bypass Python registry promotion criteria. A full
production bridge that imports signed promotion evidence into the application
registry remains a deployment gate. No champion is installed by default.

The current high-conviction rule selects the first qualifying approved signal
of an India-local day and enforces a unique account/day index. It does not yet
perform a coordinated all-universe batch ranking. Do not market it as proof of
the globally best opportunity. Research candidates can be compared in the UI.

AUTO_PAPER_ENABLED defaults to false. When enabled, an approved qualifying
high-conviction recommendation submits an idempotent simulated limit order.
Every fill still passes current risk controls. Scoring is user-queued in this
milestone; periodic universe scoring and retraining require an explicit operating
schedule after data and model validation. The execution timer monitors pending
orders and stop/target exits independently of research and quote-refresh jobs.

Start the worker with `npm run worker -w @alphasutra/api`. It needs MongoDB,
Redis and the private quant service. A missing Redis connection does not block
the independent paper-order monitoring timer. Missing quotes always block fills.
The application health endpoint only covers the API; the worker records a
heartbeat in MongoDB. Monitor it separately during deployment.

Open limitations: end-of-day liquidation and derivative expiry settlement,
partial exit fills, multi-asset historical replay, signed model promotion import,
periodic retraining policy and globally ranked high-conviction batches are not
validated production features. These boundaries are not replaced with mocks.

## Retry and lifecycle semantics

Job identity is a stable UUID held in the account's idempotency record. An API
retry returns the original job. Queued jobs survive Redis outages in the MongoDB
outbox; stale running records are eligible for redispatch after 20 minutes.
BullMQ handles active-job leases and bounded retries. Model inserts are unique
by job ID; orphan artifacts from a crash need operator cleanup, not automatic
promotion. No job may select a model belonging to another account.

A scoring request must postdate the model calibration cutoff. This prevents a
current fitted model being misused to produce apparent historical predictions.
For historical evaluation use the purged walk-forward pipeline instead.
