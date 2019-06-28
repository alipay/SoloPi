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

import android.app.Activity;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.CheckBox;
import android.widget.ImageView;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.service.DisplayManager;
import com.alipay.hulu.shared.display.DisplayItemInfo;
import com.alipay.hulu.shared.display.DisplayProvider;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

public class PerformFloatAdapter extends BaseAdapter implements View.OnClickListener{
	private String TAG = "PerformFloatAdapter";
	private LayoutInflater mInflater;
	private List<DisplayItemInfo> mData;
	private List<String> packages = new ArrayList<>();

	private DisplayProvider provider;
	private DisplayManager displayManager;

	private Map<Integer, Boolean> isSelected;

	Activity context;

	public PerformFloatAdapter(Activity context) {
		this.context = context;
		packages.add("com.alipay.hulu.display");
		mInflater = LayoutInflater.from(context);

		init();
	}

	// 初始化
	private void init() {
		mData = new ArrayList<>();
		displayManager = DisplayManager.getInstance();
		provider = LauncherApplication.getInstance().findServiceByName(DisplayProvider.class.getName());
		mData = provider.getAllDisplayItems();

		Set<String> runningItems = provider.getRunningDisplayItems();


		// 这儿定义isSelected这个map是记录每个listitem的状态，初始状态全部为false。
		isSelected = new HashMap<>();
		for (int i = 0; i < mData.size(); i++) {
		    if (runningItems.contains(mData.get(i).getName())) {
		        isSelected.put(i, true);
		    } else {
                isSelected.put(i, false);
            }
		}

		InjectorService injectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
		injectorService.register(this);
	}

	@Override
	public int getCount() {
		return mData.size();
	}

	@Override
	public Object getItem(int position) {
		return null;
	}

	@Override
	public long getItemId(int position) {
		return 0;
	}

	@Override
	public View getView(final int position, View convertView, ViewGroup parent) {
		ViewHolder holder = null;
		// convertView为null的时候初始化convertView。
		if (convertView == null) {
			holder = new ViewHolder();
			convertView = mInflater.inflate(R.layout.perform_float_list, null);
			holder.img = (ImageView) convertView.findViewById(R.id.img);
			holder.title = (TextView) convertView.findViewById(R.id.title);
			holder.cBox = (CheckBox) convertView.findViewById(R.id.cb);
			holder.cBox.setOnClickListener(this);
			holder.tip = (TextView) convertView.findViewById(R.id.tip);
			convertView.setTag(holder);
		} else {
			holder = (ViewHolder) convertView.getTag();
		}

		holder.img.setImageResource(mData.get(position).getIcon());
		holder.title.setText(mData.get(position).getName());
		holder.tip.setText(mData.get(position).getTip());
		holder.cBox.setChecked(isSelected.get(position));
		holder.cBox.setTag(position);
		return convertView;
	}

	@Override
	public void onClick(final View v) {
		final int position = (Integer) v.getTag();
		if (!isSelected.get(position)) {
			// 悬浮窗权限检查
			Set<String> permissions = new HashSet<>();
			permissions.add("float");
			permissions.addAll(mData.get(position).getPermissions());
			PermissionUtil.requestPermissions(new ArrayList<>(permissions), context, new PermissionUtil.OnPermissionCallback() {
				@Override
				public void onPermissionResult(boolean result, String reason) {
					if (result) {
						// 配置添加项
						List<DisplayItemInfo> add = new ArrayList<>(2);
						add.add(mData.get(position));

						isSelected.put(position, true);
						List<DisplayItemInfo> failedItems = displayManager.updateRecordingItems(add, null);

						// 如果显示失败
						if (failedItems != null && failedItems.size() > 0) {
							for (DisplayItemInfo failed: failedItems) {
								LogUtil.w(TAG, "Open item %s failed", failed.getName());
								int idx = mData.indexOf(failed);
								isSelected.put(idx, false);
							}
						}
					}

					((CheckBox) v).setChecked(isSelected.get(position));
				}
			});
		} else {
			List<DisplayItemInfo> remove = new ArrayList<>(2);
			// 配置添加项
			remove.add(mData.get(position));

			isSelected.put(position, false);
			displayManager.updateRecordingItems(null, remove);

			((CheckBox) v).setChecked(isSelected.get(position));
		}
	}

	@Subscriber(value = @Param(DisplayManager.STOP_DISPLAY), thread = RunningThread.MAIN_THREAD)
	public void onDisplayStop() {
		for (int i = 0; i < mData.size(); i++) {
			isSelected.put(i, false);
		}
		notifyDataSetChanged();
	}

	public static final class ViewHolder {
		public ImageView img;
		public TextView title;
		public TextView tip;
		public CheckBox cBox;
	}
}