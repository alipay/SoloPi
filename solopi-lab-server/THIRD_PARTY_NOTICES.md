# Third-party notices

SoloPi Desktop source follows the SoloPi repository's Apache-2.0 license; see [LICENSE](LICENSE) and [NOTICE](NOTICE). Dependencies retain their own licenses.

## Distributed applications

Each new package build generates a platform-specific `third-party/` directory in the application's resources before code signing. It contains:

- `LICENSE.project.txt` and `NOTICE.project.txt`;
- `electron/LICENSE.electron.txt` and `electron/LICENSES.chromium.html`, copied unchanged from the exact Electron runtime for that platform and version;
- `npm/THIRD-PARTY-LICENSES.txt`, with installed production dependency versions, original license and notice texts, including dependencies compiled into the renderer bundle;
- `inventory.json`, with source paths relative to the dependency tree, package versions, license identifiers, source URLs where available, and file hashes.

The build fails when required notices are missing, an installed production dependency does not match the lock file, or the Electron runtime does not match the target. Downloaded platform-specific optional dependencies are included only when present in that target's installed tree. Missing license texts in a published npm tarball require a reviewed, commit-pinned upstream record under `resources/third-party/npm-supplements/`; a license identifier alone is not a replacement for the full text.

Native tools require their own `LICENSES`, source archives and build records alongside `media-runtime/` and `git-runtime/`. This Electron/npm bundle does not certify those separate native binaries. Source-only exports do not contain those runtime binaries. The checksum-pinned public SoloPi recording APK is included with its Apache-2.0 license and provenance.

These changes apply to newly built artifacts. Previously signed installers must be rebuilt and signed again; do not insert files into an already signed application.

## FFmpeg source release attachment

Every new desktop package must pass the FFmpeg source/build-record gate. The packaging hook creates `solopi-desktop-<version>-<platform>-<arch>-ffmpeg-sources.tar.gz` and its SHA256 sidecar next to the installer. Publish both alongside the installer on the same release page; do not publish the installer alone. Source-only exports exclude native executables and source archives, but include the pinned source lock and rebuild scripts.

The attachment contains the exact original FFmpeg, Opus, Speex and LAME source archives, license texts, build recipes/support files, normalized configure arguments and a file hash manifest. Machine-local workspace paths are placeholders; source archives are never rewritten. The recorded compiled-runtime hash precedes application signing; final Mac signature verification separately compares compiled code against the audited runtime.

macOS builds use `scripts/build-ffmpeg-macos.sh` and compile the pinned codec sources instead of taking static libraries from Homebrew. Run `node scripts/prepare-ffmpeg-sources.mjs <archive-directory>`, then set `GLASSBOX_FFMPEG_ARCHIVES`, `GLASSBOX_MEDIA_BUILD_ROOT` and `GLASSBOX_MEDIA_OUTPUT_ROOT` to absolute paths (the latter two must be new directories) and run the build script on the target Mac. The host must permit normal native compiler probes; if endpoint policy kills them, use an approved build host or have the policy resolved. Do not disable security controls or treat a failed build as verified.

The standalone executable is a separate process. Its source attachment does not replace Electron/Chromium's own codec notices or corresponding-source obligations; those components must be reviewed against the actual Electron release too.

## Upstream references

- [Electron license](https://github.com/electron/electron/blob/main/LICENSE)
- [VS Code notice generation](https://github.com/microsoft/vscode/blob/main/.github/instructions/oss-third-party-notices.instructions.md)
- [Skill Recorder platform-specific compliance bundle](https://github.com/microsoft/skill-recorder/blob/main/THIRD-PARTY-NOTICES.md)
