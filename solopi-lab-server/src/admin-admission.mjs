import {ApiError,tokenHash,sha256b64} from './util.mjs';

// Cache only a successful, expensive credential derivation. Subject lifecycle,
// role, scopes and the persisted salt/hash are read again for every request.
export function createAdminAdmission({derive=tokenHash,now=Date.now,maxEntries=128,ttlMs=300000}={}){
 const databases=new WeakMap();
 return function adminSubject(db,bearer){
  if(!bearer)throw new ApiError('AUTH_REQUIRED','admin token required');
  const at=now(),candidates=db.prepare('SELECT id,label AS id_label,token_hash,token_salt,expires_at_ms,role FROM admin_subject WHERE revoked_at_ms IS NULL AND expires_at_ms>?').all(at);
  let cache=databases.get(db);if(!cache){cache=new Map();databases.set(db,cache);}
  const key=sha256b64(bearer),remembered=cache.get(key);
  let subject=remembered&&at-remembered.at<ttlMs?candidates.find(c=>c.id===remembered.id&&c.token_hash===remembered.hash&&c.token_salt===remembered.salt):null;
  if(!subject){cache.delete(key);subject=candidates.find(c=>derive(bearer,c.token_salt)===c.token_hash);if(!subject)throw new ApiError('AUTH_TOKEN_INVALID','invalid admin token');}
  cache.delete(key);cache.set(key,{id:subject.id,hash:subject.token_hash,salt:subject.token_salt,at});while(cache.size>maxEntries)cache.delete(cache.keys().next().value);
  const scopes=db.prepare('SELECT org_rowid,project_rowid FROM admin_scope WHERE admin_rowid=? AND revoked_at_ms IS NULL').all(subject.id);
  return {id:subject.id,label:subject.id_label,role:subject.role??'admin',scopes};
 };
}
