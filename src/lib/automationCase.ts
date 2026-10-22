import { normalizeCaseFailurePolicy } from '../../electron/workflow-failure-policy';
export type AutomationStepType =
  | 'start'
  | 'if'
  | 'component'
  | 'launch_test_page'
  | 'broadcast_scene'
  | 'http_request'
  | 'llm_text_generate'
  | 'tts_synthesize'
  | 'send_audio'
  | 'wait'
  | 'push_audio'
  | 'debug_forward'
  | 'rpc_assert'
  | 'end';

export type AutomationDeviceRole = 'phone' | 'glasses' | 'pc';
export type ComponentParamInputType = 'text' | 'textarea' | 'number' | 'json';
export type TestComponentKind = 'adb' | 'pc_command' | 'activity' | 'audio' | 'image_mock' | 'mobile_ui_action' | 'mobile_ui_assert' | 'tts_assert' | 'json_assert' | 'llm_assert';

export interface ComponentParam {
  key: string;
  label: string;
  inputType: ComponentParamInputType;
  templateMode?: 'resolve' | 'literal';
  defaultValue?: string;
  placeholder?: string;
  helperText?: string;
  required?: boolean;
}

export interface TestComponent {
  id: string;
  name: string;
  description?: string;
  tags?: string[];
  legacyBusiness?: boolean;
  platformScope?: string;
  replacementHint?: string;
  kind?: TestComponentKind;
  device: AutomationDeviceRole;
  commandTemplate: string;
  params: ComponentParam[];
  timeoutSeconds: number;
  resultAssertions?: unknown;
}

export function isLegacyBusinessComponent(component?: Pick<TestComponent, 'legacyBusiness' | 'platformScope'> | null) {
  return Boolean(component?.legacyBusiness || component?.platformScope === 'legacy-business-compatibility');
}

export interface AutomationStep {
  id: string;
  name: string;
  type: AutomationStepType;
  device: AutomationDeviceRole;
  componentId?: string;
  inputs?: Record<string, string>;
  config: Record<string, unknown>;
  timeoutMs?: number;
  postDelayMs?: number;
  retry?: number;
  continueOnError?: boolean;
  acceptedExitCodes?: number[];
  onError?: 'fail' | 'continue' | 'branch';
  outputMapping?: Record<string, unknown>;
}

export interface AutomationCase {
  assetBaseDir?: string;
  schemaVersion: 'glassbox.workflow.v1';
  id: string;
  name: string;
  folderId?: string;
  libraryId?: string;
  description?: string;
  tags?: string[];
  reviewStatus?: 'draft' | 'confirmed';
  conversionSource?: CaseConversionSource;
  variables?: Record<string, unknown>;
  defaults?: {
    phonePackage?: string;
    glassesPackage?: string;
    phoneSerial?: string;
    glassesSerial?: string;
  };
  components?: TestComponent[];
  steps: AutomationStep[];
}

export type CaseConversionSourceType = 'prd' | 'interaction' | 'flowchart' | 'screenshot' | 'mixed' | 'solopi';

export interface CaseConversionSource {
  type: CaseConversionSourceType;
  title?: string;
  summary?: string;
  rawText?: string;
  createdAt: string;
}


export interface ConversationalCaseDraftInput {
  userMessage: string;
  conversation: Array<{
    role: 'user' | 'assistant';
    content: string;
  }>;
  currentCase?: AutomationCase;
  folderId?: string;
  defaults?: AutomationCase['defaults'];
}

export interface ConversationalCaseDraftResponse {
  reply: string;
  draftCases: AutomationCase[];
  questions?: string[];
}

export interface WorkflowRunResult {
  success: boolean;
  results: Array<{
    stepId: string;
    stepName: string;
    status: 'success' | 'failed' | 'skipped' | 'stopped';
    startedAt: string;
    completedAt?: string;
    endedAt: string;
    command?: string;
    stdout?: string;
    stderr?: string;
    error?: string;
    meta?: Record<string, unknown>;
  }>;
  artifacts?: {
    runDir: string;
    logs: Array<{
      deviceType: 'phone' | 'glasses' | string;
      serial: string;
      path: string;
      error?: string;
    }>;
    recordings?: Array<{
      deviceType: 'phone' | 'glasses' | string;
      serial: string;
      path: string;
      remotePath?: string;
      success: boolean;
      error?: string;
      errorCode?: string;
      command?: string;
      sizeBytes?: number;
      exitCode?: number | null;
      signal?: string | null;
      scrcpyOutput?: string;
      recoveryActions?: string[];
      diagnostics?: {
        schemaVersion: string;
        errorCode: string;
        errorType: string;
        message: string;
        recoveryActions: string[];
        details: Record<string, unknown>;
      } | null;
    }>;
    screenMirrors?: Array<{
      status?: 'ready' | 'stopped' | 'interrupted' | 'failed';
      deviceType: 'phone' | 'glasses' | string;
      serial: string;
      path?: string;
      success: boolean;
      ready: boolean;
      error?: string;
      errorCode?: string;
      command?: string;
      exitCode?: number | null;
      signal?: string | null;
      scrcpyOutput?: string;
      recoveryActions?: string[];
      diagnostics?: {
        schemaVersion: string;
        errorCode: string;
        errorType: string;
        message: string;
        recoveryActions: string[];
        details: Record<string, unknown>;
      } | null;
    }>;
    screenshots?: Array<{
      deviceType: 'phone' | 'glasses' | string;
      serial: string;
      path: string;
      stepId?: string;
      stepName?: string;
      success: boolean;
      error?: string;
    }>;
    pushedAudioFiles?: Array<{
      stepId?: string;
      stepName?: string;
      serial: string;
      localPath?: string;
      pushedLocalPath?: string;
      sourceLocalPath?: string;
      remotePath: string;
      sourceType?: string;
      outputFormat?: string;
      sampleFormat?: string;
      sampleRate?: number | string;
      channelCnt?: number | string;
      trailingSilenceMs?: number | string;
      audioMetrics?: {
        schemaVersion: string;
        audioDurationMs: number | null;
        trailingSilenceMs: number;
        preparedAudioDurationMs: number | null;
        injectionDurationMs: number | null;
        injectionDurationSource: string;
        sampleRate?: number;
        channelCnt?: number;
        bytesPerSample?: number;
        sourceBytes?: number;
        preparedBytes?: number;
      };
      transcode?: {
        sourcePath?: string;
        path?: string;
        outputFormat?: string;
        sampleFormat?: string;
        sampleRate?: number | string;
        channelCnt?: number | string;
        trailingSilenceMs?: number | string;
        preparedAudioDurationMs?: number | null;
      } | null;
      tts?: {
        provider?: string;
        path?: string;
        url?: string;
        sourceUrl?: string;
        size?: number;
      } | null;
    }>;
    generatedTtsAudioFiles?: Array<{
      stepId?: string;
      stepName?: string;
      nodeKey?: string;
      text?: string;
      localPath?: string;
      url?: string;
      sourceUrl?: string;
      size?: number;
      sha256?: string;
      mimeType?: string;
      extension?: string;
      sampleRate?: number | string;
      sampleFormat?: string;
      channelCnt?: number | string;
      provider?: string;
      variable?: string;
      urlVariable?: string;
    }>;
    pushedImageFiles?: Array<{
      serial: string;
      localPath: string;
      remotePath: string;
      sourceType?: string;
      source?: string;
    }>;
    cleanup?: Array<{
      serial: string;
      remotePath: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }>;
    imageCleanup?: Array<{
      serial: string;
      remotePath: string;
      success: boolean;
      skipped?: boolean;
      error?: string;
    }>;
  };
  error?: string;
  stopped?: boolean;
}

export const stepTypeLabels: Record<AutomationStepType, string> = {
  start: '开始',
  if: '条件分支',
  component: '测试组件',
  launch_test_page: '启动测试页',
  broadcast_scene: '唤起测试场景',
  http_request: 'HTTP 接口请求',
  llm_text_generate: 'LLM 文本生成',
  tts_synthesize: 'TTS 音频合成',
  send_audio: '发送音频',
  wait: '等待',
  push_audio: '推送音频',
  debug_forward: 'DebugServer 转发',
  rpc_assert: 'RPC 日志校验',
  end: '结束',
};

export const stepTypeDescriptions: Record<AutomationStepType, string> = {
  start: '标记用例执行入口',
  if: '根据 {{variables.xxx}} 或 {{nodeOutputs.xxx}} 选择 true/false 分支',
  component: '引用测试组件管理中定义的通用组件',
  launch_test_page: '通过 am start 拉起调试 Activity',
  broadcast_scene: '通过广播进入被测应用的指定测试场景',
  http_request: '在电脑侧请求 HTTP 接口，并把响应写入运行时变量',
  llm_text_generate: '调用设置中心模型配置生成文本，并写入运行时变量',
  tts_synthesize: '提前调用 HTTP TTS 合成音频，并写入运行时变量',
  send_audio: '广播 audio_path，模拟用户语音输入',
  wait: '等待 SDK、语音识别或页面状态变化',
  push_audio: '把本地音频推送到设备',
  debug_forward: '启动测试页并转发 8080 调试端口',
  rpc_assert: '检查 DebugServer RPC 日志',
  end: '标记用例结束，并配置执行后的收尾动作',
};

export function createStepId(type: AutomationStepType) {
  return `${type}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createComponentId() {
  return `adb_command-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

export function createDefaultComponent(kind: TestComponentKind = 'adb'): TestComponent {
  if (kind === 'pc_command') {
    return {
      id: createComponentId(),
      name: '新建通用 PC 命令组件',
      description: '在运行 solopi-desktop 的当前电脑执行命令，不依赖手机或眼镜设备',
      tags: ['pc', 'command'],
      kind: 'pc_command',
      device: 'pc',
      timeoutSeconds: 30,
      commandTemplate: '',
      params: [],
    };
  }

  if (kind === 'activity') {
    return {
      id: createComponentId(),
      name: '新建拉起 Activity 组件',
      description: '拉起指定 Activity，并校验 Activity 已进入前台',
      tags: ['activity'],
      kind: 'activity',
      device: 'phone',
      timeoutSeconds: 5,
      commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}}',
      params: [
        {
          key: 'packageName',
          label: '包名',
          inputType: 'text',
          defaultValue: '${defaults.phonePackage}',
          helperText: '目标 App 包名',
        },
        {
          key: 'activity',
          label: 'Activity',
          inputType: 'text',
          defaultValue: '',
          helperText: '支持完整类名或 .MainActivity',
        },
      ],
    };
  }

  if (kind === 'audio') {
    return {
      id: createComponentId(),
      name: '新建音频输入组件',
      description: '录入音频、推送到设备并执行可配置 ADB 命令触发模拟输入',
      tags: ['audio'],
      kind: 'audio',
      device: 'phone',
      timeoutSeconds: 30,
      commandTemplate: '',
      params: [
        {
          key: 'pathExtraKey',
          label: '路径 Extra Key',
          inputType: 'text',
          defaultValue: 'audio_path',
          helperText: '广播中承载音频路径的 extra key',
        },
        {
          key: 'sourceType',
          label: '音频选择',
          inputType: 'text',
          defaultValue: 'file',
          helperText: 'file / record / tts',
        },
        {
          key: 'outputFormat',
          label: '最终音频格式',
          inputType: 'text',
          defaultValue: 'pcm',
          helperText: 'pcm / wav / ogg (Opus) / speex (Ogg .spx)；Speex 支持 8/16/32kHz，预编码文件直传时尾部静音设为 0',
        },
        {
          key: 'sampleFormat',
          label: '采样格式',
          inputType: 'text',
          defaultValue: 'AV_SAMPLE_FMT_S16',
          helperText: '默认 AV_SAMPLE_FMT_S16',
        },
        {
          key: 'sampleRate',
          label: '采样率',
          inputType: 'number',
          defaultValue: '16000',
          helperText: '默认 16000 Hz',
        },
        {
          key: 'trailingSilenceMs',
          label: '尾部静音（ms）',
          inputType: 'number',
          defaultValue: '800',
          helperText: '在实际注入音频尾部追加静音，默认 800ms；可配置 0–60000ms',
        },
        {
          key: 'localPath',
          label: '本地音频文件',
          inputType: 'text',
          defaultValue: '',
        },
        {
          key: 'remotePath',
          label: '音频 push 路径',
          inputType: 'text',
          defaultValue: '/sdcard/Android/data/${defaults.phonePackage}/files/',
        },
        {
          key: 'ttsText',
          label: 'TTS 文本',
          inputType: 'textarea',
          defaultValue: '',
        },
      ],
    };
  }

  if (kind === 'image_mock') {
    return {
      id: createComponentId(),
      name: '新建图片 Mock 组件',
      description: '选择电脑图片或网络图片，推送到指定设备后执行可配置 Mock指令',
      tags: ['image', 'mock', 'adb'],
      kind: 'image_mock',
      device: 'phone',
      timeoutSeconds: 30,
      commandTemplate: 'adb -s {{serial}} shell "am broadcast -a {{action}} --es {{pathExtraKey}} \\"{{remoteImagePath}}\\" {{extraArgs}}"',
      params: [
        {
          key: 'action',
          label: '广播 Action',
          inputType: 'text',
          defaultValue: '',
          helperText: '由业务组件包或用例填写，例如被测应用的图片 Mock 广播',
        },
        {
          key: 'pathExtraKey',
          label: '路径 Extra Key',
          inputType: 'text',
          defaultValue: 'mockImagePath',
          helperText: '广播中承载图片路径的 extra key',
        },
        {
          key: 'extraArgs',
          label: '额外参数',
          inputType: 'text',
          defaultValue: '',
          helperText: '可追加 --es/--ez 等通用 am broadcast 参数',
        },
        {
          key: 'imagePath',
          label: '图片路径或 URL',
          inputType: 'text',
          defaultValue: '',
          helperText: '支持电脑本地图片或 http/https URL；保存到 Git 时本地图片会自动归档到 assets/images',
        },
        {
          key: 'pushDevice',
          label: '图片推送设备',
          inputType: 'text',
          defaultValue: 'glasses',
          helperText: 'phone / glasses；默认推送到眼镜设备',
        },
        {
          key: 'remoteImagePath',
          label: '设备侧图片路径',
          inputType: 'text',
          defaultValue: '/sdcard/Android/data/${defaults.glassesPackage}/files/',
          helperText: '第三步 Mock指令可用 {{remoteImagePath}} 引用该路径',
        },
        {
          key: 'commandDevice',
          label: '执行设备',
          inputType: 'text',
          defaultValue: 'phone',
          helperText: 'phone / glasses / pc；默认在手机设备执行，本机 PC 使用本地命令',
        },
      ],
    };
  }

  if (kind === 'mobile_ui_action') {
    return {
      id: createComponentId(),
      name: '手机 UI 操作',
      description: '基于手机当前 UI 元素执行点击、输入、滑动或返回',
      tags: ['mobile', 'ui', 'action'],
      kind: 'mobile_ui_action',
      device: 'phone',
      timeoutSeconds: 10,
      commandTemplate: '',
      params: [
        { key: 'direction', label: '手指滑动方向', inputType: 'text', defaultValue: 'up' },
        { key: 'distancePercent', label: '滑动距离(元素百分比)', inputType: 'number', defaultValue: '100' },
        { key: 'swipeDurationMs', label: '滑动时长(ms)', inputType: 'number', defaultValue: '300' },
        {
          key: 'action',
          label: '操作类型',
          inputType: 'text',
          defaultValue: 'tap',
          helperText: 'tap / input / swipe / back / home',
        },
        {
          key: 'selector',
          label: '元素选择器',
          inputType: 'json',
          defaultValue: '{\n  "resourceId": "",\n  "text": "",\n  "contentDesc": "",\n  "className": "",\n  "bounds": "",\n  "xRatio": "",\n  "yRatio": ""\n}',
          helperText: '点击/输入优先按 resourceId、text、contentDesc、className 匹配；bounds/xRatio/yRatio 仅兜底',
        },
        {
          key: 'inputText',
          label: '输入文本',
          inputType: 'text',
          defaultValue: '',
          helperText: 'action=input 时必填',
        },
        {
          key: 'tapPosition',
          label: '元素内点击位置',
          inputType: 'text',
          defaultValue: 'center',
          helperText: 'center / top-left / top-right / bottom-left / bottom-right',
        },
        {
          key: 'tapInsetXPx',
          label: '横向内缩(px)',
          inputType: 'number',
          defaultValue: '5',
          helperText: '四角点击时沿横向从元素边缘向内偏移；默认 5px',
        },
        {
          key: 'tapInsetYPx',
          label: '纵向内缩(px)',
          inputType: 'number',
          defaultValue: '5',
          helperText: '四角点击时沿纵向从元素边缘向内偏移；默认 5px',
        },
        {
          key: 'clearBeforeInput',
          label: '输入前清空',
          inputType: 'text',
          defaultValue: 'false',
          helperText: 'true / false',
        },
        {
          key: 'matchMode',
          label: '匹配方式',
          inputType: 'text',
          defaultValue: 'auto',
          helperText: 'auto / contains / exact',
        },
        {
          key: 'pollIntervalMs',
          label: '轮询间隔(ms)',
          inputType: 'number',
          defaultValue: '250',
          helperText: '点击/输入等待元素时的 UI 树抓取间隔，建议 120-500ms',
        },
        {
          key: 'swipe',
          label: '滑动参数',
          inputType: 'json',
          defaultValue: '{\n  "startXRatio": "0.5",\n  "startYRatio": "0.8",\n  "endXRatio": "0.5",\n  "endYRatio": "0.2",\n  "durationMs": "400"\n}',
          helperText: 'action=swipe 时使用，相对当前屏幕宽高计算坐标',
        },
      ],
    };
  }

  if (kind === 'mobile_ui_assert') {
    return {
      id: createComponentId(),
      name: '手机 UI 元素校验',
      description: '校验手机当前页面在超时时间内出现指定元素',
      tags: ['mobile', 'ui', 'assert'],
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
          helperText: '优先按 resourceId、text、contentDesc、className 匹配',
        },
        {
          key: 'matchMode',
          label: '匹配方式',
          inputType: 'text',
          defaultValue: 'auto',
          helperText: 'auto / contains / exact',
        },
        {
          key: 'pollIntervalMs',
          label: '轮询间隔(ms)',
          inputType: 'number',
          defaultValue: '250',
          helperText: '断言会在超时时间内持续抓取 UI 树，命中任意一次即通过',
        },
        {
          key: 'captureScreenshotOnPass',
          label: '检测时截屏',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false；无论检测通过或失败都截取手机屏幕',
        },
      ],
    };
  }

  if (kind === 'tts_assert') {
    return {
      id: createComponentId(),
      name: '新建日志文本提取断言组件',
      description: '从日志中提取文本，并与期望文本进行比对',
      tags: ['assert', 'tts', 'logcat'],
      kind: 'tts_assert',
      device: 'glasses',
      timeoutSeconds: 10,
      commandTemplate: '',
      params: [
        {
          key: 'sampleLog',
          label: '日志样例',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '粘贴一条包含目标文本的完整日志',
        },
        {
          key: 'extractRegex',
          label: '提取正则',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '需包含命名捕获组 (?<ttsText>...) 或第一个捕获组',
        },
        {
          key: 'sampleExtractText',
          label: '提取内容样例',
          inputType: 'text',
          defaultValue: '',
          helperText: '从日志样例中需要被提取出来的文案片段',
        },
        {
          key: 'expectedText',
          label: '期望文本',
          inputType: 'text',
          defaultValue: '${variables.expectedTtsText}',
          helperText: '从日志提取出的文本需要与该值比对',
        },
        {
          key: 'matchOperator',
          label: '比较方式',
          inputType: 'text',
          defaultValue: 'equals',
          helperText: 'equals / contains',
        },
        {
          key: 'caseSensitive',
          label: '区分大小写',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false',
        },
        {
          key: 'clearBeforeStart',
          label: '断言前清理历史日志',
          inputType: 'text',
          defaultValue: 'false',
          helperText: 'true：仅匹配本节点开始后的日志；false：保留本用例本轮已采集日志（默认）。不删除共享日志文件，也不读取上一轮日志。',
        },
        {
          key: 'captureScreenshotOnPass',
          label: '检测时截屏',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false；无论检测通过或失败都会截屏',
        },
        {
          key: 'extractVariableEnabled',
          label: '提取为变量',
          inputType: 'text',
          defaultValue: 'false',
          helperText: '默认关闭；开启后断言通过时把正则提取出的文本写入变量',
        },
        {
          key: 'extractVariableName',
          label: '变量名',
          inputType: 'text',
          defaultValue: '',
          helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
        },
      ],
    };
  }

  if (kind === 'json_assert') {
    return {
      id: createComponentId(),
      name: '新建 JSON 日志断言组件',
      description: '用正则定位 logcat 日志，递归解析 JSON 后校验字段条件',
      tags: ['assert', 'json', 'logcat'],
      kind: 'json_assert',
      device: 'glasses',
      timeoutSeconds: 45,
      commandTemplate: '',
      params: [
        {
          key: 'lineRegex',
          label: 'JSON 提取正则',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '用捕获组圈出 JSON；可以在组件配置里通过日志原文和提取内容生成',
        },
        {
          key: 'conditions',
          label: '字段条件',
          inputType: 'json',
          defaultValue: '[]',
          helperText: 'UI 中以条件行维护；operator 支持 equals / notEquals / contains / notContains / regex / notRegex / exists / notExists',
        },
        {
          key: 'caseSensitive',
          label: '正则区分大小写',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false',
        },
        {
          key: 'clearBeforeStart',
          label: '断言前清理历史日志',
          inputType: 'text',
          defaultValue: 'false',
          helperText: 'true：仅匹配本节点开始后的日志；false：保留本用例本轮已采集日志（默认）。不删除共享日志文件，也不读取上一轮日志。',
        },
        {
          key: 'captureScreenshotOnPass',
          label: '检测时截屏',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false；无论检测通过或失败都会截屏',
        },
        {
          key: 'extractVariableEnabled',
          label: '提取为变量',
          inputType: 'text',
          defaultValue: 'false',
          helperText: '默认关闭；开启后断言通过时把当前正则提取出的 JSON 写入变量',
        },
        {
          key: 'extractVariableName',
          label: '变量名',
          inputType: 'text',
          defaultValue: '',
          helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
        },
      ],
    };
  }

  if (kind === 'llm_assert') {
    return {
      id: createComponentId(),
      name: '新建 LLM 语义断言组件',
      description: '把运行时变量、当前日志和用户断言诉求交给大模型判断，输出 pass/fail',
      tags: ['assert', 'llm', 'logcat'],
      kind: 'llm_assert',
      device: 'glasses',
      timeoutSeconds: 20,
      commandTemplate: '',
      params: [
        {
          key: 'providerId',
          label: '模型配置',
          inputType: 'text',
          defaultValue: '',
          helperText: '为空时使用设置中心默认模型',
        },
        {
          key: 'sampleLog',
          label: '日志样例',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '粘贴一条完整日志，用于生成当前日志匹配正则',
        },
        {
          key: 'samplePayload',
          label: '提取内容',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '粘贴日志里需要交给 LLM 判断的 JSON 或文本片段',
        },
        {
          key: 'lineRegex',
          label: '当前日志匹配正则',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '用于定位当前日志；命中日志会交给 LLM 判断',
        },
        { key: 'llmTimeoutMs', label: 'LLM 判断超时（毫秒）', inputType: 'number', defaultValue: '15000', helperText: '每次请求独立计时；每条候选最多请求3次，最多判断3条候选。' },
        {
          key: 'waitingStates',
          label: '等待状态（JSON）',
          inputType: 'textarea',
          defaultValue: '[]',
          helperText: '按提取 JSON 的字段精确匹配等待状态；其余结果均交给 LLM，包括错误结果。',
        },
        {
          key: 'assertionPrompt',
          label: '断言诉求',
          inputType: 'textarea',
          defaultValue: '请根据前置提取的数据 {{variables.extractedJson}} 和当前日志内容，判断当前状态是否符合预期。请重点核对关键字段是否一致；如果不一致，请在 reason 中说明差异。',
          helperText: '只写判断诉求；solopi-desktop 会隐式要求模型返回 pass:boolean。变量引用使用 {{variables.xxx.path}}',
        },
        {
          key: 'caseSensitive',
          label: '正则区分大小写',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false',
        },
        {
          key: 'clearBeforeStart',
          label: '断言前清理历史日志',
          inputType: 'text',
          defaultValue: 'false',
          helperText: 'true：仅匹配本节点开始后的日志；false：保留本用例本轮已采集日志（默认）。不删除共享日志文件，也不读取上一轮日志。',
        },
        {
          key: 'temperature',
          label: 'Temperature',
          inputType: 'number',
          defaultValue: '0.1',
          helperText: '建议保持低温度，减少断言波动',
        },
        {
          key: 'maxTokens',
          label: '最大输出 Token',
          inputType: 'number',
          defaultValue: '4096',
        },
        {
          key: 'captureScreenshotOnPass',
          label: '检测时截屏',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false；无论检测通过或失败都会截屏',
        },
        {
          key: 'extractVariableEnabled',
          label: '提取为变量',
          inputType: 'text',
          defaultValue: 'false',
          helperText: '默认关闭；开启后断言通过时把当前日志正则提取出的内容写入变量',
        },
        {
          key: 'extractVariableName',
          label: '变量名',
          inputType: 'text',
          defaultValue: '',
          helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
        },
      ],
    };
  }

  return {
    id: createComponentId(),
    name: '新建 ADB 命令组件',
    description: '通过占位符定义可复用的 ADB 命令',
    tags: [],
    kind: 'adb',
    device: 'phone',
    timeoutSeconds: 10,
    commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}}',
    params: [
      {
        key: 'packageName',
        label: '包名',
        inputType: 'text',
        defaultValue: '${defaults.phonePackage}',
        helperText: '目标 App 包名，对应命令里的 {{packageName}}',
      },
      {
        key: 'activity',
        label: 'Activity',
        inputType: 'text',
        defaultValue: '',
        helperText: '目标 Activity，对应命令里的 {{activity}}',
      },
    ],
  };
}

export function createDefaultComponents(): TestComponent[] {
  return [
    {
      id: 'template-pc-command',
      name: '通用 PC 命令',
      description: '在运行 solopi-desktop 的当前电脑执行命令，不依赖手机或眼镜设备',
      tags: ['pc', 'command'],
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
      tags: ['activity'],
      kind: 'activity',
      device: 'phone',
      timeoutSeconds: 5,
      commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}}',
      params: [
        {
          key: 'packageName',
          label: '包名',
          inputType: 'text',
          defaultValue: '${defaults.phonePackage}',
          helperText: '目标 App 包名',
        },
        {
          key: 'activity',
          label: 'Activity',
          inputType: 'text',
          defaultValue: '',
          helperText: '支持完整类名或 .MainActivity',
        },
      ],
    },
    {
      id: 'component-launch-test-page',
      name: '拉起调试 Activity',
      description: '通过通用 am start 命令打开被测应用的调试 Activity',
      tags: ['debug', 'activity'],
      kind: 'adb',
      device: 'phone',
      timeoutSeconds: 10,
      commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}} {{intentArgs}}',
      params: [
        {
          key: 'packageName',
          label: '包名',
          inputType: 'text',
          defaultValue: '${defaults.phonePackage}',
          helperText: '目标 App 包名',
        },
        {
          key: 'activity',
          label: 'Activity',
          inputType: 'text',
          defaultValue: '',
          helperText: '要启动的 Activity',
        },
        {
          key: 'intentArgs',
          label: 'Intent 参数',
          inputType: 'text',
          defaultValue: '',
          helperText: '可选，例如 -a action 或 --es key value',
        },
      ],
    },
    {
      id: 'component-scanpay',
      name: '旧业务广播场景',
      description: '历史业务兼容组件：通过广播进入旧业务测试场景，默认组件列表不展示',
      tags: ['payment', 'broadcast'],
      legacyBusiness: true,
      platformScope: 'legacy-business-compatibility',
      replacementHint: 'Use a generic ADB broadcast component and keep business-specific action/params in a business case bundle.',
      kind: 'adb',
      device: 'glasses',
      timeoutSeconds: 10,
      commandTemplate: "adb -s {{serial}} shell \"am broadcast -a {{action}} --es params '{{params}}'\"",
      params: [
        {
          key: 'action',
          label: 'Action',
          inputType: 'text',
          defaultValue: '',
        },
        {
          key: 'params',
          label: 'Params',
          inputType: 'json',
          defaultValue: '',
          helperText: '会替换命令中的 {{params}}',
        },
      ],
    },
    {
      id: 'component-send-confirm-audio',
      name: '音频输入与模拟',
      description: '录入音频、推送到设备并执行可配置 ADB 命令触发模拟输入',
      tags: ['audio', 'record', 'broadcast'],
      kind: 'audio',
      device: 'phone',
      timeoutSeconds: 30,
      commandTemplate: 'adb -s {{serial}} shell am broadcast -a {{action}} --es "{{pathExtraKey}}" "{{remotePath}}"',
      params: [
        {
          key: 'action',
          label: '广播 Action',
          inputType: 'text',
          defaultValue: '',
          helperText: '由业务组件包或用例填写，例如被测应用的音频注入广播',
        },
        {
          key: 'pathExtraKey',
          label: '路径 Extra Key',
          inputType: 'text',
          defaultValue: 'audio_path',
          helperText: '广播中承载音频路径的 extra key',
        },
        {
          key: 'sourceType',
          label: '音频来源',
          inputType: 'text',
          defaultValue: 'file',
          helperText: 'file / record / tts',
        },
        {
          key: 'outputFormat',
          label: '最终音频格式',
          inputType: 'text',
          defaultValue: 'pcm',
          helperText: 'pcm / wav / ogg',
        },
        {
          key: 'sampleFormat',
          label: '采样格式',
          inputType: 'text',
          defaultValue: 'AV_SAMPLE_FMT_S16',
          helperText: '默认 AV_SAMPLE_FMT_S16',
        },
        {
          key: 'sampleRate',
          label: '采样率',
          inputType: 'number',
          defaultValue: '16000',
          helperText: '默认 16000 Hz',
        },
        {
          key: 'trailingSilenceMs',
          label: '尾部静音（ms）',
          inputType: 'number',
          defaultValue: '800',
          helperText: '在实际注入音频尾部追加静音，默认 800ms；可配置 0–60000ms',
        },
        {
          key: 'localPath',
          label: '本地音频文件',
          inputType: 'text',
          defaultValue: '',
        },
        {
          key: 'remotePath',
          label: '手机内音频路径',
          inputType: 'text',
          defaultValue: '/sdcard/Android/data/${defaults.phonePackage}/files/',
        },
        {
          key: 'ttsText',
          label: 'TTS 文本',
          inputType: 'textarea',
          defaultValue: '',
        },
      ],
    },
    {
      id: 'component-image-mock',
      name: '旧业务图片 Mock',
      description: '历史业务兼容组件：推送图片并通过旧业务广播注入 mock 图片路径，默认组件列表不展示',
      tags: ['image', 'mock', 'adb'],
      legacyBusiness: true,
      platformScope: 'legacy-business-compatibility',
      replacementHint: 'Use a generic image/mock component and keep business-specific broadcast params in a business case bundle.',
      kind: 'image_mock',
      device: 'phone',
      timeoutSeconds: 30,
      commandTemplate: '',
      params: [
        {
          key: 'imagePath',
          label: '图片路径或 URL',
          inputType: 'text',
          defaultValue: '',
          helperText: '支持电脑本地图片或 http/https URL；保存到 Git 时本地图片会自动归档到 assets/images',
        },
        {
          key: 'pushDevice',
          label: '图片推送设备',
          inputType: 'text',
          defaultValue: 'glasses',
          helperText: 'phone / glasses；默认推送到眼镜设备',
        },
        {
          key: 'remoteImagePath',
          label: '设备侧图片路径',
          inputType: 'text',
          defaultValue: '/sdcard/Android/data/${defaults.glassesPackage}/files/',
          helperText: '第三步 Mock指令可用 {{remoteImagePath}} 引用该路径',
        },
        {
          key: 'commandDevice',
          label: '执行设备',
          inputType: 'text',
          defaultValue: 'phone',
          helperText: 'phone / glasses / pc；默认在手机设备执行，本机 PC 使用本地命令',
        },
        {
          key: 'payinitasr',
          label: 'PAY_INIT_ASR',
          inputType: 'text',
          defaultValue: '支付一分钱',
          helperText: '会替换默认命令里的 {{payinitasr}}',
        },
      ],
    },
    {
      id: 'component-tts-text-assert',
      name: '日志文本提取断言',
      description: '从 logcat 中提取文本，并与期望文本比对',
      tags: ['assert', 'tts', 'logcat'],
      kind: 'tts_assert',
      device: 'glasses',
      timeoutSeconds: 10,
      commandTemplate: '',
      params: [
        {
          key: 'sampleLog',
          label: '日志样例',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '粘贴一条包含目标文本的完整日志',
        },
        {
          key: 'extractRegex',
          label: '提取正则',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '需包含命名捕获组 (?<ttsText>...) 或第一个捕获组',
        },
        {
          key: 'sampleExtractText',
          label: '提取内容样例',
          inputType: 'text',
          defaultValue: '',
          helperText: '从日志样例中需要被提取出来的文案片段',
        },
        {
          key: 'expectedText',
          label: '期望文本',
          inputType: 'text',
          defaultValue: '${variables.expectedTtsText}',
          helperText: '用例执行时要校验的日志文本',
        },
        {
          key: 'matchOperator',
          label: '比较方式',
          inputType: 'text',
          defaultValue: 'equals',
          helperText: 'equals / contains',
        },
        {
          key: 'caseSensitive',
          label: '区分大小写',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false',
        },
        {
          key: 'clearBeforeStart',
          label: '断言前清理历史日志',
          inputType: 'text',
          defaultValue: 'false',
          helperText: 'true：仅匹配本节点开始后的日志；false：保留本用例本轮已采集日志（默认）。不删除共享日志文件，也不读取上一轮日志。',
        },
        {
          key: 'captureScreenshotOnPass',
          label: '检测时截屏',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false；无论检测通过或失败都会截屏',
        },
        {
          key: 'extractVariableEnabled',
          label: '提取为变量',
          inputType: 'text',
          defaultValue: 'false',
          helperText: '默认关闭；开启后断言通过时把正则提取出的文本写入变量',
        },
        {
          key: 'extractVariableName',
          label: '变量名',
          inputType: 'text',
          defaultValue: '',
          helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
        },
      ],
    },
    {
      id: 'component-json-log-assert',
      name: 'JSON 日志字段断言',
      description: '用正则定位 logcat 日志，递归解析转义 JSON 后校验字段条件',
      tags: ['assert', 'json', 'logcat'],
      kind: 'json_assert',
      device: 'glasses',
      timeoutSeconds: 45,
      commandTemplate: '',
      params: [
        {
          key: 'lineRegex',
          label: 'JSON 提取正则',
          inputType: 'textarea',
          defaultValue: '',
          helperText: '用捕获组圈出 JSON；可以在组件配置里通过日志原文和提取内容生成',
        },
        {
          key: 'conditions',
          label: '字段条件',
          inputType: 'json',
          defaultValue: '[]',
          helperText: 'UI 中以条件行维护；operator 支持 equals / notEquals / contains / notContains / regex / notRegex / exists / notExists',
        },
        {
          key: 'caseSensitive',
          label: '正则区分大小写',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false',
        },
        {
          key: 'clearBeforeStart',
          label: '断言前清理历史日志',
          inputType: 'text',
          defaultValue: 'false',
          helperText: 'true：仅匹配本节点开始后的日志；false：保留本用例本轮已采集日志（默认）。不删除共享日志文件，也不读取上一轮日志。',
        },
        {
          key: 'captureScreenshotOnPass',
          label: '检测时截屏',
          inputType: 'text',
          defaultValue: 'true',
          helperText: 'true / false；无论检测通过或失败都会截屏',
        },
        {
          key: 'extractVariableEnabled',
          label: '提取为变量',
          inputType: 'text',
          defaultValue: 'false',
          helperText: '默认关闭；开启后断言通过时把当前正则提取出的 JSON 写入变量',
        },
        {
          key: 'extractVariableName',
          label: '变量名',
          inputType: 'text',
          defaultValue: '',
          helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
        },
      ],
    },
    {
      ...createDefaultComponent('llm_assert'),
      id: 'component-llm-assert',
      name: 'LLM 语义断言',
      description: '结合 variables、当前日志和用户诉求，由大模型判断当前状态是否符合预期',
    },
  ];
}

export function createComponentStep(component: TestComponent): AutomationStep {
  const inputs = Object.fromEntries(
    component.params.map((param) => [param.key, param.defaultValue || ''])
  );

  return {
    id: createStepId('component'),
    name: component.name,
    type: 'component',
    device: component.device,
    componentId: component.id,
    inputs,
    timeoutMs: component.timeoutSeconds * 1000,
    config: {},
  };
}

export function createDefaultStep(type: AutomationStepType): AutomationStep {
  const id = createStepId(type);

  if (type === 'start') {
    return {
      id,
      name: '开始',
      type,
      device: 'phone',
      config: {
        capturePhoneLog: true,
        captureGlassesLog: true,
        keepScreenAwake: true,
        recordGlassesScreen: false,
        recordPhoneScreen: false,
        showPhoneScreen: false,
        showGlassesScreen: false,
      },
    };
  }

  if (type === 'end') {
    return {
      id,
      name: '结束',
      type,
      device: 'phone',
      config: {
        cleanupAudioFiles: true,
        cleanupImageFiles: true,
      },
    };
  }

  if (type === 'if') {
    return {
      id,
      name: '条件分支',
      type,
      device: 'phone',
      config: {
        condition: '{{variables.running}}',
        equals: true,
      },
    };
  }

  if (type === 'launch_test_page') {
    return {
      id,
      name: '启动调试 Activity',
      type,
      device: 'phone',
      timeoutMs: 10000,
      config: {
        packageName: '${defaults.phonePackage}',
        activity: '',
        intentArgs: '',
      },
    };
  }

  if (type === 'broadcast_scene') {
    return {
      id,
      name: '发送场景广播',
      type,
      device: 'glasses',
      timeoutMs: 10000,
      config: {
        action: '',
        params: {},
      },
    };
  }

  if (type === 'send_audio') {
    return {
      id,
      name: '音频输入与模拟',
      type,
      device: 'phone',
      timeoutMs: 30000,
      config: {
        sourceType: 'file',
        outputFormat: 'pcm',
        sampleFormat: 'AV_SAMPLE_FMT_S16',
        sampleRate: '16000',
        trailingSilenceMs: '800',
        localPath: '',
        remotePath: '/sdcard/Android/data/${defaults.phonePackage}/files/',
        commandTemplate: 'adb -s {{serial}} shell am broadcast -a {{action}} --es "{{pathExtraKey}}" "{{remotePath}}"',
        action: '',
        pathExtraKey: 'audio_path',
        ttsText: '',
      },
    };
  }

  if (type === 'llm_text_generate') {
    return {
      id,
      name: 'LLM 文本生成',
      type,
      device: 'phone',
      timeoutMs: 30000,
      config: {
        providerId: '',
        prompt: '请生成一句自然的测试语音',
        outputMode: 'json',
        temperature: '0.2',
        maxTokens: '4096',
        outputMappings: [
          { variableName: 'voiceText', outputPath: 'voiceText', fallbackValue: '' },
        ],
        saveToVariables: {
          voiceText: '$.voiceText',
        },
        saveToVariablesText: '{\n  "voiceText": "$.voiceText"\n}',
        fallback: {
          voiceText: '',
        },
        fallbackText: '{\n  "voiceText": ""\n}',
      },
    };
  }

  if (type === 'http_request') {
    return {
      id,
      name: 'HTTP 接口请求',
      type,
      device: 'phone',
      timeoutMs: 15000,
      config: {
        method: 'GET',
        url: '',
        headersText: '{\n  "Accept": "application/json"\n}',
        bodyText: '',
        responseType: 'json',
        expectedStatus: '2xx',
        responseMappings: [
          { variableName: '', responsePath: '' },
        ],
        saveToVariablesText: '{}',
        failOnBusinessErrorPath: '$.data.error',
        failOnMissingSavedVariable: true,
        failOnEmptySavedVariable: true,
      },
    };
  }

  if (type === 'tts_synthesize') {
    return {
      id,
      name: 'TTS 音频合成',
      type,
      device: 'phone',
      timeoutMs: 30000,
      config: {
        text: '${variables.voiceText}',
      },
    };
  }

  if (type === 'debug_forward') {
    return {
      id,
      name: '启动 DebugServer 转发',
      type,
      device: 'phone',
      timeoutMs: 30000,
      config: {
        localPort: 8080,
        remotePort: 8080,
      },
    };
  }

  if (type === 'push_audio') {
    return {
      id,
      name: '推送音频文件',
      type,
      device: 'glasses',
      timeoutMs: 30000,
      config: {
        localPath: '',
        remotePath: '/sdcard/Download/glassbox-input.pcm',
      },
    };
  }

  if (type === 'rpc_assert') {
    return {
      id,
      name: '校验 RPC 日志',
      type,
      device: 'phone',
      timeoutMs: 10000,
      config: {
        operationType: '',
        limit: 50,
      },
    };
  }

  return {
    id,
    name: '等待',
    type: 'wait',
    device: 'phone',
    config: {
      durationMs: 3000,
    },
  };
}

export function createDefaultCase(): AutomationCase {
  const startStep = createDefaultStep('start');
  const endStep = createDefaultStep('end');

  return {
    schemaVersion: 'glassbox.workflow.v1',
    id: 'glassbox-generic-smoke',
    name: '通用自动化 Smoke',
    description: '通用用例骨架：拉起被测 Activity、等待、结束。请按业务组件包补齐输入和断言。',
    tags: ['generic', 'smoke'],
    variables: {
      expectedText: '',
    },
    defaults: {
      phonePackage: '',
      glassesPackage: '',
    },
    steps: [
      startStep,
      createComponentStep(createDefaultComponents()[0]),
      {
        ...createDefaultStep('wait'),
        id: createStepId('wait'),
        name: '等待被测应用响应',
      },
      endStep,
    ],
  };
}

function createCaseSlug(value: string) {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);

  return slug || 'document-draft';
}

function clipText(value: string, maxLength: number) {
  const text = value.trim();
  return text.length > maxLength ? `${text.slice(0, maxLength)}...` : text;
}



function extractJsonObject(text: string) {
  const trimmed = text.trim().replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```$/i, '').trim();

  if (trimmed.startsWith('{')) {
    return trimmed;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');

  if (start >= 0 && end > start) {
    return trimmed.slice(start, end + 1);
  }

  return trimmed;
}


export function buildConversationalCaseDraftPrompt(input: ConversationalCaseDraftInput, availableComponents: TestComponent[]) {
  const componentSummary = availableComponents.map((component) => ({
    id: component.id,
    name: component.name,
    description: component.description || '',
    kind: component.kind || 'adb',
    device: component.device,
    params: component.params.map((param) => ({
      key: param.key,
      label: param.label,
      defaultValue: param.defaultValue || '',
      required: Boolean(param.required),
    })),
  }));

  return [
    '你是 solopi-desktop 对话式自动化用例编写 Skill。你正在和用户持续对话，并把用户需求转成 solopi-desktop 待确认自动化用例草稿。',
    '只输出 JSON，不要输出 Markdown。JSON 顶层必须是 {"schemaVersion":"glassbox.conversational-case-draft.v1","reply":"","draftCases":[],"questions":[]}。',
    'reply 是给用户看的自然语言回复。draftCases 是候选草稿用例。questions 是必须向用户追问的缺失信息。',
    '每个 draftCase 必须符合 glassbox.workflow.v1，并包含 reviewStatus="draft"、tags 包含 "draft" 和 "ai-generated"。',
    '优先复用 availableComponents 中的 componentId。不能确定的动作使用 wait 节点占位，并在 config.todo 写明需要人工确认的内容。',
    '步骤必须包含 start 和 end。断言优先使用日志断言、日志文本提取断言或 JSON 日志字段断言组件。',
    '如果用户是在修改当前草稿，返回完整更新后的 draftCase，而不是局部 patch。',
    `默认上下文：${JSON.stringify(input.defaults || {})}`,
    `目标文件夹：${input.folderId || ''}`,
    `当前用例：${JSON.stringify(input.currentCase || null)}`,
    `availableComponents：${JSON.stringify(componentSummary)}`,
    `对话历史：${JSON.stringify(input.conversation)}`,
    `用户最新输入：\n${input.userMessage}`,
  ].join('\n\n');
}

export function parseConversationalCaseDraftResponse(
  text: string,
  fallbackInput: ConversationalCaseDraftInput
): ConversationalCaseDraftResponse {
  const parsed = JSON.parse(extractJsonObject(text)) as {
    reply?: string;
    draftCases?: AutomationCase[];
    cases?: AutomationCase[];
    questions?: string[];
  };
  const rawCases = Array.isArray(parsed.draftCases)
    ? parsed.draftCases
    : Array.isArray(parsed.cases)
      ? parsed.cases
      : [];
  const draftCases = rawCases.map((rawCase, index) => normalizeCase({
    ...rawCase,
    schemaVersion: 'glassbox.workflow.v1',
    id: rawCase.id || `draft-${createCaseSlug(rawCase.name || fallbackInput.userMessage)}-${Date.now()}-${index + 1}`,
    name: rawCase.name?.startsWith('[草稿]') ? rawCase.name : `[草稿] ${rawCase.name || `对话生成用例 ${index + 1}`}`,
    folderId: fallbackInput.folderId,
    reviewStatus: 'draft',
    conversionSource: {
      type: 'mixed',
      title: rawCase.name || '对话式用例生成',
      summary: clipText(fallbackInput.userMessage, 220),
      rawText: fallbackInput.conversation.map((message) => `${message.role}: ${message.content}`).join('\n'),
      createdAt: new Date().toISOString(),
      ...(rawCase.conversionSource || {}),
    },
    tags: Array.from(new Set([...(rawCase.tags || []), 'draft', 'ai-generated', 'conversation'])),
    defaults: {
      phonePackage: '',
      glassesPackage: '',
      ...(fallbackInput.defaults || {}),
      ...(rawCase.defaults || {}),
    },
  }));

  return {
    reply: parsed.reply || (draftCases.length > 0 ? `已生成 ${draftCases.length} 个待确认用例草稿。` : '我还需要更多信息才能生成用例草稿。'),
    draftCases,
    questions: Array.isArray(parsed.questions) ? parsed.questions : [],
  };
}

export function ensureWorkflowBoundarySteps(testCase: AutomationCase): AutomationCase {
  const hasStart = testCase.steps.some((step) => step.type === 'start');
  const hasEnd = testCase.steps.some((step) => step.type === 'end');
  const nextSteps = [...testCase.steps];

  if (!hasStart) {
    nextSteps.unshift(createDefaultStep('start'));
  }

  if (!hasEnd) {
    nextSteps.push(createDefaultStep('end'));
  }

  return {
    ...testCase,
    steps: nextSteps.map((step) => (
      step.type === 'end'
        ? {
            ...step,
            config: {
              cleanupAudioFiles: true,
              cleanupImageFiles: true,
              ...(step.config || {}),
            },
          }
        : step.type === 'start'
          ? {
              ...step,
              config: {
                capturePhoneLog: true,
                captureGlassesLog: true,
                keepScreenAwake: true,
                recordGlassesScreen: false,
                recordPhoneScreen: false,
                showPhoneScreen: false,
                showGlassesScreen: false,
                ...(step.config || {}),
              },
            }
        : step
    )),
  };
}

export function normalizeCase(value: unknown): AutomationCase {
  if (!value || typeof value !== 'object') {
    throw new Error('用例文件不是有效对象');
  }

  const source = value as Partial<AutomationCase>;

  if (source.schemaVersion !== 'glassbox.workflow.v1') {
    throw new Error('仅支持 schemaVersion=glassbox.workflow.v1');
  }

  if (!source.id || !source.name || !Array.isArray(source.steps)) {
    throw new Error('用例缺少 id、name 或 steps');
  }

  return normalizeCaseFailurePolicy(ensureWorkflowBoundarySteps({
    schemaVersion: 'glassbox.workflow.v1',
    id: source.id,
    name: source.name,
    folderId: source.folderId,
    libraryId: source.libraryId,
    assetBaseDir: source.assetBaseDir,
    description: source.description || '',
    tags: Array.isArray(source.tags) ? source.tags : [],
    reviewStatus: source.reviewStatus,
    conversionSource: source.conversionSource,
    variables: source.variables || {},
    defaults: source.defaults || {},
    components: Array.isArray(source.components) ? source.components : [],
    steps: source.steps.map((step, index) => ({
      ...step,
      id: step.id || `step-${index + 1}`,
      name: step.name || stepTypeLabels[step.type] || `步骤 ${index + 1}`,
      type: step.type,
      device: step.device || 'phone',
      componentId: step.componentId,
      inputs: step.inputs || {},
      config: step.config || {},
      timeoutMs: step.timeoutMs,
      postDelayMs: Number(step.postDelayMs || 0),
      retry: step.retry,
      ...(step.continueOnError === undefined ? {} : { continueOnError: step.continueOnError }),
    })),
  }));
}

export function automationCaseToJson(testCase: AutomationCase) {
  return JSON.stringify(normalizeCaseFailurePolicy(testCase), null, 2);
}

function yamlScalar(value: unknown): string {
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  if (value === null) {
    return 'null';
  }

  return JSON.stringify(String(value));
}

function yamlValue(value: unknown, indent = 0): string {
  const space = ' '.repeat(indent);

  if (Array.isArray(value)) {
    if (value.length === 0) {
      return '[]';
    }

    return value
      .map((item) => `${space}- ${yamlValue(item, indent + 2).trimStart()}`)
      .join('\n');
  }

  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);

    if (entries.length === 0) {
      return '{}';
    }

    return entries
      .map(([key, item]) => {
        if (item && typeof item === 'object' && !Array.isArray(item)) {
          return `${space}${key}:\n${yamlValue(item, indent + 2)}`;
        }

        return `${space}${key}: ${yamlValue(item, indent + 2).trimStart()}`;
      })
      .join('\n');
  }

  return yamlScalar(value);
}

export function automationCaseToYaml(testCase: AutomationCase) {
  testCase = normalizeCaseFailurePolicy(testCase);
  const lines = [
    `schemaVersion: ${testCase.schemaVersion}`,
    `id: ${yamlScalar(testCase.id)}`,
    `name: ${yamlScalar(testCase.name)}`,
  ];

  if (testCase.description) {
    lines.push(`description: ${yamlScalar(testCase.description)}`);
  }

  lines.push(`tags: ${yamlValue(testCase.tags || [], 2).trimStart()}`);
  lines.push('variables:');
  lines.push(yamlValue(testCase.variables || {}, 2));
  lines.push('defaults:');
  lines.push(yamlValue(testCase.defaults || {}, 2));
  if (testCase.components && testCase.components.length > 0) {
    lines.push('components:');
    lines.push(yamlValue(testCase.components, 2));
  }
  lines.push('steps:');

  testCase.steps.forEach((step) => {
    lines.push(`  - id: ${yamlScalar(step.id)}`);
    lines.push(`    name: ${yamlScalar(step.name)}`);
    lines.push(`    type: ${step.type}`);
    lines.push(`    device: ${step.device}`);

    if (step.timeoutMs !== undefined) {
      lines.push(`    timeoutMs: ${step.timeoutMs}`);
    }

    if (step.retry !== undefined) {
      lines.push(`    retry: ${step.retry}`);
    }

    if (step.continueOnError) {
      lines.push('    continueOnError: true');
    }

    lines.push('    config:');
    lines.push(yamlValue(step.config, 6));
  });

  return `${lines.join('\n')}\n`;
}

function parseScalar(raw: string): unknown {
  const value = raw.trim();

  if (value === 'true') return true;
  if (value === 'false') return false;
  if (value === 'null') return null;
  if (value === '[]') return [];
  if (value === '{}') return {};
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);

  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return JSON.parse(value);
  }

  return value;
}

function parseGeneratedYaml(text: string): AutomationCase {
  const root: Record<string, unknown> = {
    schemaVersion: '',
    id: '',
    name: '',
    tags: [],
    variables: {},
    defaults: {},
    steps: [],
  };
  let currentStep: Record<string, unknown> | null = null;
  let currentSection = '';
  let currentConfigParent: Record<string, unknown> | null = null;

  text.split(/\r?\n/).forEach((line) => {
    if (!line.trim() || line.trimStart().startsWith('#')) {
      return;
    }

    const stepMatch = line.match(/^  - id:\s*(.+)$/);

    if (stepMatch) {
      currentStep = {
        id: parseScalar(stepMatch[1]),
        config: {},
      };
      (root.steps as unknown[]).push(currentStep);
      currentSection = 'steps';
      currentConfigParent = null;
      return;
    }

    const rootMatch = line.match(/^([A-Za-z][\w]*):(?:\s*(.*))?$/);

    if (rootMatch) {
      const [, key, raw = ''] = rootMatch;
      currentSection = key;
      currentStep = null;
      currentConfigParent = null;

      if (raw) {
        root[key] = parseScalar(raw);
      } else if (key === 'tags') {
        root[key] = [];
    } else if (key === 'defaults') {
      root[key] = {};
    } else if (key === 'variables') {
      root[key] = {};
      } else if (key === 'steps') {
        root[key] = [];
      }
      return;
    }

    const tagMatch = line.match(/^  -\s*(.+)$/);

    if (currentSection === 'tags' && tagMatch) {
      (root.tags as unknown[]).push(parseScalar(tagMatch[1]));
      return;
    }

    const defaultMatch = line.match(/^  ([A-Za-z][\w]*):\s*(.+)$/);

    if ((currentSection === 'defaults' || currentSection === 'variables') && defaultMatch) {
      (root[currentSection] as Record<string, unknown>)[defaultMatch[1]] = parseScalar(defaultMatch[2]);
      return;
    }

    if (!currentStep) {
      return;
    }

    const stepFieldMatch = line.match(/^    ([A-Za-z][\w]*):(?:\s*(.*))?$/);

    if (stepFieldMatch) {
      const [, key, raw = ''] = stepFieldMatch;

      if (key === 'config') {
        currentStep.config = {};
        currentConfigParent = currentStep.config as Record<string, unknown>;
        return;
      }

      currentStep[key] = parseScalar(raw);
      currentConfigParent = null;
      return;
    }

    const configObjectMatch = line.match(/^      ([A-Za-z_][\w.-]*):\s*$/);

    if (configObjectMatch) {
      const config = currentStep.config as Record<string, unknown>;
      const nested: Record<string, unknown> = {};
      config[configObjectMatch[1]] = nested;
      currentConfigParent = nested;
      return;
    }

    const configMatch = line.match(/^      ([A-Za-z_][\w.-]*):\s*(.+)$/);

    if (configMatch) {
      const config = currentStep.config as Record<string, unknown>;
      config[configMatch[1]] = parseScalar(configMatch[2]);
      currentConfigParent = config;
      return;
    }

    const nestedConfigMatch = line.match(/^        ([A-Za-z_][\w.-]*):\s*(.+)$/);

    if (nestedConfigMatch && currentConfigParent) {
      currentConfigParent[nestedConfigMatch[1]] = parseScalar(nestedConfigMatch[2]);
    }
  });

  return normalizeCase(root);
}

export function parseAutomationCase(text: string, fileName = '') {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('文件内容为空');
  }

  if (fileName.endsWith('.json') || trimmed.startsWith('{')) {
    return normalizeCase(JSON.parse(trimmed));
  }

  return parseGeneratedYaml(trimmed);
}

export function downloadTextFile(fileName: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');

  link.href = url;
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(url);
}
