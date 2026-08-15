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
package com.alipay.hulu.common.bean;

/**
 * 持续动作
 * Created by qiaoruikai on 2019/11/26 9:52 PM.
 */
public class ContinueGesture {
    /**
     * 目标X
     */
    private int x;
    /**
     * 目标Y
     */
    private int y;
    /**
     * 耗时
     */
    private int time;
    /**
     * 下一个动作
     */
    private ContinueGesture next;

    public ContinueGesture(int x, int y) {
        this.x = x;
        this.y = y;
    }

    private ContinueGesture(int x, int y, int time) {
        this.x = x;
        this.y = y;
        this.time = time;
    }

    /**
     * 持续性动作
     * @param x
     * @param y
     * @param time
     * @return
     */
    public ContinueGesture moveTo(int x, int y, int time) {
        ContinueGesture cur = this;
        while (cur.next != null) {
            cur = cur.next;
        }

        cur.next = new ContinueGesture(x, y, time);
        return this;
    }

    public int totalTime() {
        int total = 0;
        ContinueGesture cur = this;
        while (cur.next != null) {
            cur = cur.next;
            total += cur.time;
        }
        return total;
    }

    public int getX() {
        return x;
    }

    public void setX(int x) {
        this.x = x;
    }

    public int getY() {
        return y;
    }

    public void setY(int y) {
        this.y = y;
    }

    public int getTime() {
        return time;
    }

    public void setTime(int time) {
        this.time = time;
    }

    public ContinueGesture getNext() {
        return next;
    }

    public void setNext(ContinueGesture next) {
        this.next = next;
    }
}
