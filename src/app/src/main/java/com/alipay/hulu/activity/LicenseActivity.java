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
package com.alipay.hulu.activity;

import android.os.Bundle;
import android.support.annotation.Nullable;
import android.view.View;
import android.webkit.WebView;

import com.alipay.hulu.R;
import com.alipay.hulu.ui.HeadControlPanel;

/**
 * Created by qiaoruikai on 2018/10/24 3:42 PM.
 */
public class LicenseActivity extends BaseActivity {
    private static final String TAG = "LicenseActivity";

    private static final String NOTICE_HTML = "file:///android_asset/NOTICE.html";

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_license);

        HeadControlPanel panel = (HeadControlPanel) findViewById(R.id.license_head);
        panel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                finish();
            }
        });
        panel.setMiddleTitle("开源许可");

        final WebView licenseText = (WebView) findViewById(R.id.license_text);
        licenseText.loadUrl(NOTICE_HTML);
    }
}
