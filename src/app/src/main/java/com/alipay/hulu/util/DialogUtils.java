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
package com.alipay.hulu.util;

import android.app.Activity;
import android.app.Dialog;
import android.app.ProgressDialog;
import android.content.Context;
import android.content.DialogInterface;
import android.database.DataSetObserver;
import android.graphics.Bitmap;
import android.net.Uri;
import android.os.Bundle;
import android.support.annotation.NonNull;
import android.support.v7.app.AlertDialog;
import android.text.TextUtils;
import android.util.DisplayMetrics;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.FrameLayout;
import android.widget.ImageView;
import android.widget.LinearLayout;
import android.widget.ListAdapter;
import android.widget.ListView;
import android.widget.ScrollView;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.GlideApp;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.ui.TwoLevelSelectLayout;
import com.bumptech.glide.RequestBuilder;
import com.bumptech.glide.RequestBuilder;
import com.bumptech.glide.RequestManager;
import com.bumptech.glide.request.RequestOptions;

import java.io.File;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;

/**
 * Created by ruyao.yry on 2018/3/24.
 */
public class DialogUtils {
    private static final String TAG = "DialogUtil";

    public static class DialogInfo {
        private int mResourceId;
        private String mNegativeButtonText;
        private String mPositiveButtonText;
        private String mShowContent;
        private String mTitle;
        private boolean mCancelable;

        private DialogInfo(Builder builder) {
            mResourceId = builder.mResourceId;
            mNegativeButtonText = builder.mNegativeButtonText;
            mPositiveButtonText = builder.mPositiveButtonText;
            mShowContent = builder.mShowContent;
            mTitle = builder.mTitle;
            mCancelable = builder.mCancelable;
        }

        public int getResourceId() {
            return mResourceId;
        }

        public String getNegativeButtonText() {
            return mNegativeButtonText;
        }

        public String getPositiveButtonText() {
            return mPositiveButtonText;
        }

        public String getShowContent() {
            return mShowContent;
        }

        public String getTitle() {
            return mTitle;
        }

        public boolean isCancelable() {
            return mCancelable;
        }

        public static class Builder {
            private String mNegativeButtonText;
            private String mPositiveButtonText;
            private String mShowContent;
            private String mTitle;
            private boolean mCancelable;
            private int mResourceId;

            public Builder setResourceId(int id) {
                mResourceId = id;
                return this;
            }

            public Builder setNegativeButtonText(String text) {
                mNegativeButtonText = text;
                return this;
            }

            public Builder setPositiveButtonText(String text) {
                mPositiveButtonText = text;
                return this;
            }

            public Builder setShowContent(String text) {
                mShowContent = text;
                return this;
            }

            public Builder setTitle(String text) {
                mTitle = text;
                return this;
            }

            public Builder setCancelable(boolean cancelable) {
                mCancelable = cancelable;
                return this;
            }

            public DialogInfo build() {
                return new DialogInfo(this);
            }
        }
    }

    public static AlertDialog createDialog(@NonNull  Activity activity, @NonNull DialogInfo dialogInfo,
                                           @NonNull DialogInterface.OnClickListener onClickListener) {

        AlertDialog.Builder alertDialogBuilder = dialogInfo.getResourceId() == 0?
                new AlertDialog.Builder(activity) :
                new AlertDialog.Builder(activity, dialogInfo.getResourceId());

        if (!TextUtils.isEmpty(dialogInfo.getNegativeButtonText())) {
            alertDialogBuilder.setNegativeButton(dialogInfo.getNegativeButtonText(), onClickListener);
        }

        if (!TextUtils.isEmpty(dialogInfo.getPositiveButtonText())) {
            alertDialogBuilder.setPositiveButton(dialogInfo.getPositiveButtonText(), onClickListener);
        }

        if (!TextUtils.isEmpty(dialogInfo.getTitle())) {
            alertDialogBuilder.setTitle(dialogInfo.getTitle());
        }

        if (!TextUtils.isEmpty(dialogInfo.getShowContent())) {
            alertDialogBuilder.setMessage(dialogInfo.getShowContent());
        }

        alertDialogBuilder.setCancelable(dialogInfo.isCancelable());

        return alertDialogBuilder.create();
    }

    /**
     * 显示加载悬浮窗
     *
     * @param context
     * @param str
     * @return
     */
    public static ProgressDialog showProgressDialog(final Context context, final String str) {
        if (context == null) {
            return null;
        }

        final ProgressDialog[] dialogs = new ProgressDialog[1];

        final CountDownLatch latch = new CountDownLatch(1);
        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            public void run() {
                ProgressDialog progressDialog = new ProgressDialog(context, R.style.SimpleDialogTheme);
                progressDialog.setMessage(str);
                progressDialog.setProgressStyle(ProgressDialog.STYLE_SPINNER);
                progressDialog.show();
                dialogs[0] = progressDialog;
                latch.countDown();
            }
        });

        try {
            latch.await();
        } catch (InterruptedException e) {
            LogUtil.e(TAG, "Catch java.lang.InterruptedException: " + e.getMessage(), e);
        }

        return dialogs[0];
    }

    /**
     * 展示单选界面
     * @param context
     * @param names 名称列表
     * @param icons 图标列表
     * @param callback 选择回调
     */
    public static void showSingleItemCheckDialog(final Context context,final String[] names
            , final int[] icons, final ItemCheckCallback callback) {
        if (callback == null) {
            return;
        }
        // 图标与名称不对应
        if (icons != null && icons.length != names.length) {
            return;
        }

        try {
            ListAdapter listAdapter = new ListAdapter() {
                @Override
                public boolean areAllItemsEnabled() {
                    return true;
                }

                @Override
                public boolean isEnabled(int position) {
                    return true;
                }

                @Override
                public void registerDataSetObserver(DataSetObserver observer) {

                }

                @Override
                public void unregisterDataSetObserver(DataSetObserver observer) {

                }

                @Override
                public int getCount() {
                    return names.length;
                }

                @Override
                public Object getItem(int position) {
                    return names[position];
                }

                @Override
                public long getItemId(int position) {
                    return position;
                }

                @Override
                public boolean hasStableIds() {
                    return true;
                }

                @Override
                public View getView(int position, View convertView, ViewGroup parent) {
                    if (convertView == null) {
                        convertView = LayoutInflater.from(
                                ContextUtil.getContextThemeWrapper(context,
                                        R.style.AppDialogTheme)).inflate(
                                R.layout.dialog_action_select_item, parent, false);
                    }

                    // 加载资源
                    TextView text = (TextView) convertView.findViewById(R.id.dialog_action_title);
                    text.setText(names[position]);

                    // 如果有图标信息
                    if (icons != null) {
                        ImageView img = (ImageView) convertView.findViewById(R.id.dialog_action_icon);
                        img.setImageResource(icons[position]);
                    }
                    return convertView;
                }

                @Override
                public int getItemViewType(int position) {
                    return 0;
                }

                @Override
                public int getViewTypeCount() {
                    return 1;
                }

                @Override
                public boolean isEmpty() {
                    return false;
                }
            };

            final ListView listView = new ListView(context);
            listView.setAdapter(listAdapter);
            listView.setDividerHeight(0);

            final AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                    .setTitle("请选择操作")
                    .setView(listView)
                    .setOnCancelListener(new DialogInterface.OnCancelListener() {
                        @Override
                        public void onCancel(DialogInterface dialog) {
                            callback.onCancel(dialog);
                        }
                    });

            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    final AlertDialog dialog = builder.create();
                    dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
                    dialog.setCanceledOnTouchOutside(true);                                   //点击外面区域不会让dialog消失
                    dialog.setCancelable(true);

                    listView.setOnItemClickListener(new AdapterView.OnItemClickListener() {
                        @Override
                        public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                            dialog.dismiss();
                            callback.onExecute(dialog, position);
                        }
                    });

                    dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
                        @Override
                        public void onDismiss(DialogInterface dialog) {
                            callback.onDismiss(dialog);
                        }
                    });
                    dialog.show();

                    //dialog 尺寸配置
                    dialog.getWindow().setLayout(ContextUtil.dip2px(context, 225), WindowManager.LayoutParams.WRAP_CONTENT);
                }
            });
        } catch (Exception e) {
            LogUtil.e(TAG, "显示悬浮窗抛出异常", e);
        }
    }

    /**
     * 展示功能界面
     * @param context
     * @param actionEnums
     * @param callback
     */
    public static void showFunctionView(final Context context,final List<PerformActionEnum> actionEnums
            , final FunctionViewCallback<PerformActionEnum> callback) {
        if (callback == null) {
            return;
        }

        // 转换一层
        ItemCheckCallback innerCallback = new ItemCheckCallback() {
            @Override
            public void onExecute(DialogInterface dialog, int idx) {
                callback.onExecute(dialog, actionEnums.get(idx));
            }

            @Override
            public void onCancel(DialogInterface dialog) {
                callback.onCancel(dialog);
            }

            @Override
            public void onDismiss(DialogInterface dialog) {
                callback.onDismiss(dialog);
            }
        };

        String[] names = new String[actionEnums.size()];
        int[] icons = new int[actionEnums.size()];

        for (int i = 0; i < actionEnums.size(); i++) {
            PerformActionEnum action = actionEnums.get(i);
            names[i] = action.getDesc();
            icons[i] = action.getIcon();
        }

        // 实际显示
        showSingleItemCheckDialog(context, names, icons, innerCallback);
    }

    /**
     * 显示自定义页面
     * @param context
     * @param content
     * @param confirm
     * @param onConfirm
     * @param cancel
     * @param onCancel
     */
    public static void showCustomView(final Context context, View content,
                                      String confirm, final Runnable onConfirm, String cancel, final Runnable onCancel) {
        ScrollView view = (ScrollView) LayoutInflater.from(ContextUtil.getContextThemeWrapper(
                context, R.style.AppDialogTheme))
                .inflate(R.layout.dialog_setting, null);
        LinearLayout wrapper = (LinearLayout) view.findViewById(R.id.dialog_content);

        LinearLayout.LayoutParams layoutParams = new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT);
        wrapper.addView(content, layoutParams);

        // 显示Dialog
        android.app.AlertDialog.Builder dialogB = new android.app.AlertDialog.Builder(context, R.style.AppDialogTheme)
                .setView(view)
                .setCancelable(false);

        if (confirm != null) {
            // 设置取消
            dialogB.setPositiveButton(confirm, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    if (onConfirm != null) {
                        onConfirm.run();
                    }
                }
            });
        }

        if (cancel != null) {
            dialogB.setNegativeButton(cancel, new DialogInterface.OnClickListener() {
                @Override
                public void onClick(DialogInterface dialog, int which) {
                    if (onCancel != null) {
                        onCancel.run();
                    }
                }
            });
        }

        android.app.AlertDialog dialog = dialogB.create();

        dialog.setTitle(null);
        dialog.setCanceledOnTouchOutside(false);
        dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
        dialog.show();
    }

    /**
     * 展示分层菜单项
     * @param context
     * @param keys
     * @param icons
     * @param secondLevels
     * @param callback
     */
    public static void showLeveledFunctionView(final Context context, final List<String> keys,
                                        final List<Integer> icons,
                                        final Map<String, List<TwoLevelSelectLayout.SubMenuItem>> secondLevels,
                                        final FunctionViewCallback<TwoLevelSelectLayout.SubMenuItem> callback) {
        if (callback == null) {
            LogUtil.e(TAG,"回调函数为空");
            return;
        }

        // 校验各个参数
        if (icons == null || keys == null || secondLevels == null) {
            LogUtil.e(TAG,"参数存在空情况");
            return;
        }

        // 校验长度
        if (icons.size() != keys.size()) {
            LogUtil.e(TAG,"图标与key不对应");
            return;
        }

        // 校验各个key都有对应子菜单
        for (String key: keys) {
            if (!secondLevels.containsKey(key)) {
                LogUtil.e(TAG, "菜单%s不包含对应子菜单", key);
                return;
            }
        }


        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                final TwoLevelSelectLayout layout = new TwoLevelSelectLayout(ContextUtil.getContextThemeWrapper(context, R.style.AppTheme));
                layout.updateMenus(keys, icons, secondLevels);
                AlertDialog.Builder builder = new AlertDialog.Builder(context, R.style.AppDialogTheme)
                        .setView(layout);
                final AlertDialog dialog = builder.create();
                dialog.getWindow().setType(WindowManager.LayoutParams.TYPE_SYSTEM_ALERT);
                dialog.setCanceledOnTouchOutside(true);                                   //点击外面区域不会让dialog消失
                dialog.setCancelable(true);
                dialog.setCustomTitle(null);
                dialog.setOnDismissListener(new DialogInterface.OnDismissListener() {
                    @Override
                    public void onDismiss(DialogInterface dialog) {
                        callback.onDismiss(dialog);
                    }
                });

                dialog.setOnCancelListener(new DialogInterface.OnCancelListener() {
                    @Override
                    public void onCancel(DialogInterface dialog) {
                        callback.onCancel(dialog);
                    }
                });
                dialog.show();

                layout.setOnSubMenuItemClickListener(new TwoLevelSelectLayout.OnSubMenuClickListener() {
                    @Override
                    public void onSubMenuClick(TwoLevelSelectLayout.SubMenuItem item) {
                        callback.onExecute(dialog, item);
                    }
                });

                WindowManager wm = (WindowManager) context.getSystemService(Context.WINDOW_SERVICE);
                DisplayMetrics metrics = new DisplayMetrics();
                wm.getDefaultDisplay().getMetrics(metrics);

                // 高度350dp, 宽度250dp
                int pix = ContextUtil.dip2px(context, 350);
                int width = ContextUtil.dip2px(context, 250);
                if (metrics.heightPixels < pix) {
                    if (metrics.widthPixels < width) {
                        dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, WindowManager.LayoutParams.WRAP_CONTENT);
                    } else {
                        dialog.getWindow().setLayout(width, WindowManager.LayoutParams.WRAP_CONTENT);
                    }
                } else {
                    if (metrics.widthPixels < width) {
                        dialog.getWindow().setLayout(WindowManager.LayoutParams.WRAP_CONTENT, pix);
                    } else {
                        dialog.getWindow().setLayout(width, pix);
                    }
                }
            }
        });
    }

    /**
     * 显示图像Dialog
     * @param context
     * @param targetFile
     */
    public static void showImageDialog(Context context, File targetFile) {
        ImageDialog dialog = new ImageDialog(context, targetFile);
        dialog.show();
    }

    /**
     * 显示图像Dialog
     * @param context
     * @param id resId
     */
    public static void showImageDialog(Context context, int id) {
        ImageDialog dialog = new ImageDialog(context, id);
        dialog.show();
    }

    /**
     * 显示图像Dialog
     * @param context
     * @param path 路径
     */
    public static void showImageDialog(Context context, String path) {
        ImageDialog dialog = new ImageDialog(context, path);
        dialog.show();
    }

    /**
     * 显示图像Dialog
     * @param context
     * @param content uri
     */
    public static void showImageDialog(Context context, Uri content) {
        ImageDialog dialog = new ImageDialog(context, content);
        dialog.show();
    }

    /**
     * 显示图像Dialog
     * @param context
     * @param bitmap
     */
    public static void showImageDialog(Context context, Bitmap bitmap) {
        ImageDialog dialog = new ImageDialog(context, bitmap);
        dialog.show();
    }

    /**
     * 显示图像Dialog
     * @param context
     * @param data
     */
    public static void showImageDialog(Context context, byte[] data) {
        ImageDialog dialog = new ImageDialog(context, data);
        dialog.show();
    }

    private static class ImageDialog extends Dialog {
        private ImageView img;
        private File file;
        private Integer id;
        private String path;
        private Uri uri;
        private Bitmap bitmap;
        private byte[] data;

        public ImageDialog(@NonNull Context context, File targetFile) {
            super(context, R.style.ShadowDialogTheme);
            file = targetFile;
        }

        public ImageDialog(@NonNull Context context, int resId) {
            super(context, R.style.ShadowDialogTheme);
            id = resId;
        }

        public ImageDialog(@NonNull Context context, Bitmap bitmap) {
            super(context, R.style.ShadowDialogTheme);
            this.bitmap = bitmap;
        }

        public ImageDialog(@NonNull Context context, String path) {
            super(context, R.style.ShadowDialogTheme);
            this.path = path;
        }

        public ImageDialog(@NonNull Context context, Uri uri) {
            super(context, R.style.ShadowDialogTheme);
            this.uri = uri;
        }

        public ImageDialog(@NonNull Context context, byte[] data) {
            super(context, R.style.ShadowDialogTheme);
            this.data = data;
        }

        @Override
        protected void onCreate(Bundle savedInstanceState) {
            super.onCreate(savedInstanceState);
            setCanceledOnTouchOutside(false);

            initView();
            initData();
        }


        private void initView() {
            LinearLayout linearLayout = new LinearLayout(getContext());
            img = new ImageView(getContext());
            DisplayMetrics dm = new DisplayMetrics();
            ((WindowManager) LauncherApplication.getInstance().getSystemService(Context.WINDOW_SERVICE)).getDefaultDisplay().getMetrics(dm);
            int height = (int) (dm.heightPixels * 0.8);
            img.setScaleType(ImageView.ScaleType.CENTER_INSIDE);
            linearLayout.addView(img, new LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height));

            setContentView(linearLayout, new FrameLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, height));
        }

        /**
         * 初始化监听器
         */
        private void initData() {
            img.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    ImageDialog.this.dismiss();
                }
            });

            // 对于resourceId类型，暂时只能走直接设置
            if (id != null) {
                img.setImageResource(id);
                return;
            }

            RequestManager manager = GlideApp.with(img.getContext());

            RequestBuilder<?> request;
            if (file != null) {
                request = manager.load(file);
            } else if (path != null) {
                request = manager.load(path);
            } else if (uri != null) {
                request = manager.load(uri);
            } else if (bitmap != null){
                request = manager.load(bitmap);
            } else if (data != null){
                request = manager.load(data);
            } else {
                return;
            }

            request.apply(RequestOptions.fitCenterTransform()).into(img);
        }
    }

    public interface FunctionViewCallback<T> {
        void onExecute(DialogInterface dialog, T action);
        void onCancel(DialogInterface dialog);
        void onDismiss(DialogInterface dialog);
    }

    public interface ItemCheckCallback {
        void onExecute(DialogInterface dialog, int idx);
        void onCancel(DialogInterface dialog);
        void onDismiss(DialogInterface dialog);
    }
}
