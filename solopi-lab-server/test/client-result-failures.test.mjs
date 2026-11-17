import {test} from 'node:test';import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {clientResultView} from '../src/client-result-view.mjs';
test('large failed saves expose field errors and preserve exact original receipt',async t=>{
 const directory=mkdtempSync(join(tmpdir(),'failed-save-'));t.after(()=>rmSync(directory,{recursive:true,force:true}));
 const value={status:'failed',commandId:'same-id',payload:{args:{document:{steps:'x'.repeat(20000)}}},result:{success:false,validationErrors:[{path:'/schemaVersion',message:'required'},{path:'/libraryId',message:'unknown library'}]}};
 const view=await clientResultView(value,{directory});assert.equal(view.status,'failed');assert.deepEqual(view.failureSummary.details.validationErrors,value.result.validationErrors);assert.equal(view.failureSummary.detailsComplete,true);assert.deepEqual(JSON.parse(readFileSync(view.fullResultPath)),value);assert.ok(JSON.stringify(view).length<6000);
});
