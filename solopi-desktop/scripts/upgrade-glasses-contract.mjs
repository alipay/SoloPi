// One-time data upgrade. Runtime APIs do not accept or translate obsolete roles.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const fields=new Map(['Serial','Serials','Package','Packages','Runtime','Version','DefaultPackage','Device','Devices','Log'].map(s=>['glass'+s,'glasses'+s]));
for(const prefix of ['record','show','capture','collect'])for(const suffix of ['Screen','Log','Performance'])fields.set(prefix+'Glass'+suffix,prefix+'Glasses'+suffix);
const roleMaps=new Set(['devices','targets','performanceOptions','performanceReports','screenMirrors','recordings']);
const roleValues=new Set(['device','role','target','pushDevice','commandDevice','kind']);
const opaque=new Set(['assistantMessages','messages','calls','stdout','stderr','raw','content','body','response','request','headers']);
export function upgradeGlassesContract(input){
 let changes=0;const conflicts=[];
 function walk(value,parent='',location='$'){
  if(Array.isArray(value))return value.map((v,i)=>walk(v,parent,`${location}[${i}]`));
  if(!value||typeof value!=='object')return value;
  const out={};
  for(const [key,original]of Object.entries(value)){
   if(opaque.has(key)){out[key]=original;continue;}
   const nextKey=fields.get(key)||(key==='glass'&&roleMaps.has(parent)?'glasses':key);
   if(nextKey!==key){
    if(Object.hasOwn(value,nextKey)){
     if(JSON.stringify(original)!==JSON.stringify(value[nextKey]))conflicts.push(`${location}.${key}`);
     changes++;continue;
    }
    changes++;
   }
   let next=walk(original,nextKey,`${location}.${nextKey}`);
   if(roleValues.has(key)&&next==='glass'){next='glasses';changes++;}
   if(key==='defaultValue'&&roleValues.has(value.key)&&next==='glass'){next='glasses';changes++;}
   if(key==='key'&&fields.has(next)){next=fields.get(next);changes++;}
   if(typeof next==='string'){
    // Only framework template variables, never vendor namespaces or raw logs.
    next=next.replace(/(\$\{|\{\{)(defaults\.)?(glassSerial|glassPackage)(\s*\}\}?)/g,(_m,open,scope,field,close)=>{changes++;return open+(scope||'')+fields.get(field)+close;});
   }
   out[nextKey]=next;
  }
  return out;
 }
 const value=walk(input);
 return{value,changes,conflicts};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{
  const args=process.argv.slice(2),dry=args.includes('--dry-run'),files=[];let backupDirectory;
  for(let i=0;i<args.length;i++){
   if(args[i]==='--dry-run')continue;
   if(args[i]==='--backup-dir'){if(!args[i+1]||args[i+1].startsWith('--'))throw Error('--backup-dir requires a path');backupDirectory=path.resolve(args[++i]);continue;}
   if(args[i].startsWith('--'))throw Error('Unknown option: '+args[i]);files.push(args[i]);
  }
  if(!files.length)throw Error('Usage: node scripts/upgrade-glasses-contract.mjs [--dry-run] <owned-json-file> ...');
  const upgrades=files.map(file=>{const full=path.resolve(file),raw=fs.readFileSync(full,'utf8');return{full,raw,...upgradeGlassesContract(JSON.parse(raw))};});
  if(upgrades.some(x=>x.conflicts.length))throw Error('Conflicting canonical fields: '+upgrades.flatMap(x=>x.conflicts).join(', '));
  const receipts=[];
  for(const item of upgrades){
   let backup;
   if(!dry&&item.changes){
    const folder=backupDirectory||path.dirname(item.full);fs.mkdirSync(folder,{recursive:true,mode:0o700});
    backup=path.join(folder,'.'+path.basename(item.full)+'.before-glasses-'+createHash('sha256').update(item.full).digest('hex').slice(0,8)+'-'+Date.now()+'.json');fs.writeFileSync(backup,item.raw,{flag:'wx',mode:0o600});
    const temporary=item.full+'.glasses-upgrade-'+process.pid+'.tmp';
    try{fs.writeFileSync(temporary,JSON.stringify(item.value,null,2),{flag:'wx',mode:0o600});fs.renameSync(temporary,item.full);}
    finally{fs.rmSync(temporary,{force:true});}
   }
   receipts.push({file:item.full,changes:item.changes,backup});
  }
  console.log(JSON.stringify({success:true,dryRun:dry,files:receipts},null,2));
 }catch(error){console.error(error.message);process.exitCode=1;}
}
