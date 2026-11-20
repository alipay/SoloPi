# Local security backport

Upstream: micromatch/picomatch 4.0.7 (MIT; see LICENSE). Local version: 4.0.7-solopi.1.

GHSA-fc5q-39xc-vjpf has no official fixed npm release as of 2026-11-18. This fork preserves the original API and fixes single-branch repeated extglobs: simple single-star languages compile once; more complex ambiguous single-branch repetitions use the existing upstream literal fallback. Ordinary globs, literal repetitions and non-ambiguous alternatives remain supported. Set-based and nested risky patterns may match literally rather than as repetitions.

This is an explicitly patched local fork, not an official upstream release or a claim that the upstream advisory has been withdrawn. npm installs its checked-in source with install-links=true; all transitive picomatch consumers resolve to the same fork. Regression tests cover actual malicious patterns in bounded subprocesses and ordinary path matching.
