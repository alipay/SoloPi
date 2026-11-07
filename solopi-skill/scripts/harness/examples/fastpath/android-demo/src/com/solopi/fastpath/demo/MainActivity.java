package com.solopi.fastpath.demo;

import android.app.Activity;
import android.app.Dialog;
import android.app.ActivityOptions;
import android.content.Intent;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.ColorFilter;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.PixelFormat;
import android.graphics.Typeface;
import android.graphics.drawable.Drawable;
import android.graphics.drawable.GradientDrawable;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.os.Build;
import android.view.Display;
import android.view.Gravity;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
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
    private Dialog controlledDialog;

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
        if (controlledDialog != null) {
            controlledDialog.dismiss();
            controlledDialog = null;
        }
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
        button(body, R.id.scenario_ocr_canvas, "视觉文字入口", false, true, this::showOcrCanvas);
        button(body, R.id.scenario_replaced_target, "目标自动替换", false, true, this::showReplacedTarget);
        button(body, R.id.scenario_unstable, "页面持续变化", false, true, this::showUnstablePage);
        button(body, R.id.scenario_escape_to_main, "模拟应用跳至主屏", false, true, this::escapeToMain);
        button(body, R.id.scenario_secure_window, "12  受保护窗口", false, true, this::showSecureWindow);
        scenarioButton(R.id.scenario_renamed, "02  文案与位置变化", "renamed");
        scenarioButton(R.id.scenario_popup, "03  出现非关键提示", "popup");
        scenarioButton(R.id.scenario_loading, "04  页面加载等待", "loading");
        scenarioButton(R.id.scenario_broken, "05  真实业务结果错误", "broken");
        scenarioButton(R.id.scenario_unknown, "06  未知页面", "unknown");
        scenarioButton(R.id.scenario_disabled, "07  目标按钮不可用", "disabled");
        space(body, 12);
        body.addView(text("视觉受控场景", 13, MUTED, true));
        space(body, 10);
        controlledScenarioButton(R.id.scenario_visual_icons, "08  无标签图标", "icon");
        controlledScenarioButton(R.id.scenario_visual_layout, "09  相似入口与布局变化", "similar-layout");
        controlledScenarioButton(R.id.scenario_visual_guard, "10  真实遮挡与禁用", "overlay");
        controlledScenarioButton(R.id.scenario_visual_negative, "11  无目标与错误结果", "no-target-wrong-result");
        space(body, 8);
        body.addView(text("统一验收：打开订单 FP-20260923，核对状态为“已支付”。", 13, MUTED, false));
        reset();
    }

    /** The OS blacks out this synthetic dialog on displays without secure output. */
    private void showSecureWindow() {
        controlledDialog = new Dialog(this);
        Button protectedButton = new Button(this);
        protectedButton.setText("受保护弹窗按钮");
        protectedButton.setOnClickListener(view -> protectedButton.setText("不应被自动点击"));
        controlledDialog.setContentView(protectedButton);
        controlledDialog.getWindow().addFlags(WindowManager.LayoutParams.FLAG_SECURE);
        controlledDialog.show();
    }

    /** A deterministic visual-only target: its label is drawn, not exposed as node text. */
    private void showOcrCanvas() {
        scenario = "baseline";
        base("OCR_CANVAS", "视觉文字入口", "点击画面中的文字进入订单详情。");
        View target = new View(this) {
            private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);
            @Override protected void onDraw(Canvas canvas) {
                super.onDraw(canvas);
                canvas.drawColor(Color.WHITE);
                paint.setColor(INK);
                paint.setTextSize(dp(22));
                paint.setTypeface(Typeface.DEFAULT_BOLD);
                canvas.drawText("进入订单详情", dp(24), dp(65), paint);
            }
            @Override public boolean onTouchEvent(MotionEvent event) {
                if (event.getAction() == MotionEvent.ACTION_DOWN) return true;
                if (event.getAction() == MotionEvent.ACTION_UP) { showDetail(); return true; }
                return true;
            }
        };
        body.addView(target, new LinearLayout.LayoutParams(-1, dp(110)));
        reset();
    }

    /** The original target is replaced while a previously captured observation is still in use. */
    private void showReplacedTarget() {
        base("REPLACE_PENDING", "目标自动替换", "稍后原入口会被替换，用于验证旧观察不能点击新入口。");
        LinearLayout slot = new LinearLayout(this);
        slot.setOrientation(LinearLayout.VERTICAL);
        body.addView(slot, new LinearLayout.LayoutParams(-1, -2));
        button(slot, R.id.action_primary, "原订单入口", false, true, this::showDetail);
        int currentGeneration = generation;
        handler.postDelayed(() -> {
            if (generation != currentGeneration) return;
            slot.removeAllViews();
            button(slot, R.id.replacement_target, "替换后的入口", false, true, this::showWrong);
            TextView state = findViewById(R.id.page_state);
            if (state != null) state.setText("REPLACED");
        }, 15000);
        reset();
    }

    /** Continuously changing semantics exercise post-dispatch observation timeouts. */
    private void showUnstablePage() {
        base("UNSTABLE_0", "页面持续变化", "页面短时持续更新，用于验证动作结果不确定时停止。");
        final TextView state = findViewById(R.id.page_state);
        final int currentGeneration = generation;
        final long until = SystemClock.uptimeMillis() + 16000;
        handler.post(new Runnable() {
            int count;
            @Override public void run() {
                if (generation != currentGeneration) return;
                if (SystemClock.uptimeMillis() >= until) { state.setText("STABLE"); return; }
                state.setText("UNSTABLE_" + (++count));
                handler.postDelayed(this, 50);
            }
        });
        reset();
    }

    /** Controlled escape fixture: launch only this offline demo on display 0. */
    private void escapeToMain() {
        if (Build.VERSION.SDK_INT < 26) return;
        Intent intent = new Intent(this, MainActivity.class);
        intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_MULTIPLE_TASK);
        ActivityOptions options = ActivityOptions.makeBasic();
        options.setLaunchDisplayId(Display.DEFAULT_DISPLAY);
        startActivity(intent, options.toBundle());
        finish();
    }

    private void scenarioButton(int id, String label, String value) {
        button(body, id, label, false, true, () -> {
            scenario = value;
            if ("unknown".equals(value)) showUnknown();
            else if ("loading".equals(value)) showLoading();
            else showOrders("popup".equals(value));
        });
    }

    private void controlledScenarioButton(int id, String label, String group) {
        button(body, id, label, false, true, () -> showControlledVariants(group));
    }

    private void showControlledVariants(String group) {
        base("VISUAL_GROUP", "选择受控变体", "变体由固定准备段选择，进入后再执行统一目标。");
        if ("overlay".equals(group)) {
            button(body, R.id.visual_variant_a, "真实对话框遮挡", false, true,
                    () -> showControlled(group, 0));
            button(body, R.id.visual_variant_b, "真实禁用状态", false, true,
                    () -> showControlled(group, 1));
        } else if ("no-target-wrong-result".equals(group)) {
            button(body, R.id.visual_variant_a, "没有订单详情入口", false, true,
                    () -> showControlled(group, 0));
            button(body, R.id.visual_variant_b, "详情页显示已取消", false, true,
                    () -> showControlled(group, 1));
            button(body, R.id.visual_variant_c, "正常详情供错误 Oracle 对照", false, true,
                    () -> showControlled(group, 2));
        } else {
            button(body, R.id.visual_variant_a, "布局 A", false, true, () -> showControlled(group, 0));
            button(body, R.id.visual_variant_b, "布局 B", false, true, () -> showControlled(group, 1));
        }
        reset();
    }

    private void showControlled(String group, int variant) {
        base("VISUAL_ORDERS", "订单服务", "打开订单详情并检查已支付。");
        // Keep the actual task page identical across positive/negative controls;
        // variant names and expected results stay on the preparation page.
        body.addView(text("订单编号  FP-20260923", 13, MUTED, false));
        space(body, 20);
        boolean iconsOnly = "icon".equals(group);
        boolean disabled = "overlay".equals(group) && variant == 1;
        boolean noTarget = "no-target-wrong-result".equals(group) && variant == 0;
        boolean wrongResult = "no-target-wrong-result".equals(group) && variant == 1;
        boolean horizontal = "similar-layout".equals(group) && variant == 1;
        LinearLayout actions = new LinearLayout(this);
        actions.setOrientation(horizontal ? LinearLayout.HORIZONTAL : LinearLayout.VERTICAL);
        body.addView(actions, new LinearLayout.LayoutParams(-1, -2));
        int[] order = variant == 1 ? new int[]{2, 1, 0} : new int[]{0, 1, 2};
        for (int kind : order) {
            if (kind == 0 && noTarget) continue;
            int id = kind == 0 ? R.id.visual_b2 : kind == 1 ? R.id.visual_a7 : R.id.visual_c9;
            controlledButton(actions, id, kind, iconsOnly, !(kind == 0 && disabled), horizontal,
                    kind == 0 ? () -> showControlledDetail(wrongResult) : this::showWrong);
        }
        reset();
        if ("overlay".equals(group) && variant == 0) showControlledDialog();
    }

    private void controlledButton(LinearLayout parent, int id, int kind, boolean iconsOnly,
                                  boolean enabled, boolean horizontal, Runnable action) {
        Button view = new Button(this);
        view.setId(id);
        // Code security: these are real unlabeled actionable nodes. The drawing
        // contains no text, content description, child label or answer-bearing ID.
        view.setText(iconsOnly ? "" : "查看");
        view.setContentDescription(null);
        view.setAllCaps(false);
        view.setTextSize(15);
        view.setTextColor(enabled ? INK : MUTED);
        view.setGravity(Gravity.CENTER);
        view.setPadding(dp(10), dp(10), dp(10), dp(10));
        view.setMinWidth(0);
        view.setMinimumWidth(0);
        view.setBackground(surface(Color.WHITE, Color.rgb(217, 224, 216)));
        view.setElevation(0);
        view.setStateListAnimator(null);
        ServiceGlyph glyph = new ServiceGlyph(kind, enabled ? ACCENT : Color.rgb(180, 184, 179));
        glyph.setBounds(0, 0, dp(44), dp(44));
        if (horizontal || iconsOnly) view.setCompoundDrawables(null, glyph, null, null);
        else view.setCompoundDrawables(glyph, null, null, null);
        view.setCompoundDrawablePadding(dp(6));
        view.setEnabled(enabled);
        view.setOnClickListener(clicked -> action.run());
        LinearLayout.LayoutParams layout = horizontal
                ? new LinearLayout.LayoutParams(0, dp(106), 1)
                : new LinearLayout.LayoutParams(-1, dp(86));
        layout.bottomMargin = dp(12);
        if (horizontal) layout.setMargins(dp(3), 0, dp(3), dp(12));
        parent.addView(view, layout);
    }

    private void showControlledDetail(boolean wrongResult) {
        base("DETAIL", "订单详情", "页面到达只是第一步，业务结果仍须核对。");
        orderCard(wrongResult ? "已取消" : "已支付", true);
        body.addView(text("演示订单不涉及真实交易或个人信息。", 13, MUTED, false));
        reset();
    }

    private void showControlledDialog() {
        Dialog dialog = new Dialog(this);
        dialog.setCancelable(false);
        dialog.setCanceledOnTouchOutside(false);
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(dp(24), dp(24), dp(24), dp(24));
        content.setBackground(surface(Color.WHITE, 0));
        content.addView(text("本地提示", 22, INK, true));
        space(content, 14);
        content.addView(text("当前提示未关闭，订单页面不能操作。", 15, MUTED, false));
        space(content, 14);
        TextView state = text("VISUAL_DIALOG", 11, ACCENT, true);
        state.setId(R.id.page_state);
        content.addView(state);
        space(content, 20);
        // A real modal window owns input. Only the frozen cleanup uses this ID.
        button(content, R.id.visual_dialog_reset, "返回场景选择", false, true, this::showScenarios);
        dialog.setContentView(content);
        controlledDialog = dialog;
        dialog.show();
    }

    /** Small offline pictograms: document, delivery truck and conversation. */
    private static final class ServiceGlyph extends Drawable {
        private final int kind;
        private final Paint paint = new Paint(Paint.ANTI_ALIAS_FLAG);

        ServiceGlyph(int kind, int color) {
            this.kind = kind;
            paint.setColor(color);
            paint.setStyle(Paint.Style.STROKE);
            paint.setStrokeWidth(3);
            paint.setStrokeCap(Paint.Cap.ROUND);
            paint.setStrokeJoin(Paint.Join.ROUND);
        }

        @Override public void draw(Canvas canvas) {
            int saved = canvas.save();
            canvas.translate(getBounds().left, getBounds().top);
            canvas.scale(getBounds().width() / 48f, getBounds().height() / 48f);
            if (kind == 0) {
                Path sheet = new Path();
                sheet.moveTo(12, 5); sheet.lineTo(30, 5); sheet.lineTo(38, 13);
                sheet.lineTo(38, 43); sheet.lineTo(12, 43); sheet.close();
                canvas.drawPath(sheet, paint);
                canvas.drawLine(29, 6, 29, 15, paint); canvas.drawLine(29, 15, 37, 15, paint);
                canvas.drawLine(18, 22, 32, 22, paint); canvas.drawLine(18, 29, 32, 29, paint);
                canvas.drawLine(18, 36, 27, 36, paint);
            } else if (kind == 1) {
                canvas.drawRect(4, 12, 28, 33, paint); canvas.drawRect(28, 21, 42, 33, paint);
                canvas.drawLine(28, 15, 36, 15, paint); canvas.drawLine(36, 15, 42, 21, paint);
                canvas.drawCircle(13, 36, 5, paint); canvas.drawCircle(35, 36, 5, paint);
            } else {
                Path bubble = new Path();
                bubble.moveTo(6, 8); bubble.lineTo(42, 8); bubble.lineTo(42, 33);
                bubble.lineTo(21, 33); bubble.lineTo(12, 41); bubble.lineTo(12, 33);
                bubble.lineTo(6, 33); bubble.close();
                canvas.drawPath(bubble, paint);
                canvas.drawCircle(16, 21, 1, paint); canvas.drawCircle(24, 21, 1, paint);
                canvas.drawCircle(32, 21, 1, paint);
            }
            canvas.restoreToCount(saved);
        }

        @Override public void setAlpha(int alpha) { paint.setAlpha(alpha); invalidateSelf(); }
        @Override public void setColorFilter(ColorFilter filter) { paint.setColorFilter(filter); invalidateSelf(); }
        @Override public int getOpacity() { return PixelFormat.TRANSLUCENT; }
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
        if (controlledDialog != null) {
            controlledDialog.dismiss();
            controlledDialog = null;
        }
        super.onDestroy();
    }
}
