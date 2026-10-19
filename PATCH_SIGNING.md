# SoloPi Patch Signing

Dynamic patch archives execute code in the SoloPi process. Every archive accepted by the current patch loader therefore requires a detached signature before its descriptor, JAR, or shared objects are loaded.

## Trust contract

- `desc.json` remains the patch descriptor and declares the name, version and SHA/MD5 checks used for the packaged JAR, SO and assets.
- `manifest.sig` is a binary `SHA256withRSA` signature over the exact bytes of `desc.json`.
- `manifest.sig` must be in the same effective archive root as `desc.json`. Existing archives with a single top-level directory keep that layout: the signature is inside that directory.
- The app pins the public key with id `solopi-patch-2026-v1`. A signature from another key, a missing signature, a modified descriptor, or malformed input is rejected before dynamic loading.
- The loader copies the descriptor and signature into its internal patch directory. At every later app startup, stored patches are re-verified before class loading. Unsigned legacy patches are refused rather than trusted from past installation state.

## Release procedure

The production private key is named `SoloPi Patch Signing 2026` and currently lives only in the release maintainer's macOS login keychain. It must never be committed, pasted into Issues, or copied into a patch archive.

1. Build each patch ZIP and preserve its `desc.json` byte-for-byte.
2. Use the release-signing key to create binary `manifest.sig` for `desc.json`.
3. Add `manifest.sig` within the ZIP's effective root and rebuild the ZIP.
4. Verify the ZIP locally by loading it through the same application verifier and by checking a tampered `desc.json` fails.
5. Publish signed ZIPs at immutable release URLs, then update all ABI indexes in the same change. Do not retain an ABI entry when its signed artifact is unavailable.
6. Build and validate the APK on a dedicated device before changing the public indexes.

The private key needs a second, access-controlled recovery copy before the first public release. If it is lost, a new key id and an app update that trusts it are required; do not silently replace a key under the same id.
