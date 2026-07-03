import { prisma } from './prisma';

// 家庭共享模型：所有用户共享所有宝宝。
// 注意：SQLite 的 createMany 不支持 skipDuplicates，这里先查已有关系再只创建缺失的，保证幂等。

const DEFAULT_ROLE = 'editor';

// 将某用户加入所有已存在的宝宝
export async function addUserToAllBabies(userId: string, role: string = DEFAULT_ROLE): Promise<void> {
  const babies = await prisma.baby.findMany({ select: { id: true } });
  if (babies.length === 0) return;

  const existing = await prisma.babyMember.findMany({ where: { userId }, select: { babyId: true } });
  const have = new Set(existing.map((m) => m.babyId));

  const toCreate = babies
    .filter((b) => !have.has(b.id))
    .map((b) => ({ userId, babyId: b.id, role }));

  if (toCreate.length > 0) {
    await prisma.babyMember.createMany({ data: toCreate });
  }
}

// 将某宝宝分享给所有已存在的用户（已是成员的会跳过，例如创建者）
export async function addBabyToAllUsers(babyId: string, role: string = DEFAULT_ROLE): Promise<void> {
  const users = await prisma.user.findMany({ select: { id: true } });
  if (users.length === 0) return;

  const existing = await prisma.babyMember.findMany({ where: { babyId }, select: { userId: true } });
  const have = new Set(existing.map((m) => m.userId));

  const toCreate = users
    .filter((u) => !have.has(u.id))
    .map((u) => ({ userId: u.id, babyId, role }));

  if (toCreate.length > 0) {
    await prisma.babyMember.createMany({ data: toCreate });
  }
}

// 回填：确保每个用户都是每个宝宝的成员（用于修复历史数据）
export async function ensureAllMemberships(): Promise<void> {
  const [users, babies] = await Promise.all([
    prisma.user.findMany({ select: { id: true } }),
    prisma.baby.findMany({ select: { id: true } }),
  ]);
  if (users.length === 0 || babies.length === 0) return;

  const existing = await prisma.babyMember.findMany({ select: { userId: true, babyId: true } });
  const have = new Set(existing.map((m) => `${m.userId}:${m.babyId}`));

  const toCreate: { userId: string; babyId: string; role: string }[] = [];
  for (const u of users) {
    for (const b of babies) {
      if (!have.has(`${u.id}:${b.id}`)) {
        toCreate.push({ userId: u.id, babyId: b.id, role: DEFAULT_ROLE });
      }
    }
  }

  if (toCreate.length > 0) {
    await prisma.babyMember.createMany({ data: toCreate });
    console.log(`[Membership] Backfilled ${toCreate.length} baby membership(s)`);
  }
}
