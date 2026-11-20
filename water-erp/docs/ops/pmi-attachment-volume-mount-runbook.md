# PMI 附件挂卷 + 双轨部署生产操作单（2026-11-20）

> 适用：生产后端机 **10.60.14.14**（B 机，Docker 运行 API 于 `/app/apps/api`）。
> 背景：PMI 阶段附件历史上只写容器本地盘 `uploads/`，容器 recreate 即灭失
> （2026-11-20 13:50 实录：`室内绿植服务谈判文件.pdf` 下载 500 ×3、AI 分析静默丢文本）。
> 代码已改双轨（写入即落 MinIO 副本、读取本地→MinIO 回退、存量回填脚本
> `apps/api/scripts/backfill-attachment-minio.ts`）。本操作单完成**运维侧**的挂卷止血与回填。
> ⚠️ 权威 compose 在生产机（仓库版无 api 服务、已漂移）；桌面拷贝目录改完须同步。

## 0. 前置确认

```bash
# 容器名与现状（记下 container name，下文以 <api> 指代）
docker ps --format '{{.Names}}\t{{.Status}}' | grep -i api
# 是否已挂 uploads 卷（若已有覆盖 /app/apps/api/uploads 的卷 → 跳过第 2 步挂载，只做回填）
docker inspect <api> --format '{{json .Mounts}}' | python3 -m json.tool
```

## 1. 先救文件（顺序铁律：挂卷/重建之前）

```bash
# 盘点现存附件文件
docker exec <api> ls -la /app/apps/api/uploads/project-management/ | head -20
docker exec <api> ls /app/apps/api/uploads/project-management/ | wc -l
# 有文件 → 先导出宿主暂存（recreate 会抹掉容器可写层）
docker cp <api>:/app/apps/api/uploads/project-management /home/<user>/uploads-rescue-$(date +%m%d)/
# 校验导出行数一致
ls /home/<user>/uploads-rescue-*/project-management | wc -l
```

## 2. 挂卷（生产 compose 的 api 服务 volumes 增 bind mount）

```yaml
volumes:
  - /home/<user>/water-erp-uploads:/app/apps/api/uploads
```

```bash
# 建宿主目录并入盘救援文件
mkdir -p /home/<user>/water-erp-uploads/project-management
cp -a /home/<user>/uploads-rescue-*/project-management/. /home/<user>/water-erp-uploads/project-management/
# 改 compose 后重建（compose 权威源在生产机；改完同步桌面拷贝目录）
docker compose up -d <api服务名>
# 确认挂载生效
docker exec <api> ls /app/apps/api/uploads/project-management | wc -l   # 应与救援行数一致
```

## 3. 部署含双轨代码的镜像

按既有发布流程（打包脚本 + `docker compose up -d` recreate api 与 ai-worker 两容器）。
**部署前确认第 1、2 步已完成**——recreate 之前没挂卷 = 救援白做。

> ⚠️ **提交溯源警示（终审 C1）**：供应商端谈判下载的双轨实现代码物理上位于并行提交
> `4da7a8365`（非本计划自己的提交 `326ff100d`——后者只含测试）。**任何对 4da7a8365 的
> revert/cherry-pick 排除操作都会连带撤掉该修复**，使供应商端回到「文件缺失裸 500」。
> 镜像须从包含 `4da7a8365` 及其后提交的 main HEAD 构建（现行发布流程天然满足）。

## 4. 存量回填

⚠️ `tsx` 是 devDependency，生产镜像多半没有——两条路径任选：

- **路径 a（宿主/打包机有代码+Node）**：以生产 env 跑（在 water-erp/apps/api 下）：
  ```bash
  # env 指生产：DATABASE_URL=金仓 10.60.1.10 生产库；MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY 指生产 MinIO
  DATABASE_URL="postgresql://<用户>:<密码>@10.60.1.10:54321/<库>" \
  MINIO_ENDPOINT=<生产MinIO地址> MINIO_PORT=9000 MINIO_ACCESS_KEY=<...> MINIO_SECRET_KEY=<...> \
    npx tsx scripts/backfill-attachment-minio.ts            # dry-run 复核
  # 同参数加 --execute 真传
  ```
- **路径 b（临时容器）**：`docker run --rm -v <代码目录>:/w -w /w/apps/api node:20 \
  npx tsx scripts/backfill-attachment-minio.ts`（env 同上以 -e 传入）。

预期：待回填 = 救援文件数（把容器可写层幸存件补进 MinIO）；**不可恢复清单**打印出
两轨皆无的行（预期含 `室内绿植服务谈判文件.pdf`）。

## 5. 验证

```bash
# ① 卷在位
docker inspect <api> --format '{{json .Mounts}}' | grep uploads
# ② 既有附件可下载（:3005 项目管理 → 附件预览/下载，或直接 curl 附件端点应 200）
# ③ 副本轨生效证明：force-recreate 后同一附件仍可下载（本地文件已随卷保留；即便不保留也有 MinIO 副本）
docker compose up -d --force-recreate <api服务名>
# ④ 再跑一次回填 dry-run：应全 skip（幂等）
```

## 6. 不可恢复清单收尾

回填脚本打印的清单交业务方：按 `fileName` 找回原始文件 → 项目管理对应阶段走 UI 重传
（旧附件行可删除）。**不要**手工往 uploads/ 目录拷文件再插 DB 行——重传走正门才有
MinIO 副本与审计留痕。

## 风险与回退

- bind mount 宿主目录须与容器内属主一致（root 容器写 root 属主目录；若报 EACCES，
  `chown -R` 对齐容器 UID）。
- 回退 = 去掉 volume 行 recreate（数据留在宿主目录，不丢）。
- 双轨代码本身无开关——MinIO 故障时写入自动降级（warn 不阻断）、读取自动回退本地，
  无需干预。
