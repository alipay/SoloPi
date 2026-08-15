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
import androidx.recyclerview.widget.RecyclerView;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.service.DisplayManager;
import com.alipay.hulu.shared.display.DisplayItemInfo;

import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.List;

public class FloatWinAdapter extends RecyclerView.Adapter<FloatWinAdapter.InformationViewHolder> {
	private String TAG = "FloatWinAdapter";
	private LayoutInflater mInflater;
    private List<DisplayItemInfo> listViewData;
    private List<String> contents;
    private WeakReference<DisplayManager> managerRef;
	Context context;

    private View.OnTouchListener listener = new View.OnTouchListener() {
        @Override
        public boolean onTouch(View v, MotionEvent event) {
            return false;
        }
    };

    public void updateListViewSource(List<DisplayItemInfo> infoList, List<String> messages) {
        this.listViewData = infoList;
        this.contents = messages;
        notifyDataSetChanged();
    }

    public FloatWinAdapter(Context context, DisplayManager manager, List<DisplayItemInfo> listViewData) {
		this.context = context;
		this.managerRef = new WeakReference<>(manager);
		this.listViewData = listViewData;
		this.contents = new ArrayList<>();
        mInflater = LayoutInflater.from(context);
	}

    @Override
    public InformationViewHolder onCreateViewHolder(ViewGroup parent, int viewType) {
        View convertView = mInflater.inflate(R.layout.float_win_list, null);
        convertView.setOnTouchListener(listener);
//        RecyclerView.LayoutParams layoutParams = new RecyclerView.LayoutParams(ViewGroup.LayoutParams.WRAP_CONTENT, ViewGroup.LayoutParams.WRAP_CONTENT);
//        convertView.setLayoutParams(layoutParams);
        return new InformationViewHolder(convertView, managerRef.get());
    }

    @Override
    public void onBindViewHolder(InformationViewHolder holder, int position) {
        DisplayItemInfo info = listViewData.get(position);
        if (contents == null || contents.size() <= position) {
            holder.updateViewContent(info, null);
        } else {
            holder.updateViewContent(info, contents.get(position));
        }
    }

    @Override
    public int getItemCount() {
        return listViewData.size();
    }

    static final class InformationViewHolder extends RecyclerView.ViewHolder {
		private TextView content;
        private TextView appTitle;
        private TextView trigger;
        private DisplayItemInfo currentInfo;

        private InformationViewHolder(View itemView, final DisplayManager manager) {
            super(itemView);
            content = (TextView) itemView.findViewById(R.id.display_content);
            appTitle = (TextView) itemView.findViewById(R.id.display_title);
            trigger = (TextView) itemView.findViewById(R.id.display_trigger);
            trigger.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    manager.triggerInfo(currentInfo);
                }
            });
        }

        private void updateViewContent(DisplayItemInfo info, final String content) {
            this.appTitle.setText(info.getName());
            this.content.setText(content);
            if (!StringUtil.isEmpty(info.getTrigger())) {
                this.trigger.setText(info.getTrigger());
                this.trigger.setVisibility(View.VISIBLE);
                this.currentInfo = info;
            } else {
                this.trigger.setVisibility(View.GONE);
            }
        }

    }

}