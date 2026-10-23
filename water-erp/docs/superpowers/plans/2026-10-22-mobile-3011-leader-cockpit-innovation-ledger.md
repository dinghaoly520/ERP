# SDD ledger — plan: docs/superpowers/plans/2026-10-22-mobile-3011-leader-cockpit-innovation.md

工作树：main 直行（仓库并行会话协议 + 验证依赖主树热更 dev 服务器；计划提交命令按当前检出编写，用户已批）。
BASE=da8104faa881e84511707fbac39fe7c5d232d146
Task 1: minor (deferred): stalledCount 未限定 PMI ACTIVE/当前阶段——口径与 spec「active PMI 当前阶段停留>30天」有偏（archived PMI 滞留阶段会虚增角标）→ 终审triage
Task 1: minor (deferred): 枚举字面量 'AWARDED' vs ResultStatus.AWARDED 风格不一
Task 1: minor (deferred): spec 内 lastStageWhere 死脚手架未断言、PENDING count where 未显式断言
Task 1: complete (commits da8104fa..984baa92, review clean)
BASE_T2=984baa92
Task 2: minor (deferred): priorWindow 单边界 29-31 日起点可能跨月滚动/窗口反转（契约用例均为月初1号，未触）→ 终审triage
Task 2: minor (deferred): compare 块/控制器透传无直接测试（口径镜像仅注释锚定）
Task 2: minor (deferred): endDate<startDate 反转窗口未防护（与主查询 garbage-in 一致）
Task 2: complete (commits 984baa92..b28c2afb, review clean)
BASE_T3=b28c2afb
Task 3: fix round 1/5 (2 addressed, 0 open — shareText 160字净化+测试契约化; 阶段分布改源 ProgressService+forwardRef; commits bef80abb..1387fa00)
Task 3: minor (deferred): 阶段 key 无 stageName 映射（prompt 见 CONTRACT 原键；getAiInsights 有本地 stageNames 表未复用）
Task 3: minor (deferred): getProgressStats/getDashboard 在 try 外（DB 故障 500 而非 available:false——沿既有模式）
Task 3: minor (deferred): 每次要报跑全量 progress 查询（低频端点可接受）
Task 3: minor (deferred): spec mock.calls[0] 未 reset（确定性相同，无害）
Task 3: complete (commits b28c2afb..1387fa00, fix round 1, review clean)
BASE_T4=1387fa00
Task 4: minor (deferred): 角标 pill text-[11px] 低于 12-21 阶梯（计划自带，有 web 先例）
Task 4: minor (deferred): MetricCard 宽值+delta 徽标可能换行致双卡不齐（无 truncate）
Task 4: minor (deferred): 公司切换时要报未置 null——旧公司三句滞留 2-8s
Task 4: minor (deferred): dashboard.ts 混新旧两层 API 封装（brief 指定）
Task 4: complete (commits 1387fa00..934ad871, review clean)
── P0 期完成（T1-T4）──
BASE_T5=1c48173a
Task 5: complete (commits 1c48173a..b9143f8b, review clean)
Task 5→6 carry: 【必须】handleFallbackWithGlobalOverview 第三处 tool.execute(~L338) + handleNormalChat toolCalls.length===0 兜底入口未穿 ctx——T6 消费 global_overview 过滤时即成 leader 越权漏点，T6 派发已含
Task 5: minor (deferred): 外部角色也跑 resolveToolCtx 单查（可 INTERNAL_ROLES 门控省一次查询）
Task 5: minor (deferred): cap-50/空集→undefined/ctx 全链 spec 未覆盖
BASE_T6=b9143f8b
Task 6: complete (commits b9143f8b..44136972, review clean)
Task 6: minor (deferred): bid_host 属 INTERNAL_ROLES 过工具门禁但 toolCompanyWhere 返回 {}——全公司视图（计划真值表口径，设计观察→终审/用户裁定是否也按公司过滤）
Task 6: minor (deferred): 非 admin/leader/staff 认证角色分支无直测；expert.tool 无条件 user:{} 依赖必需关系（schema 现为必需，若改可选会静默丢行）
BASE_T7=55970e29
Task 7: fix round 1/5 (1 addressed, 0 open — STAGE_LABELS 导出共用，stages 卡/要报 prompt 中文，NOT_IN_LABELS 兜底锁测; commits 69c34614..0f0ba4d5)
Task 7: minor (deferred): STAGE_LABELS 仅 9 键（stageDistribution 六键已全覆盖；扩表归终审）
Task 7: complete (commits 55970e29..0f0ba4d5, fix round 1, review clean)
BASE_T8=0f0ba4d5
Task 8: complete (commits 0f0ba4d5..2a10168a, review clean)
Task 8: minor (deferred): restore effect 缺 active flag（破坏本地模式一致性）；restore-vs-ask 竞态窗口；会话中途被删不自愈；index keys
BASE_T9=3b3022c3
Task 9: complete (commits 3b3022c3..71f3b683, review clean; 非空加固+变异验证)
Task 9: minor (deferred): 月界跨越天然 flake 窗（fails loud）；afterAll 无 try/finally（forceExit 兜底）；monthStart 镜像单向耦合（drift fails loud）
── P1 期完成（T5-T9）：ctx 基建/五工具过滤/cockpit/前端 Tab/e2e 闸 ──
BASE_T10=c09bce59
Task 10: complete (commits c09bce59..5c08b65f, review clean)
Task 10: minor (deferred): copy util 为简版——缺四姊妹门户的 iOS Safari 加固（focus+setSelectionRange/readonly/top:-9999px/无条件 removeChild）；execCommand 抛错会遗留隐形 textarea——移动门户 iOS 主场景，终审优先修
Task 10: minor (deferred): 2s 窗口内连点 timer 叠加（cosmetic）
BASE_T11=ba14eef9
Task 11: complete (commits ba14eef9..0e7bbe9e, review clean)
Task 11: minor (deferred): 下拉刷新不重取 upcoming（deps 无 retryTick）；UTC 日分组 00:00-08:00 入前日；days=0 落默认 14；午夜界 flake 窗；orderBy 惰性
BASE_T12=c436f2da
Task 12: complete (commits c436f2da..0d77bf32, review clean)
Task 12: minor (deferred): 下拉刷新不重取龙虎榜/要报（loadData 不 bump retryTick——同根两项）；初始 fetch 空态闪烁（无 skeleton）；service 注释提 staff 但守卫 403；index 6.5 与下卡 25ms 倒置
BASE_T13=c0bfa9ab
Task 13: complete (commits c0bfa9ab..d8452ef5, review clean; 5 组验证全绿+文档同步)
── 13/13 任务完成，进入终审 ──
终审: 修复后交付 → fix wave 1f2e80ce（iOS剪贴板加固/admin口径透传+文案/下拉刷新三连）全部 ADDRESSED，复审通过
终审 PARK: 下拉刷新 dashboard 双请求（loadData直调+retryTick联动，数据无害）；bid_host assistant 数据面 vs 页面层 403 口径分裂——【待用户裁定：a) INTERNAL_ROLES 剔除 bid_host 或 b) toolCompanyWhere 给 bid_host 落本公司过滤】；T1 stalledCount ACTIVE 限定；T2 priorWindow 边界；通知工具全局计数（预置）
终审: 交付完成（13/13 任务 + 2 修复波，全部验证绿）
