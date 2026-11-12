# Bug 整理与代码核查执行手册（SOP）

> 版本：2026-11-11（依据 yuanguoyu 非正式环境 21 票全流程实录沉淀）；**2026-11-11b 修订：产出即入库（§8）——本仓库副本为权威版**（`~/桌面/禅道/bug-export/` 内同名文件降级为工作区参考副本）
> 用途：禅道新 bug 提交后，按本手册执行 **数据核对 → 附件导出校验 → 截图取证 → 代码核查 → 产出导出件 → 交付前质量闸 → 交付入库**。
> 前六步全程只读禅道库与 ERP 代码、写盘仅限 `bug-export/`，可随时安全执行；§8 起写仓库（只 add 自己的批次目录，遵守并行会话协作约定）。

---

## 0. 资产与环境

| 资产 | 位置 / 获取方式 |
|---|---|
| 禅道 Docker | `~/桌面/禅道/compose.yaml`；容器 `zentao-standalone-db-1`（MariaDB）+ `zentao-standalone-zentao-1`（Web :8088），用 `~/桌面/禅道/start-zentao.sh` 启动 |
| DB 凭据 | 不写死。`docker exec zentao-standalone-db-1 printenv \| grep -i MARIA` → 取 `MARIADB_USER` / `MARIADB_PASSWORD` |
| 附件存储 | 禅道容器内 `/data/zentao/www/data/upload/1/<zt_file.pathname>`；**磁盘文件不带扩展名**（pathname 里的 `.png` 只在 DB） |
| ERP 代码 | `~/桌面/ERP/water-erp`（先 `git log --oneline -1` 记录基准 commit） |
| 本地 OCR | PM2 `erp-ocr`，`http://localhost:8110`，`POST /ocr` multipart 字段 `file`（可选 `dpi`，默认 150）；内容取证唯一权威通道 |
| 导出目录 | `~/桌面/禅道/bug-export/`：`*.md`（详情）+ `*.csv`（清单）+ `images/`（截图） |
| 关键表 | `zt_bug`（主表）、`zt_file`（附件映射）、`zt_action`（操作历史：软删除/指派/激活轨迹） |

**开工先同步（2026-11-12 补）**：代码核查必须对着最新 main——远端已修的票，对着过期本地代码会被误判「仍存在」，整份核查结论失真。执行：`git fetch`（只读）→ 落后则**问用户**是否拉取；**pull 前工作区必须干净，绝不 autostash / 脏树 pull**（并行会话协作约定，会卷走对方未提交改动）。树脏拉不了时：按当前 HEAD 继续，但必须在产出件「核查方法备注」如实写「核查基准=本地 HEAD `<hash>`，落后 origin/main N 提交」，标注结论时效风险——§8 入库前若已可拉取，先拉再复核增量。

---

## 1. 第一步：禅道数据核对（定范围）

### 1.1 范围查询

```bash
DBPW=$(docker exec zentao-standalone-db-1 printenv MARIADB_PASSWORD)
docker exec zentao-standalone-db-1 mysql -uzentao -p"$DBPW" zentao -e "
SELECT id, severity, pri, status, deleted, assignedTo, openedBy, openedDate, title
FROM zt_bug
WHERE assignedTo='yuanguoyu' AND status='active' AND deleted='0'
ORDER BY id;"
```

要点：
- **必须带 `deleted='0'`**——禅道删除是软删除，行还在（实录：#156 曾是合法范围内 bug，11-05 被报告人软删除后仍会查出）。
- 排除口径按需求定（本次：标题含「正式环境」的剔除，单独立档）。
- severity 数字→等级映射：1=S1、2=S2、3=S3；核对总数分布（如 S1×5、S2×6、S3×10）。

### 1.2 疑点追历史（zt_action）

范围数与预期不符、或某票「应在却不在」时：

```sql
SELECT objectID, actor, action, date, LEFT(comment,200)
FROM zt_action WHERE objectID=<ID> AND objectType='bug' ORDER BY id;
```

实录：#156 靠此确认 11-05 11:35 `deleted` 事件，排除得有据。

### 1.3 元数据逐条核对

导出件中每票的 **等级 / 报告人 / 创建时间 / 标题** 必须与 `zt_bug` 逐条对上；标题允许可辨识缩写但不得改变语义。无步骤无截图的票（`steps` 为空模板）如实标「无截图」。

---

## 2. 第二步：附件导出与 md5 校验

### 2.1 映射查询

```sql
SELECT f.id, f.objectID, f.title, f.extension, f.size, f.pathname
FROM zt_file f JOIN zt_bug b ON b.id=f.objectID
WHERE f.objectType='bug' AND b.assignedTo='yuanguoyu' AND b.deleted='0' AND b.status='active'
ORDER BY f.objectID, f.id;
```

命名规范：**`bug{bugID}_{fileID}.{extension}`**（如 `bug59_115.png`）。文件名即自证映射，不必另做对照表。

### 2.2 md5 逐字节校验（坑：磁盘路径去扩展名）

```bash
cd ~/桌面/禅道/bug-export/images
for f in *; do
  fileid=$(echo "$f" | sed -E 's/^bug[0-9]+_([0-9]+)\.(png|jpg)$/\1/')
  pn=$(docker exec zentao-standalone-db-1 mysql -uzentao -p"$DBPW" zentao -N \
       -e "SELECT pathname FROM zt_file WHERE id=$fileid" | tr -d '\r\n')
  diskpath="/data/zentao/www/data/upload/1/$(dirname "$pn")/$(basename "$pn" | sed -E 's/\.(png|jpg|jpeg)$//')"
  src=$(docker exec zentao-standalone-zentao-1 md5sum "$diskpath" 2>/dev/null | awk '{print $1}')
  loc=$(md5sum "$f" | awk '{print $1}')
  [ "$src" = "$loc" ] && [ -n "$src" ] && echo "$f ✓" || echo "$f ✗ local=$loc zentao=$src"
done
```

要求 **N/N 全绿**。md5 空 = 路径错（十有八九是忘了去扩展名），不是内容差异。

---

## 3. 第三步：截图内容取证（本地 OCR，勿信 CDN 回传）

> **坑（本实录实证）**：Claude 的 Read 图片回传经 CDN，并发上传时会**串图**——磁盘 1912×922 的文件三次回传 3412×1718 的另一张画面；尺寸标注与像素也会交叉错位。
> **铁律：截图内容判定一律走本地 OCR 直读磁盘文件；CDN 回传只当参考，不作依据。**

### 3.1 全图 OCR

```bash
cd ~/桌面/禅道/bug-export/images
curl -s --noproxy '*' -X POST http://localhost:8110/ocr -F "file=@bug59_115.png" --max-time 120 \
| python3 -c "import json,sys; d=json.load(sys.stdin); \
t=d.get('text') or ''.join(p.get('text','') for p in (d.get('pages') or [])); \
print(' '.join(t.split())[:1000])"
```

### 3.2 疑难图加码

- 疑点未出现（如「应有英文却没读到」）→ 加 `-F "dpi=300"` 复跑；
- 仍无 → 本地切块（PIL 上/中/下或四象限）逐块 OCR，彻底排除漏读（#142 即此法定谳：全图无英文）。

### 3.3 内容判定口径

- 三方对齐：bug 标题/steps 原文 ↔ OCR 文本 ↔ 截图内嵌证据（`zt_file` fileID 与 steps HTML `<img alt="...fileID=N">` 一致性在 2.1 已锁）。
- **只有 OCR 实证后才可写「与描述相符 ✓」**；实证不符要如实分档：
  - △ 语境相符但细节出入（实录：#69 无报错弹窗、#121 画面是对照面非缺陷面）
  - ✗ 明显不符（实录：#142 标题说英文、截图全中文——须写明「现象未被附件留存，建议向报告人补录」）
- OCR 文本常能反向印证代码根因（实录：#150 三家全显 `technical.plain`、#115-198 直开原始 JSON、#79 手写标注）——发现即记入详情，别浪费。

---

## 4. 第四步：代码核查（处理意见）

### 4.1 基准与工具纪律

```bash
cd ~/桌面/ERP/water-erp && git log --oneline -1   # 记录基准，写进产出件（基准必须取自 §0「开工先同步」之后的 HEAD）
for c in <引用的commit...>; do git log --oneline -1 $c || echo "$c 不存在"; done
```

- **引用 commit 必须验存在且主题相符**。
- `rg` 用 `rg -n`；**勿用 `rg -rn`**——`-r` 是替换标志，会把匹配文本改写成 "n"（本实录踩过，输出看着像方法名变 `n()`）。
- 行号锚点：`sed -n 'N,Mp' file` + `rg -n '关键词' file` 双确认；文件路径先 `find` 定位（组件可能被移动过，如 `bid-confirm-panel.tsx` 在 `projects/` 下而非 `projects/bid-confirm/`）。行号小幅漂移不影响结论，但要记录实际行号。

### 4.2 每票断言的四个层次（逐层验）

1. **修复态断言**（已修复/仍存在/部分修复）：找到正反两面证据——修复要看落点代码+commit；「仍存在」要看当前代码确实无闸/无渲染。
2. **file:line 锚点**：逐个核到行。
3. **根因链**：跨文件链路逐环验证（实录 #150：上传带名 `.outer` → 解密落库覆盖 `${role}.plain` → 专家端反显 `asset.originalName`，三环全中才下结论）。
4. **缺失类断言必须全仓反证**：「无此机制」要 `rg` 全仓搜关键词族证明零命中（实录 #61 回归场景 A：搜「确认超时/autoConfirm」零命中才敢写「确认超时自动闭环不存在」）。

### 4.3 处理意见的两个红线

- **强断言先找恢复路径与例外分支**：说「死路/完全未实现」前，先查 try/catch、兜底 toast、条件分支（实录 #74：写「死路」失准——实有 M3 恢复提示，只是恢复路径仍 409；正确表述是「失败恢复循环」）。
- **修复建议不得与既有产品裁定冲突**：建议前先查 CLAUDE.md 裁定区（实录 #73：「改齐招标文件→采购文件」撞上 2026-11-03 裁定 #3「邀请招标显法定名」，应改按采购方式条件化）。

### 4.4 判定与分档

- 状态五档：`✅ 已修复` / `🟡 基本·部分修复` / `⚠️ 有意设计（需产品裁定）` / `❌ 仍存在` / `➖ 未核查`。
- 动作分组（汇总表）：**直接验收关单 / 小改动快修（≤1-2 文件）/ 中等工作量 / 需产品裁定 / 联动票（同链路同页面并票）/ 补录信息**。
- 联动票引用前到 `zt_bug` 验一下对方票真实存在且状态吻合（实录：#126、#166 均验过）。

---

## 5. 第五步：产出物规范

### 5.1 MD（详情文件）

结构骨架（沿用 `非正式环境bug清单-<人>.md`）：

```
# 蜀水云采 · 未解决 Bug 导出 vN（<负责人> · <范围>）
> 导出时间 | 来源 | 范围口径（指派/状态/排除项）| 总数与等级分布 | 基准 commit | 端口对照
## 一、清单总览（ID/级/标题/当前代码状态/一句话结论）
## 二、逐条详情：报告人行（报告人·日期·截图文件+OCR 实证括注）→ v2 代码核查 → 修复建议
## 三、汇总：建议动作分组表
> 核查方法备注（验证方法、复核记录、修正出处——**每次复核修正都要在此登记**）
```

括注纪律：截图括注 = OCR 实证结论，不符就写 △/✗ 与修正日期，**严禁未经实证写「与描述相符 ✓」**。

### 5.2 CSV（清单文件）

- 表头 9 列：`ID,等级,标题,报告人,创建时间,当前代码状态,关键代码/根因,修复建议要点,截图文件`
- **UTF-8 with BOM**（否则 Excel 双击中文乱码）、字段内多值用 `;`（不要逗号——免引号依赖）
- 截图列**全量引用**：一票多图逐个 `images/xxx.png;images/yyy.png`（实录漏过 4 张被核对揪出）
- 交付前跑校验：

```bash
python3 -I -c "
import csv, io, os
raw = open('<csv路径>','rb').read()
rows = list(csv.reader(io.StringIO(raw.decode('utf-8-sig'))))
print('BOM:', raw[:3]==b'\xef\xbb\xbf')
print('行数:', len([r for r in rows[1:] if r]), '坏行:', [i for i,r in enumerate(rows[1:],2) if r and len(r)!=9])
refs=[x for r in rows[1:] if r and r[8].strip() for x in r[8].split(';') if x]
print('截图引用:', len(refs), '全部存在:', all(os.path.exists(p) for p in refs))
print('未引用:', set(os.listdir('images')) - {os.path.basename(x) for x in refs})
"
```

### 5.3 MD ↔ CSV 一致性

两份文件对同一 bug 的状态/根因/建议措辞必须同步（含后续修正——实录：#73/#74 修正后 CSV 落后一拍，需专门补同步）。

---

## 6. 交付前质量闸（自检清单）

- [ ] DB 范围数 = 导出数；排除口径（软删除/正式环境）有 zt_action 或标题证据
- [ ] 元数据 N/N 对上（等级/报告人/日期/标题）
- [ ] 截图 md5 N/N 全绿
- [ ] 截图内容 OCR 实证 N/N；括注与实况一致（△/✗ 已如实标注）
- [ ] 引用 commit 全部存在且主题相符
- [ ] file:line 锚点逐个核过；漂移已记录实际行号
- [ ] 缺失类断言全仓反证通过
- [ ] 强断言查过恢复路径；修复建议无裁定冲突
- [ ] CSV：BOM + 列数 + 截图引用 N/N 解析无悬空
- [ ] MD 总览/详情/汇总/方法备注四处口径一致；MD↔CSV 同步

---

## 7. 本实录案例索引（坑 ↔ 实证）

| 坑 | 案例 | 章节 |
|---|---|---|
| 软删除不过滤会多票 | #156（zt_action deleted 事件） | §1 |
| pathname 带扩展名、磁盘不带 | md5 全空 ≠ 内容差异 | §2 |
| CDN 图片回传串图 | 1912×922 三次回传 3412×1718 画面 | §3 |
| OCR 漏读假象 | #142 dpi300+分块定谳「全图无英文」 | §3 |
| 括注失真 | #69 无弹窗、#121 对照面、#142 无英文 | §3/§5.1 |
| `rg -rn` 替换标志 | 输出被改写误读 | §4.1 |
| 强断言漏看恢复路径 | #74 M3 try/catch（死路→恢复循环） | §4.3 |
| 建议撞产品裁定 | #73 招标文件 vs 2026-11-03 裁定 #3 | §4.3 |
| CSV 多图漏引 / 无 BOM | 补 4 张引用 + BOM | §5.2 |
| MD↔CSV 修正不同步 | #73/#74 补同步 | §5.3 |

---

## 8. 第八步：产出即入库（2026-11-11b 起，质量闸通过后执行）

整理核查完成后，**同一会话**把交付物落进仓库并提交——新鲜度的唯一保证（不依赖任何后续手动同步），修 bug 会话 git pull 天然拿到最新：

1. 交付物 = 清单 MD + CSV + `images/`（**引用到的原件原样**，不压缩——md5 取证链与像素级视觉细节票都依赖原件）→ `water-erp/docs/bugs/<日期>-<负责人>/`；
2. 生成 `manifest.json`（逐文件 md5+size，值与 §2.2 校验一致）——任何机器可本地复验；
3. 建/续 `票修队列.md`（新票入队，沿用现行格式）；
4. 只 add 本批次目录，commit（`chore(bugs): 入列 <日期>-<负责人> N 票`）→ 问用户是否推送；
5. `bug-export/` 同名产出保留作工作区副本，**仓库是唯一交付事实源**。
