#!/bin/sh
set -eu

if [ -z "${ANDROID_SDK_ROOT:-}" ]; then
    printf '%s\n' 'ANDROID_SDK_ROOT must point to an installed Android SDK' >&2
    exit 2
fi

APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
BUILD_TOOLS=${ANDROID_BUILD_TOOLS_VERSION:-34.0.0}
PLATFORM=${ANDROID_PLATFORM_VERSION:-android-35}
TOOLS="$ANDROID_SDK_ROOT/build-tools/$BUILD_TOOLS"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/$PLATFORM/android.jar"
OUTPUT=${1:-"$APP_DIR/dist/trustbench-counter.apk"}

for required in "$TOOLS/aapt2" "$TOOLS/d8" "$TOOLS/zipalign" "$TOOLS/apksigner" "$ANDROID_JAR"; do
    if [ ! -f "$required" ]; then
        printf 'Missing Android build input: %s\n' "$required" >&2
        exit 2
    fi
done

TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT HUP INT TERM
mkdir -p "$TEMP_DIR/compiled" "$TEMP_DIR/generated" "$TEMP_DIR/classes" "$TEMP_DIR/dex"

"$TOOLS/aapt2" compile --dir "$APP_DIR/res" -o "$TEMP_DIR/compiled"
"$TOOLS/aapt2" link \
    -o "$TEMP_DIR/unsigned.apk" \
    -I "$ANDROID_JAR" \
    --manifest "$APP_DIR/AndroidManifest.xml" \
    --java "$TEMP_DIR/generated" \
    "$TEMP_DIR/compiled/values_ids.arsc.flat"

javac -source 8 -target 8 -cp "$ANDROID_JAR" -d "$TEMP_DIR/classes" \
    "$APP_DIR/src/com/example/counter/MainActivity.java" \
    "$TEMP_DIR/generated/com/example/counter/R.java"
jar cf "$TEMP_DIR/classes.jar" -C "$TEMP_DIR/classes" .
"$TOOLS/d8" --min-api 23 --lib "$ANDROID_JAR" \
    --output "$TEMP_DIR/dex" "$TEMP_DIR/classes.jar"
zip -q -j "$TEMP_DIR/unsigned.apk" "$TEMP_DIR/dex/classes.dex"
"$TOOLS/zipalign" -f 4 "$TEMP_DIR/unsigned.apk" "$TEMP_DIR/aligned.apk"

keytool -genkeypair -noprompt -keystore "$TEMP_DIR/debug.keystore" \
    -storepass trustbench -keypass trustbench -alias trustbench \
    -dname "CN=SoloPi TrustBench Test Fixture" -keyalg RSA -keysize 2048 \
    -validity 3650 >/dev/null 2>&1

mkdir -p "$(dirname -- "$OUTPUT")"
"$TOOLS/apksigner" sign --ks "$TEMP_DIR/debug.keystore" \
    --ks-key-alias trustbench --ks-pass pass:trustbench \
    --key-pass pass:trustbench --out "$OUTPUT" "$TEMP_DIR/aligned.apk"
"$TOOLS/apksigner" verify "$OUTPUT"
shasum -a 256 "$OUTPUT"
