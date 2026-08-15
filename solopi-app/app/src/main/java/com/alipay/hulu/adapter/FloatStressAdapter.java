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
import android.os.Build;
import android.view.View;
import android.widget.SeekBar;
import android.widget.TextView;

import androidx.annotation.NonNull;

import com.alipay.hulu.R;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.shared.display.items.MemoryTools;
import com.alipay.hulu.tools.PerformStressImpl;

import java.util.ArrayList;
import java.util.List;

public class FloatStressAdapter extends SoloBaseRecyclerAdapter<FloatStressAdapter.StressItem> {
    public FloatStressAdapter(Context context) {
        super(context, R.layout.float_stress_item);
        init();
    }

    private int cpuCount = 0;
    private int cpuPercent = 0;
    private int memory = 0;

    @Subscriber(@Param(PerformStressImpl.PERFORMANCE_STRESS_CPU_COUNT))
    public void receiveCpuCount(int count) {
        if (count == cpuCount) {
            return;
        }

        // CPU变了
        cpuCount = count;
        List<StressItem> items = getAllData();
        items.get(1).count = cpuCount;
        notifyDataSetChanged();
    }

    @Subscriber(@Param(PerformStressImpl.PERFORMANCE_STRESS_CPU_PERCENT))
    public void receiveCpuPercent(int percent) {
        if (cpuPercent == percent) {
            return;
        }

        // CPU占比变了
        cpuPercent = percent;
        List<StressItem> items = getAllData();
        items.get(0).count = cpuPercent;
        notifyDataSetChanged();
    }


    @Subscriber(@Param(PerformStressImpl.PERFORMANCE_STRESS_MEMORY))
    public void receiveMemory(int memory) {
        if (memory == this.memory) {
            return;
        }

        // 内存变了
        this.memory = memory;
        List<StressItem> items = getAllData();
        StressItem item = items.get(2);
        item.count = memory;
        item.max = MemoryTools.getTotalMemory(context).intValue();
        notifyDataSetChanged();
    }

    @Override
    public SimpleViewHolder<StressItem> generateViewHolder(View view) {
        return new FloatViewHolder(view);
    }

    private void init() {
        InjectorService.g().register(this);

        List<StressItem> stressItemList = new ArrayList<>();
        StressItem map = new StressItem();
        map.type = 0;
        map.title = "CPU负载";
        map.unit = "%";
        map.max = 100;
        map.count = cpuPercent;
        stressItemList.add(map);

        map = new StressItem();
        map.type = 1;
        map.title = "CPU占用核数";
        map.unit = "核";
        map.max = Runtime.getRuntime().availableProcessors();
        map.count = cpuCount;
        stressItemList.add(map);

        map = new StressItem();
        map.type = 2;
        map.title = "内存占用";
        map.unit = "MB";
        map.max = MemoryTools.getTotalMemory(context).intValue();
        map.count = memory;
        stressItemList.add(map);
        updateDate(stressItemList);
    }

    public static class StressItem {
        int type;
        String title;
        String unit;
        int max;
        int count;
    }

    private static class FloatViewHolder extends SimpleViewHolder<StressItem> {
        private TextView title;
        private TextView unit;
        private TextView count;
        private SeekBar seekBar;
        public FloatViewHolder(@NonNull View itemView) {
            super(itemView);
        }

        @Override
        public void bindView(View base) {
            this.title = base.findViewById(R.id.display_stress_title);
            this.unit = base.findViewById(R.id.display_stress_data_unit);
            this.count = base.findViewById(R.id.display_stress_data);
            this.seekBar = base.findViewById(R.id.display_stress_sb);
        }

        @Override
        public void bindData(StressItem data, int index) {
            if (data == null) {
                return;
            }
            title.setText(data.title);
            unit.setText(data.unit);
            seekBar.setMax(data.max);
            if (Build.VERSION.SDK_INT >= 26) {
                seekBar.setMin(0);
            }

            int type = data.type;
            seekBar.setTag(type);

            int countValue = data.count;
            if (type == 2) {
                if (countValue > data.max / 2) {
                    count.setTextColor(Color.RED);
                    count.setText("⚠️" + countValue);
                } else {
                    count.setTextColor(count.getResources().getColor(R.color.secondaryText));
                    count.setText("" + countValue);
                }
            } else {
                count.setText("" + countValue);
            }
            seekBar.setProgress(countValue);
            seekBar.setOnSeekBarChangeListener(new SeekBar.OnSeekBarChangeListener() {
                @Override
                public void onProgressChanged(SeekBar seekBar, int progress, boolean fromUser) {
                    if (fromUser) {
                        int type = (int) seekBar.getTag();
                        if (type == 2) {
                            if (progress > seekBar.getMax() / 2) {
                                count.setTextColor(Color.RED);
                                count.setText("⚠️" + progress);
                            } else {
                                count.setTextColor(count.getResources().getColor(R.color.secondaryText));
                                count.setText("" + progress);
                            }
                        } else {
                            count.setText("" + progress);
                        }
                    }
                }

                @Override
                public void onStartTrackingTouch(SeekBar seekBar) {

                }

                @Override
                public void onStopTrackingTouch(SeekBar seekBar) {
                    int type = (int) seekBar.getTag();
                    String event;
                    if (type == 0) {
                        event = PerformStressImpl.PERFORMANCE_STRESS_CPU_PERCENT;
                    } else if (type == 1) {
                        event = PerformStressImpl.PERFORMANCE_STRESS_CPU_COUNT;
                    } else {
                        event = PerformStressImpl.PERFORMANCE_STRESS_MEMORY;
                    }
                    InjectorService.g().pushMessage(event, seekBar.getProgress());
                }
            });
        }
    }
}
