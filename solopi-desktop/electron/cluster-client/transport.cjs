'use strict';
const https = require('node:https');
const http = require('node:http');
const tls = require('node:tls');
const CLIENT_ROUTES = Object.freeze({
  'POST /v1/lab/context':'/cp/lab/context',
  'GET /v1/healthz':'/cp/healthz',
  'GET /v1/lab/queue':'/cp/lab/queue',
  'POST /v1/lab/catalog':'/cp/lab/catalog',
  'POST /v1/lab/artifact-begin':'/cp/lab/artifact-begin',
  'POST /v1/lab/artifact-chunk':'/cp/lab/artifact-chunk',
  'POST /v1/lab/artifact-finish':'/cp/lab/artifact-finish',
  'POST /v1/lab/reply':'/cp/lab/reply',
  'POST /v1/lab/task-state':'/cp/lab/task-state',
  'POST /v1/lab/client-tasks':'/cp/lab/client-tasks',
  'POST /v1/group-registrations':'/cp/group-registrations',
  'POST /v1/group-executions':'/cp/group-executions',
  'GET /v1/group-dispatches':'/cp/group-dispatches',
  'POST /v1/group-dispatches':'/cp/group-dispatches',
  'POST /v1/group-dispatches/cancel':'/cp/group-dispatches/cancel',
  'POST /v1/group-grants/verify':'/cp/group-grants/verify',
  'POST /v1/enrollments':'/cp/enrollments',
  'POST /v1/enrollments/revoke':'/cp/enrollments/revoke',
  'POST /v1/enrollments/recover/challenge':'/cp/enrollments/recover/challenge',
  'POST /v1/enrollments/recover':'/cp/enrollments/recover',
  'GET /v1/sessions/challenge':'/cp/sessions/challenge',
  'POST /v1/sessions':'/cp/sessions',
  'POST /v1/heartbeat':'/cp/heartbeat',
  'POST /v1/devices/snapshot':'/cp/devices/snapshot',
  'GET /v1/events':'/cp/events',
  'GET /v1/agent-tasks/queue':'/cp/agent-tasks/queue',
  'GET /v1/events/snapshot':'/cp/events/snapshot',
});
class ConnectorError extends Error {
  constructor(code) { super(code); this.code = code; }
}
function endpoint(value, { allowInsecureHttp = false } = {}) {
  let u; try { u = new URL(value); } catch { throw new ConnectorError('CONFIG_URL_INVALID'); }
  if ((u.protocol !== 'https:' && !(u.protocol === 'http:' && allowInsecureHttp === true)) || u.username || u.password || u.search || u.hash || u.pathname !== '/') throw new ConnectorError('HTTPS_ORIGIN_REQUIRED');
  return u.origin;
}
function createTransport({ serverUrl, ca, allowInsecureHttp = false, apiMode, timeoutMs = 10000 }) {
  const origin = endpoint(serverUrl, { allowInsecureHttp });
  const client = origin.startsWith('http:') ? http : https;
  const mode = apiMode ?? (client === http ? 'cp' : 'v1');
  if (!['cp','v1'].includes(mode)) throw new ConnectorError('CONFIG_INVALID');
  return (method, route, body, token, signal) => new Promise((resolve, reject) => {
    if (!route.startsWith('/v1/')) return reject(new ConnectorError('ROUTE_INVALID'));
    let target=route;
    if(mode==='cp'){
      const index=route.indexOf('?'),base=index<0?route:route.slice(0,index),query=index<0?'':route.slice(index);
      const dynamic=method==='POST'&&/^\/v1\/agent-tasks\/[0-7][0-9A-HJKMNP-TV-Z]{25}\/(progress|result)$/.test(base);
      const detail=method==='GET'&&/^\/v1\/group-dispatches-by-request\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(base);
      const mapped=CLIENT_ROUTES[method+' '+base]||((dynamic||detail)?base.replace('/v1/','/cp/'):undefined);
      if(!mapped||(query&&!['/v1/sessions/challenge','/v1/events','/v1/events/snapshot','/v1/agent-tasks/queue','/v1/group-dispatches'].includes(base)))return reject(new ConnectorError('ROUTE_INVALID'));
      if(query&&base==='/v1/agent-tasks/queue'){
        const p=new URLSearchParams(query);if([...p.keys()].some(k=>!['sinceId','limit'].includes(k)||p.getAll(k).length!==1)||['sinceId','limit'].some(k=>p.has(k)&&(!/^\d+$/.test(p.get(k))||!Number.isSafeInteger(Number(p.get(k)))))||(p.has('limit')&&(Number(p.get('limit'))<1||Number(p.get('limit'))>100)))return reject(new ConnectorError('ROUTE_INVALID'));
      }
      if(query&&base.startsWith('/v1/events')){
        const params=new URLSearchParams(query);const allowed=new Set(['stream','sinceSeq','limit']);
        if([...params.keys()].some(k=>!allowed.has(k)||params.getAll(k).length!==1)||!/^client:[0-7][0-9A-HJKMNP-TV-Z]{25}$/.test(params.get('stream')||'')||['sinceSeq','limit'].some(k=>params.has(k)&&(!/^\d+$/.test(params.get(k))||!Number.isSafeInteger(Number(params.get(k))))))return reject(new ConnectorError('ROUTE_INVALID'));
      }
      if(method==='POST'&&query&&['/v1/group-dispatches','/v1/group-dispatches/cancel'].includes(base))return reject(new ConnectorError('ROUTE_INVALID'));
      if(method==='GET'&&base==='/v1/group-dispatches'){
        const p=new URLSearchParams(query),allowed=new Set(['clientId','afterCreatedMs','afterDispatchUid','limit']);
        const uint=v=>/^\d+$/.test(v||'')&&Number.isSafeInteger(Number(v));
        if([...p.keys()].some(k=>!allowed.has(k)||p.getAll(k).length!==1)||!(/^[0-7][0-9A-HJKMNP-TV-Z]{25}$/).test(p.get('clientId')||'')
          ||p.has('afterCreatedMs')!==p.has('afterDispatchUid')
          ||(p.has('afterCreatedMs')&&(!uint(p.get('afterCreatedMs'))||!(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i).test(p.get('afterDispatchUid')||'')))
          ||(p.has('limit')&&(!uint(p.get('limit'))||Number(p.get('limit'))<1||Number(p.get('limit'))>200)))return reject(new ConnectorError('ROUTE_INVALID'));
      }
      target=mapped+query;
    }
    const data = body === undefined ? undefined : JSON.stringify(body);
    const req = client.request(origin + target, {
      method, signal, rejectUnauthorized: true,
      ca: ca ? [...tls.rootCertificates, ca] : undefined,
      headers: { Accept: 'application/json', ...(data ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    }, res => {
      const chunks = []; let size = 0;
      res.on('aborted', () => reject(new ConnectorError('NETWORK_FAILED')));
      res.on('error', () => reject(new ConnectorError('NETWORK_FAILED')));
      res.on('data', chunk => { size += chunk.length; if (size > (route==='/v1/lab/queue'?16:1) * 1024 * 1024) req.destroy(new ConnectorError('RESPONSE_TOO_LARGE')); else chunks.push(chunk); });
      res.on('end', () => {
        let value; try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return reject(new ConnectorError('RESPONSE_INVALID')); }
        if (res.statusCode < 200 || res.statusCode >= 300) {
          // Never relay remote messages, headers, request bodies or session tokens to CLI/logs.
          const code = value?.error?.code || value?.code;
          return reject(new ConnectorError(typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,63}$/.test(code) ? code : `HTTP_${res.statusCode}`));
        }
        resolve(value);
      });
    });
    const timer = setTimeout(() => req.destroy(new ConnectorError('NETWORK_TIMEOUT')), timeoutMs);
    req.on('close', () => clearTimeout(timer));
    req.on('error', e => reject(new ConnectorError(e instanceof ConnectorError ? e.code : signal?.aborted ? 'ABORTED' : /CERT|TLS|SELF_SIGNED|VERIFY/.test(e.code || '') ? 'TLS_FAILED' : 'NETWORK_FAILED')));
    req.end(data);
  });
}
module.exports = { ConnectorError, endpoint, createTransport };
