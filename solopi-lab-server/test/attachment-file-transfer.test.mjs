import {test} from 'node:test';import assert from 'node:assert/strict';import {DatabaseSync} from 'node:sqlite';
import {mkdtempSync,readFileSync,writeFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {MessageAttachments} from '../src/message-attachments.mjs';
function setup(t){const directory=mkdtempSync(join(tmpdir(),'attachment-')),db=new DatabaseSync(':memory:');t.after(()=>{db.close();rmSync(directory,{recursive:true,force:true});});return{directory,db,store:new MessageAttachments(db,directory)};}
test('generic files retain exact bytes, deduplicate uploads and expose readable workspace paths',t=>{
 const {directory,store}=setup(t),bytes=Buffer.from('原始需求\n保留字节\r\n'),input={name:'demand.txt',mime:'text/plain',data:bytes.toString('base64')};
 const a=store.upload('c',input);assert.equal(store.upload('c',input).id,a.id);const [file]=store.model('c',[a.id],{workspace:join(directory,'workspace')});assert.deepEqual(readFileSync(file.path),bytes);assert.ok(file.path.startsWith(join(directory,'workspace','attachments')));assert.equal(file.mime,'text/plain');assert.equal(file.size,bytes.length);assert.equal(JSON.stringify(file).includes(bytes.toString()),false);assert.equal(JSON.stringify(file).includes(input.data),false);assert.equal(file.data,undefined);assert.equal(file.content,undefined);assert.equal(store.model('c',[a.id],{workspace:join(directory,'workspace')})[0].path,file.path);assert.throws(()=>store.model('other',[a.id]),e=>e.code==='ATTACHMENT_NOT_FOUND');
});
test('unsupported or disguised image content remains rejected and tampering fails integrity checks',t=>{
 const {directory,store}=setup(t);assert.throws(()=>store.upload('c',{name:'fake.png',mime:'image/png',data:Buffer.from('text').toString('base64')}),e=>e.code==='ATTACHMENT_INVALID');
 const a=store.upload('c',{name:'raw.bin',mime:'application/octet-stream',data:Buffer.from([0,1,2]).toString('base64')});writeFileSync(join(directory,'attachments',a.id),'changed');assert.throws(()=>store.model('c',[a.id]),e=>e.code==='ATTACHMENT_CORRUPT');
});
