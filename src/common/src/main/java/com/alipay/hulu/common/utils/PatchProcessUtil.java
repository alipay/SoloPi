/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * 	http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.common.utils;

import com.alibaba.fastjson.JSON;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.patch.PatchDescription;
import com.alipay.hulu.common.utils.patch.PatchLoadResult;

import java.io.File;
import java.io.FileFilter;
import java.io.FileInputStream;
import java.io.IOException;
import java.lang.reflect.Method;

import dalvik.system.DexClassLoader;

/**
 * Created by qiaoruikai on 2018/12/18 8:34 PM.
 */
public class PatchProcessUtil {
    public static final String TAG = "PatchProcess";

    /**
     * 加载补丁信息
     * @param file
     * @return
     */
    public static PatchLoadResult dynamicLoadPatch(File file) {
        if (file == null || !file.exists() || !file.canRead() || !file.isFile()) {
            LogUtil.e(TAG, "文件%s无法处理", file);
            return null;
        }

        File outFolder = null;
        try {
            outFolder = DecompressUtil.decompressZip(file, FileUtils.getSubDir("tmp"));
            if (outFolder == null) {
                throw new PatchProcessException("Can't decompress file " + file, outFolder);
            }

            // 防止有一层目录
            File[] subFiles = outFolder.listFiles(new FileFilter() {
                @Override
                public boolean accept(File pathname) {
                    return !(pathname.isDirectory() && StringUtil.equals(pathname.getName(), "__MACOSX"));
                }
            });
            if (subFiles != null && subFiles.length == 1 && subFiles[0].isDirectory()) {
                outFolder = subFiles[0];
            }

            // 解析描述信息
            File description = new File(outFolder, "desc.json");

            if (!description.exists()) {
                LogUtil.e(TAG, "压缩文件【%s】格式有误，不包含desc.json文件", file);
                return null;
            }

            FileInputStream stream = new FileInputStream(description);

            StringBuilder sb = new StringBuilder();
            byte[] content = new byte[4096];
            int readCount = -1;
            while ((readCount = stream.read(content)) > 0) {
                sb.append(new String(content, 0, readCount));
            }

            PatchDescription patchDesc = JSON.parseObject(sb.toString(), PatchDescription.class);

            String patchName = patchDesc.getName();
            if (StringUtil.isEmpty(patchName)) {
                throw new PatchProcessException("patch name is empty", outFolder);
            }

            PatchLoadResult oldPatch = ClassUtil.getPatchInfo(patchName);
            if (oldPatch != null && oldPatch.version >= patchDesc.getVersion()) {
                throw new PatchProcessException(
                        String.format("Cant' downgrade patch %s from version %f to version %f",
                                patchName, oldPatch.version, patchDesc.getVersion()), outFolder);
            }

            PatchLoadResult result = new PatchLoadResult();
            String[] soList = patchDesc.getSoList();
            String[] soMd5s = patchDesc.getSoMd5s();
            // 解析so信息
            if (soList != null && soList.length > 0) {
                if (soMd5s == null || soMd5s.length != soList.length) {
                    throw new PatchProcessException("So hashes don't match so List", file);
                }


                for (int i = 0; i < soList.length; i++) {
                    File soFile = new File(outFolder, soList[i]);
                    String md5 = soMd5s[i];
                    if (!FileUtils.checkFileMd5(soFile, md5)) {
                        throw new PatchProcessException("SO File " + soFile + "doesn't match its md5", outFolder);
                    }
                }
            }

            // 加载jar包信息
            String jar = patchDesc.getJar();
            String jarMd5 = patchDesc.getJarMd5();
            if (!StringUtil.isEmpty(jar)) {
                File jarFile = new File(outFolder, jar);
                if (!FileUtils.checkFileMd5(jarFile, jarMd5)) {
                    throw new PatchProcessException("Jar File " + jarFile + "doesn't match its md5", outFolder);
                }

                // 校验主入口是否存在
                if (!StringUtil.isEmpty(patchDesc.getMainClass()) && !StringUtil.isEmpty(patchDesc.getMainMethod())) {
                    DexClassLoader tmpLoader = new DexClassLoader(jarFile.getCanonicalPath(),
                            LauncherApplication.getContext().getFilesDir().getPath(), null,
                            LauncherApplication.getContext().getClassLoader());
                    Class targetClass = tmpLoader.loadClass(patchDesc.getMainClass());
                    // 如果该方法不存在
                    if (targetClass == null) {
                        throw new PatchProcessException(
                                String.format("Class %s not exists", patchDesc.getMainClass()), outFolder);
                    }

                    Method[] methods = targetClass.getDeclaredMethods();
                    boolean findFlag = false;
                    for (Method method: methods) {
                        if (StringUtil.equals(method.getName(), patchDesc.getMainMethod())) {
                            findFlag = true;
                            break;
                        }
                    }

                    if (!findFlag) {
                        throw new PatchProcessException(
                                String.format("Class %s doesn't contain method %s",
                                        patchDesc.getMainClass(), patchDesc.getMainMethod()), outFolder);
                    }

                    result.entryClass = patchDesc.getMainClass();
                    result.entryMethod = patchDesc.getMainMethod();
                }
                result.filter = patchDesc.getFilter();
            }

            result.name = patchDesc.getName();
            result.version = patchDesc.getVersion();

            // 拷贝到内部的patch目录，先删除，后安装
            File innerDirectory = new File(FileUtils.getInnerSubDir("patch"), patchDesc.getName());
            if (innerDirectory.exists() && innerDirectory.isDirectory()) {
                FileUtils.deleteFile(innerDirectory);
            }
            innerDirectory.mkdirs();

            if (!StringUtil.isEmpty(jar)) {
                File targetJar = new File(innerDirectory, jar);
                FileUtils.copyFile(new File(outFolder, jar), targetJar);
                result.jarPath = targetJar.getCanonicalPath();
            }
            if (soList != null && soList.length > 0) {
                File lib = new File(innerDirectory, "lib");
                lib.mkdirs();
                String[] innerFiles = new String[soList.length];
                for (int i = 0; i < soList.length; i++) {
                    File soFile = new File(outFolder, soList[i]);
                    File targetSo = new File(lib, soFile.getName());
                    FileUtils.copyFile(soFile, targetSo);
                    soFile.setExecutable(true);
                    innerFiles[i] = targetSo.getCanonicalPath();
                }

                result.soPath = lib.getPath();
                result.preloadSo = patchDesc.getPreloadSo();
            }
            result.root = innerDirectory.getPath();

            File assetsFolder = new File(innerDirectory, "assets");
            if (!assetsFolder.exists()) {
                assetsFolder.mkdir();
            }

            result.assetsPath = assetsFolder.getPath();

            String assetsZip = patchDesc.getAssetsZip();
            String assetsMd5 = patchDesc.getAssetsMd5();
            if (!StringUtil.isEmpty(assetsZip)) {
                File assetsFile = new File(outFolder, assetsZip);
                if (!FileUtils.checkFileMd5(assetsFile, assetsMd5)) {
                    throw new PatchProcessException("Assets File " + assetsZip + "doesn't match its md5", outFolder);
                }

                // 解压assets
                File assetsDecompressed = DecompressUtil.decompressZip(assetsFile, FileUtils.getSubDir("tmp"));

                if (assetsDecompressed != null && assetsDecompressed.isDirectory()) {
                    FileUtils.copyDirectory(assetsDecompressed, assetsFolder);
                }

                // 删除文件
                if (assetsDecompressed != null && assetsDecompressed.exists()) {
                    FileUtils.deleteFile(assetsDecompressed);
                }
            }

            return result;

        } catch (Exception e) {
            LogUtil.e(TAG, e, "压缩文件【%s】处理失败", file);
            return null;
        } finally {
            if (outFolder != null && outFolder.exists()) {
                // 稳妥走deleteFile
                FileUtils.deleteFile(outFolder);
            }
        }
    }

    public static final class PatchProcessException extends Exception {
        public PatchProcessException(String message, File patch) {
            super("【PatchFile—" + patch + "】" + message);
        }
    }
}
