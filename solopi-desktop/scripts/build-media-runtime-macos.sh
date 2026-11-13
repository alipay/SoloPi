#!/usr/bin/env bash
# Assemble the media runtime from pinned scrcpy and a newly source-built FFmpeg.
set -euo pipefail
ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCRCPY_ARCHIVE=${GLASSBOX_SCRCPY_ARCHIVE:?Set GLASSBOX_SCRCPY_ARCHIVE to scrcpy-macos-aarch64-v4.1.tar.gz}
ARCHIVES=${GLASSBOX_FFMPEG_ARCHIVES:?Set GLASSBOX_FFMPEG_ARCHIVES to the source archive directory}
BUILD_ROOT=${GLASSBOX_MEDIA_BUILD_ROOT:?Set GLASSBOX_MEDIA_BUILD_ROOT to a new build directory}
OUTPUT_ROOT=${GLASSBOX_MEDIA_OUTPUT_ROOT:?Set GLASSBOX_MEDIA_OUTPUT_ROOT to a new runtime directory}
if [[ $(uname -s) != Darwin || $(uname -m) != arm64 ]]; then echo 'This scrcpy distribution targets macOS arm64' >&2; exit 2; fi
if [[ -e "$BUILD_ROOT" || -e "$OUTPUT_ROOT" ]]; then echo 'Build and output directories must be new' >&2; exit 2; fi
expected=20fd47c9014dd5e0fa77091f3cb7adbda8445a360c4584aeaa0150b5b3988ff3
actual=$(shasum -a 256 "$SCRCPY_ARCHIVE" | awk '{print $1}')
[[ "$actual" == "$expected" ]] || { echo 'scrcpy source archive hash mismatch' >&2; exit 2; }
node "$ROOT/scripts/prepare-ffmpeg-sources.mjs" "$ARCHIVES"
mkdir -p "$BUILD_ROOT"
touch "$BUILD_ROOT/.metadata_never_index"
GLASSBOX_MEDIA_BUILD_ROOT="$BUILD_ROOT/ffmpeg" GLASSBOX_MEDIA_OUTPUT_ROOT="$OUTPUT_ROOT" bash "$ROOT/scripts/build-ffmpeg-macos.sh"
tar -xzf "$SCRCPY_ARCHIVE" -C "$BUILD_ROOT"
SCRCPY_SOURCE="$BUILD_ROOT/scrcpy-macos-aarch64-v4.1"
mkdir -p "$OUTPUT_ROOT/share/scrcpy"
cp "$SCRCPY_SOURCE/scrcpy" "$OUTPUT_ROOT/bin/scrcpy"
cp "$SCRCPY_SOURCE/adb" "$OUTPUT_ROOT/bin/adb"
cp "$SCRCPY_SOURCE/scrcpy-server" "$OUTPUT_ROOT/share/scrcpy/scrcpy-server"
cp "$SCRCPY_SOURCE/LICENSE" "$OUTPUT_ROOT/LICENSES/scrcpy-Apache-2.0.txt"
node - "$OUTPUT_ROOT" <<'JS'
const fs=require('fs'),path=require('path');const root=process.argv[2];
fs.writeFileSync(path.join(root,'provenance.json'),JSON.stringify({schemaVersion:'glassbox.media-runtime-provenance.v1',platform:'darwin',arch:'arm64',scrcpy:{version:'4.1',sourceUrl:'https://github.com/Genymobile/scrcpy/releases/download/v4.1/scrcpy-macos-aarch64-v4.1.tar.gz',archiveSha256:'20fd47c9014dd5e0fa77091f3cb7adbda8445a360c4584aeaa0150b5b3988ff3'},ffmpeg:{version:'8.1.2',sourceUrl:'https://ffmpeg.org/releases/ffmpeg-8.1.2.tar.xz',archiveSha256:'464beb5e7bf0c311e68b45ae2f04e9cc2af88851abb4082231742a74d97b524c',linkage:'static-with-system-frameworks',audioLibraries:['opus','mp3lame','speex'],buildRecord:'ffmpeg-build.json'}},null,2)+'\n');
JS
echo "Media runtime output: $OUTPUT_ROOT"
