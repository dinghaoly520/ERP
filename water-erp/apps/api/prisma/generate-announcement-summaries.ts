import { PrismaClient } from '@prisma/client';
import { AnnouncementAiService } from '../src/announcement/announcement-ai.service';

const prisma = new PrismaClient();
const announcementAi = new AnnouncementAiService();

async function main() {
  const announcements = await prisma.announcement.findMany({
    where: {
      status: 'PUBLISHED',
      OR: [{ aiSummary: null }, { aiSummary: '' }],
    },
    orderBy: [{ publishDate: 'desc' }, { createdAt: 'desc' }],
  });

  let updated = 0;
  for (const announcement of announcements) {
    const aiSummary = await announcementAi.summarize({
      title: announcement.title,
      type: announcement.type,
      content: announcement.content,
    });

    if (!aiSummary) {
      console.log(`Skipped: ${announcement.title}`);
      continue;
    }

    await prisma.announcement.update({
      where: { id: announcement.id },
      data: { aiSummary },
    });
    updated += 1;
    console.log(`Updated ${updated}/${announcements.length}: ${announcement.title}`);
  }

  console.log(`AI summaries updated: ${updated}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
