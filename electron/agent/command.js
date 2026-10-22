const fs = require('node:fs');
const path = require('node:path');
const { runManagedCommand } = require('../managed-command');
const DEFAULT_COMMAND_TIMEOUT_SECONDS=60;
async function executeCommand(args, { signal, directory, run = runManagedCommand }) {
  const argv = args.arguments || [];
  if (typeof args.command !== 'string' || !args.command.trim() || /[\0\r\n]/.test(args.command) || !Array.isArray(argv) || argv.some(v => typeof v !== 'string' || v.includes('\0'))) throw Error('请提供可执行程序和独立参数数组');
  // This tool has no stdin payload. A shell's stdin-script mode otherwise exits
  // zero on EOF while treating the intended executable arguments as positional
  // parameters, producing a misleading empty process receipt.
  if(['sh','bash','dash','zsh','ksh'].includes(path.basename(args.command))) {
    const options=[];
    for(const value of argv){if(value==='--' || !value.startsWith('-') || value==='-')break;options.push(value);}
    const commandMode=options.some(v=>/^-[^-]*c/.test(v));
    if(!commandMode && (argv.length===0 || options.some(v=>v==='--stdin' || /^-[^-]*s/.test(v))))
      throw Error('此工具未提供标准输入脚本；Shell 的 -s/标准输入入口不会执行后面的程序参数。请填写真实可执行程序与参数，或显式使用 Shell -c 和脚本文本。未执行，不自动改写命令。');
  }
  const cwd = args.cwd || directory;
  if (!path.isAbsolute(cwd) || !fs.statSync(cwd).isDirectory()) throw Error('工作目录不存在');
  signal.throwIfAborted();
  try {
    const result = await run(args.command, argv, { cwd, env: process.env, timeout: (args.timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS) * 1000, maxBuffer: 2 * 1024 * 1024 }, cancel => {
      const abort = () => cancel(); signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
      return () => signal.removeEventListener('abort', abort);
    });
    return {...result,successScope:'process'};
  } catch (error) {
    return { success: false, successScope:'process', error: error.message, stdout: error.stdout, stderr: error.stderr, exitCode: error.exitCode, meta: error.meta };
  }
}
async function executeCommands({commands,timeoutSeconds},{signal,execute}) {
  if(!Array.isArray(commands) || !commands.length || commands.length>20)throw Error('请提供1至20条顺序命令');
  for(const value of [timeoutSeconds,...commands.map(command=>command.timeoutSeconds)]) {
    if(value!==undefined && (!Number.isInteger(value) || value<1 || value>900))throw Error('timeoutSeconds必须是1至900的整数秒');
  }
  const results=[];
  for(const [index,command] of commands.entries()) {
    if(signal.aborted)return {success:false,successScope:'process',stopped:true,results,remaining:commands.slice(index)};
    const effectiveTimeoutSeconds=command.timeoutSeconds ?? timeoutSeconds ?? DEFAULT_COMMAND_TIMEOUT_SECONDS;
    let result;
    try{result=await execute({...command,timeoutSeconds:effectiveTimeoutSeconds});}catch(error){result={success:false,error:error.message};}
    results.push({index,command:command.command,arguments:command.arguments,...result,timeoutSeconds:effectiveTimeoutSeconds,successScope:'process'});
    if(result.success!==true || (typeof result.exitCode==='number' && result.exitCode!==0))return {success:false,successScope:'process',failedIndex:index,results,remaining:commands.slice(index+1)};
  }
  return {success:true,successScope:'process',results,remaining:[]};
}
module.exports = { executeCommand, executeCommands };
