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

import android.graphics.Point;
import android.os.Build;
import android.util.DisplayMetrics;

import com.alipay.hulu.common.bean.DeviceInfo;

import java.io.BufferedReader;
import java.io.FileReader;
import java.net.InetAddress;
import java.net.NetworkInterface;
import java.net.SocketException;
import java.util.Enumeration;


/**
 * Created by lezhou.wyl on 2018/5/17.
 */

public class DeviceInfoUtil {

    private static final String TAG = DeviceInfoUtil.class.getSimpleName();

    public static final Point realScreenSize = new Point();
    public static final Point curScreenSize = new Point();
    public static final DisplayMetrics metrics = new DisplayMetrics();


    public static String getSystemVersion() {
        return "Android " + Build.VERSION.RELEASE;
    }

    public static String getDeviceModel() {
        return Build.MODEL;
    }

    public static String getDeviceBrand() {
        return Build.BRAND;
    }

    public static String getDeviceManufacturer() {
        return Build.MANUFACTURER;
    }

    public static int getSDKVersion() {
        return Build.VERSION.SDK_INT;
    }

    public static String getSerialNo() {
        return Build.SERIAL;
    }

    public static String getProduct() {
        return Build.PRODUCT;
    }

    public static String getSize() {
        return realScreenSize.x + "*" + realScreenSize.y;
    }

    public static String getDisplaySize() {
        return curScreenSize.x + "*" + curScreenSize.y;
    }

    public static float getDensity() {
        return metrics.density;
    }

    public static int getDensityDpi() {
        return metrics.densityDpi;
    }

    public static String getCPUABI() {
        if (Build.VERSION.SDK_INT < 21) {
            return Build.CPU_ABI;
        } else {
            return Build.SUPPORTED_ABIS[0];
        }
    }

    public static String getIP() {
        InetAddress ip = getLocalInetAddress();
        return ip == null ? "" : ip.getHostAddress();
    }

    public static String getMacAddress() {
        InetAddress ip = getLocalInetAddress();
        if (ip == null) {
            return "";
        }

        String strMacAddr = null;
        try {
            byte[] b = NetworkInterface.getByInetAddress(ip).getHardwareAddress();
            StringBuilder buffer = new StringBuilder();
            for (int i = 0; i < b.length; i++) {
                if (i != 0) {
                    buffer.append(':');
                }
                String str = Integer.toHexString(b[i] & 0xFF);
                buffer.append(str.length() == 1 ? 0 + str : str);
            }
            strMacAddr = buffer.toString().toUpperCase();
        } catch (Exception e) {
            LogUtil.e(TAG, "getMacAddress exception: " + e.getMessage(), e);
        }

        return strMacAddr;
    }

    private static InetAddress getLocalInetAddress() {
        InetAddress ip = null;
        try {
            Enumeration<NetworkInterface> en_netInterface = NetworkInterface.getNetworkInterfaces();
            while (en_netInterface.hasMoreElements()) {
                NetworkInterface ni = en_netInterface.nextElement();
                Enumeration<InetAddress> en_ip = ni.getInetAddresses();
                while (en_ip.hasMoreElements()) {
                    ip = en_ip.nextElement();
                    if (!ip.isLoopbackAddress() && !ip.getHostAddress().contains(":"))
                        break;
                    else
                        ip = null;
                }
                if (ip != null) {
                    break;
                }
            }
        } catch (SocketException e) {
            LogUtil.e(TAG, "getLocalInetAddress exception: " + e.getMessage(), e);
        }
        return ip;
    }

    public static int getTotalRAM(){
        String path = "/proc/meminfo";
        String firstLine = null;
        int totalRam = 0 ;
        try{
            FileReader fileReader = new FileReader(path);
            BufferedReader br = new BufferedReader(fileReader,8192);
            firstLine = br.readLine().split("\\s+")[1];
            br.close();
        }catch (Exception e){
            LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
        }
        if(firstLine != null){
            try {
                totalRam = (int)Math.ceil((Float.valueOf(Float.valueOf(firstLine) / (1024 * 1024)).doubleValue()));
            } catch (Exception e) {
                LogUtil.e(TAG, "getTotalRam exception: " + e.getMessage(), e);
            }

        }

        return totalRam;
    }

    public static DeviceInfo generateDeviceInfo() {
        DeviceInfo deviceInfo = new DeviceInfo();
        deviceInfo.setBrand(getDeviceBrand());
        deviceInfo.setModel(getDeviceModel());
        deviceInfo.setManufacturer(getDeviceManufacturer());
        deviceInfo.setProduct(getProduct());
        deviceInfo.setIp(getIP());
        deviceInfo.setMac(getMacAddress());
        deviceInfo.setSerialNo(getSerialNo());
        deviceInfo.setSystemVersion(getSystemVersion());
        deviceInfo.setSdkVersion(getSDKVersion());
        deviceInfo.setScreenSize(getSize());
        deviceInfo.setDisplaySize(getDisplaySize());
        deviceInfo.setDensity(getDensity());
        deviceInfo.setDensityDpi(getDensityDpi());
        deviceInfo.setRam(getTotalRAM());
        deviceInfo.setCpuABI(getCPUABI());
        return deviceInfo;
    }

}
