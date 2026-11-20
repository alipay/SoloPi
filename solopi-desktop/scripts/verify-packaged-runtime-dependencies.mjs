// Read-only audit of the final archive. Resolution never falls back to the host's node_modules.
import path from 'node:path';
import {isBuiltin,createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {parse} from 'acorn';
const require=createRequire(import.meta.url),asar=require('@electron/asar');
const posix=path.posix;
function conditional(value,mode){
 if(typeof value==='string'||value===null)return value;
 if(Array.isArray(value)){for(const item of value){const v=conditional(item,mode);if(v!==undefined)return v;}return;}
 for(const [key,item] of Object.entries(value || {}))if(['node',mode,'default'].includes(key)){const v=conditional(item,mode);if(v!==undefined)return v;}
}
function mapping(map,key,mode){
 if(Object.hasOwn(map,key))return conditional(map[key],mode);
 const patterns=Object.keys(map).filter(k=>k.includes('*')).sort((a,b)=>b.indexOf('*')-a.indexOf('*')||b.length-a.length);
 for(const pattern of patterns){const [prefix,suffix]=pattern.split('*');if(key.startsWith(prefix)&&key.endsWith(suffix)&&key.length>=prefix.length+suffix.length){
  const target=conditional(map[pattern],mode);return typeof target==='string'?target.replaceAll('*',key.slice(prefix.length,suffix?-suffix.length:undefined)):target;
 }}
}
function references(code){
 const ast=parse(code,{ecmaVersion:'latest',sourceType:'module',allowReturnOutsideFunction:true,allowHashBang:true}),result=[];
 function walk(node,guarded=false){
  if(!node||typeof node!=='object')return;
  if(node.type==='TryStatement'){walk(node.block,true);walk(node.handler,guarded);walk(node.finalizer,guarded);return;}
  if(['ImportDeclaration','ExportAllDeclaration','ExportNamedDeclaration'].includes(node.type)&&node.source)result.push({specifier:node.source.value,mode:'import',guarded});
  if(node.type==='ImportExpression')result.push({specifier:node.source?.value,mode:'import',guarded});
  if(node.type==='CallExpression'&&(node.callee?.name==='require'||node.callee?.type==='MemberExpression'&&node.callee.object?.name==='require'&&node.callee.property?.name==='resolve'))result.push({specifier:node.arguments?.[0]?.value,mode:'require',guarded});
  for(const [key,value] of Object.entries(node)){if(['start','end','loc'].includes(key))continue;if(Array.isArray(value))value.forEach(v=>walk(v,guarded));else if(value?.type)walk(value,guarded);}
 }
 walk(ast);return result;
}
export function auditRuntimeDependencies({files,readFile,hostModules=['electron']}){
 const available=new Set(files.map(f=>f.replace(/^\//,''))),cache=new Map(),errors=[],warnings=[],dynamicReferences=[],visited=new Set(),queue=[];
 const json=file=>{if(!cache.has(file))cache.set(file,JSON.parse(readFile(file).toString()));return cache.get(file);};
 json('package.json');
 function packageScope(file){let dir=posix.dirname(file);while(true){const p=posix.join(dir,'package.json');if(available.has(p))return{file:p,dir,manifest:json(p)};if(dir==='.')break;dir=posix.dirname(dir);}return null;}
 function legacy(file){
  for(const suffix of ['','.js','.json','.node'])if(available.has(file+suffix))return file+suffix;
  const p=posix.join(file,'package.json');if(available.has(p)){const m=json(p);if(m.main){const target=legacy(posix.join(file,m.main));if(target)return target;}}
  for(const name of ['index.js','index.json','index.node'])if(available.has(posix.join(file,name)))return posix.join(file,name);
 }
 function resolve(specifier,importer,mode){
  if(isBuiltin(specifier)||hostModules.includes(specifier))return null;
  if(specifier.startsWith('.')){
   const target=posix.normalize(posix.join(posix.dirname(importer),specifier));
   if(target.startsWith('../'))throw Error('relative import escapes archive');
   const resolved=mode==='require'?legacy(target):available.has(target)&&target;if(!resolved)throw Error('relative module file missing');return resolved;
  }
  if(specifier.startsWith('#')){
   const scope=packageScope(importer),target=scope&&mapping(scope.manifest.imports || {},specifier,mode);
   if(typeof target!=='string')throw Error('package import mapping missing');
   return resolve(target.startsWith('.')?posix.relative(posix.dirname(importer),posix.join(scope.dir,target)).replace(/^(?!\.)/,'./'):target,importer,mode);
  }
  const parts=specifier.split('/'),name=parts.splice(0,specifier.startsWith('@')?2:1).join('/'),subpath=parts.length?'./'+parts.join('/'):'.';
  let dir=posix.dirname(importer);
  while(true){
   const base=posix.join(dir,'node_modules',name),file=posix.join(base,'package.json');
   if(available.has(file)){
    const pkg=json(file);let target;
    if(pkg.exports!==undefined){const exp=pkg.exports;
     target=typeof exp==='object'&&exp!==null&&!Array.isArray(exp)&&Object.keys(exp).some(k=>k.startsWith('.'))?mapping(exp,subpath,mode):subpath==='.'?conditional(exp,mode):undefined;
     if(typeof target!=='string'||!target.startsWith('./'))throw Error('package export unavailable');
     target=posix.normalize(posix.join(base,target));if(!target.startsWith(base+'/')||!available.has(target))throw Error('exported module file missing');
    }else target=legacy(posix.join(base,subpath==='.'?pkg.main || 'index.js':subpath));
    if(!target)throw Error('package entry missing');return target;
   }
   if(dir==='.')break;dir=posix.dirname(dir);
  }
  throw Error('package missing from archive');
 }
 function add(specifier,importer,mode,guarded=false){
  try{const file=resolve(specifier,importer,mode);if(file&&!visited.has(file))queue.push(file);}
  catch(error){const scope=packageScope(importer),name=specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0];
   const optional=guarded||scope?.manifest.optionalDependencies?.[name]||scope?.manifest.peerDependenciesMeta?.[name]?.optional;
   (optional?warnings:errors).push({importer,specifier,mode,reason:error.message,optional:!!optional});}
 }
 // Audit actual runtime entry points. A dependency may only expose subpaths,
 // or may be a renderer build plugin; importing every package root invents uses.
 for(const file of available)if(/^(?:electron|dist)\/.*\.(?:js|mjs|cjs)$/.test(file))queue.push(file);
 if(!queue.length)errors.push({reason:'no packaged application runtime entry points'});
 while(queue.length){
  const file=queue.shift();if(visited.has(file))continue;visited.add(file);
  if(!/\.(?:js|mjs|cjs)$/.test(file))continue;
  let refs;try{refs=references(readFile(file).toString());}catch(error){errors.push({importer:file,reason:`cannot parse runtime module: ${error.message}`});continue;}
  for(const ref of refs){if(typeof ref.specifier!=='string'){dynamicReferences.push({importer:file,mode:ref.mode});continue;}add(ref.specifier,file,ref.mode,ref.guarded);}
 }
 return{success:errors.length===0,checkedFiles:visited.size,errors,warnings,dynamicReferences};
}
export function verifyPackagedRuntimeDependencies(archive){
 const files=asar.listPackage(archive).filter(file=>!asar.statFile(archive,file.replace(/^\//,'')).files);
 const result=auditRuntimeDependencies({files,readFile:file=>asar.extractFile(archive,file)});
 if(!result.success)throw Object.assign(Error(`Packaged runtime dependencies are incomplete: ${result.errors.slice(0,8).map(e=>`${e.importer} -> ${e.specifier || e.reason}`).join('; ')}`),{audit:result});
 return result;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
 try{if(!process.argv[2])throw Error('usage: verify-packaged-runtime-dependencies.mjs <app.asar>');console.log(JSON.stringify(verifyPackagedRuntimeDependencies(path.resolve(process.argv[2])),null,2));}
 catch(error){console.error(JSON.stringify({success:false,error:error.message,...(error.audit?{audit:error.audit}:{})},null,2));process.exitCode=1;}
}
