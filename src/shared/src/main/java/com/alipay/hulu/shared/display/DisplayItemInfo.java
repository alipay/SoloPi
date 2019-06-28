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
package com.alipay.hulu.shared.display;

import com.alipay.hulu.shared.R;
import com.alipay.hulu.shared.display.items.base.DisplayItem;
import com.alipay.hulu.shared.display.items.base.Displayable;

import java.util.Arrays;
import java.util.List;

/**
 * 显示信息
 * Created by qiaoruikai on 2018/10/15 2:30 PM.
 */
public class DisplayItemInfo {
    /**
     * 名称
     */
    private final String name;

    /**
     * 依赖权限
     */
    private final List<String> permissions;

    /**
     * 提示文案
     */
    private final String tip;

    /**
     * 图标
     */
    private final int icon;

    /**
     * level信息
     */
    protected final int level;

    /**
     * 触发文案
     */
    private final String trigger;

    /**
     * 目标类
     */
    private final Class<? extends Displayable> targetClass;

    public DisplayItemInfo(DisplayItem displayItem, Class<? extends Displayable> targetClass) {
        this.targetClass = targetClass;
        this.name = displayItem.name();
        this.permissions = Arrays.asList(displayItem.permissions());
        this.tip = displayItem.tip();
        if (displayItem.icon() != 0) {
            this.icon = displayItem.icon();
        } else {
            this.icon = R.drawable.performance_icon;
        }
        this.level = displayItem.level();
        this.trigger = displayItem.trigger();
    }

    public String getName() {
        return name;
    }

    public List<String> getPermissions() {
        return permissions;
    }

    public String getTip() {
        return tip;
    }

    public int getIcon() {
        return icon;
    }

    public String getTrigger() {
        return trigger;
    }

    public Class<? extends Displayable> getTargetClass() {
        return targetClass;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (o == null || getClass() != o.getClass()) return false;

        DisplayItemInfo info = (DisplayItemInfo) o;

        if (!name.equals(info.name)) return false;
        return targetClass.equals(info.targetClass);
    }

    @Override
    public int hashCode() {
        int result = name.hashCode();
        result = 31 * result + targetClass.hashCode();
        return result;
    }

    @Override
    public String toString() {
        return "DisplayItemInfo{" +
                "name='" + name + '\'' +
                ", permissions=" + permissions +
                ", tip='" + tip + '\'' +
                ", icon=" + icon +
                ", level=" + level +
                ", trigger='" + trigger + '\'' +
                ", targetClass=" + targetClass +
                '}';
    }
}
