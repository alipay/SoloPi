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
package com.alipay.hulu.common.bean;

import com.alibaba.fastjson.annotation.JSONField;
import com.alipay.hulu.common.R;
import com.alipay.hulu.common.utils.StringUtil;

/**
 * Created by lezhou.wyl on 2018/5/27.
 */

public class DeviceInfo {

    @JSONField(name = "android_version")
    private String systemVersion;
    private String model;
    private String brand;
    private String manufacturer;
    @JSONField(name = "name")
    private String product;
    @JSONField(name = "sdk_version")
    private int sdkVersion;
    @JSONField(name = "serial")
    private String serialNo;
    @JSONField(name = "size")
    private String screenSize;
    private String displaySize;
    private int densityDpi;
    private float density;
    @JSONField(name = "cpu_abi")
    private String cpuABI;
    private String ip;
    private String mac;
    @JSONField(name = "memsize")
    private int ram;

    public String getDisplaySize() {
        return displaySize;
    }

    public void setDisplaySize(String displaySize) {
        this.displaySize = displaySize;
    }

    public int getDensityDpi() {
        return densityDpi;
    }

    public void setDensityDpi(int densityDpi) {
        this.densityDpi = densityDpi;
    }

    public float getDensity() {
        return density;
    }

    public void setDensity(float density) {
        this.density = density;
    }

    public String getSystemVersion() {
        return systemVersion;
    }

    public void setSystemVersion(String systemVersion) {
        this.systemVersion = systemVersion;
    }

    public String getModel() {
        return model;
    }

    public void setModel(String model) {
        this.model = model;
    }

    public String getBrand() {
        return brand;
    }

    public void setBrand(String brand) {
        this.brand = brand;
    }

    public String getManufacturer() {
        return manufacturer;
    }

    public void setManufacturer(String manufacturer) {
        this.manufacturer = manufacturer;
    }

    public String getProduct() {
        return product;
    }

    public void setProduct(String product) {
        this.product = product;
    }

    public int getSdkVersion() {
        return sdkVersion;
    }

    public void setSdkVersion(int sdkVersion) {
        this.sdkVersion = sdkVersion;
    }

    public String getSerialNo() {
        return serialNo;
    }

    public void setSerialNo(String serialNo) {
        this.serialNo = serialNo;
    }

    public String getScreenSize() {
        return screenSize;
    }

    public void setScreenSize(String screenSize) {
        this.screenSize = screenSize;
    }

    public String getCpuABI() {
        return cpuABI;
    }

    public void setCpuABI(String cpuABI) {
        this.cpuABI = cpuABI;
    }

    public String getIp() {
        return ip;
    }

    public void setIp(String ip) {
        this.ip = ip;
    }

    public String getMac() {
        return mac;
    }

    public void setMac(String mac) {
        this.mac = mac;
    }

    public int getRam() {
        return ram;
    }

    public void setRam(int ram) {
        this.ram = ram;
    }

    @Override
    public String toString() {
        return StringUtil.getString(R.string.device_info__to_string, model, brand, manufacturer, product, systemVersion, sdkVersion, serialNo, screenSize, displaySize, density, densityDpi, ip, mac, ram, cpuABI);
    }
}