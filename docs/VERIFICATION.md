# Verification record

Date: 12 November 2026. This record distinguishes local fixtures, the real relay and external providers.

## Automated local checks

`node --test tests/*.test.mjs` exercises:

- Indonesian six-section prompt and no dispatch before approval.
- Edited prompt exact text, revision mismatch rejection, rejected prompt and replay deduplication.
- Pause/resume/stop/retry and emergency reset behavior.
- Separate challenge histories and provider-switch context handoff requiring approval.
- User-initiated same-scope follow-up queue and cancellation of unsent follow-ups.
- Added attachments invalidating previous approval.
- Candidate flag extraction without scoreboard submission.
- Rejection of unknown command verbs and off-provider/login/token-bearing conversation URLs.
- AES-GCM roundtrip; wrong-key, ciphertext tamper and cross-repo/path rejection.
- Public relay refusal, chunked binary transfer, SHA-256 integrity and file size/path validation.
- Actual Worker persistence, encrypted local journal, restart, uncertain-send recovery and lease exclusion using an in-memory protocol fixture.
- Byte-for-byte PROMPT MASTER reference integrity (SHA-256 `aab34190ef8d6c7b6bfa5b14d8963ac5cc47794763bada1976a8439a4a29ae95`).

Windows DPAPI protect/unprotect roundtrip was separately run successfully. Node syntax checks passed for frontend and browser/worker modules.

## Real GitHub relay check

`node scripts/live-check.mjs` passed against the private `AlthafTM/ctfconnector-relay` repository. This used GitHub's real HTTPS Contents API, encrypted command files, worker consumption, state publication, file encryption/chunk transfer/checksum, prompt approval and manual response import. The harmless test task is clearly named TEST and retained as evidence. Its ID is `adc74542-9cac-4bc8-877e-ca1b8b721d50`.

Test response `DEMO{connector_transport_only}` is a **fixture**, not a flag found by AI and not a competition submission. No external AI was contacted.

## Provider boundary

No ChatGPT/Claude/Gemini login, model selection, actual provider file upload, actual provider quota detection or real provider response extraction was verified. The visible-browser CDP adapter exists but requires local selectors, verified free-tier/model access and provider automation permission. Default profiles remain manual and UNVERIFIED. Consumer Claude automated access is restricted by its terms. The shipped fallback is review/copy/open/import using the official provider UI.

The unattended remote browser-solving part of the original definition of done remains blocked on those external requirements. Do not describe the whole project as end-to-end autonomous solving.

## Deployment and UI

The final UI/deployment observation is recorded after the GitHub Pages workflow and browser checks. Source-only tests are not a claim that every third-party integration works.
