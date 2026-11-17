import {mkdtempSync,cpSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join,resolve} from 'node:path';import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const client=process.env.SOLOPI_DESKTOP_SOURCE||(existsSync(new URL('../../../solopi-desktop/',import.meta.url))?fileURLToPath(new URL('../../../solopi-desktop/',import.meta.url)):fileURLToPath(new URL('../../',import.meta.url)));
if(!client||!existsSync(join(client,'webpack.report-viewer.cjs')))throw Error('Set SOLOPI_DESKTOP_SOURCE to the Desktop source checkout. The lab report must be built from its shared WorkflowEditor.');
const output=mkdtempSync(join(tmpdir(),'desktop-report-viewer-'));
try{
 const result=spawnSync(process.execPath,[join(resolve(client),'node_modules/webpack/bin/webpack.js'),'--config','webpack.report-viewer.cjs','--mode','production'],{cwd:resolve(client),env:{...process.env,REPORT_VIEWER_OUTPUT:output},stdio:'inherit'});
 if(result.status!==0)throw Error('Shared Desktop report viewer build failed');
 cpSync(output,resolve('dist'),{recursive:true});
}finally{rmSync(output,{recursive:true,force:true});}
