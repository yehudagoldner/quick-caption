# Account connections

The profile menu links to `?screen=connections` (including the `/qa/` base path). The page lists website logins and Premiere connections, records registration/activity dates, marks the current login, and offers targeted revocation and an explicit all-connections confirmation. All-connections revocation includes the current browser.

## Enforcement

All Firebase-authenticated API entry points, including admin routes and plugin approval, use the server connection guard. The verified Firebase `auth_time` identifies a browser login across ID-token refreshes. Revoked logins remain as tombstones; changing headers, clearing client storage, or refreshing an ID token cannot create a new login. A genuine fresh sign-in is required. Website logins with the same account and exact authentication second share one logical connection; multiple tabs sharing Firebase persistence also share the login. Browser/system labels come from parsed user-agent metadata, not a verified physical computer name.

Targeted revocation always constrains SQL by authenticated account UID. Plugin credentials cannot call the connection-management API. Global revocation records a server-time authentication cutoff, tombstones existing website logins, deletes plugin credentials, and cancels approved pending pairing requests in one transaction. This also blocks old website logins that have not yet registered a connection. The cutoff has second precision: sign-in in the same second as all-connections revocation may need another sign-in after that second.

Media and thumbnail grants are signed with their originating connection and checked against live revocation state. Legacy unbound media grants no longer authorize media access; open pages may need a refresh to obtain a fresh grant. Existing edit links still require a separately verified live login and ownership. Revocation does not remove files already downloaded/cached or cancel work already accepted by the server.

Website clients clear the signed-in state on an explicit `CONNECTION_REVOKED` response, including upload responses, and ignore a delayed revocation response from an older login. Existing 30-second balance polling detects remote revocation while the page is visible; server protection takes effect on the next request regardless of polling. The plugin already handles failed refresh tokens; its client now also clears a revoked upload session without resubmitting paid work. This small client change requires plugin reload for the updated display behavior; server enforcement works with the previous plugin too.

Old website connections appear only after their next authenticated API request. Existing plugin connections can be listed immediately, with missing metadata until next use. These controls govern access to Quick Caption in the selected environment; they do not sign the user out of Google or another environment's separate database.

## Schema and validation

Three additive tables: `account_connection_state`, `browser_connections`, `plugin_connection_details`. Existing account balances, captions, and plugin tokens are preserved during schema initialization. No production migration is authorized by QA testing. Code rollback does not undo revocation tombstones or restore revoked tokens.

Local automated fixtures cover verified-identity routing, ownership, no-store responses, revocation versus temporary outage, signed media binding, stale browser responses, and plugin upload behavior. Playwright tests cover desktop/mobile layouts, targeted disconnection, cancellation, menu navigation, all-device confirmation, and failed/successful responses. `tests/account-connections.mysql.test.mjs` runs only with the existing isolated QA database/user and cleans its unique fixture records; it verifies persistence, token replay rejection, other-account isolation, plugin refresh revocation, pending pairing and media grants without model calls.

Firebase session behavior reference: [Manage User Sessions](https://firebase.google.com/docs/auth/admin/manage-sessions).
