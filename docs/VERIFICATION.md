# Verification record

Date: 12 November 2026. This record distinguishes local fixtures, the real relay and external providers.

## Automated local checks

`node --test tests/*.test.mjs` exercises:

The initial release passed 18 tests. The minimal desktop-operator revision passes 28 tests, including photo transcription gates, exact Sonnet 5/no-thinking receipts, conditional solver results and local packet integrity.

- Indonesian six-section prompt and no dispatch before approval.
- Edited prompt exact text, revision mismatch rejection, rejected prompt and replay deduplication.
- Pause/resume/stop/retry and emergency reset behavior.
- Separate challenge histories and provider-switch context handoff requiring approval.
- User-initiated same-scope follow-up queue and cancellation of unsent follow-ups.
- Category auto-triage with category-specific prompt methodology; manual limit report/reset.
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

`node scripts/check-running-agent.mjs` separately passed against the real background Windows process. Command `8404716e-4755-47ec-ac89-86666b41a785` was acknowledged by the live worker, with a fresh cloud heartbeat. It was a note on the existing TEST task, never a provider prompt. Worker startup/logs and process existence were also observed. The final background worker PID is recorded locally in `.local/agent.pid`, not hardcoded in this report.

## Provider boundary

Claude desktop was inspected on the existing signed-in Free session. Sonnet 5 was selected from More models and Thinking was switched OFF; both were visually observed. No CTF prompt, provider attachment, real solver response or quota-limit event was tested. Claude now uses a desktop-operator queue; its legacy browser adapter is explicitly blocked. Per-task model receipts are operator attestations, not a hidden UI-reading service. Provider restrictions still apply.

Do not describe the project as a verified end-to-end autonomous solver. Worker/website queue tests, UI model configuration and an actual completed CTF solve are different evidence. A scheduled Codex heartbeat, if successfully enabled, supplies wake-ups; it does not prove a challenge was solved or override service restrictions.

## Deployment and UI

Browser checks used the production frontend and actual Worker against an isolated in-memory GitHub protocol fixture. Verified login/error/logout, challenge creation/switching, edit/reject/approve, response import, message sending, pause/resume/stop/retry, provider context handoff, manual limit report/reset, completion, emergency/reset, follow-up attachments, multiple uploads, image preview, download, prompt/flag copy, and Escape/focus behavior. A native Windows browser was also used to confirm a file upload. The initial upload-test paths were malformed by the test harness; corrected absolute Windows paths succeeded. This was not a successful external-provider test.

DOM measurements found no horizontal overflow at viewport widths 320, 390, 768 and 1440. The keyboard focus outline was visible (solid, about 3px). Browser error logs were empty in the final fixture check. Foreground text contrast calculations had a minimum of 5.67:1 across the active palette, including hover surfaces.

The first GitHub Pages deployment completed successfully in [workflow 43157918574](https://github.com/AlthafTM/ctfconnector/actions/runs/43157918574) and returned HTTP 200 at https://althaftm.github.io/ctfconnector/. Later commits rerun the same workflow. `node scripts/verify-deployment.mjs` checks every deployed source asset against the local source and checks JavaScript MIME types; the final chat reports the final workflow and commit actually observed.

The authenticated browser-to-real-GitHub flow was not exercised with a phone token: real relay integration and browser fixture checks are separate evidence. A real phone login still requires the owner's fine-grained token and pairing key. The user must verify actual provider sessions/model/free-tier permission before enabling browser automation.

The minimal revision additionally passed browser fixture checks for photo-only input, transcription before approval, structured flag/chat result, optional/required solver upload, downloaded solver fixture, and prompt-maker copy verified by pasting into a field. Fixture flags/URLs and the solver-fixture.py file are test data, not actual CTF results. The final chat records the actual deployment and heartbeat outcome. See [UI delivery gate](UI_QA.md).

The desktop-operator relay integration passed against the running Windows worker: task `63e22958-c500-4b86-b6cd-3bb56b253416`, approval, WAITING_FOR_OPERATOR, local approved packet, question/answer and stop. No AI was contacted. A concurrent GitHub Contents branch conflict was reproduced and fixed with bounded retries only when the target file SHA remains unchanged; changed target SHAs still fail. The regression suite passes 28 tests.

Prepared-account quota handoff adds a passing regression test (29 tests total): original scope/approval retained, old chat archived, fresh model receipt required, exhausted aliases cannot be reused and old-chat result links rejected. The actual Claude menu showed Log out, without a visible multi-account picker. User confirmed the route is logout then Google sign-in with an account already available in the browser. No account was logged out or switched during verification; the actual OAuth handoff remains untested.

Remember-device browser fixture check: opt-in saves the relay token and non-extractable CryptoKey in IndexedDB, refresh restores without entering credentials, a new tab also restores, and Keluar clears the saved connection. Original pairing secret text is not persisted. This was tested with test/private fixture credentials only.

Auto-accept revision: 33 regression tests cover automatic prompt approval after transcription, turning approval off, exact edited prompt text, stale revision rejection, editable outgoing messages, single-send claiming, pause/stop, archiving uncertain sends without replay, and disabling auto accept while paused. Browser fixture verified default-on new task, automatic WAITING_FOR_OPERATOR, turning auto accept off restores review, initial prompt edit/approval, follow-up draft edit and automatic acceptance of the corrected text. Console errors: none. No external AI contacted; production worker and heartbeat remain stopped.

English/skip revision: 37 tests pass. Solver and prompt-maker instructions are English with the user's casual, direct phrasing; original challenge data and PROMPT MASTER remain intact. Skip clears pending sends/questions, archives outgoing text, writes skip.txt locally, aborts a running worker operation, and rejects further sends until explicit retry. Browser fixture verified English prompt-maker text, skip reason/status, and the Send a new question button opening the creation form. No external AI contacted. Production worker remains stopped and heartbeat PAUSED.
