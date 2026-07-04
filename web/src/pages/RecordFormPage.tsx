import { ArrowLeft, ImagePlus, Play, X } from "lucide-react";
import { useEffect, useState } from "react";
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
  Textarea,
  useToast,
} from "../components/ui";
import { useAuth } from "../contexts/AuthContext";
import { useBaby } from "../contexts/BabyContext";
import { api, type RecordImage } from "../lib/api";
import { cacheRead } from "../lib/queryCache";
import { Skeleton } from "../components/ui/skeleton";

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
  const [images, setImages] = useState<RecordImage[]>(_sr?.images || []);
  const [uploading, setUploading] = useState(false);
  const [loading, setLoading] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);

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
  const [sleepDuration, setSleepDuration] = useState(_d.durationMinutes ?? 60);
  const [supplementName, setSupplementName] = useState(_d.name || "维生素D");
  const [temperature, setTemperature] = useState(_d.value ?? 36.5);
  const [tempLocation, setTempLocation] = useState<
    "axillary" | "ear" | "forehead" | "rectal"
  >(_d.location || "axillary");
  const [playDuration, setPlayDuration] = useState(_d.durationMinutes ?? 30);
  const [bathDuration, setBathDuration] = useState(_d.durationMinutes ?? 15);

  useEffect(() => {
    if (isEditing && currentBaby) {
      // Try location state first (passed from list page) for instant render
      const stateRecord = (location.state as any)?.record;
      if (stateRecord) {
        setCategory(stateRecord.category as CategoryType);
        setType(stateRecord.type);
        setOccurredAt(toLocalDateTimeString(new Date(stateRecord.occurredAt)));
        setNote(stateRecord.note || "");
        setImages(normalizeRecordImages(stateRecord.images));
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
        setImages(normalizeRecordImages(record.images));
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
        setImages(normalizeRecordImages(freshRecord.images));
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
        setSleepDuration(data.durationMinutes || 0);
        break;
      case "temperature":
        setTemperature(data.value || 36.5);
        setTempLocation(data.location || "axillary");
        break;
      case "play":
        setPlayDuration(data.durationMinutes || 30);
        break;
      case "bath":
        setBathDuration(data.durationMinutes || 15);
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
        return { durationMinutes: bathDuration };
      case "supplement":
        return { name: supplementName };
      case "temperature":
        return { value: temperature, location: tempLocation };
      case "sleep":
        return {
          startTime: new Date(occurredAt).toISOString(),
          durationMinutes: sleepDuration,
        };
      case "play":
        return { durationMinutes: playDuration };
      default:
        return {};
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!currentBaby) return;
    setLoading(true);

    try {
      const payload = {
        babyId: currentBaby.id,
        category,
        type,
        data: buildData(),
        occurredAt: new Date(occurredAt).toISOString(),
        note: note || undefined,
        images: images.length > 0
          ? images.map((img) => ({ key: img.key, rawKey: img.rawKey, mediaType: img.mediaType }))
          : undefined,
      };

      if (isEditing) {
        await api.put(`/records/${id}`, payload);
      } else {
        await api.post("/records", payload);
      }
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                左侧(分钟)
              </label>
              <input
                type="number"
                value={leftMinutes}
                onChange={(e) => setLeftMinutes(+e.target.value)}
                className="input"
                min={0}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                右侧(分钟)
              </label>
              <input
                type="number"
                value={rightMinutes}
                onChange={(e) => setRightMinutes(+e.target.value)}
                className="input"
                min={0}
              />
            </div>
          </div>
        );
      case "bottle":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                奶类型
              </label>
              <div className="flex gap-3">
                <button
                  type="button"
                  onClick={() => setMilkType("formula")}
                  className={`flex-1 py-2 rounded-lg border-2 text-sm ${milkType === "formula" ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                >
                  配方奶
                </button>
                <button
                  type="button"
                  onClick={() => setMilkType("breast_milk")}
                  className={`flex-1 py-2 rounded-lg border-2 text-sm ${milkType === "breast_milk" ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                >
                  母乳
                </button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                奶量(ml)
              </label>
              <input
                type="number"
                value={amountMl}
                onChange={(e) => setAmountMl(+e.target.value)}
                className="input"
                min={0}
                step={10}
              />
            </div>
          </div>
        );
      case "solid":
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              水量(ml)
            </label>
            <input
              type="number"
              value={waterMl}
              onChange={(e) => setWaterMl(+e.target.value)}
              className="input"
              min={0}
              step={5}
            />
          </div>
        );
      case "diaper":
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                  className={`flex-1 py-2 rounded-lg border-2 text-sm ${diaperType === item.value ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
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
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              名称
            </label>
            <input
              type="text"
              value={supplementName}
              onChange={(e) => setSupplementName(e.target.value)}
              className="input"
              placeholder="如：维生素D"
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
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
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
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
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                温度(°C)
              </label>
              <input
                type="number"
                value={temperature}
                onChange={(e) => setTemperature(+e.target.value)}
                className="input"
                min={35}
                max={42}
                step={0.1}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
                    className={`flex-1 py-2 rounded-lg border-2 text-sm ${tempLocation === item.value ? "border-primary-400 bg-primary-50 dark:bg-primary-900/30 dark:text-primary-300" : "border-gray-200 dark:border-gray-600 dark:text-gray-300"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        );
      case "sleep":
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              持续时间(分钟)
            </label>
            <input
              type="number"
              value={sleepDuration}
              onChange={(e) => setSleepDuration(+e.target.value)}
              className="input"
              min={0}
              step={1}
            />
          </div>
        );
      case "bath":
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              持续时间(分钟)
            </label>
            <input
              type="number"
              value={bathDuration}
              onChange={(e) => setBathDuration(+e.target.value)}
              className="input"
              min={0}
              step={1}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[5, 10, 15, 20, 30].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setBathDuration(min)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
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
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              持续时间(分钟)
            </label>
            <input
              type="number"
              value={playDuration}
              onChange={(e) => setPlayDuration(+e.target.value)}
              className="input"
              min={0}
              step={1}
            />
            <div className="flex flex-wrap gap-1.5 mt-2">
              {[10, 15, 20, 30, 45, 60].map((min) => (
                <button
                  key={min}
                  type="button"
                  onClick={() => setPlayDuration(min)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
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
        <Button type="submit" form="record-form" size="sm" disabled={loading}>
          {loading ? "保存中..." : "保存"}
        </Button>
      </div>

      <form
        id="record-form"
        onSubmit={handleSubmit}
        className="flex-1 overflow-y-auto px-4 md:px-8 py-6 space-y-5"
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
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
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
            {images.map((img, idx) => (
              <div
                key={idx}
                className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 dark:border-gray-600"
              >
                {img.mediaType === "video" ? (
                  <div className="w-full h-full bg-gray-200 dark:bg-gray-700 flex items-center justify-center">
                    <Play size={20} className="text-gray-500" />
                  </div>
                ) : (
                  <img
                    src={img.url}
                    alt=""
                    className="w-full h-full object-cover cursor-zoom-in"
                    onClick={() => {
                      setViewerIndex(idx);
                      setViewerOpen(true);
                    }}
                  />
                )}
                <button
                  type="button"
                  onClick={() => setImages(images.filter((_, i) => i !== idx))}
                  className="absolute top-0.5 right-0.5 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center"
                >
                  <X size={12} className="text-white" />
                </button>
              </div>
            ))}
            <label className="w-20 h-20 rounded-lg border-2 border-dashed border-gray-300 dark:border-gray-600 flex items-center justify-center cursor-pointer hover:border-primary-400 dark:hover:border-primary-500 transition-colors">
              <input
                type="file"
                accept="image/*,video/*"
                className="hidden"
                multiple
                disabled={uploading}
                onChange={async (e) => {
                  const files = e.target.files;
                  if (!files || files.length === 0) return;
                  setUploading(true);
                  try {
                    const newItems: RecordImage[] = [];
                    for (const file of Array.from(files)) {
                      const result = await api.moments.uploadMediaSingle(file);
                      newItems.push({
                        key: result.key,
                        rawKey: result.rawKey,
                        mediaType: result.mediaType,
                        url: result.url,
                        rawUrl: result.rawUrl,
                      });
                    }
                    setImages((prev) => [...prev, ...newItems]);
                  } catch {
                    toast("上传失败", "error");
                  } finally {
                    setUploading(false);
                    e.target.value = "";
                  }
                }}
              />
              {uploading ? (
                <span className="text-xs text-gray-400">上传中</span>
              ) : (
                <ImagePlus size={20} className="text-gray-400" />
              )}
            </label>
          </div>
          {images.length > 0 && (
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              已选 {images.length} 个文件
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
        images={images.map((img) => img.url)}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </div>
  );
}
