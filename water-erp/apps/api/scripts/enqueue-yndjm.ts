import { Queue } from 'bullmq';

async function main() {
  const q = new Queue('ai-bidder-processing', {
    connection: { url: 'redis://localhost:6380' },
  });
  const taskId = 'cmqsy9tyz0005uu582knvea0u';
  for (const id of ['yndjm-br3-1', 'yndjm-br3-2', 'yndjm-br3-3']) {
    await q.add('process', { bidderResultId: id, taskId }, { jobId: `rerun4-${id}`, attempts: 1 });
    console.log(`enqueued: ${id}`);
  }
  await q.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
