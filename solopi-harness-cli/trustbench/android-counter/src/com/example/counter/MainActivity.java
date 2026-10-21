package com.example.counter;

import android.app.Activity;
import android.os.Bundle;
import android.view.Gravity;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private int value;
    private TextView counterValue;
    private TextView counterStatus;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        value = state == null ? 0 : state.getInt("counterValue", 0);

        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setGravity(Gravity.CENTER);
        content.setPadding(48, 48, 48, 48);

        counterValue = new TextView(this);
        counterValue.setId(R.id.counter_value);
        counterValue.setTextSize(36);
        counterValue.setGravity(Gravity.CENTER);
        content.addView(counterValue, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        counterStatus = new TextView(this);
        counterStatus.setId(R.id.counter_status);
        counterStatus.setGravity(Gravity.CENTER);
        content.addView(counterStatus, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button increment = new Button(this);
        increment.setId(R.id.increment_button);
        increment.setText("Increment");
        increment.setOnClickListener(view -> {
            value++;
            render();
        });
        content.addView(increment);

        Button reset = new Button(this);
        reset.setId(R.id.reset_button);
        reset.setText("Reset");
        reset.setOnClickListener(view -> {
            value = 0;
            render();
        });
        content.addView(reset);

        setContentView(content);
        render();
    }

    @Override
    protected void onSaveInstanceState(Bundle state) {
        state.putInt("counterValue", value);
        super.onSaveInstanceState(state);
    }

    private void render() {
        counterValue.setText(Integer.toString(value));
        counterStatus.setText(value == 0 ? "Ready" : "Counting");
    }
}
