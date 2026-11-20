'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {createWorkflowExecutionGate}=require('../workflow-execution-gate');
test('two website captures borrow live group lease; closing one preserves parent and the other',()=>{
 const gate=createWorkflowExecutionGate(),parent=gate.acquire({id:'native-task',reservedDeviceSerials:['phone','glasses']}),phone=parent.observe({id:'phone-view',reservedDeviceSerials:['phone']}),glasses=parent.observe({id:'glasses-view',reservedDeviceSerials:['glasses']});
 phone.release();assert.throws(()=>gate.acquire({id:'writer',reservedDeviceSerials:['phone']}),{code:'TEST_TASK_BUSY'});assert.throws(()=>gate.acquire({id:'writer',reservedDeviceSerials:['glasses']}),{code:'TEST_TASK_BUSY'});
 parent.release();assert.throws(()=>gate.acquire({id:'writer',reservedDeviceSerials:['glasses']}),{code:'TEST_TASK_BUSY'});const next=gate.acquire({id:'other',reservedDeviceSerials:['phone']});next.release();glasses.release();gate.acquire({id:'writer',reservedDeviceSerials:['glasses']}).release();
});
test('stale parent, foreign devices, duplicate observer and public readOnly flag cannot gain ownership',()=>{
 const gate=createWorkflowExecutionGate(),parent=gate.acquire({id:'task',reservedDeviceSerials:['phone']});assert.throws(()=>gate.acquire({id:'forged',readOnly:true,reservedDeviceSerials:['phone']}),{code:'TEST_TASK_BUSY'});
 for(const serials of [[],['foreign'],['phone','phone']])assert.throws(()=>parent.observe({id:'view',reservedDeviceSerials:serials}),{code:'OBSERVER_LEASE_INVALID'});
 const child=parent.observe({id:'view',reservedDeviceSerials:['phone']});assert.equal(child.observe,undefined);assert.throws(()=>parent.observe({id:'view',reservedDeviceSerials:['phone']}),{code:'OBSERVER_LEASE_INVALID'});parent.release();assert.throws(()=>parent.observe({id:'new',reservedDeviceSerials:['phone']}),{code:'OBSERVER_LEASE_INVALID'});child.release();
});
