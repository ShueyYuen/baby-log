import dayjs from "dayjs";
import { AlertCircle, ArrowLeft, ImagePlus, Play, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  useLocation,
  useNavigate,
  useParams,
  useSearchParams,
} from "react-router-dom";
import {
  Button,
  DateTimePicker,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  ImageViewer,
  ScrollDateTimePicker,
  Slider,
  Textarea,
  useToast,
} from "../components/ui";
import { Skeleton } from "../components/ui/skeleton";
import { VisibilityPicker } from "../components/ui/visibility-picker";
import { useAuth } from "../contexts/AuthContext";
import { useBaby } from "../contexts/BabyContext";
import {
  api,
  generateIdempotencyKey,
  type RecordImage,
  type UploadMomentResult,
} from "../lib/api";
import { cacheInvalidate, cacheRead } from "../lib/queryCache";

interface MediaPreview {
  file?: File;
  url: string;
  result?: UploadMomentResult;
  progress?: number;
  error?: boolean;
  type: "image" | "video";
  existing?: RecordImage;
  visibleTo?: string[];
}

const CONCURRENT_UPLOADS = 5;
const PROGRESS_STEP = 5;

function UploadProgressRing({
  progress,
  error,
}: {
  progress: number;
  error?: boolean;
}) {
  const r = 18;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (progress / 100) * circumference;
  return (
    <div className="absolute inset-0 flex items-center justify-center bg-black/40">
      {error ? (
        <AlertCircle size={20} className="text-red-400" />
      ) : (
        <div className="relative w-11 h-11">
          <svg viewBox="0 0 44 44" className="w-full h-full -rotate-90">
            <circle
              cx="22"
              cy="22"
              r={r}
              fill="none"
              stroke="white"
              strokeWidth="3"
              opacity={0.3}
            />
            <circle
              cx="22"
              cy="22"
              r={r}
              fill="none"
              stroke="white"
              strokeWidth="3"
              strokeLinecap="round"
              strokeDasharray={circumference}
              strokeDashoffset={offset}
              className="transition-[stroke-dashoffset] duration-200"
            />
          </svg>
          <span className="absolute inset-0 flex items-center justify-center text-white text-[10px] font-semibold">
            {progress}%
          </span>
        </div>
      )}
    </div>
  );
}

function toLocalDateTimeString(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

type CategoryType = "feeding" | "nursing" | "activity";

const categories: { value: CategoryType; label: string }[] = [
  { value: "feeding", label: "喂养" },
  { value: "nursing", label: "护理" },
  { value: "activity", label: "活动" },
];

const subTypes: Record<CategoryType, { value: string; label: string }[]> = {
  feeding: [
    { value: "breastfeed", label: "母乳" },
    { value: "bottle", label: "瓶喂" },
    { value: "pump", label: "吸奶" },
    { value: "solid", label: "辅食" },
    { value: "water", label: "喝水" },
  ],
  nursing: [
    { value: "diaper", label: "换尿布" },
    { value: "bath", label: "洗澡" },
    { value: "supplement", label: "营养补充" },
    { value: "temperature", label: "体温" },
  ],
  activity: [
    { value: "sleep", label: "睡眠" },
    { value: "play", label: "玩耍" },
    { value: "other", label: "其他" },
  ],
};

const typeLabels: Record<string, string> = Object.values(subTypes)
  .flat()
  .reduce(
    (acc, item) => {
      acc[item.value] = item.label;
      return acc;
    },
    {} as Record<string, string>,
  );

const quickTimes = [
  { label: "现在", offset: 0 },
  { label: "5分钟前", offset: -5 },
  { label: "10分钟前", offset: -10 },
  { label: "30分钟前", offset: -30 },
  { label: "1小时前", offset: -60 },
];

function normalizeRecordImages(raw: unknown): RecordImage[] {
  if (!Array.isArray(raw) || raw.length === 0) return [];
  return raw as RecordImage[];
}

function recordImagesToPreviews(images: RecordImage[]): MediaPreview[] {
  return images.map((img) => ({
    url: img.url,
    type: (img.mediaType === "video" ? "video" : "image") as "image" | "video",
    existing: img,
    visibleTo: img.visibleTo,
    result: {
      url: img.url,
      key: img.key,
      rawUrl: img.rawUrl,
      rawKey: img.rawKey,
      mediaType: img.mediaType || "image",
    },
  }));
}

export default function RecordFormPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const { toast } = useToast();
  const { id } = useParams<{ id: string }>();
  const [searchParams] = useSearchParams();
  const isEditing = !!id;
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();

  // Viewers cannot create or edit records
  useEffect(() => {
    if (isViewer) navigate("/", { replace: true });
  }, [isViewer, navigate]);

  const urlType = searchParams.get("type");
  const urlCategory = searchParams.get("category") as CategoryType | null;

  // Derive initial values from location state (passed when navigating from list) for instant render
  const _sr = isEditing ? (location.state as any)?.record : null;
  const _d = _sr?.data || {};

  const [category, setCategory] = useState<CategoryType>(
    _sr?.category || urlCategory || "feeding",
  );
  const [type, setType] = useState(_sr?.type || urlType || "breastfeed");
  const [occurredAt, setOccurredAt] = useState(
    _sr
      ? toLocalDateTimeString(new Date(_sr.occurredAt))
      : toLocalDateTimeString(new Date()),
  );
  const [note, setNote] = useState(_sr?.note || "");
  const [previews, setPreviews] = useState<MediaPreview[]>(
    (_sr?.images || []).map((img: RecordImage) => ({
      url: img.url,
      type: img.mediaType === "video" ? "video" : "image",
      existing: img,
      visibleTo: img.visibleTo,
      result: {
        url: img.url,
        key: img.key,
        rawUrl: img.rawUrl,
        rawKey: img.rawKey,
        mediaType: img.mediaType || "image",
      },
    })),
  );
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const idempotencyKeyRef = useRef(generateIdempotencyKey());

  // Dynamic form data — initialized from state record if available
  const [leftMinutes, setLeftMinutes] = useState(_d.leftMinutes ?? 10);
  const [rightMinutes, setRightMinutes] = useState(_d.rightMinutes ?? 10);
  const [milkType, setMilkType] = useState<"breast_milk" | "formula">(
    _d.milkType || "formula",
  );
  const [amountMl, setAmountMl] = useState(_d.amountMl ?? 120);
  const [solidName, setSolidName] = useState(_d.name || "");
  const [solidAmount, setSolidAmount] = useState(_d.amount || "");
  const [waterMl, setWaterMl] = useState(_d.amountMl ?? 30);
  const [diaperType, setDiaperType] = useState<"wet" | "dirty" | "both">(
    _d.type || "wet",
  );
  const [sleepEndTime, setSleepEndTime] = useState(() => {
    if (_d.endTime) return dayjs(_d.endTime).format('YYYY-MM-DDTHH:mm');
    if (_d.startTime && _d.durationMinutes) return dayjs(_d.startTime).add(_d.durationMinutes, 'minute').format('YYYY-MM-DDTHH:mm');
    return dayjs().format('YYYY-MM-DDTHH:mm');
  });
  const [supplementName, setSupplementName] = useState(_d.name || "维生素D");
  const [temperature, setTemperature] = useState(_d.value ?? 36.5);
  const [tempLocation, setTempLocation] = useState<
    "axillary" | "ear" | "forehead" | "rectal"
  >(_d.location || "axillary");
  const [playDuration, setPlayDuration] = useState(_d.durationMinutes ?? 30);
  const [bathDuration, setBathDuration] = useState(_d.durationMinutes ?? 15);
  const [pumpAmountMl, setPumpAmountMl] = useState(_d.amountMl ?? 120);
  const [pumpSide, setPumpSide] = useState<"left" | "right" | "both">(_d.side || "both");
  const [pumpDuration, setPumpDuration] = useState(_d.durationMinutes ?? 15);
  const [pumpStorage, setPumpStorage] = useState<"fridge" | "freezer" | "direct_feed">(
    _d.storage || "fridge",
  );
  const [isOngoing, setIsOngoing] = useState(false);
  const [ongoingStartTime, setOngoingStartTime] = useState<string | null>(null);

  useEffect(() => {
    if (isEditing && currentBaby) {
      // Try location state first (passed from list page) for instant render
      const stateRecord = (location.state as any)?.record;
      if (stateRecord) {
        setCategory(stateRecord.category as CategoryType);
        setType(stateRecord.type);
        setOccurredAt(toLocalDateTimeString(new Date(stateRecord.occurredAt)));
        setNote(stateRecord.note || "");
        setPreviews(
          recordImagesToPreviews(normalizeRecordImages(stateRecord.images)),
        );
        populateData(stateRecord.type, stateRecord.data);
        setLoadingRecord(false);
      } else {
        loadRecord();
      }
    }
  }, [id, currentBaby]);

  const loadRecord = async () => {
    if (!currentBaby || !id) return;
    setLoadingRecord(true);
    try {
      // Try cache first
      const params = new URLSearchParams({
        babyId: currentBaby.id,
        pageSize: "50",
      });
      const cKey = `/records?${params}`;
      const cached = cacheRead<{ success: boolean; data: { items: any[] } }>(
        cKey,
      );
      const record = cached?.data?.items?.find((r: any) => r.id === id);
      if (record) {
        setCategory(record.category as CategoryType);
        setType(record.type);
        setOccurredAt(toLocalDateTimeString(new Date(record.occurredAt)));
        setNote(record.note || "");
        setPreviews(
          recordImagesToPreviews(normalizeRecordImages(record.images)),
        );
        populateData(record.type, record.data);
        setLoadingRecord(false);
        return;
      }
      const res = await api.get<{ success: boolean; data: { items: any[] } }>(
        `/records?babyId=${currentBaby.id}&pageSize=100`,
      );
      const freshRecord = res.data.items.find((r: any) => r.id === id);
      if (freshRecord) {
        setCategory(freshRecord.category as CategoryType);
        setType(freshRecord.type);
        setOccurredAt(toLocalDateTimeString(new Date(freshRecord.occurredAt)));
        setNote(freshRecord.note || "");
        setPreviews(
          recordImagesToPreviews(normalizeRecordImages(freshRecord.images)),
        );
        populateData(freshRecord.type, freshRecord.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingRecord(false);
    }
  };

  const populateData = (recordType: string, data: any) => {
    switch (recordType) {
      case "breastfeed":
        setLeftMinutes(data.leftMinutes || 0);
        setRightMinutes(data.rightMinutes || 0);
        break;
      case "bottle":
        setMilkType(data.milkType || "formula");
        setAmountMl(data.amountMl || 0);
        break;
      case "solid":
        setSolidName(data.name || "");
        setSolidAmount(data.amount || "");
        break;
      case "water":
        setWaterMl(data.amountMl || 0);
        break;
      case "diaper":
        setDiaperType(data.type || "wet");
        break;
      case "supplement":
        setSupplementName(data.name || "");
        break;
      case "sleep":
        if (data.ongoing) {
          setIsOngoing(true);
          setOngoingStartTime(data.startTime || null);
        } else if (data.endTime) {
          setSleepEndTime(dayjs(data.endTime).format('YYYY-MM-DDTHH:mm'));
        } else if (data.startTime && data.durationMinutes) {
          setSleepEndTime(dayjs(data.startTime).add(data.durationMinutes, 'minute').format('YYYY-MM-DDTHH:mm'));
        }
        break;
      case "temperature":
        setTemperature(data.value || 36.5);
        setTempLocation(data.location || "axillary");
        break;
      case "play":
        if (data.ongoing) {
          setIsOngoing(true);
          setOngoingStartTime(data.startTime || null);
        } else {
          setPlayDuration(data.durationMinutes || 30);
        }
        break;
      case "bath":
        if (data.ongoing) {
          setIsOngoing(true);
          setOngoingStartTime(data.startTime || null);
        } else {
          setBathDuration(data.durationMinutes || 15);
        }
        break;
      case "pump":
        setPumpAmountMl(data.amountMl ?? 120);
        setPumpSide(data.side || "both");
        setPumpDuration(data.durationMinutes ?? 15);
        setPumpStorage(data.storage || "fridge");
        break;
    }
  };

  const handleCategoryChange = (cat: CategoryType) => {
    setCategory(cat);
    setType(subTypes[cat][0].value);
  };

  const setQuickTime = (offsetMinutes: number) => {
    const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
    setOccurredAt(toLocalDateTimeString(d));
  };

  const handleFiles = useCallback(
    async (files: FileList | null) => {
      if (!files || files.length === 0) return;
      const allowed = Array.from(files);
      const startIdx = previews.length;

      const placeholders: MediaPreview[] = allowed.map((f) => ({
        file: f,
        url: "",
        type: f.type.startsWith("video/")
          ? ("video" as const)
          : ("image" as const),
        progress: 0,
      }));
      setPreviews((prev) => [...prev, ...placeholders]);
      setUploading(true);

      for (let i = 0; i < allowed.length; i++) {
        const blobUrl = URL.createObjectURL(allowed[i]);
        setPreviews((prev) => {
          const next = [...prev];
          const idx = startIdx + i;
          if (next[idx]) next[idx] = { ...next[idx], url: blobUrl };
          return next;
        });
        if (i % 3 === 2) await new Promise((r) => requestAnimationFrame(r));
      }

      let queueIdx = 0;
      const lastReported: number[] = new Array(allowed.length).fill(-1);

      const uploadNext = async (): Promise<void> => {
        const myIdx = queueIdx++;
        if (myIdx >= allowed.length) return;
        const fileIdx = startIdx + myIdx;
        try {
          const result = await api.records.uploadMedia(
            allowed[myIdx],
            (percent) => {
              const stepped =
                Math.floor(percent / PROGRESS_STEP) * PROGRESS_STEP;
              if (stepped <= lastReported[myIdx]) return;
              lastReported[myIdx] = stepped;
              setPreviews((prev) => {
                const next = [...prev];
                if (next[fileIdx])
                  next[fileIdx] = { ...next[fileIdx], progress: stepped };
                return next;
              });
            },
          );
          setPreviews((prev) => {
            const next = [...prev];
            if (next[fileIdx])
              next[fileIdx] = { ...next[fileIdx], result, progress: undefined };
            return next;
          });
        } catch {
          setPreviews((prev) => {
            const next = [...prev];
            if (next[fileIdx])
              next[fileIdx] = {
                ...next[fileIdx],
                error: true,
                progress: undefined,
              };
            return next;
          });
        }
        await uploadNext();
      };

      const workers = Math.min(CONCURRENT_UPLOADS, allowed.length);
      await Promise.all(Array.from({ length: workers }, () => uploadNext()));
      setUploading(false);
    },
    [previews.length],
  );

  const removePreview = useCallback((idx: number) => {
    setPreviews((prev) => {
      const next = [...prev];
      const removed = next.splice(idx, 1)[0];
      if (removed.url && removed.file) URL.revokeObjectURL(removed.url);
      return next;
    });
  }, []);

  const buildData = (): Record<string, unknown> => {
    switch (type) {
      case "breastfeed":
        return { leftMinutes, rightMinutes };
      case "bottle":
        return { milkType, amountMl };
      case "solid":
        return { name: solidName, amount: solidAmount };
      case "water":
        return { amountMl: waterMl };
      case "diaper":
        return { type: diaperType };
      case "bath":
        if (isOngoing) return { ongoing: true, startTime: ongoingStartTime || new Date(occurredAt).toISOString() };
        return { durationMinutes: bathDuration };
      case "supplement":
        return { name: supplementName };
      case "temperature":
        return { value: temperature, location: tempLocation };
      case "sleep": {
        if (isOngoing) return { ongoing: true, startTime: ongoingStartTime || new Date(occurredAt).toISOString() };
        const sStart = new Date(occurredAt);
        let sEnd = new Date(sleepEndTime);
        if (sEnd.getTime() <= sStart.getTime()) {
          sEnd = new Date(sEnd.getTime() + 24 * 60 * 60 * 1000);
        }
        const dur = Math.max(1, Math.round((sEnd.getTime() - sStart.getTime()) / 60000));
        return {
          startTime: sStart.toISOString(),
          endTime: sEnd.toISOString(),
          durationMinutes: dur,
        };
      }
      case "play":
        if (isOngoing) return { ongoing: true, startTime: ongoingStartTime || new Date(occurredAt).toISOString() };
        return { durationMinutes: playDuration };
      case "pump":
        return {
          amountMl: pumpAmountMl,
          side: pumpSide,
          durationMinutes: pumpDuration,
          storage: pumpStorage,
        };
      default:
        return {};
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    setLoading(true);

    try {
      const completedImages = previews
        .filter((p) => p.result)
        .map((p) => ({
          key: p.result!.key,
          rawKey: p.result!.rawKey,
          mediaType: p.result!.mediaType,
          visibleTo: p.visibleTo?.length ? p.visibleTo : undefined,
        }));
      const payload = {
        babyId: currentBaby.id,
        category,
        type,
        data: buildData(),
        occurredAt: new Date(occurredAt).toISOString(),
        note: note || undefined,
        images: completedImages.length > 0 ? completedImages : undefined,
      };

      if (isEditing) {
        await api.put(`/records/${id}`, payload);
      } else {
        await api.post("/records", payload, idempotencyKeyRef.current);
        if (
          type === "pump" &&
          (pumpStorage === "fridge" || pumpStorage === "freezer")
        ) {
          try {
            await api.milkInventory.create(
              {
                babyId: currentBaby.id,
                amountMl: pumpAmountMl,
                storageType: pumpStorage,
                storedAt: new Date(occurredAt).toISOString(),
              },
              generateIdempotencyKey(),
            );
            cacheInvalidate("/milk-inventory");
          } catch {
            toast("记录已保存，但自动入库失败", "error");
          }
        }
      }
      cacheInvalidate("/timeline");
      navigate("/", { replace: true });
    } catch {
      toast(isEditing ? "修改失败" : "添加失败", "error");
    } finally {
      setLoading(false);
    }
  };

  const renderDataFields = () => {
    switch (type) {
      case "breastfeed":
        return (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                左侧
              </label>
              <Slider
                value={leftMinutes}
                onChange={setLeftMinutes}
                min={0}
                max={60}
                step={1}
                unit="分钟"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                右侧
              </label>
              <Slider
                value={rightMinutes}
                onChange={setRightMinutes}
                min={0}
                max={60}
                step={1}
                unit="分钟"
              />
            </div>
          </div>
        );
      case "bottle":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                奶类型
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMilkType("formula")}
                  className={`flex-1 py-2.5 rounded-lg border-2 text-base ${milkType === "formula" ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                >
                  配方奶
                </button>
                <button
                  type="button"
                  onClick={() => setMilkType("breast_milk")}
                  className={`flex-1 py-2.5 rounded-lg border-2 text-base ${milkType === "breast_milk" ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                >
                  母乳
                </button>
              </div>
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                奶量
              </label>
              <Slider
                value={amountMl}
                onChange={setAmountMl}
                min={0}
                max={300}
                step={5}
                unit="ml"
              />
            </div>
          </div>
        );
      case "solid":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                食物名称
              </label>
              <input
                type="text"
                value={solidName}
                onChange={(e) => setSolidName(e.target.value)}
                className="input"
                placeholder="如：米糊"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                食用量
              </label>
              <input
                type="text"
                value={solidAmount}
                onChange={(e) => setSolidAmount(e.target.value)}
                className="input"
                placeholder="如：半碗"
              />
            </div>
          </div>
        );
      case "water":
        return (
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
              水量
            </label>
            <Slider
              value={waterMl}
              onChange={setWaterMl}
              min={0}
              max={200}
              step={5}
              unit="ml"
            />
          </div>
        );
      case "diaper":
        return (
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
              类型
            </label>
            <div className="flex gap-3">
              {[
                { value: "wet" as const, label: "尿" },
                { value: "dirty" as const, label: "便" },
                { value: "both" as const, label: "尿+便" },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setDiaperType(item.value)}
                  className={`flex-1 py-2.5 rounded-lg border-2 text-base ${diaperType === item.value ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        );
      case "supplement":
        return (
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
              名称
            </label>
            <input
              type="text"
              value={supplementName}
              onChange={(e) => setSupplementName(e.target.value)}
              className="input"
              placeholder="如：维生素D"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {[
                "维生素D",
                "DHA",
                "益生菌",
                "维生素AD",
                "铁剂",
                "钙",
                "锌",
                "乳铁蛋白",
                "鱼肝油",
              ].map((name) => (
                <button
                  key={name}
                  type="button"
                  onClick={() => setSupplementName(name)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    supplementName === name
                      ? "border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-400"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400 dark:hover:border-gray-500"
                  }`}
                >
                  {name}
                </button>
              ))}
            </div>
          </div>
        );
      case "temperature":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                温度
              </label>
              <Slider
                value={temperature}
                onChange={setTemperature}
                min={35}
                max={42}
                step={0.1}
                unit="°C"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                测量部位
              </label>
              <div className="flex gap-2">
                {[
                  { value: "axillary" as const, label: "腋下" },
                  { value: "ear" as const, label: "耳温" },
                  { value: "forehead" as const, label: "额温" },
                  { value: "rectal" as const, label: "肛温" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setTempLocation(item.value)}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-base ${tempLocation === item.value ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      case "sleep": {
        if (isOngoing) {
          return (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                睡眠进行中，如需结束请返回时间线
              </span>
            </div>
          );
        }

        const sleepStart = new Date(occurredAt);
        let sleepEnd = new Date(sleepEndTime);
        if (sleepEnd.getTime() <= sleepStart.getTime()) {
          sleepEnd = new Date(sleepEnd.getTime() + 24 * 60 * 60 * 1000);
        }
        const sleepDurMin = Math.max(0, Math.round((sleepEnd.getTime() - sleepStart.getTime()) / 60000));
        const sleepDurH = Math.floor(sleepDurMin / 60);
        const sleepDurM = sleepDurMin % 60;
        const sleepDurLabel = sleepDurH > 0
          ? `${sleepDurH}小时${sleepDurM > 0 ? `${sleepDurM}分钟` : ''}`
          : `${sleepDurM}分钟`;

        const applyPreset = (minutes: number) => {
          const base = dayjs(occurredAt);
          setSleepEndTime(base.add(minutes, 'minute').format('YYYY-MM-DDTHH:mm'));
        };
        const applyNight = () => {
          const now = dayjs();
          const bedtime = now.subtract(1, 'day').hour(21).minute(0).second(0);
          const wakeup = now.hour(6).minute(0).second(0);
          setOccurredAt(bedtime.format('YYYY-MM-DDTHH:mm'));
          setSleepEndTime(wakeup.format('YYYY-MM-DDTHH:mm'));
        };

        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">快捷录入</label>
              <div className="flex gap-2 flex-wrap">
                {[
                  { label: '小睡30min', min: 30 },
                  { label: '小睡1h', min: 60 },
                  { label: '小睡1.5h', min: 90 },
                  { label: '小睡2h', min: 120 },
                ].map(p => (
                  <button
                    key={p.min}
                    type="button"
                    onClick={() => applyPreset(p.min)}
                    className="px-3 py-1.5 text-sm rounded-lg border border-gray-300 dark:border-gray-600 hover:bg-gray-50 dark:hover:bg-gray-700 dark:text-gray-300 transition-colors"
                  >
                    {p.label}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={applyNight}
                  className="px-3 py-1.5 text-sm rounded-lg border border-indigo-300 dark:border-indigo-700 text-indigo-600 dark:text-indigo-400 hover:bg-indigo-50 dark:hover:bg-indigo-950/30 transition-colors"
                >
                  夜间睡眠
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">醒来时间</label>
              <ScrollDateTimePicker
                value={sleepEndTime}
                onChange={(v) => setSleepEndTime(v)}
                className="md:hidden"
              />
              <DateTimePicker
                value={sleepEndTime}
                onChange={(v) => setSleepEndTime(v)}
                placeholder="选择醒来时间"
                className="hidden md:flex"
              />
            </div>
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-gray-50 dark:bg-gray-800/50">
              <span className="text-sm text-gray-500 dark:text-gray-400">时长：</span>
              <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">{sleepDurLabel}</span>
              {sleepEnd.getDate() !== sleepStart.getDate() && (
                <span className="text-xs text-indigo-500 dark:text-indigo-400 ml-1">跨天</span>
              )}
            </div>
          </div>
        );
      }
      case "bath":
        if (isOngoing) {
          return (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                洗澡进行中，如需结束请返回时间线
              </span>
            </div>
          );
        }
        return (
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
              持续时间
            </label>
            <Slider
              value={bathDuration}
              onChange={setBathDuration}
              min={0}
              max={60}
              step={1}
              unit="分钟"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {[5, 10, 15, 20, 30].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setBathDuration(min)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    bathDuration === min
                      ? "border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-400"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400"
                  }`}
                >
                  {min}分钟
                </button>
              ))}
            </div>
          </div>
        );
      case "play":
        if (isOngoing) {
          return (
            <div className="flex items-center gap-3 px-4 py-3 rounded-xl bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800">
              <div className="w-2 h-2 rounded-full bg-primary-500 animate-pulse" />
              <span className="text-sm font-medium text-primary-700 dark:text-primary-300">
                活动进行中，如需结束请返回时间线
              </span>
            </div>
          );
        }
        return (
          <div>
            <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
              持续时间
            </label>
            <Slider
              value={playDuration}
              onChange={setPlayDuration}
              min={0}
              max={120}
              step={5}
              unit="分钟"
            />
            <div className="flex flex-wrap gap-2 mt-3">
              {[10, 15, 20, 30, 45, 60].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setPlayDuration(min)}
                  className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
                    playDuration === min
                      ? "border-primary-400 bg-primary-50 text-primary-600 dark:border-primary-500 dark:bg-primary-900/30 dark:text-primary-400"
                      : "border-gray-200 text-gray-500 hover:border-gray-300 dark:border-gray-600 dark:text-gray-400"
                  }`}
                >
                  {min}分钟
                </button>
              ))}
            </div>
          </div>
        );
      case "pump":
        return (
          <div className="space-y-4">
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                吸出量
              </label>
              <Slider
                value={pumpAmountMl}
                onChange={setPumpAmountMl}
                min={0}
                max={300}
                step={5}
                unit="ml"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                侧别
              </label>
              <div className="flex gap-3">
                {[
                  { value: "left" as const, label: "左" },
                  { value: "right" as const, label: "右" },
                  { value: "both" as const, label: "双侧" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPumpSide(item.value)}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-base ${
                      pumpSide === item.value
                        ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300"
                        : "border-gray-200 dark:border-gray-600 dark:text-gray-300"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                时长
              </label>
              <Slider
                value={pumpDuration}
                onChange={setPumpDuration}
                min={0}
                max={60}
                step={1}
                unit="分钟"
              />
            </div>
            <div>
              <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
                存储方式
              </label>
              <div className="flex gap-2">
                {[
                  { value: "fridge" as const, label: "冷藏" },
                  { value: "freezer" as const, label: "冷冻" },
                  { value: "direct_feed" as const, label: "直接喂" },
                ].map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    onClick={() => setPumpStorage(item.value)}
                    className={`flex-1 py-2.5 rounded-lg border-2 text-sm ${
                      pumpStorage === item.value
                        ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300"
                        : "border-gray-200 dark:border-gray-600 dark:text-gray-300"
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      default:
        return null;
    }
  };

  if (loadingRecord) {
    return (
      <div className="space-y-4 p-4">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
        <Skeleton className="h-24 rounded-xl" />
        <Skeleton className="h-12 rounded-xl" />
      </div>
    );
  }

  return (
    <div
      style={{ viewTransitionName: id ? `record-card-${id}` : undefined }}
      className="fixed inset-0 md:top-0 md:bottom-0 md:left-64 z-30 flex flex-col bg-gray-50 dark:bg-gray-900 form-expand-in"
    >
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft size={20} />
        </Button>
        <h2 className="flex-1 text-xl font-semibold dark:text-gray-100">
          {typeLabels[type] || type}
        </h2>
        <Button
          type="submit"
          form="record-form"
          size="sm"
          disabled={loading || uploading}
        >
          {loading ? "保存中..." : uploading ? "上传中..." : "保存"}
        </Button>
      </div>

      <form
        id="record-form"
        onSubmit={handleSubmit}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-6"
      >
        {/* Category & Type Selection - only show when not pre-selected */}
        {!urlType && !isEditing && (
          <>
            <div className="flex gap-2">
              {categories.map((cat) => (
                <button
                  key={cat.value}
                  type="button"
                  onClick={() => handleCategoryChange(cat.value)}
                  className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${
                    category === cat.value
                      ? "bg-primary-500 text-white"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap gap-2">
              {subTypes[category].map((st) => (
                <button
                  key={st.value}
                  type="button"
                  onClick={() => setType(st.value)}
                  className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                    type === st.value
                      ? "bg-primary-100 dark:bg-primary-900/40 text-primary-700 dark:text-primary-300 border border-primary-300 dark:border-primary-700"
                      : "bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600"
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </>
        )}

        {/* Quick Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            时间
          </label>
          <div className="flex flex-wrap gap-2 mb-2">
            {quickTimes.map((qt) => (
              <Button
                key={qt.label}
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => setQuickTime(qt.offset)}
                className="text-xs"
              >
                {qt.label}
              </Button>
            ))}
          </div>
          <ScrollDateTimePicker
            value={occurredAt}
            onChange={(val) => setOccurredAt(val)}
            className="md:hidden"
          />
          <DateTimePicker
            value={occurredAt}
            onChange={(val) => setOccurredAt(val)}
            placeholder="选择记录时间"
            className="hidden md:flex"
          />
        </div>

        {/* Dynamic Data Fields */}
        <div className="card">{renderDataFields()}</div>

        {/* Note */}
        <div>
          <label className="block text-base font-medium text-gray-700 dark:text-gray-300 mb-2">
            备注
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={2}
            placeholder="可选备注..."
          />
        </div>

        {/* Images / Videos */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            图片 / 视频
          </label>
          <div className="flex flex-wrap gap-2">
            {previews.map((p, idx) => (
              <div
                key={idx}
                className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600"
              >
                {!p.url ? null : p.type === "video" ? (
                  <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <Play size={20} className="text-gray-500" />
                  </div>
                ) : (
                  <img
                    src={p.url}
                    alt=""
                    className="w-full h-full object-cover cursor-zoom-in"
                    decoding="async"
                    loading="lazy"
                    onClick={() => {
                      if (p.result) {
                        setViewerIndex(idx);
                        setViewerOpen(true);
                      }
                    }}
                  />
                )}
                {p.file && !p.result && (
                  <UploadProgressRing
                    progress={p.progress ?? 0}
                    error={p.error}
                  />
                )}
                <button
                  type="button"
                  onClick={() => removePreview(idx)}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                >
                  <X size={12} className="text-white" />
                </button>
                {p.result && (
                  <div className="absolute bottom-0.5 left-0.5">
                    <VisibilityPicker
                      value={p.visibleTo}
                      onChange={(vt) => {
                        setPreviews((prev) =>
                          prev.map((item, i) =>
                            i === idx ? { ...item, visibleTo: vt } : item
                          )
                        );
                      }}
                    />
                  </div>
                )}
              </div>
            ))}
            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-400 dark:hover:border-primary-500 transition-colors">
              <input
                ref={fileRef}
                type="file"
                accept="image/*,video/*"
                className="hidden"
                multiple
                disabled={uploading}
                onChange={(e) => {
                  handleFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              {uploading ? (
                <span className="text-xs text-gray-400 animate-pulse">
                  上传中
                </span>
              ) : (
                <ImagePlus size={20} className="text-gray-400" />
              )}
            </label>
          </div>
          {previews.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              已选 {previews.length} 个文件
              {previews.some((p) => p.error) && (
                <span className="text-red-400 ml-1">(部分上传失败)</span>
              )}
            </p>
          )}
        </div>

        {/* Delete (edit only) */}
        {isEditing && (
          <button
            type="button"
            onClick={() => setShowDeleteConfirm(true)}
            className="w-full py-2.5 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
          >
            删除这条记录
          </button>
        )}
      </form>

      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>
              确定要删除这条记录吗？此操作不可撤销。
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setShowDeleteConfirm(false)}
            >
              取消
            </Button>
            <Button
              variant="destructive"
              className="flex-1"
              onClick={async () => {
                try {
                  await api.delete(`/records/${id}`);
                  cacheInvalidate("/timeline");
                  navigate("/", { replace: true });
                } catch {
                  toast("删除失败", "error");
                }
              }}
            >
              删除
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ImageViewer
        images={previews
          .filter((p) => p.result)
          .map((p) => ({
            url: p.result!.url,
            rawUrl: p.result!.rawUrl,
          }))}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
