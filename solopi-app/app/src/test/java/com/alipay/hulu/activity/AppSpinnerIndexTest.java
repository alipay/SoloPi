/*
 * Copyright (C) 2015-present, Ant Financial Services Group
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
package com.alipay.hulu.activity;

import org.junit.Test;
import static org.junit.Assert.*;

public class AppSpinnerIndexTest {
    @Test public void outOfRangeDropdownDoesNotIndexPastLastApp() {
        assertEquals(-1, AppSpinnerIndex.appIndex(111, 110));
        assertEquals(111, AppSpinnerIndex.count(110));
    }

    @Test public void firstAndLastAppsStayBoundAndGlobalStaysSentinel() {
        assertEquals(0, AppSpinnerIndex.appIndex(1, 110));
        assertEquals(109, AppSpinnerIndex.appIndex(110, 110));
        assertEquals(-1, AppSpinnerIndex.appIndex(0, 110));
    }

    @Test public void emptyListAndOneAppShrinkStayOffTheList() {
        assertEquals(1, AppSpinnerIndex.count(0));
        assertEquals(-1, AppSpinnerIndex.appIndex(0, 0));
        assertEquals(-1, AppSpinnerIndex.appIndex(1, 0));
        assertEquals(-1, AppSpinnerIndex.appIndex(111, 110));
    }

    @Test public void negativeAndFarPositionsStayOffTheList() {
        assertEquals(-1, AppSpinnerIndex.appIndex(-1, 110));
        assertEquals(-1, AppSpinnerIndex.appIndex(112, 110));
    }
}
