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
package com.alipay.hulu.service;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.content.SharedPreferences.Editor;
import android.content.pm.PackageInfo;
import android.content.pm.PackageManager;
import android.graphics.Point;
import android.graphics.Rect;
import android.os.Binder;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Message;
import android.os.PowerManager;
import android.os.PowerManager.WakeLock;
import android.util.DisplayMetrics;
import android.view.Display;
import android.view.Gravity;
import android.view.LayoutInflater;
import android.view.MotionEvent;
import android.view.View;
import android.view.View.OnClickListener;
import android.view.View.OnTouchListener;
import android.view.WindowManager;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.activity.IndexActivity;
import com.alipay.hulu.activity.MyApplication;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.injector.InjectorService;
import com.alipay.hulu.common.injector.param.RunningThread;
import com.alipay.hulu.common.injector.param.SubscribeParamEnum;
import com.alipay.hulu.common.injector.param.Subscriber;
import com.alipay.hulu.common.injector.provider.Param;
import com.alipay.hulu.common.tools.AppInfoProvider;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.utils.AppUtil;

import java.io.FileOutputStream;
import java.lang.ref.WeakReference;
import java.util.ArrayList;
import java.util.Date;
import java.util.Iterator;
import java.util.List;
import java.util.Locale;

import androidx.appcompat.app.AlertDialog;

import static android.view.Surface.ROTATION_0;


/**
 * 悬浮窗
 */
public class FloatWinService extends BaseService {
	private static final int NOTIFICATION_ID = 1212;

	// const
	private static final String TAG = "FloatWinService";
	private static final int UPDATE_RECORD_TIME = 103;

	public static final int RECORDING_ICON = R.drawable.recording;
	public static final int PLAY_ICON = R.drawable.start;

	// Views
	List<WeakReference<View>> displayedViews = null;

	WindowManager wm = null;
	WindowManager.LayoutParams wmParams = null;
	/**
	 * 悬浮窗根节点
	 */
	View view;
	/** 关闭按钮 */
	ImageView close;
	/** 录制按钮 */
	ImageView record;

	/**
	 * 显示
	 */
	View floatDisplayWrapper;
	LinearLayout floatDisplay;

	LinearLayout extraButton;

	LinearLayout extraView;

	/**
	 * 数据列表标题
	 */
	LinearLayout titlePanal;

	/**
	 * 录制时间文字
	 */
	TextView recordTime;

	/**
	 * 应用名称文字
	 */
	private TextView appText;
	/**
	 * 悬浮卡图标
	 */
	private ImageView cardIcon;

	/**
	 * 缩小状态图标
	 */
	private ImageView backgroundIcon;

	/**
	 * 悬浮卡
	 */
	private LinearLayout cardView;

	private OnRunListener runListener = null;

	private OnFloatListener floatListener = null;

	private OnStopListener stopListener = null;

	private OnHomeListener homeListener = null;

	private int recordCount = 0;
	private boolean isCountTime = false;

	// Draw
	private float mTouchStartX;
	private float mTouchStartY;
	private float x;
	private float y;
	int state, lastState;
	private float StartX;
	private float StartY;
	int div = 0;
	private int statusBarHeight = 0;

	private AppInfoProvider provider = null;
	// IO
	String fileName = "current.log";

	private InjectorService mInjectorService;

	/**
	 * 默认屏幕方向为垂直
	 */
	private int currentOrientation = ROTATION_0;

	private String appPackage = "";
	private String appName = "";

	static {
		LauncherApplication.getInstance().registerSelfAsForegroundService(FloatWinService.class);
	}

	@Subscriber(@Param(SubscribeParamEnum.APP))
	public void setAppPackage(String appPackage){
		this.appPackage = appPackage;
	}

	@Subscriber(@Param(SubscribeParamEnum.APP_NAME))
	public void setAppName(final String appName){
		if (!StringUtil.equals(this.appName, appName)) {
			this.appName = appName;
			handler.post(new Runnable() {
				@Override
				public void run() {
					appText.setText(appName);
				}
			});
		}
	}

	@Subscriber(@Param(LauncherApplication.SCREEN_ORIENTATION))
	public void setScreenOrientation(int orientation) {
		if (orientation != currentOrientation) {
			currentOrientation = orientation;

			// 更新下位置坐标
			if (cardView.getVisibility() == View.GONE) {
				hideFloatWin();
			}
		}
	}

	/**
	 * 加载中dialog
	 */
	private AlertDialog loadingDialog;
	private TextView messageText;

	@Subscriber(value = @Param(value = LauncherApplication.SHOW_LOADING_DIALOG, sticky = false), thread = RunningThread.MAIN_THREAD)
	public void startDialog(String message) {
		// 调用了长时间加载
		LogUtil.i(TAG, "Going to display dialog");
		if (loadingDialog == null) {
			View v = LayoutInflater.from(ContextUtil.getContextThemeWrapper(this, R.style.AppDialogTheme)).inflate(R.layout.dialog_loading, null);
			messageText = (TextView) v.findViewById(R.id.loading_dialog_text);
			loadingDialog = new AlertDialog.Builder(this, R.style.AppDialogTheme)
					.setView(v)
					.setNegativeButton(R.string.float__hide, new DialogInterface.OnClickListener() {
						@Override
						public void onClick(DialogInterface dialog, int which) {
							dialog.dismiss();
						}
					})
					.create();
			// 设置dialog
			loadingDialog.getWindow().setType(com.alipay.hulu.common.constant.Constant.TYPE_ALERT);
			loadingDialog.setCanceledOnTouchOutside(false);                                   //点击外面区域不会让dialog消失
			loadingDialog.setCancelable(false);
		}
		messageText.setText(message);
		loadingDialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);

		// 显示加载提示窗
		if (!loadingDialog.isShowing()) {
			loadingDialog.show();
		}
	}

	@Subscriber(value = @Param(value = LauncherApplication.DISMISS_LOADING_DIALOG, sticky = false), thread = RunningThread.MAIN_THREAD)
	public void dismissDialog() {
		if (loadingDialog != null && loadingDialog.isShowing()) {
			loadingDialog.dismiss();
		}
	}

	@Override
	public void onCreate() {
		super.onCreate();
		LogUtil.d(TAG, "onCreate");

		Notification notification = generateNotificationBuilder().setContentText(getString(R.string.float__toast_title)).setSmallIcon(R.drawable.solopi_main).build();
		startForeground(NOTIFICATION_ID, notification);

		handler = new TimeProcessHandler(this);

		mInjectorService = LauncherApplication.getInstance().findServiceByName(InjectorService.class.getName());
		mInjectorService.register(this);

		if (provider == null) {
			provider = AppInfoProvider.getInstance();
			mInjectorService.register(provider);
		}

		createView();
		initData();
	}

	public void writeFileData(String fileName, String message) {
		try {
			FileOutputStream fout = openFileOutput(fileName, MODE_APPEND);

			byte[] bytes = message.getBytes();
			fout.write(bytes);
			bytes = "\n".getBytes();
			fout.write(bytes);
			fout.close();
		} catch (Exception e) {
			LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
		}

	}

	/***
	 * 初始化界面
	 */
	private void createView() {
		view = LayoutInflater.from(ContextUtil.getContextThemeWrapper(this, R.style.AppTheme)).inflate(R.layout.float_win, null);
		// 关闭按钮
		close = (ImageView) view.findViewById(R.id.closeIcon);
		// 录制开关
		record = (ImageView) view.findViewById(R.id.recordIcon);

		// 录制文字
		recordTime = (TextView) view.findViewById(R.id.recordText);
		recordTime.setVisibility(View.GONE);

		appText = (TextView) view.findViewById(R.id.float_title_app);
        appText.setOnClickListener(new OnClickListener() {
            @Override
            public void onClick(View v) {
				try {
					PackageInfo pkgInfo = getPackageManager().getPackageInfo(appPackage, 0);
					if (pkgInfo == null) {
						return;
					}

					// 通过adb开启
					AppUtil.startApp(pkgInfo.packageName);
                } catch (PackageManager.NameNotFoundException e) {
					LogUtil.e(TAG, "Catch PackageManager.NameNotFoundException: " + e.getMessage(), e);
				}
			}
        });

		titlePanal = (LinearLayout) view.findViewById(R.id.float_title);

		// 主窗体
		floatDisplayWrapper = view.findViewById(R.id.float_display_wrapper);
		floatDisplay = (LinearLayout)  view.findViewById(R.id.float_display_view);
		floatDisplayWrapper.setVisibility(View.GONE);

		// 额外窗体
		extraView = (LinearLayout) view.findViewById(R.id.float_extra_layout);
		extraButton = (LinearLayout) view.findViewById(R.id.float_expand_layout);
		extraView.setVisibility(View.GONE);
		extraButton.setVisibility(View.GONE);

		final ImageView expandButton = (ImageView) view.findViewById(R.id.float_expand_icon);
		extraButton.setOnClickListener(new OnClickListener() {
			@Override
			public void onClick(View v) {
				// 当扩展字段隐藏（扩展按钮方向向下）
				if (expandButton.getRotation() % 360 == 0) {
					extraView.setVisibility(View.VISIBLE);
				} else {
					extraView.setVisibility(View.GONE);
				}
				expandButton.setRotation(expandButton.getRotation() + 180);
			}
		});

		// 悬浮卡图标与缩小图标
		cardIcon = (ImageView) view.findViewById(R.id.float_card_icon);
		backgroundIcon = (ImageView) view.findViewById(R.id.floatIcon);
		backgroundIcon.setVisibility(View.GONE);
		cardView = (LinearLayout) view.findViewById(R.id.float_card);

		// 获取标题栏高度
		if (statusBarHeight == 0) {
			try {
				Class<?> clazz = Class.forName("com.android.internal.R$dimen");
				Object object = clazz.newInstance();
				statusBarHeight = Integer.parseInt(clazz.getField("status_bar_height")
						.get(object).toString());
				statusBarHeight = getResources().getDimensionPixelSize(statusBarHeight);
			} catch (Exception e) {
				LogUtil.e(TAG, "Catch Exception: " + e.getMessage(), e);
			} finally {
				if (statusBarHeight == 0) {
					statusBarHeight = 50;
				}
			}
		}

		// 获取WindowManager
		wm = (WindowManager) getApplicationContext().getSystemService(WINDOW_SERVICE);
		// 设置LayoutParams(全局变量）相关参数
		wmParams = ((MyApplication) getApplication()).getFloatWinParams();
		wmParams.type = com.alipay.hulu.common.constant.Constant.TYPE_ALERT;
		wmParams.flags |= 8;
		wmParams.gravity = Gravity.LEFT | Gravity.TOP; // 调整悬浮窗口至左上角
		// 以屏幕左上角为原点，设置x、y初始值
		wmParams.x = 0;
		wmParams.y = 0;
		// 设置悬浮窗口长宽数据
		wmParams.width = WindowManager.LayoutParams.WRAP_CONTENT;
		wmParams.height = WindowManager.LayoutParams.WRAP_CONTENT;
		wmParams.format = 1;
		wmParams.alpha = 1F;

		displayedViews = new ArrayList<>();

		wm.addView(view, wmParams);

		view.setOnTouchListener(new OnTouchListener() {
			public boolean onTouch(View v, MotionEvent event) {
				// 获取相对屏幕的坐标，即以屏幕左上角为原点
				x = event.getRawX();
				y = event.getRawY() - statusBarHeight; // 25是系统状态栏的高度
				LogUtil.i(TAG, "currX" + x + "====currY" + y);

				switch (event.getAction()) {
				case MotionEvent.ACTION_DOWN:
					state = MotionEvent.ACTION_DOWN;
					StartX = x;
					StartY = y;
					// 获取相对View的坐标，即以此View左上角为原点
					mTouchStartX = event.getX();
					mTouchStartY = event.getY();
					LogUtil.i(TAG, "startX" + mTouchStartX + "====startY" + mTouchStartY);
					lastState = state;
					break;
				case MotionEvent.ACTION_MOVE:
					state = MotionEvent.ACTION_MOVE;
					updateViewPosition();
					lastState = state;
					break;

				case MotionEvent.ACTION_UP:
					state = MotionEvent.ACTION_UP;
					updateViewPosition();
					// 对于点击移动小于(10, 10) 且处于缩小状态下，恢复成原始状态
					if (Math.abs(x - StartX) < 10 && Math.abs(y - StartY) < 10 && backgroundIcon.getVisibility() == View.VISIBLE) {
						// 有注册悬浮窗监听器的话
						if (floatListener != null) {
							floatListener.onFloatClick(false);
						} else {
							cardView.setVisibility(View.VISIBLE);
							// handler.postDelayed(task, period);
							backgroundIcon.setVisibility(View.GONE);
						}
					}
					mTouchStartX = mTouchStartY = 0;
					lastState = state;
					break;
				}
				return false;
			}
		});

		close.setOnClickListener(new OnClickListener() {
			@Override
			public void onClick(View v) {
				if (stopListener != null) {
					// 看看监听器是不是要停止
					boolean result = stopListener.onStopClick();
					if (!result) {
						return;
					}
				}

				FloatWinService.this.stopSelf();
				LogUtil.i(TAG, "Stop self");
			}
		});

		ImageView homeButton = (ImageView) view.findViewById(R.id.homeIcon);
		homeButton.setOnClickListener(new OnClickListener() {
			@Override
			public void onClick(View v) {
				if (homeListener == null || !homeListener.onHomeClick()) {
					goToHomePage();
				}
			}
		});

		// 悬浮卡点击图标变成缩小状态
		cardIcon.setOnClickListener(new OnClickListener() {
			@Override
			public void onClick(View v) {
				if (floatListener != null) {
					floatListener.onFloatClick(true);
				} else {
					cardView.setVisibility(View.GONE);
					backgroundIcon.setVisibility(View.VISIBLE);
				}
			}
		});

		// 录制按钮
		record.setOnClickListener(new OnClickListener() {
			@Override
			public void onClick(View v) {
				if (runListener != null) {
					int result = runListener.onRunClick();
					if (result != 0) {
						record.setImageResource(result);
						if (result == RECORDING_ICON) {
							recordCount = 0;
							isCountTime = true;
							recordTime.setVisibility(View.VISIBLE);
							handler.sendEmptyMessageDelayed(UPDATE_RECORD_TIME, 1000);
						} else if (result == PLAY_ICON) {
							recordCount = 0;
							isCountTime = false;
							recordTime.setVisibility(View.INVISIBLE);
						}
					} else {
						if (isCountTime) {
							recordTime.setVisibility(View.INVISIBLE);
							isCountTime = false;
						}
					}
				}
			}
		});
		PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
		WakeLock mWakeLock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, this.getClass().getName());
		mWakeLock.setReferenceCounted(false);
	}

	public void goToHomePage() {
		// 通过PendingIntent由外部启动较快
		Intent intent = new Intent(FloatWinService.this, IndexActivity.class);
		intent.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
		PendingIntent pendingIntent = PendingIntent.getActivity(FloatWinService.this, 0, intent, PendingIntent.FLAG_UPDATE_CURRENT);
		try{
            pendingIntent.send();
        } catch (PendingIntent.CanceledException e) {
            LogUtil.e(TAG, "PendingIntent canceled ", e);
        }
	}

	/***
	 * 初始化数据
	 */
	private void initData(){
		updateCurrentAppName(appName);
	}

	private void updateCurrentAppName(String name) {
		if (appText != null) {
			appText.setText(name);
		}
	}

	private Handler handler;

	/**
	 * 更新界面位置
	 */
	private void updateViewPosition() {
		// 更新浮动窗口位置参数
		try {
			wmParams.x = (int) (x - mTouchStartX);
			wmParams.y = (int) (y - mTouchStartY);
			wmParams.alpha = 1F;
			wm.updateViewLayout(view, wmParams);
		} catch (Throwable t) {
			LogUtil.e(TAG, "Fail update View layout", t);
		}
	}

	@Override
	public int onStartCommand(Intent intent, int flags, int startId) {
		LogUtil.d(TAG, "onStart");
		return super.onStartCommand(intent, flags, startId);
	}

	@Override
	public void onDestroy() {
		super.onDestroy();
		stopForeground(true);
		mNotificationManager.cancel(NOTIFICATION_ID);

		// 清理定时任务
		mInjectorService.unregister(this.provider);
		this.provider = null;

		LogUtil.w(TAG, "FloatWin onDestroy");
		writeFileData(fileName, "destroy recording:" + new Date());
		div = 0;
		//
		wm.removeView(view);

		//InjectorService.getInstance().stopInjection();

		SharedPreferences sharedPreferences = getSharedPreferences("config", Context.MODE_PRIVATE);
		Editor editor = sharedPreferences.edit();
		editor.putString("state", "stop");
		editor.apply();
		// 取消注册广播
	}



	@Override
	public boolean onUnbind(Intent intent) {
		// 清理引用
		runListener = null;
		floatListener = null;
		stopListener = null;
		LogUtil.d(TAG, "Float dismiss");
		stopForeground(true);
		stopSelf();

		return super.onUnbind(intent);
	}

	@Override
	public IBinder onBind(Intent intent) {
		return new FloatBinder(this);
	}

	public static class FloatBinder extends Binder {
		private static final String TAG = "FloatBinder";
		private WeakReference<FloatWinService> floatWinServiceRef;

		private FloatBinder(FloatWinService service) {
			this.floatWinServiceRef = new WeakReference<>(service);
		}

		public Context loadServiceContext() {
			return floatWinServiceRef.get();
		}

		/**
		 * 提供主窗体
		 * @param baseView
		 * @param params
		 */
		public void provideDisplayView(final View baseView, final LinearLayout.LayoutParams params) {
			if (floatWinServiceRef.get() == null) {
				return;
			}

			final FloatWinService service = floatWinServiceRef.get();
			service.handler.post(new Runnable() {
				@Override
				public void run() {
					View floatWrapper = service.floatDisplayWrapper;
					LinearLayout floatDisplay = service.floatDisplay;
					floatDisplay.removeAllViews();
					if (baseView != null) {
						if (params == null) {
							floatDisplay.addView(baseView);
						} else {
							floatDisplay.addView(baseView, params);
						}
						floatWrapper.setVisibility(View.VISIBLE);
					} else {
						floatWrapper.setVisibility(View.GONE);
					}
				}
			});
		}

		/**
		 * 设置录制按钮图标
		 * @param icon
		 */
		public void updateRunImage(int icon) {
			if (floatWinServiceRef.get() == null) {
				return;
			}

			FloatWinService service = floatWinServiceRef.get();
			if (icon != 0) {
				service.record.setImageResource(icon);
				if (icon == RECORDING_ICON) {
					service.recordCount = 0;
					service.isCountTime = true;
					service.recordTime.setVisibility(View.VISIBLE);
					service.handler.sendEmptyMessageDelayed(UPDATE_RECORD_TIME, 1000);
				} else if (icon == PLAY_ICON) {
					service.recordCount = 0;
					service.isCountTime = false;
					service.recordTime.setVisibility(View.INVISIBLE);
				}
			} else {
				if (service.isCountTime) {
					service.recordTime.setVisibility(View.INVISIBLE);
					service.isCountTime = false;
				}
			}
		}

		/**
		 * 提供扩展窗体
		 * @param expendView
		 * @param params
		 */
		public void provideExpendView(final View expendView, final WindowManager.LayoutParams params) {
			if (floatWinServiceRef.get() == null) {
				return;
			}

			final FloatWinService service = floatWinServiceRef.get();
			service.handler.post(new Runnable() {
				@Override
				public void run() {
					LinearLayout expend = service.extraView;
					LinearLayout expendButton = service.extraButton;
					expend.removeAllViews();
					if (expendView != null) {
						if (params == null) {
							expend.addView(expendView);
						} else {
							expend.addView(expendView, params);
						}
						expendButton.setVisibility(View.VISIBLE);
					} else {
						expend.setVisibility(View.GONE);
						expendButton.setVisibility(View.GONE);
					}
				}
			});
		}

		/**
		 * 添加View
		 * @param v
		 */
		public void addView(View v, WindowManager.LayoutParams layoutParams) {
			FloatWinService service = floatWinServiceRef.get();
			service.wm.addView(v, layoutParams);
			service.displayedViews.add(new WeakReference<>(v));
		}

		/**
		 * 清理特定View
		 * @param v
		 */
		public void removeView(View v) {
			FloatWinService service = floatWinServiceRef.get();
			try {
				service.wm.removeView(v);
			} catch (Exception e) {
				LogUtil.e(TAG, "Remove view throw exception: " + e.getMessage(), e);
			}
			Iterator<WeakReference<View>> refIter = service.displayedViews.iterator();
			while (refIter.hasNext()) {
				WeakReference<View> ref = refIter.next();
				if (ref.get() == null) {
					refIter.remove();
				}

				// 清理目标View
				if (ref.get() == v) {
					refIter.remove();
					break;
				}
			}
		}

		/**
		 * 清理全部View
		 */
		public void removeAllViews() {
			FloatWinService service = floatWinServiceRef.get();
			Iterator<WeakReference<View>> refIter = service.displayedViews.iterator();
			while (refIter.hasNext()) {
				WeakReference<View> ref = refIter.next();
				if (ref.get() != null) {
					View v = ref.get();
					try {
						service.wm.removeView(v);
					} catch (Exception e) {
						LogUtil.e(TAG, "Remove view throw exception: " + e.getMessage(), e);
					}
				}

				// 全部清理
				refIter.remove();
			}
		}

		public void registerRunClickListener(OnRunListener listener) {
			FloatWinService service = floatWinServiceRef.get();
			service.runListener = listener;
		}

		public void registerFloatClickListener(OnFloatListener listener) {
			FloatWinService service = floatWinServiceRef.get();
			service.floatListener = listener;
		}

		public void registerStopClickListener(OnStopListener listener) {
			FloatWinService service = floatWinServiceRef.get();
			service.stopListener = listener;
		}

		public void registerHomeClickListener(OnHomeListener listener) {
			FloatWinService service = floatWinServiceRef.get();
			service.homeListener = listener;
		}

		/**
		 * 隐藏悬浮窗
		 */
		public void hideFloat() {
			final FloatWinService service = floatWinServiceRef.get();
			service.handler.post(new Runnable() {
				@Override
				public void run() {
					service.hideFloatWin();
				}
			});
		}

		/**
		 * 恢复悬浮窗
		 */
		public void restoreFloat() {
			final FloatWinService service = floatWinServiceRef.get();
			service.handler.post(new Runnable() {
				@Override
				public void run() {
					service.restoreFloatWin();
				}
			});
		}

		/**
		 * 恢复悬浮窗
		 */
		public void stopFloat() {
			final FloatWinService service = floatWinServiceRef.get();
			service.handler.post(new Runnable() {
				@Override
				public void run() {
					service.stopSelf();
				}
			});
		}

		/**
		 * 更新悬浮窗小图标
		 */
		public void updateFloatIcon(int res) {
			final FloatWinService service = floatWinServiceRef.get();
			service.backgroundIcon.setImageResource(res);
		}

		/**
		 * 开始计时
		 */
		public void startTimeRecord() {
			final FloatWinService service = floatWinServiceRef.get();

			// 重置计时
			service.recordCount = 0;
			if (!service.isCountTime) {
				service.isCountTime = true;
				service.recordTime.setVisibility(View.VISIBLE);
				service.handler.sendEmptyMessageDelayed(UPDATE_RECORD_TIME, 1000);
			}
		}

		/**
		 * 停止计时
		 */
		public void stopRecordTime() {
			final FloatWinService service = floatWinServiceRef.get();

			if (service.isCountTime) {
				service.isCountTime = false;
				service.recordTime.setVisibility(View.GONE);
			}
		}

		/**
		 * 更新文字
		 * @param text
		 */
		public void updateText(String text) {
			final FloatWinService service = floatWinServiceRef.get();

			if (!StringUtil.isEmpty(text)) {
				service.recordTime.setVisibility(View.VISIBLE);
				service.recordTime.setText(text);
			} else {
				service.recordTime.setVisibility(View.GONE);
				service.recordTime.setText("");
			}
		}

		/**
		 * 检查点是否在悬浮窗内
		 *
		 * @param point
		 * @return
		 */
		public boolean checkInFloat(Point point) {
			if (point == null) {
				return false;
			}

			// 看下是否点到SoloPi图标
			FloatWinService service = floatWinServiceRef.get();
			Rect rect = new Rect();
			service.view.getDrawingRect(rect);

			// 通过当前LayoutParam进行判断
			Rect r = new Rect();
			service.view.getWindowVisibleDisplayFrame(r);
			WindowManager.LayoutParams params = (WindowManager.LayoutParams) service.view.getLayoutParams();

			// Android 10 尺寸获取问题
			if (Build.VERSION.SDK_INT >= 29) {
				DisplayMetrics metrics = new DisplayMetrics();
				service.wm.getDefaultDisplay().getRealMetrics(metrics);
				r.right = metrics.widthPixels;
				Point smallP = new Point();
				service.view.getDisplay().getCurrentSizeRange(smallP, new Point());
				int decoSize = metrics.heightPixels - smallP.y;
				if (r.top > decoSize) {
					r.top = decoSize;
				}
			}

			int x = r.left + params.x;
			int y = r.top + params.y;

			// 对于超过边界的情况
			if (x > r.right - rect.width()) {
				x = r.right - rect.width();
			}

			if (y > r.bottom - rect.height()) {
				y = r.bottom - rect.height();
			}

			LogUtil.d("FloatWinService", "悬浮窗坐标包含：%s, 目标x: %f, 目标y: %f", rect, point.x - service.x + rect.right, point.y - service.y - service.statusBarHeight);
			return rect.contains(point.x - x, point.y - y);
		}
	}

	/**
	 * 隐藏悬浮窗
	 */
	private void hideFloatWin() {
		cardView.setVisibility(View.GONE);
		Display screenDisplay = ((WindowManager)FloatWinService.this.getSystemService(WINDOW_SERVICE)).getDefaultDisplay();
		DisplayMetrics metrics = new DisplayMetrics();
		screenDisplay.getRealMetrics(metrics);
		x = metrics.widthPixels;

		//y = (size.y - statusBarHeight) / 2;
		y = metrics.heightPixels / 2 - 4 * statusBarHeight;
		updateViewPosition();
		// handler.removeCallbacks(task);
		backgroundIcon.setVisibility(View.VISIBLE);
		backgroundIcon.setAlpha(0.5f);
	}

	private void restoreFloatWin() {
		record.setImageResource(R.drawable.start);
		cardView.setVisibility(View.VISIBLE);
		backgroundIcon.setVisibility(View.GONE);
		backgroundIcon.setAlpha(1.0f);
	}

	public interface OnRunListener {
		int onRunClick();
	}

	public interface OnFloatListener {
		void onFloatClick(boolean hide);
	}

	public interface OnStopListener {
		boolean onStopClick();
	}

	public interface OnHomeListener {
		boolean onHomeClick();
	}

	private static final class TimeProcessHandler extends Handler {
		private WeakReference<FloatWinService> serviceRef;

		public TimeProcessHandler(FloatWinService service) {
			this.serviceRef = new WeakReference<>(service);
		}

		@Override
		public void handleMessage(Message msg) {
			FloatWinService service = serviceRef.get();
			if (service == null) {
				// Service被回收了，不用处理了
				return;
			}

			switch (msg.what) {
				case UPDATE_RECORD_TIME:
					// 每秒钟增加recordCount，作为已录制的时间
					if (!service.isCountTime) {
						return;
					}
					service.recordCount++;
					service.recordTime.setText(timefyCount(service.recordCount));

					if (service.isCountTime) {
						// 1秒后刷新录制时间
						sendEmptyMessageDelayed(UPDATE_RECORD_TIME, 1000);
					}
					break;
			}
			super.handleMessage(msg);
		}

		/**
		 * 将秒数转化为xx:xx格式
		 * @param count 秒数
		 * @return 转化后的字符串
		 */
		private static String timefyCount(int count) {
			return String.format(Locale.CHINA, "%02d:%02d", count / 60, count % 60);
		}
	}
}
