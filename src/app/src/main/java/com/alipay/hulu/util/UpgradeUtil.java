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
package com.alipay.hulu.util;

import com.alipay.hulu.BuildConfig;
import com.alipay.hulu.bean.GithubReleaseBean;
import com.alipay.hulu.common.utils.HttpUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.io.IOException;

import okhttp3.Call;

public class UpgradeUtil {
    private static final String RELEASE_API = "https://api.github.com/repos/alipay/solopi/releases/latest";
    private static final String TAG = "UpgradeUtil";

    /**
     * Check update
     * @param listener
     */
    public static void checkForUpdate(final CheckUpdateListener listener) {
        // no upgrade for debug version
        if (BuildConfig.DEBUG) {
            return;
        }

        HttpUtil.get(RELEASE_API, new HttpUtil.Callback<GithubReleaseBean>(GithubReleaseBean.class) {
            @Override
            public void onResponse(Call call, GithubReleaseBean item) throws IOException {
                String versionName = SystemUtil.getAppVersionName();
                String tagName = item.getTag_name();
                if (StringUtil.startWith(tagName, "v")) {
                    tagName = tagName.substring(1);
                }

                // should update?
                boolean update = shouldUpdate(tagName, versionName);
                if (update) {
                    listener.onNewUpdate(item);
                } else {
                    listener.onNoUpdate();
                }
            }

            @Override
            public void onFailure(Call call, IOException e) {
                LogUtil.e(TAG, "Check update failed", e);
                listener.onUpdateFailed(e);
            }
        });
    }

    /**
     * Check versions
     * @param newVersion
     * @param oldVersion
     * @return
     */
    private static boolean shouldUpdate(String newVersion, String oldVersion) {
        if (StringUtil.isEmpty(newVersion) || StringUtil.isEmpty(oldVersion)) {
            return false;
        }

        try {
            String[] newSplit = newVersion.split("\\.");
            String[] oldSplit = oldVersion.split("\\.");
            int commonLength = Math.min(newSplit.length, oldSplit.length);
            for (int i = 0; i < commonLength; i++) {
                int newCode = Integer.parseInt(newSplit[i]);
                int oldCode = Integer.parseInt(oldSplit[i]);
                if (newCode > oldCode) {
                    return true;
                } else if (newCode < oldCode) {
                    return false;
                }
            }

            return newSplit.length > oldSplit.length;
        } catch (NumberFormatException e) {
            LogUtil.e(TAG, e, "parse version failed: old: %s, new: %s", oldVersion, newVersion);
            return false;
        }
    }

    public interface CheckUpdateListener {
        void onNoUpdate();

        void onNewUpdate(GithubReleaseBean release);

        void onUpdateFailed(Throwable t);
    }
}
