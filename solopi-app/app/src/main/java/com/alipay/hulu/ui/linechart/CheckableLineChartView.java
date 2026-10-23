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
package com.alipay.hulu.ui.linechart;

import android.content.Context;
import android.util.AttributeSet;

import lecho.lib.hellocharts.model.LineChartData;
import lecho.lib.hellocharts.model.PointValue;
import lecho.lib.hellocharts.model.SelectedValue;
import lecho.lib.hellocharts.view.LineChartView;

/**
 * Created by cathor on 17/8/7.
 */
public class CheckableLineChartView extends LineChartView{
    private CheckableLineChartRenderer renderer;

    public CheckableLineChartView(Context context) {
        this(context, null, 0);
    }

    public CheckableLineChartView(Context context, AttributeSet attrs) {
        this(context, attrs, 0);
    }

    public CheckableLineChartView(Context context, AttributeSet attrs, int defStyle) {
        super(context, attrs, defStyle);
        renderer = new CheckableLineChartRenderer(context, this, this);
        setChartRenderer(renderer);
        setLineChartData(LineChartData.generateDummyData());
    }

    @Override
    public void setLineChartData(LineChartData data) {
        super.setLineChartData(data);
        if (renderer != null) {
            renderer.setCheckedValue(null);
        }
    }

    public void setCheckColor(int color) {
        renderer.setCheckedColor(color);
    }

    @Override
    public void callTouchListener() {
        SelectedValue selectedValue = chartRenderer.getSelectedValue();
        if (selectedValue.isSet()) {
            renderer.setCheckedValue(selectedValue);
            PointValue point = data.getLines().get(selectedValue.getFirstIndex()).getValues()
                    .get(selectedValue.getSecondIndex());
            onValueTouchListener.onValueSelected(selectedValue.getFirstIndex(), selectedValue.getSecondIndex(), point);
        } else {
            onValueTouchListener.onValueDeselected();
        }
    }
}
