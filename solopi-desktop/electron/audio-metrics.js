const fs = require('node:fs');

const AUDIO_METRICS_SCHEMA_VERSION = 'glassbox.audio-metrics.v1';
const DEFAULT_TRAILING_SILENCE_MS = 800;
const MAX_TRAILING_SILENCE_MS = 60000;

const SAMPLE_FORMAT_BYTES = new Map([
  ['AV_SAMPLE_FMT_U8', 1],
  ['AV_SAMPLE_FMT_U8P', 1],
  ['AV_SAMPLE_FMT_S16', 2],
  ['AV_SAMPLE_FMT_S16P', 2],
  ['AV_SAMPLE_FMT_S32', 4],
  ['AV_SAMPLE_FMT_S32P', 4],
  ['AV_SAMPLE_FMT_FLT', 4],
  ['AV_SAMPLE_FMT_FLTP', 4],
  ['AV_SAMPLE_FMT_DBL', 8],
  ['AV_SAMPLE_FMT_DBLP', 8],
  ['AV_SAMPLE_FMT_S64', 8],
  ['AV_SAMPLE_FMT_S64P', 8],
]);

function normalizeTrailingSilenceMs(value, fallback = DEFAULT_TRAILING_SILENCE_MS) {
  const raw = value === undefined || value === null || String(value).trim() === ''
    ? fallback
    : Number(value);
  if (!Number.isFinite(raw)) return fallback;
  return Math.min(MAX_TRAILING_SILENCE_MS, Math.max(0, Math.round(raw)));
}

function getAudioBytesPerSample(sampleFormat) {
  return SAMPLE_FORMAT_BYTES.get(String(sampleFormat || '').trim().toUpperCase()) || 2;
}

function getPcmByteRate(options = {}) {
  const sampleRate = Math.max(1, Number(options.sampleRate || 16000));
  const channelCnt = Math.max(1, Number(options.channelCnt || 1));
  const bytesPerSample = getAudioBytesPerSample(options.sampleFormat);
  return sampleRate * channelCnt * bytesPerSample;
}

function durationMsFromPcmBytes(sizeBytes, options = {}) {
  const byteRate = getPcmByteRate(options);
  return Math.max(0, Math.round((Math.max(0, Number(sizeBytes || 0)) / byteRate) * 1000));
}

function getPcmSilenceByteLength(trailingSilenceMs, options = {}) {
  const byteRate = getPcmByteRate(options);
  const frameSize = Math.max(1, Number(options.channelCnt || 1))
    * getAudioBytesPerSample(options.sampleFormat);
  const unaligned = Math.round((normalizeTrailingSilenceMs(trailingSilenceMs, 0) / 1000) * byteRate);
  return Math.ceil(unaligned / frameSize) * frameSize;
}

function appendPcmSilence(sourcePath, targetPath, options = {}) {
  const trailingSilenceMs = normalizeTrailingSilenceMs(options.trailingSilenceMs);
  fs.copyFileSync(sourcePath, targetPath);
  const silenceBytes = getPcmSilenceByteLength(trailingSilenceMs, options);
  if (silenceBytes > 0) {
    const handle = fs.openSync(targetPath, 'a');
    try {
      const chunk = Buffer.alloc(Math.min(silenceBytes, 64 * 1024));
      let remaining = silenceBytes;
      while (remaining > 0) {
        const length = Math.min(remaining, chunk.length);
        fs.writeSync(handle, chunk, 0, length);
        remaining -= length;
      }
    } finally {
      fs.closeSync(handle);
    }
  }
  return { trailingSilenceMs, silenceBytes };
}

function createPcmAudioMetrics(options = {}) {
  const sourceBytes = Math.max(0, Number(options.sourceBytes || 0));
  const preparedBytes = Math.max(0, Number(options.preparedBytes ?? sourceBytes));
  const trailingSilenceMs = normalizeTrailingSilenceMs(options.trailingSilenceMs);
  const audioDurationMs = durationMsFromPcmBytes(
    Math.max(0, preparedBytes - getPcmSilenceByteLength(trailingSilenceMs, options)),
    options
  );
  const preparedAudioDurationMs = durationMsFromPcmBytes(preparedBytes, options);
  return {
    schemaVersion: AUDIO_METRICS_SCHEMA_VERSION,
    audioDurationMs,
    trailingSilenceMs,
    preparedAudioDurationMs,
    // This is the media timeline delivered to the receiver. solopi-desktop cannot
    // claim device playback completion until the receiver provides an ACK.
    injectionDurationMs: preparedAudioDurationMs,
    injectionDurationSource: 'prepared-audio-timeline',
    sampleRate: Math.max(1, Number(options.sampleRate || 16000)),
    channelCnt: Math.max(1, Number(options.channelCnt || 1)),
    bytesPerSample: getAudioBytesPerSample(options.sampleFormat),
    sourceBytes,
    preparedBytes,
  };
}

function createAudioTimelineMetrics(options = {}) {
  const trailingSilenceMs = normalizeTrailingSilenceMs(options.trailingSilenceMs);
  const preparedAudioDurationMs = Number.isFinite(Number(options.preparedAudioDurationMs))
    ? Math.max(0, Math.round(Number(options.preparedAudioDurationMs)))
    : null;
  const explicitAudioDurationMs = Number.isFinite(Number(options.audioDurationMs))
    ? Math.max(0, Math.round(Number(options.audioDurationMs)))
    : null;
  const audioDurationMs = explicitAudioDurationMs ?? (
    preparedAudioDurationMs === null
      ? null
      : Math.max(0, preparedAudioDurationMs - trailingSilenceMs)
  );
  return {
    schemaVersion: AUDIO_METRICS_SCHEMA_VERSION,
    audioDurationMs,
    trailingSilenceMs,
    preparedAudioDurationMs,
    injectionDurationMs: preparedAudioDurationMs,
    injectionDurationSource: 'prepared-audio-timeline',
    sampleRate: Math.max(1, Number(options.sampleRate || 16000)),
    channelCnt: Math.max(1, Number(options.channelCnt || 1)),
    sourceBytes: Math.max(0, Number(options.sourceBytes || 0)),
    preparedBytes: Math.max(0, Number(options.preparedBytes || 0)),
  };
}

module.exports = {
  AUDIO_METRICS_SCHEMA_VERSION,
  DEFAULT_TRAILING_SILENCE_MS,
  MAX_TRAILING_SILENCE_MS,
  appendPcmSilence,
  createAudioTimelineMetrics,
  createPcmAudioMetrics,
  durationMsFromPcmBytes,
  getAudioBytesPerSample,
  getPcmByteRate,
  getPcmSilenceByteLength,
  normalizeTrailingSilenceMs,
};
