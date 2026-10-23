import { execFileSync, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { withTimestampRetry } from "./electron-builder-sign.mjs";
import { verifyElectronEntitlements } from "./verify-mac-entitlements.mjs";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productName = packageJson.productName || "solopi-desktop";
const version = packageJson.version || "0.0.0";
const releaseDir = path.join(root, "release");
const appPath = path.join(releaseDir, "mac-arm64", `${productName}.app`);
const stagingDir = path.join(releaseDir, "dmg-staging");
const dmgPath = path.join(releaseDir, `${productName}-${version}-arm64.dmg`);
const integrityPath = path.join(releaseDir, "packaged-app-sha256.json");

if (!fs.existsSync(appPath)) {
  throw new Error(`Missing packaged app: ${appPath}`);
}

function runOutput(command, args) {
  try {
    return execFileSync(command, args, {
      cwd: root,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (_error) {
    return "";
  }
}

function findCodesignIdentity() {
  const configuredIdentity = (
    process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1
    || process.env.GLASSBOX_CODESIGN_IDENTITY
    || process.env.CODESIGN_IDENTITY
    || process.env.CSC_NAME
    || ""
  ).trim().toUpperCase();

  const identities = runOutput("security", ["find-identity", "-v", "-p", "codesigning"]);
  const validIdentities = identities
    .split("\n")
    .map((line) => line.trim())
    .map((line) => line.match(/^\d+\)\s+([A-F0-9]{40})\s+"(.+)"$/))
    .filter(Boolean)
    .map((match) => ({ hash: match[1], name: match[2] }));

  if (configuredIdentity && configuredIdentity !== "-") {
    if (/^[A-F0-9]{40}$/.test(configuredIdentity)) {
      if (!validIdentities.some((identity) => identity.hash === configuredIdentity)) {
        throw new Error(`Configured signing identity is not currently valid: ${configuredIdentity}`);
      }
      return validIdentities.find((identity) => identity.hash === configuredIdentity);
    }
    const matchingNames = validIdentities.filter(
      (identity) => identity.name.toUpperCase() === configuredIdentity,
    );
    if (matchingNames.length > 1) {
      throw new Error(
        `Signing identity display name is ambiguous; use GLASSBOX_CODESIGN_IDENTITY_SHA1: ${configuredIdentity}`,
      );
    }
    if (matchingNames.length === 1) {
      return matchingNames[0];
    }
    throw new Error(`Configured signing identity is not currently valid: ${configuredIdentity}`);
  }

  const candidates = validIdentities.filter(
    (identity) => !identity.name.startsWith("Developer ID Application:"),
  );
  const duplicateName = candidates.find((identity, index) => (
    candidates.findIndex((candidate) => candidate.name === identity.name) !== index
  ));
  if (duplicateName) {
    throw new Error(
      `Multiple valid signing identities share the display name "${duplicateName.name}". `
      + "Set GLASSBOX_CODESIGN_IDENTITY_SHA1 to the exact 40-character hash.",
    );
  }

  return candidates[0] || null;
}

const forceAdHocSigning = process.env.GLASSBOX_FORCE_ADHOC_SIGNING === "1";
const allowAdHocSigning = forceAdHocSigning || process.env.GLASSBOX_ALLOW_ADHOC_SIGNING === "1";
const codesignIdentity = forceAdHocSigning ? null : findCodesignIdentity();
const codesignIdentityHash = codesignIdentity?.hash || "";

if (forceAdHocSigning && process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false") {
  throw new Error("Temporary ad-hoc QA packaging requires CSC_IDENTITY_AUTO_DISCOVERY=false.");
}

if (forceAdHocSigning) {
  console.warn("[dmg] Using the explicitly requested temporary ad-hoc QA signing flow.");
} else if (codesignIdentity) {
  console.log(`[dmg] Signing temporary QA app with local identity: ${codesignIdentityHash}`);
} else if (allowAdHocSigning) {
  console.warn("[dmg] Using explicitly requested ad-hoc diagnostic signing.");
} else {
  throw new Error([
    "No usable local macOS code-signing identity is available for the temporary QA package.",
    "Restore a local development/enterprise identity, then rerun npm run package:mac.",
    "GLASSBOX_ALLOW_ADHOC_SIGNING=1 is diagnostic-only because managed macOS rejects ad-hoc executables.",
  ].join("\n"));
}

verifyElectronEntitlements(appPath);
// Re-sign only the enclosing bundle; keep osx-sign's per-process permissions.
const codesignArgs = ["--force", "--preserve-metadata=entitlements"];
if (codesignIdentity) {
  codesignArgs.push("--options", "runtime");
  if (codesignIdentity.name.startsWith("Apple Development:")) {
    codesignArgs.push("--timestamp=none");
  } else {
    codesignArgs.push("--timestamp");
  }
}
codesignArgs.push("--sign", codesignIdentityHash || "-", appPath);

await withTimestampRetry(() => execFileSync("codesign", codesignArgs, {
  cwd: root,
  stdio: "pipe",
}));

verifyElectronEntitlements(appPath);

execFileSync("codesign", ["--verify", "--deep", "--strict", "--verbose=2", appPath], {
  cwd: root,
  stdio: "inherit",
});

const signatureInspection = spawnSync("codesign", ["-dv", "--verbose=4", appPath], {
  cwd: root,
  encoding: "utf8",
});
if (signatureInspection.status !== 0) {
  throw new Error(`Unable to inspect final app signature: ${signatureInspection.stderr || signatureInspection.stdout}`);
}
const signatureDetails = `${signatureInspection.stdout || ""}\n${signatureInspection.stderr || ""}`;
if (forceAdHocSigning && !signatureDetails.includes("Signature=adhoc")) {
  throw new Error("Temporary QA app is not ad-hoc signed after final bundle signing.");
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

const integrity = {
  schemaVersion: "glassbox.packaged-app-integrity.v1",
  createdAt: new Date().toISOString(),
  signingMode: forceAdHocSigning ? "adhoc-qa" : "configured-identity",
  files: {
    mainExecutable: {
      path: "mac-arm64/solopi-desktop.app/Contents/MacOS/solopi-desktop",
      sha256: sha256(path.join(appPath, "Contents", "MacOS", productName)),
    },
    appAsar: {
      path: "mac-arm64/solopi-desktop.app/Contents/Resources/app.asar",
      sha256: sha256(path.join(appPath, "Contents", "Resources", "app.asar")),
    },
    cliLauncher: {
      path: "mac-arm64/solopi-desktop.app/Contents/Resources/bin/glassbox",
      sha256: sha256(path.join(appPath, "Contents", "Resources", "bin", "glassbox")),
    },
    infoPlist: {
      path: "mac-arm64/solopi-desktop.app/Contents/Info.plist",
      sha256: sha256(path.join(appPath, "Contents", "Info.plist")),
    },
  },
};
fs.writeFileSync(integrityPath, `${JSON.stringify(integrity, null, 2)}\n`);

fs.rmSync(dmgPath, { force: true });

fs.rmSync(stagingDir, { force: true, recursive: true });
fs.mkdirSync(stagingDir, { recursive: true });
execFileSync("ditto", ["--rsrc", "--extattr", appPath, path.join(stagingDir, `${productName}.app`)], {
  cwd: root,
  stdio: "inherit",
});
fs.symlinkSync("/Applications", path.join(stagingDir, "Applications"));

execFileSync(
  "hdiutil",
  [
    "create",
    "-volname",
    productName,
    "-srcfolder",
    stagingDir,
    "-ov",
    "-format",
    "UDZO",
    dmgPath,
  ],
  {
    cwd: root,
    stdio: "inherit",
  }
);

if (codesignIdentity) {
  const dmgCodesignArgs = ["--force"];
  if (codesignIdentity.name.startsWith("Apple Development:")) {
    dmgCodesignArgs.push("--timestamp=none");
  } else {
    dmgCodesignArgs.push("--timestamp");
  }
  dmgCodesignArgs.push("--sign", codesignIdentityHash, dmgPath);
  await withTimestampRetry(() => execFileSync("codesign", dmgCodesignArgs, {
    cwd: root,
    stdio: "pipe",
  }));
  execFileSync("codesign", ["--verify", "--verbose=4", dmgPath], {
    cwd: root,
    stdio: "inherit",
  });
}

execFileSync("hdiutil", ["verify", dmgPath], {
  cwd: root,
  stdio: "inherit",
});

fs.rmSync(stagingDir, { force: true, recursive: true });

console.log(`Created ${dmgPath}`);
