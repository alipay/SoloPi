import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {saveApiModel} from '../src/model-settings.mjs';
import {ServerSuperagent} from '../src/server-superagent.mjs';

for (const mode of ['catalog', 'legacy']) test(`${mode}: endpoint changes require an explicit key and preserve saved config on rejection`, t => {
  const directory = mkdtempSync(join(tmpdir(), 'model-credentials-'));
  t.after(() => rmSync(directory, {recursive:true,force:true}));
  const save = mode === 'catalog'
    ? input => saveApiModel(directory, {id:'fixture', ...input})
    : input => ServerSuperagent.prototype.configure.call({directory, modelStatus:()=>({})}, input);
  const initial = {baseUrl:'https://first.example/v1', model:'fixture', apiKey:'fixture-original'};
  save(initial);
  const before = readFileSync(join(directory,'model.json'),'utf8');
  for (const baseUrl of ['https://second.example/v1','http://first.example/v1','https://first.example/v2','https://first.example:8443/v1']) {
    assert.throws(() => save({baseUrl,model:'fixture'}), {code:'INVALID_MODEL_CONFIG'});
    assert.equal(readFileSync(join(directory,'model.json'),'utf8'), before);
  }
  save({baseUrl:initial.baseUrl+'/',model:'updated'});
  assert.equal(JSON.parse(readFileSync(join(directory,'model.json'))).apiKey,initial.apiKey);
  save({baseUrl:'https://second.example/v1',model:'fixture',apiKey:'fixture-new'});
  assert.equal(JSON.parse(readFileSync(join(directory,'model.json'))).apiKey,'fixture-new');
});
