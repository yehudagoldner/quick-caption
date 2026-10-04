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
Upload and download activity is kept in `media_upload_activity` and
`media_downloads`, independently of retained media. Uploads are inserted in the
same transaction as the saved video (including failed processing), and backfilled
from retained videos and the existing completed-media ledger. Previously deleted
uploads without a ledger record and historical downloads cannot be reconstructed.
The dashboard shows per-user video uploads, video downloads, subtitle downloads,
distinct downloaded videos and average experience ratings, with separate global
totals for video and audio.

Every editor subtitle export, history subtitle export, burned-video download,
cached burned-video download and sharing-to-download fallback uses
`POST /api/downloads`. The verified identity must own the completed source media.
The event is acknowledged by MySQL before the browser download starts. UUIDs
deduplicate rapid clicks and retries after a lost response; each later deliberate
download counts separately. Preview/media fetches, video rendering and successful
native sharing are not counted as downloads. These are initiated downloads;
the browser does not expose whether the user ultimately saved the file to disk.

After each video download an optional 1–5-star experience dialog asks for written
feedback (up to 2,000 characters). Skipping does not affect the download. Feedback
is saved in `download_feedback` via `POST /api/downloads/:id/feedback`, restricted
to that download's verified owner, with one response per download. Failed saves
retain the selected stars and text for retry. The **דירוגים ופידבק** tab lists
responses with customer, filename and date, 25 rows per server-side page; only
administrators can access `GET /api/admin/feedback`.

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
node --test tests/admin.test.mjs tests/error-monitoring.test.mjs tests/downloads.test.mjs tests/transcription-models.test.mjs
$env:RUN_MYSQL_TESTS = '1'
node --test tests/admin.mysql.test.mjs tests/error-monitoring.mysql.test.mjs tests/downloads.mysql.test.mjs
npx playwright test tests/admin-ui.spec.ts tests/error-monitoring-ui.spec.ts tests/download-admin.spec.ts tests/download-experience.spec.ts tests/subtitle-download-name.spec.ts --workers=1 --reporter=line
```

The MySQL test uses connection-local temporary tables; it never writes test
fixtures to customer tables.
