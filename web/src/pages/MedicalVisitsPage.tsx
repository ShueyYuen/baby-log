import { useState, useEffect, useCallback, useRef } from 'react';
import { Link, useParams, useNavigate, useLocation } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  ArrowLeft,
  Plus,
  Search,
  X,
  Trash2,
  Edit3,
  ChevronRight,
  ImagePlus,
  FileText,
  Loader2,
  Hospital,
  Stethoscope,
} from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import {
  api,
  generateIdempotencyKey,
  type MedicalVisit,
  type MedicalVisitImage,
  type OcrDataItem,
  type UploadMomentResult,
} from '../lib/api';
import { cacheInvalidate, cacheRead, cacheWrite } from '../lib/queryCache';
import {
  Button,
  Card,
  CardContent,
  Badge,
  Input,
  Textarea,
  useToast,
  DatePicker,
  ImageViewer,
  type ViewerImage,
  ConfirmDialog,
} from '../components/ui';
import { Skeleton } from '../components/ui/skeleton';

const CACHE_KEY = 'medical-visits';

// ── List View ───────────────────────────────────────────────────────────────

function VisitListItem({
  visit,
  onClick,
}: {
  visit: MedicalVisit;
  onClick: () => void;
}) {
  const thumb = visit.images?.[0];
  return (
    <button
      onClick={onClick}
      className="w-full text-left bg-white dark:bg-gray-800 rounded-xl border border-gray-200 dark:border-gray-700 p-4 hover:border-primary-300 dark:hover:border-primary-600 transition-colors"
    >
      <div className="flex gap-3">
        {thumb?.url ? (
          <img
            src={thumb.url}
            alt=""
            className="w-16 h-16 rounded-lg object-cover shrink-0"
          />
        ) : (
          <div className="w-16 h-16 rounded-lg bg-blue-50 dark:bg-blue-900/30 flex items-center justify-center shrink-0">
            <Hospital size={24} className="text-blue-400" />
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-medium text-gray-900 dark:text-gray-100 truncate">
              {visit.hospital || '就诊记录'}
            </span>
            {visit.department && (
              <Badge variant="secondary" className="text-[10px] shrink-0">
                {visit.department}
              </Badge>
            )}
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-1">
            {dayjs(visit.visitDate).format('YYYY-MM-DD')}
            {visit.doctor ? ` · ${visit.doctor}` : ''}
          </p>
          {visit.diagnosis && (
            <p className="text-sm text-gray-600 dark:text-gray-300 truncate">
              {visit.diagnosis}
            </p>
          )}
        </div>
        <ChevronRight
          size={18}
          className="text-gray-300 dark:text-gray-600 shrink-0 mt-1"
        />
      </div>
    </button>
  );
}

function VisitList() {
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const navigate = useNavigate();
  const [visits, setVisits] = useState<MedicalVisit[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState('');
  const [searchOpen, setSearchOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [total, setTotal] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const fetchVisits = useCallback(
    async (p = 1, q = '', append = false) => {
      if (!currentBaby) return;
      setLoading(true);
      try {
        const res = await api.medicalVisits.list(currentBaby.id, {
          q: q || undefined,
          page: p,
          pageSize: 20,
        });
        const data = res.data;
        if (append) {
          setVisits((prev) => [...prev, ...data.items]);
        } else {
          setVisits(data.items);
        }
        setHasMore(data.hasMore);
        setTotal(data.total);
        setPage(p);
        if (!q && p === 1) {
          cacheWrite(CACHE_KEY, data.items);
        }
      } catch {
        toast('加载失败', 'error');
      } finally {
        setLoading(false);
      }
    },
    [currentBaby, toast],
  );

  useEffect(() => {
    if (!currentBaby) return;
    const cached = cacheRead<MedicalVisit[]>(CACHE_KEY);
    if (cached) {
      setVisits(cached);
      setLoading(false);
    }
    fetchVisits(1, '');
  }, [currentBaby?.id]);

  const handleSearch = useCallback(() => {
    fetchVisits(1, query);
  }, [fetchVisits, query]);

  const clearSearch = useCallback(() => {
    setQuery('');
    setSearchOpen(false);
    fetchVisits(1, '');
  }, [fetchVisits]);

  return (
    <div className="fixed inset-0 md:left-64 z-30 flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <Button variant="ghost" size="icon" asChild>
            <Link to="/growth">
              <ArrowLeft size={20} />
            </Link>
          </Button>
          {searchOpen ? (
            <div className="flex-1 flex items-center gap-2">
              <div className="flex-1 relative">
                <Search
                  size={16}
                  className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
                />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
                  placeholder="搜索医院、诊断、处方..."
                  className="w-full pl-9 pr-3 py-2 rounded-lg border border-gray-300 dark:border-gray-600 bg-gray-50 dark:bg-gray-700 text-sm focus:outline-none focus:ring-2 focus:ring-primary-400 dark:text-gray-100"
                  autoFocus
                />
              </div>
              <Button size="sm" onClick={handleSearch}>
                搜索
              </Button>
              <Button variant="ghost" size="icon" onClick={clearSearch}>
                <X size={18} />
              </Button>
            </div>
          ) : (
            <>
              <h2 className="flex-1 text-xl font-semibold dark:text-gray-100">
                就诊记录
              </h2>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => {
                  setSearchOpen(true);
                  setTimeout(() => searchInputRef.current?.focus(), 50);
                }}
              >
                <Search size={20} />
              </Button>
              {!isViewer && (
                <Button
                  size="sm"
                  onClick={() => navigate('/medical-visits/new')}
                >
                  <Plus size={16} className="mr-1" />
                  新建
                </Button>
              )}
            </>
          )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-3">
        {query && !loading && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            搜索 &quot;{query}&quot;，共 {total} 条结果
          </p>
        )}

        {loading && visits.length === 0 ? (
          <div className="space-y-3">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))}
          </div>
        ) : visits.length === 0 ? (
          <div className="text-center py-20 text-gray-400 dark:text-gray-500">
            <Hospital size={48} className="mx-auto mb-3 opacity-40" />
            <p>{query ? '没有找到匹配的记录' : '暂无就诊记录'}</p>
            {!query && !isViewer && (
              <Button
                className="mt-4"
                onClick={() => navigate('/medical-visits/new')}
              >
                添加就诊记录
              </Button>
            )}
          </div>
        ) : (
          <>
            {visits.map((v) => (
              <VisitListItem
                key={v.id}
                visit={v}
                onClick={() => navigate(`/medical-visits/${v.id}`)}
              />
            ))}
            {hasMore && (
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => fetchVisits(page + 1, query, true)}
                disabled={loading}
              >
                {loading ? '加载中...' : '加载更多'}
              </Button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Detail View ─────────────────────────────────────────────────────────────

function VisitDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isViewer } = useAuth();
  const [visit, setVisit] = useState<MedicalVisit | null>(null);
  const [loading, setLoading] = useState(true);
  const [showDelete, setShowDelete] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(0);
  const { toast } = useToast();

  useEffect(() => {
    if (!id) return;
    setLoading(true);
    api.medicalVisits
      .get(id)
      .then((res) => setVisit(res.data))
      .catch(() => toast('加载失败', 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!visit) return;
    try {
      await api.medicalVisits.delete(visit.id);
      cacheInvalidate(CACHE_KEY);
      toast('已删除', 'success');
      navigate('/medical-visits', { replace: true });
    } catch {
      toast('删除失败', 'error');
    }
  };

  const viewerImages: ViewerImage[] =
    visit?.images.map((img) => ({
      url: img.rawUrl || img.url || '',
    })) ?? [];

  if (loading) {
    return (
      <div className="fixed inset-0 md:left-64 z-30 bg-gray-50 dark:bg-gray-900 p-4">
        <Skeleton className="h-12 mb-4" />
        <Skeleton className="h-40 mb-4" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="fixed inset-0 md:left-64 z-30 bg-gray-50 dark:bg-gray-900 flex items-center justify-center">
        <p className="text-gray-400">记录不存在</p>
      </div>
    );
  }

  const fields = [
    { label: '医院', value: visit.hospital },
    { label: '科室', value: visit.department },
    { label: '医生', value: visit.doctor },
    { label: '诊断', value: visit.diagnosis },
    { label: '处方/用药', value: visit.prescription },
    { label: '备注', value: visit.notes },
  ].filter((f) => f.value);

  return (
    <div className="fixed inset-0 md:left-64 z-30 flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/medical-visits')}
          >
            <ArrowLeft size={20} />
          </Button>
          <h2 className="flex-1 text-xl font-semibold dark:text-gray-100 truncate">
            {visit.hospital || '就诊记录'}
          </h2>
          {!isViewer && (
            <div className="flex gap-2">
              <Button
                variant="ghost"
                size="icon"
                onClick={() =>
                  navigate(`/medical-visits/${visit.id}/edit`)
                }
              >
                <Edit3 size={18} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowDelete(true)}
              >
                <Trash2 size={18} className="text-red-500" />
              </Button>
            </div>
          )}
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Stethoscope size={16} />
          <span>{dayjs(visit.visitDate).format('YYYY年M月D日')}</span>
        </div>

        {fields.length > 0 && (
          <Card>
            <CardContent className="p-4 space-y-3">
              {fields.map((f) => (
                <div key={f.label}>
                  <p className="text-xs text-gray-400 dark:text-gray-500 mb-0.5">
                    {f.label}
                  </p>
                  <p className="text-sm text-gray-800 dark:text-gray-200 whitespace-pre-wrap">
                    {f.value}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {visit.images.length > 0 && (
          <Card>
            <CardContent className="p-4">
              <p className="text-xs text-gray-400 dark:text-gray-500 mb-2">
                图片 ({visit.images.length})
              </p>
              <div className="grid grid-cols-3 gap-2">
                {visit.images.map((img, i) => (
                  <button
                    key={img.key}
                    onClick={() => {
                      setViewerIdx(i);
                      setViewerOpen(true);
                    }}
                    className="aspect-square rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700"
                  >
                    <img
                      src={img.url}
                      alt=""
                      className="w-full h-full object-cover"
                    />
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {(visit.ocrData?.length > 0 || visit.ocrText) && (
          <div>
            <p className="text-xs text-gray-400 dark:text-gray-500 mb-3 flex items-center gap-1 px-1">
              <FileText size={14} />
              OCR 识别文本
            </p>
            {visit.ocrData?.length > 0 ? (
              <div className="space-y-4">
                {visit.ocrData.map((item, idx) => {
                  const img = visit.images.find((i) => i.key === item.key);
                  return (
                    <Card key={item.key || idx}>
                      <CardContent className="p-0 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-100 dark:border-gray-700">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            图片 {idx + 1}
                          </span>
                          {!item.text && (
                            <Badge variant="secondary" className="text-[10px] ml-auto">
                              未识别到文字
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row">
                          {img?.url && (
                            <div className="p-3 sm:w-1/2 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-gray-100 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
                              <img
                                src={img.rawUrl || img.url}
                                alt={`图片 ${idx + 1}`}
                                className="w-full object-contain rounded-lg cursor-pointer max-h-[60vh]"
                                onClick={() => {
                                  const imgIdx = visit.images.findIndex((i) => i.key === item.key);
                                  if (imgIdx >= 0) {
                                    setViewerIdx(imgIdx);
                                    setViewerOpen(true);
                                  }
                                }}
                              />
                            </div>
                          )}
                          {item.text && (
                            <div className="px-3 py-3 sm:flex-1 sm:min-w-0">
                              <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed break-words">
                                {item.text}
                              </p>
                            </div>
                          )}
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            ) : (
              <Card>
                <CardContent className="p-4">
                  <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap leading-relaxed">
                    {visit.ocrText}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>

      <ConfirmDialog
        open={showDelete}
        onOpenChange={setShowDelete}
        title="确认删除"
        description="删除后无法恢复，确定要删除这条就诊记录吗？"
        confirmLabel="删除"
        variant="danger"
        onConfirm={handleDelete}
      />

      <ImageViewer
        images={viewerImages}
        initialIndex={viewerIdx}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}

// ── Form View ───────────────────────────────────────────────────────────────

interface UploadingImage {
  id: string;
  file: File;
  previewUrl: string;
  progress: number;
  result?: UploadMomentResult;
}

function VisitForm() {
  const { id } = useParams<{ id: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const { currentBaby } = useBaby();
  const { toast } = useToast();

  const [visitDate, setVisitDate] = useState(dayjs().format('YYYY-MM-DD'));
  const [hospital, setHospital] = useState('');
  const [department, setDepartment] = useState('');
  const [doctor, setDoctor] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [prescription, setPrescription] = useState('');
  const [notes, setNotes] = useState('');
  const [existingImages, setExistingImages] = useState<MedicalVisitImage[]>([]);
  const [uploads, setUploads] = useState<UploadingImage[]>([]);
  const [ocrText, setOcrText] = useState('');
  const [ocrData, setOcrData] = useState<OcrDataItem[]>([]);
  const [saving, setSaving] = useState(false);
  const [loadingVisit, setLoadingVisit] = useState(isEdit);
  const [ocrRunning, setOcrRunning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!id) return;
    api.medicalVisits
      .get(id)
      .then((res) => {
        const v = res.data;
        setVisitDate(dayjs(v.visitDate).format('YYYY-MM-DD'));
        setHospital(v.hospital);
        setDepartment(v.department);
        setDoctor(v.doctor);
        setDiagnosis(v.diagnosis);
        setPrescription(v.prescription);
        setNotes(v.notes);
        setExistingImages(v.images);
        setOcrText(v.ocrText);
        setOcrData(v.ocrData || []);
      })
      .catch(() => toast('加载失败', 'error'))
      .finally(() => setLoadingVisit(false));
  }, [id]);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newUploads: UploadingImage[] = Array.from(files).map((file) => ({
      id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
      file,
      previewUrl: URL.createObjectURL(file),
      progress: 0,
    }));
    setUploads((prev) => [...prev, ...newUploads]);

    for (const up of newUploads) {
      try {
        const result = await api.medicalVisits.uploadMedia(up.file, (p) => {
          setUploads((prev) =>
            prev.map((u) => (u.id === up.id ? { ...u, progress: p } : u)),
          );
        });
        setUploads((prev) =>
          prev.map((u) =>
            u.id === up.id ? { ...u, progress: 100, result } : u,
          ),
        );
      } catch {
        toast('图片上传失败', 'error');
        setUploads((prev) => prev.filter((u) => u.id !== up.id));
      }
    }

    e.target.value = '';
  };

  const removeUpload = (uploadId: string) => {
    setUploads((prev) => {
      const up = prev.find((u) => u.id === uploadId);
      if (up) URL.revokeObjectURL(up.previewUrl);
      return prev.filter((u) => u.id !== uploadId);
    });
  };

  const removeExistingImage = (key: string) => {
    setExistingImages((prev) => prev.filter((img) => img.key !== key));
  };

  const [ocrAvailable, setOcrAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    api.ocr.status().then((res) => setOcrAvailable(res.data.available)).catch(() => setOcrAvailable(false));
  }, []);

  const buildAllImages = (): MedicalVisitImage[] => [
    ...existingImages.map((img) => ({
      key: img.key,
      rawKey: img.rawKey,
      mediaType: img.mediaType,
    })),
    ...uploads
      .filter((u) => u.result)
      .map((u) => ({
        key: u.result!.key,
        rawKey: u.result!.rawKey,
        mediaType: u.result!.mediaType,
      })),
  ];

  const saveVisit = async (): Promise<string | null> => {
    if (!currentBaby) return null;
    const allImages = buildAllImages();
    try {
      if (isEdit && id) {
        await api.medicalVisits.update(id, {
          visitDate: new Date(visitDate).toISOString(),
          hospital, department, doctor, diagnosis, prescription, notes,
          images: allImages, ocrText,
          ocrData: ocrData.length > 0 ? ocrData : undefined,
        });
        return id;
      } else {
        const res = await api.medicalVisits.create({
          babyId: currentBaby.id,
          visitDate: new Date(visitDate).toISOString(),
          hospital, department, doctor, diagnosis, prescription, notes,
          images: allImages, ocrText,
          ocrData: ocrData.length > 0 ? ocrData : undefined,
        }, generateIdempotencyKey());
        return res.data.id;
      }
    } catch {
      return null;
    }
  };

  const runOcr = async () => {
    const pendingUploads = uploads.some((u) => !u.result);
    if (pendingUploads) {
      toast('请等待图片上传完成');
      return;
    }

    const allImages = buildAllImages();
    if (allImages.length === 0) {
      toast('没有可识别的图片');
      return;
    }

    const recognizedKeys = new Set(
      ocrData.filter((d) => d.text).map((d) => d.key),
    );
    const newImages = allImages.filter((img) => !recognizedKeys.has(img.key));

    if (newImages.length === 0) {
      toast('所有图片已识别，无需重复处理');
      return;
    }

    setOcrRunning(true);
    try {
      const res = await api.ocr.recognize(
        newImages.map((img) => ({ key: img.key, rawKey: img.rawKey })),
      );
      const newOcrData = res.data.ocrData || [];
      const merged = [
        ...ocrData.filter((d) => !newOcrData.some((n) => n.key === d.key)),
        ...newOcrData,
      ];
      const ordered = allImages.map(
        (img) => merged.find((d) => d.key === img.key) || { key: img.key, text: '' },
      );
      setOcrData(ordered);
      setOcrText(
        ordered
          .map((d) => d.text)
          .filter(Boolean)
          .join('\n\n'),
      );
      toast(
        `OCR 完成，新识别了 ${res.data.recognized} 张图片（共 ${allImages.length} 张）`,
        'success',
      );
    } catch {
      toast('OCR 识别失败', 'error');
    } finally {
      setOcrRunning(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentBaby) return;
    const pendingUploads = uploads.some((u) => !u.result);
    if (pendingUploads) {
      toast('请等待图片上传完成');
      return;
    }

    setSaving(true);
    const visitId = await saveVisit();
    if (visitId) {
      toast(isEdit ? '已更新' : '已创建', 'success');
      cacheInvalidate(CACHE_KEY);
      navigate('/medical-visits', { replace: true });
    } else {
      toast('保存失败', 'error');
    }
    setSaving(false);
  };

  if (loadingVisit) {
    return (
      <div className="fixed inset-0 md:left-64 z-30 bg-gray-50 dark:bg-gray-900 p-4">
        <Skeleton className="h-12 mb-4" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const allImageCount =
    existingImages.length + uploads.filter((u) => u.result).length;

  return (
    <div className="fixed inset-0 md:left-64 z-30 flex flex-col bg-gray-50 dark:bg-gray-900">
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Button>
          <h2 className="flex-1 text-xl font-semibold dark:text-gray-100">
            {isEdit ? '编辑就诊记录' : '新建就诊记录'}
          </h2>
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? '保存中...' : '保存'}
          </Button>
      </div>

      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4 space-y-4 pb-20">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            就诊日期
          </label>
          <DatePicker value={visitDate} onChange={setVisitDate} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            医院
          </label>
          <Input
            value={hospital}
            onChange={(e) => setHospital(e.target.value)}
            placeholder="医院名称"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            科室
          </label>
          <Input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder="如：儿科、耳鼻喉科"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            医生
          </label>
          <Input
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            placeholder="医生姓名"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            诊断
          </label>
          <Textarea
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder="诊断内容"
            rows={2}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            处方/用药
          </label>
          <Textarea
            value={prescription}
            onChange={(e) => setPrescription(e.target.value)}
            placeholder="药品名称、用量、频率等"
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            备注
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="其他补充说明"
            rows={2}
          />
        </div>

        {/* Images */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            图片（处方、化验单等）
          </label>
          <div className="grid grid-cols-4 gap-2">
            {existingImages.map((img) => (
              <div key={img.key} className="relative aspect-square">
                <img
                  src={img.url}
                  alt=""
                  className="w-full h-full object-cover rounded-lg"
                />
                <button
                  onClick={() => removeExistingImage(img.key)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {uploads.map((up) => (
              <div key={up.id} className="relative aspect-square">
                <img
                  src={up.previewUrl}
                  alt=""
                  className="w-full h-full object-cover rounded-lg"
                />
                {up.progress < 100 && (
                  <div className="absolute inset-0 bg-black/40 rounded-lg flex items-center justify-center">
                    <span className="text-white text-sm font-medium">
                      {up.progress}%
                    </span>
                  </div>
                )}
                <button
                  onClick={() => removeUpload(up.id)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            <button
              onClick={() => fileInputRef.current?.click()}
              className="aspect-square rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex flex-col items-center justify-center text-gray-400 hover:border-primary-400 hover:text-primary-400 transition-colors"
            >
              <ImagePlus size={20} />
              <span className="text-[10px] mt-1">添加图片</span>
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* OCR Button */}
        {allImageCount > 0 && ocrAvailable && (
          <Button
            variant="secondary"
            className="w-full"
            onClick={runOcr}
            disabled={ocrRunning || saving}
          >
            {ocrRunning ? (
              <>
                <Loader2 size={16} className="mr-2 animate-spin" />
                识别中...
              </>
            ) : (
              <>
                <FileText size={16} className="mr-2" />
                OCR 识别图片文字
              </>
            )}
          </Button>
        )}

        {/* OCR Text */}
        {(ocrData.length > 0 || ocrText || ocrRunning) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
              <FileText size={14} />
              OCR 识别文本
              <span className="text-xs text-gray-400 font-normal">
                （可手动编辑，修改后点保存生效）
              </span>
            </label>
            {ocrData.length > 0 ? (
              <div className="space-y-4">
                {ocrData.map((item, idx) => {
                  const img =
                    existingImages.find((i) => i.key === item.key) ||
                    (() => {
                      const up = uploads.find((u) => u.result?.key === item.key);
                      return up?.result
                        ? { key: up.result.key, url: up.previewUrl }
                        : undefined;
                    })();
                  return (
                    <div
                      key={item.key || idx}
                      className="rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          图片 {idx + 1}
                        </span>
                        {!item.text && (
                          <Badge variant="secondary" className="text-[10px] ml-auto">
                            未识别到文字
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row">
                        {img?.url && (
                          <div className="p-3 sm:w-1/2 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-gray-200 dark:border-gray-700 bg-gray-50/50 dark:bg-gray-900/30">
                            <img
                              src={(img as MedicalVisitImage).rawUrl || img.url}
                              alt={`图片 ${idx + 1}`}
                              className="w-full object-contain rounded-lg max-h-[60vh]"
                            />
                          </div>
                        )}
                        <div className="sm:flex-1 sm:min-w-0">
                          <Textarea
                            value={item.text}
                            onChange={(e) => {
                              const newData = [...ocrData];
                              newData[idx] = { ...item, text: e.target.value };
                              setOcrData(newData);
                              setOcrText(
                                newData
                                  .map((d) => d.text)
                                  .filter(Boolean)
                                  .join('\n\n'),
                              );
                            }}
                            placeholder="未识别到文字"
                            rows={6}
                            className="border-0 rounded-none focus:ring-0 bg-transparent h-full min-h-[150px]"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <Textarea
                value={ocrText}
                onChange={(e) => setOcrText(e.target.value)}
                placeholder="识别到的文字会显示在这里..."
                rows={6}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Router ──────────────────────────────────────────────────────────────────

export default function MedicalVisitsPage() {
  const location = useLocation();
  const pathname = location.pathname;

  if (pathname.endsWith('/new')) return <VisitForm />;
  if (pathname.endsWith('/edit')) return <VisitForm />;
  if (/^\/medical-visits\/[^/]+$/.test(pathname) && !pathname.endsWith('/new'))
    return <VisitDetail />;
  return <VisitList />;
}
