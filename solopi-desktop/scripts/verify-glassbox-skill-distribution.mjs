#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {PUBLIC_SKILLS, PUBLIC_SKILL_PRIVATE_CONTENT} from './export-public-source.mjs';
const defaultRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../skills');

export function verifyPublicSkills(skillsRoot = defaultRoot) {
  for (const name of PUBLIC_SKILLS) {
    const root = path.resolve(skillsRoot, name);
    if (fs.existsSync(root) && fs.lstatSync(root).isSymbolicLink()) throw Error('Skill must be self-contained: ' + root);
    if (!fs.existsSync(path.join(root, 'SKILL.md'))) throw Error('Missing public Skill: ' + name);
    function walk(directory) {
      for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const file = path.join(directory, entry.name);
        if (entry.isSymbolicLink()) throw Error('Skill must be self-contained: ' + file);
        if (entry.isDirectory()) {walk(file); continue;}
        const content = fs.readFileSync(file, 'utf8');
        if (PUBLIC_SKILL_PRIVATE_CONTENT.test(content)) throw Error('Private content candidate in public Skill: ' + path.relative(skillsRoot, file));
        if (entry.name === 'SKILL.md' && !content.startsWith('---\nname: ' + name + '\ndescription: ')) throw Error('Invalid Skill frontmatter: ' + name);
        if (!entry.name.endsWith('.md')) continue;
        for (const match of content.matchAll(/\[[^\]]*\]\(([^)\s]+)\)/g)) {
          const href = decodeURIComponent(match[1]).split('#')[0];
          if (!href || /^(https?:|mailto:)/.test(href)) continue;
          const target = path.resolve(path.dirname(file), href);
          if (!target.startsWith(root + path.sep) || !fs.existsSync(target)) throw Error('Invalid Skill reference: ' + file + ' -> ' + href);
        }
      }
    }
    walk(root);
  }
  return {success: true, skills: [...PUBLIC_SKILLS]};
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(JSON.stringify(verifyPublicSkills(process.argv[2])));
