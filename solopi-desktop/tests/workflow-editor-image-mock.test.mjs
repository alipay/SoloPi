import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const editorSource = fs.readFileSync(path.join(repoRoot, 'src/components/WorkflowEditor.tsx'), 'utf8');
const automationCaseSource = fs.readFileSync(path.join(repoRoot, 'src/lib/automationCase.ts'), 'utf8');
const electronSource = fs.readFileSync(path.join(repoRoot, 'electron/main.js'), 'utf8');

function extractFunction(source, name) {
  const start = source.indexOf(`async function ${name}`);
  assert.notEqual(start, -1, `${name} must exist`);
  const next = source.indexOf('\nasync function ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('editor keeps persisted explicit template-image-mock command while retaining generic factory fallback', () => {
  assert.match(editorSource, /components\.forEach\(\(component\) => mergedComponents\.set\(component\.id, mergeWorkflowComponent/);
  assert.match(editorSource, /defaultImageMockCommandTemplate/);
  assert.match(automationCaseSource, /id: 'component-image-mock'[\s\S]*?device: 'phone'/);
  assert.doesNotMatch(automationCaseSource, /ACTION_SCANPAY --es params/);
  assert.match(editorSource, /commandTemplate: component.commandTemplate \|\| ''/);
});

test('image mock execution keeps dual-device semantics and glasses app fallback path', () => {
  const executeImageMockStepSource = extractFunction(electronSource, 'executeImageMockStep');

  assert.match(executeImageMockStepSource, /normalizeImageMockDevice\(config\.pushDevice, 'glasses'\)/);
  assert.match(executeImageMockStepSource, /normalizeImageMockDevice\(config\.commandDevice, 'phone'\)/);
  assert.match(executeImageMockStepSource, /getImageMockDeviceSerial\(context, pushDevice, '图片推送'\)/);
  assert.match(executeImageMockStepSource, /getImageMockDeviceSerial\(context, commandDevice, 'Mock 指令执行'\)/);
  assert.match(executeImageMockStepSource, /const imagePackage = config\.glassesPackage \|\| context\.defaults\.glassesPackage/);
  assert.match(executeImageMockStepSource, /fallbackRemoteDir = imagePackage/);
  assert.match(executeImageMockStepSource, /normalizeRemoteImagePath\(config\.remoteImagePath, localImagePath, fallbackRemoteDir\)/);
});
