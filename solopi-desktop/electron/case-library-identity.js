// Browser-safe shared repository identity; no filesystem or credentials.
// Transport/authentication spelling is not repository identity. Keep branch and
// path case distinct, and do not collapse non-default SSH ports into HTTPS.
function canonicalCaseLibraryRepoUrl(repoUrl) {
  const raw=String(repoUrl || '').trim();
  const scp=raw.match(/^[^@:/\s]+@([^:\/]+):(.+)$/);
  let url;
  try { url=new URL(scp?`ssh://${scp[1]}/${scp[2]}`:raw); } catch { return raw; }
  if(!['https:','http:','ssh:'].includes(url.protocol))return raw;
  if(url.protocol==='ssh:' && url.port && url.port!=='22')return `ssh://${url.hostname.toLowerCase()}:${url.port}${url.pathname.replace(/\/+$/,'').replace(/\.git$/,'')}.git`;
  if(['https:','http:'].includes(url.protocol)&&url.port)return raw;
  const repo=url.pathname.replace(/\/+$/,'').replace(/\.git$/,'');
  return `https://${url.hostname.toLowerCase()}${repo}.git`;
}
module.exports={canonicalCaseLibraryRepoUrl};
