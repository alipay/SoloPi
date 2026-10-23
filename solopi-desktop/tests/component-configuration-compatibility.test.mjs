import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const directory=fs.mkdtempSync(path.join(os.tmpdir(),'component-compat-'));
process.env.GLASSBOX_WORKFLOW_STATE_PATH=path.join(directory,'state.json');
fs.writeFileSync(process.env.GLASSBOX_WORKFLOW_STATE_PATH,JSON.stringify({cases:[],components:[]}));
const cli=await import('../scripts/glassbox-cli.mjs');
const {collectRequiredDeviceRoles,resolveTaskDevices}=require('../electron/task-device-selection');
function fixture(kind='audio',id='fixture-component') {
 const component={id,name:'fixture',kind,device:'phone',commandTemplate:'adb -s {{serial}} shell am broadcast -a {{action}}',params:[{key:'action',defaultValue:'fixture.ACTION'}]};
 const c={schemaVersion:'glassbox.workflow.v1',id:'fixture',name:'fixture',reviewStatus:'draft',tags:['draft','ai-generated'],defaults:{},components:[component],steps:[{id:'start',name:'start',type:'start',device:'phone'},{id:'work',name:'work',type:'component',componentId:id,device:'phone',inputs:{}},{id:'end',name:'end',type:'end',device:'phone'}]};
 return {c,component,step:c.steps[1]};
}
const validate=c=>cli.validateExecutableTaskSelectionForCli({cases:[JSON.parse(JSON.stringify(c))]});
test('required parameters use saved defaults while explicit empty overrides remain invalid',()=>{
 const f=fixture('adb');f.component.params[0].required=true;
 assert.equal(validate(f.c).success,true);
 f.step.inputs.action='';assert.equal(validate(f.c).success,false);
 for(const value of [0,false]){f.step.inputs.action=value;assert.equal(validate(f.c).success,true);}
});
for(const id of ['fixture-component','template-audio-input','component-send-confirm-audio'])test('audio action defaults and commandParams have runtime precedence: '+id,()=>{
 const f=fixture('audio',id);assert.equal(validate(f.c).success,true);
 f.step.inputs.action='';assert.ok(validate(f.c).validationErrors.some(e=>e.code==='AUDIO_BROADCAST_ACTION_MISSING'));
 f.step.inputs.commandParams=JSON.stringify({action:'fixture.OVERRIDE'});assert.equal(validate(f.c).success,true);
 f.step.inputs.commandParams=JSON.stringify({action:''});assert.equal(validate(f.c).success,false);
});
test('audio asset checks respect saved source type and saved local path defaults',()=>{
 const f=fixture();f.component.params.push({key:'sourceType',defaultValue:'tts'},{key:'localPath',defaultValue:path.join(directory,'missing.pcm')});
 assert.equal(validate(f.c).success,true);
 f.step.inputs.sourceType='file';assert.ok(validate(f.c).validationErrors.some(e=>e.code==='AUDIO_ASSET_NOT_FOUND'));
 const file=path.join(directory,'exists.pcm');fs.writeFileSync(file,'fixture');f.step.inputs.localPath=file;assert.equal(validate(f.c).success,true);
});
test('legacy send_audio validates silence before submission, including zero and runtime expressions',()=>{
 const f=fixture();f.step.type='send_audio';f.step.config={trailingSilenceMs:-1};assert.ok(validate(f.c).validationErrors.some(e=>e.code==='AUDIO_TRAILING_SILENCE_INVALID'));
 for(const value of [0,800,'${variables.silence}']){f.step.config.trailingSilenceMs=value;assert.equal(validate(f.c).success,true);}
});
for(const condition of ['variables.ok','nodeOutputs.previous.success','${variables.ok}','{{variables.ok}}','{{nodeOutputs.previous.success}}'])test('legacy and template IF conditions remain valid: '+condition,()=>{
 const f=fixture();f.step.type='if';f.step.config={condition,equals:true};assert.equal(validate(f.c).success,true);
});
for(const kind of ['adb','activity','audio','mobile_ui_action','mobile_ui_assert','tts_assert','json_assert','llm_assert'])test('CLI and broker honor phone node override over glasses component: '+kind,()=>{
 const f=fixture(kind);f.component.device='glasses';
 assert.deepEqual([...collectRequiredDeviceRoles({cases:[f.c]})],['phone']);
 assert.deepEqual([...cli.collectRequiredDeviceRolesForCli({cases:[f.c]})],['phone']);
 const result=resolveTaskDevices({cases:[f.c]},{phone:{serial:'fixture-phone'}},[{serial:'fixture-phone',state:'device'}]);
 assert.equal(result.devices.phone.serial,'fixture-phone');assert.equal(result.devices.glasses,undefined);
 f.step.device='glasses';f.component.device='phone';assert.deepEqual([...collectRequiredDeviceRoles({cases:[f.c]})],['glasses']);
});
test('partial case component overrides preserve inherited device parameters',()=>{
 const selection={components:[{id:'image',kind:'image_mock',params:[{key:'pushDevice',defaultValue:'phone'},{key:'commandDevice',defaultValue:'pc'}]}],cases:[{components:[{id:'image',params:[{key:'extra',defaultValue:'value'}]}],steps:[{id:'s',type:'component',componentId:'image',device:'phone'}]}]};
 assert.deepEqual([...collectRequiredDeviceRoles(selection)],['phone']);
});
test.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
