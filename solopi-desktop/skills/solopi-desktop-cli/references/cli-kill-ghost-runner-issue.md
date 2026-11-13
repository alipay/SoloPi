# CLI 退出后的任务状态核对

CLI 进程退出与任务停止是不同状态。先通过 `tasks show <taskId> --json` 核对已提交任务；需要停止时使用 `tasks stop <taskId>` 并等待终态。不要按进程名称批量杀死其他应用的进程。

检查该 taskId 的日志、报告和所属子进程是否完成收尾。记录任务状态、停止回执和清理错误；不要因为 CLI 被中断而重跑任务。参见 [长任务恢复](run-task-long-running-issue.md)。
