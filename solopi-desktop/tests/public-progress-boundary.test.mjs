import {test} from 'node:test';import assert from 'node:assert/strict';import {readFileSync,mkdtempSync,mkdirSync,writeFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {checkPublicFile,isPublicSourceFile,exportPublicSource,publicSourcePath,sourceRoot} from '../scripts/export-public-source.mjs';
test('progress and file transfer stay generic and contain no private entry or file service dependency',()=>{
 for(const file of ['lab-server/src/request-timing.mjs','lab-server/src/superagent-host-capabilities.mjs','lab-server/src/tool-contract-examples.mjs','lab-server/src/client-result-view.mjs','lab-server/src/message-attachments.mjs','electron/agent/receipt-timing.js','electron/cluster-client/lab-client.cjs']){
  const source=readFileSync(publicSourcePath(sourceRoot,file),'utf8');assert.doesNotMatch(source,/\b(?:antmultica|afts)\b|(?:alipayobjects\.com|alipay\.com|antfin\.com)/i,file);checkPublicFile(file,source);assert.equal(isPublicSourceFile(file),true,file);
 }
 for(const file of ['private-skills/superagent-test-lifecycle/SKILL.md','artifacts/wear414-path-fix-20261116/superagent_client.py','artifacts/wear414-path-fix-20261116/client-upload.json'])assert.equal(isPublicSourceFile(file),false,file);
});

test('private providers cannot enter public runtime or dependency manifests even without internal URLs',t=>{
 const root=mkdtempSync(join(tmpdir(),'public-provider-boundary-'));t.after(()=>rmSync(root,{recursive:true,force:true}));
 for(const [file,source] of [['electron/transfer.js',"require('afts-sdk')"],['electron/private-storage.js',"process.env.COMPANY_AFTS_UPLOAD_URL"],['lab-server/src/entry.mjs',"import adapter from 'antmultica';"],['scripts/publish.mjs',"execFile('multica',args)"],['package.json',JSON.stringify({dependencies:{'afts-sdk':'1.0.0'}})],['skills/solopi-desktop-cli/SKILL.md','Use AFTS to upload files.']]){
  const path=join(root,file);mkdirSync(join(path,'..'),{recursive:true});writeFileSync(path,source);
  const out=join(root,'out');assert.throws(()=>exportPublicSource(out,root),/Private (?:platform dependency|content candidate)/,file);assert.equal(existsSync(out),false);rmSync(path);
 }
 for(const file of ['electron/afts/upload.js','integrations/solopi-lab/solopi_lab/antmultica.py','scripts/multica-relay.mjs'])assert.equal(isPublicSourceFile(file),false,file);
});
test('configured standard HTTP storage remains exportable without enterprise providers',()=>{
 checkPublicFile('lab-server/src/storage.mjs',"const endpoint = process.env.ATTACHMENT_ENDPOINT; export const upload = (body) => fetch(endpoint, {method:'POST',body});");
});

test('public package carries regressions for file transfer, tool examples and receipt timing',()=>{
 for(const file of ['tests/public-progress-boundary.test.mjs','tests/receipt-timing.test.mjs','lab-server/test/attachment-file-transfer.test.mjs','lab-server/test/client-result-failures.test.mjs','lab-server/test/tool-contract-examples.test.mjs','lab-server/test/lab-platform.test.mjs'])assert.equal(isPublicSourceFile(file),true,file);
});

test('public guidance uses configured runtime IDs and generic issue registration',()=>{
 for(const file of ['docs/agent/glassbox-cli-usage.md','skills/solopi-desktop-cli/references/cli-services.md','integrations/solopi-lab/agent-instructions.md'])assert.doesNotMatch(readFileSync(publicSourcePath(sourceRoot,file),'utf8'),/antcc|antcodex|codefuse|dima|伙伴提测/i,file);
 assert.match(readFileSync('skills/solopi-desktop-cli/references/cli-services.md','utf8'),/discover返回的运行时ID/);
});
