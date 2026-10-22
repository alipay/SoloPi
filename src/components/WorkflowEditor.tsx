import { loadTaskForFailedRerun } from '../lib/task-rerun-source';
import { useTaskActionFeedback } from '../hooks/use-task-action-feedback';
import TaskActionNotice from './TaskActionNotice';
import { useModelConfiguration, createLlmProviderDraft, type LlmProviderConfig } from '../hooks/use-model-configuration';
import { normalizeCaseFailurePolicy } from '../../electron/workflow-failure-policy';
import { createTaskCreationAttempt } from '../lib/task-creation-diagnostics';
import CopyableTaskId from './CopyableTaskId';
import SoloPiNativeEditor from './SoloPiNativeEditor';
import { nativeCaseIssues } from '../../electron/solopi-native-schema';
import SoloPiImport from './SoloPiImport';
import { TeamConfigurationPanel, TeamOnboarding } from './TeamConfiguration';
import { createJsonExtractRegexFromSample, createTtsExtractRegexFromSelection } from '../../electron/workflow-log-diagnostics';
import AgentMirrors from './AgentMirrors';
import WorkflowMirrors from './WorkflowMirrors';
import AgentPage from './AgentPage';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AudioParameterField, WorkflowVariablePanel } from './WorkflowVariablePanel';
import { CaseTreeDisclosure, toggleTreeBranch } from './CaseTreeDisclosure';
import { mergeCaseUpdate } from '../../electron/case-update';
import ReactFlow, {
  addEdge,
  applyEdgeChanges,
  Background,
  Connection,
  Controls,
  Edge,
  EdgeChange,
  Node,
  NodeChange,
  PanOnScrollMode,
  ReactFlowInstance,
  updateEdge,
  useEdgesState,
  useNodesState,
} from 'reactflow';
import 'reactflow/dist/style.css';
import {
  ArrowLeft,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  CloudDownload,
  CloudUpload,
  Copy,
  ExternalLink,
  FileDown,
  FileCode2,
  FileUp,
  FilePlus,
  Folder,
  FolderPlus,
  FolderOpen,
  GitBranch,
  Globe2,
  Image as ImageIcon,
  ListChecks,
  Loader2,
  MessageSquare,
  Minimize2,
  Mic,
  MoreHorizontal,
  Plus,
  Play,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Send,
  Settings2,
  Sparkles,
  Square,
  CheckCircle2,
  CircleHelp,
  MonitorSmartphone,
  Smartphone,
  Tags,
  Terminal,
  Timer,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import WorkflowNode from './WorkflowNode';
import { Sidebar } from './Sidebar';
import { DeviceHeader } from './DeviceHeader';
import { QuickActions } from './QuickActions';
import { QuickActionsSettings } from './QuickActionsSettings';
import { CommonSitesPage } from './CommonSitesPage';
import { CommonSitesSettings } from './CommonSitesSettings';
import { PerformanceTestPage, CrashSummary, crashSummary, type CrashStats } from './PerformanceTestPage';
import { BugreportAnalysisPage } from './BugreportAnalysisPage';
import {
  getMobileUiTapPoint,
  normalizeMobileUiTapInset,
  normalizeMobileUiTapPosition,
  type MobileUiTapPosition,
} from '../../electron/mobile-ui-tap-position';
import {
  AutomationCase,
  ComponentParam,
  ConversationalCaseDraftResponse,
  AutomationStep,
  AutomationStepType,
  TestComponent,
  TestComponentKind,
  WorkflowRunResult,
  automationCaseToJson,
  automationCaseToYaml,
  buildConversationalCaseDraftPrompt,
  createComponentStep,
  createDefaultComponent,
  createDefaultComponents,
  createDefaultCase,
  createDefaultStep,
  createStepId,
  downloadTextFile,
  ensureWorkflowBoundarySteps,
  isLegacyBusinessComponent,
  normalizeCase,
  parseConversationalCaseDraftResponse,
  parseAutomationCase,
  stepTypeDescriptions,
  stepTypeLabels,
} from '@/lib/automationCase';

const nodeTypes = {
  start: WorkflowNode,
  adb: WorkflowNode,
  pay: WorkflowNode,
  llm: WorkflowNode,
  audio: WorkflowNode,
  tool: WorkflowNode,
  condition: WorkflowNode,
  wait: WorkflowNode,
  end: WorkflowNode,
};

const WORKFLOW_STORAGE_KEY = 'glassbox.workflow.editor.v1';
const MAIN_SIDEBAR_COLLAPSED_KEY = 'glassbox.mainSidebar.collapsed';
const DEFAULT_CASE_LIBRARY_ID = 'case-library-local';
const DEFAULT_CASE_FOLDER_ID = 'case-folder-default';
const DEFAULT_JSON_ASSERT_VARIABLE_NAME = 'extractedJson';
const DEFAULT_TEXT_ASSERT_VARIABLE_NAME = 'extractedText';
const DEFAULT_LLM_ASSERT_VARIABLE_NAME = 'extractedLlmLog';
const DEFAULT_LLM_TEXT_VARIABLE_NAME = 'voiceText';
const DEFAULT_LLM_ASSERT_PROMPT = '请根据前置提取的数据 {{variables.extractedJson}} 和当前日志内容，判断当前状态是否符合预期。请重点核对关键字段是否一致；如果不一致，请在 reason 中说明差异。';


const glassBoxSkills: GlassBoxSkill[] = [
  {
    id: 'glassbox-case-generation',
    name: '用例编写 Skill',
    description: '把用户对话、文档内容和当前组件库转换成 solopi-desktop 待确认自动化用例草稿。',
    triggers: ['生成用例', 'PRD', '交互', '流程图', '截图', '测试场景'],
    allowedTools: ['glassbox.search_cases', 'document.read_url'],
    systemPrompt: '输出 solopi-desktop 对话式用例草稿协议，所有结果必须先进入 draft。',
  },
];

interface CaseLibrary {
  id: string;
  name: string;
  repoUrl?: string;
  authUsername?: string;
  authToken?: string;
  sshKeyPath?: string;
  sshPassphrase?: string;
  gitBranch?: string;
  autoUpdate?: boolean;
  expanded?: boolean;
  branch?: string;
  lastUpdatedAt?: string;
  lastUpdatedBy?: string;
  lastUpdatedEmail?: string;
  lastCommitMessage?: string;
  localRevision?: string;
  localRepoPath?: string;
  localComponentIds?: string[];
}

interface CaseFolder {
  id: string;
  name: string;
  libraryId?: string;
  parentId?: string;
  expanded?: boolean;
}

interface StressTaskOptions {
  mode: 'rounds' | 'duration';
  value: number;
  phoneLog: boolean;
  glassesLog: boolean;
}

interface AutomationTaskRecord {
  externalSource?: { dataDir: string; ownerPid?: number };
  stress?: StressTaskOptions;
  currentRound?: number;
  taskLogs?: Array<{ deviceType: string; path: string; error?: string }>;
  id: string;
  name: string;
  folderId: string;
  caseIds: string[];
  status: 'pending' | 'submitted' | 'running' | 'stopping' | 'success' | 'failed' | 'stopped';
  completed: number;
  total: number;
  currentCaseName?: string;
  currentCaseId?: string;
  currentStepId?: string;
  currentStepName?: string;
  createdAt: string;
  startedAt?: string;
  updatedAt?: string;
  finishedAt?: string;
  taskRevision?: string;
  source?: 'cli' | 'broker' | 'ui' | string;
  cases?: AutomationTaskCaseRecord[];
  error?: string;
  readonly?: boolean;
  imported?: boolean;
  importedAt?: string;
  reportPackagePath?: string;
  reportRoot?: string;
  reportDetailPath?: string;
  reportDetailLoaded?: boolean;
  reportPersistenceError?: string;
  reportPackage?: { success?: boolean; path?: string; error?: string };
  validationSummary?: {
    selected: number;
    passed: number;
    warnings: number;
    errors: number;
  };
  summary?: {
    successCount?: number;
    failedCount?: number;
    stoppedCount?: number;
    caseCount?: number;
    validationSummary?: AutomationTaskRecord['validationSummary'];
  };
  threadStacks?: Array<{ id: string; target: string; packageName: string; pid?: string; caseId?: string; round?: number; reason: string; startedAt: string; status: string; errorCode?: string; error?: string; files: Array<{ path: string; remotePath: string }>; commands?: unknown[] }>;
  performanceOptions?: AutomationTaskPerformanceOptions;
  performanceReports?: AutomationTaskPerformanceReports;
  startOptions?: AutomationTaskStartOptions;
  devices?: Record<string, unknown>;
  runtimeEnvironment?: Record<string, unknown>;
}

function getAutomationTaskUpdatedAtMs(task: AutomationTaskRecord) {
  const value = Date.parse(task.updatedAt || task.finishedAt || task.createdAt || '');
  return Number.isFinite(value) ? value : 0;
}

function isAutomationTaskActive(task: AutomationTaskRecord) {
  return ['pending', 'submitted', 'running', 'stopping'].includes(task.status);
}

function mergeAutomationTaskRecords(
  current: AutomationTaskRecord[],
  incoming: AutomationTaskRecord[],
  removed: Set<string> = new Set(),
): AutomationTaskRecord[] {
  const merged = new Map(current.filter(task=>!removed.has(task.id)).map((task) => [task.id, task]));
  incoming.forEach((task) => {
    if(removed.has(task.id))return;
    const existing = merged.get(task.id);
    if (!existing) {
      merged.set(task.id, task);
      return;
    }
    const incomingTime = getAutomationTaskUpdatedAtMs(task);
    const existingTime = getAutomationTaskUpdatedAtMs(existing);
    const incomingSequence = Number(task.taskRevision?.split('-').at(-1) || 0);
    const existingSequence = Number(existing.taskRevision?.split('-').at(-1) || 0);
    const incomingIsNewer = incomingTime > existingTime
      || (incomingTime === existingTime && incomingSequence >= existingSequence);
    if (!incomingIsNewer) return;
    merged.set(task.id, {
      ...existing,
      ...task,
      cases: task.cases?.length ? task.cases : existing.cases,
      performanceReports: task.performanceReports || existing.performanceReports,
      reportDetailLoaded: task.taskRevision && task.taskRevision === existing.taskRevision
        ? existing.reportDetailLoaded : task.reportDetailLoaded,
    });
  });
  return Array.from(merged.values()).sort((left, right) => (
    getAutomationTaskUpdatedAtMs(right) - getAutomationTaskUpdatedAtMs(left)
  ));
}

function isRendererOwnedAutomationTask(task: AutomationTaskRecord) {
  if (task.imported) return true;
  const isBrokerTask = task.source === 'cli'
    || task.source === 'broker'
    || task.source === 'ui-broker'
    || task.id.startsWith('cli-task-');
  return !isBrokerTask;
}

type AutomationTaskPerformanceTarget = 'phone' | 'glasses';
type AutomationDeviceRuntime = 'android' | 'harmony';

interface AutomationTaskStartOptions {
  keepScreenAwake?: boolean;
  recordGlassesScreen?: boolean;
  recordPhoneScreen?: boolean;
  showPhoneScreen?: boolean;
  showGlassesScreen?: boolean;
}

interface ThreadStackOptions {
  enabled: boolean;
  mode?: 'manual' | 'interval' | 'checkpoint' | 'failure';
  intervalMs?: number;
  maxCount?: number;
  maxBytes?: number;
  checkpoints?: string[];
}
function ThreadStackOptionsEditor({ value, onChange }: { value?: ThreadStackOptions; onChange: (value: ThreadStackOptions) => void }) {
  const update = (patch: Partial<ThreadStackOptions>) => onChange({ enabled: false, ...value, ...patch });
  return <fieldset className="mt-3 rounded-xl border border-slate-200 p-3 text-xs space-y-2">
    <label className="flex gap-2"><input type="checkbox" checked={Boolean(value?.enabled)} onChange={e => update({ enabled: e.target.checked })} />采集 Android ART 线程栈（可选）</label>
    <p className="text-slate-500">针对上方勾选的性能设备及包名，可能短暂影响应用。默认关闭；这是栈快照，不是线程 CPU 耗时统计。权限不足时记录失败。</p>
    {value?.enabled && <>
      <label className="block">触发方式 <select value={value.mode || 'manual'} onChange={e => update({ mode: e.target.value as ThreadStackOptions['mode'] })}>
        <option value="manual">手动</option><option value="interval">低频采样</option><option value="checkpoint">指定节点执行前（每轮）</option><option value="failure">用例失败、清理前</option>
      </select></label>
      {value.mode === 'checkpoint' && <label className="block">节点 ID（逗号分隔）<input className="w-full border rounded p-2" value={(value.checkpoints || []).join(',')} onChange={e => update({ checkpoints: e.target.value.split(',') })} /></label>}
      <label className="block">最小间隔（毫秒，至少 30000）<input type="number" min={30000} max={3600000} value={value.intervalMs ?? 60000} onChange={e => update({ intervalMs: Number(e.target.value) })} /></label>
      <label className="block">最多采集批次 <input type="number" min={1} max={100} value={value.maxCount ?? 10} onChange={e => update({ maxCount: Number(e.target.value) })} /></label>
      <label className="block">总容量（字节）<input type="number" min={1024} max={67108864} value={value.maxBytes ?? 16777216} onChange={e => update({ maxBytes: Number(e.target.value) })} /></label>
    </>}
  </fieldset>;
}
interface AutomationTaskPerformanceOptions {
  threadStacks?: ThreadStackOptions;
  phone?: boolean;
  glasses?: boolean;
}

interface AutomationTaskPerformanceSample {
  rawEvidencePath?: string;
  timestamp: string;
  serial: string;
  packageName: string;
  runtime: AutomationDeviceRuntime;
  pid?: string;
  memoryKb?: number;
  cpuPercent?: number;
  threadCount?: number;
  systemAvailableMemoryKb?: number;
  systemAvailableCpuPercent?: number;
  batteryTemperatureC?: number;
  batteryError?: string;
  error?: string;
}

interface AutomationTaskPerformanceReport {
  crashes?: CrashStats;
  id: string;
  target: AutomationTaskPerformanceTarget;
  name: string;
  createdAt: string;
  runtime: AutomationDeviceRuntime;
  serial: string;
  packageName: string;
  samples: AutomationTaskPerformanceSample[];
}

type AutomationTaskPerformanceReports = Partial<Record<AutomationTaskPerformanceTarget, AutomationTaskPerformanceReport>>;

const defaultAutomationTaskStartOptions: Required<AutomationTaskStartOptions> = {
  keepScreenAwake: true,
  recordGlassesScreen: false,
  recordPhoneScreen: false,
  showPhoneScreen: false,
  showGlassesScreen: false,
};

function normalizeAutomationTaskStartOptions(
  options?: AutomationTaskStartOptions
): Required<AutomationTaskStartOptions> {
  return {
    keepScreenAwake: options?.keepScreenAwake ?? defaultAutomationTaskStartOptions.keepScreenAwake,
    recordGlassesScreen: Boolean(options?.recordGlassesScreen),
    recordPhoneScreen: Boolean(options?.recordPhoneScreen),
    showPhoneScreen: Boolean(options?.showPhoneScreen),
    showGlassesScreen: Boolean(options?.showGlassesScreen),
  };
}

interface MobileUiRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
}

interface MobileUiElement {
  id: string;
  index: number;
  text?: string;
  contentDesc?: string;
  resourceId?: string;
  className?: string;
  packageName?: string;
  clickable?: boolean;
  enabled?: boolean;
  bounds?: string;
  rect: MobileUiRect;
  screenshotRect?: MobileUiRect;
  label?: string;
  selector?: Record<string, string>;
}

interface MobileUiInspectorState {
  loading: boolean;
  error?: string;
  serial?: string;
  inspectedStepId?: string;
  screenshotDataUrl?: string;
  screen?: {
    width?: number;
    height?: number;
  };
  screenshot?: {
    width?: number;
    height?: number;
  };
  coordinateTransform?: {
    mode?: string;
    rotation?: number;
    scaleX?: number;
    scaleY?: number;
    source?: string;
  };
  elements: MobileUiElement[];
  selectedElementId?: string;
  clickPreview?: {
    source: 'element-anchor' | 'coordinate-fallback';
    x: number;
    y: number;
    screenshotX: number;
    screenshotY: number;
    elementId?: string;
    elementLabel?: string;
    bounds?: string;
    tapPosition?: MobileUiTapPosition | 'coordinate-fallback';
    tapInsetXPx?: number | null;
    tapInsetYPx?: number | null;
  };
}

interface MobileUiDebugState {
  stepId?: string;
  status: 'idle' | 'running' | 'success' | 'error';
  message?: string;
  command?: string;
  stdout?: string;
  stderr?: string;
  errorCode?: string;
  recoveryActions?: string[];
}

function getNestedMobileUiTargets(selectedElement: MobileUiElement | undefined, elements: MobileUiElement[]) {
  if (!selectedElement?.rect) {
    return [];
  }

  const selectedRect = selectedElement.rect;
  const selectedArea = Math.max(1, selectedRect.width * selectedRect.height);
  return elements.filter((element) => {
    if (element.id === selectedElement.id || !element.rect) {
      return false;
    }
    const rect = element.rect;
    const area = Math.max(1, rect.width * rect.height);
    const isInside = rect.left >= selectedRect.left
      && rect.top >= selectedRect.top
      && rect.right <= selectedRect.right
      && rect.bottom <= selectedRect.bottom;
    const hasSemanticTarget = Boolean(element.text || element.contentDesc || element.resourceId || element.clickable);
    return isInside && hasSemanticTarget && area < selectedArea * 0.8;
  });
}

function formatMobileUiCoordinate(value: number | undefined) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) return '-';
  return Number.isInteger(numericValue) ? String(numericValue) : numericValue.toFixed(1);
}

const mobileUiTapPositionLabels: Record<MobileUiTapPosition, string> = {
  relative: '元素内相对位置',
  center: '中间',
  'top-left': '左上角',
  'top-right': '右上角',
  'bottom-left': '左下角',
  'bottom-right': '右下角',
};

function mapMobileUiPointToInspectorScreenshot(
  point: { x: number; y: number },
  inspector: Pick<MobileUiInspectorState, 'screen' | 'screenshot' | 'coordinateTransform'>,
) {
  const uiWidth = Number(inspector.screen?.width || 0);
  const uiHeight = Number(inspector.screen?.height || 0);
  const screenshotWidth = Number(inspector.screenshot?.width || uiWidth);
  const screenshotHeight = Number(inspector.screenshot?.height || uiHeight);
  if (!uiWidth || !uiHeight || !screenshotWidth || !screenshotHeight) return point;

  if (inspector.coordinateTransform?.mode === 'rotate-90') {
    return {
      x: point.y * screenshotWidth / uiHeight,
      y: (uiWidth - point.x) * screenshotHeight / uiWidth,
    };
  }
  if (inspector.coordinateTransform?.mode === 'rotate-270') {
    return {
      x: (uiHeight - point.y) * screenshotWidth / uiHeight,
      y: point.x * screenshotHeight / uiWidth,
    };
  }
  return {
    x: point.x * screenshotWidth / uiWidth,
    y: point.y * screenshotHeight / uiHeight,
  };
}

function normalizeAutomationTaskPerformanceOptions(
  options?: AutomationTaskPerformanceOptions
): Required<AutomationTaskPerformanceOptions> {
  return {
    threadStacks: options?.threadStacks || { enabled: false },
    phone: Boolean(options?.phone),
    glasses: Boolean(options?.glasses),
  };
}

interface AutomationTaskCaseRecord {
  caseId: string;
  caseName: string;
  status: 'pending' | 'running' | 'success' | 'failed' | 'stopped';
  completed: number;
  total: number;
  caseSnapshot?: AutomationCase;
  edges?: Edge[];
  startedAt?: string;
  endedAt?: string;
  finishedAt?: string;
  results?: WorkflowRunLog[];
  artifacts?: WorkflowRunResult['artifacts'];
  error?: string;
  errorCode?: string;
  errorType?: string;
  recoveryActions?: string[];
  diagnostics?: unknown;
  plannedPath?: string[];
  executedPath?: string[];
  reachedEnd?: boolean;
  terminationReason?: string;
  failedEdge?: { source?: string; target?: string | null; sourceHandle?: string } | null;
  duplicateStepId?: string;
}

type FlowReturnTarget =
  | { tab: 'automation-cases' }
  | { tab: 'automation-task-report'; taskId: string }
  | { tab: 'automation-flow-report-preview'; taskId: string; caseId: string }
  | { tab: 'automation-tasks' };

type ReportCaseStatusFilter = 'all' | 'failed' | 'success' | 'running' | 'stopped' | 'pending';
type ReportCaseArtifactFilter = 'all' | 'withArtifacts' | 'withScreenshots';

interface WorkflowClipboardPayload {
  schema: 'glassbox.workflow.clipboard.v1';
  step: AutomationStep;
}

type NameDialogState =
  | { mode: 'create-folder'; title: string; value: string }
  | { mode: 'create-library'; title: string; value: string }
  | { mode: 'rename-folder'; title: string; value: string; folderId: string }
  | { mode: 'rename-case'; title: string; value: string; caseId: string }
  | null;

type InlineEditingName =
  | { type: 'library'; id: string; value: string }
  | { type: 'folder'; id: string; value: string }
  | { type: 'case'; id: string; value: string }
  | null;

type CaseLibraryViewMode = 'library' | 'folder';

interface GitConfigDialogState {
  libraryId: string;
  value: string;
  authUsername?: string;
  authToken?: string;
  sshKeyPath?: string;
  sshPassphrase?: string;
  branch?: string;
  intent: 'pull' | 'push' | 'auto';
}

type CaseTreeDragItem =
  | { type: 'folder'; id: string }
  | { type: 'case'; id: string }
  | null;

interface ExportFolderDialogState {
  folderId: string;
}

interface TaskCreateDialogState {
  stress?: StressTaskOptions;
  name: string;
  selectedCaseIds: string[];
  threadStacks?: ThreadStackOptions;
  collectPhonePerformance: boolean;
  collectGlassesPerformance: boolean;
  startOptions: Required<AutomationTaskStartOptions>;
}

interface QuickTaskPerformanceDialogState {
  folderId: string;
  folderName: string;
  threadStacks?: ThreadStackOptions;
  collectPhonePerformance: boolean;
  collectGlassesPerformance: boolean;
  startOptions: Required<AutomationTaskStartOptions>;
}


interface ToastMessage {
  id: string;
  message: string;
}


interface AssistantMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: string;
  mode?: 'chat' | 'case-authoring';
}

interface GlassBoxSkill {
  id: string;
  name: string;
  description: string;
  triggers: string[];
  allowedTools: string[];
  systemPrompt: string;
}

interface CaseLibraryFile {
  name: string;
  path: string;
  relativePath: string;
  content: string;
}

interface CaseLibraryManifest {
  schemaVersion?: string;
  name?: string;
  team?: string;
  casesRoot?: string;
  assetsRoot?: string;
  workspaceFile?: string;
}

interface CaseLibraryWorkspace {
  schemaVersion: 'glassbox.case-library.workspace.v1';
  name?: string;
  folders?: CaseFolder[];
  cases: AutomationCase[];
  components?: TestComponent[];
  caseEdges?: Record<string, Edge[]>;
  nodePositions?: CaseNodePositions;
}

interface PullCaseLibraryResult {
  success: boolean;
  needsGitLfs?: boolean;
  repoUrl?: string;
  repoPath?: string;
  repoId?: string;
  targetLibraryId?: string;
  manifest?: CaseLibraryManifest;
  workspaceFile?: string;
  workspace?: CaseLibraryWorkspace;
  gitInfo?: Partial<CaseLibrary>;
  files?: CaseLibraryFile[];
  revision?: string;
  source?: 'local' | 'remote';
  gitOperation?: boolean;
  strictLocalReload?: boolean;
  preserveSelection?: boolean;
  error?: string;
  errorCode?: string;
  recoveryActions?: string[];
}

interface LocalCaseLibraryChangeEvent {
  schemaVersion: 'glassbox.case-library.local-change-event.v1';
  type: 'library-changed' | 'library-error' | 'watcher-error';
  libraryId: string;
  libraryName?: string;
  revision?: string;
  previousRevision?: string;
  detectedAt: string;
  result?: PullCaseLibraryResult;
  error?: string;
  errorCode?: string;
  recoveryActions?: string[];
}

const nodeTypeMap: Record<AutomationStepType, string> = {
  start: 'start',
  if: 'condition',
  component: 'adb',
  launch_test_page: 'adb',
  broadcast_scene: 'pay',
  http_request: 'tool',
  llm_text_generate: 'llm',
  tts_synthesize: 'audio',
  send_audio: 'audio',
  wait: 'wait',
  push_audio: 'audio',
  debug_forward: 'adb',
  rpc_assert: 'pay',
  end: 'end',
};

const iconTypeMap: Record<AutomationStepType, string> = {
  start: 'start',
  if: 'condition',
  component: 'adb',
  launch_test_page: 'adb',
  broadcast_scene: 'pay',
  http_request: 'tool',
  llm_text_generate: 'llm',
  tts_synthesize: 'audio',
  send_audio: 'audio',
  wait: 'condition',
  push_audio: 'audio',
  debug_forward: 'adb',
  rpc_assert: 'pay',
  end: 'end',
};

const rawConfigEditorHiddenStepTypes = new Set<AutomationStepType>([
  'start',
  'end',
  'wait',
  'launch_test_page',
  'broadcast_scene',
  'http_request',
  'llm_text_generate',
  'tts_synthesize',
  'send_audio',
  'push_audio',
  'debug_forward',
]);

const mobileUiActionLabels: Record<string, string> = {
  wait: '等待元素',
  tap: '点击元素',
  input: '输入文本',
  assert: '断言元素',
  swipe: '屏幕滑动',
  swipe_element: '元素内滑动',
  solopi_replay: 'SoloPi 原生回放',
  back: '返回',
  home: '主页',
};

function shouldShowRawConfigEditor(step?: AutomationStep | null, component?: TestComponent | null) {
  return Boolean(step && !component && !rawConfigEditorHiddenStepTypes.has(step.type));
}

function createConfigDraftForStep(step?: AutomationStep | null, component?: TestComponent | null) {
  if (!shouldShowRawConfigEditor(step, component)) {
    return '';
  }

  return JSON.stringify(step?.type === 'component' ? (step.inputs || step.config || {}) : (step?.config || {}), null, 2);
}

function normalizeTtsNodeVariableKey(value: unknown, fallback = 'tts') {
  const normalized = String(value || fallback)
    .trim()
    .replace(/^variables\./, '')
    .replace(/\.(?=.+)/g, '_')
    .replace(/\s+/g, '_')
    .replace(/[^\w$\-\u4e00-\u9fff]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

  return normalized || fallback;
}

function mergeWorkflowComponent(baseComponent: TestComponent | undefined, overrideComponent: TestComponent): TestComponent {
  if (!baseComponent) {
    return normalizeWorkflowComponentDefaults(overrideComponent);
  }

  const paramMap = new Map((baseComponent.params || []).map((param) => [param.key, param]));
  (overrideComponent.params || []).forEach((param) => {
    if (param.key) {
      paramMap.set(param.key, param);
    }
  });

  return normalizeWorkflowComponentDefaults({
    ...baseComponent,
    ...overrideComponent,
    params: Array.from(paramMap.values()),
  });
}

function ensureAssertExtractionParams(component: TestComponent, _defaultVariableName: string, helperText: string) {
  const paramMap = new Map((component.params || []).map((param) => [param.key, param]));
  const enabledParam = paramMap.get('extractVariableEnabled');
  const nameParam = paramMap.get('extractVariableName');

  paramMap.set('extractVariableEnabled', {
    ...enabledParam,
    key: 'extractVariableEnabled',
    label: '提取为变量',
    inputType: 'text',
    defaultValue: enabledParam?.defaultValue || 'false',
    helperText: enabledParam?.helperText || helperText,
  });
  paramMap.set('extractVariableName', {
    ...nameParam,
    key: 'extractVariableName',
    label: '变量名',
    inputType: 'text',
    defaultValue: nameParam?.defaultValue || '',
    helperText: nameParam?.helperText || '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
  });

  return {
    ...component,
    params: Array.from(paramMap.values()),
  };
}

const supportedComponentKinds = new Set<TestComponentKind>([
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

function isSupportedComponent(component: TestComponent) {
  return supportedComponentKinds.has(component.kind || 'adb');
}

function normalizeWorkflowComponentDefaults(component: TestComponent): TestComponent {
  if (component.kind === 'pc_command') {
    return {
      ...component,
      device: 'pc',
      commandTemplate: component.commandTemplate || '',
    };
  }

  if (component.id === 'component-image-mock') {
    const requiredParams: TestComponent['params'] = [
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
      params: Array.from(paramMap.values()),
    };
  }

  if (component.kind === 'tts_assert') {
    return ensureAssertExtractionParams(
      component,
      DEFAULT_TEXT_ASSERT_VARIABLE_NAME,
      'true / false；断言通过后把正则提取出的文本写入变量'
    );
  }

  if (component.kind === 'json_assert') {
    const normalizedComponent = ensureAssertExtractionParams(
      component,
      DEFAULT_JSON_ASSERT_VARIABLE_NAME,
      'true / false；断言通过后把当前正则提取出的 JSON 内容写入变量'
    );
    return {
      ...normalizedComponent,
      params: normalizedComponent.params.map((param) => {
        if (param.key === 'extractVariableEnabled') {
          return { ...param, defaultValue: param.defaultValue || 'false' };
        }

        if (param.key === 'extractVariableName') {
          return {
            ...param,
            defaultValue: param.defaultValue || '',
            helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
          };
        }

        return param;
      }),
    };
  }

  if (component.kind === 'llm_assert') {
    const normalizedComponent = ensureAssertExtractionParams(
      component,
      DEFAULT_LLM_ASSERT_VARIABLE_NAME,
      'true / false；断言通过后把当前日志正则提取出的内容写入变量'
    );
    const paramMap = new Map((normalizedComponent.params || []).map((param) => [param.key, param]));
    paramMap.delete('model');
    const ensureParam = (param: ComponentParam) => {
      const existing = paramMap.get(param.key);
      paramMap.set(param.key, existing ? { ...param, ...existing, defaultValue: existing.defaultValue || param.defaultValue } : param);
    };

    ensureParam({ key: 'sampleLog', label: '日志样例', inputType: 'textarea', defaultValue: '' });
    ensureParam({ key: 'samplePayload', label: '提取内容', inputType: 'textarea', defaultValue: '' });
    ensureParam({ key: 'llmTimeoutMs', label: 'LLM 判断超时（毫秒）', inputType: 'number', defaultValue: '15000' });
    ensureParam({ key: 'waitingStates', label: '等待状态（JSON）', inputType: 'textarea', defaultValue: '[]' });

    if (paramMap.has('assertionPrompt')) {
      const promptParam = paramMap.get('assertionPrompt');
      paramMap.set('assertionPrompt', {
        ...promptParam,
        defaultValue: promptParam?.defaultValue && !String(promptParam.defaultValue).includes('[0]')
          ? promptParam.defaultValue
          : DEFAULT_LLM_ASSERT_PROMPT,
        helperText: '只写业务判断诉求；solopi-desktop 会隐式要求模型返回 pass:boolean。变量引用使用 {{variables.xxx.path}}',
      } as ComponentParam);
    }

    return {
      ...normalizedComponent,
      params: Array.from(paramMap.values()),
    };
  }

  return component;
}

type RunStatus = 'pending' | 'running' | 'success' | 'failed' | 'stopped';
type WorkflowRunLog = WorkflowRunResult['results'][number];

type RunLogDisplayMode = 'compact' | 'full' | 'minimized';
type ActiveTaskRunRef = {
  requestId: string;
  taskId: string;
  caseId: string;
  stepIds: string[];
} | null;
type RecordingState = {
  stepId: string;
  startedAt: number;
} | null;
const componentKindLabels: Record<TestComponentKind, string> = {
  adb: 'ADB 命令组件',
  pc_command: '通用 PC 命令组件',
  activity: '拉起 Activity 组件',
  audio: '音频输入组件',
  image_mock: '图片 Mock 组件',
  mobile_ui_action: '手机 UI 操作组件',
  mobile_ui_assert: '手机 UI 校验组件',
  tts_assert: '日志文本提取断言组件',
  json_assert: 'JSON 日志断言组件',
  llm_assert: 'LLM 语义断言组件',
};

const assertComponentKinds = new Set<TestComponentKind>(['mobile_ui_assert', 'tts_assert', 'json_assert', 'llm_assert']);
const builtinAssertComponentIds = new Set([
  'template-mobile-ui-assert',
  'component-tts-text-assert',
  'component-json-log-assert',
  'template-tts-assert',
  'template-json-assert',
]);

function isAssertComponent(component?: TestComponent | null) {
  return Boolean(component?.kind && assertComponentKinds.has(component.kind));
}

function isAssertComponentStep(step: AutomationStep, componentMap: Map<string, TestComponent>) {
  if (step.type === 'rpc_assert') {
    return true;
  }

  if (step.type !== 'component' || !step.componentId) {
    return false;
  }

  const component = componentMap.get(step.componentId);
  return isAssertComponent(component) || builtinAssertComponentIds.has(step.componentId);
}

function ensureAssertScreenshotParam(component: TestComponent) {
  if (!isAssertComponent(component)) {
    return component;
  }

  const hasScreenshotParam = component.params.some((param) => param.key === 'captureScreenshotOnPass');
  const params = component.params.map((param) => (
    param.key === 'captureScreenshotOnPass'
      ? {
          ...param,
          defaultValue: 'true',
          helperText: param.helperText || 'true / false；无论检测通过或失败都会截屏',
        }
      : param
  ));

  if (!hasScreenshotParam) {
    params.push({
      key: 'captureScreenshotOnPass',
      label: '检测时截屏',
      inputType: 'text',
      defaultValue: 'true',
      helperText: 'true / false；无论检测通过或失败都会截屏',
    });
  }

  return {
    ...component,
    params,
  };
}

function createDefaultAudioRemoteDir() {
  return '/sdcard/Android/data/${defaults.phonePackage}/files/';
}

function isDefaultAudioRemotePath(value: string) {
  return !value
    || /^\/sdcard\/Download\/glassbox_audio\.[A-Za-z0-9]+$/.test(value)
    || /^\/sdcard\/Android\/data\/(?:\$\{defaults\.phonePackage\}|[^/]+)\/files\/(?:glassbox_audio\.[A-Za-z0-9]+)?$/.test(value);
}

const audioReservedParamKeys = new Set([
  'pushEnabled', 'pushDevice',
  'sourceType',
  'outputFormat',
  'codeFmt',
  'sampleFormat',
  'sampleRate',
  'channelCnt',
  'trailingSilenceMs',
  'localPath',
  'remotePath',
  'ttsText',
  'commandParams',
  'commandParamsText',
]);
const defaultAudioCommandTemplate = ''; // Audio delivery commands are supplied by the case or component configuration.
const defaultAudioTranscodeParams = {
  outputFormat: 'pcm',
  sampleFormat: 'AV_SAMPLE_FMT_S16',
  sampleRate: '16000',
  channelCnt: '1',
  trailingSilenceMs: '800',
};
const requiredTtsTextParam = {
  key: 'text',
  defaultValue: '',
};
const imageMockReservedParamKeys = new Set([
  'imagePath',
  'pushDevice',
  'remoteImagePath',
  'commandDevice',
]);
const defaultImageMockRemotePath = '/sdcard/Android/data/${defaults.glassesPackage}/files/';
const defaultPhonePackageName = '';
const defaultGlassesPackageName = '';
const defaultImageMockCommandTemplate = 'adb -s {{serial}} shell "am broadcast -a {{action}} --es {{pathExtraKey}} \\"{{remoteImagePath}}\\" {{extraArgs}}"';

const componentLibraryTabs = [
  { key: 'execute', label: '执行', kinds: ['adb', 'pc_command', 'activity', 'audio', 'image_mock', 'mobile_ui_action'] as TestComponentKind[] },
  { key: 'detect', label: '检测', kinds: ['mobile_ui_assert', 'tts_assert', 'json_assert', 'llm_assert'] as TestComponentKind[] },
] as const;

type ComponentLibraryTab = typeof componentLibraryTabs[number]['key'];

type JsonAssertCondition = {
  path: string;
  operator: 'equals' | 'notEquals' | 'contains' | 'notContains' | 'regex' | 'notRegex' | 'exists' | 'notExists';
  value: string;
  ignoreCase?: boolean;
};

const jsonAssertOperatorOptions: Array<{ value: JsonAssertCondition['operator']; label: string }> = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'regex', label: '正则匹配' },
  { value: 'notRegex', label: '正则不匹配' },
  { value: 'exists', label: '存在' },
  { value: 'notExists', label: '不存在' },
];

type TextAssertOperator = 'equals' | 'notEquals' | 'contains' | 'notContains' | 'regex' | 'notRegex';

const textAssertOperatorOptions: Array<{ value: TextAssertOperator; label: string }> = [
  { value: 'equals', label: '等于' },
  { value: 'notEquals', label: '不等于' },
  { value: 'contains', label: '包含' },
  { value: 'notContains', label: '不包含' },
  { value: 'regex', label: '正则匹配' },
  { value: 'notRegex', label: '正则不匹配' },
];

function normalizeTextAssertOperator(value: unknown): TextAssertOperator {
  const text = String(value || '').trim();
  if (text === 'notEquals' || text === 'contains' || text === 'notContains' || text === 'regex' || text === 'notRegex') {
    return text;
  }

  return 'equals';
}

function normalizeJsonAssertOperator(value: unknown): JsonAssertCondition['operator'] {
  const text = String(value || '').trim();

  if (
    text === 'contains'
    || text === 'notContains'
    || text === 'regex'
    || text === 'notRegex'
    || text === 'exists'
    || text === 'notExists'
    || text === 'notEquals'
  ) {
    return text;
  }

  return 'equals';
}

function parseJsonAssertConditionsForUi(value: unknown): JsonAssertCondition[] {
  if (Array.isArray(value)) {
    return value.map((condition) => ({
      path: String(condition?.path || ''),
      operator: normalizeJsonAssertOperator(condition?.operator),
      value: String(condition?.value ?? ''),
      ignoreCase: condition?.ignoreCase === true || String(condition?.ignoreCase || '').toLowerCase() === 'true',
    }));
  }

  try {
    const parsed = JSON.parse(String(value || '[]'));
    return parseJsonAssertConditionsForUi(parsed);
  } catch (_error) {
    return [];
  }
}

function stringifyJsonAssertConditions(conditions: JsonAssertCondition[]) {
  return JSON.stringify(
    conditions.map((condition) => ({
      path: condition.path,
      operator: condition.operator,
      value: condition.value,
      ignoreCase: Boolean(condition.ignoreCase),
    })),
    null,
    2
  );
}

const avSampleFormats = [
  { key: 'AV_SAMPLE_FMT_NONE', sampleType: -1, bitDepth: 0, label: 'NONE (-1 / 0bit)' },
  { key: 'AV_SAMPLE_FMT_U8', sampleType: 0, bitDepth: 8, label: 'U8 (0 / 8bit)' },
  { key: 'AV_SAMPLE_FMT_S16', sampleType: 1, bitDepth: 16, label: 'S16 (1 / 16bit)' },
  { key: 'AV_SAMPLE_FMT_S32', sampleType: 2, bitDepth: 32, label: 'S32 (2 / 32bit)' },
  { key: 'AV_SAMPLE_FMT_FLT', sampleType: 3, bitDepth: 32, label: 'FLT (3 / 32bit float)' },
  { key: 'AV_SAMPLE_FMT_DBL', sampleType: 4, bitDepth: 64, label: 'DBL (4 / 64bit double)' },
  { key: 'AV_SAMPLE_FMT_U8P', sampleType: 5, bitDepth: 8, label: 'U8P (5 / 8bit planar)' },
  { key: 'AV_SAMPLE_FMT_S16P', sampleType: 6, bitDepth: 16, label: 'S16P (6 / 16bit planar)' },
  { key: 'AV_SAMPLE_FMT_S32P', sampleType: 7, bitDepth: 32, label: 'S32P (7 / 32bit planar)' },
  { key: 'AV_SAMPLE_FMT_FLTP', sampleType: 8, bitDepth: 32, label: 'FLTP (8 / 32bit planar)' },
  { key: 'AV_SAMPLE_FMT_DBLP', sampleType: 9, bitDepth: 64, label: 'DBLP (9 / 64bit planar)' },
  { key: 'AV_SAMPLE_FMT_S64', sampleType: 10, bitDepth: 64, label: 'S64 (10 / 64bit)' },
  { key: 'AV_SAMPLE_FMT_S64P', sampleType: 11, bitDepth: 64, label: 'S64P (11 / 64bit planar)' },
] as const;

type AvSampleFormatKey = typeof avSampleFormats[number]['key'];

function resolveAvSampleFormat(value: unknown) {
  const raw = String(value ?? '').trim();
  const byKey = avSampleFormats.find((format) => format.key === raw);
  if (byKey) return byKey;

  const numericValue = Number(raw);
  const bySampleType = avSampleFormats.find((format) => format.sampleType === numericValue);
  return bySampleType || avSampleFormats.find((format) => format.key === defaultAudioTranscodeParams.sampleFormat)!;
}

function formatWorkflowDuration(ms: number) {
  if (!Number.isFinite(ms) || ms < 0) {
    return '';
  }

  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(ms >= 10000 ? 1 : 2)}s`;
  }

  return `${Math.round(ms)}ms`;
}

function buildEdgeRuntimeLabels(results: WorkflowRunLog[], sourceEdges: Edge[]) {
  const resultByStepId = new Map(results.map((item) => [item.stepId, item]));
  const labels: Record<string, string> = {};

  sourceEdges.forEach((edge) => {
    const sourceResult = resultByStepId.get(String(edge.source));
    const targetResult = resultByStepId.get(String(edge.target));
    const sourceCompletedAt = sourceResult?.completedAt || sourceResult?.endedAt;
    const targetCompletedAt = targetResult?.completedAt || targetResult?.endedAt;

    if (!sourceCompletedAt || !targetCompletedAt) {
      return;
    }

    const duration = new Date(targetCompletedAt).getTime() - new Date(sourceCompletedAt).getTime();
    const label = formatWorkflowDuration(duration);

    if (label) {
      labels[edge.id || `${edge.source}-${edge.target}`] = label;
    }
  });

  return labels;
}

function parseJsonRecordForPreview(value: unknown) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }

  const raw = String(value || '').trim();
  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch (_error) {
    return {};
  }
}

function getLlmMappingVariableNamesForPreview(config: AutomationStep['config']) {
  const storedMappings = config.outputMappings;

  if (Array.isArray(storedMappings)) {
    const names = storedMappings
      .map((item) => String((item as { variableName?: unknown })?.variableName ?? '').trim())
      .filter(Boolean);

    if (names.length > 0) {
      return names;
    }
  }

  return Object.keys(parseJsonRecordForPreview(config.saveToVariablesText || config.saveToVariables));
}

interface WorkflowPreviewContext {
  phoneSerial: string;
  glassesSerial: string;
  phonePackage: string;
  glassesPackage: string;
  variables: Record<string, unknown>;
  llmProviders?: LlmProviderConfig[];
  selectedLlmProviderId?: string;
}

type NodePosition = { x: number; y: number };
type NodePositions = Record<string, NodePosition>;
type CaseNodePositions = Record<string, NodePositions>;
type WorkflowNodeResultPreview = {
  kind: 'text' | 'audio' | 'error';
  text?: string;
  title?: string;
  path?: string;
  statusLabel?: string;
  canPlay?: boolean;
  stepId?: string;
};
type StepsToNodesOptions = {
  readOnlyPreview?: boolean;
  layoutPositions?: NodePositions;
  forceLayoutPositions?: boolean;
  runtimePreviews?: Record<string, WorkflowNodeResultPreview>;
};

const WORKFLOW_NODE_EDIT_GAP_X = 290;
const WORKFLOW_NODE_REPORT_GAP_X = 460;
const WORKFLOW_NODE_REPORT_GAP_Y = 260;
const WORKFLOW_NODE_REPORT_COLUMNS = 4;
const WORKFLOW_LAYOUT_BASE_X = 80;
const WORKFLOW_LAYOUT_BASE_Y = 160;
const WORKFLOW_LAYOUT_GAP_X = 460;
const WORKFLOW_LAYOUT_GAP_Y = 260;

function isNodePosition(value: unknown): value is NodePosition {
  return Boolean(
    value
    && typeof value === 'object'
    && typeof (value as NodePosition).x === 'number'
    && typeof (value as NodePosition).y === 'number'
  );
}

function isNodePositions(value: unknown): value is NodePositions {
  return Boolean(
    value
    && typeof value === 'object'
    && Object.values(value as Record<string, unknown>).every(isNodePosition)
  );
}

interface ComponentDraft {
  name: string;
  description: string;
  tags: string;
  kind: TestComponentKind;
  device: TestComponent['device'];
  timeoutSeconds: number;
  commandTemplate: string;
  params: ComponentParam[];
}

function getElectronApi() {
  try {
    return window.glassbox;
  } catch (_error) {
    return null;
  }
}

function getPathValue(source: Record<string, unknown>, pathExpression: string) {
  return pathExpression
    .split('.')
    .reduce<unknown>((current, key) => (
      current && typeof current === 'object' ? (current as Record<string, unknown>)[key] : undefined
    ), source);
}

function resolveTemplateValue(value: string, context: WorkflowPreviewContext) {
  const source = {
    defaults: {
      phoneSerial: context.phoneSerial,
      glassesSerial: context.glassesSerial,
      phonePackage: context.phonePackage,
      glassesPackage: context.glassesPackage,
    },
    variables: context.variables,
  };

  const resolveExpression = (_match: string, expression: string) => {
    const resolved = getPathValue(source, expression.trim());
    return resolved === undefined || resolved === null ? '' : String(resolved);
  };

  return value
    .replace(/\$\{([^}]+)\}/g, resolveExpression)
    .replace(/\{\{(defaults\.[^}]+|variables\.[^}]+)\}\}/g, resolveExpression);
}

function renderCommandPreview(component: TestComponent, step: AutomationStep, context: WorkflowPreviewContext) {
  const device = step.device || component.device;
  const serial = device === 'glasses' ? context.glassesSerial : device === 'phone' ? context.phoneSerial : '';
  const values: Record<string, string> = {
    serial,
    phoneSerial: context.phoneSerial,
    glassesSerial: context.glassesSerial,
    phonePackage: context.phonePackage,
    glassesPackage: context.glassesPackage,
  };

  component.params.forEach((param) => {
    const rawValue = step.inputs?.[param.key] ?? param.defaultValue ?? '';
    const resolved = param.templateMode === 'literal' ? rawValue : resolveTemplateValue(rawValue, context);

    if (param.inputType === 'json') {
      try {
        values[param.key] = JSON.stringify(JSON.parse(resolved || '{}'));
      } catch (_error) {
        values[param.key] = resolved;
      }
      return;
    }

    values[param.key] = resolved;
  });

  const commandTemplate = component.kind === 'pc_command' && component.commandTemplate.trim() === '{{command}}'
    ? values.command || ''
    : component.commandTemplate;
  return renderAdbTemplateWithValues(commandTemplate, values);
}

function renderAdbTemplateWithValues(template: string, values: Record<string, string>) {
  return String(template || '').replace(/\{\{([^}]+)\}\}/g, (_match, expression) => {
    const key = expression.trim();
    return values[key] ?? '';
  });
}

function buildLaunchActivityPreview(step: AutomationStep, component: TestComponent | undefined, context: WorkflowPreviewContext) {
  const device = step.device || component?.device || 'phone';
  const serial = device === 'glasses' ? context.glassesSerial : context.phoneSerial;
  const packageName = resolveTemplateValue(
    step.inputs?.packageName
      ?? component?.params.find((param) => param.key === 'packageName')?.defaultValue
      ?? '${defaults.phonePackage}',
    context
  );
  const activity = resolveTemplateValue(
    step.inputs?.activity
      ?? component?.params.find((param) => param.key === 'activity')?.defaultValue
      ?? '',
    context
  );

  return `adb -s ${serial || '{{serial}}'} shell am start -n ${packageName || '{{packageName}}'}/${activity || '{{activity}}'}`;
}

function getBaseNameFromPath(value: string) {
  const normalized = String(value || '').split(/[?#]/)[0].replace(/\\/g, '/');
  return normalized.split('/').filter(Boolean).pop() || 'glassbox_mock_image.png';
}

function normalizeImageMockRemotePathForPreview(remotePath: string, imagePath: string) {
  const raw = String(remotePath || defaultImageMockRemotePath).trim();
  const fileName = getBaseNameFromPath(imagePath || 'glassbox_mock_image.png');

  return raw.endsWith('/') ? `${raw}${fileName}` : raw;
}

function getImageMockCommandTemplate(component: TestComponent | undefined) {
  return component?.commandTemplate ?? defaultImageMockCommandTemplate;
}

function buildImageMockCommandPreview(step: AutomationStep, component: TestComponent | undefined, context: WorkflowPreviewContext) {
  const params = component?.params || [];
  const paramValue = (key: string, fallback = '') => (
    resolveTemplateValue(step.inputs?.[key] ?? params.find((param) => param.key === key)?.defaultValue ?? fallback, context) || fallback
  );
  const pushDevice = paramValue('pushDevice', 'glasses') === 'phone' ? 'phone' : 'glasses';
  const commandDevice = paramValue('commandDevice', 'phone') === 'pc' ? 'pc' : paramValue('commandDevice', 'phone') === 'glasses' ? 'glasses' : 'phone';
  const pushSerial = pushDevice === 'glasses' ? context.glassesSerial : context.phoneSerial;
  const commandSerial = commandDevice === 'pc' ? '' : commandDevice === 'glasses' ? context.glassesSerial : context.phoneSerial;
  const imagePath = paramValue('imagePath', '');
  const remoteImagePath = normalizeImageMockRemotePathForPreview(paramValue('remoteImagePath', defaultImageMockRemotePath), imagePath);
  const values: Record<string, string> = {
    serial: commandSerial,
    pushSerial,
    commandSerial,
    pushDevice,
    commandDevice,
    phoneSerial: context.phoneSerial,
    glassesSerial: context.glassesSerial,
    phonePackage: context.phonePackage,
    glassesPackage: context.glassesPackage,
    imagePath,
    localImagePath: imagePath,
    remoteImagePath,
    imageFileName: getBaseNameFromPath(imagePath || remoteImagePath),
  };

  params.forEach((param) => {
    values[param.key] = paramValue(param.key, param.defaultValue || '');
  });

  return renderAdbTemplateWithValues(getImageMockCommandTemplate(component), values);
}

function summarizeConfig(step: AutomationStep, component: TestComponent | undefined, context: WorkflowPreviewContext) {
  if (step.type === 'start') {
    return {
      说明: '工作流入口',
    };
  }

  if (step.type === 'end') {
    return {
      清理音频: step.config.cleanupAudioFiles === false ? '否' : '是',
      清理图片: step.config.cleanupImageFiles === false ? '否' : '是',
    };
  }

  if (step.type === 'if') {
    const config = step.config || {};
    const operator = config.regex ? 'regex' : config.notEmpty ? 'notEmpty' : 'equals';
    return {
      来源: String(config.condition || config.value || '未配置'),
      运算: operator,
      期望值: operator === 'regex'
        ? String(config.regex || '')
        : operator === 'equals'
          ? String(config.equals ?? '')
          : '非空',
      分支: 'true / false / error',
    };
  }

  if (step.type === 'component' && component) {
    const device = step.device || component.device;
    const deviceLabel = device === 'glasses' ? '眼镜设备' : device === 'pc' ? '当前电脑' : '手机设备';
    const serial = device === 'glasses' ? context.glassesSerial : device === 'phone' ? context.phoneSerial : '';
    const paramValue = (key: string, fallback = '') => (
      resolveTemplateValue(step.inputs?.[key] ?? component.params.find((param) => param.key === key)?.defaultValue ?? fallback, context) || fallback
    );

    if (component.kind === 'pc_command') {
      return {
        执行位置: '当前电脑（无需选择设备）',
        命令: renderCommandPreview(component, step, context) || '-',
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 30000} ms`,
      };
    }

    if (component.kind === 'audio') {
      const sampleFormat = resolveAvSampleFormat(paramValue('sampleFormat', defaultAudioTranscodeParams.sampleFormat));
      return {
        目标设备: device === 'pc' ? '当前电脑' : serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        来源: paramValue('sourceType', 'file'),
        格式: paramValue('outputFormat', 'pcm'),
        转码: `${sampleFormat.key} / ${paramValue('sampleRate', '16000')}Hz / 1ch`,
        本地文件: paramValue('localPath', '-'),
        Push目录: paramValue('pushEnabled', device === 'pc' ? 'false' : 'true') === 'true' ? paramValue('remotePath', createDefaultAudioRemoteDir()) : '已禁用',
        执行命令: component.commandTemplate || '-',
      };
    }

    if (component.kind === 'activity') {
      return {
        目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        包名: paramValue('packageName', '${defaults.phonePackage}'),
        Activity: paramValue('activity', '-'),
        ADB: buildLaunchActivityPreview(step, component, context),
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 5000} ms`,
      };
    }

    if (component.kind === 'image_mock') {
      const pushDevice = paramValue('pushDevice', 'glasses') === 'phone' ? 'phone' : 'glasses';
      const commandDevice = paramValue('commandDevice', 'phone') === 'pc' ? 'pc' : paramValue('commandDevice', 'phone') === 'glasses' ? 'glasses' : 'phone';
      const pushSerial = pushDevice === 'glasses' ? context.glassesSerial : context.phoneSerial;
      const commandSerial = commandDevice === 'pc' ? '' : commandDevice === 'glasses' ? context.glassesSerial : context.phoneSerial;
      return {
        图片推送设备: pushSerial ? `${pushDevice === 'glasses' ? '眼镜设备' : '手机设备'} / ${pushSerial}` : `${pushDevice === 'glasses' ? '眼镜设备' : '手机设备'} / 未选择`,
        执行设备: commandDevice === 'pc' ? '本机 PC' : commandSerial ? `${commandDevice === 'glasses' ? '眼镜设备' : '手机设备'} / ${commandSerial}` : `${commandDevice === 'glasses' ? '眼镜设备' : '手机设备'} / 未选择`,
        图片路径: paramValue('imagePath', '-'),
        Push路径: normalizeImageMockRemotePathForPreview(paramValue('remoteImagePath', defaultImageMockRemotePath), paramValue('imagePath', '')),
        Mock指令: buildImageMockCommandPreview(step, component, context),
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 30000} ms`,
      };
    }

    if (component.kind === 'mobile_ui_action') {
      if (paramValue('action', 'tap') === 'solopi_replay') {
        let count = 0; try { count = JSON.parse(paramValue('nativeCase', '{}')).operationLog?.steps?.length || 0; } catch { /* validation displays malformed JSON */ }
        return { 目标设备: serial ? `${deviceLabel} / ${serial}` : '未选择手机', 执行引擎: 'SoloPi 原生回放', 动作数: `${count}`, 超时: `${paramValue('runTimeoutMs', '600000')} ms` };
      }
      return {
        目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        操作: mobileUiActionLabels[paramValue('action', 'tap')] || paramValue('action', 'tap'),
        点击位置: mobileUiTapPositionLabels[normalizeMobileUiTapPosition(paramValue('tapPosition', 'center'))],
        横向内缩: `${normalizeMobileUiTapInset(paramValue('tapInsetXPx', paramValue('tapInsetPx', '5')))}px`,
        纵向内缩: `${normalizeMobileUiTapInset(paramValue('tapInsetYPx', paramValue('tapInsetPx', '5')))}px`,
        选择器: paramValue('selector', '-'),
        输入: paramValue('inputText', '-'),
        滑动: paramValue('action', 'tap') === 'swipe_element' ? `${({ up: '上', down: '下', left: '左', right: '右' } as Record<string, string>)[paramValue('direction', 'up')] || paramValue('direction', 'up')}滑 ${paramValue('distancePercent', '100')}% · ${paramValue('swipeDurationMs', '300')}ms` : paramValue('swipe', '-'),
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 10000} ms`,
      };
    }

    if (component.kind === 'mobile_ui_assert') {
      return {
        目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        选择器: paramValue('selector', '-'),
        匹配方式: paramValue('matchMode', 'auto'),
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 10000} ms`,
      };
    }

    if (component.kind === 'tts_assert') {
      return {
        目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        提取正则: paramValue('extractRegex', '-'),
        期望文本: paramValue('expectedText', '-'),
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 10000} ms`,
      };
    }

    if (component.kind === 'json_assert') {
      const conditionSummary = parseJsonAssertConditionsForUi(paramValue('conditions', '[]'))
        .map((condition) => `${condition.path || '-'} ${jsonAssertOperatorOptions.find((option) => option.value === condition.operator)?.label || condition.operator} ${condition.operator === 'exists' || condition.operator === 'notExists' ? '' : condition.value}`)
        .join('；') || '-';

      return {
        目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        日志正则: paramValue('lineRegex', '-'),
        条件: conditionSummary,
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 10000} ms`,
      };
    }

    if (component.kind === 'llm_assert') {
      return {
        目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
        模型配置: paramValue('providerId', '默认模型'),
        日志正则: paramValue('lineRegex', '-'),
        断言诉求: paramValue('assertionPrompt', '-'),
        超时: `${step.timeoutMs || component.timeoutSeconds * 1000 || 10000} ms`,
      };
    }

    return {
      目标设备: serial ? `${deviceLabel} / ${serial}` : `${deviceLabel} / 未选择`,
      ...Object.fromEntries(component.params.map((param) => [
        param.label || param.key,
        resolveTemplateValue(step.inputs?.[param.key] ?? param.defaultValue ?? '', context) || '-',
      ])),
      ADB: renderCommandPreview(component, step, context),
    };
  }

  if (step.type === 'launch_test_page') {
    return {
      包名: step.config.packageName || '${defaults.phonePackage}',
      Activity: step.config.activity || 'TestPageActivity',
    };
  }

  if (step.type === 'broadcast_scene') {
    const params = step.config.params as Record<string, unknown> | undefined;

    return {
      Action: step.config.action || '-',
      Params: Object.keys(params || {}).length ? JSON.stringify(params) : '-',
    };
  }

  if (step.type === 'llm_text_generate') {
    const prompt = String(step.config.prompt || '').trim();
    const provider = context.llmProviders?.find((item) => item.id === step.config.providerId)
      || context.llmProviders?.find((item) => item.id === context.selectedLlmProviderId)
      || context.llmProviders?.[0];
    const modelName = String(provider?.model || '').trim();
    const providerLabel = provider
      ? `${provider.name || '未命名模型'}${modelName ? ` / ${modelName}` : ''}`
      : '未配置模型';

    return {
      节点位置: '电脑侧预处理',
      模型: providerLabel,
      输出: step.config.outputMode === 'text' ? '文本' : 'JSON',
      Prompt: prompt || '-',
      写入变量: getLlmMappingVariableNamesForPreview(step.config).join(', ') || '-',
    };
  }

  if (step.type === 'http_request') {
    return {
      节点位置: '电脑侧预处理',
      方法: step.config.method || 'GET',
      URL: step.config.url || '-',
      响应: step.config.responseType === 'text' ? '文本' : 'JSON',
      写入变量: Object.keys(parseJsonRecordForPreview(step.config.saveToVariablesText || step.config.saveToVariables)).join(', ') || '-',
    };
  }

  if (step.type === 'tts_synthesize') {
    const nodeKey = normalizeTtsNodeVariableKey(step.name || step.id);
    return {
      节点位置: '电脑侧预处理',
      文本: step.config.text || '-',
      输出变量: `variables.${nodeKey}.audioPath`,
    };
  }

  if (step.type === 'send_audio') {
    const sampleFormat = resolveAvSampleFormat(step.config.sampleFormat || defaultAudioTranscodeParams.sampleFormat);
    return {
      目标设备: step.device === 'glasses' ? '眼镜设备' : '手机设备',
      来源: step.config.sourceType === 'tts' ? 'TTS' : step.config.sourceType === 'record' ? '电脑录音' : '本地文件',
      转码: `${sampleFormat.key} / ${step.config.sampleRate || '16000'}Hz / 1ch`,
      本地文件: step.config.localPath || '-',
      Push目录: step.config.remotePath || createDefaultAudioRemoteDir(),
      ADB: step.config.commandTemplate || 'adb -s {{serial}} shell ...',
    };
  }

  if (step.type === 'wait') {
    return {
      时长: `${step.config.durationMs || 0} ms`,
    };
  }

  if (step.type === 'debug_forward') {
    return {
      端口: `${step.config.localPort || 8080} -> ${step.config.remotePort || 8080}`,
    };
  }

  return step.config;
}

function getWorkflowNodePreviewLine(step: AutomationStep, context: WorkflowPreviewContext) {
  if (step.type === 'if') {
    const operator = step.config.regex ? 'regex' : step.config.notEmpty ? 'notEmpty' : 'equals';
    const expected = operator === 'regex'
      ? String(step.config.regex || '')
      : operator === 'equals'
        ? String(step.config.equals ?? '')
        : '非空';
    return `${String(step.config.condition || step.config.value || '未配置')} · ${operator} · ${expected}`;
  }

  if (step.type === 'llm_text_generate') {
    const provider = context.llmProviders?.find((item) => item.id === step.config.providerId)
      || context.llmProviders?.find((item) => item.id === context.selectedLlmProviderId)
      || context.llmProviders?.[0];
    const modelName = String(provider?.model || '').trim();
    const prompt = String(step.config.prompt || '').trim();
    const variables = getLlmMappingVariableNamesForPreview(step.config);
    return [
      modelName || provider?.name || '未配置模型',
      variables.length > 0 ? `写入 ${variables.map((name) => `variables.${name}`).join(', ')}` : '',
      prompt ? prompt.slice(0, 80) : '未配置 Prompt',
    ].filter(Boolean).join(' · ');
  }

  if (step.type === 'http_request') {
    return `${String(step.config.method || 'GET').toUpperCase()} · ${String(step.config.url || '未配置 URL').slice(0, 80)}`;
  }

  if (step.type === 'tts_synthesize') {
    const nodeKey = normalizeTtsNodeVariableKey(step.name || step.id);
    return `variables.${nodeKey}.audioPath · ${String(step.config.text || '').slice(0, 60) || '未配置文本'}`;
  }

  return '';
}

function compactWorkflowResultText(value: unknown, maxLength = 900) {
  const raw = String(value || '').trim();
  if (!raw) {
    return '';
  }

  const normalized = raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => line.trimEnd())
    .filter((line, index, lines) => line || (index > 0 && lines[index - 1]))
    .join('\n')
    .trim();

  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function getWorkflowRunLogDetail(result: WorkflowRunLog) {
  const sections: Array<{ label: string; value: string }> = [];
  const seen = new Set<string>();
  const addSection = (label: string, value: unknown) => {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) {
      return;
    }
    seen.add(text);
    sections.push({ label, value: text });
  };

  const assertion = result.meta?.assertion as { outcome?: string; blocking?: boolean; continued?: boolean } | undefined;
  if (assertion) addSection('断言结果', assertion.outcome === 'timeout'
    ? assertion.continued ? '超时未命中（非卡点，继续执行）' : '超时未命中（卡点，终止执行）'
    : assertion.outcome === 'matched' ? '命中' : assertion.continued ? '断言未通过或执行异常（非卡点，按成功继续）' : '断言执行异常');
  addSection('错误', result.error);
  addSection('标准错误', result.stderr);
  addSection(result.status === 'failed' ? 'HTTP / 节点原始输出' : '节点输出', result.stdout);

  const httpResponse = (result.meta as { httpResponse?: unknown } | undefined)?.httpResponse;
  if (httpResponse && !result.stdout) {
    addSection('HTTP 响应证据', JSON.stringify(httpResponse, null, 2));
  }

  return sections.map((section) => `${section.label}：\n${section.value}`).join('\n\n');
}

function getPathFileNameForPreview(filePath: string) {
  const parts = String(filePath || '').split(/[\\/]/);
  return parts[parts.length - 1] || filePath;
}

function buildWorkflowNodeResultPreviews(
  steps: AutomationStep[],
  results: WorkflowRunLog[],
  artifacts: WorkflowRunResult['artifacts'] | null
) {
  const previews: Record<string, WorkflowNodeResultPreview> = {};
  const stepById = new Map(steps.map((step) => [step.id, step]));

  results.forEach((result) => {
    if (!result?.stepId) {
      return;
    }

    if (result.status === 'failed' || result.error) {
      const text = compactWorkflowResultText(getWorkflowRunLogDetail(result) || '节点执行失败');
      previews[result.stepId] = {
        kind: 'error',
        text,
        statusLabel: '失败',
      };
      return;
    }

    const text = compactWorkflowResultText(getWorkflowRunLogDetail(result) || result.command || '');
    if (text) {
      previews[result.stepId] = {
        kind: 'text',
        text,
        statusLabel: (result.meta?.assertion as { outcome?: string } | undefined)?.outcome === 'timeout' ? '超时继续' : result.status === 'success' ? '成功' : result.status,
      };
    }
  });

  (artifacts?.generatedTtsAudioFiles || []).forEach((artifact) => {
    const stepId = artifact?.stepId;
    if (!stepId) {
      return;
    }

    const localPath = String(artifact.localPath || '').trim();
    previews[stepId] = {
      kind: 'audio',
      title: artifact.text ? `文案：${artifact.text}` : getPathFileNameForPreview(localPath),
      path: localPath,
      statusLabel: '音频',
      canPlay: Boolean(localPath),
      stepId,
    };
  });

  (artifacts?.pushedAudioFiles || []).forEach((artifact) => {
    const stepId = artifact?.stepId;
    if (!stepId) {
      return;
    }

    const localPath = String(artifact.localPath || artifact.pushedLocalPath || artifact.sourceLocalPath || '').trim();
    previews[stepId] = {
      kind: 'audio',
      title: getPathFileNameForPreview(localPath || artifact.remotePath || ''),
      path: localPath || artifact.remotePath,
      statusLabel: '音频',
      canPlay: Boolean(localPath),
      stepId,
    };
  });

  Object.entries(previews).forEach(([stepId, preview]) => {
    const step = stepById.get(stepId);
    if (!step || preview.kind !== 'text') {
      return;
    }

    if (step.type === 'tts_synthesize' || step.type === 'send_audio') {
      const localPath = String(step.config.localPath || '').trim();
      if (localPath) {
        previews[stepId] = {
          kind: 'audio',
          title: getPathFileNameForPreview(localPath),
          path: localPath,
          statusLabel: '音频',
          canPlay: true,
          stepId,
        };
      }
    }
  });

  return previews;
}

function stepsToNodes(
  steps: AutomationStep[],
  statuses: Record<string, RunStatus>,
  components: TestComponent[],
  context: WorkflowPreviewContext,
  nodePositions: NodePositions,
  onDelete: (stepId: string) => void,
  options: StepsToNodesOptions = {}
): Node[] {
  const componentMap = new Map(components.map((component) => [component.id, component]));

  return steps.map((step, index) => {
    const component = step.componentId ? componentMap.get(step.componentId) : undefined;
    const reportColumn = index % WORKFLOW_NODE_REPORT_COLUMNS;
    const reportRow = Math.floor(index / WORKFLOW_NODE_REPORT_COLUMNS);
    const fallbackPosition = options.readOnlyPreview
      ? {
          x: 80 + reportColumn * WORKFLOW_NODE_REPORT_GAP_X,
          y: 120 + reportRow * WORKFLOW_NODE_REPORT_GAP_Y,
        }
      : {
          x: 60 + index * WORKFLOW_NODE_EDIT_GAP_X,
          y: 140,
        };

    return {
      id: step.id,
      type: nodeTypeMap[step.type],
      position: options.forceLayoutPositions
        ? options.layoutPositions?.[step.id] || fallbackPosition
        : nodePositions[step.id] || options.layoutPositions?.[step.id] || fallbackPosition,
      draggable: !options.readOnlyPreview,
      selectable: true,
      connectable: !options.readOnlyPreview,
      data: {
        label: step.name,
        stepTypeLabel: component
          ? component.kind === 'audio'
            ? '音频测试组件'
            : component.kind === 'image_mock'
              ? '图片 Mock 组件'
            : component.kind === 'mobile_ui_assert' || component.kind === 'tts_assert' || component.kind === 'json_assert' || component.kind === 'llm_assert'
              ? componentKindLabels[component.kind]
              : componentKindLabels[component.kind || 'adb']
          : stepTypeLabels[step.type],
        previewLine: getWorkflowNodePreviewLine(step, context),
        iconType: component?.kind === 'audio'
          ? 'audio'
          : component?.kind === 'image_mock'
            ? 'image'
          : component?.kind === 'mobile_ui_action'
            ? 'mobile'
          : component?.kind === 'mobile_ui_assert' || component?.kind === 'tts_assert' || component?.kind === 'json_assert' || component?.kind === 'llm_assert'
            ? 'capture'
            : iconTypeMap[step.type],
        config: summarizeConfig(step, component, context),
        resultPreview: options.runtimePreviews?.[step.id],
        status: statuses[step.id] || 'pending',
        onDelete: options.readOnlyPreview ? undefined : () => onDelete(step.id),
      },
    };
  });
}

function stepsToEdges(steps: AutomationStep[]): Edge[] {
  return steps.slice(1).map((step, index) => ({
    id: `edge-${steps[index].id}-${step.id}`,
    source: steps[index].id,
    target: step.id,
  }));
}

const conditionalSourceHandles = ['true', 'false', 'error'] as const;
type ConditionalSourceHandle = typeof conditionalSourceHandles[number];

function normalizeConditionalEdgeHandles(testCase: AutomationCase, edges: Edge[]): Edge[] {
  const conditionalStepIds = new Set((testCase.steps || [])
    .filter((step) => step.type === 'if')
    .map((step) => step.id));
  if (conditionalStepIds.size === 0) {
    return edges || [];
  }

  const usedBySource = new Map<string, Set<string>>();
  return (edges || []).map((edge) => {
    if (!conditionalStepIds.has(edge.source)) {
      return edge;
    }

    const rawHandle = String(
      edge.sourceHandle
      ?? (edge as Edge & { sourcehandle?: string }).sourcehandle
      ?? (edge as Edge & { handle?: string }).handle
      ?? (edge as Edge & { condition?: string }).condition
      ?? ''
    ).trim().toLowerCase();
    const mappedHandle: ConditionalSourceHandle | undefined = rawHandle === 'yes'
      ? 'true'
      : rawHandle === 'no'
        ? 'false'
        : conditionalSourceHandles.includes(rawHandle as ConditionalSourceHandle)
          ? rawHandle as ConditionalSourceHandle
          : undefined;
    const used = usedBySource.get(edge.source) || new Set<string>();
    const sourceHandle = mappedHandle
      || conditionalSourceHandles.find((handle) => !used.has(handle))
      || 'true';
    used.add(sourceHandle);
    usedBySource.set(edge.source, used);
    return {
      ...edge,
      sourceHandle,
    };
  });
}

function collectWorkflowVariableNames(steps: AutomationStep[]) {
  const usedNames = new Set<string>();

  const addName = (value: unknown) => {
    const name = String(value ?? '').trim().replace(/^variables\./, '');
    if (name) {
      usedNames.add(name);
    }
  };

  const addJsonKeys = (value: unknown) => {
    Object.keys(parseJsonRecordForPreview(value)).forEach(addName);
  };

  steps.forEach((step) => {
    addName(step.inputs?.extractVariableName);
    addName(step.config?.extractVariableName);
    addName(step.config?.saveToVariable);

    if (step.type === 'llm_text_generate') {
      if (Array.isArray(step.config.outputMappings)) {
        step.config.outputMappings.forEach((item) => addName((item as { variableName?: unknown })?.variableName));
      }
      addJsonKeys(step.config.saveToVariablesText || step.config.saveToVariables);
    }

    if (step.type === 'http_request') {
      if (Array.isArray(step.config.responseMappings)) {
        step.config.responseMappings.forEach((item) => addName((item as { variableName?: unknown })?.variableName));
      }
      addJsonKeys(step.config.saveToVariablesText || step.config.saveToVariables);
    }

    if (step.type === 'tts_synthesize') {
      addName(normalizeTtsNodeVariableKey(step.name || step.id));
    }
  });

  return usedNames;
}

function createUniqueWorkflowVariableName(steps: AutomationStep[], baseName: string) {
  const usedNames = collectWorkflowVariableNames(steps);

  if (!usedNames.has(baseName)) {
    return baseName;
  }

  let index = 2;
  while (usedNames.has(`${baseName}${index}`)) {
    index += 1;
  }

  return `${baseName}${index}`;
}

function createUniqueLlmTextVariableName(steps: AutomationStep[], baseName = DEFAULT_LLM_TEXT_VARIABLE_NAME) {
  return createUniqueWorkflowVariableName(steps, baseName);
}

function ensureAssertExtractionInputs(step: AutomationStep, _steps: AutomationStep[], _defaultVariableName: string) {
  const inputs = step.inputs || {};

  return {
    ...step,
    inputs: {
      ...inputs,
      extractVariableEnabled: inputs.extractVariableEnabled ?? 'false',
      extractVariableName: String(inputs.extractVariableName || '').trim(),
    },
  };
}

function getAssertExtractionDefaultName(step: AutomationStep, componentMap: Map<string, TestComponent>) {
  const component = step.componentId ? componentMap.get(step.componentId) : undefined;
  const kind = component?.kind;

  if (kind === 'tts_assert' || step.componentId === 'component-tts-text-assert' || step.componentId === 'template-tts-assert') {
    return DEFAULT_TEXT_ASSERT_VARIABLE_NAME;
  }
  if (kind === 'json_assert' || step.componentId === 'component-json-log-assert' || step.componentId === 'template-json-assert') {
    return DEFAULT_JSON_ASSERT_VARIABLE_NAME;
  }
  if (kind === 'llm_assert' || step.componentId === 'component-llm-assert' || step.componentId === 'template-llm-assert') {
    return DEFAULT_LLM_ASSERT_VARIABLE_NAME;
  }

  return '';
}

const initialAutomationCase = createDefaultCase();

function normalizeStoredCase(testCase: AutomationCase) {
  const normalizedCase = normalizeCaseFailurePolicy(ensureWorkflowBoundarySteps(testCase), createDefaultComponents());
  const componentMap = new Map([
    ...createDefaultComponents(),
    ...(normalizedCase.components || []),
  ].map((component) => [component.id, ensureAssertScreenshotParam(component)]));

  return {
    ...normalizedCase,
    components: normalizedCase.components
      ?.filter(isSupportedComponent)
      .map(ensureAssertScreenshotParam),
    steps: normalizedCase.steps.map((step) => (
      step.type === 'start'
        ? {
            ...step,
            config: {
              ...(step.config || {}),
              recordGlassesScreen: false,
            },
          }
        : step.type === 'component' && getAssertExtractionDefaultName(step, componentMap)
          ? ensureAssertExtractionInputs({
              ...step,
              timeoutMs: getAssertExtractionDefaultName(step, componentMap) === DEFAULT_JSON_ASSERT_VARIABLE_NAME
                ? Math.max(Number(step.timeoutMs || 0), 45000)
                : step.timeoutMs,
              inputs: {
                ...(step.inputs || {}),
                captureScreenshotOnPass: 'true',
              },
            }, normalizedCase.steps, getAssertExtractionDefaultName(step, componentMap))
          : isAssertComponentStep(step, componentMap)
            ? {
                ...step,
                inputs: {
                  ...(step.inputs || {}),
                  captureScreenshotOnPass: 'true',
                },
                config: {
                  ...(step.config || {}),
                  captureScreenshotOnPass: true,
                },
              }
            : step
    )),
  };
}

function normalizeStoredCases(cases: AutomationCase[]) {
  return cases.map(normalizeStoredCase);
}

function migrateCaseNodePositions(testCase: AutomationCase, rawPositions: unknown, edges: Edge[]): NodePositions {
  const stepIds = new Set((testCase.steps || []).map((step) => step.id));
  const stored = rawPositions && typeof rawPositions === 'object' && !Array.isArray(rawPositions)
    ? rawPositions as Record<string, unknown>
    : {};
  const validStored = Object.fromEntries(Object.entries(stored).filter(([id, position]) => (
    stepIds.has(id) && isNodePosition(position)
  ))) as NodePositions;
  const generated = createWorkflowAutoLayoutPositions(testCase.steps || [], ensureBoundaryEdges(testCase, edges || []));
  if (Object.keys(validStored).length === stepIds.size) {
    return validStored;
  }
  return Object.fromEntries([...stepIds].map((id) => [id, validStored[id] || generated[id]]));
}

function ensureBoundaryEdges(testCase: AutomationCase, edges: Edge[]) {
  const stepIds = new Set(testCase.steps.map((step) => step.id));
  const validEdges = (edges || []).filter((edge) => stepIds.has(edge.source) && stepIds.has(edge.target));
  const sourceEdges = normalizeConditionalEdgeHandles(
    testCase,
    validEdges.length ? validEdges : stepsToEdges(testCase.steps)
  );
  const orderedSteps = orderStepsByEdges(testCase.steps, sourceEdges);
  const rank = new Map(orderedSteps.map((step, index) => [step.id, index]));
  return sourceEdges.slice().sort((left, right) => (
    (rank.get(left.source) || 0) - (rank.get(right.source) || 0)
    || (conditionalSourceHandles.indexOf(String(left.sourceHandle || '') as ConditionalSourceHandle)
      - conditionalSourceHandles.indexOf(String(right.sourceHandle || '') as ConditionalSourceHandle))
    || (rank.get(left.target) || 0) - (rank.get(right.target) || 0)
    || String(left.id || '').localeCompare(String(right.id || ''))
  ));
}

function readFileAsText(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取文件失败'));
    reader.readAsText(file);
  });
}

function parseAutomationCaseList(text: string, fileName = '') {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error('文件内容为空');
  }

  if (fileName.endsWith('.json') || trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsed = JSON.parse(trimmed) as AutomationCase | AutomationCase[] | { cases?: AutomationCase[] };
    const sourceCases = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as { cases?: AutomationCase[] }).cases)
        ? (parsed as { cases: AutomationCase[] }).cases
        : [parsed as AutomationCase];

    return sourceCases.map((testCase) => normalizeStoredCase(normalizeCase(testCase)));
  }

  return trimmed
    .split(/\n---+\n/g)
    .map((document) => document.trim())
    .filter(Boolean)
    .map((document) => normalizeStoredCase(parseAutomationCase(document, fileName)));
}

function formatRunTime(value?: string) {
  if (!value) {
    return '-';
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleTimeString('zh-CN', { hour12: false });
}

function summarizePerformanceValues(values: Array<number | undefined>) {
  const nums = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value));

  if (nums.length === 0) {
    return { avg: undefined, max: undefined, min: undefined };
  }

  return {
    avg: nums.reduce((sum, value) => sum + value, 0) / nums.length,
    max: Math.max(...nums),
    min: Math.min(...nums),
  };
}

function formatPerformanceMetric(value: number | undefined, suffix = '') {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(value >= 100 ? 0 : 1)}${suffix}` : '-';
}

function formatPerformanceMemory(kb: number | undefined) {
  if (typeof kb !== 'number' || !Number.isFinite(kb)) {
    return '-';
  }

  return kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb.toFixed(0)} KB`;
}

function formatRunDuration(log: WorkflowRunLog) {
  const startedAt = new Date(log.startedAt).getTime();
  const endedAt = new Date((log.completedAt || log.endedAt || '') as string).getTime();

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) {
    return '-';
  }

  return `${Math.max(0, endedAt - startedAt)} ms`;
}

function getCaseStartedAt(caseRecord: AutomationTaskCaseRecord) {
  return caseRecord.startedAt || caseRecord.results?.[0]?.startedAt || '';
}

function formatCaseDuration(caseRecord: AutomationTaskCaseRecord) {
  const startedAt = new Date(getCaseStartedAt(caseRecord)).getTime();
  const endedAt = new Date(caseRecord.endedAt || caseRecord.results?.slice(-1)[0]?.endedAt || '').getTime();

  if (Number.isNaN(startedAt) || Number.isNaN(endedAt)) {
    return '-';
  }

  return `${Math.max(0, endedAt - startedAt)} ms`;
}

function normalizeRunLogTiming(log: WorkflowRunLog): WorkflowRunLog {
  const completedAt = log.completedAt || log.endedAt || log.startedAt;
  return {
    ...log,
    completedAt,
    endedAt: log.endedAt || completedAt,
  };
}

function normalizeRunLogsTiming(logs: WorkflowRunLog[] = []) {
  return logs.map(normalizeRunLogTiming);
}

function cloneAutomationCase(testCase: AutomationCase): AutomationCase {
  return JSON.parse(JSON.stringify(testCase)) as AutomationCase;
}

function normalizeReportCaseForPreview(testCase: AutomationCase): AutomationCase {
  return normalizeCase(cloneAutomationCase(testCase));
}

function cloneWorkflowStep(step: AutomationStep): AutomationStep {
  return JSON.parse(JSON.stringify(step)) as AutomationStep;
}

function shouldIgnoreWorkflowShortcut(target: EventTarget | null) {
  const selectedText = typeof window !== 'undefined'
    ? window.getSelection()?.toString()
    : '';

  if (selectedText?.trim()) {
    return true;
  }

  if (!(target instanceof HTMLElement)) {
    return false;
  }

  return Boolean(target.closest('input, textarea, select, [contenteditable="true"]'));
}

function clampAudioSample(value: number) {
  return Math.max(-1, Math.min(1, value));
}

const recordingStopFlushDelayMs = 500;
const recordingLeadSilenceMs = 200;
const recordingTailSilenceMs = 600;

function audioBufferToPcm16(audioBuffer: AudioBuffer) {
  const channelCount = audioBuffer.numberOfChannels;
  const frameCount = audioBuffer.length;
  const output = new ArrayBuffer(frameCount * channelCount * 2);
  const view = new DataView(output);
  let offset = 0;

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const sample = clampAudioSample(audioBuffer.getChannelData(channel)[frame]);
      const int16 = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      view.setInt16(offset, int16, true);
      offset += 2;
    }
  }

  return output;
}

function audioBufferToSampleFormat(audioBuffer: AudioBuffer, sampleFormatValue: unknown) {
  const sampleFormat = resolveAvSampleFormat(sampleFormatValue);
  const channelCount = audioBuffer.numberOfChannels;
  const frameCount = audioBuffer.length;
  const bytesPerSample = Math.max(1, sampleFormat.bitDepth / 8);
  const output = new ArrayBuffer(frameCount * channelCount * bytesPerSample);
  const view = new DataView(output);
  const isPlanar = sampleFormat.key.endsWith('P');
  const sampleOffset = (frame: number, channel: number) => (
    (isPlanar ? channel * frameCount + frame : frame * channelCount + channel) * bytesPerSample
  );

  for (let frame = 0; frame < frameCount; frame += 1) {
    for (let channel = 0; channel < channelCount; channel += 1) {
      const offset = sampleOffset(frame, channel);
      const sample = clampAudioSample(audioBuffer.getChannelData(channel)[frame]);

      switch (sampleFormat.key) {
        case 'AV_SAMPLE_FMT_U8':
        case 'AV_SAMPLE_FMT_U8P':
          view.setUint8(offset, Math.round((sample + 1) * 127.5));
          break;
        case 'AV_SAMPLE_FMT_S32':
        case 'AV_SAMPLE_FMT_S32P':
          view.setInt32(offset, Math.round(sample < 0 ? sample * 0x80000000 : sample * 0x7fffffff), true);
          break;
        case 'AV_SAMPLE_FMT_FLT':
        case 'AV_SAMPLE_FMT_FLTP':
          view.setFloat32(offset, sample, true);
          break;
        case 'AV_SAMPLE_FMT_DBL':
        case 'AV_SAMPLE_FMT_DBLP':
          view.setFloat64(offset, sample, true);
          break;
        case 'AV_SAMPLE_FMT_S64':
        case 'AV_SAMPLE_FMT_S64P':
          view.setBigInt64(offset, BigInt(Math.round(sample < 0 ? sample * Number(0x8000000000000000n) : sample * Number(0x7fffffffffffffffn))), true);
          break;
        case 'AV_SAMPLE_FMT_S16':
        case 'AV_SAMPLE_FMT_S16P':
        default:
          view.setInt16(offset, Math.round(sample < 0 ? sample * 0x8000 : sample * 0x7fff), true);
          break;
      }
    }
  }

  return output;
}

async function renderAudioBuffer(audioBuffer: AudioBuffer, sampleRate: number, channelCnt: number) {
  const targetSampleRate = Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 16000;
  const targetChannelCnt = Number.isFinite(channelCnt) && channelCnt > 0 ? Math.max(1, Math.min(2, channelCnt)) : 1;
  const frameCount = Math.max(1, Math.ceil((audioBuffer.length / audioBuffer.sampleRate) * targetSampleRate));
  const OfflineAudioContextCtor = window.OfflineAudioContext || (window as any).webkitOfflineAudioContext;

  if (!OfflineAudioContextCtor) {
    return audioBuffer;
  }

  const offlineContext = new OfflineAudioContextCtor(targetChannelCnt, frameCount, targetSampleRate);
  const source = offlineContext.createBufferSource();

  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start(0);

  return offlineContext.startRendering() as Promise<AudioBuffer>;
}

function padAudioBuffer(audioContext: BaseAudioContext, audioBuffer: AudioBuffer, leadMs: number, tailMs: number) {
  const leadFrames = Math.max(0, Math.round((leadMs / 1000) * audioBuffer.sampleRate));
  const tailFrames = Math.max(0, Math.round((tailMs / 1000) * audioBuffer.sampleRate));

  if (leadFrames === 0 && tailFrames === 0) {
    return audioBuffer;
  }

  const paddedBuffer = audioContext.createBuffer(
    audioBuffer.numberOfChannels,
    audioBuffer.length + leadFrames + tailFrames,
    audioBuffer.sampleRate
  );

  for (let channel = 0; channel < audioBuffer.numberOfChannels; channel += 1) {
    paddedBuffer.getChannelData(channel).set(audioBuffer.getChannelData(channel), leadFrames);
  }

  return paddedBuffer;
}

function audioBufferToWav(audioBuffer: AudioBuffer) {
  const pcm = audioBufferToPcm16(audioBuffer);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeString = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  const channelCount = audioBuffer.numberOfChannels;
  const sampleRate = audioBuffer.sampleRate;
  const byteRate = sampleRate * channelCount * 2;

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + pcm.byteLength, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, byteRate, true);
  view.setUint16(32, channelCount * 2, true);
  view.setUint16(34, 16, true);
  writeString(36, 'data');
  view.setUint32(40, pcm.byteLength, true);

  const output = new Uint8Array(header.byteLength + pcm.byteLength);
  output.set(new Uint8Array(header), 0);
  output.set(new Uint8Array(pcm), header.byteLength);

  return output.buffer;
}

interface AudioTranscodeSettings {
  outputFormat: string;
  sampleFormat: AvSampleFormatKey;
  sampleRate: number;
  channelCnt: number;
}

function normalizeAudioTranscodeSettings(source: Record<string, unknown>): AudioTranscodeSettings {
  const outputFormat = String(source.outputFormat || source.codeFmt || defaultAudioTranscodeParams.outputFormat).toLowerCase();
  const sampleFormat = resolveAvSampleFormat(source.sampleFormat || defaultAudioTranscodeParams.sampleFormat);
  const sampleRate = Number(source.sampleRate || defaultAudioTranscodeParams.sampleRate);
  const channelCnt = Number(source.channelCnt || defaultAudioTranscodeParams.channelCnt);

  return {
    outputFormat: ['pcm', 'wav', 'ogg', 'speex'].includes(outputFormat) ? outputFormat : 'pcm',
    sampleFormat: sampleFormat.key,
    sampleRate: Number.isFinite(sampleRate) && sampleRate > 0 ? sampleRate : 16000,
    channelCnt: Number.isFinite(channelCnt) && channelCnt > 0 ? channelCnt : 1,
  };
}

function createDefaultCaseLibraries(): CaseLibrary[] {
  return [
    {
      id: DEFAULT_CASE_LIBRARY_ID,
      name: '全量用例',
      expanded: true,
    },
  ];
}

function createDefaultCaseFolders(): CaseFolder[] {
  return [
    {
      id: DEFAULT_CASE_FOLDER_ID,
      name: '默认用例集',
      libraryId: DEFAULT_CASE_LIBRARY_ID,
      expanded: true,
    },
  ];
}

function getCaseFolderId(testCase: AutomationCase) {
  return testCase.folderId || (testCase.libraryId && testCase.libraryId !== DEFAULT_CASE_LIBRARY_ID
    ? `case-library-root:${testCase.libraryId}` : DEFAULT_CASE_FOLDER_ID);
}

function getFolderLibraryId(folder?: CaseFolder) {
  return folder?.libraryId || DEFAULT_CASE_LIBRARY_ID;
}

function createRemoteFolderId(repoId: string, relativeDir: string) {
  const safeDir = relativeDir || 'root';
  return `remote-${repoId}-${safeDir.replace(/[^A-Za-z0-9._-]/g, '-')}`;
}

function getRemoteCaseRelativeDir(file: CaseLibraryFile, manifest?: CaseLibraryManifest) {
  const normalized = file.relativePath.replace(/\\/g, '/');
  const casesRoot = (manifest?.casesRoot || 'cases').replace(/^\/+|\/+$/g, '');
  const withoutRoot = normalized.startsWith(`${casesRoot}/`)
    ? normalized.slice(casesRoot.length + 1)
    : normalized;
  const dir = withoutRoot.split('/').slice(0, -1).join('/');

  return dir || '根目录';
}

function formatLibraryTime(value?: string) {
  if (!value) {
    return '未同步';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return date.toLocaleString('zh-CN', { hour12: false });
}

async function convertRecordingBlob(blob: Blob, settings: AudioTranscodeSettings) {
  const format = ['pcm', 'wav', 'ogg', 'speex'].includes(settings.outputFormat) ? settings.outputFormat : 'pcm';

  const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;

  if (!AudioContextCtor) {
    throw new Error('当前环境不支持音频转码');
  }

  const audioContext = new AudioContextCtor();

  try {
    const decodedBuffer = await audioContext.decodeAudioData(await blob.arrayBuffer());
    const renderedBuffer = await renderAudioBuffer(decodedBuffer, settings.sampleRate, settings.channelCnt);
    const audioBuffer = padAudioBuffer(audioContext, renderedBuffer, recordingLeadSilenceMs, recordingTailSilenceMs);
    const output = format === 'wav' || format === 'ogg' || format === 'speex'
      ? audioBufferToWav(audioBuffer)
      : audioBufferToSampleFormat(audioBuffer, settings.sampleFormat);

    return new Blob([output], { type: format === 'wav' || format === 'ogg' || format === 'speex' ? 'audio/wav' : 'audio/pcm' });
  } finally {
    await audioContext.close?.();
  }
}

interface StoredWorkflowEditorState {
  cases?: AutomationCase[];
  caseLibraries?: CaseLibrary[];
  caseFolders?: CaseFolder[];
  automationTasks?: AutomationTaskRecord[];
  components?: TestComponent[];
  llmProviders?: LlmProviderConfig[];
  selectedLlmProviderId?: string;
  assistantMessages?: AssistantMessage[];
  caseEdges?: Record<string, Edge[]>;
  nodePositions?: CaseNodePositions | NodePositions;
  selectedCaseId?: string;
  selectedCaseLibraryId?: string;
  remoteCasesUrl?: string;
  deviceBindings?: DeviceBindings;
}

type SettingsSection = 'team' | 'model' | 'environment' | 'tts' | 'quick-actions' | 'sites' | 'device';

interface TtsProviderParam {
  key: string;
  defaultValue: string;
}

interface TtsResponseMapping {
  variableName: string;
  responsePath: string;
}

interface TtsHttpResponseEvidence {
  status?: number | null;
  statusText?: string;
  headers?: Record<string, unknown>;
  rawBody?: string;
  body?: unknown;
}

interface TtsTestDialogState {
  values: Record<string, string>;
  message: string;
  response?: TtsHttpResponseEvidence;
  audioPath?: string;
  audioPreviewUrl?: string;
  audioPreviewError?: string;
}

function formatTtsResponseEvidence(value: unknown) {
  if (value === undefined || value === null || value === '') return '(empty)';
  if (typeof value === 'string') return value;
  try {
    return JSON.stringify(value, null, 2);
  } catch (_error) {
    return String(value);
  }
}

interface TtsProviderConfig {
  enabled: boolean;
  name: string;
  url: string;
  method: 'GET' | 'POST' | 'PUT';
  params: TtsProviderParam[];
  headersText: string;
  bodyTemplate: string;
  responseType: 'binary' | 'json-base64' | 'json-url';
  responseMappings: TtsResponseMapping[];
  audioField: string;
  urlField: string;
  outputExtension: string;
  sampleRate: number;
  sampleFormat: string;
  channelCnt: number;
  timeoutMs: number;
}

interface EnvironmentConfig {
  adbPath: string;
  ttsProvider?: TtsProviderConfig;
}

interface DeviceBindings {
  phoneSerials: string[];
  glassesSerials: string[];
  phoneDefaultPackage: string;
  glassesDefaultPackage: string;
}

interface SettingsAdbDevice {
  serial: string;
  state: string;
  model?: string;
  product?: string;
  device?: string;
  manufacturer?: string;
  kind?: 'phone' | 'glasses' | 'unknown';
}

function readStoredWorkflowState(): StoredWorkflowEditorState {
  if (typeof window === 'undefined') {
    return {};
  }

  try {
    const raw = window.localStorage.getItem(WORKFLOW_STORAGE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (_error) {
    return {};
  }
}

const maxLocalStorageAutomationTasks = 12;
const maxLocalStorageTaskCases = 20;
const maxLocalStorageCaseResults = 30;
const maxLocalStoragePerformanceSamples = 80;

function slimWorkflowRunArtifacts(artifacts: WorkflowRunResult['artifacts'] | undefined) {
  if (!artifacts) {
    return undefined;
  }

  return {
    runDir: artifacts.runDir,
    logs: artifacts.logs || [],
    recordings: artifacts.recordings,
    screenMirrors: artifacts.screenMirrors,
    screenshots: artifacts.screenshots,
  };
}

function slimAutomationTaskForLocalStorage(task: AutomationTaskRecord): AutomationTaskRecord {
  const taskCases = task.cases || [];
  const successCount = taskCases.filter((item) => item.status === 'success').length;
  const failedCount = taskCases.filter((item) => item.status === 'failed').length;
  const stoppedCount = taskCases.filter((item) => item.status === 'stopped').length;

  return {
    ...task,
    cases: taskCases.slice(0, maxLocalStorageTaskCases).map((caseRecord) => ({
      ...caseRecord,
      results: (caseRecord.results || []).slice(-maxLocalStorageCaseResults),
      artifacts: slimWorkflowRunArtifacts(caseRecord.artifacts),
    })),
    performanceReports: task.performanceReports
      ? Object.fromEntries(
          Object.entries(task.performanceReports).map(([key, report]) => [
            key,
            {
              ...report,
              samples: (report.samples || []).slice(-maxLocalStoragePerformanceSamples),
            },
          ])
        ) as AutomationTaskPerformanceReports
      : undefined,
    reportDetailLoaded: task.reportDetailLoaded === false ? false : undefined,
    summary: task.summary || {
      successCount,
      failedCount,
      stoppedCount,
      caseCount: taskCases.length || task.total || 0,
    },
  };
}

function createLocalStorageWorkflowPayload(payload: StoredWorkflowEditorState): StoredWorkflowEditorState {
  return {
    ...payload,
    automationTasks: (payload.automationTasks || [])
      .slice(0, maxLocalStorageAutomationTasks)
      .map(slimAutomationTaskForLocalStorage),
    assistantMessages: (payload.assistantMessages || []).slice(-40).map((message) => ({
      ...message,
      content: message.content.slice(0, 4000),
    })),
  };
}

function saveWorkflowStateToLocalStorage(payload: StoredWorkflowEditorState) {
  if (typeof window === 'undefined') {
    return;
  }

  const candidates = [
    createLocalStorageWorkflowPayload(payload),
    {
      ...createLocalStorageWorkflowPayload(payload),
      automationTasks: (payload.automationTasks || []).slice(0, 5).map((task) => ({
        ...slimAutomationTaskForLocalStorage(task),
        cases: [],
      })),
    },
    {
      ...createLocalStorageWorkflowPayload(payload),
      automationTasks: [],
      assistantMessages: [],
    },
  ];

  for (const candidate of candidates) {
    try {
      window.localStorage.setItem(WORKFLOW_STORAGE_KEY, JSON.stringify(candidate, (key, value) =>
        /^(apiKey|authToken|sshPassphrase|password|accessToken|refreshToken)$/i.test(key) ? '' : value));
      return;
    } catch (error) {
      if (!(error instanceof DOMException) || error.name !== 'QuotaExceededError') {
        throw error;
      }
    }
  }
}

function createCaseLibraryEditorFingerprint(
  cases: AutomationCase[],
  libraries: CaseLibrary[],
  folders: CaseFolder[],
  components: TestComponent[],
  caseEdges: Record<string, Edge[]>,
  nodePositions: CaseNodePositions
) {
  return JSON.stringify({
    cases,
    libraries: libraries.map((library) => ({
      id: library.id,
      name: library.name,
      repoUrl: library.repoUrl || '',
      gitBranch: library.gitBranch || library.branch || 'master',
      localRevision: library.localRevision || '',
    })),
    folders,
    components,
    caseEdges,
    nodePositions,
  });
}


function createDefaultTtsProviderConfig(): TtsProviderConfig {
  return {
    enabled: false,
    name: 'HTTP TTS',
    url: '',
    method: 'POST',
    params: [requiredTtsTextParam],
    headersText: '{\n  "Content-Type": "application/json"\n}',
    bodyTemplate: '{\n  "text": "{{text}}"\n}',
    responseType: 'json-url',
    responseMappings: [
      { variableName: '', responsePath: 'data.url' },
    ],
    audioField: '',
    urlField: 'data.url',
    outputExtension: 'pcm',
    sampleRate: 16000,
    sampleFormat: 'AV_SAMPLE_FMT_S16',
    channelCnt: 1,
    timeoutMs: 30000,
  };
}

function normalizeTtsProviderParams(params?: unknown): TtsProviderParam[] {
  if (!Array.isArray(params)) {
    return [requiredTtsTextParam];
  }

  const normalized = params
    .map((param) => ({
      key: String((param as TtsProviderParam)?.key || '').trim(),
      defaultValue: String((param as TtsProviderParam)?.defaultValue ?? ''),
    }))
    .filter((param) => param.key);
  const textParam = normalized.find((param) => param.key === 'text');

  return [
    {
      ...requiredTtsTextParam,
      defaultValue: textParam?.defaultValue || requiredTtsTextParam.defaultValue,
    },
  ];
}

function normalizeTtsResponseMappings(mappings?: unknown, fallbackPath = ''): TtsResponseMapping[] {
  const normalized = Array.isArray(mappings)
    ? mappings.map((mapping) => ({
        variableName: String((mapping as TtsResponseMapping)?.variableName || ''),
        responsePath: String((mapping as TtsResponseMapping)?.responsePath || ''),
      }))
    : [];

  if (normalized.length > 0 && fallbackPath && normalized.every((mapping) => !mapping.responsePath.trim())) {
    return [
      { ...normalized[0], responsePath: fallbackPath },
      ...normalized.slice(1),
    ];
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return [{ variableName: '', responsePath: fallbackPath }];
}

function normalizeTtsProviderConfig(config?: Partial<TtsProviderConfig>): TtsProviderConfig {
  const fallbackResponsePath = String(config?.urlField || config?.responseMappings?.[0]?.responsePath || 'data.url');
  const responseMappings = normalizeTtsResponseMappings(config?.responseMappings, fallbackResponsePath);

  return {
    ...createDefaultTtsProviderConfig(),
    ...(config || {}),
    method: (['GET', 'POST', 'PUT'].includes(String(config?.method || '').toUpperCase())
      ? String(config?.method).toUpperCase()
      : 'POST') as TtsProviderConfig['method'],
    responseType: 'json-url',
    params: normalizeTtsProviderParams(config?.params),
    responseMappings,
    audioField: String(config?.audioField || responseMappings[0]?.responsePath || ''),
    urlField: String(config?.urlField || responseMappings[0]?.responsePath || ''),
    sampleRate: Number(config?.sampleRate || 16000),
    sampleFormat: String(config?.sampleFormat || 'AV_SAMPLE_FMT_S16'),
    channelCnt: Number(config?.channelCnt || 1),
    timeoutMs: Number(config?.timeoutMs || 30000),
  };
}

function createAssistantMessage(role: AssistantMessage['role'], content: string, mode: AssistantMessage['mode'] = 'chat'): AssistantMessage {
  return {
    id: `assistant-message-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    role,
    content,
    mode,
    createdAt: new Date().toISOString(),
  };
}

function orderStepsByEdges(steps: AutomationStep[], edges: Edge[]) {
  if (edges.length === 0) {
    return steps;
  }

  const stepMap = new Map(steps.map((step) => [step.id, step]));
  const stepIndex = new Map(steps.map((step, index) => [step.id, index]));
  const outgoing = new Map<string, string[]>();
  const incoming = new Map(steps.map((step) => [step.id, 0]));

  edges.forEach((edge) => {
    if (!stepMap.has(edge.source) || !stepMap.has(edge.target)) {
      return;
    }

    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
    incoming.set(edge.target, (incoming.get(edge.target) || 0) + 1);
  });

  const startStep = steps.find((step) => step.type === 'start');
  const startIds = [
    ...(startStep ? [startStep.id] : []),
    ...steps
      .filter((step) => step.id !== startStep?.id && (incoming.get(step.id) || 0) === 0)
      .map((step) => step.id),
  ];
  const queue = startIds.sort((left, right) => (stepIndex.get(left) || 0) - (stepIndex.get(right) || 0));
  const queued = new Set(queue);
  const orderedIds: string[] = [];

  while (queue.length > 0) {
    const id = queue.shift()!;
    orderedIds.push(id);

    const nextTargets = (outgoing.get(id) || [])
      .slice()
      .sort((left, right) => (stepIndex.get(left) || 0) - (stepIndex.get(right) || 0));

    nextTargets.forEach((targetId) => {
      incoming.set(targetId, (incoming.get(targetId) || 0) - 1);

      if ((incoming.get(targetId) || 0) === 0 && !queued.has(targetId)) {
        queued.add(targetId);
        queue.push(targetId);
        queue.sort((left, right) => (stepIndex.get(left) || 0) - (stepIndex.get(right) || 0));
      }
    });
  }

  if (orderedIds.length !== steps.length) {
    steps.forEach((step) => {
      if (!orderedIds.includes(step.id)) {
        orderedIds.push(step.id);
      }
    });
  }

  return orderedIds.map((id) => stepMap.get(id)!).filter(Boolean);
}

function createWorkflowAutoLayoutPositions(steps: AutomationStep[], edges: Edge[]) {
  if (steps.length === 0) {
    return {};
  }

  const stepMap = new Map(steps.map((step) => [step.id, step]));
  const orderedSteps = orderStepsByEdges(steps, edges);
  const orderIndex = new Map(orderedSteps.map((step, index) => [step.id, index]));
  const validEdges = edges.filter((edge) => stepMap.has(edge.source) && stepMap.has(edge.target));
  const outgoing = new Map<string, string[]>();

  validEdges.forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  });

  const layerByStepId = new Map<string, number>();
  orderedSteps.forEach((step, index) => {
    if (!layerByStepId.has(step.id)) {
      layerByStepId.set(step.id, index === 0 ? 0 : Math.max(index, 0));
    }

    const currentLayer = layerByStepId.get(step.id) || 0;
    (outgoing.get(step.id) || []).forEach((targetId) => {
      layerByStepId.set(targetId, Math.max(layerByStepId.get(targetId) || 0, currentLayer + 1));
    });
  });

  const endStep = steps.find((step) => step.type === 'end');
  if (endStep) {
    const maxNonEndLayer = Math.max(
      0,
      ...steps
        .filter((step) => step.id !== endStep.id)
        .map((step) => layerByStepId.get(step.id) || 0)
    );
    layerByStepId.set(endStep.id, Math.max(layerByStepId.get(endStep.id) || 0, maxNonEndLayer + 1));
  }

  const layers = new Map<number, AutomationStep[]>();
  orderedSteps.forEach((step) => {
    const layer = layerByStepId.get(step.id) || 0;
    layers.set(layer, [...(layers.get(layer) || []), step]);
  });

  const positions: NodePositions = {};
  Array.from(layers.entries())
    .sort(([left], [right]) => left - right)
    .forEach(([layer, layerSteps]) => {
      const sortedLayerSteps = layerSteps
        .slice()
        .sort((left, right) => (orderIndex.get(left.id) || 0) - (orderIndex.get(right.id) || 0));
      const layerHeight = Math.max(0, (sortedLayerSteps.length - 1) * WORKFLOW_LAYOUT_GAP_Y);
      const topY = WORKFLOW_LAYOUT_BASE_Y - layerHeight / 2;

      sortedLayerSteps.forEach((step, index) => {
        positions[step.id] = {
          x: WORKFLOW_LAYOUT_BASE_X + layer * WORKFLOW_LAYOUT_GAP_X,
          y: topY + index * WORKFLOW_LAYOUT_GAP_Y,
        };
      });
    });

  return positions;
}

function componentToDraft(component: TestComponent): ComponentDraft {
  const normalizedComponent = normalizeWorkflowComponentDefaults(component);

  return {
    name: normalizedComponent.name,
    description: normalizedComponent.description || '',
    tags: (normalizedComponent.tags || []).join(', '),
    kind: normalizedComponent.kind || 'adb',
    device: normalizedComponent.device,
    timeoutSeconds: normalizedComponent.timeoutSeconds,
    commandTemplate: normalizedComponent.commandTemplate,
    params: normalizedComponent.params.map((param) => ({ ...param })),
  };
}

function draftToComponent(id: string, draft: ComponentDraft): TestComponent {
  return normalizeWorkflowComponentDefaults(ensureAssertScreenshotParam({
    id,
    name: draft.name.trim() || '未命名组件',
    description: draft.description.trim(),
    tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
    kind: draft.kind || 'adb',
    device: draft.device,
    timeoutSeconds: Number(draft.timeoutSeconds || 10),
    commandTemplate: draft.commandTemplate.trim(),
    params: draft.params
      .map((param) => ({
        ...param,
        key: param.key.trim(),
        label: param.label.trim() || param.key.trim(),
      }))
      .filter((param) => param.key),
  }));
}

function ensureAudioComponentParams(component: TestComponent) {
  if (component.kind !== 'audio') {
    return component;
  }

  const params = [...component.params];
  const ensureParam = (param: ComponentParam) => {
    if (!params.some((item) => item.key === param.key)) {
      params.push(param);
    }
  };

  ensureParam({
    key: 'sampleFormat',
    label: '采样格式',
    inputType: 'text',
    defaultValue: defaultAudioTranscodeParams.sampleFormat,
    helperText: '默认 AV_SAMPLE_FMT_S16',
  });
  if (component.commandTemplate.includes('{{action}}')) {
    const actionIndex = params.findIndex((item) => item.key === 'action');
    if (actionIndex >= 0) {
      params[actionIndex] = {
        ...params[actionIndex],
        helperText: params[actionIndex].helperText || '必填：模板使用 {{action}} 时不得为空；请填写可编辑的广播 Action。',
      };
    } else {
      params.push({
        key: 'action',
        label: '广播 Action',
        inputType: 'text',
        defaultValue: '',
        required: true,
        helperText: '必填：模板使用 {{action}} 时不得为空。',
      });
    }
  }
  ensureParam({
    key: 'sampleRate',
    label: '采样率',
    inputType: 'number',
    defaultValue: defaultAudioTranscodeParams.sampleRate,
    helperText: '默认 16000 Hz',
  });
  ensureParam({
    key: 'trailingSilenceMs',
    label: '尾部静音（ms）',
    inputType: 'number',
    defaultValue: defaultAudioTranscodeParams.trailingSilenceMs,
    helperText: '在实际注入音频末尾追加静音；0–60000ms，默认 800ms',
  });
  return {
    ...component,
    params,
  };
}

function mergeDefaultComponents(components: TestComponent[]) {
  const nextMap = new Map(components
    .filter(isSupportedComponent)
    .map((rawComponent) => {
    const component = normalizeWorkflowComponentDefaults(ensureAssertScreenshotParam(ensureAudioComponentParams(rawComponent)));

    if (component.id === 'component-launch-test-page') {
      return [component.id, {
        ...component,
        commandTemplate: 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}} -a "start_debug_server"',
      }] as const;
    }

    if (component.id === 'component-scanpay') {
      return [component.id, {
        ...component,
        commandTemplate: "adb -s {{serial}} shell \"am broadcast -a {{action}} --es params '{{params}}'\"",
      }] as const;
    }

    if (component.id === 'component-json-log-assert') {
      return [component.id, {
        ...component,
        timeoutSeconds: Math.max(Number(component.timeoutSeconds || 0), 45),
        params: component.params.map((param) => {
          if (param.key === 'lineRegex') {
            return { ...param, defaultValue: '' };
          }

          if (param.key === 'conditions') {
            return { ...param, defaultValue: '[]' };
          }

          if (param.key === 'captureScreenshotOnPass') {
            return { ...param, defaultValue: 'true' };
          }

          if (param.key === 'extractVariableEnabled') {
            return { ...param, defaultValue: 'false' };
          }

          if (param.key === 'extractVariableName') {
            return {
              ...param,
              defaultValue: '',
              helperText: '开启提取后必须填写唯一变量名；后续节点可用 {{variables.xxx}}',
            };
          }

          if (param.key === 'clearBeforeStart') {
            return {
              ...param,
              defaultValue: param.defaultValue ?? 'false',
              label: '断言前清理历史日志',
              helperText: 'true：仅匹配本节点开始后的日志；false：保留本用例本轮已采集日志（默认）。不删除共享日志文件，也不读取上一轮日志。',
            };
          }

          return param;
        }),
      }] as const;
    }

    if (component.kind !== 'audio') {
      return [component.id, {
        ...component,
        params: component.params.map((param) => (
          param.key === 'captureScreenshotOnPass' && param.defaultValue === 'false'
            ? { ...param, defaultValue: 'true' }
            : param
        )),
      }] as const;
    }

    const commandTemplate = component.commandTemplate.includes('--es audio_path')
      ? defaultAudioCommandTemplate
      : component.commandTemplate;

    return [component.id, {
      ...component,
      commandTemplate,
      params: component.params.map((param) => (
        param.key === 'remotePath' && isDefaultAudioRemotePath(param.defaultValue || '')
          ? { ...param, defaultValue: createDefaultAudioRemoteDir() }
          : param
      )),
    }] as const;
    }));

  createDefaultComponents().forEach((component) => {
    if (!nextMap.has(component.id)) {
      nextMap.set(component.id, ensureAssertScreenshotParam(component));
    }
  });

  return Array.from(nextMap.values());
}

function AssertVariableExtractionCard({
  enabled,
  variableName,
  defaultVariableName: _defaultVariableName,
  description,
  referenceExample,
  onEnabledChange,
  onVariableNameChange,
}: {
  enabled: boolean;
  variableName: string;
  defaultVariableName: string;
  description: string;
  referenceExample: string;
  onEnabledChange: (enabled: boolean) => void;
  onVariableNameChange: (name: string) => void;
}) {
  return (
    <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
      <label className="flex items-center justify-between gap-3 text-xs font-bold text-emerald-800">
        <span>
          提取为变量
          <span className="ml-2 rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">默认关闭</span>
        </span>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(event) => {
            const nextEnabled = event.target.checked;
            onEnabledChange(nextEnabled);
            if (!nextEnabled) onVariableNameChange('');
          }}
          className="h-4 w-4 accent-emerald-600"
        />
      </label>
      {enabled && (
        <div className="mt-3 space-y-2">
          <div>
            <label className="text-[10px] font-black uppercase tracking-wide text-emerald-700">变量名（必填）</label>
            <div className="mt-1 flex h-9 overflow-hidden rounded-lg border border-emerald-100 bg-white">
              <span className="flex shrink-0 items-center border-r border-emerald-100 bg-emerald-50 px-2 font-mono text-[10px] font-bold text-emerald-600">variables.</span>
              <input
                value={variableName}
                onChange={(event) => onVariableNameChange(event.target.value)}
                required
                className="min-w-0 flex-1 px-2 font-mono text-xs font-bold outline-none"
                placeholder="请输入唯一变量名"
              />
            </div>
          </div>
          <div className="text-[10px] font-bold leading-5 text-emerald-700">
            {description} 后续节点可引用 <span className="font-mono">{referenceExample}</span>。
          </div>
        </div>
      )}
    </div>
  );
}

export default function WorkflowEditor() {
  const storedWorkflowState = useMemo(() => readStoredWorkflowState(), []);
  const [uiSmoke] = useState(() => new URLSearchParams(window.location.search).get('ui-smoke') === 'tasks');
  const [activeTab, setActiveTab] = useState(uiSmoke ? 'automation-tasks' : 'agent');
  const [mirrorSessionId, setMirrorSessionId] = useState('');
  const [isMainSidebarCollapsed, setIsMainSidebarCollapsed] = useState(() => {
    try {
      return window.localStorage.getItem(MAIN_SIDEBAR_COLLAPSED_KEY) === 'true';
    } catch (_error) {
      return false;
    }
  });
  const [selectedPhoneSerial, setSelectedPhoneSerial] = useState('');
  const [deviceRefreshKey, setDeviceRefreshKey] = useState(0);
  const [selectedGlassesSerial, setSelectedGlassesSerial] = useState('');
  const [selectedPhonePackage, setSelectedPhonePackage] = useState(
    () => storedWorkflowState.deviceBindings?.phoneDefaultPackage || defaultPhonePackageName
  );
  const [selectedGlassesPackage, setSelectedGlassesPackage] = useState(
    () => storedWorkflowState.deviceBindings?.glassesDefaultPackage || defaultGlassesPackageName
  );
  const [selectedPhoneRuntime, setSelectedPhoneRuntime] = useState<AutomationDeviceRuntime>('android');
  const [selectedGlassesRuntime, setSelectedGlassesRuntime] = useState<AutomationDeviceRuntime>('android');


  const toggleMainSidebarCollapsed = useCallback(() => {
    setIsMainSidebarCollapsed((current) => !current);
  }, []);
  useEffect(() => {
    try {
      window.localStorage.setItem(MAIN_SIDEBAR_COLLAPSED_KEY, String(isMainSidebarCollapsed));
    } catch (_error) {
      // Ignore storage failures; collapse state is a convenience preference.
    }
  }, [isMainSidebarCollapsed]);
  const [components, setComponents] = useState<TestComponent[]>(
    () => storedWorkflowState.components?.length ? mergeDefaultComponents(storedWorkflowState.components) : createDefaultComponents()
  );
  const [selectedComponentId, setSelectedComponentId] = useState('component-launch-test-page');
  const [componentDraft, setComponentDraft] = useState<ComponentDraft>(() => componentToDraft(createDefaultComponents()[0]));
  const [componentLibraryTab, setComponentLibraryTab] = useState<ComponentLibraryTab>('execute');
  const [componentMessage, setComponentMessage] = useState('');
  const [cases, setCases] = useState<AutomationCase[]>(
    () => storedWorkflowState.cases?.length ? normalizeStoredCases(storedWorkflowState.cases) : [initialAutomationCase]
  );
  const [caseLibraries, setCaseLibraries] = useState<CaseLibrary[]>(
    () => storedWorkflowState.caseLibraries?.length ? storedWorkflowState.caseLibraries : createDefaultCaseLibraries()
  );
  const [caseFolders, setCaseFolders] = useState<CaseFolder[]>(
    () => storedWorkflowState.caseFolders?.length
      ? storedWorkflowState.caseFolders.map((folder) => ({ ...folder, libraryId: folder.libraryId || DEFAULT_CASE_LIBRARY_ID }))
      : createDefaultCaseFolders()
  );
  const [automationTasks, setAutomationTasks] = useState<AutomationTaskRecord[]>(
    () => storedWorkflowState.automationTasks || []
  );
  useEffect(() => {
    if (!uiSmoke || activeTab !== 'automation-tasks') return;
    // Read the committed renderer DOM, rather than treating Broker state as UI evidence.
    const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-task-id]')).map((row) => ({
      taskId: row.dataset.taskId,
      status: row.dataset.taskStatus,
      reportButton: Boolean(row.querySelector('[data-task-report]')),
      visible: row.getClientRects().length > 0,
    }));
    console.info(`[ui-smoke:tasks] ${JSON.stringify({ schemaVersion: 1, rows })}`);
  }, [uiSmoke, activeTab, automationTasks]);
  const [selectedAutomationTaskId, setSelectedAutomationTaskId] = useState('');
  const [selectedAutomationTaskIds, setSelectedAutomationTaskIds] = useState<Set<string>>(() => new Set());
  const [purgeTaskArtifacts,setPurgeTaskArtifacts]=useState(false);
  const [taskCleanupBusy,setTaskCleanupBusy]=useState(false);
  const [taskCleanupSupported,setTaskCleanupSupported]=useState(false);
  const taskCleanupLockRef=useRef(false);
  const removedAutomationTaskIdsRef=useRef<Set<string>>(new Set());
  const applyTaskRemovals=useCallback((ids:string[])=>{
    ids.forEach(id=>removedAutomationTaskIdsRef.current.add(id));
    setAutomationTasks(current=>current.filter(t=>!removedAutomationTaskIdsRef.current.has(t.id)));
    setSelectedAutomationTaskIds(current=>new Set([...current].filter(id=>!removedAutomationTaskIdsRef.current.has(id))));
    setSelectedAutomationTaskId(current=>removedAutomationTaskIdsRef.current.has(current)?'':current);
  },[]);
  const [llmProviders, setLlmProviders] = useState<LlmProviderConfig[]>(
    () => storedWorkflowState.llmProviders || []
  );
  const [selectedLlmProviderId, setSelectedLlmProviderId] = useState(
    () => storedWorkflowState.selectedLlmProviderId || ''
  );
  const {
    llmProviderDraft, setLlmProviderDraft, llmCapabilityStatus, setLlmCapabilityStatus,
    providerTestMessage, isTestingProvider, isNewLlmProvider,
    selectLlmProvider, addLlmProvider, cancelLlmProviderDraft, saveLlmProvider, removeLlmProvider, testLlmProvider,
  } = useModelConfiguration({
    providers: llmProviders, setProviders: setLlmProviders,
    selectedProviderId: selectedLlmProviderId, setSelectedProviderId: setSelectedLlmProviderId,
    testProvider: provider => electronApi?.ipcRenderer?.invoke('llm:test-provider', { provider }) || Promise.resolve(undefined),
  });
  const [settingsSection, setSettingsSection] = useState<SettingsSection>('model');
  const [environmentDraft, setEnvironmentDraft] = useState<EnvironmentConfig>({ adbPath: '' });
  const [environmentMessage, setEnvironmentMessage] = useState('');
  const [effectiveAdbPath, setEffectiveAdbPath] = useState('');
  const [isSavingEnvironment, setIsSavingEnvironment] = useState(false);
  const [ttsProviderDraft, setTtsProviderDraft] = useState<TtsProviderConfig>(() => createDefaultTtsProviderConfig());
  const [ttsMessage, setTtsMessage] = useState('');
  const [isTestingTts, setIsTestingTts] = useState(false);
  const [ttsTestDialog, setTtsTestDialog] = useState<TtsTestDialogState | null>(null);
  const [deviceBindings, setDeviceBindings] = useState<DeviceBindings>(
    () => ({
      phoneSerials: storedWorkflowState.deviceBindings?.phoneSerials || [],
      glassesSerials: storedWorkflowState.deviceBindings?.glassesSerials || [],
      phoneDefaultPackage: storedWorkflowState.deviceBindings?.phoneDefaultPackage || defaultPhonePackageName,
      glassesDefaultPackage: storedWorkflowState.deviceBindings?.glassesDefaultPackage || defaultGlassesPackageName,
    })
  );
  const [settingsDevices, setSettingsDevices] = useState<SettingsAdbDevice[]>([]);
  const [deviceBindingDraft, setDeviceBindingDraft] = useState('');
  const [deviceSettingsMessage, setDeviceSettingsMessage] = useState('');
  const [assistantMessages, setAssistantMessages] = useState<AssistantMessage[]>(
    () => storedWorkflowState.assistantMessages || []
  );
  const [assistantInput, setAssistantInput] = useState('');
  const [assistantError, setAssistantError] = useState('');
  const [isAssistantOpen, setIsAssistantOpen] = useState(false);
  const [isAssistantCollapsed, setIsAssistantCollapsed] = useState(false);
  const [isAssistantSending, setIsAssistantSending] = useState(false);
  const [assistantCaseAuthoringEnabled, setAssistantCaseAuthoringEnabled] = useState(false);
  const [pendingAssistantDraft, setPendingAssistantDraft] = useState<ConversationalCaseDraftResponse | null>(null);
  const [selectedCaseId, setSelectedCaseId] = useState(
    () => storedWorkflowState.selectedCaseId || 'payment-one-cent'
  );
  const [selectedStepId, setSelectedStepId] = useState('');
  const [configDraft, setConfigDraft] = useState('');
  const [runStatuses, setRunStatuses] = useState<Record<string, RunStatus>>({});
  const [runMessage, setRunMessage] = useState('');
  const { pendingTaskActions, taskActionFeedback, runTaskAction } = useTaskActionFeedback();
  const [taskStopFeedback, setTaskStopFeedback] = useState<Record<string, string>>({});
  const taskStopPendingRef = useRef(new Set<string>());
  const [taskStopPending, setTaskStopPending] = useState<Set<string>>(new Set());
  const [taskPickerCollapsed, setTaskPickerCollapsed] = useState<Set<string>>(new Set());
  const [runLogs, setRunLogs] = useState<WorkflowRunLog[]>([]);
  const [runArtifacts, setRunArtifacts] = useState<WorkflowRunResult['artifacts'] | null>(null);
  const [screenshotPreviewUrls, setScreenshotPreviewUrls] = useState<Record<string, string>>({});
  const [edgeRuntimeLabels, setEdgeRuntimeLabels] = useState<Record<string, string>>({});
  const [runLogDisplayMode, setRunLogDisplayMode] = useState<RunLogDisplayMode>('compact');
  const [reportCaseSearch, setReportCaseSearch] = useState('');
  const [reportCaseStatusFilter, setReportCaseStatusFilter] = useState<ReportCaseStatusFilter>('all');
  const [reportCaseArtifactFilter, setReportCaseArtifactFilter] = useState<ReportCaseArtifactFilter>('all');
  const [flowCaseSnapshot, setFlowCaseSnapshot] = useState<AutomationCase | null>(null);
  const [flowCaseEdgesSnapshot, setFlowCaseEdgesSnapshot] = useState<Edge[] | null>(null);
  const [flowReturnTarget, setFlowReturnTarget] = useState<FlowReturnTarget>({ tab: 'automation-cases' });
  const [flowRenderVersion, setFlowRenderVersion] = useState(0);
  const [recordingState, setRecordingState] = useState<RecordingState>(null);
  const [recordingPreviewUrls, setRecordingPreviewUrls] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [caseSearch, setCaseSearch] = useState('');
  const [caseLibraryViewMode, setCaseLibraryViewMode] = useState<CaseLibraryViewMode>('library');
  const [selectedCaseLibraryId, setSelectedCaseLibraryId] = useState(
    () => storedWorkflowState.selectedCaseLibraryId || DEFAULT_CASE_LIBRARY_ID
  );
  const [selectedCaseFolderId, setSelectedCaseFolderId] = useState(DEFAULT_CASE_FOLDER_ID);
  const [caseCreateMenuFor, setCaseCreateMenuFor] = useState<string | null>(null);
  const [soloPiDialog, setSoloPiDialog] = useState<{ mode: 'import' | 'record'; folderId: string; libraryId: string } | null>(null);
  const [caseActionMenuFor, setCaseActionMenuFor] = useState<string | null>(null);
  const [caseTreeDragItem, setCaseTreeDragItem] = useState<CaseTreeDragItem>(null);
  const [caseTreeDropTarget, setCaseTreeDropTarget] = useState<string | null>(null);
  const [caseTreeDragPosition, setCaseTreeDragPosition] = useState<{ x: number; y: number } | null>(null);
  const [gitConfigError, setGitConfigError] = useState('');
  const [nameDialog, setNameDialog] = useState<NameDialogState>(null);
  const [editingName, setEditingName] = useState<InlineEditingName>(null);
  const [gitConfigDialog, setGitConfigDialog] = useState<GitConfigDialogState | null>(null);
  const [exportFolderDialog, setExportFolderDialog] = useState<ExportFolderDialogState | null>(null);
  const [taskCreateDialog, setTaskCreateDialog] = useState<TaskCreateDialogState | null>(null);
  const [taskCreateError, setTaskCreateError] = useState('');
  const [isSubmittingTask, setIsSubmittingTask] = useState(false);
  const taskSubmitLockRef = useRef(false);
  const [quickTaskCreateError, setQuickTaskCreateError] = useState('');
  const [quickTaskPerformanceDialog, setQuickTaskPerformanceDialog] = useState<QuickTaskPerformanceDialogState | null>(null);
  const [performanceReportDialog, setPerformanceReportDialog] = useState<AutomationTaskPerformanceReport | null>(null);
  const [pendingNewFolderParentId, setPendingNewFolderParentId] = useState<string | undefined>(undefined);
  const [remoteCasesUrl, setRemoteCasesUrl] = useState(storedWorkflowState.remoteCasesUrl || '');
  const [caseLibraryStatus, setCaseLibraryStatus] = useState('');
  const [pendingLocalCaseLibraryChange, setPendingLocalCaseLibraryChange] = useState<LocalCaseLibraryChangeEvent | null>(null);
  const [toastMessages, setToastMessages] = useState<ToastMessage[]>([]);
  const [isPullingCaseLibrary, setIsPullingCaseLibrary] = useState(false);
  const [isRefreshingCaseLibrary, setIsRefreshingCaseLibrary] = useState(false);
  const [isGitLfsGuideOpen, setIsGitLfsGuideOpen] = useState(false);
  const [isInstallingGitLfs, setIsInstallingGitLfs] = useState(false);
  const [gitLfsInstallMessage, setGitLfsInstallMessage] = useState('');
  const [scrcpyGuideDialog, setScrcpyGuideDialog] = useState<{ optionLabel: string; installCommand: string; tutorialUrl: string } | null>(null);
  const [commandVariableGuide, setCommandVariableGuide] = useState<'adb' | 'pc_command' | null>(null);
  const [customAtomMenuScope, setCustomAtomMenuScope] = useState<'action' | 'detect' | null>(null);
  const [customAtomMenuRect, setCustomAtomMenuRect] = useState<{ left: number; top: number; width: number } | null>(null);
  const [isConfigPanelOpen, setIsConfigPanelOpen] = useState(false);
  const [isAddComponentMenuOpen, setIsAddComponentMenuOpen] = useState(false);
  const [nodePositions, setNodePositions] = useState<CaseNodePositions>(
    () => (storedWorkflowState.nodePositions || {}) as CaseNodePositions
  );
  const [caseEdges, setCaseEdges] = useState<Record<string, Edge[]>>(
    () => storedWorkflowState.caseEdges || { [initialAutomationCase.id]: stepsToEdges(initialAutomationCase.steps) }
  );
  const [isFlowOpening, setIsFlowOpening] = useState(false);
  const [nodes, setNodes, onNodesChangeBase] = useNodesState([]);
  const [edges, setEdges, onEdgesChangeBase] = useEdgesState([]);
  const [mobileUiInspector, setMobileUiInspector] = useState<MobileUiInspectorState>({
    loading: false,
    elements: [],
  });
  const [mobileUiDebug, setMobileUiDebug] = useState<MobileUiDebugState>({
    status: 'idle',
  });
  const caseLibraryImportInputRef = useRef<HTMLInputElement>(null);
  const caseLibraryImportFolderIdRef = useRef(DEFAULT_CASE_FOLDER_ID);
  const runLogPanelRef = useRef<HTMLDivElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingStopTimerRef = useRef<number | null>(null);
  const recordingChunksRef = useRef<BlobPart[]>([]);
  const recordingStreamRef = useRef<MediaStream | null>(null);
  const audioPreviewRef = useRef<HTMLAudioElement | null>(null);
  const reactFlowInstanceRef = useRef<ReactFlowInstance | null>(null);
  const workflowClipboardRef = useRef<WorkflowClipboardPayload | null>(null);
  const runLockRef = useRef(false);
  const caseTreeDragTimerRef = useRef<number | null>(null);
  const caseTreeDragFinishedRef = useRef(false);
  const activeWorkflowRequestIdRef = useRef('');
  const activeWorkflowStepIdsRef = useRef<string[]>([]);
  const activeTaskRunRef = useRef<ActiveTaskRunRef>(null);
  const submittedUiTaskIdRef = useRef('');
  const workflowStateHydratedRef = useRef(false);
  const workflowStateSaveTimerRef = useRef<number | null>(null);
  const automationTaskSyncSinceRef = useRef('');
  const automationTaskSyncInFlightRef = useRef(false);
  const rendererOwnedAutomationTasksRef = useRef<AutomationTaskRecord[]>([]);
  const caseLibraryEditorBaselineRef = useRef('');
  const caseLibraryEditorDirtyRef = useRef(false);
  const caseLibraryRefreshApplyingRef = useRef(false);
  const caseLibraryPersistenceUrgentRef = useRef(false);
  const mergeCaseLibraryFilesRef = useRef<(result: PullCaseLibraryResult) => Promise<void>>(async () => {});
  const caseLibrariesRef = useRef<CaseLibrary[]>(caseLibraries);
  const selectedCaseLibraryIdRef = useRef(selectedCaseLibraryId);
  const caseLibraryRefreshInFlightRef = useRef<Set<string>>(new Set());
  const caseLibraryNavigationRefreshKeyRef = useRef('');
  const autoUpdatedLibraryIdsRef = useRef<Set<string>>(new Set());
  const autoUpdateCheckedOnStartupRef = useRef(false);
  const lastRenderedFlowCaseIdRef = useRef('');

  const selectedCase = useMemo(
    () => flowCaseSnapshot || cases.find((testCase) => testCase.id === selectedCaseId) || cases[0] || initialAutomationCase,
    [cases, flowCaseSnapshot, selectedCaseId]
  );
  const isReportFlowReadOnly = flowReturnTarget.tab === 'automation-task-report';
  const isImportedReportFlow = isReportFlowReadOnly && Boolean(
    automationTasks.find((task) => task.id === flowReturnTarget.taskId)?.imported
  );
  const selectedStep = selectedCase?.steps.find((step) => step.id === selectedStepId) || selectedCase?.steps[0];
  const displayEdges = useMemo(() => (
    edges.map((edge) => {
      const runtimeLabel = edgeRuntimeLabels[edge.id];

      if (!runtimeLabel) {
        return edge;
      }

      return {
        ...edge,
        label: runtimeLabel,
        labelBgPadding: [6, 3] as [number, number],
        labelBgBorderRadius: 8,
        labelBgStyle: { fill: '#eff6ff', fillOpacity: 0.96 },
        labelStyle: { fill: '#2563eb', fontSize: 11, fontWeight: 800 },
        style: {
          ...(edge.style || {}),
          stroke: '#60a5fa',
          strokeWidth: 2,
        },
      };
    })
  ), [edgeRuntimeLabels, edges]);
  const legacyDefaultComponents = useMemo(() => createDefaultComponents(), []);
  const templateComponents = useMemo(() => {
    const makeTemplate = (kind: TestComponentKind, id: string, name: string, description: string) => ({
      ...createDefaultComponent(kind),
      id,
      name,
      description,
    });

    return [
      makeTemplate('adb', 'template-adb-command', '通用 ADB 命令', '通过 adb 命令模板执行通用动作'),
      makeTemplate('pc_command', 'template-pc-command', '通用 PC 命令', '在当前电脑执行命令，不依赖手机或眼镜设备'),
      makeTemplate('activity', 'template-launch-activity', '拉起 Activity', '拉起指定 Activity 并校验已进入前台'),
      makeTemplate('audio', 'template-audio-input', '音频输入与模拟', '选择/录制音频，push 后触发 adb 命令'),
      makeTemplate('image_mock', 'template-image-mock', '图片 Mock', '选择图片，push 到设备后执行 Mock 命令'),
      makeTemplate('mobile_ui_action', 'template-mobile-ui-action', '手机 UI 操作', '点击、输入、滑动或返回手机页面'),
      makeTemplate('mobile_ui_assert', 'template-mobile-ui-assert', '手机 UI 元素校验', '校验手机页面上是否存在指定元素'),
      makeTemplate('tts_assert', 'template-tts-assert', '日志文本提取断言', '从日志提取文本并比对期望值'),
      makeTemplate('json_assert', 'template-json-assert', 'JSON 日志字段断言', '正则定位日志，解析 JSON 后校验字段'),
      makeTemplate('llm_assert', 'template-llm-assert', 'LLM 语义断言', '结合 variables 和当前日志判断当前状态是否符合预期'),
    ];
  }, []);
  const defaultComponentIds = useMemo(() => new Set([
    ...legacyDefaultComponents.map((component) => component.id),
    ...templateComponents.map((component) => component.id),
  ]), [legacyDefaultComponents, templateComponents]);
  const customComponents = useMemo(() => (
    components.filter((component) => !defaultComponentIds.has(component.id))
  ), [components, defaultComponentIds]);
  const selectedCaseComponents = useMemo(() => (
    Array.isArray(selectedCase?.components)
      ? selectedCase.components.filter(isSupportedComponent)
      : []
  ), [selectedCase]);
  const allWorkflowComponents = useMemo(() => {
    const mergedComponents = new Map([
      ...legacyDefaultComponents,
      ...templateComponents,
    ].map((component) => [component.id, component] as const));
    // Persisted component definitions are authoritative even when their id is a
    // built-in template. This preserves explicit commandTemplate values (for
    // example template-image-mock's ACTION_SCANPAY command) after hydrate/reopen;
    // newly created templates still use the generic factory definition until saved.
    components.forEach((component) => mergedComponents.set(component.id, mergeWorkflowComponent(mergedComponents.get(component.id), component)));
    selectedCaseComponents.forEach((component) => mergedComponents.set(component.id, mergeWorkflowComponent(mergedComponents.get(component.id), component)));
    return Array.from(mergedComponents.values());
  }, [customComponents, legacyDefaultComponents, selectedCaseComponents, templateComponents]);
  const selectedStepComponent = selectedStep?.componentId
    ? allWorkflowComponents.find((component) => component.id === selectedStep.componentId)
    : undefined;
  const selectedStepComponentKind = selectedStepComponent?.kind || 'adb';
  const selectedResultAssertions = selectedStep?.config?.resultAssertions
    ?? selectedStep?.inputs?.resultAssertions
    ?? selectedStepComponent?.params.find(param => param.key === 'resultAssertions')?.defaultValue
    ?? selectedStepComponent?.resultAssertions;
  const actionTemplateComponents = useMemo(() => (
    templateComponents.filter((component) => component.kind === 'adb' || component.kind === 'pc_command' || component.kind === 'activity' || component.kind === 'audio' || component.kind === 'image_mock' || component.kind === 'mobile_ui_action')
  ), [templateComponents]);
  const detectTemplateComponents = useMemo(() => (
    templateComponents.filter((component) => component.kind === 'mobile_ui_assert' || component.kind === 'tts_assert' || component.kind === 'json_assert' || component.kind === 'llm_assert')
  ), [templateComponents]);
  const actionCustomComponents = useMemo(() => (
    customComponents.filter((component) => component.kind === 'adb' || component.kind === 'pc_command' || component.kind === 'activity' || component.kind === 'audio' || component.kind === 'image_mock' || component.kind === 'mobile_ui_action')
  ), [customComponents]);
  const detectCustomComponents = useMemo(() => (
    customComponents.filter((component) => component.kind === 'mobile_ui_assert' || component.kind === 'tts_assert' || component.kind === 'json_assert' || component.kind === 'llm_assert')
  ), [customComponents]);
  const selectedLlmProvider = useMemo(() => (
    llmProviders.find((provider) => provider.id === selectedLlmProviderId) || llmProviders[0]
  ), [llmProviders, selectedLlmProviderId]);
  const electronApi = useMemo(() => getElectronApi(), []);
  useEffect(() => {
    void electronApi?.ipcRenderer.invoke('workflow:set-header-devices', {
      phone: {serial:selectedPhoneSerial, runtime:selectedPhoneRuntime},
      glasses: {serial:selectedGlassesSerial, runtime:selectedGlassesRuntime},
    }).catch((error: unknown) => console.error('同步头部设备选择失败', error));
  }, [selectedPhoneSerial, selectedGlassesSerial, selectedPhoneRuntime, selectedGlassesRuntime, electronApi]);

  useEffect(() => {
    let cancelled = false;

    async function hydrateWorkflowState() {
      if (!electronApi?.ipcRenderer) {
        workflowStateHydratedRef.current = true;
        return;
      }

      try {
        const result = await electronApi.ipcRenderer.invoke('workflow-state:load') as {
          success: boolean;
          state?: StoredWorkflowEditorState | null;
        };

        if (cancelled) {
          return;
        }

        const state = result.success ? result.state : null;

        if (state?.components?.length) {
          setComponents(mergeDefaultComponents(state.components));
        }
        const hydratedCases = state?.cases?.length ? normalizeStoredCases(state.cases) : null;

        if (hydratedCases) {
          setCases(hydratedCases);
        }
        if (state?.caseLibraries?.length) {
          setCaseLibraries(state.caseLibraries);
        }
        if (state?.caseFolders?.length) {
          setCaseFolders(state.caseFolders.map((folder) => ({
            ...folder,
            libraryId: folder.libraryId || DEFAULT_CASE_LIBRARY_ID,
          })));
        }
        if (state?.automationTasks) {
          setAutomationTasks((current) => mergeAutomationTaskRecords(current, state.automationTasks || [],removedAutomationTaskIdsRef.current));
        }
        if (state?.llmProviders) {
          setLlmProviders(state.llmProviders);
          selectLlmProvider(state.llmProviders.find(provider => provider.id === state.selectedLlmProviderId) || state.llmProviders[0] || createLlmProviderDraft());
        }
        if (state?.selectedLlmProviderId) {
          setSelectedLlmProviderId(state.selectedLlmProviderId);
        }
        if (state?.assistantMessages) {
          setAssistantMessages(state.assistantMessages);
        }
        if (state?.caseEdges || hydratedCases) {
          const casesForEdges = hydratedCases || cases;
          const rawEdges = state?.caseEdges || {};
          setCaseEdges(Object.fromEntries(casesForEdges.map((testCase) => [
            testCase.id,
            ensureBoundaryEdges(testCase, rawEdges[testCase.id] || []),
          ])));
        }
        if (state?.nodePositions || hydratedCases) {
          const rawPositions = state?.nodePositions || {};
          const rawEdges = state?.caseEdges || {};
          setNodePositions(Object.fromEntries((hydratedCases || []).map((testCase) => [
            testCase.id,
            migrateCaseNodePositions(testCase, rawPositions[testCase.id] || rawPositions, rawEdges[testCase.id] || []),
          ])));
        }
        if (state?.selectedCaseId) {
          setSelectedCaseId(state.selectedCaseId);
        }
        if (state?.selectedCaseLibraryId) {
          setSelectedCaseLibraryId(state.selectedCaseLibraryId);
        }
        if (state?.remoteCasesUrl) {
          setRemoteCasesUrl(state.remoteCasesUrl);
        }
        if (state?.deviceBindings) {
          const nextDeviceBindings = {
            phoneSerials: state.deviceBindings.phoneSerials || [],
            glassesSerials: state.deviceBindings.glassesSerials || [],
            phoneDefaultPackage: state.deviceBindings.phoneDefaultPackage || defaultPhonePackageName,
            glassesDefaultPackage: state.deviceBindings.glassesDefaultPackage || defaultGlassesPackageName,
          };
          setDeviceBindings(nextDeviceBindings);
          setSelectedPhonePackage(nextDeviceBindings.phoneDefaultPackage);
          setSelectedGlassesPackage(nextDeviceBindings.glassesDefaultPackage);
        }
      } finally {
        if (!cancelled) {
          workflowStateHydratedRef.current = true;
        }
      }
    }

    void hydrateWorkflowState();

    return () => {
      cancelled = true;
    };
  }, [electronApi]);

  useEffect(() => {
    if (!electronApi?.ipcRenderer) {
      return undefined;
    }

    let disposed = false;
    const mergeIncomingTasks = (tasks: AutomationTaskRecord[], synchronizedAt = '') => {
      if (disposed || !tasks.length) return;
      const persistenceFailure = tasks.find(task => task.reportPersistenceError);
      if (persistenceFailure) setRunMessage(`报告保存失败：${persistenceFailure.reportPersistenceError}`);
      setAutomationTasks((current) => mergeAutomationTaskRecords(current, tasks,removedAutomationTaskIdsRef.current));
      const submittedUiTaskId = submittedUiTaskIdRef.current;
      const submittedUiTask = submittedUiTaskId
        ? tasks.find((task) => task.id === submittedUiTaskId)
        : undefined;
      if (submittedUiTask && ['success', 'failed', 'stopped'].includes(submittedUiTask.status)) {
        submittedUiTaskIdRef.current = '';
        runLockRef.current = false;
        setIsRunning(false);
        setRunMessage(
          submittedUiTask.status === 'success'
            ? `测试任务「${submittedUiTask.name}」执行完成`
            : submittedUiTask.status === 'stopped'
              ? `测试任务「${submittedUiTask.name}」已停止`
              : `测试任务「${submittedUiTask.name}」执行完成，有失败用例`
        );
      }
      const latestUpdatedAt = tasks
        .map((task) => task.updatedAt || '')
        .filter(Boolean)
        .sort()
        .at(-1);
      automationTaskSyncSinceRef.current = synchronizedAt || latestUpdatedAt || automationTaskSyncSinceRef.current;
    };
    const syncTasks = async (forceFull = false) => {
      if (!workflowStateHydratedRef.current || automationTaskSyncInFlightRef.current) return;
      automationTaskSyncInFlightRef.current = true;
      try {
        const result = await electronApi.ipcRenderer.invoke('workflow-task:list', {
          since: forceFull ? '' : automationTaskSyncSinceRef.current,
        }) as {
          success?: boolean;
          tasks?: AutomationTaskRecord[];
          synchronizedAt?: string;
          removedTaskIds?: string[];
          cleanupSupported?:boolean;
        };
        if (result?.success) {
          setTaskCleanupSupported(result.cleanupSupported===true);
          applyTaskRemovals(result.removedTaskIds || []);
          mergeIncomingTasks(result.tasks || [], result.synchronizedAt || '');
        }
      } finally {
        automationTaskSyncInFlightRef.current = false;
      }
    };
    const handleTaskChanged = (_event: unknown, payload: { task?: AutomationTaskRecord; updatedAt?: string; removedTaskIds?:string[] }) => {
      if(payload?.removedTaskIds)applyTaskRemovals(payload.removedTaskIds);
      if (!payload?.task) return;
      mergeIncomingTasks([payload.task], payload.updatedAt || payload.task.updatedAt || '');
    };
    const handleWindowFocus = () => {
      void syncTasks(false);
    };
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void syncTasks(false);
    };

    electronApi.ipcRenderer.on('workflow-task:changed', handleTaskChanged);
    window.addEventListener('focus', handleWindowFocus);
    document.addEventListener('visibilitychange', handleVisibilityChange);
    const initialTimer = window.setTimeout(() => void syncTasks(true), 300);
    const recoveryTimer = window.setInterval(() => void syncTasks(false), 2000);

    return () => {
      disposed = true;
      window.clearTimeout(initialTimer);
      window.clearInterval(recoveryTimer);
      electronApi.ipcRenderer.removeListener('workflow-task:changed', handleTaskChanged);
      window.removeEventListener('focus', handleWindowFocus);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [electronApi]);

  const filteredCases = useMemo(() => {
    const keyword = caseSearch.trim().toLowerCase();

    if (!keyword) {
      return cases;
    }

    return cases.filter((testCase) => {
      const haystack = [
        testCase.name,
        testCase.description,
        ...(testCase.tags || []),
      ].join(' ').toLowerCase();

      return haystack.includes(keyword);
    });
  }, [caseSearch, cases]);
  const caseSearchKeyword = caseSearch.trim().toLowerCase();
  const normalizedCaseLibraries = useMemo(() => {
    const libraryMap = new Map(caseLibraries.map((library) => [library.id, library]));

    if (libraryMap.size === 0) {
      libraryMap.set(DEFAULT_CASE_LIBRARY_ID, createDefaultCaseLibraries()[0]);
    }

    return Array.from(libraryMap.values());
  }, [caseLibraries]);
  const caseLibraryFolders = useMemo(() => {
    const folderMap = new Map(caseFolders.map((folder) => [folder.id, folder]));

    if (folderMap.size === 0 && normalizedCaseLibraries.length === 1 && normalizedCaseLibraries[0]?.id === DEFAULT_CASE_LIBRARY_ID) {
      folderMap.set(DEFAULT_CASE_FOLDER_ID, createDefaultCaseFolders()[0]);
    }

    cases.forEach((testCase) => {
      const folderId = getCaseFolderId(testCase);
      if (!folderMap.has(folderId)) {
        folderMap.set(folderId, {
          id: folderId,
          name: testCase.folderId ? '未命名文件夹' : '根目录用例',
          libraryId: testCase.libraryId || DEFAULT_CASE_LIBRARY_ID,
          expanded: true,
        });
      }
    });

    return Array.from(folderMap.values());
  }, [caseFolders, cases, normalizedCaseLibraries]);
  const foldersByLibrary = useMemo(() => {
    const libraryMap = new Map<string, CaseFolder[]>();

    normalizedCaseLibraries.forEach((library) => libraryMap.set(library.id, []));
    caseLibraryFolders.forEach((folder) => {
      const libraryId = getFolderLibraryId(folder);
      libraryMap.set(libraryId, [...(libraryMap.get(libraryId) || []), folder]);
    });

    return libraryMap;
  }, [normalizedCaseLibraries, caseLibraryFolders]);
  const childFoldersByParent = useMemo(() => {
    const folderMap = new Map<string, CaseFolder[]>();

    caseLibraryFolders.forEach((folder) => {
      const parentKey = folder.parentId || `library:${getFolderLibraryId(folder)}`;
      folderMap.set(parentKey, [...(folderMap.get(parentKey) || []), folder]);
    });

    return folderMap;
  }, [caseLibraryFolders]);
  const visibleFolderIds = useMemo(() => {
    if (!caseSearchKeyword) {
      return new Set(caseLibraryFolders.map((folder) => folder.id));
    }

    const folderById = new Map(caseLibraryFolders.map((folder) => [folder.id, folder]));
    const ids = new Set<string>();
    const includeAncestors = (folderId: string) => {
      let cursor = folderById.get(folderId);
      while (cursor) {
        ids.add(cursor.id);
        cursor = cursor.parentId ? folderById.get(cursor.parentId) : undefined;
      }
    };

    caseLibraryFolders.forEach((folder) => {
      if (folder.name.toLowerCase().includes(caseSearchKeyword)) {
        includeAncestors(folder.id);
      }
    });

    filteredCases.forEach((testCase) => includeAncestors(getCaseFolderId(testCase)));

    return ids;
  }, [caseLibraryFolders, caseSearchKeyword, filteredCases]);
  const visibleChildFoldersByParent = useMemo(() => {
    const folderMap = new Map<string, CaseFolder[]>();

    caseLibraryFolders.forEach((folder) => {
      if (!visibleFolderIds.has(folder.id)) {
        return;
      }
      const parentKey = folder.parentId || `library:${getFolderLibraryId(folder)}`;
      folderMap.set(parentKey, [...(folderMap.get(parentKey) || []), folder]);
    });

    return folderMap;
  }, [caseLibraryFolders, visibleFolderIds]);
  const casesByFolder = useMemo(() => {
    const folderMap = new Map<string, AutomationCase[]>();

    caseLibraryFolders.forEach((folder) => folderMap.set(folder.id, []));
    filteredCases.forEach((testCase) => {
      const folderId = getCaseFolderId(testCase);
      folderMap.set(folderId, [...(folderMap.get(folderId) || []), testCase]);
    });

    return folderMap;
  }, [caseLibraryFolders, filteredCases]);
  const selectedFolderCases = casesByFolder.get(selectedCaseFolderId) || [];
  const selectedFolder = caseLibraryFolders.find((folder) => folder.id === selectedCaseFolderId) || caseLibraryFolders[0];
  const selectedCaseLibrary = normalizedCaseLibraries.find((library) => library.id === selectedCaseLibraryId)
    || normalizedCaseLibraries[0];
  caseLibrariesRef.current = normalizedCaseLibraries;
  selectedCaseLibraryIdRef.current = selectedCaseLibraryId;
  const selectedLibraryRootFolders = visibleChildFoldersByParent.get(`library:${selectedCaseLibrary?.id || DEFAULT_CASE_LIBRARY_ID}`) || [];
  const selectedFolderChildren = visibleChildFoldersByParent.get(selectedFolder?.id || '') || [];
  const allCasesByFolder = useMemo(() => {
    const folderMap = new Map<string, AutomationCase[]>();

    caseLibraryFolders.forEach((folder) => folderMap.set(folder.id, []));
    cases.forEach((testCase) => {
      const folderId = getCaseFolderId(testCase);
      folderMap.set(folderId, [...(folderMap.get(folderId) || []), testCase]);
    });

    return folderMap;
  }, [caseLibraryFolders, cases]);
  const getConfiguredGitBranch = (library?: CaseLibrary) => (library?.gitBranch || library?.branch || 'master').trim() || 'master';
  const getCaseLibraryGitKey = (repoUrl: string, branch?: string) => `${repoUrl.trim()}#${(branch || 'master').trim() || 'master'}`;
  const findDuplicateGitLibrary = (libraryId: string, repoUrl: string, branch?: string) => {
    const nextKey = getCaseLibraryGitKey(repoUrl, branch);
    return normalizedCaseLibraries.find((library) => (
      library.id !== libraryId
      && Boolean(library.repoUrl)
      && getCaseLibraryGitKey(library.repoUrl || '', getConfiguredGitBranch(library)) === nextKey
    ));
  };

  const warnMissingLibraryGit = (library?: CaseLibrary, intent: GitConfigDialogState['intent'] = 'pull') => {
    const targetLibrary = library || selectedCaseLibrary;

    if (targetLibrary) {
      setSelectedCaseLibraryId(targetLibrary.id);
    }

    setGitConfigDialog({
      libraryId: targetLibrary?.id || DEFAULT_CASE_LIBRARY_ID,
      value: targetLibrary?.repoUrl || '',
      authUsername: targetLibrary?.authUsername || '',
      authToken: targetLibrary?.authToken || '',
      sshKeyPath: targetLibrary?.sshKeyPath || '',
      sshPassphrase: '',
      branch: getConfiguredGitBranch(targetLibrary),
      intent,
    });
    setGitConfigError('');
    setCaseLibraryStatus(`「${targetLibrary?.name || '当前用例库'}」尚未配置 Git 用例库地址。`);
  };

  useEffect(() => {
    if (!selectedLlmProviderId && llmProviders[0]) {
      setSelectedLlmProviderId(llmProviders[0].id);
    }
  }, [llmProviders, selectedLlmProviderId]);

  useEffect(() => {
    if (!electronApi?.ipcRenderer) {
      return;
    }

    let cancelled = false;
    void electronApi.ipcRenderer.invoke('environment:get-config').then((result: {
      success?: boolean;
      config?: EnvironmentConfig;
      effectiveAdbPath?: string;
      error?: string;
    }) => {
      if (cancelled) {
        return;
      }

      if (result?.success) {
        setEnvironmentDraft({
          adbPath: result.config?.adbPath || '',
          ttsProvider: normalizeTtsProviderConfig(result.config?.ttsProvider),
        });
        setTtsProviderDraft(normalizeTtsProviderConfig(result.config?.ttsProvider));
        setEffectiveAdbPath(result.effectiveAdbPath || '');
      } else if (result?.error) {
        setEnvironmentMessage(result.error);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [electronApi]);

  const saveEnvironmentConfig = async () => {
    if (!electronApi?.ipcRenderer) {
      setEnvironmentMessage('当前环境无法保存环境配置');
      return;
    }

    setIsSavingEnvironment(true);
    setEnvironmentMessage('正在保存环境配置...');

    try {
      const result = await electronApi.ipcRenderer.invoke('environment:save-config', {
        ...environmentDraft,
        ttsProvider: normalizeTtsProviderConfig(ttsProviderDraft),
        validateAdb: false,
      }) as {
        success?: boolean;
        config?: EnvironmentConfig;
        effectiveAdbPath?: string;
        adbVersion?: string;
        error?: string;
      };

      if (!result?.success) {
        setEnvironmentMessage(result?.error || '环境配置保存失败');
        return;
      }

      setEnvironmentDraft({
        adbPath: result.config?.adbPath || '',
        ttsProvider: normalizeTtsProviderConfig(result.config?.ttsProvider),
      });
      setTtsProviderDraft(normalizeTtsProviderConfig(result.config?.ttsProvider));
      setEffectiveAdbPath(result.effectiveAdbPath || '');
      setEnvironmentMessage(result.adbVersion ? `ADB 配置已保存：${result.adbVersion}` : 'ADB 配置已保存');
    } catch (error) {
      setEnvironmentMessage(error instanceof Error ? error.message : '环境配置保存失败');
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const saveTtsProviderConfig = async () => {
    if (!electronApi?.ipcRenderer) {
      setTtsMessage('当前环境无法保存 TTS 配置');
      return;
    }

    setIsSavingEnvironment(true);
    setTtsMessage('正在保存 TTS 配置...');

    try {
      const result = await electronApi.ipcRenderer.invoke('environment:save-config', {
        ...environmentDraft,
        ttsProvider: normalizeTtsProviderConfig(ttsProviderDraft),
      }) as {
        success?: boolean;
        config?: EnvironmentConfig;
        error?: string;
      };

      if (!result?.success) {
        setTtsMessage(result?.error || 'TTS 配置保存失败');
        return;
      }

      setEnvironmentDraft({
        adbPath: result.config?.adbPath || '',
        ttsProvider: normalizeTtsProviderConfig(result.config?.ttsProvider),
      });
      setTtsProviderDraft(normalizeTtsProviderConfig(result.config?.ttsProvider));
      setTtsMessage('TTS 配置已保存');
    } catch (error) {
      setTtsMessage(error instanceof Error ? error.message : 'TTS 配置保存失败');
    } finally {
      setIsSavingEnvironment(false);
    }
  };

  const testTtsProvider = async (paramValues: Record<string, string>) => {
    if (!electronApi?.ipcRenderer) {
      setTtsMessage('当前环境无法测试 TTS 配置');
      return;
    }

    if (!ttsProviderUsesTextParam(ttsProviderDraft)) {
      const message = 'TTS URL/Header/Body 中没有使用 text/textUrlEncoded/textJson，无法动态输入文本合成';
      setTtsMessage(message);
      setTtsTestDialog((current) => current ? { ...current, message } : current);
      return;
    }

    if (!String(paramValues.text || '').trim()) {
      const message = 'text 参数不能为空';
      setTtsMessage(message);
      setTtsTestDialog((current) => current ? { ...current, message } : current);
      return;
    }

    setIsTestingTts(true);
    setTtsMessage('正在调用 TTS 接口...');
    setTtsTestDialog((current) => current ? {
      ...current,
      message: '正在调用 TTS 接口...',
      response: undefined,
      audioPath: undefined,
      audioPreviewUrl: undefined,
      audioPreviewError: undefined,
    } : current);

    try {
      const result = await electronApi.ipcRenderer.invoke('tts:test-provider', {
        provider: ttsProviderDraft,
        params: paramValues,
      }) as {
        success?: boolean;
        path?: string;
        size?: number;
        sha256?: string;
        error?: string;
        httpResponse?: TtsHttpResponseEvidence;
        diagnostics?: { httpResponse?: TtsHttpResponseEvidence };
      };

      if (!result?.success) {
        setTtsMessage(result?.error || 'TTS 测试失败');
        setTtsTestDialog((current) => current ? {
          ...current,
          message: result?.error || 'TTS 测试失败',
          response: result.httpResponse || result.diagnostics?.httpResponse,
          audioPath: undefined,
          audioPreviewUrl: undefined,
          audioPreviewError: undefined,
        } : current);
        return;
      }

      const message = `TTS 测试成功：${result.path} (${result.size || 0} bytes, sha256 ${(result.sha256 || '').slice(0, 12)})`;
      let audioPreviewUrl = '';
      let audioPreviewError = '';

      if (result.path) {
        try {
          const previewResult = await electronApi.ipcRenderer.invoke('audio:create-preview', {
            sourcePath: result.path,
            outputFormat: ttsProviderDraft.outputExtension,
            sampleFormat: ttsProviderDraft.sampleFormat,
            sampleRate: ttsProviderDraft.sampleRate,
            channelCnt: ttsProviderDraft.channelCnt,
          }) as {
            success?: boolean;
            url?: string;
            error?: string;
          };
          if (previewResult?.success && previewResult.url) {
            audioPreviewUrl = previewResult.url;
          } else {
            audioPreviewError = previewResult?.error || '音频预览生成失败';
          }
        } catch (error) {
          audioPreviewError = error instanceof Error ? error.message : '音频预览生成失败';
        }
      } else {
        audioPreviewError = 'TTS 接口未返回可播放的本地音频文件';
      }

      setTtsMessage(message);
      setTtsTestDialog((current) => current ? {
        ...current,
        message,
        response: result.httpResponse,
        audioPath: result.path,
        audioPreviewUrl,
        audioPreviewError,
      } : current);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'TTS 测试失败';
      setTtsMessage(message);
      setTtsTestDialog((current) => current ? {
        ...current,
        message,
        audioPath: undefined,
        audioPreviewUrl: undefined,
        audioPreviewError: undefined,
      } : current);
    } finally {
      setIsTestingTts(false);
    }
  };

  const refreshSettingsDevices = async () => {
    if (!electronApi?.ipcRenderer) {
      setDeviceSettingsMessage('当前环境无法读取 adb devices');
      return;
    }

    setDeviceSettingsMessage('正在扫描 adb devices...');

    try {
      const result = await electronApi.ipcRenderer.invoke('adb:list-devices') as {
        devices?: SettingsAdbDevice[];
        error?: string;
      };
      setSettingsDevices(result.devices || []);
      setDeviceSettingsMessage(result.error ? `扫描失败：${result.error}` : `已检测到 ${result.devices?.length || 0} 台设备`);
    } catch (error) {
      setSettingsDevices([]);
      setDeviceSettingsMessage(error instanceof Error ? error.message : '扫描设备失败');
    }
  };

  useEffect(() => {
    if (settingsSection === 'device') {
      void refreshSettingsDevices();
    }
  }, [settingsSection]);

  const bindDeviceSerial = (target: 'phone' | 'glasses', rawSerial = deviceBindingDraft) => {
    const serial = rawSerial.trim();

    if (!serial) {
      setDeviceSettingsMessage('请输入或选择设备 SN');
      return;
    }

    setDeviceBindings((current) => {
      const nextPhoneSerials = current.phoneSerials.filter((item) => item !== serial);
      const nextGlassesSerials = current.glassesSerials.filter((item) => item !== serial);

      if (target === 'phone') {
        nextPhoneSerials.push(serial);
      } else {
        nextGlassesSerials.push(serial);
      }

      return {
        ...current,
        phoneSerials: nextPhoneSerials,
        glassesSerials: nextGlassesSerials,
      };
    });
    setDeviceBindingDraft('');
    setDeviceSettingsMessage(`已固定 ${serial} 为${target === 'phone' ? '手机' : '眼镜'}设备`);
  };

  const removeDeviceBinding = (serial: string) => {
    setDeviceBindings((current) => ({
      ...current,
      phoneSerials: current.phoneSerials.filter((item) => item !== serial),
      glassesSerials: current.glassesSerials.filter((item) => item !== serial),
    }));
  };

  const getSettingsDeviceLabel = (serial: string) => {
    const device = settingsDevices.find((item) => item.serial === serial);
    const model = device?.model || device?.product || device?.device;
    return model ? `${serial} / ${model}` : serial;
  };

  const sendAssistantMessage = async () => {
    const content = assistantInput.trim();

    if (!content || isAssistantSending) {
      return;
    }

    const provider = selectedLlmProvider || llmProviderDraft;
    if (!provider?.baseUrl || !provider?.model) {
      setAssistantError('请先在设置中心配置模型 Base URL 和模型名称，API Key 可留空。');
      setActiveTab('settings');
      return;
    }

    const assistantMode: AssistantMessage['mode'] = assistantCaseAuthoringEnabled ? 'case-authoring' : 'chat';
    const userMessage = createAssistantMessage('user', content, assistantMode);
    const nextMessages = [...assistantMessages, userMessage];

    setAssistantMessages(nextMessages);
    setAssistantInput('');
    setAssistantError('');
    setIsAssistantSending(true);

    try {
      const messages = assistantCaseAuthoringEnabled
        ? [
            {
              role: 'user',
              content: buildConversationalCaseDraftPrompt({
                userMessage: content,
                conversation: nextMessages
                  .filter((message) => message.mode === 'case-authoring')
                  .map((message) => ({
                    role: message.role,
                    content: message.content,
                  })),
                currentCase: selectedCase,
                folderId: selectedCaseFolderId || DEFAULT_CASE_FOLDER_ID,
                defaults: {
                  phonePackage: selectedPhonePackage,
                  glassesPackage: selectedGlassesPackage,
                },
              }, allWorkflowComponents),
            },
          ]
        : nextMessages.map((message) => ({
            role: message.role,
            content: message.content,
          }));

      const result = await electronApi?.ipcRenderer?.invoke('llm:chat', {
        provider,
        messages,
      });

      if (!result?.success) {
        throw new Error(result?.error || '模型请求失败');
      }

      if (assistantCaseAuthoringEnabled) {
        const parsed = parseConversationalCaseDraftResponse(result.content || '', {
          userMessage: content,
          conversation: nextMessages
            .filter((message) => message.mode === 'case-authoring')
            .map((message) => ({
              role: message.role,
              content: message.content,
            })),
          currentCase: selectedCase,
          folderId: selectedCaseFolderId || DEFAULT_CASE_FOLDER_ID,
          defaults: {
            phonePackage: selectedPhonePackage,
            glassesPackage: selectedGlassesPackage,
          },
        });

        setPendingAssistantDraft(parsed.draftCases.length > 0 ? parsed : null);
        setAssistantMessages((current) => [
          ...current,
          createAssistantMessage('assistant', parsed.reply, 'case-authoring'),
        ]);
        return;
      }

      setAssistantMessages((current) => [
        ...current,
        createAssistantMessage('assistant', result.content || '模型没有返回内容。', 'chat'),
      ]);
    } catch (error) {
      setAssistantError(error instanceof Error ? error.message : '模型请求失败');
    } finally {
      setIsAssistantSending(false);
    }
  };
  const visibleRunLogs = useMemo(() => {
    const indexedLogs = runLogs.map((log, index) => ({ log, index }));

    return indexedLogs;
  }, [runLogs, runLogDisplayMode]);

  const updateSelectedCase = (updater: (testCase: AutomationCase) => AutomationCase) => {
    if (isReportFlowReadOnly) {
      return;
    }

    if (flowCaseSnapshot?.id === selectedCase.id) {
      setFlowCaseSnapshot((current) => (current ? normalizeCaseFailurePolicy(updater(current), allWorkflowComponents) : current));
      return;
    }

    setCases((current) => current.map((testCase) => (
      testCase.id === selectedCase.id ? normalizeCaseFailurePolicy(updater(testCase), allWorkflowComponents) : testCase
    )));
  };

  const updateSelectedCaseEdges = (updater: (edges: Edge[]) => Edge[]) => {
    if (isReportFlowReadOnly) {
      return;
    }

    setCaseEdges((current) => {
      const nextEdges = normalizeConditionalEdgeHandles(selectedCase, updater(current[selectedCase.id] || []));
      setEdges(nextEdges);

      return {
        ...current,
        [selectedCase.id]: nextEdges,
      };
    });
  };

  const selectStep = (stepId: string) => {
    const step = selectedCase.steps.find((item) => item.id === stepId);
    const component = step?.componentId
      ? allWorkflowComponents.find((item) => item.id === step.componentId)
      : null;
    const nextConfigDraft = createConfigDraftForStep(step, component);

    if (selectedStepId !== stepId) {
      setSelectedStepId(stepId);
    }
    setConfigDraft((current) => (current === nextConfigDraft ? current : nextConfigDraft));
    if (!isConfigPanelOpen) {
      setIsConfigPanelOpen(true);
    }
  };

  const restoreWorkflowCanvasView = () => {
    window.setTimeout(() => {
      reactFlowInstanceRef.current?.fitView({
        padding: isReportFlowReadOnly ? 0.28 : 0.18,
        duration: 320,
        ...(isReportFlowReadOnly ? { maxZoom: 0.8 } : {}),
      });
    }, 120);
  };

  const getCaseNodePositions = (testCase: AutomationCase, liveNodes: Node[] = []) => {
    const storedPositions = nodePositions as unknown as CaseNodePositions & Record<string, unknown>;
    const caseScopedPositions = isNodePositions(storedPositions[testCase.id])
      ? storedPositions[testCase.id] as NodePositions
      : {};
    const legacyFlatPositions = testCase.steps.reduce<NodePositions>((positions, step) => {
      const position = storedPositions[step.id];

      if (isNodePosition(position)) {
        positions[step.id] = position;
      }

      return positions;
    }, {});
    const livePositions = liveNodes.reduce<NodePositions>((positions, node) => {
      positions[node.id] = node.position;
      return positions;
    }, {});

    return {
      ...legacyFlatPositions,
      ...caseScopedPositions,
      ...livePositions,
    };
  };

  const restoreWorkflowCanvasAfterLayout = (focusStepId?: string) => {
    const runAfterLayout = (callback: () => void) => {
      window.setTimeout(() => {
        window.requestAnimationFrame(() => {
          window.requestAnimationFrame(callback);
        });
      }, 40);
    };

    runAfterLayout(() => {
      const instance = reactFlowInstanceRef.current;

      if (!instance || !selectedCase) {
        return;
      }

      const focusPosition = focusStepId
        ? getCaseNodePositions(selectedCase)[focusStepId]
        : undefined;
      const viewport = instance.getViewport();

      if (focusPosition) {
        instance.setCenter(focusPosition.x + 130, focusPosition.y + 90, {
          zoom: viewport.zoom,
          duration: 0,
        });
        return;
      }

      instance.fitView({ padding: 0.18, duration: 0 });
    });
  };
  void restoreWorkflowCanvasAfterLayout;

  const getFlowViewportCenterPosition = (): NodePosition => {
    const pane = document.querySelector('.react-flow')?.getBoundingClientRect();
    const center = {
      x: (pane?.left || 0) + (pane?.width || window.innerWidth) / 2,
      y: (pane?.top || 0) + (pane?.height || window.innerHeight) / 2,
    };
    const instance = reactFlowInstanceRef.current as (ReactFlowInstance & {
      screenToFlowPosition?: (position: NodePosition) => NodePosition;
      project?: (position: NodePosition) => NodePosition;
    }) | null;
    const projected = instance?.screenToFlowPosition
      ? instance.screenToFlowPosition(center)
      : instance?.project
        ? instance.project(center)
        : center;

    return {
      x: Math.round(projected.x - 130),
      y: Math.round(projected.y - 80),
    };
  };

  const preserveFlowViewportAfterStateChange = () => {
    const instance = reactFlowInstanceRef.current;
    const viewport = instance?.getViewport();

    if (!instance || !viewport) {
      return;
    }

    window.requestAnimationFrame(() => {
      window.requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.setViewport(viewport, { duration: 0 });
      });
    });
  };

  const addStep = (type: AutomationStepType) => {
    if (isReportFlowReadOnly) {
      return;
    }

    const nextStep = createDefaultStep(type);
    if (type === 'llm_text_generate') {
      const provider = selectedLlmProvider || llmProviders[0];
      const variableName = createUniqueLlmTextVariableName(selectedCase.steps);
      nextStep.config = {
        ...nextStep.config,
        providerId: provider?.id || '',
        outputMappings: [
          { variableName, outputPath: variableName, fallbackValue: '' },
        ],
        saveToVariables: {
          [variableName]: `$.${variableName}`,
        },
        saveToVariablesText: JSON.stringify({ [variableName]: `$.${variableName}` }, null, 2),
        fallback: {
          [variableName]: '',
        },
        fallbackText: JSON.stringify({ [variableName]: '' }, null, 2),
      };
    }
    if (type === 'tts_synthesize') {
      const ttsIndex = selectedCase.steps.filter((step) => step.type === 'tts_synthesize').length + 1;
      nextStep.name = `TTS 音频合成 ${ttsIndex}`;
    }
    const endIndex = selectedCase.steps.findIndex((step) => step.type === 'end');
    const insertIndex = endIndex >= 0 ? endIndex : selectedCase.steps.length;
    const position = getFlowViewportCenterPosition();

    updateSelectedCase((testCase) => ({
      ...testCase,
      steps: [
        ...testCase.steps.slice(0, insertIndex),
        nextStep,
        ...testCase.steps.slice(insertIndex),
      ],
    }));
    setNodePositions((current) => ({
      ...current,
      [selectedCase.id]: {
        ...(current[selectedCase.id] || {}),
        [nextStep.id]: position,
      },
    }));
    setSelectedStepId(nextStep.id);
  };

  const addComponentStep = (component: TestComponent) => {
    if (isReportFlowReadOnly) {
      return;
    }

    const createdStep = createComponentStep(component);
    const extractionDefaultName = component.kind === 'tts_assert'
      ? DEFAULT_TEXT_ASSERT_VARIABLE_NAME
      : component.kind === 'json_assert'
        ? DEFAULT_JSON_ASSERT_VARIABLE_NAME
        : component.kind === 'llm_assert'
          ? DEFAULT_LLM_ASSERT_VARIABLE_NAME
          : '';
    const nextStep = extractionDefaultName
      ? ensureAssertExtractionInputs(createdStep, selectedCase.steps, extractionDefaultName)
      : createdStep;
    const endIndex = selectedCase.steps.findIndex((step) => step.type === 'end');
    const insertIndex = endIndex >= 0 ? endIndex : selectedCase.steps.length;
    const position = getFlowViewportCenterPosition();

    updateSelectedCase((testCase) => ({
      ...testCase,
      steps: [
        ...testCase.steps.slice(0, insertIndex),
        nextStep,
        ...testCase.steps.slice(insertIndex),
      ],
    }));
    setNodePositions((current) => ({
      ...current,
      [selectedCase.id]: {
        ...(current[selectedCase.id] || {}),
        [nextStep.id]: position,
      },
    }));
    setSelectedStepId(nextStep.id);
    setCustomAtomMenuScope(null);
    setCustomAtomMenuRect(null);
  };

  const copySelectedWorkflowStep = async () => {
    if (!selectedStep || selectedStep.type === 'start' || selectedStep.type === 'end') {
      return;
    }

    const payload: WorkflowClipboardPayload = {
      schema: 'glassbox.workflow.clipboard.v1',
      step: cloneWorkflowStep(selectedStep),
    };
    workflowClipboardRef.current = payload;
    window.localStorage.setItem('glassbox.workflow.clipboard', JSON.stringify(payload));

    try {
      await navigator.clipboard?.writeText(JSON.stringify(payload));
    } catch (_error) {
      // Browser clipboard permissions are best-effort; the in-app clipboard still works.
    }

    setRunMessage(`已复制节点：${selectedStep.name}`);
  };

  const readWorkflowClipboard = async () => {
    try {
      const text = await navigator.clipboard?.readText?.();
      if (text) {
        const parsed = JSON.parse(text) as WorkflowClipboardPayload;
        if (parsed?.schema === 'glassbox.workflow.clipboard.v1' && parsed.step) {
          return parsed;
        }
      }
    } catch (_error) {
      // Fall back to in-memory/localStorage clipboard.
    }

    if (workflowClipboardRef.current) {
      return workflowClipboardRef.current;
    }

    try {
      const stored = window.localStorage.getItem('glassbox.workflow.clipboard');
      const parsed = stored ? JSON.parse(stored) as WorkflowClipboardPayload : null;
      return parsed?.schema === 'glassbox.workflow.clipboard.v1' && parsed.step ? parsed : null;
    } catch (_error) {
      return null;
    }
  };

  const pasteWorkflowStep = async () => {
    if (isReportFlowReadOnly) {
      return;
    }

    const payload = await readWorkflowClipboard();

    if (!payload?.step || payload.step.type === 'start' || payload.step.type === 'end') {
      return;
    }

    const nextStep: AutomationStep = {
      ...cloneWorkflowStep(payload.step),
      id: createStepId(payload.step.type),
    };
    const endIndex = selectedCase.steps.findIndex((step) => step.type === 'end');
    const insertIndex = endIndex >= 0 ? endIndex : selectedCase.steps.length;
    const position = getFlowViewportCenterPosition();

    updateSelectedCase((testCase) => ({
      ...testCase,
      steps: [
        ...testCase.steps.slice(0, insertIndex),
        nextStep,
        ...testCase.steps.slice(insertIndex),
      ],
    }));
    setNodePositions((current) => ({
      ...current,
      [selectedCase.id]: {
        ...(current[selectedCase.id] || {}),
        [nextStep.id]: position,
      },
    }));
    setSelectedStepId(nextStep.id);
    setIsConfigPanelOpen(true);
    setRunMessage(`已粘贴节点：${nextStep.name}`);
  };

  useEffect(() => {
    const handleWorkflowShortcut = (event: KeyboardEvent) => {
      if (activeTab !== 'automation-flow' || shouldIgnoreWorkflowShortcut(event.target)) {
        return;
      }

      const isCopy = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'c';
      const isPaste = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v';

      if (!isCopy && !isPaste) {
        return;
      }

      event.preventDefault();
      if (isCopy) {
        void copySelectedWorkflowStep();
        return;
      }

      void pasteWorkflowStep();
    };

    window.addEventListener('keydown', handleWorkflowShortcut);
    return () => window.removeEventListener('keydown', handleWorkflowShortcut);
  }, [activeTab, selectedCase, selectedStep, isReportFlowReadOnly]);

  const toggleCustomAtomMenu = (
    scope: 'action' | 'detect',
    event: React.MouseEvent<HTMLButtonElement>
  ) => {
    const rect = event.currentTarget.getBoundingClientRect();

    setCustomAtomMenuScope((current) => {
      const nextScope = current === scope ? null : scope;
      setCustomAtomMenuRect(nextScope ? {
        left: Math.max(12, Math.min(rect.left, window.innerWidth - 272)),
        top: rect.bottom + 6,
        width: Math.max(224, rect.width),
      } : null);
      return nextScope;
    });
  };

  const updateStep = (stepId: string, patch: Partial<AutomationStep>) => {
    updateSelectedCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((step) => (
        step.id === stepId ? { ...step, ...patch } : step
      )),
    }));
  };

  const updateStepInput = (stepId: string, key: string, value: string) => {
    updateSelectedCase((testCase) => ({
      ...testCase,
      steps: testCase.steps.map((step) => (
        step.id === stepId
          ? {
              ...step,
              inputs: {
                ...(step.inputs || {}),
                [key]: value,
              },
            }
          : step
      )),
    }));
  };

  const updateSelectedCaseComponent = (updater: (component: TestComponent) => TestComponent) => {
    if (!selectedStepComponent || !selectedStep?.componentId) {
      return;
    }

    updateSelectedCase((testCase) => {
      const caseComponents = [...(testCase.components || [])];
      const existingIndex = caseComponents.findIndex((component) => component.id === selectedStep.componentId);
      const nextComponent = updater(existingIndex >= 0 ? caseComponents[existingIndex] : selectedStepComponent);

      if (existingIndex >= 0) {
        caseComponents[existingIndex] = nextComponent;
      } else {
        caseComponents.push(nextComponent);
      }

      return {
        ...testCase,
        components: caseComponents,
      };
    });
  };

  const addSelectedAdbParam = () => {
    if (!selectedStepComponent || !selectedStep) {
      return;
    }

    const usedKeys = new Set(selectedStepComponent.params.map((param) => param.key));
    let index = selectedStepComponent.params.length + 1;
    while (usedKeys.has(`param${index}`)) {
      index += 1;
    }
    const key = `param${index}`;
    updateSelectedCaseComponent((component) => ({
      ...component,
      params: [
        ...component.params,
        { key, label: `参数 ${index}`, inputType: 'text', defaultValue: '' },
      ],
    }));
    updateStepInput(selectedStep.id, key, '');
  };

  const updateSelectedAdbParam = (paramIndex: number, patch: Partial<ComponentParam>) => {
    if (!selectedStepComponent || !selectedStep) {
      return;
    }

    const previousParam = selectedStepComponent.params[paramIndex];
    if (!previousParam) {
      return;
    }
    const nextKey = patch.key === undefined ? previousParam.key : patch.key.trim();

    updateSelectedCase((testCase) => {
      const caseComponents = [...(testCase.components || [])];
      const existingIndex = caseComponents.findIndex((component) => component.id === selectedStep.componentId);
      const nextParams = selectedStepComponent.params.map((param, index) => (
        index === paramIndex ? { ...param, ...patch, key: nextKey } : param
      ));
      const nextComponent = {
        ...selectedStepComponent,
        commandTemplate: nextKey && nextKey !== previousParam.key
          ? selectedStepComponent.commandTemplate.split(`{{${previousParam.key}}}`).join(`{{${nextKey}}}`)
          : selectedStepComponent.commandTemplate,
        params: nextParams,
      };

      if (existingIndex >= 0) {
        caseComponents[existingIndex] = nextComponent;
      } else {
        caseComponents.push(nextComponent);
      }

      return {
        ...testCase,
        components: caseComponents,
        steps: testCase.steps.map((step) => {
          if (step.id !== selectedStep.id || nextKey === previousParam.key) {
            return step;
          }
          const nextInputs = { ...(step.inputs || {}) };
          const previousValue = nextInputs[previousParam.key] ?? previousParam.defaultValue ?? '';
          delete nextInputs[previousParam.key];
          if (nextKey) {
            nextInputs[nextKey] = previousValue;
          }
          return { ...step, inputs: nextInputs };
        }),
      };
    });
  };

  const removeSelectedAdbParam = (paramIndex: number) => {
    if (!selectedStepComponent || !selectedStep) {
      return;
    }

    const removedParam = selectedStepComponent.params[paramIndex];
    if (!removedParam) {
      return;
    }

    updateSelectedCase((testCase) => {
      const caseComponents = [...(testCase.components || [])];
      const existingIndex = caseComponents.findIndex((component) => component.id === selectedStep.componentId);
      const nextComponent = {
        ...selectedStepComponent,
        params: selectedStepComponent.params.filter((_, index) => index !== paramIndex),
      };
      if (existingIndex >= 0) {
        caseComponents[existingIndex] = nextComponent;
      } else {
        caseComponents.push(nextComponent);
      }

      return {
        ...testCase,
        components: caseComponents,
        steps: testCase.steps.map((step) => {
          if (step.id !== selectedStep.id) {
            return step;
          }
          const nextInputs = { ...(step.inputs || {}) };
          delete nextInputs[removedParam.key];
          return { ...step, inputs: nextInputs };
        }),
      };
    });
  };

  const removeStep = (stepId: string) => {
    if (isReportFlowReadOnly) {
      return;
    }

    preserveFlowViewportAfterStateChange();
    updateSelectedCase((testCase) => {
      const nextSteps = testCase.steps.filter((step) => step.id !== stepId);

      return {
        ...testCase,
        steps: nextSteps,
      };
    });
    setSelectedStepId('');
    setConfigDraft('');
    setIsConfigPanelOpen(false);
    updateSelectedCaseEdges((current) => current.filter((edge) => edge.source !== stepId && edge.target !== stepId));
    setNodePositions((current) => {
      const next = { ...current };
      const nextCasePositions = { ...(next[selectedCase.id] || {}) };
      delete nextCasePositions[stepId];
      next[selectedCase.id] = nextCasePositions;
      delete (next as unknown as Record<string, unknown>)[stepId];
      return next;
    });
  };

  const spreadWorkflowLayout = () => {
    if (!selectedCase || isReportFlowReadOnly) {
      return;
    }

    preserveFlowViewportAfterStateChange();

    const positionByStepId = createWorkflowAutoLayoutPositions(
      selectedCase.steps,
      ensureBoundaryEdges(selectedCase, edges)
    );

    setNodePositions((current) => ({
      ...current,
      [selectedCase.id]: {
        ...(current[selectedCase.id] || {}),
        ...positionByStepId,
      },
    }));
    setRunMessage('已整理 FLOW 节点布局');
  };

  const handleConnect = useCallback((connection: Connection) => {
    if (isReportFlowReadOnly) {
      return;
    }

    if (!connection.source || !connection.target || connection.source === connection.target) {
      return;
    }

    updateSelectedCaseEdges((current) => addEdge({
      ...connection,
      type: 'smoothstep',
      animated: false,
    }, current));
  }, [selectedCase, isReportFlowReadOnly]);

  const previewContext = useMemo<WorkflowPreviewContext>(() => ({
    phoneSerial: selectedPhoneSerial,
    glassesSerial: selectedGlassesSerial,
    phonePackage: selectedPhonePackage,
    glassesPackage: selectedGlassesPackage,
    variables: selectedCase?.variables || {},
    llmProviders,
    selectedLlmProviderId,
  }), [selectedPhoneSerial, selectedGlassesSerial, selectedPhonePackage, selectedGlassesPackage, selectedCase, llmProviders, selectedLlmProviderId]);

  useEffect(() => {
    if (activeTab !== 'automation-flow') {
      return;
    }

    if (!selectedCase) {
      setNodes([]);
      lastRenderedFlowCaseIdRef.current = '';
      return;
    }

    const shouldPreserveViewport = (
      activeTab === 'automation-flow'
      && lastRenderedFlowCaseIdRef.current === selectedCase.id
      && reactFlowInstanceRef.current
    );
    const instance = reactFlowInstanceRef.current;
    const previousViewport = shouldPreserveViewport && instance
      ? instance.getViewport()
      : null;
    const sourceEdgesForLayout = flowCaseSnapshot && isReportFlowReadOnly && flowCaseEdgesSnapshot
      ? flowCaseEdgesSnapshot
      : caseEdges[selectedCase.id] || [];
    const layoutEdges = ensureBoundaryEdges(selectedCase, sourceEdgesForLayout);
    const layoutPositions = createWorkflowAutoLayoutPositions(selectedCase.steps, layoutEdges);
    const storedCasePositions = getCaseNodePositions(selectedCase);
    const missingPositions = Object.fromEntries(
      Object.entries(layoutPositions).filter(([stepId]) => !isNodePosition(storedCasePositions[stepId]))
    );
    if (Object.keys(missingPositions).length > 0 && !isReportFlowReadOnly) {
      setNodePositions((current) => ({
        ...current,
        [selectedCase.id]: {
          ...(current[selectedCase.id] || {}),
          ...missingPositions,
        },
      }));
    }
    const runtimePreviews = buildWorkflowNodeResultPreviews(selectedCase.steps, runLogs, runArtifacts);

    setNodes(() => {
      return stepsToNodes(
        selectedCase.steps,
        runStatuses,
        allWorkflowComponents,
        previewContext,
        storedCasePositions,
        removeStep,
        {
          readOnlyPreview: isReportFlowReadOnly,
          layoutPositions,
          forceLayoutPositions: isReportFlowReadOnly,
          runtimePreviews,
        }
      );
    });
    lastRenderedFlowCaseIdRef.current = selectedCase.id;

    if (previousViewport) {
      window.requestAnimationFrame(() => {
        reactFlowInstanceRef.current?.setViewport(previousViewport, { duration: 0 });
      });
    }
  }, [selectedCase, runStatuses, allWorkflowComponents, previewContext, nodePositions, activeTab, setNodes, isReportFlowReadOnly, caseEdges, flowCaseSnapshot, flowCaseEdgesSnapshot, runLogs, runArtifacts]);

  useEffect(() => {
    const sourceEdges = flowCaseSnapshot && isReportFlowReadOnly && flowCaseEdgesSnapshot
      ? flowCaseEdgesSnapshot
      : selectedCase
        ? caseEdges[selectedCase.id] || []
        : [];

    setEdges(selectedCase ? ensureBoundaryEdges(selectedCase, sourceEdges) : []);
  }, [caseEdges, selectedCase, setEdges, flowCaseSnapshot, flowCaseEdgesSnapshot, isReportFlowReadOnly]);

  useEffect(() => {
    if (runLogDisplayMode !== 'compact' || !runLogPanelRef.current) {
      return;
    }

    runLogPanelRef.current.scrollTop = runLogPanelRef.current.scrollHeight;
  }, [runLogs, runLogDisplayMode]);

  useEffect(() => {
    if (!electronApi?.ipcRenderer || activeTab !== 'automation-task-report' || !selectedAutomationTaskId) {
      return;
    }

    const selectedTask = automationTasks.find((task) => task.id === selectedAutomationTaskId);
    const screenshotPaths = Array.from(new Set(
      (selectedTask?.cases || []).flatMap((caseRecord) => (
        (caseRecord.artifacts?.screenshots || []).map((screenshot) => screenshot.path).filter(Boolean)
      ))
    ));
    const missingPaths = screenshotPaths.filter((pathValue) => !screenshotPreviewUrls[pathValue]);

    if (missingPaths.length === 0) {
      return;
    }

    let cancelled = false;
    void Promise.all(missingPaths.map(async (pathValue) => {
      try {
        const result = await electronApi.ipcRenderer.invoke('file:read-image-data-url', pathValue) as {
          success?: boolean;
          dataUrl?: string;
        };

        return result?.success && result.dataUrl ? [pathValue, result.dataUrl] as const : null;
      } catch (_error) {
        return null;
      }
    })).then((entries) => {
      if (cancelled) {
        return;
      }

      const nextEntries = entries.filter(Boolean) as Array<readonly [string, string]>;
      if (nextEntries.length === 0) {
        return;
      }

      setScreenshotPreviewUrls((current) => ({
        ...current,
        ...Object.fromEntries(nextEntries),
      }));
    });

    return () => {
      cancelled = true;
    };
  }, [activeTab, automationTasks, electronApi, screenshotPreviewUrls, selectedAutomationTaskId]);

  useEffect(() => {
    if (activeTab !== 'automation-task-report' || !selectedAutomationTaskId) {
      return;
    }

    const selectedTask = automationTasks.find((task) => task.id === selectedAutomationTaskId);
    if (selectedTask?.reportDetailLoaded === false) {
      const elapsed = Date.now() - (detailLoadedAtRef.current.get(selectedTask.id) || 0);
      const timer = window.setTimeout(() => void ensureAutomationTaskDetail(selectedTask), Math.max(0, 2000 - elapsed));
      return () => window.clearTimeout(timer);
    }
  }, [activeTab, selectedAutomationTaskId, automationTasks]);

  useEffect(() => {
    if (activeTab !== 'automation-flow' || !selectedCase) {
      return;
    }

    restoreWorkflowCanvasView();
  }, [runLogDisplayMode, activeTab, selectedCase?.id, isReportFlowReadOnly]);

  useEffect(() => {
    if (!workflowStateHydratedRef.current) {
      return;
    }
    const fingerprint = createCaseLibraryEditorFingerprint(
      cases,
      caseLibraries,
      caseFolders,
      components,
      caseEdges,
      nodePositions
    );
    if (!caseLibraryEditorBaselineRef.current || caseLibraryRefreshApplyingRef.current) {
      caseLibraryEditorBaselineRef.current = fingerprint;
      caseLibraryEditorDirtyRef.current = false;
      caseLibraryRefreshApplyingRef.current = false;
      return;
    }
    caseLibraryEditorDirtyRef.current = fingerprint !== caseLibraryEditorBaselineRef.current;
  }, [cases, caseLibraries, caseFolders, components, caseEdges, nodePositions]);

  const nextRendererOwnedAutomationTasks = automationTasks.filter(isRendererOwnedAutomationTask);
  if (
    nextRendererOwnedAutomationTasks.length !== rendererOwnedAutomationTasksRef.current.length
    || nextRendererOwnedAutomationTasks.some((task, index) => task !== rendererOwnedAutomationTasksRef.current[index])
  ) {
    rendererOwnedAutomationTasksRef.current = nextRendererOwnedAutomationTasks;
  }
  const rendererOwnedAutomationTasks = rendererOwnedAutomationTasksRef.current;
  const pendingCaseUpdateRef = useRef('');
  const liveCaseStateRef = useRef({ cases, components, caseEdges, nodePositions, caseLibraries, caseFolders });
  liveCaseStateRef.current = { cases, components, caseEdges, nodePositions, caseLibraries, caseFolders };
  useEffect(() => {
    if (!electronApi?.ipcRenderer) return;
    const handleCaseUpdate = (_event: unknown, request: { requestId: string; caseId: string; document: unknown; options?: { create?: boolean; libraryId?: string; folderId?: string } }) => {
      try {
        if (!workflowStateHydratedRef.current) throw new Error('Editor is still loading; retry after loading completes');
        const next = mergeCaseUpdate(liveCaseStateRef.current, request.caseId, request.document, request.options);
        if (workflowStateSaveTimerRef.current) window.clearTimeout(workflowStateSaveTimerRef.current);
        pendingCaseUpdateRef.current = request.requestId;
        setCases(next.cases);
        setCaseEdges(next.caseEdges);
        setNodePositions(next.nodePositions);
      } catch (error) {
        void electronApi.ipcRenderer.invoke('workflow-case:update-failed', request.requestId, String(error));
      }
    };
    electronApi.ipcRenderer.on('workflow-case:update', handleCaseUpdate);
    return () => electronApi.ipcRenderer.removeListener('workflow-case:update', handleCaseUpdate);
  }, [electronApi]);

  useEffect(() => {
    if (!electronApi?.ipcRenderer) return;
    const update = (_event: unknown, request: { requestId: string; patch: Pick<StoredWorkflowEditorState, 'llmProviders' | 'selectedLlmProviderId' | 'components' | 'deviceBindings' | 'cases' | 'caseLibraries' | 'caseFolders' | 'caseEdges' | 'nodePositions' | 'selectedCaseId' | 'selectedCaseLibraryId'> }) => {
      try {
        if (!workflowStateHydratedRef.current || pendingCaseUpdateRef.current) throw new Error('编辑器正在保存，请稍后重试配置');
        if (workflowStateSaveTimerRef.current) window.clearTimeout(workflowStateSaveTimerRef.current);
        pendingCaseUpdateRef.current = request.requestId;
        if (request.patch.llmProviders) { setLlmProviders(request.patch.llmProviders); setLlmProviderDraft(request.patch.llmProviders[0] || createLlmProviderDraft()); }
        if (request.patch.selectedLlmProviderId) setSelectedLlmProviderId(request.patch.selectedLlmProviderId);
        if (request.patch.components) setComponents(request.patch.components);
        if (request.patch.cases) setCases(normalizeStoredCases(request.patch.cases));
        if (request.patch.caseLibraries) setCaseLibraries(request.patch.caseLibraries);
        if (request.patch.caseFolders) setCaseFolders(request.patch.caseFolders);
        if (request.patch.caseEdges) setCaseEdges(request.patch.caseEdges);
        if (request.patch.nodePositions) setNodePositions(request.patch.nodePositions as CaseNodePositions);
        if (request.patch.selectedCaseId) setSelectedCaseId(request.patch.selectedCaseId);
        if (request.patch.selectedCaseLibraryId) setSelectedCaseLibraryId(request.patch.selectedCaseLibraryId);

        if (request.patch.deviceBindings) { setDeviceBindings(request.patch.deviceBindings); setSelectedPhonePackage(request.patch.deviceBindings.phoneDefaultPackage); setSelectedGlassesPackage(request.patch.deviceBindings.glassesDefaultPackage); }
      } catch (error) {
        void electronApi.ipcRenderer.invoke('workflow-case:update-failed', request.requestId, String(error));
      }
    };
    const environment = (_event: unknown, result: { config: EnvironmentConfig; effectiveAdbPath?: string }) => {
      setEnvironmentDraft(result.config);
      setTtsProviderDraft(normalizeTtsProviderConfig(result.config.ttsProvider));
      setEffectiveAdbPath(result.effectiveAdbPath || '');
    };
    electronApi.ipcRenderer.on('agent:environment-update', environment);
    electronApi.ipcRenderer.on('agent:configuration-update', update);
    return () => { electronApi.ipcRenderer.removeListener('agent:configuration-update', update); electronApi.ipcRenderer.removeListener('agent:environment-update', environment); };
  }, [electronApi]);

  const liveSettingsRef = useRef({ llmProviders, selectedLlmProviderId, components });
  liveSettingsRef.current = { llmProviders, selectedLlmProviderId, components };
  useEffect(() => {
    if (!electronApi?.ipcRenderer) return;
    const update = (_event: unknown, request: { requestId: string; patch: Partial<Pick<StoredWorkflowEditorState, 'llmProviders' | 'selectedLlmProviderId' | 'components'>>; baseline: Partial<Pick<StoredWorkflowEditorState, 'llmProviders' | 'selectedLlmProviderId' | 'components'>> }) => {
      try {
        if (!workflowStateHydratedRef.current || pendingCaseUpdateRef.current) throw new Error('编辑器正在加载或保存，请稍后重试');
        for (const key of Object.keys(request.patch) as (keyof typeof request.patch)[]) {
          if (JSON.stringify(liveSettingsRef.current[key]) !== JSON.stringify(request.baseline[key])) throw new Error('设置存在尚未同步的页面修改，请等待保存后重新提交差量配置');
        }
        if (workflowStateSaveTimerRef.current) window.clearTimeout(workflowStateSaveTimerRef.current);
        pendingCaseUpdateRef.current = request.requestId;
        if (request.patch.llmProviders) { setLlmProviders(request.patch.llmProviders); setLlmProviderDraft(request.patch.llmProviders[0]); }
        if (request.patch.selectedLlmProviderId) setSelectedLlmProviderId(request.patch.selectedLlmProviderId);
        if (request.patch.components) setComponents(request.patch.components);
      } catch (error) { void electronApi.ipcRenderer.invoke('workflow-case:update-failed', request.requestId, String(error)); }
    };
    const environment = (_event: unknown, result: { config: EnvironmentConfig; effectiveAdbPath?: string }) => {
      setEnvironmentDraft(result.config);
      setTtsProviderDraft(normalizeTtsProviderConfig(result.config.ttsProvider));
      setEffectiveAdbPath(result.effectiveAdbPath || '');
    };
    electronApi.ipcRenderer.on('settings:workflow-update', update);
    electronApi.ipcRenderer.on('settings:environment-updated', environment);
    return () => { electronApi.ipcRenderer.removeListener('settings:workflow-update', update); electronApi.ipcRenderer.removeListener('settings:environment-updated', environment); };
  }, [electronApi]);

  const rendererOwnedAutomationTasksFingerprint = useMemo(
    () => JSON.stringify(rendererOwnedAutomationTasks),
    [rendererOwnedAutomationTasks]
  );

  useEffect(() => {
    if (!workflowStateHydratedRef.current || typeof window === 'undefined') {
      return;
    }

    const synchronizedCases = cases.map((testCase) => ({
      ...testCase,
      edges: ensureBoundaryEdges(testCase, caseEdges[testCase.id] || (testCase as AutomationCase & { edges?: Edge[] }).edges || stepsToEdges(testCase.steps)),
    }));
    const payload: StoredWorkflowEditorState = {
      cases: synchronizedCases,
      caseLibraries,
      caseFolders,
      automationTasks: rendererOwnedAutomationTasks,
      components,
      llmProviders,
      selectedLlmProviderId,
      assistantMessages,
      caseEdges,
      nodePositions,
      selectedCaseId,
      selectedCaseLibraryId,
      remoteCasesUrl,
      deviceBindings,
    };

    if (workflowStateSaveTimerRef.current) {
      window.clearTimeout(workflowStateSaveTimerRef.current);
    }

    const saveDelay = pendingCaseUpdateRef.current || caseLibraryPersistenceUrgentRef.current ? 0 : 250;
    workflowStateSaveTimerRef.current = window.setTimeout(() => {
      saveWorkflowStateToLocalStorage(payload);

      if (electronApi?.ipcRenderer) {
        const requestId = pendingCaseUpdateRef.current;
        pendingCaseUpdateRef.current = '';
        void electronApi.ipcRenderer.invoke('workflow-state:save', payload, requestId).then(async (result: { success: boolean; error?: string }) => {
          if (result.success) return;
          setRunMessage(`用例保存未完成：${result.error || '保存失败'}；已保留磁盘上的版本`);
          // Restore the authoritative editor projection after a rejected stale
          // refresh; otherwise a later auto-save could retry the old snapshot.
          const loaded = await electronApi.ipcRenderer.invoke('workflow-state:load') as { success: boolean; state?: StoredWorkflowEditorState };
          if (!loaded.success || !loaded.state) return;
          const saved = loaded.state;
          if (saved.cases) setCases(normalizeStoredCases(saved.cases));
          if (saved.caseEdges) setCaseEdges(saved.caseEdges);
          if (saved.caseLibraries) setCaseLibraries(saved.caseLibraries);
          if (saved.caseFolders) setCaseFolders(saved.caseFolders);
          if (saved.nodePositions) setNodePositions(saved.nodePositions as CaseNodePositions);
        }).catch((error: unknown) => setRunMessage(`用例保存失败：${String(error)}`));
      }
      caseLibraryPersistenceUrgentRef.current = false;
    }, saveDelay);

    return () => {
      if (workflowStateSaveTimerRef.current) {
        window.clearTimeout(workflowStateSaveTimerRef.current);
      }
    };
  }, [cases, caseLibraries, caseFolders, rendererOwnedAutomationTasksFingerprint, components, llmProviders, selectedLlmProviderId, assistantMessages, caseEdges, nodePositions, selectedCaseId, selectedCaseLibraryId, remoteCasesUrl, deviceBindings, electronApi]);

  const handleNodesChange = useCallback((changes: NodeChange[]) => {
    if (isReportFlowReadOnly) {
      return;
    }

    onNodesChangeBase(changes);
  }, [onNodesChangeBase, isReportFlowReadOnly]);

  const handleNodeDragStop = useCallback((_event: React.MouseEvent, node?: Node) => {
    const activeCaseId = selectedCase?.id;

    if (isReportFlowReadOnly || !activeCaseId || !node?.id) {
      return;
    }

    window.requestAnimationFrame(() => {
      setNodePositions((current) => ({
        ...current,
        [activeCaseId]: {
          ...(current[activeCaseId] || {}),
          [node.id]: node.position,
        },
      }));
    });
  }, [selectedCase?.id, isReportFlowReadOnly]);

  const handleEdgesChange = useCallback((changes: EdgeChange[]) => {
    if (isReportFlowReadOnly) {
      return;
    }

    onEdgesChangeBase(changes);
    updateSelectedCaseEdges((current) => applyEdgeChanges(changes, current));
  }, [onEdgesChangeBase, selectedCase, isReportFlowReadOnly]);

  const handleEdgeUpdate = useCallback((oldEdge: Edge, newConnection: Connection) => {
    if (isReportFlowReadOnly) {
      return;
    }

    updateSelectedCaseEdges((current) => updateEdge(oldEdge, newConnection, current));
  }, [selectedCase, isReportFlowReadOnly]);

  useEffect(() => {
    if (!electronApi?.ipcRenderer) {
      return undefined;
    }

    const handleProgress = (_event: unknown, payload: { requestId: string; result: WorkflowRunLog; results: WorkflowRunLog[] }) => {
      const activeTaskRun = activeTaskRunRef.current;
      if (String(payload.result?.status) === 'running') {
        if (payload.requestId === activeWorkflowRequestIdRef.current) {
          setRunStatuses((current) => ({ ...current, [payload.result.stepId]: 'running' }));
          setRunMessage(`正在执行工作流：${payload.result.stepName}`);
        }
        return;
      }
      const normalizedResults = normalizeRunLogsTiming(payload.results || []);
      const normalizedResult = normalizeRunLogTiming(payload.result);

      if (activeTaskRun?.requestId === payload.requestId) {
        setAutomationTasks((current) => current.map((task) => {
          if (task.id !== activeTaskRun.taskId) {
            return task;
          }

          return {
            ...task,
            cases: (task.cases || []).map((caseRecord) => (
              caseRecord.caseId === activeTaskRun.caseId
                ? caseRecord.endedAt || caseRecord.finishedAt
                  ? caseRecord
                  : {
                      ...caseRecord,
                      status: normalizedResult.status === 'stopped'
                        ? 'stopped'
                        : normalizedResult.status === 'failed'
                          ? 'failed'
                          : 'running',
                      completed: normalizedResults.length,
                      results: normalizedResults,
                      error: normalizedResult.status === 'failed' || normalizedResult.status === 'stopped'
                        ? normalizedResult.error || normalizedResult.stderr || caseRecord.error
                        : caseRecord.error,
                    }
                : caseRecord
            )),
          };
        }));
      }

      if (payload.requestId !== activeWorkflowRequestIdRef.current) {
        return;
      }

      setRunLogs(normalizedResults);
      setEdgeRuntimeLabels(buildEdgeRuntimeLabels(normalizedResults, edges));
      setRunStatuses((current) => ({
        ...current,
        [normalizedResult.stepId]: normalizedResult.status === 'success'
          ? 'success'
          : normalizedResult.status === 'stopped'
            ? 'stopped'
            : 'failed',
        ...(() => {
          if (normalizedResult.status !== 'success') {
            return {};
          }

          const currentIndex = activeWorkflowStepIdsRef.current.indexOf(normalizedResult.stepId);
          const nextStepId = activeWorkflowStepIdsRef.current[currentIndex + 1];

          return nextStepId ? { [nextStepId]: 'running' as RunStatus } : {};
        })(),
      }));
      setRunMessage(`正在执行工作流：${normalizedResult.stepName} ${normalizedResult.status === 'success' ? '完成' : normalizedResult.status === 'stopped' ? '已强制停止' : '失败'}`);
    };

    electronApi.ipcRenderer.on('workflow:progress', handleProgress);

    return () => {
      electronApi.ipcRenderer.removeListener('workflow:progress', handleProgress);
    };
  }, [electronApi]);

  const saveConfigDraft = () => {
    if (!selectedStep) {
      return;
    }

    try {
      const nextConfig = JSON.parse(configDraft || '{}');

      updateStep(selectedStep.id, { config: nextConfig });
      setRunMessage('节点配置已保存');
    } catch (error) {
      setRunMessage(`配置 JSON 解析失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const createCase = (folderId = selectedCaseFolderId || DEFAULT_CASE_FOLDER_ID) => {
    const folder = caseLibraryFolders.find((item) => item.id === folderId);
    const nextCase = normalizeCase({
      ...createDefaultCase(),
      id: `case-${Date.now()}`,
      name: `新建用例 ${cases.length + 1}`,
      folderId,
      steps: [
        createDefaultStep('start'),
        createDefaultStep('end'),
      ],
    });

    setCases((current) => [...current, nextCase]);
    setCaseEdges((current) => ({
      ...current,
      [nextCase.id]: stepsToEdges(nextCase.steps),
    }));
    setSelectedCaseId(nextCase.id);
    setSelectedStepId(nextCase.steps[0]?.id || '');
    setConfigDraft(JSON.stringify(nextCase.steps[0]?.config || {}, null, 2));
    setIsConfigPanelOpen(false);
    setSelectedCaseFolderId(folderId);
    setSelectedCaseLibraryId(getFolderLibraryId(folder));
    setCaseCreateMenuFor(null);
    setCaseActionMenuFor(null);
  };

  const importSoloPiDraft = (source: AutomationCase) => {
    const libraryId = soloPiDialog?.libraryId || selectedCaseLibraryId || DEFAULT_CASE_LIBRARY_ID;
    let folder = caseLibraryFolders.find(item => item.id === soloPiDialog?.folderId && getFolderLibraryId(item) === libraryId);
    if (!folder) {
      folder = { id: `case-folder-solopi-${Date.now()}`, name: 'SoloPi 导入', libraryId, expanded: true };
      const createdFolder = folder;
      setCaseFolders(current => [...current, createdFolder]);
    }
    const folderId = folder.id;
    const nextCase = normalizeCase({ ...source, folderId, libraryId });
    setCases(current => [...current, nextCase]);
    setCaseEdges(current => ({ ...current, [nextCase.id]: stepsToEdges(nextCase.steps) }));
    setSelectedCaseId(nextCase.id);
    setSelectedStepId(nextCase.steps[1]?.id || nextCase.steps[0].id);
    setConfigDraft(JSON.stringify(nextCase.steps[1]?.config || {}, null, 2));
    setSelectedCaseFolderId(folderId);
    setSelectedCaseLibraryId(getFolderLibraryId(folder));
    setCaseCreateMenuFor(null);
    setFlowReturnTarget({ tab: 'automation-cases' });
    setActiveTab('automation-flow');
    setIsConfigPanelOpen(true);
    setRunMessage('SoloPi 用例已生成草稿；请检查节点并补充业务断言。');
  };

  const createCaseFolder = (libraryId = selectedCaseLibraryId || DEFAULT_CASE_LIBRARY_ID, parentId?: string) => {
    setNameDialog({
      mode: 'create-folder',
      title: '新建文件夹',
      value: `用例文件夹 ${caseFolders.length + 1}`,
    });
    setSelectedCaseLibraryId(libraryId);
    setPendingNewFolderParentId(parentId);
    if (parentId) {
      setSelectedCaseFolderId(parentId);
    }
    setCaseCreateMenuFor(null);
    setCaseActionMenuFor(null);
  };

  const createCaseLibrary = () => {
    setNameDialog({
      mode: 'create-library',
      title: '新建用例库',
      value: `用例库 ${caseLibraries.length + 1}`,
    });
    setCaseCreateMenuFor(null);
  };

  const openRenameFolderDialog = (folder: CaseFolder) => {
    setNameDialog({
      mode: 'rename-folder',
      title: '重命名文件夹',
      value: folder.name,
      folderId: folder.id,
    });
    setCaseCreateMenuFor(null);
  };
  void openRenameFolderDialog;

  const openRenameCaseDialog = (testCase: AutomationCase) => {
    setNameDialog({
      mode: 'rename-case',
      title: '重命名用例',
      value: testCase.name,
      caseId: testCase.id,
    });
  };
  void openRenameCaseDialog;

  const openFolderImport = (folderId: string) => {
    caseLibraryImportFolderIdRef.current = folderId;
    setCaseCreateMenuFor(null);
    caseLibraryImportInputRef.current?.click();
  };


  const addDraftCasesToFolder = (draftCases: AutomationCase[], folderId: string) => {
    setCases((current) => {
      const nextMap = new Map(current.map((testCase) => [testCase.id, testCase]));
      draftCases.forEach((testCase) => nextMap.set(testCase.id, { ...testCase, folderId }));
      return Array.from(nextMap.values());
    });
    setCaseEdges((current) => {
      const nextEdges = { ...current };
      draftCases.forEach((testCase) => {
        nextEdges[testCase.id] = ensureBoundaryEdges(testCase, current[testCase.id] || []);
      });
      return nextEdges;
    });
    setNodePositions((current) => {
      const nextPositions = { ...current };
      draftCases.forEach((testCase) => {
        nextPositions[testCase.id] = migrateCaseNodePositions(testCase, current[testCase.id], stepsToEdges(testCase.steps));
      });
      return nextPositions;
    });
    setComponents((current) => {
      const nextMap = new Map(current.map((component) => [component.id, component]));
      draftCases.forEach((testCase) => {
        (testCase.components || []).forEach((component) => nextMap.set(component.id, component));
      });
      return Array.from(nextMap.values());
    });
    setSelectedCaseFolderId(folderId);
    setSelectedCaseLibraryId(getFolderLibraryId(caseLibraryFolders.find((folder) => folder.id === folderId)));
    setCaseLibraryViewMode('folder');
    setSelectedCaseId(draftCases[0].id);
    setSelectedStepId(draftCases[0].steps[0]?.id || '');
    setConfigDraft(JSON.stringify(draftCases[0].steps[0]?.config || {}, null, 2));
  };

  const applyPendingAssistantDraft = () => {
    if (!pendingAssistantDraft?.draftCases.length) {
      return;
    }

    const folderId = selectedCaseFolderId || DEFAULT_CASE_FOLDER_ID;
    addDraftCasesToFolder(pendingAssistantDraft.draftCases, folderId);
    setPendingAssistantDraft(null);
    setRunMessage(`已应用 ${pendingAssistantDraft.draftCases.length} 个对话生成用例草稿`);
    setActiveTab('automation-cases');
  };


  const commitInlineEditingName = () => {
    if (!editingName) {
      return;
    }

    const nextName = editingName.value.trim();
    if (!nextName) {
      setEditingName(null);
      return;
    }

    if (editingName.type === 'library') {
      setCaseLibraries((current) => {
        let updated = false;
        const next = current.map((library) => {
          if (library.id !== editingName.id) {
            return library;
          }

          updated = true;
          return { ...library, name: nextName };
        });

        if (updated) {
          return next;
        }

        return [
          ...next,
          {
            ...(normalizedCaseLibraries.find((library) => library.id === editingName.id) || createDefaultCaseLibraries()[0]),
            id: editingName.id,
            name: nextName,
          },
        ];
      });
    } else if (editingName.type === 'folder') {
      setCaseFolders((current) => current.map((folder) => (
        folder.id === editingName.id ? { ...folder, name: nextName } : folder
      )));
    } else if (editingName.type === 'case') {
      setCases((current) => current.map((testCase) => (
        testCase.id === editingName.id ? { ...testCase, name: nextName } : testCase
      )));
    }

    setEditingName(null);
  };

  const submitNameDialog = () => {
    if (!nameDialog) {
      return;
    }

    const nextName = nameDialog.value.trim();

    if (!nextName) {
      return;
    }

    if (nameDialog.mode === 'create-folder') {
      const folder: CaseFolder = {
        id: `case-folder-${Date.now()}`,
        name: nextName,
        libraryId: selectedCaseLibraryId || DEFAULT_CASE_LIBRARY_ID,
        parentId: pendingNewFolderParentId,
        expanded: true,
      };

      setCaseFolders((current) => [
        ...current.map((item) => (
          item.id === pendingNewFolderParentId ? { ...item, expanded: true } : item
        )),
        folder,
      ]);
      setSelectedCaseFolderId(folder.id);
      setCaseLibraryViewMode('folder');
    } else if (nameDialog.mode === 'create-library') {
      const libraryId = `case-library-${Date.now()}`;
      const folderId = `case-folder-${Date.now()}`;

      setCaseLibraries((current) => [...current, {
        id: libraryId,
        name: nextName,
        expanded: true,
      }]);
      setCaseFolders((current) => [...current, {
        id: folderId,
        name: '默认文件夹',
        libraryId,
        expanded: true,
      }]);
      setSelectedCaseLibraryId(libraryId);
      setSelectedCaseFolderId(folderId);
    } else if (nameDialog.mode === 'rename-folder') {
      setCaseFolders((current) => current.map((folder) => (
        folder.id === nameDialog.folderId ? { ...folder, name: nextName } : folder
      )));
    } else if (nameDialog.mode === 'rename-case') {
      setCases((current) => current.map((testCase) => (
        testCase.id === nameDialog.caseId ? { ...testCase, name: nextName } : testCase
      )));
    }

    setNameDialog(null);
    setPendingNewFolderParentId(undefined);
  };

  const importCasesToFolder = async (file: File, folderId: string) => {
    try {
      const content = await readFileAsText(file);
      const importedCases = parseAutomationCaseList(content, file.name).map((testCase) => ({
        ...testCase,
        folderId,
      }));

      if (importedCases.length === 0) {
        throw new Error('文件中没有可导入的用例');
      }

      setCases((current) => {
        const nextMap = new Map(current.map((testCase) => [testCase.id, testCase]));
        importedCases.forEach((testCase) => nextMap.set(testCase.id, testCase));
        return Array.from(nextMap.values());
      });
      setCaseEdges((current) => {
        const nextEdges = { ...current };
        importedCases.forEach((testCase) => {
          nextEdges[testCase.id] = ensureBoundaryEdges(testCase, current[testCase.id] || []);
        });
        return nextEdges;
      });
      setNodePositions((current) => {
        const nextPositions = { ...current };
        importedCases.forEach((testCase) => {
          nextPositions[testCase.id] = migrateCaseNodePositions(testCase, current[testCase.id], stepsToEdges(testCase.steps));
        });
        return nextPositions;
      });
      setComponents((current) => {
        const nextMap = new Map(current.map((component) => [component.id, component]));
        importedCases.forEach((testCase) => {
          (testCase.components || []).forEach((component) => nextMap.set(component.id, component));
        });
        return Array.from(nextMap.values());
      });
      setSelectedCaseFolderId(folderId);
      setSelectedCaseLibraryId(getFolderLibraryId(caseLibraryFolders.find((folder) => folder.id === folderId)));
      setSelectedCaseId(importedCases[0].id);
      setSelectedStepId(importedCases[0].steps[0]?.id || '');
      setConfigDraft(JSON.stringify(importedCases[0].steps[0]?.config || {}, null, 2));
      setRunMessage(`已导入 ${importedCases.length} 个用例`);
    } catch (error) {
      setRunMessage(`导入失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      if (caseLibraryImportInputRef.current) {
        caseLibraryImportInputRef.current.value = '';
      }
    }
  };

  const toggleCaseFolder = (folderId: string) => {
    setCaseFolders((current) => current.map((folder) => (
      folder.id === folderId ? { ...folder, expanded: folder.expanded === false } : folder
    )));
  };

  const canonicalizeCaseForExport = (testCase: AutomationCase) => {
    const embeddedEdges = (testCase as AutomationCase & { edges?: Edge[] }).edges || [];
    const canonicalEdges = caseEdges[testCase.id];
    // Resolve this case independently of the selected case. Local snapshots are
    // authoritative, including intentionally empty command templates.
    const exportComponents = new Map([
      ...legacyDefaultComponents,
      ...templateComponents,
    ].map((component) => [component.id, component] as const));
    [...components, ...(testCase.components || [])].forEach((component) => {
      exportComponents.set(component.id, mergeWorkflowComponent(exportComponents.get(component.id), component));
    });
    return {
      ...testCase,
      components: Array.from(exportComponents.values()),
      edges: ensureBoundaryEdges(testCase, canonicalEdges?.length ? canonicalEdges : (embeddedEdges.length ? embeddedEdges : stepsToEdges(testCase.steps))),
    };
  };

  // Keep the protocol-level single-case export available to non-toolbar callers.
  // The FLOW header intentionally no longer exposes JSON/YAML shortcut buttons.
  const exportCase = (format: 'json' | 'yaml') => {
    const exportPayload = canonicalizeCaseForExport(selectedCase);
    const content = format === 'json' ? automationCaseToJson(exportPayload) : automationCaseToYaml(exportPayload);
    const suffix = format === 'json' ? 'json' : 'yaml';
    const mimeType = format === 'json' ? 'application/json' : 'text/yaml';
    downloadTextFile(`${selectedCase.id}.${suffix}`, content, mimeType);
  };
  void exportCase;

  const mergeRemoteWorkspace = (payload: unknown) => {
    const source = payload as Partial<StoredWorkflowEditorState> | AutomationCase | AutomationCase[];
    const nextCasesSource: AutomationCase[] = Array.isArray(source)
      ? source
      : Array.isArray((source as Partial<StoredWorkflowEditorState>).cases)
        ? (source as Partial<StoredWorkflowEditorState>).cases || []
        : source && typeof source === 'object' && (source as AutomationCase).schemaVersion === 'glassbox.workflow.v1'
          ? [source as AutomationCase]
          : [];

    const nextCases = nextCasesSource.map((item) => normalizeCase(item));

    if (nextCases.length === 0) {
      throw new Error('远程数据里没有可用的用例');
    }

    setCases((current) => {
      const nextMap = new Map(current.map((testCase) => [testCase.id, testCase]));
      nextCases.forEach((testCase) => nextMap.set(testCase.id, testCase));
      return Array.from(nextMap.values());
    });

    if (!Array.isArray(source) && source && typeof source === 'object') {
      const workspace = source as Partial<StoredWorkflowEditorState>;

      if (Array.isArray(workspace.components) && workspace.components.length > 0) {
        setComponents((current) => {
          const nextMap = new Map(current.map((component) => [component.id, component]));
          workspace.components!.forEach((component) => nextMap.set(component.id, component));
          return Array.from(nextMap.values());
        });
      }

      if (workspace.caseEdges) {
        setCaseEdges((current) => ({
          ...current,
          ...workspace.caseEdges,
        }));
      }

      if (workspace.nodePositions) {
        setNodePositions((current) => ({
          ...current,
          ...(workspace.nodePositions as CaseNodePositions),
        }));
      }
    }

    setCaseEdges((current) => {
      const next = { ...current };
      nextCases.forEach((testCase) => {
        next[testCase.id] = next[testCase.id] || stepsToEdges(testCase.steps);
      });
      return next;
    });
    setSelectedCaseId(nextCases[0].id);
    setRunMessage(`已从远程拉取 ${nextCases.length} 个用例`);
  };
  void mergeRemoteWorkspace;

  const mergeCaseLibraryFiles = async (result: PullCaseLibraryResult) => {
    const files = result.files || [];
    const manifest = result.manifest || {};
    const repoId = result.repoId || 'remote';
    const fallbackLibraryId = `remote-library-${repoId}`;
    const libraryId = result.targetLibraryId || fallbackLibraryId;
    const libraryName = manifest.name || '云端用例库';
    const repoUrl = result.repoUrl || remoteCasesUrl.trim();
    const configuredBranch = result.gitInfo?.branch || 'master';
    const folderMap = new Map<string, CaseFolder>();
    const importedCases: AutomationCase[] = [];
    const importedComponents: TestComponent[] = [];
    const importedCaseEdges: Record<string, Edge[]> = {};
    const importedNodePositions: Record<string, NodePositions> = {};
    const parseErrors: string[] = [];

    const mergeWorkspace = (parsed: CaseLibraryWorkspace, relativePath: string) => {
      try {
        if (Array.isArray(parsed.components)) {
          importedComponents.push(...parsed.components);
        }

        if (Array.isArray(parsed.folders)) {
          parsed.folders.forEach((folder) => {
            folderMap.set(folder.id, {
              ...folder,
              libraryId,
              expanded: folder.expanded !== false,
            });
          });
        }

        parsed.cases.forEach((testCase) => {
          // Bind workspace definitions to each case before touching shared state.
          // Case snapshots always win over same-id library definitions.
          const caseComponentMap = new Map((parsed.components || []).map((component) => [component.id, component]));
          (testCase.components || []).forEach((component) => {
            caseComponentMap.set(component.id, mergeWorkflowComponent(caseComponentMap.get(component.id), component));
          });
          const normalizedCase = normalizeStoredCase(normalizeCase({
            ...testCase,
            components: Array.from(caseComponentMap.values()),
            schemaVersion: testCase.schemaVersion || 'glassbox.workflow.v1',
          }));
          const folderId = getCaseFolderId(normalizedCase);

          if (!folderMap.has(folderId)) {
            folderMap.set(folderId, {
              id: folderId,
              name: parsed.name || '云端用例',
              libraryId,
              expanded: true,
            });
          }

          importedCases.push({
            ...normalizedCase,
            folderId,
          });
        });
        if (parsed.caseEdges && typeof parsed.caseEdges === 'object') {
          Object.entries(parsed.caseEdges).forEach(([caseId, edges]) => {
            if (Array.isArray(edges)) {
              importedCaseEdges[caseId] = edges;
            }
          });
        }
        if (parsed.nodePositions && typeof parsed.nodePositions === 'object') {
          Object.entries(parsed.nodePositions).forEach(([caseId, positions]) => {
            if (positions && typeof positions === 'object') {
              importedNodePositions[caseId] = positions as NodePositions;
            }
          });
        }
      } catch (error) {
        parseErrors.push(`${relativePath}: workspace 内容无效：${error instanceof Error ? error.message : String(error)}`);
      }
    };

    files.forEach((file) => {
      if (/^manifest\.json$/i.test(file.relativePath)) {
        return;
      }

      if (
        result.workspace
        && result.workspaceFile
        && file.relativePath.replace(/\\/g, '/') === result.workspaceFile.replace(/\\/g, '/')
      ) {
        mergeWorkspace(result.workspace, file.relativePath);
        return;
      }

      let parsedJson: {
        schemaVersion?: string;
        name?: string;
        folders?: CaseFolder[];
        cases?: AutomationCase[];
        components?: TestComponent[];
        caseEdges?: Record<string, Edge[]>;
        nodePositions?: CaseNodePositions;
      } | null = null;
      try {
        parsedJson = JSON.parse(file.content);
      } catch (_error) {
        // Non-JSON or legacy case file, continue with the path-based parser below.
      }
      if (
        parsedJson?.schemaVersion === 'glassbox.case-library.workspace.v1'
        && Array.isArray(parsedJson.cases)
      ) {
        mergeWorkspace(parsedJson as CaseLibraryWorkspace, file.relativePath);
        return;
      }

      try {
        const relativeDir = getRemoteCaseRelativeDir(file, manifest);
        const folderId = createRemoteFolderId(repoId, relativeDir);
        const folderName = relativeDir === '根目录' ? '根目录' : relativeDir;

        if (!folderMap.has(folderId)) {
          folderMap.set(folderId, {
            id: folderId,
            name: folderName,
            libraryId,
            expanded: true,
          });
        }

        parseAutomationCaseList(file.content, file.name).forEach((testCase) => {
          importedCases.push({
            ...testCase,
            folderId,
          });
        });
      } catch (error) {
        parseErrors.push(`${file.relativePath}: ${error instanceof Error ? error.message : String(error)}`);
      }
    });

    if (result.strictLocalReload && parseErrors.length > 0) {
      throw new Error(`本地用例解析失败，未更新当前编辑器：${parseErrors.join('；')}`);
    }
    if (result.strictLocalReload && importedCases.length === 0) {
      throw new Error('本地用例库没有解析出任何用例，未更新当前编辑器');
    }

    // Check durable edits in the main process, including edits saved by CLI or
    // before a restart. An editor 'clean' flag does not mean Git is in sync.
    const beforeApply = liveCaseStateRef.current;
    if (electronApi?.ipcRenderer) {
      const checked = await electronApi.ipcRenderer.invoke('case-library:check-apply', {
        libraryId, cases: importedCases, caseEdges: importedCaseEdges, components: importedComponents,
        source: result.source || 'pull',
      }) as { success: boolean; error?: string; errorCode?: string };
      if (!checked.success) throw Object.assign(new Error(checked.error || '已保存用例与用例库内容冲突，未覆盖'), { code: checked.errorCode });
      if (beforeApply.cases !== liveCaseStateRef.current.cases || beforeApply.caseEdges !== liveCaseStateRef.current.caseEdges) {
        throw new Error('检查期间用例已被编辑或由CLI更新，已保留新版本，请重新刷新比较');
      }
    }

    const currentLibraryFolderIds = new Set(caseFolders
      .filter((folder) => getFolderLibraryId(folder) === libraryId || folder.libraryId === fallbackLibraryId)
      .map((folder) => folder.id));
    const currentLibraryCaseIds = new Set(cases
      .filter((testCase) => currentLibraryFolderIds.has(getCaseFolderId(testCase)))
      .map((testCase) => testCase.id));
    const previousLibraryComponentIds = new Set(
      caseLibraries.find((library) => library.id === libraryId)?.localComponentIds || []
    );
    const importedComponentIds = new Set(importedComponents.map((component) => component.id));
    const componentIdsUsedOutsideLibrary = new Set(cases
      .filter((testCase) => !currentLibraryCaseIds.has(testCase.id))
      .flatMap((testCase) => [
        ...testCase.steps.map((step) => step.componentId).filter(Boolean),
        ...(testCase.components || []).map((component) => component.id),
      ]));
    const selectedCaseWasInLibrary = currentLibraryCaseIds.has(selectedCaseId);
    const importedSelectedCase = importedCases.find((testCase) => testCase.id === selectedCaseId);
    const selectedFolderWasInLibrary = currentLibraryFolderIds.has(selectedCaseFolderId);
    const importedSelectedFolder = folderMap.get(selectedCaseFolderId);
    const preserveSelectionOutsideLibrary = Boolean(
      result.preserveSelection && selectedCaseId && !selectedCaseWasInLibrary
    );
    const nextSelectedCase = result.preserveSelection && (!selectedCaseWasInLibrary || importedSelectedCase)
      ? importedSelectedCase || cases.find((testCase) => testCase.id === selectedCaseId)
      : importedCases[0];

    setCaseLibraries((current) => {
      const repoPeer = current.find((library) => (
        library.id !== libraryId
        && repoUrl
        && (library.repoUrl || '').trim() === repoUrl
        && getConfiguredGitBranch(library) === configuredBranch
      ));
      const nextMap = new Map(current
        .filter((library) => (
          library.id === libraryId
          || !repoUrl
          || getCaseLibraryGitKey(library.repoUrl || '', getConfiguredGitBranch(library)) !== getCaseLibraryGitKey(repoUrl, configuredBranch)
        ))
        .map((library) => [library.id, library]));
      const existing = nextMap.get(libraryId);
      nextMap.set(libraryId, {
        id: libraryId,
        name: libraryName,
        repoUrl,
        authUsername: existing?.authUsername || repoPeer?.authUsername,
        authToken: existing?.authToken || repoPeer?.authToken,
        sshKeyPath: existing?.sshKeyPath || repoPeer?.sshKeyPath,
        sshPassphrase: existing?.sshPassphrase || repoPeer?.sshPassphrase,
        gitBranch: existing?.gitBranch || repoPeer?.gitBranch || configuredBranch,
        autoUpdate: existing?.autoUpdate || repoPeer?.autoUpdate || false,
        expanded: existing?.expanded !== false,
        branch: result.gitInfo?.branch,
        lastUpdatedAt: result.gitInfo?.lastUpdatedAt,
        lastUpdatedBy: result.gitInfo?.lastUpdatedBy,
        lastUpdatedEmail: result.gitInfo?.lastUpdatedEmail,
        lastCommitMessage: result.gitInfo?.lastCommitMessage,
        localRevision: result.revision || existing?.localRevision,
        localRepoPath: result.repoPath || existing?.localRepoPath,
        localComponentIds: importedComponents.map((component) => component.id),
      });
      return Array.from(nextMap.values());
    });
    setCaseFolders((current) => {
      const currentLibraryFolderIds = new Set(current
        .filter((folder) => getFolderLibraryId(folder) === libraryId || folder.libraryId === fallbackLibraryId)
        .map((folder) => folder.id));
      const nextMap = new Map(current
        .filter((folder) => !currentLibraryFolderIds.has(folder.id))
        .map((folder) => [folder.id, folder]));
      folderMap.forEach((folder) => nextMap.set(folder.id, folder));
      return Array.from(nextMap.values());
    });
    setCases((current) => {
      const nextMap = new Map(current
        .filter((testCase) => !currentLibraryFolderIds.has(getCaseFolderId(testCase)))
        .map((testCase) => [testCase.id, testCase]));
      importedCases.forEach((testCase) => nextMap.set(testCase.id, testCase));
      return Array.from(nextMap.values());
    });
    setCaseEdges((current) => {
      const nextEdges = { ...current };
      currentLibraryCaseIds.forEach((caseId) => {
        delete nextEdges[caseId];
      });
      importedCases.forEach((testCase) => {
        nextEdges[testCase.id] = ensureBoundaryEdges(testCase, importedCaseEdges[testCase.id] ?? (testCase as AutomationCase & { edges?: Edge[] }).edges ?? stepsToEdges(testCase.steps));
      });
      return nextEdges;
    });
    setNodePositions((current) => {
      const nextPositions = { ...current };
      currentLibraryCaseIds.forEach((caseId) => {
        delete nextPositions[caseId];
      });
      importedCases.forEach((testCase) => {
        const importedEdges = importedCaseEdges[testCase.id] ?? (testCase as AutomationCase & { edges?: Edge[] }).edges ?? stepsToEdges(testCase.steps);
        nextPositions[testCase.id] = migrateCaseNodePositions(testCase, importedNodePositions[testCase.id], importedEdges);
      });
      return nextPositions;
    });
    setComponents((current) => {
      const nextMap = new Map(current
        .filter((component) => (
          !previousLibraryComponentIds.has(component.id)
          || importedComponentIds.has(component.id)
          || componentIdsUsedOutsideLibrary.has(component.id)
        ))
        .map((component) => [component.id, component]));
      importedComponents.forEach((component) => {
        // Existing shared definitions may belong to another library. Imported
        // cases carry their own definitions and never rewrite that library.
        if (!nextMap.has(component.id)) nextMap.set(component.id, component);
      });
      return Array.from(nextMap.values());
    });

    if (!preserveSelectionOutsideLibrary) {
      const firstFolderId = nextSelectedCase?.folderId || importedCases[0]?.folderId || Array.from(folderMap.values())[0]?.id || '';
      setSelectedCaseLibraryId(libraryId);
      setSelectedCaseFolderId(
        result.preserveSelection && selectedFolderWasInLibrary && importedSelectedFolder
          ? importedSelectedFolder.id
          : firstFolderId
      );
      setCaseLibraryViewMode(
        result.preserveSelection && selectedFolderWasInLibrary && importedSelectedFolder
          ? caseLibraryViewMode
          : 'library'
      );

      if (nextSelectedCase) {
        setSelectedCaseId(nextSelectedCase.id);
        const nextSelectedStep = nextSelectedCase.steps.find((step) => step.id === selectedStepId)
          || nextSelectedCase.steps[0];
        setSelectedStepId(nextSelectedStep?.id || '');
        setConfigDraft(JSON.stringify(nextSelectedStep?.config || {}, null, 2));
      } else {
        setSelectedCaseId('');
        setSelectedStepId('');
        setConfigDraft('{}');
      }
    }

    const sourceLabel = result.source === 'local' ? '本地刷新' : '云端拉取';
    const revisionLabel = result.revision ? `，revision ${result.revision.slice(0, 12)}` : '';
    setCaseLibraryStatus(`已从「${libraryName}」${sourceLabel} ${importedCases.length} 个用例${revisionLabel}${parseErrors.length ? `，${parseErrors.length} 个文件跳过` : ''}`);
    setRunMessage(`已${sourceLabel} ${importedCases.length} 个用例${revisionLabel}`);
  };

  mergeCaseLibraryFilesRef.current = mergeCaseLibraryFiles;

  const applyLocalCaseLibraryChange = async (change: LocalCaseLibraryChangeEvent) => {
    if (!change.result?.success) {
      return false;
    }
    try {
      caseLibraryRefreshApplyingRef.current = true;
      caseLibraryPersistenceUrgentRef.current = true;
      await mergeCaseLibraryFilesRef.current({
        ...change.result,
        targetLibraryId: change.libraryId,
        source: 'local',
        strictLocalReload: true,
        preserveSelection: true,
      });
      setPendingLocalCaseLibraryChange(null);
      return true;
    } catch (error) {
      caseLibraryRefreshApplyingRef.current = false;
      setPendingLocalCaseLibraryChange({
        ...change,
        type: 'library-error',
        errorCode: (error as { code?: string })?.code || 'CASE_LIBRARY_LOCAL_APPLY_FAILED',
        error: error instanceof Error ? error.message : String(error),
        recoveryActions: [
          '当前编辑器状态已保留，请修复本地文件后等待再次自动读取。',
          '也可点击“刷新用例”手动重试。',
        ],
      });
      return false;
    }
  };

  useEffect(() => {
    if (!electronApi?.ipcRenderer) {
      return undefined;
    }
    const handleLocalCaseLibraryChange = (_event: unknown, payload: LocalCaseLibraryChangeEvent) => {
      if (!payload?.libraryId) {
        return;
      }
      if (payload.type !== 'library-changed' || !payload.result?.success) {
        setPendingLocalCaseLibraryChange((current) => {
          const currentKey = `${current?.libraryId || ''}:${current?.type || ''}:${current?.errorCode || ''}:${current?.error || ''}`;
          const nextKey = `${payload.libraryId}:${payload.type}:${payload.errorCode || ''}:${payload.error || ''}`;
          return currentKey === nextKey ? current : payload;
        });
        return;
      }
      if (caseLibraryEditorDirtyRef.current) {
        setPendingLocalCaseLibraryChange((current) => (
          current?.libraryId === payload.libraryId && current?.revision === payload.revision
            ? current
            : payload
        ));
        return;
      }
      void applyLocalCaseLibraryChange(payload);
    };
    electronApi.ipcRenderer.on('case-library:local-changed', handleLocalCaseLibraryChange);
    return () => {
      electronApi.ipcRenderer.removeListener('case-library:local-changed', handleLocalCaseLibraryChange);
    };
  }, [electronApi]);

  const confirmPendingLocalCaseLibraryChange = () => {
    const pending = pendingLocalCaseLibraryChange;
    if (!pending || pending.libraryId !== selectedCaseLibraryId) return;
    const library = caseLibrariesRef.current.find((item) => item.id === pending.libraryId);
    if (!library) return;
    if (pending.type !== 'library-changed' || !pending.result?.success) {
      void refreshSelectedCaseLibrary({ library });
      return;
    }
    if (caseLibraryEditorDirtyRef.current) {
      const confirmed = window.confirm(
        '当前用例存在本地修改，是否检查用例库更新？有冲突时会保留当前版本。'
      );
      if (!confirmed) {
        return;
      }
    }
    void applyLocalCaseLibraryChange(pending);
  };

  const refreshSelectedCaseLibrary = async (options: {
    library?: CaseLibrary;
    trigger?: 'manual' | 'navigation';
  } = {}) => {
    const trigger = options.trigger || 'manual';
    const isNavigationRefresh = trigger === 'navigation';
    const library = options.library || selectedCaseLibrary;
    if (!library) {
      if (!isNavigationRefresh) setRunMessage('刷新失败：未选择用例库');
      return;
    }
    if (!String(library.repoUrl || '').trim()) {
      if (!isNavigationRefresh) setRunMessage('刷新失败：当前用例库未配置本地 Git 仓库地址');
      return;
    }
    if (!electronApi?.ipcRenderer) {
      if (!isNavigationRefresh) setRunMessage('刷新失败：当前环境无法读取本地用例库');
      return;
    }
    if (caseLibraryRefreshInFlightRef.current.has(library.id)) {
      return;
    }

    caseLibraryRefreshInFlightRef.current.add(library.id);
    setIsRefreshingCaseLibrary(true);
    if (!isNavigationRefresh) {
      setRunMessage('正在读取本地用例库，不会执行 Git pull/push...');
    }
    try {
      const result = await electronApi.ipcRenderer.invoke('case-library:reload-local', {
        libraryId: library.id,
        repoUrl: library.repoUrl,
        branch: getConfiguredGitBranch(library),
      }) as PullCaseLibraryResult;
      if (!result.success) {
        {
          setPendingLocalCaseLibraryChange({
            schemaVersion: 'glassbox.case-library.local-change-event.v1',
            type: 'library-error',
            libraryId: library.id,
            libraryName: library.name,
            detectedAt: new Date().toISOString(),
            result,
            errorCode: result.errorCode || 'CASE_LIBRARY_LOCAL_RELOAD_FAILED',
            error: result.error || '本地用例刷新失败',
            recoveryActions: result.recoveryActions || [
              '当前编辑器状态已保留，请修复本地文件后重新进入用例列表。',
              '也可点击“刷新用例”手动重试。',
            ],
          });
        }
        throw new Error(result.error || '本地用例刷新失败');
      }
      const latestLibrary = caseLibrariesRef.current.find((item) => item.id === library.id);
      if (result.revision && result.revision === latestLibrary?.localRevision) {
        setPendingLocalCaseLibraryChange((current) => current?.libraryId === library.id ? null : current);
        if (!isNavigationRefresh) {
          setRunMessage(`当前用例库已是最新 revision ${result.revision.slice(0, 12)}`);
        }
        return;
      }
      if (isNavigationRefresh && selectedCaseLibraryIdRef.current !== library.id) {
        return;
      }
      if (isNavigationRefresh && caseLibraryEditorDirtyRef.current) {
        setRunMessage('已保留当前用例修改；本地文件更新需比较后再同步');
        return;
      }
      if (caseLibraryEditorDirtyRef.current) {
        const confirmed = window.confirm(
          '检测到用例库更新及本地修改，是否比较更新？有冲突时会保留当前版本。'
        );
        if (!confirmed) {
          setPendingLocalCaseLibraryChange({
            schemaVersion: 'glassbox.case-library.local-change-event.v1',
            type: 'library-changed',
            libraryId: library.id,
            libraryName: library.name,
            revision: result.revision,
            previousRevision: latestLibrary?.localRevision,
            detectedAt: new Date().toISOString(),
            result,
          });
          setRunMessage('已保留本地修改；可稍后点击“刷新用例”比较更新');
          return;
        }
      }
      caseLibraryRefreshApplyingRef.current = true;
      caseLibraryPersistenceUrgentRef.current = true;
      await mergeCaseLibraryFiles({
        ...result,
        repoUrl: library.repoUrl,
        targetLibraryId: library.id,
        source: 'local',
        strictLocalReload: true,
        preserveSelection: true,
      });
      setPendingLocalCaseLibraryChange((current) => current?.libraryId === library.id ? null : current);
      if (workflowStateSaveTimerRef.current) {
        window.clearTimeout(workflowStateSaveTimerRef.current);
        workflowStateSaveTimerRef.current = null;
      }
    } catch (error) {
      caseLibraryRefreshApplyingRef.current = false;
      setRunMessage(`刷新失败，当前状态未改变：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      caseLibraryRefreshInFlightRef.current.delete(library.id);
      setIsRefreshingCaseLibrary(false);
    }
  };

  useEffect(() => {
    if (activeTab !== 'automation-cases') {
      caseLibraryNavigationRefreshKeyRef.current = '';
      return;
    }
    if (!workflowStateHydratedRef.current || !selectedCaseLibrary) {
      return;
    }
    const navigationKey = [
      activeTab,
      caseLibraryViewMode,
      selectedCaseLibrary.id,
      caseLibraryViewMode === 'folder' ? selectedCaseFolderId : '',
    ].join(':');
    if (caseLibraryNavigationRefreshKeyRef.current === navigationKey) {
      return;
    }
    caseLibraryNavigationRefreshKeyRef.current = navigationKey;
    void refreshSelectedCaseLibrary({
      library: selectedCaseLibrary,
      trigger: 'navigation',
    });
  }, [activeTab, caseLibraryViewMode, selectedCaseFolderId, selectedCaseLibrary?.id]);

  const pullRemoteCases = async (library?: CaseLibrary) => {
    const repoUrl = (library ? library.repoUrl || '' : remoteCasesUrl).trim();
    const branch = getConfiguredGitBranch(library);

    if (!repoUrl) {
      warnMissingLibraryGit(library);
      return false;
    }

    const duplicateLibrary = findDuplicateGitLibrary(library?.id || selectedCaseLibrary?.id || DEFAULT_CASE_LIBRARY_ID, repoUrl, branch);
    if (duplicateLibrary) {
      const message = `已存在相同 Git 地址和分支的库「${duplicateLibrary.name}」（${branch}），请先使用已有库或修改分支。`;
      setCaseLibraryStatus(message);
      setGitConfigError(message);
      return false;
    }

    if (!electronApi?.ipcRenderer) {
      setCaseLibraryStatus('当前环境无法执行 Git 拉取');
      return false;
    }

    setIsPullingCaseLibrary(true);
    setCaseLibraryStatus('正在检测 Git LFS...');

    try {
      const lfsResult = await electronApi.ipcRenderer.invoke('case-library:check-git-lfs') as {
        installed?: boolean;
        source?: string;
        version?: string;
        error?: string;
      };

      if (!lfsResult?.installed) {
        if (lfsResult?.source === 'bundled') throw new Error(lfsResult.error || '内置 Git LFS 不可用，请修复或重新安装 solopi-desktop');
        setIsGitLfsGuideOpen(true);
        setCaseLibraryStatus('当前电脑未安装 Git LFS，安装后可继续拉取包含音频/图片的用例库');
        return false;
      }

      setCaseLibraryStatus('正在拉取云端用例库...');

      const result = await electronApi.ipcRenderer.invoke('case-library:pull-git-repo', {
        repoUrl,
        branch,
        authUsername: library?.authUsername,
        authToken: library?.authToken,
        sshKeyPath: library?.sshKeyPath,
        sshPassphrase: library?.sshPassphrase,
      }) as PullCaseLibraryResult;

      if (result.needsGitLfs) {
        setIsGitLfsGuideOpen(true);
        setCaseLibraryStatus('当前电脑未安装 Git LFS，安装后可继续拉取包含音频/图片的用例库');
        return false;
      }

      if (!result.success) {
        throw new Error(result.error || '拉取失败');
      }

      await mergeCaseLibraryFiles({ ...result, repoUrl, targetLibraryId: library?.id });
      return true;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      setCaseLibraryStatus(`云端用例库拉取失败：${errorMessage}`);
      if (/auth|authentication|credential|permission|403|401|denied|passphrase|publickey|could not read from remote repository|鉴权|权限|私钥|密码/i.test(errorMessage)) {
        const targetLibrary = library || selectedCaseLibrary;
        setGitConfigDialog({
          libraryId: targetLibrary?.id || DEFAULT_CASE_LIBRARY_ID,
          value: repoUrl,
          authUsername: targetLibrary?.authUsername || '',
          authToken: targetLibrary?.authToken || '',
          sshKeyPath: targetLibrary?.sshKeyPath || '',
          sshPassphrase: targetLibrary?.sshPassphrase || '',
          branch: getConfiguredGitBranch(targetLibrary),
          intent: 'pull',
        });
        setGitConfigError(errorMessage);
      }
      return false;
    } finally {
      setIsPullingCaseLibrary(false);
    }
  };

  const pushCaseLibrary = async (library: CaseLibrary) => {
    if (!electronApi?.ipcRenderer) {
      setCaseLibraryStatus('当前环境无法执行 Git 上传');
      return false;
    }

    const repoUrl = (library.repoUrl || '').trim();
    const branch = getConfiguredGitBranch(library);
    if (!repoUrl) {
      warnMissingLibraryGit(library);
      return false;
    }

    const duplicateLibrary = findDuplicateGitLibrary(library.id, repoUrl, branch);
    if (duplicateLibrary) {
      const message = `已存在相同 Git 地址和分支的库「${duplicateLibrary.name}」（${branch}），请先使用已有库或修改分支。`;
      setCaseLibraryStatus(message);
      setGitConfigError(message);
      return false;
    }

    const libraryFolders = foldersByLibrary.get(library.id) || [];
    const folderIds = new Set(libraryFolders.map((folder) => folder.id));
    const libraryCases = cases.filter((testCase) => folderIds.has(getCaseFolderId(testCase)));
    const canonicalLibraryCases = libraryCases.map(canonicalizeCaseForExport);
    const referencedComponentIds = new Set(
      canonicalLibraryCases.flatMap((testCase) => testCase.steps.map((step) => step.componentId).filter(Boolean) as string[])
    );
    const libraryComponentMap = new Map<string, TestComponent>();

    const collectLibraryComponent = (component?: TestComponent) => {
      if (!component || defaultComponentIds.has(component.id)) {
        return;
      }

      libraryComponentMap.set(component.id, component);
    };

    allWorkflowComponents.forEach((component) => {
      if (referencedComponentIds.has(component.id)) {
        collectLibraryComponent(component);
      }
    });
    canonicalLibraryCases.forEach((testCase) => {
      (testCase.components || []).forEach(collectLibraryComponent);
    });
    const libraryCaseEdges = Object.fromEntries(canonicalLibraryCases.map((testCase) => [testCase.id, testCase.edges || []]));

    setCaseLibraryStatus(`正在上传「${library.name}」到云端（${libraryFolders.length} 个文件夹 / ${libraryCases.length} 个用例）...`);

    const result = await electronApi.ipcRenderer.invoke('case-library:push-git-repo', {
      repoUrl,
      branch,
      authUsername: library.authUsername,
      authToken: library.authToken,
      sshKeyPath: library.sshKeyPath,
      sshPassphrase: library.sshPassphrase,
      libraryName: library.name,
      libraryId: library.id,
      sourceCases: libraryCases,
      sourceComponents: components,
      sourceCaseEdges: caseEdges,
      cases: canonicalLibraryCases,
      folders: libraryFolders,
      components: Array.from(libraryComponentMap.values()),
      caseEdges: libraryCaseEdges,
      nodePositions: Object.fromEntries(canonicalLibraryCases.map((testCase) => [
        testCase.id,
        getCaseNodePositions(testCase, testCase.id === selectedCase.id ? nodes : []),
      ])),
    }) as {
      success: boolean;
      uploadSync?: { cases: Array<AutomationCase & { edges?: Edge[] }>; synchronizedCaseIds: string[]; skippedCaseIds: string[]; warning?: string };
      message?: string;
      gitInfo?: Partial<CaseLibrary>;
      folderCount?: number;
      caseCount?: number;
      workspaceFile?: string;
      error?: string;
    };

    if (!result.success) {
      setCaseLibraryStatus(`上传失败：${result.error || '未知错误'}`);
      if (/auth|authentication|credential|permission|403|401|denied|passphrase|publickey|could not read from remote repository|鉴权|权限|私钥|密码/i.test(result.error || '')) {
        setGitConfigDialog({
          libraryId: library.id,
          value: repoUrl,
          authUsername: library.authUsername || '',
          authToken: library.authToken || '',
          sshKeyPath: library.sshKeyPath || '',
          sshPassphrase: library.sshPassphrase || '',
          branch,
          intent: 'push',
        });
        setGitConfigError(result.error || '请检查 Git 鉴权信息');
      }
      return false;
    }

    // Updating the editor is conditional too: edits can still be unsaved while Git is running.
    const live = liveCaseStateRef.current;
    const uploadSync = result.uploadSync;
    let keptNewEdits = Boolean(uploadSync?.skippedCaseIds.length);
    if (uploadSync?.cases.length) {
      const originals = new Map(libraryCases.map(c => [c.id, c]));
      const accepted = new Map(uploadSync.cases.map(c => [c.id, c]));
      const sourceStillCurrent = live.components === components && live.caseEdges === caseEdges;
      const applicable = new Set(live.cases.filter(c => accepted.has(c.id) && sourceStillCurrent && c === originals.get(c.id)).map(c => c.id));
      keptNewEdits ||= applicable.size !== accepted.size;
      setCases(current => current.map(c => applicable.has(c.id) && c === originals.get(c.id) ? accepted.get(c.id)! : c));
      setCaseEdges(current => {
        if (current !== caseEdges) return current;
        const next = { ...current };
        for (const id of applicable) {
          const edges = accepted.get(id)?.edges;
          if (edges) next[id] = edges;
        }
        return next;
      });
    }
    if (result.gitInfo) {
      setCaseLibraries((current) => current.map((item) => (
        item.id === library.id ? { ...item, ...result.gitInfo, gitBranch: branch } : item
      )));
    }
    setCaseLibraryStatus((!uploadSync ? '上传已完成，但当前运行版本未返回同步确认，请重新加载新版后比较' : uploadSync.warning) || (keptNewEdits ? '上传已完成；上传期间的新修改已保留，尚未包含在本次上传中' : result.message || `「${library.name}」已上传到云端`));
    if (uploadSync && !keptNewEdits && !uploadSync.warning) setPendingLocalCaseLibraryChange(current => current?.libraryId === library.id ? null : current);
    return true;
  };

  const copyGitLfsInstallCommand = async () => {
    const command = 'git --version >/dev/null 2>&1 || brew install git; git lfs version >/dev/null 2>&1 || brew install git-lfs';

    try {
      await navigator.clipboard.writeText(command);
      setCaseLibraryStatus('已复制 Git LFS 安装命令');
    } catch (_error) {
      setCaseLibraryStatus(command);
    }
  };

  const openGitLfsWebsite = async () => {
    if (electronApi?.ipcRenderer) {
      await electronApi.ipcRenderer.invoke('shell:open-external', 'https://git-lfs.com/');
    } else {
      window.open('https://git-lfs.com/', '_blank');
    }
  };

  const installGitLfsWithHomebrew = async () => {
    if (!electronApi?.ipcRenderer) {
      setCaseLibraryStatus('当前环境无法执行安装命令，请复制命令到终端安装');
      return;
    }

    setIsInstallingGitLfs(true);
    setGitLfsInstallMessage('正在启动 Homebrew 安装任务...');
    setCaseLibraryStatus('正在通过 Homebrew 安装 Git LFS...');
    const installMessages = [
      '正在检查 Homebrew 环境...',
      '正在下载或复用 Git LFS 安装包...',
      '正在执行 brew install git-lfs，网络较慢时可能需要几分钟...',
      '正在执行 git lfs install 初始化...',
      '仍在等待安装命令返回，请不要关闭窗口...',
    ];
    let messageIndex = 0;
    const progressTimer = window.setInterval(() => {
      setGitLfsInstallMessage(installMessages[messageIndex % installMessages.length]);
      messageIndex += 1;
    }, 3000);

    try {
      const result = await electronApi.ipcRenderer.invoke('case-library:install-git-lfs-homebrew') as {
        success: boolean;
        output?: string;
        error?: string;
      };

      if (!result.success) {
        throw new Error(result.error || '安装失败');
      }

      setGitLfsInstallMessage(result.output ? `安装完成：${result.output.trim().split('\n').slice(-1)[0]}` : 'Git LFS 安装完成');
      setCaseLibraryStatus('Git LFS 安装完成，正在继续拉取用例库...');
      setIsGitLfsGuideOpen(false);
      await pullRemoteCases();
    } catch (error) {
      setGitLfsInstallMessage('安装失败，请查看下方错误信息或复制命令到终端执行');
      setCaseLibraryStatus(`Git LFS 安装失败：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      window.clearInterval(progressTimer);
      setIsInstallingGitLfs(false);
    }
  };

  const recheckGitLfsAndPull = async () => {
    if (!electronApi?.ipcRenderer) {
      return;
    }

    setCaseLibraryStatus('正在重新检测 Git LFS...');
    const result = await electronApi.ipcRenderer.invoke('case-library:check-git-lfs') as {
      success: boolean;
      installed: boolean;
      version?: string;
      error?: string;
    };

    if (!result.installed) {
      setCaseLibraryStatus(`仍未检测到 Git LFS：${result.error || '请完成安装后重试'}`);
      return;
    }

    setCaseLibraryStatus(`已检测到 ${result.version || 'Git LFS'}，正在继续拉取用例库...`);
    setIsGitLfsGuideOpen(false);
    await pullRemoteCases();
  };

  const submitGitConfigDialog = async () => {
    if (!gitConfigDialog) {
      return;
    }

    setGitConfigError('');
    const repoUrl = gitConfigDialog.value.trim();
    const authUsername = (gitConfigDialog.authUsername || '').trim();
    const authToken = (gitConfigDialog.authToken || '').trim();
    const sshKeyPath = (gitConfigDialog.sshKeyPath || '').trim();
    const sshPassphrase = (gitConfigDialog.sshPassphrase || '').trim();
    const branch = (gitConfigDialog.branch || 'master').trim() || 'master';

    if (!repoUrl) {
      setGitConfigError('请填写 Git 用例库地址');
      setCaseLibraryStatus('请填写 Git 用例库地址');
      return;
    }

    const targetLibrary = normalizedCaseLibraries.find((library) => library.id === gitConfigDialog.libraryId)
      || selectedCaseLibrary;
    const duplicateLibrary = findDuplicateGitLibrary(gitConfigDialog.libraryId, repoUrl, branch);

    if (duplicateLibrary) {
      const message = `已存在相同 Git 地址和分支的库「${duplicateLibrary.name}」（${branch}），请切换到已有库或填写其他分支。`;
      setGitConfigError(message);
      setCaseLibraryStatus(message);
      return;
    }

    const nextLibrary = targetLibrary ? { ...targetLibrary, repoUrl, authUsername, authToken, sshKeyPath, sshPassphrase, gitBranch: branch } : undefined;

    setRemoteCasesUrl(repoUrl);
    setCaseLibraries((current) => current.map((library) => (
      library.id === gitConfigDialog.libraryId
        ? {
            ...library,
            repoUrl,
            authUsername,
            authToken,
            sshKeyPath,
            sshPassphrase,
            gitBranch: branch,
            branch,
            autoUpdate: gitConfigDialog.intent === 'auto' ? true : library.autoUpdate,
          }
        : library
    )));
    if (!nextLibrary) {
      return;
    }

    let success = false;
    if (gitConfigDialog.intent === 'push') {
      success = await pushCaseLibrary(nextLibrary);
    } else {
      success = await pullRemoteCases(nextLibrary);
    }

    if (success) {
      setGitConfigDialog(null);
      setGitConfigError('');
    }
  };

  useEffect(() => {
    if (!workflowStateHydratedRef.current || !electronApi?.ipcRenderer) {
      return;
    }

    if (autoUpdateCheckedOnStartupRef.current) {
      return;
    }

    autoUpdateCheckedOnStartupRef.current = true;
    const autoUpdatedRepoUrls = new Set<string>();

    normalizedCaseLibraries.forEach((library) => {
      if (!library.autoUpdate || !library.repoUrl || autoUpdatedLibraryIdsRef.current.has(library.id)) {
        return;
      }

      const repoKey = getCaseLibraryGitKey(library.repoUrl, getConfiguredGitBranch(library));
      if (autoUpdatedRepoUrls.has(repoKey)) {
        return;
      }

      autoUpdatedRepoUrls.add(repoKey);
      autoUpdatedLibraryIdsRef.current.add(library.id);
      setCaseLibraryStatus(`正在自动更新「${library.name}」...`);
      void pullRemoteCases(library);
    });
  }, [normalizedCaseLibraries, electronApi]);

  useEffect(() => {
    const message = caseLibraryStatus.trim();

    if (!message) {
      return undefined;
    }

    const id = `toast-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
    setToastMessages((current) => [...current.slice(-2), { id, message }]);

    window.setTimeout(() => {
      setToastMessages((current) => current.filter((toast) => toast.id !== id));
    }, 3600);

    return undefined;
  }, [caseLibraryStatus]);

  const exportWorkspace = () => {
    const workspaceNodePositions = selectedCase
      ? {
          ...nodePositions,
          [selectedCase.id]: getCaseNodePositions(selectedCase, nodes),
        }
      : nodePositions;

    downloadTextFile(
      'glassbox-workspace.json',
      JSON.stringify({
        cases: cases.map(canonicalizeCaseForExport),
        components,
        caseEdges,
        nodePositions: workspaceNodePositions,
      }, null, 2),
      'application/json'
    );
  };
  void exportWorkspace;

  const exportFolder = (folder: CaseFolder, format: 'json' | 'yaml') => {
    const folderIds = collectFolderTreeIds(folder.id);
    const folderCases = cases.filter((testCase) => folderIds.has(getCaseFolderId(testCase)));
    const canonicalFolderCases = folderCases.map(canonicalizeCaseForExport);
    const payload = {
      schemaVersion: 'glassbox.case-folder.v1',
      folder,
      cases: canonicalFolderCases,
      components,
    };
    const content = format === 'json'
      ? JSON.stringify(payload, null, 2)
      : canonicalFolderCases.map((testCase) => automationCaseToYaml(testCase)).join('\n---\n');

    downloadTextFile(
      `${folder.name || 'glassbox-folder'}.${format}`,
      content,
      format === 'json' ? 'application/json' : 'text/yaml'
    );
    setCaseCreateMenuFor(null);
    setCaseActionMenuFor(null);
    setExportFolderDialog(null);
  };

  const collectFolderTreeIds = (folderId: string) => {
    const ids = new Set<string>([folderId]);
    const visit = (parentId: string) => {
      caseLibraryFolders
        .filter((folder) => folder.parentId === parentId)
        .forEach((folder) => {
          ids.add(folder.id);
          visit(folder.id);
        });
    };

    visit(folderId);
    return ids;
  };

  const deleteCase = (caseId: string) => {
    const targetCase = cases.find((testCase) => testCase.id === caseId);
    const remainingCases = cases.filter((testCase) => testCase.id !== caseId);
    const nextSelectedCase = selectedCaseId === caseId ? remainingCases[0] : selectedCase;

    setCases(remainingCases);
    setCaseEdges((current) => {
      const next = { ...current };
      delete next[caseId];
      return next;
    });
    setNodePositions((current) => {
      const next = { ...current };
      delete next[caseId];
      targetCase?.steps.forEach((step) => {
        delete (next as unknown as Record<string, unknown>)[step.id];
      });
      return next;
    });

    if (selectedCaseId === caseId) {
      setSelectedCaseId(nextSelectedCase?.id || '');
      setSelectedStepId(nextSelectedCase?.steps[0]?.id || '');
      setConfigDraft(JSON.stringify(nextSelectedCase?.steps[0]?.config || {}, null, 2));
    }

    setCaseActionMenuFor(null);
    setRunMessage(`已删除用例：${targetCase?.name || caseId}`);
  };

  const duplicateCase = (caseId: string) => {
    const targetCase = cases.find((testCase) => testCase.id === caseId);

    if (!targetCase) {
      return;
    }

    const siblingNames = new Set(cases
      .filter((testCase) => getCaseFolderId(testCase) === getCaseFolderId(targetCase))
      .map((testCase) => testCase.name));
    let copyIndex = 1;
    let nextName = `${targetCase.name}_副本${copyIndex}`;

    while (siblingNames.has(nextName)) {
      copyIndex += 1;
      nextName = `${targetCase.name}_副本${copyIndex}`;
    }

    const stepIdMap = new Map<string, string>();
    const nextSteps = targetCase.steps.map((step) => {
      const nextId = createStepId(step.type);
      stepIdMap.set(step.id, nextId);
      return {
        ...step,
        id: nextId,
        config: { ...step.config },
        inputs: step.inputs ? { ...step.inputs } : step.inputs,
      };
    });
    const nextCase: AutomationCase = {
      ...targetCase,
      id: `case-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
      name: nextName,
      steps: nextSteps,
    };
    const nextEdges = (caseEdges[targetCase.id] || stepsToEdges(targetCase.steps)).map((edge) => ({
      ...edge,
      id: `${stepIdMap.get(edge.source) || edge.source}-${stepIdMap.get(edge.target) || edge.target}`,
      source: stepIdMap.get(edge.source) || edge.source,
      target: stepIdMap.get(edge.target) || edge.target,
    }));
    const sourcePositions = getCaseNodePositions(targetCase, targetCase.id === selectedCase.id ? nodes : []);
    const nextPositions = targetCase.steps.reduce<NodePositions>((positions, step) => {
      const nextStepId = stepIdMap.get(step.id);
      const position = sourcePositions[step.id];

      if (nextStepId && position) {
        positions[nextStepId] = { ...position };
      }

      return positions;
    }, {});

    setCases((current) => [...current, nextCase]);
    setCaseEdges((current) => ({ ...current, [nextCase.id]: nextEdges }));
    setNodePositions((current) => ({ ...current, [nextCase.id]: nextPositions }));
    setSelectedCaseId(nextCase.id);
    setSelectedCaseFolderId(getCaseFolderId(nextCase));
    setSelectedStepId(nextSteps[0]?.id || '');
    setConfigDraft(JSON.stringify(nextSteps[0]?.config || {}, null, 2));
    setCaseActionMenuFor(null);
    setRunMessage(`已复制用例：${nextName}`);
  };

  const deleteCaseLibraryLocal = (libraryId: string) => {
    const targetLibrary = normalizedCaseLibraries.find((library) => library.id === libraryId);
    const deletedFolderIds = new Set(caseFolders
      .filter((folder) => getFolderLibraryId(folder) === libraryId)
      .map((folder) => folder.id));
    const deletedCaseIds = new Set(cases
      .filter((testCase) => deletedFolderIds.has(getCaseFolderId(testCase)))
      .map((testCase) => testCase.id));
    const remainingLibraries = normalizedCaseLibraries.filter((library) => library.id !== libraryId);
    const fallbackLibrary = remainingLibraries[0];
    const remainingFolders = caseFolders.filter((folder) => getFolderLibraryId(folder) !== libraryId);
    const fallbackFolder = fallbackLibrary
      ? remainingFolders.find((folder) => getFolderLibraryId(folder) === fallbackLibrary.id)
      : undefined;
    const remainingCases = cases.filter((testCase) => !deletedCaseIds.has(testCase.id));
    const fallbackCase = deletedCaseIds.has(selectedCaseId) ? remainingCases[0] : selectedCase;

    if (remainingLibraries.length === 0) {
      const [defaultLibrary] = createDefaultCaseLibraries();
      const [defaultFolder] = createDefaultCaseFolders();
      setCaseLibraries([defaultLibrary]);
      setCaseFolders([defaultFolder]);
    } else {
      setCaseLibraries((current) => current.filter((library) => library.id !== libraryId));
      setCaseFolders(remainingFolders);
    }
    setCases(remainingCases);
    setCaseEdges((current) => {
      const next = { ...current };
      deletedCaseIds.forEach((id) => {
        delete next[id];
      });
      return next;
    });

    if (selectedCaseLibraryId === libraryId) {
      setSelectedCaseLibraryId(fallbackLibrary?.id || DEFAULT_CASE_LIBRARY_ID);
      setSelectedCaseFolderId(fallbackFolder?.id || DEFAULT_CASE_FOLDER_ID);
      setCaseLibraryViewMode('library');
    }

    if (deletedCaseIds.has(selectedCaseId)) {
      setSelectedCaseId(fallbackCase?.id || '');
      setSelectedStepId(fallbackCase?.steps[0]?.id || '');
      setConfigDraft(JSON.stringify(fallbackCase?.steps[0]?.config || {}, null, 2));
    }

    setCaseActionMenuFor(null);
    setCaseCreateMenuFor(null);
    setRunMessage(`已从本地删除用例库：${targetLibrary?.name || libraryId}`);
  };

  const deleteFolder = (folderId: string) => {
    const targetFolder = caseLibraryFolders.find((folder) => folder.id === folderId);
    const deletedFolderIds = collectFolderTreeIds(folderId);
    const deletedCaseIds = cases
      .filter((testCase) => deletedFolderIds.has(getCaseFolderId(testCase)))
      .map((testCase) => testCase.id);
    const remainingCases = cases.filter((testCase) => !deletedCaseIds.includes(testCase.id));
    const nextSelectedCase = deletedCaseIds.includes(selectedCaseId) ? remainingCases[0] : selectedCase;

    setCaseFolders((current) => current.filter((folder) => !deletedFolderIds.has(folder.id)));
    setCases(remainingCases);
    setCaseEdges((current) => {
      const next = { ...current };
      deletedCaseIds.forEach((caseId) => {
        delete next[caseId];
      });
      return next;
    });
    setNodePositions((current) => {
      const next = { ...current };
      const deletedCaseIdSet = new Set(deletedCaseIds);
      cases.forEach((testCase) => {
        if (!deletedCaseIdSet.has(testCase.id)) {
          return;
        }

        delete next[testCase.id];
        testCase.steps.forEach((step) => {
          delete (next as unknown as Record<string, unknown>)[step.id];
        });
      });
      return next;
    });

    if (selectedCaseFolderId === folderId || deletedFolderIds.has(selectedCaseFolderId)) {
      const fallbackFolder = caseLibraryFolders.find((folder) => (
        getFolderLibraryId(folder) === getFolderLibraryId(targetFolder) && !deletedFolderIds.has(folder.id)
      ));
      setSelectedCaseFolderId(fallbackFolder?.id || DEFAULT_CASE_FOLDER_ID);
      setCaseLibraryViewMode(fallbackFolder ? 'folder' : 'library');
    }

    if (deletedCaseIds.includes(selectedCaseId)) {
      setSelectedCaseId(nextSelectedCase?.id || '');
      setSelectedStepId(nextSelectedCase?.steps[0]?.id || '');
      setConfigDraft(JSON.stringify(nextSelectedCase?.steps[0]?.config || {}, null, 2));
    }

    setCaseActionMenuFor(null);
    setRunMessage(`已删除文件夹：${targetFolder?.name || folderId}`);
  };

  const beginCaseTreeLongPress = (item: NonNullable<CaseTreeDragItem>, position: { x: number; y: number }) => {
    if (caseTreeDragTimerRef.current) {
      window.clearTimeout(caseTreeDragTimerRef.current);
    }
    caseTreeDragTimerRef.current = window.setTimeout(() => {
      setCaseTreeDragItem(item);
      setCaseTreeDragPosition(position);
      setCaseCreateMenuFor(null);
      setCaseActionMenuFor(null);
    }, 350);
  };

  const cancelCaseTreeLongPress = () => {
    if (caseTreeDragTimerRef.current) {
      window.clearTimeout(caseTreeDragTimerRef.current);
      caseTreeDragTimerRef.current = null;
    }
  };

  const getCaseTreeDropTargetFromPoint = (x: number, y: number) => {
    const element = document.elementFromPoint(x, y)?.closest('[data-case-tree-drop-type][data-case-tree-drop-id]') as HTMLElement | null;

    if (!element) {
      return null;
    }

    const type = element.dataset.caseTreeDropType;
    const id = element.dataset.caseTreeDropId;

    if (type === 'library' && id) {
      return { type, id } as const;
    }

    if (type === 'folder' && id) {
      return { type, id } as const;
    }

    return null;
  };

  const moveCaseTreeItem = (
    target: { type: 'library'; id: string } | { type: 'folder'; id: string },
    draggedItem: NonNullable<CaseTreeDragItem> | null = caseTreeDragItem
  ) => {
    if (!draggedItem) {
      return;
    }

    if (draggedItem.type === 'case') {
      const targetFolder = target.type === 'folder'
        ? caseLibraryFolders.find((folder) => folder.id === target.id)
        : (childFoldersByParent.get(`library:${target.id}`) || [])[0];

      if (!targetFolder) {
        setRunMessage('目标库下还没有文件夹，请先创建文件夹后再移动用例');
        return;
      }

      setCases((current) => current.map((testCase) => (
        testCase.id === draggedItem.id ? { ...testCase, folderId: targetFolder.id } : testCase
      )));
      setSelectedCaseFolderId(targetFolder.id);
      setSelectedCaseLibraryId(getFolderLibraryId(targetFolder));
      setRunMessage('已移动用例');
      return;
    }

    const draggedFolder = caseLibraryFolders.find((folder) => folder.id === draggedItem.id);
    if (!draggedFolder) {
      return;
    }

    if (target.type === 'folder') {
      if (target.id === draggedFolder.id || collectFolderTreeIds(draggedFolder.id).has(target.id)) {
        setRunMessage('不能把文件夹移动到自己或自己的子文件夹下面');
        return;
      }

      const targetFolder = caseLibraryFolders.find((folder) => folder.id === target.id);
      const nextLibraryId = getFolderLibraryId(targetFolder);
      const movedFolderIds = collectFolderTreeIds(draggedFolder.id);
      setCaseFolders((current) => current.map((folder) => {
        if (folder.id === draggedFolder.id) {
          return { ...folder, parentId: target.id, libraryId: nextLibraryId, expanded: true };
        }
        if (movedFolderIds.has(folder.id)) {
          return { ...folder, libraryId: nextLibraryId };
        }
        if (folder.id === target.id) {
          return { ...folder, expanded: true };
        }
        return folder;
      }));
      setSelectedCaseLibraryId(nextLibraryId);
      setSelectedCaseFolderId(draggedFolder.id);
      setRunMessage('已移动文件夹');
      return;
    }

    const movedFolderIds = collectFolderTreeIds(draggedFolder.id);
    setCaseFolders((current) => current.map((folder) => {
      if (folder.id === draggedFolder.id) {
        return { ...folder, parentId: undefined, libraryId: target.id };
      }
      if (movedFolderIds.has(folder.id)) {
        return { ...folder, libraryId: target.id };
      }
      return folder;
    }));
    setSelectedCaseLibraryId(target.id);
    setSelectedCaseFolderId(draggedFolder.id);
    setRunMessage('已移动文件夹到库根目录');
  };

  const finishCaseTreeDrop = (target: { type: 'library'; id: string } | { type: 'folder'; id: string }) => {
    moveCaseTreeItem(target);
    setCaseTreeDragItem(null);
    setCaseTreeDropTarget(null);
    setCaseTreeDragPosition(null);
    caseTreeDragFinishedRef.current = true;
    window.setTimeout(() => {
      caseTreeDragFinishedRef.current = false;
    }, 0);
  };

  const beginCaseTreeNativeDrag = (event: React.DragEvent, item: NonNullable<CaseTreeDragItem>) => {
    event.stopPropagation();
    const target = event.target as HTMLElement;
    if (target.closest('[data-tree-action="true"]') || target.closest('input')) {
      event.preventDefault();
      return;
    }
    setCaseTreeDragItem(item);
    setCaseCreateMenuFor(null);
    setCaseActionMenuFor(null);
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('application/x-glassbox-case-tree', JSON.stringify(item));
  };

  const readCaseTreeNativeDragItem = (event: React.DragEvent): NonNullable<CaseTreeDragItem> | null => {
    try {
      const rawValue = event.dataTransfer.getData('application/x-glassbox-case-tree');
      const parsed = JSON.parse(rawValue) as CaseTreeDragItem;

      if (parsed?.type === 'case' || parsed?.type === 'folder') {
        return parsed;
      }
    } catch (_error) {
      return null;
    }

    return null;
  };

  const handleCaseTreeDragOver = (
    event: React.DragEvent,
    target: { type: 'library'; id: string } | { type: 'folder'; id: string }
  ) => {
    if (!caseTreeDragItem) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    event.dataTransfer.dropEffect = 'move';
    setCaseTreeDropTarget(`${target.type}:${target.id}`);
  };

  const handleCaseTreeDrop = (
    event: React.DragEvent,
    target: { type: 'library'; id: string } | { type: 'folder'; id: string }
  ) => {
    event.preventDefault();
    event.stopPropagation();
    const draggedItem = readCaseTreeNativeDragItem(event) || caseTreeDragItem;
    moveCaseTreeItem(target, draggedItem);
    setCaseTreeDragItem(null);
    setCaseTreeDropTarget(null);
    setCaseTreeDragPosition(null);
  };

  useEffect(() => {
    if (!caseTreeDragItem) {
      return undefined;
    }

    const handleMouseMove = (event: MouseEvent) => {
      setCaseTreeDragPosition({ x: event.clientX, y: event.clientY });
      const target = getCaseTreeDropTargetFromPoint(event.clientX, event.clientY);
      setCaseTreeDropTarget(target ? `${target.type}:${target.id}` : null);
    };

    const handleMouseUp = (event: MouseEvent) => {
      cancelCaseTreeLongPress();
      const target = getCaseTreeDropTargetFromPoint(event.clientX, event.clientY);
      if (target) {
        finishCaseTreeDrop(target);
      } else {
        setCaseTreeDragItem(null);
        setCaseTreeDropTarget(null);
        setCaseTreeDragPosition(null);
      }
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp, { once: true });

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [caseTreeDragItem, caseLibraryFolders, cases]);

  const selectAudioFileForStep = async (stepId: string) => {
    if (!electronApi?.ipcRenderer) {
      setRunMessage('当前环境无法选择本地音频文件');
      return;
    }

    const result = await electronApi.ipcRenderer.invoke('dialog:select-audio-file') as {
      success: boolean;
      path?: string;
      canceled?: boolean;
      error?: string;
    };

    if (result.success && result.path) {
      const step = selectedCase.steps.find((item) => item.id === stepId);
      if (step?.type === 'component') {
        updateStepInput(stepId, 'sourceType', 'file');
        updateStepInput(stepId, 'localPath', result.path);
      } else {
        updateStep(stepId, {
          config: {
            ...(step?.config || {}),
            sourceType: 'file',
            localPath: result.path,
          },
        });
      }
      setRunMessage('已选择音频文件');
    } else if (!result.canceled) {
      setRunMessage(`选择音频失败：${result.error || '未知错误'}`);
    }
  };

  const selectImageFileForStep = async (stepId: string) => {
    if (!electronApi?.ipcRenderer) {
      setRunMessage('当前环境无法选择本地图片文件');
      return;
    }

    const result = await electronApi.ipcRenderer.invoke('dialog:select-image-file') as {
      success: boolean;
      path?: string;
      canceled?: boolean;
      error?: string;
    };

    if (result.success && result.path) {
      updateStepInput(stepId, 'imagePath', result.path);
      setRunMessage('已选择图片文件');
    } else if (!result.canceled) {
      setRunMessage(`选择图片失败：${result.error || '未知错误'}`);
    }
  };

  const openPathInFolder = async (targetPath?: string, mode: 'reveal' | 'open' = 'reveal') => {
    if (!targetPath || !electronApi?.ipcRenderer) {
      return;
    }

    await electronApi.ipcRenderer.invoke(mode === 'open' ? 'shell:open-path' : 'shell:show-item-in-folder', targetPath);
  };

  const getStepAudioArtifacts = (stepId: string) => (
    (runArtifacts?.pushedAudioFiles || []).filter((artifact) => {
      if (!artifact) {
        return false;
      }

      if (artifact.stepId) {
        return artifact.stepId === stepId;
      }

      return (runArtifacts?.pushedAudioFiles || []).length === 1;
    })
  );

  const getPrimaryStepAudioArtifact = (stepId: string) => getStepAudioArtifacts(stepId)[0];

  const getStepTtsArtifacts = (stepId: string) => (
    (runArtifacts?.generatedTtsAudioFiles || []).filter((artifact) => artifact?.stepId === stepId)
  );

  const getPrimaryStepTtsArtifact = (stepId: string) => getStepTtsArtifacts(stepId)[0];

  const isRuntimeAudioPathExpression = (value: string) => (
    value.includes('${')
    || value.includes('{{')
    || /^variables\./.test(value)
    || /^runtime\./.test(value)
  );

  const getAudioPreviewSourcePath = (stepId: string) => {
    const step = selectedCase.steps.find((item) => item.id === stepId);
    const artifactPath = String(getPrimaryStepAudioArtifact(stepId)?.localPath || '').trim();
    if (artifactPath) {
      return artifactPath;
    }

    const ttsArtifactPath = String(getPrimaryStepTtsArtifact(stepId)?.localPath || '').trim();
    if (ttsArtifactPath) {
      return ttsArtifactPath;
    }

    const isComponentDraftRecording = stepId.startsWith('component-draft-');
    const configPath = String(
      step
        ? getStepConfigValue(step, 'localPath', '')
        : isComponentDraftRecording
          ? getComponentDraftParamValue('localPath', '')
          : ''
    ).trim();

    return configPath && !isRuntimeAudioPathExpression(configPath) ? configPath : '';
  };

  const getAutomationTaskCounts = (task: AutomationTaskRecord) => {
    const taskCases = task.cases || [];

    if ((task.reportDetailLoaded === false || taskCases.length === 0) && task.summary) {
      return {
        successCount: task.summary.successCount || 0,
        failedCount: task.summary.failedCount || 0,
        stoppedCount: task.summary.stoppedCount || 0,
        caseCount: task.summary.caseCount || task.total || 0,
      };
    }

    return {
      successCount: taskCases.filter((item) => item.status === 'success').length,
      failedCount: taskCases.filter((item) => item.status === 'failed').length,
      stoppedCount: taskCases.filter((item) => item.status === 'stopped').length,
      caseCount: taskCases.length || task.total || 0,
    };
  };

  const detailLoadsRef = useRef(new Set<string>());
  const detailLoadedAtRef = useRef(new Map<string, number>());
  const ensureAutomationTaskDetail = async (task: AutomationTaskRecord) => {
    if (task.reportDetailLoaded !== false) {
      return task;
    }

    if (!electronApi?.ipcRenderer) {
      setRunMessage('当前环境无法加载报告详情');
      return task;
    }

    if (detailLoadsRef.current.has(task.id)) return task;
    detailLoadsRef.current.add(task.id);
    let result: { success?: boolean; task?: AutomationTaskRecord; error?: string };
    try {
    result = await electronApi.ipcRenderer.invoke('workflow-report:load-task', {
      taskId: task.id,
      reportDetailPath: task.reportDetailPath,
    }) as {
      success?: boolean;
      task?: AutomationTaskRecord;
      error?: string;
    };

    } catch (error) {
      setRunMessage(`加载报告详情失败：${error instanceof Error ? error.message : String(error)}`);
      return task;
    } finally { detailLoadsRef.current.delete(task.id); }
    detailLoadedAtRef.current.set(task.id, Date.now());
    if (!result?.success || !result.task) {
      setRunMessage(`加载报告详情失败：${result?.error || '未知错误'}`);
      return task;
    }

    const detailedTask = result.task;
    setAutomationTasks((current) => mergeAutomationTaskRecords(current, [detailedTask],removedAutomationTaskIdsRef.current));

    return { ...detailedTask, id: task.id };
  };

  const openAutomationTaskReport = async (task: AutomationTaskRecord) => {
    setSelectedAutomationTaskId(task.id);
    setActiveTab('automation-task-report');
    void ensureAutomationTaskDetail(task);
  };

  const exportAutomationTaskReport = async (task: AutomationTaskRecord) => {
    if (!electronApi?.ipcRenderer) {
      setRunMessage('当前环境无法导出报告包');
      return;
    }

    let result: {
      success?: boolean;
      canceled?: boolean;
      path?: string;
      error?: string;
    };

    try {
      setRunMessage(`正在导出测试报告：${task.name}`);
      const exportTask = await ensureAutomationTaskDetail(task);
      result = await electronApi.ipcRenderer.invoke('workflow-report:export-package', {
        task: exportTask,
      }) as typeof result;
    } catch (error) {
      setRunMessage(`导出测试报告失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (result?.canceled) {
      setRunMessage('已取消导出测试报告');
      return;
    }

    if (!result?.success) {
      setRunMessage(`导出测试报告失败：${result?.error || '未知错误'}`);
      return;
    }

    if (result.path) {
      try {
        await openPathInFolder(result.path, 'reveal');
      } catch (_error) {
        // Finder 打开失败不影响报告包导出结果。
      }
    }

    setRunMessage(`测试报告已导出：${result.path}`);
  };

  const openAutomationTaskReportPackage = async () => {
    if (!electronApi?.ipcRenderer) {
      setRunMessage('当前环境无法打开报告包');
      return;
    }

    let result: {
      success?: boolean;
      canceled?: boolean;
      task?: AutomationTaskRecord;
      error?: string;
    };

    try {
      setRunMessage('请选择 solopi-desktop 报告包');
      result = await electronApi.ipcRenderer.invoke('workflow-report:open-package') as typeof result;
    } catch (error) {
      setRunMessage(`打开报告包失败：${error instanceof Error ? error.message : String(error)}`);
      return;
    }

    if (result?.canceled) {
      setRunMessage('已取消打开报告包');
      return;
    }

    if (!result?.success || !result.task) {
      setRunMessage(`打开报告包失败：${result?.error || '未知错误'}`);
      return;
    }

    const importedTask = result.task;
    setAutomationTasks((current) => [importedTask, ...current.filter((task) => task.id !== importedTask.id)]);
    setSelectedAutomationTaskId(importedTask.id);
    setActiveTab('automation-task-report');
    setRunMessage(`已打开只读报告：${importedTask.name}`);
  };

  const ensureScrcpyForWorkflowOption = async (optionLabel: string) => {
    if (!electronApi?.ipcRenderer) {
      return true;
    }

    let result: {
      success?: boolean;
      missingScrcpy?: boolean;
      installCommand?: string;
      tutorialUrl?: string;
      error?: string;
    };

    try {
      result = await electronApi.ipcRenderer.invoke('scrcpy:check') as typeof result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/No handler registered for 'scrcpy:check'|No handler registered/i.test(message)) {
        return true;
      }
      throw error;
    }

    if (result?.success) {
      return true;
    }

    setScrcpyGuideDialog({
      optionLabel,
      installCommand: result?.installCommand || 'brew install scrcpy',
      tutorialUrl: result?.tutorialUrl || 'https://github.com/Genymobile/scrcpy/blob/master/doc/macos.md',
    });
    return false;
  };

  const updateWorkflowScrcpyOption = async (step: AutomationStep, key: string, checked: boolean, label: string) => {
    if (checked) {
      const ready = await ensureScrcpyForWorkflowOption(label);
      if (!ready) {
        return;
      }
    }

    setStepConfigValue(step, key, checked);
  };

  const copyScrcpyInstallCommand = async () => {
    const command = scrcpyGuideDialog?.installCommand || 'brew install scrcpy';

    try {
      await navigator.clipboard.writeText(command);
      setCaseLibraryStatus('已复制 scrcpy 安装命令');
    } catch (_error) {
      setCaseLibraryStatus(command);
    }
  };

  const openScrcpyInstallGuide = async () => {
    if (!electronApi?.ipcRenderer) {
      return;
    }

    await electronApi.ipcRenderer.invoke(
      'shell:open-external',
      scrcpyGuideDialog?.tutorialUrl || 'https://github.com/Genymobile/scrcpy/blob/master/doc/macos.md'
    );
  };

  const getStepConfigValue = (step: AutomationStep, key: string, fallback: unknown = '') => (
    step.type === 'component'
      ? step.inputs?.[key] ?? fallback
      : step.config[key] ?? fallback
  );

  const setStepConfigValue = (step: AutomationStep, key: string, value: unknown) => {
    if (step.type === 'component') {
      updateStepInput(step.id, key, typeof value === 'string' ? value : JSON.stringify(value));
      return;
    }

    const nextConfig = {
      ...step.config,
      [key]: value,
    };

    updateStep(step.id, {
      config: nextConfig,
    });

    if (step.id === selectedStepId) {
      setConfigDraft(JSON.stringify(nextConfig, null, 2));
    }
  };

  const getMobileUiSelector = (step: AutomationStep) => {
    const rawSelector = getStepConfigValue(step, 'selector', {});
    const selector = typeof rawSelector === 'string'
      ? (() => {
          try {
            return JSON.parse(rawSelector) as Record<string, unknown>;
          } catch (_error) {
            return { text: rawSelector };
          }
        })()
      : rawSelector as Record<string, unknown>;
    return {
      resourceId: String(selector?.resourceId || ''),
      text: String(selector?.text || ''),
      contentDesc: String(selector?.contentDesc || ''),
      className: String(selector?.className || ''),
      bounds: String(selector?.bounds || ''),
      xRatio: String(selector?.xRatio || ''),
      yRatio: String(selector?.yRatio || ''),
    };
  };

  const setMobileUiSelectorValue = (step: AutomationStep, key: string, value: string) => {
    const currentSelector = getMobileUiSelector(step);
    const semanticKeys = new Set(['resourceId', 'text', 'contentDesc', 'className']);
    const coordinateKeys = new Set(['bounds', 'xRatio', 'yRatio']);
    const valueChanged = currentSelector[key as keyof typeof currentSelector] !== value;
    const nextSelector = {
      ...currentSelector,
      [key]: value,
    };

    if (valueChanged && semanticKeys.has(key)) {
      nextSelector.bounds = '';
      nextSelector.xRatio = '';
      nextSelector.yRatio = '';
    } else if (valueChanged && coordinateKeys.has(key)) {
      if (key === 'bounds') {
        nextSelector.xRatio = '';
        nextSelector.yRatio = '';
      } else {
        nextSelector.bounds = '';
      }
    }

    setStepConfigValue(step, 'selector', nextSelector);

    if (valueChanged && semanticKeys.has(key) && String(getStepConfigValue(step, 'matchMode', 'auto')) === 'auto') {
      setStepConfigValue(step, 'matchMode', 'exact');
    }

    if (valueChanged) {
      setMobileUiInspector((current) => ({
        ...current,
        inspectedStepId: step.id,
        selectedElementId: undefined,
        clickPreview: undefined,
      }));
      setMobileUiDebug({ status: 'idle', stepId: step.id });
    }
  };

  const getMobileUiElementLabel = (element: MobileUiElement) => (
    element.text || element.contentDesc || element.resourceId || element.className || `元素 ${element.index + 1}`
  );

  const findMobileUiElementForStep = (step: AutomationStep | undefined, elements: MobileUiElement[]) => {
    if (!step) {
      return undefined;
    }
    const selector = getMobileUiSelector(step);
    return elements.find((element) => (
      (selector.resourceId && element.resourceId === selector.resourceId)
      || (selector.text && element.text === selector.text)
      || (selector.contentDesc && element.contentDesc === selector.contentDesc)
      || (selector.bounds && element.bounds === selector.bounds)
    ));
  };

  const getMobileUiTapInsetsForStep = (step: AutomationStep) => {
    const legacyTapInsetPx = normalizeMobileUiTapInset(getStepConfigValue(step, 'tapInsetPx', '5'));
    return {
      tapInsetXPx: normalizeMobileUiTapInset(getStepConfigValue(step, 'tapInsetXPx', String(legacyTapInsetPx)), legacyTapInsetPx),
      tapInsetYPx: normalizeMobileUiTapInset(getStepConfigValue(step, 'tapInsetYPx', String(legacyTapInsetPx)), legacyTapInsetPx),
    };
  };

  const refreshMobileUiInspector = async (step?: AutomationStep) => {
    if (!electronApi?.ipcRenderer) {
      setMobileUiInspector({ loading: false, elements: [], error: '当前环境不支持 Electron IPC' });
      return;
    }

    const serial = selectedPhoneSerial;
    if (!serial) {
      setMobileUiInspector({ loading: false, elements: [], error: '请先选择手机设备' });
      return;
    }

    setMobileUiInspector((current) => ({
      ...current,
      serial,
      inspectedStepId: step?.id,
      loading: true,
      error: undefined,
      selectedElementId: undefined,
    }));

    const selector = step ? getMobileUiSelector(step) : {};
    const result = await electronApi.ipcRenderer.invoke('mobile-ui:inspect', {
      serial,
      selector,
      matchMode: step ? String(getStepConfigValue(step, 'matchMode', 'auto')) : 'auto',
      tapPosition: step ? String(getStepConfigValue(step, 'tapPosition', 'center')) : 'center',
      tapInsetXPx: step ? getMobileUiTapInsetsForStep(step).tapInsetXPx : 5,
      tapInsetYPx: step ? getMobileUiTapInsetsForStep(step).tapInsetYPx : 5,
      action: step ? String(getStepConfigValue(step, 'action', '')) : '',
    }) as {
      success?: boolean;
      error?: string;
      screenshotDataUrl?: string;
      screen?: { width?: number; height?: number };
      screenshot?: { width?: number; height?: number };
      coordinateTransform?: MobileUiInspectorState['coordinateTransform'];
      elements?: MobileUiElement[];
      clickPreview?: MobileUiInspectorState['clickPreview'];
    };

    if (!result?.success) {
      setMobileUiInspector({
        loading: false,
        serial,
        error: result?.error || '读取手机页面失败',
        elements: [],
      });
      return;
    }

    const elements = result.elements || [];
    const selectedElement = result.clickPreview?.elementId
      ? elements.find((element) => element.id === result.clickPreview?.elementId)
      : findMobileUiElementForStep(step, elements);

    setMobileUiInspector({
      loading: false,
      serial,
      inspectedStepId: step?.id,
      screenshotDataUrl: result.screenshotDataUrl,
      screen: result.screen,
      screenshot: result.screenshot,
      coordinateTransform: result.coordinateTransform,
      elements,
      selectedElementId: selectedElement?.id,
      clickPreview: result.clickPreview,
    });
  };

  const applyMobileUiElementToStep = (step: AutomationStep, element: MobileUiElement) => {
    const screenWidth = Number(mobileUiInspector.screen?.width || 0);
    const screenHeight = Number(mobileUiInspector.screen?.height || 0);
    const action = String(getStepConfigValue(step, 'action', 'tap'));
    const tapPosition = normalizeMobileUiTapPosition(getStepConfigValue(step, 'tapPosition', 'center'));
    const { tapInsetXPx, tapInsetYPx } = getMobileUiTapInsetsForStep(step);
    const tapPoint = getMobileUiTapPoint(element.rect, tapPosition, tapInsetXPx, tapInsetYPx, getStepConfigValue(step, 'tapRatioX', '0.5'), getStepConfigValue(step, 'tapRatioY', '0.5'));
    const screenshotTapPoint = mapMobileUiPointToInspectorScreenshot(tapPoint, mobileUiInspector);

    setStepConfigValue(step, 'selector', {
      resourceId: element.resourceId || '',
      text: element.text || '',
      contentDesc: element.contentDesc || '',
      className: element.className || '',
      bounds: element.bounds || '',
      xRatio: screenWidth > 0 ? String(Number((tapPoint.x / screenWidth).toFixed(4))) : '',
      yRatio: screenHeight > 0 ? String(Number((tapPoint.y / screenHeight).toFixed(4))) : '',
    });
    setMobileUiInspector((current) => ({
      ...current,
      inspectedStepId: step.id,
      selectedElementId: element.id,
      clickPreview: action === 'tap' || action === 'input' ? {
        source: 'element-anchor',
        x: tapPoint.x,
        y: tapPoint.y,
        screenshotX: screenshotTapPoint.x,
        screenshotY: screenshotTapPoint.y,
        elementId: element.id,
        elementLabel: getMobileUiElementLabel(element),
        bounds: element.bounds || '',
        tapPosition,
        tapInsetXPx,
        tapInsetYPx,
      } : undefined,
    }));

    if (step.name === '点击手机元素' || step.name === '等待手机元素') {
      const label = getMobileUiElementLabel(element);
      updateStep(step.id, {
        name: `${mobileUiActionLabels[String(getStepConfigValue(step, 'action', 'tap'))] || '手机操作'} ${label}`.slice(0, 48),
      });
    }
  };

  const setMobileUiTapPosition = (step: AutomationStep, value: string) => {
    const tapPosition = normalizeMobileUiTapPosition(value);
    const { tapInsetXPx, tapInsetYPx } = getMobileUiTapInsetsForStep(step);
    setStepConfigValue(step, 'tapPosition', tapPosition);
    const screenWidth = Number(mobileUiInspector.screen?.width || 0);
    const screenHeight = Number(mobileUiInspector.screen?.height || 0);
    const selectedElement = mobileUiInspector.elements.find((item) => item.id === mobileUiInspector.selectedElementId);
    if (selectedElement && screenWidth > 0 && screenHeight > 0) {
      const point = getMobileUiTapPoint(selectedElement.rect, tapPosition, tapInsetXPx, tapInsetYPx, getStepConfigValue(step, 'tapRatioX', '0.5'), getStepConfigValue(step, 'tapRatioY', '0.5'));
      setStepConfigValue(step, 'selector', {
        ...getMobileUiSelector(step),
        xRatio: String(Number((point.x / screenWidth).toFixed(4))),
        yRatio: String(Number((point.y / screenHeight).toFixed(4))),
      });
    }
    setMobileUiInspector((current) => {
      const element = current.elements.find((item) => item.id === current.selectedElementId);
      if (!element) return current;
      const point = getMobileUiTapPoint(element.rect, tapPosition, tapInsetXPx, tapInsetYPx, getStepConfigValue(step, 'tapRatioX', '0.5'), getStepConfigValue(step, 'tapRatioY', '0.5'));
      const screenshotPoint = mapMobileUiPointToInspectorScreenshot(point, current);
      return {
        ...current,
        clickPreview: {
          source: 'element-anchor',
          x: point.x,
          y: point.y,
          screenshotX: screenshotPoint.x,
          screenshotY: screenshotPoint.y,
          elementId: element.id,
          elementLabel: getMobileUiElementLabel(element),
          bounds: element.bounds || '',
          tapPosition,
          tapInsetXPx,
          tapInsetYPx,
        },
      };
    });
    setMobileUiDebug({ status: 'idle', stepId: step.id });
  };

  const setMobileUiTapInset = (step: AutomationStep, axis: 'x' | 'y', value: string) => {
    const tapInsetPx = normalizeMobileUiTapInset(value, 5);
    const tapPosition = normalizeMobileUiTapPosition(getStepConfigValue(step, 'tapPosition', 'center'));
    setStepConfigValue(step, axis === 'x' ? 'tapInsetXPx' : 'tapInsetYPx', String(tapInsetPx));
    const currentInsets = getMobileUiTapInsetsForStep(step);
    const tapInsetXPx = axis === 'x' ? tapInsetPx : currentInsets.tapInsetXPx;
    const tapInsetYPx = axis === 'y' ? tapInsetPx : currentInsets.tapInsetYPx;
    const screenWidth = Number(mobileUiInspector.screen?.width || 0);
    const screenHeight = Number(mobileUiInspector.screen?.height || 0);
    const selectedElement = mobileUiInspector.elements.find((item) => item.id === mobileUiInspector.selectedElementId);
    if (selectedElement && screenWidth > 0 && screenHeight > 0) {
      const point = getMobileUiTapPoint(selectedElement.rect, tapPosition, tapInsetXPx, tapInsetYPx, getStepConfigValue(step, 'tapRatioX', '0.5'), getStepConfigValue(step, 'tapRatioY', '0.5'));
      setStepConfigValue(step, 'selector', {
        ...getMobileUiSelector(step),
        xRatio: String(Number((point.x / screenWidth).toFixed(4))),
        yRatio: String(Number((point.y / screenHeight).toFixed(4))),
      });
    }
    setMobileUiInspector((current) => {
      const element = current.elements.find((item) => item.id === current.selectedElementId);
      if (!element) return current;
      const point = getMobileUiTapPoint(element.rect, tapPosition, tapInsetXPx, tapInsetYPx, getStepConfigValue(step, 'tapRatioX', '0.5'), getStepConfigValue(step, 'tapRatioY', '0.5'));
      const screenshotPoint = mapMobileUiPointToInspectorScreenshot(point, current);
      return {
        ...current,
        clickPreview: {
          source: 'element-anchor',
          x: point.x,
          y: point.y,
          screenshotX: screenshotPoint.x,
          screenshotY: screenshotPoint.y,
          elementId: element.id,
          elementLabel: getMobileUiElementLabel(element),
          bounds: element.bounds || '',
          tapPosition,
          tapInsetXPx,
          tapInsetYPx,
        },
      };
    });
    setMobileUiDebug({ status: 'idle', stepId: step.id });
  };

  const clearMobileUiElementFromStep = (step: AutomationStep) => {
    setStepConfigValue(step, 'selector', {
      resourceId: '',
      text: '',
      contentDesc: '',
      className: '',
      bounds: '',
      xRatio: '',
      yRatio: '',
    });
    setMobileUiInspector((current) => ({
      ...current,
      inspectedStepId: step.id,
      selectedElementId: undefined,
      clickPreview: undefined,
    }));
    setMobileUiDebug({ status: 'idle', stepId: step.id });
  };

  const debugMobileUiStep = async (step: AutomationStep) => {
    if (!electronApi?.ipcRenderer || !selectedStepComponent) {
      setMobileUiDebug({
        stepId: step.id,
        status: 'error',
        message: '当前环境无法调试手机 UI 节点',
      });
      return;
    }

    setMobileUiDebug({
      stepId: step.id,
      status: 'running',
      message: selectedStepComponentKind === 'mobile_ui_assert' ? '正在校验当前元素...' : '正在执行当前操作...',
    });

    try {
      const result = await electronApi.ipcRenderer.invoke('mobile-ui:debug-step', {
        step,
        component: selectedStepComponent,
        defaults: {
          phoneSerial: selectedPhoneSerial,
          glassesSerial: selectedGlassesSerial,
          phonePackage: selectedPhonePackage,
          glassesPackage: selectedGlassesPackage,
        },
        variables: selectedCase?.variables || {},
      }) as {
        success?: boolean;
        error?: string;
        errorCode?: string;
        recoveryActions?: string[];
        command?: string;
        stdout?: string;
        stderr?: string;
      };

      if (!result?.success) {
        setMobileUiDebug({
          stepId: step.id,
          status: 'error',
          message: result?.error || '当前节点调试失败',
          command: result?.command,
          stdout: result?.stdout,
          stderr: result?.stderr,
          errorCode: result?.errorCode,
          recoveryActions: result?.recoveryActions || [],
        });
        return;
      }

      setMobileUiDebug({
        stepId: step.id,
        status: 'success',
        message: selectedStepComponentKind === 'mobile_ui_assert' ? '元素校验通过' : '节点操作执行成功',
        command: result.command,
        stdout: result.stdout,
        stderr: result.stderr,
      });

      if (selectedStepComponentKind === 'mobile_ui_action') {
        window.setTimeout(() => {
          void refreshMobileUiInspector(step);
        }, 300);
      }
    } catch (error) {
      setMobileUiDebug({
        stepId: step.id,
        status: 'error',
        message: error instanceof Error ? error.message : String(error),
        recoveryActions: ['确认手机设备在线并已允许 USB 调试后重试。'],
      });
    }
  };

  useEffect(() => {
    const selectedElement = findMobileUiElementForStep(selectedStep, mobileUiInspector.elements);
    setMobileUiInspector((current) => {
      const nextSelectedElementId = selectedElement?.id;
      if (current.inspectedStepId === selectedStep?.id && current.selectedElementId === nextSelectedElementId) {
        return current;
      }
      return {
        ...current,
        inspectedStepId: selectedStep?.id,
        selectedElementId: nextSelectedElementId,
      };
    });
  }, [selectedStep?.id]);

  const ttsProviderUsesTextParam = (provider: Pick<TtsProviderConfig, 'url' | 'headersText' | 'bodyTemplate'>) => (
    /(?:\{\{\s*|\$\{\s*)text(?:Json|UrlEncoded)?\s*(?:\}\}|\})/.test(`${provider.url || ''}\n${provider.headersText || ''}\n${provider.bodyTemplate || ''}`)
  );

  const openTtsTestDialog = () => {
    if (!ttsProviderUsesTextParam(ttsProviderDraft)) {
      setTtsMessage('TTS URL/Header/Body 中没有使用 text/textUrlEncoded/textJson，无法动态输入文本合成');
      return;
    }

    setTtsTestDialog({
      values: {
        text: requiredTtsTextParam.defaultValue,
      },
      message: '',
    });
  };

  const getHttpVariableMappings = (step: AutomationStep) => {
    const toDisplayResponsePath = (pathValue: unknown) => {
      const value = String(pathValue ?? '').trim();

      if (value === '$.body' || value === '$') {
        return '';
      }

      return value.replace(/^\$\.body\.?/, '');
    };

    const storedMappings = getStepConfigValue(step, 'responseMappings', null);
    if (Array.isArray(storedMappings)) {
      const mappings = storedMappings
        .map((item) => ({
          variableName: String((item as { variableName?: unknown })?.variableName ?? ''),
          responsePath: toDisplayResponsePath((item as { responsePath?: unknown })?.responsePath),
        }));

      if (mappings.length > 0) {
        return mappings;
      }
    }

    const mapping = parseJsonRecordForPreview(getStepConfigValue(step, 'saveToVariablesText', '{}'));
    const entries = Object.entries(mapping)
      .map(([variableName, responsePath]) => ({
        variableName,
        responsePath: toDisplayResponsePath(responsePath),
      }))
      .filter((item) => item.variableName || item.responsePath);

    return entries.length > 0 ? entries : [{ variableName: '', responsePath: '' }];
  };

  const setHttpVariableMappings = (step: AutomationStep, mappings: Array<{ variableName: string; responsePath: string }>) => {
    const toRuntimeResponsePath = (pathValue: string) => {
      const value = pathValue.trim();

      if (!value) {
        return '$.body';
      }

      if (value === '$' || value.startsWith('$.')) {
        return value;
      }

      return `$.body.${value}`;
    };

    const nextMapping = mappings.reduce<Record<string, string>>((result, item) => {
      const variableName = item.variableName.trim();

      if (variableName) {
        result[variableName] = toRuntimeResponsePath(item.responsePath);
      }

      return result;
    }, {});

    updateStep(step.id, {
      config: {
        ...step.config,
        responseMappings: mappings,
        saveToVariablesText: JSON.stringify(
          Object.keys(nextMapping).length > 0 ? nextMapping : {},
          null,
          2
        ),
      },
    });
  };

  const updateHttpVariableMapping = (
    step: AutomationStep,
    index: number,
    patch: Partial<{ variableName: string; responsePath: string }>
  ) => {
    const nextMappings = getHttpVariableMappings(step).map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    ));
    setHttpVariableMappings(step, nextMappings);
  };

  const addHttpVariableMapping = (step: AutomationStep) => {
    setHttpVariableMappings(step, [
      ...getHttpVariableMappings(step),
      { variableName: '', responsePath: '' },
    ]);
  };

  const removeHttpVariableMapping = (step: AutomationStep, index: number) => {
    setHttpVariableMappings(
      step,
      getHttpVariableMappings(step).filter((_item, itemIndex) => itemIndex !== index)
    );
  };

  const getLlmVariableMappings = (step: AutomationStep) => {
    const toDisplayOutputPath = (pathValue: unknown) => {
      const value = String(pathValue ?? '').trim();

      if (value === '$.text') {
        return 'text';
      }

      if (value === '$') {
        return '';
      }

      return value.replace(/^\$\.?/, '');
    };

    const storedMappings = getStepConfigValue(step, 'outputMappings', null);
    if (Array.isArray(storedMappings)) {
      const mappings = storedMappings.map((item) => ({
        variableName: String((item as { variableName?: unknown })?.variableName ?? ''),
        outputPath: toDisplayOutputPath((item as { outputPath?: unknown })?.outputPath),
        fallbackValue: String((item as { fallbackValue?: unknown })?.fallbackValue ?? ''),
      }));

      if (mappings.length > 0) {
        return mappings;
      }
    }

    const saveMapping = parseJsonRecordForPreview(getStepConfigValue(step, 'saveToVariablesText', '{}'));
    const fallbackMapping = parseJsonRecordForPreview(getStepConfigValue(step, 'fallbackText', '{}'));
    const entries = Object.entries(saveMapping).map(([variableName, outputPath]) => ({
      variableName,
      outputPath: toDisplayOutputPath(outputPath),
      fallbackValue: String(fallbackMapping[variableName] ?? ''),
    }));

    return entries.length > 0 ? entries : [{ variableName: DEFAULT_LLM_TEXT_VARIABLE_NAME, outputPath: DEFAULT_LLM_TEXT_VARIABLE_NAME, fallbackValue: '' }];
  };

  const setLlmVariableMappings = (
    step: AutomationStep,
    mappings: Array<{ variableName: string; outputPath: string; fallbackValue: string }>,
    outputModeOverride?: string
  ) => {
    const outputMode = String(outputModeOverride || getStepConfigValue(step, 'outputMode', 'json'));
    const toRuntimeOutputPath = (pathValue: string) => {
      const value = pathValue.trim();

      if (!value) {
        return outputMode === 'text' ? '$.text' : '$';
      }

      if (value === '$' || value.startsWith('$.')) {
        return value;
      }

      return `$.${value}`;
    };
    const saveMapping = mappings.reduce<Record<string, string>>((result, item) => {
      const variableName = item.variableName.trim();

      if (variableName) {
        result[variableName] = toRuntimeOutputPath(item.outputPath);
      }

      return result;
    }, {});
    const fallbackMapping = mappings.reduce<Record<string, string>>((result, item) => {
      const variableName = item.variableName.trim();

      if (variableName && item.fallbackValue !== '') {
        result[variableName] = item.fallbackValue;
      }

      return result;
    }, {});

    updateStep(step.id, {
      config: {
        ...step.config,
        ...(outputModeOverride ? { outputMode: outputModeOverride } : {}),
        outputMappings: mappings,
        saveToVariablesText: JSON.stringify(saveMapping, null, 2),
        fallbackText: JSON.stringify(fallbackMapping, null, 2),
      },
    });
  };

  const updateLlmVariableMapping = (
    step: AutomationStep,
    index: number,
    patch: Partial<{ variableName: string; outputPath: string; fallbackValue: string }>
  ) => {
    const nextMappings = getLlmVariableMappings(step).map((item, itemIndex) => (
      itemIndex === index ? { ...item, ...patch } : item
    ));
    setLlmVariableMappings(step, nextMappings);
  };

  const addLlmVariableMapping = (step: AutomationStep) => {
    setLlmVariableMappings(step, [
      ...getLlmVariableMappings(step),
      { variableName: '', outputPath: '', fallbackValue: '' },
    ]);
  };

  const removeLlmVariableMapping = (step: AutomationStep, index: number) => {
    setLlmVariableMappings(
      step,
      getLlmVariableMappings(step).filter((_item, itemIndex) => itemIndex !== index)
    );
  };

  const generateTtsRegexForStep = (step: AutomationStep) => {
    const textarea = document.getElementById(`tts-sample-log-step-${step.id}`) as HTMLTextAreaElement | null;
    const sampleLog = String(getStepConfigValue(step, 'sampleLog', ''));
    const targetText = String(getStepConfigValue(step, 'sampleExtractText', '')).trim();
    const selectedText = textarea
      ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
      : '';
    const extractText = targetText || selectedText;
    const regex = createTtsExtractRegexFromSelection(sampleLog, extractText);

    if (!regex) {
      setRunMessage('请先填写日志样例和提取内容，或在日志样例中选中代表目标文本的内容');
      return;
    }

    setStepConfigValue(step, 'extractRegex', regex);
    if (!String(getStepConfigValue(step, 'expectedText', '')).trim()) {
      setStepConfigValue(step, 'expectedText', extractText);
    }
    setRunMessage('已根据日志样例和提取内容生成 TTS 提取正则');
  };

  const generateJsonRegexForStep = (step: AutomationStep) => {
    const sampleLog = String(getStepConfigValue(step, 'sampleLog', ''));
    const samplePayload = String(getStepConfigValue(step, 'samplePayload', ''));
    const regex = createJsonExtractRegexFromSample(sampleLog, samplePayload);

    if (!regex) {
      setRunMessage('请确认日志原文和提取内容都已填写，且提取内容完整存在于日志原文中');
      return;
    }

    setStepConfigValue(step, 'lineRegex', regex);
    setRunMessage('已根据日志原文和提取内容生成 JSON 提取正则');
  };

  const generateLlmAssertRegexForStep = (step: AutomationStep) => {
    const sampleLog = String(getStepConfigValue(step, 'sampleLog', ''));
    const samplePayload = String(getStepConfigValue(step, 'samplePayload', ''));
    const regex = createJsonExtractRegexFromSample(sampleLog, samplePayload);

    if (!regex) {
      setRunMessage('请确认日志原文和提取内容都已填写，且提取内容完整存在于日志原文中');
      return;
    }

    setStepConfigValue(step, 'lineRegex', regex);
    setRunMessage('已根据日志原文和提取内容生成 LLM 断言日志正则');
  };

  const updateJsonAssertStepCondition = (step: AutomationStep, index: number, patch: Partial<JsonAssertCondition>) => {
    const conditions = parseJsonAssertConditionsForUi(getStepConfigValue(step, 'conditions', '[]'));
    const nextConditions = conditions.map((condition, conditionIndex) => (
      conditionIndex === index ? { ...condition, ...patch } : condition
    ));

    setStepConfigValue(step, 'conditions', stringifyJsonAssertConditions(nextConditions));
  };

  const addJsonAssertStepCondition = (step: AutomationStep) => {
    const conditions = parseJsonAssertConditionsForUi(getStepConfigValue(step, 'conditions', '[]'));

    setStepConfigValue(step, 'conditions', stringifyJsonAssertConditions([
      ...conditions,
      { path: '', operator: 'equals', value: '', ignoreCase: false },
    ]));
  };

  const removeJsonAssertStepCondition = (step: AutomationStep, index: number) => {
    const conditions = parseJsonAssertConditionsForUi(getStepConfigValue(step, 'conditions', '[]'));

    setStepConfigValue(step, 'conditions', stringifyJsonAssertConditions(
      conditions.filter((_, conditionIndex) => conditionIndex !== index)
    ));
  };

  const stopRecordingStream = () => {
    recordingStreamRef.current?.getTracks().forEach((track) => track.stop());
    recordingStreamRef.current = null;
  };

  const getAudioTranscodeSettings = (stepId: string) => {
    const step = selectedCase.steps.find((item) => item.id === stepId);
    const source = step
      ? {
          outputFormat: getStepConfigValue(step, 'outputFormat', defaultAudioTranscodeParams.outputFormat),
          sampleFormat: getStepConfigValue(step, 'sampleFormat', defaultAudioTranscodeParams.sampleFormat),
          sampleRate: getStepConfigValue(step, 'sampleRate', defaultAudioTranscodeParams.sampleRate),
          channelCnt: getStepConfigValue(step, 'channelCnt', defaultAudioTranscodeParams.channelCnt),
        }
      : stepId.startsWith('component-draft-')
        ? {
            outputFormat: getComponentDraftParamValue('outputFormat', defaultAudioTranscodeParams.outputFormat),
            sampleFormat: getComponentDraftParamValue('sampleFormat', defaultAudioTranscodeParams.sampleFormat),
            sampleRate: getComponentDraftParamValue('sampleRate', defaultAudioTranscodeParams.sampleRate),
            channelCnt: getComponentDraftParamValue('channelCnt', defaultAudioTranscodeParams.channelCnt),
          }
        : defaultAudioTranscodeParams;

    return normalizeAudioTranscodeSettings(source);
  };

  const saveRecordingBlob = async (stepId: string, blob: Blob, settings: AudioTranscodeSettings) => {
    if (!electronApi?.ipcRenderer) {
      setRunMessage('当前环境无法保存录音文件');
      return;
    }

    const convertedBlob = await convertRecordingBlob(blob, settings);
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();

      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('读取录音数据失败'));
      reader.readAsDataURL(convertedBlob);
    });
    const result = await electronApi.ipcRenderer.invoke('audio:save-recording', {
      stepId,
      dataUrl,
      mimeType: convertedBlob.type,
      outputFormat: settings.outputFormat,
      sampleRate: settings.sampleRate,
      channelCnt: settings.channelCnt,
    }) as {
      success: boolean;
      path?: string;
      size?: number;
      sha256?: string;
      error?: string;
    };

    if (!result.success || !result.path) {
      setRunMessage(`录音保存失败：${result.error || '未知错误'}`);
      return;
    }

    const step = selectedCase.steps.find((item) => item.id === stepId);
    const isComponentDraftRecording = stepId.startsWith('component-draft-');
    const currentRemotePath = String(
      step
        ? getStepConfigValue(step, 'remotePath', '')
        : isComponentDraftRecording
          ? getComponentDraftParamValue('remotePath', '')
          : ''
    );
    const shouldRefreshRemotePath = isDefaultAudioRemotePath(currentRemotePath);

    if (step) {
      setStepConfigValue(step, 'sourceType', 'record');
      setStepConfigValue(step, 'outputFormat', settings.outputFormat);
      setStepConfigValue(step, 'sampleFormat', settings.sampleFormat);
      setStepConfigValue(step, 'sampleRate', String(settings.sampleRate));
      setStepConfigValue(step, 'localPath', result.path);
      setStepConfigValue(step, 'remotePath', shouldRefreshRemotePath ? createDefaultAudioRemoteDir() : currentRemotePath);
    } else if (isComponentDraftRecording) {
      setComponentDraftParamValue('sourceType', 'record');
      setComponentDraftParamValue('outputFormat', settings.outputFormat);
      setComponentDraftParamValue('sampleFormat', settings.sampleFormat);
      setComponentDraftParamValue('sampleRate', String(settings.sampleRate));
      setComponentDraftParamValue('localPath', result.path);
      setComponentDraftParamValue('remotePath', shouldRefreshRemotePath ? createDefaultAudioRemoteDir() : currentRemotePath);
    }
    setRunMessage(
      result.sha256
        ? `录音已保存，执行时会覆盖使用这段音频（${result.size || 0} bytes，sha256 ${result.sha256.slice(0, 12)}）`
        : '录音已保存，执行时会覆盖使用这段音频'
    );
  };

  const setRecordingPreview = (stepId: string, blob: Blob) => {
    const previewUrl = URL.createObjectURL(blob);

    setRecordingPreviewUrls((current) => {
      if (current[stepId]) {
        URL.revokeObjectURL(current[stepId]);
      }

      return {
        ...current,
        [stepId]: previewUrl,
      };
    });
  };

  const playAudioPreview = async (stepId: string) => {
    const audioArtifact = getPrimaryStepAudioArtifact(stepId);
    const ttsArtifact = getPrimaryStepTtsArtifact(stepId);
    const localPath = getAudioPreviewSourcePath(stepId);
    let previewUrl = recordingPreviewUrls[stepId];

    if (localPath && electronApi?.ipcRenderer) {
      try {
        const settings = ttsArtifact
          ? {
              outputFormat: String(ttsArtifact.extension || ttsArtifact.mimeType || 'pcm'),
              sampleFormat: String(ttsArtifact.sampleFormat || defaultAudioTranscodeParams.sampleFormat),
              sampleRate: Number(ttsArtifact.sampleRate || defaultAudioTranscodeParams.sampleRate),
              channelCnt: Number(ttsArtifact.channelCnt || defaultAudioTranscodeParams.channelCnt),
            }
          : audioArtifact
          ? {
              outputFormat: String(audioArtifact.outputFormat || 'pcm'),
              sampleFormat: String(audioArtifact.sampleFormat || defaultAudioTranscodeParams.sampleFormat),
              sampleRate: Number(audioArtifact.sampleRate || defaultAudioTranscodeParams.sampleRate),
              channelCnt: Number(audioArtifact.channelCnt || defaultAudioTranscodeParams.channelCnt),
            }
          : getAudioTranscodeSettings(stepId);
        const result = await electronApi.ipcRenderer.invoke('audio:create-preview', {
          sourcePath: localPath,
          outputFormat: settings.outputFormat,
          sampleFormat: settings.sampleFormat,
          sampleRate: settings.sampleRate,
          channelCnt: settings.channelCnt,
        }) as {
          success: boolean;
          url?: string;
          error?: string;
        };

        if (!result.success || !result.url) {
          setRunMessage(`播放音频失败：${result.error || '未知错误'}`);
          return;
        }

        previewUrl = result.url;
      } catch (error) {
        setRunMessage(`播放音频失败：${error instanceof Error ? error.message : String(error)}`);
        return;
      }
    }

    if (!previewUrl) {
      setRunMessage('当前节点还没有可试听的音频文件');
      return;
    }

    if (!audioPreviewRef.current) {
      audioPreviewRef.current = new Audio();
    }

    audioPreviewRef.current.pause();
    audioPreviewRef.current.src = previewUrl;
    void audioPreviewRef.current.play().catch((error) => {
      setRunMessage(`播放音频失败：${error instanceof Error ? error.message : String(error)}`);
    });
  };

  useEffect(() => {
    const handleNodeAudioPreview = (event: Event) => {
      const stepId = String((event as CustomEvent<{ stepId?: string }>).detail?.stepId || '').trim();
      if (stepId) {
        void playAudioPreview(stepId);
      }
    };

    window.addEventListener('glassbox:workflow-node-play-audio', handleNodeAudioPreview);
    return () => {
      window.removeEventListener('glassbox:workflow-node-play-audio', handleNodeAudioPreview);
    };
  }, [playAudioPreview]);

  const startAudioRecording = async (stepId: string) => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setRunMessage('当前环境不支持电脑录音');
      return;
    }

    try {
      const transcodeSettings = getAudioTranscodeSettings(stepId);

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const preferredMimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/webm')
          ? 'audio/webm'
          : '';
      const recorder = new MediaRecorder(stream, preferredMimeType ? { mimeType: preferredMimeType } : undefined);

      recordingChunksRef.current = [];
      recordingStreamRef.current = stream;
      mediaRecorderRef.current = recorder;
      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordingChunksRef.current.push(event.data);
        }
      };
      recorder.onstop = () => {
        const blob = new Blob(recordingChunksRef.current, { type: recorder.mimeType || 'audio/webm' });
        recordingChunksRef.current = [];
        setRecordingPreview(stepId, blob);
        void saveRecordingBlob(stepId, blob, transcodeSettings).finally(stopRecordingStream);
        mediaRecorderRef.current = null;
        if (recordingStopTimerRef.current !== null) {
          window.clearTimeout(recordingStopTimerRef.current);
          recordingStopTimerRef.current = null;
        }
        setRecordingState(null);
      };
      recorder.start();
      setRecordingState({ stepId, startedAt: Date.now() });
      setRunMessage('录音中，再次点击按钮结束录制');
    } catch (error) {
      stopRecordingStream();
      setRecordingState(null);
      setRunMessage(`录音失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const stopAudioRecording = () => {
    const recorder = mediaRecorderRef.current;

    if (!recorder) {
      setRecordingState(null);
      stopRecordingStream();
      return;
    }

    if (recorder.state !== 'inactive') {
      if (recordingStopTimerRef.current !== null) {
        return;
      }

      const isOggRecorder = recorder.mimeType.toLowerCase().includes('ogg');

      if (isOggRecorder) {
        recorder.stop();
        return;
      }

      try {
        recorder.requestData?.();
      } catch {
        // Some Electron/Chromium builds throw while requestData is already pending.
      }

      recordingStopTimerRef.current = window.setTimeout(() => {
        recordingStopTimerRef.current = null;
        if (recorder.state !== 'inactive') {
          recorder.stop();
        }
      }, recordingStopFlushDelayMs);
    }
  };

  const toggleAudioRecording = (stepId: string) => {
    if (recordingState?.stepId === stepId) {
      stopAudioRecording();
      return;
    }

    if (recordingState) {
      setRunMessage('请先结束当前录音');
      return;
    }

    void startAudioRecording(stepId);
  };

  useEffect(() => () => {
    if (recordingStopTimerRef.current !== null) {
      window.clearTimeout(recordingStopTimerRef.current);
      recordingStopTimerRef.current = null;
    }

    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    stopRecordingStream();
    Object.values(recordingPreviewUrls).forEach((url) => URL.revokeObjectURL(url));
  }, []);

  const getOrderedCaseSteps = (testCase: AutomationCase) => {
    const sourceEdges = testCase.id === selectedCase?.id ? edges : ensureBoundaryEdges(testCase, caseEdges[testCase.id] || []);
    return orderStepsByEdges(testCase.steps, sourceEdges);
  };

  const getWorkflowScrcpyRequirement = (steps: AutomationStep[], options: { ignoreScreenMirror?: boolean; startOptions?: AutomationTaskStartOptions } = {}) => {
    const startStep = steps.find((step) => step.type === 'start');
    const config = {
      ...(startStep?.config || {}),
      ...(options.startOptions || {}),
    };

    if (String(config.recordGlassesScreen ?? true) !== 'false') {
      return '保存眼镜录屏';
    }

    if (String(config.recordPhoneScreen ?? false) !== 'false') {
      return '保存手机录屏';
    }

    if (!options.ignoreScreenMirror && String(config.showGlassesScreen ?? false) !== 'false') {
      return '执行时展示眼镜投屏';
    }

    if (!options.ignoreScreenMirror && String(config.showPhoneScreen ?? false) !== 'false') {
      return '执行时展示手机投屏';
    }

    return '';
  };

  const executeCase = async (testCase: AutomationCase, options: { updateUi: boolean; requestId?: string; disableScreenMirror?: boolean; startOptions?: AutomationTaskStartOptions }) => {
    if (!electronApi?.ipcRenderer) {
      throw new Error('当前环境无法执行工作流');
    }

    const orderedSteps = getOrderedCaseSteps(testCase);
    const canonicalEdges = ensureBoundaryEdges(
      testCase,
      testCase.id === selectedCase?.id ? edges : caseEdges[testCase.id] || stepsToEdges(testCase.steps)
    );
    const assertionVariables = new Map<string, string>();
    for (const step of orderedSteps) {
      if (step.type !== 'component') continue;
      const component = allWorkflowComponents.find((item) => item.id === step.componentId);
      if (!['tts_assert', 'json_assert', 'llm_assert'].includes(component?.kind || '')) continue;
      const params = new Map((component?.params || []).map((param) => [param.key, param.defaultValue]));
      const enabled = String(step.inputs?.extractVariableEnabled ?? step.config?.extractVariableEnabled ?? params.get('extractVariableEnabled') ?? 'false').trim().toLowerCase() === 'true';
      if (!enabled) continue;
      const name = String(step.inputs?.extractVariableName ?? step.config?.extractVariableName ?? params.get('extractVariableName') ?? '').trim();
      if (!name) {
        const error = new Error('断言提取已开启，但变量名为空或仅包含空格。');
        Object.assign(error, {
          errorCode: 'ASSERTION_EXTRACT_VARIABLE_NAME_REQUIRED',
          phase: 'validation',
          node: step.id,
          recoveryActions: ['关闭提取，或填写唯一变量名后重新运行。'],
        });
        throw error;
      }
      const previousStepId = assertionVariables.get(name);
      if (previousStepId) {
        const error = new Error(`断言提取变量名重复：${name}；冲突步骤 ${previousStepId} 与 ${step.id}`);
        Object.assign(error, {
          errorCode: 'ASSERTION_EXTRACT_VARIABLE_NAME_DUPLICATE',
          phase: 'validation',
          node: step.id,
          recoveryActions: ['为同一 case 中每个开启提取的断言填写不同变量名。'],
        });
        throw error;
      }
      assertionVariables.set(name, step.id);
    }
    const scrcpyRequirement = getWorkflowScrcpyRequirement(orderedSteps, {
      ignoreScreenMirror: options.disableScreenMirror,
      startOptions: options.startOptions,
    });
    if (scrcpyRequirement) {
      const ready = await ensureScrcpyForWorkflowOption(scrcpyRequirement);
      if (!ready) {
        throw new Error(`${scrcpyRequirement} 需要先安装 scrcpy`);
      }
    }

    const requestId = options.requestId || `workflow-${Date.now()}-${Math.random().toString(16).slice(2)}`;

    if (options.updateUi) {
      activeWorkflowRequestIdRef.current = requestId;
      activeWorkflowStepIdsRef.current = orderedSteps.map((step) => step.id);
      setRunMessage('工作流执行中...');
      setRunLogs([]);
      setRunArtifacts(null);
      setEdgeRuntimeLabels({});
      setRunLogDisplayMode('compact');
      setRunStatuses(Object.fromEntries(orderedSteps.map((step, index) => [
        step.id,
        index === 0 ? 'running' : 'pending',
      ])));
      restoreWorkflowCanvasView();
    }

    const result = await electronApi.ipcRenderer.invoke('workflow:run', {
      requestId: options.updateUi || options.requestId ? requestId : '',
      testCase: {
        ...testCase,
        steps: orderedSteps,
        edges: canonicalEdges,
        defaults: {
          ...testCase.defaults,
          phoneSerial: selectedPhoneSerial,
          glassesSerial: selectedGlassesSerial,
          phonePackage: selectedPhonePackage,
          glassesPackage: selectedGlassesPackage,
        },
      },
      components: allWorkflowComponents,
      edges: canonicalEdges,
      caseEdges: { [testCase.id]: canonicalEdges },
      llmProviders,
      selectedLlmProviderId,
      disableScreenMirror: Boolean(options.disableScreenMirror),
      startConfigOverride: options.startOptions ? normalizeAutomationTaskStartOptions(options.startOptions) : undefined,
    }) as WorkflowRunResult;

    if (options.updateUi) {
      const normalizedResults = normalizeRunLogsTiming(result.results);
      setRunStatuses(Object.fromEntries(result.results.map((item) => [
        item.stepId,
        item.status === 'success'
          ? 'success'
          : item.status === 'stopped'
            ? 'stopped'
            : item.status === 'failed'
              ? 'failed'
              : 'pending',
      ])));
      setRunLogs(normalizedResults);
      setRunArtifacts(result.artifacts || null);
      setEdgeRuntimeLabels(buildEdgeRuntimeLabels(normalizedResults, edges));
      const mirrorFailure = result.artifacts?.screenMirrors?.find((item) => !item.success);
      setRunMessage(result.stopped
        ? '工作流已强制停止'
        : result.success
          ? mirrorFailure
            ? `工作流执行完成；投屏异常：${mirrorFailure.error || '请查看投屏诊断日志'}`
            : '工作流执行完成'
          : `工作流执行失败：${result.error || '请查看失败节点'}`);
      setFlowRenderVersion((current) => current + 1);
      restoreWorkflowCanvasView();
    }

    return result;
  };

  const stopActiveWorkflow = async () => {
    const requestId = activeWorkflowRequestIdRef.current;

    if (!requestId || !electronApi?.ipcRenderer) {
      return;
    }

    setRunMessage('正在强制停止工作流...');
    await electronApi.ipcRenderer.invoke('workflow:stop', { requestId });
  };

  const runWorkflow = async () => {
    if (runLockRef.current) {
      await stopActiveWorkflow();
      return;
    }

    if (!selectedCase) {
      setRunMessage('当前没有可执行的用例');
      return;
    }

    runLockRef.current = true;
    setIsRunning(true);

    try {
      await executeCase(selectedCase, { updateUi: true });
    } catch (error) {
      setRunMessage(`工作流执行异常：${error instanceof Error ? error.message : String(error)}`);
      setFlowRenderVersion((current) => current + 1);
      restoreWorkflowCanvasView();
    } finally {
      activeWorkflowRequestIdRef.current = '';
      activeWorkflowStepIdsRef.current = [];
      runLockRef.current = false;
      setIsRunning(false);
    }
  };

  const runCaseTask = async (
    taskName: string,
    taskCases: AutomationCase[],
    folderId = '',
    performanceOptions: AutomationTaskPerformanceOptions = {},
    startOptions: AutomationTaskStartOptions = defaultAutomationTaskStartOptions,
    stress?: StressTaskOptions,
    creationSource = 'ui-create',
    sourceTaskId?: string,
  ) => {
    const creation = createTaskCreationAttempt(electronApi, creationSource, {sourceTaskId, caseCount: taskCases.length, folderId, performanceOptions, startConfigOverride: startOptions, devices: {phone: {serial: selectedPhoneSerial}, glasses: {serial: selectedGlassesSerial}}});
    const rejectTask = (error: string, code = 'TASK_REJECTED') => {
      creation.record('rejected', {code});
      setRunMessage(error);
      return { success: false as const, error, creationId: creation.id };
    };
    if (runLockRef.current) {
      return rejectTask('当前有任务正在运行或提交，请等待完成或停止后再创建。', 'TASK_UI_BUSY');
    }

    if (taskCases.length === 0) {
      return rejectTask('请选择至少一个用例创建测试任务', 'TASK_CASES_EMPTY');
    }

    const normalizedPerformanceOptions = normalizeAutomationTaskPerformanceOptions(performanceOptions);
    const normalizedStartOptions = normalizeAutomationTaskStartOptions(startOptions);
    const applyCurrentDeviceDefaults = (testCase: AutomationCase): AutomationCase => ({
      ...testCase,
      defaults: {
        ...testCase.defaults,
        phoneSerial: selectedPhoneSerial,
        glassesSerial: selectedGlassesSerial,
        phonePackage: selectedPhonePackage,
        glassesPackage: selectedGlassesPackage,
      },
    });
    const preparedTaskCases = taskCases.map(applyCurrentDeviceDefaults);
    const canonicalTaskEdges = Object.fromEntries(preparedTaskCases.map((testCase) => [
      testCase.id,
      caseEdges[testCase.id] || (testCase as AutomationCase & { edges?: Edge[] }).edges || [],
    ]));
    runLockRef.current = true;
    setRunMessage(`正在校验测试任务「${taskName}」的全部 ${preparedTaskCases.length} 条用例...`);

    let validation: {
      success: boolean;
      validationErrors?: Array<{ caseId?: string; caseName?: string; node?: string; code?: string; message?: string }>;
      validationWarnings?: unknown[];
      validationSummary?: { selected: number; passed: number; warnings: number; errors: number };
    };
    try {
      if (!electronApi?.ipcRenderer) {
        throw new Error('当前环境无法调用 solopi-desktop CLI 统一校验门禁');
      }
      validation = await electronApi.ipcRenderer.invoke('workflow:validate-task-selection', {
        creationId: creation.id, creationSource: creation.source, sourceTaskId, performanceOptions, startConfigOverride: normalizedStartOptions, folderId,
        cases: preparedTaskCases,
        components: allWorkflowComponents,
        caseEdges: canonicalTaskEdges,
      }) as typeof validation;
    } catch (error) {
      runLockRef.current = false;
      return rejectTask(`任务提交前校验异常：${error instanceof Error ? error.message : String(error)}`, 'VALIDATION_IPC_EXCEPTION');
    }

    if (!validation.success) {
      runLockRef.current = false;
      const firstError = validation.validationErrors?.[0];
      const location = [firstError?.caseName || firstError?.caseId, firstError?.node].filter(Boolean).join(' / ');
      return rejectTask(`任务未提交：${location ? `${location}：` : ''}${firstError?.message || '用例校验失败'}`, firstError?.code || 'TASK_VALIDATION_REJECTED');
    }

    const taskId = `task-${Date.now()}`;
    try {
      const result = await electronApi.ipcRenderer.invoke('workflow-task:submit', {
        creationId: creation.id, creationSource: creation.source, sourceTaskId,
        stress,
        source: 'ui-broker',
        taskId,
        taskName,
        folderId,
        cases: preparedTaskCases.map((testCase) => ({
          ...cloneAutomationCase(testCase),
          edges: ensureBoundaryEdges(
            testCase,
            canonicalTaskEdges[testCase.id] || stepsToEdges(testCase.steps)
          ),
        })),
        components: allWorkflowComponents,
        caseEdges: canonicalTaskEdges,
        llmProviders,
        selectedLlmProviderId,
        devices: {
          phone: {
            runtime: selectedPhoneRuntime,
            serial: selectedPhoneSerial,
            packageName: selectedPhonePackage,
          },
          glasses: {
            runtime: selectedGlassesRuntime,
            serial: selectedGlassesSerial,
            packageName: selectedGlassesPackage,
          },
        },
        performanceOptions: {
          ...normalizedPerformanceOptions,
          targets: {
            phone: {
              runtime: selectedPhoneRuntime,
              serial: selectedPhoneSerial,
              packageName: selectedPhonePackage,
            },
            glasses: {
              runtime: selectedGlassesRuntime,
              serial: selectedGlassesSerial,
              packageName: selectedGlassesPackage,
            },
          },
        },
        startConfigOverride: normalizedStartOptions,
        validationSummary: validation.validationSummary,
      }) as { success?: boolean; taskId?: string; task?: AutomationTaskRecord; error?: string };

      if (!result?.success || !result.taskId || !result.task) {
        throw new Error(result?.error || '主进程未接受测试任务');
      }

      creation.record('accepted', {taskId: result.taskId, code: 'OK'});
      submittedUiTaskIdRef.current = result.taskId;
      setAutomationTasks((current) => mergeAutomationTaskRecords(current, [result.task as AutomationTaskRecord],removedAutomationTaskIdsRef.current));
      setSelectedAutomationTaskId(result.taskId);
      setActiveTab('automation-tasks');
      setIsRunning(true);
      setRunMessage(`测试任务「${taskName}」已提交，正在后台串行执行`);
      return { success: true as const, taskId: result.taskId };
    } catch (error) {
      submittedUiTaskIdRef.current = '';
      runLockRef.current = false;
      setIsRunning(false);
      return rejectTask(`测试任务提交失败：${error instanceof Error ? error.message : String(error)}`, 'SUBMISSION_EXCEPTION');
    }
  };

  const runFolderTask = async (
    folder: CaseFolder,
    performanceOptions: AutomationTaskPerformanceOptions = {},
    startOptions: AutomationTaskStartOptions = defaultAutomationTaskStartOptions,
  ) => {
    const folderIds = collectFolderTreeIds(folder.id);
    const folderCases = cases.filter((testCase) => folderIds.has(getCaseFolderId(testCase)));

    if (folderCases.length === 0) {
      const error = `文件夹「${folder.name}」下暂无用例`;
      setRunMessage(error);
      return { success: false as const, error };
    }

    const taskName = `${folder.name} · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    return runCaseTask(taskName, folderCases, folder.id, performanceOptions, startOptions, undefined, 'ui-quick');
  };

  const stopAutomationTask = async (taskId: string) => {
    if (!electronApi?.ipcRenderer || taskStopPendingRef.current.has(taskId)) return;
    taskStopPendingRef.current.add(taskId);
    setTaskStopPending(new Set(taskStopPendingRef.current));
    setTaskStopFeedback(current => ({ ...current, [taskId]: '正在发送停止请求…' }));
    try {
      // Task execution belongs to the main process, including tasks started in this UI.
      const result = await electronApi.ipcRenderer.invoke('workflow-task:stop', { taskId, force: false }) as { success?: boolean; error?: string; message?: string };
      if (!result?.success) throw new Error(result?.error || '任务不在当前进程中运行');
      setTaskStopFeedback(current => ({ ...current, [taskId]: '停止请求已接收，正在结束执行并整理录屏、报告…' }));
      setAutomationTasks(current => current.map(task => task.id === taskId && isAutomationTaskActive(task) ? { ...task, status: 'stopping' } : task));
    } catch (error) {
      setTaskStopFeedback(current => ({ ...current, [taskId]: `停止失败：${error instanceof Error ? error.message : String(error)}，可再次点击停止重试` }));
    } finally {
      taskStopPendingRef.current.delete(taskId);
      setTaskStopPending(new Set(taskStopPendingRef.current));
    }
  };

  const openTaskActionReport = (taskId: string) => {
    setSelectedAutomationTaskId(taskId);
    setActiveTab('automation-task-report');
  };

  const loadAutomationTaskForRerun = async (task: AutomationTaskRecord) => {
    if (!electronApi?.ipcRenderer) throw new Error('当前环境无法加载重跑所需的报告详情');
    const detail = await loadTaskForFailedRerun(task, () => electronApi.ipcRenderer.invoke('workflow-report:load-task', {
      taskId: task.id,
      reportDetailPath: task.reportDetailPath,
    }));
    setAutomationTasks(current => mergeAutomationTaskRecords(current, [detail], removedAutomationTaskIdsRef.current));
    return detail;
  };

  const rerunAutomationTask = (task: AutomationTaskRecord) => void runTaskAction(task.id, '重跑', async () => {
    if (task.readonly || isAutomationTaskActive(task)) return { success: false, error: task.readonly ? '只读报告不能重跑。' : '原任务仍在执行，请等待完成或停止后再重跑。' };
    const performanceOptions = normalizeAutomationTaskPerformanceOptions(task.performanceOptions);
    const startOptions = normalizeAutomationTaskStartOptions(task.startOptions);
    const taskCases = (task.caseIds || [])
      .map((caseId) => cases.find((testCase) => testCase.id === caseId))
      .filter(Boolean) as AutomationCase[];
    if (taskCases.length > 0) return runCaseTask(`${task.name} · 重跑`, taskCases, task.folderId, performanceOptions, startOptions, task.stress, 'ui-rerun', task.id);
    const folder = caseLibraryFolders.find((item) => item.id === task.folderId);
    if (!folder) return { success: false, error: `未找到任务用例：${task.name}` };
    const folderIds = collectFolderTreeIds(folder.id);
    const folderCases = cases.filter((testCase) => folderIds.has(getCaseFolderId(testCase)));
    return runCaseTask(`${task.name} · 重跑`, folderCases, task.folderId, performanceOptions, startOptions, task.stress, 'ui-rerun', task.id);
  });

  const rerunFailedAutomationTask = (task: AutomationTaskRecord) => void runTaskAction(task.id, '重跑失败用例', async () => {
    if (task.readonly || isAutomationTaskActive(task)) return { success: false, error: task.readonly ? '只读报告不能重跑。' : '原任务仍在执行，请等待完成或停止后再重跑。' };
    task = await loadAutomationTaskForRerun(task);
    if (task.readonly || isAutomationTaskActive(task)) return { success: false, error: task.readonly ? '只读报告不能重跑。' : '原任务仍在执行，请等待完成或停止后再重跑。' };
    const performanceOptions = normalizeAutomationTaskPerformanceOptions(task.performanceOptions);
    const startOptions = normalizeAutomationTaskStartOptions(task.startOptions);
    const failedCaseRecords = (task.cases || []).filter((caseRecord) => caseRecord.status === 'failed');
    if (failedCaseRecords.length === 0) return { success: false, error: `测试任务「${task.name}」没有失败用例可重跑` };
    const taskCases = failedCaseRecords
      .map((caseRecord) => cases.find((testCase) => testCase.id === caseRecord.caseId) || caseRecord.caseSnapshot)
      .filter(Boolean)
      .map((testCase) => cloneAutomationCase(testCase as AutomationCase));
    if (taskCases.length !== failedCaseRecords.length) return { success: false, error: `未找到测试任务「${task.name}」中的全部失败用例，已取消提交以避免漏跑` };
    return runCaseTask(`${task.name} · 重跑失败`, taskCases, task.folderId, performanceOptions, startOptions, undefined, 'ui-rerun-failed', task.id);
  });

  const onNodeClick = useCallback((_event: React.MouseEvent, node: Node) => {
    selectStep(node.id);
  }, [selectedCase, selectedStepId, allWorkflowComponents, isConfigPanelOpen]);

  const openCaseFlow = (
    testCase: AutomationCase,
    options: {
      source?: FlowReturnTarget;
      snapshot?: AutomationCase | null;
      edges?: Edge[] | null;
      logs?: WorkflowRunLog[];
      artifacts?: WorkflowRunResult['artifacts'] | null;
      preserveRunState?: boolean;
      deferRender?: boolean;
    } = {}
  ) => {
    const applyFlowOpen = () => {
      const folderId = getCaseFolderId(testCase);
      const folder = caseLibraryFolders.find((item) => item.id === folderId);
      const normalizedLogs = normalizeRunLogsTiming(options.logs || []);

      setFlowCaseSnapshot(options.snapshot || null);
      setFlowCaseEdgesSnapshot(options.edges || null);
      setFlowReturnTarget(options.source || { tab: 'automation-cases' });
      setSelectedCaseLibraryId(getFolderLibraryId(folder));
      setSelectedCaseFolderId(folderId);
      setSelectedCaseId(testCase.id);
      setSelectedStepId(testCase.steps[0]?.id || '');
      setConfigDraft(JSON.stringify(testCase.steps[0]?.config || {}, null, 2));
      setIsConfigPanelOpen(true);
      if (options.preserveRunState) {
        setRunLogs(normalizedLogs);
        setRunArtifacts(options.artifacts || null);
        setRunStatuses(Object.fromEntries(normalizedLogs.map((item) => [
          item.stepId,
          item.status === 'success' ? 'success' : item.status === 'stopped' ? 'stopped' : 'failed',
        ])));
        setEdgeRuntimeLabels(buildEdgeRuntimeLabels(normalizedLogs, ensureBoundaryEdges(testCase, options.edges || caseEdges[testCase.id] || [])));
      } else {
        setRunLogs([]);
        setRunArtifacts(null);
        setRunStatuses({});
        setEdgeRuntimeLabels({});
        setRunMessage('');
      }
      setActiveTab('automation-flow');
      setIsFlowOpening(false);
    };

    if (options.deferRender) {
      // Report previews may take two animation frames to build a large graph. Keep
      // a complete case identity available before switching tabs so the interim
      // render never reads a stale library selection or an empty case list.
      setFlowCaseSnapshot(options.snapshot || cloneAutomationCase(testCase));
      setFlowCaseEdgesSnapshot(options.edges || null);
      setFlowReturnTarget(options.source || { tab: 'automation-cases' });
      setSelectedCaseId(testCase.id);
      setSelectedStepId(testCase.steps[0]?.id || '');
      setIsFlowOpening(true);
      setNodes([]);
      setEdges([]);
      setActiveTab('automation-flow');
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(applyFlowOpen);
      });
      return;
    }

    applyFlowOpen();
  };

  const handleFlowBack = () => {
    if (flowReturnTarget.tab === 'automation-task-report') {
      setSelectedAutomationTaskId(flowReturnTarget.taskId);
      setFlowCaseSnapshot(null);
      setFlowCaseEdgesSnapshot(null);
      setActiveTab('automation-task-report');
      return;
    }

    if (flowReturnTarget.tab === 'automation-tasks') {
      setFlowCaseSnapshot(null);
      setFlowCaseEdgesSnapshot(null);
      setActiveTab('automation-tasks');
      return;
    }

    if (flowReturnTarget.tab === 'automation-flow-report-preview') {
      const task = automationTasks.find((item) => item.id === flowReturnTarget.taskId);
      const caseRecord = task?.cases?.find((item) => item.caseId === flowReturnTarget.caseId);
      const targetCase = caseRecord?.caseSnapshot || cases.find((testCase) => testCase.id === caseRecord?.caseId);

      if (task && caseRecord && targetCase) {
        try {
          const normalizedCase = normalizeReportCaseForPreview(targetCase);
          openCaseFlow(normalizedCase, {
            source: { tab: 'automation-task-report', taskId: task.id },
            snapshot: normalizedCase,
            edges: caseRecord.edges || caseEdges[caseRecord.caseId] || stepsToEdges(normalizedCase.steps),
            logs: caseRecord.results || [],
            artifacts: caseRecord.artifacts || null,
            preserveRunState: true,
            deferRender: true,
          });
          setRunMessage(`查看测试任务「${task.name}」中的用例：${caseRecord.caseName}`);
          return;
        } catch (error) {
          setRunMessage(`报告用例无法打开，已保留在报告页：${error instanceof Error ? error.message : String(error)}`);
        }
      }

      setFlowCaseSnapshot(null);
      setFlowCaseEdgesSnapshot(null);
      setSelectedAutomationTaskId(flowReturnTarget.taskId);
      setActiveTab('automation-task-report');
      return;
    }

    setFlowCaseSnapshot(null);
    setFlowCaseEdgesSnapshot(null);
    setActiveTab('automation-cases');
  };

  const openEditableCaseFromReport = () => {
    if (!isReportFlowReadOnly || !selectedCase) {
      return;
    }

    const editableCase = cases.find((testCase) => testCase.id === selectedCase.id);

    if (!editableCase) {
      setRunMessage(`用例库中未找到原用例：${selectedCase.name}`);
      return;
    }

    openCaseFlow(editableCase, {
      source: flowReturnTarget.tab === 'automation-task-report'
        ? { tab: 'automation-flow-report-preview', taskId: flowReturnTarget.taskId, caseId: selectedCase.id }
        : { tab: 'automation-cases' },
    });
    setRunMessage(`已打开可编辑用例：${editableCase.name}`);
  };

  const getFolderTreeCaseCount = (folderId: string) => {
    const folderIds = collectFolderTreeIds(folderId);
    return filteredCases.filter((testCase) => folderIds.has(getCaseFolderId(testCase))).length;
  };

  const renderSidebarCase = (testCase: AutomationCase) => (
    <div
      key={testCase.id}
      draggable={editingName?.id !== testCase.id}
      onDragStart={(event) => beginCaseTreeNativeDrag(event, { type: 'case', id: testCase.id })}
      onDragEnd={() => {
        setCaseTreeDragItem(null);
        setCaseTreeDropTarget(null);
        setCaseTreeDragPosition(null);
      }}
      onMouseDown={(event) => {
        event.stopPropagation();
        const target = event.target as HTMLElement;
        if (target.closest('[data-tree-action="true"]') || target.closest('input')) {
          return;
        }
        beginCaseTreeLongPress({ type: 'case', id: testCase.id }, { x: event.clientX, y: event.clientY });
      }}
      onMouseUp={(event) => {
        event.stopPropagation();
        cancelCaseTreeLongPress();
      }}
      onMouseLeave={(event) => {
        event.stopPropagation();
        cancelCaseTreeLongPress();
      }}
      className={`group/case relative flex items-center rounded-lg ${selectedCaseId === testCase.id ? 'bg-blue-50 text-blue-600' : 'text-slate-500 hover:bg-slate-50 hover:text-slate-900'}`}
    >
      <button
        type="button"
        title={testCase.name}
        onClick={() => {
          if (caseTreeDragFinishedRef.current) {
            return;
          }
          openCaseFlow(testCase);
        }}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 pr-8 text-left"
      >
        <ListChecks className="h-3.5 w-3.5 shrink-0" />
        {editingName?.type === 'case' && editingName.id === testCase.id ? (
          <input
            autoFocus
            value={editingName.value}
            onClick={(event) => event.stopPropagation()}
            onChange={(event) => setEditingName({ ...editingName, value: event.target.value })}
            onBlur={commitInlineEditingName}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitInlineEditingName();
              if (event.key === 'Escape') setEditingName(null);
            }}
            className="h-6 min-w-0 flex-1 rounded-md border border-blue-200 bg-white px-2 text-xs font-bold text-slate-800 outline-none"
          />
        ) : (
          <span
            onDoubleClick={(event) => {
              event.stopPropagation();
              setEditingName({ type: 'case', id: testCase.id, value: testCase.name });
            }}
            className="min-w-0 flex-1 truncate text-xs font-bold"
            title={`${testCase.name}（双击重命名）`}
          >
            {testCase.name}
          </span>
        )}
      </button>
      <button
        type="button"
        data-tree-action="true"
        onClick={(event) => {
          event.stopPropagation();
          setCaseActionMenuFor(caseActionMenuFor === `case:${testCase.id}` ? null : `case:${testCase.id}`);
          setCaseCreateMenuFor(null);
        }}
        className="absolute right-1 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 opacity-0 hover:bg-white hover:text-slate-700 group-hover/case:opacity-100"
        title="更多操作"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>
      {caseActionMenuFor === `case:${testCase.id}` && (
        <div className="absolute right-1 top-8 z-20 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold text-slate-600 shadow-xl">
          <button
            type="button"
            data-tree-action="true"
            onClick={() => duplicateCase(testCase.id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
          >
            <Copy className="h-3.5 w-3.5" />
            复制用例
          </button>
          <button
            type="button"
            data-tree-action="true"
            onClick={() => deleteCase(testCase.id)}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
          >
            <Trash2 className="h-3.5 w-3.5" />
            删除用例
          </button>
        </div>
      )}
    </div>
  );

  const renderSidebarFolder = (folder: CaseFolder, library: CaseLibrary, depth = 0): React.ReactNode => {
    const folderCases = casesByFolder.get(folder.id) || [];
    const childFolders = visibleChildFoldersByParent.get(folder.id) || [];
    const isSelectedFolder = selectedCaseFolderId === folder.id;
    const isExpanded = folder.expanded !== false;
    const folderCaseCount = getFolderTreeCaseCount(folder.id);
    const createMenuKey = `folder:${folder.id}`;
    const actionMenuKey = `folder:${folder.id}`;
    const dropTargetKey = `folder:${folder.id}`;

    return (
      <div
        key={folder.id}
        data-case-tree-drop-type="folder"
        data-case-tree-drop-id={folder.id}
        draggable={editingName?.id !== folder.id}
        onDragStart={(event) => beginCaseTreeNativeDrag(event, { type: 'folder', id: folder.id })}
        onDragOver={(event) => handleCaseTreeDragOver(event, { type: 'folder', id: folder.id })}
        onDragLeave={(event) => {
          event.stopPropagation();
          setCaseTreeDropTarget((current) => (current === dropTargetKey ? null : current));
        }}
        onDrop={(event) => handleCaseTreeDrop(event, { type: 'folder', id: folder.id })}
        onDragEnd={() => {
          setCaseTreeDragItem(null);
          setCaseTreeDropTarget(null);
          setCaseTreeDragPosition(null);
        }}
        onMouseDown={(event) => {
          const target = event.target as HTMLElement;
          if (target.closest('[data-tree-action="true"]') || target.closest('input')) {
            return;
          }
          beginCaseTreeLongPress({ type: 'folder', id: folder.id }, { x: event.clientX, y: event.clientY });
        }}
        onMouseUp={cancelCaseTreeLongPress}
        onMouseLeave={cancelCaseTreeLongPress}
        className={depth > 0 ? 'mt-1' : undefined}
      >
        <div className={`group/folder relative flex items-center rounded-lg px-2 py-1.5 ${caseTreeDropTarget === dropTargetKey ? 'bg-blue-50 ring-1 ring-blue-200' : isSelectedFolder ? 'bg-slate-100' : 'hover:bg-slate-50'}`}>
          <button
            type="button"
            title={folder.name}
            onClick={() => {
              if (caseTreeDragFinishedRef.current) {
                return;
              }
              setSelectedCaseLibraryId(library.id);
              setSelectedCaseFolderId(folder.id);
              setCaseLibraryViewMode('folder');
              toggleCaseFolder(folder.id);
            }}
            className="flex min-w-0 flex-1 items-center gap-1.5 pr-20 text-left"
          >
            <CaseTreeDisclosure expanded={isExpanded} />
            <Folder className="h-4 w-4 shrink-0 text-slate-500" />
            {editingName?.type === 'folder' && editingName.id === folder.id ? (
              <input
                autoFocus
                value={editingName.value}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => setEditingName({ ...editingName, value: event.target.value })}
                onBlur={commitInlineEditingName}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') commitInlineEditingName();
                  if (event.key === 'Escape') setEditingName(null);
                }}
                className="h-6 min-w-0 flex-1 rounded-md border border-blue-200 bg-white px-2 text-xs font-bold text-slate-800 outline-none"
              />
            ) : (
              <span
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  setEditingName({ type: 'folder', id: folder.id, value: folder.name });
                }}
                className="min-w-0 flex-1 truncate text-xs font-black text-slate-700"
                title={`${folder.name}（双击重命名）`}
              >
                {folder.name}
              </span>
            )}
            <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-400">{folderCaseCount}</span>
          </button>
          <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-white/90 shadow-sm group-hover/folder:flex">
            <button
              type="button"
              data-tree-action="true"
              onClick={(event) => {
                event.stopPropagation();
                setCaseCreateMenuFor(caseCreateMenuFor === createMenuKey ? null : createMenuKey);
                setCaseActionMenuFor(null);
              }}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
              title="新建"
            >
              <Plus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-tree-action="true"
              onClick={(event) => {
                event.stopPropagation();
                setCaseActionMenuFor(caseActionMenuFor === actionMenuKey ? null : actionMenuKey);
                setCaseCreateMenuFor(null);
              }}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
              title="更多操作"
            >
              <MoreHorizontal className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              data-tree-action="true"
              onMouseDown={(event) => {
                event.preventDefault();
                event.stopPropagation();
              }}
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setCaseCreateMenuFor(null);
                setCaseActionMenuFor(null);
                setQuickTaskCreateError('');
                setQuickTaskPerformanceDialog({
                  folderId: folder.id,
                  folderName: folder.name,
                  collectPhonePerformance: false,
                  collectGlassesPerformance: false,
                  startOptions: defaultAutomationTaskStartOptions,
                });
              }}
              disabled={isRunning || folderCaseCount === 0}
              className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30"
              title="快速创建测试任务"
            >
              <Rocket className="h-3.5 w-3.5" />
            </button>
          </div>
          {caseActionMenuFor === actionMenuKey && (
            <div className="absolute right-1 top-8 z-20 w-32 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold text-slate-600 shadow-xl">
              <button
                type="button"
                data-tree-action="true"
                onClick={() => setExportFolderDialog({ folderId: folder.id })}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
              >
                <FileDown className="h-3.5 w-3.5" />
                导出文件夹
              </button>
              <button
                type="button"
                data-tree-action="true"
                onClick={() => deleteFolder(folder.id)}
                className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除文件夹
              </button>
            </div>
          )}
        </div>
        {caseCreateMenuFor === createMenuKey && (
          <div className="ml-9 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold text-slate-600 shadow-xl">
            <button type="button" data-tree-action="true" onClick={() => createCaseFolder(library.id, folder.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
              <FolderPlus className="h-3.5 w-3.5" />
              新建文件夹
            </button>
            <button type="button" data-tree-action="true" onClick={() => createCase(folder.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
              <FilePlus className="h-3.5 w-3.5" />
              新建用例
            </button>
            <button type="button" data-tree-action="true" onClick={() => openFolderImport(folder.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
              <FileUp className="h-3.5 w-3.5" />
              导入用例
            </button>
            <button type="button" data-tree-action="true" onClick={() => { setSoloPiDialog({ mode: 'import', folderId: folder.id, libraryId: library.id }); setCaseCreateMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">导入 SoloPi 用例</button>
            <button type="button" data-tree-action="true" onClick={() => { setSoloPiDialog({ mode: 'record', folderId: folder.id, libraryId: library.id }); setCaseCreateMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">SoloPi 录制生成</button>
          </div>
        )}
        {isExpanded && (
          <div className="ml-3 mt-1 space-y-0.5 border-l border-slate-100 pl-2">
            {childFolders.map((childFolder) => renderSidebarFolder(childFolder, library, depth + 1))}
            {folderCases.map((testCase) => renderSidebarCase(testCase))}
          </div>
        )}
      </div>
    );
  };

  const caseTreeDragLabel = useMemo(() => {
    if (!caseTreeDragItem) {
      return '';
    }

    if (caseTreeDragItem.type === 'case') {
      return cases.find((testCase) => testCase.id === caseTreeDragItem.id)?.name || '移动用例';
    }

    return caseLibraryFolders.find((folder) => folder.id === caseTreeDragItem.id)?.name || '移动文件夹';
  }, [caseTreeDragItem, cases, caseLibraryFolders]);

  const renderLocalCaseLibraryChangeBanner = () => {
    if (!pendingLocalCaseLibraryChange || pendingLocalCaseLibraryChange.libraryId !== selectedCaseLibraryId) {
      return null;
    }
    const library = normalizedCaseLibraries.find((item) => item.id === pendingLocalCaseLibraryChange.libraryId);
    if (!library) return null;
    const isConflict = pendingLocalCaseLibraryChange.errorCode === 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT';
    const isError = pendingLocalCaseLibraryChange.type !== 'library-changed';
    const missingDirectory = pendingLocalCaseLibraryChange.errorCode === 'CASE_LIBRARY_LOCAL_REPO_NOT_FOUND';
    return (
      <div className={`flex min-w-0 items-start justify-between gap-4 border-b px-5 py-3 ${
        isError
          ? 'border-rose-200 bg-rose-50 text-rose-900'
          : 'border-amber-200 bg-amber-50 text-amber-950'
      }`}>
        <div className="flex min-w-0 items-start gap-3">
          <AlertTriangle className={`mt-0.5 h-4 w-4 shrink-0 ${isError ? 'text-rose-600' : 'text-amber-600'}`} />
          <div className="min-w-0">
            <div className="text-xs font-black">
              「{library.name}」{isConflict ? '用例版本冲突，已保留当前修改' : isError ? (missingDirectory ? '本地仓库目录不存在' : '本地用例读取失败') : '检测到本地用例更新'}
            </div>
            {isError && <div className="mt-1 text-[11px] opacity-80">{isConflict ? '当前版本已保存到应用。请先核对并同步用例库；刷新不会覆盖已保存修改。' : <>当前页面内容未清空；此提示不表示编辑已保存到磁盘。{missingDirectory ? '请检查仓库地址和分支，或重新拉取。' : '请修复文件后重试。'}</>}</div>}
            <div className="mt-1 break-words text-[11px] font-medium opacity-80">
              {isError
                ? pendingLocalCaseLibraryChange.error || '请检查本地用例文件后重试'
                : `「${pendingLocalCaseLibraryChange.libraryName || pendingLocalCaseLibraryChange.libraryId}」已有新 revision，当前未保存编辑不会被自动覆盖。`}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            disabled={isPullingCaseLibrary || isRefreshingCaseLibrary}
            onClick={() => {
              if (!missingDirectory) { confirmPendingLocalCaseLibraryChange(); return; }
              if (caseLibraryEditorDirtyRef.current && !window.confirm('重新拉取会更新该库的页面内容。请确认已保存或备份编辑，是否继续？')) return;
              void pullRemoteCases(library).then((success) => {
                if (success) setPendingLocalCaseLibraryChange((current) => current?.libraryId === library.id ? null : current);
              });
            }}
            className={`rounded-lg px-3 py-1.5 text-[11px] font-black text-white ${
              isError ? 'bg-rose-600 hover:bg-rose-700' : 'bg-amber-600 hover:bg-amber-700'
            }`}
          >
            {isPullingCaseLibrary ? '拉取中…' : isRefreshingCaseLibrary ? '读取中…' : missingDirectory ? '重新拉取' : isConflict ? '重新比较' : isError ? '重新读取' : '刷新'}
          </button>
          {isError && !isConflict && <button type="button" className="rounded-lg border border-current/20 bg-white/70 px-3 py-1.5 text-[11px] font-black"
            onClick={() => {
              setGitConfigError('');
              setGitConfigDialog({ libraryId: library.id, value: library.repoUrl || '', branch: getConfiguredGitBranch(library),
                authUsername: library.authUsername || '', authToken: library.authToken || '', sshKeyPath: library.sshKeyPath || '', sshPassphrase: '', intent: 'pull' });
            }}>检查配置</button>}
          <button
            type="button"
            onClick={() => setPendingLocalCaseLibraryChange(null)}
            className="rounded-lg border border-current/20 bg-white/70 px-3 py-1.5 text-[11px] font-black hover:bg-white"
          >
            稍后
          </button>
        </div>
      </div>
    );
  };

  const renderAutomationCases = () => (
    <div className="flex min-h-0 flex-1 bg-slate-50">
      <aside className={`flex shrink-0 flex-col border-r border-slate-200 bg-white transition-[width] duration-200 ${isMainSidebarCollapsed ? 'w-64' : 'w-72'}`}>
        <input
          ref={caseLibraryImportInputRef}
          type="file"
          accept=".json,.yaml,.yml,application/json,text/yaml"
          className="hidden"
          onChange={(event) => {
            const file = event.target.files?.[0];
            if (file) {
              void importCasesToFolder(file, caseLibraryImportFolderIdRef.current);
            }
          }}
        />
        <div className="border-b border-slate-100 px-4 py-4">
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <Folder className="h-4 w-4 text-blue-600" />
              <h2 className="truncate text-sm font-black text-slate-900">用例库</h2>
            </div>
            <div className="relative flex items-center gap-1">
              <button
                type="button"
                onClick={createCaseLibrary}
                className="rounded-lg p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900"
                title="新建用例库"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
            <Search className="h-4 w-4 text-slate-400" />
            <input
              value={caseSearch}
              onChange={(event) => setCaseSearch(event.target.value)}
              placeholder="搜索名称 / tag"
              className="h-7 min-w-0 flex-1 bg-transparent text-xs font-bold text-slate-700 outline-none placeholder:text-slate-400"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-auto px-2 py-3">
          {normalizedCaseLibraries.map((library) => {
            const libraryFolders = childFoldersByParent.get(`library:${library.id}`) || [];
            const libraryFolderIds = new Set((foldersByLibrary.get(library.id) || []).map((folder) => folder.id));
            const libraryCaseCount = filteredCases.filter((testCase) => libraryFolderIds.has(getCaseFolderId(testCase))).length;
            const isSelectedLibrary = selectedCaseLibraryId === library.id;
            const isLibraryExpanded = library.expanded !== false;
            const libraryDropTargetKey = `library:${library.id}`;
            const libraryActionMenuKey = `library:${library.id}`;

            return (
              <div key={library.id} className="mb-2">
                <div
                  data-case-tree-drop-type="library"
                  data-case-tree-drop-id={library.id}
                  onDragOver={(event) => handleCaseTreeDragOver(event, { type: 'library', id: library.id })}
                  onDragLeave={(event) => {
                    event.stopPropagation();
                    setCaseTreeDropTarget((current) => (current === libraryDropTargetKey ? null : current));
                  }}
                  onDrop={(event) => handleCaseTreeDrop(event, { type: 'library', id: library.id })}
                  className={`group/library relative flex items-center rounded-lg px-2 py-1.5 ${caseTreeDropTarget === libraryDropTargetKey ? 'bg-blue-50 ring-1 ring-blue-200' : isSelectedLibrary ? 'bg-slate-100' : 'hover:bg-slate-50'}`}
                >
                  <button
                    type="button"
                    title={library.name}
                    onClick={() => {
                      if (caseTreeDragFinishedRef.current) {
                        return;
                      }
                      setSelectedCaseLibraryId(library.id);
                      const firstFolder = libraryFolders[0];
                      if (firstFolder) {
                        setSelectedCaseFolderId(firstFolder.id);
                      }
                      setCaseLibraryViewMode('library');
                      setCaseLibraries((current) => current.map((item) => (
                        item.id === library.id ? { ...item, expanded: item.expanded === false } : item
                      )));
                    }}
                    className="flex min-w-0 flex-1 items-center gap-1.5 pr-24 text-left"
                  >
                    <CaseTreeDisclosure expanded={isLibraryExpanded} />
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-md ${
                      library.repoUrl ? 'bg-blue-600 text-white shadow-sm' : 'border border-dashed border-slate-300 bg-slate-50 text-slate-400'
                    }`}>
                      <GitBranch className="h-3.5 w-3.5" />
                    </span>
                    {editingName?.type === 'library' && editingName.id === library.id ? (
                      <input
                        autoFocus
                        value={editingName.value}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditingName({ ...editingName, value: event.target.value })}
                        onBlur={commitInlineEditingName}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitInlineEditingName();
                          if (event.key === 'Escape') setEditingName(null);
                        }}
                        className="h-6 min-w-0 flex-1 rounded-md border border-blue-200 bg-white px-2 text-xs font-black text-slate-800 outline-none"
                      />
                    ) : (
                      <span
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setEditingName({ type: 'library', id: library.id, value: library.name });
                        }}
                        className="min-w-0 flex-1 truncate text-xs font-black text-slate-800"
                        title={`${library.name}（双击重命名）`}
                      >
                        {library.name}
                      </span>
                    )}
                    <span className="shrink-0 rounded-full bg-white px-1.5 py-0.5 text-[10px] font-black text-slate-400">{libraryCaseCount}</span>
                  </button>
                  <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-lg bg-white/90 shadow-sm group-hover/library:flex">
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={() => setCaseCreateMenuFor(caseCreateMenuFor === `library:${library.id}` ? null : `library:${library.id}`)}
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                      title="新建"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={() => void pullRemoteCases(library)}
                      disabled={isPullingCaseLibrary}
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-blue-600 disabled:cursor-not-allowed disabled:opacity-30"
                      title="从云端拉取"
                    >
                      <CloudDownload className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={() => void pushCaseLibrary(library)}
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-emerald-600"
                      title="上传到云端"
                    >
                      <CloudUpload className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={(event) => {
                        event.stopPropagation();
                        setCaseActionMenuFor(caseActionMenuFor === libraryActionMenuKey ? null : libraryActionMenuKey);
                        setCaseCreateMenuFor(null);
                      }}
                      className="rounded-md p-1 text-slate-400 hover:bg-white hover:text-slate-700"
                      title="更多操作"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                {caseActionMenuFor === libraryActionMenuKey && (
                  <div className="ml-9 mt-1 w-40 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold text-slate-600 shadow-xl">
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={() => {
                        if (!library.repoUrl) {
                          warnMissingLibraryGit(library, 'auto');
                          return;
                        }
                        setCaseLibraries((current) => current.map((item) => (
                          item.id === library.id ? { ...item, autoUpdate: !item.autoUpdate } : item
                        )));
                        setCaseActionMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <Zap className={`h-3.5 w-3.5 ${library.autoUpdate ? 'text-blue-600' : 'text-slate-400'}`} />
                      {library.autoUpdate ? '关闭自动更新' : '开启自动更新'}
                    </button>
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={() => {
                        setGitConfigDialog({
                          libraryId: library.id,
                          value: library.repoUrl || '',
                          authUsername: library.authUsername || '',
                          authToken: library.authToken || '',
                          sshKeyPath: library.sshKeyPath || '',
                          sshPassphrase: library.sshPassphrase || '',
                          branch: getConfiguredGitBranch(library),
                          intent: 'pull',
                        });
                        setGitConfigError('');
                        setCaseActionMenuFor(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50"
                    >
                      <GitBranch className="h-3.5 w-3.5" />
                      Git配置
                    </button>
                    <button
                      type="button"
                      data-tree-action="true"
                      onClick={() => deleteCaseLibraryLocal(library.id)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-rose-600 hover:bg-rose-50"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      删除当前库
                    </button>
                  </div>
                )}
                {caseCreateMenuFor === `library:${library.id}` && (
                  <div className="ml-9 mt-1 w-36 overflow-hidden rounded-xl border border-slate-200 bg-white p-1 text-xs font-bold text-slate-600 shadow-xl">
                    <button type="button" onClick={() => createCaseFolder(library.id)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                      <FolderPlus className="h-3.5 w-3.5" />
                      新建文件夹
                    </button>
                    <button type="button" onClick={() => createCase(libraryFolders[0]?.id || DEFAULT_CASE_FOLDER_ID)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                      <FilePlus className="h-3.5 w-3.5" />
                      新建用例
                    </button>
                    <button type="button" onClick={() => openFolderImport(libraryFolders[0]?.id || DEFAULT_CASE_FOLDER_ID)} className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-slate-50">
                      <FileUp className="h-3.5 w-3.5" />
                      导入用例
                    </button>
                    <button type="button" onClick={() => { setSoloPiDialog({ mode: 'import', folderId: libraryFolders[0]?.id || DEFAULT_CASE_FOLDER_ID, libraryId: library.id }); setCaseCreateMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">导入 SoloPi 用例</button>
                    <button type="button" onClick={() => { setSoloPiDialog({ mode: 'record', folderId: libraryFolders[0]?.id || DEFAULT_CASE_FOLDER_ID, libraryId: library.id }); setCaseCreateMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left hover:bg-slate-50">SoloPi 录制生成</button>
                  </div>
                )}
                {isLibraryExpanded && (
                  <div className="ml-3 mt-1 space-y-1 border-l border-slate-100 pl-2">
                    {libraryFolders.map((folder) => renderSidebarFolder(folder, library))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-auto p-6">
        <div className="mx-auto max-w-6xl">
          {renderLocalCaseLibraryChangeBanner()}
          <div className="flex items-center justify-between gap-4">
            <div className="min-w-0">
              <h2 className="truncate text-lg font-black text-slate-900">
                {caseLibraryViewMode === 'library' ? selectedCaseLibrary?.name : selectedFolder?.name || '用例库'}
              </h2>
              <p className="mt-1 text-xs font-medium text-slate-500">
                {caseLibraryViewMode === 'library'
                  ? '当前展示库信息和一级文件夹。点击文件夹进入文件夹视图。'
                  : '当前展示子文件夹和用例。可按名称或 tag 搜索用例。'}
              </p>
            </div>
            <button
              type="button"
              data-testid="case-library-overview-refresh"
              onClick={() => void refreshSelectedCaseLibrary()}
              disabled={isRefreshingCaseLibrary}
              className="inline-flex h-9 shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 text-xs font-black text-slate-600 shadow-sm transition-all hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
              title="重新读取当前本地用例库 JSON/YAML；不会执行 Git pull 或 push"
            >
              {isRefreshingCaseLibrary ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isRefreshingCaseLibrary ? '刷新中' : '刷新用例'}
            </button>
          </div>

          {caseLibraryViewMode === 'library' && (
            <div className="mt-5 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-start gap-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white">
                  <GitBranch className="h-4 w-4" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <div className="text-xs font-black uppercase tracking-widest text-slate-400">Team Case Library</div>
                    {!selectedCaseLibrary?.repoUrl && (
                      <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-black text-amber-600">未配置 Git</span>
                    )}
                    {selectedCaseLibrary?.autoUpdate && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-black text-blue-600">自动更新</span>
                    )}
                  </div>
                  <div className="mt-2 min-h-9 w-full truncate rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-bold text-slate-800">
                    {selectedCaseLibrary?.repoUrl || '未配置 Git 用例库地址，点击左侧库节点的拉取/上传会引导配置'}
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">当前分支</div>
                      <div className="mt-1 truncate text-xs font-black text-slate-700">{selectedCaseLibrary?.branch || selectedCaseLibrary?.gitBranch || '未同步'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">最新更新时间</div>
                      <div className="mt-1 truncate text-xs font-black text-slate-700">{formatLibraryTime(selectedCaseLibrary?.lastUpdatedAt)}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">更新人</div>
                      <div className="mt-1 truncate text-xs font-black text-slate-700">{selectedCaseLibrary?.lastUpdatedBy || '未同步'}</div>
                    </div>
                    <div className="rounded-xl bg-slate-50 px-3 py-2">
                      <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">提交信息</div>
                      <div className="mt-1 truncate text-xs font-black text-slate-700">{selectedCaseLibrary?.lastCommitMessage || '未同步'}</div>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {caseLibraryViewMode === 'folder' && (
            <div className="mt-5 flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <Search className="h-4 w-4 text-slate-400" />
              <input
                value={caseSearch}
                onChange={(event) => setCaseSearch(event.target.value)}
                placeholder="搜索当前文件夹用例名称 / tag"
                className="h-8 min-w-0 flex-1 bg-transparent text-sm font-bold text-slate-700 outline-none placeholder:text-slate-400"
              />
            </div>
          )}

          <div className="mt-5 grid grid-cols-1 gap-3 xl:grid-cols-2">
            {(caseLibraryViewMode === 'library' ? selectedLibraryRootFolders : selectedFolderChildren).map((folder) => {
              const folderCaseCount = getFolderTreeCaseCount(folder.id);

              return (
                <button
                  key={folder.id}
                  type="button"
                  onClick={() => {
                    setSelectedCaseFolderId(folder.id);
                    setSelectedCaseLibraryId(getFolderLibraryId(folder));
                    setCaseLibraryViewMode('folder');
                  }}
                  className="rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4 shrink-0 text-blue-600" />
                        <h3 className="truncate text-sm font-black text-slate-900">{folder.name}</h3>
                      </div>
                      <p className="mt-2 text-xs leading-5 text-slate-500">点击进入文件夹视图</p>
                    </div>
                    <div className="rounded-xl bg-slate-100 px-3 py-1 text-xs font-black text-slate-500">
                      {folderCaseCount} 用例
                    </div>
                  </div>
                </button>
              );
            })}

            {caseLibraryViewMode === 'folder' && selectedFolderCases.map((testCase) => (
              <div
                key={testCase.id}
                onClick={() => openCaseFlow(testCase)}
                className="cursor-pointer rounded-2xl border border-slate-200 bg-white p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-blue-200 hover:shadow-lg"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    {editingName?.type === 'case' && editingName.id === testCase.id ? (
                      <input
                        autoFocus
                        value={editingName.value}
                        onClick={(event) => event.stopPropagation()}
                        onChange={(event) => setEditingName({ ...editingName, value: event.target.value })}
                        onBlur={commitInlineEditingName}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter') commitInlineEditingName();
                          if (event.key === 'Escape') setEditingName(null);
                        }}
                        className="h-7 w-full rounded-lg border border-blue-200 bg-white px-2 text-sm font-black text-slate-900 outline-none"
                      />
                    ) : (
                      <h3
                        onDoubleClick={(event) => {
                          event.stopPropagation();
                          setEditingName({ type: 'case', id: testCase.id, value: testCase.name });
                        }}
                        className="truncate text-sm font-black text-slate-900"
                        title="双击重命名"
                      >
                        {testCase.name}
                      </h3>
                    )}
                    <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-500">{testCase.description || '暂无描述'}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <div className="rounded-xl bg-blue-50 px-3 py-1 text-xs font-black text-blue-600">
                      {testCase.steps.length} 步
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {(testCase.tags || []).length > 0 ? (
                    (testCase.tags || []).map((tag) => (
                      <span key={tag} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500">
                        <Tags className="h-3 w-3" />
                        {tag}
                      </span>
                    ))
                  ) : (
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-400">无 Tag</span>
                  )}
                </div>
              </div>
            ))}
            {caseLibraryViewMode === 'library' && selectedLibraryRootFolders.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
                <FolderPlus className="mx-auto h-8 w-8 text-slate-300" />
                <div className="mt-3 text-sm font-black text-slate-700">这个库还没有文件夹</div>
                <button
                  type="button"
                  onClick={() => selectedCaseLibrary && createCaseFolder(selectedCaseLibrary.id)}
                  className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
                >
                  新建第一个文件夹
                </button>
              </div>
            )}
            {caseLibraryViewMode === 'folder' && selectedFolderChildren.length === 0 && selectedFolderCases.length === 0 && (
              <div className="col-span-full rounded-2xl border border-dashed border-slate-200 bg-white px-6 py-12 text-center">
                <FilePlus className="mx-auto h-8 w-8 text-slate-300" />
                <div className="mt-3 text-sm font-black text-slate-700">这个文件夹还没有内容</div>
                <button
                  type="button"
                  onClick={() => createCase(selectedCaseFolderId)}
                  className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
                >
                  新建第一个用例
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  const openTaskCaseFlow = (task: AutomationTaskRecord, caseRecord: AutomationTaskCaseRecord) => {
    const targetCase = caseRecord.caseSnapshot || cases.find((testCase) => testCase.id === caseRecord.caseId);

    if (!targetCase) {
      setRunMessage(`未找到任务用例：${caseRecord.caseName}`);
      return;
    }

    try {
      const normalizedCase = normalizeReportCaseForPreview(targetCase);
      openCaseFlow(normalizedCase, {
        source: { tab: 'automation-task-report', taskId: task.id },
        snapshot: normalizedCase,
        edges: caseRecord.edges || caseEdges[caseRecord.caseId] || stepsToEdges(normalizedCase.steps),
        logs: caseRecord.results || [],
        artifacts: caseRecord.artifacts || null,
        preserveRunState: true,
        deferRender: true,
      });
      setRunMessage(`查看测试任务「${task.name}」中的用例：${caseRecord.caseName}`);
    } catch (error) {
      setRunMessage(`报告用例无法打开，已保留在报告页：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const renderTaskCaseLatestStep = (caseRecord: AutomationTaskCaseRecord) => {
    const latest = (caseRecord.results || []).slice(-1)[0];

    if (!latest) {
      return (
        <div className="rounded-lg border border-dashed border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-400">
          {caseRecord.status === 'pending' ? '等待执行' : '暂无执行步骤'}
        </div>
      );
    }
    const latestDetail = getWorkflowRunLogDetail(latest) || latest.command || '';
    const latestName = latest.stepName || (latest as unknown as { name?: string }).name || latest.stepId || '步骤';
    const latestIndex = (latest as unknown as { index?: number }).index;
    const durationLabel = formatRunDuration(latest);

    return (
      <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs shadow-sm">
        <div className="flex min-w-0 items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <span className="font-black text-slate-900">{latestIndex ? `#${latestIndex} ` : '# '}{latestName}</span>
            <span className="rounded-full bg-slate-100 px-2 py-0.5 font-mono text-[10px] font-bold text-slate-500">{durationLabel}</span>
          </div>
          <div className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
            latest.status === 'success'
              ? 'bg-emerald-50 text-emerald-600'
              : latest.status === 'stopped'
                ? 'bg-slate-800 text-white'
                : 'bg-rose-50 text-rose-600'
          }`}>
            {latest.status === 'success' ? '成功' : latest.status === 'stopped' ? '强制停止' : '失败'}
          </div>
        </div>
        {latestDetail && (
          <pre className="nodrag nowheel mt-2 max-h-24 overflow-auto whitespace-pre-wrap break-words rounded-lg border border-slate-100 bg-slate-50 p-2 font-mono text-[11px] leading-5 text-slate-600">
            {latestDetail}
          </pre>
        )}
      </div>
    );
  };

  const renderTaskPerformanceCard = (
    label: string,
    report?: AutomationTaskPerformanceReport,
    state: { enabled?: boolean; running?: boolean } = {}
  ) => {
    const validSamples = report?.samples.filter((sample) => !sample.error) || [];
    const failedSamples = report?.samples.filter((sample) => sample.error).length || 0;
    const memorySummary = summarizePerformanceValues(validSamples.map((sample) => sample.memoryKb));
    const cpuSummary = summarizePerformanceValues(validSamples.map((sample) => sample.cpuPercent));
    const threadSummary = summarizePerformanceValues(validSamples.map((sample) => sample.threadCount));
    const temperatureSummary = summarizePerformanceValues(validSamples.map((sample) => sample.batteryTemperatureC));
    const isCollecting = !report && state.enabled && state.running;
    const badgeLabel = report ? `${validSamples.length} 次` : isCollecting ? '采集中' : '未启用';

    return (
      <button
        type="button"
        disabled={!report}
        onClick={() => report && setPerformanceReportDialog(report)}
        className={`rounded-2xl border p-4 text-left transition-colors ${
          report
            ? 'border-blue-100 bg-white hover:border-blue-200 hover:bg-blue-50'
            : isCollecting
              ? 'cursor-default border-blue-100 bg-blue-50'
            : 'cursor-not-allowed border-dashed border-slate-200 bg-slate-50'
        }`}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="text-sm font-black text-slate-900">{label}</div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${report ? 'bg-blue-50 text-blue-600' : isCollecting ? 'bg-blue-600 text-white' : 'bg-slate-100 text-slate-400'}`}>
            {badgeLabel}
          </span>
        </div>
        {report ? (
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs font-bold text-slate-500">
            <div>
              <div className="text-[10px] font-black text-slate-400">CPU均值</div>
              <div className="mt-1 text-slate-900">{formatPerformanceMetric(cpuSummary.avg, '%')}</div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400">内存均值</div>
              <div className="mt-1 text-slate-900">{formatPerformanceMemory(memorySummary.avg)}</div>
            </div>
            <div>
              <div className="text-[10px] font-black text-slate-400">线程均值</div>
              <div className="mt-1 text-slate-900">{formatPerformanceMetric(threadSummary.avg)}</div>
            </div>
            <div><div className="text-[10px] font-black text-slate-400">电池温度均值（设备）</div><div className="mt-1 text-slate-900">{formatPerformanceMetric(temperatureSummary.avg, '°C')}</div></div>
            <div className={`col-span-4 ${report.crashes?.count ? 'text-red-600' : ''}`} title={report.crashes?.scope === 'device' ? '设备全部应用；系统事件与应用崩溃日志合并去重' : '历史报告仅统计目标包 am_crash；0 次不代表没有应用异常'}>应用崩溃：{crashSummary(report.crashes)}{report.crashes?.scope === 'device' && ` · 目标包 ${report.crashes.targetCount ?? 0} 次`}</div>
            {failedSamples > 0 && (
              <div className="col-span-4 text-[11px] font-black text-rose-600">采样失败 {failedSamples} 次</div>
            )}
          </div>
        ) : (
          <div className={`mt-3 text-xs font-bold ${isCollecting ? 'text-blue-600' : 'text-slate-400'}`}>
            {isCollecting ? '后台性能采样中，任务结束后生成报告' : '创建任务时勾选后自动生成'}
          </div>
        )}
      </button>
    );
  };

  const renderAutomationPerformanceTrendCard = (
    title: string,
    samples: AutomationTaskPerformanceSample[],
    getValue: (sample: AutomationTaskPerformanceSample) => number | undefined,
    formatValue: (value?: number) => string,
    color: string,
    secondary?: { label: string; getValue: (sample: AutomationTaskPerformanceSample) => number | undefined; color: string }
  ) => {
    const chartSamples = samples.filter((sample) => !sample.error);
    const width = 360;
    const height = 150;
    const padding = { left: 46, right: 16, top: 18, bottom: 28 };
    const series = chartSamples
      .map((sample) => ({ sample, value: getValue(sample) }))
      .filter((item): item is { sample: AutomationTaskPerformanceSample; value: number } => Number.isFinite(item.value));
    const secondarySeries = secondary
      ? chartSamples
        .map((sample) => ({ sample, value: secondary.getValue(sample) }))
        .filter((item): item is { sample: AutomationTaskPerformanceSample; value: number } => Number.isFinite(item.value))
      : [];
    const values = [...series.map((item) => item.value), ...secondarySeries.map((item) => item.value)];
    const minValue = values.length ? Math.min(...values) : 0;
    const maxValue = values.length ? Math.max(...values) : 1;
    const range = maxValue - minValue || Math.max(Math.abs(maxValue), 1);
    const xForIndex = (index: number, length: number) => (
      padding.left + (length <= 1 ? 0 : (index / (length - 1)) * (width - padding.left - padding.right))
    );
    const yForValue = (value: number) => (
      padding.top + (1 - ((value - minValue) / range)) * (height - padding.top - padding.bottom)
    );
    const toPath = (items: Array<{ value: number }>) => (
      items.map((item, index) => `${index === 0 ? 'M' : 'L'} ${xForIndex(index, items.length).toFixed(1)} ${yForValue(item.value).toFixed(1)}`).join(' ')
    );
    const firstTime = series[0]?.sample.timestamp || secondarySeries[0]?.sample.timestamp;
    const lastTime = series[series.length - 1]?.sample.timestamp || secondarySeries[secondarySeries.length - 1]?.sample.timestamp;

    return (
      <div className="rounded-2xl border border-slate-200 bg-white p-3">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-black text-slate-700">
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />
            {title}
          </div>
          {secondary && (
            <div className="flex items-center gap-2 text-[10px] font-black text-slate-400">
              <span className="h-0.5 w-5 border-t-2 border-dashed" style={{ borderColor: secondary.color }} />
              {secondary.label}
            </div>
          )}
        </div>
        <svg viewBox={`0 0 ${width} ${height}`} className="mt-2 h-40 w-full">
          <rect x={padding.left} y={padding.top} width={width - padding.left - padding.right} height={height - padding.top - padding.bottom} rx="10" fill="#f8fafc" />
          <line x1={padding.left} y1={padding.top} x2={padding.left} y2={height - padding.bottom} stroke="#cbd5e1" />
          <line x1={padding.left} y1={height - padding.bottom} x2={width - padding.right} y2={height - padding.bottom} stroke="#cbd5e1" />
          <text x="8" y={padding.top + 5} className="fill-slate-400 text-[10px] font-bold">{formatValue(maxValue)}</text>
          <text x="8" y={height - padding.bottom} className="fill-slate-400 text-[10px] font-bold">{formatValue(minValue)}</text>
          {secondarySeries.length > 0 && (
            <path d={toPath(secondarySeries)} fill="none" stroke={secondary?.color} strokeWidth="2.5" strokeDasharray="6 5" strokeLinecap="round" strokeLinejoin="round" opacity="0.75" />
          )}
          {series.length > 0 && (
            <path d={toPath(series)} fill="none" stroke={color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
          )}
          {series.length === 0 && secondarySeries.length === 0 && (
            <text x={width / 2} y={height / 2} textAnchor="middle" className="fill-slate-400 text-xs font-bold">暂无趋势数据</text>
          )}
          {firstTime && (
            <text x={padding.left} y={height - 8} className="fill-slate-400 text-[10px] font-bold">{formatRunTime(firstTime)}</text>
          )}
          {lastTime && (
            <text x={width - padding.right} y={height - 8} textAnchor="end" className="fill-slate-400 text-[10px] font-bold">{formatRunTime(lastTime)}</text>
          )}
        </svg>
      </div>
    );
  };

  const renderPerformanceReportDialog = () => {
    if (!performanceReportDialog) {
      return null;
    }

    const validSamples = performanceReportDialog.samples.filter((sample) => !sample.error);
    const memorySummary = summarizePerformanceValues(validSamples.map((sample) => sample.memoryKb));
    const cpuSummary = summarizePerformanceValues(validSamples.map((sample) => sample.cpuPercent));
    const threadSummary = summarizePerformanceValues(validSamples.map((sample) => sample.threadCount));
    const temperatureSummary = summarizePerformanceValues(validSamples.map((sample) => sample.batteryTemperatureC));

    return (
      <div className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-900/35 px-4">
        <div className="flex max-h-[86vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl">
          <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
            <div>
              <div className="text-[11px] font-black uppercase tracking-[0.18em] text-blue-600">
                {performanceReportDialog.target === 'phone' ? 'Phone Performance' : 'Glasses Performance'}
              </div>
              <h3 className="mt-1 text-lg font-black text-slate-900">{performanceReportDialog.name}</h3>
              <div className="mt-1 text-xs font-bold text-slate-500">
                {performanceReportDialog.runtime === 'android' ? 'Android / adb' : '鸿蒙 / hdc'} · {performanceReportDialog.serial || '-'} · {performanceReportDialog.packageName || '-'}
              </div>
            </div>
            <button
              type="button"
              onClick={() => setPerformanceReportDialog(null)}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
              title="关闭"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-5">
            <div className="grid grid-cols-4 gap-3">
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs font-black text-slate-400">CPU峰值 / 均值</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{formatPerformanceMetric(cpuSummary.max, '%')} / {formatPerformanceMetric(cpuSummary.avg, '%')}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs font-black text-slate-400">内存峰值 / 均值</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{formatPerformanceMemory(memorySummary.max)} / {formatPerformanceMemory(memorySummary.avg)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs font-black text-slate-400">线程峰值 / 均值</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{formatPerformanceMetric(threadSummary.max)} / {formatPerformanceMetric(threadSummary.avg)}</div>
              </div>
              <div className="rounded-2xl border border-slate-200 p-4">
                <div className="text-xs font-black text-slate-400">电池温度峰值 / 均值（设备）</div>
                <div className="mt-2 text-2xl font-black text-slate-950">{formatPerformanceMetric(temperatureSummary.max, '°C')} / {formatPerformanceMetric(temperatureSummary.avg, '°C')}</div>
              </div>
            </div>
            <div className="mt-4"><CrashSummary crashes={performanceReportDialog.crashes} /></div>
            <div className="mt-4 grid grid-cols-4 gap-3">
              {renderAutomationPerformanceTrendCard(
                'CPU %', performanceReportDialog.samples,
                sample => sample.cpuPercent,
                value => formatPerformanceMetric(value, '%'), '#ea580c',
                { label: '可用CPU', getValue: sample => sample.systemAvailableCpuPercent, color: '#fdba74' }
              )}
              {renderAutomationPerformanceTrendCard(
                '内存 MB', performanceReportDialog.samples,
                sample => typeof sample.memoryKb === 'number' ? sample.memoryKb / 1024 : undefined,
                value => typeof value === 'number' ? `${value.toFixed(0)}MB` : '-', '#0284c7',
                { label: '可用内存', getValue: sample => typeof sample.systemAvailableMemoryKb === 'number' ? sample.systemAvailableMemoryKb / 1024 : undefined, color: '#7dd3fc' }
              )}
              {renderAutomationPerformanceTrendCard(
                '线程', performanceReportDialog.samples, sample => sample.threadCount,
                value => typeof value === 'number' ? value.toFixed(0) : '-', '#059669'
              )}
              {renderAutomationPerformanceTrendCard(
                '电池温度（设备）', performanceReportDialog.samples, sample => sample.batteryTemperatureC,
                value => typeof value === 'number' ? `${value.toFixed(1)}°C` : '-', '#e11d48'
              )}
            </div>
            <div className="mt-4 overflow-auto rounded-2xl border border-slate-200">
              <table className="w-full min-w-[820px] text-left text-xs">
                <thead className="bg-slate-50 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-4 py-3">时间</th>
                    <th className="px-4 py-3">PID</th>
                    <th className="px-4 py-3">内存</th>
                    <th className="px-4 py-3">CPU</th>
                    <th className="px-4 py-3">线程</th>
                    <th className="px-4 py-3">电池温度</th>
                    <th className="px-4 py-3">可用内存</th>
                    <th className="px-4 py-3">可用CPU</th>
                    <th className="px-4 py-3">状态</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {performanceReportDialog.samples.map((sample, index) => (
                    <tr key={`${sample.timestamp}-${index}`}>
                      <td className="px-4 py-3 font-mono text-slate-500">{formatRunTime(sample.timestamp)}</td>
                      <td className="px-4 py-3 font-mono font-bold text-slate-700">{sample.pid || '-'}</td>
                      <td className="px-4 py-3 font-bold text-slate-700">{formatPerformanceMemory(sample.memoryKb)}</td>
                      <td className="px-4 py-3 font-bold text-slate-700">{formatPerformanceMetric(sample.cpuPercent, '%')}</td>
                      <td className="px-4 py-3 font-bold text-slate-700">{formatPerformanceMetric(sample.threadCount)}</td>
                      <td className="px-4 py-3" title={sample.batteryError}>{formatPerformanceMetric(sample.batteryTemperatureC, '°C')}</td>
                      <td className="px-4 py-3 font-bold text-slate-500">{formatPerformanceMemory(sample.systemAvailableMemoryKb)}</td>
                      <td className="px-4 py-3 font-bold text-slate-500">{formatPerformanceMetric(sample.systemAvailableCpuPercent, '%')}</td>
                      <td className="px-4 py-3">
                        <span className={`rounded-full px-2 py-1 text-[10px] font-black ${sample.error ? 'bg-rose-50 text-rose-600' : 'bg-emerald-50 text-emerald-600'}`}>
                          {sample.error ? '失败' : '成功'}
                        </span>
                        {sample.rawEvidencePath && <button className="ml-2 text-blue-600 underline" onClick={() => void openPathInFolder(sample.rawEvidencePath)}>原始证据</button>}
                      </td>
                    </tr>
                  ))}
                  {performanceReportDialog.samples.length === 0 && (
                    <tr>
                      <td colSpan={9} className="px-4 py-12 text-center text-sm font-bold text-slate-400">没有采样数据</td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderAutomationTaskReport = () => {
    const selectedTask = automationTasks.find((task) => task.id === selectedAutomationTaskId);

    if (!selectedTask) {
      return (
        <div className="flex-1 min-h-0 bg-slate-50 p-6">
          <div className="mx-auto max-w-6xl rounded-2xl border border-slate-200 bg-white p-8 text-center shadow-sm">
            <Rocket className="mx-auto h-8 w-8 text-slate-300" />
            <div className="mt-3 text-sm font-black text-slate-700">未选择测试报告</div>
            <button
              type="button"
              onClick={() => setActiveTab('automation-tasks')}
              className="mt-4 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
            >
              返回任务列表
            </button>
          </div>
        </div>
      );
    }

    const selectedTaskCases = selectedTask?.cases || [];
    const isReportDetailLoading = selectedTask.reportDetailLoaded === false && selectedTaskCases.length === 0;
    const { successCount, failedCount, stoppedCount, caseCount } = getAutomationTaskCounts(selectedTask);
    const finishedCount = selectedTaskCases.filter((item) => item.status === 'success' || item.status === 'failed' || item.status === 'stopped').length;
    const normalizedReportSearch = reportCaseSearch.trim().toLowerCase();
    const getReportCaseSearchText = (caseRecord: AutomationTaskCaseRecord) => [
      caseRecord.caseName,
      caseRecord.caseId,
      caseRecord.status,
      caseRecord.error,
      caseRecord.caseSnapshot?.name,
      caseRecord.caseSnapshot?.tags?.join(' '),
      ...(caseRecord.results || []).flatMap((result) => [
        result.stepName,
        result.status,
        result.error,
        result.stdout,
        result.stderr,
        result.command,
      ]),
    ].filter(Boolean).join('\n').toLowerCase();
    const selectedTaskFilteredCases = selectedTaskCases.filter((caseRecord) => {
      if (reportCaseStatusFilter !== 'all' && caseRecord.status !== reportCaseStatusFilter) {
        return false;
      }

      if (reportCaseArtifactFilter === 'withArtifacts' && !caseRecord.artifacts?.runDir) {
        return false;
      }

      if (reportCaseArtifactFilter === 'withScreenshots' && !(caseRecord.artifacts?.screenshots || []).some((item) => item?.path)) {
        return false;
      }

      if (!normalizedReportSearch) {
        return true;
      }

      return getReportCaseSearchText(caseRecord).includes(normalizedReportSearch);
    });
    const hasReportCaseFilter = Boolean(normalizedReportSearch)
      || reportCaseStatusFilter !== 'all'
      || reportCaseArtifactFilter !== 'all';
    const successRate = caseCount > 0
      ? Math.round((successCount / caseCount) * 100)
      : 0;
    const totalCount = caseCount;
    const successWidth = totalCount > 0 ? Math.round((successCount / totalCount) * 100) : 0;
    const failedWidth = totalCount > 0 ? Math.round((failedCount / totalCount) * 100) : 0;
    const selectedTaskActive = isAutomationTaskActive(selectedTask);
    const canRerunFailed = !selectedTask.readonly && !selectedTaskActive && failedCount > 0;
    const taskDevices = selectedTask.devices as {
      phone?: { serial?: string; packageName?: string };
      glasses?: { serial?: string; packageName?: string };
    } | undefined;
    const taskEnvironment = String(selectedTask.runtimeEnvironment?.environment || selectedTask.runtimeEnvironment?.env || '未记录');
    const taskOptions = [
      selectedTask.startOptions?.recordPhoneScreen ? '手机录屏' : '',
      selectedTask.startOptions?.recordGlassesScreen ? '眼镜录屏' : '',
      selectedTask.performanceOptions?.phone ? '手机性能' : '',
      selectedTask.performanceOptions?.glasses ? '眼镜性能' : '',
    ].filter(Boolean);

    return (
      <div className="flex-1 min-h-0 bg-slate-50 p-6 overflow-auto">
        <div className="mx-auto max-w-6xl">
          {(selectedTask.performanceOptions?.threadStacks?.enabled || selectedTask.threadStacks?.length) && <section className="mb-4 rounded-xl border bg-white p-4">
            <div className="flex justify-between"><strong>线程栈快照</strong>{selectedTaskActive && !selectedTask.readonly && <button className="text-blue-600" onClick={async () => {
              try { const result = await electronApi?.ipcRenderer?.invoke('workflow-task:capture-stacks', { taskId: selectedTask.id }) as { success?: boolean; error?: string } | undefined;
                alert(result?.success ? '线程栈已采集，结果会同步到报告' : result?.error || '未完成采集：请查看诊断，可能触发间隔或容量限制');
              } catch (error) { alert(String(error)); }
            }}>立即采集</button>}</div>
            <p className="text-xs text-slate-500">SIGQUIT 栈快照不代表线程 CPU 执行耗时；信号成功不等于文件采集成功。完整证据随报告包导出。</p>
            {(selectedTask.threadStacks || []).map(record => <details key={record.id} className="mt-2 text-xs"><summary>{record.startedAt} · {record.target} · PID {record.pid || '未知'} · 第 {record.round || '-'} 轮 · {record.reason} · {record.status}</summary>
              <p>{record.errorCode} {record.error}</p>
              {record.files.map(file => <p key={file.path}><button className="text-blue-600" onClick={() => void openPathInFolder(file.path, 'open')}>{file.path}</button></p>)}
              <pre className="overflow-auto whitespace-pre-wrap">{JSON.stringify(record, null, 2)}</pre>
            </details>)}
          </section>}

          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex min-w-0 flex-1 items-center gap-3">
              <button
                type="button"
                onClick={() => setActiveTab('automation-tasks')}
                className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-900"
              >
                <ArrowLeft className="h-4 w-4" />
	              </button>
	              <div className="min-w-0">
	                <div className="flex min-w-0 items-center gap-2">
	                  <h2 className="truncate text-lg font-black text-slate-900">测试报告 · {selectedTask.name}</h2>
	                  <div className={`shrink-0 rounded-full px-3 py-1 text-xs font-black ${
	                    selectedTask.status === 'success' ? 'bg-emerald-50 text-emerald-600' : selectedTask.status === 'failed' ? 'bg-rose-50 text-rose-600' : selectedTaskActive ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
	                  }`}>
	                    {selectedTask.status === 'success' ? stoppedCount ? '已停止' : '已完成' : selectedTask.status === 'failed' ? '有失败' : selectedTask.status === 'stopped' ? '已停止' : selectedTask.status === 'stopping' ? '停止中' : selectedTaskActive ? '执行中' : '等待执行'}
	                  </div>
	                </div>
	                <div className="mt-1 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-xs font-medium text-slate-500">
                    <CopyableTaskId key={selectedTask.id} taskId={selectedTask.id} />
                    <span className="whitespace-nowrap">· 成功率 <span className="font-black text-emerald-600">{successCount}</span>/<span className="font-black text-slate-900">{caseCount}</span> ({successRate}%)</span>
                    <span className="whitespace-nowrap">· 结果 <span className="font-black text-emerald-600">{successCount}</span>/<span className="font-black text-rose-600">{failedCount}</span>/<span className="font-black text-slate-900">{caseCount}</span></span>
                    <span className="whitespace-nowrap">· 已执行 {finishedCount}/{caseCount}</span>
                  </div>
              </div>
	            </div>
	            <div className="flex items-center gap-2">
	              <button
	                type="button"
	                onClick={() => void exportAutomationTaskReport(selectedTask)}
                disabled={selectedTaskActive}
                className="inline-flex items-center gap-1.5 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-xs font-black text-emerald-700 hover:bg-emerald-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <FileDown className="h-3.5 w-3.5" />
                导出报告包
              </button>
              <button
                type="button"
                onClick={() => deleteAutomationTasks([selectedTask.id])}
                disabled={selectedTaskActive}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
                title={selectedTaskActive ? '执行中的任务不能删除' : '删除当前测试报告'}
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除报告
              </button>
              {selectedTask.imported && (
                <div className="rounded-full bg-slate-900 px-3 py-1 text-xs font-black text-white">
                  只读报告
                </div>
              )}
	              {!selectedTask.readonly && (
                <>
                  <button
                    type="button"
                    onClick={() => rerunFailedAutomationTask(selectedTask)}
                    disabled={!canRerunFailed || pendingTaskActions.has(selectedTask.id)}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
                    title={selectedTaskActive ? '任务执行中不可重跑失败' : failedCount > 0 ? '只重跑执行失败的用例' : '没有失败用例可重跑'}
                  >
                    <RefreshCw className={`h-3.5 w-3.5 ${pendingTaskActions.has(selectedTask.id) ? 'animate-spin' : ''}`} />
                    {pendingTaskActions.has(selectedTask.id) ? '正在提交…' : '重跑失败'}
                  </button>
                  <button
                    type="button"
                    disabled={taskStopPending.has(selectedTask.id) || (!selectedTaskActive && pendingTaskActions.has(selectedTask.id))}
                    onClick={() => selectedTaskActive ? void stopAutomationTask(selectedTask.id) : rerunAutomationTask(selectedTask)}
                    className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-black ${
                      selectedTaskActive
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    }`}
                  >
                    {selectedTaskActive ? <Square className="h-3.5 w-3.5 fill-current" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    {taskStopPending.has(selectedTask.id) ? '正在请求…' : selectedTask.status === 'stopping' ? '停止中…' : selectedTaskActive ? '停止' : '重跑'}
                  </button>
                </>
              )}
            </div>
          </div>

          <TaskActionNotice feedback={taskActionFeedback[selectedTask.id]} onOpenTask={openTaskActionReport} />
          {taskStopFeedback[selectedTask.id] && <p role="status" className="mt-3 text-sm text-slate-600">{selectedTaskActive ? taskStopFeedback[selectedTask.id] : '任务已结束'}</p>}
          <div className="mt-4 grid gap-3 rounded-2xl border border-slate-200 bg-white p-4 text-xs text-slate-600 shadow-sm md:grid-cols-2 xl:grid-cols-4">
            <div>
              <div className="font-black text-slate-400">环境 / 来源</div>
              <div className="mt-1 font-bold text-slate-800">{taskEnvironment} · {selectedTask.source === 'cli' ? 'CLI Broker' : '桌面 UI'}</div>
            </div>
            <div>
              <div className="font-black text-slate-400">设备</div>
              <div className="mt-1 break-all font-mono font-bold text-slate-800">
                手机 {taskDevices?.phone?.serial || '未记录'} · 眼镜 {taskDevices?.glasses?.serial || '未记录'}
              </div>
            </div>
            <div>
              <div className="font-black text-slate-400">时间</div>
              <div className="mt-1 font-bold text-slate-800">
                {formatRunTime(selectedTask.startedAt || selectedTask.createdAt)}
                {selectedTask.finishedAt ? ` → ${formatRunTime(selectedTask.finishedAt)}` : ' → 执行中'}
              </div>
            </div>
            <div>
              <div className="font-black text-slate-400">采集 / 报告</div>
              <div className="mt-1 break-all font-bold text-slate-800">
                {taskOptions.length ? taskOptions.join('、') : '未启用额外采集'}
                {selectedTask.reportPackagePath ? ` · ${selectedTask.reportPackagePath}` : ''}
              </div>
            </div>
          </div>

          {selectedTask.stress && <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 text-sm">
            <div className="font-bold">压测任务 · {selectedTask.stress.mode === 'rounds' ? `${selectedTask.stress.value} 轮` : `${selectedTask.stress.value} 分钟`} · 当前第 {selectedTask.currentRound || 1} 轮</div>
            <div className="mt-2 flex flex-wrap gap-3">
              {(selectedTask.taskLogs || []).map((log) => <div key={log.deviceType}>
                <button className="text-xs font-bold text-blue-700 underline" type="button" disabled={!log.path} onClick={() => void openPathInFolder(log.path)}>{log.deviceType === 'glasses' ? '眼镜' : '手机'}完整日志</button>
                {log.error && <p className="mt-1 max-w-xl break-words text-xs text-rose-600">日志采集异常：{log.error}</p>}
              </div>)}
            </div>
          </div>}
          <div className="mt-5 rounded-2xl border border-blue-100 bg-white p-4 shadow-sm">
            <div className="flex h-2 overflow-hidden rounded-full bg-slate-100">
              <div
                className="h-full bg-emerald-500"
                style={{ width: `${successWidth}%` }}
              />
              <div
                className="h-full bg-rose-500"
                style={{ width: `${failedWidth}%` }}
              />
            </div>
            <div className="mt-4 grid gap-3 md:grid-cols-2">
              {renderTaskPerformanceCard('手机性能报告', selectedTask.performanceReports?.phone, {
                enabled: selectedTask.performanceOptions?.phone,
                running: selectedTaskActive,
              })}
              {renderTaskPerformanceCard('眼镜性能报告', selectedTask.performanceReports?.glasses, {
                enabled: selectedTask.performanceOptions?.glasses,
                running: selectedTaskActive,
              })}
            </div>
            <div className="mt-5 rounded-2xl border border-slate-100 bg-slate-50 p-3">
              <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
                <div className="relative min-w-0 flex-1">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={reportCaseSearch}
                    onChange={(event) => setReportCaseSearch(event.target.value)}
                    className="h-10 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-9 text-xs font-bold text-slate-700 outline-none transition-colors placeholder:text-slate-400 focus:border-blue-300 focus:ring-2 focus:ring-blue-100"
                    placeholder="搜索用例名、caseId、节点名、错误日志、stdout/stderr"
                  />
                  {reportCaseSearch && (
                    <button
                      type="button"
                      onClick={() => setReportCaseSearch('')}
                      className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                      title="清空搜索"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  {([
                    ['all', `全部 ${selectedTaskCases.length}`],
                    ['failed', `失败 ${failedCount}`],
                    ['success', `成功 ${successCount}`],
                    ['running', '执行中'],
                    ['stopped', `停止 ${stoppedCount}`],
                    ['pending', '等待'],
                  ] as Array<[ReportCaseStatusFilter, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReportCaseStatusFilter(value)}
                      className={`h-8 rounded-lg px-3 text-[11px] font-black transition-colors ${
                        reportCaseStatusFilter === value
                          ? value === 'failed'
                            ? 'bg-rose-600 text-white shadow-sm'
                            : value === 'success'
                              ? 'bg-emerald-600 text-white shadow-sm'
                              : 'bg-slate-900 text-white shadow-sm'
                          : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100 hover:text-slate-800'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>
              <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                <div className="flex flex-wrap items-center gap-2">
                  {([
                    ['all', '所有产物'],
                    ['withArtifacts', '有执行产物'],
                    ['withScreenshots', '有校验截图'],
                  ] as Array<[ReportCaseArtifactFilter, string]>).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      onClick={() => setReportCaseArtifactFilter(value)}
                      className={`h-7 rounded-lg px-2.5 text-[10px] font-black transition-colors ${
                        reportCaseArtifactFilter === value
                          ? 'border border-blue-100 bg-blue-50 text-blue-700'
                          : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-100'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
                <div className="flex items-center gap-2 text-[11px] font-bold text-slate-500">
                  <span>
                    当前显示 <span className="font-black text-slate-900">{selectedTaskFilteredCases.length}</span> / {selectedTaskCases.length}
                  </span>
                  {hasReportCaseFilter && (
                    <button
                      type="button"
                      onClick={() => {
                        setReportCaseSearch('');
                        setReportCaseStatusFilter('all');
                        setReportCaseArtifactFilter('all');
                      }}
                      className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-black text-slate-500 hover:bg-slate-100"
                    >
                      清空过滤
                    </button>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-5 space-y-4">
              {isReportDetailLoading && (
                <div className="rounded-2xl border border-dashed border-blue-100 bg-blue-50 px-5 py-8 text-center">
                  <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
                  <div className="mt-3 text-sm font-black text-slate-800">正在加载报告详情</div>
                  <div className="mt-1 text-xs font-bold text-slate-500">列表只保存摘要，详情会在打开报告时按需读取。</div>
                </div>
              )}
              {selectedTaskFilteredCases.length === 0 && !isReportDetailLoading && (
                <div className="rounded-2xl border border-dashed border-slate-200 bg-white px-5 py-10 text-center">
                  <Search className="mx-auto h-7 w-7 text-slate-300" />
                  <div className="mt-3 text-sm font-black text-slate-700">没有匹配的用例</div>
                  <div className="mt-1 text-xs font-bold text-slate-400">换个关键词，或清空状态/产物筛选。</div>
                </div>
              )}
              {selectedTaskFilteredCases.map((caseRecord) => {
                const caseIndex = selectedTaskCases.findIndex((item) => item.caseId === caseRecord.caseId);
                const caseProgress = caseRecord.total > 0 ? Math.round((caseRecord.completed / caseRecord.total) * 100) : 0;
                const screenshots = (caseRecord.artifacts?.screenshots || []).filter((item) => item?.path);
                const hasArtifacts = Boolean(caseRecord.artifacts?.runDir);
                const caseStartedAt = getCaseStartedAt(caseRecord);

                return (
                  <div key={caseRecord.caseId} className="rounded-2xl border border-slate-100 bg-slate-50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => openTaskCaseFlow(selectedTask, caseRecord)}
                        className="inline-flex min-w-0 items-center text-left text-sm font-black text-slate-900 hover:text-blue-600"
                      >
                        <span className="mr-2 inline-flex h-6 min-w-6 items-center justify-center rounded-full bg-white px-2 font-mono text-[11px] font-black text-blue-600 ring-1 ring-blue-100">
                          #{caseIndex + 1}
                        </span>
                        <span>{caseRecord.caseName}</span>
                      </button>
                      <div className="flex items-center gap-2">
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-black ${
                          caseRecord.status === 'success' ? 'bg-emerald-50 text-emerald-600' : caseRecord.status === 'failed' ? 'bg-rose-50 text-rose-600' : caseRecord.status === 'stopped' ? 'bg-slate-800 text-white' : caseRecord.status === 'running' ? 'bg-blue-50 text-blue-600' : 'bg-slate-100 text-slate-500'
                        }`}>
                          {caseRecord.status === 'success' ? '成功' : caseRecord.status === 'failed' ? '失败' : caseRecord.status === 'stopped' ? '强制停止' : caseRecord.status === 'running' ? '执行中' : '等待'}
                        </span>
                        <span className="rounded-full bg-white px-2 py-0.5 font-mono text-[10px] font-black text-slate-500">
                          {caseRecord.completed}/{caseRecord.total}
                        </span>
                        {hasArtifacts && (
                          <button
                            type="button"
                            onClick={() => void openPathInFolder(caseRecord.artifacts?.runDir, 'open')}
                            className="rounded-lg border border-blue-100 px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50"
                          >
                            产物
                          </button>
                        )}
                      </div>
                    </div>
                    <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-slate-500">
                      <span className="rounded-full bg-white px-2 py-1">
                        开始 {formatRunTime(caseStartedAt)}
                      </span>
                      {caseRecord.endedAt && (
                        <span className="rounded-full bg-white px-2 py-1">
                          结束 {formatRunTime(caseRecord.endedAt)}
                        </span>
                      )}
                      <span className="rounded-full bg-white px-2 py-1">
                        耗时 {formatCaseDuration(caseRecord)}
                      </span>
                    </div>
                    {(caseRecord.terminationReason || caseRecord.reachedEnd !== undefined || caseRecord.duplicateStepId) && (
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold">
                        <span className={`rounded-full px-2 py-1 ${caseRecord.reachedEnd ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'}`}>
                          到达 End：{caseRecord.reachedEnd ? '是' : '否'}
                        </span>
                        {caseRecord.terminationReason && (
                          <span className="rounded-full bg-white px-2 py-1 text-slate-600">
                            终止：{caseRecord.terminationReason}
                          </span>
                        )}
                        {caseRecord.duplicateStepId && (
                          <span className="rounded-full bg-rose-50 px-2 py-1 text-rose-700">
                            异常重复节点：{caseRecord.duplicateStepId}
                          </span>
                        )}
                      </div>
                    )}
                    <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white">
                      <div
                        className={`h-full rounded-full ${
                          caseRecord.status === 'success'
                            ? 'bg-emerald-500'
                            : caseRecord.status === 'failed'
                              ? 'bg-rose-500'
                              : caseRecord.status === 'stopped'
                                ? 'bg-slate-700'
                              : 'bg-blue-500'
                        }`}
                        style={{ width: `${caseProgress}%` }}
                      />
                    </div>
                    <div className="mt-3">
                      {renderTaskCaseLatestStep(caseRecord)}
                    </div>
                    {screenshots.length > 0 && (
                      <div className="mt-4">
                        <div className="mb-2 text-[11px] font-black uppercase tracking-wide text-slate-500">校验截图</div>
                        <div className="flex gap-3 overflow-x-auto pb-2">
                          {screenshots.map((screenshot, index) => (
                            <button
                              type="button"
                              key={`${screenshot.path}-${index}`}
                              onClick={() => void openPathInFolder(screenshot.path, 'open')}
                              className="group w-[260px] min-w-[260px] overflow-hidden rounded-xl border border-slate-200 bg-white text-left shadow-sm hover:border-blue-200 hover:bg-blue-50"
                            >
                              <div className="flex h-[360px] w-full items-center justify-center overflow-hidden bg-slate-950">
                                {screenshotPreviewUrls[screenshot.path] ? (
                                  <img
                                    src={screenshotPreviewUrls[screenshot.path]}
                                    alt={`截图 ${index + 1}`}
                                    className="h-full w-full object-contain transition-transform group-hover:scale-[1.02]"
                                  />
                                ) : (
                                  <div className="px-3 text-center text-[11px] font-black text-slate-400">
                                    点击打开截图
                                  </div>
                                )}
                              </div>
                              <div className="p-2">
                                <div className="truncate text-xs font-black text-slate-800">截图 {index + 1}</div>
                              </div>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    );
  };

  const getFolderCaseIdsForTask = (folderId: string) => {
    const folderIds = collectFolderTreeIds(folderId);

    return cases
      .filter((testCase) => folderIds.has(getCaseFolderId(testCase)))
      .map((testCase) => testCase.id);
  };

  const getLibraryCaseIdsForTask = (libraryId: string) => {
    const libraryFolderIds = new Set(
      caseLibraryFolders
        .filter((folder) => getFolderLibraryId(folder) === libraryId)
        .map((folder) => folder.id)
    );

    return cases
      .filter((testCase) => libraryFolderIds.has(getCaseFolderId(testCase)))
      .map((testCase) => testCase.id);
  };

  const setTaskCaseSelection = (caseIds: string[], selected: boolean) => {
    setTaskCreateDialog((current) => {
      if (!current) {
        return current;
      }

      const next = new Set(current.selectedCaseIds);
      caseIds.forEach((caseId) => {
        if (selected) {
          next.add(caseId);
        } else {
          next.delete(caseId);
        }
      });

      return { ...current, selectedCaseIds: Array.from(next) };
    });
  };

  const openTaskCreateDialog = (stress = false) => {
    setTaskCreateError('');
    setTaskPickerCollapsed(new Set());
    setTaskCreateDialog({
      name: `${stress ? '压测' : '测试'}任务 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`,
      stress: stress ? { mode: 'rounds', value: 10, phoneLog: false, glassesLog: true } : undefined,
      selectedCaseIds: [],
      collectPhonePerformance: false,
      collectGlassesPerformance: false,
      startOptions: stress ? { ...defaultAutomationTaskStartOptions, recordPhoneScreen: false, recordGlassesScreen: false } : defaultAutomationTaskStartOptions,
    });
  };

  const createTaskFromDialog = async () => {
    if (!taskCreateDialog || taskSubmitLockRef.current) {
      return;
    }
    const stress = taskCreateDialog.stress;
    if (stress && (!Number.isSafeInteger(stress.value) || stress.value < 1 || stress.value > 100000)) {
      setTaskCreateError('压测轮数或分钟数须为 1–100000 的整数');
      return;
    }

    const selectedIds = new Set(taskCreateDialog.selectedCaseIds);
    const selectedCases = cases.filter((testCase) => selectedIds.has(testCase.id));

    if (selectedCases.length === 0) {
      setTaskCreateError('请选择至少一个用例创建测试任务');
      return;
    }

    const taskName = taskCreateDialog.name.trim() || `测试任务 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
    const performanceOptions = {
      threadStacks: taskCreateDialog.threadStacks,
      phone: taskCreateDialog.collectPhonePerformance,
      glasses: taskCreateDialog.collectGlassesPerformance,
    };
    const startOptions = normalizeAutomationTaskStartOptions(taskCreateDialog.startOptions);
    taskSubmitLockRef.current = true;
    setIsSubmittingTask(true);
    setTaskCreateError('');
    try {
      const result = await runCaseTask(taskName, selectedCases, '', performanceOptions, startOptions, stress);
      if (result.success) {
        setTaskCreateDialog(null);
      } else {
        setTaskCreateError(result.error);
      }
    } catch (error) {
      setTaskCreateError(`任务提交异常：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      taskSubmitLockRef.current = false;
      setIsSubmittingTask(false);
    }
  };

  const createQuickTaskFromDialog = async () => {
    if (!quickTaskPerformanceDialog || taskSubmitLockRef.current) return;
    const folder = caseLibraryFolders.find(item => item.id === quickTaskPerformanceDialog.folderId);
    if (!folder) {
      setQuickTaskCreateError('未找到要运行的用例文件夹，请重新选择');
      return;
    }
    taskSubmitLockRef.current = true;
    setIsSubmittingTask(true);
    setQuickTaskCreateError('');
    try {
      const result = await runFolderTask(folder, {
        threadStacks: quickTaskPerformanceDialog.threadStacks,
        phone: quickTaskPerformanceDialog.collectPhonePerformance,
        glasses: quickTaskPerformanceDialog.collectGlassesPerformance,
      }, normalizeAutomationTaskStartOptions(quickTaskPerformanceDialog.startOptions));
      if (result.success) setQuickTaskPerformanceDialog(null);
      else setQuickTaskCreateError(result.error);
    } catch (error) {
      setQuickTaskCreateError(`任务提交异常：${error instanceof Error ? error.message : String(error)}`);
    } finally {
      taskSubmitLockRef.current = false;
      setIsSubmittingTask(false);
    }
  };

  const renderTaskFolderPicker = (folder: CaseFolder, depth = 0): React.ReactNode => {
    const branchKey = `folder:${folder.id}`;
    const expanded = !taskPickerCollapsed.has(branchKey);
    const folderCaseIds = getFolderCaseIdsForTask(folder.id);
    const selectedIds = new Set(taskCreateDialog?.selectedCaseIds || []);
    const selectedCount = folderCaseIds.filter((caseId) => selectedIds.has(caseId)).length;
    const folderCases = allCasesByFolder.get(folder.id) || [];
    const childFolders = childFoldersByParent.get(folder.id) || [];
    const isChecked = folderCaseIds.length > 0 && selectedCount === folderCaseIds.length;
    const isPartial = selectedCount > 0 && selectedCount < folderCaseIds.length;

    return (
      <div key={folder.id} className="space-y-1">
        <div
          className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm font-bold text-slate-700 hover:bg-slate-50"
          style={{ paddingLeft: `${12 + depth * 18}px` }}
        >
          <input
            type="checkbox"
            checked={isChecked}
            aria-label={`选择文件夹 ${folder.name}`}
            aria-checked={isPartial ? 'mixed' : isChecked}
            ref={(input) => { if (input) input.indeterminate = isPartial; }}
            disabled={folderCaseIds.length === 0}
            onChange={(event) => setTaskCaseSelection(folderCaseIds, event.target.checked)}
            className="h-4 w-4 rounded border-slate-300 text-blue-600"
          />
          <button type="button" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}文件夹 ${folder.name}`}
            onClick={() => setTaskPickerCollapsed((current) => toggleTreeBranch(current, branchKey))}
            className="flex min-w-0 flex-1 items-center gap-2 text-left">
            <CaseTreeDisclosure expanded={expanded} />
            <Folder className="h-4 w-4 shrink-0 text-blue-500" />
            <span className="min-w-0 flex-1 truncate" title={folder.name}>{folder.name}</span>
          </button>
          <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
            isPartial ? 'bg-amber-50 text-amber-600' : 'bg-slate-100 text-slate-500'
          }`}>
            {selectedCount}/{folderCaseIds.length}
          </span>
        </div>
        {expanded && folderCases.map((testCase) => (
          <label
            key={testCase.id}
            className="flex min-w-0 items-center gap-2 rounded-xl px-3 py-2 text-sm text-slate-600 hover:bg-slate-50"
            style={{ paddingLeft: `${34 + depth * 18}px` }}
          >
            <input
              type="checkbox"
              checked={selectedIds.has(testCase.id)}
              onChange={(event) => setTaskCaseSelection([testCase.id], event.target.checked)}
              className="h-4 w-4 rounded border-slate-300 text-blue-600"
            />
            <ListChecks className="h-3.5 w-3.5 shrink-0 text-slate-400" />
            <span className="min-w-0 flex-1 truncate font-bold">{testCase.name}</span>
            <span className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-black text-slate-500">
              {testCase.steps.length} 步
            </span>
          </label>
        ))}
        {expanded && childFolders.map((childFolder) => renderTaskFolderPicker(childFolder, depth + 1))}
      </div>
    );
  };

  const toggleAutomationTaskSelection = (taskId: string, checked: boolean) => {
    setSelectedAutomationTaskIds((current) => {
      const next = new Set(current);

      if (checked) {
        next.add(taskId);
      } else {
        next.delete(taskId);
      }

      return next;
    });
  };

  const setAllAutomationTaskSelection = (checked: boolean) => {
    setSelectedAutomationTaskIds(() => (
      checked
        ? new Set(automationTasks.filter((task) => !isAutomationTaskActive(task)).map((task) => task.id))
        : new Set()
    ));
  };

  const deleteAutomationTasks = async (taskIds: string[]) => {
    if(taskCleanupLockRef.current)return;
    if(!taskCleanupSupported){setRunMessage('当前桌面服务尚未加载任务清理接口，请更新并正常重启应用');return;}
    if(!electronApi?.ipcRenderer){setRunMessage('任务清理需要桌面服务，未删除任何任务');return;}
    taskCleanupLockRef.current=true;
    setTaskCleanupBusy(true);
    try{
      const request={taskIds,limit:Math.max(50,taskIds.length),purgeArtifacts:purgeTaskArtifacts};
      const result=await electronApi.ipcRenderer.invoke('workflow-task:clean',request);
      if(!result?.success)throw Error(result?.error || '清理失败');
      applyTaskRemovals(result.removedTaskIds || []);
      setRunMessage(`已移除 ${result.count} 条任务${result.purgeErrors?.length?'；部分产物待清理，请查看回执':''}`);
    }catch(e){setRunMessage(e instanceof Error?e.message:String(e));}finally{taskCleanupLockRef.current=false;setTaskCleanupBusy(false);}
  };

  const renderAutomationTasks = () => {
    const deletableTaskIds = automationTasks.filter((task) => !isAutomationTaskActive(task)).map((task) => task.id);
    const selectedDeletableCount = deletableTaskIds.filter((taskId) => selectedAutomationTaskIds.has(taskId)).length;
    const allDeletableSelected = deletableTaskIds.length > 0 && selectedDeletableCount === deletableTaskIds.length;

    return (
    <div className="flex-1 min-h-0 bg-slate-50 p-6 overflow-auto">
      <div className="mx-auto max-w-6xl">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-black text-slate-900">测试任务</h2>
            <p className="mt-1 text-xs font-medium text-slate-500">从用例库圈选用例组成测试任务，报告详情单独进入报告页查看。</p>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => openTaskCreateDialog(false)}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white shadow-sm hover:bg-blue-700"
            >
              <Plus className="h-3.5 w-3.5" />
              创建测试任务
            </button>
            <button type="button" onClick={() => openTaskCreateDialog(true)} className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100">创建压测任务</button>
            <button
              type="button"
              onClick={() => void openAutomationTaskReportPackage()}
              className="inline-flex items-center gap-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-black text-blue-700 hover:bg-blue-100"
            >
              <FileUp className="h-3.5 w-3.5" />
              打开报告包
            </button>
          </div>
        </div>

        {Object.entries(taskStopFeedback).map(([id, message]) => <p key={id} role="status" className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-slate-700">{automationTasks.find(task => task.id === id)?.name || id}：{isAutomationTaskActive(automationTasks.find(task => task.id === id) || { status: 'stopped' } as AutomationTaskRecord) ? message : '任务已结束'}</p>)}
        {automationTasks.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <label className="flex items-center gap-2 text-xs font-black text-slate-600">
              <input
                type="checkbox"
                checked={allDeletableSelected}
                disabled={deletableTaskIds.length === 0}
                onChange={(event) => setAllAutomationTaskSelection(event.target.checked)}
                className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-40"
              />
              全选可删除报告
            </label>
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-slate-400">
                已选 {selectedDeletableCount} / {deletableTaskIds.length}
              </span>
              <button
                type="button"
                disabled={!taskCleanupSupported || taskCleanupBusy || selectedDeletableCount === 0}
                onClick={() => deleteAutomationTasks(Array.from(selectedAutomationTaskIds))}
                className="inline-flex items-center gap-1.5 rounded-xl border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-black text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除选中
              </button>
              <label className="flex items-center gap-1 text-xs text-slate-500"><input type="checkbox" checked={purgeTaskArtifacts} disabled={!taskCleanupSupported || taskCleanupBusy} onChange={e=>setPurgeTaskArtifacts(e.target.checked)}/>同时清理产物</label>
              {!taskCleanupSupported && <span className="text-xs text-slate-400">清理功能需更新并重启桌面服务</span>}
            </div>
          </div>
        )}

        <div className="mt-5 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          {automationTasks.length === 0 ? (
            <div className="px-5 py-10 text-center">
              <Rocket className="mx-auto h-8 w-8 text-slate-300" />
              <div className="mt-3 text-sm font-black text-slate-700">暂无测试任务</div>
              <div className="mt-1 text-xs font-bold text-slate-400">点击“创建测试任务”，从库、文件夹或单条用例维度圈选要执行的用例。</div>
            </div>
          ) : automationTasks.map((task) => {
            const { successCount, failedCount, stoppedCount, caseCount } = getAutomationTaskCounts(task);
            const isTaskRunning = isAutomationTaskActive(task);
            const canRerunFailed = !task.readonly && !isTaskRunning && failedCount > 0;
            return (
              <div key={task.id} data-task-id={task.id} data-task-status={task.status} className="grid grid-cols-[28px_minmax(0,1fr)_120px_160px_320px] items-center gap-4 border-b border-slate-100 px-5 py-4 last:border-b-0">
                <input
                  type="checkbox"
                  checked={selectedAutomationTaskIds.has(task.id)}
                  disabled={isTaskRunning}
                  onChange={(event) => toggleAutomationTaskSelection(task.id, event.target.checked)}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:cursor-not-allowed disabled:opacity-35"
                  title={isTaskRunning ? '执行中的任务不能删除' : '选择报告'}
                />
                <button
                  type="button"
                  onClick={() => void openAutomationTaskReport(task)}
                  data-task-report={task.id}
                  className="min-w-0 text-left"
                >
                  <div className="flex min-w-0 items-center gap-2">
                    <div className="truncate text-sm font-black text-slate-900 hover:text-blue-600">{task.name}</div>
                    {task.stress && <div className="mt-1 text-xs font-bold text-blue-600">压测 · {task.stress.mode === 'rounds' ? `${task.stress.value} 轮` : `${task.stress.value} 分钟`} · 第 {task.currentRound || 1} 轮</div>}
                    {task.externalSource && <span className="shrink-0 text-xs font-bold text-blue-600">隔离执行 · 已同步</span>}
                    {task.imported && (
                      <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">
                        只读
                      </span>
                    )}
                  </div>
                  <div className="mt-1 truncate text-xs text-slate-500">
                    <span className="font-mono font-bold text-slate-400">ID {task.id}</span>
                    <span className="mx-1 text-slate-300">·</span>
                    {task.currentCaseName
                      ? `当前执行：${task.currentCaseName}${task.currentStepName ? ` · ${task.currentStepName}` : ''}`
                      : `创建于 ${formatRunTime(task.createdAt)}`}
                  </div>
                </button>
                <div className={`text-xs font-bold ${
                  task.status === 'success' ? 'text-emerald-600' : task.status === 'failed' ? 'text-rose-600' : isTaskRunning ? 'text-blue-600' : 'text-slate-500'
                }`}>
                  {task.status === 'success' ? stoppedCount ? '已停止' : '已完成' : task.status === 'failed' ? '有失败' : task.status === 'stopped' ? '已停止' : task.status === 'stopping' ? '停止中' : isTaskRunning ? '执行中' : '等待执行'}
                </div>
                <div className="text-xs font-mono font-bold">
                  <span className="text-emerald-600">{successCount}</span>
                  <span className="text-slate-300">/</span>
                  <span className="text-rose-600">{failedCount}</span>
                  <span className="text-slate-300">/</span>
                  <span className="text-slate-900">{caseCount || task.total}</span>
                </div>
                <div className="flex items-center justify-end gap-2">
                  <button
                    className="rounded-lg border border-rose-100 bg-rose-50 px-3 py-1.5 text-xs font-bold text-rose-700 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    disabled={!canRerunFailed || pendingTaskActions.has(task.id)}
                    onClick={() => rerunFailedAutomationTask(task)}
                    title={isTaskRunning ? '任务执行中不可重跑失败' : failedCount > 0 ? '只重跑执行失败的用例' : '没有失败用例可重跑'}
                  >
                    {pendingTaskActions.has(task.id) ? '正在提交…' : '重跑失败'}
                  </button>
                  <button
                    className={`rounded-lg px-3 py-1.5 text-xs font-bold ${
                      isTaskRunning
                        ? 'bg-rose-600 text-white hover:bg-rose-700'
                        : 'border border-blue-100 bg-blue-50 text-blue-700 hover:bg-blue-100'
                    }`}
                    type="button"
                    disabled={task.readonly || taskStopPending.has(task.id) || (!isTaskRunning && pendingTaskActions.has(task.id))}
                    onClick={() => isTaskRunning ? void stopAutomationTask(task.id) : rerunAutomationTask(task)}
                  >
                    {task.readonly ? '只读' : taskStopPending.has(task.id) ? '正在请求…' : task.status === 'stopping' ? '停止中…' : isTaskRunning ? '停止' : '重跑'}
                  </button>
                  <button
                    className="rounded-lg border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
                    type="button"
                    onClick={() => void openAutomationTaskReport(task)}
                    title={task.error || '查看测试报告'}
                  >
                    报告
                  </button>
                  <button
                    className="inline-flex items-center gap-1 rounded-lg border border-rose-100 bg-white px-2.5 py-1.5 text-xs font-bold text-rose-600 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-45"
                    type="button"
                    disabled={isTaskRunning}
                    onClick={() => deleteAutomationTasks([task.id])}
                    title={isTaskRunning ? '执行中的任务不能删除' : '删除测试报告'}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                  </button>
                </div>
                {taskActionFeedback[task.id] && <div className="col-span-full"><TaskActionNotice feedback={taskActionFeedback[task.id]} onOpenTask={openTaskActionReport} /></div>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
    );
  };

  const selectComponent = (component: TestComponent) => {
    setSelectedComponentId(component.id);
    setComponentDraft(componentToDraft(component));
    setComponentMessage('');
  };

  const createComponent = (kind: TestComponentKind = 'adb') => {
    const component = createDefaultComponent(kind);

    setComponents((current) => [...current, component]);
    setComponentLibraryTab(kind === 'adb' || kind === 'pc_command' || kind === 'activity' || kind === 'audio' || kind === 'image_mock' || kind === 'mobile_ui_action' ? 'execute' : 'detect');
    selectComponent(component);
    setIsAddComponentMenuOpen(false);
  };

  const saveComponent = () => {
    try {
      const previousComponent = components.find((component) => component.id === selectedComponentId);
      const nextComponent = draftToComponent(selectedComponentId, componentDraft);
      const syncedStepCount = previousComponent && previousComponent.device !== nextComponent.device
        ? cases.reduce((count, testCase) => (
            count + testCase.steps.filter((step) => (
              step.componentId === nextComponent.id && step.device === previousComponent.device
            )).length
          ), 0)
        : 0;

      setComponents((current) => current.map((component) => (
        component.id === selectedComponentId ? nextComponent : component
      )));
      if (previousComponent && previousComponent.device !== nextComponent.device) {
        setCases((current) => current.map((testCase) => ({
          ...testCase,
          steps: testCase.steps.map((step) => {
            if (step.componentId !== nextComponent.id || step.device !== previousComponent.device) {
              return step;
            }

            return {
              ...step,
              device: nextComponent.device,
            };
          }),
        })));
      }
      setComponentMessage(
        syncedStepCount > 0
          ? `组件已保存，已同步 ${syncedStepCount} 个引用节点的目标设备类型`
          : '组件已保存，并会出现在 Flow 顶部组件库中'
      );
    } catch (error) {
      setComponentMessage(`保存失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const deleteComponent = () => {
    if (components.length <= 1) {
      setComponentMessage('至少保留一个测试组件');
      return;
    }

    const nextComponents = components.filter((component) => component.id !== selectedComponentId);
    setComponents(nextComponents);
    selectComponent(nextComponents[0]);
  };

  const getComponentDraftParamValue = (key: string, fallback = '') => (
    componentDraft.params.find((param) => param.key === key)?.defaultValue ?? fallback
  );

  const setComponentDraftParamValue = (key: string, value: string) => {
    setComponentDraft((current) => {
      const paramIndex = current.params.findIndex((param) => param.key === key);

      if (paramIndex >= 0) {
        return {
          ...current,
          params: current.params.map((param, index) => (
            index === paramIndex ? { ...param, defaultValue: value } : param
          )),
        };
      }

      return {
        ...current,
        params: [
          ...current.params,
          {
            key,
            label: key,
            inputType: 'text',
            defaultValue: value,
          },
        ],
      };
    });
  };

  const buildImageMockDraftCommandPreview = () => {
    const imagePath = getComponentDraftParamValue('imagePath', '');
    const remoteImagePath = normalizeImageMockRemotePathForPreview(
      resolveTemplateValue(getComponentDraftParamValue('remoteImagePath', defaultImageMockRemotePath) || defaultImageMockRemotePath, previewContext),
      imagePath
    );
    const pushDevice = getComponentDraftParamValue('pushDevice', 'glasses') === 'phone' ? 'phone' : 'glasses';
    const commandDevice = getComponentDraftParamValue('commandDevice', 'phone') === 'pc' ? 'pc' : getComponentDraftParamValue('commandDevice', 'phone') === 'glasses' ? 'glasses' : 'phone';
    const pushSerial = pushDevice === 'glasses' ? previewContext.glassesSerial : previewContext.phoneSerial;
    const commandSerial = commandDevice === 'pc' ? '' : commandDevice === 'glasses' ? previewContext.glassesSerial : previewContext.phoneSerial;
    const values: Record<string, string> = {
      serial: commandSerial,
      pushSerial,
      commandSerial,
      pushDevice,
      commandDevice,
      phoneSerial: previewContext.phoneSerial,
      glassesSerial: previewContext.glassesSerial,
      phonePackage: previewContext.phonePackage,
      glassesPackage: previewContext.glassesPackage,
      imagePath,
      localImagePath: imagePath,
      remoteImagePath,
      imageFileName: getBaseNameFromPath(imagePath || remoteImagePath),
    };

    componentDraft.params.forEach((param) => {
      values[param.key] = param.defaultValue || '';
    });

    return (componentDraft.commandTemplate || defaultImageMockCommandTemplate).replace(/\{\{([^}]+)\}\}/g, (_match, expression) => {
      const key = expression.trim();
      return values[key] ?? '';
    });
  };

  const addComponentDraftParam = () => {
    setComponentDraft((current) => ({
      ...current,
      params: [
        ...current.params,
        {
          key: '',
          label: '',
          inputType: 'text',
          defaultValue: '',
          helperText: '',
          required: false,
        },
      ],
    }));
  };

  const updateComponentDraftParam = (index: number, patch: Partial<ComponentParam>) => {
    setComponentDraft((current) => ({
      ...current,
      params: current.params.map((param, paramIndex) => (
        paramIndex === index ? { ...param, ...patch } : param
      )),
    }));
  };

  const removeComponentDraftParam = (index: number) => {
    setComponentDraft((current) => ({
      ...current,
      params: current.params.filter((_, paramIndex) => paramIndex !== index),
    }));
  };

  const generateTtsRegexFromSelection = () => {
    const textarea = document.getElementById('tts-sample-log-input') as HTMLTextAreaElement | null;
    const sampleLog = getComponentDraftParamValue('sampleLog', '');
    const targetText = getComponentDraftParamValue('sampleExtractText', '').trim();
    const selectedText = textarea
      ? textarea.value.slice(textarea.selectionStart, textarea.selectionEnd)
      : '';
    const extractText = targetText || selectedText;
    const regex = createTtsExtractRegexFromSelection(sampleLog, extractText);

    if (!regex) {
      setComponentMessage('请先填写日志样例和提取内容，或在日志样例中选中代表目标文本的内容');
      return;
    }

    setComponentDraftParamValue('extractRegex', regex);
    if (!getComponentDraftParamValue('expectedText', '').trim()) {
      setComponentDraftParamValue('expectedText', extractText);
    }
    setComponentMessage('已根据日志样例和提取内容生成 TTS 提取正则');
  };

  const generateJsonRegexFromSample = () => {
    const sampleLog = getComponentDraftParamValue('sampleLog', '');
    const samplePayload = getComponentDraftParamValue('samplePayload', '');
    const regex = createJsonExtractRegexFromSample(sampleLog, samplePayload);

    if (!regex) {
      setComponentMessage('请确认日志原文和提取内容都已填写，且提取内容完整存在于日志原文中');
      return;
    }

    setComponentDraftParamValue('lineRegex', regex);
    setComponentMessage('已根据日志原文和提取内容生成 JSON 提取正则');
  };

  const updateJsonAssertComponentCondition = (index: number, patch: Partial<JsonAssertCondition>) => {
    const conditions = parseJsonAssertConditionsForUi(getComponentDraftParamValue('conditions', '[]'));
    const nextConditions = conditions.map((condition, conditionIndex) => (
      conditionIndex === index ? { ...condition, ...patch } : condition
    ));

    setComponentDraftParamValue('conditions', stringifyJsonAssertConditions(nextConditions));
  };

  const addJsonAssertComponentCondition = () => {
    const conditions = parseJsonAssertConditionsForUi(getComponentDraftParamValue('conditions', '[]'));

    setComponentDraftParamValue('conditions', stringifyJsonAssertConditions([
      ...conditions,
      { path: '', operator: 'equals', value: '', ignoreCase: false },
    ]));
  };

  const removeJsonAssertComponentCondition = (index: number) => {
    const conditions = parseJsonAssertConditionsForUi(getComponentDraftParamValue('conditions', '[]'));

    setComponentDraftParamValue(
      'conditions',
      stringifyJsonAssertConditions(conditions.filter((_, conditionIndex) => conditionIndex !== index))
    );
  };

  const selectAudioFileForComponentDraft = async () => {
    if (!electronApi?.ipcRenderer) {
      setComponentMessage('当前环境无法选择本地音频文件');
      return;
    }

    const result = await electronApi.ipcRenderer.invoke('dialog:select-audio-file') as {
      success: boolean;
      path?: string;
      canceled?: boolean;
      error?: string;
    };

    if (result.success && result.path) {
      setComponentDraftParamValue('sourceType', 'file');
      setComponentDraftParamValue('localPath', result.path);
      setComponentMessage('已选择音频文件');
    } else if (!result.canceled) {
      setComponentMessage(`选择音频失败：${result.error || '未知错误'}`);
    }
  };

  const selectImageFileForComponentDraft = async () => {
    if (!electronApi?.ipcRenderer) {
      setComponentMessage('当前环境无法选择本地图片文件');
      return;
    }

    const result = await electronApi.ipcRenderer.invoke('dialog:select-image-file') as {
      success: boolean;
      path?: string;
      canceled?: boolean;
      error?: string;
    };

    if (result.success && result.path) {
      setComponentDraftParamValue('imagePath', result.path);
      setComponentMessage('已选择图片文件，保存到 Git 时会自动归档到 assets/images');
    } else if (!result.canceled) {
      setComponentMessage(`选择图片失败：${result.error || '未知错误'}`);
    }
  };

  const renderComponentParamEditor = (params: Array<{ param: ComponentParam; index: number }>) => (
    <div className="space-y-3">
      {params.map(({ param, index }) => (
        <div key={`${param.key}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-[1fr_1fr_110px_36px] gap-2">
            <input
              value={param.key}
              onChange={(event) => updateComponentDraftParam(index, { key: event.target.value })}
              placeholder="key，如 audioPath"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
            />
            <input
              value={param.label}
              onChange={(event) => updateComponentDraftParam(index, { label: event.target.value })}
              placeholder="展示名称"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
            />
            <select
              value={param.inputType}
              onChange={(event) => updateComponentDraftParam(index, { inputType: event.target.value as ComponentParam['inputType'] })}
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
            >
              <option value="text">文本</option>
              <option value="textarea">多行文本</option>
              <option value="number">数字</option>
              <option value="json">JSON</option>
            </select>
            <button
              type="button"
              onClick={() => removeComponentDraftParam(index)}
              className="h-9 rounded-lg text-rose-500 hover:bg-rose-50"
              title="删除参数"
            >
              <Trash2 className="mx-auto h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <input
              value={param.defaultValue || ''}
              onChange={(event) => updateComponentDraftParam(index, { defaultValue: event.target.value })}
              placeholder="默认值"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-300"
            />
            <input
              value={param.helperText || ''}
              onChange={(event) => updateComponentDraftParam(index, { helperText: event.target.value })}
              placeholder="引导文案"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-300"
            />
          </div>
        </div>
      ))}
    </div>
  );

  const renderAutomationComponents = () => {
    const activeComponentTab = componentLibraryTabs.find((tab) => tab.key === componentLibraryTab) || componentLibraryTabs[0];
    const visibleComponents = customComponents.filter((component) => (
      activeComponentTab.kinds.includes(component.kind || 'adb') && !isLegacyBusinessComponent(component)
    ));
    const selectedComponent = visibleComponents.find((component) => component.id === selectedComponentId) || visibleComponents[0];
    const componentTemplates: Record<ComponentLibraryTab, Array<[TestComponentKind, string, string]>> = {
      execute: [
        ['adb', '通用 ADB 命令', '通过 adb 命令模板执行通用动作'],
        ['pc_command', '通用 PC 命令', '在当前电脑执行命令，无需选择设备'],
        ['activity', '拉起 Activity', '拉起指定 Activity 并校验前台状态'],
        ['audio', '音频输入', '选择/录制音频，push 后触发 adb 命令'],
        ['image_mock', '图片 Mock', '选择图片，push 到设备后执行 Mock 命令'],
        ['mobile_ui_action', '手机 UI 操作', '点击、输入、滑动或返回手机页面'],
      ],
      detect: [
        ['mobile_ui_assert', '手机 UI 元素校验', '校验手机页面上是否存在指定元素'],
        ['tts_assert', '日志文本提取断言', '从日志提取文本并比对期望值'],
        ['json_assert', 'JSON 日志断言', '正则定位日志，解析 JSON 后校验字段'],
        ['llm_assert', 'LLM 语义断言', '结合变量和当前日志做语义断言'],
      ],
    };

    return (
      <div className="flex-1 min-h-0 bg-slate-50 p-6 overflow-auto">
        <div className="mx-auto grid max-w-6xl grid-cols-[300px_minmax(0,1fr)] gap-5">
          <aside>
            <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-black text-slate-900">测试组件管理</h2>
              </div>
              <div className="mt-3 grid grid-cols-2 rounded-xl border border-slate-200 bg-slate-100 p-1">
                {componentLibraryTabs.map((tab) => (
                  <button
                    key={tab.key}
                    type="button"
                    onClick={() => setComponentLibraryTab(tab.key)}
                    className={`h-8 rounded-lg text-xs font-black transition ${
                      componentLibraryTab === tab.key
                        ? 'bg-white text-blue-600 shadow-sm'
                        : 'text-slate-500 hover:text-slate-900'
                    }`}
                  >
                    {tab.label}
                  </button>
                ))}
              </div>
              <div className="relative mt-3">
                <button
                  type="button"
                  onClick={() => setIsAddComponentMenuOpen((current) => !current)}
                  className="w-full rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold text-blue-700 hover:bg-blue-100"
                >
                  新增测试组件
                </button>
                {isAddComponentMenuOpen && (
                  <div className="absolute left-0 right-0 top-11 z-20 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">
                    {componentTemplates[componentLibraryTab].map(([kind, title, description]) => (
                      <button
                        key={kind}
                        type="button"
                        onClick={() => createComponent(kind)}
                        className="w-full border-b border-slate-100 px-3 py-3 text-left last:border-b-0 hover:bg-slate-50"
                      >
                        <div className="text-xs font-black text-slate-900">{title}</div>
                        <div className="mt-1 text-[10px] font-bold text-slate-400">{description}</div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-4 space-y-2">
                {visibleComponents.length ? visibleComponents.map((component) => (
                    <button
                      key={component.id}
                      type="button"
                      onClick={() => selectComponent(component)}
                      className={`w-full rounded-xl border p-3 text-left transition-all ${
                        selectedComponent?.id === component.id
                          ? 'border-blue-200 bg-blue-50'
                          : 'border-slate-200 bg-white hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <div className="rounded-lg bg-blue-600 p-2 text-white">
                          {component.kind === 'audio' ? (
                            <Mic className="h-4 w-4" />
                          ) : component.kind === 'image_mock' ? (
                            <ImageIcon className="h-4 w-4" />
                          ) : component.kind === 'mobile_ui_assert' || component.kind === 'tts_assert' || component.kind === 'json_assert' || component.kind === 'llm_assert' ? (
                            <Search className="h-4 w-4" />
                          ) : (
                            <Terminal className="h-4 w-4" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-xs font-black text-slate-900">{component.name}</div>
                          <div className="mt-1 text-[10px] font-bold text-slate-500">
                            {componentKindLabels[component.kind || 'adb']} · {component.params.length} 个参数
                          </div>
                        </div>
                      </div>
                    </button>
                )) : (
                  <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs font-bold text-slate-400">
                    当前分类暂无组件
                  </div>
                )}
              </div>
            </div>
          </aside>

          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-sm font-black text-slate-900">组件配置</h2>
                <p className="mt-1 text-xs text-slate-500">组件可以是 ADB 命令、音频输入或日志断言，参数会在 Flow 步骤里呈现。</p>
              </div>
              <div className="rounded-xl bg-slate-100 px-3 py-1.5 text-xs font-black text-slate-500">
                ADB 命令模板
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">组件名称</label>
                <input
                  value={componentDraft.name}
                  onChange={(event) => setComponentDraft((current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">组件类型</label>
                <div className="mt-1 flex h-10 items-center rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-black text-slate-700">
                  {componentKindLabels[componentDraft.kind]}
                </div>
              </div>
              {componentDraft.kind !== 'image_mock' && componentDraft.kind !== 'pc_command' && (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">目标设备类型</label>
                  <select
                    value={componentDraft.device}
                    onChange={(event) => setComponentDraft((current) => ({ ...current, device: event.target.value as TestComponent['device'] }))}
                    className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300"
                  >
                    <option value="phone">手机</option>
                    <option value="glasses">眼镜</option>
                    {componentDraft.kind === 'audio' && <option value="pc">当前电脑（PC）</option>}
                  </select>
                </div>
              )}
              {componentDraft.kind === 'pc_command' && (
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">执行位置</label>
                  <div className="mt-1 flex h-10 items-center rounded-xl border border-blue-100 bg-blue-50 px-3 text-sm font-black text-blue-700">
                    当前电脑（无需选择设备）
                  </div>
                </div>
              )}
              <div>
                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Tag，逗号分隔</label>
                <input
                  value={componentDraft.tags}
                  onChange={(event) => setComponentDraft((current) => ({ ...current, tags: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">超时，秒</label>
                <input
                  type="number"
                  value={componentDraft.timeoutSeconds}
                  onChange={(event) => setComponentDraft((current) => ({ ...current, timeoutSeconds: Number(event.target.value || 0) }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">描述</label>
                <input
                  value={componentDraft.description}
                  onChange={(event) => setComponentDraft((current) => ({ ...current, description: event.target.value }))}
                  className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none focus:border-blue-300"
                />
              </div>

              {componentDraft.kind === 'audio' && (
                <div className="col-span-2 space-y-4">
                  <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 p-4">
                    <div className="text-xs font-black text-slate-900">1. 音频选择</div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">音频来源</label>
                        <select
                          value={getComponentDraftParamValue('sourceType', 'file')}
                          onChange={(event) => setComponentDraftParamValue('sourceType', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-blue-300"
                        >
                          <option value="file">直接选择电脑音频文件</option>
                          <option value="record">电脑录制音频</option>
                          <option value="tts">TTS 合成</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">最终音频格式</label>
                        <select
                          value={getComponentDraftParamValue('outputFormat', 'pcm')}
                          onChange={(event) => {
                            const outputFormat = event.target.value;
                            setComponentDraftParamValue('outputFormat', outputFormat);
                          }}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-blue-300"
                        >
                          <option value="pcm">PCM</option>
                          <option value="wav">WAV</option>
                          <option value="ogg">OGG (Opus)</option>
                          <option value="speex">Speex (Ogg / .spx)</option>
                        </select>
                      </div>
                    </div>

                    <div className="mt-3 rounded-xl border border-indigo-100 bg-white/70 p-3">
                      <div className="text-[11px] font-black text-slate-700">电脑录音转码参数</div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">sampleFormat</label>
                          <select
                            value={resolveAvSampleFormat(getComponentDraftParamValue('sampleFormat', defaultAudioTranscodeParams.sampleFormat)).key}
                            onChange={(event) => setComponentDraftParamValue('sampleFormat', event.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
                          >
                            {avSampleFormats.map((format) => (
                              <option key={format.key} value={format.key}>{format.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">sampleRate</label>
                          <input
                            type="number"
                            value={getComponentDraftParamValue('sampleRate', defaultAudioTranscodeParams.sampleRate)}
                            onChange={(event) => setComponentDraftParamValue('sampleRate', event.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
                          />
                        </div>
                        <div className="col-span-2">
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">尾部静音（ms）</label>
                          <input
                            type="number"
                            min="0"
                            max="60000"
                            step="1"
                            value={getComponentDraftParamValue('trailingSilenceMs', defaultAudioTranscodeParams.trailingSilenceMs)}
                            onChange={(event) => setComponentDraftParamValue('trailingSilenceMs', event.target.value)}
                            className="mt-1 h-9 w-full rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
                          />
                        </div>
                      </div>
                      <div className="mt-2 text-[10px] font-bold leading-4 text-slate-400">
                        codeFmt 由最终音频格式决定；声道数固定为 1。尾部静音会写入实际推送文件，默认 800ms。默认对齐 receiveDenoiseAudio(audioBuffer, "pcm", AV_SAMPLE_FMT_S16, 16000, 1, extInfo)。
                      </div>
                    </div>

                    {getComponentDraftParamValue('sourceType', 'file') === 'tts' ? (
                      <div className="mt-3">
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">TTS 文本</label>
                        <textarea
                          value={getComponentDraftParamValue('ttsText', '')}
                          onChange={(event) => setComponentDraftParamValue('ttsText', event.target.value)}
                          className="mt-1 h-20 w-full resize-none rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-5 outline-none focus:border-blue-300"
                          placeholder="执行时通过设置中心的 HTTP TTS 合成"
                        />
                        <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold text-amber-700">
                          执行时会读取设置中心的 HTTP TTS 配置，合成音频后推送到设备。
                        </div>
                      </div>
                    ) : (
                      <div className="mt-3">
                        <div className="flex items-center justify-between">
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">本地音频文件</label>
                          <div className="flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void toggleAudioRecording(`component-draft-${selectedComponentId}`)}
                              className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ${
                                recordingState?.stepId === `component-draft-${selectedComponentId}`
                                  ? 'border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100'
                                  : 'border border-slate-200 bg-white text-slate-500 hover:bg-slate-50'
                              }`}
                            >
                              {recordingState?.stepId === `component-draft-${selectedComponentId}` ? (
                                <Square className="h-3 w-3 fill-current" />
                              ) : (
                                <Mic className="h-3 w-3" />
                              )}
                              {recordingState?.stepId === `component-draft-${selectedComponentId}` ? '结束录音' : '电脑录音'}
                            </button>
                            <button
                              type="button"
                              onClick={() => void playAudioPreview(`component-draft-${selectedComponentId}`)}
                              disabled={!recordingPreviewUrls[`component-draft-${selectedComponentId}`] && !String(getComponentDraftParamValue('localPath', '')).trim()}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                            >
                              播放音频
                            </button>
                            <button
                              type="button"
                              onClick={() => void selectAudioFileForComponentDraft()}
                              className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                            >
                              选择文件
                            </button>
                          </div>
                        </div>
                        <input
                          value={getComponentDraftParamValue('localPath', '')}
                          onChange={(event) => setComponentDraftParamValue('localPath', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                          placeholder="/path/to/confirm_pay.pcm"
                        />
                      </div>
                    )}
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black text-slate-900">2. 音频 push 文件夹</div>
                    <label className="mt-3 flex items-center gap-2 text-xs font-bold">
                      <input type="checkbox" checked={getComponentDraftParamValue('pushEnabled', componentDraft.device === 'pc' ? 'false' : 'true') === 'true'} onChange={(event) => setComponentDraftParamValue('pushEnabled', String(event.target.checked))} />
                      启用 ADB push（PC 默认关闭）
                    </label>
                    {componentDraft.device === 'pc' && getComponentDraftParamValue('pushEnabled', 'false') === 'true' && <select aria-label="音频 push 目标设备" value={getComponentDraftParamValue('pushDevice', 'phone')} onChange={(event) => setComponentDraftParamValue('pushDevice', event.target.value)}><option value="phone">手机</option><option value="glasses">眼镜</option></select>}
                    <input
                      disabled={getComponentDraftParamValue('pushEnabled', componentDraft.device === 'pc' ? 'false' : 'true') !== 'true'}
                      value={getComponentDraftParamValue('remotePath', createDefaultAudioRemoteDir())}
                      onChange={(event) => setComponentDraftParamValue('remotePath', event.target.value)}
                      className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                      placeholder={createDefaultAudioRemoteDir()}
                    />
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                    <div className="text-xs font-black text-slate-900">3. {componentDraft.device === 'pc' ? 'PC 执行命令' : 'ADB 触发命令'}</div>
                    <textarea
                      value={componentDraft.commandTemplate}
                      onChange={(event) => setComponentDraft((current) => ({ ...current, commandTemplate: event.target.value }))}
                      className="mt-3 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                      placeholder='adb -s {{serial}} shell am broadcast -a ... --es audio_path "{{remotePath}}"'
                    />
                    <div className="mt-2 text-[11px] leading-5 text-slate-500">
                      {'{{localPath}}'} 为处理后的本地音频；{'{{defaults.adbPath}}'} 为当前 ADB 路径。PC 命令直接执行程序及参数，不自动套 shell。
                    </div>
                    <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-5 text-blue-700">
                      启用 push 后，{'{{remotePath}}'} 为设备端完整路径；禁用后远端路径为空，请用 {'{{localPath}}'}。
                    </div>
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">ADB 触发命令参数</label>
                        <button
                          type="button"
                          onClick={addComponentDraftParam}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                        >
                          + 参数
                        </button>
                      </div>
                      {renderComponentParamEditor(componentDraft.params
                        .map((param, index) => ({ param, index }))
                        .filter(({ param }) => !audioReservedParamKeys.has(param.key)))}
                    </div>
                  </div>
                </div>
              )}

              {componentDraft.kind === 'image_mock' && (
                <div className="col-span-2 space-y-4">
                  <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50/70 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-900">
                      <span className="rounded-lg bg-cyan-600 px-2 py-1 text-[10px] text-white">STEP 1</span>
                      图片选择
                    </div>
                    <div className="mt-3">
                      <div className="flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">图片路径或 URL</label>
                        <button
                          type="button"
                          onClick={() => void selectImageFileForComponentDraft()}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                        >
                          选择文件
                        </button>
                      </div>
                      <input
                        value={getComponentDraftParamValue('imagePath', '')}
                        onChange={(event) => setComponentDraftParamValue('imagePath', event.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                        placeholder="/path/to/mock.png 或 https://..."
                      />
                    </div>
                    <div className="mt-3 rounded-xl border border-cyan-100 bg-white/70 px-3 py-2 text-[11px] font-bold leading-5 text-cyan-800">
                      输入 http/https 会在执行时下载；选择电脑图片后，推送用例库到 Git 时会自动归档到 assets/images，其他人拉取后仍可执行。
                    </div>
                  </div>

                  <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/70 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-900">
                      <span className="rounded-lg bg-blue-600 px-2 py-1 text-[10px] text-white">STEP 2</span>
                      图片 push 路径
                    </div>
                    <div className="mt-3 grid grid-cols-[150px_minmax(0,1fr)] gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">推送设备</label>
                        <select
                          value={getComponentDraftParamValue('pushDevice', 'glasses')}
                          onChange={(event) => setComponentDraftParamValue('pushDevice', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-blue-300"
                        >
                          <option value="glasses">眼镜</option>
                          <option value="phone">手机</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">设备侧图片路径</label>
                        <input
                          value={getComponentDraftParamValue('remoteImagePath', defaultImageMockRemotePath)}
                          onChange={(event) => setComponentDraftParamValue('remoteImagePath', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                          placeholder={defaultImageMockRemotePath}
                        />
                      </div>
                    </div>
                    <div className="mt-2 text-[11px] font-bold leading-5 text-blue-700">
                      可以填写完整文件路径；如果以 / 结尾，会自动拼接图片文件名。
                    </div>
                  </div>

                  <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/70 p-4 shadow-sm">
                    <div className="flex items-center gap-2 text-xs font-black text-slate-900">
                      <span className="rounded-lg bg-violet-600 px-2 py-1 text-[10px] text-white">STEP 3</span>
                      Mock指令
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">执行设备</label>
                      <select
                        value={getComponentDraftParamValue('commandDevice', 'phone')}
                        onChange={(event) => setComponentDraftParamValue('commandDevice', event.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold outline-none focus:border-blue-300"
                      >
                        <option value="phone">手机</option>
                        <option value="glasses">眼镜</option>
                        <option value="pc">本机 PC</option>
                      </select>
                    </div>
                    <textarea
                      value={componentDraft.commandTemplate}
                      onChange={(event) => setComponentDraft((current) => ({ ...current, commandTemplate: event.target.value }))}
                      className="mt-3 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                      placeholder={defaultImageMockCommandTemplate}
                    />
                    <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-5 text-blue-700">
                      {'{{serial}}'} 是执行设备的 SN（本机 PC 时为空）；第三步命令可用 {'{{remoteImagePath}}'} 引用第 2 步 push 后的设备侧图片路径。也可使用 {'{{pushSerial}}'}、{'{{commandSerial}}'}、{'{{localImagePath}}'}、{'{{imageFileName}}'}。本机 PC 直接执行程序及参数，不自动套 shell；可用 {'{{phoneSerial}}'}、{'{{glassesSerial}}'} 指定设备，{'{{defaults.adbPath}}'} 读取当前 ADB 路径。
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Mock指令预览</label>
                      <pre className="mt-1 h-16 w-full overflow-auto rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs leading-5 text-slate-700 whitespace-pre-wrap break-words">{buildImageMockDraftCommandPreview()}</pre>
                    </div>
                    <div className="mt-4">
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Flow 页面自定义参数</label>
                        <button
                          type="button"
                          onClick={addComponentDraftParam}
                          className="rounded-lg border border-slate-200 bg-white px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                        >
                          + 参数
                        </button>
                      </div>
                      {renderComponentParamEditor(componentDraft.params
                        .map((param, index) => ({ param, index }))
                        .filter(({ param }) => !imageMockReservedParamKeys.has(param.key)))}
                    </div>
                  </div>
                </div>
              )}

              {(componentDraft.kind === 'adb' || componentDraft.kind === 'pc_command') && (
                <div className="col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                      {componentDraft.kind === 'pc_command' ? 'PC 命令模板' : 'ADB 命令模板'}
                    </label>
                    <button
                      type="button"
                      onClick={() => setCommandVariableGuide(componentDraft.kind === 'pc_command' ? 'pc_command' : 'adb')}
                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600 transition-colors hover:border-blue-200 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200"
                      title="查看变量使用教程"
                      aria-label="查看命令变量使用教程"
                    >
                      <CircleHelp className="h-4 w-4" />
                    </button>
                  </div>
                  <textarea
                    value={componentDraft.commandTemplate}
                    onChange={(event) => setComponentDraft((current) => ({ ...current, commandTemplate: event.target.value }))}
                    className="mt-1 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                  />
                  <div className="mt-2 text-[11px] leading-5 text-slate-500">
                    {componentDraft.kind === 'pc_command'
                      ? <>命令在当前电脑直接执行，不经过 shell。内置变量：{'{{phoneSerial}}'}、{'{{glassesSerial}}'}、{'{{phonePackage}}'}、{'{{glassesPackage}}'}；自定义参数用 {'{{参数key}}'} 关联。</>
                      : <>内置变量：{'{{serial}}'}、{'{{phoneSerial}}'}、{'{{glassesSerial}}'}、{'{{phonePackage}}'}、{'{{glassesPackage}}'}。自定义参数用 {'{{参数key}}'} 关联。</>}
                  </div>
                </div>
              )}

              {componentDraft.kind === 'tts_assert' && (
                <div className="col-span-2 space-y-4">
                  <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-4">
                    <div className="flex items-center justify-between">
                      <div>
                        <div className="text-xs font-black text-slate-900">日志文本提取规则</div>
                        <div className="mt-1 text-[11px] font-bold text-slate-500">
                          填写日志样例和要提取的文本片段，生成可复用的提取正则。
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={generateTtsRegexFromSelection}
                        className="rounded-xl bg-orange-600 px-3 py-2 text-xs font-black text-white hover:bg-orange-700"
                      >
                        生成正则
                      </button>
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">日志样例</label>
                      <textarea
                        id="tts-sample-log-input"
                        value={getComponentDraftParamValue('sampleLog', '')}
                        onChange={(event) => setComponentDraftParamValue('sampleLog', event.target.value)}
                        className="mt-1 h-24 w-full resize-none rounded-xl border border-orange-100 bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-orange-300"
                        placeholder="粘贴一条包含目标文本的 logcat 日志，并选中文本部分"
                      />
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">提取内容</label>
                      <input
                        value={getComponentDraftParamValue('sampleExtractText', '')}
                        onChange={(event) => setComponentDraftParamValue('sampleExtractText', event.target.value)}
                        className="mt-1 h-10 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold outline-none focus:border-orange-300"
                        placeholder="例如：已退出支付"
                      />
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">期望文本</label>
                        <input
                          value={getComponentDraftParamValue('expectedText', '')}
                          onChange={(event) => setComponentDraftParamValue('expectedText', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold outline-none focus:border-orange-300"
                          placeholder="${variables.expectedTtsText}"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">比较方式</label>
                        <select
                          value={getComponentDraftParamValue('matchOperator', 'equals')}
                          onChange={(event) => setComponentDraftParamValue('matchOperator', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold outline-none focus:border-orange-300"
                        >
                          <option value="equals">等于</option>
                          <option value="contains">包含</option>
                        </select>
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">区分大小写</label>
                        <select
                          value={getComponentDraftParamValue('caseSensitive', 'true')}
                          onChange={(event) => setComponentDraftParamValue('caseSensitive', event.target.value)}
                          className="mt-1 h-10 w-full rounded-xl border border-orange-100 bg-white px-3 text-sm font-bold outline-none focus:border-orange-300"
                        >
                          <option value="true">是</option>
                          <option value="false">否</option>
                        </select>
                      </div>
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">提取正则</label>
                      <textarea
                        value={getComponentDraftParamValue('extractRegex', '')}
                        onChange={(event) => setComponentDraftParamValue('extractRegex', event.target.value)}
                        className="mt-1 h-24 w-full resize-none rounded-xl border border-orange-100 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-orange-300"
                        placeholder="例如：prefix (?<ttsText>.*?) suffix"
                      />
                      <div className="mt-2 text-[11px] leading-5 text-orange-700">
                        正则需要包含命名捕获组 {'(?<ttsText>...)'}，或者至少一个普通捕获组。执行时会提取真实文本，并按比较方式校验“期望文本”。
                      </div>
                    </div>
                  </div>
                  <AssertVariableExtractionCard
                    enabled={getComponentDraftParamValue('extractVariableEnabled', 'false') === 'true'}
                    variableName={getComponentDraftParamValue('extractVariableName', '')}
                    defaultVariableName={DEFAULT_TEXT_ASSERT_VARIABLE_NAME}
                    description="断言通过后会把提取正则捕获到的文本写入该变量。"
                    referenceExample={'{{variables.extractedText}}'}
                    onEnabledChange={(enabled) => setComponentDraftParamValue('extractVariableEnabled', String(enabled))}
                    onVariableNameChange={(name) => setComponentDraftParamValue('extractVariableName', name)}
                  />
                </div>
              )}

              {componentDraft.kind === 'json_assert' && (
                <div className="col-span-2 space-y-4">
                  <div className="rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4">
                    <div className="text-xs font-black text-slate-900">JSON 日志字段断言</div>
                    <div className="mt-1 text-[11px] font-bold leading-5 text-slate-500">
                      先从日志原文生成 JSON 提取正则；命中后会递归解析日志中的转义 JSON 字符串，再逐条校验字段条件。
                    </div>
                    <div className="mt-3 grid grid-cols-2 gap-3">
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">日志原文</label>
                        <textarea
                          value={getComponentDraftParamValue('sampleLog', '')}
                          onChange={(event) => setComponentDraftParamValue('sampleLog', event.target.value)}
                          className="mt-1 h-28 w-full resize-none rounded-xl border border-cyan-100 bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-cyan-300"
                          placeholder="粘贴一条完整 logcat 日志"
                        />
                      </div>
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">提取内容</label>
                        <textarea
                          value={getComponentDraftParamValue('samplePayload', '')}
                          onChange={(event) => setComponentDraftParamValue('samplePayload', event.target.value)}
                          className="mt-1 h-28 w-full resize-none rounded-xl border border-cyan-100 bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-cyan-300"
                          placeholder="粘贴日志里要提取出来的 JSON 片段"
                        />
                      </div>
                    </div>
                    <div className="mt-3 flex items-center justify-between">
                      <div className="text-[11px] leading-5 text-cyan-700">
                        会用提取内容前后的文本生成边界，中间用捕获组承接 JSON，避免手写转义出错。
                      </div>
                      <button
                        type="button"
                        onClick={generateJsonRegexFromSample}
                        className="rounded-lg bg-cyan-600 px-3 py-1.5 text-[11px] font-black text-white hover:bg-cyan-700"
                      >
                        生成正则
                      </button>
                    </div>
                    <div className="mt-3">
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">JSON 提取正则</label>
                      <textarea
                        value={getComponentDraftParamValue('lineRegex', '')}
                        onChange={(event) => setComponentDraftParamValue('lineRegex', event.target.value)}
                        className="mt-1 h-20 w-full resize-none rounded-xl border border-cyan-100 bg-white px-3 py-2 font-mono text-xs leading-5 outline-none focus:border-cyan-300"
                        placeholder="dataJson=([\\s\\S]*?), extfo="
                      />
                      <div className="mt-2 text-[11px] leading-5 text-cyan-700">
                        正则必须能匹配目标日志；优先使用第一个捕获组作为 JSON 内容，没有捕获组时会尝试从整行截取 JSON。
                      </div>
                    </div>
                    <div className="mt-3 rounded-2xl border border-cyan-100 bg-white p-3">
                      <div className="mb-2 flex items-center justify-between">
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">条件设置</label>
                        <button
                          type="button"
                          onClick={addJsonAssertComponentCondition}
                          className="inline-flex items-center gap-1 rounded-lg border border-cyan-100 px-2 py-1 text-[10px] font-black text-cyan-700 hover:bg-cyan-50"
                        >
                          <Plus className="h-3 w-3" />
                          添加条件
                        </button>
                      </div>
                      <div className="space-y-2">
                        {parseJsonAssertConditionsForUi(getComponentDraftParamValue('conditions', '[]')).length === 0 ? (
                          <div className="rounded-xl border border-dashed border-cyan-100 bg-cyan-50/60 px-3 py-4 text-center text-[11px] font-bold text-cyan-700">
                            暂无条件。点击“添加条件”后配置 path、处理方式和期望值。
                          </div>
                        ) : parseJsonAssertConditionsForUi(getComponentDraftParamValue('conditions', '[]')).map((condition, conditionIndex) => (
                          <div key={`component-json-condition-${conditionIndex}`} className="min-w-0 rounded-xl bg-slate-50 p-2">
                            <div className="flex items-center justify-between gap-2">
                              <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">条件 {conditionIndex + 1}</div>
                              <button
                                type="button"
                                onClick={() => removeJsonAssertComponentCondition(conditionIndex)}
                                className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                            <input
                              value={condition.path}
                              onChange={(event) => updateJsonAssertComponentCondition(conditionIndex, { path: event.target.value })}
                              className="mt-2 h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-cyan-300"
                              placeholder="path，如 data.prompt"
                            />
                            <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                              <select
                                value={condition.operator}
                                onChange={(event) => updateJsonAssertComponentCondition(conditionIndex, { operator: normalizeJsonAssertOperator(event.target.value) })}
                                className="h-8 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-cyan-300"
                              >
                                {jsonAssertOperatorOptions.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                              <label className="flex shrink-0 items-center justify-center gap-1 text-[10px] font-bold text-slate-500">
                                <input
                                  type="checkbox"
                                  checked={Boolean(condition.ignoreCase)}
                                  onChange={(event) => updateJsonAssertComponentCondition(conditionIndex, { ignoreCase: event.target.checked })}
                                  className="h-3 w-3"
                                />
                                忽略大小写
                              </label>
                            </div>
                            <input
                              value={condition.value}
                              onChange={(event) => updateJsonAssertComponentCondition(conditionIndex, { value: event.target.value })}
                              className="mt-2 h-8 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-cyan-300"
                              placeholder="期望值"
                              disabled={condition.operator === 'exists' || condition.operator === 'notExists'}
                            />
                          </div>
                        ))}
                      </div>
                      <div className="mt-2 text-[11px] leading-5 text-cyan-700">
                        path 支持短路径，例如 type、data.prompt；执行时会在解析后的 JSON 树里查找匹配路径。
                      </div>
                    </div>
                    <div className="mt-3 grid grid-cols-1 gap-3">
                      <div className="rounded-xl border border-emerald-100 bg-white px-3 py-2">
                        <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                          提取为变量
                          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">默认关闭</span>
                          <input
                            type="checkbox"
                            checked={getComponentDraftParamValue('extractVariableEnabled', 'false') === 'true'}
                            onChange={(event) => {
                              setComponentDraftParamValue('extractVariableEnabled', String(event.target.checked));
                              if (!event.target.checked) setComponentDraftParamValue('extractVariableName', '');
                            }}
                            className="h-4 w-4 accent-emerald-600"
                          />
                        </div>
                        {getComponentDraftParamValue('extractVariableEnabled', 'false') === 'true' && <div className="mt-3 space-y-2">
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-emerald-700">变量名</label>
                            <input
                              value={getComponentDraftParamValue('extractVariableName', '')}
                              onChange={(event) => {
                                setComponentDraftParamValue('extractVariableEnabled', 'true');
                                setComponentDraftParamValue('extractVariableName', event.target.value);
                              }}
                              required
                              className="mt-1 h-8 w-full rounded-lg border border-emerald-100 bg-emerald-50/40 px-2 font-mono text-xs font-bold outline-none focus:border-emerald-300"
                              placeholder="请输入唯一变量名"
                            />
                          </div>
                          <div className="text-[10px] font-bold leading-5 text-emerald-700">
                            断言通过后会把“JSON 提取正则”捕获并解析出的内容写入该变量，后续节点可引用 {'{{variables.extractedJson.xxx}}'}。
                          </div>
                        </div>}
                      </div>
                      <label className="flex items-center justify-between rounded-xl border border-cyan-100 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                        正则区分大小写
                        <input
                          type="checkbox"
                          checked={getComponentDraftParamValue('caseSensitive', 'true') !== 'false'}
                          onChange={(event) => setComponentDraftParamValue('caseSensitive', String(event.target.checked))}
                          className="h-4 w-4"
                        />
                      </label>
                    </div>
                  </div>
                </div>
              )}

              {componentDraft.kind === 'llm_assert' && (
                <div className="col-span-2">
                  <AssertVariableExtractionCard
                    enabled={getComponentDraftParamValue('extractVariableEnabled', 'false') === 'true'}
                    variableName={getComponentDraftParamValue('extractVariableName', '')}
                    defaultVariableName={DEFAULT_LLM_ASSERT_VARIABLE_NAME}
                    description="断言通过后会把当前日志正则捕获并解析出的内容写入该变量。"
                    referenceExample={'{{variables.extractedLlmLog.xxx}}'}
                    onEnabledChange={(enabled) => setComponentDraftParamValue('extractVariableEnabled', String(enabled))}
                    onVariableNameChange={(name) => setComponentDraftParamValue('extractVariableName', name)}
                  />
                </div>
              )}

              {componentDraft.kind !== 'audio' && componentDraft.kind !== 'image_mock' && componentDraft.kind !== 'tts_assert' && componentDraft.kind !== 'json_assert' && (
              <div className="col-span-2">
                <div className="mb-2 flex items-center justify-between">
                  <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">参数列表</label>
                  <button
                    type="button"
                    onClick={() => setComponentDraft((current) => ({
                      ...current,
                      params: [
                        ...current.params,
                        {
                          key: '',
                          label: '',
                          inputType: 'text',
                          defaultValue: '',
                          helperText: '',
                          required: false,
                        },
                      ],
                    }))}
                    className="rounded-lg border border-slate-200 px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-50"
                  >
                    + 参数
                  </button>
                </div>
                <div className="space-y-3">
                  {componentDraft.params
                    .map((param, index) => ({ param, index }))
                    .filter(({ param }) => componentDraft.kind !== 'llm_assert' || (param.key !== 'extractVariableEnabled' && param.key !== 'extractVariableName'))
                    .map(({ param, index }) => (
                    <div key={`${param.key}-${index}`} className="rounded-xl border border-slate-200 bg-slate-50 p-3">
                      <div className="grid grid-cols-[1fr_1fr_110px_36px] gap-2">
                        <input
                          value={param.key}
                          onChange={(event) => setComponentDraft((current) => ({
                            ...current,
                            params: current.params.map((item, itemIndex) => itemIndex === index ? { ...item, key: event.target.value } : item),
                          }))}
                          placeholder="key，如 packageName"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
                        />
                        <input
                          value={param.label}
                          onChange={(event) => setComponentDraft((current) => ({
                            ...current,
                            params: current.params.map((item, itemIndex) => itemIndex === index ? { ...item, label: event.target.value } : item),
                          }))}
                          placeholder="展示名称"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
                        />
                        <select
                          value={param.inputType}
                          onChange={(event) => setComponentDraft((current) => ({
                            ...current,
                            params: current.params.map((item, itemIndex) => itemIndex === index ? { ...item, inputType: event.target.value as ComponentParam['inputType'] } : item),
                          }))}
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-blue-300"
                        >
                          <option value="text">文本</option>
                          <option value="textarea">多行文本</option>
                          <option value="number">数字</option>
                          <option value="json">JSON</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => setComponentDraft((current) => ({
                            ...current,
                            params: current.params.filter((_, itemIndex) => itemIndex !== index),
                          }))}
                          className="h-9 rounded-lg text-rose-500 hover:bg-rose-50"
                          title="删除参数"
                        >
                          <Trash2 className="mx-auto h-4 w-4" />
                        </button>
                      </div>
                      <div className="mt-2 grid grid-cols-2 gap-2">
                        <input
                          value={param.defaultValue || ''}
                          onChange={(event) => setComponentDraft((current) => ({
                            ...current,
                            params: current.params.map((item, itemIndex) => itemIndex === index ? { ...item, defaultValue: event.target.value } : item),
                          }))}
                          placeholder="默认值"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-300"
                        />
                        <input
                          value={param.helperText || ''}
                          onChange={(event) => setComponentDraft((current) => ({
                            ...current,
                            params: current.params.map((item, itemIndex) => itemIndex === index ? { ...item, helperText: event.target.value } : item),
                          }))}
                          placeholder="引导文案"
                          className="h-9 rounded-lg border border-slate-200 bg-white px-2 text-xs outline-none focus:border-blue-300"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
              )}
            </div>

            {componentMessage && (
              <div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                {componentMessage}
              </div>
            )}

            <div className="mt-5 flex items-center justify-between">
              <button
                type="button"
                onClick={deleteComponent}
                className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100"
              >
                <Trash2 className="h-3.5 w-3.5" />
                删除组件
              </button>
              <button
                type="button"
                onClick={saveComponent}
                className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
              >
                <Save className="h-3.5 w-3.5" />
                保存组件
              </button>
            </div>
          </section>
        </div>
      </div>
    );
  };

  const renderSettingsCenter = () => (
    <div className="flex-1 min-h-0 overflow-auto bg-slate-50 p-4">
      <div className="mx-auto max-w-7xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black uppercase tracking-widest text-blue-600">
              <Settings2 className="h-3.5 w-3.5" />
              Settings Center
            </div>
            <h2 className="mt-3 text-xl font-black text-slate-900">设置中心</h2>
            <p className="mt-1 text-sm font-bold text-slate-500">
              这里维护通用配置。大模型助手只负责模型对话，solopi-desktop 操作能力后续通过 Skill / MCP / CLI 接入。
            </p>
          </div>
          <div className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-500">
            配置保存后立即对 CLI 与 Flow 生效
          </div>
        </div>

        <div className="mt-5 grid grid-cols-[220px_minmax(0,1fr)] items-start gap-4">
          <section className="sticky top-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm">
            <h3 className="px-2 text-[11px] font-black uppercase tracking-widest text-slate-400">配置导航</h3>
            <div className="mt-3 grid grid-cols-1 gap-1.5">
              {([
                ['team', '团队配置与入门', Settings2],
                ['model', '模型配置', Sparkles],
                ['environment', '环境配置', Terminal],
                ['tts', 'TTS 配置', Mic],
                ['quick-actions', '快捷操作', FileCode2],
                ['sites', '常用站点', Globe2],
                ['device', '设备管理', MonitorSmartphone],
              ] satisfies Array<[SettingsSection, string, React.ComponentType<{ className?: string }>]>) .map(([key, label, Icon]) => (
                <button
                  key={String(key)}
                  type="button"
                  onClick={() => setSettingsSection(key as SettingsSection)}
                  className={`rounded-2xl border px-3 py-3 text-left transition-all ${
                    settingsSection === key
                      ? 'border-blue-200 bg-blue-50 text-blue-700'
                      : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Icon className="h-4 w-4 shrink-0" />
                    <span className="truncate text-xs font-black">{label}</span>
                  </div>
                </button>
              ))}
            </div>
            {settingsSection === 'model' && (
              <>
                <div className="mt-5 flex items-center justify-between">
                  <h3 className="text-sm font-black text-slate-900">模型列表</h3>
                  <button
                    type="button"
                    onClick={addLlmProvider}
                    className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 text-slate-500 hover:bg-blue-50 hover:text-blue-600"
                    title="新增模型配置"
                    aria-label="新增模型配置"
                  >
                    <Plus className="h-4 w-4" />
                  </button>
                </div>
                <div className="mt-3 space-y-2">
                  {isNewLlmProvider && <div aria-current="true" className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm font-bold text-blue-700">新增模型配置<span className="ml-2 text-xs font-normal">待保存</span></div>}
                  {llmProviders.length === 0 ? (
                    <div className="rounded-2xl border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center">
                      <Bot className="mx-auto h-7 w-7 text-slate-300" />
                      <div className="mt-3 text-xs font-bold text-slate-500">还没有模型配置</div>
                    </div>
                  ) : llmProviders.map((provider) => (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => {
                        selectLlmProvider(provider);
                      }}
                      className={`w-full rounded-2xl border px-4 py-3 text-left transition-all ${
                        llmProviderDraft.id === provider.id
                          ? 'border-blue-200 bg-blue-50 text-blue-700'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <Sparkles className="h-4 w-4 shrink-0" />
                        <span className="truncate text-sm font-black">{provider.name || '未命名模型'}</span>
                      </div>
                      <div className="mt-1 truncate text-[11px] font-bold text-slate-400">{provider.model || '未填写模型'}</div>
                    </button>
                  ))}
                </div>
              </>
            )}
          </section>

          {settingsSection === 'team' ? (
            <TeamConfigurationPanel onNavigate={(section) => { if (section === 'cases') setActiveTab('automation-cases'); else if (section === 'agent') setActiveTab('agent'); else { setSettingsSection(section); setActiveTab('settings'); } }} />
          ) : settingsSection === 'model' ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">{isNewLlmProvider ? '新增模型配置 · 待保存' : '编辑模型配置'}</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">兼容所有提供 Chat Completions 风格接口的云端模型平台。</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => isNewLlmProvider ? cancelLlmProviderDraft() : removeLlmProvider(llmProviderDraft.id)}
                  className="rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100"
                >
                  {isNewLlmProvider ? '取消新增' : '删除'}
                </button>
                <button
                  type="button"
                  onClick={() => saveLlmProvider()}
                  className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
                >
                  保存配置
                </button>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">配置名称</label>
                <input
                  value={llmProviderDraft.name}
                  onChange={(event) => setLlmProviderDraft((current) => ({ ...current, name: event.target.value }))}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="例如 OpenAI / DashScope / DeepSeek"
                />
              </div>
              <div>
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">模型名称</label>
                <input
                  value={llmProviderDraft.model}
                  onChange={(event) => {
                    setLlmProviderDraft((current) => ({ ...current, model: event.target.value }));
                    setLlmCapabilityStatus({ responseFormat: 'unknown', thinking: 'unknown' });
                  }}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="gpt-4.1 / deepseek-chat / qwen-plus"
                />
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">Base URL</label>
                <input
                  value={llmProviderDraft.baseUrl}
                  onChange={(event) => {
                    setLlmProviderDraft((current) => ({ ...current, baseUrl: event.target.value }));
                    setLlmCapabilityStatus({ responseFormat: 'unknown', thinking: 'unknown' });
                  }}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-mono text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="https://api.example.com/v1"
                />
              </div>
              <div className="col-span-2 grid grid-cols-2 gap-3">
                <label className="text-xs text-slate-500">上下文容量（tokens）
                  <input type="number" min="1" placeholder="自动读取服务容量；缺失时借用 DeepSeek 1,048,576" value={llmProviderDraft.contextWindowTokens ?? ''}
                    onChange={e => setLlmProviderDraft(p => ({ ...p, contextWindowTokens: e.target.value ? Number(e.target.value) : undefined }))}
                    className="mt-1 h-11 w-full rounded-2xl border border-slate-200 px-4" />
                </label>
                <label className="text-xs text-slate-500">Agent 单次输出上限（tokens）
                  <input type="number" min="1" placeholder="对话默认 16384；摘要使用 Harness 默认预算" value={llmProviderDraft.maxOutputTokens ?? ''}
                    onChange={e => setLlmProviderDraft(p => ({ ...p, maxOutputTokens: e.target.value ? Number(e.target.value) : undefined }))}
                    className="mt-1 h-11 w-full rounded-2xl border border-slate-200 px-4" />
                </label>
                <p className="col-span-2 text-xs text-slate-400">请按服务商实际限额填写，用于提前压缩和预留输出空间；默认预算不代表已探测到模型容量。</p>
              </div>
              <div className="col-span-2">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">API Key</label>
                <input
                  type="password"
                  value={llmProviderDraft.apiKey}
                  onChange={(event) => setLlmProviderDraft((current) => ({ ...current, apiKey: event.target.value }))}
                  className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-mono text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="sk-..."
                />
              </div>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <div className="mb-4 grid gap-3 md:grid-cols-2">
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                  <input
                    type="checkbox"
                    checked={llmCapabilityStatus.responseFormat === 'supported' && llmProviderDraft.responseFormat === 'json_object'}
                    disabled={llmCapabilityStatus.responseFormat !== 'supported'}
                    onChange={(event) => setLlmProviderDraft((current) => ({
                      ...current,
                      responseFormat: event.target.checked ? 'json_object' : 'default',
                    }))}
                    className="mt-0.5 h-4 w-4 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <span>
                    <span className="block text-xs font-black text-slate-900">启用 JSON 输出模式 <em className="ml-1 not-italic text-[10px] text-blue-600">{llmCapabilityStatus.responseFormat === 'supported' ? '已探测支持' : llmCapabilityStatus.responseFormat === 'unsupported' ? '不支持' : '待测试'}</em></span>
                    <span className="mt-1 block text-[11px] font-bold leading-5 text-slate-400">测试连接后按实际响应开放。适合 LLM 断言节点。</span>
                  </span>
                </label>
                <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-slate-200 bg-white px-3 py-3">
                  <input
                    type="checkbox"
                    checked={llmCapabilityStatus.thinking === 'supported' && llmProviderDraft.thinking === 'disabled'}
                    disabled={llmCapabilityStatus.thinking !== 'supported'}
                    onChange={(event) => setLlmProviderDraft((current) => ({
                      ...current,
                      thinking: event.target.checked ? 'disabled' : 'default',
                    }))}
                    className="mt-0.5 h-4 w-4 accent-blue-600 disabled:cursor-not-allowed disabled:opacity-40"
                  />
                  <span>
                    <span className="block text-xs font-black text-slate-900">关闭 Thinking <em className="ml-1 not-italic text-[10px] text-blue-600">{llmCapabilityStatus.thinking === 'supported' ? '已探测支持' : llmCapabilityStatus.thinking === 'unsupported' ? '不支持' : '待测试'}</em></span>
                    <span className="mt-1 block text-[11px] font-bold leading-5 text-slate-400">测试连接后按实际响应开放，减少推理内容占用输出预算。</span>
                  </span>
                </label>
              </div>
              <div className="flex items-center justify-between gap-4">
                <div>
                  <div className="text-xs font-black text-slate-900">连接测试</div>
                  <div className="mt-1 text-[11px] font-bold leading-5 text-slate-400">点击后会向模型发送一条极短测试消息。</div>
                </div>
                <button
                  type="button"
                  onClick={() => void testLlmProvider()}
                  disabled={isTestingProvider}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isTestingProvider ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
                  测试连接
                </button>
              </div>
              {providerTestMessage && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-5 text-slate-600">
                  {providerTestMessage}
                </div>
              )}
            </div>
          </section>
          ) : settingsSection === 'environment' ? (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">环境配置</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">配置本机执行环境。保存后所有 adb 命令都会使用这里的 adb。</p>
              </div>
              <button
                type="button"
                onClick={() => void saveEnvironmentConfig()}
                disabled={isSavingEnvironment}
                className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isSavingEnvironment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                保存环境
              </button>
            </div>
            <div className="mt-5">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">ADB 路径</label>
              <input
                value={environmentDraft.adbPath}
                onChange={(event) => setEnvironmentDraft({ adbPath: event.target.value })}
                className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-mono text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"
                placeholder="留空自动查找，例如 /path/to/platform-tools/adb"
              />
              <div className="mt-2 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <div className="text-[10px] font-black uppercase tracking-widest text-slate-400">当前生效 ADB</div>
                <div className="mt-1 break-all font-mono text-xs font-bold text-slate-700">{effectiveAdbPath || '自动查找 adb'}</div>
              </div>
              {environmentMessage && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-5 text-slate-600">
                  {environmentMessage}
                </div>
              )}
            </div>
          </section>
          ) : settingsSection === 'tts' ? (
          <section className="space-y-5">
            <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-black text-slate-900">接口请求配置</h3>
	                  <p className="mt-1 text-xs font-bold text-slate-400">配置 TTS 接口请求和音频 URL 解析。Flow 里只传入 text。</p>
                </div>
                <button
                  type="button"
                  onClick={() => void saveTtsProviderConfig()}
                  disabled={isSavingEnvironment}
                  className="inline-flex items-center gap-2 rounded-xl bg-slate-900 px-4 py-2 text-xs font-black text-white hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isSavingEnvironment ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />}
                  保存
                </button>
              </div>

              <div className="mt-5 space-y-4">
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black text-slate-900">请求配置</div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">METHOD</label>
                      <select
                        value={ttsProviderDraft.method}
                        onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, method: event.target.value as TtsProviderConfig['method'] }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-300"
                      >
                        <option value="POST">POST</option>
                        <option value="PUT">PUT</option>
                        <option value="GET">GET</option>
                      </select>
                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">超时时间(ms)</label>
                      <input
                        type="number"
                        value={String(ttsProviderDraft.timeoutMs)}
                        onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, timeoutMs: Number(event.target.value || 30000) }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-sm font-bold outline-none focus:border-blue-300"
                      />
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">TTS 接口 URL</label>
	                      <div className="mt-1">
	                        <input
	                          value={ttsProviderDraft.url}
	                          onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, url: event.target.value }))}
	                          className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-sm font-bold outline-none focus:border-blue-300"
	                          placeholder="例如：https://tts.example.com/synthesize?synText={{textUrlEncoded}}&voice=female"
	                        />
	                      </div>
                      {ttsProviderDraft.url && !/{{[^}]+?}}/.test(ttsProviderDraft.url) && (
                        <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-700">
                          当前 URL 没有使用任何 {'{{参数名}}'}，运行时参数不会替换到请求里。
                        </div>
                      )}
                      {ttsProviderDraft.url && !ttsProviderUsesTextParam(ttsProviderDraft) && (
                        <div className="mt-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold leading-5 text-rose-700">
                          当前 URL/Header/Body 没有使用 {'{{text}} / {{textUrlEncoded}} / {{textJson}}'}，无法动态输入文本去合成。
                        </div>
                      )}
                    </div>

                    <div className="col-span-2">
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">HEADERS 模板</label>
                      <textarea
                        value={ttsProviderDraft.headersText}
                        onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, headersText: event.target.value }))}
                        className="mt-1 h-24 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs font-bold leading-5 outline-none focus:border-blue-300"
                      />
                    </div>
                    {ttsProviderDraft.method !== 'GET' && (
                      <div className="col-span-2">
                        <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">BODY 模板</label>
                        <textarea
                          value={ttsProviderDraft.bodyTemplate}
                          onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, bodyTemplate: event.target.value }))}
                          className="mt-1 h-32 w-full resize-none rounded-2xl border border-slate-200 bg-white px-4 py-3 font-mono text-xs font-bold leading-5 outline-none focus:border-blue-300"
                        />
                      </div>
                    )}

	                    <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
	                      <div className="text-xs font-black text-slate-900">请求参数</div>
	                      <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-5 text-blue-700">
	                        Flow 只会传入一个动态参数 <span className="font-mono text-slate-800">{'{{text}}'}</span>。音色、采样、噪声权重、鉴权等其它参数请直接写死在 URL、Header 或 Body 模板里。
	                      </div>
	                      <div className="mt-3 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2 px-1 text-[10px] font-black uppercase tracking-widest text-slate-400">
	                        <span>参数名</span>
	                        <span>来源</span>
	                      </div>
	                      <div className="mt-2 grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)] gap-2">
	                        <div className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 pt-2 font-mono text-xs font-black text-slate-700">text</div>
	                        <div className="h-9 rounded-xl border border-slate-200 bg-slate-50 px-3 pt-2 text-xs font-bold text-slate-500">Flow TTS 节点的 Text</div>
	                      </div>
	                    </div>
                  </div>
                </div>

                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="text-xs font-black text-slate-900">响应解析</div>
                  <div className="mt-4 grid grid-cols-2 gap-4">
	                    <div>
	                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">响应音频类型</label>
	                      <div className="mt-1 flex h-11 items-center rounded-2xl border border-slate-200 bg-white px-4 text-sm font-black text-slate-800">
	                        JSON 字段返回音频 URL
	                      </div>
	                    </div>
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">输出扩展名</label>
                      <select
                        value={ttsProviderDraft.outputExtension}
                        onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, outputExtension: event.target.value }))}
                        className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 text-sm font-bold outline-none focus:border-blue-300"
                      >
                        <option value="pcm">pcm</option>
                        <option value="wav">wav</option>
                        <option value="mp3">mp3</option>
                        <option value="ogg">ogg</option>
                        <option value="m4a">m4a</option>
                      </select>
                    </div>
	                    <div className="col-span-2 rounded-2xl border border-slate-200 bg-white p-4">
	                      <div className="text-xs font-black text-slate-900">音频 URL 字段路径</div>
	                      <div className="mt-1 text-[11px] font-bold leading-5 text-slate-400">
	                        填写 TTS 响应 JSON 里音频 URL 所在路径。执行后 Flow 固定输出 <span className="font-mono text-slate-600">${'{variables.<节点名>.audioPath}'}</span> 和 <span className="font-mono text-slate-600">${'{variables.<节点名>.audioUrl}'}</span>。
	                      </div>
	                      <input
	                        value={ttsProviderDraft.urlField || normalizeTtsResponseMappings(ttsProviderDraft.responseMappings, 'data.url')[0]?.responsePath || 'data.url'}
	                        onChange={(event) => {
	                          const responsePath = event.target.value;
	                          setTtsProviderDraft((current) => ({
	                            ...current,
	                            enabled: true,
	                            responseType: 'json-url',
	                            urlField: responsePath,
	                            responseMappings: [{ variableName: '', responsePath }],
	                          }));
	                        }}
	                        className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
	                        placeholder="data.url"
	                      />
	                      <div className="mt-3 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold leading-5 text-emerald-700">
	                        示例：节点名为 <span className="font-mono text-slate-800">生成支付语音</span> 时，音频 Mock 本地路径填写 <span className="font-mono text-slate-800">${'{variables.生成支付语音.audioPath}'}</span>，报告或外部工具可引用 <span className="font-mono text-slate-800">${'{variables.生成支付语音.audioUrl}'}</span>。
	                      </div>
	                    </div>
                    <div className="col-span-2 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3">
                      <div className="text-xs font-black text-blue-900">TTS 音频文件描述</div>
                      <div className="mt-1 text-xs font-bold leading-5 text-blue-700">
                        {ttsProviderDraft.outputExtension === 'pcm'
                          ? 'PCM 没有文件头，需要补充采样率、采样格式和声道，后续音频 Mock 或转码会按这里处理。'
                          : '压缩音频通常自带格式信息，这里主要用于声明文件扩展名，方便后续节点识别和分享。'}
                      </div>
                    </div>
                    {ttsProviderDraft.outputExtension === 'pcm' && (
                      <>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">sampleRate</label>
                          <input
                            type="number"
                            value={String(ttsProviderDraft.sampleRate)}
                            onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, sampleRate: Number(event.target.value || 16000) }))}
                            className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">sampleFormat</label>
                          <select
                            value={resolveAvSampleFormat(ttsProviderDraft.sampleFormat).key}
                            onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, sampleFormat: event.target.value }))}
                            className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300"
                          >
                            {avSampleFormats.map((format) => (
                              <option key={format.key} value={format.key}>{format.label}</option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">channelCnt</label>
                          <input
                            type="number"
                            min={1}
                            max={2}
                            value={String(ttsProviderDraft.channelCnt)}
                            onChange={(event) => setTtsProviderDraft((current) => ({ ...current, enabled: true, channelCnt: Number(event.target.value || 1) }))}
                            className="mt-1 h-10 w-full rounded-xl border border-slate-200 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                          />
                        </div>
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="mt-5 flex items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div>
                  <div className="text-xs font-black text-slate-900">接口测试</div>
                  <div className="mt-1 text-[11px] font-bold text-slate-400">点击后填写参数值，并按当前配置发起请求。</div>
                </div>
                <button
                  type="button"
                  onClick={openTtsTestDialog}
                  disabled={isTestingTts}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {isTestingTts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                  测试
                </button>
              </div>
              {ttsMessage && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold leading-5 text-slate-600">
                  {ttsMessage}
                </div>
              )}
            </div>

          </section>
          ) : settingsSection === 'quick-actions' ? (
            <QuickActionsSettings />
          ) : settingsSection === 'sites' ? (
            <CommonSitesSettings />
          ) : (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">设备管理</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">固定常用 SN 的设备角色。顶部设备栏每 5 秒自动检测，命中后会自动分配到对应栏位。</p>
              </div>
              <button
                type="button"
                onClick={() => void refreshSettingsDevices()}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                刷新设备
              </button>
            </div>

            <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">设备 SN</label>
              <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2">
                <div className="relative">
                  <input
                    value={deviceBindingDraft}
                    onChange={(event) => setDeviceBindingDraft(event.target.value)}
                    list="settings-adb-device-options"
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 pr-10 font-mono text-sm font-bold outline-none focus:border-blue-300"
                    placeholder="输入 SN，或从 adb devices 中搜索选择"
                  />
                  <Search className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <datalist id="settings-adb-device-options">
                    {settingsDevices.map((device) => (
                      <option key={device.serial} value={device.serial}>
                        {getSettingsDeviceLabel(device.serial)}
                      </option>
                    ))}
                  </datalist>
                </div>
                <button
                  type="button"
                  onClick={() => bindDeviceSerial('phone')}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-blue-600 px-4 text-xs font-black text-white hover:bg-blue-700"
                >
                  <Smartphone className="h-3.5 w-3.5" />
                  固定为手机
                </button>
                <button
                  type="button"
                  onClick={() => bindDeviceSerial('glasses')}
                  className="inline-flex h-11 items-center gap-2 rounded-2xl bg-emerald-600 px-4 text-xs font-black text-white hover:bg-emerald-700"
                >
                  <MonitorSmartphone className="h-3.5 w-3.5" />
                  固定为眼镜
                </button>
              </div>
              {deviceSettingsMessage && (
                <div className="mt-3 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold leading-5 text-slate-600">
                  {deviceSettingsMessage}
                </div>
              )}
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">手机默认包名</label>
                <input
                  value={deviceBindings.phoneDefaultPackage}
                  onChange={(event) => setDeviceBindings((current) => ({
                    ...current,
                    phoneDefaultPackage: event.target.value.trim(),
                  }))}
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-sm font-bold outline-none focus:border-blue-300"
                  placeholder={defaultPhonePackageName}
                />
                <div className="mt-2 text-[11px] font-bold leading-5 text-slate-400">启动或手机 SN 更新时默认选中该包名。</div>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="text-[10px] font-black uppercase tracking-widest text-slate-400">眼镜默认包名</label>
                <input
                  value={deviceBindings.glassesDefaultPackage}
                  onChange={(event) => setDeviceBindings((current) => ({
                    ...current,
                    glassesDefaultPackage: event.target.value.trim(),
                  }))}
                  className="mt-2 h-11 w-full rounded-2xl border border-slate-200 bg-white px-4 font-mono text-sm font-bold outline-none focus:border-blue-300"
                  placeholder={defaultGlassesPackageName}
                />
                <div className="mt-2 text-[11px] font-bold leading-5 text-slate-400">启动或眼镜 SN 更新时默认选中该包名。</div>
              </div>
            </div>

            <div className="mt-5 grid grid-cols-2 gap-4">
              {([
                ['phone', '手机设备', Smartphone, deviceBindings.phoneSerials],
                ['glasses', '眼镜设备', MonitorSmartphone, deviceBindings.glassesSerials],
              ] satisfies Array<['phone' | 'glasses', string, React.ComponentType<{ className?: string }>, string[]]>) .map(([kind, label, Icon, serials]) => (
                <div key={String(kind)} className="rounded-2xl border border-slate-200 bg-white p-4">
                  <div className="flex items-center gap-2 text-sm font-black text-slate-900">
                    <Icon className="h-4 w-4 text-blue-600" />
                    {label}
                  </div>
                  <div className="mt-3 space-y-2">
                    {(serials as string[]).length === 0 ? (
                      <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-6 text-center text-xs font-bold text-slate-400">
                        暂未固定 SN
                      </div>
                    ) : (serials as string[]).map((serial) => (
                      <div key={serial} className="flex items-center justify-between gap-2 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                        <div className="min-w-0">
                          <div className="truncate font-mono text-xs font-black text-slate-800">{serial}</div>
                          <div className="mt-0.5 truncate text-[10px] font-bold text-slate-400">{getSettingsDeviceLabel(serial)}</div>
                        </div>
                        <button
                          type="button"
                          onClick={() => removeDeviceBinding(serial)}
                          className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
                          title="取消固定"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </section>
          )}
        </div>
      </div>
    </div>
  );

  const renderAssistantPanel = () => {
    if (!isAssistantOpen) {
      return null;
    }

    if (isAssistantCollapsed) {
      return (
        <div className="fixed left-56 top-6 z-[90] flex w-80 items-center justify-between rounded-2xl border border-slate-200 bg-white/95 px-4 py-3 shadow-2xl backdrop-blur">
          <button
            type="button"
            onClick={() => setIsAssistantCollapsed(false)}
            className="flex min-w-0 items-center gap-2 text-left"
          >
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-white"><Bot className="h-4 w-4" /></span>
            <span className="truncate text-sm font-black text-slate-900">AI 助手</span>
          </button>
          <button
            type="button"
            onClick={() => setIsAssistantOpen(false)}
            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="关闭"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      );
    }

    return (
      <div className="fixed left-56 top-6 z-[90] flex h-[min(680px,calc(100vh-48px))] w-[440px] flex-col overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
        <div className="border-b border-slate-100 bg-slate-950 px-5 py-4 text-white">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20"><Bot className="h-5 w-5" /></div>
              <div className="min-w-0">
                <div className="truncate text-sm font-black">AI 助手</div>
                <div className="mt-0.5 truncate text-[11px] font-bold text-slate-400">
                  {assistantCaseAuthoringEnabled ? '用例编写模式' : selectedLlmProvider?.name || '未配置模型'}
                </div>
              </div>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => {
                  setAssistantCaseAuthoringEnabled((enabled) => !enabled);
                  setPendingAssistantDraft(null);
                  setAssistantError('');
                }}
                className={`rounded-xl p-2 ${
                  assistantCaseAuthoringEnabled
                    ? 'bg-emerald-500 text-white hover:bg-emerald-400'
                    : 'text-slate-300 hover:bg-white/10 hover:text-white'
                }`}
                title={assistantCaseAuthoringEnabled ? '切回纯 LLM 聊天' : '切换到用例编写模式'}
              >
                <ListChecks className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('settings')}
                className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white"
                title="模型设置"
              >
                <Settings2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsAssistantCollapsed(true)}
                className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white"
                title="最小化"
              >
                <Minimize2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setIsAssistantOpen(false)}
                className="rounded-xl p-2 text-slate-300 hover:bg-white/10 hover:text-white"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>

        <div className="border-b border-slate-200 bg-white px-4 py-3">
          <button
            type="button"
            onClick={() => {
              setAssistantCaseAuthoringEnabled((enabled) => !enabled);
              setPendingAssistantDraft(null);
              setAssistantError('');
            }}
            className={`flex w-full items-center justify-between rounded-2xl border px-3 py-2 text-left transition-all ${
              assistantCaseAuthoringEnabled
                ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                : 'border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100'
            }`}
          >
            <span className="flex min-w-0 items-center gap-2">
              {assistantCaseAuthoringEnabled ? <ListChecks className="h-4 w-4 shrink-0" /> : <MessageSquare className="h-4 w-4 shrink-0" />}
              <span className="truncate text-xs font-black">
                {assistantCaseAuthoringEnabled ? glassBoxSkills[0].name : '纯 LLM 聊天'}
              </span>
            </span>
            <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-black">
              {assistantCaseAuthoringEnabled ? 'ON' : 'OFF'}
            </span>
          </button>
        </div>

        <div className="flex-1 overflow-auto bg-slate-50 px-4 py-4">
          {assistantMessages.length === 0 ? (
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white px-5 py-8 text-center">
              {assistantCaseAuthoringEnabled ? (
                <ListChecks className="mx-auto h-8 w-8 text-emerald-500" />
              ) : (
                <MessageSquare className="mx-auto h-8 w-8 text-slate-300" />
              )}
              <div className="mt-3 text-sm font-black text-slate-900">
                {assistantCaseAuthoringEnabled ? '用例编写模式已开启' : '先从一个问题开始'}
              </div>
              <p className="mt-2 text-xs font-bold leading-5 text-slate-400">
                {assistantCaseAuthoringEnabled
                  ? `当前启用 ${glassBoxSkills[0].name}，生成结果会先进入「${selectedFolder?.name || '当前文件夹'}」待确认草稿。`
                  : '当前是纯 LLM 聊天，不会读取 solopi-desktop 组件库，也不会生成或修改用例。'}
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {assistantMessages.map((message) => (
                <div
                  key={message.id}
                  className={`flex ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
                >
                  <div className={`max-w-[86%] rounded-2xl px-4 py-3 text-sm font-medium leading-6 ${
                    message.role === 'user'
                      ? 'bg-blue-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-700 shadow-sm'
                  }`}
                  >
                    {message.content}
                  </div>
                </div>
              ))}
              {isAssistantSending && (
                <div className="flex justify-start">
                  <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold text-slate-500 shadow-sm">
                    <Loader2 className="h-4 w-4 animate-spin text-blue-600" />
                    正在思考...
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {assistantError && (
          <div className="border-t border-rose-100 bg-rose-50 px-4 py-2 text-xs font-bold leading-5 text-rose-600">
            {assistantError}
          </div>
        )}

        {pendingAssistantDraft && (
          <div className="border-t border-emerald-100 bg-emerald-50 px-4 py-3">
            <div className="rounded-2xl border border-emerald-200 bg-white p-3 shadow-sm">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-xs font-black text-emerald-700">待应用用例草稿</div>
                  <div className="mt-1 text-[11px] font-bold leading-5 text-slate-500">
                    {pendingAssistantDraft.draftCases.length} 个用例，将写入「{selectedFolder?.name || '当前文件夹'}」。
                  </div>
                </div>
                <div className="rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-black text-emerald-600">
                  draft
                </div>
              </div>
              <div className="mt-3 space-y-2">
                {pendingAssistantDraft.draftCases.map((testCase) => (
                  <div key={testCase.id} className="rounded-xl bg-slate-50 px-3 py-2">
                    <div className="truncate text-xs font-black text-slate-800">{testCase.name}</div>
                    <div className="mt-1 text-[10px] font-bold text-slate-400">{testCase.steps.length} 步</div>
                  </div>
                ))}
              </div>
              {(pendingAssistantDraft.questions || []).length > 0 && (
                <div className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-700">
                  {pendingAssistantDraft.questions?.join(' / ')}
                </div>
              )}
              <div className="mt-3 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setPendingAssistantDraft(null)}
                  className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-black text-slate-500 hover:bg-slate-50"
                >
                  丢弃
                </button>
                <button
                  type="button"
                  onClick={applyPendingAssistantDraft}
                  className="rounded-xl bg-emerald-600 px-3 py-2 text-xs font-black text-white hover:bg-emerald-700"
                >
                  应用到草稿
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="border-t border-slate-200 bg-white p-4">
          <div className="flex items-end gap-2">
            <textarea
              value={assistantInput}
              onChange={(event) => setAssistantInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();
                  void sendAssistantMessage();
                }
              }}
              className="min-h-[44px] flex-1 resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-bold leading-5 text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
              placeholder={assistantCaseAuthoringEnabled ? '输入 PRD、文档链接、测试场景或修改要求' : '输入问题，Shift + Enter 换行'}
            />
            <button
              type="button"
              onClick={() => void sendAssistantMessage()}
              disabled={isAssistantSending || !assistantInput.trim()}
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-blue-600 text-white shadow-lg shadow-blue-100 hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              title="发送"
            >
              <Send className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const getLlmProviderForStep = (step?: AutomationStep) => (
    llmProviders.find((provider) => provider.id === step?.config.providerId)
    || llmProviders.find((provider) => provider.id === selectedLlmProviderId)
    || llmProviders[0]
  );

  const configuredMobileUiSelector = selectedStep
    && (selectedStepComponentKind === 'mobile_ui_action' || selectedStepComponentKind === 'mobile_ui_assert')
    ? getMobileUiSelector(selectedStep)
    : null;
  const hasConfiguredMobileUiTarget = Boolean(
    configuredMobileUiSelector
    && Object.entries(configuredMobileUiSelector).some(([key, value]) => key !== 'className' && String(value || '').trim())
  );
  const selectedMobileUiInspectorElement = selectedStep
    ? findMobileUiElementForStep(selectedStep, mobileUiInspector.elements)
    : undefined;
  const nestedMobileUiTargets = getNestedMobileUiTargets(selectedMobileUiInspectorElement, mobileUiInspector.elements);
  const mobileUiClickPreview = selectedStepComponentKind === 'mobile_ui_action'
    && ['tap', 'input'].includes(String(selectedStep ? getStepConfigValue(selectedStep, 'action', 'tap') : ''))
    ? mobileUiInspector.clickPreview
    : undefined;

  const soloPiPendingSteps = useMemo(() => (selectedCase?.steps || []).filter(step => step.inputs?.action === 'solopi_replay' || step.config?.solopiNative ? nativeCaseIssues(step.inputs?.nativeCase ?? step.config?.nativeCase, step.inputs).length > 0 : step.config?.importReview && (step.config.importReview as { required?: boolean }).required === true), [selectedCase?.steps]);

  const deviceControls = (
    <>
      <DeviceHeader
        refreshKey={deviceRefreshKey}
        onPhoneSerialChange={setSelectedPhoneSerial}
        onGlassesSerialChange={setSelectedGlassesSerial}
        onPhonePackageChange={setSelectedPhonePackage}
        onGlassesPackageChange={setSelectedGlassesPackage}
        onPhoneRuntimeChange={setSelectedPhoneRuntime}
        onGlassesRuntimeChange={setSelectedGlassesRuntime}
        deviceBindings={deviceBindings}
      />
      <QuickActions
        phoneSerial={selectedPhoneSerial}
        glassesSerial={selectedGlassesSerial}
        phonePackage={selectedPhonePackage}
        glassesPackage={selectedGlassesPackage}
        onManage={() => {
          setSettingsSection('quick-actions');
          setActiveTab('settings');
        }}
      />
    </>
  );

  return (
    <div className="flex h-screen bg-white text-slate-900 overflow-hidden">
      {soloPiDialog && <SoloPiImport api={electronApi} mode={soloPiDialog.mode} phoneSerial={selectedPhoneSerial} phonePackage={selectedPhonePackage} phoneRuntime={selectedPhoneRuntime} glassesSerial={selectedGlassesSerial} onRefreshDevices={() => setDeviceRefreshKey(value => value + 1)} onImport={importSoloPiDraft} onClose={() => setSoloPiDialog(null)} />}
      <TeamOnboarding onNavigate={(section) => { if (section === 'cases') setActiveTab('automation-cases'); else if (section === 'agent') setActiveTab('agent'); else { setSettingsSection(section); setActiveTab('settings'); } }} />
      {caseTreeDragItem && caseTreeDragPosition && (
        <div
          className="pointer-events-none fixed z-[120] flex max-w-xs items-center gap-2 rounded-xl border border-blue-200 bg-white/95 px-3 py-2 text-xs font-black text-slate-700 shadow-2xl"
          style={{
            left: caseTreeDragPosition.x + 12,
            top: caseTreeDragPosition.y + 12,
          }}
        >
          {caseTreeDragItem.type === 'folder' ? (
            <Folder className="h-3.5 w-3.5 text-blue-600" />
          ) : (
            <ListChecks className="h-3.5 w-3.5 text-blue-600" />
          )}
          <span className="truncate">{caseTreeDragLabel}</span>
        </div>
      )}
      {commandVariableGuide && (
        <div
          className="fixed inset-0 z-[95] flex items-center justify-center bg-slate-950/40 px-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-labelledby="command-variable-guide-title"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) setCommandVariableGuide(null);
          }}
        >
          <div className="max-h-[82vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-100 bg-white/95 px-6 py-5 backdrop-blur">
              <div>
                <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-[0.2em] text-blue-600">
                  <CircleHelp className="h-3.5 w-3.5" />
                  Command Variables
                </div>
                <h3 id="command-variable-guide-title" className="mt-1 text-lg font-black text-slate-950">
                  命令变量使用教程
                </h3>
                <p className="mt-1 text-xs font-bold leading-5 text-slate-500">
                  运行时会把形如 {'{{变量名}}'} 的占位符替换为当前任务中的真实值。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setCommandVariableGuide(null)}
                className="rounded-xl p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
                aria-label="关闭变量使用教程"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="space-y-5 px-6 py-5">
              <section className="overflow-hidden rounded-2xl border border-slate-200">
                <div className="grid grid-cols-[150px_minmax(0,1fr)_minmax(120px,0.7fr)] gap-3 bg-slate-50 px-4 py-2 text-[10px] font-black uppercase tracking-wide text-slate-500">
                  <span>变量</span>
                  <span>用途</span>
                  <span>当前值</span>
                </div>
                {[
                  ['{{phoneSerial}}', '顶部当前选择的手机 SN', selectedPhoneSerial || '未选择'],
                  ['{{glassesSerial}}', '顶部当前选择的眼镜 SN', selectedGlassesSerial || '未选择'],
                  ['{{phonePackage}}', '顶部当前选择的手机包名', selectedPhonePackage || '未选择'],
                  ['{{glassesPackage}}', '顶部当前选择的眼镜包名', selectedGlassesPackage || '未选择'],
                  ...(commandVariableGuide === 'adb'
                    ? [['{{serial}}', '当前 ADB 组件执行设备的 SN', '随组件设备变化']]
                    : []),
                ].map(([variable, description, currentValue]) => (
                  <div key={variable} className="grid grid-cols-[150px_minmax(0,1fr)_minmax(120px,0.7fr)] gap-3 border-t border-slate-100 px-4 py-3 text-xs">
                    <code className="w-fit rounded-lg bg-blue-50 px-2 py-1 font-bold text-blue-700">{variable}</code>
                    <span className="font-bold leading-5 text-slate-700">{description}</span>
                    <span className="break-all font-mono text-[11px] leading-5 text-slate-500">{currentValue}</span>
                  </div>
                ))}
              </section>

              {commandVariableGuide === 'pc_command' && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs font-bold leading-5 text-amber-800">
                  PC 命令不绑定单一设备，因此不要使用 {'{{serial}}'}；指定手机或眼镜时请分别使用 {'{{phoneSerial}}'} 或 {'{{glassesSerial}}'}。
                </div>
              )}

              <section className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <div className="text-xs font-black text-slate-900">
                      {commandVariableGuide === 'pc_command' ? 'PC 命令示例' : 'ADB 命令示例'}
                    </div>
                    <div className="mt-1 text-[11px] font-bold text-slate-500">变量可以出现在命令的任意参数位置。</div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(commandVariableGuide === 'pc_command'
                      ? 'qwc asr send "确认支付" --json --serial {{phoneSerial}}'
                      : 'adb -s {{serial}} shell am force-stop {{phonePackage}}')}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-slate-600 hover:border-blue-200 hover:text-blue-600"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    复制示例
                  </button>
                </div>
                <pre className="mt-3 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 font-mono text-xs leading-6 text-cyan-200"><code>{commandVariableGuide === 'pc_command'
                  ? 'qwc asr send "确认支付" --json --serial {{phoneSerial}}'
                  : 'adb -s {{serial}} shell am force-stop {{phonePackage}}'}</code></pre>
              </section>

              <section className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-blue-100 bg-blue-50/60 p-4">
                  <div className="text-xs font-black text-blue-950">自定义参数</div>
                  <p className="mt-2 text-[11px] font-bold leading-5 text-blue-800">
                    在下方“命令参数”中新建 key，例如 <code className="rounded bg-white px-1.5 py-0.5">text</code>，命令中使用 {'{{text}}'}，每个流程节点都可以填写自己的参数值。
                  </p>
                </div>
                <div className="rounded-2xl border border-rose-100 bg-rose-50/60 p-4">
                  <div className="text-xs font-black text-rose-950">填写注意</div>
                  <p className="mt-2 text-[11px] font-bold leading-5 text-rose-800">
                    变量名区分大小写；变量没有值或拼写错误时会替换为空字符串。路径或文本参数建议放在双引号中。
                  </p>
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
      {ttsTestDialog && (
        <div className="fixed inset-0 z-[86] flex items-center justify-center bg-slate-900/35 px-4">
          <div className="w-full max-w-xl rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.22em] text-blue-600">TTS Test</div>
	                <h3 className="mt-1 text-lg font-black text-slate-900">填写测试文本</h3>
	                <p className="mt-1 text-xs font-bold leading-5 text-slate-400">测试时只替换 {'{{text}}'}，其它参数使用设置中心模板里的固定值。</p>
              </div>
              <button
                type="button"
                onClick={() => setTtsTestDialog(null)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

	            <div className="mt-4">
	              <label className="text-[10px] font-black uppercase tracking-widest text-slate-500">text</label>
	              <input
	                value={ttsTestDialog.values.text ?? ''}
	                onChange={(event) => setTtsTestDialog((current) => current ? {
	                  ...current,
	                  values: {
	                    text: event.target.value,
	                  },
	                } : current)}
	                className="mt-1 h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 font-mono text-sm font-bold outline-none focus:border-blue-300 focus:bg-white"
	                placeholder={requiredTtsTextParam.defaultValue}
	              />
	            </div>

            {ttsTestDialog.message && (
              <div className="mt-4 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs font-bold leading-5 text-slate-600">
                {ttsTestDialog.message}
              </div>
            )}

            {ttsTestDialog.audioPath && (
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3">
                <div className="flex min-w-0 items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="text-xs font-black text-emerald-900">试听合成音频</div>
                    <div
                      className="mt-1 line-clamp-2 break-all font-mono text-[10px] font-bold leading-4 text-emerald-700"
                      title={ttsTestDialog.audioPath}
                    >
                      {ttsTestDialog.audioPath}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(ttsTestDialog.audioPath || '')}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg border border-emerald-200 bg-white px-2.5 py-1.5 text-[11px] font-black text-emerald-700 hover:bg-emerald-100"
                  >
                    <Copy className="h-3 w-3" />
                    复制路径
                  </button>
                </div>
                {ttsTestDialog.audioPreviewUrl ? (
                  <audio
                    key={ttsTestDialog.audioPreviewUrl}
                    controls
                    preload="metadata"
                    src={ttsTestDialog.audioPreviewUrl}
                    className="mt-3 h-10 w-full"
                  >
                    当前环境不支持音频播放。
                  </audio>
                ) : (
                  <div className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-700">
                    音频已生成，但暂时无法预览：{ttsTestDialog.audioPreviewError || '未知错误'}
                  </div>
                )}
              </div>
            )}

            {ttsTestDialog.response && (
              <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200 bg-slate-950 text-slate-100">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <div className="text-xs font-black">HTTP 原始响应</div>
                  <button
                    type="button"
                    onClick={() => void navigator.clipboard?.writeText(JSON.stringify(ttsTestDialog.response, null, 2))}
                    className="rounded-lg border border-white/15 px-2.5 py-1 text-[11px] font-black text-slate-200 hover:bg-white/10"
                  >
                    复制全部
                  </button>
                </div>
                <div className="max-h-80 space-y-3 overflow-y-auto p-4 text-[11px] leading-5">
                  <div>
                    <div className="mb-1 font-black text-cyan-300">HTTP 状态</div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-slate-100">
                      {`${ttsTestDialog.response.status ?? '-'} ${ttsTestDialog.response.statusText || ''}`.trim()}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-black text-cyan-300">响应头（敏感值已脱敏）</div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-slate-300">
                      {formatTtsResponseEvidence(ttsTestDialog.response.headers)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-black text-cyan-300">原始 Body</div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-slate-300">
                      {formatTtsResponseEvidence(ttsTestDialog.response.rawBody)}
                    </pre>
                  </div>
                  <div>
                    <div className="mb-1 font-black text-cyan-300">解析 Body</div>
                    <pre className="whitespace-pre-wrap break-words font-mono text-slate-300">
                      {formatTtsResponseEvidence(ttsTestDialog.response.body)}
                    </pre>
                  </div>
                </div>
              </div>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setTtsTestDialog(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-black text-slate-600 hover:bg-slate-50"
              >
                关闭
              </button>
              <button
                type="button"
                onClick={() => void testTtsProvider(ttsTestDialog.values)}
                disabled={isTestingTts}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isTestingTts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                发起请求
              </button>
            </div>
          </div>
        </div>
      )}
      {nameDialog && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-slate-900/35 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-900">{nameDialog.title}</h3>
              <button
                type="button"
                onClick={() => setNameDialog(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              autoFocus
              value={nameDialog.value}
              onChange={(event) => setNameDialog((current) => (
                current ? { ...current, value: event.target.value } : current
              ))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  submitNameDialog();
                }
                if (event.key === 'Escape') {
                  setNameDialog(null);
                }
              }}
              className="mt-4 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
              placeholder="输入名称"
            />
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setNameDialog(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={submitNameDialog}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}
      {renderPerformanceReportDialog()}
      {quickTaskPerformanceDialog && (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-900/35 px-4">
          <div role="dialog" aria-modal="true" aria-label="快捷创建测试任务" className="max-h-[86vh] w-full max-w-md overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-black text-slate-900">快捷创建测试任务</h3>
                <p className="mt-1 truncate text-xs font-bold text-slate-400">
                  {quickTaskPerformanceDialog.folderName}
                </p>
              </div>
              <button
                type="button"
                disabled={isSubmittingTask}
                onClick={() => setQuickTaskPerformanceDialog(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <fieldset disabled={isSubmittingTask} className="min-w-0">
            <div className="mt-4 grid gap-2">
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={quickTaskPerformanceDialog.collectPhonePerformance}
                  onChange={(event) => setQuickTaskPerformanceDialog((current) => (
                    current ? { ...current, collectPhonePerformance: event.target.checked } : current
                  ))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block text-xs font-black text-slate-800">采集手机性能</span>
                  <span className="mt-1 block text-[11px] font-bold leading-4 text-slate-400">使用顶部手机设备信息，任务结束后生成报告。</span>
                </span>
              </label>
              <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left">
                <input
                  type="checkbox"
                  checked={quickTaskPerformanceDialog.collectGlassesPerformance}
                  onChange={(event) => setQuickTaskPerformanceDialog((current) => (
                    current ? { ...current, collectGlassesPerformance: event.target.checked } : current
                  ))}
                  className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                />
                <span>
                  <span className="block text-xs font-black text-slate-800">采集眼镜性能</span>
                  <span className="mt-1 block text-[11px] font-bold leading-4 text-slate-400">使用顶部眼镜设备信息，任务结束后生成报告。</span>
                </span>
              </label>
            </div>
            <ThreadStackOptionsEditor value={quickTaskPerformanceDialog.threadStacks} onChange={threadStacks => setQuickTaskPerformanceDialog(current => current ? { ...current, threadStacks } : current)} />
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
              <div className="text-xs font-black text-slate-900">本次执行开始节点选项</div>
              <div className="mt-2 grid gap-2">
                {[
                  ['keepScreenAwake', '执行前开启设备屏幕常亮'],
                  ['recordGlassesScreen', '保存眼镜录屏'],
                  ['recordPhoneScreen', '保存手机录屏'],
                  ['showPhoneScreen', '执行时展示手机投屏'],
                  ['showGlassesScreen', '执行时展示眼镜投屏'],
                ].map(([key, label]) => (
                  <label key={key} className="flex items-center justify-between rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                    {label}
                    <input
                      type="checkbox"
                      checked={Boolean(quickTaskPerformanceDialog.startOptions[key as keyof AutomationTaskStartOptions])}
                      onChange={(event) => setQuickTaskPerformanceDialog((current) => (
                        current
                          ? {
                              ...current,
                              startOptions: {
                                ...current.startOptions,
                                [key]: event.target.checked,
                              },
                            }
                          : current
                      ))}
                      className="h-4 w-4"
                    />
                  </label>
                ))}
              </div>
              <div className="mt-2 text-[11px] font-bold leading-4 text-blue-700">
                只覆盖本次任务运行，不会修改用例库里每个用例的开始节点配置。
              </div>
            </div>
            </fieldset>
            {quickTaskCreateError && <div role="alert" className="mt-3 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{quickTaskCreateError}</div>}
            {isSubmittingTask && <div role="status" className="mt-3 flex items-center gap-2 text-xs text-blue-600"><Loader2 className="h-4 w-4 animate-spin" />正在校验并提交任务，请稍候…</div>}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                disabled={isSubmittingTask}
                onClick={() => setQuickTaskPerformanceDialog(null)}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                disabled={isSubmittingTask}
                onClick={createQuickTaskFromDialog}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Play className="h-3.5 w-3.5 fill-current" />
                {isSubmittingTask ? '提交中…' : '创建并运行'}
              </button>
            </div>
          </div>
        </div>
      )}
      {taskCreateDialog && (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-900/35 px-4">
          <div className="flex max-h-[86vh] w-full max-w-3xl flex-col rounded-2xl border border-slate-200 bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-black text-slate-900">创建{taskCreateDialog.stress ? '压测' : '测试'}任务</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  从用例库、文件夹或单条用例维度圈选要执行的用例。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setTaskCreateDialog(null)}
                disabled={isSubmittingTask}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <fieldset disabled={isSubmittingTask} className="contents">
            <div className="max-h-[48vh] shrink-0 overflow-auto border-b border-slate-100 px-5 py-4">
              <label className="block text-xs font-black text-slate-500">
                任务名称
                <input
                  value={taskCreateDialog.name}
                  onChange={(event) => setTaskCreateDialog((current) => (
                    current ? { ...current, name: event.target.value } : current
                  ))}
                  className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
                  placeholder="输入测试任务名称"
                />
              </label>
              {taskCreateDialog.stress && (
                <div className="mt-4 space-y-3 rounded-xl border border-blue-100 bg-blue-50/60 p-3">
                  <div className="flex flex-wrap items-end gap-3">
                    <label className="text-xs font-bold">循环模式
                      <select className="ml-2 rounded-lg border border-slate-200 bg-white p-2" value={taskCreateDialog.stress.mode}
                        onChange={(event) => setTaskCreateDialog((current) => current?.stress ? { ...current, stress: { ...current.stress, mode: event.target.value as StressTaskOptions['mode'] } } : current)}>
                        <option value="rounds">指定轮数</option><option value="duration">指定时长</option>
                      </select>
                    </label>
                    <label className="text-xs font-bold">{taskCreateDialog.stress.mode === 'rounds' ? '轮数' : '分钟'}
                      <input type="number" min="1" max="100000" step="1" className="ml-2 w-24 rounded-lg border border-slate-200 bg-white p-2" value={taskCreateDialog.stress.value || ''}
                        onChange={(event) => setTaskCreateDialog((current) => current?.stress ? { ...current, stress: { ...current.stress, value: Number(event.target.value) } } : current)} />
                    </label>
                  </div>
                  <p className="text-xs text-slate-500">按列表顺序串行循环。达到时长后不再启动下一条，当前用例完成后结束。录屏默认关闭，可在下方手动开启。</p>
                  <div className="flex flex-wrap gap-4 text-xs font-bold">
                    {(['phoneLog', 'glassesLog'] as const).map((key) => <label key={key} className="flex items-center gap-2">
                      <input type="checkbox" checked={taskCreateDialog.stress![key]} onChange={(event) => setTaskCreateDialog((current) => current?.stress ? { ...current, stress: { ...current.stress, [key]: event.target.checked } } : current)} />
                      保存{key === 'phoneLog' ? '手机' : '眼镜'}完整日志
                    </label>)}
                  </div>
                  <p className="text-xs text-slate-500">完整日志覆盖整个任务，单个 case 的日志仍独立保留。长时间采集会占用磁盘空间。</p>
                </div>
              )}
              <div className="mt-4 grid gap-2 sm:grid-cols-2">
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={taskCreateDialog.collectPhonePerformance}
                    onChange={(event) => setTaskCreateDialog((current) => (
                      current ? { ...current, collectPhonePerformance: event.target.checked } : current
                    ))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    <span className="block text-xs font-black text-slate-800">启动手机性能测试</span>
                    <span className="mt-1 block text-[11px] font-bold leading-4 text-slate-400">后台采集 CPU、内存、线程；Android 同时采集电池温度。</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-left">
                  <input
                    type="checkbox"
                    checked={taskCreateDialog.collectGlassesPerformance}
                    onChange={(event) => setTaskCreateDialog((current) => (
                      current ? { ...current, collectGlassesPerformance: event.target.checked } : current
                    ))}
                    className="mt-0.5 h-4 w-4 rounded border-slate-300 text-blue-600"
                  />
                  <span>
                    <span className="block text-xs font-black text-slate-800">启动眼镜性能测试</span>
                    <span className="mt-1 block text-[11px] font-bold leading-4 text-slate-400">后台采集 CPU、内存、线程；Android 同时采集电池温度。</span>
                  </span>
                </label>
              </div>
              <ThreadStackOptionsEditor value={taskCreateDialog.threadStacks} onChange={threadStacks => setTaskCreateDialog(current => current ? { ...current, threadStacks } : current)} />
              <div className="mt-4 rounded-2xl border border-blue-100 bg-blue-50/60 p-3">
                <div className="text-xs font-black text-slate-900">本次执行开始节点选项</div>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  {[
                    ['keepScreenAwake', '执行前开启设备屏幕常亮'],
                    ['recordGlassesScreen', '保存眼镜录屏'],
                    ['recordPhoneScreen', '保存手机录屏'],
                    ['showPhoneScreen', '执行时展示手机投屏'],
                    ['showGlassesScreen', '执行时展示眼镜投屏'],
                  ].map(([key, label]) => (
                    <label key={key} className="flex items-center justify-between rounded-xl border border-blue-100 bg-white px-3 py-2 text-xs font-bold text-slate-600">
                      {label}
                      <input
                        type="checkbox"
                        checked={Boolean(taskCreateDialog.startOptions[key as keyof AutomationTaskStartOptions])}
                        onChange={(event) => setTaskCreateDialog((current) => (
                          current
                            ? {
                                ...current,
                                startOptions: {
                                  ...current.startOptions,
                                  [key]: event.target.checked,
                                },
                              }
                            : current
                        ))}
                        className="h-4 w-4"
                      />
                    </label>
                  ))}
                </div>
                <div className="mt-2 text-[11px] font-bold leading-4 text-blue-700">
                  这些选项会覆盖所有选中用例的开始节点，但只对本次任务生效，不会写回原用例。
                </div>
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-auto px-5 py-4">
              <div className="space-y-3">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span>勾选选择用例，点击名称展开或收起</span>
                  <div className="flex gap-3">
                    <button type="button" className="text-blue-600" onClick={() => setTaskPickerCollapsed(new Set())}>全部展开</button>
                    <button type="button" className="text-blue-600" onClick={() => setTaskPickerCollapsed(new Set([
                      ...normalizedCaseLibraries.map((library) => `library:${library.id}`),
                      ...caseLibraryFolders.map((folder) => `folder:${folder.id}`),
                    ]))}>全部收起</button>
                  </div>
                </div>
                {normalizedCaseLibraries.map((library) => {
                  const branchKey = `library:${library.id}`;
                  const expanded = !taskPickerCollapsed.has(branchKey);
                  const libraryCaseIds = getLibraryCaseIdsForTask(library.id);
                  const selectedIds = new Set(taskCreateDialog.selectedCaseIds);
                  const selectedCount = libraryCaseIds.filter((caseId) => selectedIds.has(caseId)).length;
                  const isChecked = libraryCaseIds.length > 0 && selectedCount === libraryCaseIds.length;
                  const isPartial = selectedCount > 0 && selectedCount < libraryCaseIds.length;
                  const rootFolders = (childFoldersByParent.get(`library:${library.id}`) || [])
                    .filter((folder) => getFolderLibraryId(folder) === library.id);

                  return (
                    <div key={library.id} className="rounded-2xl border border-slate-200 bg-white p-2">
                      <div className="flex min-w-0 items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-sm font-black text-slate-800">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={(event) => setTaskCaseSelection(libraryCaseIds, event.target.checked)}
                          aria-label={`选择用例库 ${library.name}`}
                          aria-checked={isPartial ? 'mixed' : isChecked}
                          ref={(input) => { if (input) input.indeterminate = isPartial; }}
                          disabled={libraryCaseIds.length === 0}
                          className="h-4 w-4 rounded border-slate-300 text-blue-600"
                        />
                        <button type="button" aria-expanded={expanded} aria-label={`${expanded ? '收起' : '展开'}用例库 ${library.name}`}
                          onClick={() => setTaskPickerCollapsed((current) => toggleTreeBranch(current, branchKey))}
                          className="flex min-w-0 flex-1 items-center gap-2 text-left">
                          <CaseTreeDisclosure expanded={expanded} />
                          <FolderOpen className="h-4 w-4 shrink-0 text-blue-600" />
                          <span className="min-w-0 flex-1 truncate" title={library.name}>{library.name}</span>
                        </button>
                        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                          isPartial ? 'bg-amber-50 text-amber-600' : 'bg-white text-slate-500'
                        }`}>
                          {selectedCount}/{libraryCaseIds.length}
                        </span>
                      </div>
                      {expanded && <div className="mt-1 space-y-1">
                        {rootFolders.length > 0 ? (
                          rootFolders.map((folder) => renderTaskFolderPicker(folder))
                        ) : (
                          <div className="rounded-xl px-3 py-4 text-center text-xs font-bold text-slate-400">
                            这个库暂无可选文件夹
                          </div>
                        )}
                      </div>}
                    </div>
                  );
                })}
              </div>
            </div>
            </fieldset>
            {taskCreateError && <div role="alert" className="mx-5 max-h-28 shrink-0 overflow-auto whitespace-pre-wrap break-words rounded-xl bg-rose-50 px-3 py-2 text-xs text-rose-700">{taskCreateError}</div>}
            {isSubmittingTask && <div role="status" className="mx-5 flex shrink-0 items-center gap-2 text-xs text-blue-600"><Loader2 className="h-4 w-4 animate-spin" />正在校验并提交任务，请稍候…</div>}
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 px-5 py-4">
              <div className="text-xs font-bold text-slate-500">
                已选择 <span className="font-black text-blue-600">{taskCreateDialog.selectedCaseIds.length}</span> 条用例
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setTaskCreateDialog((current) => (
                    current ? { ...current, selectedCaseIds: [] } : current
                  ))}
                  disabled={isSubmittingTask}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
                >
                  清空
                </button>
                <button
                  type="button"
                  onClick={() => setTaskCreateDialog(null)}
                  disabled={isSubmittingTask}
                  className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={createTaskFromDialog}
                  disabled={taskCreateDialog.selectedCaseIds.length === 0 || isSubmittingTask}
                  className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Play className="h-3.5 w-3.5 fill-current" />
                  {isSubmittingTask ? '提交中…' : '创建并运行'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {gitConfigDialog && (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-900/35 px-4">
          <div className="w-full max-w-lg rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-black text-slate-900">配置 Git 用例库地址</h3>
                <p className="mt-1 text-xs font-bold text-slate-400">
                  配置后将继续执行{gitConfigDialog.intent === 'push' ? '上传' : gitConfigDialog.intent === 'auto' ? '自动更新' : '拉取'}操作。
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setGitConfigDialog(null);
                  setGitConfigError('');
                }}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              autoFocus
              value={gitConfigDialog.value}
              onChange={(event) => setGitConfigDialog((current) => (
                current ? { ...current, value: event.target.value } : current
              ))}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  void submitGitConfigDialog();
                }
                if (event.key === 'Escape') {
                  setGitConfigDialog(null);
                }
              }}
              className="mt-4 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
              placeholder="git@xxx:team/glassbox-cases.git"
            />
            <input
              value={gitConfigDialog.branch || 'master'}
              onChange={(event) => setGitConfigDialog((current) => (
                current ? { ...current, branch: event.target.value } : current
              ))}
              className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
              placeholder="分支，如 master / develop"
            />
            <div className="mt-3 grid grid-cols-2 gap-2">
              <input
                value={gitConfigDialog.authUsername || ''}
                onChange={(event) => setGitConfigDialog((current) => (
                  current ? { ...current, authUsername: event.target.value } : current
                ))}
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
                placeholder="HTTPS 用户名，可选"
              />
              <input
                type="password"
                value={gitConfigDialog.authToken || ''}
                onChange={(event) => setGitConfigDialog((current) => (
                  current ? { ...current, authToken: event.target.value } : current
                ))}
                className="h-10 rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
                placeholder="Token / 密码，可选"
              />
            </div>
            <div className="mt-2 text-[11px] font-bold leading-5 text-slate-400">
              HTTPS 私有仓库可填写用户名和 Token；SSH 仓库可填写本机私钥路径和私钥密码。
            </div>
            <input
              value={gitConfigDialog.sshKeyPath || ''}
              onChange={(event) => setGitConfigDialog((current) => (
                current ? { ...current, sshKeyPath: event.target.value } : current
              ))}
              className="mt-3 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
              placeholder="SSH 私钥路径，可选，如 ~/.ssh/id_rsa"
            />
            <input
              type="password"
              value={gitConfigDialog.sshPassphrase || ''}
              onChange={(event) => setGitConfigDialog((current) => (
                current ? { ...current, sshPassphrase: event.target.value } : current
              ))}
              className="mt-2 h-10 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold text-slate-800 outline-none focus:border-blue-300 focus:bg-white"
              placeholder="SSH 私钥密码 / passphrase，可选"
            />
            <div className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-700">
              这里不是电脑登录密码，而是创建 SSH 私钥时设置的 passphrase。若你的 SSH key 没有设置密码，可留空；如果 Git 提示需要密码，软件会回到这个弹窗让你补充。
            </div>
            {gitConfigError && (
              <div className="mt-3 max-h-28 overflow-auto rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold leading-5 text-rose-700">
                {gitConfigError}
              </div>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setGitConfigDialog(null);
                  setGitConfigError('');
                }}
                className="rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-500 hover:bg-slate-50"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void submitGitConfigDialog()}
                className="rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white hover:bg-blue-700"
              >
                保存并继续
              </button>
            </div>
          </div>
        </div>
      )}
      {exportFolderDialog && (
        <div className="fixed inset-0 z-[82] flex items-center justify-center bg-slate-900/35 px-4">
          <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-black text-slate-900">选择导出格式</h3>
              <button
                type="button"
                onClick={() => setExportFolderDialog(null)}
                className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-3">
              <button
                type="button"
                onClick={() => {
                  const folder = caseLibraryFolders.find((item) => item.id === exportFolderDialog.folderId);
                  if (folder) exportFolder(folder, 'json');
                }}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-black text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
              >
                JSON
              </button>
              <button
                type="button"
                onClick={() => {
                  const folder = caseLibraryFolders.find((item) => item.id === exportFolderDialog.folderId);
                  if (folder) exportFolder(folder, 'yaml');
                }}
                className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-5 text-sm font-black text-slate-700 hover:border-blue-200 hover:bg-blue-50 hover:text-blue-600"
              >
                YAML
              </button>
            </div>
          </div>
        </div>
      )}
      {isGitLfsGuideOpen && (
        <div className="fixed inset-0 z-[85] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-xl overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-2xl">
            <div className="border-b border-slate-100 bg-slate-50 px-6 py-5">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="inline-flex items-center gap-2 rounded-full bg-blue-50 px-3 py-1 text-[11px] font-black text-blue-600">
                    <GitBranch className="h-3.5 w-3.5" />
                    Git LFS Required
                  </div>
                  <h3 className="mt-3 text-lg font-black text-slate-900">检查系统 Git / Git LFS</h3>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    solopi-desktop 与终端共用 Git、Git LFS 和认证配置。点击安装仅补装缺失工具，不升级已有版本。需要先安装 Homebrew；Windows 请手动安装 Git 与 Git LFS 后重新检测。
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsGitLfsGuideOpen(false)}
                  className="rounded-xl p-2 text-slate-400 hover:bg-white hover:text-slate-700"
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="space-y-4 px-6 py-5">
              <div className="rounded-2xl border border-slate-200 bg-white p-4">
                <div className="text-xs font-black uppercase tracking-widest text-slate-400">macOS Homebrew</div>
                <div className="mt-3 overflow-x-auto rounded-xl bg-slate-950 px-4 py-3 font-mono text-xs font-bold text-slate-100">
                  {'git --version >/dev/null 2>&1 || brew install git; git lfs version >/dev/null 2>&1 || brew install git-lfs'}
                </div>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  <button
                    type="button"
                    onClick={installGitLfsWithHomebrew}
                    disabled={isInstallingGitLfs}
                    className="rounded-xl bg-blue-600 px-3 py-2 text-xs font-black text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {isInstallingGitLfs ? '安装中...' : '使用 Homebrew 安装'}
                  </button>
                  <button
                    type="button"
                    onClick={copyGitLfsInstallCommand}
                    className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    复制命令
                  </button>
                </div>
                {isInstallingGitLfs && (
                  <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-bold leading-5 text-blue-700">
                    {gitLfsInstallMessage || '正在安装 Git LFS...'}
                  </div>
                )}
              </div>

              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  onClick={openGitLfsWebsite}
                  className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  打开 Git LFS 官网
                </button>
                <button
                  type="button"
                  onClick={recheckGitLfsAndPull}
                  className="flex items-center justify-center gap-2 rounded-xl bg-slate-900 px-3 py-2 text-xs font-black text-white hover:bg-slate-700"
                >
                  <CheckCircle2 className="h-3.5 w-3.5" />
                  已安装，继续拉取
                </button>
              </div>

              {caseLibraryStatus && (
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold leading-5 text-slate-500">
                  {caseLibraryStatus}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
      {scrcpyGuideDialog && (
        <div className="fixed inset-0 z-[94] flex items-center justify-center bg-slate-900/40 px-4">
          <div className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h3 className="text-base font-black text-slate-900">需要安装 scrcpy</h3>
                <p className="mt-2 text-xs font-bold leading-5 text-slate-500">
                  {scrcpyGuideDialog.optionLabel} 依赖 scrcpy。安装完成后重新勾选该选项。
                </p>
              </div>
              <button
                type="button"
                onClick={() => setScrcpyGuideDialog(null)}
                className="rounded-xl p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                title="关闭"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
            <div className="mt-4 rounded-2xl bg-slate-950 px-4 py-3 font-mono text-xs font-bold text-slate-100">
              {scrcpyGuideDialog.installCommand}
            </div>
            <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={copyScrcpyInstallCommand}
                className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"
              >
                <Copy className="h-3.5 w-3.5" />
                复制命令
              </button>
              <button
                type="button"
                onClick={openScrcpyInstallGuide}
                className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
              >
                <ExternalLink className="h-3.5 w-3.5" />
                打开下载说明
              </button>
            </div>
          </div>
        </div>
      )}
      {toastMessages.length > 0 && (
        <div className="fixed right-6 top-6 z-[95] flex w-[360px] max-w-[calc(100vw-48px)] flex-col gap-2">
          {toastMessages.map((toast) => (
            <div
              key={toast.id}
              className="rounded-2xl border border-slate-200 bg-white px-4 py-3 text-xs font-bold leading-5 text-slate-700 shadow-2xl"
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}
      {renderAssistantPanel()}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        collapsed={isMainSidebarCollapsed}
        onToggleCollapsed={toggleMainSidebarCollapsed}
        onAssistantOpen={() => {
          setIsAssistantOpen(true);
          setIsAssistantCollapsed(false);
        }}
      />

      <main className="flex-1 flex min-h-0 min-w-0 flex-col overflow-hidden bg-white">
        {activeTab !== 'agent' && deviceControls}
        {activeTab === 'agent' ? (
          <AgentPage onNavigate={setActiveTab} deviceControls={deviceControls} initialSessionId={mirrorSessionId} onSessionChange={setMirrorSessionId} />
        ) : activeTab === 'automation-cases' ? (
          renderAutomationCases()
        ) : activeTab === 'automation-task-report' ? (
          renderAutomationTaskReport()
        ) : activeTab === 'automation-tasks' ? (
          renderAutomationTasks()
        ) : activeTab === 'automation-components' ? (
          renderAutomationComponents()
        ) : activeTab === 'settings' ? (
          renderSettingsCenter()
        ) : activeTab === 'automation-flow' ? (
          <div className="flex-1 flex flex-col min-h-0">
            <header className="h-14 border-b border-slate-200 bg-white flex items-center justify-between px-6 shrink-0 z-10">
              <div className="flex min-w-0 items-center gap-3">
                <button
                  type="button"
                  onClick={handleFlowBack}
                  className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 transition-all hover:bg-slate-50 hover:text-slate-900"
                  title={flowReturnTarget.tab === 'automation-task-report' || flowReturnTarget.tab === 'automation-flow-report-preview' ? '返回测试报告' : '返回用例库'}
                >
                  <ArrowLeft className="h-4 w-4" />
                </button>
                <div
                  className="flex min-w-0 items-center gap-2 rounded-xl px-2 py-1.5"
                  title={isReportFlowReadOnly ? '报告查看模式，用例不可编辑' : '双击重命名用例'}
                >
                  <Zap className="w-4 h-4 text-blue-600 fill-blue-600" />
                  {!isReportFlowReadOnly && editingName?.type === 'case' && editingName.id === selectedCase.id ? (
                    <input
                      autoFocus
                      value={editingName.value}
                      onChange={(event) => setEditingName({ ...editingName, value: event.target.value })}
                      onBlur={commitInlineEditingName}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') commitInlineEditingName();
                        if (event.key === 'Escape') setEditingName(null);
                      }}
                      className="h-8 min-w-[180px] rounded-lg border border-blue-200 bg-white px-2 text-sm font-black tracking-tight text-slate-900 outline-none"
                    />
                  ) : (
                    <span
                      onDoubleClick={() => {
                        if (!isReportFlowReadOnly) {
                          setEditingName({ type: 'case', id: selectedCase.id, value: selectedCase.name });
                        }
                      }}
                      className="truncate text-sm font-black tracking-tight text-slate-900"
                    >
                      {selectedCase.name}
                    </span>
                  )}
                  {isReportFlowReadOnly && (
                    <span className="shrink-0 rounded-full bg-slate-900 px-2 py-0.5 text-[10px] font-black text-white">
                      报告查看模式
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2">
                {isReportFlowReadOnly && !isImportedReportFlow && (
                  <button
                    type="button"
                    onClick={openEditableCaseFromReport}
                    className="flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2 text-xs font-black text-white shadow-lg shadow-blue-100 hover:bg-blue-700"
                    title="跳转到用例库中的原用例进行编辑"
                  >
                    <FilePlus className="h-3.5 w-3.5" />
                    编辑原用例
                  </button>
                )}
                {!isReportFlowReadOnly && (
                  <>
                    <button
                      type="button"
                      onClick={() => void refreshSelectedCaseLibrary()}
                      disabled={isRefreshingCaseLibrary}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all rounded-lg"
                      title="重新读取本地用例库 JSON/YAML；不会执行 Git pull 或 push"
                    >
                      {isRefreshingCaseLibrary ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <RefreshCw className="w-3.5 h-3.5" />
                      )}
                      {isRefreshingCaseLibrary ? '刷新中' : '刷新用例'}
                    </button>
                    <button
                      type="button"
                      onClick={spreadWorkflowLayout}
                      className="flex items-center gap-2 px-3 py-1.5 text-xs font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all rounded-lg"
                      title="按执行顺序散开节点布局"
                    >
                      <GitBranch className="w-3.5 h-3.5" />
                      整理布局
                    </button>
                    <div className="h-4 w-[1px] bg-slate-200 mx-1" />
                    <button
                      type="button"
                      onClick={runWorkflow}
                      disabled={selectedCase.steps.length === 0 || (!isRunning && soloPiPendingSteps.length > 0)}
                      title={soloPiPendingSteps.length ? `还有 ${soloPiPendingSteps.length} 个录制动作待转换：${soloPiPendingSteps.map(step => step.name).join('、')}` : undefined}
                      className={`flex items-center gap-2 px-4 py-2 text-xs font-black text-white disabled:opacity-50 transition-all rounded-xl shadow-lg ${
                        isRunning
                          ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-200'
                          : 'bg-blue-600 hover:bg-blue-700 shadow-blue-200'
                      }`}
                    >
                      {isRunning ? <Square className="w-3.5 h-3.5 fill-current" /> : <Play className="w-3.5 h-3.5 fill-current" />}
                      {isRunning ? '强制停止' : soloPiPendingSteps.length ? `待处理 ${soloPiPendingSteps.length} 项` : '运行工作流'}
                    </button>
                  </>
                )}
              </div>
            </header>

            <div className="flex flex-1 min-h-0 flex-col bg-slate-50">
              <WorkflowVariablePanel key={selectedCase.id} entries={[
                ...Object.entries(selectedCase.variables || {}).map(([name, value]) => ({ name: `variables.${name}`, variableKey: name, value, source: '用例变量' })),
                ...Object.entries({ phoneSerial: selectedPhoneSerial, glassesSerial: selectedGlassesSerial, phonePackage: selectedPhonePackage, glassesPackage: selectedGlassesPackage }).map(([name, value]) => ({ name: `defaults.${name}`, value, source: '当前设备选择' })),
                { name: 'defaults.adbPath', source: '执行时读取环境配置中的 ADB 路径', pending: true },
                ...selectedCase.steps.flatMap((step) => {
                  const component = selectedCase.components?.find((item) => item.id === step.componentId) || components.find((item) => item.id === step.componentId);
                  const config = step.type === 'component' ? {
                    ...Object.fromEntries((component?.params || []).map((param) => [param.key, param.defaultValue])),
                    ...step.inputs,
                  } : step.config;
                  const enabled = config.extractVariableEnabled === true || config.extractVariableEnabled === 'true';
                  const catalogStep = { ...step, inputs: {}, config: { ...config, extractVariableName: enabled ? config.extractVariableName : '' } };
                  return Array.from(collectWorkflowVariableNames([catalogStep])).map((name) => ({ name: `variables.${name}`, source: `节点：${step.name || step.id}`, pending: true }));
                }),
              ]} onVariableChange={isReportFlowReadOnly ? undefined : (key, value) => {
                updateSelectedCase((testCase) => ({
                  ...testCase,
                  variables: { ...(testCase.variables || {}), [key]: value },
                }));
              }} />
              {!isReportFlowReadOnly && renderLocalCaseLibraryChangeBanner()}
              {isReportFlowReadOnly && (
                <div className="flex items-center justify-between gap-3 border-b border-slate-200 bg-slate-900 px-6 py-2 text-xs font-bold text-slate-100">
                  <span>正在查看测试报告快照。节点、连线和配置均为只读，不会写回用例库。</span>
                  {!isImportedReportFlow && (
                    <button
                      type="button"
                      onClick={openEditableCaseFromReport}
                      className="shrink-0 rounded-lg bg-white/10 px-3 py-1 text-[11px] font-black text-white hover:bg-white/20"
                    >
                      去编辑原用例
                    </button>
                  )}
                </div>
              )}
              {!isReportFlowReadOnly && (
              <div className="border-b border-slate-200 bg-white px-3 py-1.5">
                <div className="grid min-w-0 grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.1fr)] gap-1.5 overflow-visible">
                      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-400">操作</span>
                          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                            {actionTemplateComponents.map((component) => (
                              <button
                                key={component.id}
                                type="button"
                                onClick={() => addComponentStep(component)}
                                className="flex h-9 w-[140px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-blue-200 hover:bg-blue-50"
                                title={component.description}
                              >
                                <div className="rounded-lg bg-blue-600 p-1.5 text-white">
                                  {component.kind === 'audio' ? <Mic className="h-3.5 w-3.5" /> : <Terminal className="h-3.5 w-3.5" />}
                                </div>
                                <span className="truncate text-[12px] font-black text-slate-900">{component.name}</span>
                              </button>
                            ))}
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={(event) => toggleCustomAtomMenu('action', event)}
                                className="flex h-9 w-[140px] shrink-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-blue-200 hover:bg-blue-50"
                              >
                                <span className="truncate text-[12px] font-black text-slate-900">自定义组件</span>
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-400">检测</span>
                          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                            {detectTemplateComponents.map((component) => (
                              <button
                                key={component.id}
                                type="button"
                                onClick={() => addComponentStep(component)}
                                className="flex h-9 w-[140px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-orange-200 hover:bg-orange-50"
                                title={component.description}
                              >
                                <div className="rounded-lg bg-orange-500 p-1.5 text-white">
                                  <Search className="h-3.5 w-3.5" />
                                </div>
                                <span className="truncate text-[12px] font-black text-slate-900">{component.name}</span>
                              </button>
                            ))}
                            <div className="relative shrink-0">
                              <button
                                type="button"
                                onClick={(event) => toggleCustomAtomMenu('detect', event)}
                                className="flex h-9 w-[140px] shrink-0 items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-orange-200 hover:bg-orange-50"
                              >
                                <span className="truncate text-[12px] font-black text-slate-900">自定义组件</span>
                                <ChevronDown className="h-3.5 w-3.5 text-slate-400" />
                              </button>
                            </div>
                          </div>
                        </div>
                      </div>
                      <div className="min-w-0 rounded-xl border border-slate-200 bg-slate-50/70 px-2 py-1.5">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className="shrink-0 text-[10px] font-black uppercase tracking-wide text-slate-400">流程</span>
                          <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1">
                            <button
                              type="button"
                              onClick={() => addStep('http_request')}
                              className="flex h-9 w-[132px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-sky-200 hover:bg-sky-50"
                              title={stepTypeDescriptions.http_request}
                            >
                              <div className="rounded-lg bg-sky-600 p-1.5 text-white">
                                <Globe2 className="h-3.5 w-3.5" />
                              </div>
                              <span className="truncate text-[12px] font-black text-slate-900">HTTP 请求</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => addStep('llm_text_generate')}
                              className="flex h-9 w-[132px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-violet-200 hover:bg-violet-50"
                              title={stepTypeDescriptions.llm_text_generate}
                            >
                              <div className="rounded-lg bg-violet-600 p-1.5 text-white">
                                <Bot className="h-3.5 w-3.5" />
                              </div>
                              <span className="truncate text-[12px] font-black text-slate-900">LLM 文本</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => addStep('tts_synthesize')}
                              className="flex h-9 w-[132px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50"
                              title={stepTypeDescriptions.tts_synthesize}
                            >
                              <div className="rounded-lg bg-indigo-600 p-1.5 text-white">
                                <Mic className="h-3.5 w-3.5" />
                              </div>
                              <span className="truncate text-[12px] font-black text-slate-900">TTS 合成</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => addStep('wait')}
                              className="flex h-9 w-[110px] shrink-0 items-center gap-2 rounded-lg border border-slate-200 bg-white px-2.5 text-left transition-all hover:border-blue-200 hover:bg-blue-50"
                              title={stepTypeDescriptions.wait}
                            >
                              <div className="rounded-lg bg-slate-700 p-1.5 text-white">
                                <Timer className="h-3.5 w-3.5" />
                              </div>
                              <span className="truncate text-[12px] font-black text-slate-900">等待</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => addStep('if')}
                              className="flex h-9 w-[132px] shrink-0 items-center gap-2 rounded-lg border border-emerald-200 bg-white px-2.5 text-left transition-all hover:border-emerald-300 hover:bg-emerald-50"
                              title="根据 variables.* 或 nodeOutputs.* 选择 true / false / error 分支"
                            >
                              <div className="rounded-lg bg-emerald-600 p-1.5 text-white">
                                <GitBranch className="h-3.5 w-3.5" />
                              </div>
                              <span className="truncate text-[12px] font-black text-slate-900">条件分支 IF</span>
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
              </div>
              )}
              {customAtomMenuScope && customAtomMenuRect && (
                <div
                  className="fixed z-[80] max-h-72 overflow-auto rounded-xl border border-slate-200 bg-white p-1 shadow-2xl shadow-slate-900/15"
                  style={{
                    left: customAtomMenuRect.left,
                    top: customAtomMenuRect.top,
                    width: Math.max(customAtomMenuRect.width, 256),
                  }}
                >
                  {customAtomMenuScope === 'action' ? (
                    actionCustomComponents.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs font-bold text-slate-400">暂无操作类自定义组件</div>
                    ) : actionCustomComponents.map((component) => (
                      <button
                        key={component.id}
                        type="button"
                        onClick={() => addComponentStep(component)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-blue-50"
                        title={component.description}
                      >
                        {component.kind === 'audio' ? (
                          <Mic className="h-3.5 w-3.5 text-blue-600" />
                        ) : (
                          <Terminal className="h-3.5 w-3.5 text-blue-600" />
                        )}
                        <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">{component.name}</span>
                      </button>
                    ))
                  ) : (
                    detectCustomComponents.length === 0 ? (
                      <div className="px-3 py-4 text-center text-xs font-bold text-slate-400">暂无检测类自定义组件</div>
                    ) : detectCustomComponents.map((component) => (
                      <button
                        key={component.id}
                        type="button"
                        onClick={() => addComponentStep(component)}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-orange-50"
                        title={component.description}
                      >
                        <Search className="h-3.5 w-3.5 text-orange-500" />
                        <span className="min-w-0 flex-1 truncate text-xs font-black text-slate-800">{component.name}</span>
                      </button>
                    ))
                  )}
                </div>
              )}

              <div
                data-testid="workflow-editor-flow-layout"
                className={`grid flex-1 min-h-0 ${!isFlowOpening && isConfigPanelOpen && selectedStep ? 'grid-cols-[minmax(0,1fr)_minmax(300px,320px)]' : 'grid-cols-1'}`}
              >
              <section className="relative min-w-0 overflow-hidden">
                {isFlowOpening ? (
                  <div className="flex h-full min-h-[420px] items-center justify-center bg-slate-50">
                    <div className="rounded-2xl border border-slate-200 bg-white px-6 py-5 text-center shadow-sm">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-blue-600" />
                      <div className="mt-3 text-sm font-black text-slate-800">正在打开 FLOW 预览</div>
                      <div className="mt-1 text-xs font-bold text-slate-400">正在加载报告快照和执行链路</div>
                    </div>
                  </div>
                ) : (
                  <ReactFlow
                    key={`${selectedCase.id}-${flowRenderVersion}`}
                    nodes={nodes}
                    edges={displayEdges}
                    nodeTypes={nodeTypes}
                    onNodesChange={handleNodesChange}
                    onNodeDragStop={handleNodeDragStop}
                    onEdgesChange={handleEdgesChange}
                    onNodeClick={onNodeClick}
                    onInit={(instance) => {
                      reactFlowInstanceRef.current = instance;
                    }}
                    onConnect={handleConnect}
                    onEdgeUpdate={handleEdgeUpdate}
                    onReconnect={handleEdgeUpdate}
                    deleteKeyCode={isReportFlowReadOnly ? null : ['Backspace', 'Delete']}
                    nodesDraggable={!isReportFlowReadOnly}
                    nodesConnectable={!isReportFlowReadOnly}
                    elementsSelectable
                    edgesFocusable={!isReportFlowReadOnly}
                    edgesUpdatable={!isReportFlowReadOnly}
                    edgeUpdaterRadius={18}
                    reconnectRadius={18}
                    connectOnClick={false}
                    panOnDrag={isReportFlowReadOnly ? true : [1, 2]}
                    panOnScroll
                    panOnScrollMode={PanOnScrollMode.Free}
                    zoomOnScroll={isReportFlowReadOnly}
                    zoomOnPinch
                    selectNodesOnDrag={!isReportFlowReadOnly}
                    className="h-full bg-slate-50"
                  >
                    <Background color="#cbd5e1" gap={24} size={1} />
                    <Controls className="!bg-white !border-slate-200 !shadow-sm" />
                  </ReactFlow>
                )}
                {(runMessage || runLogs.length > 0) && runLogDisplayMode === 'minimized' && (
                  <button
                    type="button"
                    onClick={() => setRunLogDisplayMode('compact')}
                    className="absolute bottom-4 right-4 flex items-center gap-2 rounded-full border border-slate-200 bg-white/95 px-4 py-2 text-xs font-black text-slate-700 shadow-lg backdrop-blur hover:bg-slate-50"
                    title="展开执行日志"
                  >
                    <ListChecks className="h-4 w-4 text-blue-600" />
                    执行日志
                    {runLogs.length > 0 && (
                      <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] text-blue-600">
                        {runLogs.length}
                      </span>
                    )}
                  </button>
                )}
                {(runMessage || runLogs.length > 0) && runLogDisplayMode !== 'minimized' && (
                  <div
                    ref={runLogPanelRef}
	                    className={`absolute bottom-4 left-4 right-4 rounded-xl border border-slate-200 bg-white/95 px-4 py-3 text-xs text-slate-600 shadow-lg backdrop-blur ${
	                      runLogDisplayMode === 'full' ? 'max-h-[520px] overflow-auto' : 'max-h-[300px] overflow-auto'
                  }`}>
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        {runMessage && (
                          <div className="truncate font-black text-slate-800">{runMessage}</div>
                        )}
                        <div className="mt-0.5 text-[10px] font-bold text-slate-400">
                          {runLogDisplayMode === 'full'
                            ? `全部操作 · ${runLogs.length} 步`
                            : runLogs.length > 0
                              ? `最近一步 · 第 ${runLogs.length} 步`
                              : '最近一步'}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-1">
                        {runLogDisplayMode === 'compact' && runLogs.length > 1 && (
                          <button
                            type="button"
                            onClick={() => setRunLogDisplayMode('full')}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                            title="展开全部操作"
                          >
                            <ChevronUp className="h-4 w-4" />
                          </button>
                        )}
                        {runLogDisplayMode === 'full' && (
                          <button
                            type="button"
                            onClick={() => setRunLogDisplayMode('compact')}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                            title="缩小为最近一步"
                          >
                            <ChevronDown className="h-4 w-4" />
                          </button>
                        )}
                        {runLogDisplayMode === 'compact' && (
                          <button
                            type="button"
                            onClick={() => setRunLogDisplayMode('minimized')}
                            className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                            title="缩小为按钮"
                          >
                            <Minimize2 className="h-4 w-4" />
                          </button>
                        )}
                      </div>
                    </div>
                    {visibleRunLogs.length > 0 && (
                      <div className="mt-3 space-y-2">
                        {visibleRunLogs.map(({ log, index }) => {
                          const repeatCount = runLogs.filter((item) => item.stepId === log.stepId).length;
                          const logDetail = getWorkflowRunLogDetail(log);

                          return (
                            <div key={`${log.stepId}-${index}`} className="rounded-lg border border-slate-100 bg-slate-50 p-2">
                              <div className="flex items-center justify-between gap-3">
                                <div className="min-w-0 font-black text-slate-800">
                                  #{index + 1} {log.stepName}
                                  {repeatCount > 1 && (
                                    <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] text-amber-700">
                                      重复 {repeatCount} 次
                                    </span>
                                  )}
                                </div>
                                <div className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-black ${
                                  log.status === 'success'
                                    ? 'bg-emerald-100 text-emerald-700'
                                    : 'bg-rose-100 text-rose-700'
                                }`}>
                                  {log.status === 'success' && (log.meta?.assertion as { outcome?: string } | undefined)?.outcome === 'timeout' ? '超时继续' : log.status === 'success' ? '成功' : '失败'}
                                </div>
                              </div>
                              <div className="mt-1 text-[10px] font-bold text-slate-400">
                                {formatRunTime(log.startedAt)} {'->'} {formatRunTime(log.endedAt)} · {formatRunDuration(log)}
                              </div>
                              {log.command && (
                                <pre
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
	                                  className={`${runLogDisplayMode === 'full' ? 'max-h-40' : 'max-h-20'} nodrag nowheel mt-2 cursor-text select-text overflow-auto whitespace-pre-wrap break-words rounded-md bg-slate-950 p-2 font-mono text-[10px] leading-relaxed text-slate-100`}
                                >
                                  {log.command}
                                </pre>
                              )}
                              {logDetail && (
                                <pre
                                  onMouseDown={(event) => event.stopPropagation()}
                                  onPointerDown={(event) => event.stopPropagation()}
	                                  className={`${runLogDisplayMode === 'full' ? 'max-h-72' : 'max-h-40'} nodrag nowheel mt-2 cursor-text select-text overflow-auto whitespace-pre-wrap break-words rounded-md border border-slate-200 bg-white p-3 font-mono text-[11px] leading-relaxed text-slate-700`}
                                >
                                  {logDetail}
                                </pre>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                    {runArtifacts && (
                      <div className="mt-3 rounded-lg border border-blue-100 bg-blue-50 p-2">
                        <div className="flex items-center justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[11px] font-black text-blue-800">执行产物</div>
                            <div className="mt-0.5 truncate font-mono text-[10px] text-blue-500">{runArtifacts.runDir}</div>
                          </div>
                          <button
                            type="button"
                            onClick={() => void openPathInFolder(runArtifacts.runDir, 'open')}
                            className="flex shrink-0 items-center gap-1 rounded-lg bg-white px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                          >
                            <FolderOpen className="h-3.5 w-3.5" />
                            打开目录
                          </button>
                        </div>
                        {runArtifacts.logs.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runArtifacts.logs.map((artifact) => (
                              <button
                                key={`${artifact.deviceType}-${artifact.serial}-${artifact.path}`}
                                type="button"
                                onClick={() => void openPathInFolder(artifact.path)}
                                className="rounded-lg border border-blue-100 bg-white px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                title={artifact.path}
                              >
                                {artifact.deviceType === 'glasses' ? '眼镜日志' : '手机日志'} · {artifact.serial || 'unknown'}
                              </button>
                            ))}
                          </div>
                        )}
                        {((runArtifacts.recordings?.length || 0) > 0 || (runArtifacts.screenshots?.length || 0) > 0) && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runArtifacts.recordings?.map((artifact) => (
                              <button
                                key={`recording-${artifact.deviceType}-${artifact.serial}-${artifact.path}`}
                                type="button"
                                onClick={() => void openPathInFolder(artifact.path)}
                                className="rounded-lg border border-blue-100 bg-white px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                title={artifact.error || artifact.path}
                              >
                                {artifact.deviceType === 'glasses' ? '眼镜录屏' : '手机录屏'} · {artifact.success ? '已保存' : '失败'}
                              </button>
                            ))}
                            {runArtifacts.screenshots?.map((artifact) => (
                              <button
                                key={`screenshot-${artifact.stepId}-${artifact.path}`}
                                type="button"
                                onClick={() => void openPathInFolder(artifact.path)}
                                className="rounded-lg border border-blue-100 bg-white px-2 py-1 text-[10px] font-bold text-blue-700 hover:bg-blue-100"
                                title={artifact.error || artifact.path}
                              >
                                断言截图 · {artifact.stepName || artifact.stepId || 'assert'}
                              </button>
                            ))}
                          </div>
                        )}
                        {(runArtifacts.screenMirrors?.length || 0) > 0 && (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {runArtifacts.screenMirrors?.map((artifact) => (
                              <button
                                key={`screen-mirror-${artifact.deviceType}-${artifact.serial}-${artifact.path || 'diagnostic'}`}
                                type="button"
                                onClick={() => artifact.path ? void openPathInFolder(artifact.path) : undefined}
                                className={`rounded-lg border bg-white px-2 py-1 text-[10px] font-bold ${
                                  artifact.success
                                    ? 'border-emerald-100 text-emerald-700 hover:bg-emerald-50'
                                    : 'border-red-100 text-red-700 hover:bg-red-50'
                                }`}
                                title={[artifact.error, artifact.scrcpyOutput, artifact.path].filter(Boolean).join('\n')}
                              >
                                {artifact.deviceType === 'phone' ? '手机投屏' : '眼镜投屏'} · {artifact.status === 'stopped' ? '已随工作流结束' : artifact.status === 'interrupted' ? '运行中断' : artifact.success ? '已启动' : '启动失败'}
                              </button>
                            ))}
                          </div>
                        )}
                        {(runArtifacts.pushedImageFiles?.length || 0) > 0 && (
                          <div className="mt-2 max-h-20 overflow-auto rounded-lg border border-cyan-100 bg-cyan-50 px-2 py-1.5 font-mono text-[10px] leading-4 text-cyan-700">
                            {runArtifacts.imageCleanup?.length ? runArtifacts.imageCleanup.map((item) => (
                              <div key={`${item.serial}-${item.remotePath}`}>
                                {item.success ? '图片已清理' : item.skipped ? '图片保留' : '图片清理失败'} · {item.remotePath}
                              </div>
                            )) : (
                              <div>图片文件已 push 到设备侧。</div>
                            )}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {!isFlowOpening && isConfigPanelOpen && selectedStep && (
              <aside
                data-testid="workflow-editor-config-panel"
                className="workflow-editor-config-panel min-h-0 min-w-0 w-full max-w-[30vw] overflow-x-hidden overflow-y-auto border-l border-slate-200 bg-white p-3"
              >
                <div className="flex items-center justify-between">
                  <h3 className="text-xs font-black text-slate-900">步骤配置</h3>
                  <button
                    type="button"
                    onClick={() => setIsConfigPanelOpen(false)}
                    className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 hover:text-slate-900"
                    title="关闭配置"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                {isReportFlowReadOnly && (
                  <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-[11px] font-bold leading-5 text-slate-500">
                    报告查看模式下配置只读，不会写回用例库。
                  </div>
                )}
                <fieldset disabled={isReportFlowReadOnly} className="min-w-0 mt-4 space-y-4 disabled:opacity-75">
                    <div>
                      <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">名称</label>
                      <input
                        value={selectedStep.name}
                        onChange={(event) => updateStep(selectedStep.id, { name: event.target.value })}
                        className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                      />
                    </div>
                    {selectedStep.type !== 'wait' && selectedStep.type !== 'start' && selectedStep.type !== 'end' && (
                      <>
                        <div className={selectedStepComponentKind === 'image_mock' || selectedStepComponentKind === 'pc_command' ? 'grid grid-cols-1 gap-3' : 'grid grid-cols-2 gap-3'}>
                          {selectedStepComponentKind === 'pc_command' && (
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">执行位置</label>
                              <div className="mt-1 flex h-9 items-center rounded-xl border border-blue-100 bg-blue-50 px-3 text-xs font-black text-blue-700">
                                当前电脑（无需选择设备）
                              </div>
                            </div>
                          )}
                          {selectedStepComponentKind !== 'image_mock' && selectedStepComponentKind !== 'pc_command' && !['http_request', 'llm_text_generate', 'tts_synthesize'].includes(selectedStep.type) && (
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">设备</label>
                              <select
                                value={selectedStep.device}
                                onChange={(event) => updateStep(selectedStep.id, { device: event.target.value as TestComponent['device'] })}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                              >
                                <option value="phone">手机</option>
                                <option value="glasses">眼镜</option>
                                {(selectedStep.type === 'send_audio' || selectedStepComponentKind === 'audio') && <option value="pc">当前电脑（PC）</option>}
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">超时</label>
                            <input
                              type="number"
                              value={selectedStep.timeoutMs || ''}
                              onChange={(event) => updateStep(selectedStep.id, { timeoutMs: Number(event.target.value || 0) })}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">执行后等待(ms)</label>
                          <input
                            type="number"
                            min={0}
                            value={Number(selectedStep.postDelayMs || 0)}
                            onChange={(event) => updateStep(selectedStep.id, { postDelayMs: Number(event.target.value || 0) })}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                          />
                        </div>
                      </>
                    )}
                    {selectedStep.type === 'component' && assertComponentKinds.has(selectedStepComponentKind) && (
                      <div className="space-y-2 rounded-xl border border-orange-100 bg-orange-50/70 px-3 py-3">
                        <label className="flex items-center justify-between text-xs font-bold text-slate-700">
                          是否卡点
                          <input
                            type="checkbox"
                            checked={selectedStep.config.assertBlocking !== false && selectedStep.config.assertBlocking !== 'false'}
                            onChange={(event) => updateStep(selectedStep.id, {
                              config: { ...selectedStep.config, assertBlocking: event.target.checked },
                            })}
                            className="h-4 w-4"
                          />
                        </label>
                        <div className="text-[10px] leading-4 text-slate-500">
                          默认开启。关闭后，该断言未通过、超时或执行异常均按节点成功继续，不影响用例成败；报告保留原始结果。用户主动停止仍会终止执行。
                        </div>
                      </div>
                    )}
                    {selectedStep.type === 'if' ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-3 text-xs font-bold leading-5 text-emerald-800">
                          IF 节点只消费运行时变量；连线请使用右侧 <code>true</code>、<code>false</code>、<code>error</code> 三个端口。
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">变量来源</label>
                          <input
                            value={String(getStepConfigValue(selectedStep, 'condition', '{{variables.running}}'))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'condition', event.target.value)}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-emerald-300"
                            placeholder="{{variables.running}} 或 {{nodeOutputs.<stepId>.stdout}}"
                          />
                          <div className="mt-1 text-[10px] leading-4 text-slate-400">变量统一使用 {'{{variables.xxx}}'} 或 {'{{nodeOutputs.xxx}}'} 格式。</div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">判断方式</label>
                          <select
                            value={String(getStepConfigValue(selectedStep, 'operator', selectedStep.config.regex ? 'regex' : selectedStep.config.notEmpty ? 'notEmpty' : 'equals'))}
                            onChange={(event) => {
                              const operator = event.target.value;
                              updateStep(selectedStep.id, {
                                config: {
                                  ...selectedStep.config,
                                  operator,
                                  notEmpty: operator === 'notEmpty',
                                  regex: operator === 'regex' ? String(selectedStep.config.regex || '') : '',
                                  equals: operator === 'equals' ? (selectedStep.config.equals ?? true) : selectedStep.config.equals,
                                },
                              });
                            }}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-emerald-300"
                          >
                            <option value="equals">equals 等于</option>
                            <option value="notEmpty">notEmpty 非空</option>
                            <option value="regex">regex 正则匹配</option>
                          </select>
                        </div>
                        {String(getStepConfigValue(selectedStep, 'operator', selectedStep.config.regex ? 'regex' : selectedStep.config.notEmpty ? 'notEmpty' : 'equals')) === 'regex' ? (
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">正则表达式</label>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'regex', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'regex', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-emerald-300"
                              placeholder="^ready$"
                            />
                          </div>
                        ) : String(getStepConfigValue(selectedStep, 'operator', selectedStep.config.regex ? 'regex' : selectedStep.config.notEmpty ? 'notEmpty' : 'equals')) === 'equals' ? (
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">期望值</label>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'equals', true))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'equals', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-emerald-300"
                              placeholder="true / false / 文本"
                            />
                          </div>
                        ) : null}
                        <div className="grid grid-cols-3 gap-1 text-[10px] font-black">
                          <div className="rounded-lg bg-emerald-50 px-2 py-1.5 text-center text-emerald-700">true</div>
                          <div className="rounded-lg bg-amber-50 px-2 py-1.5 text-center text-amber-700">false</div>
                          <div className="rounded-lg bg-rose-50 px-2 py-1.5 text-center text-rose-700">error</div>
                        </div>
                      </div>
                    ) : selectedStep.type === 'start' ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3 text-xs font-bold leading-5 text-blue-700">
                          开始节点是工作流入口。手机日志和眼镜日志会在工作流开始时清空一次并强制保存，断言节点会复用同一条运行日志流。
                        </div>
                        <div className="grid grid-cols-2 gap-2 text-xs font-bold text-slate-600">
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            手机日志
                            <div className="mt-1 text-[10px] text-emerald-600">强制保存</div>
                          </div>
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                            眼镜日志
                            <div className="mt-1 text-[10px] text-emerald-600">强制保存</div>
                          </div>
                        </div>
                        {[
                          ['keepScreenAwake', '执行前开启设备屏幕常亮', true],
                          ['recordGlassesScreen', '保存眼镜录屏', false],
                          ['recordPhoneScreen', '保存手机录屏', false],
                          ['showPhoneScreen', '执行时展示手机投屏', false],
                          ['showGlassesScreen', '执行时展示眼镜投屏', false],
                        ].map(([key, label, fallback]) => (
                          <label key={String(key)} className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                            {label}
                            <input
                              type="checkbox"
                              checked={String(getStepConfigValue(selectedStep, String(key), fallback)) !== 'false'}
                              onChange={(event) => {
                                if (String(key) === 'keepScreenAwake') {
                                  setStepConfigValue(selectedStep, String(key), event.target.checked);
                                  return;
                                }
                                void updateWorkflowScrcpyOption(selectedStep, String(key), event.target.checked, String(label));
                              }}
                              className="h-4 w-4"
                            />
                          </label>
                        ))}
                      </div>
                    ) : selectedStep.type === 'end' ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs font-bold leading-5 text-slate-600">
                          结束节点用于配置工作流执行完成后的收尾动作。
                        </div>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                          执行结束后清除本次推送的音频文件
                          <input
                            type="checkbox"
                            checked={getStepConfigValue(selectedStep, 'cleanupAudioFiles', true) !== false}
                            onChange={(event) => setStepConfigValue(selectedStep, 'cleanupAudioFiles', event.target.checked)}
                            className="h-4 w-4"
                          />
                        </label>
                        <div className="text-[10px] leading-4 text-slate-400">
                          关闭后，音频文件会保留在手机 push 目录里，方便排查音频节点是否真的推送成功。
                        </div>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                          执行结束后清除本次推送的图片文件
                          <input
                            type="checkbox"
                            checked={getStepConfigValue(selectedStep, 'cleanupImageFiles', true) !== false}
                            onChange={(event) => setStepConfigValue(selectedStep, 'cleanupImageFiles', event.target.checked)}
                            className="h-4 w-4"
                          />
                        </label>
                        <div className="text-[10px] leading-4 text-slate-400">
                          关闭后，图片 Mock 推送到设备侧的图片会保留，方便排查 Mock 图片路径是否正确。
                        </div>
                      </div>
                    ) : selectedStepComponentKind === 'tts_assert' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-orange-100 bg-orange-50/70 p-3">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-black text-slate-900">生成提取正则</div>
                              <div className="mt-1 text-[10px] font-bold leading-4 text-orange-700">
                                填写日志样例和其中要提取的文案，生成包含 ttsText 捕获组的正则。
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => generateTtsRegexForStep(selectedStep)}
                              className="shrink-0 rounded-lg bg-orange-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-orange-700"
                            >
                              生成正则
                            </button>
                          </div>
                          <div className="space-y-2">
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">日志样例</label>
                              <textarea
                                id={`tts-sample-log-step-${selectedStep.id}`}
                                value={String(getStepConfigValue(selectedStep, 'sampleLog', ''))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'sampleLog', event.target.value)}
                                className="mt-1 h-24 w-full resize-none rounded-xl border border-orange-100 bg-white px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-orange-300"
                                placeholder="例如：playTTSSession speechText=已退出支付, priority="
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">提取内容</label>
                              <input
                                value={String(getStepConfigValue(selectedStep, 'sampleExtractText', ''))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'sampleExtractText', event.target.value)}
                                className="mt-1 h-9 w-full rounded-xl border border-orange-100 bg-white px-3 text-xs font-bold outline-none focus:border-orange-300"
                                placeholder="例如：已退出支付"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">提取正则</label>
                              <textarea
                                value={String(getStepConfigValue(selectedStep, 'extractRegex', ''))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'extractRegex', event.target.value)}
                                className="mt-1 h-24 w-full resize-none rounded-xl border border-orange-100 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-orange-300"
                                placeholder="例如：playTTSSession speechText=(?<ttsText>[^\\r\\n,，]*)"
                              />
                            </div>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="mb-3">
                            <div className="text-[11px] font-black text-slate-900">校验条件</div>
                            <div className="mt-1 text-[10px] font-bold leading-4 text-slate-400">从日志提取真实文本后，与这里配置的期望文本比较。</div>
                          </div>
                          <div className="grid grid-cols-1 gap-2">
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">期望文本</label>
                              <input
                                value={String(getStepConfigValue(selectedStep, 'expectedText', ''))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'expectedText', event.target.value)}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-orange-300"
                                placeholder="${variables.expectedTtsText}"
                              />
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">比较方式</label>
                              <select
                                value={normalizeTextAssertOperator(getStepConfigValue(selectedStep, 'matchOperator', 'equals'))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'matchOperator', event.target.value)}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-orange-300"
                              >
                                {textAssertOperatorOptions.map((option) => (
                                  <option key={option.value} value={option.value}>{option.label}</option>
                                ))}
                              </select>
                            </div>
                          </div>
                        </div>
                        <AssertVariableExtractionCard
                          enabled={String(getStepConfigValue(selectedStep, 'extractVariableEnabled', 'false')) === 'true'}
                          variableName={String(getStepConfigValue(selectedStep, 'extractVariableName', ''))}
                          defaultVariableName={DEFAULT_TEXT_ASSERT_VARIABLE_NAME}
                          description="断言通过后会把提取正则捕获到的文本写入该变量。"
                          referenceExample={'{{variables.extractedText}}'}
                          onEnabledChange={(enabled) => setStepConfigValue(selectedStep, 'extractVariableEnabled', String(enabled))}
                          onVariableNameChange={(name) => setStepConfigValue(selectedStep, 'extractVariableName', name)}
                        />
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                          区分大小写
                          <input
                            type="checkbox"
                            checked={String(getStepConfigValue(selectedStep, 'caseSensitive', 'true')) !== 'false'}
                            onChange={(event) => setStepConfigValue(selectedStep, 'caseSensitive', String(event.target.checked))}
                            className="h-4 w-4"
                          />
                        </label>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                          检测时截屏
                          <input
                            type="checkbox"
                            checked={String(getStepConfigValue(selectedStep, 'captureScreenshotOnPass', 'true')) !== 'false'}
                            onChange={(event) => setStepConfigValue(selectedStep, 'captureScreenshotOnPass', String(event.target.checked))}
                            className="h-4 w-4"
                          />
                        </label>
                      </div>
                    ) : selectedStepComponentKind === 'json_assert' ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-cyan-100 bg-cyan-50 px-3 py-3 text-xs font-bold leading-5 text-cyan-700">
                          先提取日志中的完整 JSON，再按字段条件断言。默认只读取最近一次操作之后的日志；目标日志应由前置操作触发。
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div>
                              <div className="text-[11px] font-black text-slate-800">提取 JSON 区域</div>
                              <div className="mt-1 text-[10px] font-bold text-slate-400">粘贴日志原文和其中的 JSON 内容，自动生成可复用的提取正则。</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => generateJsonRegexForStep(selectedStep)}
                              className="rounded-lg bg-cyan-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-cyan-700"
                            >
                              生成正则
                            </button>
                          </div>
                          <div className="space-y-2">
                            <textarea
                              value={String(getStepConfigValue(selectedStep, 'sampleLog', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'sampleLog', event.target.value)}
                              className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-cyan-300"
                              placeholder="日志原文，例如 onViIntentResult bizType=MovieTicket,dataJson=..."
                            />
                            <textarea
                              value={String(getStepConfigValue(selectedStep, 'samplePayload', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'samplePayload', event.target.value)}
                              className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-cyan-300"
                              placeholder="提取内容，例如 {&quot;data&quot;:{...},&quot;type&quot;:&quot;Notice&quot;}"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">JSON 提取正则</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'lineRegex', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'lineRegex', event.target.value)}
                            className="mt-1 h-20 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-cyan-300"
                            placeholder="dataJson=([\\s\\S]*?), extfo="
                          />
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-white p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div>
                              <div className="text-[11px] font-black text-slate-800">条件设置区域</div>
                              <div className="mt-1 text-[10px] font-bold text-slate-400">逐条配置字段 path、处理方式和期望值。</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addJsonAssertStepCondition(selectedStep)}
                              className="inline-flex items-center gap-1 rounded-lg border border-slate-200 px-2 py-1.5 text-[10px] font-black text-cyan-700 hover:bg-cyan-50"
                            >
                              <Plus className="h-3 w-3" />
                              添加条件
                            </button>
                          </div>
                          <div className="space-y-2">
                            {parseJsonAssertConditionsForUi(getStepConfigValue(selectedStep, 'conditions', '[]')).length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-3 py-4 text-center text-[11px] font-bold leading-5 text-slate-500">
                                暂无条件。点击“添加条件”后配置字段 path、处理方式和期望值。
                              </div>
                            ) : parseJsonAssertConditionsForUi(getStepConfigValue(selectedStep, 'conditions', '[]')).map((condition, conditionIndex) => (
                              <div key={`step-json-condition-${conditionIndex}`} className="min-w-0 rounded-xl bg-slate-50 p-2">
                                <div className="flex items-center justify-between gap-2">
                                  <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">条件 {conditionIndex + 1}</div>
                                  <button
                                    type="button"
                                    onClick={() => removeJsonAssertStepCondition(selectedStep, conditionIndex)}
                                    className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                                <input
                                  value={condition.path}
                                  onChange={(event) => updateJsonAssertStepCondition(selectedStep, conditionIndex, { path: event.target.value })}
                                  className="mt-2 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-cyan-300"
                                  placeholder="path，例如 type / data.prompt"
                                />
                                <div className="mt-2 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2">
                                  <select
                                    value={condition.operator}
                                    onChange={(event) => updateJsonAssertStepCondition(selectedStep, conditionIndex, { operator: normalizeJsonAssertOperator(event.target.value) })}
                                    className="h-9 min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-cyan-300"
                                  >
                                    {jsonAssertOperatorOptions.map((option) => (
                                      <option key={option.value} value={option.value}>{option.label}</option>
                                    ))}
                                  </select>
                                  <label className="flex shrink-0 items-center justify-center gap-1 text-[10px] font-bold text-slate-500">
                                    <input
                                      type="checkbox"
                                      checked={Boolean(condition.ignoreCase)}
                                      onChange={(event) => updateJsonAssertStepCondition(selectedStep, conditionIndex, { ignoreCase: event.target.checked })}
                                      className="h-3 w-3"
                                    />
                                    忽略大小写
                                  </label>
                                </div>
                                <input
                                  value={condition.value}
                                  onChange={(event) => updateJsonAssertStepCondition(selectedStep, conditionIndex, { value: event.target.value })}
                                  className="mt-2 h-9 w-full min-w-0 rounded-lg border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-cyan-300"
                                  placeholder="期望值，例如 Notice / 下单请说确认"
                                  disabled={condition.operator === 'exists' || condition.operator === 'notExists'}
                                />
                              </div>
                            ))}
                          </div>
                          <div className="mt-2 text-[10px] font-bold leading-5 text-slate-400">
                            path 支持短路径查找，比如 type、data.prompt；正则匹配时期望值会被当作正则表达式。
                          </div>
                        </div>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                          正则区分大小写
                          <input
                            type="checkbox"
                            checked={String(getStepConfigValue(selectedStep, 'caseSensitive', 'true')) !== 'false'}
                            onChange={(event) => setStepConfigValue(selectedStep, 'caseSensitive', String(event.target.checked))}
                            className="h-4 w-4"
                          />
                        </label>
                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/60 p-3">
                          <div className="flex items-center justify-between text-xs font-bold text-emerald-800">
                            提取为变量
                            <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[10px] font-black text-emerald-700">默认关闭</span>
                            <input
                              type="checkbox"
                              checked={String(getStepConfigValue(selectedStep, 'extractVariableEnabled', 'false')) === 'true'}
                              onChange={(event) => {
                                setStepConfigValue(selectedStep, 'extractVariableEnabled', String(event.target.checked));
                                if (!event.target.checked) setStepConfigValue(selectedStep, 'extractVariableName', '');
                              }}
                              className="h-4 w-4 accent-emerald-600"
                            />
                          </div>
                          {String(getStepConfigValue(selectedStep, 'extractVariableEnabled', 'false')) === 'true' && <div className="mt-3 space-y-2">
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-emerald-700">变量名</label>
                              <div className="mt-1 flex h-9 overflow-hidden rounded-lg border border-emerald-100 bg-white">
                                <span className="flex shrink-0 items-center border-r border-emerald-100 bg-emerald-50 px-2 font-mono text-[10px] font-bold text-emerald-600">variables.</span>
                                <input
                                  value={String(getStepConfigValue(selectedStep, 'extractVariableName', ''))}
                                  onChange={(event) => {
                                    setStepConfigValue(selectedStep, 'extractVariableEnabled', 'true');
                                    setStepConfigValue(selectedStep, 'extractVariableName', event.target.value);
                                  }}
                                  required
                                  className="min-w-0 flex-1 px-2 font-mono text-xs font-bold outline-none"
                                  placeholder="请输入唯一变量名"
                                />
                              </div>
                            </div>
                            <div className="text-[10px] font-bold leading-5 text-emerald-700">
                              断言通过后会把“JSON 提取正则”捕获并解析出的内容写入该变量；后续节点可引用 {'{{variables.extractedJson.xxx}}'}。
                            </div>
                          </div>}
                        </div>
                        <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                          检测时截屏
                          <input
                            type="checkbox"
                            checked={String(getStepConfigValue(selectedStep, 'captureScreenshotOnPass', 'true')) !== 'false'}
                            onChange={(event) => setStepConfigValue(selectedStep, 'captureScreenshotOnPass', String(event.target.checked))}
                            className="h-4 w-4"
                          />
                        </label>
                      </div>
                    ) : selectedStepComponentKind === 'llm_assert' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-violet-100 bg-violet-50 px-3 py-3">
                          <div className="flex items-center gap-2 text-[11px] font-black text-violet-800">
                            <Bot className="h-4 w-4" />
                            使用运行时变量和当前日志做业务语义断言，solopi-desktop 会强制模型返回 pass:boolean。
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">模型配置</label>
                          <select
                            value={String(getStepConfigValue(selectedStep, 'providerId', '')) || getLlmProviderForStep(selectedStep)?.id || ''}
                            onChange={(event) => {
                              setStepConfigValue(selectedStep, 'providerId', event.target.value);
                            }}
                            disabled={llmProviders.length === 0}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                          >
                            {llmProviders.length === 0 ? (
                              <option value="">设置中心未配置模型</option>
                            ) : llmProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.name || provider.model || provider.id}</option>
                            ))}
                          </select>
                        </div>
                        <div className="rounded-2xl border border-violet-100 bg-white p-3">
                          <div className="mb-2 flex items-center justify-between">
                            <div>
                              <div className="text-[11px] font-black text-slate-800">提取 JSON 区域</div>
                              <div className="mt-1 text-[10px] font-bold text-slate-400">粘贴日志原文和其中要交给 LLM 判断的内容，自动生成当前日志匹配正则。</div>
                            </div>
                            <button
                              type="button"
                              onClick={() => generateLlmAssertRegexForStep(selectedStep)}
                              className="rounded-lg bg-violet-600 px-2.5 py-1.5 text-[10px] font-black text-white hover:bg-violet-700"
                            >
                              生成正则
                            </button>
                          </div>
                          <div className="space-y-2">
                            <textarea
                              value={String(getStepConfigValue(selectedStep, 'sampleLog', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'sampleLog', event.target.value)}
                              className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-violet-300"
                              placeholder="日志原文，例如 onViIntentResult bizType=MovieTicket,dataJson=..."
                            />
                            <textarea
                              value={String(getStepConfigValue(selectedStep, 'samplePayload', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'samplePayload', event.target.value)}
                              className="h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-violet-300"
                              placeholder="提取内容，例如 {&quot;movieName&quot;:&quot;长安三万里&quot;,&quot;status&quot;:&quot;selected&quot;}"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">当前日志匹配正则</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'lineRegex', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'lineRegex', event.target.value)}
                            className="mt-1 h-20 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-violet-300"
                            placeholder="onViIntentResult bizType=MovieTicket,dataJson=([\\s\\S]*?), extfo="
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">LLM 判断超时（毫秒）</label>
                          <input type="number" min={1} max={300000}
                            value={String(getStepConfigValue(selectedStep, 'llmTimeoutMs', '15000'))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'llmTimeoutMs', event.target.value)}
                            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2 text-xs" />
                          <p className="mt-1 text-xs text-slate-500">上方节点超时用于累计等待业务日志。每次模型请求（含重试）独立计时；每条候选最多3次请求，最多判断3条候选。</p>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">等待状态（JSON，可选）</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'waitingStates', '[]'))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'waitingStates', event.target.value)}
                            className="mt-1 h-20 w-full rounded-xl border border-slate-200 px-3 py-2 font-mono text-xs"
                            placeholder={'[{"path":"status","values":["pending"]}]'}
                          />
                          <p className="mt-1 text-xs text-slate-500">匹配任一规则时继续等待，不调用模型。其他状态（包括错误结果）都交给模型判断；留空或 [] 表示不过滤。字段路径支持 data.status。</p>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">断言诉求</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'assertionPrompt', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'assertionPrompt', event.target.value)}
                            className="mt-1 h-32 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold leading-5 outline-none focus:border-violet-300"
                            placeholder={DEFAULT_LLM_ASSERT_PROMPT}
                          />
                          <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-700">
                            这里只写业务判断要求；变量引用使用 {'{{variables.extractedJson.movieName}}'} 这种格式，输出协议由 solopi-desktop 隐式追加和校验。
                          </div>
                        </div>
                        <AssertVariableExtractionCard
                          enabled={String(getStepConfigValue(selectedStep, 'extractVariableEnabled', 'false')) === 'true'}
                          variableName={String(getStepConfigValue(selectedStep, 'extractVariableName', ''))}
                          defaultVariableName={DEFAULT_LLM_ASSERT_VARIABLE_NAME}
                          description="断言通过后会把当前日志正则捕获并解析出的内容写入该变量。"
                          referenceExample={'{{variables.extractedLlmLog.xxx}}'}
                          onEnabledChange={(enabled) => setStepConfigValue(selectedStep, 'extractVariableEnabled', String(enabled))}
                          onVariableNameChange={(name) => setStepConfigValue(selectedStep, 'extractVariableName', name)}
                        />
                        <div className="grid grid-cols-2 gap-2">
                          <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                            正则区分大小写
                            <input
                              type="checkbox"
                              checked={String(getStepConfigValue(selectedStep, 'caseSensitive', 'true')) !== 'false'}
                              onChange={(event) => setStepConfigValue(selectedStep, 'caseSensitive', String(event.target.checked))}
                              className="h-4 w-4"
                            />
                          </label>
                          <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                            检测时截屏
                            <input
                              type="checkbox"
                              checked={String(getStepConfigValue(selectedStep, 'captureScreenshotOnPass', 'true')) !== 'false'}
                              onChange={(event) => setStepConfigValue(selectedStep, 'captureScreenshotOnPass', String(event.target.checked))}
                              className="h-4 w-4"
                            />
                          </label>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">temperature</label>
                            <input
                              type="number"
                              step="0.1"
                              value={String(getStepConfigValue(selectedStep, 'temperature', '0.1'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'temperature', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">maxTokens</label>
                            <input
                              type="number"
                              value={String(getStepConfigValue(selectedStep, 'maxTokens', '4096'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'maxTokens', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                            />
                          </div>
                        </div>
                      </div>
                    ) : selectedStepComponentKind === 'activity' ? (
                      <div className="space-y-3">
                        {(selectedStepComponent?.params || []).map((param) => {
                          const value = selectedStep.inputs?.[param.key] ?? param.defaultValue ?? '';
                          return (
                            <div key={param.key}>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">{param.label || param.key}</label>
                              <input
                                value={value}
                                onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                placeholder={param.placeholder}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                              />
                              {param.helperText && (
                                <div className="mt-1 text-[10px] leading-4 text-slate-400">{param.helperText}</div>
                              )}
                            </div>
                          );
                        })}
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">ADB 命令预览</label>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(buildLaunchActivityPreview(selectedStep, selectedStepComponent, previewContext))}
                              className="rounded-lg border border-blue-100 px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50"
                            >
                              复制
                            </button>
                          </div>
                          <pre className="mt-1 h-20 w-full overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 whitespace-pre-wrap break-words">{buildLaunchActivityPreview(selectedStep, selectedStepComponent, previewContext)}</pre>
                        </div>
                      </div>
                    ) : selectedStepComponentKind === 'image_mock' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border-2 border-cyan-200 bg-cyan-50/70 p-3">
                          <div className="mb-3 flex items-center gap-2 text-[11px] font-black text-slate-900">
                            <span className="rounded-lg bg-cyan-600 px-2 py-1 text-[10px] text-white">STEP 1</span>
                            图片选择
                          </div>
                          <div className="flex items-center justify-between">
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">图片路径或 URL</label>
                            <button
                              type="button"
                              onClick={() => void selectImageFileForStep(selectedStep.id)}
                              className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                            >
                              选择文件
                            </button>
                          </div>
                          <input
                            value={String(getStepConfigValue(selectedStep, 'imagePath', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'imagePath', event.target.value)}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                            placeholder="/path/to/mock.png 或 https://..."
                          />
                          <div className="mt-1 text-[10px] leading-4 text-slate-400">
                            输入 http/https 会在执行时下载；本机图片在推送用例库到 Git 时会自动归档到 assets/images。
                          </div>
                        </div>

                        <div className="rounded-2xl border-2 border-blue-200 bg-blue-50/70 p-3">
                          <div className="mb-3 flex items-center gap-2 text-[11px] font-black text-slate-900">
                            <span className="rounded-lg bg-blue-600 px-2 py-1 text-[10px] text-white">STEP 2</span>
                            图片 push 路径
                          </div>
                          <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">推送设备</label>
                              <select
                                value={String(getStepConfigValue(selectedStep, 'pushDevice', 'glasses'))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'pushDevice', event.target.value)}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                              >
                                <option value="glasses">眼镜</option>
                                <option value="phone">手机</option>
                              </select>
                            </div>
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">设备侧图片路径</label>
                              <input
                                value={String(getStepConfigValue(selectedStep, 'remoteImagePath', defaultImageMockRemotePath))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'remoteImagePath', event.target.value)}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                                placeholder={defaultImageMockRemotePath}
                              />
                            </div>
                          </div>
                          <div className="mt-1 text-[10px] leading-4 text-slate-400">
                            第三步 Mock指令用 {'{{remoteImagePath}}'} 引用这里的路径；执行时会先 push 到所选设备并校验文件存在且大小大于 0。
                          </div>
                        </div>

                        <div className="rounded-2xl border-2 border-violet-200 bg-violet-50/70 p-3">
                          <div className="mb-3 flex items-center gap-2 text-[11px] font-black text-slate-900">
                            <span className="rounded-lg bg-violet-600 px-2 py-1 text-[10px] text-white">STEP 3</span>
                            Mock指令
                          </div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">执行设备</label>
                          <select
                            value={String(getStepConfigValue(selectedStep, 'commandDevice', 'phone'))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'commandDevice', event.target.value)}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-blue-300"
                          >
                            <option value="phone">手机</option>
                            <option value="glasses">眼镜</option>
                            <option value="pc">本机 PC</option>
                          </select>
                          <div className="flex items-center justify-between gap-2">
                            <label className="mt-3 text-[10px] font-black uppercase tracking-wide text-slate-500">Mock指令模板</label>
                            <button
                              type="button"
                              onClick={() => void navigator.clipboard?.writeText(getImageMockCommandTemplate(selectedStepComponent))}
                              className="rounded-lg border border-blue-100 px-2 py-1 text-[10px] font-black text-blue-600 hover:bg-blue-50"
                            >
                              复制
                            </button>
                          </div>
                          <textarea
                            wrap="off"
                            value={getImageMockCommandTemplate(selectedStepComponent)}
                            onChange={(event) => {
                              const commandTemplate = event.target.value;
                              updateSelectedCaseComponent((component) => ({ ...component, commandTemplate }));
                            }}
                            className="mt-1 h-20 w-full resize-none overflow-auto rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none"
                          />
                          <div className="mt-2 rounded-xl border border-violet-100 bg-white/80 px-3 py-2 text-[10px] font-bold leading-4 text-violet-700">
                            统一模板规范：参数值里可写 ${'{defaults.phonePackage}'}、${'{defaults.glassesPackage}'}、${'{variables.xxx}'}；命令模板里用 {'{{参数key}}'}、{'{{serial}}'}、{'{{phoneSerial}}'}、{'{{glassesSerial}}'}、{'{{remoteImagePath}}'} 读取解析后的值。本机 PC 时 {'{{serial}}'} 为空，命令直接执行程序及参数；{'{{defaults.adbPath}}'} 可读取当前 ADB 路径。
                          </div>
                          <div className="mt-3">
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">解析后命令预览</label>
                            <pre className="mt-1 h-16 w-full overflow-auto rounded-xl border border-violet-100 bg-white p-3 font-mono text-xs leading-5 text-slate-700 whitespace-pre-wrap break-words">{buildImageMockCommandPreview(selectedStep, selectedStepComponent, previewContext)}</pre>
                          </div>
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">命令结果断言（JSON，可选）</label>
                          <textarea
                            value={typeof selectedResultAssertions === 'string'
                              ? selectedResultAssertions
                              : selectedResultAssertions == null ? '' : JSON.stringify(selectedResultAssertions, null, 2)}
                            onChange={(event) => updateStep(selectedStep.id, { config: { ...selectedStep.config, resultAssertions: event.target.value } })}
                            className="mt-1 h-28 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs outline-none focus:border-blue-300"
                            placeholder={'{"source":"stdout","conditions":[{"path":"ok","equals":true}]}'}
                          />
                          <p className="mt-1 text-[10px] text-slate-500">留空不校验；全部条件满足才通过。字段缺失、类型不符或输出不是 JSON 都会失败。可用 message 填写该条件的失败说明。</p>
                        </div>

                        {(selectedStepComponent?.params || []).filter((param) => !imageMockReservedParamKeys.has(param.key)).map((param) => {
                          const value = selectedStep.inputs?.[param.key] ?? param.defaultValue ?? '';
                          const commonClass = "mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300";

                          return (
                            <div key={param.key}>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">{param.label || param.key}</label>
                              {param.inputType === 'textarea' || param.inputType === 'json' ? (
                                <textarea
                                  value={value}
                                  onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                  placeholder={param.placeholder}
                                  className={`${commonClass} h-24 resize-none py-2 font-mono leading-5`}
                                />
                              ) : (
                                <input
                                  type={param.inputType === 'number' ? 'number' : 'text'}
                                  value={value}
                                  onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                  placeholder={param.placeholder}
                                  className={`${commonClass} h-9`}
                                />
                              )}
                              {param.helperText && (
                                <div className="mt-1 text-[10px] leading-4 text-slate-400">{param.helperText}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : selectedStep.type === 'http_request' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3 py-3">
                          <div className="flex items-center gap-2 text-[11px] font-black text-sky-800">
                            <Globe2 className="h-4 w-4" />
                            在电脑侧请求接口，把响应写入 variables 给后续节点使用
                          </div>
                        </div>
                        <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Method</label>
                            <select
                              value={String(getStepConfigValue(selectedStep, 'method', 'GET'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'method', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-sky-300"
                            >
                              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((method) => (
                                <option key={method} value={method}>{method}</option>
                              ))}
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">URL</label>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'url', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'url', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-sky-300"
                              placeholder="https://example.com/api/movies"
                            />
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Headers JSON</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'headersText', '{\n  \"Accept\": \"application/json\"\n}'))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'headersText', event.target.value)}
                            className="mt-1 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-sky-300"
                            placeholder='{"Authorization":"Bearer ${variables.token}"}'
                          />
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Body</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'bodyText', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'bodyText', event.target.value)}
                            className="mt-1 h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-sky-300"
                            placeholder='POST/PUT/PATCH 时填写，例如 {"city":"杭州"}'
                          />
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">响应类型</label>
                            <select
                              value={String(getStepConfigValue(selectedStep, 'responseType', 'json'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'responseType', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-sky-300"
                            >
                              <option value="json">JSON</option>
                              <option value="text">文本</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">期望状态码</label>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'expectedStatus', '2xx'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'expectedStatus', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-sky-300"
                              placeholder="2xx"
                            />
                          </div>
                        </div>
                        <div className="rounded-2xl border border-amber-100 bg-amber-50/80 p-3">
                          <div className="text-[11px] font-black text-slate-900">失败判定</div>
                          <div className="mt-2">
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">业务错误路径</label>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'failOnBusinessErrorPath', '$.data.error'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'failOnBusinessErrorPath', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-amber-100 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-amber-300"
                              placeholder="$.data.error"
                            />
                            <div className="mt-1 text-[10px] font-bold leading-4 text-amber-700">
                              命中且值非空时节点失败；多个路径用逗号或换行分隔。
                            </div>
                          </div>
                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="flex min-h-10 items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 text-[10px] font-black text-slate-700">
                              <input
                                type="checkbox"
                                checked={getStepConfigValue(selectedStep, 'failOnMissingSavedVariable', true) !== false}
                                onChange={(event) => setStepConfigValue(selectedStep, 'failOnMissingSavedVariable', event.target.checked)}
                                className="h-3.5 w-3.5 accent-amber-500"
                              />
                              保存变量缺失时失败
                            </label>
                            <label className="flex min-h-10 items-center gap-2 rounded-xl border border-amber-100 bg-white px-3 text-[10px] font-black text-slate-700">
                              <input
                                type="checkbox"
                                checked={getStepConfigValue(selectedStep, 'failOnEmptySavedVariable', true) !== false}
                                onChange={(event) => setStepConfigValue(selectedStep, 'failOnEmptySavedVariable', event.target.checked)}
                                className="h-3.5 w-3.5 accent-amber-500"
                              />
                              保存变量为空时失败
                            </label>
                          </div>
                        </div>
                        <div className="rounded-2xl border border-sky-100 bg-sky-50/80 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-black text-slate-900">响应字段保存规则</div>
                              <div className="mt-1 text-[10px] font-bold leading-4 text-sky-700">
                                左边填 variables. 后面的变量名，右边填接口返回 JSON 里的字段路径。
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addHttpVariableMapping(selectedStep)}
                              className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-sky-600 px-2.5 text-[10px] font-black text-white hover:bg-sky-700"
                              title="新增变量"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              新增
                            </button>
                          </div>
                          <div className="mt-3 grid grid-cols-[minmax(0,1.18fr)_minmax(0,1.2fr)_32px] gap-2 px-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                            <div>变量名</div>
                            <div>返回字段</div>
                            <div />
                          </div>
                          <div className="mt-1 space-y-2">
                            {getHttpVariableMappings(selectedStep).map((mapping, mappingIndex) => (
                              <div key={`http-response-mapping-${mappingIndex}`} className="grid grid-cols-[minmax(0,1.18fr)_minmax(0,1.2fr)_32px] gap-2">
                                <div className="flex h-9 min-w-0 overflow-hidden rounded-xl border border-sky-100 bg-white focus-within:border-sky-300">
                                  <span className="flex shrink-0 items-center border-r border-sky-100 bg-sky-50/60 px-1.5 font-mono text-[9px] font-bold text-sky-500">variables.</span>
                                  <input
                                    value={mapping.variableName}
                                    onChange={(event) => updateHttpVariableMapping(selectedStep, mappingIndex, { variableName: event.target.value })}
                                    onFocus={(event) => {
                                      const input = event.currentTarget;
                                      window.requestAnimationFrame(() => {
                                        input.setSelectionRange(input.value.length, input.value.length);
                                      });
                                    }}
                                    className="min-w-0 flex-1 bg-white px-2 font-mono text-xs font-black text-slate-900 outline-none"
                                    placeholder="userId"
                                  />
                                </div>
                                <input
                                  value={mapping.responsePath}
                                  onChange={(event) => updateHttpVariableMapping(selectedStep, mappingIndex, { responsePath: event.target.value })}
                                  onFocus={(event) => {
                                    const input = event.currentTarget;
                                    window.requestAnimationFrame(() => {
                                      input.setSelectionRange(input.value.length, input.value.length);
                                    });
                                  }}
                                  className="h-9 min-w-0 rounded-xl border border-sky-100 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-sky-300"
                                  placeholder="userInfo.userId"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeHttpVariableMapping(selectedStep, mappingIndex)}
                                  className="flex h-9 w-8 items-center justify-center rounded-xl border border-rose-100 bg-white text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={getHttpVariableMappings(selectedStep).length <= 1}
                                  title="删除变量"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 rounded-xl border border-white bg-white/70 px-3 py-2 text-[10px] font-bold leading-4 text-slate-500">
                            例：接口返回 <span className="font-mono text-slate-700">{"{\"test\":true,\"userInfo\":{\"userId\":\"123\"}}"}</span>，返回字段填
                            <span className="font-mono text-slate-700"> userInfo.userId </span>
                            ，变量名填
                            <span className="font-mono text-slate-700"> userId </span>
                            ，后续节点使用 <span className="font-mono text-slate-700">${'{variables.userId}'}</span>。
                          </div>
                        </div>
                      </div>
                    ) : selectedStep.type === 'llm_text_generate' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-violet-100 bg-violet-50 px-3 py-3">
                          <div className="flex items-center gap-2 text-[11px] font-black text-violet-800">
                            <Bot className="h-4 w-4" />
                            运行时生成文本，并写入 variables 给后续节点使用
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">模型配置</label>
                          <select
                            value={String(getStepConfigValue(selectedStep, 'providerId', '')) || getLlmProviderForStep(selectedStep)?.id || ''}
                            onChange={(event) => {
                              setStepConfigValue(selectedStep, 'providerId', event.target.value);
                            }}
                            disabled={llmProviders.length === 0}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                          >
                            {llmProviders.length === 0 ? (
                              <option value="">设置中心未配置模型</option>
                            ) : llmProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>{provider.name || provider.model || provider.id}</option>
                            ))}
                          </select>
                          {llmProviders.length === 0 && (
                            <div className="mt-1 text-[10px] font-bold leading-4 text-rose-500">
                              执行时会失败并提示缺少模型配置，请先到设置中心添加模型。
                            </div>
                          )}
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Prompt</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'prompt', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'prompt', event.target.value)}
                            className="mt-1 h-36 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold leading-5 outline-none focus:border-violet-300"
                            placeholder="请生成一句自然的购票意图"
                          />
                          <div className="mt-2 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-bold leading-5 text-amber-700">
                            JSON 输出格式会根据下方变量保存规则自动追加到 Prompt 后面，不需要手写“请以 JSON 格式输出”。
                          </div>
                        </div>
                        <div className="grid grid-cols-3 gap-2">
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">输出</label>
                            <select
                              value={String(getStepConfigValue(selectedStep, 'outputMode', 'json'))}
                              onChange={(event) => {
                                const nextMode = event.target.value;
                                const currentMappings = getLlmVariableMappings(selectedStep);
                                setLlmVariableMappings(selectedStep, currentMappings.map((mapping) => {
                                  if (nextMode === 'text') {
                                    return { ...mapping, outputPath: 'text' };
                                  }

                                  return {
                                    ...mapping,
                                    outputPath: mapping.outputPath === 'text' ? mapping.variableName || DEFAULT_LLM_TEXT_VARIABLE_NAME : mapping.outputPath,
                                  };
                                }), nextMode);
                              }}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                            >
                              <option value="json">JSON</option>
                              <option value="text">纯文本</option>
                            </select>
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">temperature</label>
                            <input
                              type="number"
                              step="0.1"
                              value={String(getStepConfigValue(selectedStep, 'temperature', '0.2'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'temperature', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                            />
                          </div>
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">maxTokens</label>
                            <input
                              type="number"
                              value={String(getStepConfigValue(selectedStep, 'maxTokens', '4096'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'maxTokens', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-violet-300"
                            />
                          </div>
                        </div>
                        <div className="rounded-2xl border border-violet-100 bg-violet-50/80 p-3">
                          <div className="flex items-center justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-black text-slate-900">生成结果保存规则</div>
                              <div className="mt-1 text-[10px] font-bold leading-4 text-violet-700">
                                左边填 variables. 后面的变量名，中间填 LLM 返回 JSON 里的字段名，右边是模型失败时使用的默认值。
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() => addLlmVariableMapping(selectedStep)}
                              className="flex h-8 shrink-0 items-center gap-1 rounded-lg bg-violet-600 px-2.5 text-[10px] font-black text-white hover:bg-violet-700"
                              title="新增变量"
                            >
                              <Plus className="h-3.5 w-3.5" />
                              新增
                            </button>
                          </div>
                          <div className="mt-3 grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)_32px] gap-2 px-1 text-[10px] font-black uppercase tracking-wide text-slate-500">
                            <div>变量名</div>
                            <div>返回字段</div>
                            <div>失败默认值</div>
                            <div />
                          </div>
                          <div className="mt-1 space-y-2">
                            {getLlmVariableMappings(selectedStep).map((mapping, mappingIndex) => (
                              <div key={`llm-output-mapping-${mappingIndex}`} className="grid grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)_minmax(0,1fr)_32px] gap-2">
                                <div className="flex h-9 min-w-0 overflow-hidden rounded-xl border border-violet-100 bg-white focus-within:border-violet-300">
                                  <span className="flex shrink-0 items-center border-r border-violet-100 bg-violet-50/60 px-1.5 font-mono text-[9px] font-bold text-violet-500">variables.</span>
                                  <input
                                    value={mapping.variableName}
                                    onChange={(event) => updateLlmVariableMapping(selectedStep, mappingIndex, { variableName: event.target.value })}
                                    className="min-w-0 flex-1 bg-white px-2 font-mono text-xs font-black text-slate-900 outline-none"
                                    placeholder="voiceText"
                                  />
                                </div>
                                <input
                                  value={mapping.outputPath}
                                  onChange={(event) => updateLlmVariableMapping(selectedStep, mappingIndex, { outputPath: event.target.value })}
                                  className="h-9 min-w-0 rounded-xl border border-violet-100 bg-white px-3 font-mono text-xs font-bold outline-none focus:border-violet-300"
                                  placeholder="voiceText"
                                />
                                <input
                                  value={mapping.fallbackValue}
                                  onChange={(event) => updateLlmVariableMapping(selectedStep, mappingIndex, { fallbackValue: event.target.value })}
                                  className="h-9 min-w-0 rounded-xl border border-violet-100 bg-white px-3 text-xs font-bold outline-none focus:border-violet-300"
                                  placeholder="可选"
                                />
                                <button
                                  type="button"
                                  onClick={() => removeLlmVariableMapping(selectedStep, mappingIndex)}
                                  className="flex h-9 w-8 items-center justify-center rounded-xl border border-rose-100 bg-white text-rose-500 hover:bg-rose-50 disabled:cursor-not-allowed disabled:opacity-40"
                                  disabled={getLlmVariableMappings(selectedStep).length <= 1}
                                  title="删除变量"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </div>
                            ))}
                          </div>
                          <div className="mt-3 rounded-xl border border-white bg-white/70 px-3 py-2 text-[10px] font-bold leading-4 text-slate-500">
                            例：变量名填 <span className="font-mono text-slate-700">voiceText</span>，返回字段填 <span className="font-mono text-slate-700">voiceText</span> 后，系统会自动要求模型输出包含 <span className="font-mono text-slate-700">voiceText</span> 的 JSON，后续节点使用 <span className="font-mono text-slate-700">${'{variables.voiceText}'}</span>。
                          </div>
                        </div>
                      </div>
                    ) : selectedStep.type === 'tts_synthesize' ? (
                      <div className="space-y-3">
                        <div className="rounded-2xl border border-sky-100 bg-sky-50 px-3 py-3">
                          <div className="flex items-center gap-2 text-[11px] font-black text-sky-800">
                            <Globe2 className="h-4 w-4" />
	                            运行时调用设置中心的 HTTP TTS，把文本合成为本地音频
                          </div>
                        </div>
                        {isReportFlowReadOnly && getStepTtsArtifacts(selectedStep.id).length > 0 && (
                          <div className="rounded-xl border border-sky-100 bg-sky-50 px-3 py-2">
                            <div className="flex min-w-0 flex-col items-stretch gap-2">
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-wide text-sky-700">报告 TTS 音频</div>
                                <div className="mt-0.5 text-[10px] font-bold text-sky-600">
                                  本次执行合成出的真实音频，可直接播放或定位文件。
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void playAudioPreview(selectedStep.id)}
                                className="flex w-fit max-w-full items-center gap-1 rounded-lg border border-sky-200 bg-white px-2 py-1 text-[10px] font-bold text-sky-700 hover:bg-sky-100"
                              >
                                <Play className="h-3 w-3" />
                                播放音频
                              </button>
                            </div>
                            <div className="mt-2 space-y-2">
                              {getStepTtsArtifacts(selectedStep.id).map((artifact, index) => (
                                <div key={`${artifact.stepId || selectedStep.id}-${artifact.localPath || artifact.sha256 || index}`} className="rounded-lg border border-sky-100 bg-white px-2 py-2">
                                  <div className="flex min-w-0 flex-col items-stretch gap-2">
                                    <div className="line-clamp-2 min-w-0 break-all font-mono text-[10px] font-bold leading-4 text-sky-800" title={artifact.localPath || ''}>
                                      {artifact.localPath || '未记录本地音频'}
                                    </div>
                                    {artifact.localPath && (
                                      <div className="flex flex-wrap gap-2">
                                        <button
                                          type="button"
                                          onClick={() => void navigator.clipboard?.writeText(String(artifact.localPath || ''))}
                                          className="flex w-fit max-w-full items-center gap-1 rounded-md border border-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700 hover:bg-sky-50"
                                        >
                                          <Copy className="h-3 w-3" />
                                          复制路径
                                        </button>
                                        <button
                                          type="button"
                                          onClick={() => void openPathInFolder(artifact.localPath)}
                                          className="w-fit max-w-full rounded-md border border-sky-100 px-2 py-1 text-[10px] font-bold text-sky-700 hover:bg-sky-50"
                                        >
                                          定位
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  <div className="mt-1 break-all font-mono text-[10px] leading-4 text-sky-600">
                                    变量：{artifact.variable ? `variables.${artifact.variable}` : '-'}
                                  </div>
                                  {artifact.text && (
                                    <div className="mt-1 line-clamp-2 text-[10px] font-bold leading-4 text-sky-600">
                                      文本：{artifact.text}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        )}
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Text</label>
                          <textarea
                            value={String(getStepConfigValue(selectedStep, 'text', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'text', event.target.value)}
                            className="mt-1 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-indigo-300"
                            placeholder="${variables.voiceText}"
                          />
                        </div>
	                        <div className="rounded-2xl border border-emerald-100 bg-emerald-50/80 p-3">
                          <div className="text-[11px] font-black text-slate-900">标准输出</div>
                          <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold leading-5 text-emerald-700">
                            音频 Mock 的本地音频文件填写 <span className="font-mono text-slate-800">${'{variables.'}{normalizeTtsNodeVariableKey(selectedStep.name || selectedStep.id)}{'.audioPath}'}</span>
                            <br />
                            原始音频 URL 会写入 <span className="font-mono text-slate-800">${'{variables.'}{normalizeTtsNodeVariableKey(selectedStep.name || selectedStep.id)}{'.audioUrl}'}</span>
                          </div>
                        </div>
                      </div>
                    ) : selectedStepComponentKind === 'mobile_ui_action' || selectedStepComponentKind === 'mobile_ui_assert' ? (
                      <div className="space-y-3">
                        {String(getStepConfigValue(selectedStep, 'action', 'tap')) !== 'solopi_replay' && <>
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                          <div className="flex items-start gap-2 text-[11px] font-bold leading-5 text-slate-600">
                            <Smartphone className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                            从当前手机页面选择元素，执行时优先按 resource-id/text/content-desc 查找，找不到再用比例坐标兜底
                          </div>
                        </div>

                        <div className={selectedStepComponentKind === 'mobile_ui_action' ? 'grid grid-cols-3 gap-2' : 'grid grid-cols-2 gap-2'}>
                          {selectedStepComponentKind === 'mobile_ui_action' && (
                            <div>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">动作</label>
                              <select
                                value={String(getStepConfigValue(selectedStep, 'action', 'tap'))}
                                onChange={(event) => setStepConfigValue(selectedStep, 'action', event.target.value)}
                                className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-emerald-300"
                              >
                                <option value="tap">点击元素</option>
                                <option value="input">点击并输入</option>
                                <option value="swipe">屏幕滑动</option>
                                <option value="swipe_element">元素内滑动</option>
                                <option value="solopi_replay">SoloPi 原生回放</option>
                                <option value="back">返回</option>
                                <option value="home">主页</option>
                              </select>
                            </div>
                          )}
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">匹配模式</label>
                            <select
                              value={String(getStepConfigValue(selectedStep, 'matchMode', 'auto'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'matchMode', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-emerald-300"
                            >
                              <option value="auto">自动</option>
                              <option value="exact">精确</option>
                              <option value="contains">包含</option>
                              <option value="bounds">录制区域（严格匹配）</option>
                            </select>
                          </div>
                          {selectedStepComponentKind === 'mobile_ui_action' && <label className="flex items-center gap-2 text-xs text-slate-600"><input type="checkbox" checked={String(getStepConfigValue(selectedStep, 'allowCoordinateFallback', 'true')) !== 'false'} onChange={event => setStepConfigValue(selectedStep, 'allowCoordinateFallback', String(event.target.checked))} />未命中元素时允许坐标兜底（录制导入默认关闭）</label>}
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">轮询间隔(ms)</label>
                            <input
                              type="number"
                              min={120}
                              max={500}
                              value={String(getStepConfigValue(selectedStep, 'pollIntervalMs', '250'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'pollIntervalMs', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-emerald-300"
                            />
                          </div>
                        </div>
                        </>}

                        {selectedStepComponentKind === 'mobile_ui_assert' && (
                          <label className="flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                            <span>
                              检测时截取手机屏幕
                              <span className="mt-0.5 block text-[10px] font-bold text-slate-400">通过或失败都会保存当前手机画面</span>
                            </span>
                            <input
                              type="checkbox"
                              checked={String(getStepConfigValue(selectedStep, 'captureScreenshotOnPass', 'true')) !== 'false'}
                              onChange={(event) => setStepConfigValue(selectedStep, 'captureScreenshotOnPass', String(event.target.checked))}
                              className="h-4 w-4"
                            />
                          </label>
                        )}

                        {selectedStepComponentKind === 'mobile_ui_action'
                          && ['tap', 'input'].includes(String(getStepConfigValue(selectedStep, 'action', 'tap'))) && (
                          <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5">
                            <div className="min-w-0">
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">元素内点击位置</label>
                              <select
                                value={normalizeMobileUiTapPosition(getStepConfigValue(selectedStep, 'tapPosition', 'center'))}
                                onChange={(event) => setMobileUiTapPosition(selectedStep, event.target.value)}
                                className="mt-1 h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold outline-none focus:border-emerald-300"
                              >
                                <option value="center">中间</option>
                                <option value="relative">元素内相对位置（录制）</option>
                                <option value="top-left">左上角</option>
                                <option value="top-right">右上角</option>
                                <option value="bottom-left">左下角</option>
                                <option value="bottom-right">右下角</option>
                              </select>
                            </div>
                            {getStepConfigValue(selectedStep, 'tapPosition', 'center') === 'relative' && <div className="mt-2 grid grid-cols-2 gap-2">
                              {(['X', 'Y'] as const).map(axis => <label key={axis} className="text-xs text-slate-500">{axis === 'X' ? '横向比例' : '纵向比例'}（0–1）<input type="number" min="0" max="1" step="0.01" value={String(getStepConfigValue(selectedStep, `tapRatio${axis}`, '0.5'))} onChange={event => setStepConfigValue(selectedStep, `tapRatio${axis}`, event.target.value)} className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-white px-3 text-xs text-slate-900" /></label>)}
                            </div>}
                            <div className="mt-2 grid min-w-0 grid-cols-2 gap-2">
                              <div className="min-w-0">
                                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">横向内缩(px)</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={String(getStepConfigValue(selectedStep, 'tapInsetXPx', getStepConfigValue(selectedStep, 'tapInsetPx', '5')))}
                                  onChange={(event) => {
                                    if (event.target.value === '') {
                                      setStepConfigValue(selectedStep, 'tapInsetXPx', '');
                                      return;
                                    }
                                    setMobileUiTapInset(selectedStep, 'x', event.target.value);
                                  }}
                                  onBlur={(event) => {
                                    if (event.target.value === '') setMobileUiTapInset(selectedStep, 'x', '5');
                                  }}
                                  className="mt-1 h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-emerald-300"
                                  title="四角点击时，沿横向从元素边缘向内偏移的像素数"
                                />
                              </div>
                              <div className="min-w-0">
                                <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">纵向内缩(px)</label>
                                <input
                                  type="number"
                                  min={0}
                                  step={1}
                                  value={String(getStepConfigValue(selectedStep, 'tapInsetYPx', getStepConfigValue(selectedStep, 'tapInsetPx', '5')))}
                                  onChange={(event) => {
                                    if (event.target.value === '') {
                                      setStepConfigValue(selectedStep, 'tapInsetYPx', '');
                                      return;
                                    }
                                    setMobileUiTapInset(selectedStep, 'y', event.target.value);
                                  }}
                                  onBlur={(event) => {
                                    if (event.target.value === '') setMobileUiTapInset(selectedStep, 'y', '5');
                                  }}
                                  className="mt-1 h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-white px-2 text-xs font-bold outline-none focus:border-emerald-300"
                                  title="四角点击时，沿纵向从元素边缘向内偏移的像素数"
                                />
                              </div>
                            </div>
                            <div className="mt-1 text-[10px] font-bold leading-4 text-slate-400">
                              横向和纵向分别向内偏移，默认均为 5px；中间位置不使用内缩。截图准星会同步显示最终点击点。
                            </div>
                          </div>
                        )}

                        {selectedStepComponentKind === 'mobile_ui_action' && String(getStepConfigValue(selectedStep, 'action', 'tap')) === 'input' && (
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">输入文本</label>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'inputText', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'inputText', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-emerald-300"
                              placeholder="英文/数字最稳定，中文建议后续接剪贴板或 IME 输入"
                            />
                            <label className="mt-2 flex items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold text-slate-600">
                              输入前尝试清空
                              <input
                                type="checkbox"
                                checked={String(getStepConfigValue(selectedStep, 'clearBeforeInput', false)) === 'true'}
                                onChange={(event) => setStepConfigValue(selectedStep, 'clearBeforeInput', event.target.checked)}
                                className="h-4 w-4"
                              />
                            </label>
                          </div>
                        )}

                        {selectedStepComponentKind === 'mobile_ui_action' && String(getStepConfigValue(selectedStep, 'action', 'tap')) === 'solopi_replay' && (
                          <SoloPiNativeEditor value={String(getStepConfigValue(selectedStep, 'nativeCase', '{}'))} inputs={selectedStep.inputs || {}} onChange={value => updateStepInput(selectedStep.id, 'nativeCase', value)} onInputChange={(key, value) => updateStepInput(selectedStep.id, key, value)} restartApp={String(getStepConfigValue(selectedStep, 'restartApp', 'true'))} timeout={String(getStepConfigValue(selectedStep, 'runTimeoutMs', '600000'))} onRestartChange={value => updateStepInput(selectedStep.id, 'restartApp', value)} onTimeoutChange={value => updateStepInput(selectedStep.id, 'runTimeoutMs', value)} />
                        )}

                        {selectedStepComponentKind === 'mobile_ui_action' && String(getStepConfigValue(selectedStep, 'action', 'tap')) === 'swipe_element' && (
                          <div className="grid grid-cols-3 gap-2">
                            <label className="text-xs text-slate-500">手指方向
                              <select value={String(getStepConfigValue(selectedStep, 'direction', 'up'))} onChange={e => setStepConfigValue(selectedStep, 'direction', e.target.value)} className="mt-1 w-full rounded-lg border p-2">
                                <option value="up">向上</option><option value="down">向下</option><option value="left">向左</option><option value="right">向右</option>
                              </select>
                            </label>
                            <label className="text-xs text-slate-500">元素距离(%)<input type="number" min="1" max="10000" value={String(getStepConfigValue(selectedStep, 'distancePercent', '100'))} onChange={e => setStepConfigValue(selectedStep, 'distancePercent', e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
                            <label className="text-xs text-slate-500">时长(ms)<input type="number" min="1" max="10000" value={String(getStepConfigValue(selectedStep, 'swipeDurationMs', '300'))} onChange={e => setStepConfigValue(selectedStep, 'swipeDurationMs', e.target.value)} className="mt-1 w-full rounded-lg border p-2" /></label>
                          </div>
                        )}

                        {selectedStepComponentKind === 'mobile_ui_action' && String(getStepConfigValue(selectedStep, 'action', 'tap')) === 'swipe' && (
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">滑动参数</label>
                            <textarea
                              value={String(getStepConfigValue(selectedStep, 'swipe', '{\n  "startXRatio": "0.5",\n  "startYRatio": "0.8",\n  "endXRatio": "0.5",\n  "endYRatio": "0.2",\n  "durationMs": "400"\n}'))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'swipe', event.target.value)}
                              className="mt-1 h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs font-bold leading-5 outline-none focus:border-emerald-300"
                            />
                          </div>
                        )}

                        {!['back', 'home', 'swipe', 'solopi_replay'].includes(String(getStepConfigValue(selectedStep, 'action', 'tap'))) && (
                          <>
                            <div className="min-w-0 rounded-2xl border border-slate-200 bg-slate-50/80 p-3">
                              <div className="mb-3 flex min-w-0 items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[10px] font-black text-white">1</span>
                                    <div className="text-[11px] font-black text-slate-900">从手机页面选择</div>
                                  </div>
                                  <div className="mt-1 pl-7 text-[10px] font-bold leading-4 text-slate-400">
                                    {mobileUiInspector.elements.length > 0
                                      ? `已识别 ${mobileUiInspector.elements.length} 个元素，点击蓝框或下方列表完成选择`
                                      : mobileUiInspector.error || '先读取当前手机页面，再选择需要操作的元素'}
                                  </div>
                                </div>
                                <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void refreshMobileUiInspector(selectedStep)}
                                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 text-[10px] font-black text-slate-700 shadow-sm transition-colors hover:border-emerald-200 hover:bg-emerald-50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                                    disabled={mobileUiInspector.loading || mobileUiDebug.status === 'running'}
                                  >
                                    {mobileUiInspector.loading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RefreshCw className="h-3.5 w-3.5" />}
                                    {mobileUiInspector.loading ? '读取中' : '刷新'}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void debugMobileUiStep(selectedStep)}
                                    className="flex h-8 shrink-0 items-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-[10px] font-black text-white shadow-sm transition-colors hover:bg-emerald-700 active:translate-y-px disabled:cursor-not-allowed disabled:bg-slate-200 disabled:text-slate-400"
                                    disabled={!hasConfiguredMobileUiTarget || mobileUiInspector.loading || mobileUiDebug.status === 'running'}
                                    title={hasConfiguredMobileUiTarget ? '只执行当前节点，不运行整个工作流' : '请先选择一个手机页面元素'}
                                  >
                                    {mobileUiDebug.status === 'running' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Play className="h-3.5 w-3.5" />}
                                    {mobileUiDebug.status === 'running'
                                      ? '调试中'
                                      : selectedStepComponentKind === 'mobile_ui_assert'
                                        ? '校验一次'
                                        : '执行一次'}
                                  </button>
                                </div>
                              </div>
                              {mobileUiInspector.error && (
                                <div className="mb-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-[11px] font-bold leading-5 text-rose-600">
                                  {mobileUiInspector.error}
                                </div>
                              )}
                              {mobileUiDebug.stepId === selectedStep.id && mobileUiDebug.status !== 'idle' && (
                                <div className={`mb-2 rounded-xl border px-3 py-2 text-[11px] font-bold leading-5 ${
                                  mobileUiDebug.status === 'error'
                                    ? 'border-rose-100 bg-rose-50 text-rose-700'
                                    : mobileUiDebug.status === 'success'
                                      ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                                      : 'border-blue-100 bg-blue-50 text-blue-700'
                                }`}>
                                  <div className="font-black">{mobileUiDebug.message}</div>
                                  {mobileUiDebug.errorCode && <div className="mt-1 font-mono text-[10px]">{mobileUiDebug.errorCode}</div>}
                                  {(mobileUiDebug.stdout || mobileUiDebug.stderr) && (
                                    <pre className="mt-1 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-4">
                                      {[mobileUiDebug.stdout, mobileUiDebug.stderr].filter(Boolean).join('\n')}
                                    </pre>
                                  )}
                                  {(mobileUiDebug.recoveryActions || []).map((action) => (
                                    <div key={action} className="mt-1 text-[10px]">处理建议：{action}</div>
                                  ))}
                                </div>
                              )}
                              {mobileUiInspector.screenshotDataUrl ? (
                                <div className="relative overflow-hidden rounded-xl border border-slate-200 bg-white">
                                  <img
                                    src={mobileUiInspector.screenshotDataUrl}
                                    alt="手机页面截图"
                                    className="block w-full select-none"
                                    draggable={false}
                                  />
                                  {(mobileUiInspector.elements || []).map((element) => {
                                    const screenWidth = Number(mobileUiInspector.screenshot?.width || mobileUiInspector.screen?.width || 0);
                                    const screenHeight = Number(mobileUiInspector.screenshot?.height || mobileUiInspector.screen?.height || 0);
                                    const overlayRect = element.screenshotRect || element.rect;
                                    if (!screenWidth || !screenHeight || !overlayRect) {
                                      return null;
                                    }
                                    const isSelected = mobileUiInspector.selectedElementId === element.id;
                                    const hasLabel = Boolean(element.text || element.contentDesc || element.resourceId);
                                    const screenArea = Math.max(1, screenWidth * screenHeight);
                                    const elementAreaRatio = Math.min(1, Math.max(0, (overlayRect.width * overlayRect.height) / screenArea));
                                    const interactionZIndex = Math.max(1, Math.round((1 - elementAreaRatio) * 1000));
                                    return (
                                      <button
                                        key={element.id}
                                        type="button"
                                        onClick={() => applyMobileUiElementToStep(selectedStep, element)}
                                        className={`absolute border text-left transition-all ${
                                          isSelected
                                            ? 'pointer-events-none border-emerald-500 bg-transparent shadow-[0_0_0_2px_rgba(16,185,129,0.35)]'
                                            : hasLabel
                                              ? 'border-blue-400/70 bg-transparent hover:bg-blue-400/15'
                                              : 'border-slate-400/25 bg-transparent hover:bg-slate-400/10'
                                        }`}
                                        style={{
                                          left: `${(overlayRect.left / screenWidth) * 100}%`,
                                          top: `${(overlayRect.top / screenHeight) * 100}%`,
                                          width: `${Math.max(0.8, (overlayRect.width / screenWidth) * 100)}%`,
                                          height: `${Math.max(0.8, (overlayRect.height / screenHeight) * 100)}%`,
                                          zIndex: isSelected ? 1001 : interactionZIndex,
                                        }}
                                        title={`${getMobileUiElementLabel(element)}\n${element.bounds || ''}`}
                                      />
                                    );
                                  })}
                                  {mobileUiClickPreview && (() => {
                                    const screenshotWidth = Number(mobileUiInspector.screenshot?.width || mobileUiInspector.screen?.width || 0);
                                    const screenshotHeight = Number(mobileUiInspector.screenshot?.height || mobileUiInspector.screen?.height || 0);
                                    if (!screenshotWidth || !screenshotHeight) return null;
                                    const left = Math.min(100, Math.max(0, (mobileUiClickPreview.screenshotX / screenshotWidth) * 100));
                                    const top = Math.min(100, Math.max(0, (mobileUiClickPreview.screenshotY / screenshotHeight) * 100));
                                    const isFallback = mobileUiClickPreview.source === 'coordinate-fallback';
                                    return (
                                      <div
                                        className={`pointer-events-none absolute h-6 w-6 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 bg-white/90 shadow-md ${
                                          isFallback ? 'border-amber-500 text-amber-600' : 'border-rose-500 text-rose-600'
                                        }`}
                                        style={{ left: `${left}%`, top: `${top}%`, zIndex: 1100 }}
                                        title={`实际点击点 ${formatMobileUiCoordinate(mobileUiClickPreview.x)},${formatMobileUiCoordinate(mobileUiClickPreview.y)}`}
                                        aria-label={`实际点击点 ${formatMobileUiCoordinate(mobileUiClickPreview.x)},${formatMobileUiCoordinate(mobileUiClickPreview.y)}`}
                                      >
                                        <span className="absolute left-1/2 top-[-6px] h-8 w-px -translate-x-1/2 bg-current" />
                                        <span className="absolute left-[-6px] top-1/2 h-px w-8 -translate-y-1/2 bg-current" />
                                        <span className="absolute left-1/2 top-1/2 h-1.5 w-1.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-current" />
                                      </div>
                                    );
                                  })()}
                                </div>
                              ) : (
                                <div className="flex h-44 items-center justify-center rounded-xl border border-dashed border-slate-200 bg-white text-xs font-bold text-slate-400">
                                  {mobileUiInspector.loading ? '正在读取手机页面...' : '暂无截图'}
                                </div>
                              )}
                              {mobileUiClickPreview && (
                                <div className={`mt-2 rounded-xl border px-3 py-2 text-[10px] font-bold leading-4 ${
                                  mobileUiClickPreview.source === 'coordinate-fallback'
                                    ? 'border-amber-200 bg-amber-50 text-amber-800'
                                    : 'border-rose-200 bg-rose-50 text-rose-700'
                                }`}>
                                  <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-3 gap-y-1">
                                    <span className="font-black">截图准星就是 ADB 实际点击点</span>
                                    <span className="font-mono">
                                      {formatMobileUiCoordinate(mobileUiClickPreview.x)},{formatMobileUiCoordinate(mobileUiClickPreview.y)}
                                    </span>
                                  </div>
                                  <div className="mt-1">
                                    {mobileUiClickPreview.source === 'element-anchor'
                                      ? `来源：命中元素的${mobileUiTapPositionLabels[normalizeMobileUiTapPosition(mobileUiClickPreview.tapPosition)]}${normalizeMobileUiTapPosition(mobileUiClickPreview.tapPosition) === 'center' ? '' : `，横向内缩 ${normalizeMobileUiTapInset(mobileUiClickPreview.tapInsetXPx, 5)}px、纵向内缩 ${normalizeMobileUiTapInset(mobileUiClickPreview.tapInsetYPx, 5)}px`}`
                                      : '来源：元素未命中，使用已保存的比例或边界坐标'}
                                  </div>
                                  {nestedMobileUiTargets.length >= 2 && mobileUiClickPreview.source === 'element-anchor' && (
                                    <div className="mt-1 font-black">
                                      当前框同时覆盖多个候选元素；如果点击仍无响应，请改选更小的按钮元素或切换元素内点击位置。
                                    </div>
                                  )}
                                </div>
                              )}

                              {mobileUiInspector.elements.length > 0 && (
                                <div className="mt-3 max-h-48 space-y-1 overflow-y-auto pr-0.5">
                                  {mobileUiInspector.elements
                                    .filter((element) => element.text || element.contentDesc || element.resourceId || element.clickable)
                                    .slice(0, 80)
                                    .map((element) => (
                                      <button
                                        key={`list-${element.id}`}
                                        type="button"
                                        onClick={() => applyMobileUiElementToStep(selectedStep, element)}
                                        className={`w-full rounded-lg border px-2 py-1.5 text-left text-[11px] font-bold leading-4 ${
                                          mobileUiInspector.selectedElementId === element.id
                                            ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                                            : 'border-slate-200 bg-white text-slate-600 hover:border-emerald-100 hover:bg-emerald-50/70'
                                        }`}
                                      >
                                        <div className="truncate text-slate-900">{getMobileUiElementLabel(element)}</div>
                                        <div className="mt-0.5 truncate font-mono text-[10px] text-slate-400">
                                          {element.resourceId || element.className || '-'} · {element.bounds}
                                        </div>
                                      </button>
                                    ))}
                                </div>
                              )}
                              {nestedMobileUiTargets.length >= 2 && (
                                <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-[10px] font-bold leading-4 text-amber-800">
                                  当前选择覆盖了 {nestedMobileUiTargets.length} 个更小的可识别元素，可能选中了父容器。建议点具体按钮文字，再点击“执行一次”验证目标。
                                </div>
                              )}
                            </div>

                            <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3">
                              <div className="mb-3 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-emerald-600 text-[10px] font-black text-white">2</span>
                                  <div className="text-[11px] font-black text-slate-900">已选元素</div>
                                  <div className="ml-auto flex items-center gap-1.5">
                                    <span className={`rounded-full px-2 py-0.5 text-[9px] font-black ${
                                      mobileUiInspector.selectedElementId || Object.values(getMobileUiSelector(selectedStep)).some(Boolean)
                                        ? 'bg-emerald-50 text-emerald-700'
                                        : 'bg-slate-100 text-slate-400'
                                    }`}>
                                      {mobileUiInspector.selectedElementId || Object.values(getMobileUiSelector(selectedStep)).some(Boolean) ? '已配置' : '待选择'}
                                    </span>
                                    {(mobileUiInspector.selectedElementId || Object.values(getMobileUiSelector(selectedStep)).some(Boolean)) && (
                                      <button
                                        type="button"
                                        onClick={() => clearMobileUiElementFromStep(selectedStep)}
                                        className="rounded-md px-1.5 py-0.5 text-[9px] font-black text-slate-400 hover:bg-slate-100 hover:text-rose-600"
                                      >
                                        清除
                                      </button>
                                    )}
                                  </div>
                                </div>
                                <div className="mt-1 pl-7 text-[10px] font-bold leading-4 text-slate-400">
                                  选择后会自动生成定位信息，也可以在这里手动微调
                                </div>
                              </div>

                              <div className="space-y-2.5">
                                {[
                                  ['resourceId', '资源 ID', 'resource-id'],
                                  ['text', '文本', 'text'],
                                  ['contentDesc', '内容描述', 'content-desc'],
                                  ['className', '控件类型', 'class'],
                                  ['bounds', '元素范围', 'bounds'],
                                ].map(([key, label, technicalLabel]) => (
                                  <div key={key} className="min-w-0">
                                    <label className="flex min-w-0 items-baseline justify-between gap-2 text-[10px] font-black text-slate-600">
                                      <span>{label}</span>
                                      <span className="truncate font-mono text-[9px] font-bold text-slate-400">{technicalLabel}</span>
                                    </label>
                                    <input
                                      value={getMobileUiSelector(selectedStep)[key as keyof ReturnType<typeof getMobileUiSelector>]}
                                      onChange={(event) => setMobileUiSelectorValue(selectedStep, key, event.target.value)}
                                      className="mt-1 h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-[11px] font-bold text-slate-800 outline-none transition-colors placeholder:text-slate-300 focus:border-emerald-300 focus:bg-white"
                                      placeholder="未设置"
                                    />
                                  </div>
                                ))}

                                <div className="grid min-w-0 grid-cols-1 gap-2">
                                  {[
                                    ['xRatio', '横向比例', 'xRatio'],
                                    ['yRatio', '纵向比例', 'yRatio'],
                                  ].map(([key, label, technicalLabel]) => (
                                    <div key={key} className="min-w-0">
                                      <label className="block min-w-0 text-[10px] font-black text-slate-600">
                                        <span className="block">{label}</span>
                                        <span className="mt-0.5 block truncate font-mono text-[9px] font-bold text-slate-400">{technicalLabel}</span>
                                      </label>
                                      <input
                                        value={getMobileUiSelector(selectedStep)[key as keyof ReturnType<typeof getMobileUiSelector>]}
                                        onChange={(event) => setMobileUiSelectorValue(selectedStep, key, event.target.value)}
                                        className="mt-1 h-9 w-full min-w-0 rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-[11px] font-bold text-slate-800 outline-none transition-colors placeholder:text-slate-300 focus:border-emerald-300 focus:bg-white"
                                        placeholder="未设置"
                                      />
                                    </div>
                                  ))}
                                </div>
                                {Object.values(getMobileUiSelector(selectedStep)).some(Boolean)
                                  && !getMobileUiSelector(selectedStep).bounds
                                  && !getMobileUiSelector(selectedStep).xRatio
                                  && !getMobileUiSelector(selectedStep).yRatio && (
                                  <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[10px] font-bold leading-4 text-blue-700">
                                    已手工修改定位条件。当前不会再使用原截图坐标兜底；如果页面没有对应的独立元素，“执行一次”会明确提示未找到。
                                  </div>
                                )}
                              </div>
                            </div>
                          </>
                        )}
                      </div>
                    ) : selectedStep.type === 'send_audio' || selectedStepComponentKind === 'audio' ? (
                      <div className="space-y-3">
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">音频来源</label>
                          <select
                            value={String(getStepConfigValue(selectedStep, 'sourceType', 'file'))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'sourceType', event.target.value)}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                          >
                            <option value="file">本地音频文件</option>
                            <option value="record">电脑录制音频</option>
                            <option value="tts">文本 TTS</option>
                          </select>
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">最终音频格式</label>
                          <select
                            value={String(getStepConfigValue(selectedStep, 'outputFormat', 'pcm'))}
                            onChange={(event) => {
                              const outputFormat = event.target.value;
                              setStepConfigValue(selectedStep, 'outputFormat', outputFormat);
                            }}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                          >
                            <option value="pcm">PCM</option>
                            <option value="wav">WAV</option>
                            <option value="ogg">OGG (Opus)</option>
                            <option value="speex">Speex (Ogg / .spx)</option>
                          </select>
                          <div className="mt-1 text-[10px] leading-4 text-slate-400">
                            PCM 是无文件头的原始采样；默认 S16 对应 pcm-s16le，其他 sampleFormat 不一定是 16-bit。编码、采样率和声道需与接收端一致。Speex 使用 Ogg 容器，支持 8/16/32kHz；已有 Speex 文件直传时请将尾部静音设为 0。
                          </div>
                        </div>

                        <div className="rounded-xl border border-blue-100 bg-blue-50 px-3 py-3">
                          <div className="text-[10px] font-black uppercase tracking-wide text-blue-700">电脑录音转码参数</div>
                          <div className="mt-2 grid grid-cols-1 gap-3 min-w-0">
                            {([
                              ['sampleFormat', '采样编码 · sampleFormat'],
                              ['sampleRate', '采样率（Hz）· sampleRate'],
                              ['channelCnt', '声道数 · channelCnt'],
                              ['trailingSilenceMs', '尾部静音（ms）'],
                            ] as const).map(([key, label]) => (
                              <AudioParameterField key={key} label={label}
                                value={String(getStepConfigValue(selectedStep, key, defaultAudioTranscodeParams[key]))}
                                onChange={(value) => setStepConfigValue(selectedStep, key, value)}
                                context={{ variables: selectedCase.variables || {}, defaults: previewContext }}
                                options={key === 'sampleFormat' ? avSampleFormats : undefined} />
                            ))}
                          </div>
                          <div className="mt-2 text-[10px] font-bold leading-4 text-blue-600">
                            支持数值和变量表达式；预览不覆盖原始配置。codeFmt 由最终音频格式决定。尾部静音会写入实际音频文件，采样率和声道需与接收端一致。
                          </div>
                        </div>

                        {getStepConfigValue(selectedStep, 'sourceType', 'file') === 'tts' ? (
                          <div>
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">TTS 文本</label>
                            <textarea
                              value={String(getStepConfigValue(selectedStep, 'ttsText', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'ttsText', event.target.value)}
                              className="mt-1 h-20 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-bold leading-5 outline-none focus:border-blue-300"
                              placeholder="执行时会通过设置中心的 HTTP TTS 生成音频"
                            />
                            <div className="mt-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-2 text-[11px] font-bold leading-5 text-emerald-700">
                              执行时会读取设置中心的 HTTP TTS 配置，合成音频后复用当前 push 与触发命令。
                            </div>
                          </div>
                        ) : (
                          <div>
                            <div className="flex items-center justify-between">
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">本地音频文件</label>
                              <div className="flex flex-wrap items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => void toggleAudioRecording(selectedStep.id)}
                                  className={`flex items-center gap-1 rounded-lg px-2 py-1 text-[10px] font-bold ${
                                    recordingState?.stepId === selectedStep.id
                                      ? 'border border-rose-100 bg-rose-50 text-rose-600 hover:bg-rose-100'
                                      : 'border border-slate-200 text-slate-500 hover:bg-slate-50'
                                  }`}
                                >
                                  {recordingState?.stepId === selectedStep.id ? (
                                    <Square className="h-3 w-3 fill-current" />
                                  ) : (
                                    <Mic className="h-3 w-3" />
                                  )}
                                  {recordingState?.stepId === selectedStep.id ? '结束录音' : '电脑录音'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void playAudioPreview(selectedStep.id)}
                                  disabled={!recordingPreviewUrls[selectedStep.id] && !getAudioPreviewSourcePath(selectedStep.id)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-40"
                                >
                                  播放音频
                                </button>
                                <button
                                  type="button"
                                  onClick={() => void selectAudioFileForStep(selectedStep.id)}
                                  className="rounded-lg border border-slate-200 px-2 py-1 text-[10px] font-bold text-slate-500 hover:bg-slate-50"
                                >
                                  选择文件
                                </button>
                              </div>
                            </div>
                            <input
                              value={String(getStepConfigValue(selectedStep, 'localPath', ''))}
                              onChange={(event) => setStepConfigValue(selectedStep, 'localPath', event.target.value)}
                              className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                              placeholder="/path/to/confirm_pay.pcm"
                            />
                            {getStepConfigValue(selectedStep, 'sourceType', 'file') === 'record' && (
                              <div className="mt-2 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-[11px] font-bold leading-5 text-blue-700">
                                再次点击电脑录音会重新录入，并覆盖当前节点上一次录音文件。
                              </div>
                            )}
                          </div>
                        )}

                        {getStepAudioArtifacts(selectedStep.id).length > 0 && (
                          <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2">
                            <div className="flex min-w-0 flex-col items-stretch gap-2">
                              <div>
                                <div className="text-[10px] font-black uppercase tracking-wide text-amber-700">报告音频文件</div>
                                <div className="mt-0.5 text-[10px] font-bold text-amber-600">
                                  本次执行真实 push 的音频，可直接播放或定位文件。
                                </div>
                              </div>
                              <button
                                type="button"
                                onClick={() => void playAudioPreview(selectedStep.id)}
                                className="flex w-fit max-w-full items-center gap-1 rounded-lg border border-amber-200 bg-white px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-100"
                              >
                                <Play className="h-3 w-3" />
                                播放
                              </button>
                            </div>
                            <div className="mt-2 space-y-2">
                              {getStepAudioArtifacts(selectedStep.id).map((artifact, index) => {
                                const cleanup = runArtifacts?.cleanup?.find((item) => item.remotePath === artifact.remotePath && item.serial === artifact.serial);
                                return (
                                  <div key={`${artifact.stepId || selectedStep.id}-${artifact.localPath || artifact.remotePath}-${index}`} className="rounded-lg border border-amber-100 bg-white px-2 py-2">
                                    <div className="flex min-w-0 flex-col items-stretch gap-2">
                                      <div className="line-clamp-2 min-w-0 break-all font-mono text-[10px] font-bold leading-4 text-amber-800" title={artifact.localPath || artifact.pushedLocalPath || ''}>
                                        {artifact.localPath || artifact.pushedLocalPath || '未记录本地文件'}
                                      </div>
                                      {(artifact.localPath || artifact.pushedLocalPath) && (
                                        <div className="flex flex-wrap gap-2">
                                          <button
                                            type="button"
                                            onClick={() => void navigator.clipboard?.writeText(String(artifact.localPath || artifact.pushedLocalPath || ''))}
                                            className="flex w-fit max-w-full items-center gap-1 rounded-md border border-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-50"
                                          >
                                            <Copy className="h-3 w-3" />
                                            复制路径
                                          </button>
                                          <button
                                            type="button"
                                            onClick={() => void openPathInFolder(artifact.localPath || artifact.pushedLocalPath)}
                                            className="w-fit max-w-full rounded-md border border-amber-100 px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-50"
                                          >
                                            定位
                                          </button>
                                        </div>
                                      )}
                                    </div>
                                    <div
                                      className="mt-1 line-clamp-2 break-all font-mono text-[10px] leading-4 text-amber-600"
                                      title={artifact.remotePath || ''}
                                    >
                                      设备路径：{artifact.remotePath || '-'}
                                    </div>
                                    {artifact.remotePath && (
                                      <button
                                        type="button"
                                        onClick={() => void navigator.clipboard?.writeText(artifact.remotePath)}
                                        className="mt-2 flex w-fit max-w-full items-center gap-1 rounded-md border border-amber-100 bg-white px-2 py-1 text-[10px] font-bold text-amber-700 hover:bg-amber-50"
                                      >
                                        <Copy className="h-3 w-3" />
                                        复制设备路径
                                      </button>
                                    )}
                                    {cleanup && (
                                      <div className="mt-1 font-mono text-[10px] leading-4 text-amber-600">
                                        清理状态：{cleanup.success ? '已清理设备侧文件' : cleanup.skipped ? '设备侧文件已保留' : `清理失败 ${cleanup.error || ''}`}
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">音频 push 文件夹</label>
                          <label className="mt-2 flex items-center gap-2 text-xs font-bold">
                            <input type="checkbox" checked={String(getStepConfigValue(selectedStep, 'pushEnabled', selectedStep.device === 'pc' ? 'false' : 'true')) === 'true'} onChange={(event) => setStepConfigValue(selectedStep, 'pushEnabled', String(event.target.checked))} />
                            启用 ADB push
                          </label>
                          {selectedStep.device === 'pc' && String(getStepConfigValue(selectedStep, 'pushEnabled', 'false')) === 'true' && <select aria-label="音频 push 目标设备" value={String(getStepConfigValue(selectedStep, 'pushDevice', 'phone'))} onChange={(event) => setStepConfigValue(selectedStep, 'pushDevice', event.target.value)}><option value="phone">手机</option><option value="glasses">眼镜</option></select>}
                          <input
                            disabled={String(getStepConfigValue(selectedStep, 'pushEnabled', selectedStep.device === 'pc' ? 'false' : 'true')) !== 'true'}
                            value={String(getStepConfigValue(selectedStep, 'remotePath', ''))}
                            onChange={(event) => setStepConfigValue(selectedStep, 'remotePath', event.target.value)}
                            className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 font-mono text-xs font-bold outline-none focus:border-blue-300"
                            placeholder={createDefaultAudioRemoteDir()}
                          />
                        </div>

                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">{selectedStep.device === 'pc' ? 'PC 执行命令' : 'ADB 触发命令'}</label>
                          <textarea
                            value={String(selectedStepComponent?.commandTemplate ?? getStepConfigValue(selectedStep, 'commandTemplate', ''))}
                            onChange={(event) => {
                              const commandTemplate = event.target.value;
                              if (selectedStepComponent) {
                                updateSelectedCaseComponent((component) => ({ ...component, commandTemplate }));
                                return;
                              }

                              setStepConfigValue(selectedStep, 'commandTemplate', commandTemplate);
                            }}
                            className="mt-1 h-24 w-full resize-none rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                            placeholder='adb -s {{serial}} shell am broadcast -a ... --es audio_path "{{remotePath}}"'
                          />
                          <div className="mt-1 text-[10px] leading-4 text-slate-400">
                            {'{{localPath}}'} 为处理后的本地音频；{'{{defaults.adbPath}}'} 为 solopi-desktop 当前 ADB 路径。禁用 push 后远端路径为空。PC 命令直接执行程序及参数，不自动套 shell。
                          </div>
                        </div>

                        {(selectedStepComponent?.params || []).filter((param) => !audioReservedParamKeys.has(param.key)).map((param) => {
                          const value = selectedStep.inputs?.[param.key] ?? param.defaultValue ?? '';
                          const commonClass = "mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300";

                          return (
                            <div key={param.key}>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">{param.label || param.key}</label>
                              {param.inputType === 'textarea' || param.inputType === 'json' ? (
                                <textarea
                                  value={value}
                                  onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                  placeholder={param.placeholder}
                                  className={`${commonClass} h-24 resize-none py-2 font-mono leading-5`}
                                />
                              ) : (
                                <input
                                  type={param.inputType === 'number' ? 'number' : 'text'}
                                  value={value}
                                  onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                  placeholder={param.placeholder}
                                  className={`${commonClass} h-9`}
                                />
                              )}
                              {param.helperText && (
                                <div className="mt-1 text-[10px] leading-4 text-slate-400">{param.helperText}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : (selectedStepComponentKind === 'adb' || selectedStepComponentKind === 'pc_command') && selectedStepComponent ? (
                      <div className="space-y-3">
                        <div>
                          <div className="flex items-center justify-between gap-2">
                            <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">
                              {selectedStepComponentKind === 'pc_command' ? 'PC 命令模板' : '命令模板'}
                            </label>
                            <button
                              type="button"
                              onClick={() => setCommandVariableGuide(selectedStepComponentKind === 'pc_command' ? 'pc_command' : 'adb')}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-blue-100 bg-blue-50 text-blue-600 transition-colors hover:border-blue-200 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-200"
                              title="查看变量使用教程"
                              aria-label="查看命令变量使用教程"
                            >
                              <CircleHelp className="h-4 w-4" />
                            </button>
                          </div>
                          <textarea
                            value={selectedStepComponentKind === 'pc_command' && selectedStepComponent.commandTemplate.trim() === '{{command}}'
                              ? String(selectedStep.inputs?.command || '')
                              : selectedStepComponent.commandTemplate}
                            onChange={(event) => {
                              if (selectedStepComponentKind === 'pc_command' && selectedStepComponent.commandTemplate.trim() === '{{command}}') {
                                updateStepInput(selectedStep.id, 'command', event.target.value);
                                return;
                              }
                              updateSelectedCaseComponent((component) => ({
                                ...component,
                                commandTemplate: event.target.value,
                              }));
                            }}
                            className="mt-1 h-28 w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                            placeholder={selectedStepComponentKind === 'pc_command'
                              ? 'qwc asr send "确认支付" --json --serial {{phoneSerial}}'
                              : 'adb -s {{serial}} shell ...'}
                          />
                          <div className="mt-1 text-[10px] leading-4 text-slate-400">
                            {selectedStepComponentKind === 'pc_command'
                              ? <>当前电脑直接执行，不经过 shell。内置变量：{'{{phoneSerial}}'}、{'{{glassesSerial}}'}、{'{{phonePackage}}'}、{'{{glassesPackage}}'}；参数使用 {'{{参数key}}'}。</>
                              : <>内置变量：{'{{serial}}'}、{'{{phoneSerial}}'}、{'{{glassesSerial}}'}、{'{{phonePackage}}'}、{'{{glassesPackage}}'}；参数使用 {'{{参数key}}'}。</>}
                          </div>
                        </div>
                        <div>
                          <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">命令结果断言（JSON，可选）</label>
                          <textarea
                            value={typeof selectedResultAssertions === 'string'
                              ? selectedResultAssertions
                              : selectedResultAssertions == null ? '' : JSON.stringify(selectedResultAssertions, null, 2)}
                            onChange={(event) => updateStep(selectedStep.id, { config: { ...selectedStep.config, resultAssertions: event.target.value } })}
                            className="mt-1 h-28 w-full resize-y rounded-xl border border-slate-200 bg-white p-3 font-mono text-xs outline-none focus:border-blue-300"
                            placeholder={'{"source":"stdout","conditions":[{"path":"ok","equals":true}]}'}
                          />
                          <p className="mt-1 text-[10px] text-slate-500">留空不校验；全部条件满足才通过。字段缺失、类型不符或输出不是 JSON 都会失败。可用 message 填写该条件的失败说明。</p>
                        </div>
                        <div className="rounded-2xl border border-slate-200 bg-slate-50 p-3">
                          <div className="mb-3 flex items-center justify-between gap-2">
                            <div>
                              <div className="text-[11px] font-black text-slate-800">命令参数</div>
                              <div className="mt-1 text-[10px] font-bold text-slate-400">参数 key 会同步更新命令模板中的同名占位符。</div>
                            </div>
                            <button
                              type="button"
                              onClick={addSelectedAdbParam}
                              className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-blue-100 bg-white text-blue-600 hover:bg-blue-50"
                              title="增加参数"
                              aria-label="增加参数"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                          <div className="space-y-2">
                            {selectedStepComponent.params.filter((param) => !(
                              selectedStepComponentKind === 'pc_command'
                              && selectedStepComponent.commandTemplate.trim() === '{{command}}'
                              && param.key === 'command'
                            )).length === 0 ? (
                              <div className="rounded-xl border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-[11px] font-bold text-slate-400">
                                暂无参数，点击右上角加号添加。
                              </div>
                            ) : selectedStepComponent.params.map((param, paramIndex) => {
                              if (
                                selectedStepComponentKind === 'pc_command'
                                && selectedStepComponent.commandTemplate.trim() === '{{command}}'
                                && param.key === 'command'
                              ) {
                                return null;
                              }
                              const value = selectedStep.inputs?.[param.key] ?? param.defaultValue ?? '';
                              return (
                                <div key={`${param.key}-${paramIndex}`} className="rounded-xl border border-slate-200 bg-white p-2">
                                  <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_32px] gap-2">
                                    <input
                                      value={param.key}
                                      onChange={(event) => updateSelectedAdbParam(paramIndex, { key: event.target.value })}
                                      className="h-8 min-w-0 rounded-lg border border-slate-200 px-2 font-mono text-[11px] font-bold outline-none focus:border-blue-300"
                                      placeholder="参数 key"
                                    />
                                    <input
                                      value={param.label || ''}
                                      onChange={(event) => updateSelectedAdbParam(paramIndex, { label: event.target.value })}
                                      className="h-8 min-w-0 rounded-lg border border-slate-200 px-2 text-[11px] font-bold outline-none focus:border-blue-300"
                                      placeholder="展示名称"
                                    />
                                    <button
                                      type="button"
                                      onClick={() => removeSelectedAdbParam(paramIndex)}
                                      className="flex h-8 w-8 items-center justify-center rounded-lg text-slate-400 hover:bg-rose-50 hover:text-rose-500"
                                      title="删除参数"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                  <input
                                    value={value}
                                    onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                    className="mt-2 h-9 w-full rounded-lg border border-slate-200 bg-slate-50 px-2 text-xs font-bold outline-none focus:border-blue-300"
                                    placeholder={param.placeholder || param.defaultValue || `{{${param.key}}}`}
                                  />
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      </div>
                    ) : selectedStepComponent ? (
                      <div className="space-y-3">
                        <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2">
                          <div className="text-[10px] font-black uppercase tracking-wide text-slate-400">命令模板</div>
                          <textarea
                            aria-label="当前用例组件命令模板"
                            value={selectedStepComponent.commandTemplate}
                            onChange={(event) => updateSelectedCaseComponent((component) => ({
                              ...component,
                              commandTemplate: event.target.value,
                            }))}
                            className="mt-1 h-24 w-full resize-y rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                          />
                        </div>
                        {selectedStepComponent.params.map((param) => {
                          const value = selectedStep.inputs?.[param.key] ?? param.defaultValue ?? '';
                          const commonClass = "mt-1 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300";

                          return (
                            <div key={param.key}>
                              <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">{param.label || param.key}</label>
                              {param.inputType === 'textarea' || param.inputType === 'json' ? (
                                <textarea
                                  value={value}
                                  onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                  placeholder={param.placeholder}
                                  className={`${commonClass} h-28 resize-none py-2 font-mono leading-5`}
                                />
                              ) : (
                                <input
                                  type={param.inputType === 'number' ? 'number' : 'text'}
                                  value={value}
                                  onChange={(event) => updateStepInput(selectedStep.id, param.key, event.target.value)}
                                  placeholder={param.placeholder}
                                  className={`${commonClass} h-9`}
                                />
                              )}
                              {param.helperText && (
                                <div className="mt-1 text-[10px] leading-4 text-slate-400">{param.helperText}</div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    ) : selectedStep.type === 'wait' ? (
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">等待时长(ms)</label>
                        <input
                          type="number"
                          min={0}
                          value={Number(selectedStep.config.durationMs || 0)}
                          onChange={(event) => updateStep(selectedStep.id, {
                            config: {
                              ...selectedStep.config,
                              durationMs: Number(event.target.value || 0),
                            },
                          })}
                          className="mt-1 h-9 w-full rounded-xl border border-slate-200 bg-slate-50 px-3 text-xs font-bold outline-none focus:border-blue-300"
                        />
                      </div>
                    ) : (
                      <div>
                        <label className="text-[10px] font-black uppercase tracking-wide text-slate-500">Config JSON</label>
                        <textarea
                          value={configDraft}
                          onChange={(event) => setConfigDraft(event.target.value)}
                          className="mt-1 h-52 w-full resize-none rounded-xl border border-slate-200 bg-slate-950 p-3 font-mono text-xs leading-5 text-slate-100 outline-none focus:border-blue-300"
                        />
                      </div>
                    )}
                    {Boolean((selectedStep.config.importReview as { required?: boolean } | undefined)?.required) && (
                      <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800" role="alert">
                        <strong>SoloPi 导入待处理：禁止执行</strong>
                        <p className="mt-1">{String((selectedStep.config.importReview as { reason?: string }).reason || '')}</p>
                        <p className="mt-1">不支持的操作请替换为正确节点；原始脚本和输入内容未复制。</p>
                        {selectedStep.type === 'component' && <button type="button" className="mt-2 font-bold underline" onClick={() => {
                          if (selectedStepComponent?.kind === 'mobile_ui_action' && selectedStep.inputs?.action === 'input' && (!selectedStep.inputs?.inputText?.trim() || !selectedStep.inputs?.selector?.trim() || selectedStep.inputs.selector === '{}')) {
                            setRunMessage('请先填写输入文本/变量及有效选择器'); return;
                          }
                          updateStep(selectedStep.id, { config: { ...selectedStep.config, importReview: { ...(selectedStep.config.importReview as object), required: false } } });
                        }}>已修改并核对本节点配置</button>}
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => removeStep(selectedStep.id)}
                        className="flex items-center gap-2 rounded-xl border border-rose-100 bg-rose-50 px-3 py-2 text-xs font-bold text-rose-600 hover:bg-rose-100"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        删除
                      </button>
                      {shouldShowRawConfigEditor(selectedStep, selectedStepComponent) && (
                        <button
                          type="button"
                          onClick={saveConfigDraft}
                          className="flex items-center gap-2 rounded-xl bg-blue-600 px-3 py-2 text-xs font-bold text-white hover:bg-blue-700"
                        >
                          <Save className="h-3.5 w-3.5" />
                          保存配置
                        </button>
                      )}
                    </div>
                </fieldset>
              </aside>
              )}
              </div>
            </div>
          </div>
        ) : activeTab === 'sites' ? (
          <CommonSitesPage />
        ) : activeTab === 'performance-bugreport' ? (
          <BugreportAnalysisPage />
        ) : activeTab === 'performance-task' || activeTab === 'performance-reports' || activeTab === 'performance' || activeTab === 'logs' ? (
          <PerformanceTestPage
            phoneSerial={selectedPhoneSerial}
            phonePackage={selectedPhonePackage}
            view={activeTab === 'performance-reports' ? 'reports' : 'task'}
            onOpenReports={() => setActiveTab('performance-reports')}
          />
        ) : (
          <div className="flex-1 flex items-center justify-center text-slate-400 font-bold bg-slate-50 uppercase tracking-widest">
            {activeTab} 模块正在开发中...
          </div>
        )}
      </main>
      {mirrorSessionId && <AgentMirrors sessionId={mirrorSessionId} />}
      <WorkflowMirrors />
    </div>
  );
}
