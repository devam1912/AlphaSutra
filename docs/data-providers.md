# Data and provider setup

## Credentials

Store credentials only in local `.env` or the deployment secret manager. Do not
paste keys into issues, source files or frontend settings. The browser only sees
provider availability. Python model fitting itself needs no AI API key.

| Setting             | Purpose                                          | Cost boundary                                                                                                     |
| ------------------- | ------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| UPSTOX_ACCESS_TOKEN | Read-only history and executable quotes          | Upstox documents a free Analytics Token; account eligibility and redistribution rights still require verification |
| GROQ_API_KEY        | Optional structured news headline interpretation | Free plan has request/token limits                                                                                |
| GEMINI_API_KEY      | Optional fallback headline interpretation        | Free tier is limited; its data-use policy differs from paid usage                                                 |
| MONGO_URL           | Replica-set database                             | Local development is free; production hosting and backups cost resources                                          |
| REDIS_URL           | Background jobs                                  | Local development is free                                                                                         |
| ML_SERVICE_TOKEN    | Private API-to-quant authentication              | Generate a random secret of at least 32 characters                                                                |

Verified 8 September 2026 against the providers' own documentation:

- [Upstox Analytics Token](https://upstox.com/developer/api-documentation/analytics-token/)
- [Historical daily candles](https://upstox.com/developer/api-documentation/v3/get-historical-candle-data/)
- [Market quote depth](https://upstox.com/developer/api-documentation/get-full-market-quote/)
- [Groq free-plan limits](https://console.groq.com/docs/rate-limits)
- [Gemini pricing and data-use distinctions](https://ai.google.dev/gemini-api/docs/pricing)

Do not send confidential client portfolio data to free news providers. This
implementation sends public headlines only. Headline interpretations have limited
context and cannot establish the truth of an article or predict a trade outcome.

## Import approved instrument metadata

Run from the repository root with `.env` configured:

```sh
npx tsx --env-file=.env apps/api/src/data/import.ts instruments data/instruments.json
npx tsx --env-file=.env apps/api/src/data/import.ts sessions data/sessions.json
npx tsx --env-file=.env apps/api/src/data/import.ts candles data/adjusted.json INSTRUMENT_ID
```

Instrument JSON is an array of records with `_id`, `symbol`, `exchange`, `kind`,
`sector`, `correlationGroup`, `lotSize`, `tickSize`, `active` and `providerKey`.
Optional derivative fields are `expiry`, `strike` and `underlying`. Monetary
metadata is paise. Use the provider's current instrument master rather than a
hardcoded list of lot sizes. The operator is responsible for metadata provenance.

A session record contains `_id` as the India-local YYYY-MM-DD, `open` and `close`
as timezone-qualified timestamps, plus `source`. Import the current exchange
calendar, including special sessions. Unknown days are closed. Session metadata
is operator controlled, not editable by end users.

Candle JSON contains timestamp, open, high, low, close, volume and adjusted.
Prices in historical research candles are rupees, while quotes and execution
prices are paise. Timestamps denote the time the completed daily candle became
available. The Upstox adapter translates normal-session daily timestamps to
15:30 India time. Special-session history needs an operator-reviewed import.

## Corporate actions and quality

Raw Upstox candles are marked `adjusted: false` because API transport alone does
not establish corporate-action adjustment. The training worker rejects these
until an approved adjusted dataset is supplied. To replace a raw dataset, use a
new instrument/dataset namespace or an explicit audited migration; ingestion
never silently rewrites existing history. Keep original provider data and a
versioned corporate-action adjustment manifest outside Git.

Imports reject duplicates, future or out-of-order timestamps, missing adjustment
status and invalid OHLC envelopes. The current validator does not establish
point-in-time index membership, full holiday continuity or split adjustment
correctness. These remain data acceptance tasks before serious research.

## News

NEWS_FEEDS is a comma-separated server-configured list of permitted HTTPS RSS
feeds. The importer retains headline, canonical link, source, publication and
first ingestion timestamps. It does not store licensed full article bodies.
Responses are size limited; redirects are refused; secrets never enter logs.

Each article is deduplicated by link and title. LLM responses must pass a strict
schema. If all providers fail, the article remains UNAVAILABLE with null signal.
The quantitative system remains usable. Article symbols remain empty until an
operator-approved entity mapping is available; an LLM cannot invent links to a
security. A historical feature join must use both publication and ingestion time.

## Scaling

Quote fetches batch up to 100 instruments. Candle writes use bounded bulk
upserts and compound time indexes. API requests never load full history.
Provider retries are bounded with timeout/backoff and Retry-After handling.
Do not increase worker concurrency to bypass a provider's account rate limits.
A repeated quote cannot replenish already-consumed simulated depth.

Before commercial redistribution, confirm a license covering your exact clients,
data display, non-display use and derived outputs. A free read-only token grants
no implied right to resell market data.

## Provider outage policy

JSON API calls share a per-process circuit by provider origin. After three failed
logical requests, that worker stops calling the origin for 60 seconds. A single
probe tests recovery after cooldown. This protects quota and avoids amplifying an
outage. It is not a distributed rate-limit authority: production account quotas
still require worker concurrency and per-account scheduling controls.

RSS and JSON payloads are bounded before parsing. Provider error bodies are not
returned to clients, because upstream services can include credentials or private
request details in errors. A failed data refresh never relabels an older quote as
fresh. Quotes are timestamped by the provider, not the fetch completion time.
