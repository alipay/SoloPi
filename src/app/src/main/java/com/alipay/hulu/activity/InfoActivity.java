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

import android.content.Intent;
import android.os.Bundle;
import android.support.annotation.Nullable;
import android.text.Html;
import android.text.method.LinkMovementMethod;
import android.view.View;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.ui.HeadControlPanel;
import com.alipay.hulu.util.DialogUtils;
import com.alipay.hulu.util.SystemUtil;


/**
 * Created by cathor on 17/9/29.
 */

public class InfoActivity extends BaseActivity {
    private static final String TAG = "InfoActivity";

    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_info);
        HeadControlPanel panel = (HeadControlPanel) findViewById(R.id.info_head);
        panel.setBackIconClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                InfoActivity.this.finish();
            }
        });
        panel.setMiddleTitle(getString(R.string.activity__about));

        TextView versionName = (TextView) findViewById(R.id.version_name);
        versionName.setText(getString(R.string.info__version_text, SystemUtil.getAppVersionName()));
        TextView textView = (TextView) findViewById(R.id.detail_text);
        textView.setTextColor(getResources().getColor(R.color.secondaryText));
        textView.setText(Html.fromHtml(getString(R.string.help_text)));
        textView.setMovementMethod(LinkMovementMethod.getInstance());

        ImageView mainIcon = (ImageView) findViewById(R.id.icon);
        mainIcon.setOnLongClickListener(new View.OnLongClickListener() {
            @Override
            public boolean onLongClick(View v) {
                DialogUtils.showImageDialog(InfoActivity.this, R.drawable.solopi_main);
                return true;
            }
        });

        LinearLayout license = (LinearLayout) findViewById(R.id.info_license_text);

        license.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                startActivity(new Intent(InfoActivity.this, LicenseActivity.class));
            }
        });

    }
}
