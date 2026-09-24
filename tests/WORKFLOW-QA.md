# Upload, mobile editing and payment regression checks

Reviewed against the requests in task `01a0d44a-3c89-7411-809d-05af683b00c3`.

| Area | Corrected behavior | Coverage |
| --- | --- | --- |
| New account and prices | 50 initial credits; 100/$5, 500/$20, 1000/$30; existing balances remain intact | Server package checks, temporary MySQL tables, local API configuration |
| Interrupted checkout | Persist the order before approval, recover the same order after reload, lock new purchases until resolved | PayPal gateway simulations and browser tests |
| Duplicate or uncertain payment | Verify owner, currency, package, capture and completion; unique ledger entries; transactional credit update | Replay, lost response, pending payment, wrong values and database failure cases |
| Payment availability | Missing credentials do not crash the server; configuration/SDK loading errors have retry actions | Server and browser checks |
| Background transcription | Persist actual stage snapshots and heartbeat; expire abandoned jobs after 120 seconds without a heartbeat | Progress tracker checks, browser stage recovery |
| Completion and credits | Persist the job result and deduct credits in one transaction; do not charge if media storage fails | Unit rollback test and MySQL completion replay |
| Leaving an upload | Clear saved job, abort local requests, ignore old polls and socket events; server processing may continue | Recovery suite, including reload and selecting a second file |
| Upload on phones | No slider before file selection; submit above slider; no 100% overall-transcription claim | Real media fixture at 320×568 and 390×844 in Chromium |
| Editor draft | Wait for the latest text before navigating; retain text on slow failed save and allow retry | Browser tests on Chromium and WebKit |
| Style drawer | Scrollable bottom drawer with interactive, large video above; font-size control includes the default 60 | Chromium geometry and hit-testing |

## Commands

```powershell
npm run build
node --test tests/*.test.mjs
npx playwright install chromium webkit
npx playwright test --config=playwright.workflow.config.ts --workers=2
$env:RUN_MYSQL_TESTS='1'
node --test tests/payment-ledger.mysql.test.mjs
```

The opt-in MySQL test creates connection-local TEMPORARY tables. It does not modify customer records; closing the connection removes the fixtures.

The server applies the `stages_json` schema addition at startup. Heartbeats detect an interrupted worker; they do not resume a terminated transcription process. Uploading a file that has not yet reached the server cannot survive a browser terminating the upload.

PayPal capture retries reuse the same request ID, following [PayPal's idempotency guidance](https://developer.paypal.com/api/make-api-requests). Authentication against the configured live PayPal account was checked without creating a charge. Completed-payment cases use a simulated PayPal gateway plus a real MySQL transaction test; a live buyer-approved charge has not been tested.

Windows WebKit reports the video fixture as supported but cannot decode it in this runtime. Three media-layout tests explicitly skip there; the other WebKit workflow tests run. Chromium runs all layout tests with decoded video. A physical iPhone lock/unlock and playback test remains necessary before claiming device-level verification.
