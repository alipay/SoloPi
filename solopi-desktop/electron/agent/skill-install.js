const fs = require('node:fs');
const path = require('node:path');
const { runManagedCommand } = require('../managed-command');
const { skillCatalog } = require('./extensions');
async function installSkill(args, { signal, roots, config, saveExtensions, directory, run = runManagedCommand }) {
  const { command, arguments: argv = [], skillRoots, expectedSkill } = args;
  if (typeof command !== 'string' || !command.trim() || /[\0\r\n]/.test(command) || !Array.isArray(argv) || argv.some(v => typeof v !== 'string' || v.includes('\0'))) throw Error('请提供可执行程序和独立参数数组');
  if (!Array.isArray(skillRoots) || !skillRoots.length || skillRoots.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw Error('请明确安装完成后的 Skills 根目录（绝对路径）');
  signal.throwIfAborted();
  const cwd = args.cwd || directory;
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw Error('安装工作目录不存在');
  const before = new Set(skillCatalog([...roots(), ...skillRoots], config()).skills.map(s => s.name));
  let result;
  try {
    result = await run(command, argv, { cwd, env: process.env, timeout: (args.timeoutSeconds || 300) * 1000, maxBuffer: 2 * 1024 * 1024 }, cancel => {
      const abort = () => cancel(); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      return () => signal.removeEventListener('abort', abort);
    });
  } catch (error) {
    return { success: false, error: error.message, stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode, meta: error.meta };
  }
  signal.throwIfAborted();
  const found = skillCatalog([...roots(), ...skillRoots], config());
  const registered = skillRoots.filter(p => fs.existsSync(p) && fs.statSync(p).isDirectory());
  try {
    if (registered.length) await saveExtensions({ ...config(), skillRoots: [...new Set([...(config().skillRoots || []), ...registered])] });
  } catch (error) {
    return { ...result, success: false, commandSucceeded: true, error: `安装命令已完成，但登记 Skills 目录失败：${error.message}`, skillRoots: registered };
  }
  const installed = found.skills.filter(s => expectedSkill ? s.name === expectedSkill : !before.has(s.name));
  return { ...result, success: installed.length > 0, commandSucceeded: true,
    ...(installed.length ? {} : { error: '命令已完成，但未发现目标 Skill；请检查安装目录和格式诊断，不能据此宣称安装成功' }),
    skills: installed, diagnostics: found.diagnostics, skillRoots: registered };
}
module.exports = { installSkill };
