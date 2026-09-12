# Local deployment and operations

## Run the complete stack

Install Docker Desktop with Linux containers and Node 22. From the repository root:

```sh
node scripts/init-env.mjs
docker compose config --quiet
docker compose up --build --wait --wait-timeout 180
```

Open http://localhost:8080 and create a paper account. Initial simulated capital
is INR 10,00,000. The initializer creates a random private quant-service token
without printing it; an existing `.env` is never overwritten. Configure provider
credentials in that file, then recreate the worker after changing them.

The Compose stack starts a single-member MongoDB replica set, Redis, a one-shot
migration, the API, a separate worker, Python quant service and the React site.
Only port 8080 is published, bound to localhost. Database, Redis and quant ports
remain inside the Docker network. MongoDB, Redis and model artifacts use named
volumes. Restarting containers preserves accounts and accounting history.

This is a local evaluation configuration. MongoDB and Redis have no passwords
in this isolated stack; do not expose their ports or deploy this file unchanged
to an untrusted network. APP_ORIGIN is deliberately http://localhost:8080 here.
The application rejects production mode unless its origin uses HTTPS.

```sh
docker compose ps
docker compose logs --tail 100 api worker quant
docker compose stop
docker compose start
```

`docker compose down` removes containers and the network while keeping volumes.
Avoid `down -v` unless you intentionally want to erase the entire local database,
queue and model artifact store. No reset or cleanup script deletes these volumes.

## Host development

For editing without rebuilding containers, provide your own localhost MongoDB
replica set and Redis, then follow these commands in separate terminals:

```sh
node scripts/init-env.mjs
npm ci
uv sync --frozen
npm run migrate -w @alphasutra/api
npm run dev -w @alphasutra/api
npm run dev -w @alphasutra/web
npm run worker -w @alphasutra/api
```

For Python, export ML_SERVICE_TOKEN from the same private environment used by
Node, set PYTHONPATH=services/quant and run `uv run uvicorn quant.api:app`.
The host frontend uses port 5173 and proxies API calls to port 4000. Do not point
host development at the Compose database: its replica member address is internal.

## Data activation

See [provider setup](data-providers.md) for credentials and imports. Set
MARKET_PROVIDER=upstox only after configuring the token. Import instruments and
the exchange calendar before requesting quotes or paper fills. Training also
requires an approved adjusted historical dataset. Empty dashboards and unavailable
data decisions are expected until these inputs exist; no sample signals are
seeded. External news keys are optional. Keep AUTO_PAPER_ENABLED=false during
initial evaluation. Live broker execution is not implemented and cannot be enabled.

## External deployment requirements

Build and test immutable images from an approved Git commit. Pin deployed images
by digest and scan them; the local Dockerfiles use maintained version tags for
rebuilds. Supply runtime credentials from a secret manager, never build arguments.
Use TLS at the ingress with a single configured application origin. Set
NODE_ENV=production, disable public registration when using invitations, and use
private authenticated MongoDB and Redis connections with TLS where appropriate.
The current API rate limiter is process-local: use one API replica until a shared
rate-limit store or trusted ingress limiter is configured. Never trust arbitrary
forwarded IP headers. Keep quant private and use a unique random service token.

Run migrations once before releasing API and worker instances. Their readiness
check requires a replica set and the installed schema version. Size resources
using measured workloads; numerical thread counts default to one in the image.
The research worker processes one training job at a time. More worker replicas
require load and execution-contention tests before use with client portfolios.

## Monitoring and incident response

API `/health` reports process liveness; `/ready` checks MongoDB and migrations.
These endpoints do not prove market data, Redis or model quality. Monitor the
worker heartbeat in MongoDB (`heartbeats`, component `worker`), queue age, terminal
job failures, quote age and unavailable-data decisions. Alert if the heartbeat
is older than twice the configured worker interval plus normal scheduling delay.
Inspect failed jobs before retrying: provider outages and invalid datasets need
different remedies. Logs carry request IDs and sanitized error types, not payloads.

If execution is behaving unexpectedly, pause entries in the Risk center and
investigate open positions. Pausing entries does not liquidate positions. Missing
fresh quotes can prevent exits, including protective exits. Record the incident,
verify the ledger and resume only after checking data and worker health.

## Backups and recovery

Back up MongoDB with a replica-set-aware snapshot or `mongodump --oplog`, and
retain encrypted model artifacts with their hash-checked reports. Keep secrets
in a separate recovery system. A database-only restore can leave model records
pointing to missing artifacts. Redis persistence improves restart behavior;
MongoDB remains the source of durable job requests and accounting records.

Practice restoring into an isolated environment before accepting client data.
Reconcile portfolio cash, blocked funds, open orders, positions and ledger entries;
verify artifact checksums and model ownership. Disable automation during restore.
Do not replay orders against a live broker. Document the last consistent backup,
recovery duration and any data lost before declaring recovery complete.

## Verification

CI runs formatting, lint, TypeScript checks, a production build, real replica-set
integration tests, dependency audit, Python checks and a Compose startup check.
A configured workflow is not evidence of a successful run: inspect its result for
the deployed commit. Synthetic model tests verify mechanics only. Provider-backed
paper trials, operational recovery drills, redistribution rights and commercial
account workflows remain launch gates.
