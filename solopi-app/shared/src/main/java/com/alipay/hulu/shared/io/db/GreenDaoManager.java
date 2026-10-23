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
package com.alipay.hulu.shared.io.db;

import com.alipay.hulu.common.application.LauncherApplication;

/**
 * Created by lezhou.wyl on 2018/1/30.
 */
public class GreenDaoManager {

    private DaoMaster mDaoMaster;
    private DaoSession mDaoSession;
    //FIXME 实际上不应该将具体的Entity Dao直接放在GreenDaoManager中
    private RecordCaseInfoDao mRecordCaseInfoDao;

    private static final String DB_NAME = "record_cases";

    private GreenDaoManager() {
        mDaoMaster = new DaoMaster(new RecordCaseOpenHelper(LauncherApplication.getInstance(), DB_NAME).getWritableDatabase());
        mDaoSession = mDaoMaster.newSession();
        mRecordCaseInfoDao = mDaoSession.getRecordCaseInfoDao();
    }

    private static class SingletonHolder {
        private static GreenDaoManager _INSTANCE;
        private static synchronized GreenDaoManager INSTANCE() {
            if (_INSTANCE == null) {
                _INSTANCE = new GreenDaoManager();
            }
            return _INSTANCE;
        }
    }

    public static GreenDaoManager getInstance() {
        return SingletonHolder.INSTANCE();
    }

    public RecordCaseInfoDao getRecordCaseInfoDao() {
        return mRecordCaseInfoDao;
    }

}