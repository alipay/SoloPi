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
package com.alipay.hulu.adapter;

import android.content.Context;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.common.bean.DeviceInfo;
import com.alipay.hulu.common.utils.StringUtil;

import java.text.DateFormat;
import java.text.SimpleDateFormat;
import java.util.Locale;

public class LocalTaskResultListAdapter extends SoloBaseAdapter<ReplayResultBean> {
    private static DateFormat SIMPLE_FORMAT = new SimpleDateFormat("HH:mm:ss", Locale.CHINA);
    private static DateFormat DATE_FORMAT = new SimpleDateFormat("yyyy-MM-dd", Locale.CHINA);

    public LocalTaskResultListAdapter(Context context) {
        super(context);
    }


    @Override
    public View getView(int position, View convertView, ViewGroup parent) {
        ViewHolder holder;
        if (convertView == null) {
            convertView = mInflater.inflate(R.layout.item_replay_result_info, parent, false);
            holder = new ViewHolder();
            holder.title = convertView.findViewById(R.id.item_replay_result_title);
            holder.deviceInfo = convertView.findViewById(R.id.item_replay_result_device_info);
            holder.status = convertView.findViewById(R.id.item_replay_result_status);
            holder.runTime = convertView.findViewById(R.id.item_replay_result_run_time);
            holder.targetApp = convertView.findViewById(R.id.item_replay_result_target_app);
            convertView.setTag(holder);
        } else {
            holder = (ViewHolder) convertView.getTag();
        }

        ReplayResultBean result = getItem(position);
        String title = result.getCaseName();
        holder.title.setText(title);

        DeviceInfo deviceInfo = result.getDeviceInfo();
        if (deviceInfo != null) {
            String device = String.format("%s %s - %s", deviceInfo.getBrand(), deviceInfo.getProduct(), deviceInfo.getSystemVersion());
            holder.deviceInfo.setVisibility(View.VISIBLE);
            holder.deviceInfo.setText(device);
        } else {
            holder.deviceInfo.setVisibility(View.GONE);
        }

        if (result.getExceptionStep() > -1) {
            holder.status.setTextColor(0xfff76262);
            holder.status.setText(R.string.constant__fail);
        } else {
            holder.status.setTextColor(0xff65c0ba);
            holder.status.setText(R.string.constant__success);
        }
        holder.runTime.setText(SIMPLE_FORMAT.format(result.getStartTime()) + " - " + SIMPLE_FORMAT.format(result.getEndTime()) + " [" + DATE_FORMAT.format(result.getStartTime()) + "]");

        String appName = result.getTargetApp();
        if (StringUtil.isNotEmpty(appName)) {
            String appVersion = result.getTargetAppVersion();
            if (StringUtil.isNotEmpty(appVersion)) {
                holder.targetApp.setText(mContext.getString(R.string.result_item__app_name_version, appName, appVersion));
            } else {
                holder.targetApp.setText(appName);
            }
        } else if (StringUtil.isNotEmpty(result.getTargetAppPkg())) {
            holder.targetApp.setText(result.getTargetAppPkg());
        }

        return convertView;
    }

    private static class ViewHolder {
        TextView title;
        TextView deviceInfo;
        TextView status;
        TextView runTime;
        TextView targetApp;
    }
}
