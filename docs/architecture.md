# Architecture decisions

The upstream repository was empty when inspected on 8 September 2026, with no
branches, commits, issues, migrations or existing code to preserve.

The requested MERN alternative is adopted: React, Express, MongoDB and Node,
with Python for numerical research. Prefer a modular monolith over distributed
microservices. Only ML and background workloads have separate process lifecycles.

## Tenant boundary

An account is a tenant in this milestone. The server derives ownership from a
hashed opaque session. It never accepts a caller-selected owner ID. Every private
collection query includes ownership. Shared instrument/candle data contains no
account information. Viewer accounts cannot mutate a portfolio.

## Accounting boundary

Money is an integer number of paise, constrained to ±10^12 paise. MongoDB BSON
numbers represent all permitted values exactly. Monetary products are checked
before writes; fee multiplication uses BigInt intermediate arithmetic.
Wallet, order, position, ledger, idempotency and audit writes belong in the same
transaction. Transactions lock the portfolio through a write, serializing risk
decisions against concurrent withdrawals, orders and control changes.

Do not use an in-process mutex as the concurrency authority. MongoDB retries
transaction conflicts. Idempotency keys are tenant scoped and never expire.

## Operational boundary

Liveness reports process health; readiness verifies a replica set and migration.
Do not automatically migrate on every API startup. Migrations run as a deployment
job with an operator-controlled database credential.

## Commercial boundary

Code quality, model validity and permission to sell financial research are
different acceptance gates. Passing software tests establishes none of the
other two. See the deployment and model-validation documents as they are added.
