#!/usr/bin/env bash
# Builds the exact reviewed codec sources; no system packages or prebuilt archives.
set -euo pipefail
ARCHIVES=${1:?source archive directory}; WORK=${2:?new work directory}; PREFIX=${3:?new prefix directory}
JOBS=${GLASSBOX_MEDIA_BUILD_JOBS:-2}
ROOT=$(cd "$(dirname "$0")/.." && pwd)
node "$ROOT/scripts/prepare-ffmpeg-sources.mjs" "$ARCHIVES" --verify
if [[ -e "$WORK" || -e "$PREFIX" ]]; then echo 'Codec work and prefix must be new directories' >&2; exit 2; fi
mkdir -p "$WORK" "$PREFIX"
for name in opus-1.5.2 speex-1.2.1 lame-3.100; do
 tar -xzf "$ARCHIVES/$name.tar.gz" -C "$WORK"
 (
  cd "$WORK/$name"
  opts=(--prefix="$PREFIX" --disable-shared --enable-static --with-pic)
  if [[ $(uname -s) == Darwin && $(uname -m) == arm64 ]]; then opts+=(--build=aarch64-apple-darwin); fi
  case "$name" in
   opus-*) opts+=(--disable-doc --disable-extra-programs) ;;
   speex-*) opts+=(--disable-binaries) ;;
   lame-*) opts+=(--disable-frontend --disable-nasm) ;;
  esac
  CC=${CC:-clang} ./configure "${opts[@]}"
  make -j"$JOBS"
  make install
 )
done
