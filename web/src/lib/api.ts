import { isLargeFile, toUploadableFile, uploadLargeFile } from './chunked-upload';
import { attachVideoPoster, capturePosterInBackground } from './video-poster';

const API_BASE = '/api/v1';

function getToken(): string | null {
  return localStorage.getItem('token');
}

export function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

async function request<T>(url: string, options: RequestInit = {}): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    ...(options.headers as Record<string, string>),
  };

  if (!(options.body instanceof FormData) && !headers['Content-Type']) {
    headers['Content-Type'] = 'application/json';
  }

  // Fallback: keep Authorization header for backward compatibility
  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(`${API_BASE}${url}`, {
    ...options,
    headers,
    credentials: 'same-origin',
  });
  const data = await res.json();

  if (!res.ok) {
    throw new Error(data.error || 'Request failed');
  }

  return data;
}

// ─── Shared upload types ──────────────────────────────────────────────────────

export interface RecordImage {
  key: string;
  rawKey?: string;
  posterKey?: string;
  mediaType?: 'image' | 'video';
  url: string;
  rawUrl?: string;
  posterUrl?: string;
  visibleTo?: string[];
  processing?: boolean;
}

// ─── Moments types ────────────────────────────────────────────────────────────

export interface MediaItem {
  key: string;
  rawKey?: string;
  posterKey?: string;
  mediaType: 'image' | 'video';
  visibleTo?: string[];
}

export interface MediaItemDisplay extends MediaItem {
  url: string;
  rawUrl?: string;
  posterUrl?: string;
  processing?: boolean;
}

export interface MomentComment {
  id: string;
  momentId: string;
  userId: string;
  displayName: string;
  avatar?: string | null;
  content: string;
  createdAt: string;
}

export interface Moment {
  id: string;
  userId: string;
  displayName: string;
  avatar?: string | null;
  content: string | null;
  mediaItems: MediaItemDisplay[];
  likeCount: number;
  liked: boolean;
  commentCount: number;
  comments: MomentComment[];
  createdAt: string;
  updatedAt: string;
  isOwner: boolean;
}

export interface MomentsListResponse {
  items: Moment[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UploadMomentResult {
  url: string;
  key: string;
  rawUrl?: string;
  rawKey?: string;
  posterKey?: string;
  posterUrl?: string;
  mediaType: 'image' | 'video';
  processing?: boolean;
}

export function toStoredMedia(
  result: Pick<UploadMomentResult, 'key' | 'rawKey' | 'mediaType' | 'posterKey'>,
  extra?: { visibleTo?: string[] },
) {
  return {
    key: toStorageKey(result.key) || result.key,
    rawKey: result.rawKey ? toStorageKey(result.rawKey) : result.rawKey,
    mediaType: result.mediaType,
    posterKey: result.posterKey ? toStorageKey(result.posterKey) : result.posterKey,
    visibleTo: extra?.visibleTo?.length ? extra.visibleTo : undefined,
  };
}

function toStorageKey(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) return trimmed;
  const prefix = '/api/v1/uploads/';
  if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length);
  try {
    const u = new URL(trimmed);
    const path = u.pathname.replace(/^\/+/, '');
    const uploads = 'api/v1/uploads/';
    const idx = path.indexOf(uploads);
    if (idx >= 0) return path.slice(idx + uploads.length);
    return path;
  } catch {
    return trimmed.replace(/^\/+/, '');
  }
}

// ─── Timeline types ──────────────────────────────────────────────────────────

export interface TimelineSummary {
  lastFeeding: { time: string; minutesAgo: number } | null;
  lastDiaper: { time: string; minutesAgo: number } | null;
  lastSleep: { time: string; minutesAgo: number } | null;
}

export interface FeedingPrediction {
  minutesUntilNext: number | null;
  avgIntervalMinutes: number | null;
  method: 'bottle' | 'breastfeed' | 'average' | null;
}

export interface TimelineRecord {
  id: string;
  category: string;
  type: string;
  data: any;
  occurredAt: string;
  note?: string;
  images?: RecordImage[];
  createdBy?: string;
  user?: { id?: string; displayName: string };
}

export interface DailySummary {
  date: string;
  feedingCount: number;
  diaperCount: number;
  peeCount: number;
  poopCount: number;
  sleepMinutes: number;
  bottleAmountMl?: number;
  feedingDetails: { breastfeed: number; bottle: number; solid: number };
}

export interface TimelineResponse {
  records: TimelineRecord[];
  summary?: TimelineSummary;
  prediction?: FeedingPrediction;
  hasMore: boolean;
}

export interface Member {
  id: string;
  displayName: string;
  avatar?: string | null;
}

// ─── Health Conditions types ────────────────────────────────────────────────

export interface HealthCondition {
  id: string;
  babyId: string;
  name: string;
  description?: string | null;
  status: 'active' | 'resolved';
  entryCount: number;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthEntry {
  id: string;
  conditionId: string;
  date: string;
  note?: string | null;
  images: RecordImage[];
  annotations?: HealthAnnotationsMap;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface HealthAnnotation {
  id: string;
  type: 'angle' | 'line' | 'circle' | 'point';
  points: { x: number; y: number }[];
  value?: number;
  label?: string;
  color?: string;
}

export type HealthAnnotationsMap = Record<string, HealthAnnotation[]>;

export interface HealthEntriesResponse {
  items: HealthEntry[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

export interface MilkInventoryItem {
  id: string;
  babyId: string;
  amountMl: number;
  storageType: 'fridge' | 'freezer';
  storedAt: string;
  expiresAt: string;
  status: 'available' | 'used' | 'expired' | 'discarded';
  note?: string | null;
  createdAt: string;
  updatedAt: string;
}

// ─── Medical Visit types ──────────────────────────────────────────────────────

export interface MedicalVisitImage {
  key: string;
  rawKey?: string;
  mediaType?: 'image' | 'video';
  url?: string;
  rawUrl?: string;
}

export interface OcrDataItem {
  key: string;
  text: string;
}

export interface MedicalVisit {
  id: string;
  babyId: string;
  visitDate: string;
  hospital: string;
  department: string;
  doctor: string;
  diagnosis: string;
  prescription: string;
  notes: string;
  images: MedicalVisitImage[];
  ocrText: string;
  ocrData: OcrDataItem[];
  createdBy: string;
  createdAt: string;
  updatedAt: string;
}

export interface MedicalVisitInput {
  babyId: string;
  visitDate?: string;
  hospital?: string;
  department?: string;
  doctor?: string;
  diagnosis?: string;
  prescription?: string;
  notes?: string;
  images?: MedicalVisitImage[];
  ocrText?: string;
  ocrData?: OcrDataItem[];
}

export interface MedicalVisitsListResponse {
  items: MedicalVisit[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Plan types ──────────────────────────────────────────────────────────────

export interface PlanItem {
  id: string;
  babyId: string;
  title: string;
  type: string;
  scheduledAt: string;
  status: string;
  description?: string;
  reminder: number;
  repeat: string;
  images?: RecordImage[];
  createdAt: string;
  updatedAt: string;
}

export interface PlanListResponse {
  items: PlanItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}

// ─── Growth types ────────────────────────────────────────────────────────────

export interface GrowthItem {
  id: string;
  date: string;
  height?: number;
  weight?: number;
  headCircumference?: number;
  note?: string;
}

export interface GrowthListResponse {
  items: GrowthItem[];
  total: number;
  hasMore: boolean;
}

// ─── Milestone types ─────────────────────────────────────────────────────────

export interface MilestoneItem {
  id: string;
  type: string;
  title: string;
  occurredAt: string;
  description?: string;
  images?: RecordImage[];
}

export interface MilestoneListResponse {
  items: MilestoneItem[];
  hasMore?: boolean;
}

// ─── Auth / User types ───────────────────────────────────────────────────────

export interface UserItem {
  id: string;
  username: string;
  displayName: string;
  role: string;
  createdAt: string;
  avatar?: string | null;
}

export interface AdminUploadItem {
  key: string;
  rawKey?: string;
  createdAt: string;
  used: boolean;
  ready: boolean;
  mediaType: 'image' | 'video';
  poster?: boolean;
  referenced: boolean;
  local: boolean;
  size: number;
  url?: string;
  posterUrl?: string;
  phase?: string;
}

export interface AdminUploadsResponse {
  items: AdminUploadItem[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
  counts: { total: number; unready: number; unused: number; videos: number };
  worker: { key: string; phase: string; elapsedMs: number; waitedMs: number } | null;
  queued: number;
  transcodeEnabled: boolean;
  storageType?: 'local' | 's3';
}

export interface AdminStorageReindexResult {
  listed: number;
  postersIndexed: number;
  sizesUpdated: number;
  tracked: number;
  skippedRecent: number;
  skippedReferenced: number;
  found: number;
  deleted: number;
  bytes: number;
  listRequests: number;
  truncated?: boolean;
  items: { key: string; size: number; lastModified: number }[];
  errors?: string[];
}

// ─── Baby type ───────────────────────────────────────────────────────────────

export interface Baby {
  id: string;
  name: string;
  gender: string;
  birthDate: string;
  avatar?: string | null;
}

// ─── Upload helper ────────────────────────────────────────────────────────────

function uploadSmallFile(
  file: File,
  endpoint: string,
  onProgress?: (percent: number) => void,
): Promise<UploadMomentResult> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const formData = new FormData();
    formData.append('files', file);

    if (onProgress) {
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) onProgress(Math.min(99, Math.round((e.loaded / e.total) * 100)));
      });
    }

    xhr.addEventListener('load', () => {
      try {
        const data = JSON.parse(xhr.responseText);
        if (xhr.status >= 200 && xhr.status < 300 && data.data?.length) {
          resolve(data.data[0]);
        } else {
          reject(new Error(data.error || 'Upload failed'));
        }
      } catch {
        reject(new Error('Upload failed'));
      }
    });

    xhr.addEventListener('error', () => reject(new Error('Network error')));
    xhr.addEventListener('abort', () => reject(new Error('Upload aborted')));

    xhr.open('POST', `${API_BASE}${endpoint}`);
    xhr.withCredentials = true;
    const token = getToken();
    if (token) xhr.setRequestHeader('Authorization', 'Bearer ' + token);
    xhr.send(formData);
  });
}

function createUploader(endpoint: string) {
  const prefix = endpoint.replace(/^\/upload\//, '');

  return async (file: File, onProgress?: (percent: number) => void): Promise<UploadMomentResult> => {
    const prepared = await toUploadableFile(file);
    const posterTask = capturePosterInBackground(prepared);
    const result = isLargeFile(prepared)
      ? await uploadLargeFile(prepared, prefix, onProgress)
      : await uploadSmallFile(prepared, endpoint, onProgress);
    return attachVideoPoster(prepared, result, await posterTask);
  };
}

// ─── API client ───────────────────────────────────────────────────────────────

export const api = {
  get: <T>(url: string) => request<T>(url),
  post: <T>(url: string, body: unknown, idempotencyKey?: string) =>
    request<T>(url, {
      method: 'POST',
      body: body instanceof FormData ? body : JSON.stringify(body),
      headers: idempotencyKey ? { 'X-Idempotency-Key': idempotencyKey } : undefined,
    }),
  put: <T>(url: string, body: unknown) =>
    request<T>(url, {
      method: 'PUT',
      body: body instanceof FormData ? body : JSON.stringify(body),
    }),
  delete: <T>(url: string) => request<T>(url, { method: 'DELETE' }),

  moments: {
    list: (page = 1, pageSize = 10) =>
      api.get<{ success: boolean; data: MomentsListResponse }>(
        `/moments?page=${page}&pageSize=${pageSize}`
      ),

    create: (data: { content?: string; mediaItems?: MediaItem[] }, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: Moment }>('/moments', data, idempotencyKey),

    update: (id: string, data: { content?: string; mediaItems?: MediaItem[] }) =>
      api.put<{ success: boolean; data: { id: string } }>(`/moments/${id}`, data),

    delete: (id: string) =>
      api.delete<{ success: boolean; data: { id: string } }>(`/moments/${id}`),

    addComment: (momentId: string, content: string, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: MomentComment }>(
        `/moments/${momentId}/comments`,
        { content },
        idempotencyKey,
      ),

    deleteComment: (momentId: string, commentId: string) =>
      api.delete<{ success: boolean; data: { id: string } }>(
        `/moments/${momentId}/comments/${commentId}`
      ),

    toggleLike: (momentId: string) =>
      api.post<{ success: boolean; data: { liked: boolean; likeCount: number } }>(
        `/moments/${momentId}/like`, {}
      ),

    uploadMediaSingle: createUploader('/upload/moments'),
  },

  members: {
    list: () => api.get<{ success: boolean; data: Member[] }>('/auth/members'),
  },

  healthConditions: {
    list: (babyId: string) =>
      api.get<{ success: boolean; data: HealthCondition[] }>(`/health-conditions?babyId=${babyId}`),

    create: (data: { babyId: string; name: string; description?: string }, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: HealthCondition }>('/health-conditions', data, idempotencyKey),

    update: (id: string, data: { name?: string; description?: string | null; status?: string }) =>
      api.put<{ success: boolean; data: HealthCondition }>(`/health-conditions/${id}`, data),

    delete: (id: string) =>
      api.delete<{ success: boolean }>(`/health-conditions/${id}`),

    listEntries: (conditionId: string, page = 1, pageSize = 20) =>
      api.get<{ success: boolean; data: HealthEntriesResponse }>(
        `/health-conditions/${conditionId}/entries?page=${page}&pageSize=${pageSize}`
      ),

    createEntry: (conditionId: string, data: { date: string; note?: string; images?: Array<{ key: string; rawKey?: string; mediaType?: string; posterKey?: string; visibleTo?: string[] }> }, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: HealthEntry }>(`/health-conditions/${conditionId}/entries`, data, idempotencyKey),

    updateEntry: (conditionId: string, entryId: string, data: { date?: string; note?: string | null; images?: Array<{ key: string; rawKey?: string; mediaType?: string; posterKey?: string; visibleTo?: string[] }> }) =>
      api.put<{ success: boolean; data: HealthEntry }>(`/health-conditions/${conditionId}/entries/${entryId}`, data),

    deleteEntry: (conditionId: string, entryId: string) =>
      api.delete<{ success: boolean }>(`/health-conditions/${conditionId}/entries/${entryId}`),

    uploadMedia: createUploader('/upload/health'),
  },

  milestones: {
    uploadMedia: createUploader('/upload/milestones'),
  },

  records: {
    uploadMedia: createUploader('/upload/records'),
  },

  plans: {
    uploadMedia: createUploader('/upload/plans'),
  },

  medicalVisits: {
    list: (babyId: string, opts?: { q?: string; page?: number; pageSize?: number }) =>
      api.get<{ success: boolean; data: MedicalVisitsListResponse }>(
        `/medical-visits?babyId=${babyId}${opts?.q ? `&q=${encodeURIComponent(opts.q)}` : ''}${opts?.page ? `&page=${opts.page}` : ''}${opts?.pageSize ? `&pageSize=${opts.pageSize}` : ''}`
      ),

    get: (id: string) =>
      api.get<{ success: boolean; data: MedicalVisit }>(`/medical-visits/${id}`),

    create: (data: MedicalVisitInput, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: MedicalVisit }>('/medical-visits', data, idempotencyKey),

    update: (id: string, data: Partial<MedicalVisitInput>) =>
      api.put<{ success: boolean; data: MedicalVisit }>(`/medical-visits/${id}`, data),

    delete: (id: string) =>
      api.delete<{ success: boolean }>(`/medical-visits/${id}`),

    uploadMedia: createUploader('/upload/medical'),

    runOcr: (id: string) =>
      api.post<{ success: boolean; data: { ocrText: string; ocrData: OcrDataItem[]; imageCount: number; recognized: number } }>(
        `/medical-visits/${id}/ocr`, {}
      ),
  },

  ocr: {
    status: () => api.get<{ success: boolean; data: { available: boolean } }>('/ocr/status'),
    recognize: (images: { key: string; rawKey?: string }[]) =>
      api.post<{ success: boolean; data: { ocrText: string; ocrData: OcrDataItem[]; imageCount: number; recognized: number } }>(
        '/ocr/recognize', { images }
      ),
  },

  milkInventory: {
    list: (babyId: string, status?: string) =>
      api.get<{ success: boolean; data: MilkInventoryItem[] }>(
        `/milk-inventory?babyId=${babyId}${status ? `&status=${status}` : ''}`
      ),

    create: (
      data: { babyId: string; amountMl: number; storageType: 'fridge' | 'freezer'; storedAt?: string; note?: string },
      idempotencyKey?: string,
    ) => api.post<{ success: boolean; data: MilkInventoryItem }>('/milk-inventory', data, idempotencyKey),

    update: (id: string, data: { status?: string; note?: string | null }) =>
      api.put<{ success: boolean; data: MilkInventoryItem }>(`/milk-inventory/${id}`, data),

    delete: (id: string) => api.delete<{ success: boolean }>(`/milk-inventory/${id}`),
  },

  timeline: {
    list: (babyId: string, opts?: {
      pageSize?: number;
      before?: number;
      category?: string;
      type?: string;
      search?: string;
      hasImages?: boolean;
      createdBy?: string;
      startDate?: string;
      endDate?: string;
    }) => {
      const params = new URLSearchParams({ babyId, pageSize: String(opts?.pageSize ?? 50) });
      if (opts?.before) params.set('before', String(opts.before));
      if (opts?.category && opts.category !== 'all') params.set('category', opts.category);
      if (opts?.type && opts.type !== 'all') params.set('type', opts.type);
      if (opts?.search) params.set('search', opts.search);
      if (opts?.hasImages) params.set('hasImages', 'true');
      if (opts?.createdBy) params.set('createdBy', opts.createdBy);
      if (opts?.startDate) params.set('startDate', opts.startDate);
      if (opts?.endDate) params.set('endDate', opts.endDate);
      return api.get<{ success: boolean; data: TimelineResponse }>(`/timeline?${params}`);
    },
  },

  recordsCrud: {
    list: (babyId: string, opts?: { type?: string; pageSize?: number }) => {
      const params = new URLSearchParams({ babyId, pageSize: String(opts?.pageSize ?? 100) });
      if (opts?.type) params.set('type', opts.type);
      return api.get<{ success: boolean; data: { items: TimelineRecord[] } }>(`/records?${params}`);
    },
    create: (data: Record<string, unknown>, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: TimelineRecord }>('/records', data, idempotencyKey),
    update: (id: string, data: Record<string, unknown>) =>
      api.put<{ success: boolean }>(`/records/${id}`, data),
    delete: (id: string) =>
      api.delete<{ success: boolean }>(`/records/${id}`),
  },

  plansCrud: {
    list: (babyId: string, opts?: { pageSize?: number; page?: number; status?: string; from?: string; to?: string }) => {
      const params = new URLSearchParams({ babyId, pageSize: String(opts?.pageSize ?? 20) });
      if (opts?.page) params.set('page', String(opts.page));
      if (opts?.status) params.set('status', opts.status);
      if (opts?.from) params.set('from', opts.from);
      if (opts?.to) params.set('to', opts.to);
      return api.get<{ success: boolean; data: PlanListResponse | PlanItem[] }>(`/plans?${params}`);
    },
    create: (data: Record<string, unknown>, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: PlanItem }>('/plans', data, idempotencyKey),
    update: (id: string, data: Record<string, unknown>) =>
      api.put<{ success: boolean; data: PlanItem }>(`/plans/${id}`, data),
    delete: (id: string) =>
      api.delete<{ success: boolean }>(`/plans/${id}`),
    generateVaccines: (babyId: string, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: { created: number } }>('/plans/vaccine-template', { babyId }, idempotencyKey),
  },

  growth: {
    list: (babyId: string, opts?: { page?: number; pageSize?: number }) => {
      const params = new URLSearchParams({ babyId });
      if (opts?.page) params.set('page', String(opts.page));
      if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
      return api.get<{ success: boolean; data: GrowthListResponse | GrowthItem[] }>(`/growth?${params}`);
    },
    create: (data: Record<string, unknown>, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: GrowthItem }>('/growth', data, idempotencyKey),
    update: (id: string, data: Record<string, unknown>) =>
      api.put<{ success: boolean; data: GrowthItem }>(`/growth/${id}`, data),
    delete: (id: string) =>
      api.delete<{ success: boolean }>(`/growth/${id}`),
  },

  milestonesCrud: {
    list: (babyId: string, opts?: { page?: number; pageSize?: number }) => {
      const params = new URLSearchParams({ babyId });
      if (opts?.page) params.set('page', String(opts.page));
      if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
      return api.get<{ success: boolean; data: MilestoneListResponse | MilestoneItem[] }>(`/milestones?${params}`);
    },
    create: (data: Record<string, unknown>, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: MilestoneItem }>('/milestones', data, idempotencyKey),
    update: (id: string, data: Record<string, unknown>) =>
      api.put<{ success: boolean; data: MilestoneItem }>(`/milestones/${id}`, data),
    delete: (id: string) =>
      api.delete<{ success: boolean }>(`/milestones/${id}`),
  },

  auth: {
    me: () => api.get<{ success: boolean; data: { id: string; username: string; displayName: string; role: string; avatar?: string | null } }>('/auth/me'),
    login: (username: string, password: string) =>
      api.post<{ success: boolean; data: { token: string; user: { id: string; username: string; displayName: string; role: string; avatar?: string | null } } }>('/auth/login', { username, password }),
    logout: () => api.post<{ success: boolean }>('/auth/logout', {}),
    changePassword: (currentPassword: string, newPassword: string) =>
      api.post<{ success: boolean }>('/auth/change-password', { currentPassword, newPassword }),
    listUsers: () => api.get<{ success: boolean; data: UserItem[] }>('/auth/users'),
    createUser: (data: { username: string; displayName: string; role: string }) =>
      api.post<{ success: boolean; data: { id: string; generatedPassword: string } }>('/auth/users', data),
    updateUser: (id: string, data: Record<string, unknown>) =>
      api.put<{ success: boolean }>(`/auth/users/${id}`, data),
    updateAvatar: (id: string, avatar: string | null) =>
      api.put<{ success: boolean }>(`/auth/users/${id}/avatar`, { avatar }),
    deleteUser: (id: string) =>
      api.delete<{ success: boolean }>(`/auth/users/${id}`),
  },

  admin: {
    listUploads: (opts?: { page?: number; pageSize?: number; status?: string; q?: string }) => {
      const params = new URLSearchParams();
      if (opts?.page) params.set('page', String(opts.page));
      if (opts?.pageSize) params.set('pageSize', String(opts.pageSize));
      if (opts?.status && opts.status !== 'all') params.set('status', opts.status);
      if (opts?.q) params.set('q', opts.q);
      const qs = params.toString();
      return api.get<{ success: boolean; data: AdminUploadsResponse }>(
        `/admin/uploads${qs ? `?${qs}` : ''}`,
      );
    },
    transcodeUpload: (body: { key?: string; allUnready?: boolean }) =>
      api.post<{ success: boolean; data: { queued: number; skipped?: number; alreadyActive?: boolean; key?: string } }>(
        '/admin/uploads/transcode',
        body,
      ),
    deleteUpload: (key: string, force = false) =>
      api.delete<{ success: boolean; data: { deleted: string } }>(
        `/admin/uploads?key=${encodeURIComponent(key)}${force ? '&force=1' : ''}`,
      ),
    cleanup: () =>
      api.post<{ success: boolean; data: { found: number; deleted: number; errors?: string[] } }>('/admin/cleanup', {}),
    reindexStorage: () =>
      api.post<{ success: boolean; data: AdminStorageReindexResult }>('/admin/storage/reindex', {}),
  },

  babies: {
    list: () => api.get<{ success: boolean; data: Baby[] }>('/babies'),
    create: (data: { name: string; gender: string; birthDate: string; avatar?: string }, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: Baby }>('/babies', data, idempotencyKey),
    update: (id: string, data: Record<string, unknown>) =>
      api.put<{ success: boolean; data: Baby }>(`/babies/${id}`, data),
  },

  stats: {
    range: (babyId: string, startDate: string, endDate: string, tz: number) =>
      api.get<{ success: boolean; data: unknown[] }>(`/stats/range?babyId=${babyId}&startDate=${startDate}&endDate=${endDate}&tz=${tz}`),
    daily: (babyId: string, date: string, tz: number) =>
      api.get<{ success: boolean; data: DailySummary }>(`/stats/daily?babyId=${babyId}&date=${date}&tz=${tz}`),
  },

  export: {
    baby: (babyId: string) =>
      api.get<{ success: boolean; data: { exportedAt: string; baby: Baby; records: TimelineRecord[]; plans: PlanItem[]; growth: GrowthItem[]; milestones: MilestoneItem[] } }>(`/export?babyId=${babyId}`),
  },

  push: {
    reminder: (data: { babyId: string; remindAt: string; source: string; title: string; body: string }, idempotencyKey?: string) =>
      api.post<{ success: boolean }>('/push/reminder', data, idempotencyKey),
  },
};
