#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLIC_SKILLS} from './export-public-source.mjs';
import {verifyPublicSkills} from './verify-glassbox-skill-distribution.mjs';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--publish-repo' || !args[1])) throw Error('Usage: skills:bundle [--publish-repo <directory>]');
if (args.length) {
  verifyPublicSkills(path.join(root, 'skills'));
  for (const name of PUBLIC_SKILLS) {
    const destination = path.resolve(args[1], name);
    if (fs.existsSync(destination)) throw Error('Destination already exists; use a new directory to avoid replacing installed skills');
  }
  for (const name of PUBLIC_SKILLS) fs.cpSync(path.join(root, 'skills', name), path.resolve(args[1], name), {recursive: true, filter: source => !fs.lstatSync(source).isSymbolicLink() && path.basename(source) !== '.DS_Store'});
}
console.log(JSON.stringify({success: true, skills: args.length ? [...PUBLIC_SKILLS] : ['solopi-desktop-cli']}));
