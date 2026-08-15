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
package com.alipay.hulu.shared.node.locater;

import com.alipay.hulu.common.service.SPService;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.locater.comparator.ItemComparator;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;
import com.alipay.hulu.shared.node.tree.FakeNodeTree;
import com.alipay.hulu.shared.node.tree.accessibility.tree.AccessibilityNodeTree;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.HashMap;
import java.util.List;
import java.util.Map;


/**
 * Created by cathor on 2017/12/12.
 */

public class XpathLocator {
    private static final String TAG = "XpathLocator";

    /**
     * 根据Xpath查找对应节点
     *
     * @param xpath xpath字符串
     * @param root  根节点
     * @return 查询结果
     */
    public static List<AbstractNodeTree> findNodeByXpath(String xpath, AbstractNodeTree root) {

        // 从xpath字符串构建Xpath链表
        SimpleXpathItem currentItem = buildSimpleXpathLink(xpath);

        LogUtil.d(TAG, "Find Xpath " + currentItem);

        // 创建fake节点
        List<AbstractNodeTree> findResult;
        if (!(root instanceof FakeNodeTree)) {
            AbstractNodeTree fakeNode = new AccessibilityNodeTree(null, null);
            fakeNode.setChildrenNodes(Arrays.asList(root));
            findResult= Arrays.asList(fakeNode);
        } else {
            findResult = Arrays.asList(root);
        }

        // 当xpath还未解析完毕，且当前查询结果非空
        while (currentItem != null && findResult.size() > 0) {
            List<AbstractNodeTree> currentFindResult = new ArrayList<>();
            for (AbstractNodeTree nodeTree : findResult) {
                List<AbstractNodeTree> tmpResult = new ArrayList<>();
                // 查找查询结果的子节点
                if (findNodeWithRule(nodeTree.getChildrenNodes(), currentItem.isDirectToParent(), currentItem.getItemType(), currentItem.getItemIndex(), currentItem.getFilter(), tmpResult)) {
                    currentFindResult.addAll(tmpResult);
                }
            }
            findResult = sortNodeLists(currentFindResult);
            currentItem = currentItem.childNode;
        }

        if (findResult.size() == 0) {
            LogUtil.w(TAG, "Cant't find Object for part before " + currentItem);
        }

        return findResult;
    }

    /**
     * 在当前子节点列表中查找匹配规则对象
     * @param items 子节点列表
     * @param isDirectToParent 是否只查询直接子节点
     * @param itemType 查询对象类型
     * @param itemIdx 查询对象顺序
     * @param findResult 存储查询结果
     * @return 是否查询到
     */
    private static boolean findNodeWithRule(List<AbstractNodeTree> items, boolean isDirectToParent, final String itemType, int itemIdx, final Map<String, String> filter, List<AbstractNodeTree> findResult) {

        if (items == null || items.size() == 0) {
            return false;
        }

        // 直接在父节点下，只查找子节点内容
        if (isDirectToParent) {
            // 对于有过滤条件的，只考虑过滤情况
            if (filter != null && filter.size() > 0) {
                ItemComparator<AbstractNodeTree> comparator = new ItemComparator<AbstractNodeTree>() {
                    @Override
                    public boolean isEqual(AbstractNodeTree item) {
                        boolean flag = StringUtil.equals(item.getClassName(), itemType);
                        if (!flag) {
                            return false;
                        }

                        for (String key: filter.keySet()) {
                            flag = StringUtil.equals(StringUtil.toString(item.getField(key)), filter.get(key));

                            if (!flag) {
                                break;
                            }
                        }
                        return flag;
                    }
                };

                // ID只用找一个
                for (AbstractNodeTree node: items) {
                    if (comparator.isEqual(node)) {
                        findResult.add(node);
                        return true;
                    }
                }

                return false;
            }

            // 当idx为0，查找所有子节点
            if (itemIdx == 0) {
                int findCount = 0;
                for (AbstractNodeTree node : items) {
                    if (node != null && StringUtil.equals(node.getClassName(), itemType)) {
                        findResult.add(node);
                        findCount++;
                    }
                }

                return findCount > 0;
            }

            // 当idx > 0，只查找第idx位
            int tmpIdx = 0;
            int i;
            for (i = 0; tmpIdx < items.size() && i < itemIdx; i++) {
                while (!StringUtil.equals(items.get(tmpIdx++).getClassName(), itemType)) {
                    if (tmpIdx >= items.size()) {
                        return false;
                    }
                }
            }

            // 未找到就结束，说明查找失败
            if (i < itemIdx) {
                return false;
            }

            findResult.add(items.get(tmpIdx - 1));
            return true;
        } else {

            // 对于有过滤条件的，只考虑过滤情况
            if (filter != null && filter.size() > 0) {
                ItemComparator<AbstractNodeTree> comparator = new ItemComparator<AbstractNodeTree>() {
                    @Override
                    public boolean isEqual(AbstractNodeTree item) {
                        boolean flag = StringUtil.equals(item.getClassName(), itemType);
                        if (!flag) {
                            return false;
                        }

                        for (String key: filter.keySet()) {
                            flag = StringUtil.equals(StringUtil.toString(item.getField(key)), filter.get(key));

                            if (!flag) {
                                break;
                            }
                        }
                        return flag;
                    }
                };

                // 对于指定itemIdx的节点，只查找第itemIdx个节点
                for (AbstractNodeTree root : items) {
                    if (comparator.isEqual(root)) {
                        // 查找到后会停止查找
                        findResult.add(root);
                        return true;
                    } else {
                        // 查找子节点结果
                        boolean result = findNodeWithRule(root.getChildrenNodes(), false, itemType, itemIdx, filter, findResult);
                        if (result) {
                            return true;
                        }
                    }
                }

                return false;
            }

            // 非直接子节点，需要遍历所有子节点查找
            if (itemIdx > 0) {

                // 对于指定itemIdx的节点，只查找第itemIdx个节点
                for (AbstractNodeTree root : items) {
                    if (StringUtil.equals(root.getClassName(), itemType)) {
                        // 查找到后会停止查找
                        if (itemIdx == 1 && !findResult.contains(root)) {
                            findResult.add(root);
                            return true;
                        } else {
                            // 直到itemIdx == 1才会查找结束
                            itemIdx -= 1;
                        }

                        // 查找子节点结果
                        boolean result = findNodeWithRule(root.getChildrenNodes(), false, itemType, itemIdx, filter, findResult);
                        if (result) {
                            return true;
                        }
                    }
                }
                return false;
            } else {
                // 没有顺序过滤，查找子节点中所有匹配结果
                boolean result = false;
                for (AbstractNodeTree root : items) {
                    if (StringUtil.equals(root.getClassName(), itemType)) {
                        if (!findResult.contains(root)) {
                            findResult.add(root);
                            result = true;
                        }
                    }
                    result |= findNodeWithRule(root.getChildrenNodes(), false, itemType, itemIdx, filter, findResult);
                }
                return result;
            }
        }
    }

    /**
     * 构建简单Xpath树
     *
     * @param xpath
     */
    private static SimpleXpathItem buildSimpleXpathLink(String xpath) {
        if (StringUtil.isEmpty(xpath)) {
            return null;
        }

        SimpleXpathItem current = new SimpleXpathItem();
        SimpleXpathItem root = current;

        String[] split = xpath.replace("//", "/#").replace("]", "").split("/");

        for (String part: split) {
            if (part.length() == 0) {
                continue;
            }

            current.childNode = new SimpleXpathItem();
            current = current.childNode;

            String[] tagAndConfig = part.split("\\[");
            int startIdx = (part.startsWith("#")) ? 1 : 0;
            current.directToParent = startIdx == 0;
            current.itemType = tagAndConfig[0].substring(startIdx);

            // 不包含限制条件的情景
            if (tagAndConfig.length == 1) {
                current.filter = null;
                current.itemIndex = 0;
            } else {
                // [@id="xxx"]
                if (StringUtil.startWith(tagAndConfig[1], "@")) {
                    String[] kv = tagAndConfig[1].split("=");
                    Map<String, String> filter = new HashMap<>(2);
                    filter.put(kv[0].substring(1), kv[1].substring(1, kv[1].length() - 1));
                    current.filter = filter;
                    current.itemIndex = 0;
                // [12]
                } else {
                    current.itemIndex = Integer.parseInt(tagAndConfig[1]);
                }
            }
        }

        return root.childNode;
    }

    /**
     * 去重并排序查找结果
     * @param nodeList
     * @return
     */
    private static List<AbstractNodeTree>  sortNodeLists(List<AbstractNodeTree> nodeList) {
        List<AbstractNodeTree> resultList = new ArrayList<>();
        for (AbstractNodeTree nodeTree: nodeList) {
            if (!resultList.contains(nodeTree)) {
                resultList.add(nodeTree);
            }
        }

        AbstractNodeTree[] nodeTrees = new AbstractNodeTree[resultList.size()];
        nodeList.toArray(nodeTrees);
        Arrays.sort(nodeTrees, new Comparator<AbstractNodeTree>() {
            @Override
            public int compare(AbstractNodeTree lhs, AbstractNodeTree rhs) {
                int lidx = lhs.getIndex();
                int ridx = rhs.getIndex();
                return lidx < ridx ? -1 : (lidx == ridx ? 0 : 1);
            }
        });
        return Arrays.asList(nodeTrees);
    }

    /**
     * 简易Xpath树对象，仅支持类型与顺序
     */
    private static class SimpleXpathItem {
        // 对象类型
        String itemType;

        // 对象顺序
        int itemIndex;

        // 是否是直接子节点
        boolean directToParent;

        SimpleXpathItem childNode;

        Map<String, String> filter;

        /**
         * Getter method for property <tt>itemType</tt>.
         *
         * @return property value of itemType
         */
        public String getItemType() {
            return itemType;
        }

        /**
         * Setter method for property <tt>itemType</tt>.
         *
         * @param itemType value to be assigned to property itemType
         */
        public void setItemType(String itemType) {
            this.itemType = itemType;
        }

        /**
         * Getter method for property <tt>itemIndex</tt>.
         *
         * @return property value of itemIndex
         */
        public int getItemIndex() {
            return itemIndex;
        }

        /**
         * Setter method for property <tt>itemIndex</tt>.
         *
         * @param itemIndex value to be assigned to property itemIndex
         */
        public void setItemIndex(int itemIndex) {
            this.itemIndex = itemIndex;
        }

        /**
         * Getter method for property <tt>directToParent</tt>.
         *
         * @return property value of directToParent
         */
        public boolean isDirectToParent() {
            return directToParent;
        }

        /**
         * Setter method for property <tt>directToParent</tt>.
         *
         * @param directToParent value to be assigned to property directToParent
         */
        public void setDirectToParent(boolean directToParent) {
            this.directToParent = directToParent;
        }

        /**
         * Getter method for property <tt>childNode</tt>.
         *
         * @return property value of childNode
         */
        public SimpleXpathItem getChildNode() {
            return childNode;
        }

        /**
         * Setter method for property <tt>childNode</tt>.
         *
         * @param childNode value to be assigned to property childNode
         */
        public void setChildNode(SimpleXpathItem childNode) {
            this.childNode = childNode;
        }

        public Map<String, String> getFilter() {
            return filter;
        }

        public void setFilter(Map<String, String> filter) {
            this.filter = filter;
        }

        @Override
        public String toString() {
            final StringBuffer sb = new StringBuffer("SimpleXpathItem{");
            if (SPService.getBoolean(SPService.KEY_HIDE_LOG, true)) {
                sb.append("itemType='").append(StringUtil.hash(itemType)).append('\'');
                sb.append(", filter=[");
                if (filter != null) {
                    for (String key: filter.keySet()) {
                        sb.append(key).append("=").append(StringUtil.hash(filter.get(key))).append(',');
                    }
                }
                sb.append(']');
            } else {
                sb.append("itemType='").append(itemType).append('\'');
                sb.append(", filter=").append(filter);
            }

            sb.append(", itemIndex=").append(itemIndex);
            sb.append(", directToParent=").append(directToParent);
            sb.append(", childNode=").append(childNode);
            sb.append('}');
            return sb.toString();
        }
    }
}
