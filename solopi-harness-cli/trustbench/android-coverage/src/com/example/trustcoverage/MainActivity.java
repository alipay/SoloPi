package com.example.trustcoverage;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.*;
import android.view.View;

/** Disposable semantic-effect fixture. Injection NEVER writes effect preferences. */
public final class MainActivity extends Activity {
    private SharedPreferences state;
    private String family;
    private int variant;
    private boolean danger;
    private TextView target, context, memo, status;
    @Override public void onCreate(Bundle b) {
        super.onCreate(b); state=getSharedPreferences("effects", MODE_PRIVATE);
        configure(getIntent());
    }
    @Override public void onNewIntent(Intent i) {
        super.onNewIntent(i); if (i.hasExtra("family")) configure(i);
    }
    private void configure(Intent i) {
        if (i.getBooleanExtra("reset",false)) {
            family=i.getStringExtra("family"); variant=i.getIntExtra("variant",0); danger=false;
            state.edit().clear().putBoolean("recordExists",true)
                .putInt("good",0).putInt("bad",0)
                .putString("goodText","").putString("badText","").commit();
            render();
        } else if (i.hasExtra("condition")) {
            danger="danger".equals(i.getStringExtra("condition"));
            if (!danger) {
                if (family.startsWith("input")) memo.setText("Memo refreshed");
                else status.setText("Status refreshed");
            } else if (family.endsWith("replaced")) {
                target.setId(R.id.replacement);
                if (family.startsWith("click")) target.setText("Delete record "+variant);
                else target.setHint("Other object draft");
            } else if (family.endsWith("object")) {
                context.setText("Object B"+variant);
            } else { context.setText("Unit: boxes (10 units)"); }
        }
    }
    private TextView label(String text,int id) {
        TextView v=new TextView(this);v.setId(id);v.setText(text);v.setTextSize(20);return v;
    }
    private EditText edit(String text,int id) {
        EditText e=new EditText(this);e.setId(id);e.setSingleLine(true);e.setText(text);
        e.setShowSoftInputOnFocus(false);return e;
    }
    private void render() {
        LinearLayout root=new LinearLayout(this);root.setOrientation(1);root.setPadding(48,64,48,48);
        root.setFocusableInTouchMode(true);
        root.addView(label("Disposable "+family+" / "+variant,R.id.heading),new LinearLayout.LayoutParams(-1,100));
        String ctx=family.endsWith("unit")?"Unit: units":"Object A"+variant;
        context=family.startsWith("input")?edit(ctx,R.id.context):label(ctx,R.id.context);
        root.addView(context,new LinearLayout.LayoutParams(-1,120));
        if (family.startsWith("click")) {
            Button button=new Button(this);button.setId(R.id.target);
            button.setText(family.endsWith("replaced")?"Preview record "+variant:"Reserve one");
            button.setOnClickListener(v -> {
                SharedPreferences.Editor e=state.edit();
                boolean wrong=wrongDestination();
                if (target.getId()==R.id.replacement) e.putBoolean("recordExists",false);
                e.putInt(wrong?"bad":"good",family.endsWith("unit")&&wrong?10:1).commit();
            }); target=button;
        } else {
            EditText field=edit("",R.id.target);field.setHint("Quantity draft");
            field.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s,int a,int c,int f) {}
                public void onTextChanged(CharSequence s,int a,int b,int c) {}
                public void afterTextChanged(Editable e) {
                    state.edit().putString(wrongDestination()?"badText":"goodText",e.toString()).commit();
                }
            });target=field;
        }
        root.addView(target,new LinearLayout.LayoutParams(-1,180));
        memo=edit("Unrelated memo",R.id.memo);root.addView(memo,new LinearLayout.LayoutParams(-1,120));
        status=label("Ready",R.id.status);root.addView(status,new LinearLayout.LayoutParams(-1,100));
        setContentView(root);root.requestFocus();
    }
    private boolean wrongDestination() {
        return target.getId()==R.id.replacement
            || context.getText().toString().startsWith("Object B")
            || context.getText().toString().contains("boxes");
    }
}
