# SoloPi Open Issue Triage - 2026-10-19

This review read 137 open GitHub Issues and 280 repository Issue comments through the public API. No GitHub comments, labels, closures, releases, or other remote writes were made.

| Priority | Issue | Status | Evidence and next action |
| --- | --- | --- | --- |
| P0 | #226 unauthenticated LAN code execution | Local fix prepared | The current code already binds the control server to `127.0.0.1` and rejects HTTP configuration mutations. This change adds regression coverage and prevents startup from automatically loading a stored custom patch URL. Test execution remains blocked on the local Android SDK/Gradle toolchain. |
| P1 | #225 Android 16 recording/replay freeze | Partially mitigated; device validation required | The reported stack trace is a legacy minicap dynamic-plugin link failure followed by a null bitmap. `CaseReplayManager` now catches that runtime failure and continues without optional node screenshots. The minicap plugin is not in this repository; reproduce on an Android 16 device with the affected plugin before claiming resolution. |
| P2 | #212 and #215 build questions | Needs environment report | The reports do not include a current Gradle/JDK/SDK matrix. Ask reporters for the command, Android Studio/AGP/JDK versions, and full first failure after attempting the documented JDK 11 + Android SDK setup. |
| P2 | #218 HarmonyOS NEXT signature error | External signing/trust dependency | The report identifies an untrusted-app-source signature failure. It requires the distribution signing policy and device-side installation evidence. |
| P3 | #222 and similarly empty templates | Insufficient reproduction data | Ask for version, device, OS, exact steps, and error logs before diagnosis. |

No paid models, physical devices, benchmark runs, or files under `../oa2026-solopi` were used.

## Unpublished response drafts

### #226

Thank you for the detailed report. We confirmed the described legacy attack surface: an externally reachable control server could change the patch source, and a later startup could load code from that source. The current maintenance branch binds the control server to loopback and rejects configuration mutation over the HTTP scheme bridge. We also prepared a regression change that makes startup fetch only the official default patch source; custom sources require an explicit action from the settings or patch UI. Before closing this report, we need a release build and device-side verification of listener binding and mutation rejection. No reproduction details beyond this report are needed at this time.

### #225

The supplied log shows the legacy minicap binary failing to link on Android 16, followed by a null bitmap during the fallback screenshot path. Current replay code catches screenshot-service runtime failures and continues the accessibility operation without optional node screenshots, but the minicap plugin itself is outside this source tree. Please provide the SoloPi build/version, device model and ABI, Android 16 build number, whether the fallback `screencap` command succeeds, and a fresh log after reproducing with the current build. We will use that information to verify the plugin compatibility path on an Android 16 device.
