import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

function hoursAgo(h: number) {
  return new Date(Date.now() - h * 60 * 60 * 1000);
}

function daysAgo(d: number, hour = 12) {
  const date = new Date();
  date.setDate(date.getDate() - d);
  date.setHours(hour, 0, 0, 0);
  return date;
}

async function main() {
  const user = await prisma.user.create({
    data: {
      username: 'demo',
      password: 'demo123',
      displayName: '宝宝妈妈',
    },
  });

  const baby = await prisma.baby.create({
    data: {
      name: '小宝',
      gender: 'male',
      birthDate: new Date('2025-06-01'),
      members: {
        create: { userId: user.id, role: 'admin' },
      },
    },
  });

  const records = [
    // --- 今天 ---
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 12, rightMinutes: 8 }, occurredAt: hoursAgo(1) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 150 }, occurredAt: hoursAgo(4) },
    { category: 'feeding', type: 'water', data: { amountMl: 30 }, occurredAt: hoursAgo(2.5) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: hoursAgo(1.5) },
    { category: 'nursing', type: 'diaper', data: { type: 'both' }, occurredAt: hoursAgo(5) },
    { category: 'nursing', type: 'supplement', data: { name: '维生素D' }, occurredAt: hoursAgo(6) },
    { category: 'nursing', type: 'temperature', data: { value: 36.5, location: 'axillary' }, occurredAt: hoursAgo(7) },
    { category: 'nursing', type: 'temperature', data: { value: 36.8, location: 'forehead' }, occurredAt: hoursAgo(3) },
    { category: 'nursing', type: 'temperature', data: { value: 37.0, location: 'ear' }, occurredAt: hoursAgo(0.5) },
    { category: 'activity', type: 'sleep', data: { startTime: hoursAgo(3).toISOString(), durationMinutes: 90 }, occurredAt: hoursAgo(3) },
    { category: 'activity', type: 'play', data: {}, occurredAt: hoursAgo(1.5) },

    // --- 昨天 ---
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 12 }, occurredAt: daysAgo(1, 7) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'breast_milk', amountMl: 130 }, occurredAt: daysAgo(1, 10) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 8, rightMinutes: 10 }, occurredAt: daysAgo(1, 13) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 140 }, occurredAt: daysAgo(1, 16) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 15, rightMinutes: 5 }, occurredAt: daysAgo(1, 19) },
    { category: 'feeding', type: 'solid', data: { name: '米糊', amount: '半碗' }, occurredAt: daysAgo(1, 12) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(1, 8) },
    { category: 'nursing', type: 'diaper', data: { type: 'dirty' }, occurredAt: daysAgo(1, 11) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(1, 15) },
    { category: 'nursing', type: 'diaper', data: { type: 'both' }, occurredAt: daysAgo(1, 20) },
    { category: 'nursing', type: 'bath', data: {}, occurredAt: daysAgo(1, 18) },
    { category: 'nursing', type: 'temperature', data: { value: 36.3, location: 'axillary' }, occurredAt: daysAgo(1, 8) },
    { category: 'nursing', type: 'temperature', data: { value: 36.6, location: 'axillary' }, occurredAt: daysAgo(1, 14) },
    { category: 'nursing', type: 'temperature', data: { value: 36.9, location: 'ear' }, occurredAt: daysAgo(1, 20) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(1, 9).toISOString(), durationMinutes: 60 }, occurredAt: daysAgo(1, 9) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(1, 13).toISOString(), durationMinutes: 120 }, occurredAt: daysAgo(1, 13) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(1, 21).toISOString(), durationMinutes: 480 }, occurredAt: daysAgo(1, 21) },

    // --- 前天 ---
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 10 }, occurredAt: daysAgo(2, 6) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 120 }, occurredAt: daysAgo(2, 9) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 12, rightMinutes: 8 }, occurredAt: daysAgo(2, 12) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 140 }, occurredAt: daysAgo(2, 15) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 10 }, occurredAt: daysAgo(2, 18) },
    { category: 'feeding', type: 'water', data: { amountMl: 20 }, occurredAt: daysAgo(2, 11) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(2, 7) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(2, 10) },
    { category: 'nursing', type: 'diaper', data: { type: 'dirty' }, occurredAt: daysAgo(2, 14) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(2, 17) },
    { category: 'nursing', type: 'supplement', data: { name: '维生素D' }, occurredAt: daysAgo(2, 8) },
    { category: 'nursing', type: 'temperature', data: { value: 37.2, location: 'ear' }, occurredAt: daysAgo(2, 9) },
    { category: 'nursing', type: 'temperature', data: { value: 37.5, location: 'axillary' }, occurredAt: daysAgo(2, 15) },
    { category: 'nursing', type: 'temperature', data: { value: 37.1, location: 'forehead' }, occurredAt: daysAgo(2, 21) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(2, 9).toISOString(), durationMinutes: 45 }, occurredAt: daysAgo(2, 9) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(2, 13).toISOString(), durationMinutes: 90 }, occurredAt: daysAgo(2, 13) },
    { category: 'activity', type: 'play', data: {}, occurredAt: daysAgo(2, 16) },

    // --- 3天前 ---
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 130 }, occurredAt: daysAgo(3, 7) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 12 }, occurredAt: daysAgo(3, 10) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 150 }, occurredAt: daysAgo(3, 14) },
    { category: 'feeding', type: 'solid', data: { name: '蛋黄', amount: '四分之一' }, occurredAt: daysAgo(3, 12) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(3, 8) },
    { category: 'nursing', type: 'diaper', data: { type: 'both' }, occurredAt: daysAgo(3, 13) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(3, 19) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(3, 10).toISOString(), durationMinutes: 60 }, occurredAt: daysAgo(3, 10) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(3, 14).toISOString(), durationMinutes: 120 }, occurredAt: daysAgo(3, 14) },

    // --- 4-6天前（简略）---
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 10 }, occurredAt: daysAgo(4, 8) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 140 }, occurredAt: daysAgo(4, 14) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 8, rightMinutes: 12 }, occurredAt: daysAgo(4, 20) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(4, 9) },
    { category: 'nursing', type: 'diaper', data: { type: 'dirty' }, occurredAt: daysAgo(4, 16) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(4, 13).toISOString(), durationMinutes: 90 }, occurredAt: daysAgo(4, 13) },

    { category: 'feeding', type: 'bottle', data: { milkType: 'breast_milk', amountMl: 120 }, occurredAt: daysAgo(5, 7) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 12, rightMinutes: 10 }, occurredAt: daysAgo(5, 13) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 130 }, occurredAt: daysAgo(5, 19) },
    { category: 'nursing', type: 'diaper', data: { type: 'both' }, occurredAt: daysAgo(5, 10) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(5, 17) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(5, 12).toISOString(), durationMinutes: 75 }, occurredAt: daysAgo(5, 12) },

    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 8 }, occurredAt: daysAgo(6, 6) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 120 }, occurredAt: daysAgo(6, 11) },
    { category: 'feeding', type: 'breastfeed', data: { leftMinutes: 10, rightMinutes: 10 }, occurredAt: daysAgo(6, 17) },
    { category: 'feeding', type: 'bottle', data: { milkType: 'formula', amountMl: 140 }, occurredAt: daysAgo(6, 21) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(6, 8) },
    { category: 'nursing', type: 'diaper', data: { type: 'dirty' }, occurredAt: daysAgo(6, 14) },
    { category: 'nursing', type: 'diaper', data: { type: 'wet' }, occurredAt: daysAgo(6, 20) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(6, 9).toISOString(), durationMinutes: 60 }, occurredAt: daysAgo(6, 9) },
    { category: 'activity', type: 'sleep', data: { startTime: daysAgo(6, 14).toISOString(), durationMinutes: 120 }, occurredAt: daysAgo(6, 14) },
  ];

  await prisma.record.createMany({
    data: records.map((r) => ({
      babyId: baby.id,
      category: r.category,
      type: r.type,
      data: JSON.stringify(r.data),
      occurredAt: r.occurredAt,
      createdBy: user.id,
    })),
  });

  // Plans
  const now = new Date();
  await prisma.plan.createMany({
    data: [
      {
        babyId: baby.id,
        title: '乙肝疫苗第二针',
        type: 'vaccine',
        scheduledAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
        description: '出生后第一个月接种',
        createdBy: user.id,
      },
      {
        babyId: baby.id,
        title: '儿保体检',
        type: 'checkup',
        scheduledAt: new Date(now.getTime() + 14 * 24 * 60 * 60 * 1000),
        description: '42天体检',
        createdBy: user.id,
      },
      {
        babyId: baby.id,
        title: '脊灰疫苗',
        type: 'vaccine',
        scheduledAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
        description: '两个月接种',
        createdBy: user.id,
      },
    ],
  });

  // Growth records (multiple data points)
  await prisma.growthRecord.createMany({
    data: [
      { babyId: baby.id, date: new Date('2025-06-01'), height: 50, weight: 3.3, headCircumference: 34 },
      { babyId: baby.id, date: new Date('2025-06-15'), height: 52, weight: 3.8, headCircumference: 35 },
      { babyId: baby.id, date: new Date('2025-07-01'), height: 54, weight: 4.2, headCircumference: 36 },
      { babyId: baby.id, date: new Date('2025-07-15'), height: 56, weight: 4.8, headCircumference: 37 },
      { babyId: baby.id, date: new Date('2025-08-01'), height: 58, weight: 5.3, headCircumference: 38 },
      { babyId: baby.id, date: new Date('2025-09-01'), height: 61, weight: 6.0, headCircumference: 39 },
      { babyId: baby.id, date: new Date('2025-10-01'), height: 63, weight: 6.5, headCircumference: 40 },
      { babyId: baby.id, date: new Date('2025-11-01'), height: 65, weight: 7.0, headCircumference: 41 },
      { babyId: baby.id, date: new Date('2025-12-01'), height: 68, weight: 7.5, headCircumference: 42 },
      { babyId: baby.id, date: new Date('2026-01-01'), height: 70, weight: 8.0, headCircumference: 43 },
      { babyId: baby.id, date: new Date('2026-03-01'), height: 73, weight: 8.5, headCircumference: 44 },
      { babyId: baby.id, date: new Date('2026-05-01'), height: 76, weight: 9.0, headCircumference: 45 },
      { babyId: baby.id, date: new Date('2026-07-01'), height: 78, weight: 9.3, headCircumference: 45.5 },
    ],
  });

  // Milestones
  await prisma.milestone.createMany({
    data: [
      { babyId: baby.id, type: 'smile', title: '第一次微笑', occurredAt: new Date('2025-07-10'), description: '看到妈妈时第一次露出笑容' },
      { babyId: baby.id, type: 'head_up', title: '能抬头了', occurredAt: new Date('2025-08-15'), description: '趴着时能稳稳抬起头' },
      { babyId: baby.id, type: 'roll_over', title: '第一次翻身', occurredAt: new Date('2025-10-01'), description: '从仰卧翻到俯卧' },
      { babyId: baby.id, type: 'first_tooth', title: '长第一颗牙', occurredAt: new Date('2025-12-20'), description: '下排门牙冒出' },
      { babyId: baby.id, type: 'crawl', title: '开始爬行', occurredAt: new Date('2026-02-01'), description: '可以独立向前爬' },
    ],
  });

  console.log('Seed completed!');
  console.log(`Demo user: username=demo, password=demo123`);
  console.log(`Baby: ${baby.name} (id: ${baby.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
