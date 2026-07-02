import { prisma } from './prisma';

export async function createAutoFeedingReminder(babyId: string) {
  console.log(`[AutoReminder] Computing prediction for baby ${babyId}`);

  const recentFeedings = await prisma.record.findMany({
    where: { babyId, category: 'feeding' },
    orderBy: { occurredAt: 'desc' },
    take: 30,
  });

  if (recentFeedings.length < 2) return;

  const parsed = recentFeedings.map((r) => ({
    ...r,
    parsedData: JSON.parse(r.data) as Record<string, any>,
  }));

  const bottleRates: number[] = [];
  const breastRates: number[] = [];

  for (let i = 0; i < parsed.length - 1; i++) {
    const current = parsed[i + 1];
    const next = parsed[i];
    const intervalMin = (next.occurredAt.getTime() - current.occurredAt.getTime()) / 60000;

    if (intervalMin <= 0 || intervalMin > 480) continue;

    if (current.type === 'bottle') {
      const ml = current.parsedData.amountMl;
      if (ml && ml > 0) bottleRates.push(intervalMin / ml);
    } else if (current.type === 'breastfeed') {
      const totalMin = (current.parsedData.leftMinutes || 0) + (current.parsedData.rightMinutes || 0);
      if (totalMin > 0) breastRates.push(intervalMin / totalMin);
    }
  }

  const lastFeeding = parsed[0];
  const lastFeedingTime = lastFeeding.occurredAt.getTime();
  let predictedInterval: number | null = null;

  if (lastFeeding.type === 'bottle' && bottleRates.length >= 2) {
    const avgRate = bottleRates.reduce((a, b) => a + b, 0) / bottleRates.length;
    const ml = lastFeeding.parsedData.amountMl || 0;
    predictedInterval = Math.round(avgRate * ml);
  } else if (lastFeeding.type === 'breastfeed' && breastRates.length >= 2) {
    const avgRate = breastRates.reduce((a, b) => a + b, 0) / breastRates.length;
    const totalMin = (lastFeeding.parsedData.leftMinutes || 0) + (lastFeeding.parsedData.rightMinutes || 0);
    predictedInterval = Math.round(avgRate * totalMin);
  }

  if (predictedInterval === null) {
    const intervals: number[] = [];
    for (let i = 0; i < parsed.length - 1; i++) {
      const diff = parsed[i].occurredAt.getTime() - parsed[i + 1].occurredAt.getTime();
      const min = diff / 60000;
      if (min > 0 && min <= 480) intervals.push(min);
    }
    if (intervals.length >= 2) {
      predictedInterval = Math.round(intervals.reduce((a, b) => a + b, 0) / intervals.length);
    }
  }

  if (predictedInterval === null) return;

  const remindAt = new Date(lastFeedingTime + predictedInterval * 60000);

  if (remindAt.getTime() <= Date.now()) {
    console.log(`[AutoReminder] Predicted time ${remindAt.toISOString()} is in the past, skipping`);
    return;
  }

  // Remove old unsent auto reminders for this baby
  await prisma.reminder.deleteMany({
    where: { babyId, source: 'feeding_auto', sent: false },
  });

  const reminder = await prisma.reminder.create({
    data: {
      babyId,
      remindAt,
      source: 'feeding_auto',
      title: '喂奶提醒',
      body: '根据喂养规律，宝宝预计需要喂奶了',
    },
  });

  console.log(`[AutoReminder] Created reminder ${reminder.id} for baby ${babyId}, remindAt=${remindAt.toISOString()} (in ${predictedInterval} min)`);
}
