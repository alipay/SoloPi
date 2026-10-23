const fs = require('fs');
const path = require('path');
function createSessionManager(file, run) {
  const busy = new Set();
  const read = () => fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  const save = (data) => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(data), { mode: 0o600 });
    fs.renameSync(`${file}.tmp`, file);
  };
  const put = (id, value) => { const data = read(); if (value) data[id] = value; else delete data[id]; save(data); };
  const restored = read();
  if (Object.keys(restored).length) {
    for (const session of Object.values(restored)) session.status = ['exporting', 'export-failed'].includes(session.status) ? 'export-failed' : 'needs-stop';
    save(restored);
  }
  return {
    list: () => Object.fromEntries(Object.entries(read()).map(([id, s]) => [id, { status: s.status, startedAt: s.startedAt, device: s.context.glassesSerial || s.context.phoneSerial }])),
    async execute(id, action, values, context, expectedPhase) {
      if (busy.has(id)) throw new Error('该快捷操作正在执行，请勿重复点击');
      let session = read()[id];
      if (expectedPhase && expectedPhase !== (session ? 'stop' : 'start')) throw Error(session ? '会话已存在；如需结束并导出请明确使用stop' : '会话未开始；请使用start');
      busy.add(id);
      try {
        if (!session) {
          session = { action, values, context, status: 'starting', startedAt: new Date().toISOString() };
          put(id, session); // Persist before side effects, including uncertain failures.
          await run(session, 'start');
          session.status = 'active'; put(id, session);
          return { success: true, stdout: '已开始；再次点击将结束并导出。' };
        }
        if (!['exporting', 'export-failed'].includes(session.status)) {
          session.status = 'stopping'; put(id, session);
          await run(session, 'stop');
        }
        session.status = 'exporting'; put(id, session);
        const result = await run(session, 'export');
        put(id, null);
        return { success: true, ...result, outputDir: result.outputDir || session.context.outputDir };
      } catch (error) {
        if (session) { session.status = session.status === 'exporting' ? 'export-failed' : 'needs-stop'; put(id, session); }
        throw error;
      } finally { busy.delete(id); }
    },
  };
}
module.exports = { createSessionManager };
