import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
export function verifyRetiredAppUpdate(read){
 for(const file of ['electron/main.js','electron/preload.js','dist/bundle.js']){
  if(/app-update:|app-update-debug:|autoUpdater|SoftwareUpdateSettings|AppUpdatePrompt|UpdateInterfaceDebugger/.test(String(read(file))))throw Error(`Retired application updater remains in ${file}`);
 }
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
 verifyRetiredAppUpdate(file=>fs.readFileSync(path.join(root,file)));console.log('Application updater absent from backend, preload and renderer bundle');
}
