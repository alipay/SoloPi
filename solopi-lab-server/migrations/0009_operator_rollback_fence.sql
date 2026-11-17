-- 0009: operator回退护栏（C90=root裁定"跨进程可验证的签发冻结/in途交接"；C91=7109303注释同步真实实现）
-- 增量迁移：无DROP、无破坏性变更。operator_rollback_fence表（含签发冻结开关）——
--   operator-disable --all **先提交fence**（BEGIN IMMEDIATE写事务内落held=1），**再**收敛清扫
--   （重复"扫未吊销operator→逐行吊销"直至空集，覆盖fence提交前已在途的签发事务——SQLite单写者全序）；
--   收敛失败抛出且**fence保持持有**（宁冻结不遗漏）。fence持有期跨进程可见且operatorGrant一律拒绝。
--   operator-disable-release=受控解锁，**受控部署交接清单+代次CAS、fail-closed**（C92=7109983、C93=7110319）：
--   仅当具role gate的新核心已恢复，并按 --release-manifest 交接清单（原部署负责人按现网句柄固定：
--   恰1个8791核心+2个8780/5978 httpview、逐项PID/加载字节codeDigest/DB绑定/旧实例退出/维护窗口记录）
--   逐控制面实测核验全过——组成/监听位/PID三重去重、healthz标记+codeDigest三向比对、/proc实核端口归属
--   与cmdline --db目标绑定（C94=7113125：**相对--db按目标PID的/proc cwd解析**；缺--db按本项目控制面
--   入口真实默认；控制面形状/--db载体但绑定不可读=明确拒绝+负责人核验边界，不静默漏认）、manifest目标
--   与CLI库分别规范化后真实比较（异库拒释保锁）、目标库绑定进程集恰为清单三PID（旧核仍在/复制库残留
--   即拒；范围外/不可读cmdline进程如实入审计由负责人实核）、**fence代次CAS**（核验开始记录held行id，短写事务UPDATE…WHERE id=同代AND held=1——重新落fence/代次变化即
--   拒释且不清新保护）——回退期间保持fence、不release、不签发；静止回退成功不构成解锁条件。清单中
--   healthz不可自证的记录（维护窗口、旧实例退出、httpview.mjs自身字节）由原部署负责人受控核验并留档
--   （合同v0.3.9）。
CREATE TABLE IF NOT EXISTS operator_rollback_fence (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  held INTEGER NOT NULL CHECK (held IN (0,1) AND typeof(held)='integer'),
  held_by_label TEXT CHECK (held_by_label IS NULL OR typeof(held_by_label)='text'),
  held_at_ms INTEGER NOT NULL CHECK (typeof(held_at_ms)='integer'),
  released_at_ms INTEGER CHECK (released_at_ms IS NULL OR typeof(released_at_ms)='integer')
);
