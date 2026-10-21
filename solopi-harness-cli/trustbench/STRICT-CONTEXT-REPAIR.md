# Strict context repair — development, not benchmark results

The expanded coverage group exposed an unsafe assumption: other editable text
can determine the business object or unit. The guard now preserves all text
when comparing input evidence. Host-only node IDs remain normalized. Target
disappearance, duplicate IDs, target changes and layout changes remain rejected.
No fixture names, resource IDs or benchmark expected labels are used by the guard.

This conservative repair intentionally rejects unrelated editable text changes
as well. It fixes a safety hole; it does not establish lower raw false rejection.
Clicks continue to require unchanged context. The coverage-v1 evidence is frozen
and must not be rerun using this modified source or APK under its old group ID.

`verify-run --agent-reobserve-stale` is a new, default-off recovery option for
live decision providers with the SoloPi guarded transport. After the first
`stale_observation` rejection it requests a new observation. If page content
differs (normalizing host node IDs only), it stops with
`agent_context_review_required` before another model call or action. Only
equivalent page content permits a new decision within the original budget. It never retries
the previous action automatically. A second stale rejection stops, and the
same observation ID cannot authorize recovery. Scripted historical runs and
direct transport retain their old behavior. Model pacing belongs to the
provider; keep its request start spacing at least 60 seconds.

The initial recovery implementation allowed decisions on changed content. A
real Kimi-K3 smoke exposed another unsafe object write even after re-observation.
That behavior has been disabled. Raw benign false rejection remains unresolved;
lowering it needs a trusted business-context contract, not just a fresh model call.

Validation so far: 359 Python tests, 58 Android unit tests, and isolated debug
APK compilation succeeded. New APK SHA-256:
`43a3885e717974662fe6ee249d1d8c1af8ab5c462826cf8b7633d53e72665854`.
The installed APK passed 12 scripted device regressions on 2026-10-19, all
rejecting changed context with independently read unchanged storage.

SoloPi's internal ADB connection was restored with `adb-connect` and doctor
confirmed ready. To run a new separate development regression, use:

```sh
PYTHONPATH=solopi-harness-cli/src python3 -m solopi_harness.trustbench_strict_regression \
  --serial "$DEVICE_SERIAL" --root "$NEW_REGRESSION_DIR" \
  --solopi-apk "$SOLOPI_APK" --fixture-apk "$COVERAGE_APK"
```

This separately labeled 12-position scripted check expects rejection/no effect
for both dangerous and benign changed contexts. Benign rejection remains a
known tradeoff, not benchmark PASS or evidence of reduced false rejections.

Final policy device checks also completed: benign click and dangerous input both
stopped for context review before a second decision, with no persisted effects.
Full provenance and the unsafe initial recovery counterexample:
[2026-10-19 results](REPAIR-RESULTS-20261019.md).

Subsequent work adds an optional [trusted action contract](ACTION-CONTRACT.md).
The strict behavior described above remains the fallback when no contract is configured;
contract development regressions are kept separate from this historical repair group.
