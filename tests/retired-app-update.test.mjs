import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyRetiredAppUpdate} from '../scripts/verify-retired-app-update.mjs';
test('application updater has no executable entry, IPC or dependency',()=>{
 for(const file of ['electron/main.js','electron/preload.js','src/App.tsx','src/components/WorkflowEditor.tsx'])assert.doesNotMatch(fs.readFileSync(new URL('../'+file,import.meta.url),'utf8'),/app-update:|app-update-debug:|autoUpdater|appUpdate|SoftwareUpdateSettings|AppUpdatePrompt|UpdateInterfaceDebugger/);
 const pkg=JSON.parse(fs.readFileSync(new URL('../package.json',import.meta.url)));
 assert.equal(pkg.dependencies?.['electron-updater'],undefined);
 for(const file of ['electron/app-update.js','electron/direct-update-provider.js','src/components/AppUpdatePrompt.tsx','src/components/SoftwareUpdateSettings.tsx','src/components/UpdateInterfaceDebugger.tsx'])assert.equal(fs.existsSync(new URL('../'+file,import.meta.url)),false);
});
test('artifact gate rejects backend, preload and renderer update remnants',()=>{
 verifyRetiredAppUpdate(()=> 'ordinary code');
 for(const file of ['electron/main.js','electron/preload.js','dist/bundle.js'])assert.throws(()=>verifyRetiredAppUpdate(p=>p===file?'app-update:check':''),/updater remains/);
 for(const file of ['verify-packaged-app.mjs','verify-linux-package.mjs'])assert.match(fs.readFileSync(new URL('../scripts/'+file,import.meta.url),'utf8'),/verifyRetiredAppUpdate\(file/);
});
