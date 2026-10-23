import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import {listPublicFiles} from './export-public-source.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceModulePath = path.join(root, 'electron', 'adb-error.js');
const stagedModulePath = path.join(root, 'build', 'packaged-cli', 'adb-error.cjs');
const taskEventsSourcePath = path.join(root, 'electron', 'workflow-task-events.js');
const taskEventsStagedPath = path.join(root, 'build', 'packaged-cli', 'workflow-task-events.cjs');

if (!fs.existsSync(sourceModulePath)) {
  throw new Error(`CLI ADB source module is missing: ${sourceModulePath}`);
}

fs.mkdirSync(path.dirname(stagedModulePath), { recursive: true });
const pkg = JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8'));
const sourceHash = crypto.createHash('sha256');
for (const name of listPublicFiles(root)) sourceHash.update(name).update('\0').update(fs.readFileSync(path.join(root,name))).update('\0');
fs.writeFileSync(path.join(root,'build/packaged-cli/runtime-build.json'),JSON.stringify({version:pkg.version,electronVersion:pkg.devDependencies.electron,sourceSha256:sourceHash.digest('hex'),packaged:true},null,2)+'\n');
fs.copyFileSync(sourceModulePath, stagedModulePath);
fs.copyFileSync(path.join(root,'electron/background-runtime.js'),path.join(root,'build/packaged-cli/background-runtime.cjs'));
fs.copyFileSync(taskEventsSourcePath, taskEventsStagedPath);
console.log(`prepared pre-sign CLI ADB module: ${stagedModulePath}`);
console.log(`prepared pre-sign CLI task events module: ${taskEventsStagedPath}`);

fs.copyFileSync(path.join(root, 'electron', 'development-tasks.js'), path.join(root, 'build', 'packaged-cli', 'development-tasks.cjs'));
fs.copyFileSync(path.join(root, 'electron', 'task-visibility.js'), path.join(root, 'build', 'packaged-cli', 'task-visibility.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'android-top.js'), path.join(root, 'build', 'packaged-cli', 'android-top.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'workflow-performance.js'), path.join(root, 'build', 'packaged-cli', 'workflow-performance.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'performance-battery.js'), path.join(root, 'build', 'packaged-cli', 'performance-battery.cjs'));
fs.copyFileSync(path.join(root, 'electron', 'workflow-log-text.js'), path.join(root, 'build', 'packaged-cli', 'workflow-log-text.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'diagnostics.js'), path.join(root, 'build', 'packaged-cli', 'diagnostics.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'workflow-log-diagnostics.js'), path.join(root, 'build', 'packaged-cli', 'workflow-log-diagnostics.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'git-runtime.js'), path.join(root, 'build', 'packaged-cli', 'git-runtime.cjs'));

// Bundle the Node-only configuration service and its shared validators for CLI use
// outside app.asar, with no Electron/desktop runtime dependency.
const { createRequire } = await import('node:module');
const webpack = createRequire(import.meta.url)('webpack');
await new Promise((resolve, reject) => {
  webpack({ mode:'production', target:'node', entry:path.join(root,'electron','headless-configuration.js'),
    devtool:false, optimization:{minimize:false}, externalsPresets:{node:true},
    output:{path:path.join(root,'build','packaged-cli'),filename:'headless-configuration.cjs',library:{type:'commonjs2'}} },
    (error,stats)=>error||stats.hasErrors()?reject(error||Error(stats.toString({all:false,errors:true}))):resolve());
});
fs.copyFileSync(path.join(root, 'electron', 'task-case-query.js'), path.join(root, 'build', 'packaged-cli', 'task-case-query.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'product-identity.js'), path.join(root, 'build', 'packaged-cli', 'product-identity.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'solopi-case-converter.js'), path.join(root, 'build', 'packaged-cli', 'solopi-case-converter.cjs'));

fs.copyFileSync(path.join(root, 'electron', 'solopi-native-case.js'), path.join(root, 'build', 'packaged-cli', 'solopi-native-case.js'));
fs.copyFileSync(path.join(root, 'electron', 'solopi-native-schema.js'), path.join(root, 'build', 'packaged-cli', 'solopi-native-schema.js'));

for(const name of ['case-selection','case-discovery','selection-receipt','case-scope-summary'])fs.writeFileSync(path.join(root,'build','packaged-cli',name+'.cjs'),fs.readFileSync(path.join(root,'electron','agent',name+'.js'),'utf8').replace("require('./case-discovery')","require('./case-discovery.cjs')").replaceAll("require('./selection-receipt')","require('./selection-receipt.cjs')").replaceAll("require('./case-scope-summary')","require('./case-scope-summary.cjs')"));

fs.copyFileSync(path.join(root,'electron/task-device-selection.js'),path.join(root,'build/packaged-cli/task-device-selection.cjs'));

fs.copyFileSync(path.join(root,'electron/workflow-failure-policy.js'),path.join(root,'build/packaged-cli/workflow-failure-policy.cjs'));
