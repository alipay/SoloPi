import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import {fileURLToPath} from 'node:url';
const require = createRequire(import.meta.url);
const Module = require('node:module');
const filename = fileURLToPath(new URL('../src/components/PerformanceTestPage.tsx',import.meta.url));
const source = fs.readFileSync(filename, 'utf8');
const code = require('@babel/core').transformSync(source, {filename, presets: [['@babel/preset-env', {targets:{node:'current'},modules:'commonjs'}], ['@babel/preset-react',{runtime:'automatic'}], '@babel/preset-typescript']}).code;
const loaded = new Module(filename); loaded.filename = filename; loaded.paths = Module._nodeModulePaths(path.dirname(filename)); loaded._compile(code, filename);
const { buildReportHtml, buildReportMarkdown, buildExportTrendSvg, exportReport } = loaded.exports;
const { saveTextExport } = require('../electron/save-text-export');
const report = { id:'test', name:'Report <unsafe> | test', createdAt:'2026-10-23T01:00:00Z', serial:'device', packageName:'example.app', packageVersion:'1', runtime:'android', intervalSeconds:0,
  samples: Array.from({length:2707}, (_,i)=>({timestamp:new Date(1792717200000+i*4000).toISOString(), serial:'device',packageName:'example.app',runtime:'android',cpuPercent:i===10?undefined:25,memoryKb:1024,threadCount:10,batteryTemperatureC:22})),
  crashes:{status:'stopped',count:0,scope:'device',events:[]} };

test('HTML is standalone, escaped and includes four vector images and ALL samples', () => {
  const html = buildReportHtml(report);
  assert.equal((html.match(/<svg /g)||[]).length,4);
  assert.ok(html.includes('xmlns="http://www.w3.org/2000/svg"'));
  assert.ok(html.includes('Report &lt;unsafe&gt;'));
  assert.ok(!html.includes('<unsafe>'));
  assert.ok(!/<(?:script|link)\b|(?:src|href)="(?:https?:|file:)/.test(html));
  assert.equal((html.match(/<tr>/g)||[]).length,2708);
  assert.ok(html.includes('22.0°C'));
  const charts = buildExportTrendSvg(report);
  assert.ok(charts.includes('虚线：可用 CPU'));
  assert.ok(!charts.includes('NaN'));
});

test('Markdown uses relative PNG references and escapes table cells', () => {
  const markdown = buildReportMarkdown({...report,samples:[{...report.samples[0],error:'bad | newline\n<script>'}]},'performance-images-test');
  assert.equal((markdown.match(/!\[/g)||[]).length,4);
  for(const name of ['cpu','memory','threads','temperature']) assert.ok(markdown.includes(`(performance-images-test/${name}.png)`));
  assert.ok(!markdown.includes('<svg'));
  assert.ok(markdown.includes('bad \\|'));
});

test('Markdown export saves real PNG assets with matching relative paths through the existing IPC', async () => {
  const original = {window:global.window,Image:global.Image,document:global.document};
  let payload;
  const png = Buffer.from([137,80,78,71,13,10,26,10]).toString('base64');
  global.window={glassbox:{ipcRenderer:{invoke:async(channel,value)=>{assert.equal(channel,'file:save-text');payload=value;return {success:true,filePath:'/chosen/report.md'};}}}};
  global.Image=class{set src(value){queueMicrotask(()=>this.onload());}};
  global.document={createElement:()=>({getContext:()=>({fillRect(){},drawImage(){}}),toDataURL:()=>`data:image/png;base64,${png}`})};
  try {
    assert.equal(await exportReport(report,'md'),'/chosen/report.md');
    assert.equal(payload.attachments.files.length,4);
    for(const file of payload.attachments.files) assert.ok(payload.content.includes(`${payload.attachments.directory}/${file.name}`));
    const dir=fs.mkdtempSync(path.join(os.tmpdir(),'performance-export-'));
    try { saveTextExport(path.join(dir,'report.md'),payload.content,payload.attachments);
      for(const file of payload.attachments.files) assert.ok(fs.readFileSync(path.join(dir,payload.attachments.directory,file.name)).equals(Buffer.from(png,'base64')));
      assert.throws(()=>saveTextExport(path.join(dir,'report.md'),'replacement',payload.attachments));
      assert.equal(fs.readFileSync(path.join(dir,'report.md'),'utf8'),payload.content);
    } finally {fs.rmSync(dir,{recursive:true,force:true});}
  } finally {Object.assign(global,original);}
});

test('asset paths cannot escape the save directory; failed writes remove new assets',()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'performance-export-'));
  try {
    assert.throws(()=>saveTextExport(path.join(dir,'report.md'),'x',{directory:'../escape',files:[]}));
    assert.throws(()=>saveTextExport(path.join(dir,'report.md'),'x',{directory:'performance-images-11111111-1111-1111-1111-111111111111',files:[{name:'../escape.png',base64:'AAA='}]}));
    const assetDir='performance-images-11111111-1111-1111-1111-111111111111';
    assert.throws(()=>saveTextExport(dir,'x',{directory:assetDir,files:[]}));
    assert.ok(!fs.existsSync(path.join(path.dirname(dir),assetDir)));
  } finally {fs.rmSync(dir,{recursive:true,force:true});}
});

test('empty report and unavailable metrics export without invalid coordinates',()=>{
  const html=buildReportHtml({...report,samples:[]});
  assert.ok(!html.includes('NaN'));
  assert.ok(html.includes('0 次采样'));
});

test('save cancellation and failure do not report success', async () => {
  const original=global.window;
  try {
    global.window={glassbox:{ipcRenderer:{invoke:async()=>({canceled:true})}}};
    assert.equal(await exportReport(report,'html'),null);
    global.window.glassbox.ipcRenderer.invoke=async()=>({success:false,error:'disk full'});
    await assert.rejects(exportReport(report,'html'),/disk full/);
  } finally {global.window=original;}
});
