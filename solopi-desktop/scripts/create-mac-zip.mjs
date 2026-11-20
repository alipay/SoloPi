import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const productName = packageJson.productName || "solopi-desktop";
const version = packageJson.version || "0.0.0";
const releaseDir = path.join(root, "release");
const appDir = path.join(releaseDir, "mac-arm64");
const appPath = path.join(appDir, `${productName}.app`);
const dmgPath = path.join(releaseDir, `${productName}-${version}-arm64.dmg`);
const zipPath = path.join(releaseDir, `${productName}-${version}-arm64-mac.zip`);

if (!fs.existsSync(appPath)) {
  throw new Error(`Missing packaged app: ${appPath}`);
}

fs.rmSync(zipPath, { force: true });

execFileSync("ditto", [
  "-c",
  "-k",
  "--sequesterRsrc",
  "--keepParent",
  appPath,
  zipPath,
], {
  cwd: releaseDir,
  stdio: "inherit",
});

if (process.env.GLASSBOX_KEEP_APP_DIR !== "1") {
  fs.rmSync(appDir, { recursive: true, force: true });
}

if (process.env.GLASSBOX_KEEP_RELEASE_METADATA !== "1") {
  const keep = new Set([path.basename(dmgPath), path.basename(zipPath), "packaged-app-sha256.json", ".metadata_never_index"]);
  keep.add(`${productName}-${version}-darwin-arm64-ffmpeg-sources.tar.gz`);
  keep.add(`${productName}-${version}-darwin-arm64-ffmpeg-sources.tar.gz.sha256`);
  if (process.env.GLASSBOX_KEEP_APP_DIR === "1") {
    keep.add(path.basename(appDir));
  }
  for (const entry of fs.readdirSync(releaseDir)) {
    if (!keep.has(entry)) {
      fs.rmSync(path.join(releaseDir, entry), { recursive: true, force: true });
    }
  }
}

console.log(`Created ${zipPath}`);
