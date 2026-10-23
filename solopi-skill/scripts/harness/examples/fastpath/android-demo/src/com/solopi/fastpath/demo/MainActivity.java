package com.solopi.fastpath.demo;

import android.app.Activity;
import android.graphics.Color;
import android.graphics.Typeface;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.View;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.ScrollView;
import android.widget.TextView;

/** Deterministic, offline order flow used to exercise constrained UI decisions. */
public final class MainActivity extends Activity {
    private static final int INK = Color.rgb(29, 46, 43);
    private static final int MUTED = Color.rgb(103, 118, 111);
    private static final int ACCENT = Color.rgb(22, 125, 115);
    private static final int BACKGROUND = Color.rgb(246, 245, 240);
    private final Handler handler = new Handler(Looper.getMainLooper());
    private LinearLayout body;
    private String scenario = "baseline";
    private int generation;

    @Override public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        showScenarios();
    }

    private int dp(int value) {
        return Math.round(value * getResources().getDisplayMetrics().density);
    }

    private GradientDrawable surface(int color, int stroke) {
        GradientDrawable result = new GradientDrawable();
        result.setColor(color);
        result.setCornerRadius(dp(16));
        if (stroke != 0) result.setStroke(dp(1), stroke);
        return result;
    }

    private TextView text(String value, int size, int color, boolean bold) {
        TextView view = new TextView(this);
        view.setText(value);
        view.setTextSize(size);
        view.setTextColor(color);
        view.setIncludeFontPadding(false);
        if (bold) view.setTypeface(Typeface.DEFAULT, Typeface.BOLD);
        return view;
    }

    private void space(LinearLayout parent, int height) {
        parent.addView(new View(this), new LinearLayout.LayoutParams(1, dp(height)));
    }

    private void base(String state, String title, String subtitle) {
        generation++;
        handler.removeCallbacksAndMessages(null);
        ScrollView scroll = new ScrollView(this);
        scroll.setFillViewport(true);
        scroll.setBackgroundColor(BACKGROUND);
        body = new LinearLayout(this);
        body.setOrientation(LinearLayout.VERTICAL);
        body.setPadding(dp(24), dp(24), dp(24), dp(24));
        scroll.addView(body);
        setContentView(scroll);
        body.addView(text("SOLOPI  /  FASTPATH", 12, ACCENT, true));
        space(body, 20);
        body.addView(text(title, 30, INK, true));
        space(body, 10);
        body.addView(text(subtitle, 14, MUTED, false));
        space(body, 14);
        TextView stateView = text(state, 11, ACCENT, true);
        stateView.setId(R.id.page_state);
        stateView.setPadding(dp(10), dp(6), dp(10), dp(6));
        stateView.setBackground(surface(Color.rgb(228, 240, 232), 0));
        body.addView(stateView, new LinearLayout.LayoutParams(-2, -2));
        space(body, 20);
    }

    private void button(LinearLayout parent, int id, String label, boolean filled,
                        boolean enabled, Runnable action) {
        Button button = new Button(this);
        button.setId(id);
        button.setText(label);
        button.setAllCaps(false);
        button.setTextSize(15);
        button.setGravity(Gravity.CENTER_VERTICAL | Gravity.START);
        button.setPadding(dp(18), 0, dp(18), 0);
        button.setTextColor(enabled ? (filled ? Color.WHITE : INK) : Color.rgb(149, 155, 149));
        button.setBackground(surface(enabled && filled ? ACCENT : Color.WHITE,
                enabled && filled ? 0 : Color.rgb(217, 224, 216)));
        button.setElevation(0);
        button.setStateListAnimator(null);
        button.setEnabled(enabled);
        button.setOnClickListener(view -> action.run());
        LinearLayout.LayoutParams layout = new LinearLayout.LayoutParams(-1, dp(50));
        layout.bottomMargin = dp(10);
        parent.addView(button, layout);
    }

    private void reset() {
        space(body, 12);
        button(body, R.id.reset_button, "返回场景选择", false, true, this::showScenarios);
        space(body, 10);
        body.addView(text("本地演示 · 虚构订单 · 无网络连接", 11, MUTED, false));
    }

    private void showScenarios() {
        base("SCENARIOS", "每一次变化，都可验证。", "选择一个场景，观察相同目标如何执行与验收。");
        scenarioButton(R.id.scenario_baseline, "01  标准订单流程", "baseline");
        scenarioButton(R.id.scenario_renamed, "02  文案与位置变化", "renamed");
        scenarioButton(R.id.scenario_popup, "03  出现非关键提示", "popup");
        scenarioButton(R.id.scenario_loading, "04  页面加载等待", "loading");
        scenarioButton(R.id.scenario_broken, "05  真实业务结果错误", "broken");
        scenarioButton(R.id.scenario_unknown, "06  未知页面", "unknown");
        scenarioButton(R.id.scenario_disabled, "07  目标按钮不可用", "disabled");
        space(body, 8);
        body.addView(text("统一验收：打开订单 FP-20260923，核对状态为“已支付”。", 13, MUTED, false));
        reset();
    }

    private void scenarioButton(int id, String label, String value) {
        button(body, id, label, false, true, () -> {
            scenario = value;
            if ("unknown".equals(value)) showUnknown();
            else if ("loading".equals(value)) showLoading();
            else showOrders("popup".equals(value));
        });
    }

    private void orderCard(String status, boolean detail) {
        LinearLayout card = new LinearLayout(this);
        card.setOrientation(LinearLayout.VERTICAL);
        card.setPadding(dp(20), dp(20), dp(20), dp(20));
        card.setBackground(surface(Color.WHITE, 0));
        card.addView(text("山野生活  /  FIELD NOTES", 11, ACCENT, true));
        space(card, 16);
        card.addView(text("原色帆布随行包", 22, INK, true));
        space(card, 8);
        card.addView(text("自然米白  ·  标准款  ·  数量 1", 13, MUTED, false));
        space(card, 22);
        card.addView(text("¥ 128.00", 28, INK, true));
        space(card, 16);
        card.addView(text("订单编号  FP-20260923", 12, MUTED, false));
        if (detail) {
            space(card, 20);
            card.addView(text("订单状态", 12, MUTED, false));
            space(card, 8);
            TextView orderStatus = text(status, 24,
                    "已取消".equals(status) ? Color.rgb(176, 69, 44) : ACCENT, true);
            orderStatus.setId(R.id.order_status);
            card.addView(orderStatus);
        }
        body.addView(card, new LinearLayout.LayoutParams(-1, -2));
        space(body, 22);
    }

    private void showOrders(boolean popup) {
        String note = "renamed".equals(scenario) ? "入口文案与顺序已变化，订单目标保持一致。"
                : "disabled".equals(scenario) ? "订单入口暂不可用，执行器应停止并报告。"
                : "broken".equals(scenario) ? "路径可以完成，最终订单状态仍须独立核对。"
                : "找到订单详情，核对订单状态。";
        base("ORDERS", "我的订单", note);
        if (popup) {
            LinearLayout notice = new LinearLayout(this);
            notice.setOrientation(LinearLayout.VERTICAL);
            notice.setPadding(dp(16), dp(16), dp(16), dp(8));
            notice.setBackground(surface(Color.rgb(231, 239, 220), 0));
            notice.addView(text("周末上新提醒", 17, INK, true));
            space(notice, 8);
            notice.addView(text("这是一条可关闭的非关键活动提示。", 13, MUTED, false));
            space(notice, 14);
            button(notice, R.id.dismiss_popup, "暂时不用", true, true, () -> showOrders(false));
            body.addView(notice);
            space(body, 18);
        }
        orderCard("", false);
        body.addView(text("订单服务", 12, MUTED, true));
        space(body, 12);
        boolean enabled = !popup;
        if ("renamed".equals(scenario)) {
            button(body, R.id.action_tertiary, "联系商家", false, enabled, this::showWrong);
            button(body, R.id.action_primary, "看看这笔订单", false, enabled, this::showDetail);
            button(body, R.id.action_secondary, "查看物流", false, enabled, this::showWrong);
        } else {
            button(body, R.id.action_primary, "查看订单详情", false,
                    enabled && !"disabled".equals(scenario), this::showDetail);
            button(body, R.id.action_secondary, "查看物流", false, enabled, this::showWrong);
            button(body, R.id.action_tertiary, "联系商家", false, enabled, this::showWrong);
        }
        reset();
    }

    private void showDetail() {
        base("DETAIL", "订单详情", "页面到达只是第一步，业务结果仍须核对。");
        orderCard("broken".equals(scenario) ? "已取消" : "已支付", true);
        body.addView(text("演示订单不涉及真实交易或个人信息。", 13, MUTED, false));
        reset();
    }

    private void showWrong() {
        base("WRONG", "走到了其他服务", "当前页面不是订单详情，不能视为目标完成。");
        orderCard("", false);
        reset();
    }

    private void showUnknown() {
        base("UNKNOWN", "新的服务入口", "当前页面不在已声明的流程范围内。");
        body.addView(text("继续探索需要补充计划，本次应停止执行。", 17, INK, false));
        reset();
    }

    private void showLoading() {
        base("LOADING", "正在同步订单", "请稍候，订单列表将在 8 秒后显示。");
        body.addView(text("订单数据准备中…", 19, ACCENT, true));
        reset();
        final int expectedGeneration = generation;
        handler.postDelayed(() -> {
            if (generation == expectedGeneration && !isFinishing()) showOrders(false);
        }, 8000);
    }

    @Override public void onBackPressed() { showScenarios(); }

    @Override protected void onDestroy() {
        handler.removeCallbacksAndMessages(null);
        super.onDestroy();
    }
}
