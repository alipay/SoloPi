#!/usr/bin/env python3
"""Build the offline Java demo using only a local Android SDK and JDK 17+."""

import argparse
import os
from pathlib import Path
import subprocess
import tempfile
import zipfile


def run(args, env=None):
    subprocess.run([str(arg) for arg in args], check=True, env=env, timeout=600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--sdk", type=Path, default=os.environ.get("ANDROID_HOME") or
                        os.environ.get("ANDROID_SDK_ROOT") or Path.home() / "Library/Android/sdk")
    parser.add_argument("--java-home", type=Path, default=os.environ.get("JAVA_HOME"))
    parser.add_argument("--build-tools", default="35.0.0")
    parser.add_argument("--platform", default="android-35")
    parser.add_argument("--output", type=Path, default=Path(tempfile.gettempdir()) /
                        ("solopi-fastpath-demo-" + str(os.getuid())))
    args = parser.parse_args()
    source = Path(__file__).resolve().parent
    sdk = args.sdk.expanduser().resolve()
    out = args.output.expanduser().resolve()
    out.mkdir(parents=True, exist_ok=True, mode=0o700)
    java_home = args.java_home
    if java_home is None and Path("/usr/libexec/java_home").exists():
        java_home = Path(subprocess.check_output(
            ["/usr/libexec/java_home", "-v", "17"], text=True, timeout=30).strip())
    if java_home is None:
        parser.error("Set JAVA_HOME or pass --java-home with a JDK 17+ installation")
    java_home = java_home.expanduser().resolve()
    build_tools = sdk / "build-tools" / args.build_tools
    android_jar = sdk / "platforms" / args.platform / "android.jar"
    required = [android_jar, java_home / "bin/javac", java_home / "bin/keytool"]
    required.extend(build_tools / tool for tool in ("aapt2", "d8", "zipalign", "apksigner"))
    for path in required:
        if not path.is_file():
            parser.error("Required local build tool does not exist: " + str(path))
    env = dict(os.environ, JAVA_HOME=str(java_home))
    env["PATH"] = str(java_home / "bin") + os.pathsep + env.get("PATH", "")
    apk = out / "fastpath-demo.apk"
    keystore = out / "demo-debug.keystore"
    # A persistent local debug certificate permits adb install -r across builds.
    # This key and the APK stay outside version control; they are not release assets.
    if not keystore.exists():
        run([java_home / "bin/keytool", "-genkeypair", "-keystore", keystore,
             "-storepass", "android", "-keypass", "android", "-alias", "androiddebugkey",
             "-dname", "CN=FastPath Local Demo", "-keyalg", "RSA", "-keysize", "2048",
             "-validity", "3650", "-noprompt"], env)
        keystore.chmod(0o600)
    with tempfile.TemporaryDirectory(prefix="compile-", dir=out) as work:
        work = Path(work)
        generated = work / "generated"
        classes = work / "classes"
        dex = work / "dex"
        for folder in (generated, classes, dex):
            folder.mkdir()
        resources = work / "resources.zip"
        unsigned = work / "unsigned.apk"
        aligned = work / "aligned.apk"
        run([build_tools / "aapt2", "compile", "--dir", source / "res", "-o", resources], env)
        run([build_tools / "aapt2", "link", "-o", unsigned, "-I", android_jar,
             "--manifest", source / "AndroidManifest.xml", "--java", generated,
             "--min-sdk-version", "23", "--target-sdk-version", "35", resources], env)
        sources = sorted((source / "src").rglob("*.java")) + sorted(generated.rglob("*.java"))
        run([java_home / "bin/javac", "-encoding", "UTF-8", "--release", "8",
             "-classpath", android_jar, "-d", classes, *sources], env)
        class_files = sorted(classes.rglob("*.class"))
        run([build_tools / "d8", "--min-api", "23", "--lib", android_jar,
             "--output", dex, *class_files], env)
        with zipfile.ZipFile(unsigned, "a", compression=zipfile.ZIP_DEFLATED) as archive:
            for dex_file in sorted(dex.glob("*.dex")):
                archive.write(dex_file, dex_file.name)
        run([build_tools / "zipalign", "-f", "4", unsigned, aligned], env)
        run([build_tools / "apksigner", "sign", "--ks", keystore,
             "--ks-key-alias", "androiddebugkey", "--ks-pass", "pass:android",
             "--key-pass", "pass:android", "--out", apk, aligned], env)
        run([build_tools / "apksigner", "verify", "--verbose", apk], env)
    print("APK: " + str(apk))
    print("Activity: com.solopi.fastpath.demo/.MainActivity")


if __name__ == "__main__":
    main()
