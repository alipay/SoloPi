import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import http from 'node:http';import path from 'node:path';import vm from 'node:vm';import {spawnSync}from'node:child_process';import crypto from 'node:crypto';import {createRequire}from'node:module';
const require=createRequire(import.meta.url);
test('all locked packages reject the reviewed advisory ranges, including development and packaging dependencies',()=>{
 const semver=require('semver'),lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url))),advisories=JSON.parse(fs.readFileSync(new URL('./fixtures/dependency-advisories.json',import.meta.url)));
 for(const [p,v]of Object.entries(lock.packages)){if(!p||!v.version)continue;const name=p.split('node_modules/').at(-1);for(const a of advisories.filter(a=>a.name===name))assert.equal(semver.satisfies(v.version,a.range),false,`${p}@${v.version}: ${a.url}`);}
});
test('cross-realm sensitive header lists cannot leak credentials across redirects',async t=>{
 let received;const target=http.createServer((req,res)=>{received=req.headers;res.end('ok');}),redirect=http.createServer((_req,res)=>{res.writeHead(302,{location:`http://127.0.0.1:${target.address().port}/`});res.end();});
 for(const server of [target,redirect]){await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));}
 await new Promise((resolve,reject)=>{const request=require('follow-redirects').http.get({hostname:'127.0.0.1',port:redirect.address().port,path:'/',headers:{'x-fixture-key':'synthetic-secret','x-keep':'yes'},sensitiveHeaders:vm.runInNewContext("['x-fixture-key']")},res=>{res.resume();res.on('end',resolve)});request.on('error',reject);request.setTimeout(5000,()=>request.destroy(Error('Loopback test timeout')));});
 assert.equal(received['x-fixture-key'],undefined);assert.equal(received['x-keep'],'yes');
});
test('RSA signature verification rejects extra nested DigestAlgorithm content and still accepts valid signatures',()=>{
 const forge=require('node-forge'),{publicKey,privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:1024,publicExponent:3});const verifier=forge.pki.publicKeyFromPem(publicKey.export({type:'spki',format:'pem'}));
 const message=Buffer.from('synthetic signature regression'),digest=crypto.createHash('sha256').update(message).digest();
 const valid=crypto.sign('sha256',message,privateKey);assert.equal(verifier.verify(digest.toString('binary'),valid.toString('binary')),true);
 const a=forge.asn1,C=a.Class.UNIVERSAL,T=a.Type;
 const algorithm=()=>a.create(C,T.SEQUENCE,true,[a.create(C,T.OID,false,a.oidToDer(forge.pki.oids.sha256).getBytes()),a.create(C,T.NULL,false,'')]);
 const nested=algorithm();nested.value.push(algorithm());const der=Buffer.from(a.toDer(a.create(C,T.SEQUENCE,true,[nested,a.create(C,T.OCTETSTRING,false,digest.toString('binary'))])).getBytes(),'binary');
 const padding=Buffer.alloc(128-der.length-3,255),encoded=Buffer.concat([Buffer.from([0,1]),padding,Buffer.from([0]),der]);const signature=crypto.privateEncrypt({key:privateKey,padding:crypto.constants.RSA_NO_PADDING},encoded);
 let accepted=false;try{accepted=verifier.verify(digest.toString('binary'),signature.toString('binary'));}catch{}assert.equal(accepted,false);assert.equal(crypto.verify('sha256',message,publicKey,signature),false);
});

test('patched picomatch rejects adversarial repetitions in bounded time and retains ordinary matching',()=>{
 const root=new URL('../',import.meta.url),source=JSON.parse(fs.readFileSync(new URL('../vendor/picomatch/patch-provenance.json',import.meta.url)));
 const installed=require('picomatch/package.json');assert.equal(installed.version,source.localVersion);
 const digest=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
 assert.equal(digest(require.resolve('picomatch/lib/parse')),source.patchedParseSha256);
 const child=spawnSync(process.execPath,['-e',"const p=require('picomatch');for(const options of [{},{maxExtglobRecursion:false}])for(const g of ['+(*)b','+(*a)b','*(*)b','*(*a)b','+(a*)b']){const match=p(g,options);if(match('a'.repeat(48)+'c'))process.exit(2);}console.log('bounded');"],{cwd:root,encoding:'utf8',timeout:2000});
 assert.equal(child.status,0,child.error?.message||child.stderr);assert.match(child.stdout,/bounded/);
 const picomatch=require('picomatch');for(const [g,yes,no]of [['src/**/*.ts','src/nested/a.ts','src/a.js'],['+(a|b)','abab','abc'],['+(a?)','abab','abc'],['+([ab])','abab','abc'],['+(*a)','baaa','aaab'],['+(a*)','abcd','bcd'],['a/?.js','a/b.js','a/cc.js']]){assert.equal(picomatch(g)(yes),true,g);assert.equal(picomatch(g)(no),false,g);}
});

test('security dependencies are resolved inside this checkout and the patched matcher is installed as ordinary package files',()=>{
 const moduleRoot=fs.realpathSync(new URL('../node_modules/',import.meta.url));
 for(const name of ['node-forge','follow-redirects','picomatch','semver']){const relative=path.relative(moduleRoot,fs.realpathSync(require.resolve(name)));assert.ok(!relative.startsWith('..')&&!path.isAbsolute(relative),name+' must not fall back to a parent checkout');}
 assert.equal(fs.lstatSync(new URL('../node_modules/picomatch',import.meta.url)).isSymbolicLink(),false);
 const provenance=JSON.parse(fs.readFileSync(new URL('../vendor/picomatch/patch-provenance.json',import.meta.url)));
 const lock=JSON.parse(fs.readFileSync(new URL('../package-lock.json',import.meta.url)));
 for(const [p,v]of Object.entries(lock.packages))if(p.endsWith('/picomatch'))assert.equal(v.version,provenance.localVersion,p);
});
