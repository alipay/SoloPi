# 长任务等待与断线恢复

长任务使用异步提交并保存成功回执中的 taskId。提交命令退出不代表后台任务完成。

使用 `tasks watch <taskId> --jsonl` 续接事件；连接断开后用 `tasks show <taskId> --json` 查询同一任务，不重复提交。仅在权威终态后读取最终报告；部分证据尚未落盘时明确标注。

等待超时保留 taskId、最后 revision 和原始错误。停止须显式调用 `tasks stop <taskId>` 并核对停止回执。参见 [执行与 ADB 排障](troubleshooting-runner-and-adb.md)。
