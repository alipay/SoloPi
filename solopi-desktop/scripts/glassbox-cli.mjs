#!/usr/bin/env node

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const CLI_SCRIPT_PATH = fileURLToPath(import.meta.url);
const CLI_SCRIPT_DIR = path.dirname(CLI_SCRIPT_PATH);
function getCliBuildIdentity() {
  const metadataPath = path.join(CLI_SCRIPT_DIR, 'runtime-build.json');
  if (fs.existsSync(metadataPath)) return JSON.parse(fs.readFileSync(metadataPath, 'utf8'));
  const packagePath = path.resolve(CLI_SCRIPT_DIR, '../package.json');
  const pkg = fs.existsSync(packagePath) ? JSON.parse(fs.readFileSync(packagePath, 'utf8')) : {};
  return { version: pkg.version || 'unknown', sourceSha256: crypto.createHash('sha256').update(fs.readFileSync(CLI_SCRIPT_PATH)).digest('hex'), packaged: false };
}
const CLI_BUILD_IDENTITY = getCliBuildIdentity();
const VERSION = CLI_BUILD_IDENTITY.version;
const backgroundModulePath=[path.join(CLI_SCRIPT_DIR,'background-runtime.cjs'),path.resolve(CLI_SCRIPT_DIR,'../electron/background-runtime.js')].find(p=>fs.existsSync(p));
const backgroundPolicy=createRequire(import.meta.url)(backgroundModulePath);
const require = createRequire(import.meta.url);
const failurePolicy = require([path.join(CLI_SCRIPT_DIR,'workflow-failure-policy.cjs'),path.join(CLI_SCRIPT_DIR,'../electron/workflow-failure-policy.js')].find(p=>fs.existsSync(p)));
const taskDeviceSelectionModule=[path.join(CLI_SCRIPT_DIR,'task-device-selection.cjs'),path.join(CLI_SCRIPT_DIR,'../electron/task-device-selection.js')].find(file=>fs.existsSync(file));
const selectionModule = [path.join(CLI_SCRIPT_DIR,'case-selection.cjs'),path.join(CLI_SCRIPT_DIR,'../electron/agent/case-selection.js')].find(file=>fs.existsSync(file));
const discoveryModule = [path.join(CLI_SCRIPT_DIR,'case-discovery.cjs'),path.join(CLI_SCRIPT_DIR,'../electron/agent/case-discovery.js')].find(file=>fs.existsSync(file));
const {resolveCaseSelection}=require(selectionModule),{listCases:discoverCases}=require(discoveryModule);
function scopeOptions(command){return {libraryId:getOption(command,'--library'),folderId:getOption(command,'--folder'),excludeFolderIds:getOptions(command,'--exclude-folder'),excludeCaseIds:getOptions(command,'--exclude-case')};}
const identityPath = [path.resolve(CLI_SCRIPT_DIR, 'product-identity.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/product-identity.js'), path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/product-identity.js')].find(p => fs.existsSync(p));
const {defaultDataDirectory} = require(identityPath);
const soloPiConverterPath = [path.resolve(CLI_SCRIPT_DIR, 'solopi-case-converter.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/solopi-case-converter.js'), path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/solopi-case-converter.js')].find(p => fs.existsSync(p));
const { convertSoloPiCase, pendingSteps, MAX_BYTES: SOLOPI_MAX_BYTES } = require(soloPiConverterPath);
const workflowLogTextPath = [path.resolve(CLI_SCRIPT_DIR, 'workflow-log-text.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/workflow-log-text.js'), path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/workflow-log-text.js')].find(p => fs.existsSync(p));
const { assertLogSampleExtraction } = require(workflowLogTextPath);
const androidTopPath = [path.resolve(CLI_SCRIPT_DIR, 'android-top.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/android-top.js'), path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/android-top.js')].find(p => fs.existsSync(p));
const { parseAndroidTopProcess } = require(androidTopPath);
const performanceBatteryPath = [path.resolve(CLI_SCRIPT_DIR, 'performance-battery.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/performance-battery.js'), path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/performance-battery.js')].find(p => fs.existsSync(p));
const { performanceBatteryMetrics } = require(performanceBatteryPath);
const adbErrorModulePath = [
  path.resolve(CLI_SCRIPT_DIR, 'adb-error.cjs'),
  path.resolve(CLI_SCRIPT_DIR, '../electron/adb-error.js'),
  path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/adb-error.js'),
].find((candidate) => fs.existsSync(candidate));
if (!adbErrorModulePath) {
  throw new Error('solopi-desktop CLI 缺少 ADB 错误分类模块 adb-error');
}
const {
  createAdbDiagnosticError,
  isMissingRemoteFileError,
} = require(adbErrorModulePath);
const taskEventsModulePath = [
  path.resolve(CLI_SCRIPT_DIR, 'workflow-task-events.cjs'),
  path.resolve(CLI_SCRIPT_DIR, '../electron/workflow-task-events.js'),
  path.resolve(CLI_SCRIPT_DIR, '../app.asar/electron/workflow-task-events.js'),
].find((candidate) => fs.existsSync(candidate));
if (!taskEventsModulePath) {
  throw new Error('solopi-desktop CLI 缺少任务事件模块 workflow-task-events');
}
const {
  isAuthoritativeTaskTerminal,
  rebuildTaskEvents,
  resolveAfterEventRevision,
} = require(taskEventsModulePath);

const taskVisibilityPath = [path.resolve(CLI_SCRIPT_DIR, 'task-visibility.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/task-visibility.js')].find(file => fs.existsSync(file));
const { assertTaskVisibility, readVisibleTasks, getVisibleTask, registerTaskSource, visibleTaskSummaries, getDevelopmentWorkspace } = require(taskVisibilityPath);

const performanceModulePath = [path.resolve(CLI_SCRIPT_DIR, 'workflow-performance.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/workflow-performance.js')].find(file => fs.existsSync(file));
const { attachPerformanceReportsToTaskCases, packagePerformanceReports, packageCasePerformanceReports } = require(performanceModulePath);

const gitRuntimeModulePath = [path.resolve(CLI_SCRIPT_DIR, 'git-runtime.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/git-runtime.js')].find(file => fs.existsSync(file));
function gitRuntimeCommand(command, args, options) {
  if (command !== 'git') return { command, args, env: options.env };
  if (!gitRuntimeModulePath) throw Object.assign(new Error('solopi-desktop CLI 缺少内置 Git 运行时模块，请修复安装'), { code: 'BUNDLED_GIT_LFS_UNAVAILABLE' });
  return require(gitRuntimeModulePath).gitRuntimeCommand(command, args, options);
}

const taskCaseQueryPath = [path.resolve(CLI_SCRIPT_DIR, 'task-case-query.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/task-case-query.js')].find(file => fs.existsSync(file));
if (!taskCaseQueryPath) throw Error('solopi-desktop CLI 缺少用例状态查询模块 task-case-query');
const {caseQueryOverview,taskResultReceipt} = require(taskCaseQueryPath);

function caseQueryOptionsForCli(command) {
  const options={};
  for (const [flag,key] of [['--offset','offset'],['--limit','limit']]) if(command.includes(flag)) {
    const value=getOption(command,flag);
    if(!/^\d+$/.test(value || '')) throw Error(`${flag} 必须提供非负整数`);
    options[key]=Number(value);
  }
  if(command.includes('--status')) {
    const values=getOptions(command,'--status');
    if(values.length!==command.filter(v=>v==='--status').length || !values.length || values.some(v=>v.startsWith('--') || !v.trim())) throw Error('--status 必须提供用例状态');
    options.statuses=[...new Set(values.flatMap(v=>v.split(',')).map(v=>v.trim()))];
    if(options.statuses.length===1 && options.statuses[0]==='all') delete options.statuses;
  }
  if(command.includes('--case-id')) options.caseIds=getOptions(command,'--case-id');
  // Validate before loading a report or performing any report maintenance.
  caseQueryOverview({cases:[]},options);
  return options;
}

let resolvedAdbPathForCli = '';
let resolvedAdbPathSourceForCli = '';

const defaultComponents = [
  {
    id: 'template-pc-command',
    name: '通用 PC 命令',
    description: '在运行 solopi-desktop 的当前电脑执行命令，不依赖手机或眼镜设备',
    kind: 'pc_command',
    device: 'pc',
    timeoutSeconds: 30,
    commandTemplate: '',
    params: [],
  },
  {
    id: 'component-launch-activity',
    name: '拉起 Activity',
    description: '拉起指定 Activity，并校验 Activity 已进入前台',
    kind: 'activity',
    device: 'phone',
    timeoutSeconds: 5,
    commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}}',
    params: [
      { key: 'packageName', label: '包名', inputType: 'text', defaultValue: '${defaults.phonePackage}' },
      { key: 'activity', label: 'Activity', inputType: 'text', defaultValue: '' },
    ],
  },
  {
    id: 'component-launch-test-page',
    name: '拉起调试 Activity',
    description: '通过通用 am start 命令打开被测应用的调试 Activity',
    kind: 'adb',
    device: 'phone',
    timeoutSeconds: 10,
    commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}} {{intentArgs}}',
    params: [
      { key: 'packageName', label: '包名', inputType: 'text', defaultValue: '${defaults.phonePackage}' },
      { key: 'activity', label: 'Activity', inputType: 'text', defaultValue: '' },
      { key: 'intentArgs', label: 'Intent 参数', inputType: 'text', defaultValue: '' },
    ],
  },
  {
    id: 'component-scanpay',
    name: '旧业务广播场景',
    description: '历史业务兼容组件：通过广播进入旧业务测试场景，默认组件列表不展示',
    legacyBusiness: true,
    platformScope: 'legacy-business-compatibility',
    replacementHint: 'Use template-adb-command with an app-specific broadcast action in a business case bundle.',
    kind: 'adb',
    device: 'glasses',
    timeoutSeconds: 10,
    commandTemplate: "adb -s {{serial}} shell \"am broadcast -a {{action}} --es params '{{params}}'\"",
    params: [
      { key: 'action', label: 'Action', inputType: 'text', defaultValue: '' },
      {
        key: 'params',
        label: 'Params',
        inputType: 'json',
        defaultValue: '',
      },
    ],
  },
  {
    id: 'component-send-confirm-audio',
    name: '音频输入与模拟',
    description: '录入音频、推送到设备并执行可配置 ADB 命令触发模拟输入',
    kind: 'audio',
    device: 'phone',
    timeoutSeconds: 30,
    commandTemplate: '',
    params: [
      { key: 'pathExtraKey', label: '路径 Extra Key', inputType: 'text', defaultValue: 'audio_path' },
      { key: 'sourceType', label: '音频来源', inputType: 'text', defaultValue: 'file' },
      { key: 'outputFormat', label: '最终音频格式', inputType: 'text', defaultValue: 'pcm' },
      { key: 'sampleFormat', label: '采样格式', inputType: 'text', defaultValue: 'AV_SAMPLE_FMT_S16' },
      { key: 'sampleRate', label: '采样率', inputType: 'number', defaultValue: '16000' },
      { key: 'trailingSilenceMs', label: '尾部静音（ms）', inputType: 'number', defaultValue: '800' },
      { key: 'localPath', label: '本地音频文件', inputType: 'text', defaultValue: '' },
      { key: 'remotePath', label: '手机内音频路径', inputType: 'text', defaultValue: '/sdcard/Android/data/${defaults.phonePackage}/files/' },
      { key: 'ttsText', label: 'TTS 文本', inputType: 'textarea', defaultValue: '' },
    ],
  },
  {
    id: 'component-image-mock',
    name: '旧业务图片 Mock',
    description: '历史业务兼容组件：推送图片并通过旧业务广播注入 mock 图片路径，默认组件列表不展示',
    legacyBusiness: true,
    platformScope: 'legacy-business-compatibility',
    replacementHint: 'Use template-image-mock; keep image push on glasses and ACTION_SCANPAY broadcast on phone.',
    kind: 'image_mock',
    device: 'phone',
    timeoutSeconds: 30,
    commandTemplate: '',
    params: [
      { key: 'imagePath', label: '图片路径或 URL', inputType: 'text', defaultValue: '' },
      { key: 'localPath', label: '本地图片文件', inputType: 'text', defaultValue: '' },
      { key: 'pushDevice', label: '图片推送设备', inputType: 'text', defaultValue: 'glasses' },
      { key: 'remoteImagePath', label: '设备侧图片路径', inputType: 'text', defaultValue: '/sdcard/Android/data/${defaults.glassesPackage}/files/' },
      { key: 'commandDevice', label: 'ADB 执行设备', inputType: 'text', defaultValue: 'phone' },
      { key: 'payinitasr', label: 'PAY_INIT_ASR', inputType: 'text', defaultValue: '支付一分钱' },
    ],
  },
  {
    id: 'component-tts-text-assert',
    name: '日志文本提取断言',
    description: '从 logcat 中提取文本，并与期望文本比对',
    kind: 'tts_assert',
    device: 'glasses',
    timeoutSeconds: 10,
    commandTemplate: '',
    params: [
      { key: 'sampleLog', label: '日志样例', inputType: 'textarea', defaultValue: '' },
      { key: 'extractRegex', label: '提取正则', inputType: 'textarea', defaultValue: '', required: true },
      { key: 'sampleExtractText', label: '提取内容样例', inputType: 'text', defaultValue: '' },
      { key: 'expectedText', label: '期望文本', inputType: 'text', defaultValue: '${variables.expectedTtsText}', required: true },
      { key: 'matchOperator', label: '比较方式', inputType: 'text', defaultValue: 'equals' },
      { key: 'caseSensitive', label: '区分大小写', inputType: 'text', defaultValue: 'true' },
      { key: 'clearBeforeStart', label: '进入节点前清空 logcat', inputType: 'text', defaultValue: 'false' },
      { key: 'captureScreenshotOnPass', label: '检测时截屏', inputType: 'text', defaultValue: 'true' },
      { key: 'extractVariableEnabled', label: '提取为变量', inputType: 'text', defaultValue: 'false' },
      { key: 'extractVariableName', label: '变量名', inputType: 'text', defaultValue: '' },
    ],
  },
  {
    id: 'component-json-log-assert',
    name: 'JSON 日志字段断言',
    description: '用正则定位 logcat 日志，递归解析转义 JSON 后校验字段条件',
    kind: 'json_assert',
    device: 'glasses',
    timeoutSeconds: 10,
    commandTemplate: '',
    params: [
      { key: 'lineRegex', label: 'JSON 提取正则', inputType: 'textarea', defaultValue: '', required: true },
      { key: 'conditions', label: '字段条件', inputType: 'json', defaultValue: '[]', required: true },
      { key: 'caseSensitive', label: '正则区分大小写', inputType: 'text', defaultValue: 'true' },
      { key: 'clearBeforeStart', label: '进入节点前清空 logcat', inputType: 'text', defaultValue: 'true' },
      { key: 'captureScreenshotOnPass', label: '检测时截屏', inputType: 'text', defaultValue: 'true' },
      { key: 'extractVariableEnabled', label: '提取为变量', inputType: 'text', defaultValue: 'false' },
      { key: 'extractVariableName', label: '变量名', inputType: 'text', defaultValue: '' },
    ],
  },
  {
    id: 'component-llm-assert',
    name: 'LLM 语义断言',
    description: '结合 variables、当前日志和用户诉求，由大模型判断当前状态是否符合预期',
    kind: 'llm_assert',
    device: 'glasses',
    timeoutSeconds: 45,
    commandTemplate: '',
    params: [
      { key: 'providerId', label: '模型配置', inputType: 'text', defaultValue: '' },
      { key: 'model', label: '模型名称', inputType: 'text', defaultValue: '' },
      { key: 'sampleLog', label: '日志样例', inputType: 'textarea', defaultValue: '' },
      { key: 'samplePayload', label: '提取内容', inputType: 'textarea', defaultValue: '' },
      { key: 'lineRegex', label: '当前日志匹配正则', inputType: 'textarea', defaultValue: '', required: true },
      { key: 'assertionPrompt', label: '断言诉求', inputType: 'textarea', defaultValue: '请根据前置提取的数据 {{variables.extractedJson}} 和当前日志内容，判断当前状态是否符合预期。请重点核对关键字段是否一致；如果不一致，请在 reason 中说明差异。', required: true },
      { key: 'caseSensitive', label: '正则区分大小写', inputType: 'text', defaultValue: 'true' },
      { key: 'clearBeforeStart', label: '进入节点前清空 logcat', inputType: 'text', defaultValue: 'false' },
      { key: 'temperature', label: 'Temperature', inputType: 'number', defaultValue: '0.1' },
      { key: 'maxTokens', label: '最大输出 Token', inputType: 'number', defaultValue: '512' },
      { key: 'captureScreenshotOnPass', label: '检测时截屏', inputType: 'text', defaultValue: 'true' },
      { key: 'extractVariableEnabled', label: '提取为变量', inputType: 'text', defaultValue: 'false' },
      { key: 'extractVariableName', label: '变量名', inputType: 'text', defaultValue: '' },
    ],
  },
];

const templateComponents = [
  {
    id: 'template-adb-command',
    name: '通用 ADB 命令',
    description: '通过 adb 命令模板执行通用动作',
    kind: 'adb',
    device: 'phone',
    timeoutSeconds: 10,
    commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}} {{intentArgs}}',
    params: [
      { key: 'packageName', label: '包名', inputType: 'text', defaultValue: '${defaults.phonePackage}' },
      { key: 'activity', label: 'Activity', inputType: 'text', defaultValue: '' },
      { key: 'intentArgs', label: 'Intent 参数', inputType: 'text', defaultValue: '' },
    ],
  },
  {
    ...defaultComponents.find((component) => component.id === 'component-launch-activity'),
    id: 'template-launch-activity',
    name: '拉起 Activity',
    description: '拉起指定 Activity 并校验已进入前台',
  },
  {
    ...defaultComponents.find((component) => component.id === 'component-send-confirm-audio'),
    id: 'template-audio-input',
    name: '音频输入与模拟',
    description: '选择/录制音频，push 后触发 adb 命令',
  },
  {
    id: 'template-image-mock',
    name: '图片 Mock',
    description: '选择图片，push 到设备后执行 Mock 命令',
    legacyBusiness: true,
    platformScope: 'legacy-business-compatibility',
    replacementHint: 'Use a generic image/mock template and keep business-specific broadcast params in case data.',
    kind: 'image_mock',
    device: 'phone',
    timeoutSeconds: 30,
    commandTemplate: '',
    params: [
      { key: 'imagePath', label: '图片路径或 URL', inputType: 'text', defaultValue: '' },
      { key: 'pushDevice', label: '图片推送设备', inputType: 'text', defaultValue: 'glasses' },
      { key: 'remoteImagePath', label: '设备侧图片路径', inputType: 'text', defaultValue: '/sdcard/Android/data/${defaults.glassesPackage}/files/' },
      { key: 'commandDevice', label: 'ADB 执行设备', inputType: 'text', defaultValue: 'phone' },
      { key: 'payinitasr', label: 'PAY_INIT_ASR', inputType: 'text', defaultValue: '支付一分钱' },
    ],
  },
  {
    id: 'template-mobile-ui-action',
    name: '手机 UI 操作',
    description: '基于手机当前 UI 元素执行点击、输入、滑动或返回',
    kind: 'mobile_ui_action',
    device: 'phone',
    timeoutSeconds: 10,
    commandTemplate: '',
    params: [
      { key: 'action', label: '操作类型', inputType: 'text', defaultValue: 'tap' },
      {
        key: 'selector',
        label: '元素选择器',
        inputType: 'json',
        defaultValue: '{\n  "resourceId": "",\n  "text": "",\n  "contentDesc": "",\n  "className": "",\n  "bounds": "",\n  "xRatio": "",\n  "yRatio": ""\n}',
      },
      { key: 'inputText', label: '输入文本', inputType: 'text', defaultValue: '' },
      { key: 'direction', label: '手指滑动方向', inputType: 'text', defaultValue: 'up' },
      { key: 'distancePercent', label: '滑动距离(元素百分比)', inputType: 'number', defaultValue: '100' },
      { key: 'swipeDurationMs', label: '滑动时长(ms)', inputType: 'number', defaultValue: '300' },
      { key: 'tapPosition', label: '元素内点击位置', inputType: 'text', defaultValue: 'center' },
      { key: 'tapInsetXPx', label: '横向内缩(px)', inputType: 'number', defaultValue: '5' },
      { key: 'tapInsetYPx', label: '纵向内缩(px)', inputType: 'number', defaultValue: '5' },
      { key: 'clearBeforeInput', label: '输入前清空', inputType: 'text', defaultValue: 'false' },
      { key: 'matchMode', label: '匹配方式', inputType: 'text', defaultValue: 'auto' },
      { key: 'pollIntervalMs', label: '轮询间隔(ms)', inputType: 'number', defaultValue: '250' },
      {
        key: 'swipe',
        label: '滑动参数',
        inputType: 'json',
        defaultValue: '{\n  "startXRatio": "0.5",\n  "startYRatio": "0.8",\n  "endXRatio": "0.5",\n  "endYRatio": "0.2",\n  "durationMs": "400"\n}',
      },
    ],
  },
  {
    id: 'template-mobile-ui-assert',
    name: '手机 UI 元素校验',
    description: '校验手机当前页面在超时时间内出现指定元素',
    kind: 'mobile_ui_assert',
    device: 'phone',
    timeoutSeconds: 10,
    commandTemplate: '',
    params: [
      {
        key: 'selector',
        label: '元素选择器',
        inputType: 'json',
        defaultValue: '{\n  "resourceId": "",\n  "text": "",\n  "contentDesc": "",\n  "className": "",\n  "bounds": "",\n  "xRatio": "",\n  "yRatio": ""\n}',
      },
      { key: 'matchMode', label: '匹配方式', inputType: 'text', defaultValue: 'auto' },
      { key: 'pollIntervalMs', label: '轮询间隔(ms)', inputType: 'number', defaultValue: '250' },
      { key: 'captureScreenshotOnPass', label: '检测时截屏', inputType: 'text', defaultValue: 'true' },
    ],
  },
  {
    ...defaultComponents.find((component) => component.id === 'component-tts-text-assert'),
    id: 'template-tts-assert',
    name: '日志文本提取断言',
    description: '从日志提取文本并比对期望值',
  },
  {
    id: 'template-json-assert',
    name: 'JSON 日志字段断言',
    description: '正则定位日志，解析 JSON 后校验字段',
    kind: 'json_assert',
    device: 'glasses',
    timeoutSeconds: 45,
    commandTemplate: '',
    params: [
      { key: 'lineRegex', label: 'JSON 提取正则', inputType: 'textarea', defaultValue: '' },
      { key: 'conditions', label: '字段条件', inputType: 'json', defaultValue: '[]' },
      { key: 'caseSensitive', label: '正则区分大小写', inputType: 'text', defaultValue: 'true' },
      { key: 'clearBeforeStart', label: '进入节点前清空 logcat', inputType: 'text', defaultValue: 'false' },
      { key: 'captureScreenshotOnPass', label: '检测时截屏', inputType: 'text', defaultValue: 'true' },
      { key: 'extractVariableEnabled', label: '提取为变量', inputType: 'text', defaultValue: 'false' },
      { key: 'extractVariableName', label: '变量名', inputType: 'text', defaultValue: '' },
    ],
  },
  {
    ...defaultComponents.find((component) => component.id === 'component-llm-assert'),
    id: 'template-llm-assert',
    name: 'LLM 语义断言',
    description: '结合 variables 和当前日志做语义断言',
  },
];

const builtinComponents = [...defaultComponents, ...templateComponents];

const supportedComponentKinds = new Set([
  'adb',
  'pc_command',
  'activity',
  'audio',
  'image_mock',
  'mobile_ui_action',
  'mobile_ui_assert',
  'tts_assert',
  'json_assert',
  'llm_assert',
]);

function isSupportedComponent(component = {}) {
  return supportedComponentKinds.has(component.kind || 'adb');
}

function normalizeLegacyImageMockComponentForCli(component) {
  if (!component || component.id !== 'component-image-mock') {
    return component;
  }

  const requiredParams = [
    { key: 'imagePath', label: '图片路径或 URL', inputType: 'text', defaultValue: '' },
    { key: 'localPath', label: '本地图片文件', inputType: 'text', defaultValue: '' },
    { key: 'pushDevice', label: '图片推送设备', inputType: 'text', defaultValue: 'glasses' },
    { key: 'remoteImagePath', label: '设备侧图片路径', inputType: 'text', defaultValue: '/sdcard/Android/data/${defaults.glassesPackage}/files/' },
    { key: 'commandDevice', label: 'ADB 执行设备', inputType: 'text', defaultValue: 'phone' },
    { key: 'payinitasr', label: 'PAY_INIT_ASR', inputType: 'text', defaultValue: '支付一分钱' },
  ];
  const paramMap = new Map((component.params || []).map((param) => [param.key, param]));
  requiredParams.forEach((param) => {
    paramMap.set(param.key, { ...(paramMap.get(param.key) || {}), ...param });
  });

  return {
    ...component,
    description: component.description || '历史业务兼容组件：推送图片并通过旧业务广播注入 mock 图片路径，默认组件列表不展示',
    legacyBusiness: true,
    platformScope: 'legacy-business-compatibility',
    replacementHint: 'Use template-image-mock; keep image push on glasses and ACTION_SCANPAY broadcast on phone.',
    kind: 'image_mock',
    device: 'phone',
    timeoutSeconds: Math.max(Number(component.timeoutSeconds || 0), 30) || 30,
    commandTemplate: component.commandTemplate || '',
    params: [...paramMap.values()],
  };
}

function mergeComponentForCli(baseComponent, overrideComponent) {
  if (!baseComponent) {
    return normalizeLegacyImageMockComponentForCli(overrideComponent);
  }

  if (!overrideComponent) {
    return normalizeLegacyImageMockComponentForCli(baseComponent);
  }

  const paramMap = new Map((baseComponent.params || []).map((param) => [param.key, param]));
  for (const param of Array.isArray(overrideComponent.params) ? overrideComponent.params : []) {
    if (param?.key) {
      paramMap.set(param.key, param);
    }
  }

  return normalizeLegacyImageMockComponentForCli({
    ...baseComponent,
    ...overrideComponent,
    params: [...paramMap.values()],
  });
}

const validStepTypes = new Set([
  'start',
  'if',
  'component',
  'http_request',
  'llm_text_generate',
  'tts_synthesize',
  'launch_test_page',
  'broadcast_scene',
  'send_audio',
  'wait',
  'push_audio',
  'debug_forward',
  'rpc_assert',
  'end',
]);
const validDevices = new Set(['phone', 'glasses', 'pc']);
const sdkEnvironmentMap = {
  PRE: 'ENV_PRE',
  GRAY: 'ENV_GRAY',
  STABLE: 'ENV_STABLE',
  ONLINE: 'ENV_ONLINE',
};
const rawSdkEnvironmentMap = Object.fromEntries(
  Object.entries(sdkEnvironmentMap).map(([key, value]) => [value, key])
);
const defaultPhonePackageName = '';

function normalizeStressOptionsFromCommand(command) {
  const supported = ['--stress-rounds', '--stress-minutes', '--stress-logs'];
  if (command.some((arg) => arg.startsWith('--stress') && !supported.includes(arg))) {
    throw new Error('未知压测参数；请使用 --stress-rounds N 或 --stress-minutes N，以及可选 --stress-logs');
  }
  const rounds = command.filter((arg) => arg === '--stress-rounds').length;
  const minutes = command.filter((arg) => arg === '--stress-minutes').length;
  const logs = command.filter((arg) => arg === '--stress-logs').length;
  if (!rounds && !minutes && !logs) return undefined;
  if (rounds + minutes !== 1 || logs > 1) {
    throw new Error('压测必须且只能指定一次 --stress-rounds 或 --stress-minutes');
  }
  const flag = rounds ? '--stress-rounds' : '--stress-minutes';
  const raw = command[command.indexOf(flag) + 1];
  const value = Number(raw);
  if (!/^\d+$/.test(raw || '') || !Number.isSafeInteger(value) || value < 1 || value > 100000) {
    throw new Error(`${flag} 必须为 1–100000 的整数`);
  }
  const logTarget = logs ? command[command.indexOf('--stress-logs') + 1] : 'glasses';
  if (!['phone', 'glasses', 'all', 'none'].includes(logTarget)) {
    throw new Error('--stress-logs 必须为 phone、glasses、all 或 none');
  }
  return { mode: rounds ? 'rounds' : 'duration', value,
    phoneLog: logTarget === 'phone' || logTarget === 'all',
    glassesLog: logTarget === 'glasses' || logTarget === 'all' };
}

function installCodexSkill({ force = false, source, skillsRoot } = {}) {
  const sourceRoot = source || [
    path.resolve(CLI_SCRIPT_DIR, '../skills/solopi-desktop-cli'),
  ].find((candidate) => fs.existsSync(path.join(candidate, 'SKILL.md')));
  if (!sourceRoot || !fs.existsSync(path.join(sourceRoot, 'SKILL.md'))) {
    throw new Error('安装包缺少 solopi-desktop-cli Skill，请重新安装完整 solopi-desktop');
  }
  const root = skillsRoot || path.join(process.env.CODEX_HOME || path.join(os.homedir(), '.codex'), 'skills');
  const destination = path.join(root, 'solopi-desktop-cli');
  if (fs.existsSync(destination) && fs.realpathSync(destination) === fs.realpathSync(sourceRoot)) {
    return { success: true, skill: 'solopi-desktop-cli', path: destination, message: 'Skill 已链接到当前来源，无需复制；新建 Codex 会话加载更新。' };
  }
  if (fs.existsSync(destination) && !force) {
    throw new Error(`Skill 已存在：${destination}；更新请显式添加 --force（替换此 Skill 目录）`);
  }
  if (fs.existsSync(destination) && fs.lstatSync(destination).isSymbolicLink()) {
    throw new Error('Skill 目标为符号链接，请先手动处理，未写入');
  }
  fs.mkdirSync(root, { recursive: true });
  const staging = fs.mkdtempSync(path.join(root, '.solopi-desktop-skill-'));
  const backup = `${staging}-previous`;
  try {
    fs.cpSync(sourceRoot, staging, { recursive: true, dereference: true });
    if (fs.existsSync(destination)) fs.renameSync(destination, backup);
    try { fs.renameSync(staging, destination); }
    catch (error) {
      if (fs.existsSync(backup)) fs.renameSync(backup, destination);
      throw error;
    }
    if (fs.existsSync(backup)) fs.rmSync(backup, { recursive: true });
  } finally {
    if (fs.existsSync(staging)) fs.rmSync(staging, { recursive: true });
  }
  return { success: true, skill: 'solopi-desktop-cli', path: destination,
    message: 'Skill 已安装。请在 Codex 中新建会话；若仍未发现 Skill，重新启动 Codex。' };
}

function printHelp() {
  console.log(`solopi-desktop CLI ${VERSION}

Usage:
  solopi-desktop logs export [--output /path/solopi-desktop-logs.json.gz] [--json]
  solopi-desktop quick-actions <list|show|create|import-script|update|import-git|export-git|query|execute|visibility|remove> [--file request.json] [--json]
  solopi-desktop quick-actions --help
  solopi-desktop assert generate --kind json|text (--sample-log <text> | --log <file>) --target <text> [--json]
  solopi-desktop assert try --kind json|text (--sample-log <text> | --log <file>) --line-regex <re> [--conditions <json>] [--json]
  solopi-desktop config import-team --file <team.json> [--headless] [--dry-run] [--json]
  solopi-desktop config get [--headless] [--json]
  solopi-desktop config patch --file <patch.json> [--headless] [--api-key-env ENV] [--dry-run] [--json]
  solopi-desktop battery import --file <zip|txt|log> | --serial <SN> [--json]
  solopi-desktop battery status|cancel <jobId> [--json]
  solopi-desktop battery history [--json]
  solopi-desktop battery show <reportKey> [--json]
  solopi-desktop performance start --serial <SN> --package <package> [--role glasses|phone] [--runtime android|harmony] [--duration 60] [--interval 5] [--json]
  solopi-desktop performance status|stop|report <taskId> [--json]
  solopi-desktop components list [--json] [--include-legacy-business]
  solopi-desktop reports import <file.glassreport> [--app /Applications/solopi-desktop.app] [--json]
  solopi-desktop devices list [--json]
  solopi-desktop cases list [--json] [--query <text>] [--folder <folderId>] [--library <libraryId>] [--tag <tag>] [--review-status <status>]
  solopi-desktop cases libraries [--json]
  solopi-desktop cases configure --library <id|name> [--name <name>] [--repo <url>] [--branch <branch>] [--create] [--dry-run] [--json]
  solopi-desktop cases show <caseId> [--json]
  solopi-desktop cases pull --library <libraryId|name> [--dry-run] [--json]
  solopi-desktop cases update <caseId> --file <case.json> [--preserve-source-samples] [--dry-run] [--json]
  solopi-desktop cases import-solopi --file <SoloPi.json> --out <new-desktop-case.json> [--phone SN] [--json]
  solopi-desktop cases create --file <case.json> --library <libraryId> [--folder <folderId>] [--dry-run] [--json]
  solopi-desktop cases push --library <libraryId|name> --message <msg> [--dry-run] [--json]
  solopi-desktop tasks list [--json]
  solopi-desktop tasks show <taskId> [--status failed|success|running|stopped|pending|all] [--offset N] [--limit 1-50] [--json]
  solopi-desktop tasks watch <taskId> --jsonl [--after <revision|taskRevision|eventId>] [--poll-interval-ms <ms>]
  solopi-desktop tasks stop <taskId> [--force] [--json]
  solopi-desktop tasks remove <taskId> [<taskId> ...] [--dry-run] [--limit N] [--purge-artifacts] [--backup dir] [--json]
  solopi-desktop tasks clean [--query text] [--older-than Nd|Nm] [--before yyyy-MM-dd] [--status success|failed|stopped] [--keep id ...] [--limit N] [--purge-artifacts] [--backup dir] [--dry-run] [--json]
  solopi-desktop reports list [--json]
  solopi-desktop tasks result <taskId> [--offset N] [--limit 1-20] [--json]
  solopi-desktop reports show <taskId> [--case-id <caseId>] [--summary] [--status failed|success|running|stopped|pending|all] [--offset N] [--limit 1-50] [--json]
  --status filters case execution status (repeat or comma-separate); filtered queries return compact cases with matchedCaseCount/nextOffset. Whole-task summary is unchanged. --case-id intersects the filter.
  solopi-desktop reports reindex [--dry-run] [--status success|failed|stopped] [--json]
  solopi-desktop doctor [--json]
  solopi-desktop env get [--phone <serial>] [--package <package>] [--json]
  solopi-desktop env set PRE|GRAY|STABLE|ONLINE [--phone <serial>] [--package <package>] [--force-env-restart] [--json]
  solopi-desktop cases validate <file> [--json]
  solopi-desktop run case <case-file|caseId> [--case-id <id>] [--phone <serial>] [--glasses <serial>] [--phone-package <package>] [--glasses-package <package>] [--env PRE|GRAY|STABLE|ONLINE] [--force-env-restart] [--json] [--no-screen-mirror] [--record-glasses-screen] [--record-phone-screen] [--show-phone-screen] [--show-glasses-screen] [--no-keep-screen-awake] [--report-out <file>] [--no-report] [--perf phone|glasses|all]
  solopi-desktop run task --library <id> --exclude-folder <id> --expected-count <N> [--selection-revision <hash>] [--json]\n  solopi-desktop run task [file] [--stress-rounds <N> | --stress-minutes <N>] [--stress-logs phone|glasses|all|none] [--case-id <id> ...] [--task-name <name>] [--phone <serial>] [--glasses <serial>] [--phone-package <package>] [--glasses-package <package>] [--env PRE|GRAY|STABLE|ONLINE] [--force-env-restart] [--json] [--record-glasses-screen] [--record-phone-screen] [--show-phone-screen] [--show-glasses-screen] [--wait] [--report-out <file>] [--perf phone|glasses|all]
  solopi-desktop skills install codex [--force] [--json]
  solopi-desktop --help

Installed app:
  Set SOLOPI_DESKTOP_CLI to the CLI inside the user's existing solopi-desktop installation.
  "$SOLOPI_DESKTOP_CLI" doctor --json
  "$SOLOPI_DESKTOP_CLI" devices list --json
  "$SOLOPI_DESKTOP_CLI" cases list --json
  "$SOLOPI_DESKTOP_CLI" cases libraries --json
  "$SOLOPI_DESKTOP_CLI" cases pull --library <libraryId|name> --dry-run --json
  "$SOLOPI_DESKTOP_CLI" cases push --library <libraryId|name> --message "chore: update cases" --dry-run --json
  "$SOLOPI_DESKTOP_CLI" run case ./case.json --json --env PRE
  "$SOLOPI_DESKTOP_CLI" run task --case-id CASE_A --case-id CASE_B --json
  "$SOLOPI_DESKTOP_CLI" tasks show <taskId> --json
  "$SOLOPI_DESKTOP_CLI" tasks watch <taskId> --jsonl
`);
}

function printRunTaskHelp() {
  console.log(`solopi-desktop CLI ${VERSION}

Usage:
  solopi-desktop run task [file] [--stress-rounds <N> | --stress-minutes <N>] [--stress-logs phone|glasses|all|none] [--case-id <id> ...] [--task-name <name>] [--phone <serial>] [--glasses <serial>] [--phone-package <package>] [--glasses-package <package>] [--env PRE|GRAY|STABLE|ONLINE] [--force-env-restart] [--json] [--record-glasses-screen] [--record-phone-screen] [--show-phone-screen] [--show-glasses-screen] [--wait] [--report-out <file>] [--perf phone|glasses|all]

Examples:
  solopi-desktop run task --case-id CASE_A --case-id CASE_B --json
  solopi-desktop run task --case-id CASE_A --phone PHONE_SN --glasses GLASSES_SN --json
  设备集合不重叠的任务可并行；同一 SN 在运行及收尾期间返回 TEST_TASK_BUSY。
  设备路由失败请修复配置，禁止绕过平台手工执行用例。
  solopi-desktop run task ./bundle.json --case-id CASE_A --case-id CASE_B --env PRE --record-glasses-screen --json

Notes:
  Stress: --stress-rounds 100 or --stress-minutes 30 (integer 1–100000).
  Each round runs all selected cases in order. Duration mode finishes the current case before stopping.
  Optional ART stack snapshots: --thread-stacks --perf glasses --stack-mode manual|interval|checkpoint|failure
  Package overrides are optional: --phone-package / --glasses-package.
  Precedence: explicit override > each case defaults > device defaults. Empty package is allowed for steps that do not need one.
  --env-package selects only the environment-file package; it does not override workflow packages.
  Limits: --stack-interval-ms 60000 (minimum 30000), --stack-max-count 10, --stack-max-bytes 16777216.
  Checkpoint mode: repeat --stack-checkpoint <stepId> to collect before that node, before configured cleanup.
  Manual: tasks capture-stacks <taskId> --json. Evidence: reports show <taskId> --json and exported .glassreport.
  Stack snapshots add overhead and do not measure thread CPU time; permission/identity/trace failures remain diagnostics.
  Stress logs default to glasses; recordings default off. Use tasks stop to end early.
  run task submits through the CLI-launched headless runner. It does not require opening the solopi-desktop UI.
  Use tasks show <taskId> --json and reports show <taskId> --summary --json to inspect async results.
`);
}

function printRunCaseHelp() {
  console.log(`solopi-desktop CLI ${VERSION}

Usage:
  solopi-desktop run case <case-file|caseId> [--case-id <id>] [--phone <serial>] [--glasses <serial>] [--phone-package <package>] [--glasses-package <package>] [--env PRE|GRAY|STABLE|ONLINE] [--force-env-restart] [--json] [--no-screen-mirror] [--record-glasses-screen] [--record-phone-screen] [--show-phone-screen] [--show-glasses-screen] [--no-keep-screen-awake] [--report-out <file>] [--no-report] [--perf phone|glasses|all]

Examples:
  solopi-desktop run case ./case.json --json --env PRE
  solopi-desktop run case CASE_ID --json --record-glasses-screen

Package overrides (optional): --phone-package / --glasses-package.
Precedence: explicit override > case defaults > device defaults.
--env-package is only the environment-file target, not the workflow package.

Notes:
  run case is the single-case shortcut for run task and uses the same CLI-launched headless runner.
`);
}

function hasFlag(args, flag) {
  return args.includes(flag);
}

function getOption(args, name) {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : '';
}

function buildCaseLibraryRequestForCli(command) {
  const request = {};
  for (const [flag, key] of [['--library', 'library'], ['--name', 'name'], ['--repo', 'repoUrl'], ['--branch', 'branch'], ['--message', 'message']]) {
    if (hasFlag(command, flag)) request[key] = getOption(command, flag);
  }
  if (hasFlag(command, '--dry-run')) request.dryRun = true;
  if (hasFlag(command, '--create')) request.create = true;
  return request;
}

function getOptions(args, name) {
  const values = [];
  args.forEach((arg, index) => {
    if (arg === name && args[index + 1]) {
      values.push(args[index + 1]);
    }
  });
  return values;
}

function writeJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

function loadJsonFile(filePath) {
  const absolutePath = path.resolve(process.cwd(), filePath);
  const raw = fs.readFileSync(absolutePath, 'utf8');
  return {
    absolutePath,
    value: JSON.parse(raw),
  };
}

function getGlassBoxCliDataDir() {
  const override = process.env.SOLOPI_DESKTOP_DATA_DIR || process.env.SOLOPI_HARNESS_DESKTOP_DATA_DIR || process.env.GLASSBOX_CLI_DATA_DIR;
  if (override) return path.resolve(override);
  const base = process.platform === 'darwin' ? path.join(os.homedir(), 'Library', 'Application Support')
    : process.platform === 'win32' ? (process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'))
    : (process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'));
  return defaultDataDirectory(base);
}

function getLegacyGlassBoxDocumentsDataDir() {
  return path.join(os.homedir(), 'Documents', 'GlassBoxData');
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createCliTaskId() {
  return `cli-task-${Date.now()}`;
}

function createCliProgressEmitter(jsonMode) {
  return (event) => {
    const payload = {
      schemaVersion: 'glassbox.cli.progress.v1',
      timestamp: new Date().toISOString(),
      ...event,
    };

    if (jsonMode) {
      console.error(JSON.stringify(payload));
      return;
    }

    const parts = [
      `[solopi-desktop] ${payload.stage || payload.event || 'progress'}`,
      payload.taskId ? `taskId=${payload.taskId}` : '',
      payload.submissionType ? `submission=${payload.submissionType}` : '',
      payload.bridgeType ? `bridge=${payload.bridgeType}` : '',
      payload.route ? `route=${payload.route}` : '',
      payload.requestId ? `requestId=${payload.requestId}` : '',
      payload.elapsedMs !== undefined ? `elapsed=${Math.round(payload.elapsedMs / 1000)}s` : '',
      payload.message || '',
    ].filter(Boolean);
    console.error(parts.join(' '));
  };
}

async function withCliHeartbeat(promiseFactory, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const intervalMs = Number(options.intervalMs || 5000);
  const startedAt = Date.now();
  let timer = null;

  if (onProgress && intervalMs > 0) {
    timer = setInterval(() => {
      onProgress({
        ...(options.event || {}),
        stage: options.stage || 'waiting',
        elapsedMs: Date.now() - startedAt,
      });
    }, intervalMs);
    timer.unref?.();
  }

  try {
    return await promiseFactory();
  } finally {
    if (timer) {
      clearInterval(timer);
    }
  }
}

function writeJsonFileAtomic(filePath, payload) {
  if(path.basename(filePath)==='workflow-editor-state.json' && fs.existsSync(filePath)){
    const previous=JSON.parse(fs.readFileSync(filePath,'utf8'));
    const records=new Map([...(previous.removedAutomationTasks || []),...(payload.removedAutomationTasks || [])].map(r=>[r.id,r]));
    if(records.size)payload={...payload,removedAutomationTasks:[...records.values()],automationTasks:(payload.automationTasks || []).filter(t=>!records.has(t.id))};
  }
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
}

function writeWorkflowStateForCli(state) {
  const stateInfo = readWorkflowStateForCli();
  const targetPath = stateInfo.path || path.join(getGlassBoxCliDataDir(), 'workflow-editor-state.json');
  writeJsonFileAtomic(targetPath, failurePolicy.normalizeStateFailurePolicies(state || {}));
  return targetPath;
}

function getCaseLibrariesRootForCli() {
  return path.join(getGlassBoxCliDataDir(), 'case-libraries');
}

function normalizeGitBranchForCli(branch) {
  return String(branch || 'master').trim() || 'master';
}

function getCaseLibraryRepoIdForCli(repoUrl, branch = 'master') {
  return crypto.createHash('sha1')
    .update(`${String(repoUrl || '').trim()}#${normalizeGitBranchForCli(branch)}`)
    .digest('hex')
    .slice(0, 16);
}

function buildAuthenticatedGitUrlForCli(repoUrl, username = '', token = '') {
  const rawUrl = String(repoUrl || '').trim();
  const rawToken = String(token || '').trim();

  if (!rawToken || !/^https?:\/\//i.test(rawUrl)) {
    return rawUrl;
  }

  try {
    const parsedUrl = new URL(rawUrl);
    parsedUrl.username = String(username || 'git').trim() || 'git';
    parsedUrl.password = rawToken;
    return parsedUrl.toString();
  } catch (_error) {
    return rawUrl;
  }
}

function stripGitCredentialFromMessageForCli(message) {
  return String(message || '').replace(/https?:\/\/[^@\s]+@/g, 'https://***@');
}

function runCommandForCli(command, args = [], options = {}) {
  const packaged = path.basename(CLI_SCRIPT_DIR) === 'cli';
  const runtime = gitRuntimeCommand(command, args, { env: options.env, isPackaged: packaged, resourcesPath: path.resolve(CLI_SCRIPT_DIR, packaged ? '..' : '../resources') });
  command = runtime.command; args = runtime.args; options = { ...options, env: runtime.env };
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(options.timeout || 30000);
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: {
        ...process.env,
        ...(options.env || {}),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    const maxBuffer = Number(options.maxBuffer || 1024 * 1024 * 10);
    const timer = setTimeout(() => {
      child.kill('SIGTERM');
    }, timeoutMs);

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
      if (stdout.length > maxBuffer) {
        stdout = stdout.slice(-maxBuffer);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
      if (stderr.length > maxBuffer) {
        stderr = stderr.slice(-maxBuffer);
      }
    });
    child.on('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const commandLine = [command, ...args].join(' ');
      reject(new Error([
        `Command failed: ${commandLine}`,
        `exitCode: ${code ?? 'unknown'}`,
        `signal: ${signal || 'none'}`,
        stderr ? `[stderr]\n${stderr.trim()}` : '[stderr]\n(empty)',
        stdout ? `[stdout]\n${stdout.trim()}` : '[stdout]\n(empty)',
      ].join('\n')));
    });
  });
}

function ensureGitAskpassScriptForCli() {
  const askpassPath = path.join(getGlassBoxCliDataDir(), 'glassbox-ssh-askpass.sh');
  fs.mkdirSync(path.dirname(askpassPath), { recursive: true });
  fs.writeFileSync(askpassPath, '#!/bin/sh\nprintf "%s" "$GLASSBOX_SSH_PASSPHRASE"\n', { mode: 0o700 });
  fs.chmodSync(askpassPath, 0o700);
  return askpassPath;
}

function buildGitCommandOptionsForCli(library = {}, baseOptions = {}) {
  const repoUrl = String(library.repoUrl || '').trim();
  const sshKeyPath = String(library.sshKeyPath || '').trim();
  const sshPassphrase = String(library.sshPassphrase || '').trim();
  const isSshRepo = /^(git@|ssh:\/\/)/i.test(repoUrl);
  const env = {
    ...(baseOptions.env || {}),
    GIT_TERMINAL_PROMPT: '0',
  };

  if (!sshKeyPath && !sshPassphrase && !isSshRepo) {
    return { ...baseOptions, env };
  }

  const sshArgs = ['ssh', '-o', 'StrictHostKeyChecking=accept-new'];
  if (sshKeyPath) {
    sshArgs.push('-i', JSON.stringify(sshKeyPath), '-o', 'IdentitiesOnly=yes');
  }

  if (sshPassphrase) {
    const askpassPath = ensureGitAskpassScriptForCli();
    env.GIT_ASKPASS = askpassPath;
    env.SSH_ASKPASS = askpassPath;
    env.SSH_ASKPASS_REQUIRE = 'force';
    env.DISPLAY = env.DISPLAY || ':0';
    env.GLASSBOX_SSH_PASSPHRASE = sshPassphrase;
  } else {
    sshArgs.push('-o', 'BatchMode=yes');
  }

  return {
    ...baseOptions,
    env: {
      ...env,
      GIT_SSH_COMMAND: sshArgs.join(' '),
    },
  };
}

function getCurrentPackagedAppPathForCli() {
  const execPath = String(process.execPath || '');
  const marker = '.app/Contents/MacOS/';
  const markerIndex = execPath.indexOf(marker);
  if (markerIndex >= 0) {
    const appPath = execPath.slice(0, markerIndex + '.app'.length);
    if (fs.existsSync(appPath)) {
      return appPath;
    }
  }

  const scriptPath = String(process.argv[1] || '');
  const scriptMarker = '.app/Contents/Resources/';
  const scriptMarkerIndex = scriptPath.indexOf(scriptMarker);
  if (scriptMarkerIndex >= 0) {
    const appPath = scriptPath.slice(0, scriptMarkerIndex + '.app'.length);
    if (fs.existsSync(appPath)) {
      return appPath;
    }
  }

  return '';
}

function getAdbCandidates() {
  const configuredAdbPath = getConfiguredAdbPathForCli();

  if (configuredAdbPath) {
    return [configuredAdbPath];
  }

  const candidates = [];
  if (process.env.ADB_PATH) {
    candidates.push(process.env.ADB_PATH);
  }

  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, process.platform === 'win32' ? 'adb.exe' : 'adb');
    if (fs.existsSync(candidate)) {
      candidates.push(candidate);
      break;
    }
  }

  if (process.platform === 'linux' && getLinuxPackagedBinaryForCli()) {
    candidates.push(path.resolve(CLI_SCRIPT_DIR,'..','media-runtime',`linux-${process.arch}`,'bin','adb'));
  }

  const packagedAppPath = getCurrentPackagedAppPathForCli();
  if (packagedAppPath) {
    candidates.push(path.join(
      packagedAppPath,
      'Contents',
      'Resources',
      'media-runtime',
      `${process.platform}-${process.arch}`,
      'bin',
      process.platform === 'win32' ? 'adb.exe' : 'adb'
    ));
  }

  candidates.push(
    path.join(os.homedir(), 'Library', 'Android', 'sdk', 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    'adb'
  );

  return [...new Set(candidates.filter(Boolean))];
}

function isRunnableAdbCandidate(candidate) {
  if (!candidate) {
    return false;
  }

  if (candidate === 'adb') {
    return true;
  }

  return fs.existsSync(candidate);
}

function lockResolvedAdbPathForCli(adbPath, source) {
  const normalized = String(adbPath || '').trim();
  if (!normalized) {
    return '';
  }

  resolvedAdbPathForCli = normalized;
  resolvedAdbPathSourceForCli = source || 'unknown';
  return resolvedAdbPathForCli;
}

function resolveAdbPathForCliSync() {
  if (resolvedAdbPathForCli) {
    return resolvedAdbPathForCli;
  }

  const configuredAdbPath = getConfiguredAdbPathForCli();
  if (configuredAdbPath) {
    return lockResolvedAdbPathForCli(configuredAdbPath, 'environment-config');
  }

  const adbPath = getAdbCandidates().find(isRunnableAdbCandidate) || 'adb';
  return lockResolvedAdbPathForCli(adbPath, 'local-discovery');
}

async function resolveAdbPathForCli(options = {}) {
  if (resolvedAdbPathForCli) {
    return resolvedAdbPathForCli;
  }

  return resolveAdbPathForCliSync();
}

function formatAdbFailure(adbPath, result) {
  const detail = result.error?.message || result.stderr || `exit ${result.status}`;
  if (/server version .*doesn'?t match this client|ADB server didn't ACK/i.test(detail)) {
    return [
      `ADB 命令失败 (${adbPath}, source=${resolvedAdbPathSourceForCli || 'unknown'}): ${detail}`,
      '检测到 adb client/server 版本冲突。solopi-desktop CLI 本次运行不会 fallback 到其它 adb,避免继续 kill 全局 adb server; 请统一设置中心 adbPath 或清理外部 adb server 后重试。',
    ].join('\n');
  }

  return `ADB 命令失败 (${adbPath}, source=${resolvedAdbPathSourceForCli || 'unknown'}): ${detail}`;
}

function runAdbCommand(args, options = {}) {
  const adbPath = resolveAdbPathForCliSync();
  const result = spawnSync(adbPath, args, {
    cwd: process.cwd(),
    encoding: 'utf8',
    timeout: options.timeout || 5000,
    maxBuffer: 1024 * 1024 * 5,
  });

  if (!result.error && result.status === 0) {
    return {
      adbPath,
      stdout: result.stdout || '',
      stderr: result.stderr || '',
    };
  }

  const error = new Error(formatAdbFailure(adbPath, result));
  error.command = `${adbPath} ${args.join(' ')}`;
  error.exitCode = typeof result.status === 'number' ? result.status : null;
  error.signal = result.signal || result.error?.signal || null;
  error.timeoutMs = result.error?.code === 'ETIMEDOUT' ? (options.timeout || 5000) : null;
  error.stdout = result.stdout || '';
  error.stderr = result.stderr || '';
  throw error;
}

function getHdcCandidates() {
  const candidates = [];
  if (process.env.HDC_PATH) {
    candidates.push(process.env.HDC_PATH);
  }

  candidates.push(
    '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc',
    path.join(os.homedir(), 'Library', 'OpenHarmony', 'Sdk', 'toolchains', 'hdc'),
    '/opt/homebrew/bin/hdc',
    '/usr/local/bin/hdc',
    'hdc'
  );

  return [...new Set(candidates.filter(Boolean))];
}

function runHdcCommand(args, options = {}) {
  const errors = [];

  for (const hdcPath of getHdcCandidates()) {
    const result = spawnSync(hdcPath, args, {
      cwd: process.cwd(),
      encoding: 'utf8',
      timeout: options.timeout || 5000,
      maxBuffer: 1024 * 1024 * 5,
    });

    if (!result.error && result.status === 0) {
      return {
        hdcPath,
        stdout: result.stdout || '',
        stderr: result.stderr || '',
      };
    }

    errors.push(`${hdcPath}: ${result.error?.message || result.stderr || `exit ${result.status}`}`);
  }

  throw new Error(`HDC unavailable. Tried: ${errors.join('; ')}`);
}

function shellSingleQuote(value) {
  return `'${String(value || '').replace(/'/g, "'\\''")}'`;
}

function stripAnsiControl(value) {
  return String(value || '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-_]/g, '')
    .replace(/\r/g, '\n');
}

function parseFirstNumber(value) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function parseSizeToKb(value) {
  const match = String(value || '').trim().match(/^(\d+(?:\.\d+)?)([KMG])?$/i);
  if (!match) {
    return undefined;
  }

  const amount = Number(match[1]);
  const unit = String(match[2] || 'K').toUpperCase();

  if (unit === 'G') return amount * 1024 * 1024;
  if (unit === 'M') return amount * 1024;
  return amount;
}

function parseAndroidMeminfo(output) {
  const totalPss = String(output || '').match(/TOTAL\s+PSS:\s*(\d+)/i);
  if (totalPss) {
    return Number(totalPss[1]);
  }

  const totalLine = String(output || '').split(/\r?\n/).find((line) => /^\s*TOTAL\s+\d+/.test(line));
  return totalLine ? parseFirstNumber(totalLine) : undefined;
}

function parseProcStatusMemory(output) {
  const match = String(output || '').match(/^VmRSS:\s*(\d+)\s*kB/im);
  return match ? Number(match[1]) : undefined;
}

function parseProcStatusThreads(output) {
  const match = String(output || '').match(/^Threads:\s*(\d+)/im);
  return match ? Number(match[1]) : undefined;
}

function parseCpuPercentFromOutput(output, packageName) {
  const packageLine = String(output || '').split(/\r?\n/).find((line) => line.includes(packageName));
  if (!packageLine) {
    return undefined;
  }

  const dumpsysMatch = packageLine.match(/(\d+(?:\.\d+)?)%\s+\d+\/|(\d+(?:\.\d+)?)%\s+\S+/);
  if (dumpsysMatch) {
    return Number(dumpsysMatch[1] || dumpsysMatch[2]);
  }

  const percentValues = Array.from(packageLine.matchAll(/(\d+(?:\.\d+)?)%/g)).map((match) => Number(match[1]));
  if (percentValues.length > 0) {
    return percentValues[0];
  }

  const numericColumns = packageLine.trim().split(/\s+/)
    .map((column) => column.replace(/%$/, ''))
    .filter((column) => /^\d+(?:\.\d+)?$/.test(column))
    .map(Number);

  return numericColumns.length > 0 ? numericColumns[numericColumns.length - 1] : undefined;
}

function parseSystemAvailableMemoryKb(output) {
  const text = String(output || '');
  const memAvailable = text.match(/^MemAvailable:\s*(\d+)\s*kB/im);
  if (memAvailable) return Number(memAvailable[1]);

  const freeRam = text.match(/Free RAM:\s*([\d,]+)\s*K/i);
  if (freeRam) return Number(freeRam[1].replace(/,/g, ''));

  const harmonyFree = text.match(/Mem:\s+\S+\s+total,\s+\S+\s+used,\s+(\d+(?:\.\d+)?[KMG]?)\s+free/i);
  return harmonyFree ? parseSizeToKb(harmonyFree[1]) : undefined;
}

function parseSystemAvailableCpuPercent(output) {
  const text = stripAnsiControl(output);
  const idleMatch = text.match(/(\d+(?:\.\d+)?)%\s*idle/i);
  if (idleMatch) return Number(idleMatch[1]);

  const cpuTotalMatch = text.match(/(\d+(?:\.\d+)?)%\s*cpu/i);
  if (cpuTotalMatch) {
    const total = Number(cpuTotalMatch[1]);
    const usedParts = Array.from(text.matchAll(/(\d+(?:\.\d+)?)%\s*(?:user|nice|sys|iow|irq|sirq|host|usr)/gi))
      .map((match) => Number(match[1]))
      .filter((value) => Number.isFinite(value));
    const used = usedParts.reduce((sum, value) => sum + value, 0);
    if (Number.isFinite(total) && usedParts.length > 0) {
      return Math.max(0, total - used);
    }
  }

  const idleAlt = text.match(/\bCPU:\s+.*?(\d+(?:\.\d+)?)%\s*idle/i);
  return idleAlt ? Number(idleAlt[1]) : undefined;
}

function pickPidFromOutput(output) {
  const pids = String(output || '').match(/\b\d+\b/g) || [];
  return pids[0] || '';
}

function parseHarmonyTopProcess(output, packageName, pid = '') {
  const lines = stripAnsiControl(output)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const packagePrefix = String(packageName || '').slice(0, 14);
  const processLine = lines.find((line) => (
    pid && new RegExp(`^${pid}\\s`).test(line)
  )) || lines.find((line) => (
    packageName && (line.includes(packageName) || line.includes(packagePrefix))
  ));

  if (!processLine) {
    return {};
  }

  const columns = processLine.split(/\s+/);
  const parsedPid = /^\d+$/.test(columns[0] || '') ? columns[0] : '';
  const cpuPercent = Number(columns[8]);
  const memoryKb = parseSizeToKb(columns[5]);

  return {
    pid: parsedPid,
    memoryKb,
    cpuPercent: Number.isFinite(cpuPercent) ? cpuPercent : undefined,
  };
}

function getWorkflowStateCandidates() {
  const candidates = [
    process.env.GLASSBOX_WORKFLOW_STATE_PATH,
    path.join(getGlassBoxCliDataDir(), 'workflow-editor-state.json'),
  ].filter(Boolean);

  if (process.env.SOLOPI_DESKTOP_DATA_DIR || process.env.SOLOPI_HARNESS_DESKTOP_DATA_DIR || process.env.GLASSBOX_CLI_DATA_DIR) {
    return [...new Set(candidates)];
  }

  candidates.push(path.join(getLegacyGlassBoxDocumentsDataDir(), 'workflow-editor-state.json'));

  if (process.platform === 'darwin') {
    candidates.push(
      path.join(os.homedir(), 'Library', 'Application Support', 'Glass Box', 'workflow-editor-state.json'),
      path.join(os.homedir(), 'Library', 'Application Support', 'glasses-box', 'workflow-editor-state.json')
    );
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(
      path.join(appData, 'Glass Box', 'workflow-editor-state.json'),
      path.join(appData, 'glasses-box', 'workflow-editor-state.json')
    );
  }

  if (process.platform === 'linux') {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    candidates.push(
      path.join(configHome, 'Glass Box', 'workflow-editor-state.json'),
      path.join(configHome, 'glasses-box', 'workflow-editor-state.json')
    );
  }

  return [...new Set(candidates)];
}

function getEnvironmentConfigCandidates() {
  const candidates = [
    path.join(getGlassBoxCliDataDir(), 'environment-config.json'),
  ];

  if (process.env.SOLOPI_DESKTOP_DATA_DIR || process.env.SOLOPI_HARNESS_DESKTOP_DATA_DIR || process.env.GLASSBOX_CLI_DATA_DIR) {
    return candidates;
  }

  candidates.push(path.join(getLegacyGlassBoxDocumentsDataDir(), 'environment-config.json'));

  if (process.platform === 'darwin') {
    candidates.push(
      path.join(os.homedir(), 'Library', 'Application Support', 'Glass Box', 'environment-config.json'),
      path.join(os.homedir(), 'Library', 'Application Support', 'Electron', 'environment-config.json'),
      path.join(os.homedir(), 'Library', 'Application Support', 'glasses-box', 'environment-config.json')
    );
  }

  if (process.platform === 'win32') {
    const appData = process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming');
    candidates.push(
      path.join(appData, 'Glass Box', 'environment-config.json'),
      path.join(appData, 'glasses-box', 'environment-config.json')
    );
  }

  if (process.platform === 'linux') {
    const configHome = process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    candidates.push(
      path.join(configHome, 'Glass Box', 'environment-config.json'),
      path.join(configHome, 'glasses-box', 'environment-config.json')
    );
  }

  return [...new Set(candidates)];
}

function readWorkflowStateForCli() {
  for (const statePath of getWorkflowStateCandidates()) {
    try {
      if (fs.existsSync(statePath)) {
        const rawState = fs.readFileSync(statePath, 'utf8');
        return {
          path: statePath,
          revision: crypto.createHash('sha256').update(rawState).digest('hex'),
          state: failurePolicy.normalizeStateFailurePolicies(JSON.parse(rawState)),
        };
      }
    } catch (_error) {
      // Try the next known state location.
    }
  }

  return {
    path: '',
    revision: '',
    state: null,
  };
}

const DEFAULT_CASE_LIBRARY_ID = 'case-library-local';
const DEFAULT_CASE_FOLDER_ID = 'case-folder-default';

function createDefaultCaseLibraryForCli() {
  return {
    id: DEFAULT_CASE_LIBRARY_ID,
    name: '全量用例',
    expanded: true,
  };
}

function createDefaultCaseFolderForCli() {
  return {
    id: DEFAULT_CASE_FOLDER_ID,
    name: '默认用例集',
    libraryId: DEFAULT_CASE_LIBRARY_ID,
    expanded: true,
  };
}

function getWorkflowReportDetailPathForCli(taskId) {
  return path.join(getGlassBoxCliDataDir(), 'workflow-report-details', `${sanitizeFilePart(taskId || 'report')}.json`);
}

function getCliTaskRunnerMetadataDirForCli() {
  return path.join(getGlassBoxCliDataDir(), 'cli-task-runners');
}

function getCliTaskRunnerMetadataPathForCli(taskId) {
  return path.join(getCliTaskRunnerMetadataDirForCli(), `${sanitizeFilePart(taskId || 'task')}.json`);
}

function getWorkflowReportPackagesDirForCli() {
  return path.join(getGlassBoxCliDataDir(), 'report-packages');
}

function createDoctorCheck(id, name, passed, details = {}) {
  return {
    id,
    name,
    status: passed ? 'pass' : 'fail',
    ...details,
  };
}

function createDoctorWarning(id, message, recoveryActions = []) {
  return {
    id,
    message,
    recoveryActions,
  };
}

function getDoctorPayloadForCli() {
  const dataDir = getGlassBoxCliDataDir();
  const reportPackagesDir = getWorkflowReportPackagesDirForCli();
  const workflowRunsDir = getWorkflowRunsDirForCli();
  const stateInfo = readWorkflowStateForCli();
  const state = stateInfo.state || {};
  const cases = Array.isArray(state.cases) ? state.cases : [];
  const tasks = Array.isArray(state.automationTasks) ? state.automationTasks : [];
  const appPath = getCurrentPackagedAppPathForCli();
  const runnerLaunch = getHeadlessElectronLaunchForCli();
  const checks = [];
  const warnings = [];

  checks.push(createDoctorCheck('cli-script', 'CLI script is readable', fs.existsSync(CLI_SCRIPT_PATH), {
    path: CLI_SCRIPT_PATH,
  }));
  checks.push(createDoctorCheck('data-dir', 'solopi-desktop data directory is reachable', fs.existsSync(dataDir), {
    path: dataDir,
  }));
  checks.push(createDoctorCheck('state-file', 'Workflow state file is readable', Boolean(stateInfo.path), {
    path: stateInfo.path || '',
    candidateCount: getWorkflowStateCandidates().length,
  }));
  checks.push(createDoctorCheck('report-packages-dir', 'Report package directory is reachable', fs.existsSync(reportPackagesDir), {
    path: reportPackagesDir,
  }));
  checks.push(createDoctorCheck('headless-runner-entry', 'Headless runner launch entry can be resolved', Boolean(runnerLaunch), {
    submissionType: 'headless',
    command: runnerLaunch?.command || '',
    packaged: Boolean(runnerLaunch?.packaged),
    appPath: appPath || runnerLaunch?.appPath || '',
  }));

  if (!stateInfo.path) {
    warnings.push(createDoctorWarning(
      'missing-state-file',
      'No solopi-desktop workflow state file was found. Read-only commands still work, but cases list/show and --case-id runs need a case library.',
      ['Open solopi-desktop once or import a case library, then rerun solopi-desktop doctor --json.']
    ));
  }

  if (!fs.existsSync(reportPackagesDir)) {
    warnings.push(createDoctorWarning(
      'missing-report-packages-dir',
      'No report package directory exists yet. This is normal before the first completed run.',
      ['Run a small case/task or query a terminal report with reports show after a task completes.']
    ));
  }

  if (!runnerLaunch) {
    warnings.push(createDoctorWarning(
      'missing-headless-runner',
      'The CLI could not resolve a packaged app or source Electron runner for run task/run case.',
      ['Use the bundled app CLI from solopi-desktop.app, or install source dependencies before running source CLI tasks.']
    ));
  }

  const failedRequiredChecks = checks.filter((check) => check.status !== 'pass' && [
    'cli-script',
    'headless-runner-entry',
    'state-file',
  ].includes(check.id));

  return {
    schemaVersion: 'glassbox.doctor.v1',
    success: failedRequiredChecks.length === 0,
    version: VERSION,
    build: CLI_BUILD_IDENTITY,
    successScope: 'configuration-check',
    readiness: { runtimeEntryResolved: Boolean(runnerLaunch), stateReadable: Boolean(stateInfo.path), caseLibraryAvailable: Boolean(stateInfo.path && cases.length), executionVerified: false, backgroundBackend: backgroundPolicy.backgroundBackend(), displayRequired: backgroundPolicy.backgroundBackend() === 'desktop' && process.platform === 'linux' },
    timestamp: new Date().toISOString(),
    cli: {
      scriptPath: CLI_SCRIPT_PATH,
      scriptDir: CLI_SCRIPT_DIR,
      packagedAppPath: appPath,
      sourceRoot: getSourceRootForCli() || '',
      submissionType: 'headless',
    },
    paths: {
      dataDir,
      statePath: stateInfo.path || '',
      reportPackagesDir,
      workflowRunsDir,
    },
    inventory: {
      caseCount: cases.length,
      taskCount: tasks.length,
      componentCount: createMergedComponentsForCli(state.components || []).length,
    },
    checks,
    warnings,
    recoveryActions: warnings.flatMap((warning) => warning.recoveryActions || []),
  };
}

function getDefaultTaskReportPackagePathForCli(task) {
  const baseName = `solopi-desktop-report-${sanitizeFilePart(task?.name || task?.id || 'task')}-${createTimestamp()}.glassreport`;
  return path.join(getWorkflowReportPackagesDirForCli(), baseName);
}

function getStateCollectionsForCli(state = {}) {
  const libraries = Array.isArray(state.caseLibraries) && state.caseLibraries.length
    ? state.caseLibraries
    : [createDefaultCaseLibraryForCli()];
  const folders = Array.isArray(state.caseFolders) && state.caseFolders.length
    ? state.caseFolders.map((folder) => ({
      ...folder,
      libraryId: folder.libraryId || DEFAULT_CASE_LIBRARY_ID,
    }))
    : [createDefaultCaseFolderForCli()];

  const libraryMap = new Map(libraries.map((library) => [library.id, library]));
  if (!libraryMap.has(DEFAULT_CASE_LIBRARY_ID)) {
    libraryMap.set(DEFAULT_CASE_LIBRARY_ID, createDefaultCaseLibraryForCli());
  }

  const folderMap = new Map(folders.map((folder) => [folder.id, folder]));
  for (const testCase of Array.isArray(state.cases) ? state.cases : []) {
    const folderId = getCaseFolderIdForCli(testCase);
    if (!folderMap.has(folderId)) {
      folderMap.set(folderId, {
        id: folderId,
        name: testCase.folderId ? folderId : '根目录用例',
        libraryId: testCase.libraryId || DEFAULT_CASE_LIBRARY_ID,
      });
    }
  }

  return {
    libraries: [...libraryMap.values()],
    folders: [...folderMap.values()],
    libraryMap,
    folderMap,
  };
}

function getCaseFolderForCli(testCase, collections) {
  const folderId = getCaseFolderIdForCli(testCase);
  return collections.folderMap.get(folderId) || {
    id: folderId,
    name: folderId,
    libraryId: testCase.libraryId || DEFAULT_CASE_LIBRARY_ID,
  };
}

function getFolderPathForCli(folder, collections) {
  const names = [];
  const seen = new Set();
  let current = folder;

  while (current?.id && !seen.has(current.id)) {
    seen.add(current.id);
    names.unshift(current.name || current.id);
    current = current.parentId ? collections.folderMap.get(current.parentId) : null;
  }

  return names.join(' / ');
}

function getCaseFolderIdForCli(testCase = {}) {
  return testCase.folderId || (testCase.libraryId && testCase.libraryId !== DEFAULT_CASE_LIBRARY_ID
    ? `case-library-root:${testCase.libraryId}` : DEFAULT_CASE_FOLDER_ID);
}

function getFolderLibraryIdForCli(folder = {}) {
  return folder?.libraryId || DEFAULT_CASE_LIBRARY_ID;
}

function getConfiguredGitBranchForCli(library = {}) {
  return normalizeGitBranchForCli(library.gitBranch || library.branch || 'master');
}

function sanitizeRelativePathForCli(value = '') {
  return String(value || '').replace(/\\/g, '/').replace(/^\/+/, '');
}

function toPosixRelativePathForCli(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).split(path.sep).join('/');
}

const CASE_LIBRARY_AUDIO_EXTENSIONS_FOR_CLI = new Set(['.pcm', '.wav', '.ogg', '.spx', '.speex', '.mp3', '.m4a', '.webm']);
const CASE_LIBRARY_IMAGE_EXTENSIONS_FOR_CLI = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function isLikelyCaseLibraryAssetForCli(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return CASE_LIBRARY_AUDIO_EXTENSIONS_FOR_CLI.has(ext) || CASE_LIBRARY_IMAGE_EXTENSIONS_FOR_CLI.has(ext);
}

function getTtsAudioDirCandidatesForCli() {
  return [
    path.join(getGlassBoxCliDataDir(), 'tts-audio'),
    path.join(getLegacyGlassBoxDocumentsDataDir(), 'tts-audio'),
  ];
}

function isGeneratedTtsAudioPathForCli(filePath) {
  const value = String(filePath || '').trim();
  if (!value || !path.isAbsolute(value)) {
    return false;
  }

  const resolvedPath = path.resolve(value);
  return getTtsAudioDirCandidatesForCli().some((dir) => {
    const resolvedDir = path.resolve(dir);
    return resolvedPath === resolvedDir || resolvedPath.startsWith(`${resolvedDir}${path.sep}`);
  });
}

function getCaseLibraryAssetKindForCli(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return CASE_LIBRARY_IMAGE_EXTENSIONS_FOR_CLI.has(ext) ? 'images' : 'audio';
}

function archiveCaseLibraryAssetPathForCli(rawPath, repoPath, assetsRoot, copiedAssets) {
  const value = String(rawPath || '').trim();
  if (!value) {
    return rawPath;
  }

  if (!path.isAbsolute(value)) {
    return value.replace(/\\/g, '/');
  }

  if (!isLikelyCaseLibraryAssetForCli(value) || !fs.existsSync(value)) {
    return rawPath;
  }

  const resolvedPath = path.resolve(value);
  const resolvedRepoPath = path.resolve(repoPath);
  if (resolvedPath === resolvedRepoPath || resolvedPath.startsWith(`${resolvedRepoPath}${path.sep}`)) {
    return toPosixRelativePathForCli(repoPath, resolvedPath);
  }

  const stat = fs.statSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const baseName = sanitizeFilePart(path.basename(resolvedPath, ext));
  const hash = crypto.createHash('sha1')
    .update(`${resolvedPath}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 10);
  const assetKind = getCaseLibraryAssetKindForCli(resolvedPath);
  const assetDir = path.join(repoPath, assetsRoot, assetKind);
  const assetFileName = `${baseName}-${hash}${ext}`;
  const targetPath = path.join(assetDir, assetFileName);

  fs.mkdirSync(assetDir, { recursive: true });
  fs.copyFileSync(resolvedPath, targetPath);
  copiedAssets.add(toPosixRelativePathForCli(repoPath, targetPath));
  return `${assetsRoot}/${assetKind}/${assetFileName}`;
}

function archiveCaseLibraryAssetsForCli(value, repoPath, assetsRoot = 'assets', copiedAssets = new Set(), context = {}) {
  if (Array.isArray(value)) {
    return {
      value: value.map((item) => archiveCaseLibraryAssetsForCli(item, repoPath, assetsRoot, copiedAssets, context).value),
      copiedAssets,
    };
  }

  if (!value || typeof value !== 'object') {
    return { value, copiedAssets };
  }

  const isTtsStep = context.isTtsStep || value.type === 'tts_synthesize';
  const nextValue = {};
  Object.entries(value).forEach(([key, childValue]) => {
    if ((key === 'localPath' || key === 'audioPath' || key === 'imagePath') && typeof childValue === 'string') {
      if ((key === 'localPath' || key === 'audioPath') && (isTtsStep || isGeneratedTtsAudioPathForCli(childValue))) {
        nextValue[key] = childValue;
        return;
      }
      nextValue[key] = archiveCaseLibraryAssetPathForCli(childValue, repoPath, assetsRoot, copiedAssets);
      return;
    }
    nextValue[key] = archiveCaseLibraryAssetsForCli(childValue, repoPath, assetsRoot, copiedAssets, {
      ...context,
      isTtsStep,
    }).value;
  });
  return { value: nextValue, copiedAssets };
}

function hydrateCaseLibraryAssetPathForCli(rawPath, repoPath) {
  const value = String(rawPath || '').trim();
  if (!value || path.isAbsolute(value)) {
    return rawPath;
  }

  const normalizedValue = value.replace(/\\/g, '/');
  if (!normalizedValue.startsWith('assets/')) {
    return rawPath;
  }
  return path.join(repoPath, ...normalizedValue.split('/'));
}

function hydrateCaseLibraryAssetsForCli(value, repoPath) {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateCaseLibraryAssetsForCli(item, repoPath));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const nextValue = {};
  Object.entries(value).forEach(([key, childValue]) => {
    if ((key === 'localPath' || key === 'audioPath' || key === 'imagePath') && typeof childValue === 'string') {
      nextValue[key] = hydrateCaseLibraryAssetPathForCli(childValue, repoPath);
      return;
    }
    nextValue[key] = hydrateCaseLibraryAssetsForCli(childValue, repoPath);
  });
  return nextValue;
}

function getMergedComponentsForCli(state = {}, testCase = {}) {
  const componentMap = new Map(builtinComponents.map((component) => [component.id, component]));
  for (const component of Array.isArray(state.components) ? state.components : []) {
    if (component?.id && isSupportedComponent(component)) {
      componentMap.set(component.id, mergeComponentForCli(componentMap.get(component.id), component));
    }
  }
  for (const component of Array.isArray(testCase.components) ? testCase.components : []) {
    if (component?.id && isSupportedComponent(component)) {
      componentMap.set(component.id, mergeComponentForCli(componentMap.get(component.id), component));
    }
  }
  return [...componentMap.values()];
}

function createDeterministicNodePositionsForCli(testCase = {}, edges = []) {
  const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
  const ids = new Set(steps.map((step) => String(step?.id || '')).filter(Boolean));
  const validEdges = normalizeCaseEdges(edges, testCase);
  const outgoing = new Map();
  const incoming = new Map(steps.map((step) => [String(step?.id || ''), 0]));
  validEdges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge]);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  });
  const start = steps.find((step) => step?.type === 'start');
  const queue = [start?.id || steps[0]?.id].filter(Boolean);
  const layer = new Map(queue.map((id) => [String(id), 0]));
  const visited = new Set();
  while (queue.length) {
    const id = String(queue.shift());
    if (visited.has(id)) continue;
    visited.add(id);
    const currentLayer = layer.get(id) || 0;
    (outgoing.get(id) || []).forEach((edge) => {
      const target = String(edge.target);
      layer.set(target, Math.max(layer.get(target) || 0, currentLayer + 1));
      if (!visited.has(target)) queue.push(target);
    });
  }
  steps.forEach((step, index) => {
    if (!layer.has(step.id)) layer.set(step.id, Math.max(0, index));
  });
  const lanes = new Map();
  const positions = {};
  [...ids].sort((a, b) => (layer.get(a) || 0) - (layer.get(b) || 0) || a.localeCompare(b)).forEach((id) => {
    const currentLayer = layer.get(id) || 0;
    const lane = lanes.get(currentLayer) || 0;
    lanes.set(currentLayer, lane + 1);
    positions[id] = { x: 80 + currentLayer * 460, y: 160 + lane * 260 };
  });
  return positions;
}

function getCaseNodePositionsForCli(state = {}, caseId = '', testCase = {}, edges = []) {
  const positionsRoot = state.nodePositions || {};
  const stored = positionsRoot?.[caseId] && typeof positionsRoot[caseId] === 'object'
    ? positionsRoot[caseId]
    : positionsRoot;
  const stepIds = new Set((testCase.steps || []).map((step) => String(step?.id || '')).filter(Boolean));
  const validStored = Object.fromEntries(Object.entries(stored || {}).filter(([id, position]) => (
    stepIds.has(id) && position && typeof position === 'object' && Number.isFinite(Number(position.x)) && Number.isFinite(Number(position.y))
  )));
  const generated = createDeterministicNodePositionsForCli(testCase, edges);
  return Object.fromEntries([...stepIds].map((id) => [id, validStored[id] || generated[id]]));
}

function summarizeCaseForCli(testCase, state, collections) {
  const folder = getCaseFolderForCli(testCase, collections);
  const libraryId = folder.libraryId || DEFAULT_CASE_LIBRARY_ID;
  const library = collections.libraryMap.get(libraryId) || createDefaultCaseLibraryForCli();
  const steps = Array.isArray(testCase.steps) ? testCase.steps : [];
  const edges = Array.isArray(state.caseEdges?.[testCase.id]) ? state.caseEdges[testCase.id] : [];
  const stepTypes = steps.map((step) => step?.type).filter(Boolean);
  const hasStart = stepTypes.includes('start');
  const hasEnd = stepTypes.includes('end');

  return {
    id: testCase.id,
    name: testCase.name || testCase.id || '未命名用例',
    description: testCase.description || '',
    reviewStatus: testCase.reviewStatus || '',
    tags: Array.isArray(testCase.tags) ? testCase.tags : [],
    folderId: folder.id,
    folderName: folder.name || folder.id,
    folderPath: getFolderPathForCli(folder, collections),
    libraryId,
    libraryName: library.name || library.id,
    libraryRevision: library.localRevision || '',
    stepCount: steps.length,
    edgeCount: edges.length,
    componentCount: getMergedComponentsForCli(state, testCase).length,
    hasStart,
    hasEnd,
    runnable: Boolean(testCase.id && steps.length && hasStart && hasEnd),
  };
}

function summarizeCaseLibraryForCli(library) {
  return {
    id: library.id,
    name: library.name || library.id,
    repoUrl: library.repoUrl || '',
    branch: getConfiguredGitBranchForCli(library),
    gitBranch: library.gitBranch || library.branch || getConfiguredGitBranchForCli(library),
    localRevision: library.localRevision || '',
    autoUpdate: Boolean(library.autoUpdate),
  };
}

function getCasesQueryPayloadForCli(command) {
  const { path: statePath, revision: stateRevision, state } = readWorkflowStateForCli();
  if (!statePath) return { success:false, errorCode:'WORKFLOW_STATE_UNAVAILABLE', error:'Workflow state is unavailable in the selected data directory.', dataDir:getGlassBoxCliDataDir(), statePath:'', stateRevision:'', total:0, libraries:[], folders:[], cases:[], recoveryActions:['Use the configured deployment CLI and data directory; run doctor --json. Do not rebuild cases or edit application state files.'] };
  const collections = getStateCollectionsForCli(state || {});
  const query = String(getOption(command, '--query') || '').trim().toLowerCase();
  const folderId = String(getOption(command, '--folder') || '').trim();
  const libraryId = String(getOption(command, '--library') || '').trim();
  const reviewStatus = String(getOption(command, '--review-status') || '').trim();
  const tagFilters = getOptions(command, '--tag').map((tag) => String(tag).trim()).filter(Boolean);
  const cases = Array.isArray(state?.cases) ? state.cases : [];

  const scope=discoverCases(state||{},{...scopeOptions(command),limit:Math.max(1,cases.length)});
  if(!scope.success)return {...scope,cases:[],statePath,stateRevision};
  const scopedIds=new Set(scope.caseIds);
  const summaries = cases.filter(c=>scopedIds.has(c.id))
    .map((testCase) => summarizeCaseForCli(testCase, state || {}, collections))
    .filter((item) => {
      if (folderId && !scopedIds.has(item.id)) {
        return false;
      }
      if (libraryId && item.libraryId !== libraryId) {
        return false;
      }
      if (reviewStatus && item.reviewStatus !== reviewStatus) {
        return false;
      }
      if (tagFilters.length && !tagFilters.every((tag) => item.tags.includes(tag))) {
        return false;
      }
      if (query) {
        const haystack = [
          item.id,
          item.name,
          item.description,
          item.folderName,
          item.folderPath,
          item.libraryName,
          item.tags.join(' '),
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      }
      return true;
    });

  return {
    schemaVersion: 'glassbox.cases.list.v1',
    statePath,
    stateRevision,
    total: summaries.length,
    selectionRevision:scope.selectionRevision,
    filters: {
      query,
      folderId,
      libraryId,
      reviewStatus,
      tags: tagFilters,
    },
    libraries: collections.libraries.map(summarizeCaseLibraryForCli),
    folders: collections.folders,
    cases: summaries,
  };
}

function getCaseDetailPayloadForCli(caseId) {
  const { path: statePath, revision: stateRevision, state } = readWorkflowStateForCli();
  const cases = Array.isArray(state?.cases) ? state.cases : [];
  const testCase = cases.find((item) => String(item?.id || '') === caseId);
  if (!testCase) {
    return {
      success: false,
      errorCode: statePath ? 'CASE_NOT_FOUND' : 'WORKFLOW_STATE_UNAVAILABLE',
      recoveryActions: statePath
        ? ['Run cases list --json using the same CLI entry and data directory.']
        : ['Run doctor --json; use the configured deployment entry and data directory. Do not recreate the case or modify application state files.'],
      error: statePath ? `找不到用例：${caseId}` : '工作区状态不可读取：请先核对 CLI 入口和数据目录。',
      statePath,
      stateRevision,
    };
  }

  const collections = getStateCollectionsForCli(state || {});
  const summary = summarizeCaseForCli(testCase, state || {}, collections);
  const components = getMergedComponentsForCli(state || {}, testCase);
  const caseWithComponents = {
    ...testCase,
    components,
  };

  return {
    success: true,
    schemaVersion: 'glassbox.case.detail.v1',
    statePath,
    stateRevision,
    libraryRevision: summary.libraryRevision,
    case: caseWithComponents,
    summary,
    components,
    edges: normalizeCaseEdges(state?.caseEdges?.[caseId] || testCase.edges || createEdgesFromSteps(testCase.steps || []), testCase),
    nodePositions: getCaseNodePositionsForCli(state || {}, caseId, testCase, Array.isArray(state?.caseEdges?.[caseId]) ? state.caseEdges[caseId] : testCase.edges),
  };
}

function getCaseLibrariesPayloadForCli() {
  const { path: statePath, state } = readWorkflowStateForCli();
  if (!statePath) return {success:false,errorCode:'WORKFLOW_STATE_UNAVAILABLE',error:'Workflow state is unavailable in the selected data directory.',statePath:'',dataDir:getGlassBoxCliDataDir(),total:0,libraries:[],recoveryActions:['Use the configured deployment entry and data directory; run doctor --json.']};
  const collections = getStateCollectionsForCli(state || {});
  const folders = collections.folders;
  const cases = Array.isArray(state?.cases) ? state.cases : [];
  const libraries = collections.libraries.map((library) => {
    const branch = getConfiguredGitBranchForCli(library);
    const libraryFolderIds = new Set(folders
      .filter((folder) => getFolderLibraryIdForCli(folder) === library.id)
      .map((folder) => folder.id));
    const caseCount = cases.filter((testCase) => libraryFolderIds.has(getCaseFolderIdForCli(testCase))).length;
    return {
      libraryId: library.id,
      id: library.id,
      name: library.name || library.id,
      repoUrl: library.repoUrl || '',
      branch,
      gitBranch: library.gitBranch || library.branch || branch,
      lastCommit: library.lastCommit || library.lastCommitHash || library.commitHash || '',
      lastUpdatedAt: library.lastUpdatedAt || '',
      lastUpdatedBy: library.lastUpdatedBy || '',
      lastCommitMessage: library.lastCommitMessage || '',
      autoUpdate: Boolean(library.autoUpdate),
      folderCount: libraryFolderIds.size,
      caseCount,
      syncable: Boolean(String(library.repoUrl || '').trim()),
    };
  });

  return {
    success: true,
    schemaVersion: 'glassbox.case-libraries.list.v1',
    statePath,
    total: libraries.length,
    libraries,
    recoveryActions: libraries.some((library) => library.syncable)
      ? []
      : ['在 solopi-desktop UI 中为目标用例库配置 repoUrl/branch/SSH 凭据后再执行 cases pull/push。'],
  };
}

function findCaseLibraryForCli(state = {}, selector = '') {
  const collections = getStateCollectionsForCli(state || {});
  const value = String(selector || '').trim();
  if (!value) {
    return { library: null, collections, error: 'Missing --library <libraryId|name>' };
  }

  const matches = collections.libraries.filter((library) => (
    String(library.id || '') === value || String(library.name || '') === value
  ));
  if (matches.length === 1) {
    return { library: matches[0], collections, error: '' };
  }
  if (matches.length > 1) {
    return { library: null, collections, error: `用例库名称不唯一：${value}，请改用 libraryId。` };
  }
  return { library: null, collections, error: `找不到用例库：${value}` };
}

function walkFilesForCli(rootDir, matcher, files = []) {
  if (!fs.existsSync(rootDir)) {
    return files;
  }

  fs.readdirSync(rootDir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        return;
      }
      walkFilesForCli(fullPath, matcher, files);
      return;
    }
    if (entry.isFile() && matcher(fullPath)) {
      files.push(fullPath);
    }
  });
  return files;
}

function readJsonFileIfExistsForCli(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function readCaseLibraryFilesForCli(repoPath, manifest = {}) {
  const casesRoot = path.join(repoPath, manifest.casesRoot || 'cases');
  const fallbackRoot = fs.existsSync(casesRoot) ? casesRoot : repoPath;
  return walkFilesForCli(fallbackRoot, (filePath) => /\.(json|ya?ml)$/i.test(filePath))
    .map((filePath) => ({
      name: path.basename(filePath),
      path: filePath,
      relativePath: toPosixRelativePathForCli(repoPath, filePath),
      content: fs.readFileSync(filePath, 'utf8'),
    }));
}

function hydrateCaseLibraryFileContentForCli(file, repoPath) {
  if (!/\.json$/i.test(file.name || file.path || '')) {
    return file.content;
  }
  try {
    return JSON.stringify(hydrateCaseLibraryAssetsForCli(JSON.parse(file.content), repoPath), null, 2);
  } catch (_error) {
    return file.content;
  }
}

async function getGitRepoInfoForCli(repoPath) {
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) {
    return null;
  }
  const [branchResult, hashResult, dateResult, authorResult, emailResult, messageResult] = await Promise.all([
    runCommandForCli('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandForCli('git', ['rev-parse', 'HEAD'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandForCli('git', ['log', '-1', '--format=%cI'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandForCli('git', ['log', '-1', '--format=%an'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandForCli('git', ['log', '-1', '--format=%ae'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandForCli('git', ['log', '-1', '--format=%s'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
  ]);

  return {
    branch: branchResult.stdout.trim(),
    commitHash: hashResult.stdout.trim(),
    lastUpdatedAt: dateResult.stdout.trim(),
    lastUpdatedBy: authorResult.stdout.trim(),
    lastUpdatedEmail: emailResult.stdout.trim(),
    lastCommitMessage: messageResult.stdout.trim(),
  };
}

async function checkoutCaseLibraryBranchForCli(repoPath, branch, library = {}) {
  const targetBranch = normalizeGitBranchForCli(branch);
  const options = buildGitCommandOptionsForCli(library, { cwd: repoPath, timeout: 1000 * 60 * 5 });
  await runCommandForCli('git', ['fetch', 'origin', targetBranch], options);
  try {
    await runCommandForCli('git', ['checkout', targetBranch], options);
  } catch (_error) {
    await runCommandForCli('git', ['checkout', '-B', targetBranch, `origin/${targetBranch}`], options);
  }
  await runCommandForCli('git', ['pull', '--ff-only', 'origin', targetBranch], options);
}

async function ensureCaseLibraryRepoForCli(library = {}, options = {}) {
  const repoUrl = String(library.repoUrl || '').trim();
  const branch = getConfiguredGitBranchForCli(library);
  const authRepoUrl = buildAuthenticatedGitUrlForCli(repoUrl, library.authUsername, library.authToken);

  if (!repoUrl) {
    throw new Error('当前库未配置 Git 仓库地址');
  }

  await runCommandForCli('git', ['--version'], { timeout: 5000 });

  const rootDir = options.dataDir ? path.join(options.dataDir,'case-libraries') : getCaseLibrariesRootForCli();
  const repoId = getCaseLibraryRepoIdForCli(repoUrl, branch);
  const repoPath = path.join(rootDir, repoId);
  fs.mkdirSync(rootDir, { recursive: true });

  if (fs.existsSync(path.join(repoPath, '.git'))) {
    await runCommandForCli('git', ['remote', 'set-url', 'origin', authRepoUrl], buildGitCommandOptionsForCli(library, { cwd: repoPath, timeout: 10000 }));
    if (options.update !== false) {
      await checkoutCaseLibraryBranchForCli(repoPath, branch, library);
    }
  } else if (fs.existsSync(repoPath)) {
    throw new Error(`本地缓存目录已存在但不是 Git 仓库：${repoPath}`);
  } else {
    await runCommandForCli('git', ['clone', '--branch', branch, authRepoUrl, repoPath], buildGitCommandOptionsForCli(library, {
      timeout: 1000 * 60 * 10,
      maxBuffer: 1024 * 1024 * 20,
    }));
  }

  await runCommandForCli('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: repoPath, timeout: 10000 }).catch(() => null);
  return { repoPath, repoId, branch };
}

function createRemoteFolderIdForCli(repoId, relativeDir) {
  const safeDir = relativeDir || 'root';
  return `remote-${repoId}-${safeDir.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

function getRemoteCaseRelativeDirForCli(file, manifest = {}) {
  const normalized = sanitizeRelativePathForCli(file.relativePath || '');
  const casesRoot = sanitizeRelativePathForCli(manifest.casesRoot || 'cases').replace(/\/+$/, '');
  const withoutRoot = normalized.startsWith(`${casesRoot}/`)
    ? normalized.slice(casesRoot.length + 1)
    : normalized;
  const dir = withoutRoot.split('/').slice(0, -1).join('/');
  return dir || '根目录';
}

function parseCaseLibraryFilesForCli({ files = [], manifest = {}, repoId = 'remote', libraryId = '', repoUrl = '', gitInfo = {} }) {
  const fallbackLibraryId = `remote-library-${repoId}`;
  const targetLibraryId = libraryId || fallbackLibraryId;
  const libraryName = manifest.name || '云端用例库';
  const configuredBranch = gitInfo?.branch || 'master';
  const folderMap = new Map();
  const importedCases = [];
  const importedComponents = [];
  const importedCaseEdges = {};
  const importedNodePositions = {};
  const parseErrors = [];

  files.forEach((file) => {
    if (/^manifest\.json$/i.test(file.relativePath || '')) {
      return;
    }

    try {
      const parsed = JSON.parse(file.content);
      if (parsed?.schemaVersion === 'glassbox.case-library.workspace.v1' && Array.isArray(parsed.cases)) {
        if (Array.isArray(parsed.components)) {
          importedComponents.push(...parsed.components);
        }
        if (Array.isArray(parsed.folders)) {
          parsed.folders.forEach((folder) => {
            if (folder?.id) {
              folderMap.set(folder.id, {
                ...folder,
                libraryId: targetLibraryId,
                expanded: folder.expanded !== false,
              });
            }
          });
        }
        parsed.cases.forEach((testCase) => {
          if (!testCase?.id) {
            return;
          }
          const folderId = getCaseFolderIdForCli(testCase);
          if (!folderMap.has(folderId)) {
            folderMap.set(folderId, {
              id: folderId,
              name: parsed.name || libraryName,
              libraryId: targetLibraryId,
              expanded: true,
            });
          }
          importedCases.push({ ...testCase, folderId });
        });
        if (parsed.caseEdges && typeof parsed.caseEdges === 'object') {
          Object.entries(parsed.caseEdges).forEach(([caseId, edges]) => {
            if (Array.isArray(edges)) {
              importedCaseEdges[caseId] = normalizeCaseEdges(edges, importedCases.find((item) => item.id === caseId));
            }
          });
        }
        if (parsed.nodePositions && typeof parsed.nodePositions === 'object') {
          Object.entries(parsed.nodePositions).forEach(([caseId, positions]) => {
            if (positions && typeof positions === 'object') {
              importedNodePositions[caseId] = positions;
            }
          });
        }
        return;
      }

      const candidateCases = parsed?.schemaVersion === 'glassbox.workflow.v1'
        ? [parsed]
        : (Array.isArray(parsed?.cases) ? parsed.cases : []);
      if (candidateCases.length) {
        const relativeDir = getRemoteCaseRelativeDirForCli(file, manifest);
        const folderId = createRemoteFolderIdForCli(repoId, relativeDir);
        if (!folderMap.has(folderId)) {
          folderMap.set(folderId, {
            id: folderId,
            name: relativeDir === '根目录' ? '根目录' : relativeDir,
            libraryId: targetLibraryId,
            expanded: true,
          });
        }
        candidateCases.forEach((testCase) => {
          if (testCase?.id) {
            importedCases.push({ ...testCase, folderId });
          }
        });
      }
    } catch (error) {
      parseErrors.push(`${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
    }
  });

  return {
    libraryId: targetLibraryId,
    libraryName,
    repoUrl,
    branch: configuredBranch,
    folders: [...folderMap.values()],
    cases: importedCases,
    components: importedComponents,
    caseEdges: importedCaseEdges,
    nodePositions: importedNodePositions,
    parseErrors,
  };
}

function mergePulledCaseLibraryIntoStateForCli(state = {}, library = {}, parsed = {}, gitInfo = {}) {
  const targetLibraryId = parsed.libraryId || library.id;
  const fallbackLibraryId = parsed.libraryId && parsed.libraryId !== library.id ? parsed.libraryId : `remote-library-${getCaseLibraryRepoIdForCli(library.repoUrl, parsed.branch)}`;
  const currentLibraries = getStateCollectionsForCli(state).libraries;
  const existing = currentLibraries.find((item) => item.id === targetLibraryId) || library;
  const nextLibraries = currentLibraries
    .filter((item) => item.id === targetLibraryId || item.id !== fallbackLibraryId)
    .map((item) => (item.id === targetLibraryId ? {
      ...item,
      name: parsed.libraryName || item.name,
      repoUrl: library.repoUrl || item.repoUrl || parsed.repoUrl || '',
      authUsername: item.authUsername || library.authUsername,
      authToken: item.authToken || library.authToken,
      sshKeyPath: item.sshKeyPath || library.sshKeyPath,
      sshPassphrase: item.sshPassphrase || library.sshPassphrase,
      gitBranch: item.gitBranch || library.gitBranch || parsed.branch,
      branch: gitInfo?.branch || parsed.branch,
      lastCommit: gitInfo?.commitHash || item.lastCommit || '',
      lastUpdatedAt: gitInfo?.lastUpdatedAt || item.lastUpdatedAt,
      lastUpdatedBy: gitInfo?.lastUpdatedBy || item.lastUpdatedBy,
      lastUpdatedEmail: gitInfo?.lastUpdatedEmail || item.lastUpdatedEmail,
      lastCommitMessage: gitInfo?.lastCommitMessage || item.lastCommitMessage,
      autoUpdate: Boolean(item.autoUpdate),
      expanded: item.expanded !== false,
    } : item));
  if (!nextLibraries.some((item) => item.id === targetLibraryId)) {
    nextLibraries.push({
      ...existing,
      id: targetLibraryId,
      name: parsed.libraryName || existing.name || targetLibraryId,
      repoUrl: library.repoUrl || parsed.repoUrl || '',
      gitBranch: library.gitBranch || parsed.branch,
      branch: gitInfo?.branch || parsed.branch,
      lastCommit: gitInfo?.commitHash || '',
      lastUpdatedAt: gitInfo?.lastUpdatedAt || '',
      lastUpdatedBy: gitInfo?.lastUpdatedBy || '',
      lastUpdatedEmail: gitInfo?.lastUpdatedEmail || '',
      lastCommitMessage: gitInfo?.lastCommitMessage || '',
    });
  }

  const currentFolders = Array.isArray(state.caseFolders) ? state.caseFolders : [];
  const currentLibraryFolderIds = new Set(currentFolders
    .filter((folder) => getFolderLibraryIdForCli(folder) === targetLibraryId || folder.libraryId === fallbackLibraryId)
    .map((folder) => folder.id));
  const nextFolders = currentFolders.filter((folder) => !currentLibraryFolderIds.has(folder.id));
  parsed.folders.forEach((folder) => nextFolders.push(folder));

  const previousFolderIds = new Set(currentLibraryFolderIds);
  const importedFolderIds = new Set(parsed.folders.map((folder) => folder.id));
  const nextCases = (Array.isArray(state.cases) ? state.cases : [])
    .filter((testCase) => !previousFolderIds.has(getCaseFolderIdForCli(testCase)));
  parsed.cases.forEach((testCase) => nextCases.push(testCase));

  const nextCaseEdges = { ...(state.caseEdges || {}) };
  parsed.cases.forEach((testCase) => {
    nextCaseEdges[testCase.id] = normalizeCaseEdges(parsed.caseEdges[testCase.id] || nextCaseEdges[testCase.id] || createEdgesFromSteps(testCase.steps || []), testCase);
  });
  Object.keys(nextCaseEdges).forEach((caseId) => {
    const stillExists = nextCases.some((testCase) => testCase.id === caseId);
    if (!stillExists) {
      delete nextCaseEdges[caseId];
    }
  });

  const nextNodePositions = { ...(state.nodePositions || {}) };
  parsed.cases.forEach((testCase) => {
    nextNodePositions[testCase.id] = parsed.nodePositions[testCase.id] || nextNodePositions[testCase.id] || {};
  });
  Object.keys(nextNodePositions).forEach((caseId) => {
    const stillExists = nextCases.some((testCase) => testCase.id === caseId);
    if (!stillExists) {
      delete nextNodePositions[caseId];
    }
  });

  const nextComponentMap = new Map((Array.isArray(state.components) ? state.components : []).map((component) => [component.id, component]));
  parsed.components.forEach((component) => {
    if (component?.id) {
      nextComponentMap.set(component.id, component);
    }
  });
  parsed.cases.forEach((testCase) => {
    (testCase.components || []).forEach((component) => {
      if (component?.id) {
        nextComponentMap.set(component.id, component);
      }
    });
  });

  return {
    ...state,
    caseLibraries: nextLibraries,
    caseFolders: nextFolders,
    cases: nextCases,
    components: [...nextComponentMap.values()],
    caseEdges: nextCaseEdges,
    nodePositions: nextNodePositions,
    selectedCaseLibraryId: targetLibraryId,
    selectedCaseFolderId: parsed.cases[0]?.folderId || [...importedFolderIds][0] || state.selectedCaseFolderId,
    selectedCaseId: parsed.cases[0]?.id || state.selectedCaseId,
  };
}

function collectCaseLibraryWorkspaceForCli(state = {}, library = {}, collections = getStateCollectionsForCli(state)) {
  const libraryFolders = collections.folders.filter((folder) => getFolderLibraryIdForCli(folder) === library.id);
  const folderIds = new Set(libraryFolders.map((folder) => folder.id));
  const libraryCases = (Array.isArray(state.cases) ? state.cases : [])
    .filter((testCase) => folderIds.has(getCaseFolderIdForCli(testCase)));
  const builtinComponentIds = new Set(builtinComponents.map((component) => component.id));
  const referencedComponentIds = new Set(libraryCases.flatMap((testCase) => (
    Array.isArray(testCase.steps)
      ? testCase.steps.map((step) => step?.componentId).filter(Boolean)
      : []
  )));
  const componentMap = new Map();

  const collectComponent = (component) => {
    if (!component?.id || !isSupportedComponent(component) || builtinComponentIds.has(component.id)) {
      return;
    }
    componentMap.set(component.id, component);
  };

  for (const component of Array.isArray(state.components) ? state.components : []) {
    if (referencedComponentIds.has(component.id)) {
      collectComponent(component);
    }
  }
  libraryCases.forEach((testCase) => {
    (testCase.components || []).forEach(collectComponent);
  });

  const caseEdges = Object.fromEntries(libraryCases.map((testCase) => {
    const storedEdges = normalizeCaseEdges(state.caseEdges?.[testCase.id] || [], testCase);
    const fallbackEdges = createEdgesFromSteps(testCase.steps || []);
    return [testCase.id, storedEdges.length ? storedEdges : fallbackEdges];
  }));
  const nodePositions = Object.fromEntries(libraryCases.map((testCase) => [
    testCase.id,
    getCaseNodePositionsForCli(state || {}, testCase.id, testCase, state.caseEdges?.[testCase.id] || testCase.edges || createEdgesFromSteps(testCase.steps || [])),
  ]));

  return {
    folders: libraryFolders,
    cases: libraryCases,
    components: [...componentMap.values()],
    caseEdges,
    nodePositions,
  };
}

function createCaseLibraryTtsTemplateForCli(cases = []) {
  const workflowUsage = (Array.isArray(cases) ? cases : []).flatMap((testCase) => (
    (Array.isArray(testCase?.steps) ? testCase.steps : [])
      .filter((step) => step?.type === 'tts_synthesize')
      .map((step) => ({
        caseId: testCase.id || '',
        caseName: testCase.name || '',
        stepId: step.id || '',
        stepName: step.name || '',
        text: step.config?.text || '',
      }))
  ));
  if (!workflowUsage.length) {
    return null;
  }
  return {
    schemaVersion: 'glassbox.tts-provider-template.v1',
    generatedAt: new Date().toISOString(),
    workflowUsage,
    notes: [
      '此模板由 CLI 导出，用于提示团队成员在本机设置中心配置对应 TTS Provider。',
      '模板不包含真实密钥。',
    ],
  };
}

function writeCaseLibraryWorkspaceForCli(repoPath, library = {}, workspace = {}) {
  const manifestPath = path.join(repoPath, 'manifest.json');
  const casesDir = path.join(repoPath, 'cases');
  const settingsDir = path.join(repoPath, 'settings');
  const assetsRoot = 'assets';

  fs.rmSync(casesDir, { recursive: true, force: true });
  fs.rmSync(settingsDir, { recursive: true, force: true });
  fs.mkdirSync(casesDir, { recursive: true });
  fs.mkdirSync(settingsDir, { recursive: true });
  fs.mkdirSync(path.join(repoPath, assetsRoot), { recursive: true });

  const updatedAt = new Date().toISOString();
  const workspaceFileName = 'glassbox-library.json';
  const archivedCases = archiveCaseLibraryAssetsForCli(workspace.cases || [], repoPath, assetsRoot);
  const archivedComponents = archiveCaseLibraryAssetsForCli(workspace.components || [], repoPath, assetsRoot, archivedCases.copiedAssets);
  const ttsTemplate = createCaseLibraryTtsTemplateForCli(workspace.cases || []);
  const ttsTemplateFile = ttsTemplate ? 'settings/tts-provider.template.json' : '';

  const workspacePayload = {
    schemaVersion: 'glassbox.case-library.workspace.v1',
    name: library.name || 'solopi-desktop 用例库',
    folders: (workspace.folders || []).map((folder) => ({
      id: folder.id,
      name: folder.name,
      parentId: folder.parentId,
      expanded: folder.expanded !== false,
    })),
    cases: archivedCases.value,
    components: archivedComponents.value,
    caseEdges: workspace.caseEdges || {},
    nodePositions: workspace.nodePositions || {},
    dependencies: {
      ttsProviderTemplate: ttsTemplateFile,
      ttsNodeCount: ttsTemplate?.workflowUsage?.length || 0,
    },
    updatedAt,
  };

  fs.writeFileSync(manifestPath, JSON.stringify({
    schemaVersion: 'glassbox.case-library.v1',
    name: library.name || 'solopi-desktop 用例库',
    casesRoot: 'cases',
    assetsRoot,
    workspaceFile: `cases/${workspaceFileName}`,
    ttsProviderTemplate: ttsTemplateFile,
    folderCount: workspacePayload.folders.length,
    caseCount: workspacePayload.cases.length,
    assetCount: archivedComponents.copiedAssets.size,
    updatedAt,
  }, null, 2));
  fs.writeFileSync(path.join(casesDir, workspaceFileName), JSON.stringify(workspacePayload, null, 2));
  if (ttsTemplate) {
    fs.writeFileSync(path.join(settingsDir, 'tts-provider.template.json'), JSON.stringify(ttsTemplate, null, 2));
  }

  return {
    workspaceFile: `cases/${workspaceFileName}`,
    folderCount: workspacePayload.folders.length,
    caseCount: workspacePayload.cases.length,
    componentCount: workspacePayload.components.length,
    assetCount: archivedComponents.copiedAssets.size,
  };
}

function parseGitPorcelainForCli(stdout = '') {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)
    .map((line) => ({
      status: line.slice(0, 2).trim() || 'modified',
      path: line.slice(3).trim() || line.slice(2).trim(),
    }));
}

async function getCaseLibraryPullPayloadForCli(command, storage = {}) {
  const dryRun = hasFlag(command, '--dry-run');
  const librarySelector = getOption(command, '--library');
  const { path: statePath, state } = (storage.readState || readWorkflowStateForCli)();
  const selection = findCaseLibraryForCli(state || {}, librarySelector);

  if (!selection.library) {
    return createCliCommandFailurePayload(selection.error, {
      errorCode: 'CASE_LIBRARY_SELECTION_FAILED',
      errorType: 'case-library-sync',
      recoveryActions: [
        '运行 solopi-desktop cases libraries --json 查看可同步用例库。',
        '使用 --library <libraryId> 指定唯一用例库。',
      ],
      extra: {
        schemaVersion: 'glassbox.case-library.pull.v1',
        dryRun,
        statePath,
      },
    });
  }

  const library = selection.library;
  const branch = getConfiguredGitBranchForCli(library);
  try {
    const repo = await ensureCaseLibraryRepoForCli(library, {dataDir:storage.dataDir});
    const manifestPath = path.join(repo.repoPath, 'manifest.json');
    const manifest = readJsonFileIfExistsForCli(manifestPath) || {
      schemaVersion: 'glassbox.case-library.v1',
      name: library.name || path.basename(repo.repoPath),
      casesRoot: 'cases',
      assetsRoot: 'assets',
    };
    const gitInfo = await getGitRepoInfoForCli(repo.repoPath);
    const files = readCaseLibraryFilesForCli(repo.repoPath, manifest).map((file) => ({
      ...file,
      content: hydrateCaseLibraryFileContentForCli(file, repo.repoPath),
    }));
    const parsed = parseCaseLibraryFilesForCli({
      files,
      manifest,
      repoId: repo.repoId,
      libraryId: library.id,
      repoUrl: library.repoUrl,
      gitInfo,
    });

    let writtenStatePath = '';
    if (!dryRun) {
      const nextState = mergePulledCaseLibraryIntoStateForCli((storage.readState || readWorkflowStateForCli)().state || {}, library, parsed, gitInfo || {});
      writtenStatePath = await (storage.writeState || writeWorkflowStateForCli)(nextState);
    }

    return {
      success: true,
      schemaVersion: 'glassbox.case-library.pull.v1',
      dryRun,
      statePath,
      writtenStatePath,
      libraryId: library.id,
      libraryName: library.name || library.id,
      repoUrl: library.repoUrl || '',
      branch,
      repoPath: repo.repoPath,
      commitHash: gitInfo?.commitHash || '',
      importedCases: parsed.cases.length,
      importedComponents: parsed.components.length,
      importedFolders: parsed.folders.length,
      fileCount: files.length,
      files: files.map((file) => file.relativePath),
      warnings: parsed.parseErrors.length ? parsed.parseErrors.map((item) => `Skipped ${item}`) : [],
      recoveryActions: parsed.parseErrors.length
        ? ['检查 warnings 中列出的远端文件格式，必要时用 UI 重新导出用例库后再 pull。']
        : [],
    };
  } catch (error) {
    return createCliCommandFailurePayload(stripGitCredentialFromMessageForCli(error instanceof Error ? error.message : String(error)), {
      errorCode: 'CASE_LIBRARY_PULL_FAILED',
      errorType: 'case-library-sync',
      recoveryActions: [
        '运行 solopi-desktop cases libraries --json 确认 repoUrl、branch、sshKeyPath 已配置。',
        '确认本机 git 可用，SSH key/Token 有读取远端仓库权限。',
        '先执行 solopi-desktop cases pull --library <libraryId> --dry-run --json 查看远端解析结果。',
      ],
      extra: {
        schemaVersion: 'glassbox.case-library.pull.v1',
        dryRun,
        statePath,
        libraryId: library.id,
        libraryName: library.name || library.id,
        repoUrl: library.repoUrl || '',
        branch,
      },
    });
  }
}

async function getCaseLibraryPushPayloadForCli(command, storage = {}) {
  const dryRun = hasFlag(command, '--dry-run');
  const librarySelector = getOption(command, '--library');
  const message = String(getOption(command, '--message') || '').trim();
  const { path: statePath, state } = (storage.readState || readWorkflowStateForCli)();
  const selection = findCaseLibraryForCli(state || {}, librarySelector);

  if (!selection.library) {
    return createCliCommandFailurePayload(selection.error, {
      errorCode: 'CASE_LIBRARY_SELECTION_FAILED',
      errorType: 'case-library-sync',
      recoveryActions: [
        '运行 solopi-desktop cases libraries --json 查看可同步用例库。',
        '使用 --library <libraryId> 指定唯一用例库。',
      ],
      extra: {
        schemaVersion: 'glassbox.case-library.push.v1',
        dryRun,
        statePath,
      },
    });
  }

  const library = selection.library;
  const branch = getConfiguredGitBranchForCli(library);
  if (!message && !dryRun) {
    return createCliCommandFailurePayload('Missing --message <msg> for cases push', {
      errorCode: 'CASE_LIBRARY_PUSH_MISSING_MESSAGE',
      errorType: 'case-library-sync',
      recoveryActions: [
        '先执行 solopi-desktop cases push --library <libraryId> --message "<msg>" --dry-run --json 检查变更。',
        '确认变更范围正确后，去掉 --dry-run 并保留明确的 --message。',
      ],
      extra: {
        schemaVersion: 'glassbox.case-library.push.v1',
        dryRun,
        statePath,
        libraryId: library.id,
      },
    });
  }

  try {
    const repo = await ensureCaseLibraryRepoForCli(library, {dataDir:storage.dataDir});
    let workingRepoPath = repo.repoPath;
    let dryRunRepoPath = '';
    if (dryRun) {
      dryRunRepoPath = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbox-case-library-push-dry-run-'));
      await runCommandForCli('git', ['clone', repo.repoPath, dryRunRepoPath], {
        timeout: 1000 * 60 * 5,
        maxBuffer: 1024 * 1024 * 20,
      });
      workingRepoPath = dryRunRepoPath;
    }
    const workspace = collectCaseLibraryWorkspaceForCli(state || {}, library, selection.collections);
    const exportInfo = writeCaseLibraryWorkspaceForCli(workingRepoPath, library, workspace);

    await runCommandForCli('git', ['lfs', 'track', 'assets/audio/*.pcm', 'assets/audio/*.wav', 'assets/audio/*.ogg', 'assets/audio/*.spx', 'assets/audio/*.speex', 'assets/audio/*.mp3', 'assets/audio/*.m4a', 'assets/audio/*.webm', 'assets/images/*.png', 'assets/images/*.jpg', 'assets/images/*.jpeg', 'assets/images/*.webp', 'assets/images/*.gif', 'assets/images/*.bmp'], {
      cwd: workingRepoPath,
      timeout: 1000 * 60,
    }).catch(() => null);
    await runCommandForCli('git', ['add', '-A', 'manifest.json', 'cases', 'assets', 'settings', '.gitattributes'], {
      cwd: workingRepoPath,
      timeout: 1000 * 60,
    });
    const status = await runCommandForCli('git', ['status', '--porcelain'], {
      cwd: workingRepoPath,
      timeout: 10000,
    });
    const changedFiles = parseGitPorcelainForCli(status.stdout);

    let commitHash = '';
    let gitInfo = await getGitRepoInfoForCli(workingRepoPath);
    if (!dryRun && changedFiles.length) {
      await runCommandForCli('git', ['commit', '-m', message], {
        cwd: workingRepoPath,
        timeout: 1000 * 60,
      });
      await runCommandForCli('git', ['push', 'origin', branch], buildGitCommandOptionsForCli(library, {
        cwd: workingRepoPath,
        timeout: 1000 * 60 * 5,
        maxBuffer: 1024 * 1024 * 20,
      }));
      gitInfo = await getGitRepoInfoForCli(workingRepoPath);
      commitHash = gitInfo?.commitHash || '';
    } else {
      commitHash = gitInfo?.commitHash || '';
    }

    await runCommandForCli('git', ['remote', 'set-url', 'origin', library.repoUrl || ''], { cwd: workingRepoPath, timeout: 10000 }).catch(() => null);

    return {
      success: true,
      schemaVersion: 'glassbox.case-library.push.v1',
      dryRun,
      statePath,
      libraryId: library.id,
      libraryName: library.name || library.id,
      repoUrl: library.repoUrl || '',
      branch,
      repoPath: repo.repoPath,
      dryRunRepoPath,
      message: message || '',
      commitHash,
      changedFiles,
      changedFileCount: changedFiles.length,
      folderCount: exportInfo.folderCount,
      caseCount: exportInfo.caseCount,
      componentCount: exportInfo.componentCount,
      assetCount: exportInfo.assetCount,
      workspaceFile: exportInfo.workspaceFile,
      warnings: dryRun
        ? ['dry-run 在临时 Git 工作区计算 changedFiles；未写入 solopi-desktop 本地 repo 缓存，未 commit，未 push。']
        : [],
      recoveryActions: changedFiles.length
        ? []
        : ['当前库没有可提交变更；如预期有变化，请确认用例属于目标 library，或先运行 cases libraries --json 检查库/文件夹归属。'],
    };
  } catch (error) {
    return createCliCommandFailurePayload(stripGitCredentialFromMessageForCli(error instanceof Error ? error.message : String(error)), {
      errorCode: 'CASE_LIBRARY_PUSH_FAILED',
      errorType: 'case-library-sync',
      recoveryActions: [
        '运行 solopi-desktop cases libraries --json 确认 repoUrl、branch、sshKeyPath 已配置。',
        '先执行 solopi-desktop cases push --library <libraryId> --message "<msg>" --dry-run --json 查看将提交的文件。',
        '确认本机 git/SSH key/Token 有写入远端仓库权限。',
      ],
      extra: {
        schemaVersion: 'glassbox.case-library.push.v1',
        dryRun,
        statePath,
        libraryId: library.id,
        libraryName: library.name || library.id,
        repoUrl: library.repoUrl || '',
        branch,
      },
    });
  }
}

function getTaskDetailPathForCli(task) {
  const configuredPath = String(task?.reportDetailPath || '').trim();
  if (configuredPath) {
    return path.isAbsolute(configuredPath) ? configuredPath : path.resolve(process.cwd(), configuredPath);
  }
  return getWorkflowReportDetailPathForCli(task?.id || '');
}

function loadTaskDetailForCli(task) {
  if (!task || typeof task !== 'object') {
    return { task, detailPath: '', detailLoaded: false, detailError: 'Invalid task' };
  }

  if (Array.isArray(task.cases) && task.cases.length > 0 && task.reportDetailLoaded !== false) {
    return {
      task,
      detailPath: String(task.reportDetailPath || ''),
      detailLoaded: true,
      detailError: '',
    };
  }

  const detailPath = getTaskDetailPathForCli(task);
  if (!detailPath || !fs.existsSync(detailPath)) {
    return {
      task: {
        ...task,
        reportDetailPath: task.reportDetailPath || detailPath,
      },
      detailPath,
      detailLoaded: false,
      detailError: detailPath ? '报告详情文件不存在' : '报告详情路径为空',
    };
  }

  try {
    const detail = JSON.parse(fs.readFileSync(detailPath, 'utf8'));
    const detailTask = detail?.task && typeof detail.task === 'object' ? detail.task : detail;
    return {
      task: {
        ...task,
        ...detailTask,
        reportDetailPath: detailPath,
        reportDetailLoaded: true,
      },
      detailPath,
      detailLoaded: true,
      detailError: '',
    };
  } catch (error) {
    return {
      task: {
        ...task,
        reportDetailPath: detailPath,
      },
      detailPath,
      detailLoaded: false,
      detailError: error instanceof Error ? error.message : String(error),
    };
  }
}

function readTaskRunnerMetadataForCli(taskId) {
  const metadataPath = getCliTaskRunnerMetadataPathForCli(taskId);
  try {
    if (fs.existsSync(metadataPath)) {
      return {
        metadataPath,
        metadata: JSON.parse(fs.readFileSync(metadataPath, 'utf8')),
      };
    }
  } catch (error) {
    return {
      metadataPath,
      metadata: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return {
    metadataPath,
    metadata: null,
  };
}

function persistTaskRunnerMetadataForCli(taskId, metadata = {}) {
  if (!taskId) {
    return '';
  }
  const metadataPath = getCliTaskRunnerMetadataPathForCli(taskId);
  writeJsonFileAtomic(metadataPath, {
    schemaVersion: 'glassbox.cli-task-runner.v1',
    taskId,
    updatedAt: new Date().toISOString(),
    ...metadata,
  });
  return metadataPath;
}

function probeProcessLivenessForCli(pid, options = {}) {
  const value = Number(pid || 0);
  if (!Number.isInteger(value) || value <= 0) {
    return {
      pid: value,
      alive: null,
      liveness: 'unknown',
      checked: false,
      errorCode: 'PROCESS_PID_INVALID',
      error: '缺少有效的 runner pid。',
    };
  }
  try {
    const processKill = typeof options.processKill === 'function' ? options.processKill : process.kill.bind(process);
    processKill(value, 0);
    return {
      pid: value,
      alive: true,
      liveness: 'alive',
      checked: true,
      errorCode: '',
      error: '',
    };
  } catch (error) {
    const errorCode = String(error?.code || '');
    if (errorCode === 'ESRCH') {
      return {
        pid: value,
        alive: false,
        liveness: 'dead',
        checked: true,
        errorCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    if (errorCode === 'EPERM') {
      return {
        pid: value,
        alive: true,
        liveness: 'alive',
        checked: true,
        permissionDenied: true,
        errorCode,
        error: error instanceof Error ? error.message : String(error),
      };
    }
    return {
      pid: value,
      alive: null,
      liveness: 'unknown',
      checked: false,
      errorCode: errorCode || 'PROCESS_PROBE_FAILED',
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function isProcessAliveForCli(pid, options = {}) {
  return probeProcessLivenessForCli(pid, options).alive === true;
}

function getProcessTableSnapshotForCli(options = {}) {
  if (Array.isArray(options.processTable)) {
    return {
      processes: options.processTable,
      checked: true,
      source: 'option',
      errorCode: '',
      error: '',
    };
  }
  if (process.env.GLASSBOX_CLI_PROCESS_TABLE_JSON) {
    try {
      const parsed = JSON.parse(process.env.GLASSBOX_CLI_PROCESS_TABLE_JSON);
      if (Array.isArray(parsed)) {
        return {
          processes: parsed.map((item) => ({
            pid: Number(item.pid || 0),
            command: String(item.command || item.args || ''),
          })).filter((item) => item.pid && item.command),
          checked: true,
          source: 'environment',
          errorCode: '',
          error: '',
        };
      }
      return {
        processes: [],
        checked: false,
        source: 'environment',
        errorCode: 'PROCESS_TABLE_INVALID',
        error: 'GLASSBOX_CLI_PROCESS_TABLE_JSON 必须是数组。',
      };
    } catch (error) {
      return {
        processes: [],
        checked: false,
        source: 'environment',
        errorCode: 'PROCESS_TABLE_PARSE_FAILED',
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  const spawnProcess = typeof options.spawnProcess === 'function' ? options.spawnProcess : spawnSync;
  const result = spawnProcess('ps', ['-axo', 'pid=,command='], {
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 10,
  });
  if (result.status !== 0) {
    return {
      processes: [],
      checked: false,
      source: 'ps',
      errorCode: 'PROCESS_TABLE_QUERY_FAILED',
      error: String(result.error?.message || result.stderr || `ps exited with status ${result.status}`),
    };
  }
  return {
    processes: String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean),
    checked: true,
    source: 'ps',
    errorCode: '',
    error: '',
  };
}

function extractHeadlessPayloadPathFromCommandForCli(command = '') {
  const text = String(command || '');
  const match = text.match(/--glassbox-cli-run-task-payload(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/);
  return match ? (match[1] || match[2] || match[3] || '') : '';
}

function findHeadlessRunnerProcessesForCli(taskId, options = {}) {
  const processTableSnapshot = options.processTableSnapshot || getProcessTableSnapshotForCli(options);
  const processTable = processTableSnapshot.processes || [];
  const runners = [];
  for (const item of processTable) {
    const command = String(item.command || '');
    if (!command.includes('--glassbox-cli-run-task-payload')) {
      continue;
    }
    const payloadPath = extractHeadlessPayloadPathFromCommandForCli(command);
    let payloadTaskId = '';
    if (payloadPath) {
      try {
        const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
        payloadTaskId = String(payload.taskId || '');
      } catch (_error) {
        // Fall back to command matching below.
      }
    }
    if (String(payloadTaskId || '') === String(taskId || '') || command.includes(String(taskId || ''))) {
      const probe = probeProcessLivenessForCli(item.pid, options);
      runners.push({
        pid: Number(item.pid || 0),
        command,
        payloadPath,
        taskId: payloadTaskId || taskId,
        alive: probe.alive,
        liveness: probe.liveness,
        probe,
        identityVerified: true,
      });
    }
  }
  return {
    runners,
    processTable: processTableSnapshot,
  };
}

function getTaskRunnerStatusForCli(taskId, options = {}) {
  const metadataInfo = readTaskRunnerMetadataForCli(taskId);
  const metadata = metadataInfo.metadata || {};
  const metadataPid = Number(metadata.runnerPid || metadata.pid || 0);
  const processTableSnapshot = getProcessTableSnapshotForCli(options);
  const processRunnerResult = findHeadlessRunnerProcessesForCli(taskId, {
    ...options,
    processTableSnapshot,
  });
  const metadataProbe = metadataPid ? probeProcessLivenessForCli(metadataPid, options) : null;
  const runners = [
    ...(metadataPid ? [{
      pid: metadataPid,
      command: metadata.runnerCommand || '',
      payloadPath: metadata.payloadPath || '',
      taskId,
      alive: metadataProbe.alive,
      liveness: metadataProbe.liveness,
      probe: metadataProbe,
      source: metadataInfo.metadataPath,
    }] : []),
    ...processRunnerResult.runners,
  ].filter((runner, index, list) => runner.pid && list.findIndex((item) => item.pid === runner.pid) === index);
  const hasAliveRunner = runners.some((runner) => runner.alive === true);
  const hasUnknownRunner = runners.some((runner) => runner.alive === null);
  const liveness = hasAliveRunner
    ? 'alive'
    : (hasUnknownRunner || metadataInfo.error || !processTableSnapshot.checked ? 'unknown' : 'dead');

  return {
    taskId,
    metadataPath: metadataInfo.metadataPath,
    metadataError: metadataInfo.error || '',
    metadata,
    processTableChecked: processTableSnapshot.checked,
    processTableSource: processTableSnapshot.source,
    processTableErrorCode: processTableSnapshot.errorCode,
    processTableError: processTableSnapshot.error,
    runners,
    liveness,
    alive: liveness === 'alive' ? true : (liveness === 'dead' ? false : null),
  };
}

function getTaskStopRecoveryActionsForCli(taskId) {
  return [
    `运行 solopi-desktop tasks stop ${taskId} --force --json 触发本地 runner 兜底停止并落盘为 stopped。`,
    `运行 solopi-desktop tasks show ${taskId} --json 查看 staleRunning、runnerDiagnostics 和 partial reportPackage 状态。`,
    '如果本地进程仍在运行但 CLI 无权停止，请在同一用户会话中重试，或手动结束返回的 runner pid 后再次执行 tasks stop --force。',
    '任务进入 stopped 后，运行 solopi-desktop reports show <taskId> --json 或 reports reindex --json 生成/修复 partial .glassreport。',
  ];
}

function getTaskRunnerUnknownRecoveryActionsForCli(taskId) {
  return [
    `在启动任务的同一用户会话中重新运行 solopi-desktop tasks show ${taskId} --json。`,
    '核对 currentCaseName、completed 和任务明细更新时间是否继续推进；存活状态未知时不要仅凭本次探测结果执行强制停止。',
    '如确需停止，请先恢复进程查询权限或确认返回的 runner pid/命令属于该任务。',
  ];
}

function isTerminalTaskStatusForCli(statusOrTask, taskCandidate = null) {
  const task = statusOrTask && typeof statusOrTask === 'object' ? statusOrTask : taskCandidate;
  if (task && typeof task === 'object') {
    return isAuthoritativeTaskTerminal(task);
  }
  return ['success', 'failed', 'stopped'].includes(String(statusOrTask || '').trim());
}

function getPersistedTaskForCli(taskId) {
  const { path: statePath, state } = readWorkflowStateForCli();
  const localTasks = Array.isArray(state?.automationTasks) ? state.automationTasks : [];
  const tasks = [...localTasks, ...readVisibleTasks(getGlassBoxCliDataDir()).filter(task => !localTasks.some(local => local.id === task.id))];
  const summaryTask = tasks.find((item) => String(item?.id || '') === String(taskId || ''));
  const defaultDetailPath = getWorkflowReportDetailPathForCli(taskId);
  const detailExists = fs.existsSync(defaultDetailPath);
  const loaded = summaryTask
    ? loadTaskDetailForCli(summaryTask)
    : (detailExists ? loadTaskDetailForCli({
      id: taskId,
      reportDetailPath: defaultDetailPath,
      reportDetailLoaded: false,
    }) : null);
  return {
    statePath,
    state,
    tasks,
    summaryTask,
    loaded,
    task: loaded?.task || summaryTask || null,
    exists: Boolean(summaryTask || detailExists),
  };
}

function persistTaskReportPackageForCli(statePath, state, task, detailPath) {
  if(statePath && fs.existsSync(statePath) && (JSON.parse(fs.readFileSync(statePath,'utf8')).removedAutomationTasks || []).some(r=>r.id===task?.id))return;
  if (!task?.id) {
    return;
  }

  if (detailPath) {
    try {
      writeJsonFileAtomic(detailPath, task);
    } catch (_error) {
      // The package path can still be returned even when the current sandbox cannot rewrite persisted details.
    }
  }

  if (!statePath || !state || typeof state !== 'object') {
    return;
  }

  const tasks = Array.isArray(state.automationTasks) ? state.automationTasks : [];
  const nextTasks = tasks.map((item) => {
    if (String(item?.id || '') !== String(task.id || '')) {
      return item;
    }

    return {
      ...item,
      reportPackagePath: task.reportPackagePath || item.reportPackagePath || '',
      reportPackage: task.reportPackage || item.reportPackage,
      reportPackageError: task.reportPackageError || undefined,
    };
  });

  try {
    writeJsonFileAtomic(statePath, {
      ...state,
      automationTasks: nextTasks,
    });
  } catch (_error) {
    // Keep reports show usable even if the state file is read-only in the current execution environment.
  }
}

function ensureTaskReportPackageForCli(loaded, statePath, state, options = {}) {
  const task = loaded?.task;
  if (!options.reportsOnly || !loaded?.detailLoaded || !task?.id || !isTerminalTaskStatusForCli(task)) {
    return loaded;
  }

  const existingPath = String(task.reportPackagePath || task.reportPackage?.path || '').trim();
  if (existingPath && fs.existsSync(existingPath)) {
    return loaded;
  }

  try {
    const reportPackage = createReportPackageFromTask(task, getDefaultTaskReportPackagePathForCli(task));
    const nextTask = {
      ...task,
      reportPackage,
      reportPackagePath: reportPackage.path,
      reportPackageError: undefined,
    };
    persistTaskReportPackageForCli(statePath, state, nextTask, loaded.detailPath);
    return {
      ...loaded,
      task: nextTask,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const nextTask = {
      ...task,
      reportPackage: {
        success: false,
        error: message,
      },
      reportPackageError: message,
    };
    persistTaskReportPackageForCli(statePath, state, nextTask, loaded.detailPath);
    return {
      ...loaded,
      task: nextTask,
      detailError: loaded.detailError || message,
    };
  }
}

function summarizeStoppedTaskCountsForCli(cases = []) {
  const list = Array.isArray(cases) ? cases : [];
  return {
    successCount: list.filter((item) => item?.status === 'success').length,
    failedCount: list.filter((item) => item?.status === 'failed').length,
    stoppedCount: list.filter((item) => item?.status === 'stopped').length,
    runningCount: list.filter((item) => item?.status === 'running').length,
    pendingCount: list.filter((item) => ['pending', 'submitted', ''].includes(String(item?.status || ''))).length,
    caseCount: list.length,
  };
}

function markTaskStoppedForCli(task = {}, options = {}) {
  const now = options.stoppedAt || new Date().toISOString();
  const cases = Array.isArray(task.cases) ? task.cases.map((caseRecord) => {
    const status = String(caseRecord?.status || '');
    if (['success', 'failed', 'stopped'].includes(status)) {
      return caseRecord;
    }
    return {
      ...caseRecord,
      status: 'stopped',
      stopped: true,
      endedAt: caseRecord.endedAt || now,
      error: caseRecord.error || '任务已被 CLI 停止。',
    };
  }) : task.cases;
  const counts = summarizeStoppedTaskCountsForCli(cases || []);
  const completed = Array.isArray(cases)
    ? cases.filter((item) => ['success', 'failed', 'stopped'].includes(String(item?.status || ''))).length
    : Number(task.completed || 0);

  return {
    ...task,
    status: 'stopped',
    stopped: true,
    stoppedAt: now,
    finishedAt: task.finishedAt || now,
    completed,
    summary: {
      ...(task.summary || {}),
      successCount: counts.successCount,
      failedCount: counts.failedCount,
      stoppedCount: counts.stoppedCount,
      runningCount: 0,
      pendingCount: 0,
      caseCount: counts.caseCount || Number(task.total || task.summary?.caseCount || 0),
    },
    error: task.error || options.reason || '任务已被 CLI 停止。',
    stopReason: options.reason || task.stopReason || 'cli-stop-fallback',
    stopDiagnostics: options.stopDiagnostics || task.stopDiagnostics,
    cases,
  };
}

function recoverTaskPerformanceArtifactsForCli(task = {}) {
  const taskId = String(task.id || '').trim();
  const configuredReports = task.performanceReports && typeof task.performanceReports === 'object'
    ? task.performanceReports
    : {};
  const enabledTargets = ['phone', 'glasses'].filter((target) => Boolean(task.performanceOptions?.[target]));
  const performanceDir = path.join(getGlassBoxCliDataDir(), 'logs', 'workflow-performance', taskId);
  const targets = [...new Set([...enabledTargets, ...Object.keys(configuredReports)])];
  const reports = {};
  const diagnostics = Array.isArray(task.performanceDiagnostics) ? [...task.performanceDiagnostics] : [];

  targets.forEach((target) => {
    const configured = configuredReports[target] || {};
    const sourcePath = String(configured.artifactPath || path.join(performanceDir, `${target}.json`)).trim();
    let report = configured;
    if (sourcePath && fs.existsSync(sourcePath)) {
      try {
        report = {
          ...configured,
          ...JSON.parse(fs.readFileSync(sourcePath, 'utf8')),
          artifactPath: sourcePath,
        };
      } catch (error) {
        diagnostics.push({
          schemaVersion: 'glassbox.error.v1',
          code: 'PERFORMANCE_ARTIFACT_READ_FAILED',
          type: 'performance-collection',
          message: `${target} 性能快照读取失败：${error instanceof Error ? error.message : String(error)}`,
          target,
          recoveryActions: [
            `检查性能快照文件是否可读：${sourcePath}`,
            '运行 reports show <taskId> --json 查看 partial report 和 performanceDiagnostics。',
          ],
        });
      }
    }
    if (Array.isArray(report.samples) && report.samples.length) {
      reports[target] = report;
    } else {
      diagnostics.push({
        schemaVersion: 'glassbox.error.v1',
        code: 'PERFORMANCE_COLLECTION_INTERRUPTED',
        type: 'performance-collection',
        message: `${target} 性能采集已启用，但 runner 停止前没有可恢复的采样。`,
        target,
        recoveryActions: [
          '确认目标设备和应用进程在任务运行期间保持在线。',
          '检查 runner stderr/stdout 与 task.performanceDiagnostics 中的采集错误。',
          '恢复环境后重新运行任务并保留 --perf 参数。',
        ],
      });
    }
  });

  const performanceTask = attachPerformanceReportsToTaskCases({ ...task, cases: (task.cases || []).map(record => ({
    ...record, artifacts: { ...record.artifacts, runDir: inferWorkflowRunDirForCli(record) },
  })) }, reports);
  const cases = performanceTask.cases;

  const hasReports = Object.keys(reports).length > 0;
  return {
    ...task,
    performanceReports: hasReports ? performanceTask.performanceReports : task.performanceReports,
    performanceDiagnostics: diagnostics,
    performanceStatus: diagnostics.length ? (hasReports ? 'partial' : 'failed') : hasReports ? 'success' : task.performanceStatus,
    performanceErrorCode: diagnostics.length
      ? (hasReports ? 'PERFORMANCE_COLLECTION_PARTIAL' : 'PERFORMANCE_COLLECTION_INTERRUPTED')
      : task.performanceErrorCode || '',
    performanceRecoveryActions: [...new Set(diagnostics.flatMap((item) => item.recoveryActions || []))],
    cases,
  };
}

function persistStoppedTaskForCli(taskId, options = {}) {
  const persisted = getPersistedTaskForCli(taskId);
  const {
    statePath, state, tasks, summaryTask, loaded,
  } = persisted;
  if (!persisted.exists || !persisted.task) {
    throw new Error(`Task not found: ${taskId}`);
  }
  const baseTask = persisted.task;
  if (isTerminalTaskStatusForCli(baseTask)) {
    const ensured = ensureTaskReportPackageForCli(loaded, statePath, state, { reportsOnly: true });
    return {
      statePath,
      detailPath: ensured.detailPath || getTaskDetailPathForCli(baseTask),
      task: ensured.task || baseTask,
      reportPackage: ensured.task?.reportPackage || null,
      reportPackageError: ensured.task?.reportPackageError || ensured.detailError || '',
      alreadyTerminal: true,
      idempotent: baseTask.status === 'stopped',
    };
  }
  let stoppedTask = recoverTaskPerformanceArtifactsForCli(markTaskStoppedForCli(baseTask, options));
  const detailPath = loaded.detailPath || getWorkflowReportDetailPathForCli(taskId);
  let reportPackage = null;
  let reportPackageError = '';

  try {
    reportPackage = createReportPackageFromTask(stoppedTask, getDefaultTaskReportPackagePathForCli(stoppedTask));
    stoppedTask = {
      ...stoppedTask,
      reportPackage,
      reportPackagePath: reportPackage.path,
      reportPackageError: undefined,
    };
  } catch (error) {
    reportPackageError = error instanceof Error ? error.message : String(error);
    stoppedTask = {
      ...stoppedTask,
      reportPackage: {
        success: false,
        error: reportPackageError,
      },
      reportPackageError,
    };
  }

  if (detailPath) {
    writeJsonFileAtomic(detailPath, stoppedTask);
  }

  if (statePath && state) {
    const nextTasks = tasks.some((item) => String(item?.id || '') === String(taskId || ''))
      ? tasks.map((item) => (String(item?.id || '') === String(taskId || '') ? {
        ...item,
        ...summarizeTaskForCli(stoppedTask, { loadDetails: false }),
        status: 'stopped',
        stoppedAt: stoppedTask.stoppedAt,
        finishedAt: stoppedTask.finishedAt,
        reportDetailPath: detailPath,
        reportDetailLoaded: false,
        reportPackagePath: stoppedTask.reportPackagePath || '',
        reportPackage: stoppedTask.reportPackage,
        reportPackageError: stoppedTask.reportPackageError,
      } : item))
      : [...tasks, {
        id: taskId,
        name: stoppedTask.name || taskId,
        status: 'stopped',
        stoppedAt: stoppedTask.stoppedAt,
        finishedAt: stoppedTask.finishedAt,
        reportDetailPath: detailPath,
        reportDetailLoaded: false,
        reportPackagePath: stoppedTask.reportPackagePath || '',
      }];
    writeJsonFileAtomic(statePath, {
      ...state,
      automationTasks: nextTasks,
    });
  }

  return {
    statePath,
    detailPath,
    task: stoppedTask,
    reportPackage,
    reportPackageError,
  };
}

function summarizeTaskForCli(task, options = {}) {
  const loaded = options.loadDetails ? loadTaskDetailForCli(task) : {
    task,
    detailPath: getTaskDetailPathForCli(task),
    detailLoaded: Boolean(Array.isArray(task?.cases) && task.cases.length),
    detailError: '',
  };
  const source = loaded.task || task || {};
  const cases = Array.isArray(source.cases) ? source.cases : [];
  const summary = source.summary || {};
  const hasCaseDetails = cases.length > 0;
  const successCount = hasCaseDetails ? cases.filter((item) => item?.status === 'success').length : Number(summary.successCount || 0);
  const failedCount = hasCaseDetails ? cases.filter((item) => item?.status === 'failed').length : Number(summary.failedCount || 0);
  const stoppedCount = hasCaseDetails ? cases.filter((item) => item?.status === 'stopped').length : Number(summary.stoppedCount || 0);
  const runningCount = hasCaseDetails ? cases.filter((item) => item?.status === 'running').length : Number(summary.runningCount || 0);
  const pendingCount = hasCaseDetails
    ? cases.filter((item) => ['pending', 'submitted', ''].includes(String(item?.status || ''))).length
    : Number(summary.pendingCount || 0);
  const completed = hasCaseDetails ? successCount + failedCount + stoppedCount : Number(source.completed || summary.completed || 0);
  const caseCount = hasCaseDetails ? cases.length : Number(summary.caseCount || source.total || 0);
  const runnerDiagnostics = source.status === 'running' && !source.externalSource ? getTaskRunnerStatusForCli(source.id) : null;
  const staleRunning = Boolean(source.status === 'running' && runnerDiagnostics?.liveness === 'dead');
  const runnerLivenessUnknown = Boolean(source.status === 'running' && runnerDiagnostics?.liveness === 'unknown');

  return {
    id: source.id,
    name: source.name || source.id || '未命名任务',
    status: source.status || '',
    folderId: source.folderId || '',
    caseIds: Array.isArray(source.caseIds) ? source.caseIds : cases.map((item) => item.caseId).filter(Boolean),
    completed,
    total: Number(source.total || caseCount || 0),
    taskType: source.taskType || (source.stress ? 'stress' : 'standard'),
    stress: source.stress || undefined,
    currentRound: Number(source.currentRound || 0),
    currentCaseName: source.currentCaseName || '',
    createdAt: source.createdAt || '',
    finishedAt: source.finishedAt || '',
    imported: Boolean(source.imported),
    readonly: Boolean(source.readonly),
    reportPackagePath: source.reportPackagePath || '',
    reportPackage: source.reportPackage || undefined,
    reportPackageError: source.reportPackageError || '',
    reportRoot: source.reportRoot || '',
    reportDetailPath: source.reportDetailPath || loaded.detailPath || '',
    reportDetailLoaded: Boolean(loaded.detailLoaded),
    reportDetailError: loaded.detailError || '',
    summary: {
      successCount,
      failedCount,
      stoppedCount,
      runningCount,
      pendingCount,
      completed,
      caseCount,
    },
    hasFailures: Boolean(source.hasFailures || failedCount > 0),
    taskRevision: source.taskRevision || '',
    eventRevision: Number(source.eventRevision || 0),
    performanceOptions: source.performanceOptions || {},
    performanceTargets: Object.keys(source.performanceReports || {}),
    startOptions: source.startOptions || {},
    runtimeEnvironment: source.runtimeEnvironment || {},
    error: source.error || '',
    staleRunning,
    runnerDiagnostics: runnerDiagnostics || undefined,
    diagnostics: staleRunning ? {
      schemaVersion: 'glassbox.error.v1',
      code: 'TASK_STALE_RUNNING',
      type: 'task-state',
      message: '任务状态为 running，但未找到存活 headless runner；这是 stale running 状态。',
      recoveryActions: getTaskStopRecoveryActionsForCli(source.id),
      details: {
        taskId: source.id,
        runnerDiagnostics,
      },
    } : (runnerLivenessUnknown ? {
      schemaVersion: 'glassbox.error.v1',
      code: 'TASK_RUNNER_LIVENESS_UNKNOWN',
      type: 'task-state',
      message: '任务仍为 running，但当前进程探测无法可靠确认 runner 是否存活；未将其判定为 stale。',
      recoveryActions: getTaskRunnerUnknownRecoveryActionsForCli(source.id),
      details: {
        taskId: source.id,
        runnerDiagnostics,
      },
    } : undefined),
    recoveryActions: staleRunning
      ? getTaskStopRecoveryActionsForCli(source.id)
      : (runnerLivenessUnknown ? getTaskRunnerUnknownRecoveryActionsForCli(source.id) : []),
  };
}

function compactTextForCli(value, maxLength = 500) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}

function findFirstFailedNodeForCli(caseRecord = {}) {
  const results = Array.isArray(caseRecord.results) ? caseRecord.results : [];
  const failed = results.find((item) => item?.status === 'failed' || item?.error);
  if (!failed) {
    return null;
  }

  return {
    stepId: failed.stepId || '',
    stepName: failed.stepName || '',
    status: failed.status || '',
    error: compactTextForCli(failed.error || failed.stderr || failed.stdout || ''),
  };
}

function parseTimestampMsForCli(value) {
  const time = Date.parse(String(value || ''));
  return Number.isFinite(time) ? time : 0;
}

function toIsoTimestampForCli(value) {
  const time = typeof value === 'number' ? value : parseTimestampMsForCli(value);
  return time > 0 ? new Date(time).toISOString() : '';
}

function getFileMtimeMsForCli(filePath) {
  try {
    return filePath && fs.existsSync(filePath) ? fs.statSync(filePath).mtimeMs : 0;
  } catch (_error) {
    return 0;
  }
}

function flattenArtifactPathsForCli(items = []) {
  return (Array.isArray(items) ? items : [])
    .map((item) => String(item?.path || item?.localPath || item?.pushedLocalPath || item?.sourceLocalPath || '').trim())
    .filter(Boolean);
}

function getWorkflowRunsDirForCli() {
  return path.resolve(process.env.GLASSBOX_WORKFLOW_RUNS_DIR || path.join(getGlassBoxCliDataDir(), 'logs', 'workflow-runs'));
}

function listRunDirFilesForCli(runDir, predicate, subdir = '') {
  const root = subdir ? path.join(runDir, subdir) : runDir;
  if (!root || !fs.existsSync(root)) {
    return [];
  }

  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isFile() && predicate(entry.name))
      .map((entry) => path.join(root, entry.name));
  } catch (_error) {
    return [];
  }
}

function inferWorkflowRunDirForCli(caseRecord = {}) {
  const artifacts = caseRecord.artifacts && typeof caseRecord.artifacts === 'object' ? caseRecord.artifacts : {};
  const existingRunDir = String(artifacts.runDir || '').trim();
  if (existingRunDir && fs.existsSync(existingRunDir)) {
    return existingRunDir;
  }

  const caseId = String(caseRecord.caseId || caseRecord.caseSnapshot?.id || '').trim();
  if (!caseId) {
    return '';
  }

  const startedAtMs = parseTimestampMsForCli(caseRecord.startedAt);
  if (caseRecord.status !== 'running' && !startedAtMs) {
    return '';
  }

  const runsDir = getWorkflowRunsDirForCli();
  if (!fs.existsSync(runsDir)) {
    return '';
  }

  const minMtimeMs = startedAtMs ? startedAtMs - (5 * 60 * 1000) : Date.now() - (24 * 60 * 60 * 1000);
  const prefix = `${sanitizeFilePart(caseId)}-`;
  let candidates = [];

  try {
    candidates = fs.readdirSync(runsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && entry.name.startsWith(prefix))
      .map((entry) => {
        const candidatePath = path.join(runsDir, entry.name);
        return {
          path: candidatePath,
          mtimeMs: getFileMtimeMsForCli(candidatePath),
        };
      })
      .filter((item) => item.mtimeMs >= minMtimeMs)
      .sort((a, b) => b.mtimeMs - a.mtimeMs);
  } catch (_error) {
    candidates = [];
  }

  return candidates[0]?.path || '';
}

function collectEvidencePathsForCli(artifacts = {}) {
  const runDir = String(artifacts.runDir || '').trim();
  const scannedLogs = runDir
    ? listRunDirFilesForCli(runDir, (fileName) => /\.(txt|log)$/i.test(fileName))
    : [];
  const scannedRecordings = runDir
    ? listRunDirFilesForCli(runDir, (fileName) => /\.(mp4|mov|m4v)$/i.test(fileName))
    : [];
  const scannedScreenshots = runDir
    ? [
      ...listRunDirFilesForCli(runDir, (fileName) => /\.(png|jpe?g)$/i.test(fileName)),
      ...listRunDirFilesForCli(runDir, (fileName) => /\.(png|jpe?g)$/i.test(fileName), 'screenshots'),
    ]
    : [];

  return {
    logs: [...new Set([...flattenArtifactPathsForCli(artifacts.logs), ...scannedLogs])],
    recordings: [...new Set([...flattenArtifactPathsForCli(artifacts.recordings), ...scannedRecordings])],
    screenshots: [...new Set([...flattenArtifactPathsForCli(artifacts.screenshots), ...scannedScreenshots])],
  };
}

function getLastStepForCli(results = []) {
  const last = Array.isArray(results) ? results.filter(Boolean).slice(-1)[0] : null;
  if (!last) {
    return null;
  }

  return {
    stepId: last.stepId || '',
    stepName: last.stepName || '',
    status: last.status || '',
    startedAt: last.startedAt || '',
    completedAt: last.completedAt || '',
    endedAt: last.endedAt || '',
    error: compactTextForCli(last.error || '', 240),
  };
}

function inferActiveStepForCli(caseRecord = {}) {
  if (caseRecord.status !== 'running') {
    return null;
  }

  const results = Array.isArray(caseRecord.results) ? caseRecord.results : [];
  const steps = Array.isArray(caseRecord.caseSnapshot?.steps) ? caseRecord.caseSnapshot.steps : [];
  const nextStep = steps[results.length] || null;
  if (!nextStep) {
    return null;
  }

  return {
    stepId: nextStep.id || '',
    stepName: nextStep.name || '',
    type: nextStep.type || '',
    inferred: true,
  };
}

function collectCaseTimestampMsForCli(caseRecord = {}, evidencePaths = {}) {
  const results = Array.isArray(caseRecord.results) ? caseRecord.results : [];
  const times = [
    parseTimestampMsForCli(caseRecord.startedAt),
    parseTimestampMsForCli(caseRecord.endedAt),
    ...results.flatMap((result) => [
      parseTimestampMsForCli(result?.startedAt),
      parseTimestampMsForCli(result?.completedAt),
      parseTimestampMsForCli(result?.endedAt),
    ]),
    ...Object.values(evidencePaths).flat().map(getFileMtimeMsForCli),
  ].filter((time) => time > 0);

  return times.length ? Math.max(...times) : 0;
}

function getCaseElapsedMsForCli(caseRecord = {}) {
  const startedAtMs = parseTimestampMsForCli(caseRecord.startedAt);
  if (!startedAtMs) {
    return 0;
  }

  const endedAtMs = parseTimestampMsForCli(caseRecord.endedAt);
  const endMs = endedAtMs || Date.now();
  return Math.max(0, endMs - startedAtMs);
}

function getLogCandidatePathsForCli(artifacts = {}) {
  return collectEvidencePathsForCli(artifacts).logs;
}

function readLogTailForCli(filePath, maxBytes = 512 * 1024) {
  try {
    if (!filePath || !fs.existsSync(filePath)) {
      return '';
    }

    const stat = fs.statSync(filePath);
    const length = Math.min(stat.size, maxBytes);
    const fd = fs.openSync(filePath, 'r');
    const buffer = Buffer.alloc(length);
    fs.readSync(fd, buffer, 0, length, Math.max(0, stat.size - length));
    fs.closeSync(fd);
    return buffer.toString('utf8');
  } catch (_error) {
    return '';
  }
}

function extractCorrelationIdsForCli(text = '') {
  const normalized = String(text || '').replace(/\\"/g, '"').replace(/\\'/g, "'");
  const patterns = [
    /["']?([A-Za-z][A-Za-z0-9_-]*(?:Session|SessionId|SessionID|Trace|TraceId|TraceID|RequestId|RequestID|traceid|requestid))["']?\s*[:=]\s*["']?([0-9a-fA-F]{16,64})["']?/i,
    /([A-Za-z][A-Za-z0-9_-]*(?:Session|SessionId|SessionID|Trace|TraceId|TraceID|RequestId|RequestID|traceid|requestid))\\?["']?\s*[:=]\s*\\?["']?([0-9a-fA-F]{16,64})/i,
    /([A-Z][A-Z0-9_]{3,})\s*,\s*([0-9a-fA-F]{32,64})/i,
  ];
  const ids = [];

  for (const source of [normalized, String(text || '')]) {
    for (const pattern of patterns) {
      for (const match of source.matchAll(new RegExp(pattern.source, `${pattern.flags.includes('i') ? 'i' : ''}g`))) {
        const kind = String(match[1] || 'correlationId');
        const value = String(match[2] || '').trim();
        if (!value || ids.some((item) => item.value === value && item.kind === kind)) {
          continue;
        }
        ids.push({ kind, value });
      }
    }
  }

  return ids;
}

function extractBizSessionIdForCli(text = '') {
  const ids = extractCorrelationIdsForCli(text);
  return ids.find((item) => /bizSession|trace/i.test(item.kind))?.value || ids[0]?.value || '';
}

function getDiagnosticSnippetCategoryForCli(line = '') {
  if (/timeout|timed\s*out|onTimeout|超时/i.test(line)) {
    return 'timeout';
  }
  if (/assert|expect|actual|missing|not\s+found|未找到|未等到|期望|实际|断言/i.test(line)) {
    return 'assertion';
  }
  if (/error|exception|failed|failure|失败|异常/i.test(line)) {
    return 'error';
  }
  if (/(?:Session|SessionId|SessionID|Trace|TraceId|TraceID|RequestId|RequestID|traceid|requestid)|[A-Z][A-Z0-9_]{3,}\s*,\s*[0-9a-fA-F]{32,64}/i.test(line)) {
    return 'correlation';
  }
  return '';
}

function escapeRegExpForCli(value = '') {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getDiagnosticContextTermsForCli(text = '') {
  const tokens = String(text || '').match(/[A-Za-z][A-Za-z0-9_.:-]{3,}/g) || [];
  const ignored = new Set([
    'biztype',
    'datajson',
    'extfo',
    'json',
    'datajson',
    'true',
    'false',
    'null',
    'undefined',
    'timeout',
  ]);

  return [...new Set(tokens
    .map((item) => item.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, ''))
    .filter((item) => item.length >= 4 && !ignored.has(item.toLowerCase()))
    .slice(0, 12))];
}

function scoreDiagnosticSnippetForCli(item = {}, contextTerms = []) {
  const text = String(item.text || '');
  const categoryScore = {
    correlation: 4,
    assertion: 16,
    timeout: 12,
    error: 8,
  }[item.category] || 0;
  const contextScore = contextTerms.reduce((score, term) => (
    text.toLowerCase().includes(term.toLowerCase()) ? score + 60 : score
  ), 0);
  const signalScore = /fatal|exception|assert|on[A-Z]|biz|trace|session|request|超时|断言|失败/i.test(text) ? 6 : 0;

  return categoryScore + contextScore + signalScore;
}

function selectDiagnosticLogSnippetsForCli(candidates = [], contextTerms = []) {
  const ranked = candidates
    .map((item, index) => ({
      ...item,
      score: scoreDiagnosticSnippetForCli(item, contextTerms),
      index,
    }))
    .sort((a, b) => (b.score - a.score) || (a.index - b.index));
  const selected = [];
  const perCategoryCount = new Map();

  for (const item of ranked) {
    const categoryCount = perCategoryCount.get(item.category) || 0;
    if (item.category === 'correlation' && categoryCount >= 2) {
      continue;
    }
    if (!selected.some((existing) => existing.text === item.text)) {
      const { score: _score, index: _index, ...snippet } = item;
      selected.push(snippet);
      perCategoryCount.set(item.category, categoryCount + 1);
    }
    if (selected.length >= 6) {
      break;
    }
  }

  return selected;
}

function extractDiagnosticHintsForCli(artifacts = {}, context = {}) {
  const logPaths = getLogCandidatePathsForCli(artifacts);
  const snippetCandidates = [];
  const diagnosticHints = [];
  const correlationIds = [];
  const contextTerms = getDiagnosticContextTermsForCli([
    context.error,
    context.firstFailedNode?.error,
    context.firstFailedNode?.stepName,
    context.caseName,
  ].filter(Boolean).join('\n'));
  const contextPattern = contextTerms.length
    ? new RegExp(contextTerms.map(escapeRegExpForCli).join('|'), 'i')
    : null;
  const keywordPattern = /timeout|timed\s*out|onTimeout|error|exception|failed|failure|assert|expect|actual|missing|not\s+found|未找到|未等到|期望|实际|断言|超时|失败|异常|(?:Session|SessionId|SessionID|Trace|TraceId|TraceID|RequestId|RequestID|traceid|requestid)|[A-Z][A-Z0-9_]{3,}\s*,\s*[0-9a-fA-F]{32,64}/i;

  for (const logPath of logPaths) {
    const text = readLogTailForCli(logPath);
    if (!text) {
      continue;
    }

    for (const id of extractCorrelationIdsForCli(text)) {
      if (!correlationIds.some((item) => item.kind === id.kind && item.value === id.value)) {
        correlationIds.push(id);
      }
    }

    const lines = text.split(/\r?\n/).filter((line) => keywordPattern.test(line) || contextPattern?.test(line));
    for (const line of lines) {
      const category = getDiagnosticSnippetCategoryForCli(line);
      if (!category) {
        continue;
      }
      const snippet = {
        path: logPath,
        category,
        text: compactTextForCli(line, 360),
      };
      if (!snippetCandidates.some((item) => item.text === snippet.text)) {
        snippetCandidates.push(snippet);
      }
    }
  }

  const diagnosticLogSnippets = selectDiagnosticLogSnippetsForCli(snippetCandidates, contextTerms);
  if (diagnosticLogSnippets.some((item) => item.category === 'timeout')) {
    diagnosticHints.push('日志中出现超时相关片段，请结合失败节点、输入和被测应用状态判断断言窗口或业务响应是否异常。');
  }
  if (diagnosticLogSnippets.some((item) => item.category === 'error')) {
    diagnosticHints.push('日志中出现错误或异常片段，请优先检查外部服务、设备前置或运行器错误。');
  }
  if (diagnosticLogSnippets.some((item) => item.category === 'assertion')) {
    diagnosticHints.push('日志中出现断言/期望/实际结果相关片段，请核对当前状态是否满足用例预期。');
  }
  if (correlationIds.length) {
    diagnosticHints.push('已提取日志关联 ID，可用于业务域或服务端链路继续排查。');
  }

  return {
    correlationIds: correlationIds.slice(0, 8),
    diagnosticHints: diagnosticHints.slice(0, 5),
    diagnosticLogSnippets: diagnosticLogSnippets.slice(0, 6),
    legacyBizSessionId: correlationIds.find((item) => /bizSession|trace/i.test(item.kind))?.value || correlationIds[0]?.value || '',
  };
}

function getBusinessSnippetCategoryForCli(line = '') {
  return getDiagnosticSnippetCategoryForCli(line);
}

function selectBusinessLogSnippetsForCli(candidates = []) {
  return selectDiagnosticLogSnippetsForCli(candidates);
}

function extractBusinessHintsForCli(artifacts = {}, context = {}) {
  const diagnostics = extractDiagnosticHintsForCli(artifacts, context);
  return {
    bizSessionId: diagnostics.legacyBizSessionId,
    businessHints: diagnostics.diagnosticHints,
    keyLogSnippets: diagnostics.diagnosticLogSnippets,
    correlationIds: diagnostics.correlationIds,
    diagnosticHints: diagnostics.diagnosticHints,
    diagnosticLogSnippets: diagnostics.diagnosticLogSnippets,
  };
}

/*
 * Backwards-compatible wrappers above keep the v1 summary fields stable while
 * solopi-desktop core exposes domain-neutral diagnostics. Business-specific analysis
 * should live in domain skills that consume these generic snippets/artifacts.
 */

function aggregateReportCaseSummaryForCli(caseSummaries = [], fallbackCaseCount = 0) {
  const successCount = caseSummaries.filter((item) => item.status === 'success').length;
  const failedCount = caseSummaries.filter((item) => item.status === 'failed').length;
  const stoppedCount = caseSummaries.filter((item) => item.status === 'stopped').length;
  const runningCount = caseSummaries.filter((item) => item.status === 'running').length;
  const pendingCount = caseSummaries.filter((item) => ['pending', 'submitted', ''].includes(String(item.status || ''))).length;
  const completed = successCount + failedCount + stoppedCount;
  const caseCount = caseSummaries.length || Number(fallbackCaseCount || 0);

  return {
    successCount,
    failedCount,
    stoppedCount,
    runningCount,
    pendingCount,
    completed,
    caseCount,
  };
}

function summarizeReportCaseForCli(caseRecord = {}) {
  const firstFailedNode = findFirstFailedNodeForCli(caseRecord);
  const results = Array.isArray(caseRecord.results) ? caseRecord.results : [];
  const originalArtifacts = caseRecord.artifacts && typeof caseRecord.artifacts === 'object' ? caseRecord.artifacts : {};
  const inferredRunDir = inferWorkflowRunDirForCli(caseRecord);
  const artifacts = {
    ...originalArtifacts,
    runDir: originalArtifacts.runDir || inferredRunDir,
  };
  const evidencePaths = collectEvidencePathsForCli(artifacts);
  const lastArtifactAtMs = Object.values(evidencePaths).flat().map(getFileMtimeMsForCli).filter(Boolean).sort((a, b) => b - a)[0] || 0;
  const lastUpdateAtMs = collectCaseTimestampMsForCli(caseRecord, evidencePaths);
  const businessEvidence = caseRecord.status === 'failed' ? extractBusinessHintsForCli(artifacts, {
    error: caseRecord.error || firstFailedNode?.error || '',
    firstFailedNode,
    caseName: caseRecord.caseName || caseRecord.caseSnapshot?.name || '',
  }) : {
    bizSessionId: '',
    businessHints: [],
    keyLogSnippets: [],
    correlationIds: [],
    diagnosticHints: [],
    diagnosticLogSnippets: [],
  };

  return {
    caseId: caseRecord.caseId || caseRecord.caseSnapshot?.id || '',
    caseName: caseRecord.caseName || caseRecord.caseSnapshot?.name || '',
    status: caseRecord.status || '',
    completed: Number(caseRecord.completed || 0),
    total: Number(caseRecord.total || 0),
    startedAt: caseRecord.startedAt || '',
    endedAt: caseRecord.endedAt || '',
    lastUpdateAt: toIsoTimestampForCli(lastUpdateAtMs),
    elapsedMs: getCaseElapsedMsForCli(caseRecord),
    lastStep: getLastStepForCli(results),
    activeStep: inferActiveStepForCli(caseRecord),
    firstFailedNode,
    error: compactTextForCli(caseRecord.error || firstFailedNode?.error || ''),
    runDir: artifacts.runDir || '',
    evidencePaths,
    lastArtifactAt: toIsoTimestampForCli(lastArtifactAtMs),
    bizSessionId: businessEvidence.bizSessionId,
    businessHints: businessEvidence.businessHints,
    keyLogSnippets: businessEvidence.keyLogSnippets,
    correlationIds: businessEvidence.correlationIds || [],
    diagnosticHints: businessEvidence.diagnosticHints || [],
    diagnosticLogSnippets: businessEvidence.diagnosticLogSnippets || [],
  };
}

function createReportSummaryPayloadForCli(detailPayload = {}) {
  if (!detailPayload.success) {
    return detailPayload;
  }

  const task = detailPayload.task || {};
  const cases = Array.isArray(task.cases) ? task.cases : [];
  const caseSummaries = cases.map(summarizeReportCaseForCli);
  const reportPackagePath = String(task.reportPackagePath || task.reportPackage?.path || '').trim();
  const summary = aggregateReportCaseSummaryForCli(caseSummaries, task.total || task.summary?.caseCount || detailPayload.summary?.summary?.caseCount);

  return {
    success: true,
    schemaVersion: 'glassbox.report.summary.v1',
    statePath: detailPayload.statePath || '',
    detailPath: detailPayload.detailPath || '',
    detailLoaded: Boolean(detailPayload.detailLoaded),
    detailError: detailPayload.detailError || '',
    id: task.id || detailPayload.summary?.id || '',
    name: task.name || detailPayload.summary?.name || '',
    status: task.status || detailPayload.summary?.status || '',
    createdAt: task.createdAt || '',
    finishedAt: task.finishedAt || '',
    reportPackagePath,
    reportPackage: task.reportPackage || (reportPackagePath ? { path: reportPackagePath } : undefined),
    summary,
    startOptions: task.startOptions || {},
    runtimeEnvironment: task.runtimeEnvironment || {},
    devices: task.devices || undefined,
    firstFailedCase: cases.find((item) => item?.status === 'failed')?.caseId || '',
    cases: caseSummaries,
    error: compactTextForCli(task.error || ''),
  };
}

function getCaseReportPayloadForCli(taskId, caseId) {
  const detailPayload = getTaskDetailPayloadForCli(taskId);
  if (!detailPayload.success) return detailPayload;
  const task = detailPayload.task || {};
  const caseRecord = (Array.isArray(task.cases) ? task.cases : [])
    .find((item) => String(item?.caseId || item?.caseSnapshot?.id || '') === String(caseId || ''));
  if (!caseRecord) {
    return {
      success: false,
      schemaVersion: 'glassbox.report.case.v1',
      taskId,
      caseId,
      errorCode: 'REPORT_CASE_NOT_FOUND',
      error: `任务 ${taskId} 中未找到用例：${caseId}`,
      recoveryActions: [
        `运行 solopi-desktop tasks show ${taskId} --json 查看任务包含的 caseId。`,
      ],
    };
  }
  const summary = summarizeReportCaseForCli(caseRecord);
  const artifacts = caseRecord.artifacts && typeof caseRecord.artifacts === 'object'
    ? caseRecord.artifacts
    : {};
  return {
    success: true,
    schemaVersion: 'glassbox.report.case.v1',
    taskId: task.id || taskId,
    taskStatus: task.status || '',
    taskRevision: task.taskRevision || '',
    sourceRevision: task.sourceRevision || caseRecord.caseSnapshot?.sourceRevision || '',
    caseId: summary.caseId,
    caseName: summary.caseName,
    caseStatus: summary.status,
    evidenceReady: Boolean(artifacts.evidenceReady),
    results: Array.isArray(caseRecord.results) ? caseRecord.results : [],
    firstFailedNode: summary.firstFailedNode,
    error: caseRecord.error || summary.error || '',
    errorCode: caseRecord.errorCode || summary.firstFailedNode?.errorCode || '',
    errorType: caseRecord.errorType || summary.firstFailedNode?.errorType || '',
    recoveryActions: caseRecord.recoveryActions || summary.firstFailedNode?.recoveryActions || [],
    artifacts: {
      ...artifacts,
      runDir: artifacts.runDir || summary.runDir || '',
    },
    reportPackage: null,
  };
}

function sleepForCli(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function watchTaskEventsForCli(taskId, options = {}) {
  const pollIntervalMs = Math.max(100, Number(options.pollIntervalMs || 1000));
  let afterRevision = 0;
  let initialized = false;

  while (true) {
    const persisted = getPersistedTaskForCli(taskId);
    if (!persisted.exists || !persisted.task) {
      return {
        success: false,
        errorCode: 'TASK_NOT_FOUND',
        error: `Task not found: ${taskId}`,
      };
    }
    const task = persisted.task;
    const events = rebuildTaskEvents(task);
    if (!initialized) {
      afterRevision = resolveAfterEventRevision(events, options.after);
      initialized = true;
    }
    const nextEvents = events.filter((event) => Number(event.revision || 0) > afterRevision);
    for (const event of nextEvents) {
      process.stdout.write(`${JSON.stringify(event)}\n`);
      afterRevision = Number(event.revision || afterRevision);
    }
    const terminalEvent = events.find((event) => event.type === 'task_terminal');
    if (isAuthoritativeTaskTerminal(task) && terminalEvent && afterRevision >= Number(terminalEvent.revision || 0)) {
      return {
        success: true,
        taskId,
        revision: afterRevision,
        taskRevision: task.taskRevision || '',
      };
    }
    await sleepForCli(pollIntervalMs);
  }
}

function getTasksQueryPayloadForCli(command, options = {}) {
  const { path: statePath, state } = readWorkflowStateForCli();
  const query = String(getOption(command, '--query') || '').trim().toLowerCase();
  const status = String(getOption(command, '--status') || '').trim();
  const includeReportsOnly = Boolean(options.reportsOnly);
  const localTasks = Array.isArray(state?.automationTasks) ? state.automationTasks : [];
  const tasks = visibleTaskSummaries([...localTasks, ...readVisibleTasks(getGlassBoxCliDataDir()).filter(task => !localTasks.some(local => local.id === task.id))],getGlassBoxCliDataDir());
  const summaries = tasks
    .map((task) => summarizeTaskForCli(task, { loadDetails: false }))
    .filter((item) => {
      if (includeReportsOnly && !item.reportPackagePath && !item.reportRoot && !item.imported && !item.finishedAt) {
        return false;
      }
      if (status && item.status !== status) {
        return false;
      }
      if (query) {
        const haystack = [
          item.id,
          item.name,
          item.status,
          item.currentCaseName,
          item.caseIds.join(' '),
          item.reportPackagePath,
        ].join(' ').toLowerCase();
        return haystack.includes(query);
      }
      return true;
    });

  return {
    schemaVersion: includeReportsOnly ? 'glassbox.reports.list.v1' : 'glassbox.tasks.list.v1',
    statePath,
    total: summaries.length,
    filters: {
      query,
      status,
      reportsOnly: includeReportsOnly,
    },
    tasks: summaries,
  };
}

function getTaskDetailPayloadForCli(taskId, options = {}) {
  if(path.isAbsolute(taskId) && taskId.endsWith('.json')){
    const base=path.join(getGlassBoxCliDataDir(),'workflow-report-details');
    const resolved=fs.realpathSync(taskId);if(!resolved.startsWith(fs.realpathSync(base)+path.sep))throw Error('报告路径不属于当前数据目录的报告详情');
    const task=JSON.parse(fs.readFileSync(resolved,'utf8'));if(!task.id)throw Error('无效报告详情');
    return {success:true,retainedArtifact:true,detailPath:resolved,task,summary:summarizeTaskForCli(task,{loadDetails:false})};
  }
  const { path: statePath, state } = readWorkflowStateForCli();
  const localTasks = Array.isArray(state?.automationTasks) ? state.automationTasks : [];
  const tasks = [...localTasks, ...readVisibleTasks(getGlassBoxCliDataDir()).filter(task => !localTasks.some(local => local.id === task.id))];
  const task = tasks.find((item) => String(item?.id || '') === taskId);
  const includeReportsOnly = Boolean(options.reportsOnly);

  if (!task) {
    return {
      success: false,
      error: `找不到${includeReportsOnly ? '报告' : '任务'}：${taskId}`,
      statePath,
    };
  }

  let loaded = loadTaskDetailForCli(task);
  if (!task.externalSource && !options.skipReportPackage) loaded = ensureTaskReportPackageForCli(loaded, statePath, state, { reportsOnly: includeReportsOnly });
  const summary = summarizeTaskForCli(loaded.task, { loadDetails: false });
  return {
    success: true,
    schemaVersion: includeReportsOnly ? 'glassbox.report.detail.v1' : 'glassbox.task.detail.v1',
    statePath,
    detailPath: loaded.detailPath,
    detailLoaded: loaded.detailLoaded,
    detailError: loaded.detailError,
    summary,
    staleRunning: Boolean(summary.staleRunning),
    runnerDiagnostics: summary.runnerDiagnostics,
    diagnostics: summary.diagnostics,
    recoveryActions: summary.recoveryActions || [],
    task: loaded.task,
  };
}

function getReportSummaryPayloadForCli(taskId) {
  return createReportSummaryPayloadForCli(getTaskDetailPayloadForCli(taskId, { reportsOnly: true }));
}

function getReportsReindexPayloadForCli(command) {
  const { path: statePath, state } = readWorkflowStateForCli();
  const tasks = Array.isArray(state?.automationTasks) ? state.automationTasks : [];
  const dryRun = hasFlag(command, '--dry-run');
  const statusFilter = String(getOption(command, '--status') || '').trim();
  const results = [];

  for (const task of tasks) {
    const taskId = String(task?.id || '').trim();
    if (!taskId) {
      continue;
    }

    const loaded = loadTaskDetailForCli(task);
    const loadedTask = loaded.task || task;
    const status = String(loadedTask?.status || task?.status || '').trim();
    const existingPath = String(loadedTask?.reportPackagePath || loadedTask?.reportPackage?.path || '').trim();
    const terminal = isTerminalTaskStatusForCli(loadedTask);

    if (statusFilter && status !== statusFilter) {
      continue;
    }

    if (!terminal) {
      results.push({
        taskId,
        status,
        action: 'skipped',
        reason: '任务尚未进入终态，不生成报告包索引。',
        detailPath: loaded.detailPath,
      });
      continue;
    }

    if (!loaded.detailLoaded) {
      results.push({
        taskId,
        status,
        action: 'failed',
        reason: `报告详情不可读取：${loaded.detailError || 'unknown detail error'}`,
        detailPath: loaded.detailPath,
        recoveryActions: [
          '确认 workflow-report-details/<taskId>.json 存在且是合法 JSON。',
          '如果任务由旧版本运行，请先用 tasks show <taskId> --json 检查详情路径。',
        ],
      });
      continue;
    }

    if (existingPath && fs.existsSync(existingPath)) {
      results.push({
        taskId,
        status,
        action: 'unchanged',
        reportPackagePath: existingPath,
        detailPath: loaded.detailPath,
      });
      continue;
    }

    if (dryRun) {
      results.push({
        taskId,
        status,
        action: 'would-create',
        previousReportPackagePath: existingPath,
        detailPath: loaded.detailPath,
      });
      continue;
    }

    const fixed = ensureTaskReportPackageForCli(loaded, statePath, state, { reportsOnly: true });
    const fixedTask = fixed.task || {};
    const fixedPath = String(fixedTask.reportPackagePath || fixedTask.reportPackage?.path || '').trim();
    if (fixedPath && fs.existsSync(fixedPath)) {
      results.push({
        taskId,
        status,
        action: 'created',
        reportPackagePath: fixedPath,
        detailPath: fixed.detailPath,
      });
    } else {
      results.push({
        taskId,
        status,
        action: 'failed',
        reason: fixedTask.reportPackageError || fixed.detailError || '报告包生成失败',
        previousReportPackagePath: existingPath,
        detailPath: fixed.detailPath,
        recoveryActions: [
          '检查 runDir/artifacts 中引用的日志、录屏、截图路径是否仍存在。',
          '确认 report-packages 目录可写，并重试 reports reindex。',
        ],
      });
    }
  }

  const failedCount = results.filter((item) => item.action === 'failed').length;
  const createdCount = results.filter((item) => item.action === 'created').length;
  const wouldCreateCount = results.filter((item) => item.action === 'would-create').length;
  const unchangedCount = results.filter((item) => item.action === 'unchanged').length;
  const skippedCount = results.filter((item) => item.action === 'skipped').length;

  return {
    success: failedCount === 0,
    schemaVersion: 'glassbox.reports.reindex.v1',
    dryRun,
    statePath,
    filters: {
      status: statusFilter,
    },
    summary: {
      taskCount: results.length,
      createdCount,
      wouldCreateCount,
      unchangedCount,
      skippedCount,
      failedCount,
    },
    results,
    recoveryActions: failedCount
      ? ['按 results[].recoveryActions 修复失败任务后重试 reports reindex。']
      : [],
  };
}

function readEnvironmentConfigForCli() {
  for (const configPath of getEnvironmentConfigCandidates()) {
    try {
      if (fs.existsSync(configPath)) {
        return {
          path: configPath,
          config: JSON.parse(fs.readFileSync(configPath, 'utf8')),
        };
      }
    } catch (_error) {
      // Try the next known config location.
    }
  }

  return {
    path: '',
    config: null,
  };
}

function getConfiguredAdbPathForCli() {
  for (const configPath of getEnvironmentConfigCandidates()) {
    try {
      if (!fs.existsSync(configPath)) {
        continue;
      }

      const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
      const adbPath = String(config?.adbPath || '').trim();
      if (adbPath) {
        return adbPath;
      }
    } catch (_error) {
      // Try the next known config location.
    }
  }

  return '';
}

function getBoundDevicesFromState() {
  const { path: statePath, state } = readWorkflowStateForCli();
  const bindings = state?.deviceBindings || {};
  const phoneSerials = Array.isArray(bindings.phoneSerials) ? bindings.phoneSerials : [];
  const glassesSerials = Array.isArray(bindings.glassesSerials) ? bindings.glassesSerials : [];
  const phonePackage = String(bindings.phoneDefaultPackage || '').trim();
  const glassesPackage = String(bindings.glassesDefaultPackage || '').trim();
  const devices = [
    ...phoneSerials.map((serial) => ({
      serial,
      state: 'bound',
      model: '',
      product: '',
      device: '',
      transportId: '',
      kind: 'phone',
      source: 'workflow-state',
    })),
    ...glassesSerials.map((serial) => ({
      serial,
      state: 'bound',
      model: '',
      product: '',
      device: '',
      transportId: '',
      kind: 'glasses',
      source: 'workflow-state',
    })),
  ].filter((device) => device.serial);

  return {
    statePath,
    devices,
    defaults: {
      phoneSerial: phoneSerials[0] || '',
      glassesSerial: glassesSerials[0] || '',
      phonePackage,
      glassesPackage,
    },
  };
}

function parseAdbDeviceLine(line) {
  const [serial, state] = line.trim().split(/\s+/);
  const details = {};

  for (const match of line.matchAll(/(\w+):([^\s]+)/g)) {
    details[match[1]] = match[2];
  }

  return {
    serial,
    state,
    model: details.model || '',
    product: details.product || '',
    device: details.device || '',
    transportId: details.transport_id || '',
  };
}

function parseAdbDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(parseAdbDeviceLine);
}

function classifyDevice(device, props = {}) {
  const haystack = [
    device.serial,
    device.model,
    device.product,
    device.device,
    props.model,
    props.manufacturer,
    props.device,
    props.characteristics,
  ].join(' ').toLowerCase();

  if (/(glasses|rokid|xreal|nreal|rayneo|inmo|vuzix|airglass|spectacles)/.test(haystack)) {
    return 'glasses';
  }

  if (/(phone|iphone|pixel|samsung|xiaomi|redmi|oppo|vivo|huawei|honor|oneplus|realme|meizu|redmi|rk66c)/.test(haystack)) {
    return 'phone';
  }

  return 'unknown';
}

function getDeviceProps(serial) {
  const getprop = (name) => {
    try {
      return runAdbCommand(['-s', serial, 'shell', 'getprop', name], { timeout: 3000 }).stdout.trim();
    } catch (_error) {
      return '';
    }
  };

  return {
    model: getprop('ro.product.model'),
    manufacturer: getprop('ro.product.manufacturer'),
    device: getprop('ro.product.device'),
    characteristics: getprop('ro.build.characteristics'),
  };
}

function listDevices() {
  const bound = getBoundDevicesFromState();
  let adbPath = '';
  let adbError = '';
  let adbDevices = [];

  try {
    const adbResult = runAdbCommand(['devices', '-l']);
    adbPath = adbResult.adbPath;
    adbDevices = parseAdbDevices(adbResult.stdout).map((device) => {
      const props = device.state === 'device' ? getDeviceProps(device.serial) : {};
      return {
        ...device,
        ...props,
        kind: classifyDevice(device, props),
        source: 'adb',
      };
    });
  } catch (error) {
    adbError = error instanceof Error ? error.message : String(error);
  }

  const deviceMap = new Map();
  bound.devices.forEach((device) => {
    deviceMap.set(device.serial, device);
  });
  adbDevices.forEach((device) => {
    const boundDevice = deviceMap.get(device.serial);
    deviceMap.set(device.serial, {
      ...boundDevice,
      ...device,
      kind: boundDevice?.kind && boundDevice.kind !== 'unknown' ? boundDevice.kind : device.kind,
      source: boundDevice ? 'workflow-state+adb' : 'adb',
    });
  });

  const devices = [...deviceMap.values()];
  const onlineDevices = devices.filter((device) => device.state === 'device');
  const pickDefaultDevice = (kind) => (
    onlineDevices.find((device) => device.kind === kind && device.source?.includes('workflow-state'))
    || onlineDevices.find((device) => device.kind === kind)
    || devices.find((device) => device.kind === kind && device.source?.includes('workflow-state'))
  );
  const phone = pickDefaultDevice('phone');
  const glasses = pickDefaultDevice('glasses');

  return {
    schemaVersion: 'glassbox.devices.v1',
    adbPath: adbPath || resolvedAdbPathForCli || '',
    adbPathSource: resolvedAdbPathSourceForCli || '',
    statePath: bound.statePath,
    devices,
    warnings: adbError ? [adbError] : [],
    defaults: {
      phoneSerial: phone?.serial || '',
      glassesSerial: glasses?.serial || '',
      phonePackage: bound.defaults.phonePackage || '',
      glassesPackage: bound.defaults.glassesPackage || '',
    },
  };
}

function printDeviceList(result, jsonMode) {
  if (jsonMode) {
    writeJson(result);
    return;
  }

  if (!result.devices.length) {
    console.log('No ADB devices found.');
    result.warnings?.forEach((warning) => console.warn(`warning: ${warning}`));
    return;
  }

  result.devices.forEach((device) => {
    console.log(`${device.serial}\t${device.state}\t${device.kind}\t${device.source || '-'}\t${device.model || device.product || device.device || '-'}`);
  });
  result.warnings?.forEach((warning) => console.warn(`warning: ${warning}`));
}

function resolveDeviceSerials(options = {}) {
  const requestedPhone = options.phoneSerial || '';
  const requestedGlasses = options.glassesSerial || '';

  const deviceList = listDevices();
  return {
    phoneSerial: requestedPhone || getBoundDevicesFromState().defaults.phoneSerial || deviceList.defaults.phoneSerial,
    glassesSerial: requestedGlasses || getBoundDevicesFromState().defaults.glassesSerial || deviceList.defaults.glassesSerial,
    devices: deviceList,
  };
}

function runPackageOptionsForCli(command) {
  const options = {};
  for (const role of ['phone', 'glasses']) {
    const flag = `--${role}-package`;
    if (!command.includes(flag)) continue;
    const value = getOption(command, flag);
    if (typeof value !== 'string' || !/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*$/.test(value)) {
      throw Object.assign(new Error(`${flag} 需要有效包名；不需要覆盖时请省略该参数`), { code: 'PACKAGE_OVERRIDE_INVALID', field: flag });
    }
    options[`${role}Package`] = value;
  }
  return options;
}

function resolveRunPackageForCli(testCase, role, options = {}) {
  const device = options.devices?.[role];
  const candidates = [
    [options[`${role}Package`], 'cli'],
    [testCase?.defaults?.[`${role}Package`], 'case'],
    [device?.packageNameSource === 'case' || device?.packageNameSource === 'case-specific' ? '' : device?.packageName, 'device'],
    [options.devices?.defaults?.[`${role}Package`], 'device'],
  ];
  const selected = candidates.find(([value]) => typeof value === 'string' && value.trim());
  return { packageName: selected?.[0].trim() || '', packageNameSource: selected?.[1] || 'unset' };
}

function executionDevicesForCli(devices, cases, options = {}) {
  if (!devices) return devices;
  const result = structuredClone(devices);
  for (const role of ['phone', 'glasses']) {
    const packages = cases.map(testCase => resolveRunPackageForCli(testCase, role, options));
    const unique = new Set(packages.map(item => item.packageName));
    result[role] = { ...result[role],
      packageName: unique.size === 1 ? packages[0].packageName : '',
      packageNameSource: unique.size === 1 ? packages[0].packageNameSource : 'case-specific' };
  }
  return result;
}

function createRunDevicesInfo(selection, testCase = null, packageOptions = {}) {
  const deviceList = selection?.devices || null;
  const findDevice = (serial) => (deviceList?.devices || []).find((device) => device.serial === serial) || null;
  const phoneDevice = findDevice(selection?.phoneSerial || '');
  const glassesDevice = findDevice(selection?.glassesSerial || '');
  const currentPhonePackage = String(
    packageOptions.phonePackage
    || testCase?.defaults?.phonePackage
    || phoneDevice?.packageName
    || deviceList?.defaults?.phonePackage
    || getDefaultPhonePackageFromStateOrCase(testCase)
    || testCase?.defaults?.phonePackage
    || ''
  ).trim();

  return {
    phone: {
      ...(phoneDevice || {}),
      serial: selection?.phoneSerial || '',
      packageName: currentPhonePackage,
      packageNameSource: packageOptions.phonePackage ? 'cli' : testCase?.defaults?.phonePackage ? 'case' : 'device',
      source: phoneDevice?.source || (selection?.phoneSerial ? 'explicit-or-default' : ''),
    },
    glasses: {
      ...(glassesDevice || {}),
      serial: selection?.glassesSerial || '',
      packageName: String(packageOptions.glassesPackage || testCase?.defaults?.glassesPackage || glassesDevice?.packageName || deviceList?.defaults?.glassesPackage || '').trim(),
      packageNameSource: packageOptions.glassesPackage ? 'cli' : testCase?.defaults?.glassesPackage ? 'case' : 'device',
      source: glassesDevice?.source || (selection?.glassesSerial ? 'explicit-or-default' : ''),
    },
    defaults: {
      ...(deviceList?.defaults || {}),
      phoneSerial: selection?.phoneSerial || '',
      glassesSerial: selection?.glassesSerial || '',
    },
    adbPath: deviceList?.adbPath || resolvedAdbPathForCli || '',
  };
}

function normalizeSdkEnvironment(value) {
  const environment = String(value || '').trim().toUpperCase();
  return sdkEnvironmentMap[environment] ? environment : '';
}

function getDefaultPhonePackageFromStateOrCase(testCase = null) {
  const { state } = readWorkflowStateForCli();
  const fromCase = String(testCase?.defaults?.phonePackage || '').trim();
  if (fromCase) return fromCase;
  const fromState = String(state?.deviceBindings?.phoneDefaultPackage || '').trim();
  if (fromState) {
    return fromState;
  }

  return String(testCase?.defaults?.phonePackage || defaultPhonePackageName).trim();
}

function readSdkEnvironmentForCli(options = {}) {
  const serial = String(options.serial || '').trim();
  const packageName = String(options.packageName || '').trim();

  if (!serial || !packageName || !/^[A-Za-z0-9._]+$/.test(packageName)) {
    return {
      success: false,
      environment: '',
      available: false,
      error: 'Missing serial or invalid package',
    };
  }

  const envFile = `/sdcard/Android/data/${packageName}/files/sdk_env`;
  try {
    const output = runAdbCommand([
      '-s',
      serial,
      'shell',
      'cat',
      envFile,
    ], { timeout: 5000 }).stdout;
    const rawEnvironment = output.trim();

    if (!rawEnvironment) {
      return {
        success: true,
        serial,
        packageName,
        environment: 'ONLINE',
        rawEnvironment,
        available: true,
        defaulted: true,
      };
    }

    const environment = rawSdkEnvironmentMap[rawEnvironment];
    if (!environment) {
      return {
        success: false,
        serial,
        packageName,
        environment: '',
        rawEnvironment,
        available: false,
        error: '未读取到有效环境配置',
      };
    }

    return {
      success: true,
      serial,
      packageName,
      environment,
      rawEnvironment,
      available: true,
    };
  } catch (error) {
    if (isMissingRemoteFileError(error, envFile)) {
      return {
        success: true,
        serial,
        packageName,
        environment: 'ONLINE',
        rawEnvironment: '',
        available: true,
        defaulted: true,
      };
    }

    const diagnosticError = createAdbDiagnosticError(error, {
      deviceRole: 'phone',
      serial,
      packageName,
      command: error?.command || `${resolvedAdbPathForCli || resolveAdbPathForCliSync()} -s ${serial} shell cat ${envFile}`,
    });
    return {
      success: false,
      serial,
      packageName,
      environment: '',
      available: false,
      error: diagnosticError.message,
      errorCode: diagnosticError.errorCode,
      errorType: diagnosticError.errorType,
      command: diagnosticError.command,
      exitCode: diagnosticError.exitCode,
      signal: diagnosticError.signal,
      timeoutMs: diagnosticError.timeoutMs,
      stdout: diagnosticError.stdout,
      stderr: diagnosticError.stderr,
      recoveryActions: diagnosticError.recoveryActions,
      diagnostics: diagnosticError.diagnostics,
    };
  }
}

function runAdbStepForSdkEnvironment(label, args, timeout = 5000, options = {}) {
  const serialIndex = args.indexOf('-s');
  const serial = serialIndex >= 0 ? String(args[serialIndex + 1] || '') : '';
  try {
    const result = runAdbCommand(args, { timeout });
    return {
      label,
      command: `${result.adbPath} ${args.join(' ')}`,
      stdout: result.stdout,
      stderr: result.stderr,
      optional: Boolean(options.optional),
      success: true,
    };
  } catch (error) {
    const command = error?.command || `${resolvedAdbPathForCli || resolveAdbPathForCliSync()} ${args.join(' ')}`;
    const diagnosticError = createAdbDiagnosticError(error, {
      deviceRole: 'phone',
      serial: options.serial || serial,
      packageName: options.packageName || '',
      command,
    });
    const step = {
      label,
      command,
      error: diagnosticError.message,
      errorCode: diagnosticError.errorCode,
      errorType: diagnosticError.errorType,
      exitCode: diagnosticError.exitCode,
      signal: diagnosticError.signal,
      timeoutMs: diagnosticError.timeoutMs,
      stdout: diagnosticError.stdout,
      stderr: diagnosticError.stderr,
      recoveryActions: diagnosticError.recoveryActions,
      diagnostics: diagnosticError.diagnostics,
      optional: Boolean(options.optional),
      success: false,
    };
    if (options.optional) {
      return step;
    }
    diagnosticError.step = step;
    throw diagnosticError;
  }
}

function setSdkEnvironmentForCli(options = {}) {
  const serial = String(options.serial || '').trim();
  const packageName = String(options.packageName || '').trim();
  const environment = normalizeSdkEnvironment(options.environment);
  const rawEnvironment = sdkEnvironmentMap[environment];
  const forceRestart = Boolean(options.forceRestart);

  if (!serial || !rawEnvironment || !packageName || !/^[A-Za-z0-9._]+$/.test(packageName)) {
    return {
      success: false,
      serial,
      packageName,
      environment: environment || String(options.environment || '').trim(),
      error: 'Missing serial or invalid environment/package',
    };
  }

  const envDir = `/sdcard/Android/data/${packageName}/files`;
  const envFile = `${envDir}/sdk_env`;
  const steps = [];

  try {
    const currentEnvironment = readSdkEnvironmentForCli({ serial, packageName });
    if (!currentEnvironment.success && [
      'DEVICE_ADB_UNAUTHORIZED',
      'DEVICE_ADB_OFFLINE',
      'DEVICE_ADB_TRANSPORT_UNAVAILABLE',
    ].includes(currentEnvironment.errorCode)) {
      return {
        ...currentEnvironment,
        environment,
        rawEnvironment,
        steps,
      };
    }
    if (currentEnvironment.success && currentEnvironment.environment === environment && !forceRestart) {
      return {
        success: true,
        serial,
        packageName,
        environment,
        rawEnvironment: currentEnvironment.rawEnvironment || rawEnvironment,
        restarted: false,
        skipped: true,
        reason: '当前环境已匹配，未重复写入 sdk_env，也未重启目标应用',
        currentEnvironment,
        steps,
      };
    }

    const packageStep = runAdbStepForSdkEnvironment(
      '检查目标应用',
      ['-s', serial, 'shell', 'pm', 'path', packageName],
      5000,
      { serial, packageName }
    );
    steps.push(packageStep);
    if (!String(packageStep.stdout || '').split(/\r?\n/).some((line) => line.trim().startsWith('package:'))) {
      throw createAdbDiagnosticError(
        {
          command: packageStep.command,
          stdout: packageStep.stdout,
          stderr: packageStep.stderr,
          exitCode: 0,
        },
        {
          deviceRole: 'phone',
          serial,
          packageName,
          command: packageStep.command,
          packageMissing: true,
        }
      );
    }

    try {
      steps.push(runAdbStepForSdkEnvironment('创建环境配置目录', ['-s', serial, 'shell', 'mkdir', '-p', envDir], 5000));
      steps.push(runAdbStepForSdkEnvironment('写入环境配置', ['-s', serial, 'shell', `printf '%s' '${rawEnvironment}' > ${envFile}`], 5000));
    } catch (directWriteError) {
      if ([
        'DEVICE_ADB_UNAUTHORIZED',
        'DEVICE_ADB_OFFLINE',
        'DEVICE_ADB_TRANSPORT_UNAVAILABLE',
      ].includes(directWriteError?.errorCode)) {
        throw directWriteError;
      }
      const localEnvFile = path.join(os.tmpdir(), `glassbox-sdk-env-${serial}-${Date.now()}`);
      const remoteTempFile = `/sdcard/Download/${path.basename(localEnvFile)}`;

      fs.writeFileSync(localEnvFile, rawEnvironment);

      try {
        steps.push({
          label: '直接写入环境配置失败，尝试 run-as 回退',
          error: directWriteError instanceof Error ? directWriteError.message : String(directWriteError),
          success: false,
        });
        steps.push(runAdbStepForSdkEnvironment('推送临时环境文件', ['-s', serial, 'push', localEnvFile, remoteTempFile], 10000));
        steps.push(runAdbStepForSdkEnvironment(
          '使用应用身份写入环境配置',
          ['-s', serial, 'shell', `run-as ${packageName} sh -c "mkdir -p ${envDir} && cp ${remoteTempFile} ${envFile}"`],
          10000
        ));
      } finally {
        fs.rmSync(localEnvFile, { force: true });
        steps.push(runAdbStepForSdkEnvironment('清理临时环境文件', ['-s', serial, 'shell', 'rm', '-f', remoteTempFile], 5000, { optional: true }));
      }
    }

    const verifyStep = runAdbStepForSdkEnvironment('校验环境配置', ['-s', serial, 'shell', 'cat', envFile], 5000);
    steps.push(verifyStep);
    const verifiedEnvironment = String(verifyStep.stdout || '').trim();

    if (verifiedEnvironment !== rawEnvironment) {
      throw new Error(`校验环境配置失败：期望 ${rawEnvironment}，实际 ${verifiedEnvironment || '空'}`);
    }

    steps.push(runAdbStepForSdkEnvironment('重启目标应用', ['-s', serial, 'shell', 'am', 'force-stop', packageName], 5000));
    steps.push(runAdbStepForSdkEnvironment(
      '拉起目标应用',
      ['-s', serial, 'shell', `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true`],
      10000,
      { optional: true }
    ));

    return {
      success: true,
      serial,
      packageName,
      environment,
      rawEnvironment,
      restarted: true,
      steps,
    };
  } catch (error) {
    const diagnosticError = error?.errorCode
      ? error
      : createAdbDiagnosticError(error, {
        deviceRole: 'phone',
        serial,
        packageName,
        command: error?.command || '',
      });
    return {
      success: false,
      serial,
      packageName,
      environment,
      rawEnvironment,
      steps,
      failedStep: diagnosticError?.step,
      error: diagnosticError.message,
      errorCode: diagnosticError.errorCode,
      errorType: diagnosticError.errorType,
      command: diagnosticError.command || '',
      exitCode: diagnosticError.exitCode ?? null,
      signal: diagnosticError.signal || null,
      timeoutMs: diagnosticError.timeoutMs ?? null,
      stdout: diagnosticError.stdout || '',
      stderr: diagnosticError.stderr || '',
      recoveryActions: diagnosticError.recoveryActions || [],
      diagnostics: diagnosticError.diagnostics || null,
    };
  }
}

function createCliRuntimeEnvironmentInfo(options = {}) {
  const serial = String(options.serial || '').trim();
  const packageName = String(options.packageName || defaultPhonePackageName).trim();
  const requestedEnvironment = normalizeSdkEnvironment(options.requestedEnvironment);
  const environmentSwitch = options.environmentSwitch || null;

  if (environmentSwitch?.success) {
    return {
      success: true,
      source: requestedEnvironment ? '--env' : 'environment-switch',
      requestedEnvironment: requestedEnvironment || undefined,
      serial: environmentSwitch.serial || serial,
      packageName: environmentSwitch.packageName || packageName,
      environment: environmentSwitch.environment,
      rawEnvironment: environmentSwitch.rawEnvironment || '',
      defaulted: false,
      switched: Boolean(requestedEnvironment),
      skipped: Boolean(environmentSwitch.skipped),
      restarted: Boolean(environmentSwitch.restarted),
      currentEnvironment: environmentSwitch.currentEnvironment || undefined,
    };
  }

  const currentEnvironment = readSdkEnvironmentForCli({ serial, packageName });
  return {
    success: Boolean(currentEnvironment.success),
    source: requestedEnvironment ? '--env-readback' : 'current-sdk-env',
    requestedEnvironment: requestedEnvironment || undefined,
    serial,
    packageName,
    environment: currentEnvironment.environment || '',
    rawEnvironment: currentEnvironment.rawEnvironment || '',
    defaulted: Boolean(currentEnvironment.defaulted),
    switched: false,
    skipped: false,
    restarted: false,
    available: Boolean(currentEnvironment.available),
    error: currentEnvironment.error || '',
  };
}

function normalizePerformanceOptionsFromCommand(command, testCase, runOptions) {
  const perfValues = getOptions(command, '--perf')
    .flatMap((value) => String(value || '').split(','))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  if(perfValues.some(role=>!['phone','glasses','all'].includes(role)))
    throw Object.assign(new Error('--perf 仅支持 phone、glasses、all'),{code:'INVALID_DEVICE_ROLE'});
  const phone = hasFlag(command, '--perf-phone') || perfValues.includes('phone') || perfValues.includes('all');
  const glasses = hasFlag(command, '--perf-glasses') || perfValues.includes('glasses') || perfValues.includes('all');
  const intervalMs = Math.max(1000, Number(getOption(command, '--perf-interval-ms') || 5000) || 5000);
  const phoneRuntime = String(getOption(command, '--perf-phone-runtime') || 'android') === 'harmony' ? 'harmony' : 'android';
  const glassesRuntime = String(getOption(command, '--perf-glasses-runtime') || 'android') === 'harmony' ? 'harmony' : 'android';
  const packageFor = (role) => command.includes(`--perf-${role}-package`)
    ? String(getOption(command, `--perf-${role}-package`) || '').trim()
    : String(runOptions.devices?.[role]?.packageName || runOptions.devices?.defaults?.[`${role}Package`] || testCase.defaults?.[`${role}Package`] || '').trim();
  const phonePackage = packageFor('phone');
  const glassesPackage = packageFor('glasses');
  for (const [role, enabled, packageName] of [['phone', phone, phonePackage], ['glasses', glasses, glassesPackage]]) {
    if (enabled && (!String(runOptions[`${role}Serial`] || '').trim() || !packageName || packageName.startsWith('--'))) {
      throw Object.assign(new Error(`${role} 性能采集缺少设备 SN 或目标包名，请配置设备包名或 --perf-${role}-package。`), {
        code: 'PERFORMANCE_TARGET_CONFIG_MISSING', field: `performanceOptions.targets.${role}`,
      });
    }
  }

  return {
    phone,
    glasses,
    intervalMs,
    threadStacks: hasFlag(command, '--thread-stacks') ? { enabled: true, mode: getOption(command, '--stack-mode') || 'manual',
      intervalMs: Number(getOption(command, '--stack-interval-ms') || 60000), maxCount: Number(getOption(command, '--stack-max-count') || 10),
      maxBytes: Number(getOption(command, '--stack-max-bytes') || 16777216), checkpoints: getOptions(command, '--stack-checkpoint') } : undefined,
    targets: {
      phone: {
        target: 'phone',
        runtime: phoneRuntime,
        serial: runOptions.phoneSerial || '',
        packageName: phonePackage,
      },
      glasses: {
        target: 'glasses',
        runtime: glassesRuntime,
        serial: runOptions.glassesSerial || '',
        packageName: glassesPackage,
      },
    },
  };
}

function collectAndroidPerformanceSampleSync(serial, packageName) {
  const run = (args, timeout) => runAdbCommand(args, { timeout }).stdout;
  const safeRun = (args, timeout) => {
    try {
      return run(args, timeout);
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const pidOutput = safeRun(['-s', serial, 'shell', 'pidof', packageName], 5000);
  const pid = pickPidFromOutput(pidOutput);
  const meminfo = safeRun(['-s', serial, 'shell', 'dumpsys', 'meminfo', packageName], 8000);
  const cpuinfo = safeRun(['-s', serial, 'shell', 'dumpsys', 'cpuinfo'], 8000);
  const systemMeminfo = safeRun(['-s', serial, 'shell', 'cat', '/proc/meminfo'], 5000);
  const topOutput = safeRun(['-s', serial, 'shell', 'top', '-n', '1', '-b'], 8000);
  const status = pid ? safeRun(['-s', serial, 'shell', 'cat', `/proc/${pid}/status`], 5000) : '';
  const threadCount = parseProcStatusThreads(status)
    || (pid ? parseFirstNumber(safeRun(['-s', serial, 'shell', 'sh', '-c', `ls /proc/${pid}/task 2>/dev/null | wc -l`], 5000)) : undefined);

  const batteryRaw = safeRun(['-s', serial, 'shell', 'dumpsys', 'battery'], 8000);
  return {
    ...performanceBatteryMetrics(batteryRaw),
    pid,
    memoryKb: parseAndroidMeminfo(meminfo) || parseProcStatusMemory(status),
    cpuPercent: parseAndroidTopProcess(topOutput, packageName, pid).cpuPercent ?? parseCpuPercentFromOutput(cpuinfo, packageName),
    cpuSource: parseAndroidTopProcess(topOutput, packageName, pid).cpuPercent !== undefined ? 'top' : 'dumpsys-cpuinfo',
    cpuUnit: 'percent-one-core',
    threadCount,
    systemAvailableMemoryKb: parseSystemAvailableMemoryKb(systemMeminfo),
    systemAvailableCpuPercent: parseSystemAvailableCpuPercent(topOutput),
  };
}

function collectHarmonyPerformanceSampleSync(serial, packageName) {
  const safeRun = (args, timeout) => {
    try {
      return runHdcCommand(args, { timeout }).stdout;
    } catch (error) {
      return `ERROR: ${error instanceof Error ? error.message : String(error)}`;
    }
  };
  const target = shellSingleQuote(packageName);
  const pidOutput = safeRun(['-t', serial, 'shell', `pidof ${target}`], 5000);
  const pid = pickPidFromOutput(pidOutput);
  const topOutput = safeRun(['-t', serial, 'shell', 'top -m 20 -n 1'], 8000);
  const topProcess = parseHarmonyTopProcess(topOutput, packageName, pid);
  const effectivePid = pid || topProcess.pid || '';
  const status = effectivePid ? safeRun(['-t', serial, 'shell', `cat /proc/${effectivePid}/status`], 5000) : '';
  const threadOutput = effectivePid ? safeRun(['-t', serial, 'shell', `ls /proc/${effectivePid}/task 2>/dev/null | wc -l`], 5000) : '';

  return {
    pid: effectivePid,
    memoryKb: parseProcStatusMemory(status) || topProcess.memoryKb,
    cpuPercent: topProcess.cpuPercent ?? parseCpuPercentFromOutput(topOutput, packageName),
    threadCount: parseProcStatusThreads(status) || parseFirstNumber(threadOutput),
    systemAvailableMemoryKb: parseSystemAvailableMemoryKb(topOutput),
    systemAvailableCpuPercent: parseSystemAvailableCpuPercent(topOutput),
  };
}

function collectPerformanceSampleSync(config) {
  const { runtime, serial, packageName } = config;

  if (!serial || !packageName) {
    return {
      timestamp: new Date().toISOString(),
      serial,
      packageName,
      runtime,
      error: `${config.target === 'phone' ? '手机' : '眼镜'}性能采样缺少 SN 或包名`,
    };
  }

  try {
    const sample = runtime === 'harmony'
      ? collectHarmonyPerformanceSampleSync(serial, packageName)
      : collectAndroidPerformanceSampleSync(serial, packageName);
    const error = !sample.pid ? '未找到目标进程，请确认应用正在运行，且包名/进程名正确' : undefined;

    return {
      timestamp: new Date().toISOString(),
      serial,
      packageName,
      runtime,
      ...sample,
      error,
    };
  } catch (error) {
    return {
      timestamp: new Date().toISOString(),
      serial,
      packageName,
      runtime,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function startCliPerformanceCollection(taskName, performanceOptions) {
  const enabledTargets = [
    performanceOptions.phone ? 'phone' : null,
    performanceOptions.glasses ? 'glasses' : null,
  ].filter(Boolean);
  const samples = {
    phone: [],
    glasses: [],
  };

  if (enabledTargets.length === 0) {
    return null;
  }

  const collect = () => {
    enabledTargets.forEach((target) => {
      samples[target].push(collectPerformanceSampleSync(performanceOptions.targets[target]));
    });
  };
  collect();
  const timerId = setInterval(collect, performanceOptions.intervalMs || 5000);

  return {
    stop: () => {
      clearInterval(timerId);
      collect();
      return Object.fromEntries(enabledTargets.map((target) => {
        const targetSamples = samples[target];
        const targetConfig = performanceOptions.targets[target];
        const firstSample = targetSamples[0];

        return [target, {
          id: `task-performance-${target}-${Date.now()}-${Math.random().toString(16).slice(2)}`,
          target,
          name: `${taskName} · ${target === 'phone' ? '手机性能报告' : '眼镜性能报告'}`,
          createdAt: new Date().toISOString(),
          runtime: targetConfig.runtime,
          serial: firstSample?.serial || targetConfig.serial,
          packageName: firstSample?.packageName || targetConfig.packageName,
          samples: targetSamples,
        }];
      }));
    },
  };
}

function getCasesFromPayload(payload) {
  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && payload.case
    && typeof payload.case === 'object'
    && payload.case.schemaVersion === 'glassbox.workflow.v1'
  ) {
    return [{
      ...payload.case,
      components: Array.isArray(payload.case.components)
        ? payload.case.components
        : Array.isArray(payload.components)
          ? payload.components
          : payload.case.components,
      edges: Array.isArray(payload.case.edges)
        ? payload.case.edges
        : Array.isArray(payload.edges)
          ? payload.edges
          : payload.case.edges,
    }];
  }

  if (
    payload
    && typeof payload === 'object'
    && !Array.isArray(payload)
    && Array.isArray(payload.cases)
    && payload.cases.length === 1
    && payload.cases[0]
    && typeof payload.cases[0] === 'object'
    && payload.cases[0].schemaVersion === 'glassbox.workflow.v1'
  ) {
    return payload.cases;
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (payload && typeof payload === 'object' && Array.isArray(payload.cases)) {
    return payload.cases;
  }

  return [payload];
}

function createMergedComponentsForCli(...componentSets) {
  const componentMap = new Map(builtinComponents.map((component) => [component.id, component]));

  for (const components of componentSets) {
    for (const component of Array.isArray(components) ? components : []) {
      if (component?.id && isSupportedComponent(component)) {
        componentMap.set(component.id, mergeComponentForCli(componentMap.get(component.id), component));
      }
    }
  }

  return [...componentMap.values()];
}

function isLegacyBusinessComponentForCli(component = {}) {
  return Boolean(component.legacyBusiness || component.platformScope === 'legacy-business-compatibility');
}

function getListedComponentsForCli(stateComponents = [], options = {}) {
  const components = createMergedComponentsForCli(stateComponents);
  if (options.includeLegacyBusiness) {
    return components;
  }
  return components.filter((component) => !isLegacyBusinessComponentForCli(component));
}

// Match the runner: component defaults first, then explicit node inputs (including empty/false/0).
function componentInputValuesForCli(component, step) {
  return {...Object.fromEntries((component?.params || []).map(p=>[p.key,p.defaultValue ?? ''])), ...(step.inputs || {})};
}

function createComponentMapForCli(...componentSets) {
  return new Map(createMergedComponentsForCli(...componentSets).map((component) => [component.id, component]));
}

function mergeComponentsForExecutableCase(testCase = {}, ...componentSets) {
  return {
    ...testCase,
    components: createMergedComponentsForCli(...componentSets, testCase.components),
  };
}

function getPayloadLevelComponents(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return [];
  }

  return Array.isArray(payload.components) ? payload.components : [];
}

function selectCase(cases, caseId = '') {
  if (!caseId) {
    return {
      testCase: cases.length === 1 ? cases[0] : null,
      error: cases.length === 1
        ? ''
        : `run case expects exactly one case or --case-id, received ${cases.length}`,
    };
  }

  const testCase = cases.find((item) => item?.id === caseId);
  if (!testCase) {
    return {
      testCase: null,
      error: `case not found: ${caseId}`,
    };
  }

  return {
    testCase,
    error: '',
  };
}

function isEmptyValue(value) {
  return value === undefined || value === null || String(value).trim() === '';
}

function isRuntimeResolvedAssetPathForCli(value) {
  const rawPath = String(value || '').trim();
  return /\$\{[^{}]+\}|\{\{[^{}]+\}\}/.test(rawPath);
}

function resolveCaseAssetPathForCli(testCase, value, fallbackBaseDir = '') {
  const rawPath = String(value || '').trim();
  if (!rawPath || path.isAbsolute(rawPath)) {
    return rawPath;
  }
  const baseDir = String(testCase?.assetBaseDir || fallbackBaseDir || '').trim();
  return baseDir && path.isAbsolute(baseDir) ? path.resolve(baseDir, rawPath) : '';
}

function validateCase(testCase, caseIndex, componentMap, options = {}) {
  const errors = [];
  const warnings = [];
  const prefix = `cases[${caseIndex}]`;

  if (!testCase || typeof testCase !== 'object' || Array.isArray(testCase)) {
    return {
      errors: [`${prefix}: 用例必须是对象`],
      warnings,
    };
  }

  if (testCase.schemaVersion !== 'glassbox.workflow.v1') {
    errors.push(`${prefix}.schemaVersion: 必须是 glassbox.workflow.v1`);
  }

  if (!testCase.id) {
    errors.push(`${prefix}.id: 缺少用例 ID`);
  }

  if (!testCase.name) {
    errors.push(`${prefix}.name: 缺少用例名称`);
  }

  if (!Array.isArray(testCase.steps)) {
    errors.push(`${prefix}.steps: 必须是数组`);
    return { errors, warnings };
  }

  if (testCase.reviewStatus !== 'draft') {
    warnings.push(`${prefix}.reviewStatus: Agent 生成用例建议使用 draft`);
  }

  for (const step of pendingSteps(testCase)) (options.allowImportReviewDraft && testCase.reviewStatus === 'draft' ? warnings : errors).push(`${prefix}.steps.${step.id}: SoloPi 导入节点待处理：${step.config?.importReview?.reason || '请检查原生动作和输入参数'}`);

  const tags = Array.isArray(testCase.tags) ? testCase.tags : [];
  if (!tags.includes('draft') || !tags.includes('ai-generated')) {
    warnings.push(`${prefix}.tags: Agent 生成用例建议包含 draft 和 ai-generated`);
  }

  const hasStart = testCase.steps.some((step) => step?.type === 'start');
  const hasEnd = testCase.steps.some((step) => step?.type === 'end');

  if (!hasStart) {
    errors.push(`${prefix}.steps: 缺少 start 步骤`);
  }

  if (!hasEnd) {
    errors.push(`${prefix}.steps: 缺少 end 步骤`);
  }

  testCase.steps.forEach((step, stepIndex) => {
    const stepPrefix = `${prefix}.steps[${stepIndex}]`;

    if (!step || typeof step !== 'object' || Array.isArray(step)) {
      errors.push(`${stepPrefix}: 步骤必须是对象`);
      return;
    }

    if (!step.id) {
      errors.push(`${stepPrefix}.id: 缺少步骤 ID`);
    }

    if (!step.name) {
      errors.push(`${stepPrefix}.name: 缺少步骤名称`);
    }

    if (!validStepTypes.has(step.type)) {
      errors.push(`${stepPrefix}.type: 非法步骤类型 ${JSON.stringify(step.type)}`);
    }

    if (!validDevices.has(step.device)) {
      errors.push(`${stepPrefix}.device: 必须是 phone、glasses 或 pc`);
    }

    if (step.type === 'component') {
      if (!step.componentId) {
        errors.push(`${stepPrefix}.componentId: component 步骤必须引用 componentId`);
        return;
      }

      const component = componentMap.get(step.componentId);
      if (!component) {
        errors.push(`${stepPrefix}.componentId: 未找到组件 ${step.componentId}`);
        return;
      }

      const inputs = componentInputValuesForCli(component, step);
      component.params
        .filter((param) => param.required)
        .forEach((param) => {
          if (isEmptyValue(inputs[param.key])) {
            errors.push(`${stepPrefix}.inputs.${param.key}: 缺少必填参数（${component.name}）`);
          }
        });
    }

    if (step.type === 'wait') {
      const config = step.config && typeof step.config === 'object' ? step.config : {};
      if (config.durationMs !== undefined && Number(config.durationMs) < 0) {
        errors.push(`${stepPrefix}.config.durationMs: 必须大于等于 0`);
      }
    }

    if (step.type === 'if') {
      const config = step.config && typeof step.config === 'object' ? step.config : {};
      if (!config.condition && config.value === undefined) {
        errors.push(`${stepPrefix}.config.condition: IF 节点必须声明 condition 或 value`);
      } else if (typeof config.condition === 'string' && !/^(?:\{\{(?:variables|nodeOutputs)\.[^{}]+\}\}|(?:variables|nodeOutputs)\.[^{}\s]+|\$\{variables\.[^{}]+\})$/.test(config.condition.trim())) {
        errors.push(`${stepPrefix}.config.condition: 变量必须使用 variables.xxx、nodeOutputs.xxx 或对应模板格式`);
      }
    }

    const acceptedExitCodes = step.acceptedExitCodes ?? step.config?.acceptedExitCodes;
    if (acceptedExitCodes !== undefined) {
      const values = Array.isArray(acceptedExitCodes) ? acceptedExitCodes : [acceptedExitCodes];
      if (values.some((value) => !Number.isInteger(Number(value)))) {
        errors.push(`${stepPrefix}.acceptedExitCodes: 必须是整数数组`);
      }
    }

    const mappings = step.outputMapping || step.config?.outputMapping || step.config?.variableMapping || step.config?.mapping;
    if (mappings !== undefined) {
      if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) {
        errors.push(`${stepPrefix}.outputMapping: 必须是对象`);
      } else {
        Object.entries(mappings).forEach(([name, mapping]) => {
          if (!/^[A-Za-z_][A-Za-z0-9_.]*$/.test(String(name))) {
            errors.push(`${stepPrefix}.outputMapping.${name}: 变量名不合法`);
          }
          if (typeof mapping !== 'string' && (!mapping || typeof mapping !== 'object' || Array.isArray(mapping))) {
            errors.push(`${stepPrefix}.outputMapping.${name}: mapping 必须是 source 字符串或对象`);
          }
          if (mapping && typeof mapping === 'object' && mapping.type && !['string', 'number', 'boolean', 'json', 'jsonpath'].includes(String(mapping.type).toLowerCase())) {
            errors.push(`${stepPrefix}.outputMapping.${name}.type: 仅支持 string/number/boolean/json/jsonPath`);
          }
        });
      }
    }
  });

  return { errors, warnings };
}

function validatePayload(payload, options = {}) {
  const cases = getCasesFromPayload(payload);
  const errors = [];
  const warnings = [];
  const { state } = readWorkflowStateForCli();
  const stateComponents = Array.isArray(state?.components) ? state.components : [];
  const payloadComponents = getPayloadLevelComponents(payload);

  if (!cases.length) {
    errors.push('文件中没有可校验的用例');
  }

  cases.forEach((testCase, index) => {
    const componentMap = createComponentMapForCli(stateComponents, payloadComponents, testCase.components);
    const result = validateCase(testCase, index, componentMap, options);
    errors.push(...result.errors);
    warnings.push(...result.warnings);
  });

  return {
    success: errors.length === 0,
    caseCount: cases.length,
    errors,
    warnings,
  };
}

function createTaskValidationErrorForCli(testCase, index, rawMessage, options = {}) {
  const message = String(rawMessage || '用例校验失败');
  const stepMatch = message.match(/steps\[(\d+)\](?:\.([^:]+))?/);
  const fieldMatch = message.match(/(?:^|\.)((?:schemaVersion|id|name|steps|componentId|inputs\.[^:]+|config\.[^:]+)):/);
  const node = options.node || (stepMatch ? (testCase?.steps?.[Number(stepMatch[1])]?.id || `steps[${stepMatch[1]}]`) : 'case');
  const field = options.field || fieldMatch?.[1] || (stepMatch ? `steps[${stepMatch[1]}]` : 'case');
  return {
    caseId: testCase?.id || '',
    caseName: testCase?.name || testCase?.id || `case-${index + 1}`,
    node,
    field,
    code: options.code || 'CASE_VALIDATION_FAILED',
    message,
    recoveryActions: options.recoveryActions || [
      '修复该 case 的 schema、步骤、组件、参数或边后重新运行同一条 run task 命令。',
      '运行 solopi-desktop cases show <caseId> --json 检查 UI 合并后的组件、edges 和 nodePositions。',
    ],
  };
}

function validateCaseEdgesForCli(testCase, rawEdges = []) {
  const errors = [];
  const stepIds = new Set((testCase?.steps || []).map((step) => String(step?.id || '')).filter(Boolean));
  if (!Array.isArray(rawEdges)) {
    return errors;
  }
  rawEdges.forEach((edge, index) => {
    const source = String(edge?.source || edge?.from || '').trim();
    const target = String(edge?.target || edge?.to || '').trim();
    if (!source || !target) {
      errors.push({
        code: 'CASE_EDGE_INVALID',
        field: `edges[${index}]`,
        node: `edges[${index}]`,
        message: `边必须包含 source 和 target：${JSON.stringify(edge)}`,
      });
      return;
    }
    if (!stepIds.has(source) || !stepIds.has(target)) {
      errors.push({
        code: 'CASE_EDGE_ENDPOINT_MISSING',
        field: `edges[${index}]`,
        node: `edges[${index}]`,
        message: `边引用了不存在的步骤：${source} -> ${target}`,
      });
    }
    const handle = edge?.sourceHandle ?? edge?.handle ?? edge?.condition;
    const supportedEdgeHandleFields = new Set(['sourceHandle', 'targetHandle', 'handle', 'condition']);
    const unsupportedHandleFields = Object.keys(edge || {}).filter((key) => /handle|branch|condition/i.test(key)
      && !supportedEdgeHandleFields.has(key));
    if (unsupportedHandleFields.length > 0) {
      errors.push({
        code: 'CASE_EDGE_HANDLE_FIELD_INVALID',
        field: `edges[${index}]`,
        node: `edges[${index}]`,
        message: `不支持的边分支字段：${unsupportedHandleFields.join(', ')}；分支请使用 sourceHandle/handle/condition，targetHandle 仅用于目标端口元数据。`,
      });
    }
    if (handle !== undefined && !['true', 'false', 'error', 'default', ''].includes(String(handle).trim().toLowerCase())) {
      errors.push({
        code: 'CASE_EDGE_HANDLE_INVALID',
        field: `edges[${index}].sourceHandle`,
        node: `edges[${index}]`,
        message: `边分支 handle 不合法：${String(handle)}；仅支持 true/false/error/default。`,
      });
    }
  });
  if (rawEdges.length === 0) return errors;
  const outgoing = new Map();
  rawEdges.forEach((edge) => {
    const source = String(edge?.source || edge?.from || '').trim();
    const target = String(edge?.target || edge?.to || '').trim();
    if (source && target && stepIds.has(source) && stepIds.has(target)) {
      outgoing.set(source, [...(outgoing.get(source) || []), target]);
    }
  });
  const visiting = new Set();
  const visited = new Set();
  const walk = (id) => {
    if (visiting.has(id)) return true;
    if (visited.has(id)) return false;
    visiting.add(id);
    const cycle = (outgoing.get(id) || []).some(walk);
    visiting.delete(id);
    visited.add(id);
    return cycle;
  };
  if ([...stepIds].some(walk)) {
    errors.push({
      code: 'CASE_EDGE_CYCLE',
      field: 'edges',
      node: 'edges',
      message: '执行图包含环，无法保证从 start 到 end 的确定性执行顺序。',
    });
  }
  const incoming = new Set(rawEdges.map((edge) => String(edge?.target || edge?.to || '').trim()));
  const startIds = new Set((testCase?.steps || []).filter((step) => step?.type === 'start').map((step) => String(step.id)));
  (testCase?.steps || []).forEach((step) => {
    if (step?.type !== 'start' && !incoming.has(String(step?.id || '')) && !startIds.has(String(step?.id || ''))) {
      errors.push({
        code: 'CASE_EDGE_ISOLATED_NODE',
        field: `steps.${step.id}`,
        node: step.id,
        message: `步骤 ${step.id} 没有入边，无法从 start 到达。`,
      });
    }
  });
  return errors;
}

function getAssertionExtractionConfigForCli(step, component) {
  const inputs = step?.inputs && typeof step.inputs === 'object' ? step.inputs : {};
  const config = step?.config && typeof step.config === 'object' ? step.config : {};
  const params = new Map((component?.params || []).map((param) => [param.key, param]));
  const enabledValue = inputs.extractVariableEnabled
    ?? config.extractVariableEnabled
    ?? params.get('extractVariableEnabled')?.defaultValue
    ?? 'false';
  const nameValue = inputs.extractVariableName
    ?? config.extractVariableName
    ?? params.get('extractVariableName')?.defaultValue
    ?? '';
  return {
    enabled: String(enabledValue).trim().toLowerCase() === 'true',
    name: String(nameValue ?? '').trim(),
  };
}

function validateAssertionExtractionForCli(testCase, index, componentMap) {
  const errors = [];
  const seen = new Map();
  (testCase?.steps || []).forEach((step) => {
    if (step?.type !== 'component') return;
    const component = componentMap.get(step.componentId);
    if (!['tts_assert', 'json_assert', 'llm_assert'].includes(component?.kind)) return;
    const extraction = getAssertionExtractionConfigForCli(step, component);
    if (!extraction.enabled) return;
    if (!extraction.name) {
      errors.push(createTaskValidationErrorForCli(testCase, index, '断言提取已开启，但变量名为空或仅包含空格。', {
        code: 'ASSERTION_EXTRACT_VARIABLE_NAME_REQUIRED',
        node: step.id,
        field: 'inputs.extractVariableName',
        recoveryActions: ['关闭提取，或填写字母/数字/下划线/点号组成的唯一变量名后重新运行。'],
      }));
      return;
    }
    if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(extraction.name)) {
      errors.push(createTaskValidationErrorForCli(testCase, index, `断言提取变量名不合法：${extraction.name}`, {
        code: 'ASSERTION_EXTRACT_VARIABLE_NAME_INVALID',
        node: step.id,
        field: 'inputs.extractVariableName',
        recoveryActions: ['使用字母/数字/下划线/点号组成的变量名。'],
      }));
      return;
    }
    const previous = seen.get(extraction.name);
    if (previous) {
      errors.push(createTaskValidationErrorForCli(testCase, index, `断言提取变量名重复：${extraction.name}；冲突步骤 ${previous.stepId} 与 ${step.id}`, {
        code: 'ASSERTION_EXTRACT_VARIABLE_NAME_DUPLICATE',
        node: step.id,
        field: 'inputs.extractVariableName',
        recoveryActions: ['为同一 case 中每个开启提取的断言填写不同变量名，或关闭不需要的提取。'],
      }));
    } else {
      seen.set(extraction.name, { stepId: step.id, kind: component.kind });
    }
  });
  return errors;
}

function validateExecutableTaskSelectionForCli(selection) {
  const cases = Array.isArray(selection?.cases) ? selection.cases : [];
  const errors = [];
  const warnings = [];
  const { state } = readWorkflowStateForCli();
  const stateComponents = Array.isArray(state?.components) ? state.components : [];
  const rawCaseEdges = selection?.caseEdges || {};

  cases.forEach((testCase, index) => {
    const componentMap = createComponentMapForCli(stateComponents, selection.payloadComponents, testCase?.components);
    const validation = validateCase(
      testCase,
      index,
      componentMap
    );
    validation.errors.forEach((message) => errors.push(createTaskValidationErrorForCli(testCase, index, message)));
    validation.warnings.forEach((message) => warnings.push(createTaskValidationErrorForCli(testCase, index, message, {
      code: 'CASE_VALIDATION_WARNING',
      recoveryActions: ['该 warning 不阻断提交；如需清理，可补齐 agent case 的 reviewStatus/tags。'],
    })));

    validateAssertionExtractionForCli(testCase, index, componentMap).forEach((error) => errors.push(error));
    try {
      assertLogSampleExtraction({components:[...componentMap.values()]},testCase);
    } catch(error) {
      const isPatternError=error.field==='inputs.extractRegex';
      (isPatternError?errors:warnings).push(createTaskValidationErrorForCli(testCase,index,error.message,{
        code:'LOG_SAMPLE_EXTRACTION_INVALID',node:error.stepId,field:error.field || 'inputs.extractRegex',
        recoveryActions:[isPatternError
          ? '修复提取正则语法后再运行；平台不会自动改写。'
          : '样例资料不用于运行断言，本项不阻断提交；执行后以同场景真实日志校对样例，保留原业务期望与比较方式。'],
      }));
    }

    (testCase?.steps || []).forEach((step) => {
      if (step?.type !== 'component' && step?.type !== 'send_audio') return;
      const component = step.type === 'component' ? componentMap.get(step.componentId) : null;
      const values = step.type === 'component' ? componentInputValuesForCli(component, step) : (step.config || {});
      const template = String(component?.commandTemplate || values.commandTemplate || '');
      if (component?.kind === 'audio' || step.type === 'send_audio') {
        const inputs = step.inputs || {};
        const sourceType = String(values.sourceType || 'file').trim().toLowerCase();
        const configuredPath = values.localPath || values.audioPath || '';
        if (sourceType !== 'tts'
          && !isEmptyValue(configuredPath)
          && !isRuntimeResolvedAssetPathForCli(configuredPath)) {
          const resolvedPath = resolveCaseAssetPathForCli(testCase, configuredPath, selection?.assetBaseDir);
          if (!fs.existsSync(resolvedPath)) {
            errors.push(createTaskValidationErrorForCli(testCase, index, resolvedPath ? `在声明目录未找到音频：${configuredPath}（解析为 ${resolvedPath}）；不表示原素材从未创建` : `相对素材缺少基准目录：${configuredPath}；请核对复制来源及素材库，不能判定文件缺失`, {
              code: resolvedPath ? 'AUDIO_ASSET_NOT_FOUND' : 'ASSET_BASE_DIR_MISSING',
              node: step.id,
              field: inputs.localPath !== undefined ? 'inputs.localPath' : 'config.localPath',
              recoveryActions: [
                '确认相对音频路径以 bundle/case 文件所在目录为基准。',
                '先核对复制来源用例及所属库目录，复用已有素材；不要据单一路径失败要求用户重配素材或擅自改TTS。',
              ],
            }));
          }
        }
      }
      if ((component?.kind === 'audio' || step.type === 'send_audio') && step.device !== 'pc' && template.includes('{{action}}')) {
        let commandParams = values.commandParams;
        if (typeof commandParams === 'string') {
          try { commandParams = JSON.parse(commandParams); } catch (_error) { commandParams = {}; }
        }
        const action = commandParams?.action ?? values.action ?? '';
        if (isEmptyValue(action)) {
          errors.push(createTaskValidationErrorForCli(testCase, index, '音频广播 commandTemplate 引用了 {{action}}，但 action 为空；请填写可编辑的广播 Action。', {
            code: 'AUDIO_BROADCAST_ACTION_MISSING',
            node: step.id,
            field: 'inputs.action',
            recoveryActions: [
              '为 template-audio-input 填写 action，或使用包含固定广播 Action 的兼容组件。',
              '确认 action 不是空格，并重新运行同一条 run task 命令。',
            ],
          }));
        }
      }
      if (component?.kind === 'audio' || step.type === 'send_audio') {
        const trailingSilenceValue = step.inputs?.trailingSilenceMs
          ?? step.config?.trailingSilenceMs
          ?? component?.params?.find((param) => param.key === 'trailingSilenceMs')?.defaultValue;
        if (trailingSilenceValue !== undefined
          && trailingSilenceValue !== null
          && String(trailingSilenceValue).trim() !== ''
          // Workflow variables (including preceding node outputs) are resolved
          // at execution time, before normalizeTrailingSilenceMs applies its
          // default. Never coerce the expression itself to a number here.
          && !/\$\{[^}]+\}|\{\{(?:defaults|variables|nodeOutputs)\.[^}]+\}\}/.test(String(trailingSilenceValue))) {
          const trailingSilenceMs = Number(trailingSilenceValue);
          if (!Number.isFinite(trailingSilenceMs) || trailingSilenceMs < 0 || trailingSilenceMs > 60000) {
            errors.push(createTaskValidationErrorForCli(testCase, index, '尾部静音必须是 0–60000 之间的毫秒数。', {
              code: 'AUDIO_TRAILING_SILENCE_INVALID',
              node: step.id,
              field: step.inputs?.trailingSilenceMs !== undefined
                ? 'inputs.trailingSilenceMs'
                : 'config.trailingSilenceMs',
              recoveryActions: ['将 trailingSilenceMs 设置为 0–60000 之间的数字；默认建议 800。'],
            }));
          }
        }
      }
    });

    validateCaseEdgesForCli(testCase, testCase?.__rawCanonicalEdges || rawCaseEdges[testCase?.id] || testCase?.edges || [])
      .forEach((edgeError) => errors.push(createTaskValidationErrorForCli(testCase, index, edgeError.message, edgeError)));
    if (Array.isArray(testCase?.__rawEmbeddedEdges)
      && JSON.stringify(testCase.__rawEmbeddedEdges) !== JSON.stringify(testCase.__rawCanonicalEdges || [])) {
      validateCaseEdgesForCli(testCase, testCase.__rawEmbeddedEdges)
        .forEach((edgeError) => warnings.push(createTaskValidationErrorForCli(testCase, index, `embedded case.edges 与 canonical caseEdges 漂移，已以 canonical 为准：${edgeError.message}`, {
          ...edgeError,
          code: 'CASE_EDGE_EMBEDDED_DRIFT',
          recoveryActions: ['保存/导出用例时同步 embedded case.edges；执行路径继续使用 canonical caseEdges。'],
        })));
    }

    if (!testCase?.defaults || typeof testCase.defaults !== 'object') {
      warnings.push(createTaskValidationErrorForCli(testCase, index, '缺少 defaults；将使用设备绑定或 solopi-desktop 默认包名。', {
        code: 'CASE_DEFAULTS_MISSING',
        field: 'defaults',
        node: 'case',
        recoveryActions: ['如需固定运行包名/设备，请补充 defaults.phonePackage、defaults.glassesPackage 和 serial。'],
      }));
    }
  });

  return {
    success: errors.length === 0,
    phase: 'validation',
    validationErrors: errors,
    validationWarnings: warnings,
    validationSummary: {
      selected: cases.length,
      passed: cases.length - new Set(errors.map((item) => item.caseId)).size,
      warnings: warnings.length,
      errors: errors.length,
    },
  };
}

function collectRequiredDeviceRolesForCli(selection) {
  const {state}=readWorkflowStateForCli();
  const components=createMergedComponentsForCli(state?.components, selection.payloadComponents);
  return require(taskDeviceSelectionModule).collectRequiredDeviceRoles({...selection,components});
}


function validateSelectedDevicesForCli(roles, selection) {
  return [...roles].filter(role => {
    const serial = selection[`${role}Serial`];
    return !serial || !selection.devices?.devices?.some(device => device.serial === serial && device.state === 'device' && device.source?.includes('adb'));
  });
}

function createTimestamp() {
  const date = new Date();
  const pad = (value) => String(value).padStart(2, '0');

  return [
    date.getFullYear(),
    pad(date.getMonth() + 1),
    pad(date.getDate()),
    '-',
    pad(date.getHours()),
    pad(date.getMinutes()),
    pad(date.getSeconds()),
  ].join('');
}

function sanitizeFilePart(value) {
  const sanitized = String(value || 'unknown')
    .trim()
    .replace(/[^\w.\-\u4e00-\u9fff]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return sanitized || 'unknown';
}

function getBooleanOverrideFlag(args, positiveFlag, negativeFlag) {
  if (hasFlag(args, negativeFlag)) {
    return false;
  }
  if (hasFlag(args, positiveFlag)) {
    return true;
  }
  return undefined;
}

function normalizeStartOptionsFromCommand(args) {
  const entries = {
    keepScreenAwake: getBooleanOverrideFlag(args, '--keep-screen-awake', '--no-keep-screen-awake'),
    recordGlassesScreen: getBooleanOverrideFlag(args, '--record-glasses-screen', '--no-record-glasses-screen'),
    recordPhoneScreen: getBooleanOverrideFlag(args, '--record-phone-screen', '--no-record-phone-screen'),
    showPhoneScreen: getBooleanOverrideFlag(args, '--show-phone-screen', '--no-show-phone-screen'),
    showGlassesScreen: getBooleanOverrideFlag(args, '--show-glasses-screen', '--no-show-glasses-screen'),
  };

  if (hasFlag(args, '--no-screen-mirror')) {
    entries.showPhoneScreen = false;
    entries.showGlassesScreen = false;
  }
  if (entries.recordPhoneScreen === true && entries.showPhoneScreen === undefined) {
    entries.showPhoneScreen = false;
  }
  if (entries.recordGlassesScreen === true && entries.showGlassesScreen === undefined) {
    entries.showGlassesScreen = false;
  }

  const startOptions = Object.fromEntries(
    Object.entries(entries).filter(([, value]) => value !== undefined)
  );

  return Object.keys(startOptions).length ? startOptions : undefined;
}

function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative && !relative.startsWith('..') && !path.isAbsolute(relative);
}

function rewriteArtifactPaths(value, mapper) {
  if (Array.isArray(value)) {
    return value.map((item) => rewriteArtifactPaths(item, mapper));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  return Object.fromEntries(Object.entries(value).map(([key, itemValue]) => {
    if (typeof itemValue === 'string' && (key === 'path' || key === 'runDir' || key.endsWith('Path'))) {
      return [key, mapper(itemValue)];
    }

    return [key, rewriteArtifactPaths(itemValue, mapper)];
  }));
}

function copyReportCaseArtifacts(taskId, caseRecord, packageRoot) {
  const artifacts = caseRecord?.artifacts;
  const runDir = artifacts?.runDir;

  if (!runDir || !fs.existsSync(runDir)) {
    return artifacts || null;
  }

  const caseArtifactRoot = path.join(
    packageRoot,
    'artifacts',
    sanitizeFilePart(taskId),
    sanitizeFilePart(caseRecord.caseId || caseRecord.caseName || 'case')
  );
  const targetRunDir = path.join(caseArtifactRoot, 'run');

  fs.mkdirSync(caseArtifactRoot, { recursive: true });
  fs.cpSync(runDir, targetRunDir, { recursive: true, force: true });
  packageCasePerformanceReports(targetRunDir, packageRoot, runDir);

  return rewriteArtifactPaths(artifacts, (sourcePath) => {
    if (!sourcePath || !path.isAbsolute(sourcePath)) {
      return sourcePath;
    }

    const resolvedSource = path.resolve(sourcePath);
    const resolvedRunDir = path.resolve(runDir);

    if (resolvedSource === resolvedRunDir) {
      return path.relative(packageRoot, targetRunDir).split(path.sep).join('/');
    }

    if (isPathInside(resolvedRunDir, resolvedSource)) {
      return path.relative(packageRoot, path.join(targetRunDir, path.relative(resolvedRunDir, resolvedSource))).split(path.sep).join('/');
    }

    return sourcePath;
  });
}

function getRunStatus(runResult) {
  if (runResult?.stopped) {
    return 'stopped';
  }

  return runResult?.success ? 'success' : 'failed';
}

function createSyntheticCliCase(name = 'CLI 执行失败') {
  const caseId = `cli-failure-${Date.now()}`;

  return {
    schemaVersion: 'glassbox.workflow.v1',
    id: caseId,
    name,
    description: 'CLI 在执行用例前失败，自动生成此报告用于 review 失败上下文。',
    reviewStatus: 'draft',
    tags: ['cli', 'report', 'failure'],
    defaults: {},
    steps: [
      { id: 'start', name: '开始', type: 'start' },
      { id: 'cli-failure', name: 'CLI 执行', type: 'wait', config: {} },
      { id: 'end', name: '结束', type: 'end' },
    ],
  };
}

function createCliFailureRunResult(error, options = {}) {
  const now = new Date().toISOString();
  const stdout = String(options.stdout || '').trim();
  const stderr = String(options.stderr || '').trim();
  const detail = [
    error,
    stdout ? `\n[stdout]\n${stdout}` : '',
    stderr ? `\n[stderr]\n${stderr}` : '',
  ].filter(Boolean).join('\n');

  return {
    success: false,
    results: [
      {
        stepId: options.stepId || 'cli-failure',
        stepName: options.stepName || 'CLI 执行',
        status: 'failed',
        startedAt: now,
        completedAt: now,
        endedAt: now,
        error: detail || 'CLI 执行失败',
      },
    ],
    artifacts: options.artifacts || null,
    error: String(error || 'CLI 执行失败'),
  };
}

function attachCliReportPackage(testCase, runResult, outputPath = '', disableReport = false) {
  if (disableReport || !runResult) {
    return runResult;
  }

  try {
    runResult.reportPackage = createReportPackage(testCase, runResult, outputPath);
  } catch (error) {
    runResult.reportPackage = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return runResult;
}

function createEdgesFromSteps(steps = []) {
  if (!Array.isArray(steps) || steps.length <= 1) {
    return [];
  }

  return steps.slice(0, -1).map((step, index) => ({
    id: `${step.id || `step-${index}`}-${steps[index + 1]?.id || `step-${index + 1}`}`,
    source: step.id,
    target: steps[index + 1]?.id,
  })).filter((edge) => edge.source && edge.target);
}

function normalizeCaseEdge(edge) {
  if (!edge || typeof edge !== 'object') {
    return null;
  }

  const source = String(edge.source || edge.from || '').trim();
  const target = String(edge.target || edge.to || '').trim();
  if (!source || !target) {
    return null;
  }

  return {
    ...edge,
    id: edge.id || `${source}-${target}`,
    source,
    target,
  };
}

function normalizeCaseEdges(edges = [], testCase = null) {
  if (!Array.isArray(edges)) {
    return [];
  }

  const stepIds = new Set((testCase?.steps || []).map((step) => String(step?.id || '')).filter(Boolean));
  const normalized = edges
    .map(normalizeCaseEdge)
    .filter((edge) => edge && (!stepIds.size || (stepIds.has(edge.source) && stepIds.has(edge.target))));
  if (!testCase?.steps?.length || normalized.length < 2) return normalized;
  const outgoing = new Map();
  normalized.forEach((edge) => outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]));
  const rank = new Map();
  const start = testCase.steps.find((step) => step?.type === 'start')?.id || testCase.steps[0]?.id;
  const queue = start ? [start] : [];
  while (queue.length) {
    const id = String(queue.shift());
    if (rank.has(id)) continue;
    rank.set(id, rank.size);
    (outgoing.get(id) || []).forEach((target) => queue.push(target));
  }
  testCase.steps.forEach((step, index) => { if (!rank.has(step.id)) rank.set(step.id, rank.size + index); });
  return normalized.slice().sort((left, right) => (
    (rank.get(left.source) || 0) - (rank.get(right.source) || 0)
    || (rank.get(left.target) || 0) - (rank.get(right.target) || 0)
    || String(left.id || '').localeCompare(String(right.id || ''))
  ));
}

function resolveCaseEdgesForCli(testCase, options = {}) {
  if (Array.isArray(options.edges)) {
    return normalizeCaseEdges(options.edges, testCase);
  }

  const caseId = String(testCase?.id || '');
  if (caseId && options.caseEdges && typeof options.caseEdges === 'object' && Array.isArray(options.caseEdges[caseId])) {
    return normalizeCaseEdges(options.caseEdges[caseId], testCase);
  }

  if (Array.isArray(testCase?.edges)) {
    return normalizeCaseEdges(testCase.edges, testCase);
  }

  if (Array.isArray(options.fallbackEdges)) {
    return normalizeCaseEdges(options.fallbackEdges, testCase);
  }

  return createEdgesFromSteps(testCase?.steps || []);
}

function createTaskReportFromRun(testCase, runResult) {
  const results = Array.isArray(runResult?.results) ? runResult.results : [];
  const startedAt = results[0]?.startedAt || new Date().toISOString();
  const endedAt = results.slice(-1)[0]?.endedAt || results.slice(-1)[0]?.completedAt || new Date().toISOString();
  const taskId = `cli-${sanitizeFilePart(testCase.id || testCase.name || 'case')}-${Date.now()}`;
  const status = getRunStatus(runResult);
  const edges = Array.isArray(runResult?.edges) && runResult.edges.length
    ? resolveCaseEdgesForCli(testCase, { edges: runResult.edges })
    : resolveCaseEdgesForCli(testCase);

  return {
    id: taskId,
    name: `CLI 执行 · ${testCase.name || testCase.id || '未命名用例'}`,
    folderId: '',
    caseIds: [testCase.id],
    status,
    completed: 1,
    total: 1,
    createdAt: startedAt,
    finishedAt: endedAt,
    readonly: true,
    imported: true,
    performanceOptions: runResult?.performanceOptions,
    performanceReports: runResult?.performanceReports,
    startOptions: runResult?.startOptions,
    devices: runResult?.devices,
    cases: [
      {
        caseId: testCase.id,
        caseName: testCase.name || testCase.id || '未命名用例',
        caseSnapshot: testCase,
        edges,
        status,
        completed: results.length,
        total: Array.isArray(testCase.steps) ? testCase.steps.length : results.length,
        startedAt,
        endedAt,
        results,
        artifacts: runResult?.artifacts || null,
        error: runResult?.success ? undefined : runResult?.error || 'CLI 执行失败',
      },
    ],
  };
}

function getDefaultReportOutputPath(testCase, runResult) {
  const runDir = runResult?.artifacts?.runDir;
  const baseName = `solopi-desktop-report-${sanitizeFilePart(testCase.name || testCase.id || 'case')}-${createTimestamp()}.glassreport`;

  if (runDir && fs.existsSync(runDir)) {
    return path.join(runDir, baseName);
  }

  return path.resolve(process.cwd(), baseName);
}

function createReportPackage(testCase, runResult, outputPath = '') {
  const task = createTaskReportFromRun(testCase, runResult);
  const resolvedOutputPath = path.resolve(outputPath || getDefaultReportOutputPath(testCase, runResult));
  const packagePath = resolvedOutputPath.endsWith('.glassreport')
    ? resolvedOutputPath
    : `${resolvedOutputPath}.glassreport`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glassreport-cli-export-'));
  const packageRoot = path.join(tempRoot, 'package');

  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(path.dirname(packagePath), { recursive: true });

  const packagedTask = {
    ...task,
    performanceReports: packagePerformanceReports(task.performanceReports, packageRoot),
    cases: (task.cases || []).map((caseRecord) => ({
      ...caseRecord,
      artifacts: copyReportCaseArtifacts(task.id, caseRecord, packageRoot),
    })),
  };

  const manifest = {
    schemaVersion: 'glassbox.report-package.v1',
    app: 'GlassBox',
    exportedAt: new Date().toISOString(),
    taskId: task.id,
    taskName: task.name,
    source: 'glassbox-cli',
  };

  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(packageRoot, 'report.json'), JSON.stringify({ task: packagedTask }, null, 2));

  if (fs.existsSync(packagePath)) {
    fs.rmSync(packagePath, { force: true });
  }

  const zipResult = spawnSync('/usr/bin/zip', ['-qry', packagePath, '.'], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });

  if (zipResult.status !== 0) {
    throw new Error(zipResult.stderr || zipResult.error?.message || '报告包压缩失败');
  }

  return {
    success: true,
    path: packagePath,
    taskId: task.id,
    taskName: task.name,
    caseCount: packagedTask.cases?.length || 0,
  };
}

function createReportPackageFromTask(task, outputPath = '') {
  const fallbackCase = task?.cases?.[0]?.caseSnapshot || { id: task?.id || 'task', name: task?.name || 'CLI 自动化任务' };
  const resolvedOutputPath = path.resolve(outputPath || getDefaultReportOutputPath(fallbackCase, task?.cases?.[0] || {}));
  const packagePath = resolvedOutputPath.endsWith('.glassreport')
    ? resolvedOutputPath
    : `${resolvedOutputPath}.glassreport`;
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glassreport-cli-export-'));
  const packageRoot = path.join(tempRoot, 'package');
  const taskId = task?.id || `cli-task-${Date.now()}`;

  fs.mkdirSync(packageRoot, { recursive: true });
  fs.mkdirSync(path.dirname(packagePath), { recursive: true });

  const packagedTask = {
    ...task,
    performanceReports: packagePerformanceReports(task.performanceReports, packageRoot),
    id: taskId,
    cases: (task?.cases || []).map((caseRecord) => ({
      ...caseRecord,
      artifacts: copyReportCaseArtifacts(taskId, caseRecord, packageRoot),
    })),
  };

  const manifest = {
    schemaVersion: 'glassbox.report-package.v1',
    app: 'GlassBox',
    exportedAt: new Date().toISOString(),
    taskId: packagedTask.id,
    taskName: packagedTask.name,
    source: 'glassbox-cli',
  };

  fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
  fs.writeFileSync(path.join(packageRoot, 'report.json'), JSON.stringify({ task: packagedTask }, null, 2));

  if (fs.existsSync(packagePath)) {
    fs.rmSync(packagePath, { force: true });
  }

  const zipResult = spawnSync('/usr/bin/zip', ['-qry', packagePath, '.'], {
    cwd: packageRoot,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 20,
  });

  fs.rmSync(tempRoot, { recursive: true, force: true });

  if (zipResult.status !== 0) {
    throw new Error(zipResult.stderr || zipResult.error?.message || '报告包压缩失败');
  }

  return {
    success: true,
    path: packagePath,
    taskId: packagedTask.id,
    taskName: packagedTask.name,
    caseCount: packagedTask.cases?.length || 0,
  };
}

function attachCliTaskReportPackage(taskResult, outputPath = '', disableReport = false) {
  if (disableReport || !taskResult?.task) {
    return taskResult;
  }

  try {
    taskResult.reportPackage = createReportPackageFromTask(taskResult.task, outputPath);
  } catch (error) {
    taskResult.reportPackage = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }

  return taskResult;
}

function attachCliValidationDiagnosticReport(result, outputPath = '', phase = 'validation') {
  if (!outputPath) return result;
  try {
    const absolutePath = path.resolve(outputPath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    const diagnosticReport = {
      schemaVersion: 'glassbox.validation-report.v1',
      phase,
      success: false,
      taskId: null,
      task: null,
      reportPackage: null,
      validationSummary: result.validationSummary,
      validationErrors: result.validationErrors || [],
      validationWarnings: result.validationWarnings || [],
      diagnostics: result.diagnostics || null,
    };
    fs.writeFileSync(absolutePath, JSON.stringify(diagnosticReport, null, 2));
    result.reportPackage = {
      success: true,
      path: absolutePath,
      phase,
      taskId: null,
    };
  } catch (error) {
    result.reportPackage = {
      success: false,
      phase,
      taskId: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return result;
}

function createCliErrorDiagnosticsForCli(message, options = {}) {
  return {
    schemaVersion: 'glassbox.error.v1',
    code: options.errorCode || 'CLI_TASK_FAILED',
    type: options.errorType || 'cli',
    message: String(message || 'CLI 任务执行失败'),
    recoveryActions: Array.isArray(options.recoveryActions) ? options.recoveryActions : [],
    details: options.details && typeof options.details === 'object' ? options.details : {},
  };
}

function createCliCommandFailurePayload(message, options = {}) {
  const diagnostics = createCliErrorDiagnosticsForCli(message, options);
  return {
    success: false,
    error: diagnostics.message,
    errorCode: diagnostics.code,
    errorType: diagnostics.type,
    recoveryActions: diagnostics.recoveryActions,
    diagnostics,
    ...(options.extra && typeof options.extra === 'object' ? options.extra : {}),
  };
}

function createCliFailureTaskResult(error, cases = [], options = {}) {
  const now = new Date().toISOString();
  const taskId = options.taskId || `cli-task-failure-${Date.now()}`;
  const diagnostics = createCliErrorDiagnosticsForCli(error, options);
  const taskCases = cases.length
    ? cases.map((testCase) => ({
      caseId: testCase.id,
      caseName: testCase.name || testCase.id || '未命名用例',
      caseSnapshot: testCase,
      edges: createEdgesFromSteps(testCase.steps || []),
      status: 'failed',
      completed: 1,
      total: Array.isArray(testCase.steps) ? testCase.steps.length : 1,
      startedAt: now,
      endedAt: now,
      results: [
        {
          stepId: options.stepId || 'cli-failure',
          stepName: options.stepName || 'CLI 任务执行',
          status: 'failed',
          startedAt: now,
          completedAt: now,
          endedAt: now,
          error: String(error || 'CLI 任务执行失败'),
          errorCode: diagnostics.code,
          errorType: diagnostics.type,
          recoveryActions: diagnostics.recoveryActions,
        },
      ],
      error: String(error || 'CLI 任务执行失败'),
      errorCode: diagnostics.code,
      errorType: diagnostics.type,
      recoveryActions: diagnostics.recoveryActions,
    }))
    : [{
      caseId: 'cli-task-failure',
      caseName: 'CLI 任务执行失败',
      caseSnapshot: createSyntheticCliCase('CLI 任务执行失败'),
      edges: [],
      status: 'failed',
      completed: 1,
      total: 1,
      startedAt: now,
      endedAt: now,
      results: [
        {
          stepId: options.stepId || 'cli-failure',
          stepName: options.stepName || 'CLI 任务执行',
          status: 'failed',
          startedAt: now,
          completedAt: now,
          endedAt: now,
          error: String(error || 'CLI 任务执行失败'),
          errorCode: diagnostics.code,
          errorType: diagnostics.type,
          recoveryActions: diagnostics.recoveryActions,
        },
      ],
      error: String(error || 'CLI 任务执行失败'),
      errorCode: diagnostics.code,
      errorType: diagnostics.type,
      recoveryActions: diagnostics.recoveryActions,
    }];

  return {
    success: false,
    error: String(error || 'CLI 任务执行失败'),
    errorCode: diagnostics.code,
    errorType: diagnostics.type,
    recoveryActions: diagnostics.recoveryActions,
    diagnostics,
    task: {
      id: taskId,
      name: options.taskName || 'CLI 自动化任务失败',
      status: 'failed',
      completed: taskCases.length,
      total: taskCases.length,
      createdAt: now,
      finishedAt: now,
      readonly: true,
      imported: true,
      devices: options.devices,
      summary: {
        successCount: 0,
        failedCount: taskCases.length,
        stoppedCount: 0,
        caseCount: taskCases.length,
      },
      cases: taskCases,
      error: String(error || 'CLI 任务执行失败'),
      errorCode: diagnostics.code,
      errorType: diagnostics.type,
      recoveryActions: diagnostics.recoveryActions,
      diagnostics,
    },
  };
}

function parseRunResult(stdout) {
  const trimmed = String(stdout || '').trim();
  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch (_error) {
    return null;
  }
}

function createCliPayload(testCase, options = {}) {
  const { state } = readWorkflowStateForCli();
  const { config } = readEnvironmentConfigForCli();
  const llmProviders = Array.isArray(state?.llmProviders) ? state.llmProviders : [];
  const selectedLlmProviderId = String(state?.selectedLlmProviderId || '');
  const ttsProvider = config?.ttsProvider || null;
  const stateComponents = Array.isArray(state?.components) ? state.components : [];
  const executableCase = mergeComponentsForExecutableCase(testCase, stateComponents);
  const caseEdges = options.caseEdges || (testCase?.id && Array.isArray(state?.caseEdges?.[testCase.id]) ? state.caseEdges : undefined);
  const edges = resolveCaseEdgesForCli(executableCase, {
    edges: options.edges,
    caseEdges,
  });
  const runtimePhonePackage = resolveRunPackageForCli(executableCase, 'phone', options).packageName;
  const runtimeGlassesPackage = resolveRunPackageForCli(executableCase, 'glasses', options).packageName;

  return {
    testCase: {
      ...executableCase,
      defaults: {
        ...(executableCase.defaults || {}),
        phoneSerial: options.phoneSerial ?? executableCase.defaults?.phoneSerial ?? '',
        glassesSerial: options.glassesSerial ?? executableCase.defaults?.glassesSerial ?? '',
        phonePackage: runtimePhonePackage,
        glassesPackage: runtimeGlassesPackage,
      },
    },
    components: createMergedComponentsForCli(stateComponents, executableCase.components),
    llmProviders,
    selectedLlmProviderId,
    ttsProvider,
    requestId: `cli-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    disableScreenMirror: Boolean(options.disableScreenMirror),
    devices: executionDevicesForCli(options.devices, [executableCase], options),
    runtimeEnvironment: options.runtimeEnvironment,
    edges,
    caseEdges,
    startConfigOverride: options.startOptions && typeof options.startOptions === 'object'
      ? options.startOptions
      : undefined,
  };
}

function createCliTaskPayload(cases, options = {}) {
  const { state } = readWorkflowStateForCli();
  const { config } = readEnvironmentConfigForCli();
  const llmProviders = Array.isArray(state?.llmProviders) ? state.llmProviders : [];
  const selectedLlmProviderId = String(state?.selectedLlmProviderId || '');
  const ttsProvider = config?.ttsProvider || null;
  const stateComponents = Array.isArray(state?.components) ? state.components : [];
  const normalizedCases = cases.map((testCase) => {
    const executableCase = mergeComponentsForExecutableCase(testCase, stateComponents);
    return {
      ...executableCase,
      defaults: {
        ...(executableCase.defaults || {}),
        phoneSerial: options.phoneSerial ?? executableCase.defaults?.phoneSerial ?? '',
        glassesSerial: options.glassesSerial ?? executableCase.defaults?.glassesSerial ?? '',
        phonePackage: resolveRunPackageForCli(executableCase, 'phone', options).packageName,
        glassesPackage: resolveRunPackageForCli(executableCase, 'glasses', options).packageName,
      },
    };
  });

  return {
    taskId: options.taskId,
    executionProvenance: process.env.LENSWIPER_EXECUTION_PROVENANCE ? JSON.parse(process.env.LENSWIPER_EXECUTION_PROVENANCE) : undefined,
    sourceRevision: options.sourceRevision,
    taskName: process.env.LENSWIPER_DEV_RUN === '1' ? `[DEV] ${options.taskName || options.taskId || 'Development task'}` : options.taskName,
    stress: options.stress,
    folderId: options.folderId || '',
    cases: normalizedCases,
    components: createMergedComponentsForCli(
      stateComponents,
      ...normalizedCases.map((testCase) => testCase.components)
    ),
    assetBaseDir: options.assetBaseDir || normalizedCases[0]?.assetBaseDir || '',
    caseEdges: options.caseEdges || {},
    nodePositions: options.nodePositions || {},
    validationSummary: options.validationSummary,
    llmProviders,
    selectedLlmProviderId,
    ttsProvider,
    requestId: `cli-task-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    disableScreenMirror: Boolean(options.disableScreenMirror),
    devices: executionDevicesForCli(options.devices, cases, options),
    runtimeEnvironment: options.runtimeEnvironment,
    performanceOptions: options.performanceOptions,
    startConfigOverride: options.startOptions && typeof options.startOptions === 'object'
      ? options.startOptions
      : undefined,
  };
}

function getSourceRootForCli() {
  const candidates = [
    path.resolve(CLI_SCRIPT_DIR, '..'),
    path.resolve(CLI_SCRIPT_DIR, '..', '..'),
    path.resolve(CLI_SCRIPT_DIR, '..', 'app.asar'),
    process.cwd(),
  ];

  for (const candidate of candidates) {
    if (
      candidate
      && fs.existsSync(path.join(candidate, 'electron', 'main.js'))
      && fs.existsSync(path.join(candidate, 'package.json'))
    ) {
      return candidate;
    }
  }

  return '';
}

function getElectronMainPathForCli() {
  const sourceRoot = getSourceRootForCli();
  const mainPath = sourceRoot ? path.join(sourceRoot, 'electron', 'main.js') : '';
  return mainPath && fs.existsSync(mainPath) ? mainPath : '';
}

function getLinuxPackagedBinaryForCli() {
  if (process.platform !== 'linux') return '';
  const resources = path.resolve(CLI_SCRIPT_DIR, '..');
  const binary = path.resolve(resources, '..', 'solopi-desktop');
  return fs.existsSync(path.join(resources, 'app.asar')) && fs.existsSync(binary) ? binary : '';
}

function getElectronBinary() {
  const linuxPackaged = getLinuxPackagedBinaryForCli();
  if (linuxPackaged) return linuxPackaged;
  const binaryName = process.platform === 'win32' ? 'electron.cmd' : 'electron';
  const sourceRoot = getSourceRootForCli();
  return sourceRoot
    ? path.join(sourceRoot, 'node_modules', '.bin', binaryName)
    : path.resolve(process.cwd(), 'node_modules', '.bin', binaryName);
}

function runCaseWithElectron(testCase, options = {}) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbox-cli-run-'));
  const payloadPath = path.join(tempDir, 'payload.json');
  fs.writeFileSync(payloadPath, JSON.stringify(createCliPayload(testCase, options), null, 2));

  const electronBin = getElectronBinary();
  const electronMainPath = getElectronMainPathForCli();
  if (!fs.existsSync(electronBin)) {
    return {
      status: 2,
      stdout: JSON.stringify({
        success: false,
        results: [],
        error: `未找到 Electron 可执行文件：${electronBin}`,
      }, null, 2),
      stderr: '',
    };
  }
  if (!electronMainPath) {
    return {
      status: 2,
      stdout: JSON.stringify({
        success: false,
        results: [],
        error: `未找到 solopi-desktop Electron main.js。CLI 脚本：${CLI_SCRIPT_PATH}`,
      }, null, 2),
      stderr: '',
    };
  }

  const result = spawnSync(electronBin, [
    electronMainPath,
    '--glassbox-cli-run-payload',
    payloadPath,
  ], {
    cwd: getSourceRootForCli() || process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      GLASSBOX_CLI: '1',
    },
    maxBuffer: 1024 * 1024 * 20,
  });

  return {
    status: result.status ?? 2,
    stdout: result.stdout || '',
    stderr: result.stderr || result.error?.message || '',
  };
}

function getHeadlessElectronLaunchForCli() {
  const launch = getElectronLaunchForCli();
  return launch ? {...launch,backgroundBackend:backgroundPolicy.backgroundBackend(),argsPrefix:backgroundPolicy.backgroundArguments(launch.argsPrefix)} : null;
}

function getElectronLaunchForCli() {
  const linuxPackaged = getLinuxPackagedBinaryForCli();
  if (linuxPackaged) return {command:linuxPackaged,argsPrefix:['--glassbox-background'],packaged:true,viaOpen:false,cwd:process.cwd()};
  const packagedAppPath = process.env.LENSWIPER_DEV_RUN === '1' ? '' : getCurrentPackagedAppPathForCli();
  if (process.platform === 'darwin' && packagedAppPath) {
    const packagedExecutable = ['solopi-desktop', 'LensWiper', 'Glass Box']
      .map((name) => path.join(packagedAppPath, 'Contents', 'MacOS', name))
      .find((candidate) => fs.existsSync(candidate)) || path.join(packagedAppPath, 'Contents', 'MacOS', 'solopi-desktop');
    if (!fs.existsSync(packagedExecutable)) {
      return null;
    }
    return {
      command: packagedExecutable,
      argsPrefix: ['--glassbox-background'],
      packaged: true,
      viaOpen: false,
      appPath: packagedAppPath,
      cwd: process.cwd(),
    };
  }

  const packagedExecPath = String(process.execPath || '');
  if (packagedExecPath.includes('.app/Contents/MacOS/') && fs.existsSync(packagedExecPath)) {
    return null;
  }

  const sourceRoot = getSourceRootForCli();
  const electronMainPath = getElectronMainPathForCli();
  const electronAppBinary = path.resolve(
    sourceRoot || process.cwd(),
    'node_modules',
    'electron',
    'dist',
    'Electron.app',
    'Contents',
    'MacOS',
    'Electron'
  );
  if (fs.existsSync(electronAppBinary)) {
    return {
      command: electronAppBinary,
      argsPrefix: electronMainPath ? [electronMainPath] : [],
      packaged: false,
      cwd: sourceRoot || process.cwd(),
    };
  }

  const electronBin = getElectronBinary();
  if (fs.existsSync(electronBin)) {
    return {
      command: electronBin,
      argsPrefix: electronMainPath ? [electronMainPath] : [],
      packaged: false,
      cwd: sourceRoot || process.cwd(),
    };
  }

  return null;
}

function createHeadlessElectronEnvForCli() {
  const env = {
    ...process.env,
    GLASSBOX_CLI: '1',
    GLASSBOX_BACKGROUND: '1',
  };
  delete env.ELECTRON_RUN_AS_NODE;
  return env;
}

function createSubmittedTaskSnapshotForCli(payload) {
  const cases = Array.isArray(payload?.cases) ? payload.cases : [];
  return {
    id: payload.taskId,
    name: payload.taskName || payload.taskId || 'CLI 自动化任务',
    folderId: payload.folderId || '',
    caseIds: cases.map((testCase) => testCase?.id).filter(Boolean),
    status: cases.length ? 'submitted' : 'failed',
    completed: 0,
    total: cases.length,
    createdAt: payload.createdAt || new Date().toISOString(),
    readonly: true,
    imported: true,
    startOptions: payload.startConfigOverride || undefined,
    devices: payload.devices,
    runtimeEnvironment: payload.runtimeEnvironment,
    performanceOptions: payload.performanceOptions,
    summary: {
      successCount: 0,
      failedCount: 0,
      stoppedCount: 0,
      caseCount: cases.length,
    },
  };
}

function waitForSubmittedTaskVisibleForCli(taskId, timeoutMs = Number(process.env.GLASSBOX_CLI_HEADLESS_SUBMIT_VISIBLE_TIMEOUT_MS || 5000)) {
  const startedAt = Date.now();
  const detailPath = getWorkflowReportDetailPathForCli(taskId);

  while (Date.now() - startedAt < timeoutMs) {
    if (detailPath && fs.existsSync(detailPath)) {
      return {
        visible: true,
        detailPath,
      };
    }

    const { state } = readWorkflowStateForCli();
    const tasks = Array.isArray(state?.automationTasks) ? state.automationTasks : [];
    if (tasks.some((item) => String(item?.id || '') === String(taskId || ''))) {
      return {
        visible: true,
        detailPath,
      };
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }

  return {
    visible: false,
    detailPath,
  };
}

function createHeadlessTaskPayloadSummaryForCli(payload = {}) {
  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  return {
    taskId: payload.taskId || '',
    taskName: payload.taskName || '',
    caseCount: cases.length,
    caseIds: cases.map((testCase) => testCase?.id).filter(Boolean),
    startOptions: payload.startConfigOverride || {},
    performanceOptions: payload.performanceOptions || {},
    runtimeEnvironment: payload.runtimeEnvironment ? {
      source: payload.runtimeEnvironment.source || '',
      requestedEnvironment: payload.runtimeEnvironment.requestedEnvironment || '',
      environment: payload.runtimeEnvironment.environment || '',
      serial: payload.runtimeEnvironment.serial || '',
      packageName: payload.runtimeEnvironment.packageName || '',
    } : undefined,
  };
}

function createHeadlessTaskRecoveryActionsForCli() {
  return [
    '检查 runnerStderrPath / runnerStdoutPath 中 Electron 启动错误。',
    '确认 ackPath 所在目录可写，payloadPath 文件仍存在且 JSON 可读。',
    '如果使用打包 App，确认 CLI 与 UI 指向同一个已安装 solopi-desktop，并由单实例后台 Broker 接收请求。',
    '复跑同一命令；若仍超时，把 taskId、ackPath、payloadPath、runner 日志交给 solopi-desktop 开发排查。',
  ];
}

function createHeadlessTaskDiagnosticsForCli(payload = {}, context = {}) {
  return {
    taskId: payload.taskId || '',
    caseCount: Array.isArray(payload.cases) ? payload.cases.length : 0,
    ackPath: context.ackPath || '',
    payloadPath: context.payloadPath || '',
    runnerCommand: context.runnerCommand || context.launch?.command || '',
    runnerArgs: context.runnerArgs || [],
    runnerPid: context.runnerPid || 0,
    timeoutMs: context.timeoutMs || Number(process.env.GLASSBOX_CLI_HEADLESS_ACK_TIMEOUT_MS || 15000),
    route: context.route || (context.wait ? '/workflow/run-task' : '/workflow/submit-task'),
    submitRoute: context.submitRoute || '/workflow/submit-task',
    tempDir: context.tempDir || '',
    runnerStdoutPath: context.runnerStdoutPath || '',
    runnerStderrPath: context.runnerStderrPath || '',
    brokerLogPath: context.brokerLogPath || '',
    launch: context.launch ? {
      command: context.launch.command,
      packaged: Boolean(context.launch.packaged),
      backgroundBackend: context.launch.backgroundBackend || 'desktop',
      viaOpen: Boolean(context.launch.viaOpen),
      appPath: context.launch.appPath || '',
      cwd: context.launch.cwd || '',
    } : undefined,
    payloadSummary: createHeadlessTaskPayloadSummaryForCli(payload),
    recoveryActions: createHeadlessTaskRecoveryActionsForCli(),
  };
}

function readHeadlessDiagnosticTailForCli(filePath, maxLength = 8000) {
  try {
    const content = String(fs.readFileSync(filePath, 'utf8') || '');
    return content.length > maxLength ? content.slice(-maxLength) : content;
  } catch (_error) {
    return '';
  }
}

function collectHeadlessAckFailureEvidenceForCli(diagnostics = {}) {
  const runnerPid = Number(diagnostics.runnerPid || 0);
  const processProbe = runnerPid > 0 ? probeProcessLivenessForCli(runnerPid) : null;
  return {
    runnerStdoutTail: readHeadlessDiagnosticTailForCli(diagnostics.runnerStdoutPath),
    runnerStderrTail: readHeadlessDiagnosticTailForCli(diagnostics.runnerStderrPath),
    brokerLogTail: readHeadlessDiagnosticTailForCli(diagnostics.brokerLogPath),
    submissionProcess: processProbe ? {
      pid: runnerPid,
      alive: processProbe.alive,
      liveness: processProbe.liveness,
      errorCode: processProbe.errorCode || '',
      error: processProbe.error || '',
    } : null,
  };
}

function createHeadlessTaskAckTimeoutError(message, diagnostics) {
  const error = new Error(message);
  error.code = 'GLASSBOX_HEADLESS_ACK_TIMEOUT';
  error.diagnostics = diagnostics;
  return error;
}

function waitForHeadlessTaskAckForCli(ackPath, options = {}) {
  const timeoutMs = Number(options.timeoutMs || process.env.GLASSBOX_CLI_HEADLESS_ACK_TIMEOUT_MS || 15000);
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (ackPath && fs.existsSync(ackPath)) {
      const ack = JSON.parse(fs.readFileSync(ackPath, 'utf8'));
      fs.rmSync(ackPath, { force: true });
      return ack;
    }

    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
  }

  const diagnostics = {
    ...(options.diagnostics || {}),
    timeoutMs,
    ackPath,
  };
  Object.assign(diagnostics, collectHeadlessAckFailureEvidenceForCli(diagnostics));
  throw createHeadlessTaskAckTimeoutError(
    `Headless solopi-desktop runner did not acknowledge task submission within ${timeoutMs}ms: ${ackPath}`,
    diagnostics
  );
}

function runTaskWithHeadlessRunner(payload, options = {}) {
  if(process.env.LENSWIPER_DEV_RUN==='1' && !getDevelopmentWorkspace(getGlassBoxCliDataDir()))throw Error('开发执行必须先prepare建立独立临时工作区，不能使用正式数据目录');
  assertTaskVisibility(getGlassBoxCliDataDir());
  const launch = options.launchOverride || getHeadlessElectronLaunchForCli();
  if (!launch) {
    throw new Error(`未找到可用的 headless solopi-desktop runner：${getElectronBinary()}；CLI 脚本：${CLI_SCRIPT_PATH}`);
  }
  if (!launch.packaged && !launch.argsPrefix.length) {
    throw new Error(`未找到 solopi-desktop Electron main.js，无法从当前目录自举 headless runner。CLI 脚本：${CLI_SCRIPT_PATH}`);
  }
  const runRoot = path.join(getGlassBoxCliDataDir(), 'cli-task-runners');
  fs.mkdirSync(runRoot, { recursive: true });
  fs.writeFileSync(path.join(runRoot, '.metadata_never_index'), '');
  const tempDir = fs.mkdtempSync(path.join(runRoot, 'submit-'));
  const payloadPath = path.join(tempDir, 'payload.json');
  const ackPath = path.join(tempDir, 'ack.json');
  const runnerStdoutPath = path.join(tempDir, 'runner.stdout.log');
  const runnerStderrPath = path.join(tempDir, 'runner.stderr.log');
  const brokerLogPath = path.join(tempDir, 'broker.log');
  const runnerPayload = {
    ...payload,
    __glassboxCliDataDir: getGlassBoxCliDataDir(),
    __headlessSubmitOnly: true,
    __headlessAckPath: ackPath,
    __headlessBrokerLogPath: brokerLogPath,
  };
  fs.writeFileSync(payloadPath, JSON.stringify(runnerPayload, null, 2));

  const args = [
    ...launch.argsPrefix,
    '--glassbox-cli-run-task-payload',
    payloadPath,
    '--glassbox-cli-data-dir',
    getGlassBoxCliDataDir(),
  ];
  const env = createHeadlessElectronEnvForCli();
  const diagnostics = createHeadlessTaskDiagnosticsForCli(payload, {
    tempDir,
    payloadPath,
    ackPath,
    runnerCommand: launch.command,
    runnerArgs: args,
    runnerStdoutPath,
    runnerStderrPath,
    brokerLogPath,
    launch,
    wait: options.wait,
  });

  const stdoutFd = fs.openSync(runnerStdoutPath, 'a');
  const stderrFd = fs.openSync(runnerStderrPath, 'a');
  const child = spawn(launch.command, args, {
    cwd: launch.cwd || process.cwd(),
    detached: true,
    stdio: ['ignore', stdoutFd, stderrFd],
    env,
  });
  fs.closeSync(stdoutFd);
  fs.closeSync(stderrFd);
  child.unref();
  diagnostics.runnerPid = child.pid || 0;
  const ack = waitForHeadlessTaskAckForCli(ackPath, { diagnostics });
  if (!ack.success) {
    // A rejected submission is not a task: do not publish metadata, synthesize
    // a submitted snapshot, or wait for a task that was never registered.
    return {
      status: 1,
      stdout: JSON.stringify({ ...ack, success: false, submitted: false, task: null, diagnostics }, null, 2),
      stderr: '', runner: launch, diagnostics,
    };
  }
  const brokerPid = Number(ack.pid || child.pid || 0);
  diagnostics.runnerPid = brokerPid;
  persistTaskRunnerMetadataForCli(payload.taskId, {
    runnerPid: brokerPid,
    submissionPid: child.pid || 0,
    runnerCommand: launch.command,
    runnerArgs: args,
    runnerCwd: launch.cwd || process.cwd(),
    packaged: Boolean(launch.packaged),
    appPath: launch.appPath || '',
    viaOpen: Boolean(launch.viaOpen),
    payloadPath,
    ackPath,
    runnerStdoutPath,
    runnerStderrPath,
    brokerLogPath,
    tempDir,
    createdAt: payload.createdAt || new Date().toISOString(),
    taskName: payload.taskName || '',
    caseCount: Array.isArray(payload.cases) ? payload.cases.length : 0,
    broker: true,
  });
  const visibility = waitForSubmittedTaskVisibleForCli(payload.taskId);
  const success = Boolean(ack.success && visibility.visible);
  const submission = {
    type: 'headless',
    pid: brokerPid,
    submissionPid: child.pid || 0,
    command: launch.command,
    packaged: launch.packaged,
    appPath: launch.appPath || '',
    viaOpen: Boolean(launch.viaOpen),
    taskVisible: visibility.visible,
    detailPath: visibility.detailPath,
    ackPath,
    payloadPath,
    runnerStdoutPath,
    runnerStderrPath,
    brokerLogPath,
  };

  return {
    status: success ? 0 : 1,
    stdout: JSON.stringify({
      ...ack,
      success,
      submitted: success ? ack.submitted : false,
      taskId: payload.taskId,
      task: ack.task || createSubmittedTaskSnapshotForCli(payload),
      devices: ack.devices || payload.devices,
      reservedDeviceSerials: ack.reservedDeviceSerials || ack.task?.reservedDeviceSerials,
      error: success
        ? ack.error
        : ack.error || `Headless runner acknowledged task ${payload.taskId}, but the task was not visible to CLI queries within ${Number(process.env.GLASSBOX_CLI_HEADLESS_SUBMIT_VISIBLE_TIMEOUT_MS || 5000)}ms.`,
      submission,
      bridge: submission,
      diagnostics,
    }, null, 2),
    stderr: '',
    runner: launch,
    diagnostics,
  };
}

async function waitForHeadlessTaskCompletionForCli(taskId, options = {}) {
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;
  const pollIntervalMs = Math.max(100, Number(process.env.GLASSBOX_CLI_WAIT_POLL_INTERVAL_MS || 1000));
  const heartbeatIntervalMs = Math.max(pollIntervalMs, Number(process.env.GLASSBOX_CLI_HEARTBEAT_INTERVAL_MS || 5000));
  const timeoutMs = Math.max(0, Number(process.env.GLASSBOX_CLI_HEADLESS_TASK_TIMEOUT_MS || 0));
  const startedAt = Date.now();
  let lastHeartbeatAt = 0;

  while (true) {
    const detail = getTaskDetailPayloadForCli(taskId);
    const task = detail.task || null;
    const status = String(task?.status || detail.summary?.status || '').trim();
    const cases = Array.isArray(task?.cases) ? task.cases : [];
    const currentCase = cases.find((item) => ['running', 'submitted'].includes(String(item?.status || '')));
    const now = Date.now();

    if (detail.success && isTerminalTaskStatusForCli(task || status)) {
      onProgress?.({
        stage: 'task_finished',
        taskId,
        status,
        currentCaseName: '',
        completed: detail.summary?.completed ?? task?.completed ?? 0,
        total: detail.summary?.total ?? task?.total ?? cases.length,
        elapsedMs: now - startedAt,
        message: `Task reached terminal status: ${status}.`,
      });
      return {
        ...detail,
        success: status === 'success',
        taskId,
        status,
      };
    }

    if (now - lastHeartbeatAt >= heartbeatIntervalMs) {
      lastHeartbeatAt = now;
      onProgress?.({
        stage: 'task_heartbeat',
        taskId,
        status: status || 'submitted',
        currentCaseName: task?.currentCaseName || currentCase?.caseName || '',
        completed: detail.summary?.completed ?? task?.completed ?? 0,
        total: detail.summary?.total ?? task?.total ?? cases.length,
        elapsedMs: now - startedAt,
        message: detail.success
          ? 'Task is running; waiting for terminal report.'
          : 'Task was acknowledged; waiting for persisted task detail.',
      });
    }

    if (timeoutMs && now - startedAt >= timeoutMs) {
      const error = new Error(`Timed out waiting for task ${taskId} after ${timeoutMs}ms.`);
      error.code = 'GLASSBOX_HEADLESS_TASK_TIMEOUT';
      throw error;
    }
    await sleep(pollIntervalMs);
  }
}

async function submitTaskWithHeadlessRunnerForCli(cases, options = {}) {
  const payload = createCliTaskPayload(cases, options);
  const route = options.wait ? '/workflow/run-task' : '/workflow/submit-task';
  const onProgress = typeof options.onProgress === 'function' ? options.onProgress : null;

  onProgress?.({
    stage: 'task_request_prepared',
    taskId: payload.taskId,
    route,
    wait: Boolean(options.wait),
    caseCount: cases.length,
    message: options.wait
      ? 'Task request prepared; headless runner will keep the CLI attached until the task finishes.'
      : 'Task request prepared; starting headless runner for async submit.',
  });

  try {
    onProgress?.({
      stage: 'headless_runner_start',
      submissionType: 'headless',
      taskId: payload.taskId,
      route,
      wait: Boolean(options.wait),
      message: 'Starting solopi-desktop headless runner; desktop UI does not need to be running.',
    });
    const result = runTaskWithHeadlessRunner(payload, options);
    const parsed = parseRunResult(result.stdout) || {};
    onProgress?.({
      stage: 'headless_runner_submitted',
      submissionType: 'headless',
      taskId: payload.taskId,
      route,
      wait: Boolean(options.wait),
      runner: result.runner?.command || '',
      message: options.wait
        ? 'Headless runner finished and returned task result.'
        : 'Headless runner acknowledged submission; task is visible to CLI queries.',
    });
    if (options.wait && result.status === 0 && parsed.submitted !== false) {
      const terminal = await waitForHeadlessTaskCompletionForCli(payload.taskId, { onProgress });
      return {
        status: terminal.status === 'success' ? 0 : 1,
        stdout: JSON.stringify({
          ...terminal,
          submission: parsed.submission || parsed.bridge || {},
          bridge: parsed.bridge || parsed.submission || {},
        }, null, 2),
        stderr: result.stderr || '',
      };
    }
    return {
      status: result.status,
      stdout: JSON.stringify({
        ...parsed,
        submission: {
          ...(parsed.submission || parsed.bridge || {}),
          type: 'headless',
        },
        bridge: {
          ...(parsed.bridge || {}),
          type: 'headless',
        },
      }, null, 2),
      stderr: result.stderr || '',
    };
  } catch (error) {
    const diagnostics = error.diagnostics || {};
    onProgress?.({
      stage: 'headless_runner_failed',
      submissionType: 'headless',
      taskId: payload.taskId,
      route,
      error: error.message,
      message: 'Headless runner failed; task was not submitted.',
    });
    return {
      status: 2,
      stdout: JSON.stringify({
        success: false,
        taskId: payload.taskId,
        caseCount: Array.isArray(payload.cases) ? payload.cases.length : cases.length,
        task: null,
        ackPath: diagnostics.ackPath || '',
        payloadPath: diagnostics.payloadPath || '',
        runnerCommand: diagnostics.runnerCommand || '',
        runnerArgs: diagnostics.runnerArgs || [],
        runnerPid: diagnostics.runnerPid || 0,
        timeoutMs: diagnostics.timeoutMs || Number(process.env.GLASSBOX_CLI_HEADLESS_ACK_TIMEOUT_MS || 15000),
        route,
        submitRoute: diagnostics.submitRoute || '/workflow/submit-task',
        payloadSummary: diagnostics.payloadSummary || createHeadlessTaskPayloadSummaryForCli(payload),
        recoveryActions: diagnostics.recoveryActions || createHeadlessTaskRecoveryActionsForCli(),
        runnerStdoutPath: diagnostics.runnerStdoutPath || '',
        runnerStderrPath: diagnostics.runnerStderrPath || '',
        diagnostics,
        error: [
          'solopi-desktop headless runner 启动或提交失败，任务未提交。',
          'CLI 不要求 UI 桌面端预先启动，也不会走 file bridge。',
          `错误：${error.message}`,
        ].join('\n'),
      }, null, 2),
      stderr: '',
    };
  }
}

async function stopTaskViaControlChannel(taskId, options = {}) {
  const external = getVisibleTask(getGlassBoxCliDataDir(), taskId);
  if (external) {
    const env = { ...process.env, GLASSBOX_CLI_DATA_DIR: external.externalSource.dataDir, GLASSBOX_WORKFLOW_STATE_PATH: path.join(external.externalSource.dataDir, 'workflow-editor-state.json'), LENSWIPER_TASK_UI_DATA_DIR: getGlassBoxCliDataDir() };
    return spawnSync(process.execPath, [CLI_SCRIPT_PATH, 'tasks', 'stop', taskId, '--json', ...(options.force ? ['--force'] : [])], { env, encoding: 'utf8', timeout: 20000 });
  }
  const brokerResult = stopTaskWithBrokerForCli(taskId, options);
  if (brokerResult) {
    return brokerResult;
  }
  return stopTaskWithLocalFallbackForCli(taskId, options);
}

async function updateCaseWithBrokerForCli(command) {
  const create = command[1] === 'create';
  let caseId = create ? undefined : command[2];
  const file = getOption(command, '--file');
  const libraryId = getOption(command, '--library');
  const folderId = getOption(command, '--folder');
  if (!file || (create ? !libraryId : !caseId || caseId.startsWith('--'))) return { success: false, error: create ? 'Usage: cases create --file <case.json> --library <libraryId> [--folder <folderId>] [--dry-run] [--json]' : 'Usage: cases update <caseId> --file <case.json> [--dry-run] [--json]' };
  const launch = getHeadlessElectronLaunchForCli();
  if (!launch) return { success: false, error: 'solopi-desktop desktop runtime not found' };
  let tempDir;
  try {
    let document = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
    if (create && document?.cases) {
      if (!Array.isArray(document.cases) || document.cases.length !== 1) throw new Error('Create accepts exactly one case per file');
      const item = document.cases[0];
      document = { case: item, edges: document.caseEdges?.[item.id] ?? item.edges, nodePositions: document.nodePositions?.[item.id] };
    }
    const patch = document?.case || document;
    if (create) caseId = patch?.id;
    const { state } = readWorkflowStateForCli();
    const existing = state?.cases?.find((item) => item.id === caseId);
    if (create) {
      if (typeof caseId !== 'string' || !caseId.trim()) throw new Error('Case id is required');
      if (existing) throw new Error(`Case already exists: ${caseId}`);
    } else if (!existing) throw new Error(`Case not found: ${caseId}`);
    if (patch?.id !== caseId) throw new Error('JSON case id must match the requested caseId');
    const validation = validatePayload({ cases: [{ ...existing, ...patch }] }, { allowImportReviewDraft: true });
    if (!validation.success) return { success: false, error: 'Invalid case JSON', errors: validation.errors };
    // Transport only: the main process owns state writes and renderer refresh.
    const controlDir = path.join(getGlassBoxCliDataDir(), 'cli-control');
    fs.mkdirSync(controlDir, { recursive: true });
    tempDir = fs.mkdtempSync(path.join(controlDir, 'case-update-'));
    const payloadPath = path.join(tempDir, 'payload.json');
    const ackPath = path.join(tempDir, 'ack.json');
    fs.writeFileSync(payloadPath, JSON.stringify({ action: create ? 'create-case' : 'update-case', caseId, document, libraryId, folderId, preserveSourceSamples: hasFlag(command, '--preserve-source-samples'), dryRun: hasFlag(command, '--dry-run'), dataDir: getGlassBoxCliDataDir(), ackPath }));
    const child = spawn(launch.command, [...launch.argsPrefix, '--glassbox-cli-control-payload', payloadPath, '--glassbox-cli-data-dir', getGlassBoxCliDataDir()], {
      cwd: launch.cwd || process.cwd(), env: createHeadlessElectronEnvForCli(), stdio: 'ignore', detached: true,
    });
    let launchError;
    child.on('error', (error) => { launchError = error; });
    child.unref();
    const deadline = Date.now() + 20000;
    while (Date.now() < deadline) {
      if (launchError) throw launchError;
      if (fs.existsSync(ackPath)) return JSON.parse(fs.readFileSync(ackPath, 'utf8'));
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return { success: false, error: 'Case update acknowledgement timed out; read cases show before retrying. The running app must support cases update.' };
  } catch (error) {
    return { success: false, error: error.message };
  } finally {
    if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function importReportWithBrokerForCli(command) {
  const file = command[2];
  if (!file || file.startsWith('--')) return { success: false, error: 'Usage: reports import <file.glassreport> [--app /Applications/solopi-desktop.app] --json' };
  let launch = getHeadlessElectronLaunchForCli();
  const appPath = getOption(command, '--app');
  if (appPath) {
    const absolute = path.resolve(appPath);
    if (!absolute.endsWith('.app') || !fs.existsSync(path.join(absolute, 'Contents', 'MacOS', 'solopi-desktop'))) throw new Error('Invalid installed solopi-desktop app');
    launch = { command: path.join(absolute, 'Contents', 'MacOS', 'solopi-desktop'), argsPrefix: ['--glassbox-background'], cwd: process.cwd() };
  }
  if (!launch) throw new Error('solopi-desktop runtime not found');
  const packagePath = path.resolve(file);
  if (!fs.existsSync(packagePath)) throw new Error('Report package not found');
  const directory = path.join(getGlassBoxCliDataDir(), 'cli-control');
  fs.mkdirSync(directory, { recursive: true });
  const requestDir = fs.mkdtempSync(path.join(directory, 'report-import-'));
  const payloadPath = path.join(requestDir, 'payload.json'), ackPath = path.join(requestDir, 'ack.json');
  fs.writeFileSync(payloadPath, JSON.stringify({ action: 'import-report', packagePath, dataDir: getGlassBoxCliDataDir(), ackPath }));
  const child = spawn(launch.command, [...launch.argsPrefix, '--glassbox-cli-control-payload', payloadPath, '--glassbox-cli-data-dir', getGlassBoxCliDataDir()], {
    cwd: launch.cwd, env: createHeadlessElectronEnvForCli(), detached: true, stdio: 'ignore',
  });
  let launchError; child.on('error', error => { launchError = error; }); child.unref();
  const deadline = Date.now() + 60000;
  while (Date.now() < deadline) {
    if (launchError) throw launchError;
    if (fs.existsSync(ackPath)) {
      const ack = JSON.parse(fs.readFileSync(ackPath));
      fs.rmSync(requestDir, { recursive: true, force: true });
      return ack;
    }
    await sleep(100);
  }
  return { success: false, errorCode: 'REPORT_IMPORT_ACK_TIMEOUT', error: 'Report import was not acknowledged. The installed App must support reports import; inspect reports list before retrying.', requestDir };
}

// All quick-action operations are executed by the same desktop owner as the UI.
async function quickActionWithBrokerForCli(command, dependencies = {}) {
  const action = command[1];
  const allowed = ['list','show','create','import-script','update','import-git','export-git','query','execute','visibility','remove'];
  if (!allowed.includes(action)) throw Error('Unknown quick-actions command; use quick-actions --help');
  const file = getOption(command, '--file');
  const input = file ? loadJsonFile(file).value : {};
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw Error('--file must contain a JSON object');
  const args = { ...input };
  if (command[2] && !command[2].startsWith('--')) args.id = command[2];
  for (const [flag, key] of [['--query','query'],['--repo','repoUrl'],['--branch','branch'],['--directory','directory'],['--phase','phase']]) {
    const value = getOption(command, flag); if (value !== undefined && value !== null && value !== '') args[key] = value;
  }
  for (const flag of ['offset','limit']) { const value=getOption(command, `--${flag}`); if(value)args[flag]=Number(value); }
  const script = getOption(command, '--script'); if (script) args.paths = [path.resolve(script)];
  const values = getOption(command, '--values'); if(values)args.values=JSON.parse(values);
  for (const [flag,key] of [['--phone','phoneSerial'],['--glasses','glassesSerial'],['--phone-package','phonePackage'],['--glasses-package','glassesPackage']]) {
    const value=getOption(command,flag);if(value)args.context={...args.context,[key]:value};
  }
  if(hasFlag(command,'--show'))args.show=true;
  if(hasFlag(command,'--hide'))args.show=false;
  const launch = dependencies.launch || getHeadlessElectronLaunchForCli();
  const dataDir = dependencies.dataDir || getGlassBoxCliDataDir();
  if (!launch || (!launch.packaged && process.env.LENSWIPER_DEV_RUN !== '1')) throw Error('请使用已安装App的CLI；源码联调需显式设置LENSWIPER_DEV_RUN=1');
  const directory=path.join(dataDir,'cli-control');fs.mkdirSync(directory,{recursive:true,mode:0o700});
  const requestDir=fs.mkdtempSync(path.join(directory,'quick-action-'));
  const payloadPath=path.join(requestDir,'payload.json'),ackPath=path.join(requestDir,'ack.json');
  fs.writeFileSync(payloadPath,JSON.stringify({action:'quick-action',request:{action,args},dataDir,ackPath}),{mode:0o600});
  const child=spawn(launch.command,[...launch.argsPrefix,'--glassbox-cli-control-payload',payloadPath,'--glassbox-cli-data-dir',dataDir],{cwd:launch.cwd,env:createHeadlessElectronEnvForCli(),detached:true,stdio:'ignore'});
  let launchError;child.on('error',error=>{launchError=error;});child.unref();
  let cancelled = false;
  const cancel = () => { cancelled = true; fs.writeFileSync(path.join(requestDir,'cancel'),'cancel',{mode:0o600}); };
  process.once('SIGINT',cancel); process.once('SIGTERM',cancel);
  let deadline=Date.now()+65*60*1000;
  try {
  while(Date.now()<deadline) {
    if(cancelled)deadline=Math.min(deadline,Date.now()+5000);
    if(launchError)throw launchError;
    if(fs.existsSync(ackPath)) {const ack=JSON.parse(fs.readFileSync(ackPath,'utf8'));fs.rmSync(requestDir,{recursive:true,force:true});return ack;}
    await sleep(100);
  }
  return {success:false,cancelled,errorCode:'QUICK_ACTION_ACK_TIMEOUT',error:'执行回执超时，结果未知。请核对回执及快捷操作状态，禁止自动重试。',requestDir,ackPath};
  } finally { process.removeListener('SIGINT',cancel);process.removeListener('SIGTERM',cancel); }
}

function taskCleanupRequest(command){
 const request={},booleans={'--dry-run':'dryRun','--purge-artifacts':'purgeArtifacts'},values={'--query':'query','--older-than':'olderThan','--before':'before','--status':'status','--limit':'limit','--backup':'backup'};
 const ids=[];
 for(let i=2;i<command.length;i++){
  const arg=command[i];if(arg==='--json')continue;
  if(booleans[arg]){request[booleans[arg]]=true;continue;}
  if(arg==='--keep'){const keep=[];while(command[i+1]&&!command[i+1].startsWith('--'))keep.push(command[++i]);if(!keep.length)throw Error('--keep 需要任务ID');request.keep=[...(request.keep || []),...keep];continue;}
  if(values[arg]){const v=command[++i];if(!v||v.startsWith('--'))throw Error(`${arg} 缺少值`);request[values[arg]]=arg==='--limit'?Number(v):arg==='--backup'?path.resolve(v):v;continue;}
  if(!arg.startsWith('--')&&command[1]==='remove'){ids.push(arg);continue;}
  throw Error(`未知任务清理参数：${arg}`);
 }
 if(command[1]==='remove'){if(!ids.length)throw Error('remove 需要明确taskId');request.taskIds=[...new Set(ids)];}
 if(!request.taskIds&&!request.query&&!request.olderThan&&!request.before&&!request.status)throw Error('clean 必须指定筛选条件');
 return request;
}
async function taskCleanupWithBrokerForCli(command,dependencies={}){
 const request=taskCleanupRequest(command),dataDir=dependencies.dataDir || getGlassBoxCliDataDir(),launch=dependencies.launch || getHeadlessElectronLaunchForCli();
 if(!launch||(!launch.packaged&&process.env.LENSWIPER_DEV_RUN!=='1'))throw Error('任务清理必须使用支持该控制接口的App Broker；禁止直接改写userData。源码联调需LENSWIPER_DEV_RUN=1');
 const base=path.join(dataDir,'cli-control');fs.mkdirSync(base,{recursive:true,mode:0o700});const dir=fs.mkdtempSync(path.join(base,'task-cleanup-')),payloadPath=path.join(dir,'payload.json'),ackPath=path.join(dir,'ack.json');
 fs.writeFileSync(payloadPath,JSON.stringify({action:'task-cleanup',request,dataDir,ackPath}),{mode:0o600});
 const child=spawn(launch.command,[...launch.argsPrefix,'--glassbox-cli-control-payload',payloadPath,'--glassbox-cli-data-dir',dataDir],{cwd:launch.cwd,env:createHeadlessElectronEnvForCli(),detached:true,stdio:'ignore'});let launchError;child.on('error',e=>{launchError=e;});child.unref();
 const deadline=Date.now()+(dependencies.timeoutMs || 180000);
 while(Date.now()<deadline){if(launchError)throw launchError;if(fs.existsSync(ackPath)){const result=JSON.parse(fs.readFileSync(ackPath,'utf8'));fs.rmSync(dir,{recursive:true,force:true});return result;}await sleep(100);}
 return {success:false,errorCode:'TASK_CLEANUP_ACK_TIMEOUT',error:'清理回执超时，结果未知；请核对任务索引和回执，禁止自动重试',ackPath};
}
function stopTaskWithBrokerForCli(taskId, options = {}) {
  const launch = getHeadlessElectronLaunchForCli();
  if (!launch || (!launch.packaged && process.env.LENSWIPER_DEV_RUN !== '1')) {
    return null;
  }
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbox-cli-control-'));
  const payloadPath = path.join(tempDir, 'payload.json');
  const ackPath = path.join(tempDir, 'ack.json');
  fs.writeFileSync(payloadPath, JSON.stringify({
    schemaVersion: 'glassbox.brokerControl.v1',
    action: options.action || 'stop-task',
    taskId,
    force: Boolean(options.force),
    dataDir: getGlassBoxCliDataDir(),
    ackPath,
  }, null, 2));
  const result = spawnSync(launch.command, [
    ...launch.argsPrefix,
    '--glassbox-cli-control-payload',
    payloadPath,
    '--glassbox-cli-data-dir',
    getGlassBoxCliDataDir(),
  ], {
    cwd: launch.cwd || process.cwd(),
    encoding: 'utf8',
    timeout: Number(process.env.GLASSBOX_CLI_BROKER_CONTROL_TIMEOUT_MS || 15000),
    env: createHeadlessElectronEnvForCli(),
  });
  const startedAt = Date.now();
  const timeoutMs = Number(process.env.GLASSBOX_CLI_BROKER_CONTROL_TIMEOUT_MS || 15000);
  while (!fs.existsSync(ackPath) && Date.now() - startedAt < timeoutMs) {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 100);
  }
  if (!fs.existsSync(ackPath)) {
    return null;
  }
  const ack = JSON.parse(fs.readFileSync(ackPath, 'utf8'));
  fs.rmSync(tempDir, { recursive: true, force: true });
  if (options.action === 'capture-stacks') return { status: ack.success ? 0 : 1, stdout: JSON.stringify({ ...ack, taskId }), stderr: result.stderr || '' };
  return {
    status: ack.success ? 0 : 1,
    stdout: JSON.stringify({
      ...ack,
      taskId,
      status: ack.status || (ack.success ? 'stopping' : 'running'),
      stoppedByBroker: Boolean(ack.success),
      submission: {
        type: 'single-instance-broker-control',
        pid: ack.pid || 0,
        appPath: launch.appPath || '',
      },
      diagnostics: ack.diagnostics || {
        schemaVersion: 'glassbox.error.v1',
        code: ack.success ? 'TASK_STOP_REQUESTED_BY_BROKER' : 'TASK_NOT_ACTIVE_IN_BROKER',
        type: 'task-stop',
        message: ack.message || ack.error || '',
        recoveryActions: ack.success ? [] : getTaskStopRecoveryActionsForCli(taskId),
        details: {
          taskId,
          brokerPid: ack.pid || 0,
          childStatus: result.status,
          childSignal: result.signal || null,
        },
      },
      recoveryActions: ack.success ? [] : getTaskStopRecoveryActionsForCli(taskId),
      error: ack.success ? '' : ack.error || '',
    }, null, 2),
    stderr: '',
  };
}

function terminateRunnerProcessesForCli(runners = [], options = {}) {
  const signal = options.force ? 'SIGKILL' : 'SIGTERM';
  const timeoutMs = Math.max(0, Number(options.timeoutMs || (options.force ? 2000 : 3000)));
  return runners.map((runner) => {
    const pid = Number(runner.pid || 0);
    if (!pid) {
      return {
        ...runner,
        terminated: false,
        error: 'missing pid',
      };
    }
    const beforeProbe = probeProcessLivenessForCli(pid, options);
    if (beforeProbe.alive === null) {
      return {
        ...runner,
        terminated: false,
        liveness: 'unknown',
        error: beforeProbe.error || '无法可靠确认 runner 进程状态。',
      };
    }
    if (beforeProbe.alive === false) {
      return {
        ...runner,
        terminated: false,
        alreadyExited: true,
      };
    }
    try {
      process.kill(pid, signal);
      const startedAt = Date.now();
      let afterProbe = probeProcessLivenessForCli(pid, options);
      while (afterProbe.alive === true && Date.now() - startedAt < timeoutMs) {
        Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);
        afterProbe = probeProcessLivenessForCli(pid, options);
      }
      const aliveAfterSignal = afterProbe.alive;
      return {
        ...runner,
        signal,
        terminated: true,
        aliveAfterSignal,
        exitConfirmed: aliveAfterSignal === false,
        livenessAfterSignal: afterProbe.liveness,
      };
    } catch (error) {
      return {
        ...runner,
        signal,
        terminated: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}

function stopTaskWithLocalFallbackForCli(taskId, options = {}) {
  const persisted = getPersistedTaskForCli(taskId);
  if (!persisted.exists || !persisted.task) {
    const recoveryActions = [
      `运行 solopi-desktop tasks list --json 确认 taskId ${taskId} 是否存在。`,
      '如果任务索引缺失但存在 .glassreport，运行 solopi-desktop reports reindex --json 修复报告索引。',
    ];
    return {
      status: 1,
      stdout: JSON.stringify(createCliCommandFailurePayload(`Task not found: ${taskId}`, {
        errorCode: 'TASK_NOT_FOUND',
        errorType: 'task-stop',
        recoveryActions,
        extra: { taskId, status: 'not_found', stoppedByFallback: false },
      }), null, 2),
      stderr: '',
    };
  }
  if (isTerminalTaskStatusForCli(persisted.task)) {
    let terminal = null;
    let reportPackageError = '';
    try {
      terminal = persistStoppedTaskForCli(taskId);
    } catch (error) {
      reportPackageError = error instanceof Error ? error.message : String(error);
    }
    const status = terminal?.task?.status || persisted.task.status;
    const success = Boolean(terminal && !reportPackageError);
    return {
      status: success ? 0 : 1,
      stdout: JSON.stringify({
        success,
        taskId,
        status,
        alreadyTerminal: true,
        idempotent: status === 'stopped',
        stoppedByFallback: false,
        detailPath: terminal?.detailPath || persisted.loaded?.detailPath || '',
        reportPackagePath: terminal?.task?.reportPackagePath || '',
        reportPackage: terminal?.task?.reportPackage,
        reportPackageError: terminal?.reportPackageError || reportPackageError,
        diagnostics: {
          schemaVersion: 'glassbox.error.v1',
          code: status === 'stopped' ? 'TASK_ALREADY_STOPPED' : 'TASK_ALREADY_TERMINAL',
          type: 'task-stop',
          message: status === 'stopped'
            ? '任务已经是 stopped；重复 stop 未修改已有结果。'
            : `任务已经是 ${status}；stop 未覆盖已有终态。`,
          recoveryActions: [],
          details: { taskId, status },
        },
        recoveryActions: [],
        error: reportPackageError,
      }, null, 2),
      stderr: '',
    };
  }
  const runnerStatus = getTaskRunnerStatusForCli(taskId);
  const liveRunners = runnerStatus.runners.filter((runner) => runner.alive === true);
  if (!liveRunners.length && runnerStatus.liveness === 'unknown') {
    const recoveryActions = getTaskRunnerUnknownRecoveryActionsForCli(taskId);
    return {
      status: 1,
      stdout: JSON.stringify({
        success: false,
        taskId,
        status: 'running',
        staleRunning: false,
        stoppedByFallback: false,
        runnerDiagnostics: runnerStatus,
        terminationResults: [],
        diagnostics: {
          schemaVersion: 'glassbox.error.v1',
          code: 'TASK_RUNNER_LIVENESS_UNKNOWN',
          type: 'task-stop',
          message: '无法可靠确认 headless runner 是否存活，未发送信号，也未把任务落盘为 stopped。',
          recoveryActions,
          details: { taskId, runnerStatus },
        },
        recoveryActions,
        error: 'runner 存活状态未知；为避免误停仍在执行的任务，本次 stop 未改变任务状态。',
      }, null, 2),
      stderr: '',
    };
  }
  const terminationResults = terminateRunnerProcessesForCli(liveRunners, { force: Boolean(options.force) });
  const terminationFailed = terminationResults.some((item) => (
    item.alive === true
    && (!item.terminated || item.aliveAfterSignal !== false)
    && !item.alreadyExited
  ));
  const staleRunning = runnerStatus.liveness === 'dead';
  const canMarkStopped = !terminationFailed;
  let stopped = null;
  let persistError = '';

  if (canMarkStopped) {
    try {
      stopped = persistStoppedTaskForCli(taskId, {
        reason: staleRunning
          ? '未找到存活 headless runner，CLI 判定为 stale running 并停止。'
          : 'CLI 已通过本地 runner 进程发送停止信号。',
        stopDiagnostics: {
          schemaVersion: 'glassbox.error.v1',
          code: staleRunning ? 'TASK_STALE_RUNNING_STOPPED' : 'TASK_STOP_FALLBACK_TERMINATED_RUNNER',
          type: 'task-stop',
          message: staleRunning
            ? '任务状态为 running，但未找到存活 headless runner。CLI 已将任务修复为 stopped。'
            : 'CLI 已终止本地 headless runner 并将任务落盘为 stopped。',
          recoveryActions: getTaskStopRecoveryActionsForCli(taskId),
          details: {
            taskId,
            runnerStatus,
            terminationResults,
          },
        },
      });
    } catch (error) {
      persistError = error instanceof Error ? error.message : String(error);
    }
  }

  const success = Boolean(canMarkStopped && stopped && !persistError);
  return {
    status: success ? 0 : 1,
    stdout: JSON.stringify({
      success,
      taskId,
      status: success ? 'stopped' : 'running',
      staleRunning,
      stoppedByFallback: success,
      runnerDiagnostics: runnerStatus,
      terminationResults,
      detailPath: stopped?.detailPath || '',
      reportPackagePath: stopped?.task?.reportPackagePath || '',
      reportPackage: stopped?.task?.reportPackage,
      reportPackageError: stopped?.reportPackageError || persistError || '',
      diagnostics: {
        schemaVersion: 'glassbox.error.v1',
        code: success
          ? (staleRunning ? 'TASK_STALE_RUNNING_STOPPED' : 'TASK_STOP_FALLBACK_STOPPED')
          : 'TASK_STOP_FALLBACK_FAILED',
        type: 'task-stop',
        message: success
          ? 'tasks stop 已通过本地 runner 进程控制完成，任务已落盘为 stopped。'
          : 'tasks stop 无法通过本地 runner 进程控制可靠停止或落盘任务。',
        recoveryActions: success ? [] : getTaskStopRecoveryActionsForCli(taskId),
        details: {
          runnerStatus,
          terminationResults,
          persistError,
        },
      },
      recoveryActions: success ? [] : getTaskStopRecoveryActionsForCli(taskId),
      error: success ? '' : [
        '无法通过本地 solopi-desktop headless runner 进程控制完成停止。',
        persistError ? `落盘错误：${persistError}` : '',
      ].filter(Boolean).join('\n'),
    }, null, 2),
    stderr: '',
  };
}

function printValidationResult(result, jsonMode) {
  if (jsonMode) {
    writeJson(result);
    return;
  }

  if (result.success) {
    console.log(`OK: ${result.caseCount} case(s) passed validation.`);
  } else {
    console.error(`FAILED: ${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
    result.errors.forEach((error) => console.error(`  error: ${error}`));
  }

  result.warnings.forEach((warning) => console.warn(`  warning: ${warning}`));
}

function getTaskCasesFromCommand(command) {
  const candidatePath = command[2] && !command[2].startsWith('--') ? command[2] : '';
  let requestedCaseIds = getOptions(command, '--case-id');
  const stateInfo = readWorkflowStateForCli();

  const scope=scopeOptions(command);
  if(scope.libraryId){
    if(candidatePath||requestedCaseIds.length)throw Error('选择库范围不能同时指定文件或case-id');
    requestedCaseIds=resolveCaseSelection(stateInfo.state||{},{...scope,expectedCaseCount:Number(getOption(command,'--expected-count')),expectedSelectionRevision:getOption(command,'--selection-revision')});
  }else if(scope.folderId||scope.excludeFolderIds.length||scope.excludeCaseIds.length||getOption(command,'--expected-count')||getOption(command,'--selection-revision'))throw Error('范围参数必须指定--library');
  if (candidatePath) {
    const { absolutePath, value } = loadJsonFile(candidatePath);
    const payloadComponents = getPayloadLevelComponents(value);
    const cases = getCasesFromPayload(value).map((testCase) => mergeComponentsForExecutableCase(testCase, payloadComponents));
    const selectedCases = requestedCaseIds.length
      ? requestedCaseIds.map((caseId) => {
        const match = cases.find((testCase) => testCase?.id === caseId);
        return match || { missingCaseId: caseId };
      })
      : cases;
    const missingCaseIds = selectedCases.filter((item) => item.missingCaseId).map((item) => item.missingCaseId);

    const selected = selectedCases.filter((item) => !item.missingCaseId).map((testCase) => {
      const assetBaseDir = path.dirname(absolutePath);
      const canonicalEdges = Array.isArray(value?.caseEdges?.[testCase.id]) ? value.caseEdges[testCase.id] : null;
      const embeddedEdges = Array.isArray(testCase.edges) ? testCase.edges : [];
      const selectedCase = {
        ...testCase,
        assetBaseDir,
        edges: normalizeCaseEdges(canonicalEdges || embeddedEdges, testCase),
        nodePositions: value?.nodePositions?.[testCase.id] || testCase.nodePositions || {},
      };
      Object.defineProperties(selectedCase, {
        __rawCanonicalEdges: { value: canonicalEdges || embeddedEdges, enumerable: false },
        __rawEmbeddedEdges: { value: embeddedEdges, enumerable: false },
      });
      return selectedCase;
    });
    return {
      file: absolutePath,
      cases: selected,
      missingCaseIds,
      caseEdges: value?.caseEdges || {},
      nodePositions: value?.nodePositions || {},
      payloadComponents,
      assetBaseDir: path.dirname(absolutePath),
      statePath: stateInfo.path,
      sourceRevision: crypto.createHash('sha256').update(fs.readFileSync(absolutePath)).digest('hex'),
    };
  }

  const stateCases = Array.isArray(stateInfo.state?.cases) ? stateInfo.state.cases : [];
  const selectedCases = requestedCaseIds.map((caseId) => {
    const match = stateCases.find((testCase) => testCase?.id === caseId);
    return match ? mergeComponentsForExecutableCase(match, stateInfo.state?.components || []) : { missingCaseId: caseId };
  });
  const missingCaseIds = selectedCases.filter((item) => item.missingCaseId).map((item) => item.missingCaseId);

  const selected = selectedCases.filter((item) => !item.missingCaseId).map((testCase) => {
    const assetBaseDir = stateInfo.path ? path.dirname(stateInfo.path) : getGlassBoxCliDataDir();
    const canonicalEdges = Array.isArray(stateInfo.state?.caseEdges?.[testCase.id]) ? stateInfo.state.caseEdges[testCase.id] : null;
    const embeddedEdges = Array.isArray(testCase.edges) ? testCase.edges : [];
    const selectedCase = {
      ...testCase,
      assetBaseDir,
      edges: normalizeCaseEdges(canonicalEdges || embeddedEdges, testCase),
      nodePositions: stateInfo.state?.nodePositions?.[testCase.id] || testCase.nodePositions || {},
    };
    Object.defineProperties(selectedCase, {
      __rawCanonicalEdges: { value: canonicalEdges || embeddedEdges, enumerable: false },
      __rawEmbeddedEdges: { value: embeddedEdges, enumerable: false },
    });
    return selectedCase;
  });
  return {
    file: '',
    cases: selected,
    missingCaseIds,
    caseEdges: stateInfo.state?.caseEdges || {},
    nodePositions: stateInfo.state?.nodePositions || {},
    payloadComponents: stateInfo.state?.components || [],
    assetBaseDir: stateInfo.path ? path.dirname(stateInfo.path) : getGlassBoxCliDataDir(),
    statePath: stateInfo.path,
    sourceRevision: stateInfo.revision,
  };
}

function validateServiceArguments(command, valueFlags = [], booleanFlags = [], positional = 0, repeatedFlags = []) {
  let count = 0;
  const seen = new Set();
  for (let i = 2; i < command.length; i++) {
    const arg = command[i];
    if (!arg.startsWith('--')) { count++; continue; }
    if (seen.has(arg) && !repeatedFlags.includes(arg)) throw Error(`重复参数：${arg}`);
    seen.add(arg);
    if (booleanFlags.includes(arg)) continue;
    if (!valueFlags.includes(arg)) throw Error(`不支持的参数：${arg}`);
    if (!command[i + 1] || command[i + 1].startsWith('--')) throw Error(`参数缺少值：${arg}`);
    i++;
  }
  if (count !== positional) throw Error('位置参数数量不正确');
}

async function requestServiceControlForCli(payload) {
  const launch = getHeadlessElectronLaunchForCli();
  if (!launch) throw Error('solopi-desktop runtime not found; install the current CLI runtime');
  const directory = path.join(getGlassBoxCliDataDir(), 'cli-control');
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  const requestDir = fs.mkdtempSync(path.join(directory, 'service-'));
  fs.chmodSync(requestDir, 0o700);
  const payloadPath = path.join(requestDir, 'payload.json'), ackPath = path.join(requestDir, 'ack.json');
  fs.writeFileSync(payloadPath, JSON.stringify({ ...payload, dataDir: getGlassBoxCliDataDir(), ackPath }), { mode: 0o600 });
  const child = spawn(launch.command, [...launch.argsPrefix, '--glassbox-cli-control-payload', payloadPath, '--glassbox-cli-data-dir', getGlassBoxCliDataDir()], {
    cwd: launch.cwd || process.cwd(), env: createHeadlessElectronEnvForCli(), detached: true, stdio: 'ignore',
  });
  let launchError; child.on('error', error => { launchError = error; }); child.unref();
  const deadline = Date.now() + (payload.action === 'case-library' ? 1200000 : payload.action === 'team-config' ? 600000 : payload.action === 'battery' && payload.operation === 'show' ? 180000 : 30000);
  while (Date.now() < deadline) {
    if (launchError) { fs.rmSync(requestDir, { recursive: true, force: true }); throw launchError; }
    if (fs.existsSync(ackPath)) {
      const result = JSON.parse(fs.readFileSync(ackPath, 'utf8'));
      fs.rmSync(requestDir, { recursive: true, force: true });
      return result;
    }
    await sleep(100);
  }
  // Keep the acknowledgement location for diagnosis; remove credential-bearing input.
  fs.rmSync(payloadPath, { force: true });
  return { success: false, errorCode: 'SERVICE_ACK_TIMEOUT', error: 'Runtime未确认操作，请查询状态后再重试；当前App必须支持此CLI命令', requestDir };
}

async function run(argv) {
  const args = [...argv];
  const jsonMode = hasFlag(args, '--json');
  const command = args.filter((arg) => arg !== '--json');
  if (command[0] === 'cases' && command[1] === 'import-solopi') {
    try {
      validateServiceArguments(command, ['--file', '--out', '--phone'], []);
      const input = getOption(command, '--file');
      const output = getOption(command, '--out');
      if (!input || !output) throw Error('Usage: cases import-solopi --file <SoloPi.json> --out <new-desktop-case.json> [--phone SN] --json');
      if (fs.statSync(input).size > SOLOPI_MAX_BYTES) throw Error('SoloPi 用例文件不能超过 10 MiB');
      const conversion = convertSoloPiCase(fs.readFileSync(input, 'utf8'), { phoneSerial: getOption(command, '--phone') || '' });
      fs.writeFileSync(output, JSON.stringify(conversion.testCase, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ success: true, output: path.resolve(output), operationCount: conversion.operationCount, issues: conversion.issues, runnable: conversion.runnable }));
      return 0;
    } catch (error) { console.log(JSON.stringify({ success: false, error: error.message })); return 1; }
  }


  if (['config', 'battery', 'performance'].includes(command[0])) {
    if (hasFlag(command, '--help') || hasFlag(command, '-h')) { printHelp(); return 0; }
    try {
      let payload;
      if (command[0] === 'config') {
        if (!['get','patch','import-team'].includes(command[1])) throw Error('Usage: config get | config patch --file <patch.json> [--headless] [--api-key-env ENV] [--dry-run] --json');
        if (command[1] === 'import-team') {
          validateServiceArguments(command,['--file'],['--dry-run','--headless']);
          const file=getOption(command,'--file');
          if(!file || fs.statSync(path.resolve(file)).size>10*1024**2)throw Error('团队配置文件必填且不能超过10MiB');
          const manifest=JSON.parse(fs.readFileSync(path.resolve(file),'utf8'));
          payload={action:'team-config',manifest,dryRun:hasFlag(command,'--dry-run')};
        } else {
        validateServiceArguments(command, command[1] === 'patch' ? ['--file','--api-key-env'] : [], command[1] === 'patch' ? ['--dry-run','--headless'] : ['--headless']);
        payload = { action: 'settings', operation: command[1], dryRun: hasFlag(command, '--dry-run') };
        if (command[1] === 'patch') {
          const file = getOption(command, '--file');
          if (!file || fs.statSync(path.resolve(file)).size > 1024 ** 2) throw Error('请指定不超过1MiB的配置JSON文件');
          payload.patch = JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
          const envName = getOption(command, '--api-key-env');
          if (envName) {
            if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(envName) || !process.env[envName] || !payload.patch.model) throw Error('--api-key-env需要有效环境变量及model配置');
            payload.patch.model.apiKey = process.env[envName];
          }
        }
        }
      } else if (command[0] === 'battery') {
        const operation = command[1];
        if (!['import','status','history','cancel','show'].includes(operation)) throw Error('Usage: battery import --file <zip|txt|log> | --serial <SN>; battery status/cancel <jobId>; battery history; battery show <reportKey>');
        validateServiceArguments(command, operation === 'import' ? ['--file','--serial'] : [], [], ['status','cancel','show'].includes(operation) ? 1 : 0);
        payload = { action: 'battery', operation: operation === 'import' ? 'start' : operation };
        if (operation === 'import') {
          const file = getOption(command, '--file'), serial = getOption(command, '--serial');
          if (Boolean(file) === Boolean(serial)) throw Error('仅选择--file或--serial其中一个');
          Object.assign(payload, file ? { path: path.resolve(file) } : { serial });
        } else if (['status','cancel','show'].includes(operation)) {
          if (!command[2] || command[2].startsWith('--')) throw Error('缺少jobId或reportKey');
          payload[operation === 'show' ? 'key' : 'id'] = command[2];
        }
      } else {
        if (['status','stop','report'].includes(command[1])) {
          return run([command[1] === 'report' ? 'reports' : 'tasks', command[1] === 'status' ? 'show' : command[1] === 'report' ? 'show' : 'stop', ...args.slice(2)]);
        }
        if (command[1] !== 'start') throw Error('Usage: performance start --serial <SN> --package <package> [--role glasses|phone] [--runtime android|harmony] [--duration 60] [--interval 5]; performance status/stop/report <taskId>');
        validateServiceArguments(command, ['--serial','--package','--role','--runtime','--duration','--interval','--task-name']);
        payload = { action: 'performance-start', serial: getOption(command, '--serial'), packageName: getOption(command, '--package'), role: getOption(command, '--role') || 'glasses', runtime: getOption(command, '--runtime') || 'android', durationSeconds: Number(getOption(command, '--duration') || 60), intervalSeconds: Number(getOption(command, '--interval') || 5), taskName: getOption(command, '--task-name') };
      }
      const headlessConfig = command[0] === 'config' && (hasFlag(command,'--headless') || (process.platform==='linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY));
      let result;
      if(headlessConfig) {
        const modulePath=[path.resolve(CLI_SCRIPT_DIR,'headless-configuration.cjs'),path.resolve(CLI_SCRIPT_DIR,'../electron/headless-configuration.js')].find(p=>fs.existsSync(p));
        if(!modulePath)throw Error('CLI缺少无桌面配置模块，请升级solopi-desktop');
        result=await require(modulePath).runHeadlessConfiguration({directory:getGlassBoxCliDataDir(),payload,
          codec:{parseCaseLibraryFilesForCli,mergePulledCaseLibraryIntoStateForCli},
          pullCases:async library=>{
            const repo=await ensureCaseLibraryRepoForCli(library);
            await runCommandForCli('git',['lfs','pull'],buildGitCommandOptionsForCli(library,{cwd:repo.repoPath,timeout:600000}));
            const manifest=readJsonFileIfExistsForCli(path.join(repo.repoPath,'manifest.json'))||{schemaVersion:'glassbox.case-library.v1',name:library.name,casesRoot:'cases',assetsRoot:'assets'};
            const gitInfo=await getGitRepoInfoForCli(repo.repoPath);
            const files=readCaseLibraryFilesForCli(repo.repoPath,manifest).map(file=>({...file,content:hydrateCaseLibraryFileContentForCli(file,repo.repoPath)}));
            return {success:true,...repo,manifest,gitInfo,files};
          },
          runGit:(cmd,argv,repo)=>runCommandForCli(cmd,argv,buildGitCommandOptionsForCli(repo,{timeout:600000}))});
      } else result=await requestServiceControlForCli(payload);
      if (jsonMode) writeJson(result); else console.log(JSON.stringify(result, null, 2));
      return result.success === false ? 1 : 0;
    } catch (error) {
      const result = { success: false, error: error.message, ...(error.code ? {errorCode:error.code} : {}) };
      if (jsonMode) writeJson(result); else console.error(result.error);
      return 1;
    }
  }

  if(command[0]==='cases' && ['--help','-h'].includes(command[1])) { printHelp();return 0; }
  if(command[0]==='cases' && ['configure','pull','push'].includes(command[1])) {
    try {
      validateServiceArguments(command,command[1]==='configure'?['--library','--name','--repo','--branch']:command[1]==='push'?['--library','--message']:['--library'],command[1]==='configure'?['--create','--dry-run']:['--dry-run']);
      const request = buildCaseLibraryRequestForCli(command);
      if(!request.library || (command[1]==='push'&&!request.message))throw Error('必须指定--library；push还需要--message');
      const result=await requestServiceControlForCli({action:'case-library',request:{action:command[1],args:request}});writeJson(result);return result.success?0:1;
    }catch(error){writeJson({success:false,error:error.message,errorCode:error.code||'CASE_LIBRARY_ARGUMENTS_INVALID'});return 1;}
  }

  if (command.length === 0 || command[0] === '--help' || command[0] === '-h') {
    printHelp();
    return 0;
  }
  if (command[0] === '--version' || command[0] === '-v') {
    if (jsonMode) writeJson({success:true,product:'solopi-desktop',...CLI_BUILD_IDENTITY});
    else console.log(`solopi-desktop ${VERSION} (${CLI_BUILD_IDENTITY.sourceSha256?.slice(0,12) || 'unknown-build'})`);
    return 0;
  }

  if (command[0] === 'logs' && command[1] === 'export') {
    const index=command.indexOf('--output');
    if(index>=0 && (!command[index+1] || command[index+1].startsWith('--'))) throw Error('--output需要文件路径');
    const output=index>=0?command[index+1]:path.join(process.cwd(),`solopi-desktop-logs-${Date.now()}.json.gz`);
    const modulePath=[path.resolve(CLI_SCRIPT_DIR,'diagnostics.cjs'),path.resolve(CLI_SCRIPT_DIR,'../electron/diagnostics.js')].find(p=>fs.existsSync(p));
    if(!modulePath)throw Error('CLI缺少诊断模块，请升级solopi-desktop');
    console.log(JSON.stringify(require(modulePath).bundle(getGlassBoxCliDataDir(),output),null,2));return;
  }
  if (command[0] === 'quick-actions') {
    if (hasFlag(command, '--help') || !command[1]) {
      console.log(`solopi-desktop quick-actions list [--query text] [--offset N] [--limit N] --json
solopi-desktop quick-actions show <id> --json
solopi-desktop quick-actions create --file request.json --json
solopi-desktop quick-actions import-script --script /absolute/script.sh --json
solopi-desktop quick-actions update <id> --file request.json --json
solopi-desktop quick-actions import-git --repo URL [--branch branch] [--directory path] --json
solopi-desktop quick-actions export-git <id> --repo URL --branch branch [--directory path] --json
solopi-desktop quick-actions query <id> [--values JSON] [--phone SN] [--glasses SN] --json
solopi-desktop quick-actions execute <id> --phase run|start|stop [--values JSON] [--phone SN] [--glasses SN] [--phone-package PKG] [--glasses-package PKG] --json
solopi-desktop quick-actions visibility <id> --show|--hide --json
solopi-desktop quick-actions remove <id> --json
--file contains the request fields (not a shell command). create: {fileName,content,configuration?}; update: {configuration:{name?,description?,inputs?,args?,queryConfig?,sessionConfig?}}.
show returns complete input definitions. Read them before execute. Session start/stop are explicit; do not retry uncertain writes. Uses the current App broker and shared configuration.`);
      return 0;
    }
    try { const result=await quickActionWithBrokerForCli(command);writeJson(result);return result.success?0:1; }
    catch(error) {writeJson({success:false,error:error.message});return 1;}
  }

  if (command[0] === 'run' && command[1] === 'task' && (hasFlag(command, '--help') || hasFlag(command, '-h'))) {
    printRunTaskHelp();
    return 0;
  }

  if (command[0] === 'run' && command[1] === 'case' && (hasFlag(command, '--help') || hasFlag(command, '-h'))) {
    printRunCaseHelp();
    return 0;
  }

  if (command[0] === 'run' && ['case','task'].includes(command[1])) {
    try {
      runPackageOptionsForCli(command);
      if(command[1]!=='task'&&['--library','--folder','--exclude-folder','--exclude-case','--expected-count','--selection-revision'].some(flag=>command.includes(flag)))throw Error('范围选择参数仅支持run task');
      validateServiceArguments(command,
        ['--library','--folder','--exclude-folder','--exclude-case','--expected-count','--selection-revision','--case-id','--task-name','--phone','--glasses','--phone-package','--glasses-package','--env','--report-out',
          '--stress-rounds','--stress-minutes','--stress-logs','--perf','--perf-interval-ms','--perf-phone-runtime','--perf-glasses-runtime',
          '--perf-phone-package','--perf-glasses-package','--stack-mode','--stack-interval-ms','--stack-max-count','--stack-max-bytes','--stack-checkpoint'],
        ['--no-screen-mirror','--record-glasses-screen','--no-record-glasses-screen','--record-phone-screen','--no-record-phone-screen',
          '--show-phone-screen','--no-show-phone-screen','--show-glasses-screen','--no-show-glasses-screen','--keep-screen-awake','--no-keep-screen-awake',
          '--force-env-restart','--no-report','--wait','--perf-phone','--perf-glasses','--thread-stacks'],
        command[2] && !command[2].startsWith('--') ? 1 : 0, ['--case-id','--perf','--stack-checkpoint','--exclude-folder','--exclude-case']);
    } catch(error) {
      if(error.code==='PACKAGE_OVERRIDE_INVALID'){
        writeJson({success:false,submitted:false,taskId:null,phase:'validation',errorCode:error.code,field:error.field,error:error.message});return 1;
      }
      writeJson({success:false,errorCode:'INVALID_RUN_ARGUMENTS',error:error.message}); return 2;
    }

  }

  if (command[0] === 'skills' && command[1] === 'install' && command[2] === 'codex') {
    if (hasFlag(command, '--help') || hasFlag(command, '-h')) {
      console.log('solopi-desktop skills install codex [--force] [--json]\nInstall bundled solopi-desktop-cli into CODEX_HOME/skills (default ~/.codex/skills). --force replaces this skill only.');
      return 0;
    }
    try {
      const result = installCodexSkill({ force: hasFlag(command, '--force') });
      if (jsonMode) writeJson(result); else console.log(`${result.message}\n${result.path}`);
      return 0;
    } catch (error) {
      writeJson({ success: false, error: error.message });
      return 2;
    }
  }

  let stress;
  try {
    stress = normalizeStressOptionsFromCommand(command);
    if (stress && !(command[0] === 'run' && command[1] === 'task')) {
      throw new Error('压测参数仅支持 run task');
    }
  } catch (error) {
    writeJson({ success: false, errorCode: 'INVALID_STRESS_OPTIONS', error: error.message });
    return 2;
  }

  if (command[0] === 'run' && ['case','task'].includes(command[1])) {
    const input=command[2] && !command[2].startsWith('--') ? command[2] : '';
    const fromFile=Boolean(input && fs.existsSync(path.resolve(input)));
    const fromLibrary=!fromFile && (getOption(command,'--library') || getOptions(command,'--case-id').length || (command[1]==='case' && input));
    if (fromLibrary && !readWorkflowStateForCli().path) {
      writeJson({success:false,submitted:false,taskId:null,phase:'validation',errorCode:'WORKFLOW_STATE_UNAVAILABLE',dataDir:getGlassBoxCliDataDir(),statePath:'',error:'No readable workflow state in this CLI data directory.',recoveryActions:['Use the configured deployment CLI and data directory; run doctor --json. Do not copy or rebuild the case.']});
      return 1;
    }
  }

  if (command[0] === 'doctor') {
    const payload = getDoctorPayloadForCli();
    if (jsonMode) {
      writeJson(payload);
    } else {
      console.log(`solopi-desktop CLI ${VERSION} doctor`);
      console.log(`submission: ${payload.cli.submissionType}`);
      console.log(`state: ${payload.paths.statePath || 'not found'}`);
      console.log(`cases: ${payload.inventory.caseCount}, tasks: ${payload.inventory.taskCount}`);
      payload.checks.forEach((check) => {
        console.log(`${check.status === 'pass' ? 'OK' : 'FAIL'}\t${check.id}\t${check.name}`);
      });
      payload.warnings.forEach((warning) => {
        console.log(`WARN\t${warning.id}\t${warning.message}`);
      });
    }
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'assert') {
    const usage = `solopi-desktop assert generate --kind json|text (--sample-log <text> | --log <sample.log>) --target <text> [--target-file <file>] [--json]
solopi-desktop assert try --kind json|text (--sample-log <text> | --log <file>) --line-regex <re> [--conditions <json-array>] [--conditions-file <file>] [--target <expected-text>] [--ignore-case] [--limit <N>] [--json]
Offline only. generate uses the same sample/target generator as the editor and verifies its capture. try scans individual log lines, reports every condition, and succeeds if any line passes. No task, model or device is started. Results are limited to 20 by default; counts cover the full file.`;
    if (!command[1] || hasFlag(command, '--help')) { console.log(usage); return 0; }
    try {
      const modulePath = [path.resolve(CLI_SCRIPT_DIR, 'workflow-log-diagnostics.cjs'), path.resolve(CLI_SCRIPT_DIR, '../electron/workflow-log-diagnostics.js')].find(p => fs.existsSync(p));
      const api = require(modulePath);
      const kind = getOption(command, '--kind') || 'json';
      if (!['json', 'text'].includes(kind)) throw Error('--kind must be json or text');
      const file = getOption(command, '--log');
      const hasSampleLog = hasFlag(command, '--sample-log');
      const hasLogFile = hasFlag(command, '--log');
      if (hasSampleLog === hasLogFile) throw Error('Provide exactly one of --sample-log or --log');
      const sampleLog = hasSampleLog ? getOption(command, '--sample-log') : undefined;
      if (hasSampleLog && sampleLog === undefined) throw Error('Missing --sample-log value');
      if (hasLogFile && !file) throw Error('Missing --log path');
      const targetFile = getOption(command, '--target-file');
      const target = targetFile ? fs.readFileSync(targetFile, 'utf8').trim() : (getOption(command, '--target') || undefined);
      const conditionsFile = getOption(command, '--conditions-file');
      const conditions = api.parseJsonAssertConditions(conditionsFile ? fs.readFileSync(conditionsFile, 'utf8') : getOption(command, '--conditions') || '[]');
      const operators = ['equals', 'notEquals', 'contains', 'notContains', 'regex', 'notRegex', 'exists', 'notExists'];
      if (conditions.some(c => !c || typeof c !== 'object' || !operators.includes(c.operator || 'equals'))) throw Error('Invalid condition/operator');
      const limit = Number(getOption(command, '--limit') || 20);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw Error('--limit must be 1..1000');
      let pattern = getOption(command, '--line-regex');
      let source;
      if (command[1] === 'generate') {
        source = (hasSampleLog ? sampleLog : fs.readFileSync(file, 'utf8')).trim();
        if (!target) throw Error('Missing --target or --target-file');
        pattern = kind === 'json' ? api.createJsonExtractRegexFromSample(source, target) : api.createTtsExtractRegexFromSelection(source, target);
        if (!pattern) throw Error('Target must occur verbatim in the sample log');
      } else if (command[1] !== 'try') throw Error('Unknown assert command');
      if (!pattern) throw Error('Missing --line-regex');
      const regexp = new RegExp(pattern, hasFlag(command, '--ignore-case') ? 'i' : '');
      let matchedCount = 0, passedCount = 0, lineNumber = 0;
      const matches = [];
      const inspect = line => {
        lineNumber++;
        const match = regexp.exec(line);
        if (!match) return;
        matchedCount++;
        const captured = kind === 'json' ? match.groups?.json || match[1] || line : match.groups?.ttsText ?? match[1] ?? '';
        const result = { lineNumber, line, captured, passed: false };
        try {
          if (command[1] === 'generate' && captured !== target) throw Error('Generated capture differs from target');
          if (kind === 'json') {
            result.parsed = api.parseLogJsonPayload(captured);
            result.conditions = conditions.map(condition => {
              try { return { ...api.assertJsonCondition(result.parsed, condition), passed: true }; }
              catch (error) { return { ...condition, actual: api.findJsonPathValueDeep(result.parsed, condition.path), expected: condition.value, passed: false, error: error.message }; }
            });
            result.passed = result.conditions.every(c => c.passed);
          } else result.passed = target === undefined || captured === target;
        } catch (error) { result.error = error.message; }
        if (result.passed) passedCount++;
        if (matches.length < limit) matches.push(result);
      };
      if (source !== undefined) inspect(source);
      else {
        const { createInterface } = await import('node:readline');
        const { Readable } = await import('node:stream');
        const input = hasSampleLog ? Readable.from([sampleLog]) : fs.createReadStream(file, { encoding: 'utf8' });
        for await (const line of createInterface({ input, crlfDelay: Infinity })) inspect(line);
      }
      const payload = { schemaVersion: 'lenswiper.assert.v1', success: passedCount > 0, kind, lineRegex: pattern, matchedCount, passedCount, truncated: matchedCount > matches.length, matches };
      writeJson(payload);
      return payload.success ? 0 : 1;
    } catch (error) { writeJson({ schemaVersion: 'lenswiper.assert.v1', success: false, error: error.message }); return 1; }
  }

  if (command[0] === 'components' && command[1] === 'list') {
    const { path: statePath, state } = readWorkflowStateForCli();
    const allComponents = createMergedComponentsForCli(state?.components || []);
    const includeLegacyBusiness = hasFlag(command, '--include-legacy-business');
    const components = getListedComponentsForCli(state?.components || [], { includeLegacyBusiness });
    const legacyBusinessComponentCount = allComponents.filter(isLegacyBusinessComponentForCli).length;
    if (jsonMode) {
      writeJson({
        schemaVersion: 'glassbox.components.v1',
        statePath,
        includeLegacyBusiness,
        legacyBusinessComponentCount,
        legacyBusinessHidden: !includeLegacyBusiness && legacyBusinessComponentCount > 0,
        components,
      });
    } else {
      components.forEach((component) => {
        console.log(`${component.id}\t${component.kind}\t${component.device}\t${component.name}`);
      });
      if (!includeLegacyBusiness && legacyBusinessComponentCount > 0) {
        console.error(`Hidden legacy business compatibility components: ${legacyBusinessComponentCount}. Use --include-legacy-business only for old-case migration.`);
      }
    }
    return 0;
  }

  if (command[0] === 'devices' && command[1] === 'list') {
    try {
      await resolveAdbPathForCli({ preferBridge: true });
      printDeviceList(listDevices(), jsonMode);
      return 0;
    } catch (error) {
      const payload = {
        schemaVersion: 'glassbox.devices.v1',
        devices: [],
        defaults: {
          phoneSerial: '',
          glassesSerial: '',
        },
        error: error instanceof Error ? error.message : String(error),
        errorCode: 'DEVICE_INVENTORY_FAILED',
        errorType: 'device-preflight',
        recoveryActions: [
          '运行 solopi-desktop doctor --json 确认 CLI 包、状态文件和 runner 入口可读。',
          '确认 ADB 路径配置正确且可执行。',
          '修复 ADB 后重试 solopi-desktop devices list --json。',
        ],
      };

      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 2;
    }
  }

  if (command[0] === 'cases' && ['update', 'create'].includes(command[1])) {
    const payload = await updateCaseWithBrokerForCli(command);
    if (jsonMode) writeJson(payload);
    else if (payload.success) console.log(`${payload.dryRun ? 'Validated' : command[1] === 'create' ? 'Created' : 'Updated'}: ${payload.caseId}`);
    else console.error(payload.error);
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'cases' && command[1] === 'list') {
    const payload = getCasesQueryPayloadForCli(command);
    if (jsonMode) {
      writeJson(payload);
    } else {
      console.log(`State: ${payload.statePath || '未找到'}`);
      payload.cases.forEach((testCase, index) => {
        console.log(`${index + 1}\t${testCase.id}\t${testCase.name}\t${testCase.reviewStatus || '-'}\t${testCase.folderPath || '-'}`);
      });
    }
    return payload.success === false ? 1 : 0;
  }

  if (command[0] === 'cases' && command[1] === 'libraries') {
    const payload = getCaseLibrariesPayloadForCli();
    if (jsonMode) {
      writeJson(payload);
    } else {
      console.log(`State: ${payload.statePath || '未找到'}`);
      payload.libraries.forEach((library, index) => {
        console.log(`${index + 1}\t${library.libraryId}\t${library.name}\t${library.branch || '-'}\t${library.repoUrl || '-'}\tcases=${library.caseCount}`);
      });
    }
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'cases' && command[1] === 'pull') {
    const payload = await getCaseLibraryPullPayloadForCli(command);
    if (jsonMode) {
      writeJson(payload);
    } else if (payload.success) {
      console.log(`pull ${payload.dryRun ? '(dry-run)' : ''}: ${payload.libraryName} ${payload.branch}`);
      console.log(`repo: ${payload.repoUrl}`);
      console.log(`files: ${payload.fileCount}, cases: ${payload.importedCases}, components: ${payload.importedComponents}`);
      if (payload.warnings?.length) {
        payload.warnings.forEach((warning) => console.warn(`warning: ${warning}`));
      }
    } else {
      console.error(payload.error);
    }
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'cases' && command[1] === 'push') {
    const payload = await getCaseLibraryPushPayloadForCli(command);
    if (jsonMode) {
      writeJson(payload);
    } else if (payload.success) {
      console.log(`push ${payload.dryRun ? '(dry-run)' : ''}: ${payload.libraryName} ${payload.branch}`);
      console.log(`repo: ${payload.repoUrl}`);
      console.log(`changed: ${payload.changedFileCount || 0}, cases: ${payload.caseCount || 0}, components: ${payload.componentCount || 0}`);
      (payload.changedFiles || []).forEach((item) => console.log(`${item.status}\t${item.path}`));
    } else {
      console.error(payload.error);
    }
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'cases' && command[1] === 'show') {
    const caseId = String(command[2] || '').trim();
    if (!caseId) {
      const payload = { success: false, error: 'Missing case id' };
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 2;
    }

    const payload = getCaseDetailPayloadForCli(caseId);
    if (jsonMode) {
      writeJson(payload);
    } else if (payload.success) {
      console.log(`${payload.case.id}\t${payload.case.name}`);
      console.log(`steps: ${payload.summary.stepCount}, edges: ${payload.summary.edgeCount}, runnable: ${payload.summary.runnable ? 'yes' : 'no'}`);
      console.log(`folder: ${payload.summary.folderPath || '-'}`);
    } else {
      console.error(payload.error);
    }
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'tasks' && command[1] === 'register-source') {
    const source = path.resolve(command[2] || '');
    if (!command[2] || !fs.existsSync(path.join(source, 'workflow-editor-state.json'))) throw new Error('请提供有效的任务源数据目录');
    registerTaskSource(source, getGlassBoxCliDataDir());
    writeJson({ success: true, sourceDataDir: source, uiDataDir: getGlassBoxCliDataDir(), message: '任务源已登记；支持 task-visibility 的 UI 将自动读取历史及后续任务。' });
    return 0;
  }

  if ((command[0] === 'tasks' || command[0] === 'reports') && command[1] === 'list') {
    const reportsOnly = command[0] === 'reports';
    const payload = getTasksQueryPayloadForCli(command, { reportsOnly });
    if (jsonMode) {
      writeJson(payload);
    } else {
      console.log(`State: ${payload.statePath || '未找到'}`);
      payload.tasks.forEach((task, index) => {
        const summary = task.summary || {};
        console.log(`${index + 1}\t${task.id}\t${task.status || '-'}\t${task.name}\t成功${summary.successCount || 0}/失败${summary.failedCount || 0}/停止${summary.stoppedCount || 0}`);
      });
    }
    return 0;
  }

  if (command[0] === 'reports' && command[1] === 'import') {
    try {
      const result = await importReportWithBrokerForCli(command);
      if (jsonMode) writeJson(result); else console.log(result.success ? `Imported report: ${result.task?.id}` : result.error);
      return result.success ? 0 : 1;
    } catch (error) { writeJson({ success: false, error: error.message }); return 1; }
  }

  if (command[0] === 'reports' && command[1] === 'reindex') {
    const payload = getReportsReindexPayloadForCli(command);
    if (jsonMode) {
      writeJson(payload);
    } else {
      const summary = payload.summary || {};
      console.log(`reports reindex ${payload.dryRun ? '(dry-run)' : ''}`);
      console.log(`created: ${summary.createdCount || 0}, would-create: ${summary.wouldCreateCount || 0}, unchanged: ${summary.unchangedCount || 0}, skipped: ${summary.skippedCount || 0}, failed: ${summary.failedCount || 0}`);
      payload.results.forEach((item) => {
        console.log(`${item.action}\t${item.taskId}\t${item.status || '-'}\t${item.reportPackagePath || item.previousReportPackagePath || item.reason || '-'}`);
      });
    }
    return payload.success ? 0 : 1;
  }

  if(command[0]==='tasks' && ['remove','clean'].includes(command[1])){
    try{const result=await taskCleanupWithBrokerForCli(command);if(jsonMode)writeJson(result);else{console.log(result.success?`${result.dryRun?'预览':'已移除'} ${result.count} 条任务；产物 ${result.artifactBytes} bytes${result.purgeArtifacts?'（清理）':'（保留）'}`:result.error);for(const t of result.tasks || [])console.log(`${t.id}\t${t.name}\t${t.status}\t${t.updatedAt || ''}\t${t.artifactBytes}`);}return result.success?0:1;}
    catch(e){writeJson({success:false,errorCode:e.code || 'TASK_CLEANUP_INVALID',error:e.message});return 1;}
  }
  if (command[0] === 'tasks' && command[1] === 'capture-stacks') {
    const taskId = String(command[2] || '').trim();
    const external = getVisibleTask(getGlassBoxCliDataDir(), taskId);
    let result;
    if (external) {
      result = spawnSync(process.execPath, [CLI_SCRIPT_PATH, 'tasks', 'capture-stacks', taskId, '--json'], { env: { ...process.env, GLASSBOX_CLI_DATA_DIR: external.externalSource.dataDir, GLASSBOX_WORKFLOW_STATE_PATH: path.join(external.externalSource.dataDir, 'workflow-editor-state.json'), LENSWIPER_TASK_UI_DATA_DIR: getGlassBoxCliDataDir(), GLASSBOX_CLI_BROKER_CONTROL_TIMEOUT_MS: '60000' }, encoding: 'utf8', timeout: 65000 });
    } else {
      process.env.GLASSBOX_CLI_BROKER_CONTROL_TIMEOUT_MS = '60000';
      result = stopTaskWithBrokerForCli(taskId, { action: 'capture-stacks' });
    }
    const payload = result ? parseRunResult(result.stdout) : { success: false, error: '当前 runner 不支持线程栈采集控制' };
    writeJson(payload); return payload?.success ? 0 : 1;
  }

  if (command[0] === 'tasks' && command[1] === 'stop') {
    const taskId = String(command[2] || '').trim();
    if (!taskId) {
      const payload = { success: false, error: 'Missing task id' };
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 2;
    }

    const result = await stopTaskViaControlChannel(taskId, { force: hasFlag(command, '--force') });
    const payload = parseRunResult(result.stdout) || {
      success: false,
      taskId,
      error: '停止任务结果无法解析为 JSON',
      raw: result.stdout,
    };
    if (jsonMode) {
      writeJson(payload);
    } else if (payload.success) {
      console.log(`${payload.taskId}\t${payload.status || 'stopping'}\t${payload.message || '停止请求已提交'}`);
    } else {
      console.error(payload.error);
    }
    return result.status;
  }

  if (command[0] === 'tasks' && command[1] === 'watch') {
    const taskId = String(command[2] || '').trim();
    if (!taskId) {
      console.error(JSON.stringify({ success: false, errorCode: 'TASK_ID_REQUIRED', error: 'Missing task id' }));
      return 2;
    }
    if (!hasFlag(command, '--jsonl')) {
      console.error(JSON.stringify({
        success: false,
        errorCode: 'TASK_WATCH_JSONL_REQUIRED',
        error: 'tasks watch requires --jsonl',
      }));
      return 2;
    }
    const result = await watchTaskEventsForCli(taskId, {
      after: getOption(command, '--after'),
      pollIntervalMs: getOption(command, '--poll-interval-ms'),
    });
    if (!result.success) {
      console.error(JSON.stringify(result));
      return 1;
    }
    return 0;
  }

  if (command[0] === 'tasks' && command[1] === 'result') {
    try {
      validateServiceArguments(command, ['--offset', '--limit'], [], 1);
      const taskId = String(command[2] || '').trim();
      if (!taskId || taskId.startsWith('--')) throw Error('Usage: tasks result <taskId> [--offset N] [--limit 1-20] --json');
      const parseInteger = (flag, fallback) => {
        const value = getOption(command, flag);
        if (value === undefined || value === null || value === '') return fallback;
        if (!/^\d+$/.test(value)) throw Error(`${flag} 必须为非负整数`);
        return Number(value);
      };
      const detail = getTaskDetailPayloadForCli(taskId, { skipReportPackage: true });
      if (!detail.success) { writeJson(detail); return 1; }
      const receipt = taskResultReceipt(detail.task, { offset: parseInteger('--offset', 0), limit: parseInteger('--limit', 10) });
      if (jsonMode) writeJson(receipt);
      else console.log(receipt.deliveryText + (receipt.reportPackagePath ? '\nReport: ' + receipt.reportPackagePath : ''));
      return 0;
    } catch (error) { writeJson({ success: false, successScope: 'query', error: error.message }); return 1; }
  }

  if ((command[0] === 'tasks' || command[0] === 'reports') && command[1] === 'show') {
    const taskId = String(command[2] || '').trim();
    const reportsOnly = command[0] === 'reports';
    const summaryOnly = reportsOnly && hasFlag(command, '--summary');
    const caseId = reportsOnly ? String(getOption(command, '--case-id') || '').trim() : '';
    if (!taskId) {
      const payload = { success: false, error: `Missing ${reportsOnly ? 'report' : 'task'} id` };
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 2;
    }

    const filteredQuery=['--status','--offset','--limit'].some(flag=>command.includes(flag));
    let payload;
    try {
      if(filteredQuery) {
        const options=caseQueryOptionsForCli(command);
        const detail=getTaskDetailPayloadForCli(taskId,{reportsOnly,skipReportPackage:true});
        payload=detail.success ? {success:true,successScope:'query',schemaVersion:'glassbox.task.cases.v1',statePath:detail.statePath,detailPath:detail.detailPath,detailLoaded:detail.detailLoaded,detailError:detail.detailError,task:caseQueryOverview({...detail.task,summary:detail.summary?.summary || detail.task.summary},options)} : detail;
      } else payload = caseId
      ? getCaseReportPayloadForCli(taskId, caseId)
      : (summaryOnly
        ? getReportSummaryPayloadForCli(taskId)
        : getTaskDetailPayloadForCli(taskId, { reportsOnly }));
    } catch(error) { payload={success:false,error:error.message}; }
    if (jsonMode) {
      if(filteredQuery) console.log(JSON.stringify(payload)); else writeJson(payload);
    } else if (payload.success) {
      if (caseId && !filteredQuery) {
        console.log(`${payload.taskId}\t${payload.caseId}\t${payload.caseStatus || '-'}`);
        console.log(`evidenceReady: ${payload.evidenceReady ? 'yes' : 'no'}`);
        console.log(`runDir: ${payload.artifacts?.runDir || '-'}`);
        return 0;
      }
      const summary = filteredQuery ? payload.task.summary || {} : summaryOnly ? payload.summary || {} : payload.summary?.summary || {};
      const task = summaryOnly && !filteredQuery ? payload : payload.task;
      console.log(`${task.id}\t${task.status || '-'}\t${task.name}`);
      console.log(`cases: ${summary.caseCount || 0}, success: ${summary.successCount || 0}, failed: ${summary.failedCount || 0}, stopped: ${summary.stoppedCount || 0}`);
      console.log(`detail: ${payload.detailPath || '-'} (${payload.detailLoaded ? 'loaded' : 'not loaded'})`);
      if(filteredQuery) {
        console.log(`matched: ${task.matchedCaseCount}/${task.totalCaseCount}, nextOffset: ${task.nextOffset ?? 'null'}`);
        for(const c of task.cases) console.log(`${c.caseId || c.id}\t${c.status}\t${c.name}\t${c.error}`);
      }
      if (summaryOnly && !filteredQuery) {
        console.log(`report: ${payload.reportPackagePath || '-'}`);
      }
    } else {
      console.error(payload.error);
    }
    return payload.success ? 0 : 1;
  }

  if (command[0] === 'env' && (command[1] === 'get' || command[1] === 'set')) {
    try {
      await resolveAdbPathForCli({ preferBridge: true });
      const deviceSelection = resolveDeviceSerials({
        phoneSerial: getOption(command, '--phone'),
      });
      const serial = deviceSelection.phoneSerial;
      const packageName = String(getOption(command, '--package') || getDefaultPhonePackageFromStateOrCase()).trim();

      if (!serial) {
        const payload = createCliCommandFailurePayload('未找到可自动选择的手机设备。请通过 --phone <serial> 指定。', {
          errorCode: 'DEVICE_PREFLIGHT_NO_PHONE',
          errorType: 'device-preflight',
          recoveryActions: [
            '运行 solopi-desktop doctor --json 确认 CLI 包、状态文件和 runner 入口可读。',
            '运行 solopi-desktop devices list --json 查看当前可见设备、默认绑定和 ADB 路径。',
            '确认手机已连接并处于 device 状态，或通过 --phone <serial> 指定。',
          ],
          extra: {
            devices: deviceSelection.devices || null,
          },
        });
        if (jsonMode) {
          writeJson(payload);
        } else {
          console.error(payload.error);
        }
        return 1;
      }

      const payload = command[1] === 'get'
        ? readSdkEnvironmentForCli({ serial, packageName })
        : setSdkEnvironmentForCli({
          serial,
          packageName,
          environment: command[2],
          forceRestart: hasFlag(command, '--force-env-restart'),
        });

      if (jsonMode) {
        writeJson(payload);
      } else if (payload.success) {
        console.log(`${payload.serial}\t${payload.packageName}\t${payload.environment}${payload.defaulted ? '\t(default ONLINE)' : ''}`);
      } else {
        console.error(payload.error || '环境操作失败');
      }
      return payload.success ? 0 : 1;
    } catch (error) {
      const payload = createCliCommandFailurePayload(error instanceof Error ? error.message : String(error), {
        errorCode: 'ENVIRONMENT_PREFLIGHT_FAILED',
        errorType: 'environment-preflight',
        recoveryActions: [
          '运行 solopi-desktop doctor --json 确认 CLI 包、状态文件和 runner 入口可读。',
          '运行 solopi-desktop devices list --json 查看 ADB 是否可用。',
          '确认目标设备可访问；如是权限或 ADB 错误，修复后重试同一 env 命令。',
        ],
      });
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 2;
    }
  }

  if (command[0] === 'cases' && command[1] === 'validate') {
    const filePath = command[2];

    if (!filePath) {
      const payload = createCliCommandFailurePayload('Missing file path: solopi-desktop cases validate <file>', {
        errorCode: 'VALIDATION_INPUT_MISSING_FILE',
        errorType: 'case-validation',
        recoveryActions: [
          '传入一个本地 case JSON 或 bundle JSON 文件路径。',
          '运行 solopi-desktop --help 查看 cases validate 用法。',
        ],
      });
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 1;
    }

    try {
      const { absolutePath, value } = loadJsonFile(filePath);
      const result = {
        file: absolutePath,
        ...validatePayload(value),
      };
      printValidationResult(result, jsonMode);
      return result.success ? 0 : 1;
    } catch (error) {
      const diagnostics = createCliErrorDiagnosticsForCli(error instanceof Error ? error.message : String(error), {
        errorCode: 'VALIDATION_INPUT_READ_FAILED',
        errorType: 'case-validation',
        recoveryActions: [
          '确认文件路径存在且当前 agent 有读取权限。',
          '确认文件内容是合法 JSON。',
          '如果文件来自其它 agent，先重新导出或重新生成后再验证。',
        ],
        details: {
          file: path.resolve(process.cwd(), filePath),
        },
      });
      const result = {
        success: false,
        file: path.resolve(process.cwd(), filePath),
        caseCount: 0,
        errors: [diagnostics.message],
        warnings: [],
        errorCode: diagnostics.code,
        errorType: diagnostics.type,
        recoveryActions: diagnostics.recoveryActions,
        diagnostics,
      };
      printValidationResult(result, jsonMode);
      return 2;
    }
  }

  if (command[0] === 'run' && command[1] === 'task') {
    const requestedPhoneSerial = getOption(command, '--phone');
    const requestedGlassesSerial = getOption(command, '--glasses');
    const requestedEnvironmentRaw = getOption(command, '--env');
    const requestedEnvironment = normalizeSdkEnvironment(requestedEnvironmentRaw);
    const disableScreenMirror = hasFlag(command, '--no-screen-mirror');
    const startOptions = normalizeStartOptionsFromCommand(command);
    const disableReport = hasFlag(command, '--no-report');
    const reportOut = getOption(command, '--report-out');
    const waitForTask = hasFlag(command, '--wait');
    const cliTaskId = createCliTaskId();
    const emitProgress = createCliProgressEmitter(jsonMode);
    const taskName = getOption(command, '--task-name') || `CLI 自动化任务 · ${createTimestamp()}`;

    if (requestedEnvironmentRaw && !requestedEnvironment) {
      const payload = createCliCommandFailurePayload(`Invalid --env value: ${requestedEnvironmentRaw}. Expected PRE, GRAY, STABLE, or ONLINE.`, {
        errorCode: 'ENVIRONMENT_VALUE_INVALID',
        errorType: 'environment-preflight',
        recoveryActions: [
          '把 --env 改为 PRE、GRAY、STABLE 或 ONLINE。',
          '如果不需要切换环境，移除 --env 参数。',
        ],
        extra: {
          requestedEnvironment: requestedEnvironmentRaw,
          allowedValues: ['PRE', 'GRAY', 'STABLE', 'ONLINE'],
        },
      });
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 1;
    }

    try {
      const packageOptions = runPackageOptionsForCli(command);
      const taskSelection = getTaskCasesFromCommand(command);
      const taskCases = taskSelection.cases;
      let validationSummary = {
        selected: taskCases.length,
        passed: 0,
        warnings: 0,
        errors: 0,
      };

      if (taskSelection.missingCaseIds.length || !taskCases.length) {
        const message = taskSelection.missingCaseIds.length
          ? `未找到任务用例：${taskSelection.missingCaseIds.join(', ')}`
          : '自动化任务没有可执行用例。请传入文件或至少一个 --case-id。';
        const payload = createCliCommandFailurePayload(message, {
          errorCode: taskSelection.missingCaseIds.length ? 'CASE_SELECTION_MISSING_CASE' : 'CASE_SELECTION_EMPTY',
          errorType: 'case-selection',
          recoveryActions: [
            '运行 solopi-desktop cases list --json 确认可用 caseId。',
            '如果从文件执行，确认 JSON bundle 可读且包含 cases[]。',
            '至少传入一个有效 --case-id，或传入包含用例的 bundle 文件。',
          ],
          details: {
            missingCaseIds: taskSelection.missingCaseIds,
            selectedCaseCount: taskCases.length,
          },
        });
        payload.phase = 'validation';
        payload.taskId = null;
        payload.validationErrors = [{
          caseId: taskSelection.missingCaseIds[0] || '',
          caseName: '',
          node: 'selection',
          field: 'caseId',
          code: payload.errorCode,
          message,
          recoveryActions: payload.recoveryActions,
        }];
        payload.validationWarnings = [];
        payload.validationSummary = { selected: taskCases.length, passed: 0, warnings: 0, errors: 1 };
        attachCliValidationDiagnosticReport(payload, reportOut);
        if (jsonMode) {
          writeJson(payload);
        } else {
          console.error(payload.error);
          if (payload.reportPackage?.path) {
            console.error(`Report: ${payload.reportPackage.path}`);
          }
        }
        return 1;
      }

      const validation = validateExecutableTaskSelectionForCli(taskSelection);
      validationSummary = validation.validationSummary;

      if (!validation.success) {
        const payload = createCliCommandFailurePayload(
            `用例校验失败：${validation.validationErrors.map((item) => item.message).join('\n')}`,
            {
              errorCode: 'CASE_VALIDATION_FAILED',
              errorType: 'case-validation',
              recoveryActions: [
                '运行 solopi-desktop cases validate <file> --json 查看结构化校验错误。',
                '检查 steps、edges、components 是否完整，旧 UI 用例需确保全局组件可解析。',
                '修复校验错误后重跑同一 run task 命令。',
              ],
              details: {
                validationErrors: validation.validationErrors,
              },
            }
          );
        payload.phase = 'validation';
        payload.validationErrors = validation.validationErrors;
        payload.validationWarnings = validation.validationWarnings;
        payload.validationSummary = validation.validationSummary;
        attachCliValidationDiagnosticReport(payload, reportOut);
        if (jsonMode) {
          writeJson(payload);
        } else {
          console.error(payload.error);
          if (payload.reportPackage?.path) {
            console.error(`Report: ${payload.reportPackage.path}`);
          }
        }
        return 1;
      }

      const requiredDeviceRoles = collectRequiredDeviceRolesForCli(taskSelection);
      if (requestedPhoneSerial) requiredDeviceRoles.add('phone');
      if (requestedGlassesSerial) requiredDeviceRoles.add('glasses');
      if (requestedEnvironment) requiredDeviceRoles.add('phone');
      const requestedPerf = getOptions(command, '--perf').flatMap((value) => String(value || '').split(',')).map((value) => value.trim().toLowerCase());
      for (const role of ['phone', 'glasses']) {
        if (hasFlag(command, `--perf-${role}`) || requestedPerf.includes(role) || requestedPerf.includes('all')) requiredDeviceRoles.add(role);
      }
      for (const role of ['phone', 'glasses']) {
        if (stress?.[`${role}Log`] || startOptions?.[`record${role === 'phone' ? 'Phone' : 'Glasses'}Screen`] || startOptions?.[`show${role === 'phone' ? 'Phone' : 'Glasses'}Screen`]) requiredDeviceRoles.add(role);
      }
      if (requiredDeviceRoles.size > 0) await resolveAdbPathForCli({ preferBridge: true });
      const deviceSelection = requiredDeviceRoles.size > 0
        ? resolveDeviceSerials({ phoneSerial: requestedPhoneSerial, glassesSerial: requestedGlassesSerial })
        : { phoneSerial: '', glassesSerial: '', phone: null, glasses: null, devices: [] };
      // Unused historical bindings must not activate unrelated runtime device checks.
      for (const role of ['phone', 'glasses']) {
        if (!requiredDeviceRoles.has(role)) deviceSelection[`${role}Serial`] = '';
      }
      const { phoneSerial, glassesSerial, devices } = deviceSelection;
      const runDevices = executionDevicesForCli(createRunDevicesInfo(deviceSelection, taskCases[0], packageOptions), taskCases, packageOptions);

      const missingDeviceRoles = validateSelectedDevicesForCli(requiredDeviceRoles, deviceSelection);
      if (missingDeviceRoles.length > 0) {
        const missingLabel = missingDeviceRoles.map((role) => role === 'phone' ? '手机' : '眼镜').join('和');
        const message = `用例需要的${missingLabel}设备未在线（历史绑定不代表连接）。请确认设备已连接到 solopi-desktop/ADB，或通过 --phone/--glasses 指定。`;
        const payload = attachCliTaskReportPackage(
          createCliFailureTaskResult(message, taskCases, {
            taskId: cliTaskId,
            taskName,
            stepName: '选择设备',
            devices: runDevices,
            errorCode: 'DEVICE_PREFLIGHT_NO_MATCH',
            errorType: 'device-preflight',
            recoveryActions: [
              '运行 solopi-desktop doctor --json 确认 CLI 包和状态路径可读。',
              '运行 solopi-desktop devices list --json 查看当前可见设备、默认绑定和 ADB 路径。',
              '确认手机和眼镜已连接并处于 device 状态，或通过 --phone <serial> --glasses <serial> 指定。',
            ],
            details: {
              requestedPhoneSerial,
              requestedGlassesSerial,
              requiredDeviceRoles: [...requiredDeviceRoles],
              availableDeviceCount: devices?.devices?.length || 0,
              missingDeviceRoles,
              selectedSerials: { phoneSerial, glassesSerial },
            },
          }),
          reportOut,
          disableReport
        );
        payload.phase = 'validation';
        payload.taskId = null;
        payload.submitted = false;
        payload.validationSummary = { ...validationSummary, passed: 0, errors: missingDeviceRoles.length };
        payload.validationErrors = missingDeviceRoles.map(role => ({
          code: 'DEVICE_PREFLIGHT_NO_MATCH', field: `defaults.${role}Serial`,
          serial: deviceSelection[`${role}Serial`], message,
        }));
        payload.availableDevices = devices || null;
        if (jsonMode) {
          writeJson(payload);
        } else {
          console.error(payload.error);
          if (payload.reportPackage?.path) {
            console.error(`Report: ${payload.reportPackage.path}`);
          }
        }
        return 1;
      }

      let performanceOptions;
      try {
        performanceOptions = normalizePerformanceOptionsFromCommand(command, taskCases[0], { phoneSerial, glassesSerial, devices: runDevices });
      } catch (error) {
        writeJson({ success: false, submitted: false, taskId: null, phase: 'validation', errorCode: error.code, error: error.message, field: error.field });
        return 1;
      }
    try { assertTaskVisibility(getGlassBoxCliDataDir()); } catch (error) { writeJson({ success: false, submitted: false, taskId: null, errorCode: error.code, error: error.message }); return 1; }
      let environmentSwitchResult = null;
      let runtimeEnvironment = null;
      if (requestedEnvironment) {
        environmentSwitchResult = setSdkEnvironmentForCli({
          serial: phoneSerial,
          packageName: String(getOption(command, '--env-package') || getOption(command, '--package') || packageOptions.phonePackage || getDefaultPhonePackageFromStateOrCase(taskCases[0])).trim(),
          environment: requestedEnvironment,
          forceRestart: hasFlag(command, '--force-env-restart'),
        });

        if (!environmentSwitchResult.success) {
          const payload = attachCliTaskReportPackage(
            createCliFailureTaskResult(`切换环境失败：${environmentSwitchResult.error || requestedEnvironment}`, taskCases, {
              taskId: cliTaskId,
              taskName,
              stepName: '切换运行环境',
              devices: runDevices,
              errorCode: environmentSwitchResult.errorCode || 'ENVIRONMENT_PREFLIGHT_FAILED',
              errorType: environmentSwitchResult.errorType || 'environment-preflight',
              recoveryActions: environmentSwitchResult.recoveryActions || [
                '运行 solopi-desktop env get --json 查看当前目标设备环境。',
                '确认 --env 值为 PRE、GRAY、STABLE 或 ONLINE。',
                '确认目标设备可写入应用数据目录；必要时指定 --env-package。',
              ],
              details: {
                requestedEnvironment,
                environmentSwitch: environmentSwitchResult,
              },
            }),
            reportOut,
            disableReport
          );
          payload.environmentSwitch = environmentSwitchResult;
          if (jsonMode) {
            writeJson(payload);
          } else {
            console.error(payload.error);
            if (payload.reportPackage?.path) {
              console.error(`Report: ${payload.reportPackage.path}`);
            }
          }
          return 1;
        }
      }
      runtimeEnvironment = createCliRuntimeEnvironmentInfo({
        serial: phoneSerial,
        packageName: String(getOption(command, '--env-package') || getOption(command, '--package') || packageOptions.phonePackage || getDefaultPhonePackageFromStateOrCase(taskCases[0])).trim(),
        requestedEnvironment,
        environmentSwitch: environmentSwitchResult,
      });

      const runOptions = {
        taskId: cliTaskId,
        taskName,
        stress,
        ...packageOptions,
        phoneSerial,
        glassesSerial,
        devices: runDevices,
        disableScreenMirror,
        startOptions,
        caseEdges: taskSelection.caseEdges,
        nodePositions: taskSelection.nodePositions,
        assetBaseDir: taskSelection.assetBaseDir,
        sourceRevision: taskSelection.sourceRevision,
        wait: waitForTask,
        onProgress: emitProgress,
        runtimeEnvironment,
      };
      runOptions.performanceOptions = {
        phone: Boolean(performanceOptions.phone),
        glasses: Boolean(performanceOptions.glasses),
        intervalMs: performanceOptions.intervalMs,
        threadStacks: performanceOptions.threadStacks,
        targets: performanceOptions.targets,
      };
      runOptions.validationSummary = validationSummary;
      const performanceCollector = null;
      let result;
      let performanceReports;

      try {
        result = await submitTaskWithHeadlessRunnerForCli(taskCases, runOptions);
      } finally {
        performanceReports = performanceCollector?.stop();
      }

      const parsedTaskResult = parseRunResult(result.stdout) || createCliFailureTaskResult('CLI 自动化任务结果无法解析为 JSON', taskCases, {
        taskId: cliTaskId,
        taskName,
        stepName: '解析任务结果',
        devices: runDevices,
      });
      parsedTaskResult.devices = runDevices;
      parsedTaskResult.validationSummary = validationSummary;
      parsedTaskResult.sourceRevision = taskSelection.sourceRevision;
      parsedTaskResult.validationWarnings = validation.validationWarnings;
      parsedTaskResult.environmentSwitch = environmentSwitchResult || undefined;
      parsedTaskResult.runtimeEnvironment = runtimeEnvironment || undefined;
      if (parsedTaskResult.task) {
        parsedTaskResult.task.devices = runDevices;
        parsedTaskResult.task.runtimeEnvironment = runtimeEnvironment || parsedTaskResult.task.runtimeEnvironment;
        parsedTaskResult.task.performanceOptions = {
          ...runOptions.performanceOptions,
          ...parsedTaskResult.task.performanceOptions,
          phone: Boolean(performanceOptions.phone),
          glasses: Boolean(performanceOptions.glasses),
        };
        parsedTaskResult.task.performanceReports = performanceReports || parsedTaskResult.task.performanceReports;
        parsedTaskResult.task.startOptions = startOptions || parsedTaskResult.task.startOptions;
        parsedTaskResult.task.validationSummary = validationSummary;
        parsedTaskResult.task.sourceRevision = taskSelection.sourceRevision;
      }

      if (!waitForTask) {
        if (reportOut || disableReport) {
          parsedTaskResult.reportPackage = {
            success: false,
            skipped: true,
            reason: 'run task 默认异步提交，不会在提交 CLI 内生成报告包；任务完成后请使用 reports show/tasks show 读取结果。',
          };
        }
        console.log(JSON.stringify(parsedTaskResult, null, 2));
        return parsedTaskResult.success ? 0 : 1;
      }

      const taskResult = attachCliTaskReportPackage(parsedTaskResult, reportOut, disableReport);
      console.log(JSON.stringify(taskResult, null, 2));
      return taskResult.success ? 0 : 1;
    } catch (error) {
      if (error.code === 'PACKAGE_OVERRIDE_INVALID') {
        writeJson({ success: false, submitted: false, taskId: null, phase: 'validation', errorCode: error.code, field: error.field, error: error.message });
        return 1;
      }
      const payload = attachCliTaskReportPackage(
        createCliFailureTaskResult(error instanceof Error ? error.message : String(error), [], {
          taskId: cliTaskId,
          taskName,
          errorCode: error?.code || 'CLI_TASK_FAILED',
          errorType: 'cli',
          recoveryActions: [
            '运行 solopi-desktop doctor --json 做只读健康检查。',
            '确认命令参数、输入文件和 solopi-desktop 数据目录可读。',
            '若错误来自 runner ack，请查看返回 diagnostics 中的 payloadPath、ackPath 和 runner 日志。',
          ],
        }),
        reportOut,
        disableReport
      );
      console.log(JSON.stringify(payload, null, 2));
      return 2;
    }
  }

  if (command[0] === 'run' && command[1] === 'case') {
    const target = command[2];
    if (!target || target.startsWith('--')) {
      const payload = createCliCommandFailurePayload('Missing case target: solopi-desktop run case <case-file|caseId>', {
        errorCode: 'CASE_SELECTION_MISSING_TARGET',
        errorType: 'case-selection',
        recoveryActions: [
          '传入一个 case 文件路径，或传入一个 UI 用例库中的 caseId。',
          '运行 solopi-desktop cases list --json 查看可用 caseId。',
        ],
      });
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 1;
    }

    const targetPath = path.resolve(process.cwd(), target);
    const taskCommand = ['run', 'task'];
    if (fs.existsSync(targetPath)) {
      taskCommand.push(target);
    } else if (/\.json$/i.test(target) || /[\\/]/.test(target)) {
      const payload = createCliCommandFailurePayload(`Case file does not exist: ${targetPath}`, {
        errorCode: 'CASE_SELECTION_FILE_NOT_FOUND',
        errorType: 'case-selection',
        recoveryActions: [
          '确认 case 文件路径存在且当前 agent 有读取权限。',
          '如果想按 UI 用例库 ID 执行，请传入不带路径分隔符的 caseId。',
          '运行 solopi-desktop cases validate <file> --json 先验证本地文件。',
        ],
        extra: {
          file: targetPath,
        },
      });
      if (jsonMode) {
        writeJson(payload);
      } else {
        console.error(payload.error);
      }
      return 2;
    } else {
      taskCommand.push('--case-id', target);
    }
    taskCommand.push(...command.slice(3));
    return run(taskCommand);
  }

  console.error(`Unknown command: ${command.join(' ')}`);
  printHelp();
  return 1;
}

export {
  buildCaseLibraryRequestForCli,
  runPackageOptionsForCli,
  resolveRunPackageForCli,
  executionDevicesForCli,
  createCliPayload,
  taskCleanupRequest,
  taskCleanupWithBrokerForCli,
  quickActionWithBrokerForCli,
  validateSelectedDevicesForCli,
  collectRequiredDeviceRolesForCli,
  resolveDeviceSerials,
  createRunDevicesInfo,
  normalizeStressOptionsFromCommand,
  installCodexSkill,
  createCliTaskPayload,
  createReportPackageFromTask,
  createReportSummaryPayloadForCli,
  caseQueryOptionsForCli,
  getDoctorPayloadForCli,
  getReportsReindexPayloadForCli,
  createCliCommandFailurePayload,
  createCliFailureTaskResult,
  writeCaseLibraryWorkspaceForCli,
  collectCaseLibraryWorkspaceForCli,
  createMergedComponentsForCli,
  getCaseLibrariesPayloadForCli,
  getCaseLibraryPullPayloadForCli,
  getCaseLibraryPushPayloadForCli,
  getListedComponentsForCli,
  getCaseDetailPayloadForCli,
  getCaseReportPayloadForCli,
  getTaskCasesFromCommand,
  parseCaseLibraryFilesForCli,
  mergePulledCaseLibraryIntoStateForCli,
  getTaskDetailPayloadForCli,
  getTasksQueryPayloadForCli,
  getTaskRunnerStatusForCli,
  probeProcessLivenessForCli,
  normalizePerformanceOptionsFromCommand,
  persistStoppedTaskForCli,
  stopTaskWithLocalFallbackForCli,
  runTaskWithHeadlessRunner,
  waitForHeadlessTaskCompletionForCli,
  watchTaskEventsForCli,
  summarizeReportCaseForCli,
  summarizeTaskForCli,
  validatePayload,
  validateExecutableTaskSelectionForCli,
  validateCaseEdgesForCli,
  readSdkEnvironmentForCli,
  setSdkEnvironmentForCli,
};

if (process.argv[1] && !process.argv[1].startsWith('-') && fs.existsSync(path.resolve(process.argv[1])) && fs.realpathSync(path.resolve(process.argv[1])) === fs.realpathSync(CLI_SCRIPT_PATH)) {
  process.exitCode = await run(process.argv.slice(2));
}
