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

export interface UploadResult {
  url: string;
  key: string;
  rawUrl?: string;
  rawKey?: string;
}

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

  upload: async (file: File) => {
    const formData = new FormData();
    formData.append('file', file);
    return api.post<{ success: boolean; data: UploadResult }>('/upload', formData);
  },

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

    uploadMedia: async (files: File[]): Promise<UploadMomentResult[]> => {
      const formData = new FormData();
      for (const file of files) {
        formData.append('files', file);
      }
      const res = await api.post<{ success: boolean; data: UploadMomentResult[] }>(
        '/moments/upload',
        formData
      );
      return res.data;
    },

    uploadMediaSingle: (
      file: File,
      onProgress?: (percent: number) => void,
    ): Promise<UploadMomentResult> => {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        const formData = new FormData();
        formData.append('files', file);

        if (onProgress) {
          xhr.upload.addEventListener('progress', (e) => {
            if (e.lengthComputable) {
              onProgress(Math.round((e.loaded / e.total) * 100));
            }
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

        xhr.open('POST', `${API_BASE}/moments/upload`);
        xhr.withCredentials = true;
        const token = getToken();
        if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
        xhr.send(formData);
      });
    },
  },

  members: {
    list: () => api.get<{ success: boolean; data: Member[] }>('/auth/members'),
  },
};
