// Host-side static gate; never starts the candidate application's executable.
const path=require('node:path');
module.exports=async context=>{
 const resources=context.electronPlatformName==='darwin'
  ?path.join(context.appOutDir,`${context.packager.appInfo.productFilename}.app`,'Contents','Resources')
  :path.join(context.appOutDir,'resources');
 const {prepareThirdPartyNotices}=await import('./third-party-notices.mjs');
 const notices=prepareThirdPartyNotices({projectRoot:context.packager.projectDir,resourcesDir:resources,electronDist:context.packager.config.electronDist,targetPlatform:context.electronPlatformName,electronVersion:context.packager.info.framework.version});
 console.log(`Third-party notices verified: ${notices.packages} dependencies, Electron ${notices.electronVersion} (${notices.targetPlatform})`);
 const {verifyFFmpegCompliance}=await import('./ffmpeg-compliance.mjs');
 const {createFFmpegSourceArchive}=await import('./create-ffmpeg-source-archive.mjs');
 const arch=typeof context.arch==='string'?context.arch:require('builder-util').Arch[context.arch];
 const runtime=path.join(resources,'media-runtime',`${context.electronPlatformName}-${arch}`);
 verifyFFmpegCompliance(runtime);
 const output=path.resolve(context.packager.projectDir,context.packager.config.directories.output);
 const artifact=path.join(output,`solopi-desktop-${context.packager.appInfo.version}-${context.electronPlatformName}-${arch}-ffmpeg-sources.tar.gz`);
 await createFFmpegSourceArchive({runtimeRoot:runtime,outputFile:artifact,platform:context.electronPlatformName,arch});
 const {verifyPackagedRuntimeDependencies}=await import('./verify-packaged-runtime-dependencies.mjs');
 const result=verifyPackagedRuntimeDependencies(path.join(resources,'app.asar'));
 console.log(`Packaged runtime dependencies verified: ${result.checkedFiles} modules, ${result.warnings.length} optional references unavailable, ${result.dynamicReferences.length} computed references require runtime smoke coverage`);
};
