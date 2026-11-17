// Verify every schema reference in the actual router, including versioned lazy routes.
import {readFileSync,existsSync} from 'node:fs';
import {dirname,resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
export function checkContractBundle(root=resolve(dirname(fileURLToPath(import.meta.url)),'../..')){
 const app=readFileSync(join(root,existsSync(join(root,'solopi-lab-server/src/app.mjs'))?'solopi-lab-server/src/app.mjs':'lab-server/src/app.mjs'),'utf8');
 const refs=[...new Set([...app.matchAll(/["'](v\d+\.\d+\.\d+)\/([\w.-]+\.schema\.json)#/g)].map(m=>'contracts/'+m[1]+'/schemas/'+m[2]))];
 const missing=refs.filter(ref=>!existsSync(join(existsSync(join(root,'solopi-lab-server/contracts'))?join(root,'solopi-lab-server'):root,ref)));
 if(missing.length)throw Object.assign(Error('部署合同文件缺失：'+missing.join(', ')),{code:'CONTRACT_BUNDLE_INCOMPLETE'});
 return {checked:refs.length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(checkContractBundle(process.argv[2])));
