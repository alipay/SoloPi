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
import android.graphics.Color;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.shared.display.items.MemoryTools;
import com.alipay.hulu.tools.PerformStressImpl;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class PerformStressAdapter extends BaseAdapter {
	protected static final String TAG = "PerformStressAdapter";
	private LayoutInflater mInflater;
	private List<Map<String, Object>> mData;
	Context cx;

	private int cpuCount = 1;
	private int cpuPercent = 0;
	private int memory = 0;

	@Subscriber(@Param(PerformStressImpl.PERFORMANCE_STRESS_CPU_COUNT))
	public void receiveCpuCount(int count) {
		if (count == cpuCount) {
			return;
		}

		// CPU变了
		cpuCount = count;
		notifyDataSetChanged();
	}

	@Subscriber(@Param(PerformStressImpl.PERFORMANCE_STRESS_CPU_PERCENT))
	public void receiveCpuPercent(int percent) {
		if (cpuPercent == percent) {
			return;
		}

		// CPU占比变了
		cpuPercent = percent;
		notifyDataSetChanged();
	}


	@Subscriber(@Param(PerformStressImpl.PERFORMANCE_STRESS_MEMORY))
	public void receiveMemory(int memory) {
		if (memory == this.memory) {
			return;
		}

		// 内存变了
		this.memory = memory;
		notifyDataSetChanged();
	}


	public PerformStressAdapter(Context context) {
		this.cx = context;
		mInflater = LayoutInflater.from(context);
		init();
		InjectorService.g().register(this);
		LauncherApplication.service(PerformStressImpl.class);
	}

	public void stop() {
		InjectorService.g().unregister(this);
	}

	// 初始化
	private void init() {
		LogUtil.i(TAG, "init");
		mData = new ArrayList<Map<String, Object>>();
		Map<String, Object> map = new HashMap<String, Object>();

		map.put("img", android.R.drawable.ic_menu_crop);
		map.put("title", cx.getString(R.string.stress__cpu_load));
		map.put("max", 100);
		mData.add(map);

		map = new HashMap<String, Object>();
		map.put("img", android.R.drawable.ic_menu_crop);
		map.put("title", cx.getString(R.string.stress__cpu_core));
		map.put("max", getCpuCoreNum());
		mData.add(map);

		map = new HashMap<String, Object>();
		map.put("img", android.R.drawable.ic_menu_crop);
		map.put("title", cx.getString(R.string.stress__memory));
		map.put("max", MemoryTools.getTotalMemory(cx).intValue());

		mData.add(map);
	}

	private Integer getCpuCoreNum() {
		return Runtime.getRuntime().availableProcessors();
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
			convertView = mInflater.inflate(R.layout.perform_stress_list, null);
			holder.img = (ImageView) convertView.findViewById(R.id.img);
			holder.title = (TextView) convertView.findViewById(R.id.title);
			holder.sBar = (SeekBar) convertView.findViewById(R.id.sb);
			holder.data = (TextView) convertView.findViewById(R.id.stress_data);
			convertView.setTag(holder);
		} else {
			holder = (ViewHolder) convertView.getTag();
		}
		holder.img.setBackgroundResource((Integer) mData.get(position).get("img"));
		holder.title.setText(mData.get(position).get("title").toString());

		final ViewHolder finalHolder = holder;
		holder.sBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
			@Override
			public void onProgressChanged(SeekBar arg0, int progress, boolean fromUser) {
				if (fromUser) {
					switch (position) {
						case 0:
							cpuPercent = progress;
							break;
						case 1:
							cpuCount = progress;
							break;
						case 2:
							memory = progress;
							break;
						default:
							return;
					}
					// 超过一半，将颜色变成红色，提示危险
					if (position == 2) {
						if (progress > arg0.getMax() / 2) {
							finalHolder.data.setTextColor(Color.RED);
						} else {
							finalHolder.data.setTextColor(finalHolder.data.getResources().getColor(R.color.secondaryText));
						}
					}
					finalHolder.data.setText(String.valueOf(progress));
				}
			}

			@Override
			public void onStartTrackingTouch(SeekBar seekBar) {
				// TODO Auto-generated method stub
			}

			@Override
			public void onStopTrackingTouch(SeekBar seekBar) {
				LogUtil.i(TAG,
						"progress:" + (Integer) mData.get(position).get("process") + ";max:"
								+ (Integer) mData.get(position).get("max"));
				// TODO 改成接口定义通用加压方法
				switch (position) {
				case 0:// CPU占用率
                    InjectorService.g().pushMessage(PerformStressImpl.PERFORMANCE_STRESS_CPU_PERCENT, cpuPercent);
                    break;
				case 1:// CPU多核
					InjectorService.g().pushMessage(PerformStressImpl.PERFORMANCE_STRESS_CPU_COUNT, cpuCount);
					break;
				case 2:// 内存占用
                    InjectorService.g().pushMessage(PerformStressImpl.PERFORMANCE_STRESS_MEMORY, memory);
                    break;
				default:
					break;
				}
			}
		});

		holder.sBar.setMax((Integer) mData.get(position).get("max"));

		switch (position) {
			case 0:
				holder.sBar.setProgress(cpuPercent);
				holder.data.setText(Integer.toString(cpuPercent));
				break;
			case 1:
				holder.sBar.setProgress(cpuCount);
				holder.data.setText(Integer.toString(cpuCount));
				break;
			case 2:
				holder.sBar.setProgress(memory);
				if (memory > holder.sBar.getMax() / 2) {
					holder.data.setTextColor(Color.RED);
				} else {
					holder.data.setTextColor(holder.data.getResources().getColor(R.color.secondaryText));
				}
				holder.data.setText(Integer.toString(memory));
				break;
		}
		return convertView;
	}

	public final class ViewHolder {
		public ImageView img;
		public TextView title;
		public SeekBar sBar;
		public TextView data;
	}

}