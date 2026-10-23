const { discoverSkills, readSkill } = require('./skills');
function skillCatalog(roots, config = {}) {
  const catalog = discoverSkills(roots);
  const disabled = new Set((config.disabledSkills || []).map(require('./skill-names').canonicalSkillName));
  return { ...catalog, skills: catalog.skills.map(s => ({ ...s, enabled: !disabled.has(require('./skill-names').canonicalSkillName(s.name)) })) };
}
function extensionInventory(roots, config, statuses = new Map()) {
  const currentConfig = { ...config, disabledSkills: [...new Set((config.disabledSkills || []).map(require('./skill-names').canonicalSkillName))] };
  return { config: currentConfig, roots, ...skillCatalog(roots, currentConfig), servers: (config.mcpServers || []).map(s => ({ ...s, status: !s.enabled ? 'disabled' : statuses.get(s.id)?.status || 'unconnected', toolCount: statuses.get(s.id)?.toolCount, error: statuses.get(s.id)?.error })) };
}
function skillDetails(roots, config, name) { return readSkill(skillCatalog(roots, config).skills, name); }
module.exports = { skillCatalog, extensionInventory, skillDetails };
