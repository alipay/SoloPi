const { app, BrowserWindow, dialog, ipcMain, session, shell, safeStorage: osSafeStorage } = require('electron');
const backgroundRuntime = require('./background-runtime').configureBackgroundRuntime(app);
const { protectSecrets, revealSecrets, prepareSecretsForDisplay } = require('./secret-storage');
const { EventEmitter } = require('node:events');
const agentOperationEvents = new EventEmitter();
const { createConfigurationBridge } = require('./agent/configuration');
const applicationHandlers = new Map();
function registerApplicationHandler(channel, handler) {
  const registered = ['workflow:validate-task-selection', 'workflow-task:submit'].includes(channel)
    ? require('./task-creation-diagnostics').instrument(channel, handler) : handler;
  applicationHandlers.set(channel, registered);
  ipcMain.handle(channel, registered);
}
function invokeApplicationHandler(channel, event, payload) {
  const handler = applicationHandlers.get(channel);
  if (!handler) throw new Error(`Application service unavailable: ${channel}`);
  return handler(event, payload);
}

const { execFile, execFileSync, spawn } = require('child_process');
const { gitRuntimeCommand } = require('./git-runtime');
const { AsyncLocalStorage } = require('node:async_hooks');
const { runManagedCommand, cancelAllManagedCommands } = require('./managed-command');
const { createWorkflowExecutionGate, workflowExecutionFailure, prepareWorkflowExecution } = require('./workflow-execution-gate');
const { createAssertionTimeoutError, executeWorkflowAssertionStep } = require('./workflow-assertion');
const workflowExecutionGate = createWorkflowExecutionGate();
const { assertImportReviewed, convertSoloPiCase, MAX_BYTES: SOLOPI_MAX_BYTES } = require('./solopi-case-converter');
const { getMobileUiElementSwipe } = require('./mobile-ui-element-swipe');
const soloPiProvider = require('./solopi-provider').createSoloPiProvider({ runAdb: (...args) => runAdb(...args), resourcesDirectory: () => app.isPackaged ? path.join(process.resourcesPath, 'solopi-recording') : path.join(__dirname, '..', 'resources', 'solopi-recording') });
const soloPiRecording = require('./solopi-recording').createSoloPiRecording({ directory: () => getGlassBoxDataDir(), gate: workflowExecutionGate, provider: soloPiProvider });
const workflowCommandScope = new AsyncLocalStorage();
const quickActionSignalScope = new AsyncLocalStorage();
const workflowCommandCancels = new Map();
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const https = require('https');
const os = require('os');
const path = require('path');
const safeStorage = require('./credential-storage').createCredentialStorage({ directory: () => getGlassBoxDataDir(), osStorage: osSafeStorage });
const { defaultUiDataDir, enableTaskVisibility, assertTaskVisibility, publishVisibleTask, readVisibleTasks, getVisibleTask, deleteVisibleTask } = require('./task-visibility');
const { mergeCaseUpdate } = require('./case-update');
const caseEditGuard = require('./case-edit-guard');
const { createSettingsService } = require('./settings-service');
const { createBatteryControl } = require('./cli-battery');
const { performanceTask } = require('./cli-performance');
const { normalizeStressPayload, createStressExecution, shouldRunStressCase } = require('./stress-task');
const { createTaskReportWriter } = require('./task-report-writer');
const { createRuntimeDiagnostics } = require('./runtime-diagnostics');
const { createPerformanceCrashCollector } = require('./performance-crashes');
const { collectPerformanceBattery } = require('./performance-battery');
const { createBugreportJobs } = require('./bugreport/jobs');
const bugreportJobs = createBugreportJobs({ directory: () => path.join(getGlassBoxDataDir(), 'bugreport-analysis'), adbPath: () => getAdbPath(), onChange: job => { agentOperationEvents.emit('operation', 'battery', job.id, job); maybeQuitIdleBackgroundBroker(); } });
const { packagePerformanceReports, packageCasePerformanceReports } = require('./workflow-performance');
const { startTaskLogCapture } = require('./task-log-capture');
const { createThreadStackCollector, normalizeThreadStackOptions } = require('./android-thread-stacks');
const { parseAndroidTopProcess } = require('./android-top');
const { stopOwnedLogProcess, releaseOwnedLogAssertions } = require('./owned-log-process');
const { createWorkflowLogJournal } = require('./workflow-log-journal');
const { parseCommandResultAssertions, assertCommandResult } = require('./command-result-assertions');
const { pathToFileURL } = require('url');
const {
  attachPerformanceReportsToTaskCases,
  createWorkflowPerformanceCollector,
  validateWorkflowPerformanceTargets,
} = require('./workflow-performance');
const {
  createHttpResponseEvidence,
  formatHttpResponseEvidence,
} = require('./http-response');
const {
  classifyTtsBusinessResponse,
  getTtsResponseRecoveryActions,
} = require('./tts-response');
const {
  createLocalCaseLibraryRevision,
  getLocalCaseLibraryRepoId,
  getLocalCaseLibraryRepoPath,
  parseLocalCaseLibraryWorkspace,
} = require('./case-library-local');
const {
  createCaseLibraryWatcherManager,
} = require('./case-library-watcher');
const {
  createAdbDiagnosticError,
  isMissingRemoteFileError,
} = require('./adb-error');
const {
  installApkToDevice,
} = require('./apk-install');
const {
  buildQuickActionExecution,
  readQuickActionDefinition,
  resolveQuickActionArguments,
  resolveQuickActionInputValues,
  resolveTemplate,
} = require('./quick-actions');
const {
  waitForRemoteAudioFile,
} = require('./audio-remote-file');
const {
  DEFAULT_TRAILING_SILENCE_MS,
  appendPcmSilence,
  createAudioTimelineMetrics,
  createPcmAudioMetrics,
  durationMsFromPcmBytes,
  normalizeTrailingSilenceMs,
} = require('./audio-metrics');
const {
  createScreenAwakeWarning,
  runRequiredDevicePreflight,
} = require('./device-preflight');
const {
  evaluateScrcpyRecording,
} = require('./scrcpy-recording');
const {
  evaluateScrcpyMirror,
} = require('./scrcpy-mirror');
const {
  createMobileUiCoordinateSpace,
  mapUiPointToScreenshot,
  mapUiRectToScreenshot,
  parseAndroidDisplayRotation,
  parseAndroidWindowMetrics,
  parsePngDimensions,
} = require('./mobile-ui-coordinate');
const {
  findMobileUiElement,
  normalizeMobileSelector,
} = require('./mobile-ui-selector');
const {
  getMobileUiTapPoint,
  normalizeMobileUiTapInset,
  normalizeMobileUiTapPosition,
} = require('./mobile-ui-tap-position');
const {
  getScrcpyEnvironment,
  resolveMediaRuntime,
} = require('./media-runtime');
const {
  MediaProcessQueue,
} = require('./media-process-queue');
const {
  TaskScreenRecordingCoordinator,
  buildSoftwareFallbackSegmentArgs,
} = require('./task-screen-recording');
const {
  createWorkflowTaskRendererDetail,
  createWorkflowTaskSummary,
  getWorkflowTaskUpdatedAtMs,
  isWorkflowTaskActive,
  mergeWorkflowStateForRendererSave,
  shouldRecoverStaleWorkflowTask,
  splitWorkflowTaskDetails,
} = require('./workflow-task-sync');
const {
  appendTransitionEvents,
} = require('./workflow-task-events');

const { PRODUCT_NAME: APP_NAME, KEYCHAIN_APP_NAME, defaultDataDirectory } = require('./product-identity');
const SHARED_EMBEDDED_WEBVIEW_PARTITION = 'persist:data-factory';
app.setName(process.platform === 'darwin' ? KEYCHAIN_APP_NAME : APP_NAME);
// Branding must not relocate existing cases, credentials, web sessions or CLI state.
app.setPath('userData', defaultDataDirectory(app.getPath('appData')));
app.setAboutPanelOptions?.({ applicationName: APP_NAME });

const cliDataDirOverride = require('./data-directory').resolveDataDirectory();
if (cliDataDirOverride) {
  app.setPath('userData', cliDataDirOverride);
  process.env.GLASSBOX_CLI_DATA_DIR = cliDataDirOverride;
}

let mainWindow;
let isQuitting = false;
const logcatSessions = new Map();
const logAssertStreams = new Map();
const LOG_ASSERT_RECENT_LINE_LIMIT = 2000;
const JSON_LOG_ASSERT_MIN_TIMEOUT_MS = 45000;
let environmentConfigCache = null;
const workflowCancelRequests = new Set();
const activeWorkflowRuntimes = new Map();
const activeWorkflowTasks = new Map();
const scrcpyOptionSupportCache = new Map();
const manualScrcpySessions = new Map();
const embeddedMirrorSessions = new Map();
const ffmpegProcessQueue = new MediaProcessQueue({
  name: 'ffmpeg',
  concurrency: 1,
  onStateChange: (state) => {
    if (state.event === 'started' || state.event === 'finished') {
      console.info(`[media-runtime] ${JSON.stringify(state)}`);
    }
  },
});
let cliBackgroundMode = process.argv.includes('--glassbox-background') || process.env.GLASSBOX_BACKGROUND === '1';
let suppressForegroundUntil = cliBackgroundMode ? Date.now() + 5000 : 0;
let desktopModeRequested = !cliBackgroundMode;
let pendingCliBrokerRequests = 0;
let workflowTaskReconciliationPromise = null;
let workflowTaskReconciliationCompleted = false;
let activeReportWrites = 0;
const analyticsSessionId = crypto.randomBytes(8).toString('hex');
let glassBoxCliModulePromise = null;
const pendingLocalCaseLibraryEvents = new Map();
const localCaseLibraryReloadQueues = new Map();
const localCaseLibraryErrorSignatures = new Map();
const initializedLocalCaseLibraryWatchKeys = new Set();
let localCaseLibraryWatcherManager = null;
let workflowTaskRevisionSequence = 0;

function getGlassBoxDataDir() {
  return app.getPath('userData');
}

function getGlassBoxCliModulePath() {
  const candidates = [
    path.join(process.resourcesPath || '', 'cli', 'glassbox-cli.mjs'),
    path.join(__dirname, '../scripts/glassbox-cli.mjs'),
  ];
  return candidates.find((candidate) => candidate && fs.existsSync(candidate)) || candidates[1];
}

function getGlassBoxAppIconPath() {
  const candidates = app.isPackaged
    ? [path.join(process.resourcesPath, 'dock-icon.png'), path.join(process.resourcesPath, 'icon.icns')]
    : [
        path.join(__dirname, '../resources/branding/solopi-desktop-app-icon.png'),
        path.join(__dirname, '../build/icon.icns'),
        path.join(__dirname, '../build/icon.png'),
      ];
  return candidates.find((candidate) => fs.existsSync(candidate)) || undefined;
}

function applyMacDockIcon() {
  if (process.platform !== 'darwin') {
    return false;
  }
  const iconPath = getGlassBoxAppIconPath();
  if (!iconPath) {
    return false;
  }
  try {
    app.dock?.setIcon?.(iconPath);
    return true;
  } catch (error) {
    console.warn(`[app-icon] failed to set Dock icon: ${error.message}`);
    return false;
  }
}

async function getGlassBoxCliModule() {
  if (!glassBoxCliModulePromise) {
    glassBoxCliModulePromise = import(pathToFileURL(getGlassBoxCliModulePath()).href);
  }
  return glassBoxCliModulePromise;
}

async function validateWorkflowTaskSelection(payload = {}) {
  const cliModule = await getGlassBoxCliModule();
  if (typeof cliModule.validateExecutableTaskSelectionForCli !== 'function') {
    throw new Error('solopi-desktop CLI validation gate is unavailable');
  }

  const previousDataDir = process.env.GLASSBOX_CLI_DATA_DIR;
  process.env.GLASSBOX_CLI_DATA_DIR = getGlassBoxDataDir();
  try {
    const assetState=readWorkflowState() || {};
    const validation = cliModule.validateExecutableTaskSelectionForCli({
      cases: Array.isArray(payload.cases) ? payload.cases.map(c=>require('./case-assets').withAssetContext(assetState,c)) : [],
      assetBaseDir: payload.assetBaseDir,
      payloadComponents: Array.isArray(payload.components) ? payload.components : [],
      caseEdges: payload.caseEdges && typeof payload.caseEdges === 'object' ? payload.caseEdges : {},
    });
    if (!validation.success) return validation;
    const resolved = await resolveWorkflowTaskDevices(null,payload);
    return {...validation, devices:resolved.devices};
  } finally {
    if (previousDataDir === undefined) {
      delete process.env.GLASSBOX_CLI_DATA_DIR;
    } else {
      process.env.GLASSBOX_CLI_DATA_DIR = previousDataDir;
    }
  }
}

let currentHeaderDevices = {};
registerApplicationHandler('workflow:set-header-devices', (_event, devices = {}) => {
  currentHeaderDevices = Object.fromEntries(['phone','glasses'].map(role => [role, {
    serial: typeof devices[role]?.serial === 'string' ? devices[role].serial.trim() : '',
    runtime: devices[role]?.runtime || 'android',
  }]));
  return {success:true};
});
async function resolveWorkflowTaskDevices(event, payload = {}) {
  const roles = require('./task-device-selection').collectRequiredDeviceRoles({...payload,payloadComponents:payload.components});
  const online = [];
  for (const runtime of new Set([...roles].map(role => payload.devices?.[role]?.runtime || currentHeaderDevices[role]?.runtime || 'android'))) {
    const result = await invokeApplicationHandler('performance:list-devices',event,{runtime});
    online.push(...(result.devices || []));
  }
  return require('./task-device-selection').resolveTaskDevices(payload,currentHeaderDevices,online);
}

function getWorkflowStatePath() {
  return path.join(getGlassBoxDataDir(), 'workflow-editor-state.json');
}

function getWorkflowBackupStatePath() {
  return path.join(getGlassBoxDataDir(), 'workflow-editor-state.backup.json');
}

function getWorkflowReportDetailsDir() {
  return path.join(getGlassBoxDataDir(), 'workflow-report-details');
}

function getWorkflowReportDetailPath(taskId) {
  return path.join(getWorkflowReportDetailsDir(), `${sanitizeFilePart(taskId || 'report')}.json`);
}

function getWorkflowReportPackagesDir() {
  return path.join(getGlassBoxDataDir(), 'report-packages');
}

function getAnalyticsInstallIdPath() {
  return path.join(getGlassBoxDataDir(), 'analytics', 'install-id');
}

function getAnalyticsEventLogPath() {
  return path.join(getGlassBoxDataDir(), 'analytics', 'events.jsonl');
}

function getAudioRecordingsDir() {
  return path.join(getGlassBoxDataDir(), 'audio-recordings');
}

function getAudioPreviewDir() {
  return path.join(getGlassBoxDataDir(), 'audio-previews');
}

function getTtsAudioDir() {
  return path.join(getGlassBoxDataDir(), 'tts-audio');
}

function getImageMockCacheDir() {
  return path.join(getGlassBoxDataDir(), 'image-mock-cache');
}

function getEnvironmentConfigPath() {
  return path.join(getGlassBoxDataDir(), 'environment-config.json');
}

function getEnvironmentConfigBackupPath() {
  return path.join(getGlassBoxDataDir(), 'environment-config.json');
}

function readEnvironmentConfig() {
  if (environmentConfigCache) {
    return environmentConfigCache;
  }

  try {
    const configs = [getEnvironmentConfigPath(), getEnvironmentConfigBackupPath()]
      .map((configPath) => {
        if (!fs.existsSync(configPath)) {
          return null;
        }

        return prepareSecretsForDisplay(JSON.parse(fs.readFileSync(configPath, 'utf8')));
      })
      .filter(Boolean);
    environmentConfigCache = configs.find((config) => String(config?.adbPath || '').trim()) || configs[0] || {};
  } catch (_error) {
    environmentConfigCache = {};
  }

  return environmentConfigCache;
}

function writeEnvironmentConfig(config) {
  const nextConfig = {
    ...readEnvironmentConfig(),
    ...config,
  };
  const protectedConfig = protectSecrets(nextConfig, safeStorage);
  const content = JSON.stringify(protectedConfig, null, 2);
  const writeAtomic = (filePath) => {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const temporaryPath = `${filePath}.tmp-${process.pid}-${Date.now()}`;
    try {
      fs.writeFileSync(temporaryPath, content);
      fs.renameSync(temporaryPath, filePath);
    } finally {
      if (fs.existsSync(temporaryPath)) {
        fs.rmSync(temporaryPath, { force: true });
      }
    }
  };
  const configPaths = [getEnvironmentConfigPath(), getEnvironmentConfigBackupPath()]
    .filter((filePath, index, values) => values.indexOf(filePath) === index);
  configPaths.forEach(writeAtomic);
  environmentConfigCache = prepareSecretsForDisplay(protectedConfig);
  return environmentConfigCache;
}

function normalizeAnalyticsConfig(config = {}) {
  const endpointUrl = String(
    process.env.GLASSBOX_ANALYTICS_URL
    || config.endpointUrl
    || ''
  ).trim();
  const enabledFromEnv = String(process.env.GLASSBOX_ANALYTICS_ENABLED || '').trim();
  const enabled = enabledFromEnv
    ? ['1', 'true', 'yes', 'on'].includes(enabledFromEnv.toLowerCase())
    : Boolean(config.enabled || endpointUrl);

  return {
    enabled,
    endpointUrl,
    appId: String(process.env.GLASSBOX_ANALYTICS_APP_ID || config.appId || 'glassbox').trim(),
    spma: String(process.env.GLASSBOX_ANALYTICS_SPMA || config.spma || '').trim(),
    channel: String(process.env.GLASSBOX_ANALYTICS_CHANNEL || config.channel || (app.isPackaged ? 'desktop' : 'dev')).trim(),
    localLog: config.localLog !== false,
  };
}

function getAnalyticsConfig() {
  return normalizeAnalyticsConfig(readEnvironmentConfig().analytics || {});
}

function getAnalyticsInstallId() {
  const installIdPath = getAnalyticsInstallIdPath();

  try {
    if (fs.existsSync(installIdPath)) {
      const existing = String(fs.readFileSync(installIdPath, 'utf8') || '').trim();
      if (existing) {
        return existing;
      }
    }

    const installId = crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(path.dirname(installIdPath), { recursive: true });
    fs.writeFileSync(installIdPath, installId);
    return installId;
  } catch (_error) {
    return 'unknown';
  }
}

function sanitizeAnalyticsProperties(properties = {}) {
  const allowList = new Set([
    'source',
    'mode',
    'status',
    'success',
    'stopped',
    'caseCount',
    'stepCount',
    'successCount',
    'failedCount',
    'stoppedCount',
    'durationMs',
    'packaged',
    'background',
    'currentVersion',
    'targetVersion',
    'enabled',
    'hasEndpoint',
    'errorCode',
  ]);
  const sanitized = {};

  Object.entries(properties || {}).forEach(([key, value]) => {
    if (!allowList.has(key)) {
      return;
    }

    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      sanitized[key] = value;
    }
  });

  return sanitized;
}

function appendAnalyticsLocalLog(event) {
  try {
    const logPath = getAnalyticsEventLogPath();
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify(event)}\n`);
  } catch (_error) {
    // Local analytics logging must never affect the product path.
  }
}

function postAnalyticsEvent(endpointUrl, event) {
  return new Promise((resolve) => {
    let parsedUrl;

    try {
      parsedUrl = new URL(endpointUrl);
    } catch (_error) {
      resolve(false);
      return;
    }

    const body = JSON.stringify(event);
    const client = parsedUrl.protocol === 'https:' ? https : http;
    const request = client.request(parsedUrl, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'content-length': Buffer.byteLength(body),
      },
      timeout: 3000,
    }, (response) => {
      response.resume();
      response.on('end', () => resolve(response.statusCode >= 200 && response.statusCode < 300));
    });

    request.on('timeout', () => {
      request.destroy();
      resolve(false);
    });
    request.on('error', () => resolve(false));
    request.end(body);
  });
}

function trackGlassBoxUsage(eventName, properties = {}) {
  const analyticsConfig = getAnalyticsConfig();

  if (!analyticsConfig.enabled) {
    return;
  }

  const event = {
    appId: analyticsConfig.appId,
    spma: analyticsConfig.spma || undefined,
    eventName: String(eventName || 'unknown'),
    timestamp: new Date().toISOString(),
    installId: getAnalyticsInstallId(),
    sessionId: analyticsSessionId,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    channel: analyticsConfig.channel,
    properties: sanitizeAnalyticsProperties(properties),
  };

  if (analyticsConfig.localLog) {
    appendAnalyticsLocalLog(event);
  }

  if (analyticsConfig.endpointUrl) {
    void postAnalyticsEvent(analyticsConfig.endpointUrl, event);
  }
}

function readWorkflowState() {
  const stateCandidates = [getWorkflowStatePath(), getWorkflowBackupStatePath()]
    .filter((candidate, index, values) => values.indexOf(candidate) === index)
    .filter((candidate) => fs.existsSync(candidate));
  if (!stateCandidates.length) {
    return null;
  }

  let state = null;
  let lastError = null;
  for (const statePath of stateCandidates) {
    try {
      const storedState = JSON.parse(fs.readFileSync(statePath, 'utf8'));
      state = prepareSecretsForDisplay(storedState);
      break;
    } catch (error) {
      lastError = error;
    }
  }
  if (!state) {
    throw lastError || new Error('Workflow state is unavailable');
  }
  const migratedState = require('./workflow-failure-policy').normalizeStateFailurePolicies(splitWorkflowStateReports(state));
  if (migratedState !== state) {
    writeWorkflowState(migratedState);
    return migratedState;
  }

  return state;
}

function createWorkflowReportSummary(task) {
  return createWorkflowTaskSummary(task, getWorkflowReportDetailPath(task?.id));
}

function splitWorkflowStateReports(state) {
  if (!state || typeof state !== 'object' || !Array.isArray(state.automationTasks)) {
    return state || {};
  }

  const detailsDir = getWorkflowReportDetailsDir();
  fs.mkdirSync(detailsDir, { recursive: true });

  const split = splitWorkflowTaskDetails(state.automationTasks, {
    getDetailPath: (task) => getWorkflowReportDetailPath(task.id),
    detailExists: (detailPath) => Boolean(detailPath && fs.existsSync(detailPath)),
    persistDetail: (detailPath, task) => {
      writeJsonFileAtomic(detailPath, task);
    },
  });
  if (!split.changed) return state;

  return {
    ...state,
    automationTasks: split.tasks,
  };
}

function writeWorkflowState(state, previousState) {
  const stateFile=getWorkflowStatePath();
  const previous=previousState ?? (fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):{});
  state=require('./workflow-failure-policy').normalizeStateFailurePolicies(require('./task-cleanup').preserveRemovals(state,previous));
  const persistedState = splitWorkflowStateReports(state);
  const statePath = getWorkflowStatePath();
  const backupPath = getWorkflowBackupStatePath();
  const protectedState = protectSecrets(persistedState || {}, safeStorage);
  const serializedState = JSON.stringify(protectedState);
  writeJsonFileAtomic(statePath, protectedState, serializedState);
  writeJsonFileAtomic(backupPath, protectedState, serializedState);
  return statePath;
}

function createWorkflowTaskCaseRecords(cases = [], caseEdges = {}) {
  return cases.map((testCase, index) => {
    const edges = getWorkflowCaseEdges({ caseEdges }, testCase, testCase.steps || []);
    const caseId = testCase.id || `case-${index + 1}`;

    return {
      caseId,
      caseName: testCase.name || caseId || `用例 ${index + 1}`,
      caseSnapshot: testCase,
      edges: edges.length ? edges : createWorkflowEdgesFromSteps(testCase.steps || []),
      status: 'pending',
      completed: 0,
      total: Array.isArray(testCase.steps) ? testCase.steps.length : 0,
    };
  });
}

function createWorkflowTaskRecord(payload = {}, cases = [], taskId = '', taskName = '', createdAt = '') {
  const total = payload.stress?.mode === 'rounds' ? cases.length * payload.stress.value : cases.length;
  return {
    id: taskId,
    name: taskName,
    folderId: payload.folderId || '',
    taskType: payload.stress ? 'stress' : 'standard',
    stress: payload.stress,
    caseIds: cases.map((testCase) => testCase.id).filter(Boolean),
    status: 'running',
    completed: 0,
    total,
    createdAt,
    startedAt: createdAt,
    source: payload.source || 'cli',
    readonly: false,
    imported: false,
    startOptions: payload.startConfigOverride || undefined,
    devices: payload.devices,
    reservedDeviceSerials: payload.reservedDeviceSerials,
    runtimeEnvironment: payload.runtimeEnvironment || undefined,
    performanceOptions: payload.performanceOptions || undefined,
    sourceRevision: payload.sourceRevision || undefined,
    executionProvenance: payload.executionProvenance || require('./development-tasks').provenance(getGlassBoxDataDir()),
    validationSummary: payload.validationSummary || undefined,
    hasFailures: false,
    summary: {
      successCount: 0,
      failedCount: 0,
      stoppedCount: 0,
      runningCount: 0,
      pendingCount: total,
      completed: 0,
      caseCount: total,
      validationSummary: payload.validationSummary || undefined,
    },
    cases: payload.stress ? [] : createWorkflowTaskCaseRecords(cases, payload.caseEdges || {}),
  };
}

let runtimeDiagnostics;
function getRuntimeDiagnostics() {
  return runtimeDiagnostics ||= createRuntimeDiagnostics({
    directory: path.join(getGlassBoxDataDir(), 'diagnostics'), version: app.getVersion(),
    getTaskIds: () => [...activeWorkflowTasks.keys()],
    getMetrics: () => app.getAppMetrics(),
  });
}
const workflowReportWriter = createTaskReportWriter({
  onCommit(detailPath, persistedTask) {
    const started = performance.now();
    const currentState = readWorkflowState() || {};
    const readAt = performance.now();
    const currentTasks = Array.isArray(currentState.automationTasks) ? currentState.automationTasks : [];
    const summary = {
      ...createWorkflowReportSummary(persistedTask),
      reportDetailPath: detailPath,
      reportDetailLoaded: false,
    };
    const nextTasks = [
      summary,
      ...currentTasks.filter((item) => item?.id !== persistedTask.id),
    ];

    const mergedAt = performance.now();
    writeWorkflowState({
      ...currentState,
      automationTasks: nextTasks,
    }, currentState);
    const writtenAt = performance.now();
    publishVisibleTask(getGlassBoxDataDir(), { ...summary, reportDetailPath: detailPath });
    agentOperationEvents.emit('operation', 'task', persistedTask.id, require('./agent/review-events').reviewSnapshot(persistedTask));
    return {indexReadMs:readAt-started,indexMergeMs:mergedAt-readAt,indexWriteMs:writtenAt-mergedAt,uiSyncMs:performance.now()-writtenAt};
  },
  onError(error, task) {
    console.error('[workflow-report] persistence failed:', error.message);
    try { getRuntimeDiagnostics().record('report-write-failed', { taskId: task.id, error: error.message }); } catch (diagnosticError) { console.error(diagnosticError); }
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('workflow-task:changed', {
      task: { ...createWorkflowReportSummary(task), reportPersistenceError: error.message },
    });
  },
});

function persistWorkflowTaskRecord(task) {
  if (!task?.id) {
    return;
  }

  if (Array.isArray(task.cases)) task = refreshWorkflowTaskSummary(task);

  const uiVisibility = assertTaskVisibility(getGlassBoxDataDir());
  const updatedAt = new Date().toISOString();
  workflowTaskRevisionSequence += 1;
  const activeTask = activeWorkflowTasks.get(task.id);
  const previousTask = activeTask?.task || {};
  let persistedTask = {
    ...task,
    uiVisibility,
    source: task.source || (String(task.id).startsWith('cli-task-') ? 'cli' : 'ui'),
    updatedAt,
    taskRevision: `${Date.now()}-${workflowTaskRevisionSequence}`,
  };
  if (activeTask?.stopRequested) {
    persistedTask.stopRequestedAt = activeTask.stopRequestedAt;
    persistedTask.stopForce = activeTask.force;
    if (['pending', 'submitted', 'running'].includes(persistedTask.status)) persistedTask.status = 'stopping';
  }
  persistedTask = appendTransitionEvents(previousTask, persistedTask);
  if (activeTask) {
    activeTask.task = persistedTask;
  }

  persistedTask.runtimeDiagnostics = { eventLoop: getRuntimeDiagnostics().snapshot(), reportWrite: workflowReportWriter.snapshot() };
  workflowReportWriter.schedule(getWorkflowReportDetailPath(task.id), persistedTask);
  if (!require('./development-tasks').isDevelopmentTask(persistedTask) && !require('./development-tasks').workspace(getGlassBoxDataDir()) && mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    try {
      mainWindow.webContents.send('workflow-task:changed', {
        schemaVersion: 'glassbox.workflow-task-event.v1',
        task: createWorkflowReportSummary(persistedTask),
        taskId: persistedTask.id, taskRevision: persistedTask.taskRevision, updatedAt: persistedTask.updatedAt,
      });
    } catch (error) { console.warn(`[workflow-task] renderer notification failed: ${error.message}`); }
  }
  if (['submitted','running','stopping'].includes(persistedTask.status)) agentOperationEvents.emit('operation', 'task', persistedTask.id, createWorkflowReportSummary(persistedTask));
  return persistedTask;
}

// Standalone battery analysis retired; performance sampling owns battery temperature.

function getWorkflowTaskReportPackagePath(task) {
  const baseName = `solopi-desktop-report-${sanitizeFilePart(task?.name || task?.id || 'task')}-${createTimestamp()}.glassreport`;
  return path.join(getWorkflowReportPackagesDir(), baseName);
}

async function createWorkflowTaskReportPackage(task, outputPath = '') {
  if (!task?.id) {
    throw new Error('Missing workflow task for report package');
  }

  activeReportWrites += 1;
  let tempRoot = '';
  try {
    const packagePath = path.resolve(outputPath || getWorkflowTaskReportPackagePath(task));
    const normalizedPackagePath = packagePath.endsWith('.glassreport') ? packagePath : `${packagePath}.glassreport`;
    tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glassreport-task-export-'));
    const packageRoot = path.join(tempRoot, 'package');
    fs.mkdirSync(packageRoot, { recursive: true });
    fs.mkdirSync(path.dirname(normalizedPackagePath), { recursive: true });

    const sharedLogPaths = new Map();
    const packagedTask = {
      ...task,
      performanceReports: packagePerformanceReports(task.performanceReports, packageRoot),
      readonly: true,
      imported: true,
      reportPackagePath: undefined,
      reportPackage: undefined,
      reportPackageError: undefined,
      threadStacks: (task.threadStacks || []).map(record => ({ ...record, files: (record.files || []).map((file, index) => {
        if (!file.path || !fs.existsSync(file.path)) return { ...file, path: '', error: '线程栈文件不存在' };
        const relative = `artifacts/thread-stacks/${sanitizeFilePart(record.id)}-${index}.txt`;
        fs.mkdirSync(path.join(packageRoot, 'artifacts/thread-stacks'), { recursive: true });
        fs.copyFileSync(file.path, path.join(packageRoot, relative));
        return { ...file, path: relative };
      }) })),
      taskLogs: (task.taskLogs || []).map((log, index) => {
        if (!log.path || !fs.existsSync(log.path)) return { ...log, path: '', error: log.error || '完整日志文件不存在' };
        const relative = `artifacts/task-logs/${index}-${sanitizeFilePart(log.deviceType)}.txt`;
        const destination = path.join(packageRoot, relative);
        fs.mkdirSync(path.dirname(destination), { recursive: true });
        fs.copyFileSync(log.path, destination);
        sharedLogPaths.set(path.resolve(log.path), relative);
        return { ...log, path: relative };
      }),
      cases: (task.cases || []).map((caseRecord) => ({
        ...caseRecord,
        artifacts: copyReportCaseArtifacts(task.id, caseRecord, packageRoot, sharedLogPaths),
      })),
    };

    const manifest = {
      schemaVersion: 'glassbox.report-package.v1',
      app: 'GlassBox',
      exportedAt: new Date().toISOString(),
      taskId: task.id,
      taskName: task.name,
      source: 'glassbox-desktop-auto',
    };

    fs.writeFileSync(path.join(packageRoot, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fs.writeFileSync(path.join(packageRoot, 'report.json'), JSON.stringify({ task: packagedTask }, null, 2));

    if (fs.existsSync(normalizedPackagePath)) {
      fs.rmSync(normalizedPackagePath, { force: true });
    }

    await runCommandWithOptions('/usr/bin/zip', ['-qry', normalizedPackagePath, '.'], {
      cwd: packageRoot,
      timeout: 1000 * 60 * 5,
      maxBuffer: 1024 * 1024 * 20,
    });

    return {
      success: true,
      path: normalizedPackagePath,
      taskId: task.id,
      taskName: task.name,
      caseCount: packagedTask.cases?.length || 0,
    };
  } finally {
    if (tempRoot) {
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
    activeReportWrites = Math.max(0, activeReportWrites - 1);
  }
}

async function attachWorkflowTaskReportPackage(task, outputPath = '') {
  if (!task?.id) {
    return task;
  }

  try {
    const reportPackage = await createWorkflowTaskReportPackage(task, outputPath);
    return {
      ...task,
      reportPackage,
      reportPackagePath: reportPackage.path,
      reportPackageError: undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ...task,
      reportPackage: {
        success: false,
        error: message,
      },
      reportPackageError: message,
    };
  }
}

function replaceWorkflowTaskCase(task, caseId, updater) {
  return {
    ...task,
    cases: (task.cases || []).map((caseRecord) => (
      caseRecord.caseId === caseId ? updater(caseRecord) : caseRecord
    )),
  };
}

function markWorkflowTaskCasesStopped(task, reason, stoppedAt = new Date().toISOString()) {
  return {
    ...task,
    cases: (task.cases || []).map((caseRecord) => {
      if (!['pending', 'submitted', 'running'].includes(caseRecord.status)) {
        return caseRecord;
      }

      return {
        ...caseRecord,
        status: 'stopped',
        endedAt: caseRecord.endedAt || stoppedAt,
        finishedAt: caseRecord.finishedAt || stoppedAt,
        error: caseRecord.error || reason,
      };
    }),
  };
}

function refreshWorkflowTaskSummary(task) {
  const cases = Array.isArray(task?.cases) ? task.cases : [];
  const successCount = cases.filter((item) => item.status === 'success').length;
  const failedCount = cases.filter((item) => item.status === 'failed').length;
  const stoppedCount = cases.filter((item) => item.status === 'stopped').length;

  return {
    ...task,
    hasFailures: Boolean(task.hasFailures || failedCount > 0),
    summary: {
      ...(task.summary || {}),
      successCount,
      failedCount,
      stoppedCount,
      runningCount: cases.filter((item) => ['running', 'stopping'].includes(item.status)).length,
      pendingCount: cases.filter((item) => ['pending', 'submitted', ''].includes(String(item.status || ''))).length,
      completed: successCount + failedCount + stoppedCount,
      caseCount: task.total || cases.length,
    },
  };
}

function parseWorkflowRunnerProcessTable(stdout = '') {
  return String(stdout || '')
    .split(/\r?\n/)
    .map((line) => {
      const match = line.match(/^\s*(\d+)\s+(.+)$/);
      return match ? { pid: Number(match[1]), command: match[2] } : null;
    })
    .filter(Boolean);
}

function extractWorkflowRunnerPayloadPath(command = '') {
  const match = String(command || '').match(
    /--glassbox-cli-run-task-payload(?:=|\s+)(?:"([^"]+)"|'([^']+)'|(\S+))/
  );
  return match ? (match[1] || match[2] || match[3] || '') : '';
}

function processTableHasWorkflowTaskRunner(processes = [], taskId = '') {
  return processes.some((processInfo) => {
    const command = String(processInfo?.command || '');
    if (!command.includes('--glassbox-cli-run-task-payload')) return false;
    if (command.includes(String(taskId || ''))) return true;
    const payloadPath = extractWorkflowRunnerPayloadPath(command);
    if (!payloadPath) return false;
    try {
      const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
      return String(payload?.taskId || '') === String(taskId || '');
    } catch (_error) {
      return false;
    }
  });
}

function recoverStaleWorkflowTask(task, stoppedAt = new Date().toISOString()) {
  const reason = 'solopi-desktop 启动后确认未找到该任务的存活 runner，已将历史 stale running 安全收敛为 stopped。';
  const diagnostics = {
    schemaVersion: 'glassbox.error.v1',
    code: 'TASK_STALE_RUNNING_RECOVERED',
    type: 'task-state',
    message: reason,
    recoveryActions: [
      '如需复核已完成步骤，打开该任务详情查看已保留的 results、日志和录屏。',
      '不要重复提交任务来修复历史状态；需要继续执行时请新建任务。',
    ],
    details: {
      taskId: task.id,
      previousStatus: task.status,
      recoveredAt: stoppedAt,
    },
  };
  const stoppedTask = markWorkflowTaskCasesStopped(task, reason, stoppedAt);
  const refreshed = refreshWorkflowTaskSummary({
    ...stoppedTask,
    status: 'stopped',
    finishedAt: task.finishedAt || stoppedAt,
    updatedAt: stoppedAt,
    taskRevision: `${Date.now()}-stale-recovered`,
    currentCaseName: undefined,
    currentCaseId: undefined,
    currentStepId: undefined,
    currentStepName: undefined,
    error: task.error || reason,
    errorCode: task.errorCode || diagnostics.code,
    errorType: task.errorType || diagnostics.type,
    recoveryActions: task.recoveryActions?.length ? task.recoveryActions : diagnostics.recoveryActions,
    diagnostics: task.diagnostics || diagnostics,
  });
  if (!Array.isArray(refreshed.cases) || refreshed.cases.length === 0) {
    const total = Number(refreshed.total || refreshed.summary?.caseCount || 0);
    const completed = Number(refreshed.completed || refreshed.summary?.completed || 0);
    const remaining = Math.max(0, total - completed);
    refreshed.completed = total || completed;
    refreshed.summary = {
      ...(refreshed.summary || {}),
      stoppedCount: Number(refreshed.summary?.stoppedCount || 0) + remaining,
      runningCount: 0,
      pendingCount: 0,
      completed: total || completed,
      caseCount: total,
    };
  } else {
    refreshed.completed = refreshed.summary.completed;
  }
  return refreshed;
}

async function reconcileHistoricalWorkflowTasks(state) {
  if (!state || !Array.isArray(state.automationTasks)) return state || {};
  const candidates = state.automationTasks.filter((task) => (
    isWorkflowTaskActive(task)
    && !activeWorkflowTasks.has(String(task.id || ''))
  ));
  if (!candidates.length) return state;

  let processes;
  try {
    const result = await runCommand('/bin/ps', ['-axo', 'pid=,command='], 5000);
    processes = parseWorkflowRunnerProcessTable(result.stdout);
  } catch (error) {
    console.warn(`[workflow-task] stale reconciliation skipped: ${error.message}`);
    return state;
  }

  const activeTaskIds = new Set(activeWorkflowTasks.keys());
  const now = Date.now();
  const recoveredTasks = new Map();
  for (const summary of candidates) {
    const taskId = String(summary.id || '');
    const runnerLiveness = processTableHasWorkflowTaskRunner(processes, taskId) ? 'alive' : 'dead';
    if (!shouldRecoverStaleWorkflowTask(summary, {
      activeTaskIds,
      runnerLiveness,
      now,
      minimumAgeMs: 60_000,
    })) {
      continue;
    }

    const detailPath = summary.reportDetailPath || getWorkflowReportDetailPath(taskId);
    let sourceTask = summary;
    try {
      if (detailPath && fs.existsSync(detailPath)) {
        sourceTask = {
          ...summary,
          ...JSON.parse(fs.readFileSync(detailPath, 'utf8')),
          reportDetailPath: detailPath,
        };
      }
    } catch (error) {
      console.warn(`[workflow-task] stale detail load failed for ${taskId}: ${error.message}`);
    }
    if (!isWorkflowTaskActive(sourceTask)) {
      recoveredTasks.set(taskId, createWorkflowReportSummary(sourceTask));
      continue;
    }

    const recovered = recoverStaleWorkflowTask(sourceTask);
    if (Array.isArray(recovered.cases) && recovered.cases.length > 0) {
      writeJsonFileAtomic(detailPath, recovered);
    }
    recoveredTasks.set(taskId, {
      ...createWorkflowReportSummary(recovered),
      reportDetailPath: detailPath,
    });
  }
  if (!recoveredTasks.size) return state;

  const nextState = {
    ...state,
    automationTasks: state.automationTasks.map((task) => (
      recoveredTasks.get(String(task?.id || '')) || task
    )),
  };
  writeWorkflowState(nextState);
  return nextState;
}

function reconcileHistoricalWorkflowTasksOnce(state) {
  if (workflowTaskReconciliationCompleted) {
    return Promise.resolve(state);
  }
  if (!workflowTaskReconciliationPromise) {
    workflowTaskReconciliationPromise = reconcileHistoricalWorkflowTasks(state)
      .catch((error) => {
        console.warn(`[workflow-task] stale reconciliation failed: ${error.message}`);
        return state;
      })
      .then((result) => {
        workflowTaskReconciliationCompleted = true;
        return result;
      })
      .finally(() => {
        workflowTaskReconciliationPromise = null;
      });
  }
  return workflowTaskReconciliationPromise;
}

function convergeWorkflowTaskAfterException(task, error, occurredAt = new Date().toISOString()) {
  const errorMessage = error instanceof Error ? error.message : String(error || '自动化任务执行异常');
  const errorCode = error?.errorCode || error?.code || 'WORKFLOW_TASK_EXECUTION_EXCEPTION';
  const errorType = error?.errorType || 'workflow-task';
  const recoveryActions = Array.isArray(error?.recoveryActions) ? error.recoveryActions : [];
  const diagnostics = error?.diagnostics || error?.meta?.diagnostics || undefined;
  let runningCaseFailed = false;

  const cases = (task?.cases || []).map((caseRecord) => {
    if (caseRecord.status === 'running') {
      runningCaseFailed = true;
      const syntheticResult = {
        stepId: error?.stepId || 'task-case-exception',
        stepName: error?.stepName || '用例初始化/执行',
        status: 'failed',
        startedAt: caseRecord.startedAt || occurredAt,
        completedAt: occurredAt,
        endedAt: occurredAt,
        error: errorMessage,
        errorCode,
        errorType,
        recoveryActions,
        diagnostics,
      };
      return {
        ...caseRecord,
        status: 'failed',
        completed: Math.max(Number(caseRecord.completed || 0), 1),
        endedAt: occurredAt,
        finishedAt: occurredAt,
        error: errorMessage,
        errorCode,
        errorType,
        recoveryActions,
        diagnostics,
        results: Array.isArray(caseRecord.results) && caseRecord.results.length > 0
          ? caseRecord.results
          : [syntheticResult],
      };
    }

    if (caseRecord.status === 'pending' || caseRecord.status === 'submitted') {
      return {
        ...caseRecord,
        status: 'stopped',
        endedAt: occurredAt,
        finishedAt: occurredAt,
        error: '前置用例执行异常，当前用例未执行',
      };
    }

    return caseRecord;
  });

  const converged = refreshWorkflowTaskSummary({
    ...task,
    cases,
    status: 'failed',
    completed: cases.filter((item) => ['success', 'failed', 'stopped'].includes(item.status)).length,
    currentCaseName: undefined,
    finishedAt: occurredAt,
    error: errorMessage,
    errorCode,
    errorType,
    recoveryActions,
    diagnostics,
  });

  if (!runningCaseFailed && cases.length > 0 && !cases.some((item) => item.status === 'failed')) {
    converged.summary.failedCount = 0;
  }
  return converged;
}

async function finalizeWorkflowTaskAfterException(task, error) {
  let converged = convergeWorkflowTaskAfterException(task, error);
  if (converged.stress) {
    converged.total = (converged.cases || []).length;
    converged = refreshWorkflowTaskSummary(converged);
  }
  const activeTask = activeWorkflowTasks.get(task?.id);
  if (activeTask?.performanceCollector) converged = applyWorkflowPerformanceSnapshot(converged, await activeTask.performanceCollector.stop());
  await activeTask?.threadStacks?.stop();
  if (activeTask?.taskLogCapture) {
    converged.taskLogs = await activeTask.taskLogCapture.stop();
    delete activeTask.taskLogCapture;
  }
  if (activeTask?.taskRecordingCoordinator) {
    try {
      converged = attachTaskRecordingArtifacts(
        converged,
        await activeTask.taskRecordingCoordinator.finalize()
      );
    } catch (recordingError) {
      converged.recordingFinalizeError = recordingError instanceof Error
        ? recordingError.message
        : String(recordingError);
    }
    delete activeTask.taskRecordingCoordinator;
  }
  if (activeTask?.taskMirrorSessions?.length) {
    await Promise.all(activeTask.taskMirrorSessions.map(stopWorkflowScreenMirror));
    activeTask.taskMirrorSessions = [];
  }
  const packaged = await attachWorkflowTaskReportPackage(converged);
  persistWorkflowTaskRecord(packaged);
  await workflowReportWriter.flush(getWorkflowReportDetailPath(packaged.id));
  return packaged;
}

async function stopWorkflowTaskById(taskId, options = {}) {
  const id = String(taskId || '').trim();
  const force = Boolean(options.force);
  const stoppedAt = new Date().toISOString();

  if (!id) {
    return {
      success: false,
      error: 'Missing taskId',
    };
  }

  const activeTask = activeWorkflowTasks.get(id);
  if (!activeTask) {
    return {
      success: false,
      taskId: id,
      error: `任务不在运行中或无法由当前桌面进程停止：${id}`,
    };
  }

  activeTask.stopRequested = true;
  void activeTask.performanceCollector?.stop().catch(error => console.warn('[performance] stop failed:', error.message));
  void activeTask.threadStacks?.stop().catch(error => console.warn('[thread-stacks] stop failed:', error.message));
  activeTask.force = force;
  activeTask.stopRequestedAt = stoppedAt;
  activeTask.stopReason = force ? '用户请求强制停止任务' : '用户请求停止任务';

  const requestIds = Array.from(new Set([
    activeTask.currentRequestId,
    ...(activeTask.caseRequestIds || []),
  ].filter(Boolean)));

  if (activeTask.task && activeWorkflowTasks.has(id) && !activeTask.task.finishedAt) {
    const stoppingTask = refreshWorkflowTaskSummary({
      ...activeTask.task,
      status: 'stopping',
      stopRequestedAt: stoppedAt,
      stopForce: force,
      error: activeTask.stopReason,
    });
    persistWorkflowTaskRecord(stoppingTask);
  }

  const stopResults = await Promise.all(requestIds.map((requestId) => stopWorkflowRequest(requestId)));

  return {
    success: true,
    taskId: id,
    status: 'stopping',
    force,
    requestIds,
    stoppedRuntimeCount: stopResults.filter((item) => item.runtimeFound).length,
    message: force ? '已接收强制停止请求，正在终止任务并清理资源；完成前仍为stopping。' : '已接收停止请求，正在停止任务并清理资源；完成前仍为stopping。',
  };
}

function writeJsonFileAtomic(filePath, payload, serializedPayload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tempPath, serializedPayload ?? JSON.stringify(payload, null, 2));
  fs.renameSync(tempPath, filePath);
}

function getAudioExtension(mimeType, outputFormat) {
  const requestedFormat = String(outputFormat || '').toLowerCase();
  const mime = String(mimeType || '').toLowerCase();

  if (requestedFormat === 'pcm' || requestedFormat === 'wav') {
    return requestedFormat;
  }

  if (['speex', 'spx', 'ogg-speex'].includes(requestedFormat)) return 'spx';

  if (requestedFormat === 'ogg') {
    return 'ogg';
  }

  if (mime.includes('wav')) return 'wav';
  if (mime.includes('mp4')) return 'm4a';
  if (mime.includes('mpeg')) return 'mp3';
  if (mime.includes('ogg')) return 'ogg';
  return 'webm';
}

function getAudioMimeTypeByExtension(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();

  if (ext === '.wav') return 'audio/wav';
  if (ext === '.ogg' || ext === '.spx' || ext === '.speex') return 'audio/ogg';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.m4a' || ext === '.aac') return 'audio/mp4';
  if (ext === '.webm') return 'audio/webm';
  return 'application/octet-stream';
}

function bufferToDataUrl(buffer, mimeType) {
  return `data:${mimeType};base64,${buffer.toString('base64')}`;
}

function resolveAudioSampleFormatInfo(value) {
  const key = String(value || 'AV_SAMPLE_FMT_S16').trim();
  const sampleType = Number(value);
  const formats = [
    { key: 'AV_SAMPLE_FMT_U8', sampleType: 0, bitDepth: 8, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_S16', sampleType: 1, bitDepth: 16, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_S32', sampleType: 2, bitDepth: 32, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_FLT', sampleType: 3, bitDepth: 32, wavFormat: 3 },
    { key: 'AV_SAMPLE_FMT_DBL', sampleType: 4, bitDepth: 64, wavFormat: 3 },
    { key: 'AV_SAMPLE_FMT_U8P', sampleType: 5, bitDepth: 8, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_S16P', sampleType: 6, bitDepth: 16, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_S32P', sampleType: 7, bitDepth: 32, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_FLTP', sampleType: 8, bitDepth: 32, wavFormat: 3 },
    { key: 'AV_SAMPLE_FMT_DBLP', sampleType: 9, bitDepth: 64, wavFormat: 3 },
    { key: 'AV_SAMPLE_FMT_S64', sampleType: 10, bitDepth: 64, wavFormat: 1 },
    { key: 'AV_SAMPLE_FMT_S64P', sampleType: 11, bitDepth: 64, wavFormat: 1 },
  ];

  return formats.find((format) => format.key === key)
    || formats.find((format) => format.sampleType === sampleType)
    || formats[1];
}

function isGitLfsPointerFile(filePath) {
  try {
    const header = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' }).slice(0, 128);
    return header.startsWith('version https://git-lfs.github.com/spec/v1');
  } catch (_error) {
    return false;
  }
}

function createWavBufferFromRawAudio(rawAudio, options = {}) {
  const sampleFormat = resolveAudioSampleFormatInfo(options.sampleFormat);
  const sampleRate = Number(options.sampleRate) > 0 ? Number(options.sampleRate) : 16000;
  const channelCnt = Number(options.channelCnt) > 0 ? Number(options.channelCnt) : 1;
  const blockAlign = channelCnt * Math.max(1, sampleFormat.bitDepth / 8);
  const byteRate = sampleRate * blockAlign;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + rawAudio.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(sampleFormat.wavFormat, 20);
  header.writeUInt16LE(channelCnt, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(sampleFormat.bitDepth, 34);
  header.write('data', 36);
  header.writeUInt32LE(rawAudio.length, 40);

  return Buffer.concat([header, rawAudio]);
}

function findExecutableOnPath(commandName) {
  const name = String(commandName || '').trim();
  if (!name) return '';
  const pathEntries = String(process.env.PATH || '').split(path.delimiter).filter(Boolean);
  for (const directory of pathEntries) {
    const candidate = path.join(directory, name);
    try {
      if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
        return candidate;
      }
    } catch (_error) {
      // Continue to the next PATH entry.
    }
  }
  return '';
}

function getAdbPath() {
  const bundledAdbPath = resolveMediaRuntime({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  }).adb;
  const configuredAdbPath = String(readEnvironmentConfig().adbPath || '').trim();
  // Respect an explicit user choice in every mode, including packaged apps.
  // A stale configured path is intentionally returned as-is so the caller
  // reports the configuration error instead of silently switching binaries.
  if (configuredAdbPath) {
    return configuredAdbPath;
  }

  const pathAdbPath = process.env.ADB_PATH || findExecutableOnPath('adb');
  if (pathAdbPath) {
    return pathAdbPath;
  }

  const candidates = [
    bundledAdbPath,
    path.join(os.homedir(), 'Library/Android/sdk/platform-tools/adb'),
    '/opt/homebrew/bin/adb',
    '/usr/local/bin/adb',
    'adb',
  ].filter(Boolean);

  return candidates.find((candidate) => candidate === 'adb' || fs.existsSync(candidate)) || 'adb';
}

function getFfmpegPath() {
  const ffmpegPath = resolveMediaRuntime({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  }).ffmpeg;
  return ffmpegPath || (app.isPackaged ? '' : 'ffmpeg');
}

function getRequiredFfmpegPath() {
  const ffmpegPath = getFfmpegPath();
  if (!ffmpegPath || (app.isPackaged && !fs.existsSync(ffmpegPath))) {
    const error = new Error('安装包缺少内置 FFmpeg 运行时，请重新安装完整 solopi-desktop 安装包');
    error.code = 'BUNDLED_FFMPEG_MISSING';
    throw error;
  }
  return ffmpegPath;
}

function runQueuedFfmpegCommand(args, options = {}) {
  return ffmpegProcessQueue.enqueue({
    kind: options.kind || 'ffmpeg',
    taskId: options.taskId,
    caseId: options.caseId,
  }, () => runCommand(
    getRequiredFfmpegPath(),
    args,
    Number(options.timeoutMs || 30000)
  ));
}

function getFfmpegAudioFormat(sampleFormatValue) {
  const sampleFormat = resolveAudioSampleFormatInfo(sampleFormatValue);
  const map = {
    AV_SAMPLE_FMT_U8: 'u8',
    AV_SAMPLE_FMT_S16: 's16le',
    AV_SAMPLE_FMT_S32: 's32le',
    AV_SAMPLE_FMT_FLT: 'f32le',
    AV_SAMPLE_FMT_DBL: 'f64le',
    AV_SAMPLE_FMT_U8P: 'u8',
    AV_SAMPLE_FMT_S16P: 's16le',
    AV_SAMPLE_FMT_S32P: 's32le',
    AV_SAMPLE_FMT_FLTP: 'f32le',
    AV_SAMPLE_FMT_DBLP: 'f64le',
    AV_SAMPLE_FMT_S64: 's64le',
    AV_SAMPLE_FMT_S64P: 's64le',
  };

  return map[sampleFormat.key] || 's16le';
}

function getAudioOutputExtension(outputFormat) {
  const format = String(outputFormat || 'pcm').replace(/^\./, '').toLowerCase();

  if (['speex', 'spx', 'ogg-speex'].includes(format)) return 'spx';
  if (format === 'wav') return 'wav';
  if (format === 'ogg') return 'ogg';
  if (format === 'mp3') return 'mp3';
  if (format === 'm4a' || format === 'aac') return 'm4a';
  if (format === 'webm') return 'webm';
  return 'pcm';
}

async function transcodeAudioFile(sourcePath, targetPath, options = {}) {
  const outputFormat = getAudioOutputExtension(options.outputFormat);
  const sampleRate = Number(options.sampleRate) > 0 ? Number(options.sampleRate) : 16000;
  const channelCnt = Number(options.channelCnt) > 0 ? Number(options.channelCnt) : 1;
  const inputFormat = path.extname(String(sourcePath || '')).toLowerCase() === '.pcm'
    ? getFfmpegAudioFormat(options.sampleFormat)
    : '';
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-progress', 'pipe:1', '-nostats'];
  if (inputFormat) {
    args.push('-f', inputFormat, '-ar', String(sampleRate), '-ac', String(channelCnt));
  }
  args.push('-i', sourcePath, '-ac', String(channelCnt), '-ar', String(sampleRate));

  if (outputFormat === 'pcm') {
    args.push('-f', getFfmpegAudioFormat(options.sampleFormat), targetPath);
  } else if (outputFormat === 'wav') {
    args.push('-sample_fmt', getFfmpegAudioFormat(options.sampleFormat).replace(/le$/, ''), targetPath);
  } else if (outputFormat === 'spx') {
    if (![8000, 16000, 32000].includes(sampleRate) || ![1, 2].includes(channelCnt)) throw new Error('Speex 仅支持 8000/16000/32000Hz 和 1/2 声道');
    args.push('-c:a', 'libspeex', '-q:a', '8', '-page_duration', '60000', '-f', 'ogg', targetPath);
  } else if (outputFormat === 'ogg') {
    args.push('-c:a', 'libopus');
    if (options.bitrate) args.push('-b:a', String(options.bitrate));
    args.push(targetPath);
  } else {
    args.push(targetPath);
  }

  const result = await runQueuedFfmpegCommand(args, {
    kind: 'audio-transcode',
    timeoutMs: Number(options.timeoutMs || 30000),
  });
  const progressMatches = [...String(result.stdout || '').matchAll(/out_time_(?:ms|us)=(\d+)/g)];
  const lastProgress = progressMatches.at(-1);
  return {
    path: targetPath,
    preparedAudioDurationMs: lastProgress ? Math.round(Number(lastProgress[1]) / 1000) : null,
  };
}

function isOggSpeexFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(filePath, 'r');
    const header = Buffer.alloc(290);
    const size = fs.readSync(fd, header, 0, header.length, 0);
    const packetOffset = 27 + header[26];
    return size >= packetOffset + 8 && header.toString('ascii', 0, 4) === 'OggS'
      && header[4] === 0 && header[26] > 0
      && header.toString('ascii', packetOffset, packetOffset + 8) === 'Speex   ';
  } catch {
    return false;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function shouldTranscodeAudioForInput(localPath, config = {}) {
  const outputFormat = getAudioOutputExtension(config.outputFormat || 'pcm');
  const ext = path.extname(String(localPath || '')).replace(/^\./, '').toLowerCase();

  if (outputFormat === 'pcm') {
    return ext !== 'pcm';
  }

  if (outputFormat === 'spx') return !isOggSpeexFile(localPath);
  return ext && ext !== outputFormat;
}

function getHdcPath() {
  const candidates = [
    process.env.HDC_PATH,
    '/Applications/DevEco-Studio.app/Contents/sdk/default/openharmony/toolchains/hdc',
    path.join(os.homedir(), 'Library/OpenHarmony/Sdk/toolchains/hdc'),
    '/opt/homebrew/bin/hdc',
    '/usr/local/bin/hdc',
    'hdc',
  ].filter(Boolean);

  return candidates.find((candidate) => candidate === 'hdc' || fs.existsSync(candidate)) || 'hdc';
}

async function getScrcpyPath() {
  const found = resolveMediaRuntime({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  }).scrcpy;

  if (found) {
    return found;
  }

  if (app.isPackaged) {
    return '';
  }

  try {
    const result = await runCommand(process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh', ['-lc', 'command -v scrcpy'], 3000);
    return result.stdout.trim();
  } catch (_error) {
    return '';
  }
}

function runCommand(command, args, timeout = 5000, signal) {
  signal?.throwIfAborted();
  if (!signal && workflowCommandScope.getStore()) return runCommandWithOptions(command, args, { timeout });
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, ...(signal ? { signal, killSignal: 'SIGKILL' } : {}) }, (error, stdout, stderr) => {
      if (signal?.aborted) { reject(signal.reason); return; }
      if (error) {
        reject(createCommandExecutionError(command, args, error, stdout, stderr, timeout));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function runCommandBuffer(command, args, timeout = 5000) {
  return new Promise((resolve, reject) => {
    execFile(command, args, {
      timeout,
      encoding: 'buffer',
      maxBuffer: 1024 * 1024 * 20,
    }, (error, stdout, stderr) => {
      if (error) {
        reject(createCommandExecutionError(
          command,
          args,
          error,
          stdout?.toString?.() || '',
          stderr?.toString?.() || '',
          timeout
        ));
        return;
      }

      resolve({ stdout, stderr });
    });
  });
}

function isWorkflowCanceled(requestId) {
  return Boolean(requestId && workflowCancelRequests.has(requestId));
}

function createWorkflowStoppedError() {
  const error = new Error('工作流已强制停止');
  error.code = 'WORKFLOW_STOPPED';
  return error;
}

async function sleepWorkflow(ms, requestId) {
  const slice = 200;
  let elapsed = 0;

  while (elapsed < ms) {
    if (isWorkflowCanceled(requestId)) {
      throw createWorkflowStoppedError();
    }

    const next = Math.min(slice, ms - elapsed);
    await sleep(next);
    elapsed += next;
  }
}

let desktopLoginPath;
function getDesktopCommandEnv(extraEnv = {}) {
  if (desktopLoginPath === undefined) {
    desktopLoginPath = '';
    if (process.platform !== 'win32') {
      try {
        desktopLoginPath = execFileSync(process.env.SHELL || (process.platform === 'darwin' ? '/bin/zsh' : '/bin/sh'), ['-lc', 'printf "%s" "$PATH"'], {
          encoding: 'utf8', timeout: 3000, stdio: ['ignore', 'pipe', 'ignore'],
        }).trim().split(path.delimiter).filter((entry) => path.isAbsolute(entry) && !entry.includes('\n')).join(path.delimiter);
      } catch { /* Use inherited PATH and standard system locations. */ }
    }
  }
  const pathParts = [
    extraEnv.PATH,
    desktopLoginPath,
    process.env.PATH,
    '/opt/homebrew/bin',
    '/opt/homebrew/sbin',
    '/usr/local/bin',
    '/usr/local/sbin',
    '/usr/bin',
    '/bin',
    '/usr/sbin',
    '/sbin',
  ].filter(Boolean);

  return {
    ...process.env,
    ...extraEnv,
    PATH: Array.from(new Set(pathParts.join(path.delimiter).split(path.delimiter).filter(Boolean))).join(path.delimiter),
  };
}

function getAdbAwareCommandEnv(extraEnv = {}) {
  const adbPath = getAdbPath();
  const adbDir = adbPath && adbPath !== 'adb' ? path.dirname(adbPath) : '';
  const androidSdkRoot = process.env.ANDROID_SDK_ROOT
    || process.env.ANDROID_HOME
    || path.join(os.homedir(), 'Library/Android/sdk');
  const effectiveAdbPath = adbPath;
  const effectiveAdbDir = adbDir;

  return getDesktopCommandEnv({
    ...extraEnv,
    ADB: effectiveAdbPath,
    ADB_PATH: effectiveAdbPath,
    SCRCPY_ADB: effectiveAdbPath,
    ANDROID_HOME: androidSdkRoot,
    ANDROID_SDK_ROOT: androidSdkRoot,
    PATH: [effectiveAdbDir, extraEnv.PATH].filter(Boolean).join(path.delimiter),
  });
}

function getQuickActionsStorePath() {
  return path.join(app.getPath('userData'), 'quick-actions', 'actions.json');
}

function readQuickActionsStore() {
  const storePath = getQuickActionsStorePath();
  try {
    const parsed = JSON.parse(fs.readFileSync(storePath, 'utf8'));
    return Array.isArray(parsed?.actions) ? parsed.actions : [];
  } catch (_error) {
    return [];
  }
}

function writeQuickActionsStore(actions) {
  const storePath = getQuickActionsStorePath();
  fs.mkdirSync(path.dirname(storePath), { recursive: true, mode: 0o700 });
  const temporaryPath = `${storePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(temporaryPath, JSON.stringify({ version: 1, actions }, null, 2), { mode: 0o600 });
  fs.renameSync(temporaryPath, storePath);
}

function refreshQuickActionsFromSource(actions) {
  return actions.map((action) => {
    try {
      const definition = readQuickActionDefinition(action.scriptPath);
      const hasLegacyUserConfiguration = Boolean(
        action.inputOverrides
        && typeof action.inputOverrides === 'object'
        && Object.keys(action.inputOverrides).length,
      ) || Array.isArray(action.argsOverride);
      const userConfigured = Boolean(action.userConfigured || hasLegacyUserConfiguration);
      const discardedExternalMetadata = Boolean(action.manifestPath);
      if (discardedExternalMetadata) {
        return {
          ...definition,
          id: action.id,
          updatedAt: new Date().toISOString(),
          userConfigured: false,
          configuredInputs: null,
          inputOverrides: {},
          argsOverride: null,
          queryConfig: null,
        };
      }
      const inputOverrides = action.inputOverrides && typeof action.inputOverrides === 'object'
        ? action.inputOverrides
        : {};
      const configuredInputs = userConfigured && Array.isArray(action.configuredInputs)
        ? action.configuredInputs
        : null;
      return {
        ...action,
        ...definition,
        id: action.id,
        name: action.name || definition.name,
        description: action.description || definition.description,
        inputs: configuredInputs || definition.inputs.map((input) => ({
          ...input,
          ...(inputOverrides[input.key] || {}),
          key: input.key,
        })),
        configuredInputs,
        inputOverrides,
        args: Array.isArray(action.argsOverride) ? action.argsOverride : definition.args,
        argsOverride: Array.isArray(action.argsOverride) ? action.argsOverride : null,
        queryConfig: action.queryConfig || definition.queryConfig || null,
        sessionConfig: action.sessionConfig ?? definition.sessionConfig ?? null,
        userConfigured,
      };
    } catch (_error) {
      return action;
    }
  });
}

function runCommandWithOptions(command, args, options = {}) {
  const gitRuntime = gitRuntimeCommand(command, args, { env: getDesktopCommandEnv(options.env), isPackaged: app.isPackaged, resourcesPath: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources') });
  command = gitRuntime.command; args = gitRuntime.args; options = { ...options, env: gitRuntime.env };
  const timeout = options.timeout || 30000;
  const requestId = workflowCommandScope.getStore();
  const signal = quickActionSignalScope.getStore();
  signal?.throwIfAborted();
  return runManagedCommand(command, args, {
    timeout, cwd: options.cwd,
    maxBuffer: options.maxBuffer || 1024 * 1024 * 10,
    env: getDesktopCommandEnv(options.env),
  }, (cancel) => {
    if (signal) { const abort = () => cancel(); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) cancel(); return () => signal.removeEventListener('abort', abort); }
    if (!requestId) return () => {};
    if (isWorkflowCanceled(requestId)) { cancel(); return () => {}; }
    const pending = workflowCommandCancels.get(requestId) || new Set();
    workflowCommandCancels.set(requestId, pending);
    pending.add(cancel);
    return () => {
      pending.delete(cancel);
      if (!pending.size) workflowCommandCancels.delete(requestId);
    };
  }).catch((error) => {
    if (error.code === 'WORKFLOW_STOPPED') throw error;
    throw createCommandExecutionError(command, args, error, error.stdout, error.stderr, timeout);
  });
}

function getCommandFailureReason(cause = {}) {
  const recorded = cause.meta?.commandExecution?.terminationReason;
  if (recorded) return recorded;
  if (cause.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER') return 'output-limit';
  if (cause.code === 'WORKFLOW_STOPPED') return 'stopped';
  if (cause.code === 'ETIMEDOUT' || cause.killed) return 'timeout';
  if (['ENOENT', 'EACCES', 'ENOEXEC'].includes(cause.code)) return 'spawn-error';
  return 'exit-error';
}

function formatCommandExecutionError(command, args = [], error, stdout = '', stderr = '', timeout = 0) {
  const commandLine = [command, ...(Array.isArray(args) ? args : [])].join(' ');
  const details = [
    `Command failed: ${commandLine}`,
    `exitCode: ${typeof error?.exitCode === 'number' ? error.exitCode : typeof error?.code === 'number' ? error.code : 'unknown'}`,
    typeof error?.code === 'string' ? `processErrorCode: ${error.code}` : '',
    `terminationReason: ${getCommandFailureReason(error)}`,
    `signal: ${error?.signal || 'none'}`,
    getCommandFailureReason(error) === 'timeout' ? `timeoutMs: ${timeout || 'unknown'}` : '',
    stderr ? `[stderr]\n${String(stderr).trim()}` : '[stderr]\n(empty)',
    stdout ? `[stdout]\n${String(stdout).trim()}` : '[stdout]\n(empty)',
    error?.message ? `message: ${error.message}` : '',
  ].filter(Boolean);

  return details.join('\n');
}

function createCommandExecutionError(command, args = [], cause, stdout = '', stderr = '', timeout = 0) {
  const message = formatCommandExecutionError(command, args, cause, stdout, stderr, timeout);
  const error = new Error(message);
  const exitCode = typeof cause?.exitCode === 'number' ? cause.exitCode : typeof cause?.code === 'number' ? cause.code : null;
  const signal = cause?.signal || null;
  const terminationReason = getCommandFailureReason(cause);
  const timedOut = terminationReason === 'timeout';
  const normalizedStdout = String(stdout || '');
  const normalizedStderr = String(stderr || '');
  const commandLine = [command, ...(Array.isArray(args) ? args : [])].join(' ');
  error.code = 'COMMAND_EXECUTION_FAILED';
  error.errorCode = 'COMMAND_EXECUTION_FAILED';
  error.errorType = 'command-execution';
  if (timedOut) { error.code = error.errorCode = 'COMMAND_EXECUTION_TIMEOUT'; error.errorType = 'command-timeout'; }
  else if (terminationReason === 'output-limit') { error.code = error.errorCode = 'COMMAND_OUTPUT_LIMIT_EXCEEDED'; error.errorType = 'command-output-limit'; }
  else if (terminationReason === 'spawn-error') { error.code = error.errorCode = 'COMMAND_START_FAILED'; error.errorType = 'command-start'; }
  error.meta = { ...(cause?.meta || {}) };
  error.processErrorCode = typeof cause?.code === 'string' ? cause.code : null;
  error.timedOut = timedOut;
  error.command = commandLine;
  error.exitCode = exitCode;
  error.signal = signal;
  error.stdout = normalizedStdout;
  error.stderr = normalizedStderr;
  error.timeoutMs = timedOut ? timeout : null;
  error.recoveryActions = [
    '检查 command、设备连接状态和可执行文件路径后重试。',
    '查看结构化 exitCode、stderr、signal 和 timeoutMs 定位底层命令失败原因。',
    '如果命令依赖 ADB，运行 glassbox devices list --json 确认设备和 ADB 路径。',
  ];
  error.diagnostics = createWorkflowErrorDiagnostics(
    error.errorCode,
    error.errorType,
    message,
    error.recoveryActions,
    {
      command: commandLine,
      exitCode,
      signal,
      stdout: normalizedStdout,
      stderr: normalizedStderr,
      timeoutMs: error.timeoutMs,
      terminationReason,
      processErrorCode: error.processErrorCode,
      commandExecution: cause?.meta?.commandExecution || null,
    }
  );
  return error;
}

function normalizeOpenAiCompatibleChatUrl(baseUrl) {
  const value = String(baseUrl || '').trim().replace(/\/+$/, '');

  if (!value) {
    throw new Error('缺少模型 Base URL');
  }

  if (/\/chat\/completions$/i.test(value)) {
    return value;
  }

  if (/\/v1$/i.test(value)) {
    return `${value}/chat/completions`;
  }

  return `${value}/v1/chat/completions`;
}

function getLlmProviderDiagnosticLabel(provider = {}) {
  return [
    String(provider.name || '').trim() || 'OpenAI Compatible',
    String(provider.model || '').trim(),
  ].filter(Boolean).join(' / ');
}

function classifyLlmServiceError(status, message = '') {
  const text = String(message || '').toLowerCase();

  if (
    status === 401
    || status === 403
    || /access denied|unauthorized|forbidden|invalid api key|invalid_api_key|permission/.test(text)
  ) {
    return 'LLM_ACCESS_DENIED';
  }

  if (status === 402 || /overdue|payment|quota|insufficient_quota/.test(text)) {
    return 'LLM_ACCOUNT_LIMITED';
  }

  if (status === 429 || /rate limit|too many requests/.test(text)) {
    return 'LLM_RATE_LIMITED';
  }

  return 'LLM_SERVICE_ERROR';
}

function createLlmServiceError(provider, response, bodyText = '', parsedBody = null) {
  const serviceMessage = parsedBody?.error?.message || bodyText || `HTTP ${response.status}`;
  const code = classifyLlmServiceError(response.status, serviceMessage);
  const diagnosticLabel = getLlmProviderDiagnosticLabel(provider);
  const error = new Error(`模型服务请求失败（${diagnosticLabel}）：${serviceMessage}`);

  error.code = code;
  error.httpStatus = response.status;
  error.providerName = String(provider.name || '').trim();
  error.providerId = String(provider.id || '').trim();
  error.model = String(provider.model || '').trim();
  error.baseUrl = String(provider.baseUrl || '').trim();
  error.serviceMessage = serviceMessage;
  return error;
}

function isLlmServiceError(error) {
  return typeof error?.code === 'string' && error.code.startsWith('LLM_');
}

function formatLlmServiceErrorDebug(error) {
  const title = error.code === 'LLM_ACCESS_DENIED' || error.code === 'LLM_ACCOUNT_LIMITED'
    ? '模型服务访问被拒绝或账号状态不可用'
    : error.code === 'LLM_CANDIDATE_LIMIT' ? '候选日志判断未通过' : '模型服务请求失败';

  return [
    title,
    `错误分类：${error.code || 'LLM_SERVICE_ERROR'}`,
    `HTTP 状态：${error.httpStatus || '-'}`,
    `模型配置：${[error.providerName || error.providerId || '默认模型', error.model].filter(Boolean).join(' / ') || '-'}`,
    `Base URL：${error.baseUrl || '-'}`,
    `服务返回：${error.serviceMessage || error.message || '-'}`,
    error.code === 'LLM_REQUEST_TIMEOUT' ? '单次模型请求超时；请结合下方每次请求耗时与重试记录查看，不能据此判断账号或密钥异常。'
      : error.code === 'LLM_CANDIDATE_LIMIT' ? '已达到候选判断次数上限，业务结果尚未通过；请检查候选日志和断言结果。'
      : error.code === 'LLM_RESPONSE_TRUNCATED' ? '模型输出达到上限且未完整结束；请检查输出预算、思考配置与重试记录。'
      : '请检查模型响应、协议或设置中心的连接配置；权限和额度问题以服务返回为准。',
  ].join('\n');
}

async function requestOpenAiCompatibleChat(provider = {}, messages = [], options = {}) {
  const controller = new AbortController();
  const release = bindWorkflowNetworkAbort(controller);
  const policy = require('./workflow-llm-output-policy').createOutputPolicy(provider, options);
  let metadata = null;
  try {
    const result = await require('./workflow-llm-retry').run(
      async ({ timeoutMs }) => {
        const value = await requestOpenAiCompatibleChatOnce(provider, messages, {
          ...policy.options(), timeoutMs,
          onResponse: value => { metadata = value; options.onResponse?.(value); },
        });
        options.validateResponse?.(value);
        return value;
      },
      { perAttempt: options.perAttemptTimeout === true, timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 45000,
        signal: controller.signal, recover: error => policy.recover(error) || error.code === 'LLM_ASSERT_PROTOCOL_ERROR' });
    options.onResponse?.({ ...metadata, llmRetry: result.retry, llmOutputPolicy: policy.diagnostics() });
    return result.value;
  } catch (error) {
    error.meta = { ...(error.meta || {}), llmOutputPolicy: policy.diagnostics() };
    throw error;
  } finally { release(); }
}

async function requestOpenAiCompatibleChatOnce(provider = {}, messages = [], options = {}) {
  provider = { ...provider, ...revealSecrets({ apiKey: provider.apiKey }, safeStorage) };
  const apiKey = String(provider.apiKey || '').trim();
  const model = String(provider.model || '').trim();

  if (!model) {
    throw new Error('缺少模型名称');
  }

  const requestBody = {
    model,
    messages,
    temperature: options.temperature ?? 0.2,
    max_tokens: options.maxTokens,
    stream: false,
  };
  if (options.jsonMode) {
    requestBody.response_format = { type: 'json_object' };
  }
  if (options.disableThinking) {
    requestBody.thinking = { type: 'disabled' };
  } else if (options.enableThinking) {
    requestBody.thinking = { type: 'enabled' };
  }

  const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 45000;
  const controller = new AbortController();
  const release = bindWorkflowNetworkAbort(controller);
  const startedAt = Date.now();
  const timeoutError = Object.assign(new Error(`LLM 请求超时：${timeoutMs}ms`), { code: 'LLM_REQUEST_TIMEOUT', timeoutMs });
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  let response, text;
  try {
    response = await fetch(normalizeOpenAiCompatibleChatUrl(provider.baseUrl), {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(apiKey ? {Authorization: `Bearer ${apiKey}`} : {}),
    },
    body: JSON.stringify(requestBody),
    signal: controller.signal,
  });
    text = await response.text();
    controller.signal.throwIfAborted();
  } catch(error) {
    if (controller.signal.aborted) {
      if(controller.signal.reason===timeoutError)timeoutError.diagnostics={category:'timeout',purpose:'workflow-llm',timeoutMs,durationMs:Date.now()-startedAt};
      throw controller.signal.reason;
    }
    throw error;
  } finally {
    clearTimeout(timer);
    release();
  }
  let data = null;

  try {
    data = text ? JSON.parse(text) : null;
  } catch (_error) {
    data = null;
  }

  if (!response.ok) {
    const error=createLlmServiceError({ ...provider, model }, response, text, data);
    const retryAfter=response.headers?.get('retry-after');
    if(retryAfter){const seconds=Number(retryAfter);error.retryAfterMs=Number.isFinite(seconds)?Math.max(0,seconds*1000):Math.max(0,Date.parse(retryAfter)-Date.now())||0;}
    throw error;
  }

  const content = data?.choices?.[0]?.message?.content
    || data?.choices?.[0]?.text
    || data?.output_text
    || '';
  const metadata = {
    model, requestedMaxTokens: options.maxTokens, finishReason: data?.choices?.[0]?.finish_reason || null,
    responseId: data?.id || null, usage: data?.usage || null,
    outputCharacters: String(content || '').length,
    reasoningCharacters: String(data?.choices?.[0]?.message?.reasoning_content || '').length,
    thinkingDisabledRequested: options.disableThinking === true,
    reasoningReturnedWhileDisabled: options.disableThinking === true && String(data?.choices?.[0]?.message?.reasoning_content || '').length > 0,
  };
  options.onResponse?.(metadata);
  const result = String(content || '').trim();
  if (!result || metadata.finishReason === 'length') {
    const error = new Error(metadata.finishReason === 'length'
      ? 'LLM 输出达到 token 上限，响应未完整结束'
      : 'LLM 服务返回空内容，不能作为有效生成结果');
    error.code = metadata.finishReason === 'length' ? 'LLM_RESPONSE_TRUNCATED' : 'LLM_RESPONSE_EMPTY';
    error.meta = { llmResponse: metadata };
    error.stdout = `LLM Response Metadata:\n${JSON.stringify(metadata, null, 2)}\n\nRaw Response:\n${result}`;
    throw error;
  }
  return result;
}

function bindWorkflowNetworkAbort(controller) {
  const requestId = workflowCommandScope.getStore();
  if (!requestId) return () => {};
  const cancel = () => controller.abort(createWorkflowStoppedError());
  if (isWorkflowCanceled(requestId)) { cancel(); return () => {}; }
  const pending = workflowCommandCancels.get(requestId) || new Set();
  workflowCommandCancels.set(requestId, pending);
  pending.add(cancel);
  return () => {
    pending.delete(cancel);
    if (!pending.size) workflowCommandCancels.delete(requestId);
  };
}

function resolveWorkflowLlmProvider(context, config = {}) {
  const providers = Array.isArray(context.llmProviders) ? context.llmProviders : [];
  const providerId = String(config.providerId || '').trim();
  const selectedId = String(context.selectedLlmProviderId || '').trim();
  const provider = providers.find((item) => item.id === providerId)
    || providers.find((item) => item.id === selectedId)
    || providers[0];

  if (!provider) {
    throw new Error('缺少模型配置，请先在设置中心配置模型 Base URL、API Key 和模型名称');
  }

  return {
    ...provider,
    // Model identity belongs to the selected provider; ignore legacy node overrides.
    model: provider.model,
  };
}

function stripJsonCodeFence(value) {
  const text = String(value || '').trim();
  const match = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : text;
}

function parseLlmJsonResponse(content) {
  const text = stripJsonCodeFence(content);

  try {
    return JSON.parse(text);
  } catch (_error) {
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(text.slice(firstBrace, lastBrace + 1));
    }
    if (text.includes('{') && !text.includes('}')) {
      throw new Error('LLM 输出被截断，JSON 未闭合');
    }
    throw new Error('LLM 输出不是合法 JSON');
  }
}

function validateLlmAssertResponse(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('LLM 断言输出必须是 JSON 对象');
  }

  if (typeof value.pass !== 'boolean') {
    throw new Error('LLM 断言输出缺少 boolean 类型 pass 字段');
  }

  return {
    pass: value.pass,
    confidence: typeof value.confidence === 'number' ? value.confidence : undefined,
    expected: value.expected ?? '',
    actual: value.actual ?? '',
    reason: String(value.reason || ''),
    evidence: Array.isArray(value.evidence) ? value.evidence : [],
    raw: value,
  };
}

async function requestWorkflowLlmAssert(provider, payload, options = {}) {
  const protocol = [
    '你是 solopi-desktop 自动化断言引擎。',
    '请根据用户断言诉求、运行时变量和当前日志判断断言是否通过。',
    '你必须只输出 JSON，不要输出 Markdown、解释或多余文本。',
    '只输出一行紧凑 JSON，必须包含 boolean 类型的 pass 字段。',
    '仅输出 pass、confidence、expected、actual、reason、evidence 六个字段，不增加分析过程字段。',
    'expected、actual 各不超过60字，reason 不超过100字；confidence 为0到100的数字；evidence 最多2条，每条不超过60字。',
    '只列决定通过或失败的关键字段和值，不复制整段JSON、片单、日志或用户提示词。总输出尽量控制在400字以内。',
    '完整核对全部业务条件；精简的是解释篇幅，不得省略校验条件、修改期望或把证据不足判为通过。',
    '不要复述完整日志，不要输出 Markdown，不要输出换行解释。',
    '格式示例：{"pass":false,"confidence":80,"expected":"type 应为 OrderPreview","actual":"type 为 Other","reason":"类型不匹配","evidence":[]}',
  ].join('\n');
  const userContent = JSON.stringify(payload);
  let responseMetadata = null;
  const rawContent = await requestOpenAiCompatibleChat(provider, [
    { role: 'system', content: protocol },
    { role: 'user', content: userContent },
  ], {
    workflowOutput: true,
    perAttemptTimeout: true,
    temperature: Number(options.temperature ?? 0.1),
    maxTokens: Math.max(Number(options.maxTokens || 4096), 1024),
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 15000,
    onResponse: metadata => { responseMetadata = metadata; },
    validateResponse: content => {
      try { validateLlmAssertResponse(parseLlmJsonResponse(content)); }
      catch (error) { throw Object.assign(new Error(`LLM 断言输出不符合协议：${error.message}`), { code: 'LLM_ASSERT_PROTOCOL_ERROR' }); }
    },
    jsonMode: provider.responseFormat === 'json_object' && provider.capabilities?.responseFormat === 'supported',
  });
  return { rawContent, assertion: validateLlmAssertResponse(parseLlmJsonResponse(rawContent)), llmResponse: responseMetadata };
}

function createLlmAssertLogPayload(line, config) {
  const lineRegex = String(config.lineRegex || config.pattern || '').trim();
  let extractedContent = line;
  let parsedContent = null;
  let parseError = '';

  if (lineRegex) {
    try {
      const regexp = new RegExp(lineRegex, config.caseSensitive === false ? 'i' : '');
      const match = regexp.exec(line);
      extractedContent = match?.groups?.json ?? match?.[1] ?? line;
    } catch (error) {
      parseError = `正则解析失败：${error.message}`;
    }
  }

  try {
    parsedContent = parseLogJsonPayload(extractedContent);
  } catch (error) {
    if (!parseError) {
      parseError = error.message;
    }
  }

  return {
    line,
    extractedContent,
    parsedContent,
    parseError,
  };
}

function createLlmAssertRequestPayload(assertionPrompt, variables, logPayload) {
  return {
    assertion: assertionPrompt,
    variables: variables || {},
    currentLog: logPayload.line,
    currentExtractedContent: logPayload.extractedContent,
    currentJson: logPayload.parsedContent || undefined,
  };
}

function createLlmAssertCurrentLogDebugSection(requestPayload) {
  const currentJson = requestPayload.currentJson
    ? JSON.stringify(requestPayload.currentJson, null, 2)
    : '';

  return [
    '当前节点提取结果：',
    `当前节点命中日志：\n${requestPayload.currentLog || ''}`,
    `当前节点正则提取内容：\n${requestPayload.currentExtractedContent || ''}`,
    currentJson ? `当前节点解析 JSON：\n${currentJson}` : '',
  ].filter(Boolean).join('\n\n');
}

function formatLlmAssertDebugOutput({ assertionPrompt, requestPayload, result, rawContent, protocolError }) {
  return [
    `真实断言诉求：\n${assertionPrompt}`,
    `命中日志：\n${requestPayload.currentLog || ''}`,
    `正则提取内容：\n${requestPayload.currentExtractedContent || ''}`,
    requestPayload.currentJson ? `解析后的当前 JSON：\n${JSON.stringify(requestPayload.currentJson, null, 2)}` : '',
    `发送给 LLM 的 User Prompt JSON：\n${JSON.stringify(requestPayload, null, 2)}`,
    result ? `LLM 判断结果：\n${JSON.stringify(result, null, 2)}` : '',
    rawContent ? `LLM Raw Response：\n${rawContent}` : '',
    protocolError ? `LLM 协议错误：${protocolError}` : '',
    createLlmAssertCurrentLogDebugSection(requestPayload),
  ].filter(Boolean).join('\n\n');
}

function getSimpleJsonPathValue(source, expression) {
  const pathExpression = String(expression || '').trim();

  if (!pathExpression || pathExpression === '$') {
    return source;
  }

  const normalized = pathExpression
    .replace(/^\$\./, '')
    .replace(/^\$/, '')
    .replace(/\[(\d+)\]/g, '.$1');

  if (!normalized) {
    return source;
  }

  return normalized
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), source);
}

function setSimpleJsonPathValue(target, expression, value) {
  const rawPath = String(expression || '').trim()
    .replace(/^\$\./, '')
    .replace(/^\$/, '')
    .replace(/\[(\d+)\]/g, '.$1');
  const parts = rawPath.split('.').map((part) => part.trim()).filter(Boolean);

  if (parts.length === 0) {
    return;
  }

  let current = target;
  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  });
  current[parts[parts.length - 1]] = value;
}

function buildLlmJsonOutputInstruction(saveToVariables = {}) {
  const sample = {};

  Object.entries(saveToVariables).forEach(([variableName, pathExpression]) => {
    const pathValue = String(pathExpression || '').trim();
    if (!pathValue || pathValue === '$.text') {
      return;
    }

    setSimpleJsonPathValue(sample, pathValue, `请填入 ${variableName}`);
  });

  if (Object.keys(sample).length === 0) {
    return '';
  }

  return [
    '请只输出 JSON，不要输出 Markdown、解释或多余文本。',
    'JSON 必须符合下面的字段结构：',
    JSON.stringify(sample, null, 2),
  ].join('\n');
}

function normalizeLlmVariableMappings(config = {}, outputMode = 'json') {
  const storedMappings = Array.isArray(config.outputMappings) ? config.outputMappings : [];
  const saveToVariables = {};
  const fallback = {};

  storedMappings.forEach((item) => {
    const variableName = String(item?.variableName || '').trim().replace(/^variables\./, '');
    const rawPath = String(item?.outputPath || '').trim();

    if (!variableName) {
      return;
    }

    if (!rawPath) {
      saveToVariables[variableName] = outputMode === 'text' ? '$.text' : '$';
    } else if (rawPath === '$' || rawPath.startsWith('$.')) {
      saveToVariables[variableName] = rawPath;
    } else {
      saveToVariables[variableName] = `$.${rawPath}`;
    }

    if (item.fallbackValue !== undefined && item.fallbackValue !== null && String(item.fallbackValue) !== '') {
      fallback[variableName] = String(item.fallbackValue);
    }
  });

  if (Object.keys(saveToVariables).length > 0) {
    return { saveToVariables, fallback };
  }

  return {
    saveToVariables: Object.keys(parseWorkflowJsonObject(config.saveToVariablesText)).length > 0
      ? parseWorkflowJsonObject(config.saveToVariablesText)
      : parseWorkflowJsonObject(config.saveToVariables),
    fallback: Object.keys(parseWorkflowJsonObject(config.fallbackText)).length > 0
      ? parseWorkflowJsonObject(config.fallbackText)
      : parseWorkflowJsonObject(config.fallback),
  };
}

function parseHttpHeaders(value) {
  const raw = String(value || '').trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('headers 不是 JSON 对象');
    }

    return Object.fromEntries(
      Object.entries(parsed)
        .map(([key, item]) => [String(key).trim(), String(item ?? '')])
        .filter(([key]) => key)
    );
  } catch (error) {
    throw new Error(`HTTP 请求节点 headersText 不是合法 JSON：${error.message}`);
  }
}

function matchesExpectedHttpStatus(status, expectedStatus) {
  const raw = String(expectedStatus || '2xx').trim();

  if (!raw) {
    return status >= 200 && status < 300;
  }

  return raw.split(/[\s,]+/).some((item) => {
    const token = item.trim().toLowerCase();

    if (!token) {
      return false;
    }

    if (/^\dxx$/.test(token)) {
      const base = Number(token[0]) * 100;
      return status >= base && status < base + 100;
    }

    const rangeMatch = token.match(/^(\d{3})-(\d{3})$/);
    if (rangeMatch) {
      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      return status >= start && status <= end;
    }

    return Number(token) === status;
  });
}

async function executeHttpRequestStep(step, config) {
  const method = String(config.method || 'GET').trim().toUpperCase();
  const url = String(config.url || '').trim();
  const responseType = String(config.responseType || 'json').trim().toLowerCase();
  const headers = parseHttpHeaders(config.headersText || config.headers);
  const timeoutMs = Number(step.timeoutMs || config.timeoutMs || 15000);
  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), timeoutMs);
  const command = `HTTP ${method} ${url || '<missing-url>'}`;

  if (!url) {
    clearTimeout(timeoutTimer);
    throw createHttpRequestStepFailure('HTTP 请求节点缺少 URL', command, 'HTTP request URL is empty.', {
      code: 'HTTP_REQUEST_MISSING_URL',
      details: { method, url },
    });
  }

  const requestOptions = {
    method,
    headers,
    signal: controller.signal,
  };
  const bodyText = String(config.bodyText || '').trim();

  if (!['GET', 'HEAD'].includes(method) && bodyText) {
    requestOptions.body = bodyText;
    if (!Object.keys(headers).some((key) => key.toLowerCase() === 'content-type')) {
      requestOptions.headers = {
        'Content-Type': 'application/json',
        ...headers,
      };
    }
  }

  let response;
  let text = '';
  const release = bindWorkflowNetworkAbort(controller);

  try {
    response = await fetch(url, requestOptions);
    text = await response.text();
  } catch (error) {
    if (controller.signal.reason?.code === 'WORKFLOW_STOPPED') throw controller.signal.reason;
    if (error.name === 'AbortError') {
      throw createHttpRequestStepFailure(`HTTP 请求超时：${timeoutMs}ms`, command, '', {
        code: 'HTTP_REQUEST_TIMEOUT',
        details: { method, url, timeoutMs },
      });
    }
    throw createHttpRequestStepFailure(`HTTP 请求失败：${error.message || String(error)}`, command, '', {
      code: 'HTTP_REQUEST_NETWORK_ERROR',
      details: {
        method,
        url,
        errorName: error.name || '',
      },
    });
  } finally {
    clearTimeout(timeoutTimer);
    release();
  }

  let parsedResponse = text;
  if (responseType === 'json') {
    try {
      parsedResponse = text ? JSON.parse(text) : null;
    } catch (error) {
      const httpResponse = createHttpResponseEvidence(response, text);
      throw createHttpRequestStepFailure(`HTTP 响应不是合法 JSON：${error.message}`, command, formatHttpResponseEvidence(httpResponse), {
        code: 'HTTP_RESPONSE_INVALID_JSON',
        details: {
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          httpResponse,
        },
        meta: { httpResponse },
      });
    }
  }

  if (!matchesExpectedHttpStatus(response.status, config.expectedStatus || '2xx')) {
    const httpResponse = createHttpResponseEvidence(response, text, parsedResponse);
    const preview = typeof parsedResponse === 'string' ? parsedResponse : JSON.stringify(parsedResponse);
    throw createHttpRequestStepFailure(
      `HTTP 状态不符合预期：${response.status} ${response.statusText}，期望 ${config.expectedStatus || '2xx'}${preview ? `\n${preview.slice(0, 1000)}` : ''}`,
      command,
      formatHttpResponseEvidence(httpResponse),
      {
        code: 'HTTP_STATUS_UNEXPECTED',
        details: {
          method,
          url,
          status: response.status,
          statusText: response.statusText,
          expectedStatus: config.expectedStatus || '2xx',
          httpResponse,
        },
        meta: { httpResponse },
      }
    );
  }

  const httpResponse = createHttpResponseEvidence(response, text, parsedResponse);
  return {
    status: response.status,
    statusText: response.statusText,
    headers: Object.fromEntries(response.headers.entries()),
    body: parsedResponse,
    rawText: text,
  };
}

function isHttpRequestFailFastEnabled(value, defaultValue = true) {
  if (value === undefined || value === null || value === '') {
    return defaultValue;
  }

  return value === true || value === 'true' || value === 1 || value === '1';
}

function parseHttpBusinessErrorPaths(value) {
  const raw = String(value ?? '$.data.error').trim();

  if (!raw) {
    return [];
  }

  return raw
    .split(/[\n,]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isEmptySavedHttpVariableValue(value) {
  if (value === undefined || value === null) {
    return true;
  }

  if (typeof value === 'string') {
    return value.trim() === '';
  }

  if (Array.isArray(value)) {
    return value.length === 0;
  }

  if (typeof value === 'object') {
    return Object.keys(value).length === 0;
  }

  return false;
}

function getHttpRequestRecoveryActions(code) {
  if (code === 'HTTP_REQUEST_MISSING_URL') {
    return ['填写 HTTP 节点 URL 后重试。'];
  }

  if (code === 'HTTP_REQUEST_TIMEOUT') {
    return [
      '确认外部服务在当前网络可达。',
      '检查 HTTP 节点 timeoutMs 是否过短。',
      '必要时先用 curl 或浏览器验证同一 URL。',
    ];
  }

  if (code === 'HTTP_STATUS_UNEXPECTED') {
    return [
      '检查 HTTP 节点 expectedStatus 配置是否符合接口契约。',
      '查看响应预览和服务端日志，确认外部服务是否返回错误。',
      '如非 2xx 是预期结果，请显式配置 expectedStatus。',
    ];
  }

  if (code === 'HTTP_RESPONSE_INVALID_JSON') {
    return [
      '确认 responseType 是否应为 json；如果接口返回文本，请切换为 text。',
      '检查响应预览是否是 HTML、网关错误页或空响应。',
    ];
  }

  if (code === 'HTTP_BUSINESS_ERROR') {
    return [
      '检查 failOnBusinessErrorPath 命中的响应字段。',
      '确认外部服务入参、环境、鉴权和测试数据是否满足前置条件。',
      '修复外部服务返回错误后重跑任务。',
    ];
  }

  if (code === 'HTTP_VARIABLE_EXTRACTION_FAILED') {
    return [
      '检查 saveToVariables JSONPath 是否与实际响应结构一致。',
      '确认后续节点依赖的变量在响应中存在且非空。',
      '如允许缺失变量继续执行，可关闭对应 fail-fast 配置。',
    ];
  }

  return [
    '运行同一 HTTP 请求做外部服务连通性验证。',
    '检查 URL、method、headers、body、网络和代理配置。',
  ];
}

function createWorkflowErrorDiagnostics(code, type, message, recoveryActions = [], details = {}) {
  return {
    schemaVersion: 'glassbox.error.v1',
    code,
    type,
    message,
    recoveryActions,
    details,
  };
}

function createHttpRequestStepFailure(message, command, stdout, options = {}) {
  const code = options.code || 'HTTP_REQUEST_FAILED';
  const recoveryActions = options.recoveryActions || getHttpRequestRecoveryActions(code);
  const diagnostics = createWorkflowErrorDiagnostics(
    code,
    'external-service',
    message,
    recoveryActions,
    options.details || {}
  );
  const error = new Error(message);
  error.code = code;
  error.errorCode = code;
  error.errorType = 'external-service';
  error.recoveryActions = recoveryActions;
  error.diagnostics = diagnostics;
  error.command = command;
  error.stdout = stdout;
  error.stderr = message;
  error.meta = {
    ...(options.meta || {}),
    diagnostics,
  };
  return error;
}

function writeWorkflowVariable(context, key, value) {
  const normalizedKey = String(key || '').trim().replace(/^variables\./, '');

  if (!normalizedKey) {
    return;
  }

  const parts = normalizedKey.split('.').map((part) => part.trim()).filter(Boolean);
  let current = context.variables;

  parts.slice(0, -1).forEach((part) => {
    if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) {
      current[part] = {};
    }
    current = current[part];
  });

  current[parts[parts.length - 1]] = value;
}

function getWorkflowVariable(context, key) {
  const normalizedKey = String(key || '').trim().replace(/^variables\./, '');

  if (!normalizedKey) {
    return undefined;
  }

  return normalizedKey.split('.').filter(Boolean).reduce((current, part) => (
    current && typeof current === 'object' ? current[part] : undefined
  ), context.variables || {});
}

function validateWorkflowVariableName(name) {
  const normalizedName = String(name || '').trim().replace(/^variables\./, '');

  if (!normalizedName) {
    throw new Error('提取变量已开启，但变量名为空');
  }

  if (!/^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z_][A-Za-z0-9_]*)*$/.test(normalizedName)) {
    throw new Error(`提取变量名不合法：${normalizedName}。请使用 extractedJson / order.info 这类字母、数字、下划线和点号组成的变量名`);
  }

  return normalizedName;
}

function createUniqueWorkflowVariableName(context, baseName = 'extractedJson') {
  const base = validateWorkflowVariableName(baseName);

  if (getWorkflowVariable(context, base) === undefined) {
    return base;
  }

  let index = 2;
  while (getWorkflowVariable(context, `${base}${index}`) !== undefined) {
    index += 1;
  }

  return `${base}${index}`;
}

function getCaseLibrariesRoot() {
  return path.join(app.getPath('userData'), 'case-libraries');
}

function normalizeGitBranch(branch) {
  return String(branch || 'master').trim() || 'master';
}

function getCaseLibraryRepoId(repoUrl, branch = 'master') {
  return crypto.createHash('sha1')
    .update(`${String(repoUrl || '').trim()}#${normalizeGitBranch(branch)}`)
    .digest('hex')
    .slice(0, 16);
}

function buildAuthenticatedGitUrl(repoUrl) {
  const raw = String(repoUrl || '').trim();
  if (!/^https?:\/\//i.test(raw)) return raw;
  const parsed = new URL(raw);
  if (parsed.username || parsed.password) {
    throw new Error('请勿在仓库 URL 中填写凭据，请使用认证配置');
  }
  return parsed.toString();
}

function stripGitCredentialFromMessage(message) {
  return String(message || '').replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/gi, '$1[REDACTED]@');
}

const CASE_LIBRARY_AUDIO_EXTENSIONS = new Set(['.pcm', '.wav', '.ogg', '.spx', '.speex', '.mp3', '.m4a', '.webm']);
const CASE_LIBRARY_IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);

function toPosixRelativePath(fromDir, targetPath) {
  return path.relative(fromDir, targetPath).split(path.sep).join('/');
}

function isLikelyCaseLibraryAsset(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return CASE_LIBRARY_AUDIO_EXTENSIONS.has(ext) || CASE_LIBRARY_IMAGE_EXTENSIONS.has(ext);
}

function isGeneratedTtsAudioPath(filePath) {
  const value = String(filePath || '').trim();
  if (!value || !path.isAbsolute(value)) {
    return false;
  }

  const resolvedPath = path.resolve(value);
  const resolvedTtsDir = path.resolve(getTtsAudioDir());
  return resolvedPath === resolvedTtsDir || resolvedPath.startsWith(`${resolvedTtsDir}${path.sep}`);
}

function getCaseLibraryAssetKind(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (CASE_LIBRARY_IMAGE_EXTENSIONS.has(ext)) {
    return 'images';
  }

  return 'audio';
}

function archiveCaseLibraryAssetPath(rawPath, repoPath, assetsRoot, copiedAssets) {
  const value = String(rawPath || '').trim();

  if (!value) {
    return rawPath;
  }

  if (!path.isAbsolute(value)) {
    return value.replace(/\\/g, '/');
  }

  if (!isLikelyCaseLibraryAsset(value) || !fs.existsSync(value)) {
    return rawPath;
  }

  const resolvedPath = path.resolve(value);
  const resolvedRepoPath = path.resolve(repoPath);

  if (resolvedPath === resolvedRepoPath || resolvedPath.startsWith(`${resolvedRepoPath}${path.sep}`)) {
    return toPosixRelativePath(repoPath, resolvedPath);
  }

  const stat = fs.statSync(resolvedPath);
  const ext = path.extname(resolvedPath).toLowerCase();
  const baseName = sanitizeFilePart(path.basename(resolvedPath, ext));
  const hash = crypto.createHash('sha1')
    .update(`${resolvedPath}:${stat.size}:${stat.mtimeMs}`)
    .digest('hex')
    .slice(0, 10);
  const assetKind = getCaseLibraryAssetKind(resolvedPath);
  const assetDir = path.join(repoPath, assetsRoot, assetKind);
  const assetFileName = `${baseName}-${hash}${ext}`;
  const targetPath = path.join(assetDir, assetFileName);

  fs.mkdirSync(assetDir, { recursive: true });
  fs.copyFileSync(resolvedPath, targetPath);
  copiedAssets.add(toPosixRelativePath(repoPath, targetPath));

  return `${assetsRoot}/${assetKind}/${assetFileName}`;
}

function archiveCaseLibraryAssets(value, repoPath, assetsRoot = 'assets', copiedAssets = new Set(), context = {}) {
  if (Array.isArray(value)) {
    return {
      value: value.map((item) => archiveCaseLibraryAssets(item, repoPath, assetsRoot, copiedAssets, context).value),
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
      if ((key === 'localPath' || key === 'audioPath') && (isTtsStep || isGeneratedTtsAudioPath(childValue))) {
        nextValue[key] = childValue;
        return;
      }
      nextValue[key] = archiveCaseLibraryAssetPath(childValue, repoPath, assetsRoot, copiedAssets);
      return;
    }

    nextValue[key] = archiveCaseLibraryAssets(childValue, repoPath, assetsRoot, copiedAssets, {
      ...context,
      isTtsStep,
    }).value;
  });

  return { value: nextValue, copiedAssets };
}

function collectTtsWorkflowSteps(cases = []) {
  return (Array.isArray(cases) ? cases : []).flatMap((testCase) => (
    (Array.isArray(testCase?.steps) ? testCase.steps : [])
      .filter((step) => step?.type === 'tts_synthesize')
      .map((step) => ({
        caseId: testCase.id || '',
        caseName: testCase.name || '',
        stepId: step.id || '',
        stepName: step.name || '',
        text: step.config?.text || '',
        outputAudioPath: `variables.${normalizeWorkflowVariableKey(step.name || step.id, 'tts')}.audioPath`,
        outputAudioUrl: `variables.${normalizeWorkflowVariableKey(step.name || step.id, 'tts')}.audioUrl`,
      }))
  ));
}

function redactSensitiveText(value) {
  return String(value || '')
    .replace(/(bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/("(?:authorization|api[-_]?key|token|secret|password)"\s*:\s*")[^"]*(")/gi, '$1<redacted>$2')
    .replace(/((?:api[-_]?key|token|secret|password)=)[^&\s"']+/gi, '$1<redacted>');
}

function redactTtsProviderForTemplate(rawProvider = {}) {
  const provider = normalizeTtsConfig(rawProvider);
  const audioUrlPath = String(provider.urlField || provider.responseMappings?.[0]?.responsePath || 'data.url');

  return {
    name: provider.name || 'HTTP TTS',
    method: provider.method,
    urlTemplate: redactSensitiveText(provider.url),
    headersTemplate: redactSensitiveText(provider.headersText),
    bodyTemplate: redactSensitiveText(provider.bodyTemplate),
    dynamicParams: ['text'],
    audioUrlPath,
    output: {
      extension: provider.outputExtension,
      sampleRate: provider.sampleRate,
      sampleFormat: provider.sampleFormat,
      channelCnt: provider.channelCnt,
    },
    timeoutMs: provider.timeoutMs,
    notes: [
      'Flow TTS 节点只传入 {{text}}；其它参数请固定写在 URL/Header/Body 模板中。',
      '每位成员需要在本机设置中心配置自己的 TTS Provider；此模板用于对齐团队协作，不包含真实密钥。',
      'TTS 节点执行后固定输出 variables.<节点名>.audioPath 和 variables.<节点名>.audioUrl。',
    ],
  };
}

function createCaseLibraryTtsTemplate(cases = []) {
  const steps = collectTtsWorkflowSteps(cases);

  if (steps.length === 0) {
    return null;
  }

  return {
    schemaVersion: 'glassbox.tts-provider-template.v1',
    generatedAt: new Date().toISOString(),
    provider: redactTtsProviderForTemplate(readEnvironmentConfig().ttsProvider || {}),
    workflowUsage: steps,
  };
}

function hydrateCaseLibraryAssetPath(rawPath, repoPath) {
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

function hydrateCaseLibraryAssets(value, repoPath) {
  if (Array.isArray(value)) {
    return value.map((item) => hydrateCaseLibraryAssets(item, repoPath));
  }

  if (!value || typeof value !== 'object') {
    return value;
  }

  const nextValue = {};
  Object.entries(value).forEach(([key, childValue]) => {
    if ((key === 'localPath' || key === 'audioPath' || key === 'imagePath') && typeof childValue === 'string') {
      nextValue[key] = hydrateCaseLibraryAssetPath(childValue, repoPath);
      return;
    }

    nextValue[key] = hydrateCaseLibraryAssets(childValue, repoPath);
  });

  return nextValue;
}

function hydrateCaseLibraryFileContent(file, repoPath) {
  if (!/\.json$/i.test(file.name || file.path || '')) {
    return file.content;
  }

  try {
    return JSON.stringify(hydrateCaseLibraryAssets(JSON.parse(file.content), repoPath), null, 2);
  } catch (_error) {
    return file.content;
  }
}

function ensureGitAskpassScript() {
  const askpassPath = path.join(app.getPath('userData'), 'glassbox-ssh-askpass.sh');

  fs.mkdirSync(path.dirname(askpassPath), { recursive: true });
  fs.writeFileSync(askpassPath, '#!/bin/sh\nprintf "%s" "$GLASSBOX_SSH_PASSPHRASE"\n', { mode: 0o700 });
  fs.chmodSync(askpassPath, 0o700);
  return askpassPath;
}

function buildGitCommandOptions(payload = {}, baseOptions = {}) {
  const repoUrl = String(payload.repoUrl || '').trim();
  payload = { ...payload, ...revealSecrets({ authToken: /^https:\/\//i.test(repoUrl) ? payload.authToken : undefined, sshPassphrase: /^(git@|ssh:\/\/)/i.test(repoUrl) ? payload.sshPassphrase : undefined }, safeStorage) };
  const sshKeyPath = String(payload.sshKeyPath || '').trim();
  const sshPassphrase = String(payload.sshPassphrase || '').trim();
  const isSshRepo = /^(git@|ssh:\/\/)/i.test(repoUrl);
  const baseEnv = {
    ...getDesktopCommandEnv(baseOptions.env),
    GIT_TERMINAL_PROMPT: '0',
  };
  // Process-local authentication: never put tokens in argv or .git/config.
  if (/^https:\/\//i.test(repoUrl) && payload.authToken) {
    const index = Number(baseEnv.GIT_CONFIG_COUNT || 0);
    baseEnv.GIT_CONFIG_COUNT = String(index + 1);
    baseEnv[`GIT_CONFIG_KEY_${index}`] = `http.${repoUrl}.extraHeader`;
    baseEnv[`GIT_CONFIG_VALUE_${index}`] = `Authorization: Basic ${Buffer.from(`${payload.authUsername || 'git'}:${payload.authToken}`).toString('base64')}`;
  }

  if (!sshKeyPath && !sshPassphrase && !isSshRepo) {
    return {
      ...baseOptions,
      env: baseEnv,
    };
  }

  const sshArgs = [
    'ssh',
    '-o',
    'StrictHostKeyChecking=accept-new',
  ];

  if (sshKeyPath) {
    sshArgs.push(
      '-i',
      JSON.stringify(sshKeyPath),
      '-o',
      'IdentitiesOnly=yes',
    );
  }

  const env = { ...baseEnv };

  if (sshPassphrase) {
    const askpassPath = ensureGitAskpassScript();
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

async function checkoutCaseLibraryBranch(repoPath, branch, payload = {}) {
  const targetBranch = normalizeGitBranch(branch);
  const options = buildGitCommandOptions(payload, { cwd: repoPath, timeout: 1000 * 60 * 5 });

  await runCommandWithOptions('git', ['fetch', 'origin', targetBranch], options);

  try {
    await runCommandWithOptions('git', ['checkout', targetBranch], options);
  } catch (_error) {
    await runCommandWithOptions('git', ['checkout', '-B', targetBranch, `origin/${targetBranch}`], options);
  }

  await runCommandWithOptions('git', ['pull', '--ff-only', 'origin', targetBranch], options);
}

function readJsonFileIfExists(filePath) {
  if (!fs.existsSync(filePath)) {
    return null;
  }

  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

function walkFiles(rootDir, matcher, files = []) {
  if (!fs.existsSync(rootDir)) {
    return files;
  }

  fs.readdirSync(rootDir, { withFileTypes: true }).forEach((entry) => {
    const fullPath = path.join(rootDir, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === '.git' || entry.name === 'node_modules') {
        return;
      }

      walkFiles(fullPath, matcher, files);
      return;
    }

    if (entry.isFile() && matcher(fullPath)) {
      files.push(fullPath);
    }
  });

  return files;
}

function readCaseLibraryFiles(repoPath, manifest = {}) {
  const casesRoot = path.join(repoPath, manifest.casesRoot || 'cases');
  const fallbackRoot = fs.existsSync(casesRoot) ? casesRoot : repoPath;
  const caseFiles = walkFiles(fallbackRoot, (filePath) => /\.(json|ya?ml)$/i.test(filePath));

  return caseFiles.map((filePath) => ({
    name: path.basename(filePath),
    path: filePath,
    relativePath: path.relative(repoPath, filePath),
    content: fs.readFileSync(filePath, 'utf8'),
  }));
}

async function getGitRepoInfo(repoPath) {
  if (!repoPath || !fs.existsSync(path.join(repoPath, '.git'))) {
    return null;
  }

  const [branchResult, dateResult, authorResult, emailResult, messageResult] = await Promise.all([
    runCommandWithOptions('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandWithOptions('git', ['log', '-1', '--format=%cI'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandWithOptions('git', ['log', '-1', '--format=%an'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandWithOptions('git', ['log', '-1', '--format=%ae'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
    runCommandWithOptions('git', ['log', '-1', '--format=%s'], { cwd: repoPath, timeout: 5000 }).catch(() => ({ stdout: '' })),
  ]);

  return {
    branch: branchResult.stdout.trim(),
    lastUpdatedAt: dateResult.stdout.trim(),
    lastUpdatedBy: authorResult.stdout.trim(),
    lastUpdatedEmail: emailResult.stdout.trim(),
    lastCommitMessage: messageResult.stdout.trim(),
  };
}

async function reloadLocalCaseLibrary(payload = {}, options = {}) {
  const repoUrl = String(payload.repoUrl || '').trim();
  const branch = normalizeGitBranch(payload.branch);
  const libraryId = String(payload.libraryId || '').trim();

  if (!repoUrl) {
    return {
      success: false,
      schemaVersion: 'glassbox.case-library.local-reload.v1',
      source: 'local',
      gitOperation: false,
      errorCode: 'CASE_LIBRARY_LOCAL_REPO_UNCONFIGURED',
      error: '当前用例库未配置本地 Git 仓库地址',
      recoveryActions: ['先在用例库设置中配置仓库地址；刷新本地用例不会执行 Git pull 或 push。'],
    };
  }

  try {
    const repoId = getLocalCaseLibraryRepoId(repoUrl, branch);
    const repoPath = getLocalCaseLibraryRepoPath(app.getPath('userData'), repoUrl, branch);
    if (!fs.existsSync(repoPath)) {
      throw Object.assign(new Error(`本地用例库目录不存在：${repoPath}`), {
        code: 'CASE_LIBRARY_LOCAL_REPO_NOT_FOUND',
        filePath: repoPath,
      });
    }

    const manifestPath = path.join(repoPath, 'manifest.json');
    let manifest;
    try {
      manifest = readJsonFileIfExists(manifestPath) || {
        schemaVersion: 'glassbox.case-library.v1',
        name: path.basename(repoPath),
        casesRoot: 'cases',
        assetsRoot: 'assets',
      };
    } catch (error) {
      throw Object.assign(new Error(`manifest JSON 解析失败：${manifestPath}：${error.message}`), {
        code: 'CASE_LIBRARY_MANIFEST_JSON_INVALID',
        filePath: manifestPath,
      });
    }
    let rawFiles;
    try {
      rawFiles = readCaseLibraryFiles(repoPath, manifest);
    } catch (error) {
      throw Object.assign(new Error(`本地用例文件读取失败：${error.message}`), {
        code: error?.code || 'CASE_LIBRARY_LOCAL_FILE_READ_FAILED',
        filePath: error?.path || '',
      });
    }
    if (rawFiles.length === 0) {
      throw Object.assign(new Error('本地用例库中没有可读取的 JSON/YAML 用例文件'), {
        code: 'CASE_LIBRARY_LOCAL_FILES_EMPTY',
        filePath: path.join(repoPath, manifest.casesRoot || 'cases'),
      });
    }
    const revision = createLocalCaseLibraryRevision(manifest, rawFiles);
    const workspaceDescriptor = parseLocalCaseLibraryWorkspace(manifest, rawFiles);
    const files = rawFiles.map((file) => ({
      ...file,
      content: hydrateCaseLibraryFileContent(file, repoPath),
    }));
    const workspace = workspaceDescriptor
      ? hydrateCaseLibraryAssets(workspaceDescriptor.workspace, repoPath)
      : null;
    const gitInfo = options.includeGitInfo === false ? null : await getGitRepoInfo(repoPath);

    return {
      success: true,
      schemaVersion: 'glassbox.case-library.local-reload.v1',
      source: 'local',
      gitOperation: false,
      libraryId,
      targetLibraryId: libraryId,
      repoUrl,
      branch,
      repoId,
      repoPath,
      revision,
      manifest,
      workspaceFile: workspaceDescriptor?.relativePath || '',
      workspace,
      gitInfo,
      files,
      strictLocalReload: true,
      preserveSelection: true,
    };
  } catch (error) {
    const errorCode = error?.code || 'CASE_LIBRARY_LOCAL_RELOAD_FAILED';
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      schemaVersion: 'glassbox.case-library.local-reload.v1',
      source: 'local',
      gitOperation: false,
      libraryId,
      targetLibraryId: libraryId,
      repoUrl,
      branch,
      errorCode,
      error: message,
      diagnostics: {
        schemaVersion: 'glassbox.error.v1',
        code: errorCode,
        type: 'case-library-local-refresh',
        message,
        details: {
          libraryId,
          repoUrl,
          branch,
          filePath: error?.filePath || error?.details?.workspaceFile || '',
        },
      },
      recoveryActions: [
        '检查提示文件的 JSON/YAML 是否完整且格式合法；当前编辑器状态不会被覆盖。',
        '保存完整文件后 solopi-desktop 会再次自动读取，也可使用“刷新用例”手动重试。',
      ],
    };
  }
}

function sendLocalCaseLibraryEvent(eventPayload) {
  const libraryId = String(eventPayload?.libraryId || '').trim();
  if (!libraryId) {
    return;
  }
  pendingLocalCaseLibraryEvents.set(libraryId, eventPayload);
  if (
    mainWindow
    && !mainWindow.isDestroyed()
    && !mainWindow.webContents.isDestroyed()
    && !mainWindow.webContents.isLoadingMainFrame()
  ) {
    mainWindow.webContents.send('case-library:local-changed', eventPayload);
    pendingLocalCaseLibraryEvents.delete(libraryId);
  }
}

function flushPendingLocalCaseLibraryEvents() {
  if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
    return;
  }
  pendingLocalCaseLibraryEvents.forEach((eventPayload, libraryId) => {
    mainWindow.webContents.send('case-library:local-changed', eventPayload);
    pendingLocalCaseLibraryEvents.delete(libraryId);
  });
}

function buildLocalCaseLibraryWatchEntries(state = {}) {
  return (Array.isArray(state?.caseLibraries) ? state.caseLibraries : [])
    .map((library) => {
      const libraryId = String(library?.id || '').trim();
      const repoUrl = String(library?.repoUrl || '').trim();
      const branch = normalizeGitBranch(library?.gitBranch || library?.branch);
      if (!libraryId || !repoUrl) {
        return null;
      }
      const repoPath = getLocalCaseLibraryRepoPath(app.getPath('userData'), repoUrl, branch);
      if (!fs.existsSync(repoPath)) {
        return null;
      }
      let manifest = {};
      try {
        manifest = readJsonFileIfExists(path.join(repoPath, 'manifest.json')) || {};
      } catch (_error) {
        // Watch manifest.json itself so the next valid atomic rename can recover.
      }
      return {
        libraryId,
        libraryName: String(library?.name || libraryId),
        repoUrl,
        branch,
        repoPath,
        casesRoot: String(manifest.casesRoot || 'cases'),
        workspaceFile: String(manifest.workspaceFile || ''),
        revision: String(library?.localRevision || ''),
      };
    })
    .filter(Boolean);
}

async function processLocalCaseLibraryWatchEvent(entry) {
  const result = await reloadLocalCaseLibrary(entry, { includeGitInfo: false });
  if (result.success) {
    const previousRevision = localCaseLibraryWatcherManager?.getRevision(entry.libraryId) || '';
    if (result.revision === previousRevision && !localCaseLibraryErrorSignatures.has(entry.libraryId)) {
      return;
    }
    localCaseLibraryWatcherManager?.markRevision(entry.libraryId, result.revision);
    localCaseLibraryErrorSignatures.delete(entry.libraryId);
    sendLocalCaseLibraryEvent({
      schemaVersion: 'glassbox.case-library.local-change-event.v1',
      type: 'library-changed',
      libraryId: entry.libraryId,
      libraryName: entry.libraryName,
      revision: result.revision,
      previousRevision,
      detectedAt: new Date().toISOString(),
      result,
    });
    return;
  }

  const errorSignature = JSON.stringify({
    errorCode: result.errorCode,
    error: result.error,
    filePath: result.diagnostics?.details?.filePath || '',
  });
  if (localCaseLibraryErrorSignatures.get(entry.libraryId) === errorSignature) {
    return;
  }
  localCaseLibraryErrorSignatures.set(entry.libraryId, errorSignature);
  sendLocalCaseLibraryEvent({
    schemaVersion: 'glassbox.case-library.local-change-event.v1',
    type: 'library-error',
    libraryId: entry.libraryId,
    libraryName: entry.libraryName,
    detectedAt: new Date().toISOString(),
    errorCode: result.errorCode,
    error: result.error,
    diagnostics: result.diagnostics,
    recoveryActions: result.recoveryActions,
  });
}

function enqueueLocalCaseLibraryWatchEvent(entry) {
  const libraryId = String(entry?.libraryId || '').trim();
  const previous = localCaseLibraryReloadQueues.get(libraryId) || Promise.resolve();
  const next = previous
    .catch(() => null)
    .then(() => processLocalCaseLibraryWatchEvent(entry))
    .finally(() => {
      if (localCaseLibraryReloadQueues.get(libraryId) === next) {
        localCaseLibraryReloadQueues.delete(libraryId);
      }
    });
  localCaseLibraryReloadQueues.set(libraryId, next);
}

function ensureLocalCaseLibraryWatcherManager() {
  if (!localCaseLibraryWatcherManager) {
    localCaseLibraryWatcherManager = createCaseLibraryWatcherManager({
      debounceMs: 400,
      onChange: enqueueLocalCaseLibraryWatchEvent,
      onError: (error, entry) => {
        sendLocalCaseLibraryEvent({
          schemaVersion: 'glassbox.case-library.local-change-event.v1',
          type: 'watcher-error',
          libraryId: entry?.libraryId,
          libraryName: entry?.libraryName,
          detectedAt: new Date().toISOString(),
          errorCode: 'CASE_LIBRARY_WATCHER_FAILED',
          error: error instanceof Error ? error.message : String(error),
          recoveryActions: ['检查本地用例库目录是否仍存在并可读；可使用“刷新用例”手动重试。'],
        });
      },
    });
  }
  return localCaseLibraryWatcherManager;
}

function synchronizeLocalCaseLibraryWatchers(state = null) {
  const workflowState = state || readWorkflowState() || {};
  const entries = buildLocalCaseLibraryWatchEntries(workflowState);
  ensureLocalCaseLibraryWatcherManager().sync(entries);
  const activeKeys = new Set(entries.map((entry) => (
    `${entry.libraryId}:${entry.repoPath}:${entry.casesRoot}:${entry.workspaceFile}`
  )));
  Array.from(initializedLocalCaseLibraryWatchKeys).forEach((key) => {
    if (!activeKeys.has(key)) {
      initializedLocalCaseLibraryWatchKeys.delete(key);
    }
  });
  entries.forEach((entry) => {
    const watchKey = `${entry.libraryId}:${entry.repoPath}:${entry.casesRoot}:${entry.workspaceFile}`;
    if (!initializedLocalCaseLibraryWatchKeys.has(watchKey)) {
      initializedLocalCaseLibraryWatchKeys.add(watchKey);
      enqueueLocalCaseLibraryWatchEvent(entry);
    }
  });
}

async function runAdb(args, timeout = 5000, signal) {
  const result = await runCommand(getAdbPath(), args, timeout, signal);
  return result.stdout;
}

async function runAdbBuffer(args, timeout = 5000) {
  const result = await runCommandBuffer(getAdbPath(), args, timeout);
  return result.stdout;
}

async function runHdc(args, timeout = 5000, signal) {
  const result = await runCommand(getHdcPath(), args, timeout, signal);
  return result.stdout;
}

async function runAdbStep(label, args, timeout = 5000, options = {}) {
  const command = `${getAdbPath()} ${args.join(' ')}`;
  const serialIndex = args.indexOf('-s');
  const serial = serialIndex >= 0 ? String(args[serialIndex + 1] || '') : '';
  try {
    const result = await runCommand(getAdbPath(), args, timeout);
    return {
      label,
      command,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    const diagnosticError = createAdbDiagnosticError(error, {
      deviceRole: options.deviceRole || 'phone',
      serial: options.serial || serial,
      packageName: options.packageName || '',
      command,
    });
    if (options.optional) {
      return {
        label,
        command,
        optional: true,
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
      };
    }

    diagnosticError.stepLabel = label;
    throw diagnosticError;
  }
}

async function clearLogcatBuffer(serial, timeout = 5000) {
  if (!serial) {
    return '';
  }

  try {
    await runAdb(['-s', serial, 'logcat', '-c'], timeout);
    return '';
  } catch (error) {
    return error?.message || String(error);
  }
}

function appendArtifactWarning(target, warning) {
  if (!warning) {
    return;
  }

  target.warnings = Array.isArray(target.warnings) ? target.warnings : [];
  target.warnings.push(warning);
}

async function launchPhoneTestPage() {
  throw new Error('请通过配置的快捷操作脚本打开厂商调试页；应用不再内置厂商启动命令');
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

function normalizeWorkflowVariableKey(value, fallback = 'node') {
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

function getReportCacheDir() {
  return path.join(getGlassBoxDataDir(), 'reports');
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

function copyReportCaseArtifacts(taskId, caseRecord, packageRoot, sharedLogPaths = new Map()) {
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
  const externalArtifactMappings = new Map(sharedLogPaths);

  fs.mkdirSync(caseArtifactRoot, { recursive: true });
  fs.cpSync(runDir, targetRunDir, { recursive: true, force: true });
  packageCasePerformanceReports(targetRunDir, packageRoot, runDir);
  for (const recording of Array.isArray(artifacts.recordings) ? artifacts.recordings : []) {
    const recordingPath = String(recording?.path || '').trim();
    if (!recordingPath || !path.isAbsolute(recordingPath) || !fs.existsSync(recordingPath)) {
      continue;
    }
    const targetRecordingPath = path.join(
      caseArtifactRoot,
      'recordings',
      sanitizeFilePart(path.basename(recordingPath))
    );
    fs.mkdirSync(path.dirname(targetRecordingPath), { recursive: true });
    fs.copyFileSync(recordingPath, targetRecordingPath);
    externalArtifactMappings.set(
      path.resolve(recordingPath),
      path.relative(packageRoot, targetRecordingPath).split(path.sep).join('/')
    );
  }

  return rewriteArtifactPaths(artifacts, (sourcePath) => {
    if (!sourcePath || !path.isAbsolute(sourcePath)) {
      return sourcePath;
    }

    const resolvedSource = path.resolve(sourcePath);
    const resolvedRunDir = path.resolve(runDir);
    if (externalArtifactMappings.has(resolvedSource)) {
      return externalArtifactMappings.get(resolvedSource);
    }

    if (resolvedSource === resolvedRunDir) {
      return path.relative(packageRoot, targetRunDir).split(path.sep).join('/');
    }

    if (isPathInside(resolvedRunDir, resolvedSource)) {
      return path.relative(packageRoot, path.join(targetRunDir, path.relative(resolvedRunDir, resolvedSource))).split(path.sep).join('/');
    }

    return sourcePath;
  });
}

function resolveReportArtifactPaths(value, reportRoot) {
  return rewriteArtifactPaths(value, (sourcePath) => {
    if (!sourcePath || path.isAbsolute(sourcePath)) {
      return sourcePath;
    }

    return path.join(reportRoot, ...String(sourcePath).split('/'));
  });
}

function createLogcatPath(deviceType, serial) {
  const logsDir = path.join(getGlassBoxDataDir(), 'logs', 'logcat');
  fs.mkdirSync(logsDir, { recursive: true });

  return path.join(logsDir, `${sanitizeFilePart(deviceType)}-${sanitizeFilePart(serial)}-${createTimestamp()}.txt`);
}

function createWorkflowRunDir(testCase) {
  const logsDir = path.join(getGlassBoxDataDir(), 'logs', 'workflow-runs');
  const runDir = path.join(
    logsDir,
    `${sanitizeFilePart(testCase?.id || testCase?.name || 'workflow')}-${createTimestamp()}-${crypto.randomUUID()}`
  );

  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

function createWorkflowTaskRecordingDir(taskId) {
  const recordingsRoot = path.join(getGlassBoxDataDir(), 'logs', 'workflow-task-recordings');
  const runDir = path.join(recordingsRoot, `${sanitizeFilePart(taskId || 'task')}-${createTimestamp()}`);
  fs.mkdirSync(runDir, { recursive: true });
  return runDir;
}

async function segmentWorkflowTaskRecording({ outputPath, args, source, marker }) {
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  await ffmpegProcessQueue.enqueue({
    kind: 'screen-recording-segment',
    taskId: source?.taskId,
    caseId: marker?.caseId,
  }, async () => {
    const ffmpegPath = getRequiredFfmpegPath();
    // Failed recorders can still leave playable MKV frames. Require FFmpeg
    // decode progress, not merely a nonempty MP4 container, before recovery.
    const recovering = source?.success === false;
    const commandArgs = recovering ? [...args.slice(0,-1),'-progress','pipe:1',args.at(-1)] : args;
    let result;
    try {
      result = await runCommand(ffmpegPath, commandArgs, 120000);
    } catch (error) {
      if (!args.includes('h264_videotoolbox')) throw error;
      fs.rmSync(outputPath, { force: true });
      result = await runCommand(ffmpegPath, buildSoftwareFallbackSegmentArgs(commandArgs), 120000);
    }
    if (recovering && !String(result?.stdout || '').split('\n').some(line => /^out_time_us=[1-9][0-9]*$/.test(line.trim()))) {
      fs.rmSync(outputPath, {force:true});
      throw Object.assign(new Error('异常结束的录屏在该用例时间段没有可解码视频帧'),{code:'SCREEN_RECORDING_NO_RECOVERABLE_FRAMES'});
    }
  });
  const stat = fs.statSync(outputPath);
  if (!stat.isFile() || stat.size <= 0) {
    const error = new Error('FFmpeg 未生成有效的逐用例录屏文件');
    error.code = 'SCREEN_RECORDING_SEGMENT_EMPTY';
    throw error;
  }
  return {
    success: true,
    sizeBytes: stat.size,
    error: '',
    errorCode: '',
    recoveryActions: [],
  };
}

function safeEndWriteStream(stream) {
  if (!stream || stream.destroyed || stream.writableEnded || stream.writableFinished) {
    return;
  }

  try {
    stream.end();
  } catch (_error) {
    // Ignore late stream shutdown races.
  }
}

function safeWriteStream(stream, chunk) {
  if (!stream || stream.destroyed || stream.writableEnded || stream.writableFinished) {
    return;
  }

  try {
    stream.write(chunk);
  } catch (_error) {
    // Ignore late chunks emitted after the destination stream has ended.
  }
}

async function startWorkflowLogCapture(runDir, deviceType, serial, options = {}) {
  if (!serial) {
    return null;
  }

  if (options.clearBeforeStart) {
    stopLogAssertStream(serial);
    const clearError = await clearLogcatBuffer(serial, 5000);
    if (clearError) {
      appendArtifactWarning(options, `清空 ${deviceType} logcat 失败：${clearError}`);
    }
  }

  const logPath = path.join(runDir, `${sanitizeFilePart(deviceType)}-${sanitizeFilePart(serial)}.txt`);
  // Editor runs share these sessions with assertions just like task-owned runs.
  // Establish retention before registering the listener or exposing the session.
  const journal = createWorkflowLogJournal(runDir);
  let stream, child;
  try {
    stream = fs.createWriteStream(logPath, { flags: 'w' });
    child = spawn(getAdbPath(), ['-s', serial, 'logcat', '-v', 'threadtime', ...(options.sinceNow ? ['-T', '1'] : [])], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (error) {
    journal.close();
    safeEndWriteStream(stream);
    throw error;
  }
  const session = {
    workflowOwned: true,
    deviceType,
    serial,
    path: logPath,
    process: child,
    stream,
    journal,
    waiters: new Set(),
    buffer: '',
    recentLines: [],
    recentLineSeqs: [],
    lineSequence: 0,
    error: '',
    clearError: options.warnings?.join('\n') || '',
    exited: false,
    stdoutHandler: null,
    stderrHandler: null,
  };

  session.stdoutHandler = (chunk) => {
    safeWriteStream(stream, chunk);
    session.buffer += chunk.toString();
    const lines = session.buffer.split(/\r?\n/);
    session.buffer = lines.pop() || '';

    if (!retainWorkflowLogLines(session, lines.filter(Boolean))) return;
    lines.forEach((line) => {
      if (!line) {
        return;
      }

      session.lineSequence += 1;
      session.recentLines.push(line);
      session.recentLineSeqs.push(session.lineSequence);
      if (session.recentLines.length > LOG_ASSERT_RECENT_LINE_LIMIT) {
        const removeCount = session.recentLines.length - LOG_ASSERT_RECENT_LINE_LIMIT;
        session.recentLines.splice(0, removeCount);
        session.recentLineSeqs.splice(0, removeCount);
      }

      Array.from(session.waiters).forEach((waiter) => {
        try {
          if (waiter.matcher(line)) {
            clearTimeout(waiter.timer);
            session.waiters.delete(waiter);
            waiter.resolve(line);
          }
        } catch (error) {
          clearTimeout(waiter.timer);
          session.waiters.delete(waiter);
          waiter.reject(error);
        }
      });
    });
  };
  session.stderrHandler = (chunk) => {
    session.error += chunk.toString();
  };
  child.stdout.on('data', session.stdoutHandler);
  child.stderr.on('data', session.stderrHandler);
  child.on('error', (error) => {
    session.error += error.message;
    session.journal.close();
    session.exited = true;
    if (logAssertStreams.get(serial) === session) logAssertStreams.delete(serial);
    for (const waiter of session.waiters) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
    session.waiters.clear();
    safeEndWriteStream(stream);
  });
  child.on('exit', () => {
    session.journal?.close();
    session.exited = true;
    safeEndWriteStream(stream);
    if (logAssertStreams.get(serial) === session) logAssertStreams.delete(serial);
    session.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(session.error.trim() || 'logcat 监听进程已退出'));
    });
    session.waiters.clear();
  });

  logAssertStreams.set(serial, session);
  return session;
}

function stopWorkflowLogCapture(session) {
  if (!session) {
    return null;
  }

  session.journal?.close();
  if (session.stdoutHandler) {
    session.process.stdout?.off?.('data', session.stdoutHandler);
  }
  if (session.stderrHandler) {
    session.process.stderr?.off?.('data', session.stderrHandler);
  }

  if (!session.process.killed && !session.exited) {
    stopOwnedLogProcess(session.process);
  }

  if (logAssertStreams.get(session.serial) === session) logAssertStreams.delete(session.serial);
  session.waiters?.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('logcat 监听已停止'));
  });
  session.waiters?.clear();
  safeEndWriteStream(session.stream);

  return {
    deviceType: session.deviceType,
    serial: session.serial,
    path: session.path,
    error: [session.clearError, session.error.trim()].filter(Boolean).join('\n'),
  };
}

function getWorkflowEvidenceOptions(steps = [], options = {}) {
  const startStep = steps.find((step) => step?.type === 'start');
  const config = {
    ...(startStep?.config || {}),
    ...(options.startConfigOverride || {}),
  };
  const showGlassesScreen = options.disableScreenMirror
    ? false
    : parseWorkflowBoolean(config.showGlassesScreen, false);
  const showPhoneScreen = options.disableScreenMirror
    ? false
    : parseWorkflowBoolean(config.showPhoneScreen, false);

  return {
    capturePhoneLog: true,
    captureGlassesLog: true,
    recordGlassesScreen: parseWorkflowBoolean(config.recordGlassesScreen, false),
    recordPhoneScreen: parseWorkflowBoolean(config.recordPhoneScreen, false),
    showPhoneScreen,
    showGlassesScreen,
  };
}

function applyWorkflowStartConfigOverride(steps = [], override = null) {
  if (!override || typeof override !== 'object') {
    return steps;
  }

  return steps.map((step) => (
    step?.type === 'start'
      ? {
          ...step,
          config: {
            ...(step.config || {}),
            ...override,
          },
        }
      : step
  ));
}

async function getScrcpySupportedOptions(scrcpyPath) {
  if (!scrcpyPath) {
    return new Set();
  }

  if (scrcpyOptionSupportCache.has(scrcpyPath)) {
    return scrcpyOptionSupportCache.get(scrcpyPath);
  }

  try {
    const result = await runCommand(scrcpyPath, ['--help'], 3000);
    const helpText = `${result.stdout || ''}\n${result.stderr || ''}`;
    const options = new Set();

    if (/(?:^|\s)--no-audio(?:\s|$)/m.test(helpText)) {
      options.add('--no-audio');
    }
    if (helpText.includes('--audio-codec')) options.add('--audio-codec');
    if (helpText.includes('--no-audio-playback')) {
      options.add('--no-audio-playback');
    }
    if (helpText.includes('--no-window')) {
      options.add('--no-window');
    }
    if (helpText.includes('--no-display')) {
      options.add('--no-display');
    }

    scrcpyOptionSupportCache.set(scrcpyPath, options);
    return options;
  } catch (_error) {
    const options = new Set();
    scrcpyOptionSupportCache.set(scrcpyPath, options);
    return options;
  }
}

async function createScrcpySession(scrcpyPath, args, fields = {}) {
  const adbPath = getAdbPath();
  const mediaRuntime = resolveMediaRuntime({
    resourcesPath: process.resourcesPath,
    isPackaged: app.isPackaged,
  });
  const transportDiagnostics = [];
  let onMediaFrame = () => {};
  const recordTransport = entry => { transportDiagnostics.push({time:new Date().toISOString(),...entry}); if(transportDiagnostics.length>64)transportDiagnostics.shift(); if(entry.phase==='video-frame-received')onMediaFrame(); };
  let transport;
  const preparationController = new AbortController();
  const preparationRequestId = workflowCommandScope.getStore();
  const cancelPreparation = () => preparationController.abort(Error('Recording preparation stopped'));
  if(preparationRequestId){
    const pending = workflowCommandCancels.get(preparationRequestId) || new Set();
    workflowCommandCancels.set(preparationRequestId,pending);pending.add(cancelPreparation);
    if(isWorkflowCanceled(preparationRequestId))cancelPreparation();
  }
  let recordingEnv = getScrcpyEnvironment(mediaRuntime, getAdbAwareCommandEnv(), { headless: true });
  try {
    const {resolveLocalAdbEndpoint,resolveScrcpyEndpoint,createScrcpyTransport,scopedAdbEnvironment} = require('./scrcpy-transport');
    const remoteEndpoint = await resolveScrcpyEndpoint(adbPath, fields.serial, {env:recordingEnv,signal:preparationController.signal,run:async(file,argv,opts)=>(await runCommandWithOptions(file,argv,opts)).stdout});
    const endpoint = remoteEndpoint || resolveLocalAdbEndpoint(recordingEnv);
    if (endpoint) {
      if (remoteEndpoint && !mediaRuntime.adb) throw Error('Remote recording requires bundled ADB client');
      transport = await createScrcpyTransport({endpoint,serial:fields.serial,signal:preparationController.signal,onEvent:recordTransport});
      recordingEnv = scopedAdbEnvironment(recordingEnv,mediaRuntime.adb || adbPath,transport.socket);
      args = [...args, '--force-adb-forward'];
    }
    const requestId = workflowCommandScope.getStore();
    if (isQuitting || (requestId && isWorkflowCanceled(requestId))) throw Error('Recording canceled before client launch');
    recordTransport({phase:'client-launch',configuredAdbPath:adbPath,effectiveAdbPath:recordingEnv.ADB,mode:remoteEndpoint?'scoped-remote':'scoped-local',endpoint:transport?.endpoint});
  } catch(error) {
    transport?.close();recordTransport({phase:'prepare-failed',error:error.message});
    return {...fields,process:null,startFailed:true,exited:true,error:error.message,transportDiagnostics};
  } finally {
    const pending = workflowCommandCancels.get(preparationRequestId);pending?.delete(cancelPreparation);
    if(pending && !pending.size)workflowCommandCancels.delete(preparationRequestId);
  }
  const command = [scrcpyPath, ...args].map((part) => (
    /\s/.test(String(part)) ? JSON.stringify(String(part)) : String(part)
  )).join(' ');
  const {recordingSnapshot,watchRecordingOutput}=require('./recording-readiness');
  let previousOutput;
  try { previousOutput=recordingSnapshot(fields.path); } catch(error) {
    transport?.close();recordTransport({phase:'recording-output-error',error:error.message});
    return {...fields,process:null,startFailed:true,exited:true,error:error.message,transportDiagnostics};
  }
  const child = spawn(scrcpyPath, args, {
    // Keep scrcpy owned by the solopi-desktop task. Detached children look like
    // long-lived daemons to endpoint security and can outlive failed tasks.
    detached: false,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: recordingEnv,
    cwd: adbPath && adbPath !== 'adb' ? path.dirname(adbPath) : undefined,
  });
  const session = {
    ...fields,
    transportDiagnostics,
    closeTransport: () => transport?.close(),
    scrcpyPath,
    args,
    command,
    process: child,
    processGroupPid: child.pid,
    error: '',
    exited: false,
    exitPromise: null,
    readyAtMs: 0,
    readyPromise: null,
    stopPromise: null,
  };

  let resolveReady;
  session.readyPromise = new Promise((resolve) => {
    resolveReady = resolve;
  });
  const markReady=()=>{
    if(session.exited||session.readyAtMs)return;
    session.readyAtMs=Date.now();
    recordTransport({phase:'recording-media-ready',readyAtMs:session.readyAtMs});
    resolveReady?.(session.readyAtMs);
  };
  onMediaFrame=markReady;
  const closeOutputWatch=transport ? ()=>{} : watchRecordingOutput(session.path,previousOutput,()=>{
    recordTransport({phase:'recording-output-written'});markReady();
  },{onError:error=>{recordTransport({phase:'recording-output-error',error:error.message});resolveReady?.(0);}});
  const appendOutput = (chunk) => {
    session.error = (session.error + chunk.toString()).slice(-65536);
  };

  session.exitPromise = new Promise((resolve) => {
    child.once('close', (code, signal) => {
      closeOutputWatch();
      session.closeTransport();
      recordTransport({phase:'client-exit',exitCode:code,signal});
      session.exited = true;
      session.exitCode = code;
      session.exitSignal = signal;
      session.recordingStoppedAtMs = Date.now();
      resolveReady?.(0);
      resolve({ code, signal });
    });
  });
  child.stderr.on('data', appendOutput);
  child.stdout.on('data', appendOutput);
  child.on('error', (error) => {
    session.error += error.message;
    resolveReady?.(0);
  });

  return session;
}

async function waitForScrcpySessionReady(session, timeoutMs = 15000) {
  if (!session || session.startFailed) return false;
  const timedOut = Symbol('timedOut');
  const ready = await Promise.race([
    session.readyPromise,
    sleep(timeoutMs).then(() => timedOut),
  ]);
  if (ready === timedOut && !session.exited) {
    session.transportDiagnostics?.push({phase:'recording-start-timeout',timeoutMs});
    return false;
  }
  return Boolean(ready) && !session.exited;
}

function signalScrcpySession(session, signal) {
  if (!session?.process || session.exited) {
    return;
  }

  // ChildProcess.killed means a signal was sent, not that the child exited.
  // A child ignoring SIGINT must still receive the bounded SIGKILL fallback.
  try {
    session.process.kill(signal);
  } catch (_error) {
    // Do not kill the process group here. scrcpy may have started or reused
    // the shared adb server, and killing the group can disconnect user devices.
  }
}

async function waitForScrcpyExit(session, timeoutMs) {
  if (!session?.process || session.exited) {
    return true;
  }

  const timedOut = Symbol('timedOut');
  const result = await Promise.race([
    session.exitPromise || Promise.resolve(),
    sleep(timeoutMs).then(() => timedOut),
  ]);

  return result !== timedOut;
}

async function stopScrcpySession(session, options = {}) {
  if (!session?.process || session.exited) {
    return;
  }

  if (session.stopPromise) return session.stopPromise;

  session.stopPromise = (async () => {
    const graceSignal = options.graceSignal || 'SIGINT';
    const forceAfterMs = Number.isFinite(options.forceAfterMs) ? options.forceAfterMs : 1500;
    const finalWaitMs = Number.isFinite(options.finalWaitMs) ? options.finalWaitMs : 800;

    signalScrcpySession(session, graceSignal);
    const exited = await waitForScrcpyExit(session, forceAfterMs);

    if (!exited) {
      signalScrcpySession(session, 'SIGKILL');
      await waitForScrcpyExit(session, finalWaitMs);
    }
  })();
  return session.stopPromise;
}

async function startWorkflowScreenRecord(runDir, deviceType, serial, options = {}) {
  if (!serial) {
    return null;
  }

  const scrcpyPath = await getScrcpyPath();
  const extension = options.container === 'mkv' ? 'mkv' : 'mp4';
  const localPath = path.join(runDir, `${sanitizeFilePart(deviceType)}-${sanitizeFilePart(serial)}-scrcpy-record.${extension}`);

  if (!scrcpyPath) {
    return {
      deviceType,
      serial,
      path: localPath,
      process: null,
      error: app.isPackaged
        ? '安装包缺少内置 scrcpy 运行时，请重新安装完整 solopi-desktop 安装包'
        : '开发环境未检测到 scrcpy，请准备 media-runtime 或配置 SCRCPY_PATH',
      exited: true,
      startFailed: true,
    };
  }

  const supportedOptions = await getScrcpySupportedOptions(scrcpyPath);
  const args = ['-s', serial, '--record', localPath];
  { // Recorders never own presentation; embedded previews render separately.
    if (supportedOptions.has('--no-window')) {
      args.push('--no-window');
    } else if (supportedOptions.has('--no-display')) {
      args.push('--no-display');
    } else {
      args.push('--no-window');
    }
  }
  // Record device audio; suppress only local playback, never the capture stream.
  if (supportedOptions.has('--no-audio-playback')) args.push('--no-audio-playback');
  // AAC remains playable in MP4 artifacts, including native desktop players.
  if (supportedOptions.has('--audio-codec')) args.push('--audio-codec=aac');

  const session = await createScrcpySession(scrcpyPath, args, {
    deviceType,
    serial,
    path: localPath,
    taskId: String(options.taskId || ''),
    lifecycleScope: options.taskLevel ? 'task' : 'case',
  });
  if (options.taskLevel) {
    const ready = await waitForScrcpySessionReady(session);
    if (!ready) {
      session.startFailed = true;
      session.error = `${session.error}\nscrcpy 启动超时：15 秒内未收到完整视频帧，请检查录屏传输诊断`.trim();
      await stopScrcpySession(session);
      session.closeTransport?.();
    }
  }
  return session;
}

function persistScrcpyMirrorDiagnostic(session) {
  const diagnostic = evaluateScrcpyMirror(session);
  if (!session?.logPath) return diagnostic;
  try {
    fs.mkdirSync(path.dirname(session.logPath), { recursive: true });
    fs.writeFileSync(session.logPath, `${JSON.stringify(diagnostic, null, 2)}\n`, 'utf8');
  } catch (error) {
    session.error = `${session.error || ''}\n无法写入投屏诊断日志：${error.message}`.trim();
    return evaluateScrcpyMirror(session);
  }
  return diagnostic;
}

async function startWorkflowScreenMirror(deviceType, serial, options = {}) {
  const logPath = options.runDir
    ? path.join(options.runDir, `${sanitizeFilePart(deviceType)}-${sanitizeFilePart(serial || 'unknown')}-scrcpy-mirror.log`)
    : '';
  if (!serial) {
    const deviceLabel = deviceType === 'glasses' ? '眼镜' : '手机';
    const session = {
      deviceType,
      serial: '',
      scrcpyPath: '',
      process: null,
      command: '',
      logPath,
      error: `未选择${deviceLabel}设备，无法启动投屏`,
      exited: true,
      startFailed: true,
      mirrorOnly: true,
      startedAt: new Date().toISOString(),
    };
    persistScrcpyMirrorDiagnostic(session);
    return session;
  }

  const scrcpyPath = await getScrcpyPath();

  if (!scrcpyPath) {
    const session = {
      deviceType,
      serial,
      process: null,
      scrcpyPath: '',
      command: '',
      logPath,
      error: app.isPackaged
        ? '安装包缺少内置 scrcpy 运行时，请重新安装完整 solopi-desktop 安装包'
        : '开发环境未检测到 scrcpy，请准备 media-runtime 或配置 SCRCPY_PATH',
      exited: true,
      startFailed: true,
      mirrorOnly: true,
      startedAt: new Date().toISOString(),
    };
    persistScrcpyMirrorDiagnostic(session);
    return session;
  }

  const id = crypto.randomUUID();
  const session = { deviceType, serial, scrcpyPath, logPath, mirrorOnly: true,
    embeddedId: id, taskId: String(options.taskId || id), startedAt: new Date().toISOString() };
  embeddedMirrorSessions.set(id, session);
  const prepared = await prepareEmbeddedPreview(workflowPreviewService, { taskId: id, role: deviceType, serial }, 'workflow');
  if (!prepared.success) Object.assign(session, { startFailed: true, error: prepared.error || '投屏未就绪' });
  return session;
}

async function stopWorkflowScreenRecord(session) {
  if (!session) {
    return null;
  }

  await stopScrcpySession(session, { graceSignal: 'SIGINT' });
  session.closeTransport?.();
  session.recordingStoppedAtMs ||= Date.now();

  let fileInfo = {
    exists: false,
    isFile: false,
    sizeBytes: 0,
    statError: '',
  };
  try {
    const stat = fs.statSync(session.path);
    fileInfo = {
      exists: true,
      isFile: stat.isFile(),
      sizeBytes: stat.size,
      statError: '',
    };
  } catch (error) {
    fileInfo.statError = error?.code === 'ENOENT' ? '' : (error?.message || String(error));
  }

  return evaluateScrcpyRecording(session, fileInfo);
}

async function stopWorkflowScreenMirror(session) {
  if (session?.embeddedId) {
    embeddedMirrorSessions.delete(session.embeddedId);
    await workflowPreviewService.stop(undefined, { taskId: session.embeddedId, role: session.deviceType });
    session.exited = true;
    session.stoppedIntentionally = true;
    return persistScrcpyMirrorDiagnostic(session);
  }
  await stopScrcpySession(session, { graceSignal: 'SIGTERM', forceAfterMs: 1000 });
  return persistScrcpyMirrorDiagnostic(session);
}

async function captureWorkflowScreenshot(context, deviceType, serial, step) {
  if (!serial) {
    return null;
  }

  const screenshotsDir = path.join(context.runDir, 'screenshots');
  fs.mkdirSync(screenshotsDir, { recursive: true });

  const fileName = `${sanitizeFilePart(step?.id || step?.name || 'assert')}-${createTimestamp()}.png`;
  const remotePath = `/sdcard/${fileName}`;
  const localPath = path.join(screenshotsDir, fileName);

  try {
    await runCommand(getAdbPath(), ['-s', serial, 'shell', 'screencap', '-p', remotePath], 10000);
    await runCommand(getAdbPath(), ['-s', serial, 'pull', remotePath, localPath], 10000);
    try {
      await runCommand(getAdbPath(), ['-s', serial, 'shell', 'rm', '-f', remotePath], 5000);
    } catch (_error) {
      // Best-effort cleanup.
    }

    return {
      deviceType,
      serial,
      path: localPath,
      stepId: step?.id,
      stepName: step?.name,
      success: true,
    };
  } catch (error) {
    return {
      deviceType,
      serial,
      path: localPath,
      stepId: step?.id,
      stepName: step?.name,
      success: false,
      error: error.message,
    };
  }
}

function notifyLogcatState(payload) {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send('adb:logcat-state', payload);
  }
}

function stopLogcatSession(sessionId) {
  const session = logcatSessions.get(sessionId);

  if (!session) {
    return null;
  }

  session.stopping = true;
  if (session.stdoutHandler) {
    session.process.stdout?.off?.('data', session.stdoutHandler);
  }
  if (session.stderrHandler) {
    session.process.stderr?.off?.('data', session.stderrHandler);
  }
  session.process.kill('SIGTERM');
  safeEndWriteStream(session.stream);
  logcatSessions.delete(sessionId);

  return session;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createLogMatcher(pattern, matchType = 'contains', caseSensitive = true) {
  const sourcePattern = String(pattern || '');

  if (!sourcePattern) {
    throw new Error('日志断言缺少关键字或正则');
  }

  if (matchType === 'regex') {
    const regexp = new RegExp(sourcePattern, caseSensitive ? '' : 'i');
    return (line) => regexp.test(line);
  }

  const expected = caseSensitive ? sourcePattern : sourcePattern.toLowerCase();
  return (line) => {
    const haystack = caseSensitive ? line : line.toLowerCase();
    return haystack.includes(expected);
  };
}

async function captureWorkflowAssertScreenshot(context, deviceType, serial, step) {
  try {
    const screenshot = await captureWorkflowScreenshot(context, deviceType, serial, step);
    if (screenshot) {
      context.screenshots?.push(screenshot);
    }
  } catch (_error) {
    // 截图是断言证据，失败时不能覆盖断言本身的通过/失败结果。
  }
}

function stopLogAssertStream(serial, owner) {
  const stream = owner || logAssertStreams.get(serial);

  if (!stream || stream.taskOwned) {
    return;
  }

  stream.journal?.close();
  stopOwnedLogProcess(stream.process);
  stream.waiters.forEach((waiter) => {
    clearTimeout(waiter.timer);
    waiter.reject(new Error('logcat 监听已停止'));
  });
  stream.waiters.clear();
  if (logAssertStreams.get(serial) === stream) logAssertStreams.delete(serial);
}

function ensureLogAssertStream(serial) {
  const current = logAssertStreams.get(serial);

  if (current && !current.process.killed) {
    current.journal ||= createWorkflowLogJournal(path.join(app.getPath('userData'), 'logs', 'assertion-journals'));
    return current;
  }

  const child = spawn(getAdbPath(), ['-s', serial, 'logcat', '-v', 'threadtime', '-T', '1', '*:V'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const stream = {
    process: child,
    waiters: new Set(),
    buffer: '',
    recentLines: [],
    recentLineSeqs: [],
    lineSequence: 0,
    journal: createWorkflowLogJournal(path.join(app.getPath('userData'), 'logs', 'assertion-journals')),
    lastError: '',
  };

  child.stdout.on('data', (chunk) => {
    stream.buffer += chunk.toString();
    const lines = stream.buffer.split(/\r?\n/);
    stream.buffer = lines.pop() || '';

    if (!retainWorkflowLogLines(stream, lines.filter(Boolean))) return;
    lines.forEach((line) => {
      if (!line) {
        return;
      }

      stream.lineSequence += 1;
      stream.recentLines.push(line);
      stream.recentLineSeqs.push(stream.lineSequence);
      if (stream.recentLines.length > LOG_ASSERT_RECENT_LINE_LIMIT) {
        const removeCount = stream.recentLines.length - LOG_ASSERT_RECENT_LINE_LIMIT;
        stream.recentLines.splice(0, removeCount);
        stream.recentLineSeqs.splice(0, removeCount);
      }

      Array.from(stream.waiters).forEach((waiter) => {
        try {
          if (waiter.matcher(line)) {
            clearTimeout(waiter.timer);
            stream.waiters.delete(waiter);
            waiter.resolve(line);
          }
        } catch (error) {
          clearTimeout(waiter.timer);
          stream.waiters.delete(waiter);
          waiter.reject(error);
        }
      });
    });
  });

  child.stderr.on('data', (chunk) => {
    stream.lastError += chunk.toString();
  });

  child.on('error', (error) => {
    stream.lastError = error.message;
    stream.journal?.close();
    if (logAssertStreams.get(serial) === stream) logAssertStreams.delete(serial);
    for (const waiter of stream.waiters) { clearTimeout(waiter.timer); waiter.reject(error); }
    stream.waiters.clear();
  });
  child.on('exit', () => {
    stream.journal?.close();
    if (logAssertStreams.get(serial) === stream) logAssertStreams.delete(serial);
    stream.waiters.forEach((waiter) => {
      clearTimeout(waiter.timer);
      waiter.reject(new Error(stream.lastError || 'logcat 监听进程已退出'));
    });
    stream.waiters.clear();
  });

  logAssertStreams.set(serial, stream);
  return stream;
}

function retainWorkflowLogLines(stream, lines) {
  try {
    if (stream.journalError) throw stream.journalError;
    stream.journal?.append(lines, Number(stream.lineSequence || 0) + 1);
    return true;
  } catch (error) {
    stream.journalError = error;
    for (const waiter of Array.from(stream.waiters)) {
      clearTimeout(waiter.timer);
      stream.waiters.delete(waiter);
      waiter.reject(error);
    }
    return false;
  }
}

function* getWorkflowLogEntries(stream, minSequence = 0) {
  if (stream.journalError) throw stream.journalError;
  if (stream.journal) {
    yield* stream.journal.entriesAfter(minSequence);
    return;
  }
  // Standalone consumers without retention keep their explicit preview-only behavior.
  for (let index = (stream.recentLines || []).length - 1; index >= 0; index--) {
    const sequence = Number(stream.recentLineSeqs?.[index] || 0);
    if (sequence > minSequence) yield { line: stream.recentLines[index], sequence };
  }
}

function findRecentLogLine(stream, matcher, minSequence = 0) {
  const recentLines = stream.recentLines || [];
  const recentLineSeqs = stream.recentLineSeqs || [];

  for (let index = recentLines.length - 1; index >= 0; index -= 1) {
    if (Number(recentLineSeqs[index] || 0) <= minSequence) {
      continue;
    }

    const line = recentLines[index];

    if (matcher(line)) {
      return line;
    }
  }

  return '';
}

function findRecentLogMatch(stream, matcher, minSequence = 0) {
  for (const entry of getWorkflowLogEntries(stream, minSequence)) {
    if (matcher(entry.line)) return entry;
  }
  return null;
}

function getLogAssertIgnoreBeforeSequence(serial, clearBeforeStart) {
  if (clearBeforeStart) {
    return 0;
  }

  const stream = logAssertStreams.get(serial);
  return Number(stream?.lineSequence || 0);
}

function getExplicitLogAssertIgnoreBeforeSequence(config, serial, clearBeforeStart) {
  const explicitSequence = Number(config?.ignoreBeforeSequence);

  if ((!clearBeforeStart || (logAssertStreams.get(serial)?.taskOwned || logAssertStreams.get(serial)?.workflowOwned)) && Number.isFinite(explicitSequence) && explicitSequence >= 0) {
    return explicitSequence;
  }

  return getLogAssertIgnoreBeforeSequence(serial, clearBeforeStart);
}

function getCurrentLogAssertSequence(serial) {
  return Number(logAssertStreams.get(serial)?.lineSequence || 0);
}

function escapeRegexLiteral(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getPostAssertTargetPackage(context, device, values = {}) {
  const explicitPackage = String(values.postPassTargetPackage || values.packageName || '').trim();
  if (explicitPackage) {
    return explicitPackage;
  }

  return String(device === 'glasses' ? context?.defaults?.glassesPackage || '' : context?.defaults?.phonePackage || '').trim();
}

function getPostAssertFailurePatterns(context, device, values = {}) {
  const patterns = [];
  const targetPackage = getPostAssertTargetPackage(context, device, values);

  if (targetPackage) {
    const escapedPackage = escapeRegexLiteral(targetPackage);
    patterns.push(new RegExp(`Process\\s+${escapedPackage}.*has died`, 'i'));
    patterns.push(new RegExp(`WIN DEATH: .*${escapedPackage}`, 'i'));
  }

  const customPattern = String(values.postPassFailRegex || values.stabilityFailRegex || '').trim();
  if (customPattern) {
    patterns.push(new RegExp(customPattern, values.postPassFailRegexCaseSensitive === 'true' ? '' : 'i'));
  }

  return patterns;
}

function getPostAssertObserveMs(values = {}) {
  const explicit = Number(values.postPassObserveMs || values.stabilityObserveMs);
  if (Number.isFinite(explicit) && explicit >= 0) {
    return explicit;
  }

  return 2000;
}

function isPostAssertFailureLogLine(line, patterns) {
  const text = String(line || '');
  return patterns.some((pattern) => pattern.test(text));
}

function findRecentPostAssertFailureLog(stream, patterns, minSequence = 0) {
  const recentLines = stream.recentLines || [];
  const recentLineSeqs = stream.recentLineSeqs || [];

  for (let index = recentLines.length - 1; index >= 0; index -= 1) {
    if (Number(recentLineSeqs[index] || 0) <= minSequence) {
      continue;
    }

    const line = recentLines[index];
    if (isPostAssertFailureLogLine(line, patterns)) {
      return { line, sequence: Number(recentLineSeqs[index] || 0) };
    }
  }

  return null;
}

// Scope cancellation to this waiter, leaving other users of the log stream intact.
function createWorkflowLogWait(stream, executor) {
  const requestId = workflowCommandScope.getStore();
  return new Promise((resolve, reject) => {
    let waiter;
    let settled = false;
    let pending;
    const cleanup = () => {
      if (waiter) {
        clearTimeout(waiter.timer);
        stream.waiters.delete(waiter);
      }
      if (pending) {
        pending.delete(cancel);
        if (!pending.size) workflowCommandCancels.delete(requestId);
      }
    };
    const finish = (callback, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      callback(value);
    };
    const cancel = () => finish(reject, createWorkflowStoppedError());
    if (isWorkflowCanceled(requestId)) { cancel(); return; }
    if (requestId) {
      pending = workflowCommandCancels.get(requestId) || new Set();
      workflowCommandCancels.set(requestId, pending);
      pending.add(cancel);
    }
    try {
      executor(
        value => finish(resolve, value),
        error => finish(reject, error),
        value => {
          waiter = value;
          if (settled) { cleanup(); return; }
          stream.waiters.add(waiter);
        },
      );
    } catch (error) { finish(reject, error); }
  });
}

async function assertPostAssertLogStability(serial, context, device, values, minSequence) {
  const timeoutMs = getPostAssertObserveMs(values);
  const patterns = getPostAssertFailurePatterns(context, device, values);

  if (!timeoutMs || patterns.length === 0) {
    return;
  }

  const stream = await prepareLogAssertStream(serial, false);
  const recentFailure = findRecentPostAssertFailureLog(stream, patterns, minSequence);

  if (recentFailure) {
    throw new Error(`断言通过后目标应用出现异常退出日志：${recentFailure.line}`);
  }

  return createWorkflowLogWait(stream, (resolve, reject, register) => {
    const waiter = {
      matcher: (line) => {
        if (!isPostAssertFailureLogLine(line, patterns)) {
          return false;
        }
        throw new Error(`断言通过后目标应用出现异常退出日志：${line}`);
      },
      resolve,
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      stream.waiters.delete(waiter);
      resolve();
    }, Math.max(0, Number(timeoutMs) || 0));

    register(waiter);
  });
}

async function prepareLogAssertStream(serial, clearBeforeStart = true) {
  const shared = logAssertStreams.get(serial);
  if (shared?.taskOwned || shared?.workflowOwned) {
    if (shared.exited || shared.process.killed || shared.journalError) throw Object.assign(new Error(shared.lastError || '任务日志不可用，本次断言无法确认'), { code: 'LOG_EVIDENCE_UNAVAILABLE' });
    return shared;
  }
  if (clearBeforeStart) {
    stopLogAssertStream(serial);
    await clearLogcatBuffer(serial, 5000);
  }

  return ensureLogAssertStream(serial);
}

async function waitForLogMatch(serial, config, timeoutMs) {
  const matcher = createLogMatcher(
    config.pattern,
    config.matchType || 'contains',
    config.caseSensitive !== false
  );
  const clearBeforeStart = config.clearBeforeStart !== false;
  const ignoreBeforeSequence = getExplicitLogAssertIgnoreBeforeSequence(config, serial, clearBeforeStart);
  const stream = await prepareLogAssertStream(serial, clearBeforeStart);
  const effectiveTimeout = Number(timeoutMs || config.timeoutMs || 10000);

  return createWorkflowLogWait(stream, (resolve, reject, register) => {
    try {
      const recentMatch = findRecentLogMatch(stream, matcher, ignoreBeforeSequence);
      if (recentMatch) {
        resolve(recentMatch);
        return;
      }
    } catch (error) {
      reject(error);
      return;
    }

    let matchedSequence = 0;
    const waiter = {
      matcher: (line) => {
        if (!matcher(line)) {
          return false;
        }

        matchedSequence = Number(stream.lineSequence || 0);
        return true;
      },
      resolve: (line) => resolve({ line, sequence: matchedSequence || Number(stream.lineSequence || 0) }),
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      stream.waiters.delete(waiter);
      reject(createAssertionTimeoutError(`等待日志超时：${config.pattern}`, effectiveTimeout));
    }, effectiveTimeout);

    register(waiter);
  });
}

function createTtsTextExtractor(pattern, caseSensitive = true) {
  return require('./workflow-log-text').createTtsTextExtractor(pattern, caseSensitive);
}

function getTextAssertOperatorLabel(operator) {
  if (operator === 'contains') return '包含';
  if (operator === 'notContains') return '不包含';
  if (operator === 'regex') return '正则匹配';
  if (operator === 'notRegex') return '正则不匹配';
  if (operator === 'notEquals') return '不等于';
  return '等于';
}

function evaluateTextAssert(actual, expected, operator, caseSensitive) {
  const actualText = String(actual ?? '');
  const expectedText = String(expected ?? '');
  const actualComparable = caseSensitive ? actualText : actualText.toLowerCase();
  const expectedComparable = caseSensitive ? expectedText : expectedText.toLowerCase();

  if (operator === 'contains') {
    return actualComparable.includes(expectedComparable);
  }

  if (operator === 'notContains') {
    return !actualComparable.includes(expectedComparable);
  }

  if (operator === 'regex') {
    return new RegExp(expectedText, caseSensitive ? '' : 'i').test(actualText);
  }

  if (operator === 'notRegex') {
    return !new RegExp(expectedText, caseSensitive ? '' : 'i').test(actualText);
  }

  if (operator === 'notEquals') {
    return actualComparable !== expectedComparable;
  }

  return actualComparable === expectedComparable;
}

function isNegativeTextAssertOperator(operator) {
  return operator === 'notEquals' || operator === 'notContains' || operator === 'notRegex';
}

function buildTextAssertMissReason(extractedText, expectedText, matchOperator) {
  return `比较方式「${getTextAssertOperatorLabel(matchOperator)}」，期望「${expectedText}」，实际「${extractedText}」`;
}

async function waitForTtsTextAssert(serial, config, timeoutMs) {
  const expectedText = String(config.expectedText ?? '');
  const matchOperator = String(config.matchOperator || 'equals');
  const caseSensitive = config.caseSensitive !== false;
  const extractText = createTtsTextExtractor(config.extractRegex, caseSensitive);
  const clearBeforeStart = config.clearBeforeStart !== false;
  const ignoreBeforeSequence = getExplicitLogAssertIgnoreBeforeSequence(config, serial, clearBeforeStart);
  const stream = await prepareLogAssertStream(serial, clearBeforeStart);
  const effectiveTimeout = Number(timeoutMs || config.timeoutMs || 10000);
  const negativeAssert = isNegativeTextAssertOperator(matchOperator);
  let lastCandidate = null;
  let lastMissReason = '';
  let matchedResult = null;
  const assertionFailure = (message, code) => Object.assign(new Error(message), {
    code, stdout: lastCandidate?.line || '',
    meta: { logTextAssertion: {
      patternMatched: lastCandidate !== null,
      lastExtractedText: lastCandidate?.extractedText ?? null,
      expectedText, matchOperator,
      ignoreBeforeSequence, lastMatchSequence: lastCandidate?.sequence ?? null,
    } },
  });
  const buildCandidate = (line) => {
    const sequence = Number(stream.lineSequence || 0);
    const extractedText = extractText(line);

    if (extractedText === null) {
      return null;
    }

    const passed = evaluateTextAssert(extractedText, expectedText, matchOperator, caseSensitive);
    const candidate = {
      line,
      extractedText,
      expectedText,
      matchOperator,
      passed,
      sequence,
    };

    lastCandidate = candidate;

    if (!passed) {
      lastMissReason = buildTextAssertMissReason(extractedText, expectedText, matchOperator);
    }

    return candidate;
  };

  return createWorkflowLogWait(stream, (resolve, reject, register) => {
    for (const entry of getWorkflowLogEntries(stream, ignoreBeforeSequence)) {
      const recentResult = buildCandidate(entry.line);
      if (recentResult) recentResult.sequence = entry.sequence;
      if (negativeAssert && recentResult && !recentResult.passed) {
        reject(assertionFailure(`日志文本断言失败：${lastMissReason}`, 'LOG_TEXT_ASSERT_FAILED'));
        return;
      }
      if (!negativeAssert && recentResult?.passed) {
        resolve(recentResult);
        return;
      }
    }

    const waiter = {
      matcher: (line) => {
        const candidate = buildCandidate(line);

        if (!candidate) {
          return false;
        }

        if (negativeAssert) {
          if (!candidate.passed) {
            throw assertionFailure(`日志文本断言失败：${lastMissReason}`, 'LOG_TEXT_ASSERT_FAILED');
          }

          return false;
        }

        if (candidate.passed) {
          matchedResult = candidate;
          return true;
        }

        return false;
      },
      resolve: () => {
        resolve(matchedResult);
      },
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      stream.waiters.delete(waiter);

      if (negativeAssert) {
        resolve({
          line: lastCandidate?.line || '',
          extractedText: lastCandidate?.extractedText || '',
          expectedText,
          matchOperator,
          negativeAssertPassed: true,
        });
        return;
      }

      const detail = lastMissReason ? `；最近一次未通过原因：${lastMissReason}` : '';
      reject(Object.assign(assertionFailure(`等待日志文本断言超时：${config.extractRegex}${detail}`, 'LOG_TEXT_ASSERT_TIMEOUT'), { timeoutMs: effectiveTimeout }));
    }, effectiveTimeout);

    register(waiter);
  });
}

function parseLogJsonPayload(rawText) {
  return require('./workflow-log-diagnostics').parseLogJsonPayload(rawText);
}

function parseJsonAssertConditions(value) {
  return require('./workflow-log-diagnostics').parseJsonAssertConditions(value);
}

function assertJsonCondition(root, condition) {
  return require('./workflow-log-diagnostics').assertJsonCondition(root, condition);
}

function createJsonLogAssertMatcher(config) {
  const linePattern = String(config.lineRegex || '').trim();

  if (!linePattern) {
    throw new Error('JSON 日志断言缺少候选日志正则');
  }

  const regexp = new RegExp(linePattern, config.caseSensitive !== false ? '' : 'i');
  const conditions = parseJsonAssertConditions(config.conditions);

  if (conditions.length === 0) {
    throw new Error('JSON 日志断言至少需要一条条件');
  }

  return (line) => {
    const match = regexp.exec(line);

    if (!match) {
      return null;
    }

    const rawPayload = match.groups?.json || match[1] || line;
    const root = parseLogJsonPayload(rawPayload);
    const assertions = conditions.map((condition) => assertJsonCondition(root, condition));

    return {
      line,
      root,
      assertions,
    };
  };
}

function createAssertExtractedVariable(config, value, context, defaultName) {
  if (!parseWorkflowBoolean(config.extractVariableEnabled, false)) {
    return null;
  }

  const name = String(config.extractVariableName || '').trim()
    ? validateWorkflowVariableName(config.extractVariableName)
    : createUniqueWorkflowVariableName(context, defaultName);

  if (getWorkflowVariable(context, name) !== undefined) {
    throw new Error(`提取变量名重复：variables.${name} 已存在`);
  }

  if (value === undefined) {
    throw new Error(`提取变量 ${name} 失败：当前断言没有提取到有效内容`);
  }

  writeWorkflowVariable(context, name, value);

  return {
    name,
    value,
  };
}

function getAssertExtractionMeta(config, extractedVariable = null) {
  const enabled = parseWorkflowBoolean(config?.extractVariableEnabled, false);
  return {
    extraction: {
      enabled,
      status: enabled ? (extractedVariable ? 'written' : 'enabled') : 'disabled',
      variableName: enabled ? String(config?.extractVariableName || '').trim() : '',
    },
    ...(extractedVariable ? { extractedVariable } : {}),
  };
}

function createJsonAssertExtractedVariable(config, matchedResult, context) {
  if (!parseWorkflowBoolean(config.extractVariableEnabled, false)) {
    return null;
  }

  const pathExpression = String(config.extractVariablePath || '').trim();
  const value = pathExpression
    ? getJsonPathValue(matchedResult?.root, pathExpression)
    : matchedResult?.root;

  if (value === undefined) {
    throw new Error(pathExpression
      ? `提取变量失败：路径 ${pathExpression} 不存在`
      : '提取变量失败：当前正则未提取到有效 JSON 内容');
  }

  const extractedVariable = createAssertExtractedVariable(config, value, context, 'extractedJson');
  return extractedVariable ? { ...extractedVariable, path: pathExpression } : null;
}

async function waitForJsonLogAssert(serial, config, timeoutMs) {
  const assertLine = createJsonLogAssertMatcher(config);
  const clearBeforeStart = config.clearBeforeStart !== false;
  const ignoreBeforeSequence = getExplicitLogAssertIgnoreBeforeSequence(config, serial, clearBeforeStart);
  const stream = await prepareLogAssertStream(serial, clearBeforeStart);
  const effectiveTimeout = Math.max(Number(timeoutMs || config.timeoutMs || 10000), JSON_LOG_ASSERT_MIN_TIMEOUT_MS);

  return createWorkflowLogWait(stream, (resolve, reject, register) => {
    let matchedResult = null;
    let lastMissReason = '';

    for (const entry of getWorkflowLogEntries(stream, ignoreBeforeSequence)) {
      try {
        const recentResult = assertLine(entry.line);
        if (recentResult) {
          recentResult.sequence = entry.sequence;
          resolve(recentResult);
          return;
        }
      } catch (error) {
        lastMissReason = error instanceof Error ? error.message : String(error);
      }
    }

    const waiter = {
      matcher: (line) => {
        try {
          const result = assertLine(line);

          if (!result) {
            return false;
          }

          result.sequence = Number(stream.lineSequence || 0);
          matchedResult = result;
          return true;
        } catch (error) {
          lastMissReason = error instanceof Error ? error.message : String(error);
          return false;
        }
      },
      resolve: () => resolve(matchedResult),
      reject,
      timer: null,
    };

    waiter.timer = setTimeout(() => {
      stream.waiters.delete(waiter);
      reject(createAssertionTimeoutError(`等待 JSON 日志断言超时：${config.lineRegex}${lastMissReason ? `；最近一次未通过原因：${lastMissReason}` : ''}`, effectiveTimeout, { lastMissReason }));
    }, effectiveTimeout);

    register(waiter);
  });
}

function getPathValue(source, pathExpression) {
  return String(pathExpression)
    .split('.')
    .reduce((current, key) => (
      current && typeof current === 'object' ? current[key] : undefined
    ), source);
}

function stringifyWorkflowTemplateValue(value) {
  if (value === undefined || value === null) {
    return '';
  }

  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch (_error) {
      return String(value);
    }
  }

  return String(value);
}

function resolveWorkflowValue(value, context) {
  if (typeof value === 'string') {
    const resolveExpression = (_match, expression) => {
      const resolved = expression.trim() === 'defaults.adbPath'
        ? getAdbPath()
        : getPathValue(context, expression.trim());
      if (/^defaults\.(phoneSerial|glassesSerial|phonePackage|glassesPackage)$/.test(expression.trim()) && !String(resolved ?? '').trim()) {
        const error = new Error(`必需设备变量为空：${expression.trim()}`);
        error.code = error.errorCode = 'WORKFLOW_REQUIRED_VARIABLE_MISSING';
        error.errorType = 'configuration';
        throw error;
      }
      return stringifyWorkflowTemplateValue(resolved);
    };

    return value
      .replace(/\$\{([^}]+)\}/g, resolveExpression)
      .replace(/\{\{(defaults\.[^}]+|variables\.[^}]+|nodeOutputs\.[^}]+)\}\}/g, resolveExpression);
  }

  if (Array.isArray(value)) {
    return value.map((item) => resolveWorkflowValue(item, context));
  }

  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, resolveWorkflowValue(item, context)])
    );
  }

  return value;
}

function getWorkflowSerial(step, context) {
  const serial = step.device === 'glasses'
    ? context.defaults.glassesSerial
    : context.defaults.phoneSerial;

  if (!serial) {
    throw new Error(`步骤「${step.name}」缺少${step.device === 'glasses' ? '眼镜' : '手机'}设备 SN`);
  }

  return serial;
}

function getComponentDevice(component, step = {}) {
  return (step.device || component.device) === 'glasses' ? 'glasses' : 'phone';
}

function getComponentSerial(component, context, step = {}) {
  const device = getComponentDevice(component, step);
  const serial = device === 'glasses'
    ? context.defaults.glassesSerial
    : context.defaults.phoneSerial;

  if (!serial) {
    const stepName = String(step.name || step.id || '未命名节点');
    const error = new Error(`节点「${stepName}」${step.id ? `（${step.id}）` : ''}缺少${device === 'glasses' ? '眼镜' : '手机'}设备 SN；该节点引用组件「${component.name || component.id}」。`);
    error.code = error.errorCode = 'WORKFLOW_REQUIRED_DEVICE_MISSING';
    error.errorType = 'configuration';
    error.stepId = step.id;
    error.stepName = stepName;
    error.diagnostics = { stepId: step.id, stepName, componentId: component.id, componentName: component.name, device, phase: 'device-resolution' };
    throw error;
  }

  return serial;
}

function getWorkflowPackage(step, context, config) {
  const packageName = config.packageName || (
    step.device === 'glasses'
      ? context.defaults.glassesPackage
      : context.defaults.phonePackage
  );

  if (!packageName) {
    throw new Error(`步骤「${step.name}」缺少包名`);
  }

  return packageName;
}

function buildAdbCommandPreview(args) {
  return [getAdbPath(), ...args].map((part) => {
    const value = String(part);
    return /\s/.test(value) ? JSON.stringify(value) : value;
  }).join(' ');
}

function splitShellWords(input) {
  const words = [];
  let current = '';
  let quote = '';
  let escaping = false;

  for (const char of String(input || '')) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }

    if (char === '\\') {
      escaping = true;
      continue;
    }

    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (/\s/.test(char)) {
      if (current) {
        words.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current) {
    words.push(current);
  }

  return words;
}

function createAdbExecution(command) {
  const trimmed = String(command || '').trim();
  const adbPath = getAdbPath();
  let rest = '';

  if (trimmed === 'adb' || trimmed.startsWith('adb ')) {
    rest = trimmed.slice(3).trim();
  } else if (trimmed === adbPath || trimmed.startsWith(`${adbPath} `)) {
    rest = trimmed.slice(adbPath.length).trim();
  } else {
    throw new Error('组件命令必须以 adb 开头');
  }

  const shellMatch = rest.match(/^(.*?)\bshell\s+([\s\S]+)$/);

  if (!shellMatch) {
    return {
      command: adbPath,
      args: splitShellWords(rest),
      preview: `${adbPath} ${rest}`.trim(),
    };
  }

  const prefixArgs = splitShellWords(shellMatch[1]);
  const remoteShellCommand = parseRemoteShellCommand(shellMatch[2].trim());
  const remoteCommand = normalizeRemoteShellCommand(remoteShellCommand.command);
  const remoteArgs = buildAdbShellArgs(remoteCommand, remoteShellCommand.wrapped);

  return {
    command: adbPath,
    args: [...prefixArgs, ...remoteArgs],
    preview: buildAdbCommandPreview([...prefixArgs, ...remoteArgs]),
  };
}

function createPcExecution(command) {
  const words = splitShellWords(command);
  if (words.length === 0) {
    throw new Error('PC 命令不能为空');
  }

  return {
    command: words[0],
    args: words.slice(1),
    preview: words.map((part) => /\s/.test(String(part)) ? JSON.stringify(String(part)) : String(part)).join(' '),
  };
}

function buildAdbShellArgs(remoteCommand, forceRemoteShell = false) {
  if (forceRemoteShell || requiresRemoteShell(remoteCommand) || shouldKeepRemoteCommandIntact(remoteCommand)) {
    return ['shell', remoteCommand];
  }

  return ['shell', ...splitShellWords(remoteCommand)];
}

function requiresRemoteShell(command) {
  return /[|;&<>`$]/.test(command);
}

function shouldKeepRemoteCommandIntact(command) {
  return /\s--es\s+params\s/.test(` ${command} `);
}

function parseRemoteShellCommand(command) {
  if (!command || command.length < 2) {
    return { command, wrapped: false };
  }

  const quote = command[0];
  if ((quote !== '"' && quote !== "'") || command[command.length - 1] !== quote) {
    return { command, wrapped: false };
  }

  return { command: command.slice(1, -1), wrapped: true };
}

function normalizeRemoteShellCommand(command) {
  return String(command || '').replace(/\\"/g, '"');
}

function createAudioAdbExecution(command) {
  const trimmed = String(command || '').trim();
  const adbPath = getAdbPath();
  let rest = '';

  if (trimmed === 'adb' || trimmed.startsWith('adb ')) {
    rest = trimmed.slice(3).trim();
  } else if (trimmed === adbPath || trimmed.startsWith(`${adbPath} `)) {
    rest = trimmed.slice(adbPath.length).trim();
  } else {
    throw new Error('音频触发命令必须以 adb 开头');
  }

  const shellMatch = rest.match(/^(.*?)\bshell\s+([\s\S]+)$/);

  if (!shellMatch) {
    return {
      command: adbPath,
      args: splitShellWords(rest),
      preview: `${adbPath} ${rest}`.trim(),
    };
  }

  const prefixArgs = splitShellWords(shellMatch[1]);
  const remoteShellCommand = parseRemoteShellCommand(shellMatch[2].trim());
  const remoteCommand = normalizeRemoteShellCommand(remoteShellCommand.command);
  const remoteArgs = buildAdbShellArgs(remoteCommand, remoteShellCommand.wrapped);

  return {
    command: adbPath,
    args: [...prefixArgs, ...remoteArgs],
    preview: buildAdbCommandPreview([...prefixArgs, ...remoteArgs]),
  };
}

function normalizeComponentParamValue(param, value) {
  if (param.inputType !== 'json') {
    return value;
  }

  try {
    return JSON.stringify(JSON.parse(String(value || '{}')));
  } catch (_error) {
    return value;
  }
}

function renderCommandTemplate(template, values) {
  let rendered = String(template || '');
  const seen = new Set([rendered]);

  // Component templates commonly render a parameter first (for example
  // {{command}}), while that parameter can itself contain workflow variables
  // such as {{phoneSerial}}. Resolve a bounded number of nested layers so both
  // placeholders are expanded without allowing cyclic values to loop forever.
  for (let depth = 0; depth < 8; depth += 1) {
    const next = rendered.replace(/\{\{([^}]+)\}\}/g, (_match, expression) => {
      const key = expression.trim();
      const value = values[key];
      if (/^(phoneSerial|glassesSerial|phonePackage|glassesPackage)$/.test(key) && !String(value ?? '').trim()) {
        const error = new Error(`必需设备变量为空：${key}`);
        error.code = error.errorCode = 'WORKFLOW_REQUIRED_VARIABLE_MISSING';
        error.errorType = 'configuration';
        throw error;
      }
      return value === undefined || value === null ? '' : String(value);
    });
    if (next === rendered || seen.has(next)) {
      return next;
    }
    rendered = next;
    seen.add(rendered);
  }

  return rendered;
}

function normalizeAcceptedExitCodes(value) {
  let parsed = value;
  if (typeof value === 'string') {
    try { parsed = JSON.parse(value); } catch (_error) { parsed = value.split(',').map((item) => item.trim()); }
  }
  const values = Array.isArray(parsed) ? parsed : (parsed === undefined || parsed === null ? [] : [parsed]);
  return [...new Set(values.map((item) => Number(item)).filter((item) => Number.isInteger(item)))];
}

function readCommandExitCode(result = {}) {
  if (result.exitCode !== undefined && result.exitCode !== null) {
    return Number(result.exitCode);
  }
  return result.success === false ? 1 : 0;
}

function getJsonPathValueSafe(root, expression) {
  const pathExpression = String(expression || '').trim();
  if (!pathExpression || pathExpression === '$') return root;
  const parts = pathExpression.replace(/^\$\.?/, '').split('.').filter(Boolean);
  return parts.reduce((current, part) => {
    const match = part.match(/^([^\[]+)(?:\[(\d+)\])?$/);
    if (!match || current === undefined || current === null) return undefined;
    const value = current[match[1]];
    return match[2] === undefined ? value : value?.[Number(match[2])];
  }, root);
}

function transformCommandMappingValue(value, mapping = {}) {
  const trim = mapping.trim !== false;
  const normalized = typeof value === 'string' && trim ? value.trim() : value;
  const type = String(mapping.type || mapping.transform || 'string').toLowerCase();
  if (type === 'json') {
    try { return JSON.parse(String(normalized || '')); } catch (_error) { return normalized; }
  }
  if (type === 'jsonpath') return getJsonPathValueSafe(normalized, mapping.path || mapping.jsonPath);
  if (type === 'number') return Number(normalized);
  if (type === 'boolean') {
    if (typeof normalized === 'string') {
      const lower = normalized.toLowerCase();
      if (['true', '1', 'yes', 'on'].includes(lower)) return true;
      if (['false', '0', 'no', 'off', ''].includes(lower)) return false;
      return Boolean(normalized);
    }
    return Boolean(normalized);
  }
  return normalized;
}

function applyCommandOutputMappings(context, output, mappings = {}) {
  const source = {
    stdout: output.stdout || '',
    stderr: output.stderr || '',
    exitCode: readCommandExitCode(output),
    signal: output.signal || null,
    timedOut: Boolean(output.timedOut || output.timeoutMs),
    success: output.success !== false,
  };
  Object.entries(mappings && typeof mappings === 'object' ? mappings : {}).forEach(([name, mapping]) => {
    const descriptor = typeof mapping === 'string' ? { source: mapping } : (mapping || {});
    const sourceName = String(descriptor.source || descriptor.from || name);
    const raw = source[sourceName] !== undefined ? source[sourceName] : getJsonPathValueSafe(source, sourceName);
    if (descriptor.notEmpty && (raw === undefined || raw === null || String(raw).trim() === '')) return;
    const value = transformCommandMappingValue(raw, descriptor);
    if (descriptor.equals !== undefined && String(value) !== String(descriptor.equals)) return;
    if (descriptor.regex) {
      let matched = false;
      try { matched = new RegExp(String(descriptor.regex)).test(String(value || '')); } catch (_error) { matched = false; }
      if (!matched) return;
    }
    writeWorkflowVariable(context, name, value);
  });
}

function parseWorkflowBoolean(value, fallback = false) {
  if (typeof value === 'boolean') {
    return value;
  }

  if (value === undefined || value === null || value === '') {
    return fallback;
  }

  return String(value).toLowerCase() === 'true';
}

function decodeXmlEntity(value) {
  return String(value || '')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');
}

function parseAndroidBounds(boundsValue) {
  const match = String(boundsValue || '').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);

  if (!match) {
    return null;
  }

  const [, left, top, right, bottom] = match;
  const bounds = {
    left: Number(left),
    top: Number(top),
    right: Number(right),
    bottom: Number(bottom),
  };

  if (![bounds.left, bounds.top, bounds.right, bounds.bottom].every(Number.isFinite)) {
    return null;
  }

  return {
    ...bounds,
    width: Math.max(0, bounds.right - bounds.left),
    height: Math.max(0, bounds.bottom - bounds.top),
    centerX: Math.round((bounds.left + bounds.right) / 2),
    centerY: Math.round((bounds.top + bounds.bottom) / 2),
  };
}

function parseAndroidUiElements(xml) {
  const elements = [];
  const nodeRegex = /<node\b([^>]*)\/?>/g;
  let match;
  let index = 0;

  while ((match = nodeRegex.exec(String(xml || '')))) {
    const rawAttributes = match[1] || '';
    const attributes = {};
    rawAttributes.replace(/([A-Za-z0-9_:-]+)="([^"]*)"/g, (_attrMatch, key, value) => {
      attributes[key] = decodeXmlEntity(value);
      return '';
    });

    const bounds = parseAndroidBounds(attributes.bounds);
    if (!bounds || bounds.width <= 0 || bounds.height <= 0) {
      index += 1;
      continue;
    }

    const text = attributes.text || '';
    const contentDesc = attributes['content-desc'] || '';
    const resourceId = attributes['resource-id'] || '';

    elements.push({
      id: `el-${index}`,
      index,
      text,
      contentDesc,
      resourceId,
      className: attributes.class || '',
      packageName: attributes.package || '',
      clickable: attributes.clickable === 'true',
      enabled: attributes.enabled !== 'false',
      focused: attributes.focused === 'true',
      selected: attributes.selected === 'true',
      bounds: attributes.bounds || '',
      rect: bounds,
      label: text || contentDesc || resourceId || attributes.class || `元素 ${index + 1}`,
      selector: {
        resourceId,
        text,
        contentDesc,
        className: attributes.class || '',
        bounds: attributes.bounds || '',
        xRatio: '',
        yRatio: '',
      },
    });
    index += 1;
  }

  return elements;
}

async function getAndroidWindowSize(serial) {
  try {
    const output = await runAdb(['-s', serial, 'shell', 'wm', 'size'], 3000);
    return parseAndroidWindowMetrics(output);
  } catch (_error) {
    // UI XML bounds are good enough as a fallback.
  }

  return {};
}

async function getAndroidDisplayRotation(serial) {
  try {
    const output = await runAdb(['-s', serial, 'shell', 'dumpsys', 'input'], 3000);
    return parseAndroidDisplayRotation(output);
  } catch (_error) {
    return 0;
  }
}

async function inspectMobileUi(serial, options = {}) {
  if (!serial) {
    throw new Error('缺少手机设备 SN');
  }

  const includeScreenshot = options.includeScreenshot !== false;
  const dumpPath = '/sdcard/window.xml';
  await runAdb(['-s', serial, 'shell', 'uiautomator', 'dump', dumpPath], 10000);
  const [xml, screenshotBuffer, windowMetrics, rotation] = await Promise.all([
    runAdb(['-s', serial, 'exec-out', 'cat', dumpPath], 8000),
    includeScreenshot ? runAdbBuffer(['-s', serial, 'exec-out', 'screencap', '-p'], 8000).catch(() => null) : Promise.resolve(null),
    getAndroidWindowSize(serial),
    includeScreenshot ? getAndroidDisplayRotation(serial) : Promise.resolve(0),
  ]);
  const parsedElements = parseAndroidUiElements(xml);
  const screenshot = parsePngDimensions(screenshotBuffer);
  const coordinateSpace = createMobileUiCoordinateSpace({
    elements: parsedElements,
    windowMetrics,
    screenshotSize: screenshot,
    rotation,
  });
  const elements = parsedElements.map((element) => ({
    ...element,
    screenshotRect: mapUiRectToScreenshot(element.rect, coordinateSpace),
  }));

  return {
    serial,
    capturedAt: new Date().toISOString(),
    screen: coordinateSpace.ui,
    screenshot: coordinateSpace.screenshot,
    coordinateTransform: {
      mode: coordinateSpace.mode,
      rotation: coordinateSpace.rotation,
      scaleX: coordinateSpace.scaleX,
      scaleY: coordinateSpace.scaleY,
      source: windowMetrics.source || 'xml-bounds',
      physical: windowMetrics.physical || null,
      override: windowMetrics.override || null,
    },
    elements,
    xml,
    screenshotDataUrl: screenshotBuffer
      ? `data:image/png;base64,${Buffer.from(screenshotBuffer).toString('base64')}`
      : '',
    commands: {
      dump: buildAdbCommandPreview(['-s', serial, 'shell', 'uiautomator', 'dump', dumpPath]),
      screenshot: buildAdbCommandPreview(['-s', serial, 'exec-out', 'screencap', '-p']),
    },
  };
}

async function waitForMobileUiElement(serial, selector, options = {}) {
  const timeout = Number(options.timeout || 10000);
  const matchMode = String(options.matchMode || 'auto');
  const pollIntervalMs = Math.min(500, Math.max(120, Number(options.pollIntervalMs || 250)));
  const deadline = Date.now() + timeout;
  let lastSnapshot = null;
  let attempts = 0;

  while (Date.now() <= deadline) {
    attempts += 1;
    lastSnapshot = await inspectMobileUi(serial, { includeScreenshot: false });
    const element = findMobileUiElement(lastSnapshot.elements, selector, matchMode);
    if (element) {
      return { element, snapshot: lastSnapshot, attempts };
    }
    await sleep(Math.min(pollIntervalMs, Math.max(80, deadline - Date.now())));
  }

  const normalizedSelector = normalizeMobileSelector(selector);
  const hint = [
    normalizedSelector.resourceId && `resourceId=${normalizedSelector.resourceId}`,
    normalizedSelector.text && `text=${normalizedSelector.text}`,
    normalizedSelector.contentDesc && `contentDesc=${normalizedSelector.contentDesc}`,
    normalizedSelector.className && `class=${normalizedSelector.className}`,
  ].filter(Boolean).join(', ') || JSON.stringify(normalizedSelector);
  const error = new Error(`超时未找到手机元素：${hint}`);
  error.errorCode = 'MOBILE_UI_ELEMENT_NOT_FOUND';
  error.errorType = 'device-element-not-found';
  error.recoveryActions = [
    '刷新手机页面，确认目标元素当前可见。',
    '如果刚手工修改了文本，请确认页面确实暴露了文本完全一致的独立元素。',
    '如果页面只暴露包含多个按钮的父容器，请让页面为每个按钮提供独立的 resource-id 或无障碍节点。',
  ];
  error.snapshot = lastSnapshot;
  error.attempts = attempts;
  throw error;
}

function getMobileFallbackPoint(selector = {}, screen = {}) {
  const normalizedSelector = normalizeMobileSelector(selector);
  const hasRatio = normalizedSelector.xRatio !== '' && normalizedSelector.yRatio !== '';
  const xRatio = Number(normalizedSelector.xRatio);
  const yRatio = Number(normalizedSelector.yRatio);
  const width = Number(screen.width || 0);
  const height = Number(screen.height || 0);

  if (hasRatio && Number.isFinite(xRatio) && Number.isFinite(yRatio) && width > 0 && height > 0) {
    return {
      x: Math.round(width * xRatio),
      y: Math.round(height * yRatio),
    };
  }

  const bounds = parseAndroidBounds(normalizedSelector.bounds);
  if (bounds) {
    return {
      x: bounds.centerX,
      y: bounds.centerY,
    };
  }

  return null;
}

function createMobileUiClickPreview(
  snapshot,
  selector = {},
  matchMode = 'auto',
  tapPosition = 'center',
  tapInsetXPx = 5,
  tapInsetYPx = tapInsetXPx
) {
  const normalizedSelector = normalizeMobileSelector(selector);
  const hasSelector = Object.entries(normalizedSelector)
    .some(([key, value]) => key !== 'className' && String(value || '').trim());
  if (!hasSelector) return null;

  const element = findMobileUiElement(snapshot.elements || [], normalizedSelector, matchMode);
  const normalizedTapInsetXPx = normalizeMobileUiTapInset(tapInsetXPx);
  const normalizedTapInsetYPx = normalizeMobileUiTapInset(tapInsetYPx);
  const point = element
    ? getMobileUiTapPoint(element.rect, tapPosition, normalizedTapInsetXPx, normalizedTapInsetYPx)
    : getMobileFallbackPoint(normalizedSelector, snapshot.screen);
  if (!point) return null;

  const screenshotPoint = mapUiPointToScreenshot(point, {
    ui: snapshot.screen,
    screenshot: snapshot.screenshot,
    mode: snapshot.coordinateTransform?.mode || 'scale',
    rotation: snapshot.coordinateTransform?.rotation || 0,
  });

  return {
    source: element ? 'element-anchor' : 'coordinate-fallback',
    x: point.x,
    y: point.y,
    screenshotX: screenshotPoint.x,
    screenshotY: screenshotPoint.y,
    elementId: element?.id || '',
    elementLabel: element?.label || '',
    bounds: element?.bounds || normalizedSelector.bounds || '',
    tapPosition: element ? normalizeMobileUiTapPosition(tapPosition) : 'coordinate-fallback',
    tapInsetXPx: element ? normalizedTapInsetXPx : null,
    tapInsetYPx: element ? normalizedTapInsetYPx : null,
  };
}

function escapeAdbInputText(value) {
  return String(value || '')
    .replace(/\\/g, '\\\\')
    .replace(/\s/g, '%s')
    .replace(/"/g, '\\"')
    .replace(/'/g, "\\'");
}

function getSwipePointFromRatio(screen = {}, xRatio, yRatio) {
  const width = Number(screen.width || 0);
  const height = Number(screen.height || 0);
  const x = Number(xRatio);
  const y = Number(yRatio);

  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || !Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }

  return {
    x: Math.round(width * Math.min(1, Math.max(0, x))),
    y: Math.round(height * Math.min(1, Math.max(0, y))),
  };
}

async function executeSoloPiReplayStep(step, context, config, serial) {
  const nativeCase = require('./solopi-native-schema').applyNativeInputs(typeof config.nativeCase === 'string' ? JSON.parse(config.nativeCase) : config.nativeCase, config);
  const id = crypto.randomUUID();
  const requestId = workflowCommandScope.getStore();
  const cancel = () => soloPiProvider.cancelPending(id);
  const pending = workflowCommandCancels.get(requestId) || new Set();
  if (requestId) { pending.add(cancel); workflowCommandCancels.set(requestId, pending); }
  try {
    if (isWorkflowCanceled(requestId)) throw createWorkflowStoppedError();
    const result = await soloPiProvider.execute({ id, serial, nativeCase, targetPackage: context.defaults.phonePackage || nativeCase.targetAppPackage, restartApp: parseWorkflowBoolean(config.restartApp, true), runTimeoutMs: Math.min(Number(config.runTimeoutMs || 600000), step.timeoutMs || 3600000) }, 'replay-case');
    return { command: `SoloPi native replay · ${result.operationCount} steps`, stdout: JSON.stringify({ runId: result.runId, state: result.state, results: result.results, warnings: result.warnings }, null, 2), stderr: '', meta: { soloPi: result } };
  } finally { pending.delete(cancel); if (requestId && !pending.size) workflowCommandCancels.delete(requestId); }
}

async function executeMobileUiStep(step, context, config) {
  const serial = getWorkflowSerial({ ...step, device: 'phone' }, context);
  const action = String(config.action || 'tap');
  if (action === 'solopi_replay') return executeSoloPiReplayStep(step, context, config, serial);
  const selector = normalizeMobileSelector(config.selector || {});
  const timeout = step.timeoutMs || Number(config.timeoutMs || 10000);
  const matchMode = String(config.matchMode || 'auto');
  const tapPosition = normalizeMobileUiTapPosition(config.tapPosition || 'center');
  const legacyTapInsetPx = normalizeMobileUiTapInset(config.tapInsetPx, 5);
  const tapInsetXPx = normalizeMobileUiTapInset(config.tapInsetXPx, legacyTapInsetPx);
  const tapInsetYPx = normalizeMobileUiTapInset(config.tapInsetYPx, legacyTapInsetPx);
  const commands = [];
  let snapshot = null;
  let element = null;

  const ensureElement = async () => {
    const result = await waitForMobileUiElement(serial, selector, {
      timeout,
      matchMode,
      pollIntervalMs: config.pollIntervalMs,
    });
    snapshot = result.snapshot;
    element = result.element;
    element.__attempts = result.attempts;
    return result.element;
  };

  if (action === 'back' || action === 'home') {
    const args = ['-s', serial, 'shell', 'input', 'keyevent', action === 'home' ? 'HOME' : 'BACK'];
    const result = await runCommand(getAdbPath(), args, timeout);
    return {
      command: buildAdbCommandPreview(args),
      stdout: action === 'home' ? '已执行主页键' : '已执行返回键',
      stderr: result.stderr || '',
    };
  }

  if (action === 'swipe_element') {
    await ensureElement();
    const gesture = getMobileUiElementSwipe(element.rect, snapshot.screen, config);
    const args = ['-s', serial, 'shell', 'input', 'swipe', String(gesture.fromX), String(gesture.fromY), String(gesture.toX), String(gesture.toY), String(gesture.duration)];
    const result = await runCommand(getAdbPath(), args, timeout);
    return { command: buildAdbCommandPreview(args), stdout: `已按命中元素执行 ${config.direction} 滑动 ${config.distancePercent ?? 100}%：${gesture.fromX},${gesture.fromY} → ${gesture.toX},${gesture.toY}`, stderr: result.stderr || '' };
  }

  if (action === 'swipe') {
    snapshot = await inspectMobileUi(serial);
    const swipe = parseWorkflowJsonObject(config.swipe);
    const start = getSwipePointFromRatio(snapshot.screen, swipe.startXRatio ?? swipe.startX ?? '0.5', swipe.startYRatio ?? swipe.startY ?? '0.8');
    const end = getSwipePointFromRatio(snapshot.screen, swipe.endXRatio ?? swipe.endX ?? '0.5', swipe.endYRatio ?? swipe.endY ?? '0.2');
    const durationMs = Math.max(0, Number(swipe.durationMs || config.durationMs || 400));

    if (!start || !end) {
      throw new Error('手机 UI 滑动节点缺少有效 swipe.startXRatio/startYRatio/endXRatio/endYRatio');
    }

    const args = ['-s', serial, 'shell', 'input', 'swipe', String(start.x), String(start.y), String(end.x), String(end.y), String(durationMs)];
    const result = await runCommand(getAdbPath(), args, timeout);
    return {
      command: buildAdbCommandPreview(args),
      stdout: `已执行手机滑动：${start.x},${start.y} -> ${end.x},${end.y} (${durationMs}ms)`,
      stderr: result.stderr || '',
    };
  }

  if (action === 'wait' || action === 'assert') {
    await ensureElement();
    return {
      command: `mobile ui ${action} · ${JSON.stringify(selector)}`,
      stdout: [
        action === 'wait' ? '手机元素已出现' : '手机元素断言通过',
        `轮询次数：${element.__attempts || '-'}`,
        `命中时间：${snapshot?.capturedAt || '-'}`,
        `命中元素：${element.label}`,
        `bounds：${element.bounds}`,
        `resourceId：${element.resourceId || '-'}`,
        `text：${element.text || '-'}`,
        `contentDesc：${element.contentDesc || '-'}`,
      ].join('\n'),
      stderr: '',
    };
  }

  if (action === 'tap' || action === 'input') {
    try {
      await ensureElement();
    } catch (error) {
      if (action === 'tap' && parseWorkflowBoolean(config.allowCoordinateFallback, true)) {
        snapshot = error.snapshot || await inspectMobileUi(serial);
        const point = getMobileFallbackPoint(selector, snapshot.screen);
        if (!point) {
          throw error;
        }
        const args = ['-s', serial, 'shell', 'input', 'tap', String(point.x), String(point.y)];
        const result = await runCommand(getAdbPath(), args, timeout);
        return {
          command: buildAdbCommandPreview(args),
          stdout: `未命中元素，已使用比例/边界兜底点击：${point.x},${point.y}`,
          stderr: result.stderr || '',
        };
      }
      throw error;
    }

    const point = getMobileUiTapPoint(element.rect, tapPosition, tapInsetXPx, tapInsetYPx, config.tapRatioX ?? 0.5, config.tapRatioY ?? 0.5);
    const tapArgs = ['-s', serial, 'shell', 'input', 'tap', String(point.x), String(point.y)];
    const tapResult = await runCommand(getAdbPath(), tapArgs, timeout);
    commands.push(buildAdbCommandPreview(tapArgs));

    if (action === 'input') {
      if (parseWorkflowBoolean(config.clearBeforeInput, false)) {
        const clearArgs = ['-s', serial, 'shell', 'input', 'keyevent', 'KEYCODE_MOVE_END'];
        const deleteArgs = ['-s', serial, 'shell', 'input', 'keyevent', '--longpress', 'KEYCODE_DEL'];
        await runCommand(getAdbPath(), clearArgs, 3000).catch(() => ({ stderr: '' }));
        await runCommand(getAdbPath(), deleteArgs, 3000).catch(() => ({ stderr: '' }));
        commands.push(buildAdbCommandPreview(clearArgs), buildAdbCommandPreview(deleteArgs));
      }

      const text = String(config.inputText || '');
      if (!text) {
        throw new Error('手机 UI 输入节点缺少 inputText');
      }
      const inputArgs = ['-s', serial, 'shell', 'input', 'text', escapeAdbInputText(text)];
      const inputResult = await runCommand(getAdbPath(), inputArgs, timeout);
      commands.push(buildAdbCommandPreview(inputArgs));

      return {
        command: commands.join('\n'),
        stdout: [`已点击元素并输入文本`, `命中元素：${element.label}`, `点击位置：${tapPosition}`, `横向内缩：${tapInsetXPx}px`, `纵向内缩：${tapInsetYPx}px`, `坐标：${point.x},${point.y}`, tapResult.stdout, inputResult.stdout].filter(Boolean).join('\n'),
        stderr: [tapResult.stderr, inputResult.stderr].filter(Boolean).join('\n'),
      };
    }

    return {
      command: commands.join('\n'),
      stdout: [`已点击手机元素`, `命中元素：${element.label}`, `点击位置：${tapPosition}`, `横向内缩：${tapInsetXPx}px`, `纵向内缩：${tapInsetYPx}px`, `坐标：${point.x},${point.y}`, tapResult.stdout].filter(Boolean).join('\n'),
      stderr: tapResult.stderr || '',
    };
  }

  throw new Error(`暂不支持的手机 UI 动作：${action}`);
}

function createDefaultTtsConfig() {
  return {
    enabled: false,
    name: 'HTTP TTS',
    url: '',
    method: 'POST',
    params: [{ key: 'text', defaultValue: '' }],
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

function normalizeTtsParams(params) {
  const normalized = (Array.isArray(params) ? params : [])
    .map((param) => ({
      key: String(param?.key || '').trim(),
      defaultValue: String(param?.defaultValue ?? ''),
    }))
    .filter((param) => param.key);
  const textParam = normalized.find((param) => param.key === 'text');

  return [
    {
      key: 'text',
      defaultValue: textParam?.defaultValue || '',
    },
  ];
}

function normalizeTtsResponseMappings(mappings, fallbackPath = '') {
  const normalized = (Array.isArray(mappings) ? mappings : [])
    .map((mapping) => ({
      variableName: String(mapping?.variableName || '').trim(),
      responsePath: String(mapping?.responsePath || '').trim(),
    }));
  const fallback = String(fallbackPath || '').trim();

  if (normalized.length > 0 && fallback && normalized.every((mapping) => !mapping.responsePath)) {
    return [
      { ...normalized[0], responsePath: fallback },
      ...normalized.slice(1),
    ];
  }

  return normalized.length > 0 ? normalized : [{ variableName: '', responsePath: fallback }];
}

function normalizeTtsConfig(rawConfig = {}) {
  const defaults = createDefaultTtsConfig();
  const config = {
    ...defaults,
    ...(rawConfig || {}),
  };
  const method = String(config.method || defaults.method).toUpperCase();
  const responseType = 'json-url';
  const outputExtension = String(config.outputExtension || defaults.outputExtension).replace(/^\./, '').toLowerCase() || defaults.outputExtension;
  const fallbackResponsePath = config.urlField || defaults.urlField;
  const responseMappings = normalizeTtsResponseMappings(config.responseMappings, fallbackResponsePath);

  return {
    ...config,
    enabled: Boolean(config.enabled),
    method: ['GET', 'POST', 'PUT'].includes(method) ? method : defaults.method,
    responseType,
    params: normalizeTtsParams(config.params),
    responseMappings,
    audioField: String(config.audioField || responseMappings[0]?.responsePath || ''),
    urlField: String(config.urlField || responseMappings[0]?.responsePath || ''),
    outputExtension,
    sampleRate: Number(config.sampleRate) > 0 ? Number(config.sampleRate) : defaults.sampleRate,
    sampleFormat: String(config.sampleFormat || defaults.sampleFormat),
    channelCnt: Number(config.channelCnt) > 0 ? Number(config.channelCnt) : defaults.channelCnt,
    timeoutMs: Number(config.timeoutMs) > 0 ? Number(config.timeoutMs) : defaults.timeoutMs,
  };
}

function renderTtsTemplate(template, variables) {
  const expandedVariables = createTtsTemplateVariables(variables);

  return String(template || '').replace(/\{\{\s*([^}]+?)\s*\}\}/g, (_match, expression) => {
    const key = expression.trim();
    const value = expandedVariables[key];
    return value === undefined || value === null ? '' : String(value);
  }).replace(/\$\{([^}]+)\}/g, (_match, expression) => {
    const key = expression.trim();
    const value = expandedVariables[key];
    return value === undefined || value === null ? '' : String(value);
  });
}

function createTtsTemplateVariables(variables = {}) {
  const result = { ...(variables || {}) };
  const text = String(result.text ?? '');
  const voice = String(result.voice ?? '');

  result.textJson = JSON.stringify(text);
  result.textUrlEncoded = encodeURIComponent(text);
  result.voiceJson = JSON.stringify(voice);
  result.voiceUrlEncoded = encodeURIComponent(voice);

  return result;
}

function ttsTemplateUsesTextParam(...templates) {
  const text = templates.join('\n');

  return /(?:\{\{\s*|\$\{\s*)text(?:Json|UrlEncoded)?\s*(?:\}\}|\})/.test(text);
}

function parseTtsHeaders(headersText) {
  const raw = String(headersText || '').trim();

  if (!raw) {
    return {};
  }

  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_error) {
    const headers = {};
    raw.split(/\r?\n/).forEach((line) => {
      const index = line.indexOf(':');
      if (index > 0) {
        headers[line.slice(0, index).trim()] = line.slice(index + 1).trim();
      }
    });
    return headers;
  }
}

function getJsonPathValue(source, pathExpression) {
  if (!pathExpression) {
    return source;
  }

  return String(pathExpression)
    .split('.')
    .map((part) => part.trim())
    .filter(Boolean)
    .reduce((current, key) => (current && typeof current === 'object' ? current[key] : undefined), source);
}

function getTtsMimeType(extension) {
  const ext = String(extension || '').replace(/^\./, '').toLowerCase();
  if (ext === 'wav') return 'audio/wav';
  if (ext === 'mp3') return 'audio/mpeg';
  if (ext === 'ogg') return 'audio/ogg';
  if (ext === 'm4a' || ext === 'aac') return 'audio/mp4';
  if (ext === 'webm') return 'audio/webm';
  return 'application/octet-stream';
}

function getTtsExtensionFromContentType(contentType) {
  const value = String(contentType || '').toLowerCase();

  if (value.includes('mpeg') || value.includes('mp3')) return 'mp3';
  if (value.includes('wav')) return 'wav';
  if (value.includes('ogg') || value.includes('opus')) return 'ogg';
  if (value.includes('mp4') || value.includes('aac') || value.includes('m4a')) return 'm4a';
  if (value.includes('webm')) return 'webm';
  return '';
}

function decodeBase64Audio(value) {
  const text = String(value || '');
  const match = text.match(/^data:.*?;base64,(.*)$/);
  return Buffer.from(match ? match[1] : text, 'base64');
}

function getTtsPrimaryResponsePath(ttsConfig, legacyField) {
  const firstMappingPath = Array.isArray(ttsConfig.responseMappings)
    ? String(ttsConfig.responseMappings[0]?.responsePath || '').trim()
    : '';

  return firstMappingPath || String(ttsConfig[legacyField] || '').trim();
}

function collectTtsResponseVariables(json, mappings = []) {
  return (Array.isArray(mappings) ? mappings : []).reduce((result, mapping) => {
    const variableName = String(mapping?.variableName || '').trim();
    const responsePath = String(mapping?.responsePath || '').trim();

    if (!variableName || !responsePath) {
      return result;
    }

    result[variableName] = getJsonPathValue(json, responsePath);
    return result;
  }, {});
}

async function synthesizeTtsAudio(text, options = {}) {
  const envConfig = readEnvironmentConfig();
  const ttsConfig = normalizeTtsConfig(revealSecrets(options.provider || envConfig.ttsProvider || {}, safeStorage));

  if (!ttsConfig.enabled) {
    throw new Error('TTS 合成接口未启用，请先在设置中心配置并启用 HTTP TTS');
  }

  if (!ttsConfig.url) {
    throw new Error('TTS 合成接口 URL 未配置');
  }

  if (!ttsTemplateUsesTextParam(ttsConfig.url, ttsConfig.headersText, ttsConfig.bodyTemplate)) {
    throw new Error('TTS URL/Header/Body 中没有使用 text/textUrlEncoded/textJson，无法动态输入文本合成');
  }

  const paramDefaults = Object.fromEntries((ttsConfig.params || []).map((param) => [param.key, param.defaultValue || '']));
  const optionParams = options.params && typeof options.params === 'object' && !Array.isArray(options.params)
    ? options.params
    : {};
  const finalText = String(optionParams.text || text || paramDefaults.text || '').trim();
  if (!finalText) {
    throw new Error('TTS 参数 text 不能为空');
  }
  const variables = {
    ...paramDefaults,
    ...optionParams,
    text: finalText,
    format: options.outputFormat || ttsConfig.outputExtension || 'pcm',
    sampleRate: options.sampleRate || ttsConfig.sampleRate || 16000,
    sampleFormat: options.sampleFormat || ttsConfig.sampleFormat || 'AV_SAMPLE_FMT_S16',
    channelCnt: options.channelCnt || ttsConfig.channelCnt || 1,
    stepId: options.stepId || 'tts',
  };
  const url = renderTtsTemplate(ttsConfig.url, variables);
  const headers = parseTtsHeaders(renderTtsTemplate(ttsConfig.headersText, variables));
  const body = ['GET'].includes(ttsConfig.method) ? undefined : renderTtsTemplate(ttsConfig.bodyTemplate, variables);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ttsConfig.timeoutMs);
  const release = bindWorkflowNetworkAbort(controller);
  const httpResponses = [];
  let primaryHttpResponse;

  const recordTtsHttpResponse = (stage, evidence) => {
    if (!primaryHttpResponse) {
      primaryHttpResponse = evidence;
    }
    httpResponses.push({
      stage,
      ...evidence,
    });
    return evidence;
  };

  const formatTtsHttpResponses = () => httpResponses
    .map(({ stage, ...evidence }) => [
      `TTS HTTP 响应阶段：${stage}`,
      formatHttpResponseEvidence(evidence),
    ].join('\n'))
    .join('\n\n');

  try {
    const response = await fetch(url, {
      method: ttsConfig.method,
      headers,
      body,
      signal: controller.signal,
    });

    const responseBodyText = ttsConfig.responseType === 'binary' && response.ok ? '' : await response.text();
    const createTtsResponseError = (message, httpResponse, code = 'TTS_RESPONSE_ERROR', details = {}) => {
      const recoveryActions = getTtsResponseRecoveryActions(code, details);
      const error = new Error(message);
      error.code = code;
      error.errorCode = code;
      error.errorType = 'external-service';
      error.recoveryActions = recoveryActions;
      error.httpResponse = httpResponse;
      error.httpResponses = [...httpResponses];
      error.diagnostics = {
        schemaVersion: 'glassbox.error.v1',
        code,
        errorCode: code,
        type: 'external-service',
        errorType: 'external-service',
        message,
        recoveryActions,
        details: {
          ...details,
          httpResponse,
          httpResponses: [...httpResponses],
        },
      };
      error.stdout = formatTtsHttpResponses();
      error.stderr = message;
      error.meta = {
        httpResponse,
        httpResponses: [...httpResponses],
        diagnostics: error.diagnostics,
      };
      return error;
    };

    if (!response.ok) {
      const httpResponse = recordTtsHttpResponse(
        'synthesis',
        createHttpResponseEvidence(response, responseBodyText)
      );
      throw createTtsResponseError(
        `TTS HTTP ${response.status}: ${responseBodyText.slice(0, 500)}`,
        httpResponse,
        'TTS_HTTP_ERROR'
      );
    }

    let audioBuffer;
    let remoteAudioUrl = '';
    let audioContentType = '';
    let responseVariables = {};
    if (ttsConfig.responseType === 'binary') {
      audioContentType = response.headers.get('content-type') || '';
      audioBuffer = Buffer.from(await response.arrayBuffer());
      recordTtsHttpResponse(
        'synthesis',
        createHttpResponseEvidence(response, '', {
          binary: true,
          contentType: audioContentType,
          byteLength: audioBuffer.length,
        })
      );
    } else if (ttsConfig.responseType === 'json-base64') {
      let json;
      try {
        json = responseBodyText ? JSON.parse(responseBodyText) : null;
      } catch (error) {
        const httpResponse = recordTtsHttpResponse(
          'synthesis',
          createHttpResponseEvidence(response, responseBodyText)
        );
        throw createTtsResponseError(`TTS JSON 响应解析失败：${error.message}`, httpResponse, 'TTS_RESPONSE_INVALID_JSON');
      }
      const httpResponse = recordTtsHttpResponse(
        'synthesis',
        createHttpResponseEvidence(response, responseBodyText, json)
      );
      const businessFailure = classifyTtsBusinessResponse(json);
      if (businessFailure.failed) {
        const statusText = businessFailure.status === undefined
          ? 'unknown'
          : String(businessFailure.status);
        const serviceMessage = businessFailure.message || 'TTS 服务返回业务失败';
        throw createTtsResponseError(
          `TTS 业务响应失败（status=${statusText}）：${serviceMessage}`,
          httpResponse,
          'TTS_BUSINESS_ERROR',
          {
            status: businessFailure.status,
            msg: businessFailure.message,
            traceId: businessFailure.traceId,
          }
        );
      }
      responseVariables = collectTtsResponseVariables(json, ttsConfig.responseMappings);
      const audioFieldPath = getTtsPrimaryResponsePath(ttsConfig, 'audioField');
      const base64 = getJsonPathValue(json, audioFieldPath);
      if (!base64) {
        throw createTtsResponseError(
          `TTS JSON 响应中未找到音频字段：${audioFieldPath || '未配置'}`,
          httpResponse,
          'TTS_RESPONSE_FIELD_MISSING'
        );
      }
      audioBuffer = decodeBase64Audio(base64);
    } else {
      let json;
      try {
        json = responseBodyText ? JSON.parse(responseBodyText) : null;
      } catch (error) {
        const httpResponse = recordTtsHttpResponse(
          'synthesis',
          createHttpResponseEvidence(response, responseBodyText)
        );
        throw createTtsResponseError(`TTS JSON 响应解析失败：${error.message}`, httpResponse, 'TTS_RESPONSE_INVALID_JSON');
      }
      const httpResponse = recordTtsHttpResponse(
        'synthesis',
        createHttpResponseEvidence(response, responseBodyText, json)
      );
      const businessFailure = classifyTtsBusinessResponse(json);
      if (businessFailure.failed) {
        const statusText = businessFailure.status === undefined
          ? 'unknown'
          : String(businessFailure.status);
        const serviceMessage = businessFailure.message || 'TTS 服务返回业务失败';
        throw createTtsResponseError(
          `TTS 业务响应失败（status=${statusText}）：${serviceMessage}`,
          httpResponse,
          'TTS_BUSINESS_ERROR',
          {
            status: businessFailure.status,
            msg: businessFailure.message,
            traceId: businessFailure.traceId,
          }
        );
      }
      responseVariables = collectTtsResponseVariables(json, ttsConfig.responseMappings);
      const urlFieldPath = getTtsPrimaryResponsePath(ttsConfig, 'urlField');
      const audioUrl = getJsonPathValue(json, urlFieldPath);
      if (!audioUrl) {
        throw createTtsResponseError(
          `TTS JSON 响应中未找到 URL 字段：${urlFieldPath || '未配置'}`,
          httpResponse,
          'TTS_RESPONSE_FIELD_MISSING'
        );
      }
      remoteAudioUrl = String(audioUrl);
      const audioResponse = await fetch(remoteAudioUrl, { signal: controller.signal });
      if (!audioResponse.ok) {
        const audioResponseBody = await audioResponse.text();
        const audioHttpResponse = recordTtsHttpResponse(
          'audio-download',
          createHttpResponseEvidence(audioResponse, audioResponseBody)
        );
        throw createTtsResponseError(
          `TTS 音频下载失败 HTTP ${audioResponse.status}`,
          audioHttpResponse,
          'TTS_AUDIO_DOWNLOAD_ERROR'
        );
      }
      audioContentType = audioResponse.headers.get('content-type') || '';
      audioBuffer = Buffer.from(await audioResponse.arrayBuffer());
      recordTtsHttpResponse(
        'audio-download',
        createHttpResponseEvidence(audioResponse, '', {
          binary: true,
          contentType: audioContentType,
          byteLength: audioBuffer.length,
        })
      );
    }

    if (!audioBuffer?.length) {
      throw new Error('TTS 接口返回了空音频');
    }

    const configuredExtension = String(options.outputFormat || ttsConfig.outputExtension || '').replace(/^\./, '').toLowerCase();
    const detectedExtension = getTtsExtensionFromContentType(audioContentType);
    let extension = configuredExtension || detectedExtension || 'pcm';
    if (configuredExtension && configuredExtension !== detectedExtension) {
      const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'glassbox-tts-transcode-'));
      const sourceExtension = detectedExtension || getAudioOutputExtension(configuredExtension);
      const tempInputPath = path.join(tempRoot, `source.${sourceExtension}`);
      const tempOutputPath = path.join(tempRoot, `output.${getAudioOutputExtension(configuredExtension)}`);

      try {
        fs.writeFileSync(tempInputPath, audioBuffer);
        await transcodeAudioFile(tempInputPath, tempOutputPath, {
          outputFormat: configuredExtension,
          sampleFormat: variables.sampleFormat,
          sampleRate: variables.sampleRate,
          channelCnt: variables.channelCnt,
          timeoutMs: ttsConfig.timeoutMs,
        });
        audioBuffer = fs.readFileSync(tempOutputPath);
        extension = getAudioOutputExtension(configuredExtension);
        audioContentType = getTtsMimeType(extension);
      } finally {
        fs.rmSync(tempRoot, { recursive: true, force: true });
      }
    }
    controller.signal.throwIfAborted();
    const sha256 = crypto.createHash('sha256').update(audioBuffer).digest('hex');
    const fileName = `${sanitizeFilePart(options.stepId || 'tts')}-${createTimestamp()}-${sha256.slice(0, 12)}-${crypto.randomUUID()}.${extension}`;
    const filePath = path.join(getTtsAudioDir(), fileName);
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, audioBuffer);

    return {
      success: true,
      path: filePath,
      url: remoteAudioUrl || pathToFileURL(filePath).href,
      localUrl: pathToFileURL(filePath).href,
      sourceUrl: remoteAudioUrl,
      size: audioBuffer.length,
      sha256,
      mimeType: getTtsMimeType(extension),
      extension,
      sampleRate: variables.sampleRate,
      sampleFormat: variables.sampleFormat,
      channelCnt: variables.channelCnt,
      provider: ttsConfig.name || 'HTTP TTS',
      responseVariables,
      httpResponse: primaryHttpResponse,
      httpResponses,
    };
  } catch (error) {
    if(controller.signal.reason?.code==='WORKFLOW_STOPPED')error=controller.signal.reason;
    if (httpResponses.length > 0) {
      error.httpResponse ||= primaryHttpResponse;
      error.httpResponses ||= [...httpResponses];
      error.stdout ||= formatTtsHttpResponses();
      error.stderr ||= error.message;
      error.meta = {
        ...(error.meta || {}),
        httpResponse: error.httpResponse,
        httpResponses: error.httpResponses,
      };
    }
    throw error;
  } finally {
    clearTimeout(timer);
    release();
  }
}

async function enableDeviceScreenAwake(serial) {
  if (!serial) {
    return null;
  }

  const args = ['-s', serial, 'shell', 'svc', 'power', 'stayon', 'true'];
  try {
    const result = await runCommand(getAdbPath(), args, 5000);
    return {
      serial,
      command: buildAdbCommandPreview(args),
      success: true,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } catch (error) {
    return {
      serial,
      command: buildAdbCommandPreview(args),
      success: false,
      error: error.message,
      errorCode: error.errorCode || error.code || 'DEVICE_SCREEN_AWAKE_FAILED',
      errorType: 'device-screen-awake-warning',
      exitCode: error.exitCode ?? null,
      signal: error.signal ?? null,
      timeoutMs: error.timeoutMs ?? null,
      stdout: error.stdout || '',
      stderr: error.stderr || '',
      recoveryActions: [
        '屏幕常亮设置失败不影响业务执行；必要时可在设备端手动保持亮屏。',
        '若频繁出现 exitCode=137，检查设备系统对 svc power 命令的限制。',
      ],
      diagnostics: error.diagnostics,
    };
  }
}

async function checkRequiredWorkflowDevices(context) {
  const targets = [
    {
      role: 'phone',
      serial: context.defaults.phoneSerial || '',
      packageName: context.defaults.phonePackage || '',
    },
    {
      role: 'glasses',
      serial: context.defaults.glassesSerial || '',
      packageName: context.defaults.glassesPackage || '',
    },
  ].filter((target) => target.serial);

  return Promise.all(targets.map(async (target) => {
    const result = await runRequiredDevicePreflight(target, (args, timeoutMs) => (
      runCommand(getAdbPath(), args, timeoutMs)
    ));
    return {
      ...result,
      role: target.role,
      command: result.checks.map((check) => buildAdbCommandPreview(check.args)).join('\n'),
    };
  }));
}

function createDevicePreflightError(results = []) {
  const failures = results.filter((result) => !result.success).map((result) => ({
    ...result.failure,
    role: result.role,
    command: result.command,
    checks: result.checks,
  }));
  const primary = failures[0] || {};
  const message = failures.map((item) => (
    `${item.serial || 'unknown device'}: ${item.error || '设备前置检查失败'}`
  )).join('\n');
  const recoveryActions = [
    '运行 glassbox devices list --json，确认目标设备在线、已授权且 ADB transport 稳定。',
    '在设备恢复前不要继续业务步骤；重新连接设备或重启 ADB 后再提交任务。',
    '若启用了 --perf，确认目标应用进程已启动且包名正确，再重跑最小平台用例。',
  ];
  const error = new Error(`设备前置检查失败，已阻止后续业务步骤：\n${message}`);
  error.code = 'DEVICE_PREFLIGHT_FAILED';
  error.errorCode = 'DEVICE_PREFLIGHT_FAILED';
  error.errorType = 'device-preflight';
  error.command = failures.map((item) => item.command).filter(Boolean).join('\n');
  error.exitCode = primary.exitCode ?? null;
  error.signal = primary.signal ?? null;
  error.timeoutMs = primary.timeoutMs ?? null;
  error.stdout = failures.map((item) => item.stdout).filter(Boolean).join('\n');
  error.stderr = failures.map((item) => item.stderr || item.error).filter(Boolean).join('\n');
  error.recoveryActions = recoveryActions;
  error.diagnostics = createWorkflowErrorDiagnostics(
    error.errorCode,
    error.errorType,
    error.message,
    recoveryActions,
    { failures }
  );
  return error;
}

function isWorkflowTaskEnvironmentPreflightFailure(runResult = {}) {
  const failures = [runResult, ...(runResult.results || []).filter(item => item.status === 'failed')];
  if (failures.some(item => {
    const code = String(item.errorCode || item.code || '');
    if (code.startsWith('WORKFLOW_LOG_BOUNDARY_') || code === 'LOG_EVIDENCE_UNAVAILABLE' || item.errorType === 'log-infrastructure') return false;
    const output = String(item.stderr || item.error || '');
    return /^(DEVICE_(?:ADB_)?(?:OFFLINE|UNAUTHORIZED|NOT_FOUND|TRANSPORT_UNAVAILABLE)|WORKFLOW_REQUIRED_VARIABLE_MISSING)$/.test(code)
      || /(?:error:\s*)?device(?:\s+['"][^'"]+['"])?\s+(?:not found|offline|unauthorized)\b|no devices?\/emulators? found|error:\s*(?:closed|transport error|connection reset)/i.test(output);
  })) return true;
  const errorCode = String(runResult.errorCode || '');
  const errorType = String(runResult.errorType || '');
  const diagnosticCode = String(runResult.diagnostics?.code || '');
  return errorType === 'device-preflight'
    || errorCode === 'DEVICE_PREFLIGHT_FAILED'
    || errorCode === 'PERFORMANCE_TARGET_PROCESS_NOT_FOUND'
    || diagnosticCode === 'DEVICE_PREFLIGHT_FAILED'
    || diagnosticCode === 'PERFORMANCE_TARGET_PROCESS_NOT_FOUND';
}

async function enableWorkflowScreenAwake(context) {
  const requiredChecks = await checkRequiredWorkflowDevices(context);
  if (requiredChecks.some((result) => !result.success)) {
    throw createDevicePreflightError(requiredChecks);
  }

  const targets = Array.from(new Set([
    context.defaults.phoneSerial || '',
    context.defaults.glassesSerial || '',
  ].filter(Boolean)));
  const results = (await Promise.all(targets.map(enableDeviceScreenAwake))).filter(Boolean);
  const warnings = results.map(createScreenAwakeWarning).filter(Boolean);

  return {
    command: [
      ...requiredChecks.map((item) => item.command),
      ...results.map((item) => item.command),
    ].filter(Boolean).join('\n') || 'skip screen awake',
    stdout: results.map((item) => (
      item.success
        ? `${item.serial}: 已开启屏幕常亮`
        : `${item.serial}: 屏幕常亮开启失败：${item.error}`
    )).join('\n'),
    stderr: results.filter((item) => !item.success).map((item) => item.error).join('\n'),
    warnings,
  };
}

function normalizeActivityReference(packageName, activityName) {
  const packageValue = String(packageName || '').trim();
  const activityValue = String(activityName || '').trim();
  const fullActivity = activityValue.startsWith('.')
    ? `${packageValue}${activityValue}`
    : activityValue;
  const shortActivity = fullActivity.startsWith(`${packageValue}.`)
    ? `.${fullActivity.slice(packageValue.length + 1)}`
    : activityValue;

  return {
    packageName: packageValue,
    activityName: activityValue,
    fullActivity,
    shortActivity,
  };
}

function activityOutputMatches(output, packageName, activityName) {
  const { fullActivity } = normalizeActivityReference(packageName, activityName);

  if (!packageName || !activityName || !fullActivity) {
    return false;
  }

  const lines=String(output || '').split(/\r?\n/);
  const current=lines.filter(line=>/^\s*mCurrentFocus\s*=/.test(line));
  const focused=current.length?current:lines.filter(line=>/^\s*mFocusedApp\s*=/.test(line));
  return focused.some(line=>{
    const component=line.match(/([^\s{}/]+)\/([^\s{}/]+)/);
    return component?.[1]===packageName && normalizeActivityReference(component[1],component[2]).fullActivity===fullActivity;
  });
}

async function queryAndroidProcessState(serial, packageName) {
  const safeSerial = String(serial || '').trim();
  const safePackage = String(packageName || '').trim();
  if (!safeSerial || !safePackage) {
    return { success: false, running: false, errorCode: 'PROCESS_QUERY_INVALID_ARGUMENT' };
  }
  const args = ['-s', safeSerial, 'shell', 'pidof', safePackage];
  try {
    const result = await runCommand(getAdbPath(), args, 5000);
    const stdout = String(result.stdout || '').trim();
    return {
      success: true,
      running: Boolean(stdout),
      pid: stdout.split(/\s+/).filter(Boolean)[0] || '',
      command: buildAdbCommandPreview(args),
      stdout,
    };
  } catch (error) {
    const text = [error.message, error.stderr, error.stdout].filter(Boolean).join('\n').toLowerCase();
    if ((Number(error.exitCode) === 1 || /process|not found|no such process/.test(text))
      && !/offline|unauthorized|transport|no devices/.test(text)) {
      return { success: true, running: false, pid: '', command: buildAdbCommandPreview(args), stdout: '' };
    }
    return {
      success: false,
      running: false,
      command: buildAdbCommandPreview(args),
      errorCode: error.errorCode || error.code || 'PROCESS_QUERY_FAILED',
      error: error.message,
      stderr: error.stderr || '',
      recoveryActions: error.recoveryActions || [],
    };
  }
}

async function executeLaunchActivityComponent(step, context, componentSerial, renderedValues, timeout, commandTemplate) {
  const packageName = String(renderedValues.packageName || '').trim();
  const activityName = String(renderedValues.activity || '').trim();

  if (!packageName) {
    throw new Error(`组件「${step.name}」缺少包名`);
  }

  if (!activityName) {
    throw new Error(`组件「${step.name}」缺少 Activity 名`);
  }

  const deadline = Date.now() + Math.max(1, timeout || 5000);
  // Activity originally needed only package/activity; preserve that contract for saved empty templates.
  const template=String(commandTemplate || '').trim() || 'adb -s {{serial}} shell am start -n {{packageName}}/{{activity}}';
  const command=renderCommandTemplate(resolveWorkflowValue(template,context),renderedValues);
  const adbPath=getAdbPath();
  const isAdb=command==='adb' || command.startsWith('adb ') || command===adbPath || command.startsWith(adbPath+' ');
  const launch=isAdb?createAdbExecution(command):createPcExecution(command);
  const launchResult = await runCommand(launch.command,launch.args,Math.max(1,deadline-Date.now()));
  const inspectArgs=['-s',componentSerial,'shell','dumpsys','window','displays'];
  let lastWindowOutput = '';
  let lastInspectError;

  while (Date.now() < deadline) {
    if(isWorkflowCanceled(context.requestId))throw createWorkflowStoppedError();
    try {
      const inspectResult = await runCommand(getAdbPath(),inspectArgs,Math.max(1,Math.min(2000,deadline-Date.now())));
      lastInspectError=null;
      lastWindowOutput = inspectResult.stdout || inspectResult.stderr || '';

      if (activityOutputMatches(lastWindowOutput, packageName, activityName)) {
        return {
          command: [
            launch.preview,
            buildAdbCommandPreview(inspectArgs),
          ].join('\n'),
          stdout: [
            launchResult.stdout,
            'Activity 已进入前台',
            lastWindowOutput,
          ].filter(Boolean).join('\n'),
          stderr: [launchResult.stderr,inspectResult.stderr].filter(Boolean).join('\n'),
        };
      }
    } catch (error) {
      if(error.code==='WORKFLOW_STOPPED' || isWorkflowCanceled(context.requestId))throw createWorkflowStoppedError();
      lastInspectError=error;
      lastWindowOutput=error.stdout || error.message || '';
    }

    await sleep(Math.min(250, Math.max(0, deadline - Date.now())));
  }

  const error=new Error(`Activity ${lastInspectError?'前台查询失败':'前台核验未通过'}：${packageName}/${activityName}（${timeout || 5000}ms）${lastInspectError?'\n'+lastInspectError.message:''}`);
  Object.assign(error,{
    code:lastInspectError?'ACTIVITY_FOREGROUND_QUERY_FAILED':'ACTIVITY_FOREGROUND_NOT_CONFIRMED',
    command:[launch.preview,buildAdbCommandPreview(inspectArgs)].join('\n'),
    stdout:lastWindowOutput,stderr:lastInspectError?.stderr || '',
    exitCode:lastInspectError?.exitCode,signal:lastInspectError?.signal,timeoutMs:timeout || 5000,
    meta:{launch:{command:launch.preview,stdout:launchResult.stdout,stderr:launchResult.stderr},verification:{...lastInspectError?.meta,command:buildAdbCommandPreview(inspectArgs),errorCode:lastInspectError?.errorCode || lastInspectError?.code,timeoutMs:lastInspectError?.timeoutMs}},
    diagnostics:lastInspectError?.diagnostics,
  });
  throw error;
}

function normalizeAudioCommandTemplate(template) {
  return String(template || '').replace(/--es\s+audio_path\b/g, '--es "audio_path"');
}

function isDefaultAudioRemoteDir(value) {
  return !String(value || '').trim()
    || /^\/sdcard\/Download\/glassbox_audio\.[A-Za-z0-9]+\/?$/.test(String(value || '').trim())
    || /^\/sdcard\/Android\/data\/(?:\$\{defaults\.phonePackage\}|[^/]+)\/files\/?(?:glassbox_audio\.[A-Za-z0-9]+)?\/?$/.test(String(value || '').trim());
}

function parseWorkflowJsonObject(value) {
  if (!value) {
    return {};
  }

  if (typeof value === 'object') {
    return value;
  }

  try {
    return JSON.parse(String(value));
  } catch (_error) {
    return {};
  }
}

function normalizeRemoteDir(value) {
  const raw = String(value || '').trim();
  const dir = raw || '/sdcard/Download/';

  if (!dir.endsWith('/') && path.posix.basename(dir).includes('.')) {
    return `${path.posix.dirname(dir)}/`;
  }

  return dir.endsWith('/') ? dir : `${dir}/`;
}

function isHttpUrl(value) {
  return /^https?:\/\//i.test(String(value || '').trim());
}

function getImageExtensionFromSource(source) {
  try {
    const url = isHttpUrl(source) ? new URL(source) : null;
    const ext = path.extname(url ? url.pathname : String(source || '')).toLowerCase();
    return CASE_LIBRARY_IMAGE_EXTENSIONS.has(ext) ? ext : '.png';
  } catch (_error) {
    const ext = path.extname(String(source || '')).toLowerCase();
    return CASE_LIBRARY_IMAGE_EXTENSIONS.has(ext) ? ext : '.png';
  }
}

function downloadFileToPath(sourceUrl, targetPath, redirectCount = 0) {
  if (redirectCount > 5) {
    return Promise.reject(new Error('图片下载重定向次数过多'));
  }

  return new Promise((resolve, reject) => {
    const client = String(sourceUrl).startsWith('https:') ? https : http;
    const request = client.get(sourceUrl, (response) => {
      const statusCode = response.statusCode || 0;

      if ([301, 302, 303, 307, 308].includes(statusCode) && response.headers.location) {
        response.resume();
        const nextUrl = new URL(response.headers.location, sourceUrl).toString();
        downloadFileToPath(nextUrl, targetPath, redirectCount + 1).then(resolve).catch(reject);
        return;
      }

      if (statusCode < 200 || statusCode >= 300) {
        response.resume();
        reject(new Error(`图片下载失败：HTTP ${statusCode}`));
        return;
      }

      fs.mkdirSync(path.dirname(targetPath), { recursive: true });
      const fileStream = fs.createWriteStream(targetPath, { flags: 'w' });
      response.pipe(fileStream);
      fileStream.on('finish', () => {
        fileStream.close(() => resolve(targetPath));
      });
      fileStream.on('error', reject);
    });

    request.setTimeout(30000, () => {
      request.destroy(new Error('图片下载超时'));
    });
    request.on('error', reject);
  });
}

async function resolveImageMockLocalPath(config) {
  const imagePath = String(config.imagePath || config.localPath || '').trim();

  if (!imagePath) {
    throw new Error('图片 Mock 缺少图片路径或 URL');
  }

  if (isHttpUrl(imagePath)) {
    const ext = getImageExtensionFromSource(imagePath);
    const hash = crypto.createHash('sha1').update(imagePath).digest('hex').slice(0, 16);
    const targetPath = path.join(getImageMockCacheDir(), `${hash}${ext}`);
    await downloadFileToPath(imagePath, targetPath);
    return {
      sourceType: 'url',
      source: imagePath,
      localPath: targetPath,
    };
  }

  if (!fs.existsSync(imagePath)) {
    throw new Error(`图片文件不存在：${imagePath}`);
  }

  return {
    sourceType: 'file',
    source: imagePath,
    localPath: imagePath,
  };
}

function normalizeImageMockDevice(value, fallback = 'glasses') {
  return String(value || fallback).trim() === 'phone' ? 'phone' : 'glasses';
}

function getImageMockDeviceSerial(context, device, label) {
  const serial = device === 'glasses'
    ? context.defaults.glassesSerial
    : context.defaults.phoneSerial;

  if (!serial) {
    throw new Error(`图片 Mock 缺少${label}${device === 'glasses' ? '眼镜' : '手机'}设备 SN`);
  }

  return serial;
}

function assertLocalImageFile(localPath) {
  const ext = path.extname(String(localPath || '')).toLowerCase();

  if (!CASE_LIBRARY_IMAGE_EXTENSIONS.has(ext)) {
    throw new Error(`不支持的图片格式：${ext || 'unknown'}，请使用 png/jpg/jpeg/webp/gif/bmp`);
  }

  const stat = fs.statSync(localPath);

  if (!stat.isFile() || stat.size <= 0) {
    throw new Error(`图片文件为空或不可用：${localPath}`);
  }

  return stat;
}

function normalizeRemoteImagePath(value, localPath, fallbackDir = '/sdcard/Download/') {
  const raw = String(value || '').trim();
  const fallbackName = path.basename(localPath || 'glassbox_mock_image.png') || 'glassbox_mock_image.png';

  if (!raw) {
    const normalizedFallbackDir = String(fallbackDir || '').trim() || '/sdcard/Download/';
    return `${normalizedFallbackDir.replace(/\/?$/, '/')}${fallbackName}`;
  }

  if (raw.endsWith('/')) {
    return `${raw}${fallbackName}`;
  }

  return raw;
}

function assertRemoteFileReadyFromLs(stdout, remotePath) {
  const text = String(stdout || '').trim();
  const parts = text.split(/\s+/);
  const size = Number(parts[4]);

  if (!text || Number.isNaN(size) || size <= 0) {
    throw new Error(`设备侧图片不存在或大小为 0：${remotePath}`);
  }
}

async function waitForRemoteFile(serial, remotePath, timeoutMs = 15000) {
  return waitForRemoteAudioFile({
    serial,
    remotePath,
    timeoutMs,
    execute: (args, commandTimeoutMs) => runCommand(getAdbPath(), args, commandTimeoutMs),
    delay: sleep,
  });
}

function resolveWorkflowLocalAssetPath(value, context = {}) {
  const rawPath = String(value || '').trim();
  if (!rawPath || path.isAbsolute(rawPath)) {
    return rawPath;
  }
  const baseDir = String(context.assetBaseDir || '').trim();
  if(!baseDir || !path.isAbsolute(baseDir))throw Object.assign(Error('相对素材路径缺少有效的绝对assetBaseDir，请核对复制来源或所属库目录；不能判定素材缺失'),{errorCode:'ASSET_BASE_DIR_MISSING'});
  return path.resolve(baseDir,rawPath);
}

function createWorkflowAudioAssetError(step, configuredPath, resolvedPath) {
  const normalizedConfiguredPath = String(configuredPath || '').trim();
  const normalizedResolvedPath = String(resolvedPath || '').trim();
  const message = normalizedResolvedPath
    ? `本地音频文件不存在：${normalizedResolvedPath}`
    : `音频节点的运行时本地路径未解析：${normalizedConfiguredPath || 'empty'}`;
  const recoveryActions = [
    '确认前置 TTS/变量节点已成功写入 audioPath，并且音频节点位于其后续执行路径。',
    '静态文件请确认路径相对 bundle/case 文件目录可读；动态文件请检查 variables/nodeOutputs 引用。',
  ];
  const error = new Error(message);
  error.errorCode = 'AUDIO_ASSET_NOT_FOUND';
  error.errorType = 'audio-asset-resolution';
  error.recoveryActions = recoveryActions;
  error.diagnostics = {
    schemaVersion: 'glassbox.error.v1',
    errorCode: error.errorCode,
    errorType: error.errorType,
    message,
    recoveryActions,
    details: {
      stepId: step?.id || '',
      stepName: step?.name || '',
      componentId: step?.componentId || '',
      configuredPath: normalizedConfiguredPath,
      resolvedPath: normalizedResolvedPath,
    },
  };
  return error;
}

async function executeAudioInputStep(step, context, serial, config, commandTemplate) {
  const executeOnPc = step.device === 'pc';
  const pushEnabled = config.pushEnabled == null || config.pushEnabled === ''
    ? !executeOnPc : config.pushEnabled === true || config.pushEnabled === 'true';
  if (pushEnabled && executeOnPc) {
    serial = config.pushDevice === 'glasses' ? context.defaults.glassesSerial : context.defaults.phoneSerial;
    if (!serial) throw new Error('音频 push 缺少目标设备 SN');
  }
  const sourceType = config.sourceType || 'file';
  const configuredLocalPath = config.localPath || config.audioPath;
  let localPath = resolveWorkflowLocalAssetPath(configuredLocalPath, context);
  const phonePackage = String(context.defaults.phonePackage || '').trim();
  const configuredRemotePath = String(config.remotePath || '').trim();
  if (pushEnabled && !phonePackage && isDefaultAudioRemoteDir(configuredRemotePath)) {
    throw new Error('音频输入节点缺少手机包名：请先在手机设备栏选择 packageName，或在节点 remotePath 中显式填写目标路径');
  }
  const remoteDir = normalizeRemoteDir(
    isDefaultAudioRemoteDir(configuredRemotePath)
      ? `/sdcard/Android/data/${phonePackage}/files/`
      : configuredRemotePath
  );
  const effectiveCommandTemplate = String(commandTemplate || config.commandTemplate || '').trim();
  if (!effectiveCommandTemplate) throw new Error('请先配置音频输入命令；solopi-desktop 不提供厂商默认命令');
  const commandParams = parseWorkflowJsonObject(config.commandParams);
  let ttsResult = null;

  if (sourceType === 'tts') {
    const ttsText = resolveWorkflowValue(config.ttsText || '', context);
    if (!String(ttsText || '').trim()) {
      throw new Error('TTS 音频节点缺少 ttsText');
    }

    ttsResult = await synthesizeTtsAudio(String(ttsText), {
      stepId: step.id,
      outputFormat: config.outputFormat || 'pcm',
      sampleFormat: config.sampleFormat || 'AV_SAMPLE_FMT_S16',
      sampleRate: config.sampleRate || 16000,
      voice: config.voice || '',
    });
    localPath = ttsResult.path;
  }

  if (!localPath) {
    throw createWorkflowAudioAssetError(step, configuredLocalPath, localPath);
  }

  if (!fs.existsSync(localPath)) {
    throw createWorkflowAudioAssetError(step, configuredLocalPath, localPath);
  }

  const timeout = step.timeoutMs || 30000;
  let pushLocalPath = localPath;
  let transcodeResult = null;
  const outputFormat = getAudioOutputExtension(config.outputFormat || 'pcm');
  const sampleFormat = config.sampleFormat || 'AV_SAMPLE_FMT_S16';
  const sampleRate = Number(config.sampleRate || 16000);
  const channelCnt = Number(config.channelCnt || 1);
  const trailingSilenceMs = normalizeTrailingSilenceMs(
    config.trailingSilenceMs,
    DEFAULT_TRAILING_SILENCE_MS
  );
  const shouldTranscode = shouldTranscodeAudioForInput(localPath, config);

  if (shouldTranscode || trailingSilenceMs > 0) {
    const sourceBase = path.basename(localPath, path.extname(localPath));
    const targetPath = path.join(
      context.runDir || getAudioRecordingsDir(),
      `${sanitizeFilePart(sourceBase)}-${sanitizeFilePart(step.id || 'audio')}.${outputFormat}`
    );
    let preparedDurationMs = null;
    let audioDurationMs = null;
    if (trailingSilenceMs > 0) {
      const sourcePcmPath = path.extname(localPath).toLowerCase() === '.pcm'
        ? localPath
        : `${targetPath}.source.pcm`;
      const preparedPcmPath = outputFormat === 'pcm'
        ? targetPath
        : `${targetPath}.prepared.pcm`;
      const temporaryPaths = [];
      try {
        if (sourcePcmPath !== localPath) {
          await transcodeAudioFile(localPath, sourcePcmPath, {
            outputFormat: 'pcm',
            sampleFormat,
            sampleRate,
            channelCnt,
            timeoutMs: timeout,
          });
          temporaryPaths.push(sourcePcmPath);
        }
        appendPcmSilence(sourcePcmPath, preparedPcmPath, {
          sampleFormat,
          sampleRate,
          channelCnt,
          trailingSilenceMs,
        });
        if (preparedPcmPath !== targetPath) temporaryPaths.push(preparedPcmPath);
        const sourcePcmStat = fs.statSync(sourcePcmPath);
        const preparedPcmStat = fs.statSync(preparedPcmPath);
        audioDurationMs = durationMsFromPcmBytes(sourcePcmStat.size, {
          sampleFormat,
          sampleRate,
          channelCnt,
        });
        preparedDurationMs = durationMsFromPcmBytes(preparedPcmStat.size, {
          sampleFormat,
          sampleRate,
          channelCnt,
        });
        if (outputFormat !== 'pcm') {
          await transcodeAudioFile(preparedPcmPath, targetPath, {
            outputFormat,
            sampleFormat,
            sampleRate,
            channelCnt,
            timeoutMs: timeout,
          });
        }
      } finally {
        temporaryPaths.forEach((temporaryPath) => {
          try {
            fs.unlinkSync(temporaryPath);
          } catch {
            // Best-effort cleanup; the workflow artifact remains authoritative.
          }
        });
      }
    } else {
      const transcode = await transcodeAudioFile(localPath, targetPath, {
        outputFormat,
        sampleFormat,
        sampleRate,
        channelCnt,
        timeoutMs: timeout,
      });
      preparedDurationMs = transcode.preparedAudioDurationMs;
    }
    pushLocalPath = targetPath;
    transcodeResult = {
      sourcePath: localPath,
      path: targetPath,
      outputFormat,
      sampleFormat,
      sampleRate,
      channelCnt,
      trailingSilenceMs,
      audioDurationMs,
      preparedAudioDurationMs: preparedDurationMs,
    };
  }

  const sourceStat = fs.statSync(localPath);
  const preparedStat = fs.statSync(pushLocalPath);
  const audioMetrics = outputFormat === 'pcm'
    ? createPcmAudioMetrics({
        sourceBytes: sourceStat.size,
        preparedBytes: preparedStat.size,
        sampleFormat,
        sampleRate,
        channelCnt,
        trailingSilenceMs,
      })
    : createAudioTimelineMetrics({
        audioDurationMs: transcodeResult?.audioDurationMs,
        preparedAudioDurationMs: transcodeResult?.preparedAudioDurationMs,
        trailingSilenceMs,
        sampleRate,
        channelCnt,
        sourceBytes: sourceStat.size,
        preparedBytes: preparedStat.size,
      });

  const remotePath = pushEnabled ? `${remoteDir}${path.posix.basename(pushLocalPath)}` : '';
  let artifactLocalPath = pushLocalPath;
  if (context.runDir && path.isAbsolute(pushLocalPath)) {
    const resolvedRunDir = path.resolve(context.runDir);
    const resolvedPushLocalPath = path.resolve(pushLocalPath);
    if (resolvedPushLocalPath !== resolvedRunDir && !isPathInside(resolvedRunDir, resolvedPushLocalPath)) {
      const artifactDir = path.join(context.runDir, 'audio-artifacts');
      const artifactName = `${sanitizeFilePart(step.id || 'audio')}-${sanitizeFilePart(path.basename(pushLocalPath))}`;
      artifactLocalPath = path.join(artifactDir, artifactName);
      fs.mkdirSync(artifactDir, { recursive: true });
      fs.copyFileSync(pushLocalPath, artifactLocalPath);
    }
  }
  // Host commands consume the prepared local file; disabling push must not issue
  // any ADB filesystem requests or require a package/remote directory.
  if (!pushEnabled) {
    const values = resolveWorkflowValue({
      ...config, ...commandParams, serial,
      localPath: pushLocalPath, sourceLocalPath: localPath,
      remotePath: '', remoteDir: '', outputFormat,
      sampleFormat, sampleRate, channelCnt,
      phoneSerial: context.defaults.phoneSerial || '',
      glassesSerial: context.defaults.glassesSerial || '',
    }, context);
    const command = renderCommandTemplate(resolveWorkflowValue(effectiveCommandTemplate, context), values);
    const execution = executeOnPc ? createPcExecution(command) : createAudioAdbExecution(command);
    const audioArtifact = { serial, localPath: artifactLocalPath, sourceLocalPath: localPath, remotePath: '', audioMetrics, outputFormat, sampleFormat, sampleRate, channelCnt };
    try {
      const result = executeOnPc
        ? await runCommandWithOptions(execution.command, execution.args, { timeout })
        : await runCommand(execution.command, execution.args, timeout);
      return { ...result, command: execution.preview, meta: { filePushed: false, triggerSucceeded: true, audioArtifact, audioMetrics } };
    } catch (error) {
      error.filePushed = false;
      error.triggerSucceeded = false;
      error.audioArtifact = audioArtifact;
      throw error;
    }
  }
  const mkdirArgs = ['-s', serial, 'shell', 'mkdir', '-p', remoteDir];
  const mkdirResult = await runCommand(getAdbPath(), mkdirArgs, 5000);
  const pushArgs = ['-s', serial, 'push', pushLocalPath, remotePath];
  const pushResult = await runCommand(getAdbPath(), pushArgs, timeout);
  try {
    await waitForRemoteFile(serial, remotePath, Number(config.pushReadyTimeoutMs || 15000));
  } catch (error) {
    error.filePushed = true;
    error.triggerSucceeded = false;
    error.audioArtifact = { serial, localPath: artifactLocalPath, remotePath, sourceLocalPath: localPath, audioMetrics };
    throw error;
  }
  const inspectArgs = ['-s', serial, 'shell', 'ls', '-l', remotePath];
  const inspectResult = await runCommand(getAdbPath(), inspectArgs, 5000);
  context.pushedAudioFiles?.push({
    stepId: step.id,
    stepName: step.name,
    serial,
    localPath: artifactLocalPath,
    pushedLocalPath: pushLocalPath,
    sourceLocalPath: localPath,
    remotePath,
    sourceType,
    outputFormat: transcodeResult?.outputFormat || getAudioOutputExtension(config.outputFormat || path.extname(pushLocalPath).replace(/^\./, '') || 'pcm'),
    sampleFormat: transcodeResult?.sampleFormat || config.sampleFormat || 'AV_SAMPLE_FMT_S16',
    sampleRate: transcodeResult?.sampleRate || config.sampleRate || 16000,
    channelCnt: transcodeResult?.channelCnt || config.channelCnt || 1,
    trailingSilenceMs,
    audioMetrics,
    transcode: transcodeResult,
    tts: ttsResult ? {
      provider: ttsResult.provider,
      path: ttsResult.path,
      url: ttsResult.url,
      sourceUrl: ttsResult.sourceUrl,
      size: ttsResult.size,
    } : null,
  });
  await sleep(Number(config.pushReadyDelayMs || 1000));
  const renderedValues = resolveWorkflowValue({
    ...config,
    ...commandParams,
    serial,
    remoteDir,
    remotePath,
    localPath: pushLocalPath,
    sourceLocalPath: localPath,
    phoneSerial: context.defaults.phoneSerial || '',
    glassesSerial: context.defaults.glassesSerial || '',
    phonePackage: context.defaults.phonePackage || '',
    glassesPackage: context.defaults.glassesPackage || '',
  }, context);
  const renderedAction = String(renderedValues.action || '').trim();
  const migratedTemplate = effectiveCommandTemplate;
  const command = renderCommandTemplate(resolveWorkflowValue(executeOnPc ? migratedTemplate : normalizeAudioCommandTemplate(migratedTemplate), context), renderedValues);
  const actionTemplate = String(effectiveCommandTemplate || '').includes('{{action}}');
  const createMissingActionDiagnostics = (message) => ({
    schemaVersion: 'glassbox.error.v1',
    errorCode: 'AUDIO_BROADCAST_ACTION_MISSING',
    errorType: 'audio-broadcast-validation',
    message,
    recoveryActions: ['请填写厂商提供的广播 Action 或配置完整的音频输入命令。'],
    details: {
      stepId: step.id || '',
      stepName: step.name || '',
      componentId: step.componentId || '',
      device: step.device || 'phone',
      action: renderedAction,
      commandTemplate: effectiveCommandTemplate,
      renderedCommand: command,
      filePushed: true,
      triggerSucceeded: false,
      remotePath,
      localPath: artifactLocalPath,
      audioMetrics,
      serial,
    },
  });
  if (!executeOnPc && actionTemplate && !renderedAction && migratedTemplate === effectiveCommandTemplate) {
    const error = new Error('音频广播缺少 action：commandTemplate 使用 {{action}} 但未提供有效值');
    error.errorCode = 'AUDIO_BROADCAST_ACTION_MISSING';
    error.errorType = 'audio-broadcast-validation';
    error.diagnostics = createMissingActionDiagnostics(error.message);
    error.recoveryActions = ['填写可编辑的音频广播 Action，或改用包含固定 Action 的兼容组件。'];
    error.filePushed = true;
    error.triggerSucceeded = false;
    error.audioArtifact = { serial, localPath: artifactLocalPath, remotePath, sourceLocalPath: localPath, audioMetrics };
    throw error;
  }
  if (!executeOnPc && (/(?:\s|^)\-a\s+(?:--es|$)/.test(command) || /\-a\s+['"]?\s*['"]?(?:\s|$)/.test(command))) {
    const error = new Error('音频广播命令缺少 Action，已阻止执行');
    error.errorCode = 'AUDIO_BROADCAST_ACTION_MISSING';
    error.errorType = 'audio-broadcast-validation';
    error.diagnostics = createMissingActionDiagnostics(error.message);
    error.recoveryActions = ['检查渲染后的 audio command，确保 -a 后有非空 Action。'];
    error.filePushed = true;
    error.triggerSucceeded = false;
    error.audioArtifact = { serial, localPath: artifactLocalPath, remotePath, sourceLocalPath: localPath, audioMetrics };
    throw error;
  }
  const execution = executeOnPc ? createPcExecution(command) : createAudioAdbExecution(command);
  let triggerResult;
  const triggerStartedAtMs = Date.now();
  try {
    triggerResult = executeOnPc
      ? await runCommandWithOptions(execution.command, execution.args, { timeout })
      : await runCommand(execution.command, execution.args, timeout);
  } catch (error) {
    error.errorCode = error.errorCode || 'AUDIO_BROADCAST_TRIGGER_FAILED';
    error.filePushed = true;
    error.triggerSucceeded = false;
    error.audioArtifact = { serial, localPath: artifactLocalPath, remotePath, sourceLocalPath: localPath, audioMetrics };
    error.meta = { ...(error.meta || {}), audioTrigger: {
      stage: 'trigger', startedAt: new Date(triggerStartedAtMs).toISOString(), endedAt: new Date().toISOString(),
      durationMs: Date.now() - triggerStartedAtMs, command: execution.preview,
      filePushed: true, triggerSucceeded: false, audioMetrics,
      preparation: { mkdir: mkdirResult, push: pushResult, inspect: inspectResult },
      commandExecution: error.meta?.commandExecution || null,
    } };
    throw error;
  }

  return {
    command: [
      ...(ttsResult ? [`[0] synthesize tts\n${ttsResult.provider}: ${ttsResult.path} (${ttsResult.size} bytes)`] : []),
      ...(transcodeResult ? [`[0.5] transcode audio\n${transcodeResult.sourcePath} -> ${transcodeResult.path} (${transcodeResult.outputFormat} / ${transcodeResult.sampleFormat} / ${transcodeResult.sampleRate}Hz / ${transcodeResult.channelCnt}ch)`] : []),
      `[0.75] prepare audio timeline\nsource=${audioMetrics.audioDurationMs ?? 'unknown'}ms + trailingSilence=${audioMetrics.trailingSilenceMs}ms -> injection=${audioMetrics.injectionDurationMs ?? 'unknown'}ms`,
      `[1] ensure remote dir\n${buildAdbCommandPreview(mkdirArgs)}`,
      `[2] push audio file\n${buildAdbCommandPreview(pushArgs)}`,
      `[3] wait remote file ready\n${remotePath}`,
      `[4] inspect remote file\n${buildAdbCommandPreview(inspectArgs)}`,
      `[5] trigger audio command\n${execution.preview}`,
    ].join('\n'),
    stdout: [mkdirResult.stdout, pushResult.stdout, inspectResult.stdout, triggerResult.stdout].filter(Boolean).join('\n'),
    stderr: [mkdirResult.stderr, pushResult.stderr, inspectResult.stderr, triggerResult.stderr].filter(Boolean).join('\n'),
    meta: {
      filePushed: true,
      triggerSucceeded: true,
      audioMetrics,
      triggerCommandDurationMs: Date.now() - triggerStartedAtMs,
      commandExecution: triggerResult.meta?.commandExecution || null,
      audioTrigger: { stage: 'trigger', startedAt: new Date(triggerStartedAtMs).toISOString(), endedAt: new Date().toISOString(),
        durationMs: Date.now() - triggerStartedAtMs, command: execution.preview, triggerSucceeded: true },
      audioArtifact: { serial, localPath: artifactLocalPath, remotePath, sourceLocalPath: localPath, audioMetrics },
    },
  };
}

async function executeImageMockStep(step, context, serial, config, commandTemplate) {
  const component = context.components?.[step.componentId] || {};
  const resultAssertions = parseCommandResultAssertions(resolveWorkflowValue(
    step.config?.resultAssertions ?? config.resultAssertions ?? component.resultAssertions, context
  ));
  const acceptedExitCodes = normalizeAcceptedExitCodes(
    config.acceptedExitCodes ?? step.acceptedExitCodes ?? step.config?.acceptedExitCodes ?? component.acceptedExitCodes
  );
  const onError = String(config.onError || step.onError || step.config?.onError || component.onError || 'fail').toLowerCase();
  const imageSource = await resolveImageMockLocalPath(config);
  const localImagePath = imageSource.localPath;
  const stat = assertLocalImageFile(localImagePath);
  const pushDevice = normalizeImageMockDevice(config.pushDevice, 'glasses');
  const executeOnPc = String(config.commandDevice || '').trim().toLowerCase() === 'pc';
  const commandDevice = executeOnPc ? 'pc' : normalizeImageMockDevice(config.commandDevice, 'phone');
  const pushSerial = getImageMockDeviceSerial(context, pushDevice, '图片推送');
  const commandSerial = executeOnPc ? '' : getImageMockDeviceSerial(context, commandDevice, 'Mock 指令执行');
  const imagePackage = config.glassesPackage || context.defaults.glassesPackage;
  const fallbackRemoteDir = imagePackage ? `/sdcard/Android/data/${imagePackage}/files/` : '/sdcard/Download/';
  const remoteImagePath = normalizeRemoteImagePath(config.remoteImagePath, localImagePath, fallbackRemoteDir);
  const remoteDir = path.posix.dirname(remoteImagePath);
  const timeout = step.timeoutMs || 30000;
  const commandParams = parseWorkflowJsonObject(config.commandParams);
  const effectiveCommandTemplate = String(commandTemplate || config.commandTemplate || '').trim();
  if (!effectiveCommandTemplate) throw new Error('请先配置图片 Mock 命令；solopi-desktop 不提供厂商默认命令');

  const mkdirArgs = ['-s', pushSerial, 'shell', 'mkdir', '-p', remoteDir];
  const mkdirResult = await runCommand(getAdbPath(), mkdirArgs, 5000);
  const pushArgs = ['-s', pushSerial, 'push', localImagePath, remoteImagePath];
  const pushResult = await runCommand(getAdbPath(), pushArgs, timeout);
  const inspectArgs = ['-s', pushSerial, 'shell', 'ls', '-l', remoteImagePath];
  const inspectResult = await runCommand(getAdbPath(), inspectArgs, 5000);
  assertRemoteFileReadyFromLs(inspectResult.stdout, remoteImagePath);

  context.pushedImageFiles?.push({
    serial: pushSerial,
    localPath: localImagePath,
    remotePath: remoteImagePath,
    sourceType: imageSource.sourceType,
    source: imageSource.source,
  });

  const renderedValues = resolveWorkflowValue({
    ...config,
    ...commandParams,
    serial: commandSerial,
    pushSerial,
    commandSerial,
    pushDevice,
    commandDevice,
    remoteDir,
    remoteImagePath,
    localImagePath,
    imageFileName: path.basename(localImagePath),
    imageSizeBytes: String(stat.size),
    phoneSerial: context.defaults.phoneSerial || '',
    glassesSerial: context.defaults.glassesSerial || '',
    phonePackage: context.defaults.phonePackage || '',
    glassesPackage: context.defaults.glassesPackage || '',
  }, context);
  const command = renderCommandTemplate(resolveWorkflowValue(effectiveCommandTemplate, context), renderedValues);
  const execution = executeOnPc ? createPcExecution(command) : createAdbExecution(command);
  const stages = [
    { stage: 'prepare', command: `${imageSource.sourceType}: ${imageSource.source}`, stdout: '', stderr: '' },
    { stage: 'mkdir', command: buildAdbCommandPreview(mkdirArgs), ...mkdirResult },
    { stage: 'push', command: buildAdbCommandPreview(pushArgs), ...pushResult },
    { stage: 'inspect', command: buildAdbCommandPreview(inspectArgs), ...inspectResult },
  ];
  const commandEvidence = [
    `[1] prepare image\n${imageSource.sourceType}: ${imageSource.source}`,
    `[2] ensure remote dir\n${buildAdbCommandPreview(mkdirArgs)}`,
    `[3] push image file\n${buildAdbCommandPreview(pushArgs)}`,
    `[4] inspect remote image\n${buildAdbCommandPreview(inspectArgs)}`,
    `[5] trigger image mock command\n${execution.preview}`,
  ].join('\n');
  let triggerResult;
  try {
    try {
      triggerResult = executeOnPc
        ? await runCommandWithOptions(execution.command, execution.args, { timeout })
        : await runCommand(execution.command, execution.args, timeout);
    } catch (error) {
      if (error.exitCode === null || error.exitCode === undefined || !acceptedExitCodes.includes(Number(error.exitCode))) throw error;
      triggerResult = { success: true, stdout: error.stdout || '', stderr: error.stderr || '',
        exitCode: Number(error.exitCode), signal: error.signal || null, acceptedExitCode: true };
    }
    // The transfer stages are evidence, not part of the trigger's JSON result.
    assertCommandResult(triggerResult, resultAssertions, execution.preview);
  } catch (error) {
    const failedTrigger = { stage: 'trigger', command: execution.preview,
      stdout: error.stdout || triggerResult?.stdout || '', stderr: error.stderr || triggerResult?.stderr || '',
      exitCode: error.exitCode ?? triggerResult?.exitCode ?? null, signal: error.signal || null, success: false };
    error.meta = { ...(error.meta || {}), stages: [...stages, failedTrigger], triggerResult: failedTrigger,
      resultAssertions, acceptedExitCodes, onError, filePushed: true, triggerSucceeded: false };
    error.command = commandEvidence;
    error.stdout = [...stages.map(item => item.stdout), failedTrigger.stdout].filter(Boolean).join('\n');
    error.stderr = [...stages.map(item => item.stderr), failedTrigger.stderr].filter(Boolean).join('\n');
    error.filePushed = true;
    error.triggerSucceeded = false;
    if (onError !== 'continue' && onError !== 'branch') throw error;
    error.meta.warning = { code: error.errorCode || 'IMAGE_MOCK_TRIGGER_FAILED', message: error.message, errorType: error.errorType || '', recoveryActions: error.recoveryActions || [], diagnostics: error.diagnostics };
    if (onError === 'branch') error.meta.branch = 'error';
    return { command: commandEvidence, success: false, stdout: error.stdout, stderr: error.stderr,
      exitCode: failedTrigger.exitCode, signal: failedTrigger.signal,
      ...(onError === 'branch' ? { branch: 'error' } : {}),
      warning: error.meta.warning,
      meta: error.meta };
  }
  const triggerEvidence = { stage: 'trigger', command: execution.preview, ...triggerResult, exitCode: readCommandExitCode(triggerResult) };
  return {
    command: commandEvidence,
    stdout: [mkdirResult.stdout, pushResult.stdout, inspectResult.stdout, triggerResult.stdout].filter(Boolean).join('\n'),
    stderr: [mkdirResult.stderr, pushResult.stderr, inspectResult.stderr, triggerResult.stderr].filter(Boolean).join('\n'),
    exitCode: readCommandExitCode(triggerResult),
    meta: { stages: [...stages, triggerEvidence], triggerResult: triggerEvidence,
      resultAssertions, acceptedExitCodes, onError, filePushed: true, triggerSucceeded: true },
  };
}

async function executeWorkflowStep(step, context) {
  assertImportReviewed({ steps: [step] });
  const config = resolveWorkflowValue(step.config || {}, context);

  if (step.type === 'start') {
    if (parseWorkflowBoolean(config.keepScreenAwake, true)) {
      const awakeResult = await enableWorkflowScreenAwake(context);
      return {
        command: ['workflow start', awakeResult.command].filter(Boolean).join('\n'),
        stdout: ['工作流开始', awakeResult.stdout].filter(Boolean).join('\n'),
        stderr: awakeResult.stderr || '',
        meta: { warnings: awakeResult.warnings || [] },
      };
    }

    return {
      command: 'workflow start',
      stdout: '工作流开始',
      stderr: '',
    };
  }

  if (step.type === 'end') {
    context.cleanupAudioFiles = parseWorkflowBoolean(config.cleanupAudioFiles, true);
    context.cleanupImageFiles = parseWorkflowBoolean(config.cleanupImageFiles, true);

    return {
      command: 'workflow end',
      stdout: [
        context.cleanupAudioFiles ? '结束节点：将清理本次推送的音频文件' : '结束节点：保留本次推送的音频文件',
        context.cleanupImageFiles ? '结束节点：将清理本次推送的图片文件' : '结束节点：保留本次推送的图片文件',
      ].join('\n'),
      stderr: '',
    };
  }

  if (step.type === 'if') {
    if (context.lastNodeError) {
      const error = context.lastNodeError;
      context.lastNodeError = null;
      return {
        command: 'if error',
        stdout: '条件结果：error',
        stderr: '',
        meta: { branch: 'error', error: error.message || String(error) },
        branch: 'error',
      };
    }
    const condition = config.condition !== undefined ? config.condition : config.value;
    let value = condition;
    if (typeof condition === 'string' && /^\$?\{?variables\./.test(condition)) {
      value = getWorkflowVariable(context, condition.replace(/^\$?\{?/, '').replace(/\}?$/, ''));
    } else if (typeof condition === 'string' && condition.startsWith('nodeOutputs.')) {
      value = getJsonPathValueSafe(context.nodeOutputs || {}, condition.slice('nodeOutputs.'.length));
    }
    const expected = config.equals !== undefined ? config.equals : true;
    const pass = config.regex
      ? new RegExp(String(config.regex)).test(String(value ?? ''))
      : (config.notEmpty ? value !== undefined && value !== null && String(value).trim() !== '' : String(value) === String(expected));
    const branch = pass ? 'true' : 'false';
    return {
      command: `if ${String(config.condition || config.value || '')}`,
      stdout: `条件结果：${branch}`,
      stderr: '',
      meta: { branch, value, expected },
      branch,
    };
  }

  if (step.type === 'llm_text_generate') {
    const prompt = String(config.prompt || '').trim();
    const outputMode = String(config.outputMode || 'json').toLowerCase();
    const { saveToVariables, fallback } = normalizeLlmVariableMappings(config, outputMode);
    const outputInstruction = outputMode === 'json' ? buildLlmJsonOutputInstruction(saveToVariables) : '';
    const effectivePrompt = [prompt, outputInstruction].filter(Boolean).join('\n\n');

    if (!prompt) {
      throw new Error('LLM 文本生成节点缺少 prompt');
    }

    const provider = resolveWorkflowLlmProvider(context, config);
    let rawContent = '';
    let parsedOutput = null;
    let usedFallback = false;
    let fallbackReason = '';
    let responseMetadata = null;

    try {
      rawContent = await requestOpenAiCompatibleChat(provider, [
        {
          role: 'system',
          content: outputMode === 'json'
            ? '你是自动化测试数据生成助手。请严格按用户要求输出 JSON，不要输出 Markdown 或解释。'
            : '你是自动化测试数据生成助手。请只输出可直接使用的文本。',
        },
        { role: 'user', content: effectivePrompt },
      ], {
        workflowOutput: true,
        temperature: Number(config.temperature ?? 0.2),
        maxTokens: Number(config.maxTokens || 4096),
        timeoutMs: Number(step.timeoutMs || config.timeoutMs || 45000),
        onResponse: metadata => { responseMetadata = metadata; },
      });
      parsedOutput = outputMode === 'text' ? { text: rawContent } : parseLlmJsonResponse(rawContent);
    } catch (error) {
      if (error.code === 'WORKFLOW_STOPPED') throw error;
      if (Object.keys(fallback).length === 0) {
        error.meta = { ...(error.meta || {}), llmResponse: responseMetadata || error.meta?.llmResponse || null };
        error.command = `LLM 文本生成 · ${provider.name || provider.model || '默认模型'}`;
        error.stdout ||= `LLM Response Metadata:\n${JSON.stringify(responseMetadata, null, 2)}\n\nRaw Response:\n${rawContent}`;
        throw error;
      }
      usedFallback = true;
      fallbackReason = error.message;
      responseMetadata={...(responseMetadata || {}),llmRetry:error.meta?.llmRetry};
      parsedOutput = fallback;
      rawContent = JSON.stringify(fallback);
    }

    const writtenVariables = {};
    if (Object.keys(saveToVariables).length > 0) {
      Object.entries(saveToVariables).forEach(([variableName, pathExpression]) => {
        const value = getSimpleJsonPathValue(parsedOutput, pathExpression);
        if (value !== undefined) {
          writeWorkflowVariable(context, variableName, value);
          writtenVariables[variableName] = value;
        }
      });

      if (outputMode === 'text' && Object.keys(writtenVariables).length === 0) {
        const fallbackVariableName = Object.keys(saveToVariables)[0];
        if (fallbackVariableName) {
          writeWorkflowVariable(context, fallbackVariableName, rawContent);
          writtenVariables[fallbackVariableName] = rawContent;
        }
      }
    }

    if (outputMode === 'text' && Object.keys(writtenVariables).length === 0) {
      const variableName = String(config.saveToVariable || 'llmText').trim();
      writeWorkflowVariable(context, variableName, rawContent);
      writtenVariables[variableName] = rawContent;
    }

    return {
      command: `LLM 文本生成 · ${provider.name || provider.model || '默认模型'}`,
      stdout: [
        `Written Variables:\n${JSON.stringify(writtenVariables, null, 2)}`,
        `Parsed Output:\n${JSON.stringify(parsedOutput, null, 2)}`,
        usedFallback ? `使用 fallback：${fallbackReason}` : '模型调用成功',
        `模型：${provider.name || 'OpenAI Compatible'} / ${provider.model || '-'}`,
        `Prompt:\n${effectivePrompt}`,
        `Raw Response:\n${rawContent}`,
      ].join('\n\n'),
      stderr: '',
      meta:{llmResponse:responseMetadata,usedFallback,fallbackReason},
    };
  }

  if (step.type === 'http_request') {
    const result = await executeHttpRequestStep(step, config);
    const saveToVariables = Object.keys(parseWorkflowJsonObject(config.saveToVariablesText)).length > 0
      ? parseWorkflowJsonObject(config.saveToVariablesText)
      : parseWorkflowJsonObject(config.saveToVariables);
    const failOnBusinessErrorPath = parseHttpBusinessErrorPaths(config.failOnBusinessErrorPath);
    const failOnMissingSavedVariable = isHttpRequestFailFastEnabled(config.failOnMissingSavedVariable, true);
    const failOnEmptySavedVariable = isHttpRequestFailFastEnabled(config.failOnEmptySavedVariable, true);
    const responsePayload = {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers,
      body: result.body,
      text: result.rawText,
    };
    const httpResponse = createHttpResponseEvidence(responsePayload, result.rawText, result.body);
    const command = `HTTP ${String(config.method || 'GET').toUpperCase()} ${config.url}`;
    const writtenVariables = {};
    const pendingVariables = {};
    const missingVariableWarnings = [];
    const fatalErrors = [];

    failOnBusinessErrorPath.forEach((pathExpression) => {
      let value = getSimpleJsonPathValue(result.body, pathExpression);
      if (value === undefined) {
        value = getSimpleJsonPathValue(responsePayload, pathExpression);
      }
      if (!isEmptySavedHttpVariableValue(value)) {
        const preview = typeof value === 'string' ? value : JSON.stringify(value);
        fatalErrors.push(`业务错误路径 ${pathExpression} 命中：${preview}`);
      }
    });

    Object.entries(saveToVariables).forEach(([variableName, pathExpression]) => {
      let value = getSimpleJsonPathValue(result.body, pathExpression);
      if (value === undefined) {
        value = getSimpleJsonPathValue(responsePayload, pathExpression);
      }
      if (value !== undefined) {
        pendingVariables[variableName] = value;
        if (failOnEmptySavedVariable && isEmptySavedHttpVariableValue(value)) {
          fatalErrors.push(`变量 ${variableName} 的路径 ${pathExpression} 提取结果为空`);
        }
      } else {
        const message = `变量 ${variableName} 的路径 ${pathExpression} 在响应 body 或响应元信息中未找到`;
        missingVariableWarnings.push(`警告：${message}`);
        if (failOnMissingSavedVariable) {
          fatalErrors.push(message);
        }
      }
    });

    if (fatalErrors.length > 0) {
      const failureCode = fatalErrors.some((item) => item.startsWith('业务错误路径 '))
        ? 'HTTP_BUSINESS_ERROR'
        : 'HTTP_VARIABLE_EXTRACTION_FAILED';
      throw createHttpRequestStepFailure(
        `HTTP 请求节点失败：${fatalErrors[0]}`,
        command,
        [
          formatHttpResponseEvidence(httpResponse),
          `失败原因：\n${fatalErrors.join('\n')}`,
          `保存规则：\n${JSON.stringify(saveToVariables, null, 2)}`,
        ].filter(Boolean).join('\n\n'),
        {
          code: failureCode,
          details: {
            status: result.status,
            statusText: result.statusText,
            saveToVariables,
            failOnBusinessErrorPath,
            failOnMissingSavedVariable,
            failOnEmptySavedVariable,
            fatalErrors,
            httpResponse,
          },
          meta: {
            httpResponse,
            variableExtraction: {
              saveToVariables,
              pendingVariables,
              fatalErrors,
            },
          },
        }
      );
    }

    Object.entries(pendingVariables).forEach(([variableName, value]) => {
      writeWorkflowVariable(context, variableName, value);
      writtenVariables[variableName] = value;
    });

    return {
      command,
      stdout: [
        formatHttpResponseEvidence(httpResponse),
        `写入变量：\n${JSON.stringify(writtenVariables, null, 2)}`,
        missingVariableWarnings.length > 0 ? missingVariableWarnings.join('\n') : '',
      ].filter(Boolean).join('\n\n'),
      stderr: '',
      meta: {
        httpResponse,
        variableExtraction: {
          saveToVariables,
          writtenVariables,
          warnings: missingVariableWarnings,
        },
      },
    };
  }

  if (step.type === 'tts_synthesize') {
    const nodeKey = normalizeWorkflowVariableKey(config.nodeKey || step.name || step.id, 'tts');
    const envTtsProvider = context.ttsProvider || readEnvironmentConfig().ttsProvider || {};
    const audioUrlPath = String(envTtsProvider.urlField || '').trim();
    if (!audioUrlPath) {
      throw new Error('设置中心 TTS 配置缺少音频 URL 字段路径');
    }

    const providerConfig = {
      ...envTtsProvider,
      responseType: 'json-url',
      responseMappings: [{ variableName: '', responsePath: audioUrlPath }],
      urlField: audioUrlPath,
    };
    const effectiveTtsConfig = normalizeTtsConfig(providerConfig);
    const paramDefaults = Object.fromEntries((effectiveTtsConfig.params || []).map((param) => [param.key, param.defaultValue || '']));
    const ttsParams = {
      ...paramDefaults,
      text: config.text || paramDefaults.text || '',
    };
    const text = String(ttsParams.text || '').trim();

    if (!text) {
      throw new Error('TTS 音频合成节点缺少 text 参数');
    }

    const result = await synthesizeTtsAudio(text, {
      stepId: step.id,
      provider: providerConfig,
      params: ttsParams,
      outputFormat: effectiveTtsConfig.outputExtension || 'pcm',
      sampleRate: effectiveTtsConfig.sampleRate || 16000,
      sampleFormat: effectiveTtsConfig.sampleFormat || 'AV_SAMPLE_FMT_S16',
      channelCnt: effectiveTtsConfig.channelCnt || 1,
    });

    writeWorkflowVariable(context, `${nodeKey}.text`, text);
    writeWorkflowVariable(context, `${nodeKey}.audioUrl`, result.sourceUrl || result.url);
    writeWorkflowVariable(context, `${nodeKey}.audioPath`, result.path);
    writeWorkflowVariable(context, `${nodeKey}.mimeType`, result.mimeType);
    writeWorkflowVariable(context, `${nodeKey}.sha256`, result.sha256);
    writeWorkflowVariable(context, `${nodeKey}.size`, result.size);
    context.generatedTtsAudioFiles?.push({
      stepId: step.id,
      stepName: step.name,
      nodeKey,
      text,
      localPath: result.path,
      url: result.url,
      sourceUrl: result.sourceUrl,
      size: result.size,
      sha256: result.sha256,
      mimeType: result.mimeType,
      extension: result.extension,
      sampleRate: result.sampleRate,
      sampleFormat: result.sampleFormat,
      channelCnt: result.channelCnt,
      provider: result.provider,
      variable: `${nodeKey}.audioPath`,
      urlVariable: `${nodeKey}.audioUrl`,
    });

    return {
      command: `TTS 音频合成 · ${result.provider || 'HTTP TTS'}`,
      stdout: [
        `写入变量：variables.${nodeKey}.audioPath`,
        `音频 URL 变量：variables.${nodeKey}.audioUrl`,
        `音频 URL 字段：${audioUrlPath}`,
        `音频 URL：${result.sourceUrl || result.url}`,
        `本地音频：${result.path}`,
        `文本：${text}`,
        `Provider：${result.provider || 'HTTP TTS'}`,
        `格式：${result.mimeType || effectiveTtsConfig.outputExtension || 'pcm'}`,
        `音频描述：${result.extension || effectiveTtsConfig.outputExtension || 'pcm'} / ${result.sampleFormat || effectiveTtsConfig.sampleFormat || 'AV_SAMPLE_FMT_S16'} / ${result.sampleRate || effectiveTtsConfig.sampleRate || 16000}Hz / ${result.channelCnt || effectiveTtsConfig.channelCnt || 1}ch`,
        `大小：${result.size} bytes`,
        `sha256：${result.sha256}`,
        result.httpResponses?.length
          ? result.httpResponses.map(({ stage, ...httpResponse }) => [
            `TTS HTTP 响应阶段：${stage}`,
            formatHttpResponseEvidence(httpResponse),
          ].join('\n')).join('\n\n')
          : result.httpResponse
            ? formatHttpResponseEvidence(result.httpResponse)
            : '',
      ].filter(Boolean).join('\n'),
      stderr: '',
      meta: {
        httpResponse: result.httpResponse,
        httpResponses: result.httpResponses || [],
      },
    };
  }

  if (step.type === 'component') {
    const component = context.components?.[step.componentId];

    if (!component) {
      throw new Error(`未找到测试组件：${step.componentId}`);
    }

    const componentSerial = component.kind === 'image_mock' || component.kind === 'pc_command'
      || (component.kind === 'audio' && (step.device || component.device) === 'pc')
      ? ''
      : getComponentSerial(component, context, step);
    const timeout = step.timeoutMs || (Number(component.timeoutSeconds || 10) * 1000);
    const paramDefaults = Object.fromEntries(
      (component.params || []).map((param) => [param.key, param.defaultValue ?? ''])
    );
    const rawValues = {
      ...paramDefaults,
      ...(step.inputs || {}),
      serial: componentSerial,
      phoneSerial: context.defaults.phoneSerial || '',
      glassesSerial: context.defaults.glassesSerial || '',
      phonePackage: context.defaults.phonePackage || '',
      glassesPackage: context.defaults.glassesPackage || '',
    };
    const literalParams = new Set((component.params || []).filter(param => param.templateMode === 'literal').map(param => param.key));
    const renderedValues = Object.fromEntries(Object.entries(rawValues).map(([key, value]) => [key, literalParams.has(key) ? value : resolveWorkflowValue(value, context)]));
    (component.params || []).forEach((param) => {
      renderedValues[param.key] = normalizeComponentParamValue(param, renderedValues[param.key]);
    });

    if (component.kind === 'activity') {
      return executeLaunchActivityComponent(step, context, componentSerial, renderedValues, timeout, component.commandTemplate);
    }

    if (component.kind === 'audio') {
      return executeAudioInputStep({ ...step, device: step.device || component.device }, context, componentSerial, renderedValues, component.commandTemplate);
    }

    if (component.kind === 'image_mock') {
      return executeImageMockStep(step, context, componentSerial, renderedValues, component.commandTemplate);
    }

    if (component.kind === 'mobile_ui_action') {
      return executeMobileUiStep(step, context, {
        ...renderedValues,
        action: renderedValues.action || 'tap',
      });
    }

    if (component.kind === 'mobile_ui_assert') {
      const assertDeviceType = 'phone';
      const assertSerial = getWorkflowSerial({ ...step, device: assertDeviceType }, context);
      try {
        return await executeMobileUiStep(step, context, {
          ...renderedValues,
          action: 'assert',
        });
      } finally {
        if (parseWorkflowBoolean(renderedValues.captureScreenshotOnPass, true)) {
          await captureWorkflowAssertScreenshot(context, assertDeviceType, assertSerial, step);
        }
      }
    }

    if (component.kind === 'tts_assert') {
      const assertDeviceType = getComponentDevice(component, step);
      let ttsResult;
      let extractedVariable = null;
      let completedAt = '';
      try {
        ttsResult = await waitForTtsTextAssert(componentSerial, {
          extractRegex: renderedValues.extractRegex,
          expectedText: renderedValues.expectedText,
          matchOperator: renderedValues.matchOperator || 'equals',
          caseSensitive: parseWorkflowBoolean(renderedValues.caseSensitive, true),
          clearBeforeStart: parseWorkflowBoolean(renderedValues.clearBeforeStart, false),
          ignoreBeforeSequence: getWorkflowLogAssertCheckpoint(context, componentSerial, parseWorkflowBoolean(renderedValues.clearBeforeStart, false)),
        }, timeout);
        extractedVariable = createAssertExtractedVariable(
          renderedValues,
          ttsResult.extractedText,
          context,
          'extractedText'
        );
        await assertPostAssertLogStability(
          componentSerial,
          context,
          assertDeviceType,
          renderedValues,
          Number(ttsResult?.sequence || 0)
        );
        completedAt = new Date().toISOString();
      } catch (error) {
        error.completedAt = new Date().toISOString();
        throw error;
      } finally {
        if (parseWorkflowBoolean(renderedValues.captureScreenshotOnPass, true)) {
          await captureWorkflowAssertScreenshot(context, assertDeviceType, componentSerial, step);
        }
      }

      return {
        completedAt,
        command: `logcat text assert ${renderedValues.extractRegex || ''}`,
        stdout: [
          `比较方式：${getTextAssertOperatorLabel(ttsResult.matchOperator)}`,
          `期望文本：${ttsResult.expectedText}`,
          `实际文本：${ttsResult.extractedText}`,
          `命中日志：${ttsResult.line}`,
          extractedVariable ? `提取变量：variables.${extractedVariable.name} = ${JSON.stringify(extractedVariable.value)}` : '',
        ].filter(Boolean).join('\n'),
        stderr: '',
        meta: getAssertExtractionMeta(renderedValues, extractedVariable),
      };
    }

    if (component.kind === 'json_assert') {
      const assertDeviceType = getComponentDevice(component, step);
      let jsonAssertResult;
      let extractedVariable = null;
      let completedAt = '';
      try {
        jsonAssertResult = await waitForJsonLogAssert(componentSerial, {
          lineRegex: renderedValues.lineRegex,
          conditions: renderedValues.conditions,
          caseSensitive: parseWorkflowBoolean(renderedValues.caseSensitive, true),
          clearBeforeStart: parseWorkflowBoolean(renderedValues.clearBeforeStart, false),
          ignoreBeforeSequence: getWorkflowLogAssertCheckpoint(context, componentSerial, parseWorkflowBoolean(renderedValues.clearBeforeStart, false)),
        }, timeout);
        extractedVariable = createJsonAssertExtractedVariable(renderedValues, jsonAssertResult, context);
        await assertPostAssertLogStability(
          componentSerial,
          context,
          assertDeviceType,
          renderedValues,
          Number(jsonAssertResult?.sequence || 0)
        );
        completedAt = new Date().toISOString();
      } catch (error) {
        error.completedAt = new Date().toISOString();
        throw error;
      } finally {
        if (parseWorkflowBoolean(renderedValues.captureScreenshotOnPass, true)) {
          await captureWorkflowAssertScreenshot(context, assertDeviceType, componentSerial, step);
        }
      }

      return {
        completedAt,
        command: `logcat json assert ${renderedValues.lineRegex || ''}`,
        stdout: [
          'JSON 日志断言通过',
          `命中日志：${jsonAssertResult.line}`,
          `断言结果：${JSON.stringify(jsonAssertResult.assertions, null, 2)}`,
          extractedVariable ? `提取变量：variables.${extractedVariable.name} = ${JSON.stringify(extractedVariable.value, null, 2)}` : '',
        ].join('\n'),
        stderr: '',
        meta: getAssertExtractionMeta(renderedValues, extractedVariable),
      };
    }

    if (component.kind === 'llm_assert') {
      const assertDeviceType = getComponentDevice(component, step);
      const assertionPrompt = String(renderedValues.assertionPrompt || '').trim();
      if (!assertionPrompt) {
        throw new Error('LLM 断言缺少断言诉求');
      }

      const lineRegex = String(renderedValues.lineRegex || '').trim();
      if (!lineRegex) {
        throw new Error('LLM 断言缺少当前日志匹配正则');
      }

      const isWaitingCandidate = require('./workflow-llm-candidates').createCandidateFilter(renderedValues.waitingStates);
      const candidateSelection = { skippedWaitingCount: 0, evaluatedCount: 0 };
      const llmJudgments = [];
      const budgets = require('./workflow-llm-budgets').createBudgets(timeout, renderedValues.llmTimeoutMs, Date.now);
      let matchedLine = '';
      let llmAssertResult = null;
      let llmRequestPayload = null;
      let llmDebugOutput = '';
      let lastLlmFailure = null;
      let extractedVariable = null;
      let lastMatchSequence = getWorkflowLogAssertCheckpoint(context, componentSerial, parseWorkflowBoolean(renderedValues.clearBeforeStart, false));
      let completedAt = '';
      try {
        const provider = resolveWorkflowLlmProvider(context, renderedValues);
        let firstWait = true;

        while (budgets.remaining('log') > 0) {
          if (candidateSelection.evaluatedCount >= 3) throw Object.assign(new Error('LLM 已判断 3 条候选日志仍未通过，达到候选判断上限'), { code: 'LLM_CANDIDATE_LIMIT' });
          let match = null;

          try {
            match = await budgets.measure('log', remainingTimeout => waitForLogMatch(componentSerial, {
              pattern: lineRegex,
              matchType: 'regex',
              caseSensitive: parseWorkflowBoolean(renderedValues.caseSensitive, true),
              clearBeforeStart: firstWait ? parseWorkflowBoolean(renderedValues.clearBeforeStart, false) : false,
              ignoreBeforeSequence: lastMatchSequence,
            }, remainingTimeout));
          } catch (error) {
            if ((error.errorCode || error.code) === 'ASSERTION_TIMEOUT' && candidateSelection.skippedWaitingCount && !llmRequestPayload) {
              error.message = '等待可判定日志超时：仅收到配置的等待状态，未调用 LLM';
            }
            if ((error.errorCode || error.code) === 'ASSERTION_TIMEOUT' && (lastLlmFailure || llmRequestPayload)) {
              break;
            }

            throw error;
          }

          firstWait = false;
          lastMatchSequence = Number(match.sequence || lastMatchSequence);
          matchedLine = match.line;

          const logPayload = createLlmAssertLogPayload(matchedLine, {
            lineRegex,
            caseSensitive: parseWorkflowBoolean(renderedValues.caseSensitive, true),
          });
          if (isWaitingCandidate(logPayload.parsedContent)) {
            candidateSelection.skippedWaitingCount += 1;
            continue;
          }
          candidateSelection.evaluatedCount += 1;
          llmRequestPayload = createLlmAssertRequestPayload(assertionPrompt, context.variables || {}, logPayload);
          const judgmentStarted = Date.now();
          try {
            llmAssertResult = await budgets.measure('model', modelTimeout => requestWorkflowLlmAssert(provider, llmRequestPayload, {
              temperature: Number(renderedValues.temperature ?? 0.1),
              maxTokens: Number(renderedValues.maxTokens || 4096),
              timeoutMs: modelTimeout,
            }));
            llmJudgments.push({ candidate: candidateSelection.evaluatedCount, logSequence: lastMatchSequence,
              durationMs: Date.now() - judgmentStarted, pass: llmAssertResult.assertion.pass,
              retry: llmAssertResult.llmResponse?.llmRetry });
          } catch (error) {
            llmJudgments.push({ candidate: candidateSelection.evaluatedCount, logSequence: lastMatchSequence,
              durationMs: Date.now() - judgmentStarted, errorCode: error.code, retry: error.meta?.llmRetry });
            throw error;
          }
          llmDebugOutput = formatLlmAssertDebugOutput({
            assertionPrompt,
            requestPayload: llmRequestPayload,
            result: llmAssertResult.assertion,
            rawContent: llmAssertResult.rawContent,
            protocolError: logPayload.parseError,
          });

          if (llmAssertResult.assertion.pass) {
            extractedVariable = createAssertExtractedVariable(
              renderedValues,
              logPayload.parsedContent ?? logPayload.extractedContent ?? matchedLine,
              context,
              'extractedLlmLog'
            );
            await assertPostAssertLogStability(
              componentSerial,
              context,
              assertDeviceType,
              renderedValues,
              lastMatchSequence
            );
            completedAt = new Date().toISOString();
            break;
          }

          lastLlmFailure = {
            assertion: llmAssertResult.assertion,
            rawContent: llmAssertResult.rawContent,
            debugOutput: llmDebugOutput,
          };
        }

        if (!llmAssertResult?.assertion?.pass) {
          completedAt = new Date().toISOString();
          const reason = lastLlmFailure?.assertion?.reason || '超时时间内没有出现符合预期的业务状态';
          const error = createAssertionTimeoutError(candidateSelection.skippedWaitingCount && !llmRequestPayload
            ? '等待可判定日志超时：仅收到配置的等待状态，未调用 LLM'
            : `LLM 断言超时未通过：${reason}`, timeout);
          error.completedAt = completedAt;
          error.command = `LLM assert ${lineRegex}`;
          error.stdout = [
            'LLM 断言未通过',
            lastLlmFailure?.debugOutput || llmDebugOutput || (llmRequestPayload ? formatLlmAssertDebugOutput({
              assertionPrompt,
              requestPayload: llmRequestPayload,
              result: lastLlmFailure?.assertion,
              rawContent: lastLlmFailure?.rawContent,
            }) : ''),
          ].filter(Boolean).join('\n\n');
          error.stderr = '';
          error.meta = {
            llmResponse:llmAssertResult?.llmResponse,
            llmAssertion: lastLlmFailure?.assertion || llmAssertResult?.assertion,
            llmRequestPayload,
            currentNodeLogExtraction: llmRequestPayload ? {
              log: llmRequestPayload.currentLog,
              extractedContent: llmRequestPayload.currentExtractedContent,
              json: llmRequestPayload.currentJson,
            } : undefined,
          };
          throw error;
        }
      } catch (error) {
        error.completedAt = error.completedAt || new Date().toISOString();
        if (isLlmServiceError(error)) {
          error.command = `LLM assert ${lineRegex}`;
          error.stdout = [
            formatLlmServiceErrorDebug(error),
            llmRequestPayload ? formatLlmAssertDebugOutput({
              assertionPrompt,
              requestPayload: llmRequestPayload,
              result: lastLlmFailure?.assertion,
              rawContent: lastLlmFailure?.rawContent,
            }) : '',
          ].filter(Boolean).join('\n\n');
          error.stderr = '';
          error.meta = {
            ...(error.meta || {}),
            llmServiceError: {
              code: error.code,
              httpStatus: error.httpStatus,
              providerId: error.providerId,
              providerName: error.providerName,
              model: error.model,
              baseUrl: error.baseUrl,
              serviceMessage: error.serviceMessage,
            },
            llmRequestPayload,
            currentNodeLogExtraction: llmRequestPayload ? {
              log: llmRequestPayload.currentLog,
              extractedContent: llmRequestPayload.currentExtractedContent,
              json: llmRequestPayload.currentJson,
            } : undefined,
          };
        }
        error.meta = { ...(error.meta || {}), candidateSelection, timeoutBudgets: budgets.snapshot(), llmJudgments };
        error.stdout = [require('./workflow-llm-budgets').formatTiming(budgets.snapshot(), llmJudgments), error.stdout].filter(Boolean).join('\n\n');
        throw error;
      } finally {
        if (parseWorkflowBoolean(renderedValues.captureScreenshotOnPass, true)) {
          await captureWorkflowAssertScreenshot(context, assertDeviceType, componentSerial, step);
        }
      }

      return {
        completedAt,
        command: `LLM assert ${lineRegex}`,
        stdout: [
          'LLM 断言通过',
          require('./workflow-llm-budgets').formatTiming(budgets.snapshot(), llmJudgments),
          llmDebugOutput || [
            `命中日志：${matchedLine}`,
            `断言诉求：${assertionPrompt}`,
            `判断结果：${JSON.stringify(llmAssertResult.assertion, null, 2)}`,
            `Raw Response:\n${llmAssertResult.rawContent}`,
          ].join('\n\n'),
          extractedVariable ? `提取变量：variables.${extractedVariable.name} = ${JSON.stringify(extractedVariable.value, null, 2)}` : '',
        ].filter(Boolean).join('\n\n'),
        stderr: '',
        meta: {
          ...getAssertExtractionMeta(renderedValues, extractedVariable),
          candidateSelection,
          timeoutBudgets: budgets.snapshot(),
          llmJudgments,
          llmResponse:llmAssertResult.llmResponse,
          llmAssertion: llmAssertResult.assertion,
          llmRequestPayload,
          currentNodeLogExtraction: llmRequestPayload ? {
            log: llmRequestPayload.currentLog,
            extractedContent: llmRequestPayload.currentExtractedContent,
            json: llmRequestPayload.currentJson,
          } : undefined,
        },
      };
    }

    const command = renderCommandTemplate(resolveWorkflowValue(component.commandTemplate, context), renderedValues);
    const isPcCommand = component.kind === 'pc_command';
    const execution = isPcCommand ? createPcExecution(command) : createAdbExecution(command);
    const acceptedExitCodes = normalizeAcceptedExitCodes(
      renderedValues.acceptedExitCodes ?? step.acceptedExitCodes ?? step.config?.acceptedExitCodes ?? component.acceptedExitCodes
    );
    const outputMappings = renderedValues.outputMapping || renderedValues.variableMapping
      || renderedValues.mapping || step.outputMapping || step.config?.outputMapping || step.config?.variableMapping || component.outputMapping || {};
    const onError = String(renderedValues.onError || step.onError || step.config?.onError || component.onError || 'fail').toLowerCase();
    const resultAssertions = parseCommandResultAssertions(resolveWorkflowValue(
      step.config?.resultAssertions ?? renderedValues.resultAssertions ?? component.resultAssertions, context
    ));
    let result;
    const shellIndex = isPcCommand ? -1 : execution.args.indexOf('shell');
    // Only an isolated force-stop may be skipped. Never skip a preparation script
    // that also launches or navigates an app just because its process is absent.
    const forceStopMatch = shellIndex < 0 ? null : execution.args.slice(shellIndex + 1).join(' ').trim().match(/^am\s+force-stop\s+([A-Za-z0-9._]+)$/);
    if (forceStopMatch && componentSerial) {
      const processState = await queryAndroidProcessState(componentSerial, forceStopMatch[1]);
      if (!processState.success) {
        const error = new Error(processState.error || '无法查询目标应用进程状态');
        error.errorCode = 'PROCESS_QUERY_FAILED';
        error.errorType = 'device-transport';
        error.recoveryActions = processState.recoveryActions || [];
        throw error;
      }
      if (!processState.running) {
        result = {
          success: true,
          stdout: `进程未运行，已跳过 force-stop：${forceStopMatch[1]}`,
          stderr: '',
          skipped: true,
          skipReason: 'PROCESS_NOT_RUNNING',
          processState,
        };
      }
    }
    try {
      if (!result) {
        try {
          result = isPcCommand
            ? await runCommandWithOptions(execution.command, execution.args, { timeout })
            : await runCommand(execution.command, execution.args, timeout);
        } catch (error) {
          if (error.exitCode === null || error.exitCode === undefined || !acceptedExitCodes.includes(Number(error.exitCode))) throw error;
          result = { success: true, stdout: error.stdout || '', stderr: error.stderr || '',
            exitCode: Number(error.exitCode), signal: error.signal || null, acceptedExitCode: true };
        }
      }
      assertCommandResult(result, resultAssertions, execution.preview);
    } catch (error) {
      const exitCode = error.exitCode ?? (error.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? null : null);
      if (onError === 'continue') {
        result = {
          success: false,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message || '',
          exitCode: exitCode ?? null,
          signal: error.signal || null,
          timedOut: Boolean(error.timeoutMs),
          warning: {
            code: error.errorCode || (isPcCommand ? 'PC_COMMAND_CONTINUED' : 'ADB_COMMAND_CONTINUED'),
            errorType: error.errorType || '',
            diagnostics: error.diagnostics,
            message: error.message,
            recoveryActions: Array.isArray(error.recoveryActions) ? error.recoveryActions : [],
          },
        };
      } else if (onError === 'branch') {
        result = {
          success: false,
          stdout: error.stdout || '',
          stderr: error.stderr || error.message || '',
          exitCode: exitCode ?? null,
          signal: error.signal || null,
          timedOut: Boolean(error.timeoutMs),
          branch: 'error',
          warning: { code: error.errorCode || (isPcCommand ? 'PC_COMMAND_BRANCH' : 'ADB_COMMAND_BRANCH'), message: error.message, errorType: error.errorType || '', recoveryActions: error.recoveryActions || [], diagnostics: error.diagnostics },
        };
      } else {
        throw error;
      }
    }

    applyCommandOutputMappings(context, result, outputMappings);
    return {
      command: execution.preview,
      ...result,
      success: result.success !== false,
      meta: {
        ...(result.meta || {}),
        acceptedExitCodes,
        resultAssertions,
        warning: result.warning,
        branch: result.branch,
        onError,
        outputMapping: outputMappings,
        nodeOutput: {
          stdout: result.stdout || '',
          stderr: result.stderr || '',
          exitCode: readCommandExitCode(result),
          signal: result.signal || null,
          timedOut: Boolean(result.timedOut),
          success: result.success !== false,
        },
      },
    };
  }

  const serial = step.type === 'wait' || (step.type === 'send_audio' && step.device === 'pc') ? '' : getWorkflowSerial(step, context);

  if (step.type === 'launch_test_page') {
    const packageName = getWorkflowPackage(step, context, config);
    const activity = String(config.activity || '').trim();
    if (!activity) throw new Error('请配置目标 Activity');
    const args = ['-s', serial, 'shell', 'am', 'start', '-n', `${packageName}/${activity}`, '-a', 'start_debug_server'];
    const result = await runCommand(getAdbPath(), args, step.timeoutMs || 30000);

    return {
      command: buildAdbCommandPreview(args),
      ...result,
    };
  }

  if (step.type === 'broadcast_scene') {
    const action = String(config.action || '').trim();
    if (!action) throw new Error('请配置广播 Action');
    const params = config.params || {};
    const args = ['-s', serial, 'shell', 'am', 'broadcast', '-a', action, '--es', 'params', JSON.stringify(params)];
    const result = await runCommand(getAdbPath(), args, step.timeoutMs || 30000);

    return {
      command: buildAdbCommandPreview(args),
      ...result,
    };
  }

  if (step.type === 'send_audio') {
    return executeAudioInputStep(step, context, serial, config, config.commandTemplate);
  }

  if (step.type === 'wait') {
    const durationMs = Number(config.durationMs || 0);
    await sleepWorkflow(durationMs, workflowCommandScope.getStore());

    return {
      command: `wait ${durationMs}ms`,
      stdout: '',
      stderr: '',
    };
  }

  if (step.type === 'push_audio') {
    const { localPath, remotePath = '/sdcard/Download/' } = config;

    if (!localPath) {
      throw new Error('推送音频节点缺少 localPath');
    }

    const resolvedLocalPath = resolveWorkflowLocalAssetPath(localPath, context);
    if (!fs.existsSync(resolvedLocalPath)) {
      throw new Error(`本地音频文件不存在：${resolvedLocalPath}`);
    }
    const args = ['-s', serial, 'push', resolvedLocalPath, remotePath];
    const result = await runCommand(getAdbPath(), args, step.timeoutMs || 60000);

    return {
      command: buildAdbCommandPreview(args),
      ...result,
    };
  }

  if (step.type === 'debug_forward') {
    const localPort = Number(config.localPort || 8080);
    const remotePort = Number(config.remotePort || 8080);
    const args = ['-s', serial, 'forward', `tcp:${localPort}`, `tcp:${remotePort}`];
    const result = await runCommand(getAdbPath(), args, step.timeoutMs || 30000);

    return {
      command: buildAdbCommandPreview(args),
      ...result,
    };
  }

  if (step.type === 'rpc_assert') {
    const operationType = config.operationType;
    const limit = Number(config.limit || 50);
    const response = await fetch(`http://localhost:8080/rpc/logs?limit=${limit}`);
    const logs = await response.json();
    const source = Array.isArray(logs) ? logs : logs.logs || logs.data || [];
    const matched = source.some((item) => JSON.stringify(item).includes(operationType));

    if (!matched) {
      throw new Error(`未找到 RPC 日志：${operationType}`);
    }

    return {
      command: `GET http://localhost:8080/rpc/logs?limit=${limit}`,
      stdout: JSON.stringify(source.slice(0, 3)),
      stderr: '',
    };
  }

  throw new Error(`暂不支持的节点类型：${step.type}`);
}

function shouldApplyPostDelay(step) {
  return step.type !== 'start' && step.type !== 'end' && step.type !== 'wait' && Number(step.postDelayMs || 0) > 0;
}

function shouldCleanupWorkflowAudioFiles(steps = []) {
  const endStep = [...steps].reverse().find((step) => step?.type === 'end');

  return parseWorkflowBoolean(endStep?.config?.cleanupAudioFiles, true);
}

function shouldCleanupWorkflowImageFiles(steps = []) {
  const endStep = [...steps].reverse().find((step) => step?.type === 'end');

  return parseWorkflowBoolean(endStep?.config?.cleanupImageFiles, true);
}

function sendLogProgress(event, requestId, step, status, message, extra = {}) {
  try {
    if (!event?.sender || event.sender.isDestroyed?.()) {
      return false;
    }
    event.sender.send('logs:progress', {
      requestId,
      step,
      status,
      message,
      ...extra,
    });
    return true;
  } catch (_error) {
    return false;
  }
}

function createLogPullFailure(error, details = {}) {
  const message = error instanceof Error ? error.message : String(error || '历史日志拉取失败');
  const errorCode = error?.errorCode || error?.code || 'LOG_HISTORY_PULL_FAILED';
  const isPhoneTarget = details.deviceType === 'phone';
  return {
    success: false,
    error: message,
    errorCode,
    diagnostics: {
      schemaVersion: 'glassbox.error.v1',
      errorCode,
      errorType: 'log-history',
      message,
      ...details,
    },
    recoveryActions: isPhoneTarget ? [
      '确认手机已连接且 adb 状态为 device',
      '确认当前手机包名正确且应用日志目录可访问',
      '重试历史日志捞取或选择新的保存目录',
    ] : [
      '确认眼镜已连接且 adb 状态为 device',
      '确认日志解密器 jar 与 Java 环境可用',
      '重试历史日志捞取或选择新的保存目录',
    ],
  };
}

function parseAdbDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [serial, state] = line.split(/\s+/);
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
    });
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

  if (/(phone|iphone|pixel|samsung|xiaomi|redmi|oppo|vivo|huawei|honor|oneplus|realme|meizu)/.test(haystack)) {
    return 'phone';
  }

  return 'unknown';
}

function shellSingleQuote(value) {
  return `'${String(value || '').replace(/'/g, "'\\''")}'`;
}

function parseFirstNumber(value) {
  const match = String(value || '').match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function parseAndroidMeminfo(output) {
  const totalPss = String(output || '').match(/TOTAL\s+PSS:\s*(\d+)/i);
  if (totalPss) {
    return Number(totalPss[1]);
  }

  const totalLine = String(output || '').split(/\r?\n/).find((line) => /^\s*TOTAL\s+\d+/.test(line));
  if (totalLine) {
    return parseFirstNumber(totalLine);
  }

  return undefined;
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

  const columns = packageLine.trim().split(/\s+/);
  const numericColumns = columns
    .map((column) => column.replace(/%$/, ''))
    .filter((column) => /^\d+(?:\.\d+)?$/.test(column))
    .map(Number);

  return numericColumns.length > 0 ? numericColumns[numericColumns.length - 1] : undefined;
}

function parseSystemAvailableMemoryKb(output) {
  const text = String(output || '');
  const memAvailable = text.match(/^MemAvailable:\s*(\d+)\s*kB/im);
  if (memAvailable) {
    return Number(memAvailable[1]);
  }

  const freeRam = text.match(/Free RAM:\s*([\d,]+)\s*K/i);
  if (freeRam) {
    return Number(freeRam[1].replace(/,/g, ''));
  }

  const harmonyFree = text.match(/Mem:\s+\S+\s+total,\s+\S+\s+used,\s+(\d+(?:\.\d+)?[KMG]?)\s+free/i);
  if (harmonyFree) {
    return parseSizeToKb(harmonyFree[1]);
  }

  return undefined;
}

function parseSystemAvailableCpuPercent(output) {
  const text = stripAnsiControl(output);
  const idleMatch = text.match(/(\d+(?:\.\d+)?)%\s*idle/i);
  if (idleMatch) {
    return Number(idleMatch[1]);
  }

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

function stripAnsiControl(value) {
  return String(value || '')
    .replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\x1B[@-_]/g, '')
    .replace(/\r/g, '\n');
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

function pickPidFromOutput(output) {
  const pids = String(output || '').match(/\b\d+\b/g) || [];
  return pids[0] || '';
}

function parseHarmonyTopProcess(output, packageName, pid = '') {
  const cleanOutput = stripAnsiControl(output);
  const lines = cleanOutput
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
    processLine,
  };
}

function parseHdcTargets(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\[?empty\]?$/i.test(line))
    .map((line) => {
      const [serial, state = 'device'] = line.split(/\s+/);
      return {
        serial,
        state,
        model: '',
        product: '',
        device: '',
        transportId: '',
        kind: 'unknown',
      };
    });
}

function parseHarmonyPackages(output) {
  return String(output || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^[A-Za-z0-9_.]+$/.test(line))
    .sort((first, second) => first.localeCompare(second));
}

async function collectAndroidPerformanceSample(serial, packageName, { signal } = {}) {
  const commandErrors = [];
  const read = async (args, timeoutMs) => {
    try { signal?.throwIfAborted(); return await runAdb(args, timeoutMs, signal); } catch (error) {
      signal?.throwIfAborted();
      // pidof uses exit 1 with empty output for a genuine no-match.
      if (args[3] === 'pidof' && error.exitCode === 1 && !error.signal && !String(error.stderr || '').trim() && !String(error.stdout || '').trim()) return '';
      commandErrors.push({ command: [getAdbPath(), ...args], timeoutMs, exitCode: error.exitCode ?? null, signal: error.signal || null, stdout: error.stdout || '', stderr: error.stderr || '', error: error.message });
      return '';
    }
  };
  const pidOutput = await read(['-s', serial, 'shell', 'pidof', packageName], 5000);
  const pid = pickPidFromOutput(pidOutput);
  const meminfo = await read(['-s', serial, 'shell', 'dumpsys', 'meminfo', packageName], 8000);
  const cpuinfo = await read(['-s', serial, 'shell', 'dumpsys', 'cpuinfo'], 8000);
  const systemMeminfo = await read(['-s', serial, 'shell', 'cat', '/proc/meminfo'], 5000);
  const topOutput = await read(['-s', serial, 'shell', 'top', '-n', '1', '-b'], 8000);
  const status = pid
    ? await read(['-s', serial, 'shell', 'cat', `/proc/${pid}/status`], 5000)
    : '';
  const threadCount = parseProcStatusThreads(status)
    || (pid ? parseFirstNumber(await read(['-s', serial, 'shell', 'sh', '-c', `ls /proc/${pid}/task 2>/dev/null | wc -l`], 5000)) : undefined);

  const { raw: batteryRaw, batteryDiagnostic, ...batteryMetrics } = await collectPerformanceBattery(
    abortSignal => runAdb(['-s', serial, 'shell', 'dumpsys', 'battery'], 8000, abortSignal), signal);

  return {
    ...batteryMetrics,
    pid,
    commandErrors,
    processObserved: meminfo.split('\n').some(line => line.includes(` [${packageName}]`) && line.includes('MEMINFO in pid ')),
    memoryKb: parseAndroidMeminfo(meminfo) || parseProcStatusMemory(status),
    cpuPercent: parseAndroidTopProcess(topOutput, packageName, pid).cpuPercent ?? parseCpuPercentFromOutput(cpuinfo, packageName),
    cpuSource: parseAndroidTopProcess(topOutput, packageName, pid).cpuPercent !== undefined ? 'top' : 'dumpsys-cpuinfo',
    cpuUnit: 'percent-one-core',
    threadCount,
    systemAvailableMemoryKb: parseSystemAvailableMemoryKb(systemMeminfo),
    systemAvailableCpuPercent: parseSystemAvailableCpuPercent(topOutput),
    raw: {
      battery: batteryRaw,
      ...(batteryDiagnostic ? { batteryDiagnostic } : {}),
      pid: pidOutput,
      meminfo,
      cpuinfo,
      systemMeminfo,
      top: topOutput,
      status,
    },
  };
}

async function collectHarmonyPerformanceSample(serial, packageName, { signal } = {}) {
  const read = (args, timeout) => { signal?.throwIfAborted(); return runHdc(args, timeout, signal); };
  const fallback = (error, value) => { signal?.throwIfAborted(); return value; };
  const target = shellSingleQuote(packageName);
  const pidOutput = await read(['-t', serial, 'shell', `pidof ${target}`], 5000).catch(error => fallback(error, ''));
  const pid = pickPidFromOutput(pidOutput);
  const topOutput = await read(['-t', serial, 'shell', 'top -m 20 -n 1'], 8000).catch(error => fallback(error, `ERROR: ${error.message}`));
  const topProcess = parseHarmonyTopProcess(topOutput, packageName, pid);
  const effectivePid = pid || topProcess.pid || '';
  const status = effectivePid
    ? await read(['-t', serial, 'shell', `cat /proc/${effectivePid}/status`], 5000).catch(error => fallback(error, `ERROR: ${error.message}`))
    : '';
  const threadOutput = effectivePid
    ? await read(['-t', serial, 'shell', `ls /proc/${effectivePid}/task 2>/dev/null | wc -l`], 5000).catch(error => fallback(error, ''))
    : '';

  return {
    pid: effectivePid,
    memoryKb: parseProcStatusMemory(status) || topProcess.memoryKb,
    cpuPercent: topProcess.cpuPercent ?? parseCpuPercentFromOutput(topOutput, packageName),
    threadCount: parseProcStatusThreads(status) || parseFirstNumber(threadOutput),
    systemAvailableMemoryKb: parseSystemAvailableMemoryKb(topOutput),
    systemAvailableCpuPercent: parseSystemAvailableCpuPercent(topOutput),
    raw: {
      pid: pidOutput,
      status,
      top: topOutput,
      topProcessLine: topProcess.processLine || '',
      threadCount: threadOutput,
    },
  };
}

async function collectWorkflowTaskPerformanceSample(_target, config = {}, options = {}) {
  const runtime = String(config.runtime || 'android') === 'harmony' ? 'harmony' : 'android';
  const sample = runtime === 'harmony'
    ? await collectHarmonyPerformanceSample(config.serial, config.packageName, options)
    : await collectAndroidPerformanceSample(config.serial, config.packageName, options);
  return {
    timestamp: new Date().toISOString(),
    serial: config.serial,
    packageName: config.packageName,
    runtime,
    ...sample,
    errorCode: sample.commandErrors?.length ? 'PERFORMANCE_COMMAND_FAILED' : sample.pid ? '' : sample.processObserved ? 'PERFORMANCE_PROCESS_ID_UNRESOLVED' : 'PERFORMANCE_TARGET_PROCESS_NOT_FOUND',
    error: sample.commandErrors?.length ? '性能采样命令失败，详见 commandErrors；不能据此判断设备离线或进程不存在' : sample.pid ? '' : sample.processObserved ? '已观察到目标进程，但未可靠取得 PID；本次采样不完整' : '未找到目标进程，请确认应用正在运行，且包名/进程名正确',
  };
}

function applyWorkflowPerformanceSnapshot(task, snapshot) {
  if (!snapshot) return task;
  const withReports = {
    ...task,
    performanceReports: snapshot.performanceReports,
    performanceDiagnostics: snapshot.performanceDiagnostics,
    performanceStatus: snapshot.performanceStatus,
    performanceErrorCode: snapshot.performanceErrorCode,
    performanceRecoveryActions: snapshot.performanceRecoveryActions,
  };
  return attachPerformanceReportsToTaskCases(withReports, snapshot.performanceReports);
}

async function getDeviceProps(serial) {
  try {
    const [model, manufacturer, device, characteristics] = await Promise.all([
      runAdb(['-s', serial, 'shell', 'getprop', 'ro.product.model']),
      runAdb(['-s', serial, 'shell', 'getprop', 'ro.product.manufacturer']),
      runAdb(['-s', serial, 'shell', 'getprop', 'ro.product.device']),
      runAdb(['-s', serial, 'shell', 'getprop', 'ro.build.characteristics']),
    ]);

    return {
      model: model.trim(),
      manufacturer: manufacturer.trim(),
      device: device.trim(),
      characteristics: characteristics.trim(),
    };
  } catch (_error) {
    return {};
  }
}

// Gate every renderer request before invoking a privileged handler.
const registerRendererHandler = ipcMain.handle.bind(ipcMain);
ipcMain.handle = (channel, handler) => registerRendererHandler(channel, (event, ...args) => {
  if (!mainWindow || event.sender !== mainWindow.webContents
      || event.senderFrame !== mainWindow.webContents.mainFrame) {
    throw new Error('Untrusted IPC sender');
  }
  return handler(event, ...args);
});

ipcMain.handle('adb:list-devices', async () => {
  try {
    const output = await runAdb(['devices', '-l']);
    const devices = parseAdbDevices(output);
    const enrichedDevices = await Promise.all(
      devices.map(async (device) => {
        const props = device.state === 'device' ? await getDeviceProps(device.serial) : {};

        return {
          ...device,
          ...props,
          kind: classifyDevice(device, props),
        };
      })
    );

    return { devices: enrichedDevices };
  } catch (error) {
    return {
      devices: [],
      error: error.message,
    };
  }
});

ipcMain.handle('adb:list-packages', async (_event, serial) => {
  if (!serial) {
    return { packages: [] };
  }

  try {
    let output = await runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages']);

    if (!String(output || '').trim()) {
      output = await runAdb(['-s', serial, 'shell', 'cmd', 'package', 'list', 'packages']);
    }

    const packages = output
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^package:/, ''))
      .filter(Boolean)
      .sort((first, second) => first.localeCompare(second));

    return { packages };
  } catch (error) {
    return {
      packages: [],
      error: error.message,
    };
  }
});

ipcMain.handle('mobile-ui:inspect', async (_event, payload = {}) => {
  const serial = String(payload.serial || '').trim();

  try {
    const result = await inspectMobileUi(serial);
    const action = String(payload.action || '');
    const clickPreview = action === 'tap' || action === 'input'
      ? createMobileUiClickPreview(
          result,
          payload.selector || {},
          String(payload.matchMode || 'auto'),
          String(payload.tapPosition || 'center'),
          payload.tapInsetXPx ?? payload.tapInsetPx,
          payload.tapInsetYPx ?? payload.tapInsetPx
        )
      : null;
    return {
      success: true,
      ...result,
      clickPreview,
      xml: undefined,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      elements: [],
      screenshotDataUrl: '',
      screen: {},
    };
  }
});

// Typed recording controls; no renderer-supplied shell commands or arbitrary stop session ids.
for (const [channel, operation] of Object.entries({
  'solopi:current': () => soloPiRecording.current(),
  'solopi:record-start': value => soloPiRecording.start(value),
  'solopi:record-stop': value => soloPiRecording.stop(value.id),
  'solopi:record-discard': value => soloPiRecording.discard(value.id),
  'solopi:convert': value => convertSoloPiCase(value.source, { phoneSerial: value.phoneSerial }),
})) {
  ipcMain.handle(channel, async (_event, value = {}) => {
    try { return { success: true, ...(await operation(value)) }; }
    catch (error) { return { success: false, error: error.message, code: error.code, recording: error.recording, permissionCheck: error.permissionCheck }; }
  });
}
ipcMain.handle('solopi:select-file', async () => {
  const chosen = await dialog.showOpenDialog({ properties: ['openFile'], filters: [{ name: 'SoloPi exported case', extensions: ['json'] }] });
  if (chosen.canceled || !chosen.filePaths[0]) return { canceled: true };
  try {
    const file = chosen.filePaths[0];
    if (fs.statSync(file).size > SOLOPI_MAX_BYTES) throw new Error('SoloPi 用例文件不能超过 10 MiB');
    return { success: true, source: fs.readFileSync(file, 'utf8') };
  } catch (error) { return { success: false, error: error.message }; }
});

ipcMain.handle('mobile-ui:debug-step', async (_event, payload = {}) => {
  const step = payload.step && typeof payload.step === 'object' ? payload.step : null;
  const component = payload.component && typeof payload.component === 'object' ? payload.component : null;
  const supportedKinds = new Set(['mobile_ui_action', 'mobile_ui_assert']);

  if (!step || step.type !== 'component' || !component || step.componentId !== component.id || !supportedKinds.has(component.kind)) {
    return {
      success: false,
      errorCode: 'MOBILE_UI_DEBUG_STEP_INVALID',
      error: '仅支持调试当前手机 UI 操作或元素校验节点',
      recoveryActions: ['选择一个手机 UI 操作或元素校验节点后重试。'],
    };
  }

  const startedAt = new Date().toISOString();
  const startedAtMs = Date.now();
  const context = {
    defaults: payload.defaults && typeof payload.defaults === 'object' ? payload.defaults : {},
    variables: payload.variables && typeof payload.variables === 'object' ? payload.variables : {},
    components: { [component.id]: component },
    pushedAudioFiles: [],
    pushedImageFiles: [],
    generatedTtsAudioFiles: [],
    cleanupAudioFiles: false,
    cleanupImageFiles: false,
    nodeOutputs: {},
  };

  try {
    const output = await executeWorkflowStep(step, context);
    return {
      success: true,
      stepId: step.id,
      stepName: step.name,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      command: output.command || '',
      stdout: output.stdout || '',
      stderr: output.stderr || '',
      meta: output.meta,
    };
  } catch (error) {
    const errorCode = error?.errorCode || error?.code || 'MOBILE_UI_DEBUG_STEP_FAILED';
    const recoveryActions = Array.isArray(error?.recoveryActions) && error.recoveryActions.length > 0
      ? error.recoveryActions
      : ['确认手机设备在线并已允许 USB 调试。', '刷新手机页面并重新选择目标元素后重试。'];
    return {
      success: false,
      stepId: step.id,
      stepName: step.name,
      startedAt,
      endedAt: new Date().toISOString(),
      durationMs: Date.now() - startedAtMs,
      error: error?.message || String(error),
      errorCode,
      errorType: error?.errorType || 'device-interaction',
      recoveryActions,
      diagnostics: error?.diagnostics || error?.meta?.diagnostics || createWorkflowErrorDiagnostics(
        errorCode,
        error?.errorType || 'device-interaction',
        error?.message || String(error),
        recoveryActions,
        { stepId: step.id, componentId: component.id, device: 'phone' }
      ),
      command: error?.command || '',
      stdout: error?.stdout || '',
      stderr: error?.stderr || '',
    };
  }
});

registerApplicationHandler('performance:list-devices', async (_event, payload = {}) => {
  const runtime = String(payload.runtime || 'android') === 'harmony' ? 'harmony' : 'android';

  try {
    if (runtime === 'harmony') {
      const output = await runHdc(['list', 'targets'], 5000);
      return {
        devices: parseHdcTargets(output),
        command: `${getHdcPath()} list targets`,
      };
    }

    const output = await runAdb(['devices', '-l']);
    const devices = parseAdbDevices(output);
    const enrichedDevices = await Promise.all(
      devices.map(async (device) => {
        const props = device.state === 'device' ? await getDeviceProps(device.serial) : {};

        return {
          ...device,
          ...props,
          kind: classifyDevice(device, props),
        };
      })
    );

    return {
      devices: enrichedDevices,
      command: `${getAdbPath()} devices -l`,
    };
  } catch (error) {
    return {
      devices: [],
      error: error.message,
      command: runtime === 'harmony' ? `${getHdcPath()} list targets` : `${getAdbPath()} devices -l`,
    };
  }
});

ipcMain.handle('adb:install-apk', async (_event, payload = {}) => {
  try {
    const result = await installApkToDevice(payload, { runAdb });
    trackGlassBoxUsage('device_apk_install', {
      success: true,
      deviceType: String(payload.deviceType || 'device'),
    });
    return result;
  } catch (error) {
    trackGlassBoxUsage('device_apk_install', {
      success: false,
      deviceType: String(payload.deviceType || 'device'),
      errorCode: error?.errorCode || 'APK_INSTALL_FAILED',
    });
    return {
      success: false,
      error: error?.message || String(error),
      errorCode: error?.errorCode || 'APK_INSTALL_FAILED',
      androidErrorCode: error?.androidErrorCode || '',
      technicalDetails: error?.technicalDetails || error?.message || String(error),
      packageName: error?.packageName || '',
      currentVersion: error?.currentVersion || null,
      targetVersion: error?.targetVersion || null,
      metadataErrors: error?.metadataErrors || [],
      recoveryActions: Array.isArray(error?.recoveryActions) ? error.recoveryActions : [],
    };
  }
});

registerApplicationHandler('performance:list-packages', async (_event, payload = {}) => {
  const runtime = String(payload.runtime || 'android') === 'harmony' ? 'harmony' : 'android';
  const serial = String(payload.serial || '').trim();

  if (!serial) {
    return { packages: [] };
  }

  try {
    if (runtime === 'harmony') {
      const output = await runHdc(['-t', serial, 'shell', 'bm dump -a'], 10000);
      return {
        packages: parseHarmonyPackages(output),
        command: `${getHdcPath()} -t ${serial} shell bm dump -a`,
      };
    }

    let output = await runAdb(['-s', serial, 'shell', 'pm', 'list', 'packages']);

    if (!String(output || '').trim()) {
      output = await runAdb(['-s', serial, 'shell', 'cmd', 'package', 'list', 'packages']);
    }

    const packages = output
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^package:/, ''))
      .filter(Boolean)
      .sort((first, second) => first.localeCompare(second));

    return { packages };
  } catch (error) {
    return {
      packages: [],
      error: error.message,
    };
  }
});

ipcMain.handle('performance:get-package-version', async (_event, payload = {}) => {
  const runtime = String(payload.runtime || 'android') === 'harmony' ? 'harmony' : 'android';
  const serial = String(payload.serial || '').trim();
  const packageName = String(payload.packageName || '').trim();

  if (!serial || !packageName || !/^[A-Za-z0-9._]+$/.test(packageName)) {
    return { version: '' };
  }

  try {
    if (runtime === 'harmony') {
      const output = await runHdc(['-t', serial, 'shell', `bm dump -n ${packageName}`], 10000);
      return {
        version: parsePackageVersion(output),
      };
    }

    const output = await runAdb(['-s', serial, 'shell', `dumpsys package ${packageName} | grep version`]);

    return {
      version: parsePackageVersion(output),
    };
  } catch (error) {
    return {
      version: '',
      error: error.message,
    };
  }
});

// Bugreport analysis is local and begins only through an explicit start request.
const bugreportOwners = new WeakSet();
function bindBugreportOwner(sender) {
  if (bugreportOwners.has(sender)) return;
  bugreportOwners.add(sender);
  const owner = sender.id;
  sender.once('destroyed', () => { void bugreportJobs.cancelOwner(owner); });
  sender.on('render-process-gone', () => { void bugreportJobs.cancelOwner(owner); });
}
ipcMain.handle('bugreport:pick', async event => {
  try {
    const chosen = await dialog.showOpenDialog(mainWindow, { properties: ['openFile'], filters: [{ name: 'Android Battery Logs', extensions: ['zip', 'txt', 'log'] }] });
    return chosen.canceled ? { cancelled: true } : bugreportJobs.registerUpload(event.sender.id, chosen.filePaths[0]);
  } catch (error) { return { error: error.message }; }
});
for (const action of ['start', 'status', 'current', 'cancel', 'history', 'open-report', 'reveal-source']) {
  registerApplicationHandler(`bugreport:${action}`, async (event, payload = {}) => {
    try {
      const owner = event.sender.id;
      bindBugreportOwner(event.sender);
      if (action === 'current') return {job: bugreportJobs.current(owner)};
      if (action === 'history') return await bugreportJobs.listReports();
      if (action === 'open-report') return await bugreportJobs.openReport(payload.key, owner);
      if (action === 'reveal-source') { shell.showItemInFolder(await bugreportJobs.sourceForReport(payload.key)); return {success:true}; }
      if (action === 'start') return bugreportJobs.start(owner, payload);
      if (action === 'cancel') return await bugreportJobs.cancel(owner, payload.id);
      return bugreportJobs.get(owner, payload.id);
    } catch (error) { return { error: error.message }; }
  });
}

// Owned by the renderer that started the performance session; never shared across windows.
const performanceCrashSessions = new Map();
const performanceCrashOwners = new WeakSet();
async function stopPerformanceCrashesForOwner(owner) {
  await Promise.all([...performanceCrashSessions].filter(([, entry]) => entry.owner === owner).map(async ([id, entry]) => {
    await entry.collector.stop(); performanceCrashSessions.delete(id);
  }));
}
for (const action of ['start', 'get', 'stop']) {
  registerApplicationHandler(`performance:crashes-${action}`, async (event, payload = {}) => {
    const owner = event.sender.id;
    if (action === 'start') {
      await stopPerformanceCrashesForOwner(owner);
      const serial = String(payload.serial || '').trim(), packageName = String(payload.packageName || '').trim();
      if (!serial || !packageName) throw new Error('崩溃统计缺少设备或包名');
      const id = crypto.randomUUID();
      const collector = createPerformanceCrashCollector({ serial, packageName, runtime: payload.runtime,
        adbPath: getAdbPath(), artifactPath: path.join(getGlassBoxDataDir(), 'logs', 'performance-crashes', `${id}.json`) });
      performanceCrashSessions.set(id, { owner, collector });
      if (!performanceCrashOwners.has(event.sender)) {
        performanceCrashOwners.add(event.sender);
        event.sender.once('destroyed', () => { void stopPerformanceCrashesForOwner(owner); });
        event.sender.on('render-process-gone', () => { void stopPerformanceCrashesForOwner(owner); });
      }
      await collector.start();
      return { id, ...collector.snapshot() };
    }
    const entry = performanceCrashSessions.get(payload.id);
    if (!entry || entry.owner !== owner) throw new Error('崩溃统计会话不存在');
    if (action === 'get') return entry.collector.snapshot();
    const result = await entry.collector.stop(); performanceCrashSessions.delete(payload.id); return result;
  });
}

registerApplicationHandler('performance:sample', async (_event, payload = {}) => {
  const runtime = String(payload.runtime || 'android') === 'harmony' ? 'harmony' : 'android';
  const serial = String(payload.serial || '').trim();
  const packageName = String(payload.packageName || '').trim();

  if (!serial) {
    return { success: false, error: '缺少设备 SN' };
  }

  if (!packageName) {
    return { success: false, error: '缺少包名或进程名' };
  }

  try {
    const sample = runtime === 'harmony'
      ? await collectHarmonyPerformanceSample(serial, packageName)
      : await collectAndroidPerformanceSample(serial, packageName);
    const error = !sample.pid
      ? '未找到目标进程，请确认应用正在运行，且包名/进程名正确'
      : undefined;

    return {
      success: !error,
      sample: {
        timestamp: new Date().toISOString(),
        serial,
        packageName,
        runtime,
        ...sample,
        error,
      },
      error,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      sample: {
        timestamp: new Date().toISOString(),
        serial,
        packageName,
        runtime,
        error: error.message,
      },
    };
  }
});

ipcMain.handle('adb:read-sdk-env', async (_event, payload = {}) => {
  const { serial } = payload;
  const packageName = String(payload.packageName || '').trim();

  if (!serial || !packageName || !/^[A-Za-z0-9._]+$/.test(packageName)) {
    return {
      environment: '',
      available: false,
      fallbackText: '未读取到环境配置：缺少应用包名',
    };
  }

  const envFile = `/sdcard/Android/data/${packageName}/files/sdk_env`;
  try {
    const output = await runAdb([
      '-s',
      serial,
      'shell',
      'cat',
      envFile,
    ]);
    const rawEnvironment = output.trim();
    if (!rawEnvironment) {
      return {
        environment: 'ONLINE',
        rawEnvironment,
        available: true,
        fallbackText: '',
        defaulted: true,
      };
    }

    const environmentMap = {
      ENV_PRE: 'PRE',
      ENV_GRAY: 'GRAY',
      ENV_STABLE: 'STABLE',
      ENV_ONLINE: 'ONLINE',
    };
    const environment = environmentMap[rawEnvironment];

    if (!environment) {
      return {
        environment: '',
        rawEnvironment,
        available: false,
        fallbackText: '未读取到环境配置',
      };
    }

    return {
      environment,
      rawEnvironment,
      available: true,
    };
  } catch (error) {
    if (isMissingRemoteFileError(error, envFile)) {
      return {
        environment: 'ONLINE',
        rawEnvironment: '',
        available: true,
        fallbackText: '',
        defaulted: true,
      };
    }

    const diagnosticError = createAdbDiagnosticError(error, {
      deviceRole: 'phone',
      serial,
      packageName,
      command: error?.command || `${getAdbPath()} -s ${serial} shell cat ${envFile}`,
    });
    return {
      environment: '',
      available: false,
      fallbackText: diagnosticError.message,
      error: diagnosticError.message,
      errorCode: diagnosticError.errorCode,
      errorType: diagnosticError.errorType,
      serial: diagnosticError.serial,
      packageName: diagnosticError.packageName,
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
});

ipcMain.handle('adb:set-sdk-env', async (_event, payload = {}) => {
  const { serial, environment } = payload;
  const packageName = String(payload.packageName || '').trim();
  const environmentMap = {
    PRE: 'ENV_PRE',
    GRAY: 'ENV_GRAY',
    STABLE: 'ENV_STABLE',
    ONLINE: 'ENV_ONLINE',
  };
  const rawEnvironment = environmentMap[environment];

  if (!serial || !rawEnvironment || !/^[A-Za-z0-9._]+$/.test(packageName)) {
    return {
      success: false,
      error: 'Missing serial, packageName or invalid environment',
    };
  }

  try {
    const envDir = `/sdcard/Android/data/${packageName}/files`;
    const envFile = `${envDir}/sdk_env`;
    const steps = [];

    const packageStep = await runAdbStep(
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
      steps.push(await runAdbStep('创建环境配置目录', ['-s', serial, 'shell', 'mkdir', '-p', envDir], 5000));
      steps.push(await runAdbStep('写入环境配置', ['-s', serial, 'shell', `printf '%s' '${rawEnvironment}' > ${envFile}`], 5000));
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
          error: directWriteError.message,
        });
        steps.push(await runAdbStep('推送临时环境文件', ['-s', serial, 'push', localEnvFile, remoteTempFile], 10000));
        steps.push(await runAdbStep(
          '使用应用身份写入环境配置',
          ['-s', serial, 'shell', `run-as ${packageName} sh -c "mkdir -p ${envDir} && cp ${remoteTempFile} ${envFile}"`],
          10000
        ));
      } finally {
        fs.rmSync(localEnvFile, { force: true });
        steps.push(await runAdbStep('清理临时环境文件', ['-s', serial, 'shell', 'rm', '-f', remoteTempFile], 5000, { optional: true }));
      }
    }

    const verifyStep = await runAdbStep('校验环境配置', ['-s', serial, 'shell', 'cat', envFile], 5000);
    steps.push(verifyStep);
    const verifiedEnvironment = verifyStep.stdout.trim();

    if (verifiedEnvironment !== rawEnvironment) {
      throw new Error(`校验环境配置失败：期望 ${rawEnvironment}，实际 ${verifiedEnvironment || '空'}`);
    }

    steps.push(await runAdbStep('重启目标应用', ['-s', serial, 'shell', 'am', 'force-stop', packageName], 5000));
    steps.push(await runAdbStep(
      '拉起目标应用',
      ['-s', serial, 'shell', `monkey -p ${packageName} -c android.intent.category.LAUNCHER 1 >/dev/null 2>&1 || true`],
      10000,
      { optional: true }
    ));

    return {
      success: true,
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
      error: diagnosticError.message,
      errorCode: diagnosticError.errorCode,
      errorType: diagnosticError.errorType,
      serial: diagnosticError.serial || serial,
      packageName: diagnosticError.packageName || packageName,
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
});

function parsePackageVersion(output) {
  const versionName = output.match(/versionName=([^\s]+)/)?.[1]
    || output.match(/"versionName"\s*:\s*"([^"]+)"/)?.[1];
  const versionCode = output.match(/versionCode=(\d+)/)?.[1]
    || output.match(/"versionCode"\s*:\s*(\d+)/)?.[1];

  if (versionName && versionCode) {
    return `${versionName} (${versionCode})`;
  }

  return versionName || versionCode || '';
}

ipcMain.handle('adb:get-package-version', async (_event, payload = {}) => {
  const { serial, packageName } = payload;

  if (!serial || !packageName || !/^[A-Za-z0-9._]+$/.test(packageName)) {
    return { version: '' };
  }

  try {
    const output = await runAdb(['-s', serial, 'shell', `dumpsys package ${packageName} | grep version`]);

    return {
      version: parsePackageVersion(output),
    };
  } catch (error) {
    return {
      version: '',
      error: error.message,
    };
  }
});

ipcMain.handle('adb:launch-test-page', async (_event, payload = {}) => {
  const { serial, packageName } = payload;

  try {
    await launchPhoneTestPage(serial, packageName);

    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      errorCode: error.errorCode || error.code || 'LAUNCH_TEST_PAGE_FAILED',
      errorType: error.errorType || 'device-operation',
      recoveryActions: Array.isArray(error.recoveryActions) ? error.recoveryActions : [],
      diagnostics: error.diagnostics || null,
    };
  }
});

ipcMain.handle('adb:logcat-start', async (_event, payload = {}) => {
  const { serial, deviceType = 'device' } = payload;

  if (!serial) {
    return {
      success: false,
      error: '请先选择设备',
    };
  }

  const sessionId = `${deviceType}:${serial}`;

  stopLogcatSession(sessionId);

  try {
    const filePath = createLogcatPath(deviceType, serial);
    const stream = fs.createWriteStream(filePath, { flags: 'w' });
    const logcatProcess = spawn(getAdbPath(), ['-s', serial, 'logcat', '-v', 'threadtime'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const session = {
      process: logcatProcess,
      stream,
      filePath,
      serial,
      deviceType,
      stopping: false,
      stdoutHandler: null,
      stderrHandler: null,
    };

    session.stdoutHandler = (chunk) => {
      safeWriteStream(stream, chunk);
    };
    session.stderrHandler = (chunk) => {
      safeWriteStream(stream, chunk);
    };
    logcatProcess.stdout.on('data', session.stdoutHandler);
    logcatProcess.stderr.on('data', session.stderrHandler);
    logcatProcess.once('exit', (code, signal) => {
      safeEndWriteStream(stream);
      logcatSessions.delete(sessionId);
      if (!session.stopping) {
        notifyLogcatState({
          serial,
          deviceType,
          running: false,
          filePath,
          reason: 'exit',
          code,
          signal,
        });
      }
    });

    logcatSessions.set(sessionId, session);

    return {
      success: true,
      filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('adb:logcat-stop', async (_event, payload = {}) => {
  const { serial, deviceType = 'device' } = payload;
  const sessionId = `${deviceType}:${serial}`;
  const session = stopLogcatSession(sessionId);

  if (!session) {
    return {
      success: false,
      error: '当前设备没有正在采集的日志',
    };
  }

  return {
    success: true,
    filePath: session.filePath,
  };
});

ipcMain.handle('adb:scrcpy-start', async (_event, payload = {}) => {
  const { serial, deviceType = 'phone' } = payload;

  if (!serial) {
    return {
      success: false,
      missingScrcpy: false,
      error: '请先选择设备',
    };
  }

  try {
    const existing = manualScrcpySessions.get(serial);
    if (existing && !existing.exited && !existing.startFailed) {
      return {
        success: true,
        reused: true,
        scrcpyPath: existing.scrcpyPath,
      };
    }
    const session = await startWorkflowScreenMirror(deviceType, serial, {
      taskId: `manual-ui-${serial}`,
    });
    if (session.startFailed) {
      return {
        success: false,
        missingScrcpy: !session.scrcpyPath,
        error: session.error,
        recoveryActions: session.recoveryActions || [],
      };
    }
    manualScrcpySessions.set(serial, session);
    session.process?.once('exit', () => {
      if (manualScrcpySessions.get(serial) === session) {
        manualScrcpySessions.delete(serial);
      }
    });

    return {
      success: true,
      reused: false,
      scrcpyPath: session.scrcpyPath,
    };
  } catch (error) {
    return {
      success: false,
      missingScrcpy: false,
      error: error.message,
    };
  }
});

ipcMain.handle('scrcpy:check', async () => {
  const scrcpyPath = await getScrcpyPath();

  if (!scrcpyPath) {
    return {
      success: false,
      missingScrcpy: true,
      error: app.isPackaged ? '当前安装包缺少内置投屏运行时，请重新安装完整 solopi-desktop' : '开发环境未准备 scrcpy 运行时',
      recoveryActions: app.isPackaged
        ? ['重新下载并安装完整 solopi-desktop 安装包。']
        : ['运行 npm run media:prepare，或显式配置 SCRCPY_PATH 与 SCRCPY_SERVER_PATH。'],
    };
  }

  return {
    success: true,
    scrcpyPath,
  };
});

async function stopWorkflowRequest(requestId) {
  workflowCancelRequests.add(requestId);
  for (const cancel of workflowCommandCancels.get(requestId) || []) cancel();
  const runtime = activeWorkflowRuntimes.get(requestId);

  if (runtime) {
    runtime.logSessions?.forEach(stopWorkflowLogCapture);
    releaseOwnedLogAssertions(runtime.logAssertOwners, logAssertStreams, stopLogAssertStream);
    await Promise.all([
      ...(runtime.screenRecordSessions || []).map((session) => stopScrcpySession(session, { graceSignal: 'SIGINT' })),
      ...(runtime.screenMirrorSessions || []).map(stopWorkflowScreenMirror),
    ]);
  }

  return {
    requestId,
    runtimeFound: Boolean(runtime),
  };
}

ipcMain.handle('workflow:stop', async (_event, payload = {}) => {
  const requestId = String(payload.requestId || '').trim();

  if (!requestId) {
    return {
      success: false,
      error: 'Missing requestId',
    };
  }

  const stopResult = await stopWorkflowRequest(requestId);
  return { success: true, ...stopResult };
});

function normalizeWorkflowEdge(edge) {
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

function normalizeWorkflowEdges(edges = [], steps = []) {
  if (!Array.isArray(edges)) {
    return [];
  }

  const stepIds = new Set((steps || []).map((step) => String(step?.id || '')).filter(Boolean));
  return edges
    .map(normalizeWorkflowEdge)
    .filter((edge) => edge && (!stepIds.size || (stepIds.has(edge.source) && stepIds.has(edge.target))));
}

function getWorkflowCaseEdges(payload = {}, testCase = {}, steps = []) {
  if (Array.isArray(payload.edges)) {
    return normalizeWorkflowEdges(payload.edges, steps);
  }
  const caseId = String(testCase.id || '');
  const caseEdges = payload.caseEdges && typeof payload.caseEdges === 'object' ? payload.caseEdges : {};
  if (caseId && Array.isArray(caseEdges[caseId])) {
    return normalizeWorkflowEdges(caseEdges[caseId], steps);
  }

  if (Array.isArray(testCase.edges)) {
    return normalizeWorkflowEdges(testCase.edges, steps);
  }

  return [];
}

function isWorkflowLogAssertStep(step = {}, context = {}) {
  if (step.type !== 'component') {
    return false;
  }

  const component = context.components?.[step.componentId];
  return ['tts_assert', 'json_assert', 'llm_assert'].includes(component?.kind);
}

function getWorkflowLogAssertSerial(step = {}, context = {}) {
  if (!isWorkflowLogAssertStep(step, context)) {
    return '';
  }

  if (step.type === 'component') {
    const component = context.components?.[step.componentId];
    return component ? getComponentSerial(component, context, step) : '';
  }

  return getWorkflowSerial(step, context);
}

function getWorkflowLogAssertCheckpoint(context = {}, serial = '', clearBeforeStart) {
  if (!serial) {
    return 0;
  }

  const owner = context.logAssertStreamsBySerial?.[serial];
  if (owner?.journalError) throw Object.assign(owner.journalError, { code: 'LOG_EVIDENCE_UNAVAILABLE', errorType: 'log-infrastructure' });
  if (owner && (owner.exited || logAssertStreams.get(serial) !== owner || owner.process.killed)) {
    throw Object.assign(new Error('日志流在本轮执行期间中断或被替换，不能使用历史日志继续断言。'), { code: 'LOG_EVIDENCE_UNAVAILABLE', errorType: 'log-infrastructure' });
  }
  // Clearing is a per-assertion read boundary, never destructive to shared log capture.
  if (clearBeforeStart === true) return getCurrentLogAssertSequence(serial);
  const checkpoint = Number(clearBeforeStart === false
    ? context.logAssertRoundCheckpointsBySerial?.[serial]
    : context.logAssertCheckpointsBySerial?.[serial]);
  return Number.isFinite(checkpoint) && checkpoint >= 0 ? checkpoint : 0;
}

function updateWorkflowLogAssertCheckpoint(context = {}, serial = '') {
  if (!serial) {
    return;
  }

  if (!context.logAssertCheckpointsBySerial) {
    context.logAssertCheckpointsBySerial = {};
  }

  context.logAssertCheckpointsBySerial[serial] = getCurrentLogAssertSequence(serial);
}

function updateWorkflowLogAssertCheckpointForStep(context = {}, step = {}) {
  // Consecutive assertions share the triggering action window; assertion completion is not a new action.
  if (context.logAssertStreamsBySerial) return;
  if (!isWorkflowLogAssertStep(step, context)) {
    return;
  }

  try {
    updateWorkflowLogAssertCheckpoint(context, getWorkflowLogAssertSerial(step, context));
  } catch (_error) {
    // Let the original step error surface; checkpoint refresh is only bookkeeping.
  }
}

async function establishWorkflowLogBoundary(serial) {
  const marker = `solopi-desktop-boundary-${crypto.randomBytes(16).toString('hex')}`;
  const command = ['-s', serial, 'shell', 'log', '-p', 'i', '-t', 'LensWiperBoundary', marker];
  const diagnostics = { serial, marker, command, phase: 'listener', sent: false, received: false, startedAt: new Date().toISOString() };
  let stream;
  try {
    stream = await prepareLogAssertStream(serial, false);
    if (stream.journalError) throw stream.journalError;
    diagnostics.phase = 'send';
    await createWorkflowLogWait(stream, (resolve, reject, register) => {
      let received = false;
      register({
        matcher: line => {
          const match = String(line).match(/^\d{2}-\d{2}\s+\d{2}:\d{2}:\d{2}\.\d+\s+\d+\s+\d+\s+I\s+LensWiperBoundary\s*:\s*(\S+)\s*$/);
          return Boolean(match && match[1] === marker);
        },
        resolve: () => { received = true; diagnostics.received = true; if (diagnostics.sent) resolve(); },
        reject,
        timer: setTimeout(() => reject(new Error('日志标记发送或接收超时')), 5000),
      });
      runAdb(command, 5000).then(stdout => {
        diagnostics.sent = true;
        diagnostics.stdout = stdout;
        diagnostics.exitCode = 0;
        diagnostics.phase = 'receive';
        if (received) resolve();
      }, reject);
    });
    if (logAssertStreams.get(serial) !== stream || stream.process.killed) throw new Error('日志监听已被替换或停止');
    return Number(stream.lineSequence || 0);
  } catch (error) {
    if (error.code === 'WORKFLOW_STOPPED') throw error;
    const code = diagnostics.sent ? 'WORKFLOW_LOG_BOUNDARY_RECEIVE_FAILED' : 'WORKFLOW_LOG_BOUNDARY_SEND_FAILED';
    diagnostics.finishedAt = new Date().toISOString();
    diagnostics.listenerError = stream?.lastError || '';
    diagnostics.exitCode = error.exitCode ?? diagnostics.exitCode ?? null;
    diagnostics.signal = error.signal || null;
    diagnostics.stderr = error.stderr || '';
    diagnostics.stdout = error.stdout || diagnostics.stdout || '';
    diagnostics.cause = error.message;
    throw Object.assign(new Error(`无法建立日志轮次边界（设备 ${serial}，阶段 ${diagnostics.phase}）：${error.message}。本轮日志边界未确认。`), {
      code, errorCode: code, errorType: 'log-infrastructure', diagnostics: { ...diagnostics },
      command: command.join(' '), exitCode: diagnostics.exitCode, signal: diagnostics.signal,
      timeoutMs: 5000, stdout: diagnostics.stdout, stderr: diagnostics.stderr,
      recoveryActions: ['检查报告中标记发送结果与日志监听错误，不能仅凭此错误判断设备离线。'],
    });
  }
}

async function prepareWorkflowActionLogBoundary(context, step) {
  const kind = step.type === 'component' ? context.components?.[step.componentId]?.kind : step.type;
  const isAction = step.type === 'component'
    ? !isWorkflowLogAssertStep(step, context) && kind !== 'mobile_ui_assert'
    : ['launch_test_page', 'broadcast_scene', 'send_audio', 'push_audio', 'debug_forward', 'http_request'].includes(kind);
  if (!isAction) return;
  if (context.sharedLogSessions) {
    for (const [serial, session] of Object.entries(context.sharedLogSessions)) {
      context.logAssertCheckpointsBySerial[serial] = session.lineSequence;
      for (const range of context.logReadRanges) if (range.serial === serial && range.scope === 'action' && range.endSequence === undefined) range.endSequence = session.lineSequence;
      context.logReadRanges.push({ scope: 'action', stepId: step.id, serial, startSequence: session.lineSequence, at: new Date().toISOString() });
    }
    return;
  }
  for (const serial of Object.keys(context.logAssertCheckpointsBySerial || {})) {
    getWorkflowLogAssertCheckpoint(context, serial); // Fail closed if the previous stream was replaced.
    const sequence = await establishWorkflowLogBoundary(serial);
    context.logAssertCheckpointsBySerial[serial] = sequence;
  }
}

async function initializeWorkflowLogAssertCheckpoints(context = {}, steps = []) {
  const serials = Array.from(new Set(
    steps
      .filter((step) => isWorkflowLogAssertStep(step, context))
      .map((step) => getWorkflowLogAssertSerial(step, context))
      .filter(Boolean)
  ));

  context.logAssertCheckpointsBySerial = context.logAssertCheckpointsBySerial || {};
  context.logAssertStreamsBySerial = {};
  context.logAssertRoundCheckpointsBySerial = {};
  if (context.sharedLogSessions) {
    for (const serial of serials) {
      const session = context.sharedLogSessions[serial];
      if (!session) throw new Error(`任务缺少设备 ${serial} 的共享日志流`);
      context.logAssertStreamsBySerial[serial] = session;
      context.logAssertCheckpointsBySerial[serial] = session.lineSequence;
      context.logAssertRoundCheckpointsBySerial[serial] = session.lineSequence;
      context.logReadRanges.push({ scope: 'round', serial, startSequence: session.lineSequence, at: new Date().toISOString() });
      if (!session.journalError && !session.exited) {
        try { session.journal.reset(); }
        catch (error) { session.journalError = error; session.artifact && (session.artifact.error = error.message); }
      }
    }
    return;
  }

  const initialized = await Promise.allSettled(serials.map(async (serial) => {
    context.logAssertStreamsBySerial[serial] = await prepareLogAssertStream(serial, false);
    context.logAssertCheckpointsBySerial[serial] = await establishWorkflowLogBoundary(serial);
    context.logAssertRoundCheckpointsBySerial[serial] = context.logAssertCheckpointsBySerial[serial];
    logAssertStreams.get(serial)?.journal?.reset();
  }));
  const failure = initialized.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
}

function orderWorkflowStepsByEdges(steps = [], edges = []) {
  if (!Array.isArray(steps) || steps.length <= 1 || !Array.isArray(edges) || edges.length === 0) {
    return steps;
  }

  const stepMap = new Map(steps.map((step) => [String(step.id || ''), step]).filter(([id]) => id));
  const outgoing = new Map();
  normalizeWorkflowEdges(edges, steps).forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge.target]);
  });

  if (outgoing.size === 0) {
    return steps;
  }

  const startStep = steps.find((step) => step.type === 'start') || steps[0];
  if (startStep?.id) {
    const orderedIds = [String(startStep.id)];
    const visited = new Set(orderedIds);
    let currentId = String(startStep.id);

    while ((outgoing.get(currentId) || []).length > 0) {
      const nextId = (outgoing.get(currentId) || []).find((candidate) => !visited.has(candidate));
      if (!nextId) {
        break;
      }

      orderedIds.push(nextId);
      visited.add(nextId);
      currentId = nextId;
    }

    if (orderedIds.length > 1) {
      const ordered = orderedIds.map((id) => stepMap.get(id)).filter(Boolean);
      const orderedSet = new Set(orderedIds);
      return ordered.concat(steps.filter((step) => !orderedSet.has(String(step.id || ''))));
    }
  }

  return steps;
}

function selectWorkflowNextStep(step, output, stepMap, outgoing) {
  const candidates = outgoing.get(String(step?.id || '')) || [];
  if (!candidates.length) return null;
  const branch = output?.branch !== undefined
    ? output.branch
    : (output?.meta?.branch !== undefined ? output.meta.branch : '');
  const normalizedBranch = String(branch === undefined || branch === null ? '' : branch).trim().toLowerCase();
  const getEdgeHandle = (edge) => String(
    edge?.sourceHandle
    ?? edge?.sourcehandle
    ?? edge?.handle
    ?? edge?.condition
    ?? edge?.data?.sourceHandle
    ?? edge?.data?.handle
    ?? ''
  ).trim().toLowerCase();
  const preferred = normalizedBranch
    ? candidates.find((edge) => getEdgeHandle(edge) === normalizedBranch)
    : null;
  const edge = preferred || candidates.find((item) => !item.handle && !item.sourceHandle && !item.condition) || candidates[0];
  return edge ? stepMap.get(edge.target) || null : null;
}

function getWorkflowCaseComponents(components = [], caseComponents = []) {
  const merged = new Map();
  for (const list of [components, caseComponents]) {
    for (const component of Array.isArray(list) ? list : []) {
      if (!component?.id) continue;
      const base = merged.get(component.id);
      const params = new Map((base?.params || []).map((param) => [param.key, param]));
      for (const param of component.params || []) params.set(param.key, param);
      merged.set(component.id, { ...base, ...component, params: [...params.values()] });
    }
  }
  return Object.fromEntries(merged);
}

async function runWorkflowCase(payload = {}, options = {}) {
  const { testCase, components = [], requestId = '', disableScreenMirror = false, startConfigOverride = null, llmProviders = [], selectedLlmProviderId = '', ttsProvider = null } = payload;

  if (!testCase || !Array.isArray(testCase.steps)) {
    return {
      success: false,
      results: [],
      error: '工作流用例格式不正确',
    };
  }

  assertImportReviewed(testCase);
  const stepsWithStartOverride = applyWorkflowStartConfigOverride(testCase.steps, startConfigOverride);
  const rawCaseEdges = Array.isArray(payload.edges)
    ? payload.edges
    : (Array.isArray(payload.caseEdges?.[testCase.id]) ? payload.caseEdges[testCase.id] : (Array.isArray(testCase.edges) ? testCase.edges : []));
  const stepIds = new Set(stepsWithStartOverride.map((step) => String(step?.id || '')).filter(Boolean));
  const rawEdgeError = rawCaseEdges.find((edge) => {
    const source = String(edge?.source || edge?.from || '').trim();
    const target = String(edge?.target || edge?.to || '').trim();
    return !source || !target || !stepIds.has(source) || !stepIds.has(target);
  });
  if (rawEdgeError) {
    const source = String(rawEdgeError?.source || rawEdgeError?.from || '').trim();
    const target = String(rawEdgeError?.target || rawEdgeError?.to || '').trim();
    return {
      success: false,
      results: [{
        stepId: '__workflow__',
        stepName: '执行图结构校验',
        status: 'failed',
        errorCode: 'CASE_EDGE_ENDPOINT_MISSING',
        error: `边引用了不存在的步骤：${source} -> ${target}`,
        diagnostics: { edge: rawEdgeError },
      }],
      graphMode: rawCaseEdges.length > 0,
      plannedPath: stepsWithStartOverride.map((step) => String(step?.id || '')).filter(Boolean),
      executedPath: [],
      reachedEnd: false,
      terminationReason: 'CASE_EDGE_ENDPOINT_MISSING',
      failedEdge: { source, target },
      duplicateStepId: '',
      devices: payload.devices || {},
      edges: rawCaseEdges,
      artifacts: null,
      errorCode: 'CASE_EDGE_ENDPOINT_MISSING',
      error: `边引用了不存在的步骤：${source} -> ${target}`,
    };
  }
  const executionEdges = getWorkflowCaseEdges(payload, testCase, stepsWithStartOverride);
  const effectiveSteps = orderWorkflowStepsByEdges(stepsWithStartOverride, executionEdges);
  const stepMap = new Map(effectiveSteps.map((step) => [String(step.id || ''), step]).filter(([id]) => id));
  const outgoing = new Map();
  normalizeWorkflowEdges(executionEdges, effectiveSteps).forEach((edge) => {
    outgoing.set(edge.source, [...(outgoing.get(edge.source) || []), edge]);
  });
  const context = {
    defaults: testCase.defaults || {},
    variables: testCase.variables || {},
    assetBaseDir: String(testCase.assetBaseDir || payload.assetBaseDir || require('./case-assets').assetBaseDirectory(readWorkflowState() || {},testCase)).trim(),
    llmProviders,
    selectedLlmProviderId,
    ttsProvider,
    components: getWorkflowCaseComponents(components, testCase.components),
    pushedAudioFiles: [],
    pushedImageFiles: [],
    generatedTtsAudioFiles: [],
    cleanupAudioFiles: shouldCleanupWorkflowAudioFiles(effectiveSteps),
    cleanupImageFiles: shouldCleanupWorkflowImageFiles(effectiveSteps),
    nodeOutputs: {},
  };
  const devices = {
    ...payload.devices,
    phone: { ...payload.devices?.phone, serial: context.defaults.phoneSerial || '', packageName: context.defaults.phonePackage || '' },
    glasses: { ...payload.devices?.glasses, serial: context.defaults.glassesSerial || '', packageName: context.defaults.glassesPackage || '' },
  };
  const results = [];
  const runDir = createWorkflowRunDir(testCase);
  const evidenceOptions = getWorkflowEvidenceOptions(effectiveSteps, { disableScreenMirror, startConfigOverride });
  context.sharedLogSessions = options.sharedLogSessions;
  context.logReadRanges = [];
  const sharedRangeStarts = Object.fromEntries(Object.entries(options.sharedLogSessions || {}).map(([serial, session]) => [serial, session.lineSequence]));
  const logSessions = options.sharedLogSessions ? [] : (await Promise.all([
    evidenceOptions.capturePhoneLog ? startWorkflowLogCapture(runDir, 'phone', context.defaults.phoneSerial, { clearBeforeStart: !payload.stress, sinceNow: Boolean(payload.stress) }) : null,
    evidenceOptions.captureGlassesLog ? startWorkflowLogCapture(runDir, 'glasses', context.defaults.glassesSerial, { clearBeforeStart: !payload.stress, sinceNow: Boolean(payload.stress) }) : null,
  ])).filter(Boolean);
  if (!context.sharedLogSessions) context.sharedLogSessions = Object.fromEntries(logSessions.map(session => [session.serial, session]));
  try {
    await workflowCommandScope.run(requestId, () => initializeWorkflowLogAssertCheckpoints(context, effectiveSteps));
  } catch (error) {
    logSessions.forEach(stopWorkflowLogCapture);
    for (const [serial, owner] of Object.entries(context.logAssertStreamsBySerial || {})) {
      if (!owner.taskOwned && logAssertStreams.get(serial) === owner) stopLogAssertStream(serial);
    }
    throw error;
  }
  const screenRecordSessions = (await Promise.all([
    evidenceOptions.recordPhoneScreen ? startWorkflowScreenRecord(runDir, 'phone', context.defaults.phoneSerial, { showWindow: evidenceOptions.showPhoneScreen }) : null,
    evidenceOptions.recordGlassesScreen ? startWorkflowScreenRecord(runDir, 'glasses', context.defaults.glassesSerial, { showWindow: evidenceOptions.showGlassesScreen }) : null,
  ])).filter(Boolean);
  const screenMirrorSessions = (await Promise.all([
    evidenceOptions.showPhoneScreen
      ? startWorkflowScreenMirror('phone', context.defaults.phoneSerial, { runDir })
      : null,
    evidenceOptions.showGlassesScreen
      ? startWorkflowScreenMirror('glasses', context.defaults.glassesSerial, { runDir })
      : null,
  ])).filter(Boolean);
  const runtimeTrackingId = requestId || `ui-runtime-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`;
  activeWorkflowRuntimes.set(runtimeTrackingId, {
    logSessions,
    logAssertOwners: context.logAssertStreamsBySerial,
    screenRecordSessions,
    screenMirrorSessions,
  });
  context.runDir = runDir;
  context.screenshots = [];
  const workflowStartedAtMs = Date.now();
  const workflowSource = String(requestId || '').startsWith('cli') || String(payload.taskId || '').startsWith('cli') || cliBackgroundMode ? 'cli' : 'ui';
  trackGlassBoxUsage('workflow_case_start', {
    source: workflowSource,
    stepCount: effectiveSteps.length,
  });
  const artifacts = {
    runDir,
    logs: [],
    recordings: [],
    screenMirrors: screenMirrorSessions.map(persistScrcpyMirrorDiagnostic),
    screenshots: [],
    pushedAudioFiles: [],
    pushedImageFiles: [],
    generatedTtsAudioFiles: [],
    cleanup: [],
    imageCleanup: [],
  };
  let finalResponse = null;
  const sendProgress = (result) => {
    if (requestId && options.progressSender) {
      options.progressSender.send('workflow:progress', {
        requestId,
        result,
        results: [...results],
      });
    }
    if (typeof options.onProgress === 'function') {
      options.onProgress({
        requestId,
        result,
        results: [...results],
      });
    }
  };

  try {
    const graphMode = executionEdges.length > 0;
    let currentStep = effectiveSteps.find((step) => step?.type === 'start') || effectiveSteps[0] || null;
    let linearIndex = Math.max(0, effectiveSteps.indexOf(currentStep));
    const visited = new Set();
    const executedPath = [];
    let reachedEnd = false;
    let terminationReason = 'not_started';
    let failedEdge = null;
    let duplicateStepId = '';
    let structuralError = null;
    const executionSummary = () => ({
      graphMode,
      plannedPath: effectiveSteps.map((item) => String(item?.id || '')).filter(Boolean),
      executedPath: [...executedPath],
      reachedEnd,
      terminationReason,
      failedEdge,
      duplicateStepId,
    });
    const addStructuralFailure = (code, message, step = currentStep, details = {}) => {
      structuralError = { code, message, details };
      terminationReason = code;
      const result = {
        stepId: '__workflow__',
        stepName: '执行图结构校验',
        status: 'failed',
        startedAt: new Date().toISOString(),
        completedAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        error: message,
        errorCode: code,
        diagnostics: { ...(details || {}), stepId: step?.id || null },
      };
      results.push(result);
      sendProgress(result);
    };
    while (currentStep) {
      const step = currentStep;
      const stepId = String(step?.id || '');
      if (!stepId || visited.has(stepId)) {
        duplicateStepId = stepId;
        addStructuralFailure('WORKFLOW_CYCLE_DETECTED', `执行图检测到重复节点或环：${stepId || '(empty)'}`, step, { duplicateStepId: stepId });
        break;
      }
      visited.add(stepId);
      const startedAt = new Date().toISOString();

      try {
        if (isWorkflowCanceled(requestId)) {
          throw createWorkflowStoppedError();
        }

        await options.beforeStep?.(step);
        if (isWorkflowCanceled(requestId)) throw createWorkflowStoppedError();
        sendProgress({ stepId: step.id, stepName: step.name, status: 'running', startedAt });
        executedPath.push(stepId);
        terminationReason = 'running';
        const output = await workflowCommandScope.run(requestId, async () => {
          await prepareWorkflowActionLogBoundary(context, step);
          return executeWorkflowAssertionStep(step, context, () => executeWorkflowStep(step, context));
        });
        const completedAt = output.completedAt || new Date().toISOString();
        updateWorkflowLogAssertCheckpointForStep(context, step);
        if (shouldApplyPostDelay(step)) {
          await sleepWorkflow(Number(step.postDelayMs || 0), requestId);
        }
        const endedAt = new Date().toISOString();

        const result = {
          stepId: step.id,
          stepName: step.name,
          status: 'success',
          startedAt,
          completedAt,
          endedAt,
          command: output.command,
          stdout: output.stdout,
          stderr: output.stderr,
          meta: output.meta,
        };

        results.push(result);
        sendProgress(result);
        context.nodeOutputs[step.id] = {
          ...(output.meta?.nodeOutput || {}),
          stdout: output.stdout || '',
          stderr: output.stderr || '',
          success: output.meta?.nodeOutput?.success ?? (output.success !== false),
        };
        if (output.branch === 'error' || output.meta?.branch === 'error') {
          context.lastNodeError = {
            message: output.warning?.message || output.stderr || 'ADB command failed',
            diagnostics: output.meta,
          };
        }
        if (step.type === 'end') {
          reachedEnd = true;
          terminationReason = 'reached_end';
          currentStep = null;
        } else if (graphMode) {
          const nextStep = selectWorkflowNextStep(step, output, stepMap, outgoing);
          if (!nextStep) {
            failedEdge = { source: stepId, target: null };
            addStructuralFailure('WORKFLOW_PATH_TERMINATED_EARLY', `节点 ${stepId} 执行后没有合法后继，执行图提前终止。`, step, { failedEdge });
            currentStep = null;
          } else {
            currentStep = nextStep;
          }
        } else {
          linearIndex += 1;
          currentStep = effectiveSteps[linearIndex] || null;
          if (!currentStep) terminationReason = 'legacy_linear_complete';
        }
      } catch (error) {
        const completedAt = error.completedAt || new Date().toISOString();
        const endedAt = completedAt;
        const stopped = error?.code === 'WORKFLOW_STOPPED' || isWorkflowCanceled(requestId);
        updateWorkflowLogAssertCheckpointForStep(context, step);

        const result = {
          stepId: step.id,
          stepName: step.name,
          status: stopped ? 'stopped' : 'failed',
          startedAt,
          completedAt,
          endedAt,
          error: error.message,
          errorCode: error.errorCode || error.code || '',
          errorType: error.errorType || '',
          recoveryActions: Array.isArray(error.recoveryActions) ? error.recoveryActions : [],
          diagnostics: error.diagnostics || error.meta?.diagnostics || undefined,
          command: error.command,
          exitCode: error.exitCode ?? null,
          signal: error.signal ?? null,
          timeoutMs: error.timeoutMs ?? null,
          stdout: error.stdout,
          stderr: error.stderr,
          meta: error.meta,
          filePushed: Boolean(error.filePushed),
          triggerSucceeded: Boolean(error.triggerSucceeded),
          audioArtifact: error.audioArtifact,
        };

        results.push(result);
        sendProgress(result);

        if (stopped) {
          terminationReason = 'stopped';
          finalResponse = {
            success: false,
            stopped: true,
            results,
            error: error.message,
            errorCode: error.errorCode || error.code || '',
            errorType: error.errorType || '',
            recoveryActions: Array.isArray(error.recoveryActions) ? error.recoveryActions : [],
            diagnostics: error.diagnostics || error.meta?.diagnostics || undefined,
            devices,
            edges: executionEdges,
            artifacts,
            ...executionSummary(),
          };
          return finalResponse;
        }

        // Explicit/default assertion barriers take precedence over legacy continue-on-error.
        const blockingAssertionFailed = error.meta?.assertion?.blocking === true && error.meta.assertion.passed === false;
        if (blockingAssertionFailed || !step.continueOnError || String(error.errorCode || error.code || '').startsWith('WORKFLOW_LOG_BOUNDARY_')) {
          terminationReason = executedPath.includes(stepId) ? 'step_failed' : 'before_step_failed';
          finalResponse = {
            success: false,
            results,
            error: error.message,
            errorCode: error.errorCode || error.code || '',
            errorType: error.errorType || '',
            recoveryActions: Array.isArray(error.recoveryActions) ? error.recoveryActions : [],
            diagnostics: error.diagnostics || error.meta?.diagnostics || undefined,
            devices,
            edges: executionEdges,
            artifacts,
            ...executionSummary(),
          };
          return finalResponse;
        }

        if (graphMode) {
          const nextStep = selectWorkflowNextStep(step, { branch: error.branch || 'error' }, stepMap, outgoing);
          if (!nextStep) {
            failedEdge = { source: stepId, target: null, sourceHandle: error.branch || 'error' };
            addStructuralFailure('WORKFLOW_PATH_TERMINATED_EARLY', `失败节点 ${stepId} 没有合法 error 后继。`, step, { failedEdge });
            currentStep = null;
          } else {
            currentStep = nextStep;
          }
        } else {
          linearIndex += 1;
          currentStep = effectiveSteps[linearIndex] || null;
          if (!currentStep) terminationReason = 'legacy_linear_complete';
        }
      }
    }

    if (terminationReason === 'not_started') terminationReason = 'workflow_empty';
    const legalTermination = graphMode ? reachedEnd : (reachedEnd || terminationReason === 'legacy_linear_complete');
    finalResponse = {
      success: !structuralError && legalTermination && results.length > 0 && results.every((result) => result.status === 'success'),
      results,
      devices,
      edges: executionEdges,
      artifacts,
      ...executionSummary(),
    };
    return finalResponse;
  } finally {
    if (finalResponse && typeof options.onTerminal === 'function') {
      try {
        await options.onTerminal({
          requestId,
          result: finalResponse,
          results: [...(finalResponse.results || results)],
        });
      } catch (error) {
        console.warn(`[workflow-task] case terminal notification failed: ${error.message}`);
      }
    }
    trackGlassBoxUsage('workflow_case_finish', {
      source: workflowSource,
      success: Boolean(finalResponse?.success),
      stopped: Boolean(finalResponse?.stopped),
      stepCount: effectiveSteps.length,
      durationMs: Date.now() - workflowStartedAtMs,
      errorCode: finalResponse?.success ? '' : 'workflow_case_failed',
    });
    try {
      artifacts.pushedAudioFiles = [...(context.pushedAudioFiles || [])];
      artifacts.pushedImageFiles = [...(context.pushedImageFiles || [])];
      artifacts.generatedTtsAudioFiles = [...(context.generatedTtsAudioFiles || [])];
      artifacts.cleanup = context.cleanupAudioFiles
        ? await Promise.all((context.pushedAudioFiles || []).map(async (item) => {
            try {
              await runCommand(getAdbPath(), ['-s', item.serial, 'shell', 'rm', '-f', item.remotePath], 5000);
              return {
                ...item,
                success: true,
              };
            } catch (_error) {
              return {
                ...item,
                success: false,
                error: _error.message,
              };
            }
          }))
        : (context.pushedAudioFiles || []).map((item) => ({
            ...item,
            success: false,
            skipped: true,
            error: '结束节点已关闭音频清理',
          }));
      artifacts.imageCleanup = context.cleanupImageFiles
        ? await Promise.all((context.pushedImageFiles || []).map(async (item) => {
            try {
              await runCommand(getAdbPath(), ['-s', item.serial, 'shell', 'rm', '-f', item.remotePath], 5000);
              return {
                ...item,
                success: true,
              };
            } catch (_error) {
              return {
                ...item,
                success: false,
                error: _error.message,
              };
            }
          }))
        : (context.pushedImageFiles || []).map((item) => ({
            ...item,
            success: false,
            skipped: true,
            error: '结束节点已关闭图片清理',
          }));
      artifacts.recordings = (await Promise.all(screenRecordSessions.map(stopWorkflowScreenRecord))).filter(Boolean);
      artifacts.screenMirrors = (await Promise.all(screenMirrorSessions.map(stopWorkflowScreenMirror))).filter(Boolean);
      artifacts.screenshots = [...(context.screenshots || [])];
      artifacts.logs = options.sharedLogSessions
        ? Object.entries(options.sharedLogSessions).map(([serial, session]) => ({ ...session.artifact, sharedTaskLog: true, startSequence: sharedRangeStarts[serial], endSequence: session.lineSequence }))
        : logSessions.map(stopWorkflowLogCapture).filter(Boolean);
      artifacts.logReadRanges = context.logReadRanges.map(range => ({ ...range, endSequence: range.endSequence ?? context.sharedLogSessions?.[range.serial]?.lineSequence }));
      artifacts.evidenceReady = true;
      artifacts.finalizedAt = new Date().toISOString();
    } finally {
      releaseOwnedLogAssertions(context.logAssertStreamsBySerial, logAssertStreams, stopLogAssertStream);
      activeWorkflowRuntimes.delete(runtimeTrackingId);
      if (requestId) {
        workflowCancelRequests.delete(requestId);
      }
    }
  }
}

function createWorkflowEdgesFromSteps(steps = []) {
  if (!Array.isArray(steps) || steps.length <= 1) {
    return [];
  }

  return steps.slice(0, -1).map((step, index) => ({
    id: `${step.id || `step-${index}`}-${steps[index + 1]?.id || `step-${index + 1}`}`,
    source: step.id,
    target: steps[index + 1]?.id,
  })).filter((edge) => edge.source && edge.target);
}

function getWorkflowTaskRecordingDevices(cases = [], payload = {}) {
  const recordingByDevice = new Map();
  for (const testCase of cases) {
    const steps = Array.isArray(testCase?.steps) ? testCase.steps : [];
    const evidence = getWorkflowEvidenceOptions(steps, {
      disableScreenMirror: payload.disableScreenMirror,
      startConfigOverride: payload.startConfigOverride,
    });
    const defaults = testCase?.defaults || {};
    const phoneSerial = String(payload.devices?.phone?.serial || defaults.phoneSerial || '').trim();
    const glassesSerial = String(payload.devices?.glasses?.serial || defaults.glassesSerial || '').trim();
    if (evidence.recordPhoneScreen && phoneSerial) {
      const key = `phone:${phoneSerial}`;
      const previous = recordingByDevice.get(key);
      recordingByDevice.set(key, {
        deviceType: 'phone',
        serial: phoneSerial,
        showWindow: Boolean(previous?.showWindow || evidence.showPhoneScreen),
      });
    }
    if (evidence.recordGlassesScreen && glassesSerial) {
      const key = `glasses:${glassesSerial}`;
      const previous = recordingByDevice.get(key);
      recordingByDevice.set(key, {
        deviceType: 'glasses',
        serial: glassesSerial,
        showWindow: Boolean(previous?.showWindow || evidence.showGlassesScreen),
      });
    }
  }
  return [...recordingByDevice.values()];
}

function getWorkflowTaskMirrorDevices(cases = [], payload = {}, recordingDevices = []) {
  const mirrorByDevice = new Map();
  for (const testCase of cases) {
    const evidence = getWorkflowEvidenceOptions(testCase?.steps || [], {
      disableScreenMirror: payload.disableScreenMirror,
      startConfigOverride: payload.startConfigOverride,
    });
    const devices = [
      {
        deviceType: 'phone',
        serial: String(payload.devices?.phone?.serial || testCase?.defaults?.phoneSerial || '').trim(),
        enabled: evidence.showPhoneScreen,
      },
      {
        deviceType: 'glasses',
        serial: String(payload.devices?.glasses?.serial || testCase?.defaults?.glassesSerial || '').trim(),
        enabled: evidence.showGlassesScreen,
      },
    ];
    devices.forEach((device) => {
      const key = `${device.deviceType}:${device.serial}`;
      if (device.enabled && device.serial) {
        mirrorByDevice.set(key, { deviceType: device.deviceType, serial: device.serial });
      }
    });
  }
  return [...mirrorByDevice.values()];
}

function attachTaskRecordingArtifacts(task, recordingResult) {
  if (!recordingResult?.caseRecordings) return task;
  return {
    ...task,
    recordingSession: {
      schemaVersion: recordingResult.schemaVersion,
      sourceRecordings: recordingResult.sourceRecordings,
      markers: recordingResult.markers,
      finalizedAt: new Date().toISOString(),
    },
    cases: (task.cases || []).map((caseRecord) => {
      const recordings = recordingResult.caseRecordings.get(caseRecord.caseId) || [];
      const recordingEvidenceReady = recordings.length > 0
        && recordings.every((item) => item.success && item.evidenceReady);
      return {
        ...caseRecord,
        artifacts: {
          ...(caseRecord.artifacts || {}),
          recordings,
          recordingMode: 'task-continuous-segmented',
          recordingsPending: false,
          evidenceReady: Boolean(caseRecord.artifacts?.evidenceReady && recordingEvidenceReady),
          finalizedAt: caseRecord.artifacts?.finalizedAt || new Date().toISOString(),
        },
      };
    }),
  };
}

async function runWorkflowTask(payload = {}, options = {}) {
  payload = normalizeStressPayload(payload);
  if (payload.performanceOptions !== undefined) validateWorkflowPerformanceTargets(payload.performanceOptions);
  normalizeThreadStackOptions(payload.performanceOptions?.threadStacks);
  if (payload.performanceOptions?.threadStacks?.enabled && !['phone', 'glasses'].some(role => payload.performanceOptions?.[role])) throw new Error('线程栈采集需选择性能设备');
  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  const taskId = payload.taskId || `cli-task-${crypto.randomUUID()}`;
  const taskName = payload.taskName || `CLI 自动化任务 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  const createdAt = payload.createdAt || new Date().toISOString();
  const taskCases = [];
  let task = createWorkflowTaskRecord(payload, cases, taskId, taskName, createdAt);
  let hasFailure = false;
  let wasStopped = false;
  const taskStartedAtMs = Date.now();
  const taskSource = String(payload.requestId || '').startsWith('cli') || String(taskId || '').startsWith('cli') || cliBackgroundMode ? 'cli' : 'ui';
  const activeTask = activeWorkflowTasks.get(taskId) || {};
  Object.assign(activeTask, {
    taskId,
    taskName,
    task,
    caseRequestIds: activeTask.caseRequestIds || new Set(),
    currentRequestId: activeTask.currentRequestId || '',
    createdAt,
  });
  activeWorkflowTasks.set(taskId, activeTask);

  trackGlassBoxUsage('workflow_task_start', {
    source: taskSource,
    caseCount: cases.length,
  });

  if (cases.length === 0) {
    const failedTask = await attachWorkflowTaskReportPackage({
      ...task,
      status: 'failed',
      finishedAt: new Date().toISOString(),
      error: '自动化任务没有可执行用例',
    });
    persistWorkflowTaskRecord(failedTask);
    await workflowReportWriter.flush(getWorkflowReportDetailPath(taskId));
    trackGlassBoxUsage('workflow_task_finish', {
      source: taskSource,
      success: false,
      caseCount: 0,
      durationMs: Date.now() - taskStartedAtMs,
      errorCode: 'empty_task',
    });
    activeWorkflowTasks.delete(taskId);
    maybeQuitIdleBackgroundBroker();
    return {
      success: false,
      error: '自动化任务没有可执行用例',
      task: failedTask,
    };
  }

  task = {
    ...task,
    status: 'running',
  };
  persistWorkflowTaskRecord(task);
  // Start capture while logs/recorders prepare, before the first device action.
  const agentPreviewReady = Promise.all(mirrorTargets(task).map(target => prepareEmbeddedPreview(agentPreviewService, target)));
  const stackOptions = normalizeThreadStackOptions(payload.performanceOptions?.threadStacks);
  const stackTargets = ['phone', 'glasses'].filter(role => payload.performanceOptions?.[role]).map(role => ({ role, ...payload.performanceOptions.targets?.[role] }));
  if (stackOptions.enabled && !stackTargets.length) throw new Error('线程栈采集需选择至少一个性能采集设备');
  activeTask.threadStacks = createThreadStackCollector({ config: stackOptions, targets: stackTargets, adbPath: getAdbPath(),
    directory: path.join(getGlassBoxDataDir(), 'logs', 'thread-stacks', taskId),
    run: (args, opts) => runCommandWithOptions(getAdbPath(), args, opts),
    onUpdate: records => { task = { ...task, threadStacks: records }; persistWorkflowTaskRecord(task); },
  });
  let stackSamplingAllowed = false;
  const captureStacks = (reason, detail = {}) => activeTask.threadStacks.capture({ caseId: task.currentCaseId, round: task.currentRound, ...detail }, reason);
  activeTask.captureStacks = captureStacks;
  const performanceCollector = createWorkflowPerformanceCollector({
    taskId,
    taskName,
    performanceOptions: payload.performanceOptions || {},
    dataDir: getGlassBoxDataDir(),
    createCrashCollector: config => createPerformanceCrashCollector({ ...config, adbPath: getAdbPath() }),
    collectSample: async (...args) => {
      if (stackOptions.enabled && stackOptions.mode === 'interval' && stackSamplingAllowed && !activeTask.stopRequested) await captureStacks('interval');
      return collectWorkflowTaskPerformanceSample(...args);
    },
    onUpdate: (snapshot) => {
      task = applyWorkflowPerformanceSnapshot(task, snapshot);
      persistWorkflowTaskRecord(task);
    },
  });
  if (performanceCollector) {
    activeTask.performanceCollector = performanceCollector;
    await performanceCollector.start();
  }
  const taskRecordingDevices = getWorkflowTaskRecordingDevices(cases, payload);
  const taskMirrorDevices = getWorkflowTaskMirrorDevices(cases, payload, taskRecordingDevices);
  const taskRecordingDir = createWorkflowTaskRecordingDir(taskId);
  const logDevices = [...new Map(cases.flatMap(testCase => ['phone', 'glasses'].map(deviceType => ({
    deviceType, serial: payload.devices?.[deviceType]?.serial || testCase.defaults?.[`${deviceType}Serial`] || '',
  }))).filter(device => device.serial).map(device => [device.serial, device])).values()];
  if (logDevices.length || payload.stress) {
    try {
    activeTask.taskLogCapture = startTaskLogCapture({ directory: path.join(taskRecordingDir, 'full-logs'), devices: logDevices, adbPath: getAdbPath(),
      onSession: session => logAssertStreams.set(session.serial, session),
      onStop: session => { if (logAssertStreams.get(session.serial) === session) logAssertStreams.delete(session.serial); },
    });
    } catch (error) {
      // Collection is evidence, never a prerequisite for dispatching business actions.
      const sessions = Object.fromEntries(logDevices.map(({ serial, deviceType }) => {
        const session = { taskOwned: true, serial, deviceType, exited: true, lineSequence: 0,
          lastError: error.message, artifact: { serial, deviceType, path: '', error: error.message } };
        logAssertStreams.set(serial, session);
        return [serial, session];
      }));
      const logs = Object.values(sessions).map(session => session.artifact);
      activeTask.taskLogCapture = { sessions, logs, async stop() {
        for (const [serial, session] of Object.entries(sessions)) if (logAssertStreams.get(serial) === session) logAssertStreams.delete(serial);
        return logs;
      } };
    }
    task = { ...task, taskLogs: activeTask.taskLogCapture.logs };
    persistWorkflowTaskRecord(task);
  }
  const taskRecordingCoordinator = taskRecordingDevices.length > 0
    ? new TaskScreenRecordingCoordinator({
        taskId,
        runDir: taskRecordingDir,
        startRecorder: startWorkflowScreenRecord,
        stopRecorder: stopWorkflowScreenRecord,
        segmentRecording: segmentWorkflowTaskRecording,
      })
    : null;
  if (taskRecordingCoordinator) {
    await taskRecordingCoordinator.start(taskRecordingDevices);
    activeTask.taskRecordingCoordinator = taskRecordingCoordinator;
  }
  const taskMirrorSessions = (await Promise.all(taskMirrorDevices.map((device) => (
    startWorkflowScreenMirror(device.deviceType, device.serial, {
      taskId,
      runDir: taskRecordingDir,
    })
  )))).filter(Boolean);
  activeTask.taskMirrorSessions = taskMirrorSessions;
  await agentPreviewReady;

  for (let index = 0; shouldRunStressCase(payload.stress, index, cases.length, taskStartedAtMs, Date.now()); index += 1) {
    if (activeTask.stopRequested) {
      wasStopped = true;
      break;
    }

    const testCase = payload.stress ? createStressExecution(cases, index, payload.caseEdges) : cases[index];
    if (payload.stress) {
      task = { ...task, currentRound: testCase.round,
        total: payload.stress.mode === 'rounds' ? cases.length * payload.stress.value : index + 1,
        cases: [...task.cases, ...createWorkflowTaskCaseRecords([testCase])] };
    }
    const caseId = testCase.id || `case-${index + 1}`;
    const caseRequestId = `${payload.requestId || 'cli-task'}-${taskId}-${caseId}-${Date.now()}`;
    const startedAt = new Date().toISOString();
    activeTask.currentRequestId = caseRequestId;
    activeTask.caseRequestIds.add(caseRequestId);
    taskRecordingCoordinator?.startCase(testCase);

    task = replaceWorkflowTaskCase({
      ...task,
      status: 'running',
      completed: index,
      currentCaseName: testCase.name || caseId || `用例 ${index + 1}`,
    }, caseId, (caseRecord) => ({
      ...caseRecord,
      status: 'running',
      completed: 0,
      startedAt,
      endedAt: undefined,
      results: [],
      artifacts: undefined,
      error: undefined,
    }));
    persistWorkflowTaskRecord(task);

    if (index > 0) await Promise.all(mirrorTargets(task).map(target => prepareEmbeddedPreview(agentPreviewService, target)));
    let runResult;
    let caseRecordingArtifacts = [];
    try {
      runResult = await runWorkflowCase({
        ...payload,
        testCase,
        requestId: caseRequestId,
        startConfigOverride: taskRecordingCoordinator || taskMirrorSessions.length
          ? {
              ...(payload.startConfigOverride || {}),
              recordPhoneScreen: false,
              recordGlassesScreen: false,
              showPhoneScreen: false,
              showGlassesScreen: false,
            }
          : payload.startConfigOverride,
      }, {
        ...options,
        sharedLogSessions: activeTask.taskLogCapture?.sessions,
        beforeStep: async step => {
          stackSamplingAllowed = true;
          if (stackOptions.enabled && stackOptions.mode === 'checkpoint' && stackOptions.checkpoints.includes(step.id)) await captureStacks('checkpoint', { stepId: step.id });
        },
        onProgress: ({ result, results }) => {
          task = replaceWorkflowTaskCase({
            ...task,
            status: activeTask.stopRequested ? 'stopping' : 'running',
            completed: index,
            currentCaseName: testCase.name || caseId || `用例 ${index + 1}`,
            currentCaseId: caseId,
            currentStepId: result?.stepId || '',
            currentStepName: result?.stepName || '',
          }, caseId, (caseRecord) => ({
            ...caseRecord,
            status: 'running',
            completed: Array.isArray(results) ? results.length : caseRecord.completed,
            results: Array.isArray(results) ? results : caseRecord.results,
            error: ['failed', 'stopped'].includes(result?.status)
              ? result?.error || result?.stderr || caseRecord.error
              : caseRecord.error,
          }));
          persistWorkflowTaskRecord(task);
        },
        onTerminal: async ({ result: terminalResult, results }) => {
          stackSamplingAllowed = false;
          await activeTask.threadStacks.drain();
          if (stackOptions.enabled && stackOptions.mode === 'failure' && !terminalResult?.success && !terminalResult?.stopped) await captureStacks('failure');
          const terminalStatus = terminalResult?.stopped ? 'stopped' : terminalResult?.success ? 'success' : 'failed';
          const terminalAt = new Date().toISOString();
          task = replaceWorkflowTaskCase({
            ...task,
            status: activeTask.stopRequested ? 'stopping' : 'running',
            hasFailures: Boolean(task.hasFailures || terminalStatus === 'failed'),
            currentCaseName: testCase.name || caseId || `用例 ${index + 1}`,
            currentCaseId: caseId,
          }, caseId, (caseRecord) => ({
            ...caseRecord,
            status: terminalStatus,
            completed: Array.isArray(results) ? results.length : caseRecord.completed,
            results: Array.isArray(results) ? results : caseRecord.results,
            endedAt: terminalAt,
            finishedAt: terminalAt,
            error: terminalResult?.success ? undefined : terminalResult?.error || caseRecord.error,
            errorCode: terminalResult?.success ? undefined : terminalResult?.errorCode || '',
            errorType: terminalResult?.success ? undefined : terminalResult?.errorType || '',
            recoveryActions: terminalResult?.success ? undefined : terminalResult?.recoveryActions || [],
            diagnostics: terminalResult?.success ? undefined : terminalResult?.diagnostics,
            ...Object.fromEntries(['plannedPath','executedPath','reachedEnd','terminationReason','failedEdge','duplicateStepId']
              .filter(key => terminalResult?.[key] !== undefined).map(key => [key,terminalResult[key]])),
            artifacts: undefined,
          }));
          persistWorkflowTaskRecord(task);
        },
      });
    } catch (error) {
      const stopped = Boolean(activeTask.stopRequested) || error?.code === 'WORKFLOW_STOPPED';
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = error?.errorCode || error?.code || '';
      const errorType = error?.errorType || '';
      const recoveryActions = Array.isArray(error?.recoveryActions) ? error.recoveryActions : [];
      const diagnostics = error?.diagnostics || error?.meta?.diagnostics || undefined;
      runResult = {
        success: false,
        stopped,
        results: [
          {
            stepId: error?.stepId || 'task-case-exception',
            stepName: error?.stepName || '用例初始化/执行',
            status: stopped ? 'stopped' : 'failed',
            startedAt,
            completedAt: new Date().toISOString(),
            endedAt: new Date().toISOString(),
            error: errorMessage,
            errorCode,
            errorType,
            recoveryActions,
            diagnostics,
            exitCode: error?.exitCode ?? null,
            signal: error?.signal ?? null,
            timeoutMs: error?.timeoutMs ?? null,
            stdout: error?.stdout,
            stderr: error?.stderr,
          },
        ],
        artifacts: null,
        error: errorMessage,
        errorCode,
        errorType,
        recoveryActions,
        diagnostics,
        exitCode: error?.exitCode ?? null,
        signal: error?.signal ?? null,
        timeoutMs: error?.timeoutMs ?? null,
        stdout: error?.stdout,
        stderr: error?.stderr,
      };
    } finally {
      if (taskRecordingCoordinator) {
        caseRecordingArtifacts = await taskRecordingCoordinator.finishAndSegmentCase();
      }
      if (activeTask.currentRequestId === caseRequestId) {
        activeTask.currentRequestId = '';
      }
      activeTask.caseRequestIds.delete(caseRequestId);
    }
    if (taskRecordingCoordinator) {
      const recordingEvidenceReady = caseRecordingArtifacts.length > 0
        && caseRecordingArtifacts.every((item) => item.success && item.evidenceReady);
      runResult.artifacts = {
        ...(runResult.artifacts || {}),
        recordings: caseRecordingArtifacts,
        recordingMode: 'task-continuous-segmented',
        recordingsPending: !recordingEvidenceReady,
        evidenceReady: Boolean(runResult.artifacts?.evidenceReady && recordingEvidenceReady),
      };
    }
    const endedAt = new Date().toISOString();
    const status = runResult.stopped ? 'stopped' : runResult.success ? 'success' : 'failed';

    wasStopped = wasStopped || Boolean(runResult.stopped) || Boolean(activeTask.stopRequested);
    hasFailure = hasFailure || status === 'failed';
    if (status === 'failed' && isWorkflowTaskEnvironmentPreflightFailure(runResult)) {
      wasStopped = true;
      activeTask.stopRequested = true;
      const cause = (runResult.results || []).find(item => item.status === 'failed' && isWorkflowTaskEnvironmentPreflightFailure(item)) || runResult;
      activeTask.stopReason = cause.error || cause.stderr || runResult.error || '设备/性能环境不可用，已停止后续业务用例';
      const stopErrorCode = cause.errorCode || cause.code || runResult.errorCode || 'WORKFLOW_ENVIRONMENT_UNAVAILABLE';
      activeTask.stopFailure = {
        caseId, stepId: cause.stepId,
        error: activeTask.stopReason,
        errorCode: stopErrorCode,
        errorType: cause.errorType || runResult.errorType || 'execution-environment',
        recoveryActions: cause.recoveryActions || runResult.recoveryActions || ['检查所选设备连接、USB调试授权及设备状态；恢复后由用户决定是否重新执行。'],
        diagnostics: cause.diagnostics || runResult.diagnostics || createWorkflowErrorDiagnostics(stopErrorCode,'execution-environment',activeTask.stopReason,[],{caseId,stepId:cause.stepId,stderr:cause.stderr}),
      };
      await performanceCollector?.stop();
    }
    const caseRecordEdges = getWorkflowCaseEdges(payload, testCase, testCase.steps || []);

    taskCases.push({
      caseId,
      sourceCaseId: testCase.sourceCaseId || caseId,
      round: testCase.round,
      caseName: testCase.name || caseId || `用例 ${index + 1}`,
      caseSnapshot: testCase,
      edges: caseRecordEdges.length ? caseRecordEdges : createWorkflowEdgesFromSteps(testCase.steps || []),
      status,
      completed: Array.isArray(runResult.results) ? runResult.results.length : 0,
      total: Array.isArray(testCase.steps) ? testCase.steps.length : 0,
      startedAt,
      endedAt,
      finishedAt: endedAt,
      results: runResult.results || [],
      artifacts: runResult.artifacts || null,
      error: runResult.success ? undefined : runResult.error || `${testCase.name || testCase.id || '用例'} 执行失败`,
      errorCode: runResult.success ? undefined : runResult.errorCode || '',
      errorType: runResult.success ? undefined : runResult.errorType || '',
      recoveryActions: runResult.success ? undefined : runResult.recoveryActions || [],
      diagnostics: runResult.success ? undefined : runResult.diagnostics,
      plannedPath: runResult.plannedPath || [],
      executedPath: runResult.executedPath || [],
      reachedEnd: Boolean(runResult.reachedEnd),
      terminationReason: runResult.terminationReason || '',
      failedEdge: runResult.failedEdge || null,
      duplicateStepId: runResult.duplicateStepId || '',
    });

    const completedCases = index + 1;
    const remainingCases = Math.max(0, task.total - completedCases);
    task = replaceWorkflowTaskCase({
      ...task,
      completed: completedCases,
      status: wasStopped ? 'stopping' : 'running',
      hasFailures: hasFailure,
      summary: {
        ...(task.summary || {}),
        successCount: taskCases.filter((item) => item.status === 'success').length,
        failedCount: taskCases.filter((item) => item.status === 'failed').length,
        stoppedCount: taskCases.filter((item) => item.status === 'stopped').length,
        runningCount: 0,
        pendingCount: remainingCases,
        completed: completedCases,
        caseCount: task.total,
      },
      error: activeTask.stopFailure?.error || (hasFailure ? taskCases.find((item) => item.status === 'failed')?.error : undefined),
    }, caseId, () => taskCases[taskCases.length - 1]);
    task = attachPerformanceReportsToTaskCases(task, task.performanceReports || {});
    persistWorkflowTaskRecord(task);

    if (wasStopped) {
      break;
    }
  }

  if (wasStopped) {
    task = markWorkflowTaskCasesStopped(task, activeTask.stopReason || '任务已停止');
  }

  const finalCases = Array.isArray(task.cases) ? task.cases : taskCases;
  const successCount = finalCases.filter((item) => item.status === 'success').length;
  const failedCount = finalCases.filter((item) => item.status === 'failed').length;
  const stoppedCount = finalCases.filter((item) => item.status === 'stopped').length;
  const completedCount = successCount + failedCount + stoppedCount;
  const terminalFailure = activeTask.stopFailure || taskCases.find((item) => item.status === 'failed');
  task = {
    ...task,
    status: wasStopped ? 'stopped' : hasFailure ? 'failed' : 'success',
    completed: completedCount,
    total: payload.stress ? finalCases.length : task.total,
    finishedAt: new Date().toISOString(),
    currentCaseName: undefined,
    currentCaseId: undefined,
    currentStepId: undefined,
    currentStepName: undefined,
    summary: {
      ...(task.summary || {}),
      successCount,
      failedCount,
      stoppedCount,
      runningCount: 0,
      pendingCount: 0,
      completed: completedCount,
      caseCount: finalCases.length,
    },
    hasFailures: failedCount > 0,
    stopReason: wasStopped ? activeTask.stopReason || '任务已停止' : undefined,
    stopCause: activeTask.stopFailure,
    error: terminalFailure?.error || (wasStopped ? activeTask.stopReason || '任务已停止' : undefined),
    errorCode: terminalFailure?.errorCode || (wasStopped ? 'workflow_task_stopped' : ''),
    errorType: terminalFailure?.errorType || '',
    recoveryActions: terminalFailure?.recoveryActions || [],
    diagnostics: terminalFailure?.diagnostics,
  };
  if (performanceCollector) {
    task = applyWorkflowPerformanceSnapshot(task, await performanceCollector.stop());
  }
  if (taskRecordingCoordinator) {
    task = attachTaskRecordingArtifacts(task, await taskRecordingCoordinator.finalize());
    delete activeTask.taskRecordingCoordinator;
  }
  if (taskMirrorSessions.length) {
    await Promise.all(taskMirrorSessions.map(stopWorkflowScreenMirror));
    activeTask.taskMirrorSessions = [];
  }
  await activeTask.threadStacks?.stop();
  if (activeTask.taskLogCapture) {
    task.taskLogs = await activeTask.taskLogCapture.stop();
    delete activeTask.taskLogCapture;
    task.taskLogWarning = task.taskLogs.filter((log) => log.error).map((log) => `${log.deviceType}: ${log.error}`).join('\n');
  }
  task = await attachWorkflowTaskReportPackage(task);
  persistWorkflowTaskRecord(task);
  await workflowReportWriter.flush(getWorkflowReportDetailPath(taskId));
  activeWorkflowTasks.delete(taskId);
  maybeQuitIdleBackgroundBroker();

  trackGlassBoxUsage('workflow_task_finish', {
    source: taskSource,
    success: !hasFailure && !wasStopped,
    stopped: wasStopped,
    caseCount: cases.length,
    successCount,
    failedCount,
    stoppedCount,
    durationMs: Date.now() - taskStartedAtMs,
    errorCode: wasStopped ? 'workflow_task_stopped' : hasFailure ? 'workflow_task_failed' : '',
  });

  return {
    success: !hasFailure && !wasStopped,
    stopped: wasStopped,
    task,
    devices: payload.devices,
    reservedDeviceSerials: payload.reservedDeviceSerials,
    error: task.error,
    errorCode: task.errorCode,
    errorType: task.errorType,
    recoveryActions: task.recoveryActions,
    diagnostics: task.diagnostics,
  };
}

function enqueueWorkflowTaskExecution(payload = {}, options = {}, reservation = null) {
  payload = prepareWorkflowExecution({ ...payload, taskId: payload.taskId || `cli-task-${crypto.randomUUID()}` });
  // Reserve synchronously, before the first await or scheduling callback.
  const lease = reservation || workflowExecutionGate.acquire({ id: payload.taskId, name: payload.taskName, reservedDeviceSerials: payload.reservedDeviceSerials });
  const run = async () => {
    lease.task.status = 'running';
    try { return await runWorkflowTask(payload, options); }
    catch (error) {
      lease.task.status = 'finalizing';
      const latestTask = activeWorkflowTasks.get(payload.taskId)?.task;
      try { if (latestTask) await finalizeWorkflowTaskAfterException(latestTask, error); }
      finally { activeWorkflowTasks.delete(payload.taskId); }
      throw error;
    }
  };
  return Promise.resolve().then(run).finally(() => lease.release());
}

function runStandaloneWorkflowCase(payload = {}, options = {}) {
  payload = prepareWorkflowExecution(payload);
  return workflowExecutionGate.run({ id: payload.requestId || crypto.randomUUID(), name: payload.testCase?.name, reservedDeviceSerials: payload.reservedDeviceSerials },
    () => runWorkflowCase(payload, options));
}

function submitWorkflowTask(payload = {}, options = {}) {
  payload = prepareWorkflowExecution(normalizeStressPayload(payload));
  if (payload.performanceOptions !== undefined) validateWorkflowPerformanceTargets(payload.performanceOptions);
  normalizeThreadStackOptions(payload.performanceOptions?.threadStacks);
  if (payload.performanceOptions?.threadStacks?.enabled && !['phone', 'glasses'].some(role => payload.performanceOptions?.[role])) throw new Error('线程栈采集需选择性能设备');
  if (payload.stress) {
    for (const role of ['phone', 'glasses']) {
      if (payload.stress[`${role}Log`] && !(payload.devices?.[role]?.serial || payload.cases?.[0]?.defaults?.[`${role}Serial`])) {
        throw new Error(`请先选择${role === 'glasses' ? '眼镜' : '手机'}设备，或取消对应完整日志`);
      }
    }
  }
  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  const taskId = payload.taskId || `cli-task-${crypto.randomUUID()}`;
  const taskName = payload.taskName || `CLI 自动化任务 · ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`;
  const createdAt = new Date().toISOString();
  const task = {
    ...createWorkflowTaskRecord(payload, cases, taskId, taskName, createdAt),
    status: cases.length ? 'submitted' : 'failed',
    error: cases.length ? undefined : '自动化任务没有可执行用例',
    finishedAt: cases.length ? undefined : new Date().toISOString(),
  };

  const reservation = workflowExecutionGate.acquire({ id: taskId, name: taskName, reservedDeviceSerials: payload.reservedDeviceSerials });
  try {
    persistWorkflowTaskRecord(task);

    if (cases.length) {
      activeWorkflowTasks.set(taskId, {
        taskId,
        taskName,
        task,
        caseRequestIds: new Set(),
        currentRequestId: '',
        createdAt,
        stopRequested: false,
        force: false,
      });

      setImmediate(() => {
        enqueueWorkflowTaskExecution({
          ...payload,
          taskId,
          taskName,
          createdAt,
        }, options, reservation).catch(() => {
          maybeQuitIdleBackgroundBroker();
        });
      });
    }

    if (!cases.length) reservation.release();
    return {
      success: cases.length > 0,
      submitted: cases.length > 0,
      taskId,
      status: task.status,
      caseCount: cases.length,
      task,
      devices: payload.devices,
    reservedDeviceSerials: payload.reservedDeviceSerials,
      error: task.error,
    };
  } catch (error) { reservation.release(); throw error; }
}

registerApplicationHandler('workflow-task:creation-event', (_event, payload) => require('./task-creation-diagnostics').recordClientEvent(payload));

registerApplicationHandler('workflow-task:submit', async (_event, payload = {}) => {
  if(payload.taskId && getRemovedWorkflowTaskIds().includes(payload.taskId))return {success:false,errorCode:'TASK_ID_RETIRED',error:'该任务ID已移除，请为新任务使用新的ID'};
  let result;
  try {
    const resolved = await resolveWorkflowTaskDevices(_event,payload);
    result = submitWorkflowTask({ ...resolved, source: payload.source || 'ui-broker' });
  } catch (error) {
    if (['TEST_TASK_BUSY','DEVICE_PREFLIGHT_NO_MATCH'].includes(error.code)) return workflowExecutionFailure(error);
    throw error;
  }
  await workflowReportWriter.flush(getWorkflowReportDetailPath(result.taskId));
  return result;
});

ipcMain.handle('workflow:run', async (event, payload = {}) => {
  try { return await runStandaloneWorkflowCase(await resolveWorkflowTaskDevices(event,{...payload,cases:payload.testCase ? [payload.testCase] : []}), { progressSender: event.sender }); }
  catch (error) { return { ...workflowExecutionFailure(error), results: [] }; }

  const { testCase, components = [], requestId = '', disableScreenMirror = false } = payload;

  if (!testCase || !Array.isArray(testCase.steps)) {
    return {
      success: false,
      results: [],
      error: '工作流用例格式不正确',
    };
  }

  const context = {
    defaults: testCase.defaults || {},
    variables: testCase.variables || {},
    components: getWorkflowCaseComponents(components, testCase.components),
    pushedAudioFiles: [],
    pushedImageFiles: [],
    cleanupAudioFiles: shouldCleanupWorkflowAudioFiles(testCase.steps),
    cleanupImageFiles: shouldCleanupWorkflowImageFiles(testCase.steps),
  };
  const results = [];
  const runDir = createWorkflowRunDir(testCase);
  const evidenceOptions = getWorkflowEvidenceOptions(testCase.steps, { disableScreenMirror });
  const logSessions = (await Promise.all([
    evidenceOptions.capturePhoneLog ? startWorkflowLogCapture(runDir, 'phone', context.defaults.phoneSerial, { clearBeforeStart: true }) : null,
    evidenceOptions.captureGlassesLog ? startWorkflowLogCapture(runDir, 'glasses', context.defaults.glassesSerial, { clearBeforeStart: true }) : null,
  ])).filter(Boolean);
  const screenRecordSessions = (await Promise.all([
    evidenceOptions.recordPhoneScreen ? startWorkflowScreenRecord(runDir, 'phone', context.defaults.phoneSerial, { showWindow: evidenceOptions.showPhoneScreen }) : null,
    evidenceOptions.recordGlassesScreen ? startWorkflowScreenRecord(runDir, 'glasses', context.defaults.glassesSerial, { showWindow: evidenceOptions.showGlassesScreen }) : null,
  ])).filter(Boolean);
  const screenMirrorSessions = (await Promise.all([
    evidenceOptions.showPhoneScreen
      ? startWorkflowScreenMirror('phone', context.defaults.phoneSerial)
      : null,
    evidenceOptions.showGlassesScreen
      ? startWorkflowScreenMirror('glasses', context.defaults.glassesSerial)
      : null,
  ])).filter(Boolean);
  if (requestId) {
    activeWorkflowRuntimes.set(requestId, {
      logSessions,
      screenRecordSessions,
      screenMirrorSessions,
    });
  }
  context.runDir = runDir;
  context.screenshots = [];
  const artifacts = {
    runDir,
    logs: [],
    recordings: [],
    screenshots: [],
    pushedAudioFiles: [],
    pushedImageFiles: [],
    cleanup: [],
    imageCleanup: [],
  };
  let finalResponse = null;
  const sendProgress = (result) => {
    if (requestId) {
      event.sender.send('workflow:progress', {
        requestId,
        result,
        results: [...results],
      });
    }
  };

  try {
    for (const step of testCase.steps) {
      const startedAt = new Date().toISOString();

      try {
        if (isWorkflowCanceled(requestId)) {
          throw createWorkflowStoppedError();
        }

        const output = await workflowCommandScope.run(requestId, () => executeWorkflowStep(step, context));
        const completedAt = output.completedAt || new Date().toISOString();
        if (shouldApplyPostDelay(step)) {
          await sleepWorkflow(Number(step.postDelayMs || 0), requestId);
        }
        const endedAt = new Date().toISOString();

        const result = {
          stepId: step.id,
          stepName: step.name,
          status: 'success',
          startedAt,
          completedAt,
          endedAt,
          command: output.command,
          stdout: output.stdout,
          stderr: output.stderr,
        };

        results.push(result);
        sendProgress(result);
      } catch (error) {
        const completedAt = error.completedAt || new Date().toISOString();
        const endedAt = completedAt;
        const stopped = error?.code === 'WORKFLOW_STOPPED' || isWorkflowCanceled(requestId);

        const result = {
          stepId: step.id,
          stepName: step.name,
          status: stopped ? 'stopped' : 'failed',
          startedAt,
          completedAt,
          endedAt,
          error: error.message,
          command: error.command,
          stdout: error.stdout,
          stderr: error.stderr,
          meta: error.meta,
        };

        results.push(result);
        sendProgress(result);

        if (stopped) {
          finalResponse = {
            success: false,
            stopped: true,
            results,
            error: error.message,
            artifacts,
          };
          return finalResponse;
        }

        if (!step.continueOnError) {
          finalResponse = {
            success: false,
            results,
            error: error.message,
            artifacts,
          };
          return finalResponse;
        }
      }
    }

    finalResponse = {
      success: results.every((result) => result.status === 'success'),
      results,
      artifacts,
    };
    return finalResponse;
  } finally {
    artifacts.pushedAudioFiles = [...(context.pushedAudioFiles || [])];
    artifacts.pushedImageFiles = [...(context.pushedImageFiles || [])];
    artifacts.cleanup = context.cleanupAudioFiles
      ? await Promise.all((context.pushedAudioFiles || []).map(async (item) => {
          try {
            await runCommand(getAdbPath(), ['-s', item.serial, 'shell', 'rm', '-f', item.remotePath], 5000);
            return {
              ...item,
              success: true,
            };
          } catch (_error) {
            // Cleanup is best-effort; workflow result should still reflect the actual test outcome.
            return {
              ...item,
              success: false,
              error: _error.message,
            };
          }
        }))
      : (context.pushedAudioFiles || []).map((item) => ({
          ...item,
          success: false,
          skipped: true,
          error: '结束节点已关闭音频清理',
        }));
    artifacts.imageCleanup = context.cleanupImageFiles
      ? await Promise.all((context.pushedImageFiles || []).map(async (item) => {
          try {
            await runCommand(getAdbPath(), ['-s', item.serial, 'shell', 'rm', '-f', item.remotePath], 5000);
            return {
              ...item,
              success: true,
            };
          } catch (_error) {
            return {
              ...item,
              success: false,
              error: _error.message,
            };
          }
        }))
      : (context.pushedImageFiles || []).map((item) => ({
          ...item,
          success: false,
          skipped: true,
          error: '结束节点已关闭图片清理',
        }));
    artifacts.recordings = (await Promise.all(screenRecordSessions.map(stopWorkflowScreenRecord))).filter(Boolean);
    await Promise.all(screenMirrorSessions.map(stopWorkflowScreenMirror));
    artifacts.screenshots = [...(context.screenshots || [])];
    artifacts.logs = logSessions.map(stopWorkflowLogCapture).filter(Boolean);
    if (requestId) {
      activeWorkflowRuntimes.delete(requestId);
      workflowCancelRequests.delete(requestId);
    }
  }
});

registerApplicationHandler('workflow:validate-task-selection', async (_event, payload = {}) => {
  try {
    return await validateWorkflowTaskSelection(payload);
  } catch (error) {
    return {
      success: false,
      phase: 'validation',
      validationErrors: [{
        caseId: '',
        caseName: '',
        node: 'task',
        field: 'cases',
        code: error.code || 'VALIDATION_GATE_UNAVAILABLE',
        message: error instanceof Error ? error.message : String(error),
        recoveryActions: error.code === 'DEVICE_PREFLIGHT_NO_MATCH' ? ['在头部选择在线设备，或显式指定本次任务 SN；无需修改全局绑定。'] : ['确认安装包内包含 CLI 校验模块后重新提交任务。'],
      }],
      validationWarnings: [],
      validationSummary: {
        selected: Array.isArray(payload.cases) ? payload.cases.length : 0,
        passed: 0,
        warnings: 0,
        errors: 1,
      },
    };
  }
});

ipcMain.handle('workflow-report:finalize-task', async (_event, payload = {}) => {
  const task = payload?.task;
  if (!task?.id) {
    return { success: false, error: 'Missing workflow task' };
  }
  try {
    const terminalTask = payload.error
      ? await finalizeWorkflowTaskAfterException(task, Object.assign(new Error(String(payload.error.message || payload.error)), payload.error))
      : await attachWorkflowTaskReportPackage(refreshWorkflowTaskSummary(task));
    persistWorkflowTaskRecord(terminalTask);
    return {
      success: Boolean(terminalTask.reportPackage?.success),
      task: terminalTask,
      reportPackage: terminalTask.reportPackage,
      reportPackagePath: terminalTask.reportPackagePath,
      error: terminalTask.reportPackageError,
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  }
});

ipcMain.handle('workflow-state:load', async () => {
  try {
    return {
      success: true,
      state: (()=>{const s=readWorkflowState();return s?{...s,automationTasks:require('./development-tasks').visibleTasks(s.automationTasks || [],getGlassBoxDataDir())}:s;})(),
      path: getWorkflowStatePath(),
    };
  } catch (error) {
    return {
      success: false,
      state: null,
      error: error.message,
      path: getWorkflowStatePath(),
    };
  }
});

const pendingCaseUpdates = new Map();
let caseUpdateQueue = Promise.resolve();

ipcMain.handle('workflow-case:update-failed', (event, requestId, error) => {
  const pending = pendingCaseUpdates.get(requestId);
  if (!pending || pending.sender !== event.sender) return;
  clearTimeout(pending.timer);
  pendingCaseUpdates.delete(requestId);
  pending.resolve({ success: false, error: String(error) });
});

async function updateCaseFromCli(payload) {
  const state = readWorkflowState() || {};
  require('./agent/case-batch').checkRevision(state, payload);
  const options = { create: payload.action === 'create-case', libraryId: payload.libraryId, folderId: payload.folderId };
  const existing=state.cases?.find(c=>c.id===payload.caseId);
  const assets=require('./case-assets');
  const enriched=assets.withAssetContext(state,{...existing,...payload.document,libraryId:payload.libraryId || payload.document.libraryId || existing?.libraryId},payload.sourceCaseId);
  const assetValidation=assets.validateCaseAssets(state,enriched);
  if(!assetValidation.success)return {...assetValidation,phase:'asset-validation',saved:[]};
  payload={...payload,document:enriched};
  const nextState = mergeCaseUpdate(state, payload.caseId, payload.document, options);
  const savedCase = nextState.cases.find((item) => item.id === payload.caseId);
  const sampleDiagnostics = require('./agent/case-contract').assertLogSampleExtraction(nextState, savedCase, state.cases?.find(item => item.id === payload.caseId), {preserveSourceSamples: payload.preserveSourceSamples === true});
  const receipt = { caseId: payload.caseId, libraryId: savedCase.libraryId, folderId: savedCase.folderId || null, assetBaseDir:savedCase.assetBaseDir || null, validationScope:'document-and-static-assets', runtimeReferencesDeferred:true, ...(sampleDiagnostics.length ? {sampleDiagnostics,sourceSamplesPreserved:true} : {}) };
  if (payload.dryRun) return { success: true, dryRun: true, ...receipt, uiUpdated: false };
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) {
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        pendingCaseUpdates.delete(requestId);
        resolve({ success: false, error: 'The editor did not acknowledge the case update. Check that the editor has finished loading.' });
      }, 10000);
      pendingCaseUpdates.set(requestId, { resolve, timer, ...receipt, sender: mainWindow.webContents });
      mainWindow.webContents.send('workflow-case:update', { requestId, caseId: payload.caseId, document: payload.document, options });
    });
  }
  writeWorkflowState(caseEditGuard.guardStateWrite(nextState, state, { source: 'cli', caseIds: [payload.caseId] }));
  require('./diagnostics').record({ event: 'case.saved', source: 'cli', caseId: payload.caseId, libraryId: receipt.libraryId });
  return { success: true, ...receipt, uiUpdated: false };
}

ipcMain.handle('workflow-state:save', async (_event, state = {}, caseUpdateRequestId = '') => {
  const pending = pendingCaseUpdates.get(caseUpdateRequestId);
  try {
    if (caseUpdateRequestId && (!pending || pending.sender !== _event.sender)) throw new Error('Case update request expired or belongs to another editor');
    const persistedState = readWorkflowState() || {};
    const mergedState = caseEditGuard.guardStateWrite(mergeWorkflowStateForRendererSave(state, persistedState), persistedState, { source: pending ? 'cli' : 'editor', caseIds: pending?.caseId ? [pending.caseId] : [] });
    const statePath = writeWorkflowState(mergedState);
    if (pending?.caseId) require('./diagnostics').record({ event: 'case.saved', source: 'cli', caseId: pending.caseId, libraryId: pending.libraryId });
    synchronizeLocalCaseLibraryWatchers(mergedState);
    if (pending) {
      clearTimeout(pending.timer);
      pendingCaseUpdates.delete(caseUpdateRequestId);
      pending.resolve({ success: true, caseId: pending.caseId, libraryId: pending.libraryId, folderId: pending.folderId, uiUpdated: true });
    }
    return {
      success: true,
      path: statePath,
    };
  } catch (error) {
    if (error.code === 'CASE_LIBRARY_LOCAL_EDITS_CONFLICT') require('./diagnostics').record({ event: 'case-library.save-check', source: 'renderer', status: 'blocked', code: error.code, libraryId: error.libraryId, conflictCount: error.caseIds?.length || 0 });
    if (pending) {
      clearTimeout(pending.timer);
      pendingCaseUpdates.delete(caseUpdateRequestId);
      pending.resolve({ success: false, error: error.message });
    }
    return {
      success: false,
      error: error.message,
      errorCode: error.code,
      path: getWorkflowStatePath(),
    };
  }
});

ipcMain.handle('case-library:check-apply', (_event, payload = {}) => {
  try {
    const state = readWorkflowState() || {};
    const result = caseEditGuard.assertLibraryApplySafe(state, payload);
    // The source now contains the saved local content. Release only these guards,
    // so later legitimate source edits can refresh normally after synchronization.
    if (result.synchronizedCaseIds.length) {
      const guards = { ...state.caseEditGuards };
      for (const id of result.synchronizedCaseIds) delete guards[id];
      writeWorkflowState({ ...state, caseEditGuards: guards });
    }
    require('./diagnostics').record({ event: 'case-library.apply-check', libraryId: payload.libraryId, source: payload.source || 'refresh', status: 'allowed', protectedCaseCount: result.protectedCaseCount });
    return result;
  } catch (error) {
    require('./diagnostics').record({ event: 'case-library.apply-check', libraryId: payload.libraryId, source: payload.source || 'refresh', status: 'blocked', code: error.code, conflictCount: error.caseIds?.length || 0 });
    return { success: false, errorCode: error.code, error: error.message, caseIds: error.caseIds };
  }
});

const readPersistedTaskSummaries = require('./task-summary-cache').createTaskSummaryCache({
  files: () => [getWorkflowStatePath(), getWorkflowBackupStatePath()],
  load: async () => {
    if (!workflowTaskReconciliationCompleted) {
      const state=await reconcileHistoricalWorkflowTasksOnce(readWorkflowState() || {});
      return (state.automationTasks || []).map(task=>createWorkflowReportSummary(task));
    }
    const tasks=await require('./task-summary-cache').readTaskSummaries([getWorkflowStatePath(),getWorkflowBackupStatePath()]);
    return tasks.map(task=>createWorkflowReportSummary(task));
  },
});

registerApplicationHandler('workflow-task:list', async (_event, payload = {}) => {
  try {
    const sinceMs = Date.parse(String(payload.since || ''));
    const hasSince = Number.isFinite(sinceMs);
    const localTasks = await readPersistedTaskSummaries();
    const externalTasks = readVisibleTasks(getGlassBoxDataDir(),{includeDevelopment:true});
    const summaries = [...localTasks, ...externalTasks.filter(task => !localTasks.some(local => local.id === task.id))];
    const byId = new Map(summaries.map(task => [task.id, createWorkflowReportSummary(task)]));
    for (const [id, active] of activeWorkflowTasks) if (active.task) byId.set(id, createWorkflowReportSummary(active.task));
    const tasks = require('./development-tasks').visibleTasks([...byId.values()],getGlassBoxDataDir()).filter(task => task.externalSource || !hasSince || getWorkflowTaskUpdatedAtMs(task) > sinceMs);
    return {
      success: true,
      schemaVersion: 'glassbox.workflow-task-list.v1',
      cleanupSupported: true,
      tasks,
      removedTaskIds: [...new Set([...getRemovedWorkflowTaskIds(),...[...byId.values()].filter(t=>!require('./development-tasks').visibleTasks([t],getGlassBoxDataDir()).length).map(t=>t.id)])],
      synchronizedAt: [...byId.values()]
        .map((task) => String(task?.updatedAt || ''))
        .filter(Boolean)
        .sort()
        .at(-1) || String(payload.since || ''),
    };
  } catch (error) {
    return {
      success: false,
      schemaVersion: 'glassbox.workflow-task-list.v1',
      tasks: [],
      error: String(error?.message || error || '请求失败'),
    };
  }
});

async function stopExternalWorkflowTask(task, force = false, action = 'stop-task', request, signal) {
  if(signal?.aborted)return {success:false,error:'开发任务定期清理已停止'};
  const directory = path.join(task.externalSource.dataDir, 'cli-control');
  fs.mkdirSync(directory, { recursive: true });
  const requestDir = fs.mkdtempSync(path.join(directory, 'ui-stop-'));
  const payloadPath = path.join(requestDir, 'payload.json');
  const ackPath = path.join(requestDir, 'ack.json');
  writeJsonFileAtomic(payloadPath, { action, request, taskId: task.id, force: Boolean(force), dataDir: task.externalSource.dataDir, ackPath });
  const env = { ...process.env, LENSWIPER_TASK_UI_DATA_DIR: getGlassBoxDataDir() };
  for (const key of ['ELECTRON_RUN_AS_NODE', 'GLASSBOX_CLI_DATA_DIR', 'GLASSBOX_WORKFLOW_STATE_PATH', 'GLASSBOX_WORKFLOW_RUNS_DIR']) delete env[key];
  const child = spawn(process.execPath, [...(app.isPackaged ? [] : [__filename]), '--glassbox-background', '--glassbox-cli-control-payload', payloadPath, '--glassbox-cli-data-dir', task.externalSource.dataDir], { env, detached: true, stdio: 'ignore' });
  let launchError;
  child.on('error', error => { launchError = error; }); child.unref();
  const abort=()=>child.kill('SIGTERM');signal?.addEventListener('abort',abort,{once:true});
  const deadline = Date.now() + 60000;
  try { while (Date.now() < deadline) {
    if(signal?.aborted)return {success:false,error:'开发任务定期清理已停止'};
    if (launchError) return { success: false, error: launchError.message };
    if (fs.existsSync(ackPath)) {
      const result = JSON.parse(fs.readFileSync(ackPath, 'utf8'));
      fs.rmSync(requestDir, { recursive: true, force: true });
      return result;
    }
    await sleep(100);
  }
  return { success: false, error: '停止请求尚未确认，请刷新任务状态；未重复提交任务。' };
  } finally {signal?.removeEventListener('abort',abort);}
}

async function captureTaskThreadStacks(taskId) {
  const external = getVisibleTask(getGlassBoxDataDir(), taskId);
  if (external) return stopExternalWorkflowTask(external, false, 'capture-stacks');
  const active = activeWorkflowTasks.get(taskId);
  if (!active?.captureStacks || active.stopRequested) return { success: false, error: '任务未运行或正在停止' };
  const records = await active.captureStacks('manual');
  return { success: Array.isArray(records) && records.length > 0 && records.every(r => r.status === 'success'), records };
}
ipcMain.handle('workflow-task:capture-stacks', (_event, payload = {}) => captureTaskThreadStacks(payload.taskId));

registerApplicationHandler('workflow-task:stop', async (_event, payload = {}) => {
  const external = getVisibleTask(getGlassBoxDataDir(), payload.taskId);
  if (external) return stopExternalWorkflowTask(external, payload.force);
  return stopWorkflowTaskById(payload.taskId, { force: Boolean(payload.force) });
});

registerApplicationHandler('workflow-report:load-task', async (_event, payload = {}) => {
  try {
    const taskId = String(payload.taskId || '').trim();
    if(getRemovedWorkflowTaskIds().includes(taskId))return {success:false,errorCode:'TASK_REMOVED',error:'任务索引已移除；保留产物可按文件路径打开'};
    const detailPath = getVisibleTask(getGlassBoxDataDir(), taskId)?.reportDetailPath || payload.reportDetailPath || getWorkflowReportDetailPath(taskId);

    if (!taskId) {
      return { success: false, error: 'Missing report task id' };
    }

    const liveTask = activeWorkflowTasks.get(taskId)?.task;
    if (!liveTask && (!detailPath || !fs.existsSync(detailPath))) {
      return { success: false, error: '报告详情文件不存在' };
    }
    const task = liveTask || JSON.parse(await fs.promises.readFile(detailPath, 'utf8'));
    return {
      success: true,
      reviewSnapshot: require('./agent/review-events').reviewSnapshot(task),
      task: {
        ...createWorkflowTaskRendererDetail(task),
        reportDetailPath: detailPath,
        reportDetailLoaded: true,
      },
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

function getRemovedWorkflowTaskIds(){return require('./task-visibility').readRemovedTaskIds(getGlassBoxDataDir());}
let taskCleanupService;
registerApplicationHandler('workflow-task:clean',async(_event,request={})=>{
  try{
    const state=readWorkflowState() || {},local=state.automationTasks || [],visible=readVisibleTasks(getGlassBoxDataDir()).filter(t=>!local.some(l=>l.id===t.id));
    const plan=require('./task-cleanup').selectTasks([...local,...visible],request);
    const external=plan.selected.filter(t=>t.externalSource);
    if(external.length){
      if(external.length!==plan.selected.length || new Set(external.map(t=>t.externalSource.dataDir)).size!==1)return {success:false,errorCode:'TASK_CLEANUP_MULTIPLE_SOURCES',error:'选中任务分属多个数据源，请按数据源分别清理；未删除任何任务'};
      const result=await stopExternalWorkflowTask(external[0],false,'task-cleanup',{...request,taskIds:plan.selected.map(t=>t.id)});
      if(result.removedTaskIds?.length){readVisibleTasks(getGlassBoxDataDir());if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('workflow-task:changed',{removedTaskIds:result.removedTaskIds,updatedAt:new Date().toISOString()});}
      return result;
    }
    taskCleanupService ||= require('./task-cleanup').createTaskCleanup({dataDir:getGlassBoxDataDir(),readState:readWorkflowState,writeState:writeWorkflowState,activeIds:()=>new Set(activeWorkflowTasks.keys()),flush:id=>workflowReportWriter.flush(getWorkflowReportDetailPath(id)),emit:payload=>{if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('workflow-task:changed',payload);}});
    return await taskCleanupService(request);
  }catch(e){return {success:false,errorCode:e.code || 'TASK_CLEANUP_FAILED',error:e.message,...e.details};}
});
// Older clients still use this channel; do not accept a renderer-provided path.
ipcMain.handle('workflow-report:delete-task-detail',(_event,payload={})=>invokeApplicationHandler('workflow-task:clean',_event,{taskIds:[payload.taskId]}));

ipcMain.handle('workflow-report:export-package', async (_event, payload = {}) => {
  try {
    let task = payload.task;
    if (!task?.id) {
      return { success: false, error: 'Missing report task' };
    }

    // Renderer detail excludes bulky raw evidence; exports always use the authoritative report.
    const exportDetail = getVisibleTask(getGlassBoxDataDir(), task.id)?.reportDetailPath || getWorkflowReportDetailPath(task.id);
    if (activeWorkflowTasks.get(task.id)?.task) task = activeWorkflowTasks.get(task.id).task;
    else if (fs.existsSync(exportDetail)) task = JSON.parse(await fs.promises.readFile(exportDetail, 'utf8'));
    const defaultName = `solopi-desktop-report-${sanitizeFilePart(task.name || task.id)}-${createTimestamp()}.glassreport`;
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: '导出 solopi-desktop 报告包',
      defaultPath: defaultName,
      filters: [
        { name: 'solopi-desktop Report', extensions: ['glassreport'] },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    const outputPath = saveResult.filePath.endsWith('.glassreport')
      ? saveResult.filePath
      : `${saveResult.filePath}.glassreport`;
    const reportPackage = await createWorkflowTaskReportPackage(task, outputPath);
    trackGlassBoxUsage('workflow_report_export', {
      success: true,
      caseCount: reportPackage.caseCount,
    });
    return {
      success: true,
      path: reportPackage.path,
      caseCount: reportPackage.caseCount,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

async function importWorkflowReportPackage(packagePath) {
  const imported = await require('./report-import').importReportPackage(path.resolve(packagePath), getReportCacheDir());
  if(getRemovedWorkflowTaskIds().includes(imported.task.id))imported.task={...imported.task,id:imported.task.id+'-'+crypto.randomUUID()};
  const task = {
    ...imported.task,
    performanceReports: resolveReportArtifactPaths(imported.task.performanceReports || {}, imported.reportRoot),
    taskLogs: resolveReportArtifactPaths(imported.task.taskLogs || [], imported.reportRoot),
    threadStacks: (imported.task.threadStacks || []).map(record => ({ ...record, files: resolveReportArtifactPaths(record.files || [], imported.reportRoot) })),
    cases: imported.task.cases.map(record => ({ ...record, artifacts: resolveReportArtifactPaths(record.artifacts, imported.reportRoot) })),
  };
  const persisted = persistWorkflowTaskRecord(task);
  await workflowReportWriter.flush(getWorkflowReportDetailPath(task.id));
  return { success: true, task: persisted, manifest: imported.manifest, path: imported.path, reportRoot: imported.reportRoot,
    rendererNotified: Boolean(mainWindow && !mainWindow.isDestroyed()) };
}

ipcMain.handle('workflow-report:open-package', async () => {
  try {
    const openResult = await dialog.showOpenDialog(mainWindow, {
      title: '打开 solopi-desktop 报告包',
      properties: ['openFile', 'multiSelections'],
      filters: [
        { name: 'solopi-desktop Report', extensions: ['glassreport'] },
      ],
    });

    if (openResult.canceled || openResult.filePaths.length === 0) {
      return { success: false, canceled: true };
    }

    return await importWorkflowReportPackage(openResult.filePaths[0]);
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('llm:test-provider', async (_event, payload = {}) => {
  try {
    const provider = payload.provider || {};
    const content = await requestOpenAiCompatibleChat(provider, [
      { role: 'system', content: 'You are a connectivity test assistant. Reply with OK only.' },
      { role: 'user', content: 'ping' },
    ], { maxTokens: 16, temperature: 0 });

    const probe = async (capability, options, messages) => {
      try {
        const probeContent = await requestOpenAiCompatibleChat(provider, messages, {
          ...options,
          maxTokens: 32,
          temperature: 0,
        });
        // Capability probing answers whether the endpoint accepts the
        // optional request parameter. The model's returned text is not part
        // of this contract: a provider may wrap valid JSON in a fence, return
        // an empty content field, or include reasoning while still accepting
        // response_format. The actual workflow parser remains responsible
        // for validating LLM assertion output.
        return 'supported';
      } catch (error) {
        const detail = `${error?.message || ''} ${error?.serviceMessage || ''}`.toLowerCase();
        // Providers commonly use 422 (rather than 400) for an accepted
        // endpoint that rejects an optional request parameter. Do not report
        // that deterministic capability result as "unknown". Authentication
        // and permission failures remain unknown because they do not tell us
        // whether the model supports the capability.
        const httpStatus = Number(error?.httpStatus || 0);
        const parameterRejected = httpStatus >= 400 && httpStatus < 500
          && ![401, 403].includes(httpStatus);
        return parameterRejected || /unsupported|unknown parameter|invalid parameter|not support/.test(detail)
          ? 'unsupported'
          : 'unknown';
      }
    };

    // Keep one user-visible test action, but serialize the probes. Some
    // OpenAI-compatible gateways (including DeepSeek deployments) rate-limit
    // concurrent requests for the same API key and would otherwise turn a
    // supported capability into an "unknown" result.
    const responseFormat = await probe(
      'responseFormat',
      { jsonMode: true },
      [
        { role: 'system', content: 'Output JSON only. Use exactly this shape: {"ok":true}.' },
        { role: 'user', content: 'Return the JSON test result.' },
      ],
    );
    const thinking = await probe(
      'thinking',
      { disableThinking: true },
      [
        { role: 'system', content: 'Reply with OK only.' },
        { role: 'user', content: 'ping' },
      ],
    );
    const capabilities = { responseFormat, thinking };

    return {
      success: true,
      content: content || 'OK',
      capabilities,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('llm:chat', async (_event, payload = {}) => {
  try {
    const rawMessages = Array.isArray(payload.messages) ? payload.messages : [];
    const messages = [
      {
        role: 'system',
        content: 'You are a helpful, general-purpose assistant embedded in solopi-desktop. Keep answers concise and practical. Do not claim access to solopi-desktop tools unless an explicit tool integration is provided.',
      },
      ...rawMessages
        .filter((message) => ['user', 'assistant', 'system'].includes(message?.role) && message?.content)
        .map((message) => ({
          role: message.role,
          content: String(message.content),
        })),
    ];
    const content = await requestOpenAiCompatibleChat(payload.provider, messages);

    return {
      success: true,
      content,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('dialog:select-audio-file', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择音频文件',
    properties: ['openFile'],
    filters: [
      { name: 'Audio', extensions: ['pcm', 'wav', 'mp3', 'm4a', 'aac', 'ogg', 'spx', 'speex'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return {
      success: false,
      canceled: true,
    };
  }

  return {
    success: true,
    path: result.filePaths[0],
  };
});

ipcMain.handle('dialog:select-apk-file', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: '选择要安装的 APK',
    properties: ['openFile'],
    filters: [
      { name: 'Android APK', extensions: ['apk'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true };
  }

  return { success: true, path: result.filePaths[0] };
});

ipcMain.handle('dialog:select-image-file', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择图片文件',
    properties: ['openFile'],
    filters: [
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return {
      success: false,
      canceled: true,
    };
  }

  return {
    success: true,
    path: result.filePaths[0],
  };
});

ipcMain.handle('dialog:select-image-files', async () => {
  const result = await dialog.showOpenDialog({
    title: '选择轮播图片',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp'] },
      { name: 'All Files', extensions: ['*'] },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return {
      success: false,
      canceled: true,
      paths: [],
    };
  }

  return {
    success: true,
    paths: result.filePaths,
  };
});

ipcMain.handle('audio:save-recording', async (_event, payload = {}) => {
  const { stepId, dataUrl, mimeType, outputFormat } = payload;

  if (!stepId || !dataUrl) {
    return {
      success: false,
      error: '缺少录音数据',
    };
  }

  try {
    const match = String(dataUrl).match(/^data:.*?;base64,(.*)$/);
    const base64 = match ? match[1] : String(dataUrl);
    const audioBuffer = Buffer.from(base64, 'base64');
    const sha256 = crypto.createHash('sha256').update(audioBuffer).digest('hex');
    const ext = getAudioExtension(mimeType, outputFormat);
    const fileName = `${sanitizeFilePart(stepId)}-${createTimestamp()}-${sha256.slice(0, 12)}.${ext}`;
    const filePath = path.join(getAudioRecordingsDir(), fileName);

    fs.mkdirSync(path.dirname(filePath), { recursive: true });

    if (['ogg', 'spx'].includes(getAudioOutputExtension(outputFormat))) {
      try {
        getRequiredFfmpegPath();
      } catch (error) {
        return {
          success: false,
          error: `导出压缩音频需要完整的 solopi-desktop 内置 FFmpeg。请重新安装应用，或把最终音频格式改成 PCM/WAV。${error?.message ? ` (${error.message})` : ''}`,
        };
      }

      const tempInputPath = path.join(getAudioRecordingsDir(), `${sanitizeFilePart(stepId)}-${createTimestamp()}-${sha256.slice(0, 12)}-source.wav`);
      fs.writeFileSync(tempInputPath, audioBuffer);

      try {
        await transcodeAudioFile(tempInputPath, filePath, {
          outputFormat,
          sampleRate: outputFormat === 'ogg' ? 16000 : payload.sampleRate || 16000,
          channelCnt: outputFormat === 'ogg' ? 1 : payload.channelCnt || 1,
          bitrate: outputFormat === 'ogg' ? '24k' : undefined,
        });
      } catch (error) {
        return {
          success: false,
          error: `音频转码失败，请检查内置 FFmpeg 是否支持目标编码（OGG: libopus，Speex: libspeex）。${error?.message ? ` (${error.message})` : ''}`,
        };
      } finally {
        try {
          fs.unlinkSync(tempInputPath);
        } catch (_error) {
          // Best-effort cleanup for intermediate WAV.
        }
      }

      const finalBuffer = fs.readFileSync(filePath);
      const finalSha256 = crypto.createHash('sha256').update(finalBuffer).digest('hex');

      return {
        success: true,
        path: filePath,
        mimeType: 'audio/ogg',
        size: finalBuffer.length,
        sha256: finalSha256,
      };
    }

    fs.writeFileSync(filePath, audioBuffer);

    return {
      success: true,
      path: filePath,
      mimeType,
      size: audioBuffer.length,
      sha256,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('audio:create-preview', async (_event, payload = {}) => {
  const sourcePath = String(payload.sourcePath || payload.localPath || '').trim();

  if (!sourcePath) {
    return {
      success: false,
      error: '缺少音频文件路径',
    };
  }

  try {
    if (!fs.existsSync(sourcePath)) {
      return {
        success: false,
        error: `音频文件不存在：${sourcePath}`,
      };
    }

    if (isGitLfsPointerFile(sourcePath)) {
      return {
        success: false,
        error: '当前文件仍是 Git LFS 指针文件，请先执行 Git LFS 拉取真实音频资产',
      };
    }

    const ext = path.extname(sourcePath).toLowerCase();

    if (ext !== '.pcm') {
      const audioBuffer = fs.readFileSync(sourcePath);

      return {
        success: true,
        path: sourcePath,
        url: bufferToDataUrl(audioBuffer, getAudioMimeTypeByExtension(sourcePath)),
      };
    }

    const stat = fs.statSync(sourcePath);
    const sampleFormat = resolveAudioSampleFormatInfo(payload.sampleFormat);
    const sampleRate = Number(payload.sampleRate) > 0 ? Number(payload.sampleRate) : 16000;
    const channelCnt = Number(payload.channelCnt) > 0 ? Number(payload.channelCnt) : 1;
    const previewKey = crypto.createHash('sha1')
      .update(`${sourcePath}:${stat.size}:${stat.mtimeMs}:${sampleFormat.key}:${sampleRate}:${channelCnt}`)
      .digest('hex')
      .slice(0, 16);
    const previewPath = path.join(getAudioPreviewDir(), `${sanitizeFilePart(path.basename(sourcePath, ext))}-${previewKey}.wav`);

    fs.mkdirSync(path.dirname(previewPath), { recursive: true });

    if (!fs.existsSync(previewPath)) {
      const rawAudio = fs.readFileSync(sourcePath);
      fs.writeFileSync(previewPath, createWavBufferFromRawAudio(rawAudio, {
        sampleFormat: sampleFormat.key,
        sampleRate,
        channelCnt,
      }));
    }

    const previewBuffer = fs.readFileSync(previewPath);

    return {
      success: true,
      path: previewPath,
      url: bufferToDataUrl(previewBuffer, 'audio/wav'),
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('adb:enable-phone-keeplog', async (_event, payload = {}) => {
  const serial = String(payload.serial || '').trim();
  const packageName = String(payload.packageName || '').trim();

  if (!serial) {
    return { success: false, error: '请先选择手机设备' };
  }

  if (!packageName) {
    return { success: false, error: '请先填写手机 App 包名' };
  }

  const safePackageName = packageName.replace(/"/g, '\\"');
  const command = `cd /sdcard/Android/data/${safePackageName}/files/ && touch keeplog`;

  try {
    await runAdb(['-s', serial, 'shell', command], 10000);
    return {
      success: true,
      command: `${getAdbPath()} -s ${serial} shell "${command}"`,
    };
  } catch (error) {
    return {
      success: false,
      command: `${getAdbPath()} -s ${serial} shell "${command}"`,
      error: error.message,
    };
  }
});

ipcMain.handle('logs:pull-and-decode', async (_event, payload = {}) => {
  const { serial, requestId } = payload;
  const target = String(payload.target || 'glasses').trim();
  const packageName = String(payload.packageName || '').trim();
  const isPhoneTarget = target === 'phone';
  const sendProgress = (step, status, message, extra) => {
    sendLogProgress(_event, requestId, step, status, message, extra);
  };

  if (target !== 'phone' && target !== 'glasses') {
    return createLogPullFailure(new Error('不支持的历史日志设备类型'), { phase: 'preflight' });
  }

  if (!serial) {
    return createLogPullFailure(new Error(isPhoneTarget ? '请先选择手机设备' : '请先选择眼镜设备'), {
      phase: 'preflight',
      deviceType: target,
    });
  }

  if (!/^[A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)+$/.test(packageName)) {
    return createLogPullFailure(new Error('App 包名无效，请重新选择'), {
      phase: 'preflight',
      deviceType: target,
      packageName,
    });
  }

  let saveDialogResult;
  try {
    saveDialogResult = await dialog.showOpenDialog(mainWindow, {
      title: isPhoneTarget ? '选择手机历史日志保存目录' : '选择眼镜历史日志保存目录',
      properties: ['openDirectory', 'createDirectory'],
    });
  } catch (error) {
    return createLogPullFailure(error, { phase: 'choose-directory', deviceType: target });
  }

  if (saveDialogResult.canceled || saveDialogResult.filePaths.length === 0) {
    return { canceled: true };
  }

  const saveRootPath = saveDialogResult.filePaths[0];
  const savePath = path.join(saveRootPath, `${isPhoneTarget ? 'phone' : 'glasses'}-history-logs-${createTimestamp()}`);
  const pulledFilesPath = path.join(savePath, 'files');
  const zipPath = path.join(savePath, 'extLog.zip');

  if (isPhoneTarget) {
    const remoteLogsPath = `/sdcard/Android/data/${packageName}/files/logs`;
    const pulledLogsPath = path.join(savePath, 'logs');

    try {
      fs.mkdirSync(savePath, { recursive: true });
      sendProgress('pull', 'running', '正在从手机捞取历史日志...');
      await runAdb(['-s', serial, 'pull', remoteLogsPath, savePath], 180000);

      if (!fs.existsSync(pulledLogsPath)) {
        return {
          ...createLogPullFailure(new Error('日志已捞取，但没有找到 logs 文件夹'), {
            phase: 'pull',
            deviceType: target,
            packageName,
            remoteLogsPath,
            pullPath: savePath,
          }),
          pullPath: savePath,
        };
      }

      sendProgress('pull', 'success', '手机历史日志已捞取');
      sendProgress('done', 'success', '手机历史日志捞取完成', { outputPath: savePath });
      return {
        success: true,
        pullPath: savePath,
        remotePath: remoteLogsPath,
      };
    } catch (error) {
      sendProgress('failed', 'error', error.message);
      return {
        ...createLogPullFailure(error, {
          phase: 'pull',
          deviceType: target,
          packageName,
          remoteLogsPath,
          pullPath: savePath,
        }),
        pullPath: savePath,
      };
    }
  }

  try {
    fs.mkdirSync(savePath, { recursive: true });
    sendProgress('pull', 'running', '正在从眼镜拉取历史日志...');

    await runAdb([
      '-s',
      serial,
      'pull',
      `/sdcard/Android/data/${packageName}/files`,
      savePath,
    ], 180000);

    if (!fs.existsSync(pulledFilesPath)) {
      return {
        ...createLogPullFailure(new Error('日志已拉取，但没有找到 files 文件夹'), {
          phase: 'pull',
          deviceType: target,
          pullPath: savePath,
        }),
        pullPath: savePath,
      };
    }

    sendProgress('pull', 'success', '历史日志已拉取');
    sendProgress('zip', 'running', '正在压缩 files 文件夹...');

    await runCommandWithOptions('/usr/bin/zip', [
      '-qry',
      zipPath,
      'files',
    ], {
      cwd: savePath,
      timeout: 180000,
      maxBuffer: 1024 * 1024 * 20,
    });

    sendProgress('zip', 'success', '日志压缩完成');

    return {
      success: true,
      pullPath: savePath,
      zipPath,
      stdout: '原始日志已保存；如需解密，请使用快捷操作脚本配置外部解密器',
      stderr: '',
    };
  } catch (error) {
    sendProgress('failed', 'error', error.message);

    return {
      ...createLogPullFailure(error, {
        phase: 'pull',
        deviceType: target,
        pullPath: savePath,
        zipPath,
      }),
      pullPath: savePath,
    };
  }
});

registerApplicationHandler('quick-actions:list', async () => {
  const actions = refreshQuickActionsFromSource(readQuickActionsStore());
  writeQuickActionsStore(actions);
  return { success: true, actions, sessions: getQuickActionSessions().list() };
});

let quickActionGitBusy = false;
registerApplicationHandler('quick-actions:import-git', async (_event, payload = {}) => {
  if (quickActionGitBusy) return { success: false, error: '正在拉取脚本仓库，请稍候' };
  quickActionGitBusy = true;
  try {
    const { importGitScripts } = require('./quick-action-git');
    return await importGitScripts({
      root: path.join(app.getPath('userData'), 'quick-actions', 'repositories.noindex'),
      repoUrl: String(payload.repoUrl || '').trim(), branch: String(payload.branch || '').trim(), directory: String(payload.directory || '').trim(),
      run: (command, args) => runCommandWithOptions(command, args, buildGitCommandOptions({}, { timeout: 600000 })),
      readDefinition: readQuickActionDefinition, getActions: readQuickActionsStore,
      saveActions: (actions) => writeQuickActionsStore(refreshQuickActionsFromSource(actions)),
    });
  } catch (error) { return { success: false, error: error.message || '拉取脚本仓库失败' }; }
  finally { quickActionGitBusy = false; }
});

registerApplicationHandler('quick-actions:export-git', async (_event, payload = {}) => {
  if (quickActionGitBusy) return { success: false, error: '正在同步脚本仓库，请稍候' };
  quickActionGitBusy = true;
  try {
    const action = refreshQuickActionsFromSource(readQuickActionsStore()).find((item) => item.id === payload.id);
    if (!action) throw new Error('快捷操作不存在');
    const { exportGitScript } = require('./quick-action-git');
    return await exportGitScript({
      root: path.join(app.getPath('userData'), 'quick-actions', 'repositories.noindex'),
      repoUrl: String(payload.repoUrl || '').trim(), branch: String(payload.branch || '').trim(), directory: String(payload.directory || '').trim(), action,
      run: (command, args) => runCommandWithOptions(command, args, buildGitCommandOptions({}, { timeout: 600000 })),
    });
  } catch (error) { return { success: false, error: error.message || '上传快捷操作失败' }; }
  finally { quickActionGitBusy = false; }
});

registerApplicationHandler('quick-actions:visibility', async (_event, payload = {}) => {
  const actions = readQuickActionsStore();
  const action = actions.find((item) => item.id === payload.id);
  if (!action || typeof payload.show !== 'boolean') return { success: false, error: '快捷操作不存在或显示配置无效' };
  if (!payload.show && getQuickActionSessions().list()[payload.id]) return { success: false, error: '请先结束并导出，再隐藏快捷操作' };
  action.showInToolbar = payload.show;
  writeQuickActionsStore(actions);
  return { success: true, actions };
});

registerApplicationHandler('quick-actions:import-script', async (_event, payload = {}) => {
  try {
    if (payload.paths && (!Array.isArray(payload.paths) || !payload.paths.length || payload.paths.some(p => typeof p !== 'string' || !path.isAbsolute(p)))) throw Error('脚本必须提供绝对路径');
    const result = payload.paths ? { canceled: false, filePaths: payload.paths } : await dialog.showOpenDialog(mainWindow, {
      title: '选择快捷操作脚本',
      defaultPath: app.isPackaged
        ? path.join(process.resourcesPath, 'resources', 'quick-actions')
        : path.join(__dirname, '..', 'resources', 'quick-actions'),
      properties: ['openFile', 'multiSelections'],
      filters: process.platform === 'win32'
        ? [{ name: 'PC 脚本', extensions: ['ps1', 'cmd', 'bat'] }]
        : [{ name: 'PC 脚本', extensions: ['sh', 'ps1'] }],
    });
    if (result.canceled || result.filePaths.length === 0) return { success: false, canceled: true };

    const actions = readQuickActionsStore();
    const importedActions = result.filePaths.map((scriptPath) => {
      const definition = readQuickActionDefinition(scriptPath);
      const existingIndex = actions.findIndex((item) => item.scriptPath === definition.scriptPath);
      const existing = existingIndex >= 0 ? actions[existingIndex] : null;
      const preserveUserConfiguration = Boolean(existing?.userConfigured)
        || Boolean(existing?.inputOverrides && Object.keys(existing.inputOverrides).length)
        || Array.isArray(existing?.argsOverride);
      const action = {
        ...definition,
        ...existing,
        showInToolbar: existing ? existing.showInToolbar !== false : false,
        id: existing?.id || crypto.randomUUID(),
        ...(preserveUserConfiguration ? {
          name: existing.name || definition.name,
          description: existing.description || definition.description,
          configuredInputs: existing.configuredInputs || null,
          inputOverrides: existing.inputOverrides || {},
          argsOverride: existing.argsOverride || null,
          queryConfig: existing.queryConfig || null,
          userConfigured: true,
        } : {}),
        updatedAt: new Date().toISOString(),
      };
      if (existingIndex >= 0) actions[existingIndex] = action;
      else actions.push(action);
      return action;
    });
    const refreshedActions = refreshQuickActionsFromSource(actions);
    writeQuickActionsStore(refreshedActions);
    const importedIds = new Set(importedActions.map((action) => action.id));
    const refreshedImportedActions = refreshedActions.filter((action) => importedIds.has(action.id));
    return { success: true, action: refreshedImportedActions[0], importedActions: refreshedImportedActions, actions: refreshedActions };
  } catch (error) {
    return { success: false, error: error.message || '导入脚本失败' };
  }
});

registerApplicationHandler('quick-actions:update', async (_event, payload = {}) => {
  try {
    if (getQuickActionSessions().list()[payload.id]) return { success: false, error: '请先结束并导出，再修改该快捷操作' };
    const actions = readQuickActionsStore();
    const index = actions.findIndex((item) => item.id === payload.id);
    if (index < 0) return { success: false, error: '快捷操作不存在' };
    const name = String(payload.name || '').trim();
    if (!name) return { success: false, error: '展示名称不能为空' };
    const sourceInputs = Array.isArray(actions[index].inputs) ? actions[index].inputs : [];
    const requestedInputs = (Array.isArray(payload.inputs) ? payload.inputs : sourceInputs).map((input, inputIndex) => {
      const key = String(input?.key || '').trim();
      if (!/^[a-zA-Z_][a-zA-Z0-9_.-]*$/.test(key)) {
        throw new Error(`参数 ${inputIndex + 1} 的参数名只能以字母或下划线开头，并使用字母、数字、点、短横线或下划线`);
      }
      return {
        key,
        label: String(input?.label || key).trim() || key,
        type: ['text', 'number', 'boolean', 'select', 'file', 'directory', 'multiline'].includes(input?.type) ? input.type : 'text',
        required: Boolean(input?.required),
        userInput: input?.userInput !== false,
        defaultValue: input?.defaultValue == null ? '' : String(input.defaultValue),
        placeholder: input?.placeholder == null ? '' : String(input.placeholder),
        options: Array.isArray(input?.options) ? input.options.map((option) => {
          const value = typeof option === 'object' ? String(option?.value || '').trim() : String(option || '').trim();
          return value ? { label: typeof option === 'object' ? String(option?.label || value).trim() : value, value } : null;
        }).filter(Boolean) : [],
      };
    });
    const inputKeys = requestedInputs.map((input) => input.key);
    if (new Set(inputKeys).size !== inputKeys.length) return { success: false, error: '参数名不能重复' };
    for (const input of requestedInputs) {
      if (input.type !== 'select') continue;
      if (!input.options.length) return { success: false, error: `下拉参数 ${input.key} 至少需要一个选项` };
      const values = input.options.map((option) => option.value);
      if (new Set(values).size !== values.length) return { success: false, error: `下拉参数 ${input.key} 的实际传值不能重复` };
    }
    const rawQueryConfig = payload.queryConfig && typeof payload.queryConfig === 'object' ? payload.queryConfig : {};
    const sessionConfig = payload.sessionConfig?.enabled ? {
      enabled: true,
      startArgs: (payload.sessionConfig.startArgs || []).map(String),
      stopArgs: (payload.sessionConfig.stopArgs || []).map(String),
      exportArgs: (payload.sessionConfig.exportArgs || []).map(String),
    } : null;
    if (sessionConfig && rawQueryConfig.enabled) return { success: false, error: '开始／结束类型不能同时启用执行前查询，请关闭查询模式' };
    if (sessionConfig && [sessionConfig.startArgs, sessionConfig.stopArgs, sessionConfig.exportArgs].some((args) => !args.length)) return { success: false, error: '请配置开始、结束和导出参数' };
    const queryConfig = rawQueryConfig.enabled ? {
      enabled: true,
      showOnCard: Boolean(rawQueryConfig.showOnCard),
      args: Array.isArray(rawQueryConfig.args) ? rawQueryConfig.args.map(String) : [],
      resultPath: String(rawQueryConfig.resultPath || '').trim(),
      targetInputKey: String(rawQueryConfig.targetInputKey || '').trim(),
      rerunAfterExecute: Boolean(rawQueryConfig.rerunAfterExecute),
    } : { enabled: false, args: [], resultPath: '', targetInputKey: '', rerunAfterExecute: false };
    if (queryConfig.enabled && (!queryConfig.args.length || !queryConfig.resultPath || !requestedInputs.some((input) => input.key === queryConfig.targetInputKey))) {
      return { success: false, error: '请完整配置查询参数、结果字段和回填参数' };
    }
    actions[index] = {
      ...actions[index],
      name,
      description: String(payload.description ?? actions[index].description ?? '').trim(),
      inputs: requestedInputs,
      configuredInputs: requestedInputs,
      inputOverrides: {},
      args: Array.isArray(payload.args) ? payload.args.map(String) : actions[index].args,
      argsOverride: Array.isArray(payload.args) ? payload.args.map(String) : actions[index].argsOverride,
      queryConfig,
      sessionConfig,
      userConfigured: true,
      updatedAt: new Date().toISOString(),
    };
    writeQuickActionsStore(actions);
    const refreshedActions = refreshQuickActionsFromSource(actions);
    writeQuickActionsStore(refreshedActions);
    return { success: true, action: refreshedActions[index], actions: refreshedActions };
  } catch (error) {
    return { success: false, error: error.message || '保存快捷操作失败' };
  }
});

registerApplicationHandler('quick-actions:remove', async (_event, payload = {}) => {
  if (getQuickActionSessions().list()[payload.id]) return { success: false, error: '请先结束并导出，再删除快捷操作' };
  const actions = readQuickActionsStore().filter((item) => item.id !== payload.id);
  writeQuickActionsStore(actions);
  return { success: true, actions };
});

registerApplicationHandler('quick-actions:reorder', async (_event, payload = {}) => {
  const actions = readQuickActionsStore();
  const orderedIds = Array.isArray(payload.ids) ? payload.ids.map(String) : [];
  if (orderedIds.length !== actions.length || new Set(orderedIds).size !== actions.length) {
    return { success: false, error: '快捷操作排序数据不完整，请刷新后重试' };
  }
  const actionsById = new Map(actions.map((action) => [String(action.id), action]));
  if (orderedIds.some((id) => !actionsById.has(id))) {
    return { success: false, error: '快捷操作列表已变化，请刷新后重试' };
  }
  const reorderedActions = orderedIds.map((id) => actionsById.get(id));
  const refreshedActions = refreshQuickActionsFromSource(reorderedActions);
  writeQuickActionsStore(refreshedActions);
  return { success: true, actions: refreshedActions };
});

const quickActionApi = require('./quick-action-api').createQuickActionApi({
  invoke: invokeApplicationHandler, directory: () => app.getPath('userData'),
  notify: () => { if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('quick-actions:changed'); },
});
registerApplicationHandler('quick-actions:api', (event, payload = {}) => quickActionSignalScope.run(event?.quickActionSignal, () => quickActionApi(payload.action, payload.args, event)));

ipcMain.handle('quick-actions:select-path', async (_event, payload = {}) => {
  const directory = payload.type === 'directory';
  const result = await dialog.showOpenDialog(mainWindow, {
    title: directory ? '选择目录' : '选择文件',
    properties: [directory ? 'openDirectory' : 'openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return { success: false, canceled: true };
  return { success: true, path: result.filePaths[0] };
});

function createQuickActionContext(payload, action, runSuffix = '') {
  const outputDir = path.join(app.getPath('userData'), 'quick-action-runs', `${Date.now()}-${action.id}${runSuffix}`);
  fs.mkdirSync(outputDir, { recursive: true, mode: 0o700 });
  return {
    phoneSerial: String(payload.context?.phoneSerial || ''),
    glassesSerial: String(payload.context?.glassesSerial || ''),
    phonePackage: String(payload.context?.phonePackage || ''),
    glassesPackage: String(payload.context?.glassesPackage || ''),
    adbPath: getAdbPath(),
    outputDir,
    appDataDir: app.getPath('userData'),
    platform: process.platform,
    arch: process.arch,
    resourcesDir: app.isPackaged ? path.join(process.resourcesPath, 'resources') : path.join(__dirname, '..', 'resources'),
  };
}

async function runQuickActionProcess(action, args, values, context) {
  const execution = buildQuickActionExecution(action);
  const inputEnvironment = Object.fromEntries(Object.entries(values || {}).map(([key, value]) => [
    `GLASSBOX_INPUT_${String(key).replace(/[^a-zA-Z0-9]/g, '_').toUpperCase()}`,
    String(value ?? ''),
  ]));
  return runCommandWithOptions(execution.command, [...execution.prefixArgs, ...args], {
    cwd: path.dirname(action.scriptPath),
    timeout: action.timeoutSeconds * 1000,
    maxBuffer: 1024 * 1024 * 10,
    env: getAdbAwareCommandEnv({
      ...inputEnvironment,
      GLASSBOX_CONTEXT: JSON.stringify(context),
      GLASSBOX_INPUTS: JSON.stringify(values || {}),
      GLASSBOX_OUTPUT_DIR: context.outputDir,
      GLASSBOX_EXECUTABLE: process.execPath,
      GLASSBOX_QUICK_ACTION_HELPER: path.join(__dirname, 'quick-action-helper.js'),
      GLASSBOX_RESOURCES_DIR: context.resourcesDir,
    }),
  });
}

function readQuickActionResultPath(value, resultPath) {
  return String(resultPath || '').split('.').filter(Boolean).reduce((current, key) => current?.[key], value);
}

async function queryQuickAction(action, payload, runSuffix = '-query') {
  const queryConfig = action.queryConfig;
  if (!queryConfig?.enabled) throw new Error('该快捷操作未配置执行前查询');
  const context = createQuickActionContext(payload, action, runSuffix);
  // Write-only required inputs (e.g. a target choice) must not block a read query.
  const values = resolveQuickActionInputValues({ ...action, inputs: action.inputs.map((input) => ({ ...input, required: false })) }, payload.values || {}, context);
  const args = queryConfig.args.map((argument) => resolveTemplate(argument, values, context));
  if (args.some((argument) => !argument.trim() || /\{\{[^}]+\}\}/.test(argument))) throw new Error('查询参数未填写完整，请配置参数默认值或选择设备');
  const result = await runQuickActionProcess(action, args, values, context);
  let data;
  try { data = JSON.parse(String(result.stdout || '').trim()); } catch (_error) { throw new Error('查询脚本输出不是合法 JSON'); }
  const resultValue = readQuickActionResultPath(data, queryConfig.resultPath);
  if (resultValue == null) throw new Error(`查询结果中不存在字段 ${queryConfig.resultPath}`);
  return { success: true, data, resultValue: String(resultValue), stdout: String(result.stdout || '').trim(), stderr: String(result.stderr || '').trim() };
}

registerApplicationHandler('quick-actions:query', async (_event, payload = {}) => {
  const action = refreshQuickActionsFromSource(readQuickActionsStore()).find((item) => item.id === payload.id);
  if (!action) return { success: false, error: '快捷操作不存在，请重新导入脚本' };
  try { return await queryQuickAction(action, payload); } catch (error) {
    return { success: false, error: error.message || '查询快捷操作状态失败', stdout: String(error.stdout || '').trim(), stderr: String(error.stderr || '').trim() };
  }
});

let quickActionSessions;
function getQuickActionSessions() {
  if (!quickActionSessions) quickActionSessions = require('./quick-action-session').createSessionManager(
    path.join(app.getPath('userData'), 'quick-actions', 'sessions.json'),
    async (session, phase) => {
      const args = session.action.sessionConfig[`${phase}Args`].map((arg) => resolveTemplate(arg, session.values, session.context));
      if (args.some((arg) => /\{\{[^}]+\}\}/.test(arg))) throw new Error('会话参数包含未解析的变量');
      const result = await runQuickActionProcess(session.action, args, session.values, session.context);
      const outputDir = String(result.stdout || '').split(/\r?\n/).find((line) => line.startsWith('LENSWIPER_OUTPUT_DIR='))?.slice(21);
      return { ...result, outputDir: outputDir && path.isAbsolute(outputDir) && fs.existsSync(outputDir) && fs.statSync(outputDir).isDirectory() ? outputDir : session.context.outputDir };
    }
  );
  return quickActionSessions;
}

const quickActionExecutions = new Set();
registerApplicationHandler('quick-actions:execute', async (_event, payload = {}) => {
  if (quickActionExecutions.has(payload.id)) return { success: false, error: '该快捷操作正在执行，请勿重复执行' };
  const action = refreshQuickActionsFromSource(readQuickActionsStore()).find((item) => item.id === payload.id);
  if (!action) return { success: false, error: '快捷操作不存在，请重新导入脚本' };
  quickActionExecutions.add(payload.id);
  try {
    const context = createQuickActionContext(payload, action);
    const sessions = getQuickActionSessions();
    if (payload.expectedPhase && !action.sessionConfig?.enabled && !sessions.list()[action.id] && payload.expectedPhase !== 'run') throw Error('普通快捷操作只能执行run');
    if (action.sessionConfig?.enabled || sessions.list()[action.id]) {
      const values = sessions.list()[action.id] ? {} : resolveQuickActionInputValues(action, payload.values || {}, context);
      return await sessions.execute(action.id, action, values, context, payload.expectedPhase);
    }
    const args = resolveQuickActionArguments(action, payload.values || {}, context);
    const resolvedValues = resolveQuickActionInputValues(action, payload.values || {}, context);
    const result = await runQuickActionProcess(action, args, resolvedValues, context);
    const queryResult = action.queryConfig?.rerunAfterExecute ? await queryQuickAction(action, payload, '-verify') : null;
    // Optional generic script output contract; never interpret output as a command.
    const reportedOutputDir = String(result.stdout || '').split(/\r?\n/).find((line) => line.startsWith('LENSWIPER_OUTPUT_DIR='))?.slice('LENSWIPER_OUTPUT_DIR='.length);
    const outputDir = reportedOutputDir && path.isAbsolute(reportedOutputDir) && fs.existsSync(reportedOutputDir) && fs.statSync(reportedOutputDir).isDirectory()
      ? reportedOutputDir : context.outputDir;
    return {
      success: true,
      outputDir,
      stdout: String(result.stdout || '').trim(),
      stderr: String(result.stderr || '').trim(),
      queryResult,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message || '脚本执行失败',
      stdout: String(error.stdout || '').trim(),
      stderr: String(error.stderr || '').trim(),
    };
  } finally { quickActionExecutions.delete(payload.id); }
});

ipcMain.handle('shell:open-path', async (_event, targetPath) => {
  if (!targetPath) {
    return { success: false, error: 'Missing path' };
  }

  const error = await shell.openPath(targetPath);

  return {
    success: !error,
    error,
  };
});

ipcMain.handle('shell:show-item-in-folder', async (_event, targetPath) => {
  if (!targetPath) {
    return {
      success: false,
      error: 'Missing path',
    };
  }

  try {
    shell.showItemInFolder(targetPath);
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('file:save-text', async (_event, payload = {}) => {
  const content = typeof payload.content === 'string' ? payload.content : '';
  const defaultPath = typeof payload.defaultPath === 'string' ? payload.defaultPath : 'export.txt';
  const filters = Array.isArray(payload.filters) ? payload.filters : undefined;

  try {
    const saveResult = await dialog.showSaveDialog(mainWindow, {
      title: payload.title || '保存文件',
      defaultPath,
      filters,
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { success: false, canceled: true };
    }

    fs.mkdirSync(path.dirname(saveResult.filePath), { recursive: true });
    fs.writeFileSync(saveResult.filePath, content, 'utf8');

    return {
      success: true,
      filePath: saveResult.filePath,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('file:read-image-data-url', async (_event, targetPath) => {
  if (!targetPath) {
    return { success: false, error: 'Missing path' };
  }

  try {
    const resolvedPath = path.resolve(targetPath);
    const extension = path.extname(resolvedPath).toLowerCase();
    const mimeTypes = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.webp': 'image/webp',
      '.gif': 'image/gif',
      '.bmp': 'image/bmp',
    };
    const mimeType = mimeTypes[extension];

    if (!mimeType) {
      return { success: false, error: 'Unsupported image type' };
    }

    const buffer = fs.readFileSync(resolvedPath);
    return {
      success: true,
      dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}`,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

ipcMain.handle('shell:open-external', async (_event, targetUrl) => {
  try {
    const url = new URL(String(targetUrl));
    if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许打开 HTTP/HTTPS 链接');
    await shell.openExternal(url.toString());
    return { success: true };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
});

registerApplicationHandler('environment:get-config', async () => {
  const config = readEnvironmentConfig();
  const effectiveAdbPath = getAdbPath();

  return {
    success: true,
    config: {
      adbPath: config.adbPath || '',
      ttsProvider: normalizeTtsConfig(config.ttsProvider || {}),
      analytics: normalizeAnalyticsConfig(config.analytics || {}),
    },
    effectiveAdbPath,
  };
});

registerApplicationHandler('environment:save-config', async (_event, payload = {}) => {
  const adbPath = String(payload.adbPath || '').trim();
  const ttsProvider = normalizeTtsConfig(payload.ttsProvider || readEnvironmentConfig().ttsProvider || {});
  const analytics = normalizeAnalyticsConfig(payload.analytics || readEnvironmentConfig().analytics || {});

  if (adbPath && !fs.existsSync(adbPath)) {
    return {
      success: false,
      error: 'ADB 路径不存在，请检查后再保存',
    };
  }

  const config = writeEnvironmentConfig({ adbPath, ttsProvider, analytics });

  if (payload.validateAdb === false) {
    return {
      success: true,
      config: {
        ...config,
        ttsProvider: normalizeTtsConfig(config.ttsProvider || {}),
      },
      effectiveAdbPath: getAdbPath(),
    };
  }

  try {
    const result = await runCommand(getAdbPath(), ['version'], 5000);
    return {
      success: true,
      config: {
        ...config,
        ttsProvider: normalizeTtsConfig(config.ttsProvider || {}),
      },
      effectiveAdbPath: getAdbPath(),
      adbVersion: result.stdout.trim(),
    };
  } catch (error) {
    return {
      success: false,
      config: {
        ...config,
        ttsProvider: normalizeTtsConfig(config.ttsProvider || {}),
      },
      effectiveAdbPath: getAdbPath(),
      error: error.message,
    };
  }
});

ipcMain.handle('tts:test-provider', async (_event, payload = {}) => {
  try {
    const params = payload.params && typeof payload.params === 'object' && !Array.isArray(payload.params)
      ? payload.params
      : {};
    const result = await synthesizeTtsAudio(String(params.text || ''), {
      provider: payload.provider,
      stepId: 'tts-test',
      params,
      outputFormat: payload.provider?.outputExtension || 'pcm',
      sampleRate: 16000,
      sampleFormat: 'AV_SAMPLE_FMT_S16',
    });

    return result;
  } catch (error) {
    return {
      success: false,
      error: error.message,
      errorCode: error.code || 'TTS_TEST_FAILED',
      diagnostics: error.diagnostics || (error.httpResponse ? {
        schemaVersion: 'glassbox.http-response.v1',
        errorCode: error.code || 'TTS_TEST_FAILED',
        message: error.message,
        httpResponse: error.httpResponse,
      } : undefined),
      httpResponse: error.httpResponse,
    };
  }
});

ipcMain.handle('case-library:check-git-lfs', async () => {
  try {
    const runtime = gitRuntimeCommand('git', ['lfs', 'version'], { isPackaged: app.isPackaged, resourcesPath: app.isPackaged ? process.resourcesPath : path.join(__dirname, '..', 'resources') });
    const result = await runCommandWithOptions('git', ['lfs', 'version'], { timeout: 5000 });
    return { success: true, installed: true, source: runtime.source, executable: runtime.executable, version: result.stdout.trim() || result.stderr.trim() };
  } catch (error) {
    return { success: false, installed: false, source: app.isPackaged ? 'bundled' : 'system', errorCode: error.code || 'GIT_LFS_UNAVAILABLE', error: app.isPackaged ? `内置 Git LFS 检测失败，请修复或重新安装 solopi-desktop：${error.message}` : error.message };
  }
});

ipcMain.handle('case-library:install-git-lfs-homebrew', async () => {
  if (app.isPackaged) return { success: false, errorCode: 'BUNDLED_GIT_LFS_UNAVAILABLE', error: '安装版使用内置 Git LFS，请修复或重新安装 solopi-desktop，无需安装 Homebrew。' };
  if (process.platform !== 'darwin') {
    return { success: false, error: '请安装系统 Git 和 Git LFS 后重新检测；此安装按钮仅支持 macOS Homebrew' };
  }
  try {
    // Explicit user action only. Never upgrade an existing installation.
    const result = await runCommandWithOptions('/bin/zsh', ['-lc',
      'command -v brew >/dev/null || exit 127; git --version >/dev/null 2>&1 || brew install git; git lfs version >/dev/null 2>&1 || brew install git-lfs; git --version && git lfs version'
    ], { timeout: 600000, maxBuffer: 1024 * 1024 * 20, env: { ...getDesktopCommandEnv(), HOMEBREW_NO_AUTO_UPDATE: '1' } });
    return { success: true, output: result.stdout };
  } catch (error) {
    return { success: false, error: '系统 Git 工具安装失败，请确认已安装 Homebrew，或手动安装 Git / Git LFS 后重新检测：' + error.message };
  }
});

const caseLibraryApi = require('./case-library-api').createCaseLibraryApi({
  dataDir:getGlassBoxDataDir(),readState:()=>({path:getWorkflowStatePath(),state:readWorkflowState()||{}}),
  loadCodec:()=>import(require('node:url').pathToFileURL(app.isPackaged?path.join(process.resourcesPath,'cli','glassbox-cli.mjs'):path.join(__dirname,'..','scripts','glassbox-cli.mjs')).href),
  writeState:async(next,fields=['caseLibraries','caseFolders','cases','components','caseEdges','nodePositions','selectedCaseLibraryId','selectedCaseId'])=>{
    caseUpdateQueue=caseUpdateQueue.catch(()=>{}).then(async()=>{
      const patch=Object.fromEntries(fields.filter(k=>next[k]!==undefined).map(k=>[k,next[k]]));
      if (fields.includes('cases')) {
        const current = readWorkflowState() || {};
        for (const library of next.caseLibraries || []) caseEditGuard.assertLibraryApplySafe(current, { libraryId: library.id, cases: (next.cases || []).filter(c => caseEditGuard.libraryOf(next, c) === library.id), caseEdges: next.caseEdges, components: next.components });
      }
      if(mainWindow&&!mainWindow.isDestroyed()&&!mainWindow.webContents.isDestroyed()){
        const result=await createConfigurationBridge({readState:()=>readWorkflowState()||{},sender:()=>mainWindow.webContents,pending:pendingCaseUpdates,preparePatch:()=>prepareSecretsForDisplay(protectSecrets(patch,safeStorage))})(null);
        if(!result.success)throw Error(result.error);
      }else writeWorkflowState({...readWorkflowState(),...patch});
      return getWorkflowStatePath();
    });return caseUpdateQueue;
  },
});
registerApplicationHandler('case-library:api',(_event,payload={})=>caseLibraryApi(payload.action,payload.args));

registerApplicationHandler('case-library:pull-git-repo', async (_event, payload = {}) => {
  const repoUrl = String(payload.repoUrl || '').trim();
  const branch = normalizeGitBranch(payload.branch);
  const authRepoUrl = buildAuthenticatedGitUrl(repoUrl, payload.authUsername, payload.authToken);

  if (!repoUrl) {
    return {
      success: false,
      needsGitLfs: false,
      error: '请先填写 Git 用例库地址',
    };
  }

  try {
    await runCommandWithOptions('git', ['--version'], { timeout: 5000 });
  } catch (error) {
    return {
      success: false,
      needsGitLfs: false,
      errorCode: error.code,
      error: error.code === 'BUNDLED_GIT_LFS_UNAVAILABLE' ? error.message : `当前电脑未检测到 Git：${error.message}`,
    };
  }

  try {
    await runCommandWithOptions('git', ['lfs', 'version'], { timeout: 5000 });
  } catch (error) {
    return {
      success: false,
      needsGitLfs: !app.isPackaged,
      errorCode: error.code || 'GIT_LFS_UNAVAILABLE',
      error: error.message,
    };
  }

  try {
    const rootDir = getCaseLibrariesRoot();
    const repoId = getCaseLibraryRepoId(repoUrl, branch);
    const repoPath = path.join(rootDir, repoId);

    fs.mkdirSync(rootDir, { recursive: true });

    if (fs.existsSync(path.join(repoPath, '.git'))) {
      await runCommandWithOptions('git', ['remote', 'set-url', 'origin', authRepoUrl], buildGitCommandOptions(payload, { cwd: repoPath, timeout: 10000 }));
      await checkoutCaseLibraryBranch(repoPath, branch, payload);
    } else if (fs.existsSync(repoPath)) {
      throw new Error(`本地缓存目录已存在但不是 Git 仓库：${repoPath}`);
    } else {
      await runCommandWithOptions('git', ['clone', '--branch', branch, authRepoUrl, repoPath], buildGitCommandOptions(payload, { timeout: 1000 * 60 * 10 }));
    }

    await runCommandWithOptions('git', ['lfs', 'install', '--local'], { cwd: repoPath, timeout: 10000 });
    await runCommandWithOptions('git', ['lfs', 'pull'], buildGitCommandOptions(payload, { cwd: repoPath, timeout: 1000 * 60 * 10 }));
    await runCommandWithOptions('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: repoPath, timeout: 10000 }).catch(() => null);
    const gitInfo = await getGitRepoInfo(repoPath);

    const manifestPath = path.join(repoPath, 'manifest.json');
    const manifest = readJsonFileIfExists(manifestPath) || {
      schemaVersion: 'glassbox.case-library.v1',
      name: path.basename(repoPath),
      casesRoot: 'cases',
      assetsRoot: 'assets',
    };
    const files = readCaseLibraryFiles(repoPath, manifest).map((file) => ({
      ...file,
      content: hydrateCaseLibraryFileContent(file, repoPath),
    }));

    return {
      success: true,
      repoPath,
      repoId,
      manifest,
      gitInfo,
      files,
    };
  } catch (error) {
    return {
      success: false,
      needsGitLfs: false,
      errorCode: error.code,
      error: stripGitCredentialFromMessage(error.message),
    };
  }
});

ipcMain.handle('case-library:reload-local', async (_event, payload = {}) => {
  const result = await reloadLocalCaseLibrary(payload, { includeGitInfo: true });
  if (result.success) {
    localCaseLibraryWatcherManager?.markRevision(result.libraryId, result.revision);
    localCaseLibraryErrorSignatures.delete(result.libraryId);
  }
  return result;
});

ipcMain.handle('case-library:push-git-repo', async (_event, payload = {}) => {
  let uploadSnapshot;
  try { uploadSnapshot = require('./case-library-upload-sync').captureUpload(payload); }
  catch (error) { return { success: false, error: error.message }; }
  const repoUrl = String(payload.repoUrl || '').trim();
  const branch = normalizeGitBranch(payload.branch);
  const authRepoUrl = buildAuthenticatedGitUrl(repoUrl, payload.authUsername, payload.authToken);
  const libraryName = String(payload.libraryName || 'solopi-desktop 用例库').trim();
  const cases = Array.isArray(payload.cases) ? payload.cases : [];
  const components = Array.isArray(payload.components) ? payload.components : [];
  const folders = Array.isArray(payload.folders) ? payload.folders : [];
  const caseEdges = payload.caseEdges && typeof payload.caseEdges === 'object' ? payload.caseEdges : {};
  const nodePositions = payload.nodePositions && typeof payload.nodePositions === 'object' ? payload.nodePositions : {};
  const canonicalCases = cases.map((testCase) => ({
    ...testCase,
    edges: Array.isArray(caseEdges[testCase?.id])
      ? caseEdges[testCase.id]
      : (Array.isArray(testCase?.edges) ? testCase.edges : createWorkflowEdgesFromSteps(testCase?.steps || [])),
  }));

  if (!repoUrl) {
    return { success: false, error: '当前库未配置 Git 仓库地址' };
  }

  try {
    await runCommandWithOptions('git', ['--version'], { timeout: 5000 });
    await runCommandWithOptions('git', ['lfs', 'version'], { timeout: 5000 });

    const rootDir = getCaseLibrariesRoot();
    const repoId = getCaseLibraryRepoId(repoUrl, branch);
    const repoPath = path.join(rootDir, repoId);
    fs.mkdirSync(rootDir, { recursive: true });

    if (fs.existsSync(path.join(repoPath, '.git'))) {
      await runCommandWithOptions('git', ['remote', 'set-url', 'origin', authRepoUrl], buildGitCommandOptions(payload, { cwd: repoPath, timeout: 10000 }));
      await checkoutCaseLibraryBranch(repoPath, branch, payload);
    } else if (fs.existsSync(repoPath)) {
      throw new Error(`本地缓存目录已存在但不是 Git 仓库：${repoPath}`);
    } else {
      await runCommandWithOptions('git', ['clone', '--branch', branch, authRepoUrl, repoPath], buildGitCommandOptions(payload, { timeout: 1000 * 60 * 10 }));
    }

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
    const archivedCases = archiveCaseLibraryAssets(canonicalCases, repoPath, assetsRoot);
    const archivedComponents = archiveCaseLibraryAssets(components, repoPath, assetsRoot, archivedCases.copiedAssets);
    const ttsTemplate = createCaseLibraryTtsTemplate(canonicalCases);
    const ttsTemplateFile = ttsTemplate ? 'settings/tts-provider.template.json' : '';

    const workspacePayload = {
      schemaVersion: 'glassbox.case-library.workspace.v1',
      name: libraryName,
      folders: folders.map((folder) => ({
        id: folder.id,
        name: folder.name,
        parentId: folder.parentId,
        expanded: folder.expanded !== false,
      })),
      cases: archivedCases.value,
      components: archivedComponents.value,
      caseEdges,
      nodePositions,
      dependencies: {
        ttsProviderTemplate: ttsTemplateFile,
        ttsNodeCount: ttsTemplate?.workflowUsage?.length || 0,
      },
      updatedAt,
    };

    fs.writeFileSync(manifestPath, JSON.stringify({
      schemaVersion: 'glassbox.case-library.v1',
      name: libraryName,
      casesRoot: 'cases',
      assetsRoot,
      workspaceFile: `cases/${workspaceFileName}`,
      ttsProviderTemplate: ttsTemplateFile,
      folderCount: folders.length,
      caseCount: cases.length,
      assetCount: archivedComponents.copiedAssets.size,
      updatedAt,
    }, null, 2));
    fs.writeFileSync(path.join(casesDir, workspaceFileName), JSON.stringify(workspacePayload, null, 2));
    const uploadedWorkspaceBytes = fs.readFileSync(path.join(casesDir, workspaceFileName), 'utf8');
    const confirmUploadedSnapshot = async () => {
      try {
      if (fs.readFileSync(path.join(casesDir, workspaceFileName), 'utf8') !== uploadedWorkspaceBytes) {
        return { synchronizedCaseIds: [], skippedCaseIds: cases.map(c => c.id), cases: [], warning: '上传期间用例库文件发生变化，本地修改仍保留，请重新比较' };
      }
      const committed = await runCommandWithOptions('git', ['show', `HEAD:cases/${workspaceFileName}`], { cwd: repoPath, timeout: 10000, maxBuffer: 1024 * 1024 * 20 });
      if (committed.stdout !== uploadedWorkspaceBytes || fs.readFileSync(path.join(casesDir, workspaceFileName), 'utf8') !== uploadedWorkspaceBytes) return { synchronizedCaseIds: [], skippedCaseIds: cases.map(c => c.id), cases: [], warning: 'Git上传已完成，但提交内容与导出快照不同，本地修改已保留' };
      const sync = require('./case-library-upload-sync').reconcileUpload(readWorkflowState() || {}, uploadSnapshot,
        hydrateCaseLibraryAssets(workspacePayload.cases, repoPath));
      if (sync.synchronizedCaseIds.length) writeWorkflowState(sync.state);
      require('./diagnostics').record({ event: 'case-library.upload-sync', libraryId: payload.libraryId || '', status: !uploadSnapshot ? 'legacy-no-provenance' : sync.skippedCaseIds.length ? 'local-changes-preserved' : 'synchronized', protectedCaseCount: sync.synchronizedCaseIds.length, conflictCount: sync.skippedCaseIds.length });
      const { state: _state, ...receipt } = sync;
      return receipt;
      } catch (error) {
        require('./diagnostics').record({ event: 'case-library.upload-sync', libraryId: payload.libraryId || '', status: 'pending', code: error.code || 'UPLOAD_SYNC_FAILED' });
        return { synchronizedCaseIds: [], skippedCaseIds: cases.map(c => c.id), cases: [], warning: 'Git上传已完成，但本地同步确认失败；当前修改已保留，请重新比较' };
      }
    };
    if (ttsTemplate) {
      fs.writeFileSync(path.join(settingsDir, 'tts-provider.template.json'), JSON.stringify(ttsTemplate, null, 2));
    }

    await runCommandWithOptions('git', ['lfs', 'install', '--local'], { cwd: repoPath, timeout: 10000 });
    await runCommandWithOptions('git', ['lfs', 'track', 'assets/audio/*.pcm', 'assets/audio/*.wav', 'assets/audio/*.ogg', 'assets/audio/*.spx', 'assets/audio/*.speex', 'assets/audio/*.mp3', 'assets/audio/*.m4a', 'assets/audio/*.webm', 'assets/images/*.png', 'assets/images/*.jpg', 'assets/images/*.jpeg', 'assets/images/*.webp', 'assets/images/*.gif', 'assets/images/*.bmp'], {
      cwd: repoPath,
      timeout: 1000 * 60,
    });

    await runCommandWithOptions('git', ['add', '-A', 'manifest.json', 'cases', 'assets', 'settings', '.gitattributes'], {
      cwd: repoPath,
      timeout: 1000 * 60,
    });

    const status = await runCommandWithOptions('git', ['status', '--porcelain'], {
      cwd: repoPath,
      timeout: 10000,
    });

    if (!status.stdout.trim()) {
      await runCommandWithOptions('git', ['push', 'origin', branch], buildGitCommandOptions(payload, {
        cwd: repoPath,
        timeout: 1000 * 60 * 5,
        maxBuffer: 1024 * 1024 * 20,
      }));
      await runCommandWithOptions('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: repoPath, timeout: 10000 }).catch(() => null);
      const gitInfo = await getGitRepoInfo(repoPath);
      return {
        success: true,
        uploadSync: await confirmUploadedSnapshot(),
        repoPath,
        gitInfo,
        folderCount: folders.length,
        caseCount: cases.length,
        assetCount: archivedComponents.copiedAssets.size,
        workspaceFile: `cases/${workspaceFileName}`,
        message: `本地无新增变更，已同步远端（${folders.length} 个文件夹 / ${cases.length} 个用例 / ${archivedComponents.copiedAssets.size} 个音频资产）`,
      };
    }

    await runCommandWithOptions('git', ['commit', '-m', `chore: update ${libraryName} cases`], {
      cwd: repoPath,
      timeout: 1000 * 60,
    });
    await runCommandWithOptions('git', ['push', 'origin', branch], buildGitCommandOptions(payload, {
      cwd: repoPath,
      timeout: 1000 * 60 * 5,
      maxBuffer: 1024 * 1024 * 20,
    }));
    await runCommandWithOptions('git', ['remote', 'set-url', 'origin', repoUrl], { cwd: repoPath, timeout: 10000 }).catch(() => null);
    const gitInfo = await getGitRepoInfo(repoPath);

    return {
      success: true,
      uploadSync: await confirmUploadedSnapshot(),
      repoPath,
      gitInfo,
      folderCount: folders.length,
      caseCount: cases.length,
      assetCount: archivedComponents.copiedAssets.size,
      workspaceFile: `cases/${workspaceFileName}`,
      message: `上传完成（${folders.length} 个文件夹 / ${cases.length} 个用例 / ${archivedComponents.copiedAssets.size} 个音频资产）`,
    };
  } catch (error) {
    return {
      success: false,
      errorCode: error.code,
      error: stripGitCredentialFromMessage(error.message),
    };
  }
});

function createWindow() {
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    show: desktopModeRequested,
    titleBarStyle: 'hiddenInset', // 苹果风格的无边框，但保留控制按钮
    trafficLightPosition: { x: 18, y: 18 },
    icon: getGlassBoxAppIconPath(),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webviewTag: true,
    },
  });

  // 如果是开发环境，加载 webpack 开发服务器
  mainWindow.webContents.on('will-navigate', (event) => event.preventDefault());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  mainWindow.webContents.on('will-attach-webview', (event, preferences, params) => {
    if (!/^https?:\/\//i.test(params.src || '')) return event.preventDefault();
    delete preferences.preload;
    preferences.nodeIntegration = false;
    preferences.contextIsolation = true;
    preferences.sandbox = true;
  });
  if (!app.isPackaged && process.env.NODE_ENV === 'development') {
    const devUrl = process.env.ELECTRON_RENDERER_URL || 'http://127.0.0.1:5173';
    console.log(`[electron] loading ${devUrl}`);
    mainWindow.loadURL(devUrl);
  } else {
    // 生产环境加载构建后的文件
    const indexPath = path.join(__dirname, '../dist/index.html');
    console.log(`[electron] loading ${indexPath}`);
    mainWindow.loadFile(indexPath, process.env.LENSWIPER_UI_SMOKE === '1'
      ? { query: { 'ui-smoke': 'tasks' } }
      : {});
  }

  mainWindow.webContents.on('did-fail-load', (_event, errorCode, errorDescription, validatedURL) => {
    console.error(`[electron] did-fail-load ${errorCode} ${errorDescription}: ${validatedURL}`);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    console.log(`[electron] did-finish-load ${mainWindow?.webContents.getURL() || ''}`);
    flushPendingLocalCaseLibraryEvents();
    mainWindow?.webContents.executeJavaScript(
      `(() => {
        const root = document.getElementById('root');
        return {
          title: document.title,
          bodyTextLength: document.body?.innerText?.length || 0,
          rootChildCount: root?.childElementCount || 0,
          rootHtmlLength: root?.innerHTML?.length || 0,
        };
      })()`,
      true
    ).then((result) => {
      console.log(`[electron] renderer-ready ${JSON.stringify(result)}`);
    }).catch((error) => {
      console.error(`[electron] renderer-ready failed: ${error.message}`);
    });
  });

  mainWindow.webContents.on('console-message', (_event, level, message, line, sourceId) => {
    console.log(`[renderer:${level}] ${message} (${sourceId}:${line})`);
  });

  mainWindow.webContents.on('render-process-gone', (_event, details) => {
    void getRuntimeDiagnostics().recover(mainWindow, dialog, shell, 'renderer-crash', { reason: details.reason, exitCode: details.exitCode }).catch(error => console.error('[recovery]', error));
  });

  mainWindow.webContents.on('unresponsive', () => {
    void getRuntimeDiagnostics().recover(mainWindow, dialog, shell, 'renderer-unresponsive').catch(error => console.error('[recovery]', error));
  });

  mainWindow.once('ready-to-show', () => {
    if (!desktopModeRequested) {
      mainWindow.hide();
      return;
    }
    showMainWindow();
  });

  mainWindow.on('close', () => {
    // Closing the desktop must not silently hand its tasks to a hidden broker.
    isQuitting = true;
  });

  mainWindow.on('closed', () => {
    mainWindow = null;

    if (isQuitting) {
      app.quit();
    }
  });
}

function hasCliBackgroundArg(argv = []) {
  return Array.isArray(argv) && argv.includes('--glassbox-background');
}

function shouldSuppressForeground() {
  return !desktopModeRequested || Date.now() < suppressForegroundUntil;
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) {
    createWindow();
    return;
  }

  if (shouldSuppressForeground()) {
    return;
  }

  if (mainWindow.isMinimized()) {
    mainWindow.restore();
  }
  mainWindow.show();
  mainWindow.focus();
}

function hasActiveBrokerWork() {
  return pendingCliBrokerRequests > 0 || bugreportJobs.hasActive() || activeWorkflowTasks.size > 0 || activeWorkflowRuntimes.size > 0;
}

function promoteToDesktop() {
  desktopModeRequested = true;
  cliBackgroundMode = false;
  suppressForegroundUntil = 0;
  try {
    app.setActivationPolicy?.('regular');
    applyMacDockIcon();
    app.dock?.show?.();
  } catch (error) {
    console.warn(`[broker] failed to promote to desktop mode: ${error.message}`);
  }
  createWindow();
  showMainWindow();
}

function maybeQuitIdleBackgroundBroker() {
  setImmediate(() => {
    if (desktopModeRequested || hasActiveBrokerWork() || isQuitting) {
      return;
    }
    isQuitting = true;
    app.quit();
  });
}

function getArgValue(argv, name) {
  const values = Array.isArray(argv) ? argv : [];
  const index = values.indexOf(name);
  if (index >= 0) {
    return String(values[index + 1] || '').trim();
  }
  const inlineValue = values.find((value) => String(value || '').startsWith(`${name}=`));
  return inlineValue ? String(inlineValue).slice(name.length + 1).trim() : '';
}

function getCliRunPayloadPath(argv = process.argv) {
  return getArgValue(argv, '--glassbox-cli-run-payload');
}

function getCliRunTaskPayloadPath(argv = process.argv) {
  return getArgValue(argv, '--glassbox-cli-run-task-payload');
}

function getCliControlPayloadPath(argv = process.argv) {
  return getArgValue(argv, '--glassbox-cli-control-payload');
}

function createSingleInstanceRequestData(argv = process.argv) {
  return {
    source: isCliRunMode ? 'cli' : 'desktop',
    dataDir: app.getPath('userData'),
    taskPayloadPath: getCliRunTaskPayloadPath(argv),
    casePayloadPath: getCliRunPayloadPath(argv),
    controlPayloadPath: getCliControlPayloadPath(argv),
  };
}

function appendCliBrokerLog(payloadPath, event, details = {}) {
  try {
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const logPath = String(payload.__headlessBrokerLogPath || '').trim();
    if (!logPath) {
      return;
    }
    fs.mkdirSync(path.dirname(logPath), { recursive: true });
    fs.appendFileSync(logPath, `${JSON.stringify({
      timestamp: new Date().toISOString(),
      pid: process.pid,
      event,
      payloadPath,
      ...details,
    })}\n`);
  } catch (_error) {
    // The structured ACK remains the primary observability channel.
  }
}

function writeCliBrokerRequestFailure(kind, payloadPath, error) {
  appendCliBrokerLog(payloadPath, 'broker-request-failed', {
    kind,
    error: error instanceof Error ? error.message : String(error),
    errorCode: error?.code || '',
  });
  if (kind !== 'task') {
    return;
  }
  try {
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const ackPath = String(payload.__headlessAckPath || '').trim();
    if (!ackPath) {
      return;
    }
    writeJsonFileAtomic(ackPath, {
      schemaVersion: 'glassbox.headlessTaskAck.v1',
      createdAt: new Date().toISOString(),
      success: false,
      submitted: false,
      taskId: String(payload.taskId || ''),
      caseCount: Array.isArray(payload.cases) ? payload.cases.length : 0,
      pid: process.pid,
      payloadPath,
      ackPath,
      task: null,
      errorCode: error?.code || 'BROKER_REQUEST_FAILED',
      error: error instanceof Error ? error.message : String(error),
    });
  } catch (ackError) {
    appendCliBrokerLog(payloadPath, 'broker-failure-ack-write-failed', {
      error: ackError instanceof Error ? ackError.message : String(ackError),
    });
  }
}

async function processCliWorkflowPayload(payloadPath) {
  let resultPath = '';
  try {
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    resultPath = String(payload.__glassboxCliResultPath || '').trim();
    const result = await runStandaloneWorkflowCase(payload, {});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (resultPath) {
      writeJsonFileAtomic(resultPath, result);
    }
    return result;
  } catch (error) {
    const result = {
      ...workflowExecutionFailure(error),
      results: [],
      error: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (resultPath) {
      try {
        writeJsonFileAtomic(resultPath, result);
      } catch (_resultError) {
        // stdout/stderr remain the fallback diagnostic channel.
      }
    }
    return result;
  }
}

async function processCliWorkflowTaskPayload(payloadPath) {
  let ackPath = '';
  let taskId = '';
  let caseCount = 0;
  try {
    appendCliBrokerLog(payloadPath, 'task-payload-received');
    const payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    ackPath = String(payload.__headlessAckPath || '').trim();
    taskId = String(payload.taskId || '').trim();
    caseCount = Array.isArray(payload.cases) ? payload.cases.length : 0;
    const payloadDataDir = String(payload.__glassboxCliDataDir || '').trim();
    if (payloadDataDir && path.resolve(payloadDataDir) !== app.getPath('userData')) {
      throw new Error(`Headless runner dataDir mismatch: argv=${app.getPath('userData')} payload=${path.resolve(payloadDataDir)}`);
    }
    if (payload.__headlessSubmitOnly) {
      const runPayload = {
        ...payload,
        __headlessSubmitOnly: undefined,
        __headlessAckPath: undefined,
        __glassboxCliDataDir: undefined,
      };
      const submitted = submitWorkflowTask(runPayload, {});
      taskId = submitted.taskId;
      caseCount = submitted.caseCount;
      await workflowReportWriter.flush(getWorkflowReportDetailPath(taskId));
      appendCliBrokerLog(payloadPath, 'task-persisted', { taskId, caseCount, status: submitted.status });
      if (ackPath) {
        writeJsonFileAtomic(ackPath, {
          schemaVersion: 'glassbox.headlessTaskAck.v1',
          createdAt: new Date().toISOString(),
          pid: process.pid,
          payloadPath,
          ackPath,
          ...submitted,
        });
        appendCliBrokerLog(payloadPath, 'task-ack-written', {
          taskId,
          ackPath,
          success: submitted.success,
        });
      }
      return submitted;
    }

    const result = await enqueueWorkflowTaskExecution(payload, {});
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return result;
  } catch (error) {
    appendCliBrokerLog(payloadPath, 'task-payload-failed', {
      taskId,
      error: error instanceof Error ? error.message : String(error),
      errorCode: error?.code || '',
    });
    const result = {
      ...workflowExecutionFailure(error),
      taskId,
      caseCount,
      payloadPath,
      ackPath,
      task: null,
      error: error instanceof Error ? error.message : String(error),
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (ackPath) {
      try {
        writeJsonFileAtomic(ackPath, {
          schemaVersion: 'glassbox.headlessTaskAck.v1',
          createdAt: new Date().toISOString(),
          ...workflowExecutionFailure(error),
          taskId,
          caseCount,
          pid: process.pid,
          payloadPath,
          ackPath,
          task: null,
          error: error instanceof Error ? error.message : String(error),
        });
      } catch (_ackError) {
        // stdout/stderr remain the fallback diagnostic channel.
      }
    }
    return result;
  }
}

function enqueueCliBrokerRequest(kind, payloadPath) {
  pendingCliBrokerRequests += 1;
  const run = async () => {
    await app.whenReady();
    if (kind === 'case') {
      return processCliWorkflowPayload(payloadPath);
    }
    return processCliWorkflowTaskPayload(payloadPath);
  };
  const queued = Promise.resolve().then(run);
  return queued
    .catch((error) => {
      console.error(`[broker] queued ${kind} request failed: ${error.message}`);
      writeCliBrokerRequestFailure(kind, payloadPath, error);
    })
    .finally(() => {
      pendingCliBrokerRequests = Math.max(0, pendingCliBrokerRequests - 1);
      maybeQuitIdleBackgroundBroker();
    });
}

const batteryControl = createBatteryControl({ jobs: bugreportJobs, directory: () => path.join(getGlassBoxDataDir(), 'bugreport-analysis') });
const settingsService = createSettingsService({
  readState: readWorkflowState, readEnvironment: readEnvironmentConfig, writeState: writeWorkflowState,
  writeEnvironment: config => writeEnvironmentConfig({ ...config, ttsProvider: normalizeTtsConfig(config.ttsProvider) }),
  notifyEnvironment: () => {
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isDestroyed()) mainWindow.webContents.send('settings:environment-updated', { config: readEnvironmentConfig(), effectiveAdbPath: getAdbPath() });
  },
  applyWorkflowPatch: async (patch, state) => {
    const protectedPatch = prepareSecretsForDisplay(protectSecrets(patch, safeStorage));
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
      writeWorkflowState({ ...(readWorkflowState() || {}), ...protectedPatch });
      return { success: true, uiUpdated: false };
    }
    const requestId = crypto.randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { pendingCaseUpdates.delete(requestId); resolve({ success: false, error: '编辑器未确认配置保存；请查询当前配置后再重试' }); }, 10000);
      pendingCaseUpdates.set(requestId, { resolve, timer, sender: mainWindow.webContents });
      try { mainWindow.webContents.send('settings:workflow-update', { requestId, patch: protectedPatch, baseline: Object.fromEntries(Object.keys(patch).map(key => [key, state[key]])) }); }
      catch(error) { clearTimeout(timer); pendingCaseUpdates.delete(requestId); resolve({ success: false, error: error.message }); }
    });
  },
});

async function processCliControlPayload(payloadPath) {
  let payload = {};
  try {
    payload = JSON.parse(fs.readFileSync(payloadPath, 'utf8'));
    const requestedDataDir = String(payload.dataDir || '').trim();
    if (requestedDataDir && path.resolve(requestedDataDir) !== app.getPath('userData')) {
      throw new Error(`Broker dataDir mismatch: broker=${app.getPath('userData')} request=${path.resolve(requestedDataDir)}`);
    }
    let result;
    if (payload.action === 'quick-action') {
      const controller = new AbortController();
      const cancelFile = path.join(path.dirname(payloadPath), 'cancel');
      const checkCancel = () => { if (fs.existsSync(cancelFile)) controller.abort(); };
      checkCancel();
      const timer = setInterval(checkCancel, 100);
      try { controller.signal.throwIfAborted(); result = await invokeApplicationHandler('quick-actions:api', { quickActionSignal: controller.signal }, payload.request); }
      finally { clearInterval(timer); }
    } else if (payload.action === 'case-library') {
      result = await invokeApplicationHandler('case-library:api',null,payload.request);
    } else if (payload.action === 'team-config') {
      result = await invokeApplicationHandler(payload.dryRun ? 'team-config:validate' : 'team-config:import', null, {manifest:payload.manifest,overwrite:true});
    } else if (payload.action === 'settings') {
      caseUpdateQueue = caseUpdateQueue.catch(() => {}).then(() => settingsService(payload));
      result = await caseUpdateQueue;
    } else if (payload.action === 'battery') {
      result = await batteryControl(payload);
    } else if (payload.action === 'performance-start') {
      const task = performanceTask(payload);
      const validation = await validateWorkflowTaskSelection(task);
      if (!validation.success) result = validation;
      else { result = submitWorkflowTask(task); await workflowReportWriter.flush(getWorkflowReportDetailPath(result.taskId)); }
    } else if (payload.action === 'import-report') {
      result = await importWorkflowReportPackage(payload.packagePath);
    } else if (payload.action === 'task-cleanup') {
      result = await invokeApplicationHandler('workflow-task:clean',null,payload.request);
    } else if (payload.action === 'capture-stacks') {
      result = await captureTaskThreadStacks(payload.taskId);
    } else if (payload.action === 'stop-task') {
      result = await stopWorkflowTaskById(payload.taskId, { force: Boolean(payload.force) });
    } else if (payload.action === 'update-case' || payload.action === 'create-case') {
      caseUpdateQueue = caseUpdateQueue.catch(() => {}).then(() => updateCaseFromCli(payload));
      result = await caseUpdateQueue;
    } else {
      result = {
        success: false,
        errorCode: 'BROKER_CONTROL_ACTION_UNSUPPORTED',
        error: `Unsupported broker control action: ${payload.action || ''}`,
      };
    }
    if (payload.ackPath) {
      writeJsonFileAtomic(payload.ackPath, {
        schemaVersion: 'glassbox.brokerControlAck.v1',
        pid: process.pid,
        createdAt: new Date().toISOString(),
        ...result,
      });
    }
    return result;
  } catch (error) {
    const result = {
      success: false,
      errorCode: 'BROKER_CONTROL_FAILED',
      error: error instanceof Error ? error.message : String(error),
    };
    if (payload.ackPath) {
      try {
        writeJsonFileAtomic(payload.ackPath, {
          schemaVersion: 'glassbox.brokerControlAck.v1',
          pid: process.pid,
          createdAt: new Date().toISOString(),
          ...result,
        });
      } catch (_ackError) {
        // The caller will fall back to its timeout diagnostics.
      }
    }
    return result;
  }
}

function handleBrokerArgv(argv = [], additionalData = {}) {
  if (isQuitting) return false;
  const taskPayloadPath = String(additionalData.taskPayloadPath || getCliRunTaskPayloadPath(argv) || '').trim();
  if (taskPayloadPath) {
    appendCliBrokerLog(taskPayloadPath, 'second-instance-task-dispatched', {
      source: additionalData.taskPayloadPath ? 'additionalData' : 'argv',
    });
    suppressForegroundUntil = Date.now() + 5000;
    void enqueueCliBrokerRequest('task', taskPayloadPath);
    return true;
  }
  const casePayloadPath = String(additionalData.casePayloadPath || getCliRunPayloadPath(argv) || '').trim();
  if (casePayloadPath) {
    suppressForegroundUntil = Date.now() + 5000;
    void enqueueCliBrokerRequest('case', casePayloadPath);
    return true;
  }
  const controlPayloadPath = String(additionalData.controlPayloadPath || getCliControlPayloadPath(argv) || '').trim();
  if (controlPayloadPath) {
    suppressForegroundUntil = Date.now() + 5000;
    pendingCliBrokerRequests += 1;
    void app.whenReady()
      .then(() => processCliControlPayload(controlPayloadPath))
      .finally(() => {
        pendingCliBrokerRequests = Math.max(0, pendingCliBrokerRequests - 1);
        maybeQuitIdleBackgroundBroker();
      });
    return true;
  }
  return false;
}

const isCliRunMode = Boolean(getCliRunPayloadPath() || getCliRunTaskPayloadPath() || getCliControlPayloadPath());

function configureCliRunnerApplicationMode() {
  if (!cliBackgroundMode || process.platform !== 'darwin') {
    return;
  }

  // The CLI runner is a background worker, not a second user-facing app.
  try {
    app.setActivationPolicy?.('prohibited');
  } catch (error) {
    console.warn(`[cli-runner] failed to prohibit activation: ${error.message}`);
  }
  try {
    app.dock?.hide?.();
  } catch (error) {
    console.warn(`[cli-runner] failed to hide Dock icon: ${error.message}`);
  }
}

// Apply this before Electron becomes ready to prevent a transient second Dock icon.
configureCliRunnerApplicationMode();

let shouldStartApp = true;
const hasSingleInstanceLock = app.requestSingleInstanceLock(createSingleInstanceRequestData());

if (!hasSingleInstanceLock) {
  shouldStartApp = false;
  app.quit();
} else {
  // A lifetime lease prevents offline CLI writes racing renderer autosave.
  try {
    const releaseConfiguration=require('./configuration-lock').acquireConfigurationLock(getGlassBoxDataDir(), {ignoreSingleton:true});
    app.once('quit',releaseConfiguration);
  } catch(error) {shouldStartApp=false;console.error('[configuration]',error.code||'CONFIGURATION_IN_USE');app.exit(1);}
  app.on('second-instance', (_event, argv = [], _workingDirectory = '', additionalData = {}) => {
    if (isQuitting) return;
    if (handleBrokerArgv(argv, additionalData)) {
      return;
    }
    if (hasCliBackgroundArg(argv)) {
      suppressForegroundUntil = Date.now() + 5000;
      return;
    }
    promoteToDesktop();
  });
}

let stopDevelopmentRetention;
if (shouldStartApp) {
  app.whenReady().then(() => {
    getRuntimeDiagnostics();
    if (cliBackgroundMode) {
      const backend=backgroundRuntime.headless ? 'headless' : 'desktop';
      console.info('[background-runtime]',JSON.stringify({backend,pid:process.pid}));
      require('./diagnostics').record({event:'runtime.background-ready',phase:backend,pid:process.pid});
    }
    try { soloPiRecording.current(); } catch (error) { console.error('[solopi-recording] recovery failed:', error.message); app.exit(1); return; }
    try{require('./task-cleanup').recoverCleanup(getGlassBoxDataDir(),readWorkflowState() || {});}catch(error){console.error('[task-cleanup] recovery failed:',error.message);}
    require('./development-tasks').claimWorkspace(getGlassBoxDataDir());
    enableTaskVisibility(getGlassBoxDataDir());
    if(path.resolve(getGlassBoxDataDir())===path.resolve(defaultUiDataDir()))stopDevelopmentRetention=require('./development-tasks').startRetention({ownerDir:getGlassBoxDataDir(),listLegacy:()=>[...(readWorkflowState()?.automationTasks || []).filter(t=>require('./development-tasks').isDevelopmentTask(t)).map(t=>({...t,externalSource:{dataDir:getGlassBoxDataDir()}})),...readVisibleTasks(getGlassBoxDataDir(),{includeDevelopment:true})],cleanLegacy:(tasks,request,signal)=>path.resolve(tasks[0].externalSource.dataDir)===path.resolve(getGlassBoxDataDir())?invokeApplicationHandler('workflow-task:clean',null,request):stopExternalWorkflowTask(tasks[0],false,'task-cleanup',request,signal),onResult:r=>{console.info('[development-retention]',JSON.stringify({removedTasks:r.removedTaskIds.length,removedWorkspaces:r.removedWorkspaces.length,skipped:r.skipped.length,errors:r.errors.length}));if(r.removedTaskIds.length && mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send('workflow-task:changed',{removedTaskIds:r.removedTaskIds,updatedAt:new Date().toISOString()});for(const e of r.errors)console.error('[development-retention]',e.error);},onError:e=>console.error('[development-retention]',e.message)});
    configureCliRunnerApplicationMode();
    synchronizeLocalCaseLibraryWatchers();
    if (!handleBrokerArgv(process.argv)) {
      promoteToDesktop();
    }
    trackGlassBoxUsage('app_open', {
      mode: cliBackgroundMode ? 'cli-background' : 'desktop',
      packaged: app.isPackaged,
      background: cliBackgroundMode,
    });
  });

  app.on('activate', () => {
    promoteToDesktop();
  });
}

app.on('window-all-closed', () => {
  app.quit();
});

const { installAgent } = require('./agent');
const { mirrorTargets, newAgentCase } = require('./agent/mirrors');
const { createScrcpyPreview } = require('./scrcpy-preview');
const agentPreviewService = createScrcpyPreview({
  warmIdleMs: 120000,
  runtime: () => {
    const media = resolveMediaRuntime({ resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    return { ...media, adb: media.adb || getAdbPath(), env: getScrcpyEnvironment(media, getAdbAwareCommandEnv()) };
  },
  allowed: target => mirrorTargets(activeWorkflowTasks.get(target.taskId)?.task).some(t => t.role === target.role && t.serial === target.serial),
});
async function prepareEmbeddedPreview(service, target, sessionId = '') {
  if (mainWindow && (mainWindow.isMinimized?.() || mainWindow.isVisible?.() === false)) return { success: true, stage: 'hidden' };
  const sender = mainWindow && !mainWindow.isDestroyed() ? mainWindow.webContents : null;
  if (!sender || sender.isDestroyed()) return { success: false, error: '没有可用的投屏页面' };
  try {
    await service.start(sender, target, sessionId);
    return await service.waitReady(sender.id, target);
  } catch (error) { return { success: false, error: error.message }; }
}
// Manual device mirroring and workflow previews share the same in-app renderer.
const workflowPreviewService = createScrcpyPreview({
  warmIdleMs: 120000,
  runtime: () => {
    const media = resolveMediaRuntime({ resourcesPath: process.resourcesPath, isPackaged: app.isPackaged });
    return { ...media, adb: media.adb || getAdbPath(), env: getScrcpyEnvironment(media, getAdbAwareCommandEnv()) };
  },
  onState: (target, state) => { const s = embeddedMirrorSessions.get(target.taskId); if (s) Object.assign(s, state); },
  allowed: target => { const s = embeddedMirrorSessions.get(target.taskId); return Boolean(s && s.serial === target.serial && s.deviceType === target.role); },
});
ipcMain.handle('preview:frame-ack', (event, args) => {
  agentPreviewService.acknowledge(event.sender.id, args, args.frameId);
  workflowPreviewService.acknowledge(event.sender.id, args, args.frameId);
  return { success: true };
});
ipcMain.handle('preview:targets', () => ({ targets: [...embeddedMirrorSessions.entries()].map(([id, s]) => ({ taskId: id, role: s.deviceType, serial: s.serial })) }));
ipcMain.handle('preview:start', async (event, args) => {
  const s = embeddedMirrorSessions.get(args.taskId);
  if (!s || s.serial !== args.serial || s.deviceType !== args.role) return { success: false, error: '投屏已结束' };
  try { return await workflowPreviewService.start(event.sender, args, 'workflow'); }
  catch (error) { Object.assign(s, { startFailed: true, error: error.message }); return { success: false, error: error.message }; }
});
ipcMain.handle('preview:stop', async (event, args) => {
  await workflowPreviewService.stop(event.sender.id, args?.taskId ? args : undefined, args?.force === true);
  return { success: true };
});
ipcMain.handle('preview:close', async (_event, args) => {
  const s = embeddedMirrorSessions.get(args.taskId);
  if (s) { await stopWorkflowScreenMirror(s); if (manualScrcpySessions.get(s.serial) === s) manualScrcpySessions.delete(s.serial); }
  return { success: true };
});
require('./team-configuration-ipc').installTeamConfiguration({
  register: registerApplicationHandler, directory: getGlassBoxDataDir,
  readState: () => readWorkflowState() || {}, readEnvironment: readEnvironmentConfig,
  saveEnvironment: async ttsProvider => {
    const config=writeEnvironmentConfig({ttsProvider:normalizeTtsConfig(ttsProvider)});
    mainWindow?.webContents.send('agent:environment-update',{config,effectiveAdbPath:getAdbPath()});
    return {success:true};
  },
  savePatch: async preparePatch => {
    caseUpdateQueue=caseUpdateQueue.catch(()=>{}).then(async () => {
      if (!mainWindow || mainWindow.isDestroyed() || mainWindow.webContents.isDestroyed()) {
        const state=readWorkflowState()||{};
        writeWorkflowState({...state,...preparePatch(state)});
        return {success:true,uiUpdated:false};
      }
      return createConfigurationBridge({readState:()=>readWorkflowState()||{},sender:()=>mainWindow.webContents,pending:pendingCaseUpdates,preparePatch: state => prepareSecretsForDisplay(protectSecrets(preparePatch(state),safeStorage))})(null);
    });
    return caseUpdateQueue;
  },
  pullCases: repo => invokeApplicationHandler('case-library:pull-git-repo',null,repo),
  loadCaseCodec: () => import(require('node:url').pathToFileURL(app.isPackaged ? path.join(process.resourcesPath,'cli','glassbox-cli.mjs') : path.join(__dirname,'..','scripts','glassbox-cli.mjs')).href),
  readActions: readQuickActionsStore, writeActions: writeQuickActionsStore, readDefinition: readQuickActionDefinition,
  activeActionIds: () => new Set(Object.keys(getQuickActionSessions().list())),
  importScripts: async (repo,{overwrite}) => {
    if (!overwrite && readQuickActionsStore().some(a=>a.gitSource?.repoUrl===repo.repoUrl && (a.gitSource.branch||'')===(repo.branch||'') && (a.gitSource.directory||'')===(repo.directory||''))) return {success:true,unchanged:true};
    if (quickActionGitBusy) return {success:false,error:'快捷操作仓库正在同步'};
    quickActionGitBusy=true;
    try {
      const result=await require('./quick-action-git').importGitScripts({root:path.join(app.getPath('userData'),'quick-actions','repositories.noindex'),repoUrl:repo.repoUrl,branch:repo.branch||'',directory:repo.directory||'',run:(cmd,args)=>runCommandWithOptions(cmd,args,buildGitCommandOptions(repo,{timeout:600000})),readDefinition:readQuickActionDefinition,getActions:readQuickActionsStore,saveActions:writeQuickActionsStore});
      const actions=readQuickActionsStore();
      for(const action of actions) {
        if(action.gitSource?.repoUrl!==repo.repoUrl || (action.gitSource.branch||'')!==(repo.branch||'') || (action.gitSource.directory||'')!==(repo.directory||''))continue;
        const override=(repo.overrides||[]).find(x=>x.relativePath===action.gitSource.relativePath);
        if(override){const c=override.configuration||{};Object.assign(action,c,{configuredInputs:c.inputs,argsOverride:c.args,userConfigured:true,...(override.showInToolbar!==undefined?{showInToolbar:override.showInToolbar}:{})});}
      }
      writeQuickActionsStore(actions);
      mainWindow?.webContents.send('quick-actions:changed',{});return result;
    } finally {quickActionGitBusy=false;}
  },
  notify: (event,payload) => {if(event==='team-config:progress')require('./diagnostics').record({event:'team-config.step',stepId:payload.id,status:payload.status,errorCode:payload.errorCode});if(mainWindow&&!mainWindow.isDestroyed())mainWindow.webContents.send(event,payload);},
  reveal: value => revealSecrets(value,safeStorage),
  saveFile: async content => {
    const result=await dialog.showSaveDialog({title:'导出团队配置',defaultPath:'team.solopi-desktop.json',filters:[{name:'solopi-desktop 团队配置',extensions:['json']}]});
    if(result.canceled||!result.filePath)return {success:false,canceled:true};
    const temporary=result.filePath+'.'+crypto.randomUUID()+'.tmp';
    try {fs.writeFileSync(temporary,content,{mode:0o600,flag:'wx'});fs.renameSync(temporary,result.filePath);}
    finally {if(fs.existsSync(temporary))fs.unlinkSync(temporary);}
    return {success:true};
  },
});

const agentService = installAgent({
  ipcMain, directory: getGlassBoxDataDir, invoke: invokeApplicationHandler,
  deviceOperation: (action, args, signal) => require('./agent/device-operation').deviceOperation(action, args, { runAdb, signal }),
  getMirrorTargets: id => mirrorTargets(activeWorkflowTasks.get(id)?.task), previewService: agentPreviewService,
  subscribeOperations: listener => { agentOperationEvents.on('operation', listener); return () => agentOperationEvents.off('operation', listener); },
  saveConfiguration: async payload => {
    caseUpdateQueue = caseUpdateQueue.catch(() => {}).then(() => createConfigurationBridge({ readState: () => readWorkflowState() || {}, sender: () => mainWindow?.webContents, pending: pendingCaseUpdates })(payload));
    return caseUpdateQueue;
  },
  readState: () => readWorkflowState() || {},
  provider: async () => {
    const state = readWorkflowState() || {};
    const pinnedId=process.env.NODE_ENV==='development'&&process.env.LENSWIPER_DEV_AGENT_MODEL?process.env.LENSWIPER_DEV_AGENT_PROVIDER_ID:undefined;
    const provider = state.llmProviders?.find(p => p.id === (pinnedId || state.selectedLlmProviderId)) || (!pinnedId?state.llmProviders?.[0]:undefined);
    if (!provider) throw Error(pinnedId?'开发 Agent 指定的模型配置不存在':'请先在设置中心添加支持工具调用的模型');
    const agentProvider=require('./agent/dev-model').developmentProvider(provider,{development:process.env.NODE_ENV==='development',model:process.env.LENSWIPER_DEV_AGENT_MODEL,thinking:process.env.LENSWIPER_DEV_AGENT_THINKING});
    const resolved = await require('./agent/model-capacity').resolveModelCapacity({ ...agentProvider, ...revealSecrets({ apiKey: provider.apiKey }, safeStorage) });
    require('./diagnostics').record({event:'model.capacity',model:resolved.model,contextWindowTokens:resolved.contextWindowTokens,source:resolved.contextWindowSource});
    return resolved;
  },
  getAgentModelOverride:()=>process.env.NODE_ENV==='development'?process.env.LENSWIPER_DEV_AGENT_MODEL:undefined,
  getAgentModelProviderId:()=>process.env.NODE_ENV==='development'&&process.env.LENSWIPER_DEV_AGENT_MODEL?process.env.LENSWIPER_DEV_AGENT_PROVIDER_ID:undefined,
  saveCase: async payload => {
    let doc = payload.document?.case || payload.document;
    if (payload.action === 'create-case') {
      doc = newAgentCase(doc);
      payload = { ...payload, document: payload.document?.case ? { ...payload.document, case: doc } : doc };
    }
    const cli = await getGlassBoxCliModule();
    const state = readWorkflowState() || {};
    const existing = state.cases?.find(c => c.id === payload.caseId) || {};
    require('./agent/case-contract').assertPreservedStepFields(existing, doc, (readWorkflowState() || {}).components || []);
    const validation = cli.validatePayload({ cases: [{ ...existing, ...doc }] }, { allowImportReviewDraft: true });
    if (!validation.success) return validation;
    caseUpdateQueue = caseUpdateQueue.catch(() => {}).then(() => updateCaseFromCli(payload));
    return await caseUpdateQueue;
  },
  registerUpload: (owner, file) => bugreportJobs.registerUpload(owner, file),
  protect: value => protectSecrets(value, safeStorage), reveal: value => revealSecrets(value, safeStorage),
});

let quitCleanupStarted = false;
let quitCleanupComplete = false;
app.on('before-quit', (event) => {
  if (quitCleanupComplete) return;
  event.preventDefault();
  if (quitCleanupStarted) return;
  quitCleanupStarted = true;
  stopDevelopmentRetention?.();
  isQuitting = true;
  const stops = [
    soloPiRecording.stopAll(),
    agentService.stopAll(),
    agentPreviewService.close(),
    bugreportJobs.stopAll(),
    ...[...performanceCrashSessions.values()].map(entry => entry.collector.stop()),
    ...(desktopModeRequested ? readVisibleTasks(getGlassBoxDataDir()).filter(task => ['submitted', 'running', 'stopping'].includes(task.status)).map(task => stopExternalWorkflowTask(task)) : []),
    ...Array.from(activeWorkflowTasks.keys(), (id) => stopWorkflowTaskById(id)),
    ...Array.from(activeWorkflowRuntimes.keys(), (id) => stopWorkflowRequest(id)),
    ...Array.from(activeWorkflowTasks.values(), (active) => active.performanceCollector?.stop()),
    ...Array.from(activeWorkflowTasks.values(), (active) => active.threadStacks?.stop()),
    ...Array.from(activeWorkflowTasks.values(), (active) => active.taskLogCapture?.stop()),
  ];
  // Recorder shutdown owns its bounded cancellation; allow its exact-session stop to finish.
  // Allow normal task finalizers to flush reports, but never wait indefinitely.
  let quitTimer;
  const drained = (async () => {
    await Promise.allSettled(stops);
    while (activeWorkflowTasks.size || activeWorkflowRuntimes.size) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  })();
  void Promise.race([drained, new Promise((resolve) => { quitTimer = setTimeout(resolve, 3000); })])
    .finally(async () => {
      clearTimeout(quitTimer);
      cancelAllManagedCommands();
      require('./scrcpy-transport').closeAllScrcpyTransports();
      for (const active of activeWorkflowTasks.values()) {
        if (!active.task) continue;
        try {
          const stoppedAt = new Date().toISOString();
          persistWorkflowTaskRecord(refreshWorkflowTaskSummary({
            ...markWorkflowTaskCasesStopped(active.task, 'solopi-desktop 已退出，任务停止', stoppedAt),
            status: 'stopped', finishedAt: stoppedAt, error: 'solopi-desktop 已退出，任务停止',
          }));
        } catch (error) { console.error('[quit] failed to persist task:', error.message); }
      }
      // Bounded flush; the last atomic snapshot remains recoverable if the disk stalls.
      let flushTimer;
      await Promise.race([workflowReportWriter.flush().catch(error => console.error('[quit] report flush:', error.message)),
        new Promise(resolve => { flushTimer = setTimeout(resolve, 3000); })]);
      clearTimeout(flushTimer);
      runtimeDiagnostics?.close();
      quitCleanupComplete = true;
      app.quit();
    });
  ffmpegProcessQueue.close('solopi-desktop 正在退出，未开始的媒体处理任务已取消');
  for (const session of manualScrcpySessions.values()) {
    void stopWorkflowScreenMirror(session);
  }
  manualScrcpySessions.clear();
  embeddedMirrorSessions.clear();
  void workflowPreviewService.close();
  localCaseLibraryWatcherManager?.close();
  localCaseLibraryWatcherManager = null;
  pendingLocalCaseLibraryEvents.clear();
  initializedLocalCaseLibraryWatchKeys.clear();
  Array.from(logAssertStreams.keys()).forEach((serial) => stopLogAssertStream(serial));
});

app.once('will-quit', () => runtimeDiagnostics?.close());
