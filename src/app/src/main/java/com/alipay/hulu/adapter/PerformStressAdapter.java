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
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.BaseAdapter;
import android.widget.ImageView;
import android.widget.SeekBar;
import android.widget.TextView;
import android.widget.Toast;

import com.alipay.hulu.R;
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
	private Map<Integer, Boolean> isSelected;
	Context cx;

	public PerformStressAdapter(Context context) {
		this.cx = context;
		mInflater = LayoutInflater.from(context);
		init();
	}

	// 初始化
	private void init() {
		LogUtil.i(TAG, "init");
		mData = new ArrayList<Map<String, Object>>();
		Map<String, Object> map = new HashMap<String, Object>();

		map.put("img", android.R.drawable.ic_menu_crop);
		map.put("title", "CPU负载(%)");
		map.put("process", 0);
		map.put("max", 100);
		mData.add(map);

		map = new HashMap<String, Object>();
		map.put("img", android.R.drawable.ic_menu_crop);
		map.put("title", "CPU多核(n)");
		map.put("process", 1);
		map.put("max", getCpuCoreNum());
		mData.add(map);

		map = new HashMap<String, Object>();
		map.put("img", android.R.drawable.ic_menu_crop);
		map.put("title", "内存占用(m)");
		map.put("process", 0);
		map.put("max", MemoryTools.getAvailMemory(cx).intValue());

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
					mData.get(position).put("process", progress);
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

				PerformStressImpl performStressImpl = PerformStressImpl.getInstanceImpl();
				// TODO 改成接口定义通用加压方法
				switch (position) {
				case 0:// CPU占用率
					performStressImpl.performCpuStressByCount((int) mData.get(0).get("process"), (int) mData.get(1)
							.get("process"));
					// CPUTools.performStress((int)
					// mData.get(position).get("process"));
					break;
				case 1:// CPU多核
					performStressImpl.performCpuStressByCount((int) mData.get(0).get("process"), (int) mData.get(1)
							.get("process"));
					break;
				case 2:// 内存占用
					try {
						int allocMemory = MemoryTools.dummyMem((int) mData.get(2).get("process"));
						if (allocMemory != seekBar.getProgress()) {
							seekBar.setProgress(allocMemory);
						}
					} catch (OutOfMemoryError e) {
						Toast.makeText(cx, "内存不足:" + e,Toast.LENGTH_SHORT).show();
					}
					break;
				default:
					break;
				}
			}
		});

		holder.sBar.setMax((Integer) mData.get(position).get("max"));
		holder.sBar.setProgress((Integer) mData.get(position).get("process"));
		holder.data.setText("0");
		return convertView;
	}

	public final class ViewHolder {
		public ImageView img;
		public TextView title;
		public SeekBar sBar;
		public TextView data;
	}

}