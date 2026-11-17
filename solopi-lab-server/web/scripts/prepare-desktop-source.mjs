import {existsSync,lstatSync,readFileSync,readlinkSync,symlinkSync,unlinkSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
const source=resolve(process.env.SOLOPI_DESKTOP_SOURCE || (existsSync(new URL('../../../solopi-desktop/',import.meta.url))?fileURLToPath(new URL('../../../solopi-desktop/',import.meta.url)):resolve(dirname(fileURLToPath(import.meta.url)),'../..')),'src/components/report');
if(!existsSync(join(source,'ReportWorkbench.tsx')))throw Error('Set SOLOPI_DESKTOP_SOURCE to the shared Desktop checkout');
const target=resolve('.desktop-source');
if(existsSync(target)){if(!lstatSync(target).isSymbolicLink())throw Error('.desktop-source must be a generated link');if(readlinkSync(target)!==source)unlinkSync(target);}
if(!existsSync(target))symlinkSync(source,target,process.platform==='win32'?'junction':'dir');

const uiSource=resolve(source,'..');const uiTarget=resolve('.desktop-ui');
if(existsSync(uiTarget)){if(!lstatSync(uiTarget).isSymbolicLink())throw Error('.desktop-ui must be a generated link');if(readlinkSync(uiTarget)!==uiSource)unlinkSync(uiTarget);}
if(!existsSync(uiTarget))symlinkSync(uiSource,uiTarget,process.platform==='win32'?'junction':'dir');

const iconSource=resolve(uiSource,'../../node_modules/lucide-react');const iconTarget=resolve('.desktop-lucide');
if(existsSync(iconTarget)&&lstatSync(iconTarget).isSymbolicLink()&&readlinkSync(iconTarget)!==iconSource)unlinkSync(iconTarget);
if(!existsSync(iconTarget))symlinkSync(iconSource,iconTarget,process.platform==='win32'?'junction':'dir');

// Compile the exact shared chat utilities/Markdown typography, scoped to this
// host. No global preflight or second copy of the Desktop chat styles.
const {createRequire}=await import('node:module');
const require=createRequire(join(uiSource,'../../package.json'));
const postcss=require('postcss'),tailwind=require('tailwindcss');
const {writeFileSync}=await import('node:fs');
const chatFiles=['AgentExtensions.tsx','ui/dialog.tsx','AgentChat.tsx','AgentTurn.tsx','AgentMarkdown.tsx','AgentMessageAttachments.tsx'].map(file=>join(uiSource,file));
// Reuse Desktop base variables, design tokens and theme without global leaks.
const scope=':is(#server-superagent,#server-agent-extensions)';
const desktopConfig=require(join(uiSource,'../../tailwind.config.js'));
const config={...desktopConfig,content:[...chatFiles,resolve('src/pages/ServerAgent.tsx')],important:scope};
const base=await postcss([tailwind(config)]).process('@tailwind base;',{from:undefined});
base.root.walkRules(rule=>{rule.selectors=rule.selectors.map(selector=>{
 const local=selector.replace(/:root|:host|\bhtml\b|\bbody\b/g,scope);
 return local!==selector?local:`${scope} ${selector}`;
});});
const tokens=[];postcss.parse(readFileSync(join(uiSource,'../index.css'),'utf8')).walkRules(':root',rule=>tokens.push(`${scope}{${rule.nodes.map(n=>n.toString()).join(';')}}`));
const css=await postcss([tailwind({...config,corePlugins:{preflight:false}})]).process('@tailwind components;\n@tailwind utilities;',{from:undefined});
// Typography components do not honor Tailwind's important selector automatically.
css.root.walkRules(rule=>{if(rule.parent?.type==='atrule'&&/keyframes/.test(rule.parent.name))return;if(!rule.selector.includes('#server-superagent'))rule.selectors=rule.selectors.map(selector=>`${scope} ${selector}`);});
writeFileSync(resolve('.desktop-chat.css'),`#server-superagent{height:calc(100dvh - 160px);min-height:420px;color:#334155;font-family:ui-sans-serif,system-ui,sans-serif;line-height:1.5;}#server-superagent>div{height:100%;}#server-superagent :where(*,::before,::after){box-sizing:border-box;border-width:0;border-style:solid;}#server-superagent :where(button,input,textarea,select){font:inherit;color:inherit;background:transparent;border-radius:0;padding:0;}#server-superagent :where(button:hover){color:inherit;border-color:inherit;}#server-superagent :where(a){color:inherit;text-decoration:inherit;}#server-superagent :where(p,h1,h2,h3,h4,pre,dl,dd){margin:0;}#server-superagent :where(button:focus-visible,a:focus-visible,textarea:focus-visible){outline:2px solid #64748b;outline-offset:2px;}#server-superagent :where(svg){flex-shrink:0;}@media(max-width:640px){#server-superagent{height:calc(100dvh - 130px);}}\n`+base.root.toString()+tokens.join("\n")+css.root.toString());

const libTarget=resolve('.desktop-lib'),libSource=resolve(uiSource,'../lib');if(!existsSync(libTarget))symlinkSync(libSource,libTarget,process.platform==='win32'?'junction':'dir');
