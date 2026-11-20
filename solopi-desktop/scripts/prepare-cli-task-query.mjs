import fs from 'node:fs';
import path from 'node:path';

const modules = [['electron/task-case-query.js', 'task-case-query.cjs'], ['electron/agent/receipt-timing.js', 'agent/receipt-timing.js']];
export function prepareCliTaskQuery(root, destination) {
  for (const [source, target] of modules) {
    const output = path.join(destination, target);
    fs.mkdirSync(path.dirname(output), {recursive:true});
    fs.copyFileSync(path.join(root, source), output);
  }
}
export function verifyCliTaskQuery(root, destination) {
  for (const [source, target] of modules) {
    if (!fs.readFileSync(path.join(destination, target)).equals(fs.readFileSync(path.join(root, source)))) {
      throw Error(`Packaged CLI module differs from source: ${target}`);
    }
  }
}
