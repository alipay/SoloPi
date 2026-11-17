import {test} from 'node:test';import assert from 'node:assert/strict';import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{interval,summarize}=require('../electron/agent/receipt-timing'),{taskResultReceipt}=require('../electron/task-case-query');
test('receipt arithmetic preserves UTC offsets and excludes only contained actual execution',()=>{
 const result=summarize({startedAt:'2026-11-16T01:34:38+08:00',finishedAt:'2026-11-15T18:02:19.766Z',executionStartedAt:'2026-11-15T17:49:08.234Z',executionFinishedAt:'2026-11-15T17:52:25.424Z'});
 assert.equal(result.total.durationMs,1661766);assert.equal(result.device.durationMs,197190);assert.equal(result.nonExecutionMs,1464576);
});
test('missing, reversed or timezone-free timestamps stay unknown and cannot fabricate durations',()=>{
 for(const pair of [[null,null],['2026-11-16 01:00:00','2026-11-16 02:00:00'],[200,100],['bad','bad']])assert.equal(interval(...pair).durationMs,null);
 assert.equal(summarize({startedAt:10,finishedAt:20,executionStartedAt:0,executionFinishedAt:15}).nonExecutionMs,null);
});
test('native task result shares exact timing in CLI and Agent receipts without treating query success as business success',()=>{
 const receipt=taskResultReceipt({id:'actual',status:'failed',startedAt:'2026-11-15T17:49:08.234Z',finishedAt:'2026-11-15T17:52:25.424Z',cases:[]});assert.equal(receipt.timing.durationMs,197190);assert.equal(receipt.status,'failed');assert.equal(receipt.successScope,'query');
});
