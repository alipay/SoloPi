package com.android.permission.rom;

import android.app.Activity;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import android.util.Log;
import android.widget.Toast;

import java.lang.reflect.Method;

/**
 * Created by qiaoruikai on 2019-03-28 17:01.
 */
public class VivoUtils {
    private static final String TAG = "QikuUtils";

    /**
     * 检测 Vivo 悬浮窗权限
     */
    public static boolean checkFloatWindowPermission(Context context) {
        final int version = Build.VERSION.SDK_INT;
        if (version >= 21) {
            try {
                return getFloatPermissionStatus(context) == 0;
            } catch (Exception e) {
                e.printStackTrace();

                // 通常方式去检查
                if (Build.VERSION.SDK_INT >= 23) {
                    try {
                        Class clazz = Settings.class;
                        Method canDrawOverlays = clazz.getDeclaredMethod("canDrawOverlays", Context.class);
                        return (Boolean) canDrawOverlays.invoke(null, context);
                    } catch (Exception e1) {
                        Log.e(TAG, Log.getStackTraceString(e1));
                    }
                }
                return true;
            }
        }
        return true;
    }

    /**
     * 去i管家申请页面
     */
    public static void applyPermission(final Context context) {
        Intent appIntent = context.getPackageManager().getLaunchIntentForPackage("com.iqoo.secure");
        if(appIntent != null){
            try {
                context.startActivity(appIntent);
                if (context instanceof Activity) {
                    ((Activity) context).runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(context, "请进入\"应用管理->权限管理->悬浮窗\"页面开启权限", Toast.LENGTH_LONG).show();
                        }
                    });
                }
            } catch (Exception e) {
                e.printStackTrace();

                if (context instanceof Activity) {
                    ((Activity) context).runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            Toast.makeText(context, "请手动开启i管家，进入\"应用管理->权限管理->悬浮窗\"页面开启权限", Toast.LENGTH_LONG).show();
                        }
                    });
                }
            }
        } else {
            if (context instanceof Activity) {
                ((Activity) context).runOnUiThread(new Runnable() {
                    @Override
                    public void run() {
                        Toast.makeText(context, "请手动开启i管家，进入\"应用管理->权限管理->悬浮窗\"页面开启权限", Toast.LENGTH_LONG).show();
                    }
                });
            }
        }
    }

    /**
     * 获取悬浮窗权限状态
     *
     * @param context
     * @return 1或其他是没有打开，0是打开，该状态的定义和{@link android.app.AppOpsManager#MODE_ALLOWED}，MODE_IGNORED等值差不多，自行查阅源码
     */
    public static int getFloatPermissionStatus(Context context) {
        if (context == null) {
            throw new IllegalArgumentException("context is null");
        }
        String packageName = context.getPackageName();
        Uri uri = Uri.parse("content://com.iqoo.secure.provider.secureprovider/allowfloatwindowapp");
        String selection = "pkgname = ?";
        String[] selectionArgs = new String[]{packageName};
        Cursor cursor = context
                .getContentResolver()
                .query(uri, null, selection, selectionArgs, null);
        if (cursor != null) {
            cursor.getColumnNames();
            if (cursor.moveToFirst()) {
                int currentmode = cursor.getInt(cursor.getColumnIndex("currentlmode"));
                cursor.close();
                return currentmode;
            } else {
                cursor.close();
                return getFloatPermissionStatus2(context);
            }

        } else {
            return getFloatPermissionStatus2(context);
        }
    }

    /**
     * vivo比较新的系统获取方法
     *
     * @param context
     * @return
     */
    private static int getFloatPermissionStatus2(Context context) {
        String packageName = context.getPackageName();
        Uri uri2 = Uri.parse("content://com.vivo.permissionmanager.provider.permission/float_window_apps");
        String selection = "pkgname = ?";
        String[] selectionArgs = new String[]{packageName};
        Cursor cursor = context
                .getContentResolver()
                .query(uri2, null, selection, selectionArgs, null);
        if (cursor != null) {
            if (cursor.moveToFirst()) {
                int currentmode = cursor.getInt(cursor.getColumnIndex("currentmode"));
                cursor.close();
                return currentmode;
            } else {
                cursor.close();
                return 1;
            }
        }
        return 1;
    }
}
