const fs = require('node:fs');
const path = require('node:path');
const YAML = require('yaml');
const { canonicalSkillName, canonicalSkillFile } = require('./skill-names');
function readBounded(file) {
  if (fs.statSync(file).size > 4 * 1024 * 1024) throw Error('Skill 文件超过 4 MiB，请拆分参考文档');
  return fs.readFileSync(file, 'utf8');
}
function discoverSkills(roots) {
  const skills = [], diagnostics = [];
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    let dirs;
    try { dirs = fs.readdirSync(root, { withFileTypes: true }); } catch (error) { diagnostics.push({ directory: root, error: error.message }); continue; }
    for (const dir of dirs.filter(d => d.isDirectory() || d.isSymbolicLink())) {
      const directory = path.join(root, dir.name), file = path.join(directory, 'SKILL.md');
      if (!fs.existsSync(file)) continue;
      try {
        const content = readBounded(file), front = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
        if (!front) throw Error('缺少 YAML frontmatter');
        const meta = YAML.parse(front[1]);
        if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(meta.name || '') || meta.name.length > 64 || typeof meta.description !== 'string' || !meta.description.trim() || meta.description.length > 1024) throw Error('name/description 不符合 Agent Skills 格式');
        if (skills.some(s => s.directory === fs.realpathSync(directory))) continue;
        if (skills.some(s => s.name === meta.name)) throw Error('Skill 名称重复，优先使用前一个目录的版本');
        skills.push({ name: meta.name, description: meta.description, compatibility: meta.compatibility || '', directory: fs.realpathSync(directory), root });
      } catch (error) { diagnostics.push({ directory, error: error.message }); }
    }
  }
  const names = new Set(skills.map(skill => skill.name));
  return { skills: skills.filter(skill => skill.name === canonicalSkillName(skill.name) || !names.has(canonicalSkillName(skill.name))), diagnostics };
}
function resolveSkillFile(skills, name, relative = 'SKILL.md') {
  const skill = skills.find(s => s.name === canonicalSkillName(name)) || skills.find(s => s.name === name);
  if (!skill) throw Error('Skill 不存在');
  relative = canonicalSkillFile(skill.name, relative);
  const file = fs.realpathSync(path.resolve(skill.directory, relative));
  if (!file.startsWith(`${skill.directory}${path.sep}`)) throw Error('禁止读取 Skill 目录之外的文件');
  if(!fs.statSync(file).isFile()) throw Error('Skill 参考路径不是普通文件');
  return {skill,file};
}
function readSkill(skills, name, relative = 'SKILL.md', options = {}) {
  const {skill,file}=resolveSkillFile(skills,name,relative);
  const content=readBounded(file),hash=require('node:crypto').createHash('sha256').update(content).digest('hex');
  const base={success:true,name:skill.name,file:path.relative(skill.directory,file).split(path.sep).join('/'),directory:skill.directory,absolutePath:file,sourceVersion:require('./reference-memory').fileVersion(file),hash,totalCharacters:content.length};
  if(path.relative(skill.directory,file)==='SKILL.md') {
    if(options.section || options.query || options.offset) throw Error('SKILL.md入口必须完整读取，不支持部分读取');
    const front=content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
    const meta=front?YAML.parse(front[1]):{};
    const requiredReading=meta.required_reading || [];
    if(!Array.isArray(requiredReading) || requiredReading.some(x=>typeof x!=='string')) throw Error('required_reading必须为相对文件路径数组');
    return {...base,totalLines:content.split('\n').length,content,complete:true,entry:true,requiredReading};
  }
  const lines=content.split('\n'), headings=[];let fence=null;
  for(let i=0;i<lines.length;i++) {
    const f=lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if(f){if(!fence)fence={char:f[1][0],length:f[1].length};else if(fence.char===f[1][0] && f[1].length>=fence.length && !f[2].trim())fence=null;continue;}
    if(fence)continue;
    const h=lines[i].match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if(h)headings.push({id:`line-${i+1}`,title:h[2],level:h[1].length,startLine:i+1});
  }
  if(headings[0]?.startLine>1)headings.unshift({id:'preamble',title:'章节前说明',level:0,startLine:1,endLine:headings[0].startLine-1});
  base.totalLines=lines.length;
  for(let i=0;i<headings.length;i++)if(headings[i].id!=='preamble')headings[i].endLine=headings.slice(i+1).find(h=>h.level<=headings[i].level)?.startLine-1 || lines.length;
  if(options.section) {
    const section=headings.find(h=>h.id===options.section);
    if(!section)throw Error('章节不存在，请先读取目录或搜索');
    const body=lines.slice(section.startLine-1,section.endLine).join('\n');
    if(body.length>65536)return {...base,success:false,complete:false,error:'章节超过64KiB，请读取下级完整章节；没有下级章节时需拆分文档',sections:headings.filter(h=>h.startLine>section.startLine && h.startLine<=section.endLine)};
    return {...base,complete:section.startLine===1 && section.endLine===lines.length,sectionComplete:true,section,content:body};
  }
  if(content.length<=16000 && !options.query && !options.offset)return {...base,complete:true,content};
  const matches=options.query?headings.filter(h=>lines.slice(h.startLine-1,h.endLine).join('\n').includes(options.query)):headings;
  const offset=options.offset || 0,end=offset+20;
  return {...base,complete:false,content:'',mode:options.query?'search':'outline',sections:matches.slice(offset,end),totalSections:matches.length,nextOffset:end<matches.length?end:null,
    message:!headings.length?'参考文件过大且没有可识别章节标题，请拆分文档；尚未加载全文，不得猜命令。':'这里只是目录或检索定位，未加载完整参考文件。请用section读取任务相关完整章节及入口声明的必读参考；不得据此猜命令。'};
}
function readSkillReference(skills, name, relative, options = {}) {
  if(typeof relative!=='string' || !relative.trim())throw Error('参考读取必须提供file相对路径');
  const {skill,file}=resolveSkillFile(skills,name,relative);
  if(path.relative(skill.directory,file)==='SKILL.md')throw Error('SKILL.md入口请使用read_skill完整加载');
  return readSkill(skills,name,relative,options);
}
module.exports = { discoverSkills, readSkill, readSkillReference, resolveSkillFile };
