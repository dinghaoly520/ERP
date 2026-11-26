/**
 * 删除审查任务前的确认文案（审计第 3 处跟进，2026-11-26）。
 *
 * 删任务都会连带清理它的源文件（没有别的审查记录在用时），这是不可逆的，两处都要先说清楚。
 * 任务栏里是在跑的任务，报告面板里是已结束的记录，前半句不同：
 *  - 在跑的：删除会立即停止审查，本次不保留审查结果（想换个知识库重跑的人，要知道上传也没了）；
 *  - 已结束的：删的是这条审查记录。
 */
const SOURCE_FILE_NOTE = '没有其他审查记录在用的上传源文件会一并删除，删除后无法恢复。';

export function deleteReviewConfirmMessage(status: string): string {
  if (status === 'running' || status === 'pending') {
    return `该任务正在审查中，删除后会立即停止审查，本次不保留审查结果。\n\n${SOURCE_FILE_NOTE}\n\n确定删除？`;
  }
  return `确定删除该审查记录？\n\n${SOURCE_FILE_NOTE}`;
}
