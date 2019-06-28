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
package com.alipay.hulu.shared.node.utils;

import android.widget.Toast;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.action.Constant;
import com.alipay.hulu.shared.node.action.OperationExecutor;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;

import java.util.List;

public class NodeTreeUtil {
    private static final String TAG = "NodeTreeUtil";
    private static final String ASSERT = "assert";

    /**
     * 查找当前节点在父节点中的顺序
     *
     * @param currentNode
     * @return
     */
    public static Integer findIndexInParent(AbstractNodeTree currentNode) {
        AbstractNodeTree parentNode = currentNode.getParent();
        // 父节点为空，说明是根节点，顺序不存在
        if (parentNode == null) {
            return null;
        }


        // 根据ClassName查找顺序
        CharSequence className = currentNode.getClassName();
        if (className == null) {
            return null;
        }

        // 当父节点只有一个子节点，顺序不需要
        if (parentNode.getChildrenNodes().size() == 1) {
            return null;
        }

        // 一直找到当前节点
        int count = 1;
        int idx = 1;
        List<AbstractNodeTree> childrenNodes = parentNode.getChildrenNodes();

        if (childrenNodes != null) {
            for (int i = 0; i < childrenNodes.size(); i++) {
                if (childrenNodes.get(i).equals(currentNode)) {
                    idx = count;
                }
                if (StringUtil.equals(className, childrenNodes.get(i).getClassName())) {
                    count++;
                }
            }
        }

        // 可能存在多个子元素，但是只有一个目标标签
        if (count == 1) {
            return null;
        }

        return idx;
    }

    /**
     * 断言操作
     * @param node
     * @param method
     */
    public static boolean performAssertAction(AbstractNodeTree node, OperationMethod method) {
        StringBuilder matchTxtBuilder = new StringBuilder(); // 待匹配的字符串
        for (AbstractNodeTree item : node) {
            if (!StringUtil.isEmpty(item.getText())) {
                matchTxtBuilder.append(item.getText());
            }
        }

        String matchTxt = matchTxtBuilder.toString();
        method.putParam(OperationExecutor.ASSERT_CONTENT, matchTxt);
        String mode = method.getParam(OperationExecutor.ASSERT_MODE);
        String inputContent = method.getParam(OperationExecutor.ASSERT_INPUT_CONTENT);

        LogUtil.i(TAG, "current node text: %s, assert mode: %s, target text: %s",
                matchTxt, mode, inputContent);

        String content = "";

        if (Constant.ASSERT_ACCURATE.equals(mode)) {
            if (matchTxt.equals(inputContent)) {
                LogUtil.w(ASSERT, "success");
                content = "断言成功";
            } else {
                LogUtil.e(ASSERT, "fail");
                content = "断言失败";
            }
        } else if (Constant.ASSERT_CONTAIN.equals(mode)) {
            if (matchTxt.contains(inputContent)) {
                LogUtil.w(ASSERT, "success");
                content = "断言成功";
            } else {
                LogUtil.e(ASSERT, "fail");
                content = "断言失败";
            }
        } else if (Constant.ASSERT_REGULAR.equals(mode)) {
            if (matchTxt.matches(inputContent)) {
                LogUtil.w(ASSERT, "success");
                content = "断言成功";
            } else {
                LogUtil.e(ASSERT, "fail");
                content = "断言失败";
            }
        } else if (Constant.ASSERT_DAYU.equals(mode)) {
            try {
                float curValue = Float.valueOf(matchTxt);
                float inputValue = Float.valueOf(inputContent);
                if (curValue > inputValue) {
                    LogUtil.w(ASSERT, "success");
                    content = "断言成功";
                } else {
                    LogUtil.e(ASSERT, "fail");
                    content = "断言失败";
                }
            } catch (Exception e) {
                LogUtil.e(ASSERT, "number format exception");
            }
        } else if (Constant.ASSERT_DAYUANDEQUAL.equals(mode)) {
            try {
                float curValue = Float.valueOf(matchTxt);
                float inputValue = Float.valueOf(inputContent);
                if (curValue >= inputValue) {
                    LogUtil.w(ASSERT, "success");
                    content = "断言成功";
                } else {
                    LogUtil.e(ASSERT, "fail");
                    content = "断言失败";
                }
            } catch (Exception e) {
                LogUtil.e(ASSERT, "number format exception");
            }
        } else if (Constant.ASSERT_EQUAL.equals(mode)) {
            try {
                float curValue = Float.valueOf(matchTxt);
                float inputValue = Float.valueOf(inputContent);
                if (Math.abs(curValue - inputValue) <= 0.001) {
                    LogUtil.w(ASSERT, "success");
                    content = "断言成功";
                } else {
                    LogUtil.e(ASSERT, "fail");
                    content = "断言失败";
                }
            } catch (Exception e) {
                LogUtil.e(ASSERT, "number format exception");
            }
        } else if (Constant.ASSERT_XIAOYU.equals(mode)) {
            try {
                float curValue = Float.valueOf(matchTxt);
                float inputValue = Float.valueOf(inputContent);
                if (curValue < inputValue) {
                    LogUtil.w(ASSERT, "success");
                    content = "断言成功";
                } else {
                    LogUtil.e(ASSERT, "fail");
                    content = "断言失败";
                }
            } catch (Exception e) {
                LogUtil.e(ASSERT, "number format exception");
            }
        } else if (Constant.ASSERT_XIAOYUANDEQUAL.equals(mode)) {
            try {
                float curValue = Float.valueOf(matchTxt);
                float inputValue = Float.valueOf(inputContent);
                if (curValue <= inputValue) {
                    LogUtil.w(ASSERT, "success");
                    content = "断言成功";
                } else {
                    LogUtil.e(ASSERT, "fail");
                    content = "断言失败";
                }
            } catch (Exception e) {
                LogUtil.e(ASSERT, "number format exception");
            }
        }

        // 如果有需要Toast的信息，在主线程上进行toast
        if (!StringUtil.isEmpty(content)) {
            final String toToast = content;
            LauncherApplication.getInstance().runOnUiThread(new Runnable() {
                @Override
                public void run() {
                    Toast.makeText(LauncherApplication.getInstance(), toToast, Toast.LENGTH_SHORT).show();
                }
            });
        }

        return StringUtil.equals(content, "断言成功");
    }
}
