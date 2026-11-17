export function gatewayListenOptions(args) {
  const value = (flag, fallback) => {
    const index = args.indexOf(flag);
    if (index < 0) return fallback;
    const next = args[index + 1];
    if (!next || next.startsWith('--')) throw Error(`Missing value for ${flag}`);
    return next;
  };
  const port = value('--port', '8780');
  if (!/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw Error('Invalid --port');
  return {host:value('--host', '127.0.0.1'), port:Number(port)};
}
