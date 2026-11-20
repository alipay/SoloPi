export const configurationDemos = [
  { id: 'model', title: '模型配置', path: ['设置中心', '模型配置'], purpose: '接入你可使用的模型，让 Agent 对话、用例分析和 LLM 节点能够调用模型。', fields: ['服务地址与模型名称', 'API Key（按服务要求填写）', '选择默认模型'], result: '保存后，聊天输入框可以选择该模型。连通性需在实际使用时确认。' },
  { id: 'environment', title: '环境配置', path: ['设置中心', '环境配置'], purpose: '告诉应用 ADB、媒体处理等本机工具在哪里，供设备操作和音视频处理使用。', fields: ['本机工具路径', '工作目录与运行环境'], result: '只需配置将要使用的能力所依赖的工具，不必先配置全部项目。' },
  { id: 'device', title: '设备管理', path: ['设置中心', '设备管理'], purpose: '确认已连接设备的角色和默认应用，避免把任务发给错误的设备。', fields: ['手机与眼镜角色', '设备 SN 与默认应用包名'], result: '配置后可在顶部设备区选择目标设备，运行任务前仍需确认设备在线。' },
  { id: 'tts', title: 'TTS 配置', path: ['设置中心', 'TTS 配置'], purpose: '配置文字转语音服务，为需要合成音频的用例生成语音。', fields: ['服务地址与请求头', '请求模板与音频响应'], result: '使用录音或已有音频文件时，不要求先配置 TTS。' },
  { id: 'audio-mock', title: '音频 Mock 与 ADB 命令', path: ['自动化', '测试组件管理', '音频输入'], purpose: '在测试组件管理中新增或编辑音频输入组件，在“ADB 触发命令”填写应用支持的音频注入命令；这不是全局统一命令。', fields: ['音频来源与格式', '是否 ADB push 与设备目录', 'ADB 触发命令'], result: '配置后，音频节点可以推送录音、文件或 TTS 音频并触发设备输入。启用 push 时用 {{remotePath}} 引用设备文件，{{serial}} 为目标设备。命令按应用协议填写；已有用例以节点实际保存的模板为准。演示不创建组件或注入音频。' },
  { id: 'cases', title: '用例库', path: ['自动化', '用例库'], purpose: '添加团队 Git 用例仓库或导入本地用例，浏览和编辑工作流。', fields: ['用例仓库地址与分支', '拉取用例与素材', '选择用例并创建测试任务'], result: '运行后在“自动化 → 测试任务”查看进度和报告。演示不会拉库或提交任务。' },
  { id: 'quick-actions', title: '快捷操作', path: ['设置中心', '快捷操作'], purpose: '把常用脚本保存为操作入口，配置说明、参数和工具栏展示方式。', fields: ['脚本与用途说明', '参数、默认值与执行方式', '是否显示在顶部工具栏'], result: '保存后可从工具栏点击操作，再确认参数执行；本次演示不运行脚本。' },
  { id: 'sites', title: '常用站点', path: ['设置中心', '常用站点'], purpose: '集中维护团队经常访问的网页入口。', fields: ['站点名称', '访问地址'], result: '配置后可从左侧“常用站点”找到入口。' },
] as const;
export const capabilityDemos = {
  cases: configurationDemos[5],
  agent: { id: 'agent', title: 'Agent 对话', path: ['Agent 对话'], purpose: '用自然语言说明任务，附上图片或文件，让 Agent 使用已配置的模型和工具协助处理。', fields: ['先在设置中心配置模型', '选择模型并输入诉求', '查看工具调用与返回结果'], result: '提出明确的设备、用例范围和预期结果；本次演示不会发送消息或调用模型。' },
  'quick-actions': configurationDemos[6],
  device: { id: 'device-performance', title: '设备、性能与录屏', path: ['自动化', '测试任务'], purpose: '先在顶部设备区确认手机和眼镜，再在创建任务时按需启用日志、性能或录屏。', fields: ['顶部设备区：选择设备与应用', '创建测试任务：选择用例和采集项', '测试任务报告：查看结果和产物'], result: '独立性能采集入口在左侧“性能测试”。本次演示不会连接设备、采样或录屏。' },
} as const;
export type Demo = { id: string; title: string; path: readonly string[]; purpose: string; fields: readonly string[]; result: string };

const englishTourCopy: Record<string, Pick<Demo, 'title' | 'purpose' | 'result'>> = {
  model: { title: 'Models', purpose: 'Connect a model for Agent Chat, case analysis, and LLM steps.', result: 'Select the saved model in the chat composer. Send a request to confirm it works.' },
  environment: { title: 'Environment', purpose: 'Point SoloPi Desktop to ADB and the media tools it uses to control devices and process recordings.', result: 'Configure the tools required by the features you plan to use.' },
  device: { title: 'Device Management', purpose: 'Confirm each device’s role and default app before assigning tasks.', result: 'Choose a device in the toolbar and check that it is connected before running a task.' },
  tts: { title: 'Text to Speech', purpose: 'Configure a text-to-speech service for cases that need synthesized audio.', result: 'Recordings and existing audio files can be used without configuring text to speech.' },
  'audio-mock': { title: 'Audio Input and ADB', purpose: 'Create or edit an Audio Input component and enter the ADB command supported by the target app.', result: 'Audio steps can send recordings, files, or synthesized speech to the device. Use {{remotePath}} for the device file and {{serial}} for the target device. The tour does not create components or send audio.' },
  cases: { title: 'Case Library', purpose: 'Add a team Git repository or import local cases to browse and edit workflows.', result: 'After running cases, open Test Tasks to see progress and reports. The tour does not fetch repositories or submit tasks.' },
  'quick-actions': { title: 'Quick Actions', purpose: 'Save frequently used scripts as toolbar actions and configure their arguments.', result: 'Select an action in the toolbar and review its arguments before running it. The tour does not run scripts.' },
  sites: { title: 'Common Sites', purpose: 'Keep frequently used team websites together.', result: 'Open the saved site from Common Sites in the sidebar.' },
  agent: { title: 'Agent Chat', purpose: 'Describe a task in natural language and attach images or files for the Agent to use with the configured model and tools.', result: 'Specify the device, case scope, and expected result. The tour does not send messages or call models.' },
  'device-performance': { title: 'Devices, Performance, and Recording', purpose: 'Choose the phone and glasses in the toolbar, then select the logs, metrics, or recordings to collect when creating a task.', result: 'Open Performance in the sidebar for standalone collection. The tour does not connect devices or collect data.' },
};

export type OnboardingDestination = 'team'|'device'|'model'|'environment'|'tts'|'quick-actions'|'sites'|'cases'|'tasks'|'agent'|'settings'|'components'|'components-add';
export type TourStop = { target: string; label: string; destination: OnboardingDestination };
export function localizedTourCopy(demo: Demo, translate: (chinese: string, english: string) => string) {
  const english = englishTourCopy[demo.id] || demo;
  return {
    title: translate(demo.title, english.title),
    purpose: translate(demo.purpose, english.purpose),
    result: translate(demo.result, english.result),
  };
}

export function demoStops(demo: Demo, t: (chinese: string, english: string) => string = chinese => chinese): TourStop[] {
  if(demo.id==='cases')return [{target:'nav-automation-cases',label:t('用例库','Case Library'),destination:'cases'}];
  if(demo.id==='agent')return [{target:'nav-agent',label:t('Agent 对话','Agent Chat'),destination:'agent'}];
  if(demo.id==='audio-mock')return [{target:'nav-automation-components',label:t('测试组件管理','Test Components'),destination:'components'},{target:'component-add',label:t('新增测试组件','Add Test Component'),destination:'components-add'},{target:'component-template-audio',label:t('音频输入','Audio Input'),destination:'components-add'}];
  if(demo.id==='device-performance')return [{target:'nav-settings',label:t('设置中心','Settings'),destination:'settings'},{target:'settings-device',label:t('设备管理','Device Management'),destination:'device'},{target:'nav-automation-tasks',label:t('测试任务','Test Tasks'),destination:'tasks'}];
  return [{target:'nav-settings',label:t('设置中心','Settings'),destination:'settings'},{target:`settings-${demo.id}`,label:localizedTourCopy(demo,t).title,destination:demo.id as OnboardingDestination}];
}
