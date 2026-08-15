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
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;

import lecho.lib.hellocharts.model.Line;
import lecho.lib.hellocharts.model.PointValue;
import lecho.lib.hellocharts.model.SelectedValue;
import lecho.lib.hellocharts.provider.LineChartDataProvider;
import lecho.lib.hellocharts.renderer.LineChartRenderer;
import lecho.lib.hellocharts.util.ChartUtils;
import lecho.lib.hellocharts.view.Chart;

/**
 * Created by cathor on 17/8/7.
 */
public class CheckableLineChartRenderer extends LineChartRenderer {
    private SelectedValue checkedValue;
    private Paint checkedPaint;
    private int checkedColor = Color.BLUE;
    private LineChartDataProvider dataProvider;

    public CheckableLineChartRenderer(Context context, Chart chart, LineChartDataProvider dataProvider) {
        super(context, chart, dataProvider);
        this.dataProvider = dataProvider;
        checkedPaint = new Paint();
        checkedPaint.setColor(checkedColor);
        checkedPaint.setAntiAlias(true);
        checkedPaint.setStyle(Paint.Style.FILL);
    }

    protected void setCheckedColor(int color) {
        checkedPaint.setColor(color);
    }

    @Override
    public void drawUnclipped(Canvas canvas) {
        super.drawUnclipped(canvas);
        drawChecked(canvas);
    }

    private void drawChecked(Canvas canvas) {
        if (checkedValue == null){
            return;
        }
        int lineIndex = checkedValue.getFirstIndex();
        Line line = dataProvider.getLineChartData().getLines().get(lineIndex);
        PointValue pointValue = line.getValues().get(checkedValue.getSecondIndex());
        int pointRadius = ChartUtils.dp2px(density, line.getPointRadius());
        float rawX = computator.computeRawX(pointValue.getX());
        float rawY = computator.computeRawY(pointValue.getY());
        canvas.drawCircle(rawX, rawY, pointRadius, checkedPaint);
    }

    public void setCheckedValue(SelectedValue checkedValue) {
        if (checkedValue == null) {
            this.checkedValue = null;
        } else {
            this.checkedValue = new SelectedValue(checkedValue.getFirstIndex(), checkedValue.getSecondIndex(), checkedValue.getType());
        }
    }
}
