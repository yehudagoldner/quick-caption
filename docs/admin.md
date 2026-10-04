# Admin dashboard

Open `/admin` and sign in with the verified Google account `goldnery@gmail.com`.
The owner is seeded on server startup. Additional administrators can be added by
email, including before registration. Every administrator has full dashboard,
administrator-grant and credit-grant access. Local development bypass never grants
administrator access.

The server verifies Firebase ID-token signatures, expiry, issuer and audience.
Set `FIREBASE_PROJECT_ID` or use the existing `VITE_FIREBASE_PROJECT_ID` on the
server. User synchronization now sends a Firebase token and takes identity fields
from that verified token, preventing forged user profiles.

Database tables are created automatically by `ensureSchema()` at startup.
The **שגיאות** tab at `/admin` lists server API failures and selected browser
upload/save failures. Only existing administrators can read this log. Each
request loads exactly one page of up to **50** records from MySQL, newest first.
Pagination retains a sequence snapshot so incoming records do not shift rows
between pages; Refresh starts a new snapshot at page 1. Empty/loading/error and
retry states are handled without retaining every record in the browser.

The `application_errors` table stores the source, operation, status, timestamp,
verified user UID and request ID. Request bodies, media, captions, authorization
headers and query tokens are not collected. Common credential patterns are
redacted from messages. Browser reports use fixed event codes, authenticated
ownership, deduplication IDs and a per-user rate limit. An offline browser keeps
at most 50 reports in its session and submits them when connectivity returns.
The server retries a DB outage using a bounded 500-record memory queue, without
blocking customer requests. Pending server records can be lost if the process
exits during the outage or the queue fills. Existing historical errors cannot be
backfilled from this new log.

Subtitle saves require a structured success acknowledgment, so an HTML 200 or
unacknowledged JSON response cannot mark a draft as saved. Failed drafts retain
the existing retry and navigation protection. Uploads with unreadable responses
check the existing transcription job instead of submitting a second chargeable
job; checking has a bounded timeout and handles expired sessions explicitly.

Credit grants require a reason and use an idempotency key; retries of the same
operation add credits once. Grants and administrator additions are audited.
Manual grants do not count as purchases or revenue.

Revenue is gross USD from the existing captured-PayPal-payment ledger, before
fees/refunds. “Paying” means at least one recorded purchase; all other registered
accounts are free. Counts are lifetime totals. Processed media and duration are
backfilled from retained completed videos, then recorded durably for future media.
Previously deleted media cannot be recovered. Edited counts track subtitle saves
from installation onward; duration is media length, not time spent in the editor.

AI usage is recorded for transcription, word transcription, correction, AI edits,
splitting and resegmentation, including paid successful calls whose subsequent
parsing or workflow fails. Provider errors are recorded with unknown cost.
Totals are estimated application expenses, not an imported OpenAI invoice, and
exclude historical calls and usage by other applications. Audio transcribe models
use the published per-minute estimates; token counts are also retained when the
provider returns them. Text rates include cached input and service tiers. Unknown
models, tiers or missing usage are explicitly unpriced. Fractional-dollar costs
are stored independently of rounded user credits. Rates are a 2026-09-30 snapshot
of https://developers.openai.com/api/docs/pricing and should be updated in
`src/aiUsage.js` when the provider changes pricing. No prompts or subtitle text
are stored in the usage ledger.

Checks:

```powershell
npm run build
node --test tests/admin.test.mjs tests/error-monitoring.test.mjs tests/transcription-models.test.mjs
$env:RUN_MYSQL_TESTS = '1'
node --test tests/admin.mysql.test.mjs tests/error-monitoring.mysql.test.mjs
npx playwright test tests/admin-ui.spec.ts tests/error-monitoring-ui.spec.ts --workers=1 --reporter=line
```

The MySQL test uses connection-local temporary tables; it never writes test
fixtures to customer tables.
