#!/usr/bin/env node

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(scriptDir, "..");
const identity = String(process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1 || "").trim().toUpperCase();
const profile = String(process.env.GLASSBOX_NOTARY_PROFILE || "GlassBoxNotary").trim();

if (!/^[A-F0-9]{40}$/.test(identity)) {
  throw new Error("Set GLASSBOX_CODESIGN_IDENTITY_SHA1 to the exact Developer ID SHA-1.");
}
if (!/^[A-Za-z0-9._-]+$/.test(profile)) {
  throw new Error("GLASSBOX_NOTARY_PROFILE contains unsupported characters.");
}

const configDir = path.join(os.homedir(), ".config", "glassbox");
const binDir = path.join(os.homedir(), ".local", "bin");
const configPath = path.join(configDir, "release.env");
const commandPath = path.join(binDir, "glassbox-release");

fs.mkdirSync(configDir, { recursive: true, mode: 0o700 });
fs.mkdirSync(binDir, { recursive: true, mode: 0o755 });
fs.writeFileSync(configPath, [
  `GLASSBOX_REPOSITORY='${root.replaceAll("'", "'\\''")}'`,
  `GLASSBOX_CODESIGN_IDENTITY_SHA1='${identity}'`,
  `GLASSBOX_NOTARY_PROFILE='${profile}'`,
  "",
].join("\n"), { mode: 0o600 });

fs.writeFileSync(commandPath, `#!/bin/sh
set -eu
CONFIG="\${XDG_CONFIG_HOME:-$HOME/.config}/glassbox/release.env"
if [ ! -r "$CONFIG" ]; then
  echo "GlassBox release config is missing: $CONFIG" >&2
  exit 1
fi
. "$CONFIG"
export GLASSBOX_CODESIGN_IDENTITY_SHA1 GLASSBOX_NOTARY_PROFILE
exec /usr/bin/env node "$GLASSBOX_REPOSITORY/scripts/package-and-notarize-mac.mjs" "$@"
`, { mode: 0o755 });

process.stdout.write(`${JSON.stringify({
  success: true,
  command: commandPath,
  config: configPath,
  repository: root,
  signingIdentitySha1: identity,
  keychainProfile: profile,
}, null, 2)}\n`);
