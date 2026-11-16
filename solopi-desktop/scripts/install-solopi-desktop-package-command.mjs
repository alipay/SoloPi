#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const marker = '# solopi-desktop package command';
const quote = s => `'${s.replaceAll("'", "'\\''")}'`;
export function install({ home = os.homedir(), repository = root, identity = process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1 || '' } = {}) {
  identity = identity.trim().toUpperCase();
  if (!/^[A-F0-9]{40}$/.test(identity)) throw new Error('设置 GLASSBOX_CODESIGN_IDENTITY_SHA1 为完整的签名身份 SHA-1');
  const command = path.join(home, '.local/bin/solopi-desktop-package');
  const completion = path.join(home, '.local/share/zsh/site-functions/_solopi-desktop-package');
  const rc = path.join(home, '.zshrc');
  const start = `${marker} BEGIN`, end = `${marker} END`;
  const previous = fs.existsSync(rc) ? fs.readFileSync(rc, 'utf8') : '';
  const legacyMarker = previous.includes('# LensWiper package command BEGIN') ? '# LensWiper package command' : '# lenswiper package command';
  const legacyStart = `${legacyMarker} BEGIN`, legacyEnd = `${legacyMarker} END`;
  const currentBlock = previous.includes(start);
  const first = previous.indexOf(currentBlock ? start : legacyStart), last = previous.indexOf(currentBlock ? end : legacyEnd);
  const oldEndLength = (currentBlock ? end : legacyEnd).length;
  if ((first >= 0) !== (last >= 0) || (first >= 0 && last < first)) throw new Error('已有补全配置标记不完整，请检查 .zshrc');
  for (const target of [command, completion]) {
    if (fs.existsSync(target) && !fs.readFileSync(target, 'utf8').includes(marker)) throw new Error(`已有同名文件，未覆盖：${target}`);
  }
  const block = `${start}\nexport PATH="$HOME/.local/bin:$PATH"\nfpath=("$HOME/.local/share/zsh/site-functions" $fpath)\nif ! (( $+functions[compdef] )); then\n  autoload -Uz compinit\n  compinit\nfi\nautoload -Uz _solopi-desktop-package\ncompdef _solopi-desktop-package solopi-desktop-package\n${end}`;
  const next = first >= 0 ? previous.slice(0, first) + block + previous.slice(last + oldEndLength) : previous + (previous.endsWith('\n') ? '' : '\n') + '\n' + block + '\n';
  const wrapper = `#!/bin/sh\n${marker}\nset -eu\n: "\${GLASSBOX_CODESIGN_IDENTITY_SHA1:=${identity}}"\nexport GLASSBOX_CODESIGN_IDENTITY_SHA1\nexec /usr/bin/env node ${quote(path.join(repository, 'scripts/solopi-desktop-package.mjs'))} "$@"\n`;
  fs.mkdirSync(path.dirname(command), { recursive: true });
  fs.mkdirSync(path.dirname(completion), { recursive: true });
  fs.writeFileSync(command, wrapper, { mode: 0o755 }); fs.chmodSync(command, 0o755);
  fs.writeFileSync(completion, fs.readFileSync(path.join(repository, 'scripts/completions/_solopi-desktop-package')));
  fs.writeFileSync(rc, next, { mode: 0o600 });
  return { command, completion, shellConfig: rc };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { console.log(JSON.stringify(install(), null, 2)); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
