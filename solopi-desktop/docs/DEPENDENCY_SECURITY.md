# Dependency security maintenance

Use Node.js 24 LTS and run `npm ci` in each module. The checked-in lock files and `.npmrc` install options are part of the source distribution. Run full `npm audit`, including development and packaging dependencies; production-only results do not cover the Electron runtime or build tools.

The 0.1.151 source update upgrades the affected dependency chains, including webpack-dev-server 6, electron-builder 26.18, patched glob/minimatch and selector parser versions, and React Router 7.18.5 while keeping the existing 404 component. Electron remains pinned to 44.11.3; shell-quote and tar retain their previous security fixes. Lock-file regression tests reject the reviewed advisory ranges rather than assuming a newer top-level package is sufficient.

## Local picomatch backport

GHSA-fc5q-39xc-vjpf had no official fixed npm release on 2026-11-18. Both Desktop and Web use the checked-in `vendor/picomatch` source, version `4.0.7-solopi.1`, with npm overrides and `install-links=true`. The installed package is an ordinary directory, so runtime packaging does not depend on a link outside node_modules.

The local patch prevents nested unbounded regular expressions for single-branch repeated extglobs. Simple one-star languages are compiled once without introducing an outer repetition; more complex ambiguous branches use the upstream literal fallback. Fixed-width question marks and character classes, ordinary globs and non-ambiguous alternatives remain supported. Unsupported ambiguous patterns may match literally rather than as repetitions. The opt-out for recursion limits cannot disable this single-branch protection.

This is a local security backport, not an official upstream release. An npm audit result of zero does not establish the safety of a local fork. Its approval also requires the checked-in upstream/patched source fingerprints, bounded exploit regressions, ordinary matching regressions and compatibility results. The original MIT license and attribution are retained; see `vendor/picomatch/LICENSE`, `SECURITY_PATCH.md` and `patch-provenance.json`.

## Regressions and module checks

`tests/dependency-security-regressions.test.mjs` covers cross-realm credential-header stripping on two loopback servers, valid and malformed RSA signatures, bounded adversarial glob patterns, dependency advisory ranges and resolution isolation. `tests/security-dev-server.test.mjs` starts a real local compiler/server and verifies both a generated asset and traversal rejection.

The GitHub request-settings entry, persisted per-model policy and streaming/non-streaming comparison remain covered by IPC and UI regressions. The existing model-recovery, Skill refresh and progress behaviors remain covered alongside virtual-screen cleanup and observation boundaries. Test credentials and endpoints are synthetic; boundary tests may mention prohibited platform names as rejection cases.

For the complete repository checks, install all three Node modules, run the Server tests to synchronize shared source, run Web tests/build, then run Desktop tests/typecheck/build. The Web and Server retain their existing no-user-authentication design; these dependency changes do not add a login flow.
