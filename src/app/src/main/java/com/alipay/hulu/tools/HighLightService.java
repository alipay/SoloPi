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
package com.alipay.hulu.tools;

import android.content.Context;
import android.graphics.PixelFormat;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Build;
import android.os.Handler;
import android.os.Looper;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.WindowManager;
import android.widget.RelativeLayout;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.service.base.ExportService;
import com.alipay.hulu.common.service.base.LocalService;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;

import java.lang.ref.WeakReference;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;

import static android.view.WindowManager.LayoutParams.TYPE_TOAST;

@LocalService
public class HighLightService implements ExportService, View.OnTouchListener {

	private static final String TAG = "HighLightService";

	private static int WINDOW_LEVEL = WindowManager.LayoutParams.TYPE_SYSTEM_OVERLAY;

	Context cx = null;
	private WeakReference<View> windowViewRef = null;
	private WindowManager wm;
	public Handler mHandler;

	public View unvisiableView;

	@Override
	public void onCreate(Context context) {
		this.cx = context;
		wm = (WindowManager) cx.getSystemService(Context.WINDOW_SERVICE);

		mHandler = new Handler();

		unvisiableView = new View(cx);
		int targetColor;
		if (Build.VERSION.SDK_INT >= 23) {
			targetColor = context.getColor(R.color.colorAccent);
		} else {
			targetColor = context.getResources().getColor(R.color.colorAccent);
		}
		unvisiableView.setBackgroundColor(targetColor);
		WindowManager.LayoutParams params = new WindowManager.LayoutParams();
		//创建非模态、不可碰触
		params.flags = WindowManager.LayoutParams.FLAG_NOT_TOUCH_MODAL
				|WindowManager.LayoutParams.FLAG_NOT_TOUCHABLE;
		//放在左上角
		params.gravity = Gravity.START | Gravity.TOP;
		params.height = 1;
		params.width = 1;
		//设置弹出View类型
		params.type = WINDOW_LEVEL;

		try {
			wm.addView(unvisiableView, params);
		} catch (WindowManager.BadTokenException e) {
			LogUtil.e(TAG, e, "无法使用Window type = %d, 降级", WINDOW_LEVEL);
			WINDOW_LEVEL = TYPE_TOAST;
			params.type = WINDOW_LEVEL;
			wm.addView(unvisiableView, params);
		}
	}

	@Override
	public void onDestroy(Context context) {
		if (windowViewRef != null && windowViewRef.get() != null) {
			wm.removeViewImmediate(windowViewRef.get());
		}
		this.cx = null;
		this.mHandler = null;
	}

	/**
	 * 高亮悬浮窗
	 * @param displayRect
	 * @param point
	 */
	public void highLight(final Rect displayRect, final Point point) {
		mHandler.post(new Runnable() {
			@Override
			public void run() {
				makeWindow(displayRect, point);
			}
		});
	}

	/**
	 * 显示高亮悬浮窗
	 * @param displayRect
	 * @param clickPos
	 */
	private synchronized void makeWindow(Rect displayRect, Point clickPos) {
		if (displayRect == null) {
			LogUtil.w(TAG, "无法绘制空高亮框");
			return;
		}

		LogUtil.i(TAG, "绘制高亮框开始");

		// 拿一下高亮框引用
		View windowView;
		if (windowViewRef == null || (windowView = windowViewRef.get())== null) {
			windowView = LayoutInflater.from(cx).inflate(R.layout.highlight_win, null);
			windowView.setOnTouchListener(this);
			windowViewRef = new WeakReference<>(windowView);
		} else {
			if (Build.VERSION.SDK_INT >= 19) {
				if (windowView.isAttachedToWindow()) {
					wm.removeViewImmediate(windowView);
				}
			} else {
				wm.removeViewImmediate(windowView);
			}
		}

		int px = ContextUtil.dip2px(cx, 6);
		View thumb = windowView.findViewById(R.id.img_highlight_pos);
		if (clickPos != null && displayRect.contains(clickPos.x, clickPos.y)) {
			RelativeLayout.LayoutParams thumbParam = new RelativeLayout.LayoutParams(thumb.getLayoutParams());

			thumbParam.setMargins(clickPos.x - displayRect.left - px, clickPos.y - displayRect.top - px, 0, 0);
			thumb.setLayoutParams(thumbParam);
		} else {
			thumb.setVisibility(View.GONE);
		}

		// 记录下状态栏高度
		int[] xAndY = new int[] {0, 0};
		unvisiableView.getLocationOnScreen(xAndY);

		// 设置下windowParam
		WindowManager.LayoutParams wmParams = ((MyApplication) cx.getApplicationContext()).getMywmParams();
		wmParams.type = WindowManager.LayoutParams.TYPE_SYSTEM_OVERLAY;
		wmParams.flags |= 8;
		wmParams.gravity = Gravity.LEFT | Gravity.TOP; // 调整悬浮窗口至左上角
		// 以屏幕左上角为原点，设置x、y初始值
		wmParams.x = displayRect.left - xAndY[0];
		wmParams.y = displayRect.top - xAndY[1];
		// 设置悬浮窗口长宽数据
		wmParams.width = displayRect.width();
		wmParams.height = displayRect.height();
		wmParams.format = PixelFormat.RGBA_8888;

		try {
			wm.addView(windowView, wmParams);
		} catch (WindowManager.BadTokenException e) {
			LogUtil.e(TAG, "系统不允许显示悬浮窗", e);
		} catch (IllegalStateException e) {
			LogUtil.e(TAG, "悬浮窗已加载", e);
			wm.removeView(windowView);
			windowViewRef = null;
		}
	}

	/**
	 * 移除高亮框
	 */
	public void removeHighLight() {
		mHandler.post(new Runnable() {
			@Override
			public void run() {
				// 防止多次执行
				if (windowViewRef != null && windowViewRef.get() != null) {
					wm.removeViewImmediate(windowViewRef.get());
					windowViewRef.clear();
				}
			}
		});
	}

	/**
	 * 等待移除高亮
	 */
	public void removeHightLightSync() {
		final CountDownLatch latch = new CountDownLatch(1);
		if (Looper.myLooper() == Looper.getMainLooper()) {
			// 防止多次执行
			if (windowViewRef != null && windowViewRef.get() != null) {
				wm.removeViewImmediate(windowViewRef.get());
				windowViewRef.clear();
			}
			latch.countDown();
		} else {
			mHandler.post(new Runnable() {
				@Override
				public void run() {
					// 防止多次执行
					if (windowViewRef != null && windowViewRef.get() != null) {
						wm.removeViewImmediate(windowViewRef.get());
						windowViewRef.clear();
					}
					latch.countDown();
				}
			});

			try {
				latch.await(1000, TimeUnit.MILLISECONDS);
			} catch (InterruptedException e) {
				LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
			}
		}
	}

	@Override
	public boolean onTouch(View v, MotionEvent event) {
		// 防止阻碍操作
		removeHighLight();
		return false;
	}
}
