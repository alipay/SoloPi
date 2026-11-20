const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function busy() { return Object.assign(Error('配置目录正由另一 solopi-desktop 进程使用；请关闭该 UI/Broker 后使用 --headless，或去掉 --headless 通过在线 Broker 导入'), {code:'CONFIGURATION_IN_USE'}); }
function alive(pid) {try {process.kill(pid,0);return true;}catch(e){return e.code!=='ESRCH';}}
function acquireConfigurationLock(directory, {ignoreSingleton=false}={}) {
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  // Recognize older Electron installations which do not yet hold our configuration lease.
  const singleton=path.join(directory,'SingletonLock');
  if(!ignoreSingleton) {try {const target=fs.readlinkSync(singleton),split=target.lastIndexOf('-');if(target.slice(0,split)!==os.hostname() || alive(Number(target.slice(split+1))))throw busy();}
  catch(e){if(e.code!=='ENOENT'&&e.code!=='EINVAL')throw e;}}
  const file=path.join(directory,'.configuration-owner.json');
  for(let attempt=0;attempt<2;attempt++) {
    try {
      const fd=fs.openSync(file,'wx',0o600);
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid,host:os.hostname()}));
      const identity=fs.fstatSync(fd);
      return ()=>{try{const current=fs.lstatSync(file);if(current.ino===identity.ino&&current.dev===identity.dev)fs.unlinkSync(file);}finally{fs.closeSync(fd);}};
    } catch(e) {
      if(e.code!=='EEXIST')throw e;
      const stat=fs.lstatSync(file);if(stat.isSymbolicLink())throw busy();
      let owner;try{owner=JSON.parse(fs.readFileSync(file,'utf8'));}catch{throw busy();}
      if(owner.host!==os.hostname()||!Number.isInteger(owner.pid)||owner.pid<1||alive(owner.pid))throw busy();
      // Unlink only the stale inode inspected above; competing processes fail closed.
      if(fs.lstatSync(file).ino!==stat.ino)throw busy();fs.unlinkSync(file);
    }
  }
  throw busy();
}
module.exports={acquireConfigurationLock};
