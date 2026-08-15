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
package com.alipay.hulu.common.utils.patch;

/**
 * Created by qiaoruikai on 2018/12/18 10:44 PM
 * 动态文件描述符
 */
public final class PatchDescription {
    private float version = 1;
    private String name;
    private String filter;

    private String jar;
    private String jarMd5;

    private String[] soList;
    private String[] soMd5s;

    private String[] preloadSo;

    /**
     * 额外资源zip
     */
    private String assetsZip;

    /**
     * 额外资源MD5
     */
    private String assetsMd5;

    private String mainClass;
    private String mainMethod;

    public float getVersion() {
        return version;
    }

    public void setVersion(float version) {
        this.version = version;
    }

    public String getFilter() {
        return filter;
    }

    public void setFilter(String filter) {
        this.filter = filter;
    }

    public String getName() {
        return name;
    }

    public void setName(String name) {
        this.name = name;
    }

    public String getJar() {
        return jar;
    }

    public void setJar(String jar) {
        this.jar = jar;
    }

    public String[] getSoList() {
        return soList;
    }

    public void setSoList(String[] soList) {
        this.soList = soList;
    }

    public String getMainClass() {
        return mainClass;
    }

    public void setMainClass(String mainClass) {
        this.mainClass = mainClass;
    }

    public String getMainMethod() {
        return mainMethod;
    }

    public void setMainMethod(String mainMethod) {
        this.mainMethod = mainMethod;
    }

    public String getJarMd5() {
        return jarMd5;
    }

    public void setJarMd5(String jarMd5) {
        this.jarMd5 = jarMd5;
    }

    public String[] getSoMd5s() {
        return soMd5s;
    }

    public void setSoMd5s(String[] soMd5s) {
        this.soMd5s = soMd5s;
    }

    public String[] getPreloadSo() {
        return preloadSo;
    }

    public void setPreloadSo(String[] preloadSo) {
        this.preloadSo = preloadSo;
    }

    public String getAssetsZip() {
        return assetsZip;
    }

    public void setAssetsZip(String assetsZip) {
        this.assetsZip = assetsZip;
    }

    public String getAssetsMd5() {
        return assetsMd5;
    }

    public void setAssetsMd5(String assetsMd5) {
        this.assetsMd5 = assetsMd5;
    }
}
