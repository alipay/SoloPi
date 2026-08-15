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
package com.alipay.hulu.shared.display.items.base;

import java.util.Arrays;

/**
 * 定长循环列表
 * @param <T> 包装类
 */
public class FixedLengthCircularArray<T> {
    /**
     * 实际存储结构
     */
    private Object[] mItems;

    /**
     * 当前对象位置
     */
    private int mCurrentPos;

    /**
     * 现有对象数
     */
    private int mCurrentSize;

    /**
     * 整体大小
     */
    private int mTotalSize;

    public FixedLengthCircularArray(int initialSize) {
        mItems = new Object[initialSize];
        mCurrentPos = -1;
        mTotalSize = initialSize;
        mCurrentSize = 0;
    }

    /**
     * 向队列添加对象，会自动挤掉最前的对象
     * @param item
     */
    public void addItem(T item) {
        // 从后往前添加，避免最后取出来时顺序颠倒
        mCurrentPos = (mCurrentPos + 1) % mTotalSize;
        mItems[mCurrentPos] = item;
        if (mCurrentSize < mTotalSize) {
            mCurrentSize ++;
        }
    }

    /**
     * 将队列结果按插入顺序输出
     * @return
     */
    public T[] getAllItems(T[] list) {
        T[] output = Arrays.copyOf(list, mCurrentSize);
        int length = Math.min(mCurrentPos + 1, mCurrentSize);
        // mCurrentPos指向当前节点，从当前节点向后移动
        System.arraycopy(mItems, 0, output, mCurrentSize - length, length);

        int leftLength = mCurrentSize - length;

        if (leftLength > 0) {
            System.arraycopy(mItems, mTotalSize - leftLength, output, 0, leftLength);
        }

        return output;
    }

    /**
     * 重设队列大小
     * @param newSize
     */
    public void resize(int newSize) {
        Object[] newItems = new Object[newSize];
        int length = Math.min(mCurrentPos + 1, newSize);
        // 实际会占用的长度
        int realSize = Math.min(mCurrentSize, newSize);
        // mCurrentPos指向当前节点，从当前节点向后移动
        System.arraycopy(mItems, 0, newItems, realSize - length, length);

        int leftLength = realSize - length;

        if (leftLength > 0) {
            System.arraycopy(mItems, mTotalSize - leftLength, newItems, 0, leftLength);
        }

        // 重设相关信息
        mItems = newItems;
        mCurrentPos = 0;
        mTotalSize = newSize;
    }

    public int size() {
        return mCurrentSize;
    }

    public boolean isEmpty() {
        return mCurrentSize == 0;
    }

    public boolean contains(Object o) {
        int mLoadPos = mCurrentPos;
        for (int i = 0; i < mCurrentSize; i++) {
            if (mItems[mLoadPos] != null && mItems[mLoadPos].equals(o)) {
                return true;
            }

            mLoadPos = mLoadPos > 1? mLoadPos - 1: mTotalSize - 1;
        }
        return false;
    }

    public void clear() {
        mItems = new Object[mTotalSize];
        mCurrentPos = -1;
        mCurrentSize = 0;
    }

    @SuppressWarnings("unchecked")
    public T get(int position) {
        if (position >= mCurrentSize) {
            throw new IndexOutOfBoundsException("Index " + position + " out of bounds, max=" + (mCurrentSize - 1));
        }

        int reversePos = mCurrentSize - position - 1;
        int realPos = mCurrentPos < reversePos? mTotalSize - (reversePos - mCurrentPos): mCurrentPos - reversePos;
        return (T) mItems[realPos];
    }
}
