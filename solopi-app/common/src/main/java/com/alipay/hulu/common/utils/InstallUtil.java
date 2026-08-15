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

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import androidx.core.content.FileProvider;

import com.alipay.hulu.common.application.LauncherApplication;

import java.io.File;

/**
 * Created by lezhou.wyl on 2018/2/15.
 */

public class InstallUtil {

    private static final String TAG = InstallUtil.class.getSimpleName();

    public static boolean installNormal(Context context, String filePath) {
        Intent i = new Intent(Intent.ACTION_VIEW);
        File file = new File(filePath);
        if (!file.exists() || !file.isFile()
                || file.length() <= 0) {
            return false;
        }

        i.setDataAndType(Uri.parse("file://" + filePath),
                "application/vnd.android.package-archive");
        i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        context.startActivity(i);
        return true;
    }

    public static void installNormalWithFile(Context context, File file) {
        Intent i = new Intent(Intent.ACTION_VIEW);
        i.setAction("android.intent.action.VIEW");
        i.addCategory("android.intent.category.DEFAULT");
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
        String type = "application/vnd.android.package-archive";
        if(Build.VERSION.SDK_INT>=Build.VERSION_CODES.N) {
            Uri uri= FileProvider.getUriForFile(context, LauncherApplication.getInstance().getApplicationInfo().packageName + ".myProvider",file);
            i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
            i.setDataAndType(uri,type);
        }else{
            i.setDataAndType(Uri.fromFile(file), type);
        }
        context.startActivity(i);
    }


}
