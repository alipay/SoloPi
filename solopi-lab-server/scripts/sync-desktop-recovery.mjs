import {readFileSync,writeFileSync,mkdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname,join,relative,isAbsolute,sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'../src/desktop-agent');
const source=realpathSync(resolve(process.env.SOLOPI_DESKTOP_SOURCE||(existsSync(new URL('../../electron/agent/',import.meta.url))?fileURLToPath(new URL('../../',import.meta.url)):fileURLToPath(new URL('../../solopi-desktop/',import.meta.url))),'electron/agent'));
const files=['model-capacity.js','workspace-policy.js','host-lifecycle.js','diagnostic-fields.js','stream-projection.js','task-continuation.js','mcp.js','provider-registration.mjs','operation-receipts.js','tool-outcome.js','receipt-tools.js','continuation-memory.js','context.js','request-policy.js','request-deadline.js','bounded-summary.js','harness-request-control.mjs','harness-request-recovery.js','context-receipts.js','skill-context.js','harness-host.mjs','harness-progress-policy.mjs','model-transport-trace.js','upstream-diagnostics.js','evidence-projection.js','model-failure.mjs','local-runtime.cjs','runtime-registry.cjs','deepseek-compaction.mjs','usage-anchor.js','reasoning.js','summary-deadline.js','duplicate-results.js','virtual-observation-context.js','antcc-models.cjs'];
const supportFiles=['diagnostics.js','product-identity.js','report-performance-diagnostics.js'];
const catalogBoundary=Buffer.from("// Host catalog boundary; the shared Desktop runtime transport is unchanged.\nmodule.exports=require('../runtime-model-catalog.cjs');\n");
const packaged=(name,bytes)=>name==='antcc-models.cjs'?catalogBoundary:bytes;
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const supportBytes=(name,bytes)=>name==='diagnostics.js'?Buffer.from(bytes.toString().replaceAll("'./agent/","'./desktop-agent/")):bytes;
// Copy the actual relative dependency closure as well as the public entry set.
// This is a build-time inventory; modules are resolved, never executed here.
const selected=new Set(files),pending=[...files.filter(f=>f!=='antcc-models.cjs'),...supportFiles.map(f=>'../'+f)];
const visited=new Set();
while(pending.length) {
  const name=pending.pop();if(visited.has(name))continue;visited.add(name);
  const file=join(source,name),text=readFileSync(file,'utf8');
  for(const match of text.matchAll(/(?:\brequire\s*\(\s*|\bfrom\s+|\bimport\s*\(\s*)['"](\.{1,2}\/[^'"]+)['"]/g)) {
    const target=createRequire(file).resolve(match[1]);
    const local=relative(source,target);
    if(!isAbsolute(local)&&local!=='..'&&!local.startsWith('..'+sep)) {
      const name=local.split(sep).join('/');if(name==='antcc-models.cjs')continue;
      if(!selected.has(name)){selected.add(name);pending.push(name);}
    } else if(supportFiles.some(f=>target===join(source,'..',f))) {
      pending.push('../'+target.slice(dirname(source).length+1));
    } else throw Error('Shared runtime dependency outside its public boundary: '+name+' -> '+match[1]);
  }
}
const resolvedFiles=[...selected].sort();
mkdirSync(root,{recursive:true});
if(process.argv.includes('--check')) {
  const saved=JSON.parse(readFileSync(join(root,'SOURCE.json')));
  for(const f of saved.files) {
    const bytes=readFileSync(join(root,f.file));
    if(digest(bytes)!==f.sha256)throw Error('Packaged Harness drift: '+f.file);
    if(existsSync(join(source,f.file))&&!bytes.equals(packaged(f.file,readFileSync(join(source,f.file)))))throw Error('Desktop source drift: '+f.file);
  }
  for(const name of resolvedFiles)if(!saved.files.some(f=>f.file===name))throw Error('Shared runtime dependency missing: '+name);
  for(const name of supportFiles) {
    const savedFile=saved.supportFiles?.find(f=>f.file===name);
    const bytes=readFileSync(join(root,'..',name));
    if(!savedFile||digest(bytes)!==savedFile.sha256||!bytes.equals(supportBytes(name,readFileSync(join(source,'..',name)))))throw Error('Shared runtime support drift: '+name);
  }
  if(JSON.parse(readFileSync(join(root,'..','package.json'))).type!=='commonjs')throw Error('Shared CommonJS support package missing');
  process.exit(0);
}
const manifest=[];
for(const name of resolvedFiles) {
  const original=name==='antcc-models.cjs'?null:readFileSync(join(source,name));
  const data=packaged(name,original);mkdirSync(dirname(join(root,name)),{recursive:true});writeFileSync(join(root,name),data);
  manifest.push({file:name,sha256:digest(data),...(name==='antcc-models.cjs'?{boundary:'host-model-catalog'}:{})});
}
const support=[];
for(const name of supportFiles) {
  const original=readFileSync(join(source,'..',name)),bytes=supportBytes(name,original);
  writeFileSync(join(root,'..',name),bytes);
  support.push({file:name,sha256:digest(bytes),sourceSha256:digest(original),...(name==='diagnostics.js'?{boundary:'server-diagnostic-imports'}:{})});
}
// Server entry modules are .mjs/.cjs; preserve shared CommonJS support semantics.
writeFileSync(join(root,'..','package.json'),JSON.stringify({private:true,type:'commonjs'})+'\n');
writeFileSync(join(root,'package.json'),JSON.stringify({private:true,type:'commonjs'}));
writeFileSync(join(root,'SOURCE.json'),JSON.stringify({source:'electron/agent',files:manifest,supportFiles:support},null,2)+'\n');
