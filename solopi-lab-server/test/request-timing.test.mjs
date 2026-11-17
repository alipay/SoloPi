import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {installRequestTiming,requestTiming} from '../src/request-timing.mjs';
function setup(t){const db=new DatabaseSync(':memory:');t.after(()=>db.close());db.exec(`CREATE TABLE sa_message(id TEXT PRIMARY KEY,conversation_id TEXT,status TEXT,parent_message_id TEXT,source_kind TEXT);CREATE TABLE sa_call(id TEXT PRIMARY KEY,message_id TEXT,name TEXT,status TEXT,result_json TEXT);INSERT INTO sa_message VALUES('old','c','succeeded',NULL,'user');`);installRequestTiming(db);installRequestTiming(db);return db;}
const message=(db,id,parent=null)=>db.prepare('INSERT INTO sa_message(id,conversation_id,status,parent_message_id,source_kind) VALUES(?,?,?,?,?)').run(id,'c','running',parent,parent?'platform':'user');
test('real protocol transitions record millisecond endpoints; historical and unfinished spans stay unknown',t=>{
 const db=setup(t);assert.equal(requestTiming(db,'c','old').durationMs,null);
 const before=Date.now();message(db,'new');db.prepare('INSERT INTO sa_call(id,message_id,name,status) VALUES(?,?,?,?)').run('call','new','write_work_file','running');
 let x=requestTiming(db,'c','new');assert.equal(x.finishedAt,null);assert.equal(x.complete,false);assert.equal(x.calls[0].durationMs,null);
 db.prepare('UPDATE sa_call SET status=?,result_json=? WHERE id=?').run('done',JSON.stringify({path:'plan.md',sha256:'actual-sha',writtenAt:new Date().toISOString()}),'call');db.prepare("UPDATE sa_message SET status='succeeded' WHERE id='new'").run();
 x=requestTiming(db,'c','new');assert.ok(Date.parse(x.startedAt)>=before);assert.ok(x.durationMs>=0);assert.equal(x.complete,true);assert.equal(x.calls[0].artifact.path,'plan.md');assert.ok(x.calls[0].durationMs>=0);
});
test('continuations share the original timeline; another human request cannot leak into it',t=>{
 const db=setup(t);message(db,'root');message(db,'child','root');message(db,'other');
 for(const [id,msg,name] of [['a','root','write_work_file'],['b','child','client_read'],['private','other','other-request']])db.prepare('INSERT INTO sa_call(id,message_id,name,status) VALUES(?,?,?,?)').run(id,msg,name,'running');
 const result=requestTiming(db,'c','child',{offset:0,limit:1});assert.equal(result.requestId,'root');assert.equal(result.totalCalls,2);assert.equal(result.nextOffset,1);assert.deepEqual(result.calls.map(c=>c.receiptId),['a']);
 assert.deepEqual(requestTiming(db,'c','child',{names:['client_read']}).calls.map(c=>c.receiptId),['b']);
 assert.ok(!JSON.stringify(result).includes('other-request'));
});

test('timing pages fit the shared result budget without dropping receipt identities',t=>{
 const db=setup(t);message(db,'root');
 for(let i=0;i<40;i++){const id='receipt-'+String(i).padStart(3,'0')+'a'.repeat(64);db.prepare('INSERT INTO sa_call(id,message_id,name,status,result_json) VALUES(?,?,?,?,?)').run(id,'root','write_work_file','running',JSON.stringify({path:'drafts/'+('long-path-'.repeat(15))+i,sha256:'b'.repeat(64),writtenAt:new Date().toISOString()}));db.prepare("UPDATE sa_call SET status='done' WHERE id=?").run(id);}
 let offset=0;const ids=[];do{const page=requestTiming(db,'c','root',{offset,limit:20});assert.ok(JSON.stringify(page).length<=5500);ids.push(...page.calls.map(c=>c.receiptId));offset=page.nextOffset;}while(offset!==null);
 assert.equal(ids.length,40);assert.equal(new Set(ids).size,40);
});
