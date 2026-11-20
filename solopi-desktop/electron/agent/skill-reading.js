const { canonicalSkillName, canonicalSkillFile } = require('./skill-names');
function recordSkillRead(session,result,{activate=true}={}) {
 if(activate)require('./skill-scope').activateSkills(session,[result.name]);
 const key=`${result.name}:${result.file}`,reads=session.skillReads ||= {};
 if(session.skillUpdates)delete session.skillUpdates[key];
 const prior=reads[key];
 if(result.entry && prior?.hash && prior.hash!==result.hash)for(const k of Object.keys(reads))if(k.startsWith(`${result.name}:`))delete reads[k];
 const read=prior?.hash===result.hash?prior:{hash:result.hash,ranges:[]};
 if(result.complete)read.complete=true;
 if(result.sectionComplete)read.ranges.push([result.section.startLine,result.section.endLine]);
 if(result.totalLines){let end=0;for(const [a,b] of [...read.ranges].sort((a,b)=>a[0]-b[0]))if(a<=end+1)end=Math.max(end,b);if(end>=result.totalLines)read.complete=true;}
 read.absolutePath=result.absolutePath;
 read.sourceVersion=result.sourceVersion;
 if(result.entry)read.requiredReading=result.requiredReading;
 reads[key]=read;
}
// Resolve only exact receipt paths. Never infer a Skill from a basename or read
// arbitrary files merely because a model supplied an absolute path.
function skillDependencies(session,{name,files=[]}) {
 if(session.skillReads?.[`${canonicalSkillName(name)}:SKILL.md`])name=canonicalSkillName(name);
 const reads=session.skillReads || {},groups=new Map([[name,new Set()]]);
 for(const requested of files){
  let skill=name,file=canonicalSkillFile(name,requested);
  if(require('node:path').isAbsolute(requested) || require('node:path').win32.isAbsolute(requested)){
   const match=Object.entries(reads).find(([,read])=>read.absolutePath===requested);
   if(!match)throw Error('Skill绝对路径没有当前读取凭证，未执行命令；请先读取对应入口或参考文件');
   const split=match[0].indexOf(':');skill=match[0].slice(0,split);file=match[0].slice(split+1);
  }
  if(!groups.has(skill))groups.set(skill,new Set());
  groups.get(skill).add(file);
 }
 return groups;
}
function assertSkillRead(session,context) {
 const reads=session.skillReads || {},groups=skillDependencies(session,context);
 for(const [name,files] of groups){
  const entry=reads[`${name}:SKILL.md`];
  if(!entry?.complete)throw Error(`Skill ${name}入口尚未完整加载，未执行命令`);
  for(const requested of [...(entry.requiredReading||[]),...files]){
   const file=canonicalSkillFile(name,requested),r=reads[`${name}:${file}`];
   if(!r?.complete && !r?.ranges?.length)throw Error(`Skill参考 ${file} 尚未读取完整章节，未执行命令`);
   if((entry.requiredReading||[]).some(required=>canonicalSkillFile(name,required)===file) && !r?.complete)throw Error(`Skill必读参考 ${file}尚未完整加载，未执行命令`);
  }
 }
 return groups;
}
module.exports={recordSkillRead,assertSkillRead,skillDependencies};
