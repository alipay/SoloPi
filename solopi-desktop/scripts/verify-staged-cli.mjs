import fs from 'node:fs';
import path from 'node:path';
export function verifyStagedCliFile(resources, root, name) {
  const staged=fs.readFileSync(path.join(root,'build','packaged-cli',name));
  const packaged=fs.readFileSync(path.join(resources,'cli',name));
  if (!packaged.equals(staged)) throw Error(`Packaged CLI differs from pre-sign build: ${name}`);
}
