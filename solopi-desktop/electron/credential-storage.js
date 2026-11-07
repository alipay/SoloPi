// Desktop OS storage is optional. Servers use an owner-only local encryption key.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const marker = Buffer.from('LWSF1');
function privateFile(file, { directory = false } = {}) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink() || (directory ? !stat.isDirectory() : !stat.isFile()) ||
      (process.platform !== 'win32' && ((stat.mode & 0o077) || stat.uid !== process.getuid()))) {
    throw Object.assign(Error('凭据路径必须属于当前用户，目录权限0700、文件权限0600且不能为符号链接'), {code:'SECRET_FILE_PERMISSIONS'});
  }
}
function readPrivateFile(file) {
  const fd=fs.openSync(file,fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const stat=fs.fstatSync(fd);
    if(!stat.isFile() || (process.platform!=='win32' && ((stat.mode & 0o077)||stat.uid!==process.getuid())))throw Object.assign(Error('凭据文件必须属于当前用户且仅当前用户可读写'),{code:'SECRET_FILE_PERMISSIONS'});
    if(stat.size>65536)throw Error('凭据文件超过64KiB');
    return fs.readFileSync(fd);
  } finally {fs.closeSync(fd);}
}
function createCredentialStorage({ directory, osStorage, env = process.env } = {}) {
  const root = () => path.join(typeof directory === 'function' ? directory() : directory, 'credentials');
  const preferOs = env.LENSWIPER_CREDENTIAL_BACKEND === 'os' || (env.LENSWIPER_CREDENTIAL_BACKEND !== 'file' && process.platform !== 'linux');
  const key = create => {
    const dir = root(), file = path.join(dir, 'master.key');
    const existingDirectory = fs.existsSync(dir);
    if (create) fs.mkdirSync(dir, {recursive:true, mode:0o700});
    if (!fs.existsSync(dir)) throw Object.assign(Error('本地凭据密钥不存在；请恢复原凭据目录或重新配置'), {code:'SECRET_KEY_MISSING'});
    privateFile(dir, {directory:true});
    if (!fs.existsSync(file) && create && !existingDirectory) {
      try {fs.writeFileSync(file, crypto.randomBytes(32), {flag:'wx', mode:0o600});}
      catch(e) {if(e.code!=='EEXIST')throw e;}
    }
    if (!fs.existsSync(file)) throw Object.assign(Error('本地凭据密钥不存在；请恢复原凭据目录或重新配置'), {code:'SECRET_KEY_MISSING'});
    const bytes=readPrivateFile(file); if(bytes.length!==32)throw Error('本地凭据密钥无效'); return bytes;
  };
  const osAvailable = () => {try{return !!osStorage?.isEncryptionAvailable() && osStorage.getSelectedStorageBackend?.() !== 'basic_text';}catch{return false;}};
  return {
    isEncryptionAvailable: () => true,
    getSelectedStorageBackend: () => preferOs && osAvailable() ? 'os' : 'local-encrypted-file',
    encryptString(value) {
      if(preferOs && osAvailable()) {try{return osStorage.encryptString(value);}catch{/* A locked desktop backend must not block new credential imports. */}}
      const nonce=crypto.randomBytes(12), cipher=crypto.createCipheriv('aes-256-gcm',key(true),nonce);
      const data=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
      return Buffer.concat([marker,nonce,cipher.getAuthTag(),data]);
    },
    decryptString(bytes) {
      if(!bytes.subarray(0,marker.length).equals(marker)) {
        if(!osAvailable())throw Object.assign(Error('原凭据由系统钥匙串加密；请解锁原后端或重新导入，不能自动转换'),{code:'OS_SECRET_UNAVAILABLE'});
        return osStorage.decryptString(bytes);
      }
      if(bytes.length<33)throw Error('凭据密文无效');
      const decipher=crypto.createDecipheriv('aes-256-gcm',key(false),bytes.subarray(5,17));decipher.setAuthTag(bytes.subarray(17,33));
      return Buffer.concat([decipher.update(bytes.subarray(33)),decipher.final()]).toString('utf8');
    },
    resolveReference(value) {
      const envPrefix='solopi-desktop:env-secret:v1:', filePrefix='solopi-desktop:file-secret:v1:';
      if(value.startsWith(envPrefix)) {
        const name=value.slice(envPrefix.length);
        if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || !env[name])throw Object.assign(Error('凭据环境变量未配置'),{code:'SECRET_REFERENCE_UNAVAILABLE'});
        return env[name];
      }
      const file=value.slice(filePrefix.length);
      if(!path.isAbsolute(file))throw Error('凭据文件引用需要绝对路径');
      const valueFromFile=readPrivateFile(file).toString('utf8').replace(/\r?\n$/, '');
      if(!valueFromFile)throw Error('凭据文件为空');return valueFromFile;
    },
  };
}
function isSecretReference(value) {return typeof value==='string' && (value.startsWith('solopi-desktop:env-secret:v1:') || value.startsWith('solopi-desktop:file-secret:v1:'));}
module.exports={createCredentialStorage,isSecretReference,privateFile};
