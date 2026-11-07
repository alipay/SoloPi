#!/usr/bin/env node

import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const packageJsonPath = path.join(root, "package.json");
const stateDir = path.join(root, ".glassbox-notary");
const statePath = path.join(stateDir, "latest.json");
const identityHash = String(process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1 || "")
  .trim()
  .toUpperCase();
const keychainProfile = String(process.env.GLASSBOX_NOTARY_PROFILE || "GlassBoxNotary").trim();
const pollSeconds = Math.max(10, Number(process.env.GLASSBOX_NOTARY_POLL_SECONDS || 30));
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function fail(message) {
  const error = new Error(message);
  error.code = "GLASSBOX_NOTARIZATION_FAILED";
  throw error;
}

function run(command, args, options = {}) {
  if (options.capture) {
    const result = spawnSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      ...options,
    });
    if (result.status !== 0) {
      const detail = String(result.stderr || result.stdout || "").trim();
      fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
    }
    return `${result.stdout || ""}\n${result.stderr || ""}`;
  }
  return execFileSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: "inherit",
    ...options,
  });
}

function runJson(command, args) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const detail = String(result.stderr || result.stdout || "").trim();
    fail(`${command} ${args.join(" ")} failed${detail ? `: ${detail}` : ""}`);
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    fail(`Unable to parse JSON from ${command}: ${String(result.stdout || "").trim()}`);
  }
}

function sha256(filePath) {
  const hash = crypto.createHash("sha256");
  const file = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead = 0;
    do {
      bytesRead = fs.readSync(file, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
  } finally {
    fs.closeSync(file);
  }
  return hash.digest("hex");
}

function readPackage() {
  return JSON.parse(fs.readFileSync(packageJsonPath, "utf8"));
}

function assertVersion(value) {
  const version = String(value || "").trim();
  if (!SEMVER_PATTERN.test(version)) {
    fail(`Version must be SemVer, for example 0.1.57: ${version || "(empty)"}`);
  }
  return version;
}

function compareVersions(left, right) {
  const [leftCore, leftPre = ""] = left.split("-", 2);
  const [rightCore, rightPre = ""] = right.split("-", 2);
  const leftParts = leftCore.split(".").map(Number);
  const rightParts = rightCore.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    if (leftParts[index] !== rightParts[index]) {
      return leftParts[index] > rightParts[index] ? 1 : -1;
    }
  }
  if (leftPre === rightPre) return 0;
  if (!leftPre) return 1;
  if (!rightPre) return -1;
  return leftPre.localeCompare(rightPre);
}

function setProjectVersion(targetVersion) {
  const currentVersion = assertVersion(readPackage().version);
  if (!targetVersion || targetVersion === currentVersion) return currentVersion;
  if (compareVersions(targetVersion, currentVersion) <= 0) {
    fail(`New release version ${targetVersion} must be greater than current ${currentVersion}.`);
  }
  run("npm", ["version", targetVersion, "--no-git-tag-version"]);
  const packageVersion = readPackage().version;
  const lockVersion = JSON.parse(
    fs.readFileSync(path.join(root, "package-lock.json"), "utf8"),
  ).version;
  if (packageVersion !== targetVersion || lockVersion !== targetVersion) {
    fail(
      `Version update was incomplete: package.json=${packageVersion}, package-lock.json=${lockVersion}`,
    );
  }
  return targetVersion;
}

function artifactPaths(version = readPackage().version) {
  return {
    app: path.join(root, "release", "mac-arm64", "solopi-desktop.app"),
    dmg: path.join(root, "release", `solopi-desktop-${version}-arm64.dmg`),
    zip: path.join(root, "release", `solopi-desktop-${version}-arm64-mac.zip`),
    blockmap: path.join(root, "release", `solopi-desktop-${version}-arm64-mac.zip.blockmap`),
    manifest: path.join(root, "release", "latest-mac.yml"),
  };
}

function assertFile(filePath, label) {
  if (!fs.existsSync(filePath)) fail(`Missing ${label}: ${filePath}`);
}

function readState() {
  if (!fs.existsSync(statePath)) return null;
  return JSON.parse(fs.readFileSync(statePath, "utf8"));
}

function writeState(state) {
  fs.mkdirSync(stateDir, { recursive: true, mode: 0o700 });
  const temporaryPath = `${statePath}.${process.pid}.tmp`;
  fs.writeFileSync(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporaryPath, statePath);
}

function submissionIdFrom(payload) {
  return String(payload?.id || payload?.submissionId || payload?.data?.id || "").trim();
}

function submissionStatus(payload) {
  return String(payload?.status || payload?.data?.status || "").trim();
}

function notaryInfo(id) {
  return runJson("xcrun", [
    "notarytool",
    "info",
    id,
    "--keychain-profile",
    keychainProfile,
    "--output-format",
    "json",
  ]);
}

function printJson(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
}

function assertIdentity() {
  if (!/^[A-F0-9]{40}$/.test(identityHash)) {
    fail("GLASSBOX_CODESIGN_IDENTITY_SHA1 must be an exact 40-character Developer ID SHA-1.");
  }
  const identities = run("security", ["find-identity", "-v", "-p", "codesigning"], {
    capture: true,
  });
  const line = identities.split(/\r?\n/).find((entry) => entry.includes(identityHash));
  if (!line) fail(`Signing identity is not valid in the current keychain: ${identityHash}`);
  if (!line.includes("Developer ID Application:")) {
    fail(`Configured identity is not Developer ID Application: ${line.trim()}`);
  }
}

function verifyBeforeSubmit(paths) {
  for (const [kind, filePath] of Object.entries(paths)) {
    assertFile(filePath, kind);
  }
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", paths.app]);
  const signature = run("codesign", ["-dvvv", "--verbose=4", paths.app], { capture: true });
  if (!signature.includes("Authority=Developer ID Application:")) {
    fail("Packaged App is not signed with Developer ID Application.");
  }
  if (!signature.includes("Timestamp=")) {
    fail("Packaged App is missing the secure timestamp required for Developer ID distribution.");
  }
  run("codesign", ["--verify", "--verbose=4", paths.dmg]);
  run("hdiutil", ["verify", paths.dmg]);
  run("unzip", ["-tqq", paths.zip]);
}

function verifyAfterStaple(paths) {
  run("xcrun", ["stapler", "validate", paths.dmg]);
  run("spctl", ["-a", "-vvv", "-t", "exec", paths.app]);
  run("spctl", ["-a", "-vvv", "-t", "install", paths.dmg]);
  run("hdiutil", ["verify", paths.dmg]);
  run("codesign", ["--verify", "--deep", "--strict", "--verbose=4", paths.app]);
  run("unzip", ["-tqq", paths.zip]);
  const artifacts = Object.fromEntries(
    Object.entries(paths)
      .filter(([kind]) => kind !== "app")
      .map(([kind, filePath]) => [
        kind,
        {
          path: filePath,
          size: fs.statSync(filePath).size,
          sha256: sha256(filePath),
        },
      ]),
  );
  printJson({
    success: true,
    phase: "notarized",
    version: readPackage().version,
    submissionId: readState()?.submissionId || "",
    signingIdentitySha1: identityHash,
    keychainProfile,
    artifacts,
  });
  return artifacts;
}

function finishAcceptedSubmission(state, info) {
  const paths = artifactPaths(state.version);
  assertFile(paths.dmg, "DMG");
  const currentHash = sha256(paths.dmg);
  if (state.finalDmgSha256 && currentHash === state.finalDmgSha256) {
    verifyAfterStaple(paths);
    return;
  }
  if (state.submittedDmgSha256 && currentHash !== state.submittedDmgSha256) {
    if (state.stapleStartedAt && state.preStapleDmgSha256 === state.submittedDmgSha256) {
      const artifacts = verifyAfterStaple(paths);
      writeState({
        ...state,
        status: "Accepted",
        acceptedAt: new Date().toISOString(),
        finalDmgSha256: artifacts.dmg.sha256,
        recoveredAfterInterruptedStaple: true,
        lastInfo: info,
      });
      return;
    }
    fail("The DMG changed after submission; refusing to staple a ticket onto different bytes.");
  }
  writeState({
    ...state,
    status: "Accepted",
    stapleStartedAt: new Date().toISOString(),
    preStapleDmgSha256: currentHash,
    lastInfo: info,
  });
  run("xcrun", ["stapler", "staple", paths.dmg]);
  const artifacts = verifyAfterStaple(paths);
  writeState({
    ...state,
    status: "Accepted",
    acceptedAt: new Date().toISOString(),
    finalDmgSha256: artifacts.dmg.sha256,
    lastInfo: info,
  });
}

async function waitForSubmission(state) {
  for (;;) {
    const info = notaryInfo(state.submissionId);
    const status = submissionStatus(info);
    writeState({
      ...state,
      status,
      checkedAt: new Date().toISOString(),
      lastInfo: info,
    });
    printJson({
      success: status === "Accepted",
      phase: "notarization",
      submissionId: state.submissionId,
      status,
    });
    if (status === "Accepted") {
      finishAcceptedSubmission({ ...state, status }, info);
      return;
    }
    if (status === "Invalid" || status === "Rejected") {
      process.stderr.write(
        `Notarization ${status}. Run: glassbox-release log ${state.submissionId}\n`,
      );
      process.exitCode = 1;
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, pollSeconds * 1000));
  }
}

async function packageAndSubmit(requestedVersion = "") {
  assertIdentity();
  const targetVersion = requestedVersion ? assertVersion(requestedVersion) : "";
  const saved = readState();
  if (saved?.submissionId && saved?.status !== "Accepted" && targetVersion
    && targetVersion !== saved.version) {
    fail(
      `Submission ${saved.submissionId} for ${saved.version} is still ${saved.status || "active"}. `
      + `Finish it before creating ${targetVersion}; project version files were not changed.`,
    );
  }
  if (saved?.status === "Accepted" && saved.version === readPackage().version) {
    if (targetVersion && targetVersion !== saved.version) {
      // Continue below and create the explicitly requested next version.
    } else {
    const savedDmg = artifactPaths(saved.version).dmg;
    if (fs.existsSync(savedDmg) && sha256(savedDmg) === saved.finalDmgSha256) {
      process.stdout.write(
        `Version ${saved.version} is already notarized as ${saved.submissionId}; no package or submission was repeated.\n`,
      );
      verifyAfterStaple(artifactPaths(saved.version));
      return;
    }
    }
  }
  if (saved?.submissionId && saved?.status !== "Accepted") {
    const savedDmg = artifactPaths(saved.version).dmg;
    if (fs.existsSync(savedDmg) && sha256(savedDmg) === saved.submittedDmgSha256) {
      process.stdout.write(
        `Resuming existing submission ${saved.submissionId}; no package or submission was repeated.\n`,
      );
      await waitForSubmission(saved);
      return;
    }
    fail(
      `Unfinished submission ${saved.submissionId} exists, but its DMG no longer matches. `
      + "Inspect it with glassbox-release status before creating a new submission.",
    );
  }

  const previousVersion = readPackage().version;
  const version = setProjectVersion(targetVersion);
  try {
    run("npm", ["run", "package:mac"], {
      env: {
        ...process.env,
        GLASSBOX_CODESIGN_IDENTITY_SHA1: identityHash,
      },
    });
  } catch (error) {
    if (version !== previousVersion) {
      process.stderr.write(
        `Packaging failed; restoring package.json and package-lock.json to ${previousVersion}.\n`,
      );
      run("npm", ["version", previousVersion, "--no-git-tag-version"]);
    }
    throw error;
  }
  const paths = artifactPaths(version);
  verifyBeforeSubmit(paths);
  // Validate the keychain profile before uploading a large artifact.
  runJson("xcrun", [
    "notarytool",
    "history",
    "--keychain-profile",
    keychainProfile,
    "--output-format",
    "json",
  ]);
  const submittedDmgSha256 = sha256(paths.dmg);
  const submission = runJson("xcrun", [
    "notarytool",
    "submit",
    paths.dmg,
    "--keychain-profile",
    keychainProfile,
    "--output-format",
    "json",
  ]);
  const submissionId = submissionIdFrom(submission);
  if (!submissionId) fail("Apple accepted the upload but returned no submission ID.");
  const state = {
    schemaVersion: "glassbox.notarization-state.v1",
    version,
    submissionId,
    status: submissionStatus(submission) || "In Progress",
    submittedAt: new Date().toISOString(),
    submittedDmgSha256,
    dmgPath: paths.dmg,
    signingIdentitySha1: identityHash,
    keychainProfile,
  };
  writeState(state);
  printJson({
    success: true,
    phase: "submitted",
    submissionId,
    status: state.status,
    dmgPath: paths.dmg,
    submittedDmgSha256,
  });
  await waitForSubmission(state);
}

function stateForId(id) {
  const saved = readState();
  if (saved?.submissionId === id) return saved;
  return {
    schemaVersion: "glassbox.notarization-state.v1",
    version: readPackage().version,
    submissionId: id,
    status: "",
    submittedDmgSha256: fs.existsSync(artifactPaths().dmg)
      ? sha256(artifactPaths().dmg)
      : "",
    dmgPath: artifactPaths().dmg,
    signingIdentitySha1: identityHash,
    keychainProfile,
  };
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    process.stdout.write(`Usage:
  glassbox-release <version>
  glassbox-release --version <version>
  glassbox-release
  glassbox-release status [submission-id]
  glassbox-release history
  glassbox-release log [submission-id]
  glassbox-release finish [submission-id]
  glassbox-release adopt <submission-id>

Examples:
  glassbox-release 0.1.57
  glassbox-release --version 0.1.57
`);
    return;
  }
  let command = args[0] || "run";
  let value = args[1] || "";
  let requestedVersion = "";
  if (SEMVER_PATTERN.test(command)) {
    requestedVersion = command;
    command = "run";
    value = "";
  }
  const versionIndex = args.indexOf("--version");
  if (versionIndex >= 0) {
    requestedVersion = assertVersion(args[versionIndex + 1]);
    command = args[0] === "package" ? "package" : "run";
    value = "";
  }
  if (command === "run" || command === "package") {
    await packageAndSubmit(requestedVersion);
    return;
  }
  if (command === "history") {
    printJson(runJson("xcrun", [
      "notarytool",
      "history",
      "--keychain-profile",
      keychainProfile,
      "--output-format",
      "json",
    ]));
    return;
  }
  const id = value || readState()?.submissionId || "";
  if (!id) fail(`No submission ID supplied and no saved state exists for "${command}".`);
  if (command === "status") {
    printJson(notaryInfo(id));
    return;
  }
  if (command === "log") {
    printJson(runJson("xcrun", [
      "notarytool",
      "log",
      id,
      "--keychain-profile",
      keychainProfile,
      "--output-format",
      "json",
    ]));
    return;
  }
  if (command === "finish") {
    const state = stateForId(id);
    const info = notaryInfo(id);
    const status = submissionStatus(info);
    if (status === "Accepted") {
      writeState({ ...state, status, lastInfo: info });
      finishAcceptedSubmission({ ...state, status }, info);
      return;
    }
    printJson({ success: false, phase: "notarization", submissionId: id, status });
    process.exitCode = status === "In Progress" ? 2 : 1;
    return;
  }
  if (command === "adopt") {
    const state = stateForId(id);
    const info = notaryInfo(id);
    writeState({
      ...state,
      status: submissionStatus(info),
      adoptedAt: new Date().toISOString(),
      lastInfo: info,
    });
    printJson({ success: true, phase: "adopted", submissionId: id, status: submissionStatus(info) });
    return;
  }
  fail("Usage: glassbox-release [run|status [id]|history|log [id]|finish [id]|adopt <id>]");
}

main().catch((error) => {
  process.stderr.write(`${JSON.stringify({
    success: false,
    error: {
      code: String(error?.code || "GLASSBOX_NOTARIZATION_FAILED"),
      message: error instanceof Error ? error.message : String(error),
    },
    statePath,
  }, null, 2)}\n`);
  process.exitCode = 1;
});
