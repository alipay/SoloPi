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
package com.alipay.hulu.fragment;

import android.os.Bundle;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.common.tools.BackgroundExecutor;
import com.alipay.hulu.common.utils.LogUtil;

import java.io.BufferedReader;
import java.io.File;
import java.io.FileNotFoundException;
import java.io.FileReader;
import java.io.IOException;

import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;

public class ReplayLogFragment extends Fragment {
    public static final String LOG_FILE_PATH_TAG = "logFilePath";

    private static final String TAG = "ReplayLogFrag";

    private String adbPath;

    private TextView mainText;

    private TextView tooLoneText;

    public static ReplayLogFragment newInstance(String adbPath) {
        ReplayLogFragment fragment = new ReplayLogFragment();
        Bundle args = new Bundle();
        args.putString(LOG_FILE_PATH_TAG, adbPath);
        fragment.setArguments(args);
        return fragment;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        super.onCreate(savedInstanceState);
        Bundle bundle = getArguments();
        if (bundle == null) {
            return;
        }

        adbPath = bundle.getString(LOG_FILE_PATH_TAG);
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_replay_log, container, false);

    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        initViewUI(view);

        initViewData(view);
    }

    private void initViewUI(View v) {
        mainText = (TextView) v.findViewById(R.id.text_replay_result);
        tooLoneText = (TextView) v.findViewById(R.id.text_replay_too_long);
        tooLoneText.setVisibility(View.GONE);
    }

    private void initViewData(View v) {
        BackgroundExecutor.execute(new Runnable() {
            @Override
            public void run() {
                final File file = new File(adbPath);
                if (!file.exists()) {
                    return;
                }

                try {
                    BufferedReader reader = new BufferedReader(new FileReader(file));

                    final StringBuilder sb = new StringBuilder();
                    String line;

                    int readCount = 0;
                    final boolean readEmpty = (line = reader.readLine()) == null;
                    while (line != null && readCount < 301) {
                        sb.append(line).append('\n');
                        readCount++;
                        line = reader.readLine();
                    }

                    final boolean tooLong = readCount > 300;

                    getActivity().runOnUiThread(new Runnable() {
                        @Override
                        public void run() {
                            mainText.setText(sb.toString());
                            if (tooLong) {
                                tooLoneText.setVisibility(View.VISIBLE);
                                tooLoneText.setText(String.format(getString(R.string.to_long_template), adbPath));
                            } else if (readEmpty) {
                                tooLoneText.setVisibility(View.VISIBLE);
                                tooLoneText.setText(String.format(getString(R.string.log__read_fail_template), adbPath));
                            }
                        }
                    });

                    reader.close();

                } catch (FileNotFoundException e) {
                    LogUtil.e(TAG, "Catch FileNotFoundException: " + e.getMessage(), e);
                } catch (IOException e) {
                    LogUtil.e(TAG, "Catch IOException: " + e.getMessage(), e);
                }
            }
        });
    }
}
