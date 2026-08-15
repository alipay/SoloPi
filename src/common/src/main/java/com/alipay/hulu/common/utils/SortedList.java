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
package com.alipay.hulu.common.utils;

import androidx.annotation.NonNull;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Iterator;

/**
 * Created by qiaoruikai on 2019/11/8 11:46 PM.
 */
public class SortedList<T> implements Iterable<T> {
    private ArrayList<SortedItem<T>> items;
    private boolean reverse = false;

    public SortedList() {
        items = new ArrayList<>();
    }

    public SortedList(int capability) {
        items = new ArrayList<>(capability);
    }

    public SortedList(boolean reverse) {
        items = new ArrayList<>();
        this.reverse = reverse;
    }

    public SortedList(int capability, boolean reverse) {
        items = new ArrayList<>(capability);
        this.reverse = reverse;
    }

    public boolean add(T item, int priority) {
        if (item == null) {
            return false;
        }
        boolean result = items.add(new SortedItem<T>(item, priority));
        if (reverse) {
            Collections.sort(items, Collections.reverseOrder());
        } else {
            Collections.sort(items);
        }
        return result;
    }

    public T getTop() {
        if (items.size() > 0) {
            return items.get(0).getItem();
        }

        return null;
    }

    public T get(int position) {
        if (position < 0 || position > items.size()) {
            return null;
        }

        return items.get(position).getItem();
    }

    public int size() {
        return items.size();
    }

    @NonNull
    @Override
    public Iterator<T> iterator() {
        return new MyIterator<>(this);
    }

    public static class MyIterator<T> implements Iterator<T> {
        private SortedList<T> list;
        private int position;
        MyIterator(SortedList<T> list) {
            this.list = list;
            position = 0;
        }
        @Override
        public boolean hasNext() {
            return position < list.size();
        }

        @Override
        public T next() {
            return list.get(position++);
        }

        @Override
        public void remove() {
            list.items.remove(--position);
        }
    }
}
