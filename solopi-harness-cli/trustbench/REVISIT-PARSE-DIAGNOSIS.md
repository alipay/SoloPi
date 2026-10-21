# Revisit response parsing diagnosis

Two non-device probes on 2026-10-15 reused the saved post-click observation
from `trustbench-agent-notes-revisit-theta-kimi-k3-v2-pixel8-20261015-live-02`,
segment `segment-revisit-budget-note-test-03-992857d617b9`.
The goal, allowed actions, step index (1), notes system prompt, model
(`Kimi-K3`), endpoint and temperature remained unchanged. No device action was
performed. These probes are not Agent task attempts or benchmark successes.

| Probe | Output token limit | Completion tokens | Finish reason | Result |
| --- | ---: | ---: | --- | --- |
| Existing configuration | 300 | 300 | length | Outer JSON valid; model content was 25 characters, rejected with an unterminated string at position 24 |
| Diagnostic comparison | 900 | 338 | stop | Model content was 170 characters; strict typed decision parsing returned done |

Both calls reported 473 prompt tokens. Request IDs were
`218295b417920346862801645e44a3` (300-token probe) and
`218cca4717920347310112050e2225` (900-token probe). The second call reported
3,489 ms latency and no fallback. No credentials or raw model reasoning are
included here.

The first probe establishes an output-truncation failure under the current
300-token request budget. The second shows that increasing that budget can
produce a complete typed response for this saved context. One paired probe
does not establish reliability. The two historical device attempts logged
only JSONDecodeError: their original upstream responses were not retained,
so this diagnosis cannot prove both historical failures had the same cause.

After this diagnosis, the bridge default was raised to 1,024 output tokens,
made configurable, and made to label explicit truncation. The frozen task
budget and all previous attempt classifications remain unchanged. New device
trials must record this changed model output budget separately.
