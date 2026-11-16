import test from 'node:test';
import assert from 'node:assert/strict';
import {auditQuickActionTemplates} from '../scripts/audit-quick-action-templates.mjs';
test('audit detects legacy contexts in source defaults, saved configuration and overrides without mutating definitions',()=>{
 const a={inputs:[{key:'serial',defaultValue:'{{glassSerial}}'}],configuredInputs:[{key:'serial',defaultValue:'{{glassPackage}}'}],inputOverrides:{serial:{defaultValue:'{{glassSerial}}'}}};const before=JSON.stringify(a);
 assert.deepEqual(auditQuickActionTemplates(a).map(i=>i.variable),['glassSerial','glassPackage','glassSerial']);assert.equal(JSON.stringify(a),before);
});
test('audit covers execution, query, start, stop and export templates and missing input references',()=>{
 const a={inputs:[{key:'serial'}],args:['{{glassSerial}}'],argsOverride:['{{inputs.missing}}'],queryConfig:{args:['{{glassPackage}}']},sessionConfig:{startArgs:['{{glassSerial}}'],stopArgs:['{{glassSerial}}'],exportArgs:['{{inputs.absent}}']}};
 const issues=auditQuickActionTemplates(a);assert.equal(issues.length,6);assert.deepEqual(issues.filter(i=>i.reason==='unknown-input').map(i=>i.variable),['inputs.missing','inputs.absent']);
});
test('custom script input names and business enums remain valid when they bind current context',()=>{
 const a={inputs:[{key:'glassSerial',defaultValue:'{{glassesSerial}}'},{key:'target',defaultValue:'glass'},{key:'pkg',defaultValue:'{{glassesPackage}}'}],args:['{{inputs.glassSerial}}','{{inputs.target}}','{{inputs.pkg}}','{{phoneSerial}}','{{phonePackage}}','{{adbPath}}','{{outputDir}}','{{appDataDir}}','{{platform}}','{{arch}}','{{resourcesDir}}']};assert.deepEqual(auditQuickActionTemplates(a),[]);
});
test('each configured input list is validated with its own keys rather than hiding dangling overrides',()=>{
 const a={inputs:[{key:'one',defaultValue:''}],configuredInputs:[{key:'two',defaultValue:'{{inputs.one}}'}]};assert.equal(auditQuickActionTemplates(a)[0].variable,'inputs.one');
});
