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
package com.alipay.hulu.activity;

/**
 * count(appCount) returns appCount + 1, and appIndex(position, appCount) returns
 * position - 1 only for positions 1..appCount and returns -1 for position 0 and
 * for every position outside that range, including appCount + 1.
 */
class AppSpinnerIndex {
    static int count(int appCount) {
        return appCount + 1;
    }

    static int appIndex(int position, int appCount) {
        if (position >= 1 && position <= appCount) {
            return position - 1;
        }
        return -1;
    }
}
