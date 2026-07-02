import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.create({
    data: {
      username: 'demo',
      password: 'demo123',
      displayName: '演示用户',
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

  const now = new Date();

  await prisma.record.createMany({
    data: [
      {
        babyId: baby.id,
        category: 'feeding',
        type: 'breastfeed',
        data: JSON.stringify({ leftMinutes: 15, rightMinutes: 10 }),
        occurredAt: new Date(now.getTime() - 2 * 60 * 60 * 1000),
        createdBy: user.id,
      },
      {
        babyId: baby.id,
        category: 'feeding',
        type: 'bottle',
        data: JSON.stringify({ milkType: 'formula', amountMl: 120 }),
        occurredAt: new Date(now.getTime() - 5 * 60 * 60 * 1000),
        createdBy: user.id,
      },
      {
        babyId: baby.id,
        category: 'nursing',
        type: 'diaper',
        data: JSON.stringify({ type: 'wet' }),
        occurredAt: new Date(now.getTime() - 1 * 60 * 60 * 1000),
        createdBy: user.id,
      },
      {
        babyId: baby.id,
        category: 'activity',
        type: 'sleep',
        data: JSON.stringify({ startTime: new Date(now.getTime() - 4 * 60 * 60 * 1000).toISOString(), durationMinutes: 90 }),
        occurredAt: new Date(now.getTime() - 4 * 60 * 60 * 1000),
        createdBy: user.id,
      },
    ],
  });

  await prisma.plan.create({
    data: {
      babyId: baby.id,
      title: '乙肝疫苗第二针',
      type: 'vaccine',
      scheduledAt: new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000),
      description: '出生后第一个月接种',
      createdBy: user.id,
    },
  });

  await prisma.growthRecord.create({
    data: {
      babyId: baby.id,
      date: new Date('2025-06-01'),
      height: 50,
      weight: 3.3,
      headCircumference: 34,
    },
  });

  console.log('Seed completed!');
  console.log(`Demo user: username=demo, password=demo123`);
  console.log(`Baby: ${baby.name} (id: ${baby.id})`);
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
