package com.alipay.hulu.shared.node.action.provider;

import android.view.View;

/**
 * Created by qiaoruikai on 2019/1/25 4:09 PM.
 */
public abstract class ViewLoadCallback {
    public void onViewLoaded(View v) {
        onViewLoaded(v, null);
    }

    public abstract void onViewLoaded(View v, Runnable r);
}
