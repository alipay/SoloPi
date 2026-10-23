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
package com.alipay.hulu.util;

import com.alipay.hulu.bean.ReplayResultBean;

import java.util.ArrayList;
import java.util.List;

/**
 * Created by lezhou.wyl on 2018/8/19.
 */
public class LargeObjectHolder {

    private List<ReplayResultBean> mReplayResults;

    private LargeObjectHolder() {
        mReplayResults = new ArrayList<>();
    }

    private static final LargeObjectHolder sInstance = new LargeObjectHolder();

    public static LargeObjectHolder getInstance() {
        return sInstance;
    }

    public List<ReplayResultBean> getReplayResults() {
        return mReplayResults;
    }

    public void setReplayResults(List<ReplayResultBean> replayResults) {
        mReplayResults = replayResults;
    }
}
