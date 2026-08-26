import { useState, useEffect, useRef } from 'react';
import { useParams, useNavigate, useLocation } from 'react-router-dom';
import dayjs from 'dayjs';
import {
  ArrowLeft,
  X,
  Trash2,
  Edit3,
  ImagePlus,
  FileText,
  Loader2,
  Stethoscope,
} from 'lucide-react';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { useI18n } from '../contexts/I18nContext';
import {
  api,
  generateIdempotencyKey,
  type MedicalVisit,
  type MedicalVisitImage,
  type OcrDataItem,
  type UploadMomentResult,
} from '../lib/api';
import { cacheInvalidate } from '../lib/queryCache';
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

// ── Detail View ─────────────────────────────────────────────────────────────

function VisitDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { isViewer } = useAuth();
  const { t } = useI18n();
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
      .catch(() => toast(t('visits.loadFailed'), 'error'))
      .finally(() => setLoading(false));
  }, [id]);

  const handleDelete = async () => {
    if (!visit) return;
    try {
      await api.medicalVisits.delete(visit.id);
      cacheInvalidate(CACHE_KEY);
      toast(t('visits.deleted'), 'success');
      navigate('/health', { replace: true });
    } catch {
      toast(t('visits.deleteFailed'), 'error');
    }
  };

  const viewerImages: ViewerImage[] =
    visit?.images.map((img) => ({
      url: img.rawUrl || img.url || '',
    })) ?? [];

  if (loading) {
    return (
      <div className="absolute inset-0 glass-page-shell p-4">
        <Skeleton className="h-12 mb-4" />
        <Skeleton className="h-40 mb-4" />
        <Skeleton className="h-32" />
      </div>
    );
  }

  if (!visit) {
    return (
      <div className="absolute inset-0 glass-page-shell flex items-center justify-center">
        <p className="text-gray-400">{t('visits.notFound')}</p>
      </div>
    );
  }

  const fields = [
    { label: t('visits.hospital'), value: visit.hospital },
    { label: t('visits.department'), value: visit.department },
    { label: t('visits.doctor'), value: visit.doctor },
    { label: t('visits.diagnosis'), value: visit.diagnosis },
    { label: t('visits.prescription'), value: visit.prescription },
    { label: t('visits.notes'), value: visit.notes },
  ].filter((f) => f.value);

  return (
    <div className="absolute inset-0 flex flex-col glass-page-shell">
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b glass-sticky-header flex-shrink-0">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => navigate('/health')}
          >
            <ArrowLeft size={20} />
          </Button>
          <h2 className="flex-1 text-xl font-semibold dark:text-gray-100 truncate">
            {visit.hospital || t('visits.fallbackTitle')}
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

      <div className="flex-1 overflow-y-auto py-4 space-y-4">
        <div className="flex items-center gap-2 text-gray-500 dark:text-gray-400">
          <Stethoscope size={16} />
          <span>{dayjs(visit.visitDate).format(t('dateFmt.ymd'))}</span>
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
                {t('visits.images', { n: visit.images.length })}
              </p>
              <div className="grid grid-cols-3 gap-2">
                {visit.images.map((img, i) => (
                  <button
                    key={img.key}
                    onClick={() => {
                      setViewerIdx(i);
                      setViewerOpen(true);
                    }}
                    className="aspect-square rounded-lg overflow-hidden glass-media-thumb"
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
              {t('visits.ocrText')}
            </p>
            {visit.ocrData?.length > 0 ? (
              <div className="space-y-4">
                {visit.ocrData.map((item, idx) => {
                  const img = visit.images.find((i) => i.key === item.key);
                  return (
                    <Card key={item.key || idx}>
                      <CardContent className="p-0 overflow-hidden">
                        <div className="flex items-center gap-2 px-3 py-2 glass-info-strip border-b border-white/20 dark:border-white/[0.06]">
                          <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                            {t('visits.imageN', { n: idx + 1 })}
                          </span>
                          {!item.text && (
                            <Badge variant="secondary" className="text-[10px] ml-auto">
                              {t('visits.noText')}
                            </Badge>
                          )}
                        </div>
                        <div className="flex flex-col sm:flex-row">
                          {img?.url && (
                            <div className="p-3 sm:w-1/2 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-white/20 dark:border-white/[0.06] glass-info-strip">
                              <img
                                src={img.rawUrl || img.url}
                                alt={t('visits.altImage', { n: idx + 1 })}
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
        title={t('visits.confirmDelete')}
        description={t('visits.confirmDeleteDesc')}
        confirmLabel={t('common.delete')}
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
  const { t } = useI18n();
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
  const [viewerOpen, setViewerOpen] = useState(false);
  const [viewerIdx, setViewerIdx] = useState(0);
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
      .catch(() => toast(t('visits.loadFailed'), 'error'))
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

    const uploaded: UploadMomentResult[] = [];
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
        uploaded.push(result);
      } catch {
        toast(t('visits.uploadFailed'), 'error');
        setUploads((prev) => prev.filter((u) => u.id !== up.id));
      }
    }

    e.target.value = '';

    if (uploaded.length > 0 && ocrAvailable) {
      setOcrRunning(true);
      try {
        const res = await api.ocr.recognize(
          uploaded.map((r) => ({ key: r.key, rawKey: r.rawKey })),
        );
        const newOcrData = res.data.ocrData || [];
        setOcrData((prev) => {
          const merged = [
            ...prev.filter((d) => !newOcrData.some((n) => n.key === d.key)),
            ...newOcrData,
          ];
          setOcrText(merged.map((d) => d.text).filter(Boolean).join('\n\n'));
          return merged;
        });
      } catch {
        toast(t('visits.ocrAutoFailed'), 'error');
      } finally {
        setOcrRunning(false);
      }
    }
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
      toast(t('visits.waitUpload'));
      return;
    }

    const allImages = buildAllImages();
    if (allImages.length === 0) {
      toast(t('visits.noRecognizable'));
      return;
    }

    const recognizedKeys = new Set(
      ocrData.filter((d) => d.text).map((d) => d.key),
    );
    const newImages = allImages.filter((img) => !recognizedKeys.has(img.key));

    if (newImages.length === 0) {
      toast(t('visits.alreadyRecognized'));
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
        t('visits.ocrDone', { n: res.data.recognized, total: allImages.length }),
        'success',
      );
    } catch {
      toast(t('visits.ocrFailed'), 'error');
    } finally {
      setOcrRunning(false);
    }
  };

  const handleSubmit = async () => {
    if (!currentBaby) return;
    const pendingUploads = uploads.some((u) => !u.result);
    if (pendingUploads) {
      toast(t('visits.waitUpload'));
      return;
    }

    setSaving(true);
    const visitId = await saveVisit();
    if (visitId) {
      toast(isEdit ? t('visits.updated') : t('visits.created'), 'success');
      cacheInvalidate(CACHE_KEY);
      navigate('/health', { replace: true });
    } else {
      toast(t('visits.saveFailed'), 'error');
    }
    setSaving(false);
  };

  if (loadingVisit) {
    return (
      <div className="absolute inset-0 glass-page-shell p-4">
        <Skeleton className="h-12 mb-4" />
        <Skeleton className="h-80" />
      </div>
    );
  }

  const allImageCount =
    existingImages.length + uploads.filter((u) => u.result).length;

  return (
    <div className="absolute inset-0 flex flex-col glass-page-shell">
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b glass-sticky-header flex-shrink-0">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft size={20} />
          </Button>
          <h2 className="flex-1 text-xl font-semibold dark:text-gray-100">
            {isEdit ? t('visits.edit') : t('visits.create')}
          </h2>
          <Button size="sm" onClick={handleSubmit} disabled={saving}>
            {saving ? t('common.saving') : t('common.save')}
          </Button>
      </div>

      <div className="flex-1 overflow-y-auto py-4 space-y-4 pb-20">
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.visitDate')}
          </label>
          <DatePicker value={visitDate} onChange={setVisitDate} />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.hospital')}
          </label>
          <Input
            value={hospital}
            onChange={(e) => setHospital(e.target.value)}
            placeholder={t('visits.hospitalPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.department')}
          </label>
          <Input
            value={department}
            onChange={(e) => setDepartment(e.target.value)}
            placeholder={t('visits.departmentPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.doctor')}
          </label>
          <Input
            value={doctor}
            onChange={(e) => setDoctor(e.target.value)}
            placeholder={t('visits.doctorPlaceholder')}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.diagnosis')}
          </label>
          <Textarea
            value={diagnosis}
            onChange={(e) => setDiagnosis(e.target.value)}
            placeholder={t('visits.diagnosisPlaceholder')}
            rows={2}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.prescription')}
          </label>
          <Textarea
            value={prescription}
            onChange={(e) => setPrescription(e.target.value)}
            placeholder={t('visits.prescriptionPlaceholder')}
            rows={3}
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            {t('visits.notes')}
          </label>
          <Textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder={t('visits.notesPlaceholder')}
            rows={2}
          />
        </div>

        {/* Images */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            {t('visits.imagesLabel')}
          </label>
          <div className="grid grid-cols-4 gap-2">
            {existingImages.map((img, i) => (
              <div key={img.key} className="relative aspect-square">
                <img
                  src={img.url}
                  alt=""
                  className="w-full h-full object-cover rounded-lg cursor-zoom-in"
                  onClick={() => { setViewerIdx(i); setViewerOpen(true); }}
                />
                <button
                  type="button"
                  onClick={() => removeExistingImage(img.key)}
                  className="absolute -top-1 -right-1 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
            {uploads.map((up, i) => (
              <div key={up.id} className="relative aspect-square">
                <img
                  src={up.previewUrl}
                  alt=""
                  className="w-full h-full object-cover rounded-lg cursor-zoom-in"
                  onClick={() => { setViewerIdx(existingImages.length + i); setViewerOpen(true); }}
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
              className="aspect-square rounded-lg glass-upload-zone flex flex-col items-center justify-center text-gray-400 transition-colors"
            >
              <ImagePlus size={20} />
              <span className="text-[10px] mt-1">{t('visits.addImage')}</span>
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

        {/* OCR Status / Re-run */}
        {ocrRunning && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-900/30 text-sm text-blue-700 dark:text-blue-300">
            <Loader2 size={16} className="animate-spin" />
            {t('visits.recognizing')}
          </div>
        )}
        {allImageCount > 0 && ocrAvailable && !ocrRunning && ocrData.length > 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={runOcr}
            disabled={saving}
          >
            <FileText size={14} className="mr-1" />
            {t('visits.rerecognize')}
          </Button>
        )}

        {/* OCR Text */}
        {(ocrData.length > 0 || ocrText || ocrRunning) && (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2 flex items-center gap-1">
              <FileText size={14} />
              {t('visits.ocrText')}
              <span className="text-xs text-gray-400 font-normal">
                {t('visits.ocrHint')}
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
                      className="rounded-lg glass-media-thumb overflow-hidden"
                    >
                      <div className="flex items-center gap-2 px-3 py-2 glass-info-strip border-b border-white/20 dark:border-white/[0.06]">
                        <span className="text-xs font-medium text-gray-500 dark:text-gray-400">
                          {t('visits.imageN', { n: idx + 1 })}
                        </span>
                        {!item.text && (
                          <Badge variant="secondary" className="text-[10px] ml-auto">
                            {t('visits.noText')}
                          </Badge>
                        )}
                      </div>
                      <div className="flex flex-col sm:flex-row">
                        {img?.url && (
                          <div className="p-3 sm:w-1/2 sm:shrink-0 sm:border-r border-b sm:border-b-0 border-white/20 dark:border-white/[0.06] glass-info-strip">
                            <img
                              src={(img as MedicalVisitImage).rawUrl || img.url}
                              alt={t('visits.altImage', { n: idx + 1 })}
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
                            placeholder={t('visits.noText')}
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
                placeholder={t('visits.ocrPlaceholder')}
                rows={6}
              />
            )}
          </div>
        )}
      </div>
      <ImageViewer
        images={[
          ...existingImages.map((img) => ({ url: img.rawUrl || img.url || '', rawUrl: img.rawUrl })),
          ...uploads.map((up) => ({ url: up.previewUrl, rawUrl: up.result?.rawUrl })),
        ]}
        initialIndex={viewerIdx}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
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
  return <VisitDetail />;
}
