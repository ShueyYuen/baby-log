// ===== 记录模块类型 =====

export type RecordCategory = 'feeding' | 'nursing' | 'activity';

export type FeedingType = 'breastfeed' | 'bottle' | 'solid' | 'water';
export type NursingType = 'diaper' | 'bath' | 'supplement';
export type ActivityType = 'sleep' | 'play' | 'other';

export type RecordSubType = FeedingType | NursingType | ActivityType;

export interface BreastfeedData {
  leftMinutes?: number;
  rightMinutes?: number;
}

export interface BottleData {
  milkType: 'breast_milk' | 'formula';
  amountMl: number;
}

export interface SolidData {
  name: string;
  amount?: string;
}

export interface WaterData {
  amountMl: number;
}

export interface DiaperData {
  type: 'wet' | 'dirty' | 'both';
}

export interface SleepData {
  startTime: string;
  endTime?: string;
  durationMinutes?: number;
}

export interface SupplementData {
  name: string;
}

export type RecordData =
  | BreastfeedData
  | BottleData
  | SolidData
  | WaterData
  | DiaperData
  | SleepData
  | SupplementData
  | Record<string, unknown>;

export interface BabyRecord {
  id: string;
  babyId: string;
  category: RecordCategory;
  type: RecordSubType;
  data: RecordData;
  occurredAt: string;
  note?: string;
  images?: string[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateRecordInput {
  babyId: string;
  category: RecordCategory;
  type: RecordSubType;
  data: RecordData;
  occurredAt: string;
  note?: string;
  images?: string[];
}

export interface UpdateRecordInput {
  category?: RecordCategory;
  type?: RecordSubType;
  data?: RecordData;
  occurredAt?: string;
  note?: string;
  images?: string[];
}

// ===== 计划模块类型 =====

export type PlanType = 'vaccine' | 'doctor' | 'checkup' | 'medicine' | 'custom';
export type PlanStatus = 'pending' | 'completed' | 'cancelled' | 'postponed';

export interface Plan {
  id: string;
  babyId: string;
  title: string;
  type: PlanType;
  scheduledAt: string;
  description?: string;
  reminder?: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';
  status: PlanStatus;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreatePlanInput {
  babyId: string;
  title: string;
  type: PlanType;
  scheduledAt: string;
  description?: string;
  reminder?: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';
}

export interface UpdatePlanInput {
  title?: string;
  type?: PlanType;
  scheduledAt?: string;
  description?: string;
  reminder?: string;
  repeat?: 'none' | 'daily' | 'weekly' | 'monthly';
  status?: PlanStatus;
}

// ===== 成长模块类型 =====

export interface GrowthRecord {
  id: string;
  babyId: string;
  date: string;
  height?: number;
  weight?: number;
  headCircumference?: number;
  note?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateGrowthInput {
  babyId: string;
  date: string;
  height?: number;
  weight?: number;
  headCircumference?: number;
  note?: string;
}

export type MilestoneType =
  | 'roll_over'
  | 'smile'
  | 'head_up'
  | 'sleep_through'
  | 'first_tooth'
  | 'crawl'
  | 'walk'
  | 'custom';

export interface Milestone {
  id: string;
  babyId: string;
  type: MilestoneType;
  title: string;
  occurredAt: string;
  description?: string;
  images?: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateMilestoneInput {
  babyId: string;
  type: MilestoneType;
  title: string;
  occurredAt: string;
  description?: string;
  images?: string[];
}

// ===== 宝宝管理 =====

export interface Baby {
  id: string;
  name: string;
  gender: 'male' | 'female';
  birthDate: string;
  avatar?: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateBabyInput {
  name: string;
  gender: 'male' | 'female';
  birthDate: string;
  avatar?: string;
}

// ===== 用户 =====

export interface User {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

// ===== API 响应 =====

export interface ApiResponse<T> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
}

export interface PaginatedResponse<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ===== 统计类型 =====

export interface DailyStats {
  date: string;
  feedingCount: number;
  diaperCount: number;
  sleepMinutes: number;
  feedingDetails: {
    breastfeed: number;
    bottle: number;
    solid: number;
  };
}

export interface TimelineSummary {
  lastFeeding?: { time: string; minutesAgo: number };
  lastDiaper?: { time: string; minutesAgo: number };
  lastSleep?: { time: string; minutesAgo: number };
}
