package com.alipay.hulu.common.utils.activity;

import android.app.Activity;
import android.content.DialogInterface;
import android.content.Intent;
import android.os.Bundle;
import android.os.Environment;
import androidx.annotation.Nullable;
import androidx.appcompat.app.AlertDialog;
import android.view.Display;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.AdapterView;
import android.widget.EditText;
import android.widget.LinearLayout;
import android.widget.ListView;
import android.widget.SimpleAdapter;
import android.widget.TextView;

import com.alipay.hulu.common.R;
import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.ContextUtil;
import com.alipay.hulu.common.utils.StringUtil;

import java.io.File;
import java.io.FileFilter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

public class FileChooseDialogActivity extends Activity implements View.OnClickListener {
    public static final String KEY_TARGET_FILE = "KEY_TARGET_FILE";
    public static final String KEY_SOURCE_FILE = "KEY_SOURCE_FILE";
    public static final String KEY_TITLE_NAME = "KEY_TITLE_NAME";
    public static final String KEY_NEW_FILE_NAME = "KEY_NEW_FILE_NAME";

    private static final String TAG = "FileChooseDialog";

    private static final String _KEY_FILE_NAME = "fileName";
    private static final String _KEY_FILE_WRITABLE = "fileWritable";

    private View upperIcon;
    private View createIcon;
    private TextView titleText;
    private TextView currentDirectoryText;
    private ListView dirList;
    private LinearLayout positiveButton;
    private TextView positiveBtnText;
    private LinearLayout negativeButton;
    private TextView negativeBtnText;

    private SimpleAdapter dirAdapter;

    private File currentDir;
    private String defaultFileName;
    private List<File> currentSubDir = new ArrayList<>();
    private final List<Map<String, String>> currentSubDirData = new ArrayList<>();


    @Override
    protected void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);

        setFinishOnTouchOutside(false);
        setContentView(R.layout.file_choose_dialog_layout);

        setupWindow();

        initView();
        initControl();
        initData(getIntent());
    }

    /**
     * 设置窗体信息
     */
    private void setupWindow() {
        WindowManager windowManager = getWindowManager();
        Display display = windowManager.getDefaultDisplay();
        WindowManager.LayoutParams params = getWindow().getAttributes();
        params.width = display.getWidth() - ContextUtil.dip2px(this, 48);
        getWindow().setGravity(Gravity.CENTER);
    }

    /**
     * 初始化界面
     */
    private void initView() {
        // 标题部分
        upperIcon = findViewById(R.id.file_choose_upper);
        titleText = (TextView) findViewById(R.id.file_choose_title);
        currentDirectoryText = (TextView) findViewById(R.id.file_choose_path);
        createIcon = findViewById(R.id.file_choose_create);

        // List
        dirList = (ListView) findViewById(R.id.file_choose_list);

        // button
        positiveButton = (LinearLayout) findViewById(R.id.file_choose_positive_button);
        positiveBtnText = (TextView) positiveButton.getChildAt(0);
        negativeButton = (LinearLayout) findViewById(R.id.file_choose_negative_button);
        negativeBtnText = (TextView) negativeButton.getChildAt(0);
    }

    /**
     * 初始化数据
     * @param intent
     */
    private void initData(Intent intent) {
        if (intent == null) {
            intent = new Intent();
        }

        String fileName = intent.getStringExtra(KEY_NEW_FILE_NAME);
        if (StringUtil.isEmpty(fileName)) {
            fileName = "solopi";
        }
        defaultFileName = fileName;

        // 标题名称
        String title = intent.getStringExtra(KEY_TITLE_NAME);
        if (!StringUtil.isEmpty(title)) {
            titleText.setText(title);
        }

        // 初始目录
        String rootFilePath = intent.getStringExtra(KEY_SOURCE_FILE);
        File rootFile;
        if (StringUtil.isEmpty(rootFilePath)) {
            rootFile = Environment.getExternalStorageDirectory();
        } else {
            rootFile = new File(rootFilePath);

            // 如果目录不存在
            if (!rootFile.exists() || !rootFile.isDirectory()) {
                rootFile = Environment.getExternalStorageDirectory();
            }
        }
        reloadDir(rootFile);
    }

    /**
     * 重载目录
     * @param dir
     */
    private void reloadDir(File dir) {
        if (dir == null || !dir.canRead()) {
            return;
        }
        currentDir = dir;
        currentSubDir = Arrays.asList(currentDir.listFiles(new FileFilter() {
            @Override
            public boolean accept(File pathname) {
                return pathname.isDirectory();
            }
        }));

        Collections.sort(currentSubDir);
        currentSubDirData.clear();
        for (File f: currentSubDir) {
            Map<String, String> data = new HashMap<>();
            data.put(_KEY_FILE_NAME, f.getName());
            data.put(_KEY_FILE_WRITABLE, f.canWrite()? "": "无权限");
            currentSubDirData.add(data);
        }
        dirAdapter.notifyDataSetChanged();
        runOnUiThread(new Runnable() {
            @Override
            public void run() {
                if (currentDir.canWrite()) {
                    currentDirectoryText.setTextColor(0xFF757575);
                    createIcon.setEnabled(true);
                } else {
                    currentDirectoryText.setTextColor(0xFFFF4081);
                    createIcon.setEnabled(false);
                }
                currentDirectoryText.setText(currentDir.getPath());

                if (currentDir.getParentFile() == null) {
                    upperIcon.setEnabled(false);
                } else {
                    upperIcon.setEnabled(true);
                }
            }
        });
    }

    /**
     * 初始化控制逻辑
     */
    private void initControl() {
        dirAdapter = new SimpleAdapter(this, currentSubDirData, R.layout.file_item_layout,
                new String[] {_KEY_FILE_NAME, _KEY_FILE_WRITABLE},
                new int[] {R.id.file_item_name, R.id.file_item_desc});
        dirList.setAdapter(dirAdapter);
        dirList.setOnItemClickListener(new AdapterView.OnItemClickListener() {
            @Override
            public void onItemClick(AdapterView<?> parent, View view, int position, long id) {
                File realFile = currentSubDir.get(position);
                reloadDir(realFile);
            }
        });

        upperIcon.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                File upperFile = currentDir.getParentFile();
                if (upperFile == null) {
                    return;
                }

                reloadDir(upperFile);
            }
        });

        createIcon.setOnClickListener(new View.OnClickListener() {
            @Override
            public void onClick(View v) {
                showCreateDialog();
            }
        });

        positiveButton.setOnClickListener(this);
        negativeButton.setOnClickListener(this);
    }

    /**
     * 显示创建对话框
     */
    private void showCreateDialog() {
        final EditText editText = new EditText(this);
        editText.setText(defaultFileName);
        // 显示Dialog
        new AlertDialog.Builder(this, R.style.PermissionAppDialogTheme)
                .setTitle(R.string.file_choose__create_folder)
                .setView(editText)
                .setPositiveButton(R.string.constant__confirm, new DialogInterface.OnClickListener() {
                    @Override
                    public void onClick(DialogInterface dialog, int which) {
                        if (StringUtil.isEmpty(editText.getText())) {
                            return;
                        }

                        File f = new File(currentDir, editText.getText().toString());
                        boolean result = f.mkdirs();
                        if (result && f.exists()) {
                            reloadDir(f);
                        } else {
                            reloadDir(currentDir);
                        }
                        dialog.dismiss();
                    }
                }).setNegativeButton(R.string.constant__cancel, new DialogInterface.OnClickListener() {
            @Override
            public void onClick(DialogInterface dialog, int which) {
                dialog.dismiss();
            }
        }).setCancelable(true)
                .show();
    }

    @Override
    public void onClick(View v) {
        if (v == positiveButton) {
            Intent intent = new Intent();
            intent.putExtra(KEY_TARGET_FILE, currentDir.getPath());

            setResult(RESULT_OK, intent);
        } else {
            setResult(RESULT_CANCELED);
        }

        finish();
    }

    /**
     * 启动文件选择器
     * @param activity
     * @param title
     * @param fileName
     * @param baseDir
     */
    public static void startFileChooser(final Activity activity, final int requestCode, String title, String fileName, File baseDir) {
        final Intent intent = new Intent(activity, FileChooseDialogActivity.class);
        intent.putExtra(KEY_NEW_FILE_NAME, fileName);
        if (baseDir != null) {
            intent.putExtra(KEY_SOURCE_FILE, baseDir.getPath());
        }
        intent.putExtra(KEY_TITLE_NAME, title);

        LauncherApplication.getInstance().runOnUiThread(new Runnable() {
            @Override
            public void run() {
                activity.startActivityForResult(intent, requestCode);
            }
        });
    }
}
