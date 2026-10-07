# Quick Caption agent instructions

## Existing QA environment

The owner requires all server-side testing to use the existing QA environment (instruction dated 2026-10-07).

- QA is `https://quick-caption.com/qa/`, PM2 app `caption-qa`, port `3100`, with database/user `quickcaption_qa` and persistent data in `/home/quick-caption-qa/shared`.
- Discover the active QA checkout from PM2 and update that checkout in place with Git fetch/pull or a reviewed checkout of the requested commit. Preserve local changes, runtime configuration, secrets and shared media.
- Build, run relevant tests, and apply requested migrations against the QA database there before any authorized production rollout. A code release rollback does not undo a database migration; keep an appropriate database backup when a migration needs one.
- Do not create additional server test environments, databases, PM2 applications, disposable test worktrees, or a fresh QA release directory for each change. Use the existing QA process, database and checkout. Local automated test fixtures remain appropriate.
- `scripts/deploy-qa.sh` and `/home/quick-caption-ops/deploy-qa.sh` currently use the legacy per-release worktree workflow. Do not invoke that version: use an in-place QA update, or revise and validate the helper to follow this policy first.
- Retain the existing active and immediately previous QA versions for recovery. Do not accumulate more release directories or leave temporary verification files after use. Preserve any dependency or secret directory referenced by a retained/live process.
- Test fixtures and trial migrations must not use the production database. QA work does not authorize deployment to production.

Use the `quick-caption-deploy` skill for connection details, environment isolation, health checks and production deployment. This owner's QA policy overrides the legacy QA release-directory procedure.
