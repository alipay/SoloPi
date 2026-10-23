import path from 'node:path';
export function linuxBuildConfig(root, arch = 'x64') {
  if (!['x64', 'arm64'].includes(arch)) throw Error('Linux architecture must be x64 or arm64');
  return {
    extends: null, appId: 'com.glassbox.desktop', productName: 'solopi-desktop',
    executableName: 'solopi-desktop', artifactName: '${productName}-${version}-linux-${arch}.${ext}',
    directories: {output: path.join(root, 'release', `linux-${arch}`)},
    afterPack:path.join(root,'scripts/verify-packaged-runtime-after-pack.cjs'),
    files: ['dist/**/*', 'electron/**/*', 'package.json'],
    extraResources: [
      {from: 'resources/solopi-recording', to: 'solopi-recording'},
      {from: 'resources/branding/solopi-desktop-app-icon.png', to: 'dock-icon.png'},
      {from: 'scripts/glassbox-cli.mjs', to: 'cli/glassbox-cli.mjs'},
      {from: 'build/packaged-cli', to: 'cli', filter: ['*.cjs','solopi-native-case.js','solopi-native-schema.js','runtime-build.json']},
      {from: 'resources/bin', to: 'bin'},
      {from: `resources/media-runtime/linux-${arch}`, to: `media-runtime/linux-${arch}`},
      {from: 'skills/solopi-desktop-cli', to: 'skills/solopi-desktop-cli', filter: ['**/*', '!**/.DS_Store']},
      {from: `resources/git-runtime/linux-${arch}`, to: `git-runtime/linux-${arch}`},
      {from: 'resources', to: 'resources', filter: ['**/*', '!bin{,/**}', '!media-runtime{,/**}', '!git-runtime{,/**}', '!quick-actions{,/**}', '!solopi-recording{,/**}', '!**/*.jar', '!.DS_Store']},
    ],
    linux: {icon:'resources/branding/solopi-desktop-app-icon.png',target: [{target: 'tar.gz', arch: [arch]}], category: 'Development', synopsis: 'solopi-desktop automation test workstation',
      desktop: {entry: {Name: 'solopi-desktop', Comment: 'Automation test workstation', Terminal: 'false'}}},
    deb: {depends: ['libgtk-3-0', 'libnss3', 'libxss1', 'libasound2', 'libgbm1', 'zlib1g'], maintainer: 'solopi-desktop'},
    publish: null,
  };
}
