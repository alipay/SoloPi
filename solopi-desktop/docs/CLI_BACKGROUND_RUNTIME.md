# CLI background runtime

Task execution continues to use the same Broker, executor, device leases, state and report format as the desktop app. Linux background launches select the built-in Ozone headless backend when no local X11/Wayland session is available; a stale local DISPLAY socket does not cause an attempt to connect to it. An explicitly configured remote X11 session remains caller-owned. macOS, Windows and valid desktop sessions retain their existing launch policy.

For a headless launch the main entry disables hardware acceleration before loading application services. It does not spawn Xvfb, install packages, weaken the sandbox or alter host display services. The submitting CLI and the background task have independent lifetimes. Closing a desktop window still follows the normal owned-task shutdown rules.

Electron's `app.disableHardwareAcceleration()` must be called before readiness: https://www.electronjs.org/docs/latest/api/app#appdisablehardwareacceleration . Native validation is required for the exact bundled Electron version; documentation for another version is not proof that a backend works.

## Diagnostics

`--version --json` reports product version and a source hash. Packaged builds include `cli/runtime-build.json` generated with the package. `doctor --json` reports the selected entry, data directory, source identity and background backend. Its `successScope=configuration-check` and `readiness.executionVerified=false` deliberately distinguish configuration checks from real execution.

Missing workflow state is `WORKFLOW_STATE_UNAVAILABLE`, not a missing case. A missing ID inside a readable state is `CASE_NOT_FOUND`. Discovery or library execution in an unbound directory fails without creating a task. File-based execution remains possible without an existing case library.

The Broker logs `runtime.background-ready` with its PID and selected backend. Submission diagnostics also record the backend and existing bounded startup logs. No credentials or business payloads are added to these diagnostics.

## Regression and release gate

`tests/cli-headless-runtime.test.mjs` covers Linux absent/stale display selection, valid sessions, macOS/Windows invariants, pre-ready configuration, missing-state failure without writes and validation of native smoke fixtures.

On native Linux `verify-linux-package.mjs` runs `verify-linux-headless.mjs` against the built package. That gate uses a fresh private state directory and no display variables, points ADB to a non-device stub, and runs three generic PC cases: asynchronous completion after the submitting CLI exits, a real nonzero command failure and cancellation while waiting. Terminal reports must exist and be nonempty. Original receipts/logs remain in the build evidence directory. Failure blocks packaging; help output alone is insufficient.

Basic distribution libraries remain installation prerequisites declared by the Linux package. Users do not need system Node/npm or external ADB/scrcpy/FFmpeg for the bundled platform operations. Custom component commands can still require user-configured external programs; a runtime must not infer or install business-specific tools.
