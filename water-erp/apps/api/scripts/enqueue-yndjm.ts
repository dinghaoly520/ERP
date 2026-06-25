import { Queue } from 'bullmq';

async function main() {
  const q = new Queue('ai-bidder-processing', {
    connection: { url: 'redis://localhost:6380' },
  });
  const ids = [
    'yndjm-br2-1',
    'yndjm-br2-2',
    'yndjm-br2-3',
  ];
  for (const id of ids) {
    await q.add('process', { bidderResultId: id, taskId: 'cmqsy9tyz0005uu582knvea0u' }, { jobId: `rerun3-${id}`, attempts: 1 });
    console.log(`enqueued: ${id}`);
  }
  await q.close();
}
main().catch((e) => { console.error(e); process.exit(1); });
