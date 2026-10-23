const {createHash} = require('node:crypto');
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const selectorFields = ['libraryId','folderId','query','excludeFolderIds','excludeCaseIds'];
const domainKey = (state, domain) => hash(domain || ['anonymous', (state.caseLibraries || []).map(l=>l.id).sort()]);
function create(state, selectors, ids, domain = '') {
  const membership = hash([...new Set(ids)].sort());
  // This is a portable query receipt, not an authorization capability. Every
  // use resolves its selectors against current state and validates membership.
  const receipt = {v:1,domain:domainKey(state,domain),selectors,membership};
  const id='selection:v1:'+Buffer.from(JSON.stringify(receipt)).toString('base64url');
  return {selectionRevision:membership,selectorRevision:hash(selectors),
    ...(id.length<=16000 ? {selectionId:id} : {selectionReceiptUnavailable:'selector-too-large-use-explicit-range'})};
}
function decode(state, id, domain = '') {
  const fail = () => {throw Object.assign(Error('选择凭证无效或不属于当前数据源，请重新查询'),{code:'SELECTION_RECEIPT_INVALID'});};
  if(typeof id!=='string' || id.length>16000 || !id.startsWith('selection:v1:'))return fail();
  let r;try{r=JSON.parse(Buffer.from(id.slice(13),'base64url').toString());}catch{return fail();}
  if(r?.v!==1 || r.domain!==domainKey(state,domain) || !/^[a-f0-9]{64}$/.test(r.membership || '') || !r.selectors || Array.isArray(r.selectors) || typeof r.selectors!=='object')return fail();
  for(const [k,v] of Object.entries(r.selectors)) {
    if(!selectorFields.includes(k))return fail();
    if(k.startsWith('exclude') ? !Array.isArray(v) || v.length>1000 || v.some(x=>typeof x!=='string' || !x || x.length>1000) : typeof v!=='string' || !v || v.length>1000)return fail();
  }
  return r;
}
module.exports={create,decode};
