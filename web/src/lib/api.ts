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
  mediaType?: 'image' | 'video';
  url: string;
  rawUrl?: string;
  visibleTo?: string[];
}

// ─── Moments types ────────────────────────────────────────────────────────────

export interface MediaItem {
  key: string;
  rawKey?: string;
  mediaType: 'image' | 'video';
  visibleTo?: string[];
}

export interface MediaItemDisplay extends MediaItem {
  url: string;
  rawUrl?: string;
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
  mediaType: 'image' | 'video';
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
  user?: { displayName: string };
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

// ─── Upload helper ────────────────────────────────────────────────────────────

function createUploader(endpoint: string) {
  return (file: File, onProgress?: (percent: number) => void): Promise<UploadMomentResult> =>
    new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('files', file);

      if (onProgress) {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
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
      if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      xhr.send(formData);
    });
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

    createEntry: (conditionId: string, data: { date: string; note?: string; images?: Array<{ key: string; rawKey?: string; mediaType?: string; visibleTo?: string[] }> }, idempotencyKey?: string) =>
      api.post<{ success: boolean; data: HealthEntry }>(`/health-conditions/${conditionId}/entries`, data, idempotencyKey),

    updateEntry: (conditionId: string, entryId: string, data: { date?: string; note?: string | null; images?: Array<{ key: string; rawKey?: string; mediaType?: string; visibleTo?: string[] }> }) =>
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
};
