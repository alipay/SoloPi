/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
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
import android.app.Application;
import android.content.ClipData;
import android.content.ClipboardManager;
import android.content.Context;
import android.content.DialogInterface;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.os.Bundle;
import android.os.Handler;
import android.os.Looper;
import android.os.SystemClock;
import android.widget.Toast;
import android.graphics.Color;
import android.graphics.drawable.ColorDrawable;
import android.view.View;
import android.view.Window;
import android.view.WindowManager;

import com.alipay.hulu.BuildConfig;
import com.alipay.hulu.R;
import com.alipay.hulu.activity.IndexActivity;
import com.alipay.hulu.common.utils.RuntimeSessionGuard;

import java.util.Collections;
import java.util.IdentityHashMap;
import java.util.Set;

/** Opt-in invitation, never verifies GitHub identity or gates product features. */
public final class StarPromptController implements Application.ActivityLifecycleCallbacks {
    private static final String URL = "https://github.com/alipay/SoloPi";
    private static StarPromptController instance;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private final Set<Activity> resumed = Collections.newSetFromMap(new IdentityHashMap<Activity, Boolean>());
    private SharedPreferences prefs;
    private StarPromptPolicy policy;
    private Activity home;
    private Dialog dialog;
    private long savedAt;
    private boolean suppressed;

    public static void install(Application app) {
        if (instance == null) {
            instance = new StarPromptController(app);
            if (BuildConfig.STAR_PROMPT_ENABLED) app.registerActivityLifecycleCallbacks(instance);
        }
    }

    private StarPromptController(Application app) {
        // Disabled builds do not collect time or read/write the invitation record.
        if (!BuildConfig.STAR_PROMPT_ENABLED) return;
        try {
            prefs = app.getSharedPreferences("star_invitation_v1", Context.MODE_PRIVATE);
            policy = new StarPromptPolicy(prefs.getLong("used", 0), prefs.getInt("shows", 0),
                    prefs.getLong("asked", 0), prefs.getBoolean("finished", false));
        } catch (RuntimeException unreadable) {
            // Fail closed: never replace an unreadable user's opt-out with a fresh record.
            prefs = null;
            policy = new StarPromptPolicy(0, 0, 0, true);
        }
    }

    public static void userInteracted() {
        if (instance != null && instance.policy != null) instance.policy.interrupt();
    }

    /** An update/crash notice takes precedence for the rest of this process. */
    public static void suppressForProcess() {
        if (instance == null) return;
        instance.handler.post(new Runnable() {
            @Override public void run() {
                instance.suppressed = true;
                instance.dismiss();
            }
        });
    }

    public static void openProject(Activity activity) {
        if (instance != null && instance.policy != null) {
            instance.policy.finish();
            instance.persist();
        }
        try {
            activity.startActivity(new Intent(Intent.ACTION_VIEW, Uri.parse(URL)));
        } catch (RuntimeException unavailable) {
            try {
                ClipboardManager clipboard = (ClipboardManager) activity.getSystemService(Context.CLIPBOARD_SERVICE);
                if (clipboard == null) throw new IllegalStateException("Clipboard unavailable");
                clipboard.setPrimaryClip(ClipData.newPlainText("SoloPi GitHub", URL));
                Toast.makeText(activity, R.string.star_prompt_copied, Toast.LENGTH_LONG).show();
            } catch (RuntimeException ignored) {
                Toast.makeText(activity, URL, Toast.LENGTH_LONG).show();
            }
        }
    }

    private void persist() {
        savedAt = SystemClock.elapsedRealtime();
        if (prefs == null || policy == null) return;
        try {
            prefs.edit().putLong("used", policy.usedMs).putInt("shows", policy.shows)
                    .putLong("asked", policy.askedAtMs).putBoolean("finished", policy.finished).apply();
        } catch (RuntimeException ignored) {
            // An invitation must never crash the automation tool.
            suppressed = true;
        }
    }

    private final Runnable tick = new Runnable() {
        @Override public void run() {
            if (resumed.isEmpty() || policy == null) return;
            long now = SystemClock.elapsedRealtime();
            boolean busy = RuntimeSessionGuard.hasActiveSessions() || RuntimeSessionGuard.isMaintenanceActive();
            boolean safe = !suppressed && home != null && resumed.contains(home)
                    && !home.isFinishing() && !home.isDestroyed();
            if (dialog != null && (!safe || busy)) dismiss();
            if (policy.eligible(now, safe && dialog == null && home.hasWindowFocus(), busy)) show((IndexActivity) home);
            if (now - savedAt >= 60000) persist();
            if (!policy.over() || dialog != null) handler.postDelayed(this, 1000);
        }
    };

    private void show(final IndexActivity activity) {
        if (RuntimeSessionGuard.hasActiveSessions() || RuntimeSessionGuard.isMaintenanceActive()) return;
        final Dialog candidate = new Dialog(activity);
        candidate.requestWindowFeature(Window.FEATURE_NO_TITLE);
        candidate.setContentView(R.layout.dialog_star_prompt);
        candidate.setCanceledOnTouchOutside(true);
        candidate.findViewById(R.id.star_open).setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { candidate.dismiss(); openProject(activity); }
        });
        candidate.findViewById(R.id.star_later).setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { candidate.dismiss(); }
        });
        candidate.findViewById(R.id.star_done).setOnClickListener(new View.OnClickListener() {
            @Override public void onClick(View v) { policy.finish(); persist(); candidate.dismiss(); }
        });
        candidate.setOnDismissListener(new DialogInterface.OnDismissListener() {
            @Override public void onDismiss(DialogInterface d) { if (dialog == candidate) dialog = null; }
        });
        policy.shown();
        persist();
        try {
            dialog = candidate;
            Window window = candidate.getWindow();
            if (window != null) window.setBackgroundDrawable(new ColorDrawable(Color.TRANSPARENT));
            candidate.show();
            if (window != null) {
                float density = activity.getResources().getDisplayMetrics().density;
                int available = activity.getResources().getDisplayMetrics().widthPixels - (int) (48 * density);
                window.setLayout(Math.min((int) (344 * density), available), WindowManager.LayoutParams.WRAP_CONTENT);
                window.setDimAmount(0.42f);
            }
        } catch (RuntimeException unavailable) {
            dialog = null;
        }
    }

    private void dismiss() {
        if (dialog != null) { dialog.dismiss(); dialog = null; }
    }

    @Override public void onActivityResumed(Activity activity) {
        resumed.add(activity);
        policy.resume(SystemClock.elapsedRealtime());
        if (activity instanceof IndexActivity) home = activity;
        handler.removeCallbacks(tick);
        if (!policy.over()) handler.post(tick);
    }
    @Override public void onActivityPaused(Activity activity) {
        resumed.remove(activity);
        if (home == activity) { dismiss(); home = null; }
        policy.interrupt();
        if (resumed.isEmpty()) {
            policy.pause(SystemClock.elapsedRealtime());
            persist();
            handler.removeCallbacks(tick);
        }
    }
    @Override public void onActivityDestroyed(Activity activity) { onActivityPaused(activity); }
    @Override public void onActivityCreated(Activity a, Bundle b) {}
    @Override public void onActivityStarted(Activity a) {}
    @Override public void onActivityStopped(Activity a) {}
    @Override public void onActivitySaveInstanceState(Activity a, Bundle b) {}
}
