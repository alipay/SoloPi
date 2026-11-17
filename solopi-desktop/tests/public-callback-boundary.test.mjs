import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import {isPublicSourceFile, checkPublicFile, listPublicFiles, exportPublicSource,publicSourcePath} from '../scripts/export-public-source.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
test('public distribution rejects legacy platform adapters and renamed script copies',()=>{
 assert.equal(isPublicSourceFile('scripts/callbacks/antmultica.cjs'),false);
 assert.equal(isPublicSourceFile('.private-local/entry-adapters/antmultica/callback.cjs'),false);
 assert.equal(isPublicSourceFile('scripts/callbacks/http-command-receiver.cjs'),true);
 assert.throws(()=>checkPublicFile('scripts/callbacks/renamed.cjs',Buffer.from("require('child_process').spawnSync('multica', [])")),/Private platform dependency/);
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'callback-export-'));
 try {fs.mkdirSync(path.join(dir,'scripts'),{recursive:true});fs.writeFileSync(path.join(dir,'scripts/renamed.cjs'),"require('child_process').spawnSync('multica', [])");assert.throws(()=>exportPublicSource(path.join(dir,'out'),dir),/Private platform dependency/);assert.equal(fs.existsSync(path.join(dir,'out')),false);} finally {fs.rmSync(dir,{recursive:true,force:true});}
 assert.ok(!listPublicFiles(root).some(f=>/antmultica/i.test(f)));
});
test('coordinator public package and examples have no private platform dependency',()=>{
 const base=publicSourcePath(root,'integrations/solopi-lab/');
 const scan=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(e.name==='__pycache__'||e.name.startsWith('.'))continue;const p=path.join(d,e.name);if(e.isDirectory())scan(p);else if(/\.(py|toml|json|md)$/.test(e.name))assert.doesNotMatch(fs.readFileSync(p,'utf8'),/antmultica|\bmultica\b/i,p);}};scan(base);
 const config=JSON.parse(fs.readFileSync(path.join(base,'examples/coordinator.json'))),req=JSON.parse(fs.readFileSync(path.join(base,'examples/request.json')));
 assert.ok(config.targets[req.target]);assert.ok(config.credentials[0].targets.includes(req.target));
 assert.equal(config.targets[req.target].tokenEnv,'LAB_CALLBACK_SECRET');
});
test('Desktop execution and callback dispatcher never load an entry adapter',()=>{
 for(const name of ['electron/main.js','electron/task-callbacks.js','scripts/glassbox-cli.mjs'])assert.doesNotMatch(fs.readFileSync(path.join(root,name),'utf8'),/antmultica|\bmultica\b/i,name);
 assert.equal(fs.existsSync(path.join(root,'scripts/callbacks/antmultica.cjs')),false);
});
