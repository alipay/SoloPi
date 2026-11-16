#!/usr/bin/env bash
# Native compatibility build. Inputs are source and isolated development files;
# this script never installs system packages or starts a device server.
set -euo pipefail
if [[ $(uname -s) != Linux ]]; then echo 'Build on the target Linux baseline' >&2; exit 2; fi
FFMPEG_SOURCE=${GLASSBOX_FFMPEG_SOURCE:?Set GLASSBOX_FFMPEG_SOURCE to extracted verified FFmpeg source}
DEPS=${GLASSBOX_MEDIA_DEPS:?Set GLASSBOX_MEDIA_DEPS to extracted dev dependency root}
OUTPUT=${GLASSBOX_MEDIA_OUTPUT_ROOT:?Set GLASSBOX_MEDIA_OUTPUT_ROOT to a new output directory}
JOBS=${GLASSBOX_MEDIA_BUILD_JOBS:-4}
if [[ -e "$OUTPUT" ]]; then echo 'Output must be a new directory' >&2; exit 2; fi
mkdir -p "$OUTPUT/bin" "$OUTPUT/LICENSES"
export PKG_CONFIG_PATH="$DEPS/usr/lib/x86_64-linux-gnu/pkgconfig:$DEPS/usr/lib/pkgconfig:$DEPS/usr/share/pkgconfig"
export PKG_CONFIG_SYSROOT_DIR="$DEPS"
cd "$FFMPEG_SOURCE"
./configure --cc=gcc --arch=x86_64 --target-os=linux \
 --prefix="$OUTPUT" --pkg-config-flags=--static \
 --extra-cflags="-I$DEPS/usr/include" \
 --extra-ldflags="-L$DEPS/usr/lib/x86_64-linux-gnu" \
 --disable-gpl --disable-nonfree --disable-version3 \
 --disable-doc --disable-debug --disable-network --disable-autodetect \
 --disable-x86asm --disable-shared --enable-static --disable-everything \
 --enable-ffmpeg --enable-avcodec --enable-avformat --enable-avfilter --enable-swresample --enable-swscale \
 --enable-protocol=file,pipe \
 --enable-demuxer=aac,ac3,flac,h264,hevc,matroska,mov,mp3,ogg,wav,rawvideo,image2,image2pipe,pcm_s16le,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,pcm_f64le \
 --enable-muxer=adts,flac,h264,ipod,matroska,mp3,mp4,mov,ogg,wav,webm,rawvideo,image2,pcm_s16le,pcm_s24le,pcm_s32le,pcm_u8,pcm_f32le,pcm_f64le \
 --enable-parser=aac,flac,h264,hevc,mpeg4video,mpegaudio,opus,vorbis \
 --enable-decoder=aac,alac,flac,h264,hevc,mpeg4,libspeex,mp3,mp3float,opus,vorbis,rawvideo,bmp,png,mjpeg,pcm_u8,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le \
 --enable-encoder=rawvideo,aac,flac,libspeex,libmp3lame,libopus,mpeg4,bmp,png,mjpeg,pcm_u8,pcm_s16le,pcm_s24le,pcm_s32le,pcm_f32le,pcm_f64le \
 --enable-filter=aresample,format,aformat,scale,trim,atrim,setpts,asetpts \
 --enable-zlib --enable-libspeex --enable-libmp3lame --enable-libopus \
 --enable-bsf=aac_adtstoasc,h264_mp4toannexb,hevc_mp4toannexb,extract_extradata
make -j"$JOBS" ffmpeg
cp ffmpeg "$OUTPUT/bin/ffmpeg"
cp COPYING.LGPLv2.1 "$OUTPUT/LICENSES/ffmpeg-LGPL-2.1.txt"
for codec in libopus libspeex libmp3lame mpeg4 aac; do
 "$OUTPUT/bin/ffmpeg" -hide_banner -encoders 2>/dev/null | awk '{print $2}' | grep -Fx "$codec" >/dev/null
 done
ldd "$OUTPUT/bin/ffmpeg" > "$OUTPUT/link-dependencies.txt"
"$OUTPUT/bin/ffmpeg" -version > "$OUTPUT/version.txt"
echo "Native FFmpeg ready: $OUTPUT (add dependency licenses and provenance before distribution)"
