#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--publish-repo' || !args[1])) throw Error('Usage: skills:bundle [--publish-repo <directory>]');
if (args.length) {
  const destination = path.resolve(args[1], 'solopi-desktop-cli');
  if (fs.existsSync(destination)) throw Error('Destination already exists; use a new directory to avoid replacing installed skills');
  fs.cpSync(path.join(root, 'skills/solopi-desktop-cli'), destination, {recursive: true, filter: (source) => !fs.lstatSync(source).isSymbolicLink() && path.basename(source) !== '.DS_Store'});
}
console.log(JSON.stringify({success: true, skills: ['solopi-desktop-cli']}));
