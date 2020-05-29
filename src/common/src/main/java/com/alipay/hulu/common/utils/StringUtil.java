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

import android.content.Context;
import android.support.annotation.StringRes;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.constant.Constant;
import com.alipay.hulu.common.service.SPService;

import java.lang.Character.UnicodeBlock;
import java.lang.reflect.Array;
import java.util.Arrays;
import java.util.Collection;
import java.util.HashSet;
import java.util.List;
import java.util.Random;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Created by cathor on 2017/12/12.
 */

public class StringUtil {
    private static final String TAG = "StringUtil";

    /**
     * 数字格式
     */
    private static final Pattern NUMBER_PATTERN = Pattern.compile("[-+]?\\d+(\\.\\d+)?");

    /**
     * 整数格式
     */
    private static final Pattern INTEGER_PATTERN = Pattern.compile("[-+]?\\d+");

    /**
     * 字符串是否为空
     * @param origin
     * @return
     */
    public static boolean isEmpty(CharSequence origin) {
        if (origin == null || origin.length() == 0) {
            return true;
        }
        return false;
    }

    /**
     * 是否为数字字符串
     * @param origin
     * @return
     */
    public static boolean isNumeric(CharSequence origin) {
        if (origin == null || origin.length() == 0) {
            return false;
        }

        return NUMBER_PATTERN.matcher(origin).matches();
    }

    /**
     * 是否为数字字符串
     * @param origin
     * @return
     */
    public static boolean isInteger(CharSequence origin) {
        if (origin == null || origin.length() == 0) {
            return false;
        }

        return INTEGER_PATTERN.matcher(origin).matches();
    }

    /**
     * 获取非空字符串
     * @param origin
     * @return
     */
    public static String nonNullString(CharSequence origin) {
        if (origin == null) {
            return "";
        }

        if (origin instanceof String) {
            return (String) origin;
        }

        return origin.toString();
    }

    /**
     * 查找是否包含
     * @param origin
     * @param subString
     * @return
     */
    public static boolean contains(CharSequence origin, CharSequence subString) {
        if (origin == null || origin.length() == 0) {
            return false;
        }
        return origin.toString().contains(subString);
    }

    /**
     * 查找顺序
     * @param origin
     * @param subString
     * @return
     */
    public static int indexOf(CharSequence origin, CharSequence subString) {
        if (isEmpty(origin) || isEmpty(subString)) {
            return -1;
        }

        return origin.toString().indexOf(subString.toString());
    }

    /**
     * 查找顺序
     * @param origin
     * @param subString
     * @return
     */
    public static int indexOf(CharSequence origin, char subString) {
        if (isEmpty(origin)) {
            return -1;
        }

        return origin.toString().indexOf(subString);
    }

    /**
     * 拆分字符串
     * @param origin
     * @param subString
     * @return
     */
    public static String[] split(CharSequence origin, CharSequence subString) {
        return split(origin, subString, 0);
    }

    /**
     * 拆分字符串
     * @param origin
     * @param subString
     * @param maxCount 最大拆分次数
     * @return
     */
    public static String[] split(CharSequence origin, CharSequence subString, int maxCount) {
        if (isEmpty(origin) || isEmpty(subString)) {
            return null;
        }

        return origin.toString().split(subString.toString(), maxCount);
    }

    /**
     * 强制toString
     * @param item
     * @return
     */
    public static String toString(Object item) {
        if (item == null) {
            return null;
        }

        if (item.getClass().isArray()) {
            return Arrays.toString((Object[]) item);
        }

        if (item instanceof String) {
            return (String) item;
        }

        return item.toString();
    }

    /**
     * 去除前后不可见符号
     * @param origin
     * @return
     */
    public static String trim(CharSequence origin) {
        return origin == null? null: origin.toString().trim();
    }

    /**
     * 判断origin是否以sub开始
     * @param origin 目标字段
     * @param sub 查找字段
     * @return
     */
    public static boolean startWith(CharSequence origin, CharSequence sub) {
        if (isEmpty(origin) || isEmpty(sub) || origin.length() < sub.length()) {
            return false;
        }

        /**
         * 比较前n个字符
         */
        for (int i = 0; i < sub.length(); i++) {
            if (origin.charAt(i) != sub.charAt(i)) {
                return false;
            }
        }

        return true;
    }

    /**
     * 比较字符串是否相等
     * @param a
     * @param b
     * @return
     */
    public static boolean equals(CharSequence a, CharSequence b) {
        // 两者都为空，相等
        if (a == null && b == null) {
            return true;
        }

        // 一个为空，不等
        if (a == null || b == null) {
            return false;
        }

        // 都不为空，直接比较
        return a.toString().equals(b.toString());
    }

    /**
     * 比较字符串是否相等
     * @param a
     * @param b
     * @return
     */
    public static boolean equalsOrMatch(CharSequence a, CharSequence b) {
        // 两者都为空，相等
        if (a == null && b == null) {
            return true;
        }

        if (a != null && a.equals("*")) {
            return true;
        }

        // 一个为空，不等
        if (a == null || b == null) {
            return false;
        }

        // 都不为空，直接比较
        return a.toString().equals(b.toString());
    }

    /**
     * 比较字符串是否相等，忽略大小写
     * @param a
     * @param b
     * @return
     */
    public static boolean equalsIgnoreCase(CharSequence a, CharSequence b) {
        // 两者都为空，相等
        if (a == null && b == null) {
            return true;
        }

        // 一个为空，不等
        if (a == null || b == null) {
            return false;
        }

        // 都不为空，直接比较
        return a.toString().equalsIgnoreCase(b.toString());
    }

    /**
     * 获取定义常量
     * @param res
     * @return
     */
    public static String getString(@StringRes int res) {
        return getString(LauncherApplication.getContext(), res);
    }

    /**
     * 获取特定Context定义常量
     * @param res
     * @return
     */
    public static String getString(Context context, @StringRes int res) {
        if (context == null) {
            return null;
        }

        return context.getString(res);
    }

    /**
     * 获取Format过的字符串
     * @param res
     * @return
     */
    public static String getString(@StringRes int res, Object... args) {
        return getString(LauncherApplication.getContext(), res, args);
    }

    /**
     * 获取Format过的字符串
     * @param context
     * @param res
     * @param args
     * @return
     */
    public static String getString(Context context, @StringRes int res, Object... args) {
        if (context == null) {
            return null;
        }

        return context.getString(res, args);
    }

    /**
     * 连接字符串
     * @param joiner
     * @param contents
     * @return
     */
    public static String join(CharSequence joiner, List<String> contents) {
        if (contents == null || contents.size() == 0) {
            return "";
        }

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < contents.size() - 1; i++) {
            sb.append(contents.get(i)).append(joiner);
        }
        return sb.append(contents.get(contents.size() - 1)).toString();
    }

    /**
     * 连接字符串
     * @param joiner
     * @param contents
     * @return
     */
    public static String join(CharSequence joiner, CharSequence... contents) {
        if (contents == null || contents.length == 0) {
            return "";
        }

        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < contents.length - 1; i++) {
            sb.append(contents[i]).append(joiner);
        }
        return sb.append(contents[contents.length - 1]).toString();
    }

    /**
     * 比较字符串是否相等或者左侧为空
     * @param a
     * @param b
     * @return
     */
    public static boolean equalsOrLeftBlank(CharSequence a, CharSequence b) {
        // 两者都为空，相等
        if (a == null) {
            return true;
        }

        // 都不为空，直接比较
        return toString(a).equals(toString(b));
    }

    /**
     * 正则替换
     * @param origin
     * @param reg
     * @param to
     * @return
     */
    public static String patternReplace(CharSequence origin, CharSequence reg, CharSequence to) {
        if (origin == null) {
            return null;
        }

        if (reg == null) {
            return origin.toString();
        }

        if (to == null) {
            return origin.toString().replaceAll(reg.toString(), "null");
        } else {
            return origin.toString().replaceAll(reg.toString(), to.toString());
        }
    }

    /**
     * 正则替换
     * @param origin 原始字段
     * @param pattern 正则模板
     * @param replace 替换方法
     * @return
     */
    public static String patternReplace(CharSequence origin, Pattern pattern, PatternReplace replace) {
        if (origin == null || replace == null || pattern == null) {
            return null;
        }

        // 正则匹配下
        Matcher matcher = pattern.matcher(origin);
        StringBuilder sb = new StringBuilder();

        int currentIdx = 0;
        // 替换所有匹配到的字段
        while (matcher.find()) {
            // 添加之前的字段
            int start = matcher.start();
            sb.append(origin.subSequence(currentIdx, start));

            // 替换match字段
            String content = replace.replacePattern(matcher.group());
            sb.append(content);

            // 重置偏移量
            currentIdx = start + matcher.group().length();
        }

        // 如果还有其他字段
        if (currentIdx < origin.length()) {
            sb.append(origin.subSequence(currentIdx, origin.length()));
        }

        return sb.toString();
    }

    /**
     * 字符替换接口
     */
    public interface PatternReplace {
        String replacePattern(String origin);
    }

    /**
     * 生成长度为<tt>length</tt>的随机字符串
     * @param length 生成长度
     * @return 随机字符串
     */
    public static String generateRandomString(int length) {
        if (length <= 0) {
            return "";
        }

        StringBuilder builder = new StringBuilder(length);

        // UUID填充
        int currentSize = 0;
        while (currentSize < length) {
            UUID uuid = UUID.randomUUID();
            String tmp = uuid.toString().replace("-", "");
            if (tmp.length() <= length - currentSize) {
                builder.append(tmp);
                currentSize += tmp.length();
            } else {
                builder.append(tmp, 0, length - currentSize);
                currentSize = length;
            }
        }

        return builder.toString();
    }

    /**
     * 计数字符串中数字个数
     * @param origin
     * @return
     */
    public static int numberCount(String origin) {
        if (isEmpty(origin)) {
            return 0;
        }

        int count = 0;
        for(int i = 0; i < origin.length(); i++){
            char checkChar = origin.charAt(i);
            if(checkChar >= '0' && checkChar <= '9'){
                count++;
            }
        }

        return count;
    }


    /**
     * 判断是否包含中文
     * @param checkStr
     * @return
     */
    public static boolean containsChinese(CharSequence checkStr){
        if(!isEmpty(checkStr)){
            String checkChars = checkStr.toString();
            for(int i = 0; i < checkChars.length(); i++){
                char checkChar = checkChars.charAt(i);
                if(checkCharContainChinese(checkChar)){
                    return true;
                }
            }
        }
        return false;
    }

    private static boolean checkCharContainChinese(char checkChar){
        UnicodeBlock ub = UnicodeBlock.of(checkChar);
        if(UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS == ub ||
                UnicodeBlock.CJK_COMPATIBILITY_IDEOGRAPHS == ub ||
                UnicodeBlock.CJK_COMPATIBILITY_FORMS == ub ||
                UnicodeBlock.CJK_RADICALS_SUPPLEMENT == ub ||
                UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS_EXTENSION_A == ub ||
                UnicodeBlock.CJK_UNIFIED_IDEOGRAPHS_EXTENSION_B == ub){
            return true;
        }
        return false;
    }

    private static final HashSet<Character> REGEX_SPECIAL_CHARS = new HashSet<>(Arrays.asList('\\', '$', '(', ')', '*', '+', '.', '[', ']', '?', '^', '{', '}', '|'));

    /**
     * 处理正则特殊字符
     * @param origin
     * @return
     */
    public static String escapeRegex(String origin) {
        if (isEmpty(origin)) {
            return "";
        }

        StringBuilder sb = new StringBuilder(origin.length());
        char[] charArray = origin.toCharArray();
        for (char item: charArray) {
            if (REGEX_SPECIAL_CHARS.contains(item)) {
                sb.append("\\").append(item);
            } else {
                sb.append(item);
            }
        }

        return sb.toString();
    }

    /**
     * 隐藏信息
     * @param content
     * @return
     */
    public static String hide(Object content) {
        if (SPService.getBoolean(SPService.KEY_HIDE_LOG, true)) {
            return hash(content);
        }

        return toString(content);
    }

    /**
     * 取hash
     * @param content
     * @return
     */
    public static String hash(Object content) {
        if (content == null) {
            return "FFFFFFFF##-1";
        } else {
            int length;
            if (content instanceof Collection) {
                length = ((Collection) content).size();
            } else if (content.getClass().isArray()) {
                length = Array.getLength(content);
            } else {
                String strVal = toString(content);
                length = strVal == null? 0: strVal.length();
            }

            return content.getClass().getSimpleName() + '@' + Integer.toHexString(content.hashCode()) + "##" + length;
        }
    }
}
