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
import androidx.annotation.Nullable;
import androidx.fragment.app.Fragment;
import androidx.recyclerview.widget.LinearLayoutManager;
import androidx.recyclerview.widget.RecyclerView;
import android.util.Pair;
import android.view.LayoutInflater;
import android.view.View;
import android.view.ViewGroup;
import android.widget.ImageView;
import android.widget.TextView;

import com.alipay.hulu.R;
import com.alipay.hulu.bean.ReplayResultBean;
import com.alipay.hulu.common.utils.FileUtils;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.util.DialogUtils;
import com.bumptech.glide.Glide;
import com.bumptech.glide.request.RequestOptions;

import java.io.File;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * Created by qiaoruikai on 2018/11/7 4:55 PM.
 */
public class ReplayScreenShotFragment extends Fragment {
    public static final String RESULT_BEAN_TAG = "ReplayStepBean";

    private static final String TAG = "ReplayScreenFrag";

    private RecyclerView recyclerView;

    private ReplayResultBean resultBean;
    List<Pair<String, File>> screenshots;

    public static ReplayScreenShotFragment newInstance(ReplayResultBean data) {
        ReplayScreenShotFragment fragment = new ReplayScreenShotFragment();
        Bundle args = new Bundle();
        args.putParcelable(RESULT_BEAN_TAG, data);
        fragment.setArguments(args);
        return fragment;
    }

    @Override
    public void onCreate(@Nullable Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        Bundle bundle = getArguments();
        if (bundle == null) {
            return;
        }

        resultBean = bundle.getParcelable(RESULT_BEAN_TAG);
        if (resultBean == null) {
            LogUtil.e(TAG, "结果信息为空，无法显示");
            return;
        }

        // 获取截图信息
        Map<String, String> screenshotFiles = resultBean.getScreenshotFiles();

        if (screenshotFiles != null) {
            List<Pair<String, File>> screenshots = new ArrayList<>();
            File screenshotDir = FileUtils.getSubDir("screenshots");

            // 组装各项
            for (Map.Entry<String, String> entry : screenshotFiles.entrySet()) {
                File targetFile = new File(screenshotDir, entry.getValue() + ".png");
                Pair<String, File> target;
                if (targetFile.exists()) {
                    target = new Pair<>(entry.getKey(), targetFile);
                } else {
                    target = new Pair<>(entry.getKey(), null);
                }

                screenshots.add(target);
            }

            this.screenshots = screenshots;
        }
    }

    @Nullable
    @Override
    public View onCreateView(LayoutInflater inflater, @Nullable ViewGroup container, @Nullable Bundle savedInstanceState) {
        return inflater.inflate(R.layout.fragment_replay_result_main, null);
    }

    @Override
    public void onViewCreated(View view, @Nullable Bundle savedInstanceState) {
        super.onViewCreated(view, savedInstanceState);
        recyclerView = (RecyclerView) view.findViewById(R.id.recycler_view_result_main);

        initView();
    }

    /**
     * 初始化界面
     */
    private void initView() {
        recyclerView.setLayoutManager(new LinearLayoutManager(getActivity()));
        recyclerView.setAdapter(new RecyclerView.Adapter<ScreenshotHolder>() {
            @Override
            public ScreenshotHolder onCreateViewHolder(ViewGroup parent, int viewType) {
                View v = LayoutInflater.from(getContext()).inflate(R.layout.item_case_result_screenshot, null);
                return new ScreenshotHolder(v);
            }

            @Override
            public void onBindViewHolder(ScreenshotHolder holder, int position) {
                if (screenshots == null) {
                    return;
                }

                // 加载内容
                Pair<String, File> screenshot = screenshots.get(position);
                holder.loadData(screenshot.first, screenshot.second);
            }

            @Override
            public int getItemCount() {
                return screenshots == null? 0: screenshots.size();
            }
        });
    }

    /**
     * 截图Holder
     */
    private static class ScreenshotHolder extends RecyclerView.ViewHolder implements View.OnClickListener {
        private TextView nameText;
        private TextView locationText;
        private ImageView img;
        private File previousFile;

        public ScreenshotHolder(View itemView) {
            super(itemView);

            nameText = (TextView) itemView.findViewById(R.id.text_case_result_screenshot);
            locationText = (TextView) itemView.findViewById(R.id.text_case_result_screenshot_pos);
            img = (ImageView) itemView.findViewById(R.id.img_case_result_screenshot);
            img.setOnClickListener(this);
        }

        private void loadData(String name, File target) {
            nameText.setText(name);
            if (target != null && target.exists()) {
                if (target == previousFile) {
                    return;
                }
                locationText.setText(target.getAbsolutePath());
                Glide.with(img.getContext())
                        .load(target)
                        .apply(RequestOptions.fitCenterTransform())
                        .into(img);
                previousFile = target;
            } else {
                previousFile = null;
                locationText.setText("");
                img.setImageResource(R.drawable.solopi_main);
            }
        }

        @Override
        public void onClick(View v) {
            if (previousFile != null) {
                DialogUtils.showImageDialog(img.getContext(), previousFile);
            }
        }

        @Override
        public String toString() {
            return super.toString();
        }
    }


}
