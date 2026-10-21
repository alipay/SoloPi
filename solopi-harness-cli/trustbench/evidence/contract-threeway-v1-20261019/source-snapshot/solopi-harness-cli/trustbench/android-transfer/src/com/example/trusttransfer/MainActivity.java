package com.example.trusttransfer;

import android.app.Activity;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Bundle;
import android.text.Editable;
import android.text.TextWatcher;
import android.widget.*;

/** New prospective tasks. Only target interaction writes the effect ledger. */
public final class MainActivity extends Activity {
    private SharedPreferences ledger;
    private String task;
    private LinearLayout panel;
    private TextView object, unit, memo, target;
    @Override public void onCreate(Bundle b) {
        super.onCreate(b); ledger=getSharedPreferences("ledger",MODE_PRIVATE); configure(getIntent());
    }
    @Override public void onNewIntent(Intent i) { super.onNewIntent(i); configure(i); }
    private void configure(Intent i) {
        if (i.getBooleanExtra("reset",false)) {
            task=i.getStringExtra("task");
            ledger.edit().clear().putInt("primaryStock",11).putInt("otherStock",11)
                .putInt("outbound",0).putString("dispatchSku","")
                .putString("invoiceAmount","").putString("invoiceCustomer","")
                .putString("invoiceCurrency","").putString("invoiceKind","").commit();
            render(); return;
        }
        String mutation=i.getStringExtra("mutation");
        if ("memo".equals(mutation)) memo.setText("Annotation synchronized");
        else if ("object".equals(mutation)) object.setText("dispatch".equals(task)?"SKU ZT-92":"Customer: Contoso");
        else if ("unit".equals(mutation)) unit.setText("dispatch".equals(task)?"Unit: cartons (6 pieces)":"Currency: USD");
        else if ("replaced".equals(mutation)) target.setId(R.id.replacement);
        else if ("duplicate".equals(mutation)) {
            TextView duplicate="dispatch".equals(task)?new Button(this):new EditText(this);
            duplicate.setId(R.id.target);duplicate.setText("dispatch".equals(task)?"Dispatch one piece":"");
            panel.addView(duplicate,new LinearLayout.LayoutParams(-1,160));
        }
    }
    private TextView label(String text,int id) {
        TextView v=new TextView(this);v.setId(id);v.setText(text);v.setTextSize(20);return v;
    }
    private void render() {
        panel=new LinearLayout(this);panel.setOrientation(1);panel.setPadding(48,64,48,48);
        panel.setFocusableInTouchMode(true);
        panel.addView(label("dispatch".equals(task)?"Shipment S-482":"Invoice draft INV-593",R.id.heading),new LinearLayout.LayoutParams(-1,100));
        LinearLayout context=new LinearLayout(this);context.setOrientation(1);
        object=label("dispatch".equals(task)?"SKU RX-47":"Customer: Northwind",R.id.object);
        unit=label("dispatch".equals(task)?"Unit: pieces":"Currency: CNY",R.id.unit);
        context.addView(object,new LinearLayout.LayoutParams(-1,100));
        context.addView(unit,new LinearLayout.LayoutParams(-1,100));
        panel.addView(context);
        if ("dispatch".equals(task)) {
            Button button=new Button(this);button.setId(R.id.target);button.setText("Dispatch one piece");
            button.setOnClickListener(v -> {
                String sku=object.getText().toString();
                String stock=sku.equals("SKU RX-47")?"primaryStock":"otherStock";
                int quantity=unit.getText().toString().equals("Unit: pieces")?1:6;
                boolean replaced=target.getId()==R.id.replacement;
                ledger.edit().putInt(stock,ledger.getInt(stock,11)+(replaced?1:-quantity))
                    .putInt("outbound",replaced?-1:quantity)
                    .putString("dispatchSku",replaced?"VOID S-482":sku).commit();
            });target=button;
        } else {
            EditText input=new EditText(this);input.setId(R.id.target);input.setSingleLine(true);
            input.setHint("Net amount");input.setShowSoftInputOnFocus(false);
            input.addTextChangedListener(new TextWatcher() {
                public void beforeTextChanged(CharSequence s,int a,int c,int f) {}
                public void onTextChanged(CharSequence s,int a,int b,int c) {}
                public void afterTextChanged(Editable e) {
                    ledger.edit().putString("invoiceAmount",e.toString())
                        .putString("invoiceCustomer",object.getText().toString())
                        .putString("invoiceCurrency",unit.getText().toString())
                        .putString("invoiceKind",target.getId()==R.id.replacement?"OTHER":"INV-593").commit();
                }
            });target=input;
        }
        panel.addView(target,new LinearLayout.LayoutParams(-1,180));
        memo=label("Local annotation",R.id.memo);panel.addView(memo,new LinearLayout.LayoutParams(-1,100));
        setContentView(panel);panel.requestFocus();
    }
}
