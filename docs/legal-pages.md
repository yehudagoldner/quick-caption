# Separate legal pages

Added on 2026-10-07 at the owner's request to keep this work outside the application's UI and avoid changes to existing interaction flows.

## Files and delivery

- `public/legal/index.html`: legal information hub.
- `public/legal/privacy.html`: privacy policy and collection notice text.
- `public/legal/terms.html`: service terms.
- `public/legal/cancellation.html`: cancellation information.
- `public/legal/cancellation-notice.txt`: a downloadable notice template; downloading does not submit a request.
- `public/legal/accessibility.html`: truthful draft accessibility statement.
- `public/legal/contact.html`: business identity and contact details, currently missing.
- `public/legal/legal.css`: stylesheet used only by these static documents.

Vite copies `public/legal` unchanged to `dist/legal`. Existing static serving delivers the files without new Express routes or an application router change. All internal links and the stylesheet use relative paths, including the return link to the application base, so the same documents work under `/legal/` and `/qa/legal/` when QA strips its base path in the usual way.

No React component, existing app stylesheet, authentication logic, checkout, API, database schema, or deployment configuration was changed. There are no scripts, trackers, active forms, remote fonts, or new dependencies in the documents. The existing 30-day media retention and 500MB limit were used as factual sources; their implementation was not changed.

## Current status

These documents are **drafts**, visibly labelled as such, with `noindex, nofollow` metadata. This metadata discourages indexing; it does not restrict access or prevent publication. Do not present these drafts as completed legal compliance.

The contact address in `schema.sql` is an admin login, not a verified business/support address. It was deliberately not reused as a public legal contact. The owner was asked for the legal business name, registration number, address, phone, service/cancellation email, privacy email and accessibility contact. Fill the verified details in `contact.html` and replace the draft notices only after resolving the corresponding items.

Before treating the documents as final:

1. Supply and verify the operator's identity and working contact channels. Add normal `mailto:` and `tel:` links where appropriate.
2. Determine the legal classification and cancellation rules of prepaid credits and already-consumed services. Do not assume the digital-information exception automatically applies. The cancellation page describes general statutory rules conditionally.
3. Establish a working online cancellation channel. The static page and downloadable template are **not** a submission mechanism. Avoid a dummy form or false delivery confirmation. This needs a separately scoped implementation or an approved existing receiving channel.
4. Confirm provider agreements, actual processing/storage locations, the basis for international transfers, provider retention, and whether any provider processes content for purposes beyond service delivery. No unverified promise about training or data residency was made.
5. Set retention periods for accounts, payments, operational logs and backups. The media cleaner does not delete these automatically after 30 days.
6. Complete an accessibility audit, applicability/exemption assessment and coordinator assessment; update only verified adjustments and known gaps. The current document does not claim AA compliance.
7. Review the final policies against the actual business operation and applicable law, then remove the draft notices and indexing restriction if appropriate.

## Explicitly outside this change

The owner's request excluded changes to the working application UI. Therefore the following remain separate work:

- prominent links from the homepage and other necessary points of access;
- a short privacy notice at registration and upload, and consent where required;
- disclosure of the total consumer price in shekels, tax treatment and transaction documentation;
- any change to checkout, refunds, account closure, consent recording or an online cancellation endpoint;
- accessibility fixes to the actual app and optional cookie/marketing consent controls, based on the tools actually used.

The privacy notice in a standalone page does not by itself meet every requirement to notify at the point of collection. Similarly, merely adding a cancellation page does not establish an online cancellation channel or meet the requirement for a prominent homepage link.

## Validation and release

Run the existing production build and verify that all static documents were copied. Check relative links, keyboard navigation, RTL layout and narrow-screen overflow on the standalone pages. Local file-based browser checks are fixtures and do not connect to a database or API. No backend tests or migrations are needed for this static-only change.

This request does not authorize a production deployment. If server testing is later requested, use the existing QA checkout/process and follow `AGENTS.md`; do not create a separate server test environment or invoke the legacy per-release QA helper.

Validation completed locally on 2026-10-07:

- `npm run build` passed, with existing dependency/chunk warnings.
- All eight public assets matched their built copies byte for byte.
- 70 local link/asset references resolved; relative application return links were checked for both root and QA base paths.
- All six HTML pages passed file-based Chromium checks at widths 390 and 1280: Hebrew/RTL, one main heading, no horizontal overflow, keyboard skip-link focus and no browser errors.
- The legal hub was visually reviewed. These checks are not a full accessibility audit.
- The Git status contains only the new `public/legal/` files and this documentation; no tracked application files were modified.

## Official references used for drafting

- Privacy collection notice: https://www.gov.il/BlobFolder/generalpage/manager_duties/he/InfoDuties_new.pdf
- Consent guidance (2026): https://www.gov.il/BlobFolder/legalinfo/consent-2026/he/cpncent-2025.pdf
- Consumer disclosure and cancellation guidance: https://www.gov.il/BlobFolder/generalpage/information-olim-consumerism/he/smart-consumerism-he.pdf
- Cancellation channels: https://main.knesset.gov.il/Activity/Legislation/Laws/Pages/LawBill.aspx?lawitemid=2002974
- Consumer pricing (section 17D): https://www.gov.il/BlobFolder/dynamiccollectorresultitem/9139-05-18/he/9139-05-18.pdf
- Internet accessibility: https://www.gov.il/he/pages/website_accessibility
