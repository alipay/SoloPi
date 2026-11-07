// Public CLI branding migration only. Other Skills own their names and references.
const RENAMED_SKILLS = Object.freeze({ 'lenswiper-cli': 'solopi-desktop-cli' });
const canonicalSkillName = name => RENAMED_SKILLS[name] || name;
const canonicalSkillFile = (_name, file) => file;
module.exports = { RENAMED_SKILLS, canonicalSkillName, canonicalSkillFile };
