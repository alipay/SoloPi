#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills/solopi-desktop-cli');
function walk(directory) {
  for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
    const file = path.join(directory, entry.name);
    if (entry.isSymbolicLink()) throw Error('Skill must be self-contained: ' + file);
    if (entry.isDirectory()) {walk(file); continue;}
    if (!entry.name.endsWith('.md')) continue;
    const content = fs.readFileSync(file, 'utf8');
    if (entry.name === 'SKILL.md' && !/^---\nname: solopi-desktop-cli\ndescription: [^\n]+\n/.test(content)) throw Error('Invalid CLI Skill frontmatter');
    for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
      const href = decodeURIComponent(match[1]).split('#')[0];
      if (!href || /^(https?:|mailto:)/.test(href)) continue;
      const target = path.resolve(path.dirname(file), href);
      if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) throw Error('Invalid Skill reference: ' + file + ' -> ' + href);
    }
  }
}
walk(root);
console.log(JSON.stringify({success: true, skills: ['solopi-desktop-cli']}));
