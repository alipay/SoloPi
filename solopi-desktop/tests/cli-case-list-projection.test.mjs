import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const cli=fileURLToPath(new URL('../scripts/glassbox-cli.mjs',import.meta.url));
test('case discovery returns library summaries without credentials or opaque configuration and never writes state',()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'solopi-case-list-'));
 try {
  const state={caseLibraries:[{id:'library',name:'Shared cases',repoUrl:'https://example.com/cases.git',gitBranch:'main',localRevision:'revision',autoUpdate:false,sshKeyPath:'/private/key',sshPassphrase:{__glassboxEncrypted:1,data:'opaque-credential'},token:'private-token',futureCredential:{secret:'private-secret'},localComponentIds:Array.from({length:500},(_,i)=>'component-'+i)}],caseFolders:[{id:'folder',name:'Examples',libraryId:'library'}],cases:[{id:'case',name:'Example',folderId:'folder',steps:[{id:'start',type:'start'},{id:'end',type:'end'}]}]};
  const file=path.join(dir,'workflow-editor-state.json');fs.writeFileSync(file,JSON.stringify(state));const before=fs.readFileSync(file);
  for(const options of [[],['--library','library']]) {
   const r=spawnSync(process.execPath,[cli,'cases','list',...options,'--json'],{encoding:'utf8',env:{...process.env,SOLOPI_DESKTOP_DATA_DIR:dir,GLASSBOX_CLI_DATA_DIR:dir,GLASSBOX_WORKFLOW_STATE_PATH:file}});
   assert.equal(r.status,0,r.stderr);const payload=JSON.parse(r.stdout);
   assert.equal(payload.total,1);assert.equal(payload.cases[0].libraryId,'library');
   assert.deepEqual(payload.libraries.filter(l=>l.id==='library'),[{id:'library',name:'Shared cases',repoUrl:'https://example.com/cases.git',branch:'main',gitBranch:'main',localRevision:'revision',autoUpdate:false}]);
   for(const secret of ['opaque-credential','private-token','private-secret','/private/key','component-499'])assert.equal(r.stdout.includes(secret),false);
  }
  assert.deepEqual(fs.readFileSync(file),before);
 } finally {fs.rmSync(dir,{recursive:true,force:true});}
});
