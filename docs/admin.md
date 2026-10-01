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
node --test tests/admin.test.mjs tests/transcription-models.test.mjs
$env:RUN_MYSQL_TESTS = '1'
node --test tests/admin.mysql.test.mjs
npx playwright test tests/admin-ui.spec.ts --workers=1 --reporter=line
```

The MySQL test uses connection-local temporary tables; it never writes test
fixtures to customer tables.
