# Quick Caption deployment

Production: https://quick-caption.com (`caption`, port 3000).

QA: https://quick-caption.com/qa/ (`caption-qa`, port 3100).

Use the personal `quick-caption-deploy` skill for SSH authentication and deployment.
A request mentioning QA, staging, or a test environment targets QA exclusively.
Production deployment remains the default when no environment is specified.

## Deploy to QA

Commit the requested changes and push their branch. Do not update `server-changes`
just to deploy a QA change. On the server, run:

```bash
bash /home/quick-caption-ops/deploy-qa.sh FULL_40_CHARACTER_COMMIT_SHA
```

The script fetches the commit, builds in a new release, runs regression tests,
switches only `caption-qa`, checks public HTML and asset hashes, and preserves
the previous release for rollback. The reviewed source is `scripts/deploy-qa.sh`.

QA configuration lives in `/home/quick-caption-qa/shared/.env` with mode 0600.
It uses the `quickcaption_qa` database and a user restricted to that database,
separate `stored-videos`, temporary files, and video signing keys. PayPal is
disabled. Firebase authentication and the OpenAI API account are shared;
transcription in QA can incur API charges. QA starts with an empty database.

The build must use `VITE_APP_BASE_PATH=/qa/`, `VITE_API_BASE_URL=/qa`, and
`VITE_APP_ENV=qa`. Navigation, assets, and Socket.IO stay under `/qa/`.
Pending transcription/payment and per-project style storage are scoped by the
application base path. Firebase sign-in remains shared on this origin.

Apache routes `/qa/` to port 3100 before its production catch-all proxy.
The existing HTTPS certificate and port 443 serve both environments.
