// Error text only: never persist the raw response, request body, or headers.
function redactUpstreamMessage(value, secrets = []) {
  if (typeof value !== 'string') return undefined;
  let text=value.slice(0,16384);
  for(const secret of secrets) if(typeof secret==='string' && secret.length>=4) text=text.split(secret).join('[REDACTED]');
  return text
    .replace(/Bearer\s+[^\s,;"']+/gi,'Bearer [REDACTED]')
    .replace(/(["']?(?:api[_-]?key|authorization|access[_-]?token|refresh[_-]?token|password|secret)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,;}]+)/gi,'$1[REDACTED]')
    .replace(/https?:\/\/[^\s<>"']+/gi,'[URL]')
    .replace(/(?:\/Users\/|\/home\/|[A-Za-z]:\\Users\\)[^\s"']+/g,'[LOCAL_PATH]')
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[EMAIL]')
    .replace(/[\u0000-\u001f\u007f]/g,' ')
    .slice(0,2000);
}
function requestIdentifiers(headers) {
  const safe=v=>typeof v==='string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(v)?v:undefined;
  const requestId=['x-request-id','request-id','x-requestid','x-amzn-requestid'].map(k=>safe(headers?.get?.(k))).find(Boolean);
  const traceId=['x-trace-id','trace-id','traceparent'].map(k=>safe(headers?.get?.(k))).find(Boolean);
  return {requestId,traceId};
}
module.exports={redactUpstreamMessage,requestIdentifiers};
