const fs = require('node:fs');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');
const { Readable, Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
async function downloadFile({ url, fileName }, { directory, signal, fetchImpl = fetch, maxBytes = 2 * 1024 ** 3 }) {
  const source = new URL(url);
  if (!['https:','http:'].includes(source.protocol) || source.username || source.password) throw Error('下载地址必须为不含账号密码的 HTTP(S) URL');
  const name = fileName || decodeURIComponent(source.pathname.split('/').at(-1) || 'download.bin');
  if (!name || name.length > 240 || /[\\/\0\r\n]/.test(name) || ['.','..'].includes(name)) throw Error('下载文件名无效，请只填写文件名');
  signal?.throwIfAborted();
  const controller = new AbortController();
  const abort = () => controller.abort(); signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, 10 * 60 * 1000);
  const folder = path.join(directory, randomUUID()), target = path.join(folder, name), temporary = `${target}.part`;
  let bytes = 0; const hash = createHash('sha256');
  try {
    const response = await fetchImpl(source.href, { signal: controller.signal, redirect: 'follow' });
    if (!response.ok) { await response.body?.cancel(); throw Error(`下载失败（HTTP ${response.status}），请检查链接、登录权限或链接是否过期`); }
    if (!response.body) throw Error('下载响应没有文件内容');
    if (Number(response.headers.get('content-length')) > maxBytes) { await response.body.cancel(); throw Error('下载文件超过大小上限'); }
    fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
    const counter = new Transform({ transform(chunk, _encoding, done) {
      bytes += chunk.length;
      if (bytes > maxBytes) return done(Error('下载文件超过大小上限'));
      hash.update(chunk); done(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body), counter, fs.createWriteStream(temporary, { flags: 'wx', mode: 0o600 }), { signal: controller.signal });
    controller.signal.throwIfAborted();
    fs.renameSync(temporary, target);
    return { success: true, path: target, fileName: name, bytes, sha256: hash.digest('hex'), sourceOrigin: source.origin };
  } catch (error) {
    fs.rmSync(folder, { recursive: true, force: true });
    if (controller.signal.aborted) throw Error(signal?.aborted ? '下载已取消，未保留不完整文件' : '下载超时，未保留不完整文件');
    if (error.message === 'fetch failed') {
      const code = error.cause?.code;
      throw Error(`文件下载连接失败${/^[A-Z0-9_]+$/.test(code || '') ? `（${code}）` : ''}，请检查网络、代理/VPN及地址可达性`);
    }
    throw error;
  } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}
module.exports = { downloadFile };
