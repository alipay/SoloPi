package com.example.trustnotes;

import android.app.Activity;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.view.ViewGroup;
import android.widget.Button;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.TextView;

public final class MainActivity extends Activity {
    private static final String STORE = "trustbench_notes";
    private SharedPreferences notes;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        notes = getSharedPreferences(STORE, MODE_PRIVATE);
        renderList();
    }

    private LinearLayout page(String heading) {
        LinearLayout content = new LinearLayout(this);
        content.setOrientation(LinearLayout.VERTICAL);
        content.setPadding(48, 64, 48, 48);

        TextView title = new TextView(this);
        title.setText(heading);
        title.setTextSize(24);
        content.addView(title, new LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT));

        Button reset = button(R.id.reset_button, "Reset notes");
        reset.setOnClickListener(view -> {
            notes.edit().clear().commit();
            renderList();
        });
        content.addView(reset);
        return content;
    }

    private Button button(int id, String label) {
        Button result = new Button(this);
        result.setId(id);
        result.setText(label);
        return result;
    }

    private void renderList() {
        LinearLayout content = page("Notes");
        TextView count = new TextView(this);
        count.setId(R.id.note_count);
        count.setText(notes.contains("title") ? "1" : "0");
        content.addView(count);

        Button create = button(R.id.new_note_button, "New note");
        create.setOnClickListener(view -> renderEditor());
        content.addView(create);

        if (notes.contains("title")) {
            Button saved = button(R.id.saved_note_button, notes.getString("title", ""));
            saved.setOnClickListener(view -> renderDetail());
            content.addView(saved);
        }
        setContentView(content);
    }

    private void renderEditor() {
        LinearLayout content = page("New note");
        EditText title = new EditText(this);
        title.setId(R.id.title_input);
        title.setHint("Title");
        title.setSingleLine(true);
        content.addView(title);

        EditText body = new EditText(this);
        body.setId(R.id.body_input);
        body.setHint("Body");
        body.setMinLines(3);
        content.addView(body);

        Button save = button(R.id.save_button, "Save note");
        save.setOnClickListener(view -> {
            String titleValue = title.getText().toString().trim();
            String bodyValue = body.getText().toString().trim();
            if (titleValue.isEmpty() || bodyValue.isEmpty()) {
                return;
            }
            notes.edit().putString("title", titleValue).putString("body", bodyValue).commit();
            renderDetail();
        });
        content.addView(save);
        setContentView(content);
    }

    private void renderDetail() {
        LinearLayout content = page("Saved note");
        TextView title = new TextView(this);
        title.setId(R.id.saved_title);
        title.setText(notes.getString("title", ""));
        title.setTextSize(20);
        content.addView(title);

        TextView body = new TextView(this);
        body.setId(R.id.saved_body);
        body.setText(notes.getString("body", ""));
        content.addView(body);

        Button back = button(R.id.back_to_list_button, "Back to notes");
        back.setOnClickListener(view -> renderList());
        content.addView(back);
        setContentView(content);
    }
}
