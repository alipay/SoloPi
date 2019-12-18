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
package com.alipay.hulu.activity;

import android.Manifest;
import android.app.AlertDialog;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.MiscUtil;
import com.alipay.hulu.common.utils.PermissionUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.util.Arrays;

public class SplashActivity extends BaseActivity {
	private Handler handler;
	private static final String DISPLAY_ALERT_INFO = "displayAlertInfo";

	@Override
	public void onCreate(Bundle savedInstanceState){
		super.onCreate(savedInstanceState);
		handler = new Handler();
		setContentView(R.layout.splash);

		// 如果有自定义目录
		String baseDir = SPService.getString(SPService.KEY_BASE_DIR);
		if (!StringUtil.isEmpty(baseDir)) {
			FileUtils.setSolopiBaseDir(baseDir);
		}

		// 免责弹窗
		boolean showDisplay = SPService.getBoolean(DISPLAY_ALERT_INFO, true);
		if (showDisplay) {
			AlertDialog dialog = new AlertDialog.Builder(this).setTitle(R.string.index__disclaimer)
					.setMessage(R.string.disclaimer)
					.setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
						@Override
						public void onClick(DialogInterface dialog, int which) {
							processPemission();
							dialog.dismiss();
						}
					}).setNegativeButton(R.string.constant__no_inform, new DialogInterface.OnClickListener() {
				@Override
				public void onClick(DialogInterface dialog, int which) {
					SPService.putBoolean(DISPLAY_ALERT_INFO, false);
					processPemission();
					dialog.dismiss();
				}
			}).setCancelable(false).create();
			dialog.setCanceledOnTouchOutside(false);
			dialog.show();
		} else {
			processPemission();
		}
	}

	/**
	 * 写权限后续步骤
	 */
	private void afterWritePermission(boolean noStart) {
		FileUtils.getSolopiDir();

		Intent intent = new Intent(SplashActivity.this, IndexActivity.class);
		if (noStart) {
			intent.addFlags(Intent.FLAG_ACTIVITY_NO_ANIMATION);
		}
		// 已经初始化完毕过了，直接进入主页
		if (LauncherApplication.getInstance().hasFinishInit()) {
			startActivity(intent);
			finish();
		} else {
			// 新启动进闪屏页2s
			waitForAppInitialize();
		}
	}

	/**
	 * 等待Launcher初始化完毕
	 */
	private void waitForAppInitialize() {
		BackgroundExecutor.execute(new Runnable() {
			@Override
			public void run() {
				while (!LauncherApplication.getInstance().hasFinishInit()) {
					MiscUtil.sleep(50);
				}

				// 主线程跳转下
				LauncherApplication.getInstance().runOnUiThread(new Runnable() {
					public void run() {
						Intent intent = new Intent(SplashActivity.this,
								IndexActivity.class);
						startActivity(intent);
						SplashActivity.this.finish();
					}
				});
			}
		});
	}

	private void processPemission() {
		if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
			// 如果不存储在/sdcard/solopi，说明已经降级到外置私有目录下了
			if (!StringUtil.equals(SPService.getString(SPService.KEY_SOLOPI_PATH_NAME, "solopi"), "solopi")) {
				afterWritePermission(true);
				return;
			}

			if (checkSelfPermission(Manifest.permission.WRITE_EXTERNAL_STORAGE) == PackageManager.PERMISSION_GRANTED) {
				afterWritePermission(true);
				return;
			}

			// 申请IO权限
			PermissionUtil.requestPermissions(Arrays.asList(Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE), this, new PermissionUtil.OnPermissionCallback() {
				@Override
				public void onPermissionResult(boolean result, String reason) {
					if (result) {
						afterWritePermission(false);
					} else {
						// 再申请一次
						PermissionUtil.requestPermissions(Arrays.asList(Manifest.permission.WRITE_EXTERNAL_STORAGE, Manifest.permission.READ_EXTERNAL_STORAGE), SplashActivity.this, new PermissionUtil.OnPermissionCallback() {
							@Override
							public void onPermissionResult(boolean result, String reason) {
								// 如果申请失败
								if (!result) {
									FileUtils.fallBackToExternalDir(SplashActivity.this);
								}

								afterWritePermission(false);
							}
						});
					}
				}
			});
		} else {
			afterWritePermission(true);
		}
	}

	private void finishApp() {
		runOnUiThread(new Runnable() {
			@Override
			public void run() {
				finish();
			}
		});
	}

	private void startNextPage() {
		handler.postDelayed(new Runnable() {
			@Override
			public void run() {
				Intent intent = new Intent(SplashActivity.this,
						IndexActivity.class);
				startActivity(intent);
				SplashActivity.this.finish();
			}
		}, 1000);
	}
}
