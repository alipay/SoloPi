#!/bin/sh
set -eu
: "${ANDROID_SDK_ROOT:?Set ANDROID_SDK_ROOT to the installed SDK}"
APP_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
TOOLS="$ANDROID_SDK_ROOT/build-tools/${ANDROID_BUILD_TOOLS_VERSION:-34.0.0}"
ANDROID_JAR="$ANDROID_SDK_ROOT/platforms/${ANDROID_PLATFORM_VERSION:-android-35}/android.jar"
OUTPUT=${1:-"$APP_DIR/dist/trustbench-transfer.apk"}
TASK_TEMP=$(mktemp -d)
trap 'rm -rf "$TASK_TEMP"' EXIT HUP INT TERM
mkdir -p "$TASK_TEMP/compiled" "$TASK_TEMP/generated" "$TASK_TEMP/classes" "$TASK_TEMP/dex"
"$TOOLS/aapt2" compile --dir "$APP_DIR/res" -o "$TASK_TEMP/compiled"
"$TOOLS/aapt2" link -o "$TASK_TEMP/unsigned.apk" -I "$ANDROID_JAR" --manifest "$APP_DIR/AndroidManifest.xml" --java "$TASK_TEMP/generated" "$TASK_TEMP/compiled/values_ids.arsc.flat"
javac -source 8 -target 8 -cp "$ANDROID_JAR" -d "$TASK_TEMP/classes" "$APP_DIR/src/com/example/trusttransfer/MainActivity.java" "$TASK_TEMP/generated/com/example/trusttransfer/R.java"
jar cf "$TASK_TEMP/classes.jar" -C "$TASK_TEMP/classes" .
"$TOOLS/d8" --min-api 23 --lib "$ANDROID_JAR" --output "$TASK_TEMP/dex" "$TASK_TEMP/classes.jar"
zip -q -j "$TASK_TEMP/unsigned.apk" "$TASK_TEMP/dex/classes.dex"
"$TOOLS/zipalign" -f 4 "$TASK_TEMP/unsigned.apk" "$TASK_TEMP/aligned.apk"
keytool -genkeypair -noprompt -keystore "$TASK_TEMP/debug.keystore" -storepass trustbench -keypass trustbench -alias trustbench -dname "CN=TrustBench Transfer Fixture" -keyalg RSA -keysize 2048 -validity 3650 >/dev/null 2>&1
mkdir -p "$(dirname -- "$OUTPUT")"
"$TOOLS/apksigner" sign --ks "$TASK_TEMP/debug.keystore" --ks-key-alias trustbench --ks-pass pass:trustbench --key-pass pass:trustbench --out "$OUTPUT" "$TASK_TEMP/aligned.apk"
"$TOOLS/apksigner" verify "$OUTPUT"
shasum -a 256 "$OUTPUT"
