import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { discoverSkills, readSkill, readSkillReference } = require('../electron/agent/skills');
const { skillCatalog, extensionInventory } = require('../electron/agent/extensions');
const { recordSkillRead, assertSkillRead } = require('../electron/agent/skill-reading');
const { refreshLoadedSkills, assertSkillUpdatesRead } = require('../electron/agent/skill-refresh');
const { RENAMED_SKILLS } = require('../electron/agent/skill-names');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'solopi-skill-rename-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, body) => {
    const dir = path.join(root, name); fs.mkdirSync(path.join(dir, 'references'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${name}\ndescription: fixture\n---\n${body}\n`);
    fs.writeFileSync(path.join(dir, 'references/rule.md'), `# Rule\n${body}`);
  };
  return { root, write, catalog: () => discoverSkills([root]).skills };
}
test('current names win over all installed legacy copies; old calls resolve to the same current source', t => {
  const f = fixture(t);
  for (const [oldName, name] of Object.entries(RENAMED_SKILLS)) { f.write(oldName, 'OBSOLETE'); f.write(name, 'CURRENT'); }
  assert.equal(f.catalog().length, Object.keys(RENAMED_SKILLS).length);
  for (const [oldName, name] of Object.entries(RENAMED_SKILLS)) {
    const result = readSkill(f.catalog(), oldName);
    assert.equal(result.name, name); assert.match(result.content, /CURRENT/); assert.doesNotMatch(result.content, /OBSOLETE/);
    assert.equal(readSkillReference(f.catalog(), oldName, 'references/rule.md').name, name);
    assert.equal(skillCatalog([f.root], { disabledSkills: [oldName] }).skills.find(s => s.name === name).enabled, false);
    const inventory = extensionInventory([f.root], { disabledSkills: [oldName] });
    assert.deepEqual(inventory.config.disabledSkills, [name]);
    const reenabled = { ...inventory.config, disabledSkills: inventory.config.disabledSkills.filter(n => n !== name) };
    assert.equal(skillCatalog([f.root], reenabled).skills.find(s => s.name === name).enabled, true);
  }
});
test('existing sessions migrate read ledgers and invalidate old receipts without rewriting history', t => {
  const f = fixture(t), oldName = 'lenswiper-cli', name = RENAMED_SKILLS[oldName];
  f.write(oldName, 'OLD'); const s = { messages: [{ role: 'assistant', content: 'original history' }], calls: [], referenceMemory: [{ skillName: oldName }] };
  recordSkillRead(s, readSkill(f.catalog(), oldName)); recordSkillRead(s, readSkillReference(f.catalog(), oldName, 'references/rule.md'));
  f.write(name, 'NEW'); refreshLoadedSkills(s, [f.root]);
  assert.ok(Object.keys(s.skillReads).every(k => !k.startsWith(oldName + ':')));
  assert.equal(s.skillReads[name + ':SKILL.md'].complete, false);
  assert.throws(() => assertSkillUpdatesRead(s, 'run_command', { name: oldName }));
  assert.equal(s.messages[0].content, 'original history'); assert.deepEqual(s.referenceMemory, []);
  recordSkillRead(s, readSkill(f.catalog(), oldName)); recordSkillRead(s, readSkillReference(f.catalog(), oldName, 'references/rule.md'));
  assertSkillRead(s, { name: oldName, files: ['references/rule.md'] });
  assertSkillUpdatesRead(s, 'run_command', { name });
  assert.deepEqual(refreshLoadedSkills(s, [f.root]), []);
});
test('third-party Skill names and reference paths are never remapped by the framework', t => {
  const f = fixture(t), name = 'external-workflow'; f.write(name, 'CURRENT');
  const file = 'references/original.json';
  fs.writeFileSync(path.join(f.root, name, file), '{"version":1}');
  assert.equal(readSkillReference(f.catalog(), name, file).file, file);
  assert.throws(() => readSkillReference(f.catalog(), name, 'references/missing.json'), /ENOENT|不存在/);
  assert.equal(require('../electron/agent/skill-names').canonicalSkillName(name), name);
});
