# SoloPi TrustBench: first Agent baseline protocol

Current status (2026-10-15): the scoped reproducible pilot is closed; see [PILOT-CLOSURE.md](PILOT-CLOSURE.md) and [REPRODUCE.md](REPRODUCE.md). The current 60-second group has one passing live-model/control pair and separate on-device new-seed positive/false-done Oracle probes. Historical failures remain retained. This is not a comparative or general-purpose Agent benchmark. The v0 counter suite and intentional negative cases must never become an Agent success-rate denominator. Earlier dated sections below are historical, not current completion gates.

## Next executable milestone

The first separate task set is [agent-tasks-v0.json](agent-tasks-v0.json): two independent counter goals (0 to 1 and 0 to 2). Each task resets the fixture, waits, asserts the start value is 0, gives a bounded dynamic goal, checks the target from SoloPi's post-action page observation, and cleans up. Neither task depends on the other. [agent-scripted-control-v0.json](agent-scripted-control-v0.json) is a scripted execution control, not an Agent policy.

This is a small fixture-validation set, not a useful general-purpose benchmark. Add navigation, forms, held-out seeds and perturbations only after the reset and Oracle are repeatable. Freeze task and Oracle versions before model trials, and keep the v0 contract suite unchanged for regression checks.

Compile and run the scripted control from the repository root, using a new artifact directory:

```bash
./solopi-harness-cli/solopi-ai verify-compile \
  --file solopi-harness-cli/trustbench/agent-tasks-v0.json \
  --output /tmp/trustbench-agent-tasks-plan.json
./solopi-harness-cli/solopi-ai --serial DEVICE_SERIAL verify-run \
  --plan /tmp/trustbench-agent-tasks-plan.json \
  --agent-decisions solopi-harness-cli/trustbench/agent-scripted-control-v0.json \
  --no-restart-app --artifacts /new/empty/control-run
```

On the pilot Redmi/Android 16 device, the final scripted-control run passed both tasks: the dynamic Oracle saw `1` and `2`, and artifact audit verified 28 files across six segments. The task file SHA-256 was `6b7d6fe53ef312b22d9d9b9ea857d7a7cf09f62036d01d1c729c4937d8cac506`; the compiled plan fingerprint was `b5acf2a7232821f7fc940e23818166bf9d3b42eb4d88efac68169a337e997ed6`. The raw local run is under `../../../oa2026-solopi/runs/trustbench-agent-control-20261014-live-03/` in this workspace. This is one control run, not a reliability estimate.

Two earlier pilot runs used a fixed Oracle in a *separate replay segment* and failed despite Agent action receipts observing `1` and `2`: the later replay assertion saw `0` for both targets, including with `--no-restart-app`. The counter stores state only in Activity memory, and the replay boundary did not preserve it. Those raw runs remain as `trustbench-agent-control-20261014-live-01` and `live-02`; they are invalid fixture trials, not Agent failures. The revised target Oracle uses the page captured by SoloPi immediately after an action. It is separate from the Agent's `done` claim, but shares the accessibility observation channel and is not a backend or persisted-state Oracle.

Run the same task seed and device configuration with (1) a scripted control and (2) a named live DecisionProvider using `verify-run --decision-provider cloud` or `on-device`. The provider endpoint or signed model package, exact model version, prompt/policy version, fallback setting, tool permissions, maximum steps, timeouts and retry policy must be recorded before each run. A provider that cannot be identified, an unrecorded fallback, or missing decision transcript makes the trial ineligible for an Agent score. Do not use `--agent-decisions` for the live track.

For an OpenAI-compatible HTTPS chat-completions endpoint, a local typed adapter is available. Configure the endpoint, credential and model ID in the process environment; do not put secrets in arguments, source files or run artifacts. It binds only to `127.0.0.1`, sends the goal, allowed actions and current visible counter controls with app-owned resource IDs, and returns a typed decision plus model ID, request ID, latency and token counts. It does not send the private Oracle, raw evidence or owner token. The adapter uses one stateless model call per decision and rejects clicks on nodes absent from the current observation.

```bash
# Configure TRUSTBENCH_MODEL_ENDPOINT, TRUSTBENCH_MODEL_API_KEY and
# TRUSTBENCH_MODEL_ID securely in this process environment first.
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_model_bridge --port 18765

./solopi-harness-cli/solopi-ai --serial DEVICE_SERIAL verify-run \
  --plan /tmp/trustbench-agent-tasks-plan.json \
  --decision-provider cloud --cloud-endpoint http://127.0.0.1:18765/decide \
  --cloud-timeout 95 \
  --no-restart-app --artifacts /new/empty/model-run
```

The local bridge endpoint is HTTP only on loopback; upstream model traffic must use HTTPS. Set the environment variables in the shell without saving a plaintext secret to the benchmark package. Earlier configured credentials returned HTTP 401 during non-device probes. Later user-authorized Kimi-K3 requests used the provided credential without persisting it in the repository or run artifacts; rotate it because it was shared in chat.

The bridge now defaults to 1,024 output tokens instead of the original 300 for
Chat Completions (500 for Responses). Set `TRUSTBENCH_MODEL_MAX_OUTPUT_TOKENS`
to an integer from 1 to 8,192 to freeze another per-decision budget. The
requested budget is recorded in each model receipt. A provider `length` finish
or incomplete Responses result is reported as `model_output_truncated` in the
bridge diagnostic log; it is not silently parsed as a complete decision. This
changes the model policy budget, so trials with the new default must be kept
separate from the earlier 300-token trials in any comparison.

The bridge also supports an OpenAI-compatible Responses gateway. Set `TRUSTBENCH_MODEL_WIRE_API=responses` and `TRUSTBENCH_MODEL_ENDPOINT=https://ai.feei.cn/v1/responses`, with the credential supplied through `TRUSTBENCH_MODEL_API_KEY`. This path sends `store: false` and reads the typed decision from Responses output text. `review_model` is a Codex review setting and does not affect this benchmark bridge. The credential shared in chat should be rotated after testing. The Feei Responses path currently returns HTTP 403 in direct calls; listing a model or succeeding through Codex CLI does not make it usable by this bridge.

For the antchat example, use `TRUSTBENCH_MODEL_ENDPOINT=https://model-provider.example.invalid/v1/chat/completions and `TRUSTBENCH_MODEL_ID=Kimi-K3`. If that gateway requires caller-provided `SOFA-TraceId` and `SOFA-RpcId`, set `TRUSTBENCH_SOFA_TRACE_ID` and `TRUSTBENCH_SOFA_RPC_ID`; the bridge forwards them but does not put them in result receipts. It does not invent a trace-ID format. The credential shared in chat should be rotated before use; only a fresh key configured in the local environment should be used for the trial.

User-authorized Kimi-K3 non-device preflights on 2026-10-14 first timed out at the bridge's original 25-second upstream limit, then returned HTTP 429 with a 90-second limit. A later retry returned a typed click decision in about 9 seconds. These observations show intermittent provider availability; they are not mobile-task outcomes.

Two subsequent live device trials used the same compiled task plan (`b5acf2a7232821f7fc940e23818166bf9d3b42eb4d88efac68169a337e997ed6`), `Kimi-K3`, no fallback, and `--cloud-timeout 95`:

| Trial | Counter to 1 | Counter to 2 | Evidence audit |
|---|---|---|---|
| `trustbench-agent-kimi-k3-20261014-live-01` | `not_tested`: first model decision returned upstream HTTP 503 | `passed`, Oracle actual `2` | 27 files, 6 segments |
| `trustbench-agent-kimi-k3-20261014-live-02` | `passed`, Oracle actual `1` | `passed`, Oracle actual `2` | 28 files, 6 segments |

Across these four task attempts: three passed, one was not tested due to provider unavailability, and none was an Oracle-confirmed task failure. The first trial is not discarded or merged with the second. Model receipts in the second trial identify five Kimi-K3 decisions with `fallbackUsed: false`; the raw local reports, events and transcripts remain in the named run directories. A single device, two trivial tasks and two trials do not establish reliability, cross-device generalization, or a model ranking. The target Oracle uses the same accessibility observation channel as the Agent, not an independent backend state.

On 2026-10-14, a separate `gpt-5.5` Responses preflight returned one typed click decision with a model response ID. The subsequent full device run `trustbench-agent-gpt55-20261014-live-01` used the same task plan but both first model calls returned HTTP 403 from the upstream gateway. Both tasks were `not_tested / model_decision_failed`; no GPT-5.5 action was executed. Reset and cleanup passed, and artifact audit verified 26 files across six segments. This is an access/provider availability result, not a task-failure or model-quality result. The gateway's rejection reason was not available, so no model comparison can be inferred from this run.

The follow-up gateway check on the same date returned 14 model IDs from `/v1/models`, including `gpt-6.1-sol`, `gpt-6-astra`, `gpt-6-sol`, and `gpt-6-luna`. A minimal direct `/v1/responses` request for `gpt-6.1-sol` returned HTTP 403 with an official-client-only rejection, while a minimal `codex exec --ephemeral -m gpt-6.1-sol` request returned `OK`. Model listing and CLI access therefore do not establish that the existing direct-HTTP bridge can run the benchmark. The CLI also warned that this model was absent from its local metadata cache and used fallback metadata. No `gpt-6.1-sol` device trial or task score has been recorded. Before a trial, validate a typed decision through an authorized transport with a frozen prompt, parser, model identity and request receipt; keep provider rejection as `not_tested`, not model failure. Do not replay the failed GPT-5.5 run as a GPT-6.1 result.

Direct `/v1/chat/completions` calls with `gpt-6-sol` sometimes returned HTTP 200. Three consecutive calls through the typed bridge with a simple counter observation returned valid `act` decisions; the first full device trial, `trustbench-agent-gpt6-sol-20261014-live-01`, nevertheless returned upstream HTTP 403 at the first decision in each task (`0 passed / 2 not_tested`). The bridge then excluded layout and system-decoration nodes without app-owned resource IDs. A preflight with the previous device observation returned valid decisions twice. In the new full trial, `trustbench-agent-gpt6-sol-20261014-live-02`, the counter-to-one task passed with one model-selected click, a model `done`, and a matching Oracle value of `1`; counter-to-two was `not_tested` after an upstream 403 before any model action. The evidence audit verified 26 files across six segments in live-01 and 27 files across six segments in live-02. Both runs use the same compiled task plan and no fallback. This is one confirmed live task success, not a stable two-task baseline or a model comparison.

The gateway's rejection is sensitive to the request shape: a reduced representation of the second task's same visible controls once returned HTTP 200, while the bridge's complete typed context repeatedly returned 403. Do not adapt the benchmark to evade a provider access rule. The chat path has not established the `store: false` privacy contract that the Responses path sends. Treat `gpt-6-sol` on this gateway as connected but not admitted for a reliability baseline until the provider documents and supports a stable non-Codex API route. The earlier Kimi-K3 live-02 run was the first complete two-task model pilot; its separate live-01 503 must remain in the ledger.

A separate 2026-10-14 trial used the locally configured Theta API credential with AntChat's `Kimi-K3` chat-completions endpoint, not the Feei credential. A minimal call and both real-observation typed-decision preflights succeeded. The full device run `trustbench-agent-theta-kimi-k3-20261014-live-01` passed both independent counter tasks: the target Oracle observed `1` and `2`, and five model decisions had `Kimi-K3` request IDs with `fallbackUsed: false`. Evidence audit verified 28 files across six segments. The credential was read only into the bridge process and is absent from the run bundle. This confirms one complete Theta/AntChat pilot, not sustained provider availability or general Agent quality; the earlier AntChat 503 and the single-device, two-task scope remain limitations.

The next versioned fixture is [agent-recovery-v1.json](agent-recovery-v1.json), SHA-256 `e89e37b3c3bd2d690afe9753a697d354f0997359c12d6e0bc71dbfb3131c7c80`. It is separate from the frozen v0 pair and tests three consecutive Agent goals in one scenario: reach `2`, reset to `0`, then recover to `1`. Each goal has its own post-action UI checkpoint; a verified reset checks the starting `0`. The compiled plan fingerprint is `d2f72d041554a55ff0ac315ec945e1b0eb9db036d76fcfd40f4d61ad3094dbdc`.

On the pilot device, `trustbench-agent-recovery-control-v1-20261014-live-01` passed with the [scripted control](agent-recovery-control-v1.json), and `trustbench-agent-recovery-theta-kimi-k3-v1-20261014-live-01` passed with the Theta/AntChat `Kimi-K3` DecisionProvider. The live checkpoints observed `2`, `0`, then `1`; the transcript records seven model decisions with request IDs, no fallback, and the expected increment, reset, increment action sequence. Each run's evidence audit verified 18 files across five segments. The control only validates the fixture; the live run is one observed model success, not a reliability estimate. This still uses one app, one phone, and the Agent's accessibility observation channel for the target Oracle. Held-out perturbations, independent backend truth, and repeated seeds remain open.

The independent navigation/form fixture is [agent-notes-v1.json](agent-notes-v1.json), SHA-256 `6e45dd6ab9d7b808a5755e567eeb8d73391bd320035a03b6ba7ae2769e5b89b3`. Its separate `com.example.trustnotes` app persists one note, and the task requires opening the editor, entering a title and body, saving, and checking both fields on the detail page after a verified empty-list reset. The compiled plan fingerprint is `d1ff7a0287ed9cb767c868880e823692d2ccc4e906defd9dd9fb87c04049763f`. The typed bridge supports `input` only on visible editable nodes for this allowlisted package; the counter default remains unchanged. A synthetic Theta/AntChat preflight returned a valid new-note click and title input. After owner confirmation of the SDK license and USB install, the APK was built with SHA-256 `fefa579e7f23d23fb202b4d048c7972187e40ebc533863201270c89b19bbcd43` and installed on the pilot device.

The scripted control run `trustbench-agent-notes-control-v1-20261014-live-01` passed its empty-list, saved-title, and saved-body checkpoints. The live Theta/AntChat Kimi-K3 run `trustbench-agent-notes-theta-kimi-k3-v1-20261014-live-01` passed the same plan. Its five model decisions have request IDs and `fallbackUsed: false`: click New note, input `Trip checklist`, input `Passport and charger`, click Save note, then `done`. The target Oracle observed both exact strings on the detail page. Each run's evidence audit verified 14 files across three segments. The scripted control establishes fixture executability, not Agent performance; the live run is one observed success, not a reliability estimate. The UI checkpoint is independent of the Agent's `done` claim but shares its accessibility channel and is not a separate persisted-state readback. Cross-device runs, independent backend truth, held-out perturbations, and repeated seeds remain open.

The follow-up [notes v2 task](agent-notes-v2.json) retains the saved note instead of resetting during cleanup. The v0.2.0 test-only APK enables `run-as`; a separate receipt stops the process and parses its private `trustbench_notes.xml`, requiring exact title and body values and a matching installed APK digest. This makes the persisted-state check independent of the Agent's detail-page observation, although it still trusts the test application's local storage implementation rather than an external backend. Its source SHA-256 is `723128d4b13ec5852d3238765fd1f7708529ee9a11f2365bfd2740a3e78b545b`; compiled plan fingerprint is `c9c25fb759af01030345c2440d25540636223696c3c84c7743f2c0d4b287759e`; fixture APK SHA-256 is `e6c74dec77836d7c354139d2ceaa30cc5e3cb46dd98f8634dab1757212694480`.

On 2026-10-14, the phone rejected two install attempts with `INSTALL_FAILED_USER_RESTRICTED`, then accepted a retry after owner action. The scripted `control-v2-live-01` run passed its three UI checkpoints, and an initial storage readback observed exact values after force-stop. That receipt was subsequently overwritten by a second read after the model run's reset, because the receipt writer lacked an immutability guard. Its archived receipt now says `persisted_values_mismatch`; do not cite this run as durable storage evidence. The phone's `pm path` also emitted only the package name; the reader now uses `cmd package path`. The receipt writer now refuses to overwrite an existing file. The new scripted run `trustbench-agent-notes-control-v2-20261014-live-02` passed the same three UI checkpoints; its archived storage receipt read exact `title=Trip checklist` and `body=Passport and charger` after force-stop, with installed APK digest `e6c74dec77836d7c354139d2ceaa30cc5e3cb46dd98f8634dab1757212694480`. This is a valid control fixture result, not Agent performance. The Theta/AntChat `Kimi-K3` run `trustbench-agent-notes-theta-kimi-k3-v2-20261014-live-01` made one accepted model click, then the upstream returned HTTP 429 at the next decision; SoloPi marked it `not_tested`.

The follow-up live model run `trustbench-agent-notes-theta-kimi-k3-v2-20261014-live-02` passed all three UI checkpoints on the same frozen v2 plan. Its archived storage receipt independently read the exact title and body after force-stop, with the same installed APK digest. The transcript records five `Kimi-K3` decisions with request IDs and `fallbackUsed: false`. This is one confirmed model-run persisted-state success alongside one provider-limited `not_tested` attempt, not a reliability estimate. The old v1 results must not be upgraded to persisted-state passes; cross-device repetition and backend truth remain open.

The [notes v3 alternate-seed task](agent-notes-v3.json) changes the required values to `Quarterly review` and `Check totals before Friday` while retaining the v2 fixture, reset, action budget, and independent storage readback. Its source SHA-256 is `ee386a8dcfff81f1004793e8024fd351cf0f8ca27e8ddf720a11ee9dd61e4468`; compiled plan fingerprint is `200b341d47940ab6f30398b0ff5f9795d312fdbe3bea89a6148b0c1a86f5c45d`. The reader rejects v2 persisted values for this frozen v3 plan in a negative unit test. `trustbench-agent-notes-control-v3-20261014-live-01` passed its three UI checkpoints and its archived storage receipt read the new exact values after force-stop. The first Theta/AntChat Kimi-K3 attempt `trustbench-agent-notes-theta-kimi-k3-v3-20261014-live-01` made two model decisions before an upstream HTTP 429; it remains `not_tested`, not a task failure. The second attempt `trustbench-agent-notes-theta-kimi-k3-v3-20261014-live-02` passed all three UI checkpoints and its archived storage receipt read the exact new values after force-stop. Five model decisions have request IDs and `fallbackUsed: false`. These are two task values on one app and one device, with provider-limited attempts retained; no generalization or reliability estimate follows.

## Required result ledger

The machine-readable Agent-track [attempt manifest](agent-ledger-20261014.json)
lists all 26 Notes attempts: seven historical `.tar.zst` archives, four
unarchived v3 attempts on the first device, five Pixel 8 v3 control attempts,
one Pixel 8 v3 live-model attempt, and nine Pixel 8 revisit attempts.
The offline evaluator streams and hashes archived
evidence without extraction, then verifies each report's frozen plan and outcome
fingerprint, file and inline evidence, model receipts, and persisted-state
receipt before classification. Current raw counts: scripted control `6 passed,
4 not_tested, 1 task_failed, 1 evidence_invalid`; live Kimi-K3 `8 passed,
5 provider_not_tested, 1 setup_failed`. The invalid control receipt is the overwritten v2 live-01
readback; its UI PASS is not counted as a persisted-state PASS. These are attempt
counts across two devices and three fixed note values, not an Agent success
percentage or reliability estimate. The second device has one scripted-control
PASS and one live-model PASS on the same v3 task. v1
UI-only trials are excluded from this persisted-state ledger. This closes the
manual-only ledger gap, not the cross-device reliability, held-out-task,
repeated-seed, or independent-backend gaps.

The ledger's `policyGroups` are raw audit partitions, not success-rate
denominators. They separate frozen plan, track, model, recorded model output
budget, receipt-backed device serial, and APK digest. Early model receipts did
not record `maxOutputTokens`, so their budget is `null`, even where the bridge
configuration was described as 300 tokens; only the later 1,024- and
4,096-token limits are directly attested in the decision receipts. A failed
attempt often has no storage receipt, so device serial and APK digest remain
`null`; a run-directory name is not proof of either identity. Consequently a
failed attempt with unknown identity must not silently be merged into a
receipt-backed PASS group. The 4,096-token revisit group has three PASS
attempts on one device, not enough breadth for a reliability estimate.

For the next **reproducibility pilot**, freeze the existing v3 and revisit-v2
tasks, the same APK digest, Kimi-K3 bridge version, 4,096-token limit, timeout
and no-fallback policy before touching a device. Run each task three times per
device on two prechecked devices, pairing each live-model attempt with a
scripted-control attempt and writing the manifest entry immediately after each
run. Capture storage readback before the next reset. Limit new artifact storage
to 50 MiB total, check it after every attempt, and stop on provider/auth or
device setup failure without replacing that attempt. This is a repeatability
check for two frozen note tasks, not a general benchmark score. A public Agent
benchmark still needs additional independently designed apps and held-out
tasks, an independently checked outcome beyond this local fixture, and enough
repetitions to report uncertainty. Do not pool policy groups or discard failed
attempts to manufacture a rate.

After bounded logcat collection was introduced, two more v3 attempts ran on
2026-10-14 with the same frozen plan, model and budget. `trustbench-agent-notes-theta-kimi-k3-v3-20261014-live-03`
failed the initial `list-is-empty` checkpoint before the model phase. Its report
remains `failed`; the stored note still held the previous values. The post-run
screenshot showed the recent-apps UI, but this does not prove why reset failed.
No model performance outcome can be inferred from this setup failure. The file
auditor rejects its inline `checkpoint_unreached` entries; full audit is not claimed.

Before `trustbench-agent-notes-theta-kimi-k3-v3-20261014-live-04`, the operator
explicitly foregrounded the fixture with `am start`, without clearing its data.
The frozen reset and all three UI checkpoints passed, followed immediately by
an independent force-stop storage readback matching both fields. Five Kimi-K3
decisions had request IDs and no fallback; the file audit verified 8 files across
2 segments. This is a successful repeat with an explicitly recorded foreground
preparation, not proof of unattended reset reliability. Both new run directories
together occupy about 1.6 MiB. Older attempts remain in the local archive.

The fixed replay adapter now restores `com.example.trustnotes` to the foreground
before the notes reset segment and returns `not_tested / target_app_restore_failed`
if that preparation fails. It does not change the frozen v3 plan or the model
policy. Without an operator foreground action, the next scripted run
`trustbench-agent-notes-control-v3-20261014-live-02` passed its UI and storage
checks; the next Kimi-K3 run `trustbench-agent-notes-theta-kimi-k3-v3-20261014-live-05`
also passed. Both file audits verified 8 files across 2 segments. The model run
has five request IDs with no fallback, and its independent storage readback
matched both exact fields after force-stop. The failed `live-03` remains a
setup/checkpoint failure; these two post-fix trials are evidence of improvement,
not a measured reliability rate. All current unarchived runs occupy about 3.3 MiB
with bounded logcat collection.

## Pixel 8 cross-device setup probe (2026-10-15)

The new Google Pixel 8 (`37201FDJH00E6A`, Android 16 build
`google/shiba/shiba:16/BP4A.260105.004.E1/14587043:user/release-keys`) passed
SoloPi `doctor` after the owner enabled accessibility. The same fixture APK
digest and frozen v3 plan fingerprint were used. Two scripted-control attempts
were retained in the ledger, both `not_tested`: live-01 passed the empty-list
checkpoint, then the body input was rejected as `stale_observation` after the
new-note click and title input succeeded; live-02 passed the same checkpoint,
then its first click failed because the controllable foreground page root was
unavailable. After live-02, the foreground window was an Android notification
permission prompt for SoloPi, which plausibly explains that attempt's page-root
failure but does not prove the cause of live-01. No storage readback was made
for either unfinished task, and neither is an Agent outcome.

The Pixel 8 clock reported `2025-12-15T00:01:09Z` while the host reported
`2026-10-15T02:36:13Z`, despite Android `auto_time=1`. Its event timestamps
must not be compared directly with the older phone's until the clock is fixed
and read back. The notification prompt was subsequently dismissed. The clock
offset was not corrected because the local task and persisted-state check do
not depend on wall time; device event timestamps remain unsuitable for direct
cross-device ordering.

The next scripted-control attempt, `trustbench-agent-notes-control-v3-pixel8-20261015-live-03`,
passed all three UI checkpoints with the same frozen v3 plan. Its independent
force-stop storage receipt matched `Quarterly review` and `Check totals before
Friday` and the installed fixture APK digest
`e6c74dec77836d7c354139d2ceaa30cc5e3cb46dd98f8634dab1757212694480`.
The offline audit verified 8 files across 2 segments; its bounded run directory
occupies 856 KiB. This establishes fixture/control executability on the second
device while retaining both earlier `not_tested` attempts. This control run
alone is not a live-model result or a reliability estimate.

One matched live-model attempt followed on the Pixel 8:
`trustbench-agent-notes-theta-kimi-k3-v3-pixel8-20261015-live-01` used the same
frozen v3 plan, `Kimi-K3` via Theta/AntChat, and no fallback. All three UI
checkpoints passed. An immediate independent force-stop readback matched both
exact fields and the installed APK digest above. The transcript contains five
model decisions with request IDs, including four actions and `done`; the
offline evidence audit verified 8 files across 2 segments. The run occupies
784 KiB. This is one cross-device model PASS on a fixed fixture, not a
cross-device success rate or a broad generalization claim. The Pixel 8 clock
offset still prevents direct ordering of device event timestamps across phones.

## Saved-note revisit probe (2026-10-15)

The [v2 revisit task](agent-notes-revisit-v2.json) freezes a three-stage goal:
create `Budget review` / `Reconcile 3 invoices`, return to a list containing one
note, then reopen and verify both fields. Six UI checkpoints are attached to
their respective stages; a separate force-stop `SharedPreferences` readback
checks the final persisted values. It uses the same fixture APK. Source SHA-256
is `6f5ce55f0dd4162b0f8a2c3ac0e8070e3603f38291ddce12aa5c1f6d36be42dd`;
compiled plan fingerprint is
`d4910d8a903178528ed7bd1628a2a823deeafb72b1a3c0e5e6aab7d821435643`.

The preceding frozen [v1 task](agent-notes-revisit-v1.json) remains as a failed
control attempt. Its exact list-button text Oracle expected `Budget review`,
but Android exposed `BUDGET REVIEW` for that button. All other six checkpoints,
including the reopened detail fields, passed; all three control segments were
`done`. This is an Oracle/fixture mismatch, not evidence of lost note data.
The v2 task drops only that presentation-sensitive checkpoint; its list count,
initial and reopened exact fields, and storage truth remain strict.

`trustbench-agent-notes-revisit-control-v2-pixel8-20261015-live-01` passed all
six UI checkpoints and the independent storage readback. The offline audit
verified 12 files across four segments; its run directory is about 980 KiB.
The matched live attempt
`trustbench-agent-notes-revisit-theta-kimi-k3-v2-pixel8-20261015-live-01`
completed note creation and clicked Back to notes, then the bridge rejected the
next model response as invalid JSON. SoloPi reported `not_tested` /
`model_decision_failed`, leaving the list and reopen checkpoints unreached;
no storage PASS is claimed. Six accepted model decisions have request IDs and
no fallback. Its evidence audit verified 9 files across three reached
segments, and its directory is about 880 KiB. No automatic retry was made.
This expands the frozen task and validates its control path, but does not yet
establish model success on the revisit task.

The user-requested second model attempt, `trustbench-agent-notes-revisit-theta-kimi-k3-v2-pixel8-20261015-live-02`,
used the unchanged v2 plan, APK, model policy and budgets. It again passed the
creation checkpoints and reached the return-to-list segment before a bridge
`JSONDecodeError`. Six accepted model decisions and five actions were recorded;
the list and reopen checkpoints remain `not_tested`. The current bridge log
does not distinguish invalid upstream response JSON from invalid model-content
JSON, so the precise parse failure remains unresolved. This attempt is retained
as `provider_not_tested`, with no storage PASS claimed. Audit verified 9 files,
3 segments and 2 inline entries. Its directory is 888 KiB; no further device
retry was started after the repeated failure.

The third revisit model attempt, `trustbench-agent-notes-revisit-theta-kimi-k3-v2-pixel8-20261015-live-03`,
used the new 1,024-token output budget while keeping the v2 task plan and APK
unchanged. The create and return-to-list stages passed; the reopen stage made
one accepted click, then the bridge reported `model_output_truncated` on its
next decision. The two reopened-field checkpoints remain `not_tested` and no
storage PASS is claimed. Eight accepted model decisions recorded the 1,024-token
budget; evidence audit verified 11 files across four segments. The run is
936 KiB. This attempt is separate from the earlier 300-token attempts and is
not a task failure or success.

A read-only probe using the failed reopen observation returned a complete
`done` at a 4,096-token limit (2,186 completion tokens); it did not operate the
phone or count as a task attempt. The subsequent frozen-plan device run,
`trustbench-agent-notes-revisit-theta-kimi-k3-v2-pixel8-20261015-live-04`,
passed all six UI checkpoints, including the list and reopened-detail stages.
Its independent force-stop storage receipt matched `Budget review` /
`Reconcile 3 invoices` and the installed APK digest. All nine Kimi-K3
decisions have request IDs, `maxOutputTokens: 4096` and no fallback; six were
actions. The offline audit verified 12 files across four segments. Its run
directory is 972 KiB. This is one complete model PASS for the revisit task
under the new output budget, not a reliability estimate. Earlier 300- and
1,024-token provider-limited attempts remain separate in the ledger.

Two further 4,096-token Kimi-K3 revisit attempts, `live-05` and `live-06`,
used the same frozen plan, Pixel 8 and APK. Each passed all six UI checkpoints,
the immediate force-stop storage readback, and the 12-file/four-segment offline
audit. Each has nine request-ID-bearing decisions, six actions and no fallback.
Their directories are 980 and 968 KiB. A paired scripted control
`trustbench-agent-notes-revisit-control-v2-pixel8-20261015-live-02` also
passed the same UI/storage checks and audit, occupying 960 KiB. Thus the
4,096-token revisit task has three recorded live-model PASS attempts on this
one device, while earlier provider-limited attempts remain in the full ledger.
This is limited same-task repeatability, not a cross-app or cross-device rate.

The next scripted v3 control,
`trustbench-agent-notes-control-v3-pixel8-20261015-live-04`, passed its
empty-list reset but the first click returned `action_failed` with
`Controllable foreground page root is unavailable`. It is `not_tested` with
no storage PASS; its eight-file/two-segment evidence audit passed. A read-only
post-run check found Notes in the foreground, which does not establish the
page-root state at click time. The attempt remains in the manifest. Under the
predeclared stop rule, no paired v3 model trial followed it.

A fresh v3 control attempt, `trustbench-agent-notes-control-v3-pixel8-20261015-live-05`,
again passed the empty-list reset but failed its first Agent click with the
same `Controllable foreground page root is unavailable` error. Its report is
`not_tested`, with no storage PASS; eight files across two segments passed the
offline evidence audit. The Agent's initial observation existed, but the
implementation re-reads and validates the root immediately before an action
for up to five seconds. The artifacts do not reveal which root candidate was
seen during those retries. This repeated setup failure triggered the stop
rule; no Kimi-K3 v3 run was started, despite the credential being available.

Source inspection identified a plausible first-action race: the ADB transport
opens SoloPi's `AdbSchemeActivity`, its `act` handler schedules work on a
background executor, and the host restores Notes to the foreground only after
the Scheme command returns. The worker can therefore spend its five-second
root-acquisition window while SoloPi's transport Activity is still foreground.
The initial Notes observation and failed action receipts support this timing
path, but do not prove which root candidate was seen on each retry. A narrowly
scoped code change now finishes the transport Activity immediately after an
`act` request is accepted, without weakening package, page-size, or stale-
observation checks. On 2026-10-15, `:app:testDebugUnitTest` and
`:portal:assembleDebug` passed using Android 29, Build Tools 29.0.2,
NDK 21.1, CMake 3.10.2, JDK 11, and Gradle 6.1.1. The resulting debug APK
has SHA-256 `6a89b5c0b9d1f3c97601f096636fb1aa4f29f52171f4a2cac359f78a21b28010`.
It is signed with the local Android debug certificate, while the Pixel 8's
installed SoloPi is signed with the SoloPi Open Source Release certificate.
The signatures differ, so it was not installed; uninstalling the existing app
would lose its data and permissions. The source change remains **not
device-validated**, and no new v3 control or model attempt was recorded.
New-build trials must identify the SoloPi APK digest and must not be pooled
with the earlier build's attempts.

### Isolated diagnostic build (2026-10-15; device validation pending)

With user approval, a separate `com.alipay.hulu.trustbench` debug build was
installed on Pixel 8 without uninstalling or replacing `com.alipay.hulu`.
Build with `:portal:assembleDebug -PtrustbenchIsolated`; default builds retain
the original package. Runtime IME/service identities, FileProvider authority,
default storage directory, and control port are isolated. The diagnostic
port is 23343 and the default directory is
`/sdcard/solopi-com.alipay.hulu.trustbench`.
Final APK SHA-256:
`7207c686811cbe4e7b1d780879b60125bae25d5e577d6b1e3b04a6bc5127f7b1`.

An initial doctor call mistakenly reached the original app on port 23342;
that response is **not** diagnostic-build readiness evidence. The CLI now
rejects capabilities with a missing or mismatched package identity. Both new
identity tests pass. The full CLI test file ran 197 tests, with one error in
the existing launcher-path test because `tools/solopi-ai/solopi-ai` is absent.
Android app unit tests and the isolated debug APK build passed.

After reinstalling the port-isolated APK, doctor on port 23343 could not
connect. The phone showed Android's debug-app compatibility warning:
`lib/arm64-v8a/libnativeModule.so` has LOAD segments that are not 16 KB aligned.
Execution paused at that warning for user review and first-launch permissions.
No v3 regression was started or registered, and the page-root race fix remains
device-unvalidated. Do not interpret installation or compilation as benchmark
PASS. Resume with the explicit package and port only after startup/permissions:

```bash
./solopi-harness-cli/solopi-ai --serial 37201FDJH00E6A \
  --package com.alipay.hulu.trustbench --device-port 23343 --pretty doctor
```

The next precheck found an additional isolated-build startup defect: class
discovery used the suffixed application ID as its Java namespace filter,
so `InjectorService` was not registered and `MyApplication.init` threw a
NullPointerException. Initialization now explicitly scans `com.alipay.hulu`,
the unchanged source namespace. App unit tests and the isolated APK build
passed again. The replacement diagnostic APK was installed successfully,
with SHA-256 `2c06d8ca5808b1b9908c86f30b85eddb12362d16206b53b0fa5c4366b696364d`.
The original app's version and last-update timestamp were unchanged.

Doctor on the isolated port now reports `appInitialized=true`; setting and
reading `KEY_REPLAY_AUTO_START=true` also succeeded. It still reports
`ready=false`, with accessibility, internal ADB, overlay, and battery exemption
permissions missing. The compatibility warning is still displayed after this
replacement. No task execution was attempted: user first-launch/permission
confirmation is required before the single v3 regression.

After the user enabled the isolated app's accessibility service, doctor on
port 23343 passed all permission checks with `ready=true`. The single frozen
v3 control `trustbench-agent-notes-control-v3-pixel8-isolated-20261015-live-01`
then passed its empty-list checkpoint but ended `not_tested` before any Agent
action. Its initial observation contains the Android 16 KB alignment warning
for `libnativeModule.so`, not the Notes controls. The static selector therefore
could not match a current node. The session was cancelled; no storage readback
or model run was attempted. Offline audit verified seven files in two segments;
the bundle occupied approximately 720 KiB before adding provenance metadata.
This does not validate the first-action race fix. The attempt is registered in
`agent-ledger-isolated-20261015.json`, deliberately separate from the original
build ledger because its policy grouping does not encode the SoloPi build.

After the user dismissed the compatibility warning with “do not show again”,
the explicitly authorized second control attempt,
`trustbench-agent-notes-control-v3-pixel8-isolated-20261015-live-02`, passed
the same frozen plan on the same diagnostic APK. Four scripted actions and
the Agent done signal were followed by passing UI checkpoints and immediate
force-stop storage readback. Offline audit verified eight files across two
segments; the bundle occupied about 840 KiB before provenance metadata.
Both isolated attempts remain in their separate ledger. This is one successful
control regression, not a model result or proof that the foreground race is
eliminated. No live-model evaluation was performed in this continuation.

The subsequent authorized Kimi-K3 pairing reused the local Theta credential
in memory (not stored in run artifacts). A minimal AntChat request returned
HTTP 200 with model Kimi-K3; the bridge was configured for 4,096 output tokens,
the Notes fixture, and no fallback. Doctor passed. However,
`trustbench-agent-notes-theta-kimi-k3-v3-pixel8-isolated-20261015-live-01`
received HTTP 429 on the first model decision, as recorded in bridge stderr.
The report remains `not_tested / model_decision_failed`, classified by the
ledger as `provider_not_tested`: zero actions and zero accepted model receipts.
The receipt-derived token budget correctly remains null despite the configured
budget. Seven files across two segments passed audit; the run occupied about
684 KiB before provenance metadata. No storage readback or automatic retry
followed. This is provider availability evidence, not model task performance.

The user-authorized retry, isolated Kimi-K3 v3 `live-02`, passed reset and
received one valid new-note click decision (request ID
`2182838217920467019671829e6a1a`, latency 22,102 ms, 4,096-token limit,
no fallback). Submission was rejected with `terminal_session`: the device
session had expired under the frozen 30,000 ms idle timeout. Its receipt
records `acceptedSteps=0`; the ledger's `actions=1` counts the attempted action,
not a successful click. The session's last-activity-to-expiry interval was
30,058 ms. Model latency alone does not account for all of that interval.
The result is `not_tested / agent_action_failed`, with no storage readback.
Eight files across two segments passed audit; evidence occupied about 772 KiB
before provenance metadata. No budget was changed and no further retry was
made. A successful paired model result remains outstanding.

### Control-service reuse pairing (2026-10-15)

Source inspection found that each dynamic action re-launched the SoloPi UI
and restored the foreground before submitting the mutation. Dynamic actions
now connect to the already-running control service without that launch/restore
cycle. Package identity checks and DUMP-protected mutations remain; standalone
CLI actions retain their original startup behavior. No heartbeat or budget
extension was added. Transcripts now record host decision and action-command
durations. Two focused reuse/fail-closed tests pass; the broader 197-test CLI
run had only the previously known missing `tools/solopi-ai/solopi-ai` error.

With host source SHA-256
`ffd03a384a50c108c547e9b704e67f8c1f144d2c24a6e0558b7a903e1bcb87dd`,
both `trustbench-agent-notes-control-v3-pixel8-isolated-reuse-20261015-live-01`
and `trustbench-agent-notes-theta-kimi-k3-v3-pixel8-isolated-reuse-20261015-live-01`
passed UI checkpoints, immediate independent storage readback, and offline
audit (eight files/two segments each). The same frozen 30-second idle and
120-second total Agent budgets and diagnostic APK were retained. Kimi-K3
produced five request-ID-bearing decisions, four actions, a 4,096-token limit,
and no fallback. Model latencies were 4,958 / 19,487 / 6,211 / 7,747 / 12,772 ms;
action-command durations were 9,359 / 9,393 / 9,028 / 9,205 ms including receipt
polling, settling and foreground restoration, not solely pre-submission delay.
Bundles occupied about 824 and 816 KiB before provenance metadata.

This successful pairing is recorded separately in
`agent-ledger-isolated-reuse-20261015.json`. It validates this execution but
does not establish reliability or isolate the causal effect of service reuse:
provider latencies also differed from the failed trial. Earlier failures and
budgets remain unchanged.

Store one row per task, seed, device and attempt. Record task/Oracle version, source commit, APK digest, device/Android build, provider/model/policy identity, budget, run and attempt IDs, start/end time, final Oracle outcome, Agent `done` claim, action count, fallback and human intervention, and pointers plus hashes for events, transcript and evidence. Keep `passed`, `failed`, `not_tested` and `infra_error` distinct. Count an Agent false pass only when it claimed completion while the independent Oracle failed; do not infer false pass from an intentional v0 injection. Publish raw counts and denominators before percentages, with repeated paired seeds and confidence intervals when the sample permits.

### Repetition batch stopped on provider limit (2026-10-15)

The second v3 pair retained the same diagnostic APK, host revision, frozen
plan and budgets. Control `trustbench-agent-notes-control-v3-pixel8-isolated-reuse-20261015-live-02`
passed UI, immediate independent storage readback, and audit (8 files / 2
segments, 4 actions). Model `trustbench-agent-notes-theta-kimi-k3-v3-pixel8-isolated-reuse-20261015-live-02`
obtained one model decision and recorded one action before a subsequent
decision failed; bridge stderr reported upstream HTTP 429. Its audited outcome
is `provider_not_tested` (`model_decision_failed`, 7 files / 2 segments), not
an assertion failure or a persisted-state pass. No storage PASS was recorded.
Both attempts are retained in the reuse ledger; no failed trial was replaced.
New bundles total approximately 1.5 MiB. The batch stopped per the predeclared
provider/auth failure rule. Current reuse-group counts are 2 control passes,
1 model pass, and 1 provider-not-tested attempt. Still unstarted on Pixel 8:
the third v3 pair and all three revisit-v2 pairs. The other device's same-build
repetitions also remain outstanding. Provider availability must recover before
resuming; do not pool older build/host groups or infer reliability from this pilot.

### In-session recovery check and third pair (2026-10-15)

At the user's request, the temporary heartbeat automation was deleted and
monitoring continued only in the active conversation. A minimal Kimi-K3
request returned HTTP 200 with choices; this was availability evidence only,
not proof of sustained capacity. The third v3 pair then ran with unchanged
settings. Control `trustbench-agent-notes-control-v3-pixel8-isolated-reuse-20261015-live-03`
passed UI, independent storage readback and audit (8 files / 2 segments,
4 actions). Model `trustbench-agent-notes-theta-kimi-k3-v3-pixel8-isolated-reuse-20261015-live-03`
recorded one decision and one action before another HTTP 429. Its audited
outcome is `provider_not_tested` (7 files / 2 segments), with no storage pass.
The reuse group now retains all three v3 pairs: 3 control passes, 1 model
pass and 2 provider-not-tested outcomes. These are attempts, not three
completed model trials. Revisit-v2's three pairs and same-build second-device
trials remain unstarted. No repeated run replaces the limited attempts.

The in-session 4,096-token availability probe later returned HTTP 200, after
an earlier identical-budget probe returned 429. Revisit-v2 pair 01 then ran:
`trustbench-agent-notes-revisit-control-v2-pixel8-isolated-reuse-20261015-live-01`
passed all UI checkpoints, immediate storage readback and audit (12 files /
4 segments, 6 actions). Its model pair
`trustbench-agent-notes-revisit-theta-kimi-k3-v2-pixel8-isolated-reuse-20261015-live-01`
received HTTP 429 before any model decision/action. Audit passed (7 files /
2 segments plus 3 inline entries); outcome remains `provider_not_tested`.
No storage pass or model-token receipt was inferred. Two revisit pairs remain
unstarted on Pixel 8. Intermittent probe success does not establish recovery.

### Pixel 8 fixed repetition attempts complete (2026-10-15)

After an availability diagnostic using the existing Python model adapter and
archived initial observation returned a valid action (not executed or scored),
revisit-v2 pairs 02 and 03 ran with the frozen configuration. Both controls
passed UI, immediate storage readback and audit (12 files / 4 segments,
6 actions each). Model pair 02 passed those same gates with 9 model decisions,
6 actions and 4,096-token receipts. Model pair 03 received HTTP 429 after one
decision/action, and remains `provider_not_tested`; audit verified 7 files /
2 segments and 3 inline entries. No storage pass is claimed for pair 03.

The current same-build/host Pixel 8 manifest now retains 12 attempts:

| Frozen task | Control passed / attempts | Model passed | Provider not tested | Model attempts |
| --- | --- | --- | --- | --- |
| Notes v3 | 3 / 3 | 1 | 2 | 3 |
| Notes revisit-v2 | 3 / 3 | 1 | 2 | 3 |

Thus the predeclared Pixel 8 repetitions have all been attempted, not all
successfully completed. Four provider-limited trials remain in the denominator
and must not be silently replaced or counted as task assertion failures.
All eight passes include independent storage readback. No ranking or reliability
claim is supported. Second-device same-build/host repetitions remain pending;
the prior device/build results cannot fill that gap. No scheduled automation
remains: the user requested in-session monitoring only.

### Redmi same-build repetitions started (2026-10-15)

The user reconnected the original Redmi, serial `REDACTED-DEVICE`. The isolated
diagnostic APK was installed alongside the original SoloPi. The user enabled
its accessibility permission; the harness enabled replay auto-start and doctor
reported all permissions and ready=true. APK and host source hashes match the
Pixel 8 reuse group. Notes fixture 0.2.0 was retained and its installed digest
was independently verified by the successful storage reader.

Pair 01 control `trustbench-agent-notes-control-v3-redmi-isolated-reuse-20261015-live-01`
passed UI, storage readback and audit (8 files / 2 segments, 4 actions).
The corresponding Kimi-K3 model run recorded 4 decisions and 4 action entries
before the next request returned HTTP 429. It remains `provider_not_tested`,
with 7 files / 2 segments audited, no Agent done claim, and no storage pass.
Two v3 pairs and three revisit-v2 pairs remain unstarted on Redmi.

After in-session cooldown, the same bridge returned a valid availability
decision on archived initial-page data (not scored/executed). Redmi v3 pair 02
control passed UI, immediate storage readback and audit (8 files / 2 segments).
Model `trustbench-agent-notes-theta-kimi-k3-v3-redmi-isolated-reuse-20261015-live-02`
received a valid New note click after 3,273 ms model latency, but its first
action was rejected as `stale_observation`, with acceptedSteps=0. The transcript
records one attempted action, not an executed action. Its audited result is
`not_tested / agent_action_failed`, not provider-limited or a task assertion
failure. Audit verified 8 files / 2 segments; no storage pass is claimed.
The batch stopped on this execution fault without changing the frozen policy.
Redmi now has 2 control passes, 1 provider-not-tested model attempt and
1 stale-observation model attempt. One v3 pair and three revisit-v2 pairs
remain unstarted. The precise page-change cause has not yet been established.

### Initial observation stability change: single validation failed (2026-10-15)

The user explicitly authorized an initial-observation fix and exactly one
Redmi verification, not a rerun of both devices. Observation acquisition now
requires visible target-app content intersecting the screen and ancestor
bounds, plus two identical full-page signatures sampled 500 ms apart within
the existing 5-second root-ready window. Invalid frames break the sequence;
timeout does not publish the last unstable frame. Explicit observation queries
share this acquisition path. Action-time stale-observation validation and
the frozen task/model budgets remain unchanged.

Three regression tests cover the recorded Redmi offscreen bounds, hidden /
foreign / clipped content, and consecutive stable signatures. All 50 app unit
tests and the isolated debug assembly passed. The resulting local and installed
APK SHA-256 is
`1be3332bb605b882c76c2444799e70abb423cb0c5fe35d64320195cfe4eaba50`.
Installation retained the isolated app's permissions; its internal ADB
connection was reinitialized and doctor passed before the trial.

The sole live run
`trustbench-agent-notes-theta-kimi-k3-v3-redmi-stable-observation-20261015-live-01`
failed at Agent startup after about 5 seconds: `page_root_unavailable`,
classified `not_tested / agent_start_failed`. There were zero model decisions
and zero actions, and no storage PASS was collected. Evidence audit verified
7 files / 2 segments. It is registered separately in
`agent-ledger-stable-observation-20261015.json`, not in the prior reuse group.
This does not validate a functional fix: the stricter readiness gate did not
produce a stable initial observation. Sampled rejected frames were not persisted,
so this run alone cannot distinguish content-readiness rejection from changing
signatures or foreground unavailability. No second device run or retry was
performed; the bridge was closed. Further live diagnosis needs a newly
authorized run and bounded readiness diagnostics, not a timeout increase or
weaker action identity guard.

### Foreground-ready follow-up: control and live model validated (2026-10-15)

The user authorized continuing relevant fixes/tests without per-run confirmation,
while retaining the scope of current-device verification, not a two-device rerun.
The startup Scheme now explicitly finishes its transport Activity, matching
the act path. Bounded readiness diagnostics emit at most ten metadata-only
log lines per capture. With APK
`f3ddaf1d781243b575531069c29ebc9be8926a03540ee47e745fc5ef94d42f57`,
the first control passed UI/storage/audit, but the model trial failed at startup.
Its first root load consumed 5,002 ms before returning a ready page, exhausting
the existing 5-second capture window. Those two runs are separately registered
in `agent-ledger-stable-start-20261015.json`.

The host then reused the control service for dynamic session startup as it
already did for actions; standalone CLI startup retains its original behavior.
Host SHA became `de84814b6cebfba34dd7f23544374dc4a3c83101becdd0a7d33be01aead8badd`.
That trial also failed at startup and remains in
`agent-ledger-stable-start-reuse-20261015.json`. Bounded logcat readback showed
the foreground was still SoloPi's CaseReplayResultActivity when the provider
checked accessibility, could not find that window, and took 4,997 ms in root
acquisition/recovery before returning Notes. Host reuse alone was insufficient.

The final capture loop waits for a non-control foreground before requesting the
accessibility tree, resetting consecutive-frame state while the control app
is foreground. The original 5-second window, two-frame requirement, screen
intersection checks and action-time stale guard remain in place. Final local
and device-readback APK SHA:
`cd6bcee8389209bf5fd077ca3a3b2ba8f6e3cf0854b39c45203e658b6fccea85`.
All 51 app unit tests and assembly passed; six focused host tests passed
(startup/default vs reuse, dynamic verification and reuse/fail-closed session
behavior). `git diff --check` passed.

Final model trial `trustbench-agent-notes-theta-kimi-k3-v3-redmi-ready-foreground-20261015-live-01`
published its initial observation after readiness samples false / false / true /
true, with the fourth matching the third (device log times 16:20:14.270,
14.842, 15.417 and 16.012). The provider then returned HTTP 429 before any
model decision/action, so its result is `provider_not_tested`, not PASS.
The same-build scripted control
`trustbench-agent-notes-control-v3-redmi-ready-foreground-20261015-live-01`
passed UI checkpoints, independent storage readback and audit (8 files / 2
segments). Both are in `agent-ledger-ready-foreground-20261015.json`.
All intermediate failures remain recorded; no historical outcome was replaced.
This validates the guard's observed transition handling and one complete
scripted execution, not reliability or a completed live-model regression.
No other device was rerun. The secret-bearing bridge was stopped after testing.

After a non-scored availability probe returned a valid action, the same final
build completed model trial
`trustbench-agent-notes-theta-kimi-k3-v3-redmi-ready-foreground-20261015-live-02`.
It passed with 5 model decisions and 4 actions, followed immediately by a
passing independent storage readback and evidence audit (8 files / 2 segments).
The frozen plan and action/time budgets were unchanged. The final-build ledger
now retains three attempts: one provider-not-tested model attempt, one passing
scripted control, and one passing live-model attempt. This completes the scoped
single-device repair regression, not a reliability estimate or a rerun of the
two-device benchmark matrix. Earlier failures and build groups remain separate.

### Model request pacing (2026-10-15)

The bridge initially used a process-wide 10-second minimum interval between
request starts. Configure `TRUSTBENCH_MODEL_MIN_INTERVAL_SECONDS` (0–60 seconds;
0 disables spacing). This is a conservative provisional setting, not a known
provider quota; separate bridge processes and other clients sharing a key are
not coordinated. The first request is immediate; failed requests still consume
their slot. HTTP 429 is not automatically retried.

Successful receipts include `pacingWaitMs` separately from provider `latencyMs`
and `minRequestIntervalMs`. Queue/wait time consumes the existing 90-second
bridge call allowance, rather than adding an unbounded wait to the 95-second
client timeout. Frozen device idle/overall budgets remain unchanged: pacing
still counts toward them and can exhaust them. No claim is made that slower
calls cannot time out; different pacing policies must remain separate in analysis.
Twenty-one bridge unit tests pass, including shared concurrent pacing, validation,
timeout exhaustion, remaining network timeout, receipts, and no retry on 429.

The scoped Redmi trial
`trustbench-agent-notes-theta-kimi-k3-v3-redmi-paced10s-20261015-live-01`
failed the deterministic reset checkpoint before any model request: device
logcat recorded `current node text: 1` against expected `0` at `list-is-empty`.
It is retained as `setup_failed` in `agent-ledger-paced10s-20261015.json`, with
a passing evidence audit (6 files / 1 segment / 2 inline records). No storage
PASS was generated, no assertion weakened, and no automatic rerun was made.
This does not validate live pacing or invalidate the preceding unpaced model
PASS. The bridge was stopped after the trial.

A separately recorded follow-up used the existing `--restart-app` option,
without clearing app data or changing the plan:
`trustbench-agent-notes-theta-kimi-k3-v3-redmi-paced10s-restart-20261015-live-01`.
The reset checkpoint passed; three model decisions/actions succeeded before
the fourth provider request returned HTTP 429. Audit passed (7 files / 2
segments); no storage PASS was generated. All three successful receipts record
`minRequestIntervalMs=10000` and `pacingWaitMs=0`: normal inference/device work
already exceeded ten seconds between requests. Thus the provisional interval
did not slow this run and is not a demonstrated remedy for this quota.
The attempt is retained in `agent-ledger-paced10s-restart-20261015.json`, separate
from the no-restart group. The bridge was stopped. Actual quota information is
needed before selecting a suitable interval; longer waits still consume the
unchanged device idle and overall budgets.

The user subsequently requested a 30-second interval. Trial
`trustbench-agent-notes-theta-kimi-k3-v3-redmi-paced30s-restart-20261015-live-01`
ran with that explicit environment setting and the same restart-app preparation.
Reset passed, but the first provider request returned HTTP 429: zero decisions
and actions, `provider_not_tested`, audit passed (7 files / 2 segments).
It is retained separately in `agent-ledger-paced30s-restart-20261015.json`.
This cannot establish whether 30-second spacing is sufficient, since the first
request is immediate and no consecutive calls occurred. The bridge was stopped,
then its default interval was changed to 30 seconds for future invocations.
Task budgets remain frozen: five decisions spaced 30 seconds apart already
span at least 120 seconds before final inference latency, so a completed
five-decision path would require a separately versioned longer-budget protocol;
the existing 120-second task budget was not silently extended.

### Separate long-budget / 30-second group (2026-10-15)

At the user's explicit request, `agent-notes-v3-paced30-long-v1.json` and its
frozen `.plan.json` define a separate task ID and fingerprint
`7b9c96b7c9fbcffeba5d1c2449340f09c77cfbbbd6996e1bc03d1e6a0af6a2b6`.
Both scenario and dynamic budgets are 600,000 ms total / 120,000 ms idle;
the 8-step, repetition and no-progress limits, goal, seed and assertions remain
unchanged. `agent-group-paced30-long-v1.json` records 30-second request spacing,
Kimi-K3 / 4096 output tokens, current Redmi and restart-app policy. The frozen
storage registry accepts this exact new plan/source pair without changing old
entries. Sixty-three relevant tests passed, including recompile/fingerprint,
original-plan preservation and unchanged oracle/step-limit checks.

After a non-scored availability probe succeeded, `...paced30-long-v1-20261015-live-01`
passed reset and accepted three model actions, then received HTTP 429 on the
fourth request. Successful receipts recorded pacing waits 0 / 11,379 / 16,194 ms;
the 30-second limiter actually delayed requests. No timeout occurred. The result
is `provider_not_tested`, with 7 files / 2 segments audited and no storage PASS.
It is preserved in `agent-ledger-paced30-long-v1-20261015.json`; no original
baseline manifest was changed. This is not evidence that the quota is resolved.

After a two-minute cooldown and another successful non-scored probe, the same
group's `...live-02` passed reset and received two model decisions. One action
was accepted; the title-input action was rejected as `stale_observation`.
The second decision included 11,849 ms pacing wait and 3,901 ms provider latency.
No 429 or budget timeout occurred in this attempt. It remains `not_tested`,
not a task PASS; audit verified 8 files / 2 segments and no storage receipt was
generated. Both attempts remain in the new group's ledger. The service was
stopped after this attempt; execution stability, not a confirmed provider
recovery, is the immediate blocker. No stale guard was relaxed or bypassed.

### Separate 60-second pacing group (2026-10-15)

At the user's request, the bridge default and explicit run setting became
60 seconds. `agent-group-paced60-long-v1.json` reuses the unchanged long-budget
task plan (600 seconds total / 120 seconds idle / 8 steps), but has a separate
provider-policy group and ledger `agent-ledger-paced60-long-v1-20261015.json`.
Neither original nor 30-second baseline outcomes were changed or pooled.

`trustbench-agent-notes-theta-kimi-k3-v3-redmi-paced60-long-v1-20261015-live-01`
passed with 5 model decisions / 4 actions, all UI checkpoints, immediate
independent storage readback, and evidence audit (8 files / 2 segments).
Report elapsed time was 265,789 ms. Receipts recorded 60,000 ms minimum request
spacing, with waits 0 / 44,371 / 47,873 / 47,719 / 43,716 ms. There was no 429,
stale-observation rejection or budget timeout in this trial. All 63 relevant
tests and diff checks passed. The bridge was stopped after verification.
This is one complete successful trial under the slower policy, not proof that
the provider quota or execution stability is permanently resolved.

## Admission checks

Closure update: the scoped checks now have one complete same-plan/budget/device
pair and a new-seed positive/false-done device probe pair. The latter is a held-out
seed from prior model tuning, not an independently authored task set. The
original admission list below remains the boundary for broader public ranking;
historical reset failures and one invalid receipt remain in the audited record.
Use `pilot-closure-index-20261015.json` for the explicit local closure contract.

1. Every task starts from its own verified state and remains runnable when another task fails.
2. A held-out positive and negative Oracle test detects both a real state change and a false `done`; the current counter fixture only has local regression tests for these cases.
3. The live provider's decisions and any fallback are traceable to the exact run; scripted controls are labeled separately.
4. Artifact audit passes for each run; hashes alone are not proof of device execution or evidence authenticity.
5. At least one complete live Agent trial and one scripted control trial use matched task seeds and budgets. The first paired pilot now exists, including an upstream 503 trial; broader repeated seeds, provider identity capture and independent backend Oracle remain open. Report failures and infrastructure errors, not just the best run.

Until these checks pass, publish only the v0 contract result and the separate trust probes as engineering evidence, not a benchmark ranking or AI capability claim.
