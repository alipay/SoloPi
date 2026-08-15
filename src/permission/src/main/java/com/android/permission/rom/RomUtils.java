/*
 * Copyright (C) 2016 Facishare Technology Co., Ltd. All Rights Reserved.
 */
package com.android.permission.rom;

import android.os.Build;
import android.text.TextUtils;
import android.util.Log;

import java.io.BufferedReader;
import java.io.IOException;
import java.io.InputStreamReader;

/**
 * Description:
 *
 * @author zhaozp
 * @since 2016-05-23
 */
public class RomUtils {
    private static final String TAG = "RomUtils";

    /**
     * 获取 emui 版本号
     * @return
     */
    public static double getEmuiVersion() {
        try {
            String emuiVersion = getSystemProperty("ro.build.version.emui");
            String version = emuiVersion.substring(emuiVersion.indexOf("_") + 1);
            return Double.parseDouble(version);
        } catch (Exception e) {
            e.printStackTrace();
        }
        return 4.0;
    }

    private static Boolean isSony = null;
    /**
     * 判断是否是sony
     * @return
     */
    public static boolean isSonySystem() {
        if (isSony == null) {
            isSony = Build.MANUFACTURER.toUpperCase().contains("SONY");
        }
        return isSony;
    }

    private static Boolean isSamSung = null;

    /**
     * 判断是否是三星
     *
     * @return
     */
    public static boolean isSamSungSystem() {
        if (isSamSung == null) {
            isSamSung = Build.MANUFACTURER.toUpperCase().contains("SAMSUNG");
        }
        return isSamSung;
    }

    private static Boolean isOppo = null;
    /**
     * 判断是否是oppo
     * @return
     */
    public static boolean isOppoSystem() {
        if (isOppo == null) {
            isOppo = Build.MANUFACTURER.toUpperCase().contains("OPPO");
        }
        return isOppo;
    }

    private static Boolean isVivo = null;
    public static boolean isVivoSystem() {
        if (isVivo == null) {
            isVivo = Build.MANUFACTURER.toUpperCase().contains("VIVO");
        }
        return isVivo;
    }

    private static Boolean isGoogle = null;
    public static boolean isGoogleSystem() {
        if (isGoogle == null) {
            isGoogle = Build.MANUFACTURER.toUpperCase().contains("GOOGLE");
        }

        return isGoogle;
    }

    private static Boolean isSmartisan = null;
    public static boolean isSmartisanSystem() {
        if (isSmartisan == null) {
            isSmartisan = Build.MANUFACTURER.toUpperCase().contains("SMARTISAN");
        }
        return isSmartisan;
    }


    /**
     * 获取小米 rom 版本号，获取失败返回 -1
     *
     * @return miui rom version code, if fail , return -1
     */
    public static int getMiuiVersion() {
        String version = getSystemProperty("ro.miui.ui.version.name");
        if (version != null) {
            try {
                return Integer.parseInt(version.substring(1));
            } catch (Exception e) {
                Log.e(TAG, "get miui version code error, version : " + version);
            }
        }
        return -1;
    }

    public static String getSystemProperty(String propName) {
        String line;
        BufferedReader input = null;
        try {
            Process p = Runtime.getRuntime().exec("getprop " + propName);
            input = new BufferedReader(new InputStreamReader(p.getInputStream()), 1024);
            line = input.readLine();
            input.close();
        } catch (IOException ex) {
            Log.e(TAG, "Unable to read sysprop " + propName, ex);
            return null;
        } finally {
            if (input != null) {
                try {
                    input.close();
                } catch (IOException e) {
                    Log.e(TAG, "Exception while closing InputStream", e);
                }
            }
        }
        return line;
    }
    public static boolean checkIsHuaweiRom() {
        return Build.MANUFACTURER.contains("HUAWEI");
    }

    private static Boolean isMiui = null;
    /**
     * check if is miui ROM
     */
    public static boolean checkIsMiuiRom() {
        if (isMiui == null) {
            isMiui = !TextUtils.isEmpty(getSystemProperty("ro.miui.ui.version.name"));
        }
        return isMiui;
    }


    private static Boolean isMeizu = null;
    public static boolean checkIsMeizuRom() {
        //return Build.MANUFACTURER.contains("Meizu");
        if (isMeizu == null) {
            String meizuFlymeOSFlag = getSystemProperty("ro.build.display.id");
            if (TextUtils.isEmpty(meizuFlymeOSFlag)) {
                isMeizu = false;
            } else if (meizuFlymeOSFlag.contains("flyme") || meizuFlymeOSFlag.toLowerCase().contains("flyme")) {
                isMeizu = true;
            } else {
                isMeizu = false;
            }
        }

        return isMeizu;
    }

    private static Boolean is360 = null;
    public static boolean checkIs360Rom() {
        //fix issue https://github.com/zhaozepeng/FloatWindowPermission/issues/9
        if (is360 == null) {
            is360 = Build.MANUFACTURER.contains("QiKU")
                    || Build.MANUFACTURER.contains("360");
        }
        return is360;
    }

    public static String getDeviceSerialNO() {
        try {
            return getSystemProperty("ro.serialno");
        } catch (Exception e) {
            e.printStackTrace();
            Log.e("SystemUtil", e.getMessage());
        }
        return null;
    }
}
