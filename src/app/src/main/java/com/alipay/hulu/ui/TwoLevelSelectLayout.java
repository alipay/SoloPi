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
package com.alipay.hulu.ui;

import android.annotation.TargetApi;
import android.content.Context;
import android.os.Build;
import android.support.annotation.Nullable;
import android.util.AttributeSet;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.AbsListView;
import android.widget.AdapterView;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2019/1/29 9:36 PM.
 */
public class TwoLevelSelectLayout extends LinearLayout {
    private static final String TAG = "TwoLevelSelectLayout";

    private List<String> keys = new ArrayList<>();
    private List<Integer> icons = new ArrayList<>();
    private List<SubMenuItem> currentSecondLevelItems = new ArrayList<>();
    private Map<String, List<SubMenuItem>> allSecondLevelItems = new HashMap<>();

    private ListView firstLevel;
    private ListView secondLevel;

    private BaseAdapter firstLevelAdapter;
    private BaseAdapter secondLevelAdapter;

    private int firstLevelSelectId = 0;

    private OnSubMenuClickListener listener;

    public TwoLevelSelectLayout(Context context) {
        this(context, null);
    }

    public TwoLevelSelectLayout(Context context, @Nullable AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public TwoLevelSelectLayout(Context context, @Nullable AttributeSet attrs, int defStyleAttr) {
        super(context, attrs, defStyleAttr);

        initView(context, attrs, defStyleAttr);
        initData();
    }

    @TargetApi(21)
    public TwoLevelSelectLayout(Context context, AttributeSet attrs, int defStyleAttr, int defStyleRes) {
        super(context, attrs, defStyleAttr, defStyleRes);

        initView(context, attrs, defStyleAttr);
        initData();
    }

    /**
     * 初始化界面
     * @param context
     * @param attrs
     * @param style
     */
    private void initView(Context context, AttributeSet attrs, int style) {
        setOrientation(HORIZONTAL);

        int dividerColor;
        if (Build.VERSION.SDK_INT >= 23) {
            dividerColor = getResources().getColor(R.color.divider_color, context.getTheme());
        } else {
            dividerColor = getResources().getColor(R.color.divider_color);
        }

        Context styledContext = ContextUtil.getContextThemeWrapper(context, R.style.selectListView);

        // 左侧FirstLevel
        firstLevel = new ListView(styledContext);
        firstLevel.setVerticalScrollBarEnabled(false);

        LayoutParams params = new LayoutParams(ContextUtil.dip2px(context, 40), ViewGroup.LayoutParams.MATCH_PARENT);
        addView(firstLevel, params);

        // 分割线
        View divider = new View(context, attrs, style);
        divider.setBackgroundColor(dividerColor);
        LayoutParams dividerParam = new LayoutParams(1, ViewGroup.LayoutParams.MATCH_PARENT);
        addView(divider, dividerParam);

        // 右侧滚动条
        secondLevel = new ListView(styledContext);
        LayoutParams secondParams = new LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT,
                ViewGroup.LayoutParams.MATCH_PARENT, 1.0F);
        addView(secondLevel, secondParams);
    }

    private void initData() {
        firstLevelAdapter = new BaseAdapter() {

            @Override
            public int getCount() {
                return keys.size();
            }

            @Override
            public Object getItem(int position) {
                return keys.get(position);
            }

            @Override
            public long getItemId(int position) {
                return position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                if (convertView == null) {
                    convertView = LayoutInflater.from(
                            ContextUtil.getContextThemeWrapper(getContext(),
                                    R.style.AppDialogTheme)).inflate(
                                            R.layout.dialog_first_level_item, null);
                }

                // 设置图标
                ImageView icon = (ImageView) convertView.findViewById(R.id.first_level_icon);
                icon.setImageResource(icons.get(position));

                return convertView;
            }

            @Override
            public boolean isEmpty() {
                return keys.isEmpty();
            }
        };

        firstLevel.setAdapter(firstLevelAdapter);
        firstLevel.setChoiceMode(AbsListView.CHOICE_MODE_SINGLE);

        secondLevelAdapter = new BaseAdapter() {

            @Override
            public int getCount() {
                return currentSecondLevelItems.size();
            }

            @Override
            public Object getItem(int position) {
                return currentSecondLevelItems.get(position);
            }

            @Override
            public long getItemId(int position) {
                return firstLevelSelectId * 100 + position;
            }

            @Override
            public View getView(int position, View convertView, ViewGroup parent) {
                if (convertView == null) {
                    convertView = LayoutInflater.from(
                            ContextUtil.getContextThemeWrapper(getContext(),
                                    R.style.AppDialogTheme)).inflate(
                            R.layout.dialog_action_click_item, parent, false);
                }

                // 加载资源
                TextView text = (TextView) convertView.findViewById(R.id.dialog_action_title);
                text.setText(currentSecondLevelItems.get(position).name);

                // 如果有图标信息
                int iconInfo = currentSecondLevelItems.get(position).icon;
                ImageView img = (ImageView) convertView.findViewById(R.id.dialog_action_icon);
                if (iconInfo > 0) {
                    img.setVisibility(VISIBLE);
                    img.setImageResource(iconInfo);
                } else {
                    img.setVisibility(GONE);
                }
                return convertView;
            }

            @Override
            public boolean isEmpty() {
                return currentSecondLevelItems.isEmpty();
            }
        };
        secondLevel.setAdapter(secondLevelAdapter);

        firstLevel.setOnItemClickListener(new AdapterView.OnItemClickListener() {

            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                LogUtil.d(TAG, "选择一级菜单:" + keys.get(position));
                firstLevelSelectId = position;

                // 更新子菜单
                currentSecondLevelItems.clear();
                currentSecondLevelItems.addAll(allSecondLevelItems.get(keys.get(position)));
                view.setSelected(true);

                secondLevelAdapter.notifyDataSetChanged();
            }
        });

        secondLevel.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                LogUtil.d(TAG, "Select item: " + currentSecondLevelItems.get(position));
                if (listener != null) {
                    listener.onSubMenuClick((SubMenuItem) secondLevel.getItemAtPosition(position));
                }
            }
        });
    }

    /**
     * 更新菜单信息
     * @param keys
     * @param resources
     * @param secondLevels
     */
    public void updateMenus(List<String> keys, List<Integer> resources, Map<String, List<SubMenuItem>> secondLevels) {
        // 要求key与icon一一对应
        if (keys == null || resources == null || keys.size() != resources.size()) {
            return;
        }

        // 空数据
        if (keys.size() == 0) {
            return;
        }

        this.keys = keys;
        this.icons = resources;

        // 通知数据变化
        firstLevel.deferNotifyDataSetChanged();

        allSecondLevelItems.clear();
        allSecondLevelItems.putAll(secondLevels);

        firstLevelAdapter.notifyDataSetChanged();
        // 点击一下
        post(new Runnable() {
            @Override
            public void run() {
                firstLevel.performItemClick(firstLevel.getChildAt(0), 0, 111);
            }
        });
    }

    public void setOnSubMenuItemClickListener(OnSubMenuClickListener listener) {
        this.listener = listener;
    }

    /**
     * 子菜单项
     */
    public static class SubMenuItem {
        public String name;
        public String key;
        public String extra;
        public int icon = -1;

        public SubMenuItem(String name, String key, int icon) {
            this.name = name;
            this.key = key;
            this.icon = icon;
        }

        public SubMenuItem(String name, String key) {
            this.name = name;
            this.key = key;
        }

        @Override
        public String toString() {
            return "SubMenuItem{" +
                    "name='" + name + '\'' +
                    ", key='" + key + '\'' +
                    ", extra='" + extra + '\'' +
                    '}';
        }
    }

    public interface OnSubMenuClickListener {
        void onSubMenuClick(SubMenuItem item);
    }
}
