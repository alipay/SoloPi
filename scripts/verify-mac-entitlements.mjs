import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

export function assertElectronEntitlements(entitlements, label, plugin = false) {
  const permission = plugin ? 'com.apple.security.cs.allow-unsigned-executable-memory' : 'com.apple.security.cs.allow-jit';
  if (entitlements?.[permission] !== true) throw new Error(`Electron runtime permission missing: ${label}: ${permission}`);
}

export function verifyElectronEntitlements(appPath) {
  const frameworks = path.join(appPath, 'Contents', 'Frameworks');
  const bundles = [appPath, ...fs.readdirSync(frameworks)
    .filter(name => name.endsWith('.app') && name.includes(' Helper'))
    .map(name => path.join(frameworks, name))];
  for (const bundle of bundles) {
    const xml = execFileSync('codesign', ['-d', '--entitlements', ':-', bundle], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const entitlements = xml.trim() ? JSON.parse(execFileSync('plutil', ['-convert', 'json', '-o', '-', '--', '-'], { input: xml, encoding: 'utf8' })) : {};
    assertElectronEntitlements(entitlements, bundle, bundle.endsWith(' Helper (Plugin).app'));
  }
  return { success: true, processBundles: bundles.length };
}
