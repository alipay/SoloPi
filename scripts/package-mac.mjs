import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const lockDir = path.join(root, ".glassbox-package-mac.lock");
const lockInfoPath = path.join(lockDir, "owner.json");
const stagedCliDir = path.join(root, "build", "packaged-cli");
const releaseDir = path.join(root, "release");
const backupRoot = path.join(root, ".glassbox-package-backups");
const releaseBackupDir = path.join(backupRoot, `release-${process.pid}`);
const disposableAppBundleNames = new Set([
]);
let releaseBackedUp = false;
let packageSucceeded = false;

function preventSpotlightIndexing(directory) {
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, ".metadata_never_index"), "");
}

function cleanupDisposableAppBundles(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory() && disposableAppBundleNames.has(entry.name)) {
      fs.rmSync(entryPath, { recursive: true, force: true });
      continue;
    }
    if (entry.isDirectory() && !entry.isSymbolicLink()) {
      cleanupDisposableAppBundles(entryPath);
    }
  }
}

function writeLockInfo() {
  const payload = {
    pid: process.pid,
    startedAt: new Date().toISOString(),
    cwd: root,
    hostname: os.hostname(),
    command: "npm run package:mac",
  };
  fs.writeFileSync(lockInfoPath, JSON.stringify(payload, null, 2));
}

function acquireLock() {
  try {
    fs.mkdirSync(lockDir);
    writeLockInfo();
    return;
  } catch (error) {
    if (error?.code !== "EEXIST") {
      throw error;
    }
  }

  let owner = "";
  let ownerPid = 0;
  try {
    owner = fs.readFileSync(lockInfoPath, "utf8");
    ownerPid = Number(JSON.parse(owner)?.pid || 0);
  } catch (_error) {
    owner = "lock owner metadata is missing";
  }

  if (ownerPid > 0) {
    try {
      process.kill(ownerPid, 0);
    } catch (error) {
      if (error?.code === "ESRCH") {
        fs.rmSync(lockDir, { recursive: true, force: true });
        fs.mkdirSync(lockDir);
        writeLockInfo();
        return;
      }
    }
  }

  throw new Error([
    "Another GlassBox macOS package build appears to be running.",
    `Lock: ${lockDir}`,
    `Owner: ${owner}`,
    "Wait for the existing package build to finish before rerunning npm run package:mac.",
    "If no build process exists, remove the stale lock directory and rerun.",
  ].join("\n"));
}

function releaseLock() {
  fs.rmSync(lockDir, { recursive: true, force: true });
}

function run(command, args, options = {}) {
  execFileSync(command, args, {
    cwd: root,
    stdio: "inherit",
    ...options,
  });
}

function getElectronBuilderBin() {
  const binName = process.platform === "win32" ? "electron-builder.cmd" : "electron-builder";
  return path.join(root, "node_modules", ".bin", binName);
}

function configureExactSigningIdentity() {
  const identityHash = String(process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1 || "").trim().toUpperCase();
  if (!identityHash) {
    if (process.env.GLASSBOX_FORCE_ADHOC_SIGNING === "1") {
      return;
    }
    throw new Error(
      "GLASSBOX_CODESIGN_IDENTITY_SHA1 is required so Electron Builder and final bundle signing use one exact identity.",
    );
  }
  if (!/^[A-F0-9]{40}$/.test(identityHash)) {
    throw new Error("GLASSBOX_CODESIGN_IDENTITY_SHA1 must be a complete 40-character SHA-1 identity hash.");
  }

  const identities = execFileSync("security", ["find-identity", "-v", "-p", "codesigning"], {
    cwd: root,
    encoding: "utf8",
  });
  if (!identities.includes(identityHash)) {
    throw new Error(`Configured signing identity is not currently valid: ${identityHash}`);
  }

  // Use the exact hash for both Electron Builder's first pass and the final
  // bundle seal. Display names are not unique in macOS keychains.
  process.env.CSC_NAME = identityHash;
  process.env.GLASSBOX_CODESIGN_IDENTITY = identityHash;
}

configureExactSigningIdentity();
acquireLock();

try {
  preventSpotlightIndexing(backupRoot);
  preventSpotlightIndexing(path.dirname(stagedCliDir));
  cleanupDisposableAppBundles(backupRoot);
  cleanupDisposableAppBundles(path.dirname(stagedCliDir));
  cleanupDisposableAppBundles(releaseDir);
  // The final verifier runs after ZIP creation and must inspect the exact App
  // that produced both archives. Keep it for every signing mode until the
  // complete package transaction succeeds.
  process.env.GLASSBOX_KEEP_APP_DIR = "1";
  if (process.env.GLASSBOX_FORCE_ADHOC_SIGNING === "1") {
    if (process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") {
      throw new Error("Temporary ad-hoc QA packaging requires CSC_IDENTITY_AUTO_DISCOVERY=false.");
    }
    process.env.GLASSBOX_KEEP_RELEASE_METADATA = "1";
  }
  if (fs.existsSync(releaseBackupDir)) {
    throw new Error(`Stale package release backup exists: ${releaseBackupDir}`);
  }
  if (fs.existsSync(releaseDir)) {
    fs.renameSync(releaseDir, releaseBackupDir);
    releaseBackedUp = true;
  }
  fs.mkdirSync(releaseDir, { recursive: true });
  // Electron Builder leaves a runnable .app in release/mac-arm64 for the
  // post-package signature gates. Keep Spotlight from advertising that
  // candidate as a second installed Glass Box while those gates run.
  preventSpotlightIndexing(releaseDir);

  try {
    run(process.execPath, [path.join(root, "scripts", "generate-mac-icon.mjs")]);
    run(process.execPath, [path.join(root, "scripts", "verify-media-runtime.mjs")]);
    run(process.execPath, [path.join(root, "scripts", "verify-git-runtime.mjs")]);
    run("npm", ["run", "build"]);
    run(process.execPath, [path.join(root, "scripts", "prepare-packaged-app.mjs")]);
    run(getElectronBuilderBin(), ["--mac", "dir", "--arm64"]);
    run(process.execPath, [path.join(root, "scripts", "create-mac-dmg.mjs")]);
    run(process.execPath, [path.join(root, "scripts", "verify-packaged-app.mjs")]);
    run(process.execPath, [path.join(root, "scripts", "create-mac-zip.mjs")]);
    run(process.execPath, [path.join(root, "scripts", "create-mac-update-feed.mjs")]);
    run(process.execPath, [path.join(root, "scripts", "verify-packaged-app.mjs")]);
  } catch (error) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    if (releaseBackedUp && fs.existsSync(releaseBackupDir)) {
      fs.renameSync(releaseBackupDir, releaseDir);
      releaseBackedUp = false;
    }
    throw error;
  }

  if (releaseBackedUp) {
    fs.rmSync(releaseBackupDir, { recursive: true, force: true });
    releaseBackedUp = false;
  }
  packageSucceeded = true;
} finally {
  fs.rmSync(stagedCliDir, { recursive: true, force: true });
  if (releaseBackedUp && fs.existsSync(releaseBackupDir)) {
    fs.rmSync(releaseDir, { recursive: true, force: true });
    fs.renameSync(releaseBackupDir, releaseDir);
  }
  releaseLock();
  // A completed package transaction supersedes every historical release
  // backup. Failed transactions still retain pre-existing backups so they can
  // be inspected or recovered manually.
  if (packageSucceeded && fs.existsSync(backupRoot)) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  } else if (fs.existsSync(backupRoot) && fs.readdirSync(backupRoot).every((entry) => entry === ".metadata_never_index")) {
    fs.rmSync(backupRoot, { recursive: true, force: true });
  }
}
