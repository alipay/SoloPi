import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
export function verifySoloPiRuntime(root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../resources/solopi-recording')) {
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'manifest.json'),'utf8'));
 if(manifest.packageName!=='com.alipay.hulu'||manifest.file!=='SoloPi.apk'||!Number.isSafeInteger(manifest.versionCode)||!/^https:\/\/github\.com\/alipay\/SoloPi\/releases\/download\//.test(manifest.source))throw Error('Invalid built-in SoloPi manifest');
 if(createHash('sha256').update(fs.readFileSync(path.join(root,'SoloPi.apk'))).digest('hex')!==manifest.sha256)throw Error('Bundled SoloPi APK checksum mismatch');
 for(const file of ['LICENSE.txt','NOTICE.md'])if(!fs.statSync(path.join(root,file)).size)throw Error('Missing SoloPi attribution');
 return {version:manifest.versionName,packageName:manifest.packageName,sha256:manifest.sha256};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(verifySoloPiRuntime(process.argv[2])));
