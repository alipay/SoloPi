package com.alipay.hulu.shared.node.utils;

import com.alipay.hulu.common.application.LauncherApplication;
import com.alipay.hulu.common.utils.LogUtil;
import com.alipay.hulu.common.utils.StringUtil;
import com.alipay.hulu.shared.node.OperationService;
import com.alipay.hulu.shared.node.action.OperationMethod;
import com.alipay.hulu.shared.node.action.PerformActionEnum;
import com.alipay.hulu.shared.node.tree.AbstractNodeTree;

import java.util.regex.Pattern;

/**
 * Created by qiaoruikai on 2019/2/13 4:08 PM.
 */
public class LogicUtil {

    private static final String TAG = "LogicUtil";
    /**
     * if字段
     */
    public static final String CHECK_PARAM = "check";

    public static final String LOOP_PREFIX = "loop::";

    public static final String ASSERT_ACTION_PREFIX = "assert::";

    /**
     * 声明字段
     */
    public static final String ALLOC_KEY_PARAM = "allocKey";

    /**
     * 声明类型
     * 包含 字符串类型声明{@link #ALLOC_TYPE_STRING} 与 整数类型声明 {@link #ALLOC_TYPE_INTEGER}
     */
    public static final String ALLOC_TYPE = "allocType";

    /**
     * 整数类型声明
     */
    public static final int ALLOC_TYPE_INTEGER = 0;

    /**
     * 字符串类型声明
     */
    public static final int ALLOC_TYPE_STRING = 1;

    /**
     * 声明值
     */
    public static final String ALLOC_VALUE_PARAM = "allocValue";

    /**
     * if、where执行范围
     */
    public static final String SCOPE = "scope";

    public static final String NODE_NAME = "node";

    /**
     * ${xxx}格式
     */
    private static final Pattern FILED_CALL_PATTERN = Pattern.compile("\\$\\{[^}\\s]+\\.?[^}\\s]*\\}");

    /**
     * check判断
     * @param method
     * @return
     */
    public static boolean checkStep(OperationMethod method, AbstractNodeTree node, OperationService service) {
        // 方法有误
        if (method == null || (method.getActionEnum() != PerformActionEnum.CHECK &&
                method.getActionEnum() != PerformActionEnum.CHECK_NODE)) {
            return false;
        }

        // 获取校验步骤
        String argument = method.getParam(CHECK_PARAM);

        // 无校验字段
        if (StringUtil.isEmpty(argument)) {
            return false;
        }

        try {
            Boolean result = checkArgument(argument, method, node, service);

            if (result == null) {
                return false;
            }

            return result;
        } catch (NumberFormatException e) {
            LogUtil.e(TAG, "解析check出现异常： " + e.getMessage(), e);
            return false;
        }
    }

    /**
     * 赋值语句
     * @param method
     * @param node
     * @param service
     */
    public static boolean letStep(OperationMethod method, AbstractNodeTree node, OperationService service) {
        // 不是设置字段，无法执行
        if (method == null || (method.getActionEnum() != PerformActionEnum.LET
                && method.getActionEnum() != PerformActionEnum.LET_NODE)) {
            return false;
        }

        String allocKey = method.getParam(ALLOC_KEY_PARAM);
        String allocValue = method.getParam(ALLOC_VALUE_PARAM);
        int allocType = Integer.parseInt(method.getParam(ALLOC_TYPE));

        // 确保临时变量不影响全局变量

        String val = eval(allocValue, node, allocType, service);
        if (val == null) {
            LogUtil.w(TAG, "Fail to eval value (%s) for key %s", allocValue, allocKey);
            return false;
        }

        service.putRuntimeParam(allocKey, val);
        return true;
    }

    /**
     * 计算值
     * @param constant
     * @param targetNode
     * @param evalType
     * @param service
     * @return
     */
    public static String eval(String constant, AbstractNodeTree targetNode, int evalType, OperationService service) {
        try {
            // 设置临时变量
            if (targetNode != null) {
                service.putTemporaryParam(NODE_NAME, targetNode);
            }
            String realValue = getMappedContent(constant, service);

            // 根据声明类型解析
            if (evalType == ALLOC_TYPE_INTEGER) {
                int evalValue = evalInt(realValue);
                return Integer.toString(evalValue);
            } else if (evalType == ALLOC_TYPE_STRING) {
                return evalStr(realValue);
            } else {
                LogUtil.e(TAG, "Known eval type: " + evalType);
                return null;
            }
        } catch (NumberFormatException e) {
            LogUtil.e(TAG, "do let throw FormatException: " + e.getMessage(), e);
            return null;
        } catch (Exception e) {
            LogUtil.e(TAG, "do let throw Exception: " + e.getMessage(), e);
            return null;
        } finally {
            service.removeTemporaryParam(NODE_NAME);
        }
    }

    /**
     * 校验参数
     *
     * @param argument
     * @param node
     * @param service
     * @return
     */
    private static Boolean checkArgument(String argument, OperationMethod method, AbstractNodeTree node, final OperationService service) {

        // assert部分直接使用
        if (argument.startsWith(ASSERT_ACTION_PREFIX)) {
            OperationMethod assertMethod = new OperationMethod(PerformActionEnum.getActionEnumByCode(argument.substring(8)));

            if (assertMethod.getActionEnum() == null) {
                return null;
            }

            assertMethod.getOperationParam().putAll(method.getOperationParam());
            return service.doSomeAction(assertMethod, node);
        }

        if (node != null) {
            service.putTemporaryParam(NODE_NAME, node);
        }
        String mappedValue = getMappedContent(argument, service);
        service.removeTemporaryParam(NODE_NAME);
        boolean checkResult = evalCheck(mappedValue);
        if (checkResult) {
            LauncherApplication.getInstance().showToast("检查通过");
        } else {
            LauncherApplication.getInstance().showToast("检查未通过");
        }
        return checkResult;
    }

    /**
     * 将当期运行时变量映射到字符串中
     * @param origin
     * @param service
     * @return
     */
    public static String getMappedContent(String origin, final OperationService service) {
        return StringUtil.patternReplace(origin, FILED_CALL_PATTERN, new StringUtil.PatternReplace() {
            @Override
            public String replacePattern(String origin) {
                String content = origin.substring(2, origin.length() - 1);
                // 有子内容调用
                if (content.contains(".")) {
                    String[] group = content.split("\\.", 2);

                    if (group.length != 2) {
                        return origin;
                    }

                    // 获取当前变量
                    Object obj = service.getRuntimeParam(group[0]);
                    if (obj == null) {
                        return origin;
                    }

                    LogUtil.d(TAG, "Map key word %s to value %s", group[0], obj);

                    // 特殊判断
                    // 节点字段，自行操作
                    if (obj instanceof AbstractNodeTree) {
                        String replace = StringUtil.toString(((AbstractNodeTree) obj).getField(group[1]));
                        if (replace == null) {
                            return origin;
                        } else {
                            return replace;
                        }
                    } else {
                        // 目前只支持length方法
                        if (StringUtil.equals(group[1], "length")) {
                            return Integer.toString(StringUtil.toString(obj).length());
                        } else {
                            return origin;
                        }
                    }
                } else {
                    String target = StringUtil.toString(service.getRuntimeParam(content));
                    if (target == null) {
                        return origin;
                    } else {
                        return target;
                    }
                }
            }
        });
    }

    /**
     * 计算check
     * @param content
     * @return
     */
    private static boolean evalCheck(String content) {
        if (StringUtil.contains(content, ">=")) {
            String[] leftRight = content.split(">=");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '>=' for statement " + content);
            }

            return evalInt(leftRight[0]) >= evalInt(leftRight[1]);
        } else if (StringUtil.contains(content, "<=")) {
            String[] leftRight = content.split("<=");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '<=' for statement " + content);
            }

            return evalInt(leftRight[0]) <= evalInt(leftRight[1]);
        } else if (StringUtil.contains(content, "<")) {
            String[] leftRight = content.split("<");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '<' for statement " + content);
            }

            return evalInt(leftRight[0]) < evalInt(leftRight[1]);
        } else if (StringUtil.contains(content, ">")) {
            String[] leftRight = content.split(">");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '>' for statement " + content);
            }

            return evalInt(leftRight[0]) > evalInt(leftRight[1]);
        } else if (StringUtil.contains(content, "==")) {
            String[] leftRight = content.split("==");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '==' for statement " + content);
            }

            return evalInt(leftRight[0]) == evalInt(leftRight[1]);
        } else if (StringUtil.contains(content, "<>")) {
            String[] leftRight = content.split("<>");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '<>' for statement " + content);
            }

            return evalInt(leftRight[0]) != evalInt(leftRight[1]);
        } else if (StringUtil.contains(content, "=")) {
            String[] leftRight = content.split("=");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '=' for statement " + content);
            }

            return StringUtil.equals(evalStr(leftRight[0]), evalStr(leftRight[1]));
        } else if (StringUtil.contains(content, "!=")) {
            String[] leftRight = content.split("!=");
            if (leftRight.length != 2) {
                throw new NumberFormatException("Can't parse '=' for statement " + content);
            }

            return !StringUtil.equals(evalStr(leftRight[0]), evalStr(leftRight[1]));
        } else {
            throw new NumberFormatException("Can't parse statement, unknown statement " + content);
        }
    }

    /**
     * 解析字符串
     * @param statement
     * @return
     */
    private static String evalStr(String statement) {
        if (StringUtil.isEmpty(statement)) {
            return "";
        }

        String[] result = statement.split("\\+");
        StringBuilder sb = new StringBuilder();
        for (String part: result) {
            sb.append(StringUtil.trim(part));
        }

        return sb.toString();
    }

    /**
     * 解析int表述
     * @param statement
     * @return
     */
    private static int evalInt(String statement) {
        if (StringUtil.isEmpty(statement)) {
            throw new NumberFormatException("Can't format empty statement");
        }

        if (statement.contains("+")) {
            String[] groups = statement.split("\\+");
            if (groups.length < 2) {
                throw new NumberFormatException("parse '+' failed for " + statement);
            }

            int result = 0;
            for (String part: groups) {
                result += evalInt(StringUtil.trim(part));
            }

            return result;
        } else if (statement.contains("*")) {
            String[] groups = statement.split("\\*");
            if (groups.length < 2) {
                throw new NumberFormatException("parse '*' failed for " + statement);
            }

            int result = 1;
            for (String part: groups) {
                result *= evalInt(StringUtil.trim(part));
            }

            return result;
        } else {
            return Integer.parseInt(statement);
        }
    }
}
