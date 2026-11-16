#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export function parseOptions(args) {
  const options = { check: false, dev: false, help: false, branch: '', identity: process.env.GLASSBOX_CODESIGN_IDENTITY_SHA1 || '' };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--check') options.check = true;
    else if (args[i] === '--dev') options.dev = true;
    else if (args[i] === '--help' || args[i] === '-h') options.help = true;
    else if (args[i] === '--branch') {
      if (!['master', 'main', 'agent'].includes(args[i + 1])) throw new Error('--branch 只能是 master、main 或 agent');
      options.branch = args[++i];
    } else if (args[i] === '--identity') {
      if (!/^[A-Fa-f0-9]{40}$/.test(args[i + 1] || '')) throw new Error('--identity 需要完整的 40 位证书 SHA-1');
      options.identity = args[++i];
    } else throw new Error(`未知参数：${args[i]}，使用 --help 查看帮助`);
  }
  if (options.dev && (options.check || args.includes('--identity'))) throw new Error('--dev 不能与 --check 或 --identity 同用');
  options.identity = options.identity.trim().toUpperCase();
  return options;
}
export function resolveBuildRoot(branch, repository = root, run = spawnSync) {
  if (!branch) return repository;
  const target = branch === 'agent' || branch === 'main' ? 'codex/lenswiper-main' : 'master';
  const result = run('git', ['worktree', 'list', '--porcelain', '-z'], { cwd: repository, encoding: 'utf8' });
  if (result.error || result.status !== 0) throw new Error('无法读取分支工作目录');
  const entries = String(result.stdout).split('\0\0').map(record => record.split('\0'));
  const match = entries.find(fields => fields.includes(`branch refs/heads/${target}`));
  const directory = match?.find(field => field.startsWith('worktree '))?.slice(9);
  if (!directory || match.some(field => field.startsWith('prunable'))) throw new Error(`分支 ${target} 没有可用工作目录，请先为该分支创建 Git worktree；不会自动切换或覆盖当前目录。`);
  return directory;
}
export function main(args, run = spawnSync, repository = root) {
  const options = parseOptions(args);
  if (options.help) {
    console.log(`solopi-desktop 本地签名打包\n\n用法：solopi-desktop-package [--branch master|main|agent] [--dev | --check] [--identity SHA1]\n\n  无参数       测试 → 类型检查 → 构建、签名并生成 DMG/ZIP\n  --branch     选择 master 或 main 工作目录；agent 为 main 的兼容别名；省略时使用命令安装仓库\n  --dev        在目标工作目录执行 npm run dev，不打包\n  --check      只检查仓库、版本说明、依赖和签名证书\n  --identity   指定完整 Developer ID 证书 SHA-1\n  -h, --help   查看帮助\n\n使用仓库当前版本，不修改版本号、不公证、不发布或安装。\n输出目录：${path.join(repository, 'release')}`);
    return;
  }
  if (options.dev) {
    const devRoot = resolveBuildRoot(options.branch, repository, run);
    const pkg = JSON.parse(fs.readFileSync(path.join(devRoot, 'package.json'), 'utf8'));
    if (!pkg.scripts?.dev) throw new Error('目标仓库未配置 npm run dev');
    console.log(`开发目录：${devRoot}\n▶ npm run dev（Ctrl+C 停止）`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    const result = run('npm', ['run', 'dev'], { cwd: devRoot, env, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      const error = new Error(result.error?.message || `开发服务已退出：${result.signal || result.status}`);
      error.exitCode = result.status || (result.signal === 'SIGINT' ? 130 : 1);
      throw error;
    }
    return;
  }
  if (process.platform !== 'darwin') throw new Error('macOS 打包命令只能在 macOS 运行');
  if (!/^[A-F0-9]{40}$/.test(options.identity)) throw new Error('缺少完整签名 SHA-1，请重新安装命令或使用 --identity');
  if (process.env.GLASSBOX_FORCE_ADHOC_SIGNING === '1' || process.env.GLASSBOX_ALLOW_ADHOC_SIGNING === '1') throw new Error('请移除 ad-hoc 签名环境变量后重试');
  const buildRoot = resolveBuildRoot(options.branch, repository, run);
  const pkg = JSON.parse(fs.readFileSync(path.join(buildRoot, 'package.json'), 'utf8'));
  const notes = path.join(buildRoot, 'docs', 'releases', `${pkg.version}.md`);
  if (!fs.existsSync(notes) || !fs.readFileSync(notes, 'utf8').trim()) throw new Error(`缺少版本说明：${notes}`);
  fs.accessSync(path.join(buildRoot, 'node_modules/electron/dist/Electron.app/Contents/MacOS/Electron'), fs.constants.X_OK);
  const identities = run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning'], { encoding: 'utf8' });
  if (identities.error || identities.status !== 0) throw new Error('无法读取签名身份，请检查登录钥匙串');
  if (!String(identities.stdout).split('\n').some(line => line.includes(options.identity) && line.includes('"Developer ID Application:'))) throw new Error('指定的 Developer ID 身份不可用，请运行 security find-identity -v -p codesigning 检查');
  const env = { ...process.env, GLASSBOX_CODESIGN_IDENTITY_SHA1: options.identity };
  console.log(`仓库：${buildRoot}\n分支选择：${options.branch || '命令安装仓库'}\n版本：${pkg.version}\n签名：${options.identity}\n输出：${path.join(buildRoot, 'release')}`);
  if (options.check) { console.log('预检查通过（尚未测试 Apple 时间戳服务）。'); return; }
  const whitespace = run('git', ['diff', '--check'], { cwd: buildRoot, env, stdio: 'inherit' });
  if (whitespace.error || whitespace.status !== 0) throw new Error('git diff --check 未通过，请修复后重试');
  for (const task of ['test', 'typecheck', 'package:mac']) {
    console.log(`\n▶ npm run ${task}`);
    const result = run('npm', ['run', task], { cwd: buildRoot, env, stdio: 'inherit' });
    if (result.error || result.status !== 0) {
      const error = new Error(`${task} 未完成，请查看上方原始错误；未自动重试或降低签名要求。`);
      error.exitCode = result.status || 1;
      throw error;
    }
  }
  console.log(`\n打包成功，待安装验证：\n${path.join(buildRoot, 'release', `solopi-desktop-${pkg.version}-arm64.dmg`)}\n${path.join(buildRoot, 'release', `solopi-desktop-${pkg.version}-arm64-mac.zip`)}`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); } catch (error) { console.error(error.message); process.exitCode = error.exitCode || 1; }
}
