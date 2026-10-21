# SoloPi TrustBench v0 pilot

Latest claim and evidence: [three-way execution safety comparison](CONTRACT-THREEWAY-RESULTS-20261019.md).
An added strict-context arm completes 12 three-way condition comparisons: contracts retained
6/6 dangerous rejections while executing 4/4 benign conditions versus strict context's 2/4.
This is a post-hoc supplement on two self-authored tasks with trusted configuration, not general reliability.

## Current entry (2026-10-16)

2026-10-19 update: [repair checks and the failed recovery counterexample](REPAIR-RESULTS-20261019.md).
The strict input repair passed scripted device checks. Automatic re-decision on
changed pages failed a real-model safety smoke and is now stopped for context
review. Lower false rejection remains unresolved; do not imply the repair is
already a broadly effective low-error policy.

Follow-up implementation: [action contracts v1](ACTION-CONTRACT.md) adds trusted,
session-frozen object/unit bindings and explicitly declared volatile leaf text.
It is optional and must be evaluated separately from the frozen coverage group.
Its [14-case device development regression](ACTION-CONTRACT-RESULTS-20261019.md)
passed, including benign execution and rejection after a fresh observation; this is not independent validation.
The subsequent [prospective new-task paired check](CONTRACT-TRANSFER-RESULTS-20261019.md)
completed 24 slots / 12 pairs on two new self-authored tasks with the policy frozen:
six harmful direct outcomes were intercepted, four benign conditions executed, and two ambiguous targets rejected.

Expanded evaluation executed: [coverage v1 results and limitations](COVERAGE-RESULTS.md),
[frozen design](COVERAGE-V1.md). The independent six-family group used 154 requests;
two pre-request interruptions remain visible. It exposed input-context safety misses
and benign-click false rejections. Historical pilot results below remain unchanged,
but do not establish zero-error behavior across this expanded set.

Use the existing repository's [build/run/audit guide](REPRODUCE.md); no separate reproduction package is required.
Latest safety evidence: [action-aware safety v2](SAFETY-V2.md) and [effects v2 results](EFFECTS-RESULTS.md).
The [portable-runner validation](PORTABLE-SMOKE.md) also completed its remaining 20 slots after explicit authorization, preserving the original four: 24 valid slots / 12 pairs, with separate continuation provenance and no pooling with the historical effects v2 group.
The latter completed 24 slots / 12 pairs, with persistent-state checks for deletion and wrong-object inventory changes.
This is scoped execution-safety evidence, not universal model superiority.
Historical absolute paths below identify original evidence only; they are not prerequisites for a new installation.
The latest effects v2 raw JSON is included under [evidence/](evidence/README.md); older pilot archives remain external. An audit snapshot is not a substitute for raw runs.
Use REPRODUCE.md for current commands; the older walkthrough below is retained as development history.

## Current delivery (2026-10-15)

The scoped pilot is closed: [results and boundaries](PILOT-CLOSURE.md),
[reproduction entry](REPRODUCE.md), [explicit audit index](pilot-closure-index-20261015.json),
and [audited snapshot](pilot-closure-result-20261015.json).
The current 60-second live-model group has a same-plan/budget/device scripted
control; both passed UI, independent storage and evidence audit. A new-seed
positive/false-done pair separately validates the Oracle contract on-device.
All 60 ledger attempts across 12 manifests are retained without pooling;
two Oracle probes are separate. This closes a reproducible fixture pilot,
not a broad independent task set, reliability estimate or model ranking.
The older narrative below is retained as versioned development history.

Storage policy: the shared CLI logcat collector now requests only the latest
2,000 entries from the device and caps each UTF-8 output file at 1 MiB, including
a header stating the snapshot limits and whether the byte tail was truncated.
This applies to replay artifacts and the `logs` command. These are bounded shared
device snapshots, not complete logs scoped to a segment. Unsupported bounded
collection fails rather than falling back to a full buffer dump. A run with N
replay segments therefore stores at most N MiB of these logcat artifacts; other
artifacts and repeated runs still require separate space monitoring.

The 29 original 2026-10-14 runs were archived locally in
`../../../oa2026-solopi/runs-archive-20261014/`. Restore only the needed run for
old-path evidence audits; do not regenerate the unbounded logs.

Current track: **Oracle contract self-test**. Its scorer always emits `evaluationTrack: oracle_contract_pilot` and `agentPerformanceEligible: false`, even if the runner uses a live DecisionProvider. The scripted false-done and blocked scenarios are diagnostic injections, not natural-language tasks for ranking an Agent. The next evaluation track and its admission criteria are in [BASELINE.md](BASELINE.md).

The separate Agent task fixture contains two independent counter goals. Its scripted-control and live Kimi-K3 device runs are documented in [BASELINE.md](BASELINE.md), along with provider failures and score admission rules. These are small fixture-validation samples, not a general mobile-Agent benchmark.

The next [multi-stage recovery task](agent-recovery-v1.json) checks `0 -> 2 -> 0 -> 1` in one independent scenario, with a checkpoint after each Agent goal. Its [scripted control](agent-recovery-control-v1.json) and a Theta/AntChat Kimi-K3 trial both passed on the pilot device. This adds intermediate-state verification, but remains within the same counter app and accessibility-based Oracle. See [BASELINE.md](BASELINE.md) for the separate run evidence and limitations.

The [notes task](agent-notes-v1.json) adds list-to-editor-to-detail navigation and two text inputs in a separate `com.example.trustnotes` fixture. After the owner accepted the Android SDK license and confirmed USB installation, the APK was built and installed. Both the [scripted control](agent-notes-control-v1.json) and a Theta/AntChat Kimi-K3 trial passed on the pilot device; see [BASELINE.md](BASELINE.md) for evidence and limitations. Set `TRUSTBENCH_TARGET_PACKAGE=com.example.trustnotes` for the live bridge. The task verifies the visible detail page but does not independently read the app's persisted data.

The versioned [v2 notes task](agent-notes-v2.json) leaves the note in place after the UI checkpoints. Its fixture APK is debuggable solely so the host can read `SharedPreferences` through `adb run-as` after stopping the app process. This is a test-only APK; never use this debug setting for a production app. The separate storage receipt verifies the installed APK digest, v2 report status and plan fingerprint, then parses the on-device XML and requires exact title/body values. A UI pass without matching persisted bytes remains a failed storage readback. The v1 task and its reports are unchanged.

The [v3 alternate-seed task](agent-notes-v3.json) uses the same fixture and budget but changes the required title and body to `Quarterly review` and `Check totals before Friday`. The readback accepts only registered frozen plan fingerprints and each plan's exact values; old v2 stored data cannot satisfy v3. Its [scripted control](agent-notes-control-v3.json) and live Kimi-K3 trial are documented in [BASELINE.md](BASELINE.md). This adds one discriminating task value, not a broad held-out benchmark.

The [revisit v2 task](agent-notes-revisit-v2.json) adds a separate navigation
sequence: create a note, return to the list, and reopen the saved note. Its
[scripted control](agent-notes-revisit-control-v1.json) and a Kimi-K3 run with
a recorded 4,096-token output budget passed on Pixel 8 with six step-specific
UI checkpoints and independent force-stop storage readback. Earlier model
attempts under 300 and 1,024-token budgets remain `provider_not_tested`, not
task failures or successes. The frozen v1 revisit task and its failed control
also remain in the ledger because its case-sensitive list-button Oracle
disagreed with Android's uppercased accessibility text. See [BASELINE.md](BASELINE.md)
for exact runs and limits.

The Agent-track ledger uses an explicit [attempt manifest](agent-ledger-20261014.json),
not a directory glob or a selected best run. Run it without touching the device:

```sh
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_agent_ledger \
  --manifest solopi-harness-cli/trustbench/agent-ledger-20261014.json
```

It binds each attempt to a frozen plan, validates the report outcome fingerprint,
audits file and inline checkpoint evidence, checks model identity and fallback,
and requires a matching independent storage receipt for PASS. Raw counts are
separate for scripted controls and live models. `policyGroups` further partition
attempts by frozen plan, track, model, receipt-recorded output-token limit,
receipt-backed device serial and APK digest. Historical decisions without a
recorded output limit retain `null`; failed runs without a storage receipt retain
`null` device/APK identity. These groups are audit partitions, not comparable
success-rate denominators, and neither configured defaults nor run-directory
names fill missing evidence. The manifest includes seven v2/v3
historical attempts, read and hash-checked directly from `.tar.zst` archives
without extracting them, plus four unarchived v3 attempts, five Pixel 8
v3 control attempts, one Pixel 8 v3 live-model attempt, and nine revisit
attempts. The overwritten
historical storage receipt remains visible as `evidence_invalid`, not PASS.
Each row also carries the task ID, frozen Agent budget, event and transcript
hashes, failure reason and action error code, and device/APK identity when a
storage receipt exists. Missing identities
remain null; hashes authenticate local bytes, not the phone or model provider.
The local storage receipt is fixture truth, not an external backend attestation.

For these legacy examples, initialize `TRUSTBENCH_WORK_DIR` and `TRUSTBENCH_SERIAL` using [the current guide](REPRODUCE.md). A newly built APK belongs to a new run group, not the historical binary group.

```bash
TRUSTBENCH_LEGACY_PARENT=$(mktemp -d "$TRUSTBENCH_WORK_DIR/runs/legacy-notes.XXXXXX")
./solopi-harness-cli/solopi-ai verify-compile \
  --file solopi-harness-cli/trustbench/agent-notes-v2.json \
  --output "$TRUSTBENCH_LEGACY_PARENT/plan.json"
./solopi-harness-cli/solopi-ai --serial "$TRUSTBENCH_SERIAL" --package com.alipay.hulu.trustbench --device-port 23343 verify-run \
  --plan "$TRUSTBENCH_LEGACY_PARENT/plan.json" \
  --agent-decisions solopi-harness-cli/trustbench/agent-notes-control-v1.json \
  --no-restart-app --artifacts "$TRUSTBENCH_LEGACY_PARENT/run"
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_notes_storage \
  --run-dir "$TRUSTBENCH_LEGACY_PARENT/run" --serial "$TRUSTBENCH_SERIAL" \
  --apk "$TRUSTBENCH_WORK_DIR/apks/notes.apk"
```

For a live model run, substitute `--decision-provider cloud --cloud-endpoint http://127.0.0.1:18765/decide --cloud-timeout 95` for `--agent-decisions`, with the typed bridge configured as described in [BASELINE.md](BASELINE.md). Run the storage readback immediately after each run, before starting the next task: each task's initial reset clears the prior note. `storage-readback.json` is a separate receipt, not a retroactive change to SoloPi's UI report or a backend-state Oracle.

For v3, compile `agent-notes-v3.json`, use `agent-notes-control-v3.json` for the scripted run, and point the same storage command at the v3 run directory. Each receipt is write-once; do not rerun the readback against a directory that already has `storage-readback.json`.

This first suite freezes five Oracle-contract probes around the existing counter fixture. It is a pilot for benchmark validation, not a mobile-agent leaderboard. Source for the `com.example.counter` test app is included in `android-counter/`; no prebuilt APK is bundled. A first full real-device run of the revised fixture matched 5/5 strict probe contracts; its raw evidence is retained in `../../../oa2026-solopi/runs/trustbench-20261014-settle-live-01/` in this workspace, not in the benchmark package.

The suite binds the requirement and static decisions to SHA-256 digests and emits a suite fingerprint. Its probes expect: hybrid success, intentional product mismatch, false Agent `done`, unreached checkpoint, and cleanup mismatch. All five scenarios share one compiled plan. The later scenarios depend on `hybrid-success`; if that prerequisite fails, record a setup/coverage problem rather than interpreting dependency skips as capability failures.

The cleanup probe waits 1.5 seconds after Increment before its business Oracle. On the pilot device, the accessibility value was still `0` about 0.8 seconds after the click command returned, while the subsequent failure screenshot showed `1`. This wait is a fixture-specific settling rule, not a retry or a change to SoloPi's global assertion semantics. Runs made before this fixture revision have a different suite fingerprint and must not be scored as this revision.

On 2026-10-14, three isolated runs of the revised cleanup test segment passed on the pilot device. SoloPi's app-local assertion log recorded `current node text: 1, target text: 1` in each run; the old segment recorded `0` versus `1` in three inspected failures. This validates the local timing adjustment, not the full five-probe suite or cross-device reliability. The isolated result files are under `/tmp/trustbench-oracle-settle-20261014-{1,2,3}/result.json` on the pilot host.

From the repository root, validate the frozen suite without a device:

```bash
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench validate \
  --repo-root . --suite solopi-harness-cli/trustbench/suite-v0.json
```

Build the test app with JDK 8+ and an Android SDK containing platform `android-35` and build-tools `34.0.0`:

```bash
sh solopi-harness-cli/trustbench/android-counter/build.sh "$TRUSTBENCH_WORK_DIR/apks/counter.apk"
adb devices -l
adb -s "$TRUSTBENCH_SERIAL" install -r "$TRUSTBENCH_WORK_DIR/apks/counter.apk"
```

The device must be authorized for ADB and have SoloPi's execution service installed and ready before `verify-run`. The app starts at `0`/`Ready`; Increment changes it to `1`/`Counting`, and Reset restores `0`/`Ready`. Its resource IDs are `counter_value`, `counter_status`, `increment_button`, and `reset_button`. The build script creates a fresh local signing key, so the APK SHA-256 can differ between builds. Record the printed digest and confirm that the installed APK is the one used for the run; do not treat a source commit alone as a frozen binary.

Compile the same frozen requirement into a plan, then run with the frozen static decisions on the authorized device:

```bash
TRUSTBENCH_COUNTER_PARENT=$(mktemp -d "$TRUSTBENCH_WORK_DIR/runs/counter.XXXXXX")
./solopi-harness-cli/solopi-ai verify-compile \
  --file solopi-harness-cli/fixtures/verification/counter-outcome-matrix.json \
  --output "$TRUSTBENCH_COUNTER_PARENT/plan.json"
./solopi-harness-cli/solopi-ai --serial "$TRUSTBENCH_SERIAL" --package com.alipay.hulu.trustbench --device-port 23343 verify-run \
  --plan "$TRUSTBENCH_COUNTER_PARENT/plan.json" \
  --agent-decisions solopi-harness-cli/fixtures/verification/counter-agent-decisions.json \
  --artifacts "$TRUSTBENCH_COUNTER_PARENT/run"
```

Use a new, nonexistent artifact directory for each run. Check that the generated plan fingerprint matches `validate` before scoring. The five probes intentionally include negative outcomes, including an impossible cleanup expectation. They are Oracle checks, not five successful user tasks.

After a real `verify-run` has produced an artifact directory, score its report:

```bash
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench score \
  --repo-root . --suite solopi-harness-cli/trustbench/suite-v0.json \
  --report "$TRUSTBENCH_COUNTER_PARENT/run/report.json"
```

For a local artifact-integrity check, use `audit` with the same arguments instead of `score`. It first scores the report, then reads each referenced file and verifies its size, SHA-256, run-directory containment, segment ownership, and checkpoint/precondition/cleanup phase attribution. This is the first cross-run evidence-splicing probe: a path into another run, a reference to another segment, and modified file bytes are rejected by focused fault-injection tests. `score` remains a report-only contract check and does not claim these guarantees.

`matched/total` checks the five expected **outcome classifications and probe-specific checkpoint/cleanup states**. In particular, the cleanup probe only matches if its business checkpoint passed before cleanup failed. This is not a task success rate. The scorer verifies that the report belongs to the frozen plan, its outcome fingerprint is internally consistent, and its evidence references resolve. Even `audit` cannot prove the device ran, authenticate screenshot contents, detect a copied file reintroduced inside the run with a recomputed digest, verify which decisions were supplied to `verify-run`, or compare competing agents. For a public result, retain the APK digest, device build, SoloPi build, model/decision settings, `plan.json`, `events.jsonl`, `report.json`, and raw evidence in one run bundle. The frozen static decision file is a scripted probe, not an independent AI-agent evaluation.

Next suite versions need independent per-probe resets. Artifact-integrity auditing, the stale-page action probe, and the offline Worker takeover probe have focused tests, but none is an extra scored scenario in the five-probe pilot.

## Worker takeover probe

This separate offline probe uses a temporary SQLite database and fixed timestamps. It expires an old Worker's lease, recovers and requeues its shard, lets a new Worker claim the same simulated device, then submits the old Worker's delayed heartbeat, success result, and failure result. A pass requires all three old writes to be rejected as `stale_assignment`, a higher owner generation and distinct lease for the successor, a retained expired attempt and lease-expiry event, and a terminal report whose outcome and evidence digest belong only to the successor.

```bash
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_worker_takeover \
  --artifacts /new/empty/worker-probe-directory
```

The directory must not exist yet. The probe writes a `result.json` with individual checks and a sanitized state snapshot; the SQLite database is deleted when the probe ends. Digest values identify synthetic evidence labels, not files or device screenshots. This validates local scheduling, fencing and persistence contracts only. It does not simulate a real process crash, run SoloPi on a device, or establish end-to-end evidence authenticity.

## Stale-page action probe

The separate live probe tests an old observation against a changed page. It resets only `com.example.counter` to `0 / Ready`, starts a SoloPi Agent session, captures the current Increment node ID, changes the counter to `1 / Counting` with an out-of-band ADB tap, and submits a click against the original observation. A pass requires a `rejected / stale_observation` receipt, zero accepted Agent actions, and the counter remaining at `1 / Counting`. Missing page roots, failed injection, or incomplete session cleanup are `infra_error`, not passes.

```bash
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_stale_page \
  --serial DEVICE_SERIAL --artifacts /new/empty/probe-directory
```

The directory must not exist yet. The command writes `result.json`, omits the session owner token, and cancels the Agent session at the end. Three runs on the pilot Redmi/Android 16 device passed on 2026-10-14; the third historical result, `trustbench-stale-page-20261014-live-03/result.json`, includes the initial observed state, node bounds, and screenshot capability error. Its former workspace link is no longer present; obtain the original evidence archive before auditing, rather than treating this narrative as raw evidence. This is one fixture and one device, not a cross-app or cross-device success rate. The SoloPi build used then reported `screen_capture_service_unavailable` for the Agent observation, so this probe validates tree/receipt binding and UI state, not screenshot freshness.
