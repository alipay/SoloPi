import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Build/artifact boundary check; this never inspects or routes Agent messages.
export function verifyRetiredCapturePage(read) {
  for (const file of ['electron/main.js', 'electron/preload.js', 'dist/bundle.js']) {
    const content = String(read(file));
    if (/adb:prepare-mock-page|MockPage|抓包与\s*(?:MOCK|Mock|mock)/u.test(content)) {
      throw new Error(`Retired capture page is still present in ${file}`);
    }
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  verifyRetiredCapturePage(file => fs.readFileSync(path.join(root, file), 'utf8'));
  console.log('Retired capture page: absent from backend, preload and renderer bundle');
}
