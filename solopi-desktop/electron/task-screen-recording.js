const path = require('node:path');

const TASK_RECORDING_SCHEMA_VERSION = 'glassbox.task-screen-recording.v1';

function sanitizeFilePart(value) {
  return String(value || 'unknown').replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') || 'unknown';
}

function getCaseWindow(marker, recordingStartedAtMs) {
  const startMs = Math.max(0, Number(marker.startedAtMs) - Number(recordingStartedAtMs));
  const endMs = Math.max(startMs + 1, Number(marker.endedAtMs) - Number(recordingStartedAtMs));
  return {
    startSeconds: startMs / 1000,
    durationSeconds: Math.max(0.001, (endMs - startMs) / 1000),
  };
}

function buildFfmpegSegmentArgs(inputPath, outputPath, marker, recordingStartedAtMs, platform = process.platform) {
  const window = getCaseWindow(marker, recordingStartedAtMs);
  const args = [
    '-y', '-hide_banner', '-loglevel', 'error',
    '-i', inputPath,
    '-ss', window.startSeconds.toFixed(3),
    '-t', window.durationSeconds.toFixed(3),
    '-map', '0:v:0', '-map', '0:a?',
  ];

  if (platform === 'darwin') {
    args.push('-c:v', 'h264_videotoolbox', '-allow_sw', '1', '-b:v', '8M');
  } else if (platform === 'win32') {
    args.push('-c:v', 'h264_mf', '-b:v', '8M');
  } else {
    args.push('-c:v', 'mpeg4', '-q:v', '2');
  }
  args.push('-c:a', 'aac', '-movflags', '+faststart', outputPath);
  return args;
}

function buildSoftwareFallbackSegmentArgs(args = []) {
  const fallback = [...args];
  const codecIndex = fallback.indexOf('h264_videotoolbox');
  if (codecIndex < 0) return fallback;
  fallback[codecIndex] = 'mpeg4';
  const allowSoftwareIndex = fallback.indexOf('-allow_sw');
  if (allowSoftwareIndex >= 0) fallback.splice(allowSoftwareIndex, 2);
  const bitrateIndex = fallback.indexOf('-b:v');
  if (bitrateIndex >= 0) fallback.splice(bitrateIndex, 2, '-q:v', '2');
  return fallback;
}

class TaskScreenRecordingCoordinator {
  constructor(options = {}) {
    this.taskId = String(options.taskId || 'task');
    this.runDir = options.runDir;
    this.platform = options.platform || process.platform;
    this.startRecorder = options.startRecorder;
    this.stopRecorder = options.stopRecorder;
    this.segmentRecording = options.segmentRecording;
    this.sessions = [];
    this.markers = [];
    this.caseRecordings = new Map();
    this.startedAtMs = 0;
    this.activeMarker = null;
    this.finalizePromise = null;
  }

  async start(devices = []) {
    if (this.startedAtMs) return this.sessions;
    this.startedAtMs = Date.now();
    this.sessions = (await Promise.all(devices.map(async (device) => {
      const session = await this.startRecorder(this.runDir, device.deviceType, device.serial, {
        showWindow: Boolean(device.showWindow),
        container: 'mkv',
        taskLevel: true,
        taskId: this.taskId,
      });
      if (session && !session.startFailed) {
        session.recordingStartedAtMs = Number(session.readyAtMs || Date.now());
      }
      return session;
    }))).filter(Boolean);
    return this.sessions;
  }

  startCase(testCase, nowMs = Date.now()) {
    const marker = {
      caseId: String(testCase?.id || `case-${this.markers.length + 1}`),
      caseName: String(testCase?.name || testCase?.id || `用例 ${this.markers.length + 1}`),
      startedAtMs: nowMs,
      endedAtMs: 0,
    };
    this.markers.push(marker);
    this.activeMarker = marker;
    return marker;
  }

  finishCase(nowMs = Date.now()) {
    if (!this.activeMarker) return null;
    this.activeMarker.endedAtMs = Math.max(this.activeMarker.startedAtMs + 1, nowMs);
    const marker = this.activeMarker;
    this.activeMarker = null;
    return marker;
  }

  async segmentCase(marker) {
    if (!marker) return [];
    const recordings = [];
    for (const source of this.sessions) {
      if (source.startFailed || source.exited) {
        recordings.push({
          deviceType: source.deviceType,
          serial: source.serial,
          sourcePath: source.path,
          caseId: marker.caseId,
          caseName: marker.caseName,
          success: false,
          evidenceReady: false,
          segmented: true,
          errorCode: 'SCRCPY_RECORDING_FAILED',
          readyAtMs: Number(source.readyAtMs || 0),
          transportDiagnostics: source.transportDiagnostics || [],
          error: source.error || '任务级 scrcpy 录屏未保持运行',
        });
        continue;
      }
      const outputPath = path.join(
        this.runDir,
        'cases',
        sanitizeFilePart(marker.caseId),
        `${sanitizeFilePart(source.deviceType)}-${sanitizeFilePart(source.serial)}-recording.mp4`
      );
      try {
        const segment = await this.segmentRecording({
          source,
          marker,
          outputPath,
          args: buildFfmpegSegmentArgs(
            source.path,
            outputPath,
            marker,
            source.recordingStartedAtMs || this.startedAtMs,
            this.platform
          ),
        });
        recordings.push({
          ...segment,
          deviceType: source.deviceType,
          serial: source.serial,
          sourcePath: source.path,
          path: outputPath,
          caseId: marker.caseId,
          caseName: marker.caseName,
          evidenceReady: true,
          segmented: true,
          segmentationPhase: 'live-preview',
          recordingStartedAtMs: Number(source.recordingStartedAtMs || this.startedAtMs),
          markerStartedAtMs: marker.startedAtMs,
          markerEndedAtMs: marker.endedAtMs,
        });
      } catch (error) {
        recordings.push({
          deviceType: source.deviceType,
          serial: source.serial,
          sourcePath: source.path,
          path: outputPath,
          caseId: marker.caseId,
          caseName: marker.caseName,
          success: false,
          evidenceReady: false,
          segmented: true,
          errorCode: 'SCREEN_RECORDING_SEGMENT_PENDING',
          error: error instanceof Error ? error.message : String(error),
          recoveryActions: ['任务级原始录屏仍在保留；任务结束封口后会自动重试该 case 切片。'],
        });
      }
    }
    this.caseRecordings.set(marker.caseId, recordings);
    return recordings;
  }

  async finishAndSegmentCase(nowMs = Date.now()) {
    const marker = this.finishCase(nowMs);
    if (!marker) return [];
    await new Promise((resolve) => setTimeout(resolve, 200));
    return this.segmentCase(marker);
  }

  async finalize(nowMs = Date.now()) {
    if (this.finalizePromise) return this.finalizePromise;
    this.finalizePromise = this.finalizeOnce(nowMs);
    return this.finalizePromise;
  }

  async finalizeOnce(nowMs = Date.now()) {
    this.finishCase(nowMs);
    const sourceRecordings = (await Promise.all(this.sessions.map(this.stopRecorder))).filter(Boolean);
    const caseRecordings = new Map(this.caseRecordings);

    for (const marker of this.markers) {
      // A segment produced while scrcpy is still writing its MKV is only a
      // preview. Even when FFmpeg reports success, that source has not been
      // finalized and can expose an incomplete duration/index. Always cut the
      // authoritative case artifact again after every task recorder is sealed.
      const recordings = [];
      for (const source of sourceRecordings) {
        const recoverPartial = !source.success && source.sizeBytes > 0 && source.recordingStartedAtMs > 0
          && marker.startedAtMs < Number(source.recordingStoppedAtMs || nowMs);
        if (!source.success && !recoverPartial) {
          recordings.push({ ...source, caseId: marker.caseId, evidenceReady: true, segmented: false });
          continue;
        }
        const sourceFailure = !source.success ? {partial:true,sourceErrorCode:source.errorCode,sourceError:source.error,sourceExitCode:source.exitCode} : {};
        const extension = '.mp4';
        const outputPath = path.join(
          this.runDir,
          'cases',
          sanitizeFilePart(marker.caseId),
          `${sanitizeFilePart(source.deviceType)}-${sanitizeFilePart(source.serial)}-recording${extension}`
        );
        try {
          const segment = await this.segmentRecording({
            source,
            marker,
            outputPath,
            args: buildFfmpegSegmentArgs(
              source.path,
              outputPath,
              marker,
              source.recordingStartedAtMs || this.startedAtMs,
              this.platform
            ),
          });
          recordings.push({
            ...segment,
            deviceType: source.deviceType,
            serial: source.serial,
            sourcePath: source.path,
            path: outputPath,
            caseId: marker.caseId,
            caseName: marker.caseName,
            evidenceReady: true,
            segmented: true,
            segmentationPhase: 'finalized-source',
            ...sourceFailure,
            recordingStartedAtMs: Number(source.recordingStartedAtMs || this.startedAtMs),
            recordingStoppedAtMs: Number(source.recordingStoppedAtMs || nowMs),
            markerStartedAtMs: marker.startedAtMs,
            markerEndedAtMs: marker.endedAtMs,
          });
        } catch (error) {
          recordings.push({
            deviceType: source.deviceType,
            serial: source.serial,
            sourcePath: source.path,
            path: outputPath,
            caseId: marker.caseId,
            caseName: marker.caseName,
            success: false,
            evidenceReady: true,
            segmented: true,
            errorCode: 'SCREEN_RECORDING_SEGMENT_FAILED',
            ...sourceFailure,
            error: error instanceof Error ? error.message : String(error),
            recoveryActions: ['保留任务级原始录屏并检查内置 FFmpeg 运行时后重新切片。'],
          });
        }
      }
      caseRecordings.set(marker.caseId, recordings);
    }

    return {
      schemaVersion: TASK_RECORDING_SCHEMA_VERSION,
      sourceRecordings,
      caseRecordings,
      markers: this.markers.map((marker) => ({ ...marker })),
    };
  }
}

module.exports = {
  TASK_RECORDING_SCHEMA_VERSION,
  TaskScreenRecordingCoordinator,
  buildFfmpegSegmentArgs,
  buildSoftwareFallbackSegmentArgs,
  getCaseWindow,
};
