#!/usr/bin/env node

const args = process.argv.slice(2);
const opusPrefix = String(process.env.GLASSBOX_MEDIA_OPUS_PREFIX || '').trim();
const query = args.find((arg) => ['--exists', '--cflags', '--libs', '--modversion'].includes(arg));
const packageName = args.find((arg) => !arg.startsWith('-') && !/^[<>=]/.test(arg));

if (args.includes('--version')) {
  console.log('glassbox-media-pkg-config-1');
  process.exit(0);
}

if (!opusPrefix || !['opus', 'speex'].includes(packageName)) {
  process.exit(1);
}

if (query === '--exists') {
  process.exit(0);
}
if (query === '--modversion') {
  console.log(String(packageName === 'speex' ? '1.2.1' : (process.env.GLASSBOX_MEDIA_OPUS_VERSION || '1.5.2')));
  process.exit(0);
}
if (query === '--cflags') {
  console.log(`-I${opusPrefix}/include${packageName === 'opus' ? '/opus' : ''}`);
  process.exit(0);
}
if (query === '--libs') {
  console.log(`${opusPrefix}/lib/lib${packageName}.a`);
  process.exit(0);
}

process.exit(1);
