import fs from 'node:fs';
import path from 'node:path';

// Check the actual files shipped by the extraResources filter, not merely its configuration.
export function verifyPackagedHarness(sourceRoot, resourcesRoot) {
  const required = [];
  function visit(directory, relative = '') {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.name === '__pycache__') continue;
      const name = path.join(relative, entry.name);
      if (entry.isDirectory()) visit(path.join(directory, entry.name), name);
      else if (entry.isFile() && (name.endsWith('.py') || name.split(path.sep).includes('resources'))) required.push(name);
    }
  }
  visit(sourceRoot);
  for (const entry of ['solopi_harness/desktop_control.py', 'solopi_harness/virtual_desktop.py']) {
    if (!required.includes(entry.split('/').join(path.sep))) throw Error(`Harness source missing: ${entry}`);
  }
  for (const name of required) {
    const target = path.join(resourcesRoot, 'harness', name);
    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) throw Error(`Packaged Harness missing: ${name}`);
    if (!fs.readFileSync(target).equals(fs.readFileSync(path.join(sourceRoot, name)))) {
      throw Error(`Packaged Harness differs from source: ${name}`);
    }
  }
  return { checkedFiles: required.length };
}
