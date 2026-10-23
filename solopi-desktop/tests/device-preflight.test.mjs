import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  createScreenAwakeWarning,
  runRequiredDevicePreflight,
} = require('../electron/device-preflight.js');

function successfulRequiredChecks(args) {
  if (args.includes('get-state')) return { stdout: 'device\n', stderr: '' };
  if (args.includes('pm')) return { stdout: 'package:/data/app/base.apk\n', stderr: '' };
  return { stdout: '', stderr: '' };
}

test('screen-awake exitCode 137 is a warning consistently across multiple cases', () => {
  const failedStayon = {
    success: false,
    serial: 'glasses-1',
    command: 'adb -s glasses-1 shell svc power stayon true',
    exitCode: 137,
    signal: 'SIGKILL',
    timeoutMs: 5000,
    stderr: 'killed',
  };

  for (const caseId of ['case-coffee-a', 'case-coffee-b', 'case-coffee-c']) {
    const warning = createScreenAwakeWarning({ ...failedStayon, caseId });
    assert.equal(warning.code, 'DEVICE_SCREEN_AWAKE_WARNING');
    assert.equal(warning.exitCode, 137);
    assert.equal(warning.timedOut, true);
    assert.ok(warning.recoveryActions.length > 0);
  }
});

test('required device checks accept get-state, basic shell, and installed target package', async () => {
  const calls = [];
  const result = await runRequiredDevicePreflight({
    serial: 'glasses-1',
    packageName: 'com.example.wearable',
  }, async (args) => {
    calls.push(args);
    return successfulRequiredChecks(args);
  });

  assert.equal(result.success, true);
  assert.deepEqual(result.checks.map((item) => item.kind), [
    'adb-state',
    'basic-shell',
    'package-installed',
  ]);
  assert.equal(calls.length, 3);
});

for (const fixture of [
  { name: 'unauthorized', stderr: 'error: device unauthorized', code: 'DEVICE_UNAUTHORIZED' },
  { name: 'offline', stderr: 'error: device offline', code: 'DEVICE_OFFLINE' },
  { name: 'not found', stderr: 'error: device not found', code: 'DEVICE_NOT_FOUND' },
]) {
  test(`required device checks fail fast for ${fixture.name}`, async () => {
    const result = await runRequiredDevicePreflight({ serial: 'glasses-1' }, async () => {
      const error = new Error(fixture.stderr);
      error.stderr = fixture.stderr;
      error.exitCode = 1;
      throw error;
    });
    assert.equal(result.success, false);
    assert.equal(result.failure.errorCode, fixture.code);
    assert.equal(result.checks.length, 1);
  });
}

test('required device checks fail when basic shell is unavailable', async () => {
  const result = await runRequiredDevicePreflight({ serial: 'glasses-1' }, async (args) => {
    if (args.includes('get-state')) return { stdout: 'device\n' };
    const error = new Error('shell command timed out');
    error.timeoutMs = 5000;
    throw error;
  });
  assert.equal(result.success, false);
  assert.equal(result.failure.kind, 'basic-shell');
  assert.equal(result.failure.errorCode, 'DEVICE_SHELL_UNAVAILABLE');
});

test('required device checks fail when the target package is missing', async () => {
  const result = await runRequiredDevicePreflight({
    serial: 'glasses-1',
    packageName: 'com.example.wearable',
  }, async (args) => {
    if (args.includes('get-state')) return { stdout: 'device\n' };
    if (args.includes('pm')) return { stdout: '', stderr: '' };
    return { stdout: '', stderr: '' };
  });
  assert.equal(result.success, false);
  assert.equal(result.failure.kind, 'package-installed');
  assert.equal(result.failure.errorCode, 'DEVICE_PACKAGE_NOT_FOUND');
});
