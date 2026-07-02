import cron from 'node-cron';
import { prisma } from './lib/prisma';
import { sendPushToBabyMembers } from './routes/push';

export function startReminderScheduler() {
  cron.schedule('*/5 * * * *', async () => {
    try {
      const now = new Date();
      const dueReminders = await prisma.reminder.findMany({
        where: { sent: false, remindAt: { lte: now } },
        include: { baby: { select: { name: true } } },
      });

      if (dueReminders.length > 0) {
        console.log(`[Scheduler] Found ${dueReminders.length} due reminder(s) at ${now.toISOString()}`);
      }

      for (const reminder of dueReminders) {
        const babyName = reminder.baby.name;
        const payload = {
          title: reminder.title || `${babyName} 提醒`,
          body: reminder.body || '您有一条提醒',
          data: { url: '/', babyId: reminder.babyId },
        };

        console.log(`[Scheduler] Sending push for reminder ${reminder.id}, baby=${babyName}, source=${reminder.source}`);
        const results = await sendPushToBabyMembers(reminder.babyId, payload);
        console.log(`[Scheduler] Push results for reminder ${reminder.id}:`, JSON.stringify(results));

        await prisma.reminder.update({
          where: { id: reminder.id },
          data: { sent: true },
        });
        console.log(`[Scheduler] Marked reminder ${reminder.id} as sent`);
      }
    } catch (err) {
      console.error('[Scheduler] Error:', err);
    }
  });

  console.log('[Scheduler] Reminder scheduler started (every 5 minutes)');
}
