#!/usr/bin/env bash
# Standalone LGPL FFmpeg; build from pinned sources, never from Homebrew static libraries.
set -euo pipefail
if [[ $(uname -s) != Darwin ]]; then echo 'Build on the target macOS host' >&2; exit 2; fi
ROOT=$(cd "$(dirname "$0")/.." && pwd)
ARCHIVES=${GLASSBOX_FFMPEG_ARCHIVES:?Set GLASSBOX_FFMPEG_ARCHIVES to the reviewed archive directory}
BUILD_ROOT=${GLASSBOX_MEDIA_BUILD_ROOT:?Set GLASSBOX_MEDIA_BUILD_ROOT to a new build directory}
OUTPUT=${GLASSBOX_MEDIA_OUTPUT_ROOT:?Set GLASSBOX_MEDIA_OUTPUT_ROOT to a new runtime directory}
ARCH=$(uname -m); [[ "$ARCH" != x86_64 ]] || ARCH=x86_64
JOBS=${GLASSBOX_MEDIA_BUILD_JOBS:-2}
if [[ -e "$BUILD_ROOT" || -e "$OUTPUT" ]]; then echo 'Build and output directories must be new' >&2; exit 2; fi
node "$ROOT/scripts/prepare-ffmpeg-sources.mjs" "$ARCHIVES" --verify
mkdir -p "$BUILD_ROOT" "$OUTPUT/bin" "$OUTPUT/LICENSES"
touch "$BUILD_ROOT/.metadata_never_index" "$OUTPUT/.metadata_never_index"
DEPS="$BUILD_ROOT/prefix"
bash "$ROOT/scripts/build-ffmpeg-codecs.sh" "$ARCHIVES" "$BUILD_ROOT/codec-src" "$DEPS"
mkdir "$BUILD_ROOT/src"
tar -xf "$ARCHIVES/ffmpeg-8.1.2.tar.xz" -C "$BUILD_ROOT/src"
FFMPEG_SOURCE="$BUILD_ROOT/src/ffmpeg-8.1.2"
export GLASSBOX_MEDIA_OPUS_PREFIX="$DEPS" GLASSBOX_MEDIA_OPUS_VERSION=1.5.2
cd "$FFMPEG_SOURCE"
./configure \
  --prefix="$DEPS" \
  --cc="${CC:-clang}" \
  --arch="$ARCH" \
  --target-os=darwin \
  --pkg-config="$ROOT/scripts/media-runtime-pkg-config.mjs" \
  --extra-cflags="-I$DEPS/include" \
  --extra-ldflags="-L$DEPS/lib" \
  --disable-gpl --disable-nonfree --disable-version3 \
  --disable-doc --disable-debug --disable-network --disable-autodetect \
  --disable-shared --enable-static --disable-everything \
  --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample --enable-swscale \
  --enable-protocol=file --enable-protocol=pipe \
  --enable-demuxer=rawvideo,image2,image2pipe --enable-demuxer=aac --enable-demuxer=ac3 --enable-demuxer=flac --enable-demuxer=h264 --enable-demuxer=hevc \
  --enable-demuxer=matroska --enable-demuxer=mov --enable-demuxer=mp3 --enable-demuxer=ogg --enable-demuxer=wav \
  --enable-demuxer=pcm_s16le --enable-demuxer=pcm_s24le --enable-demuxer=pcm_s32le --enable-demuxer=pcm_u8 \
  --enable-demuxer=pcm_f32le --enable-demuxer=pcm_f64le \
  --enable-muxer=adts --enable-muxer=flac --enable-muxer=h264 --enable-muxer=ipod --enable-muxer=matroska \
  --enable-muxer=mp3 --enable-muxer=mp4 --enable-muxer=mov --enable-muxer=ogg --enable-muxer=wav --enable-muxer=webm \
  --enable-muxer=pcm_s16le --enable-muxer=pcm_s24le --enable-muxer=pcm_s32le --enable-muxer=pcm_u8 \
  --enable-muxer=pcm_f32le --enable-muxer=pcm_f64le \
  --enable-parser=aac --enable-parser=flac --enable-parser=h264 --enable-parser=hevc --enable-parser=mpegaudio --enable-parser=opus --enable-parser=vorbis \
  --enable-decoder=rawvideo,bmp,png,mjpeg,mpeg4 --enable-decoder=aac --enable-decoder=alac --enable-decoder=flac --enable-decoder=h264 --enable-decoder=hevc \
  --enable-decoder=libspeex --enable-decoder=mp3 --enable-decoder=mp3float --enable-decoder=opus --enable-decoder=vorbis \
  --enable-decoder=pcm_u8 --enable-decoder=pcm_s16le --enable-decoder=pcm_s24le --enable-decoder=pcm_s32le \
  --enable-decoder=pcm_f32le --enable-decoder=pcm_f64le \
  --enable-encoder=rawvideo,bmp,png,mjpeg --enable-encoder=aac --enable-encoder=flac --enable-encoder=h264_videotoolbox --enable-encoder=hevc_videotoolbox \
  --enable-encoder=libspeex --enable-encoder=libmp3lame --enable-encoder=libopus --enable-encoder=mpeg4 \
  --enable-encoder=pcm_u8 --enable-encoder=pcm_s16le --enable-encoder=pcm_s24le --enable-encoder=pcm_s32le \
  --enable-encoder=pcm_f32le --enable-encoder=pcm_f64le \
  --enable-filter=aresample --enable-filter=format --enable-filter=aformat --enable-filter=scale --enable-filter=scale_vt \
  --enable-filter=trim --enable-filter=atrim --enable-filter=setpts --enable-filter=asetpts \
  --enable-zlib --enable-libspeex --enable-libmp3lame --enable-libopus --enable-videotoolbox --enable-audiotoolbox \
  --enable-bsf=aac_adtstoasc --enable-bsf=h264_mp4toannexb --enable-bsf=hevc_mp4toannexb --enable-bsf=extract_extradata


make ffbuild/bin2c
codesign --force --sign - ffbuild/bin2c
make -j"$JOBS" ffmpeg
cp ffmpeg "$OUTPUT/bin/ffmpeg"
codesign --force --sign - "$OUTPUT/bin/ffmpeg"
node "$ROOT/scripts/record-ffmpeg-macos-build.mjs" "$OUTPUT" "$ARCHIVES" "$BUILD_ROOT"
node "$ROOT/scripts/verify-ffmpeg-capabilities.mjs" "$OUTPUT/bin/ffmpeg"
echo "Verified macOS FFmpeg and corresponding source: $OUTPUT"
