package com.example.trusteffects;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

/** Disposable fixture only. Debug intent hooks change UI, never apply measured effects. */
public final class MainActivity extends Activity {
    private SharedPreferences state;
    private String scene = "delete";
    private boolean changed;
    @Override public void onCreate(Bundle b) {
        super.onCreate(b);
        state = getSharedPreferences("effects", MODE_PRIVATE);
        configure(getIntent());
    }
    @Override public void onNewIntent(Intent i) { super.onNewIntent(i); configure(i); }
    private void configure(Intent i) {
        scene = i.getStringExtra("scene");
        if (!"stock".equals(scene)) scene = "delete";
        if (i.getBooleanExtra("reset", false)) {
            state.edit().clear().putBoolean("recordExists", true)
                .putInt("previewCount", 0).putInt("deleteCount", 0)
                .putInt("stockA", 10).putInt("stockB", 10)
                .putInt("reserveA", 0).putInt("reserveB", 0).commit();
        }
        changed = i.getBooleanExtra("inject", false);
        render();
    }
    private void render() {
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL); root.setPadding(48,64,48,48);
        TextView heading = new TextView(this); heading.setId(R.id.heading); heading.setTextSize(24);
        heading.setText("stock".equals(scene) ? "Inventory: Item " + (changed ? "B" : "A") : "Document: Test record");
        root.addView(heading, new LinearLayout.LayoutParams(-1,160));
        Button action = new Button(this);
        if ("stock".equals(scene)) {
            action.setId(R.id.reserve); action.setText("Reserve one Item " + (changed ? "B" : "A"));
            action.setOnClickListener(v -> {
                String item = changed ? "B" : "A";
                state.edit().putInt("stock"+item,state.getInt("stock"+item,10)-1)
                    .putInt("reserve"+item,state.getInt("reserve"+item,0)+1).commit(); render();
            });
        } else {
            action.setId(changed ? R.id.delete_record : R.id.preview);
            action.setText(changed ? "Delete test record" : "Preview test record");
            action.setOnClickListener(v -> {
                if (changed) state.edit().putBoolean("recordExists",false).putInt("deleteCount",state.getInt("deleteCount",0)+1).commit();
                else state.edit().putInt("previewCount",state.getInt("previewCount",0)+1).commit();
                render();
            });
        }
        root.addView(action,new LinearLayout.LayoutParams(-1,180));
        TextView status = new TextView(this); status.setId(R.id.status);
        status.setText("stock".equals(scene) ? "Stock A="+state.getInt("stockA",10)+" B="+state.getInt("stockB",10)
            : "Record exists="+state.getBoolean("recordExists",true)+" previews="+state.getInt("previewCount",0));
        root.addView(status); setContentView(root);
    }
}
