import { useVirtualizer } from "@tanstack/react-virtual";
import dayjs from "dayjs";
import {
  BarChart3,
  Plus,
  Refrigerator,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import {
  FeedingPredictionCard,
  formatTimeAgo,
  minutesSince,
} from "../components/FeedingPredictionCard";
import { OngoingBanner, useNowTicker } from "../components/OngoingBanner";
import { QuickRecordBar } from "../components/QuickRecordBar";
import { RecordCard } from "../components/RecordCard";
import { TwoPhaseTypeButton } from "../components/TwoPhaseTypeButton";
import {
  Button,
  DatePicker,
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
  useToast,
} from "../components/ui";
import { TimelineSkeleton } from "../components/ui/skeleton";
import { useAuth } from "../contexts/AuthContext";
import { useBaby } from "../contexts/BabyContext";
import { useI18n } from "../contexts/I18nContext";
import { useActivated } from "../hooks/useActivated";
import { useRefreshHandler } from "../hooks/usePullRefresh";
import { useServerEvent } from "../hooks/useServerEvents";
import {
  api,
  type FeedingPrediction,
  type TimelineRecord,
  type TimelineSummary,
} from "../lib/api";
import { isSubscribed, subscribePush } from "../lib/push";
import {
  cacheInvalidate,
  cacheRead,
  cacheReadAsync,
  cacheWrite,
} from "../lib/queryCache";
import { quickDiaper, startOngoing } from "../lib/quick-record";
import { allRecordTypes, recordTypeLabel, twoPhaseTypes } from "../lib/record-types";

export default function TimelinePage() {
  const { currentBaby } = useBaby();
  const { isViewer, user } = useAuth();
  const { t } = useI18n();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [records, setRecords] = useState<TimelineRecord[]>([]);
  const [summary, setSummary] = useState<TimelineSummary | null>(null);
  const [prediction, setPrediction] = useState<FeedingPrediction | null>(null);
  const [pushEnabled, setPushEnabled] = useState(isSubscribed());
  const [showFilters, setShowFilters] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [error, setError] = useState(false);
  const [filter, setFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [hasImages, setHasImages] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const searchTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const loadIdRef = useRef(0);
  const [showTypePanel, setShowTypePanel] = useState(false);

  const hasOngoing = records.some((r) => r.data?.ongoing);
  const now = useNowTicker(hasOngoing);

  const handleAddType = (type: string, category: string) => {
    setShowTypePanel(false);
    navigate(`/record/new?type=${type}&category=${category}`);
  };

  const handleStartOngoing = async (type: string, category: string) => {
    if (!currentBaby) return;
    const label = recordTypeLabel(type, t);
    const existing = records.find((r) => r.type === type && r.data?.ongoing);
    if (existing) {
      toast(t("timeline.alreadyOngoing", { label }), "info");
      setShowTypePanel(false);
      return;
    }
    try {
      await startOngoing(currentBaby.id, type as "sleep" | "bath" | "play");
      setShowTypePanel(false);
      toast(t("timeline.started", { label }), "success");
      loadData(true);
    } catch {
      toast(t("timeline.startFailed"), "error");
    }
  };

  const filterKey = `${filter}|${typeFilter}|${search}|${hasImages}|${mineOnly}|${startDate}|${endDate}`;

  const loadData = async (invalidate = false) => {
    if (!currentBaby) {
      setLoading(false);
      setRecords([]);
      setSummary(null);
      setPrediction(null);
      return;
    }
    const thisLoadId = ++loadIdRef.current;
    const params = new URLSearchParams({
      babyId: currentBaby.id,
      pageSize: "50",
    });
    if (filter !== "all") params.set("category", filter);
    if (typeFilter !== "all") params.set("type", typeFilter);
    if (search) params.set("search", search);
    if (hasImages) params.set("hasImages", "true");
    if (mineOnly && user?.id) params.set("createdBy", user.id);
    if (startDate) params.set("startDate", startDate);
    if (endDate) params.set("endDate", endDate);
    const cKey = `/timeline?${params}`;

    if (invalidate) cacheInvalidate("/timeline");

    type CachedRes = {
      success: boolean;
      data: {
        records: TimelineRecord[];
        hasMore: boolean;
        summary?: TimelineSummary;
        prediction?: FeedingPrediction;
      };
    };
    let cached = cacheRead<CachedRes>(cKey);
    if (!cached) cached = (await cacheReadAsync<CachedRes>(cKey)) ?? undefined;
    if (thisLoadId !== loadIdRef.current) return;

    if (cached) {
      setRecords(cached.data.records);
      setHasMore(cached.data.hasMore);
      setSummary(cached.data.summary ?? null);
      setPrediction(cached.data.prediction ?? null);
      setLoading(false);
      setError(false);
    } else {
      setLoading(true);
    }

    try {
      const res = await api.get<CachedRes>(cKey);
      if (thisLoadId !== loadIdRef.current) return;
      cacheWrite(cKey, res);
      setRecords(res.data.records);
      setHasMore(res.data.hasMore);
      setSummary(res.data.summary ?? null);
      setPrediction(res.data.prediction ?? null);
      setError(false);
    } catch {
      if (thisLoadId !== loadIdRef.current) return;
      if (!cached) setError(true);
    } finally {
      if (thisLoadId === loadIdRef.current) setLoading(false);
    }
  };

  useEffect(() => {
    if (!currentBaby) return;
    loadData();
  }, [currentBaby, filterKey]);

  useActivated(
    useCallback(() => {
      loadData(true);
    }, [currentBaby, filterKey]),
  );
  useRefreshHandler(
    useCallback(async () => {
      await loadData(true);
    }, [currentBaby, filterKey]),
  );
  useServerEvent(
    ["record.created", "record.updated", "record.deleted"],
    useCallback(() => {
      loadData(true);
    }, [currentBaby, filterKey]),
  );

  useEffect(() => {
    const quick = searchParams.get("quick");
    if (!quick || !currentBaby || isViewer) return;
    setSearchParams({}, { replace: true });
    (async () => {
      try {
        if (quick === "sleep") {
          await startOngoing(currentBaby.id, "sleep");
          toast(t("timeline.sleepStarted"), "success");
          loadData(true);
        } else if (quick === "diaper") {
          const rec = await quickDiaper(currentBaby.id, "wet");
          toast(t("timeline.loggedWet"), "success", {
            action: {
              label: t("common.undo"),
              onClick: async () => {
                try {
                  await api.recordsCrud.delete(rec.id);
                  loadData(true);
                } catch {
                  /* ignore */
                }
              },
            },
          });
          loadData(true);
        }
      } catch {
        toast(t("timeline.actionFailed"), "error");
      }
    })();
  }, [searchParams, currentBaby, isViewer]);

  const handleEnablePush = async () => {
    if (pushEnabled) {
      if (
        prediction?.minutesUntilNext &&
        prediction.minutesUntilNext > 0 &&
        currentBaby
      ) {
        const remindAt = new Date(
          Date.now() + prediction.minutesUntilNext * 60000,
        );
        try {
          await api.push.reminder({
            babyId: currentBaby.id,
            remindAt: remindAt.toISOString(),
            source: "feeding_manual",
            title: t("timeline.reminderTitle"),
            body: t("timeline.reminderBody"),
          });
          toast(t("timeline.reminderSet"), "success");
        } catch {
          toast(t("timeline.reminderFailed"), "error");
        }
      }
      return;
    }
    const success = await subscribePush();
    setPushEnabled(success);
    if (success) toast(t("timeline.pushEnabled"), "success");
  };

  const loadMore = async () => {
    if (!currentBaby || loadingMore || !hasMore || records.length === 0) return;
    setLoadingMore(true);
    const lastRecord = records[records.length - 1];
    const beforeMs = new Date(lastRecord.occurredAt).getTime();
    try {
      const res = await api.timeline.list(currentBaby.id, {
        pageSize: 50,
        before: beforeMs,
        category: filter,
        type: typeFilter,
        search: search || undefined,
        hasImages: hasImages || undefined,
        createdBy: mineOnly ? user?.id : undefined,
        startDate: startDate || undefined,
        endDate: endDate || undefined,
      });
      setRecords((prev) => [...prev, ...res.data.records]);
      setHasMore(res.data.hasMore);
    } catch {
      /* retry on next scroll */
    } finally {
      setLoadingMore(false);
    }
  };

  type FlatRow =
    | { kind: "header"; group: string }
    | { kind: "item"; record: TimelineRecord };
  const flatRows = useMemo(() => {
    const grouped = records.reduce<Record<string, TimelineRecord[]>>(
      (acc, record) => {
        const date = dayjs(record.occurredAt);
        const today = dayjs().startOf("day");
        const yesterday = today.subtract(1, "day");
        let group: string;
        if (date.isAfter(today) || date.isSame(today, "day")) group = t("time.today");
        else if (date.isAfter(yesterday) || date.isSame(yesterday, "day"))
          group = t("time.yesterday");
        else group = date.format(t("dateFmt.mdPad"));
        if (!acc[group]) acc[group] = [];
        acc[group].push(record);
        return acc;
      },
      {},
    );
    const rows: FlatRow[] = [];
    for (const [group, items] of Object.entries(grouped)) {
      rows.push({ kind: "header", group });
      for (const record of items) rows.push({ kind: "item", record });
    }
    return rows;
  }, [records, t]);

  const listRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrollElRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const el = containerRef.current?.closest(
      ".keepalive-page",
    ) as HTMLElement | null;
    if (el) scrollElRef.current = el;
  }, []);

  const virtualizer = useVirtualizer({
    count: flatRows.length,
    getScrollElement: () => scrollElRef.current,
    estimateSize: useCallback(
      (i: number) => {
        if (flatRows[i]?.kind !== "header") return 88;
        return i === 0 ? 28 : 40;
      },
      [flatRows],
    ),
    overscan: 8,
    scrollMargin: listRef.current?.offsetTop ?? 0,
  });

  useEffect(() => {
    const el = scrollElRef.current;
    if (!el || !hasMore) return;
    const handleScroll = () => {
      if (el.scrollTop + el.clientHeight >= el.scrollHeight - 300) loadMore();
    };
    el.addEventListener("scroll", handleScroll, { passive: true });
    return () => el.removeEventListener("scroll", handleScroll);
  }, [hasMore, loadingMore, records.length]);

  const subtypeOptions = allRecordTypes.filter(
    (t) => filter === "all" || t.category === filter,
  );
  const extraFilterActive = hasImages || mineOnly || !!startDate || !!endDate;
  const chipClass = (active: boolean) =>
    `px-3 py-1 rounded-full text-xs font-medium transition-colors ${
      active
        ? "bg-primary-500 text-white"
        : "glass-chip text-gray-600 dark:text-gray-300"
    }`;

  return (
    <>
      <div ref={containerRef} className="space-y-3">
        <OngoingBanner
          records={records}
          isViewer={isViewer}
          now={now}
          onChanged={() => loadData(true)}
        />

        {summary && (
          <div className="flex gap-2 items-stretch">
            <div className="grid grid-cols-3 gap-2 flex-1 min-w-0">
              <div className="card text-center py-2 px-1">
                <p className="text-[11px] text-gray-500">{t("timeline.lastFeeding")}</p>
                <p className="text-sm font-semibold mt-0.5 dark:text-gray-100">
                  {summary.lastFeeding
                    ? formatTimeAgo(minutesSince(summary.lastFeeding.time, now), t)
                    : "--"}
                </p>
              </div>
              <div className="card text-center py-2 px-1">
                <p className="text-[11px] text-gray-500">{t("timeline.lastDiaper")}</p>
                <p className="text-sm font-semibold mt-0.5 dark:text-gray-100">
                  {summary.lastDiaper
                    ? formatTimeAgo(minutesSince(summary.lastDiaper.time, now), t)
                    : "--"}
                </p>
              </div>
              <div className="card text-center py-2 px-1">
                <p className="text-[11px] text-gray-500">{t("timeline.lastSleep")}</p>
                <p className="text-sm font-semibold mt-0.5 dark:text-gray-100">
                  {summary.lastSleep
                    ? formatTimeAgo(minutesSince(summary.lastSleep.time, now), t)
                    : "--"}
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-1.5 shrink-0 w-9">
              <Link
                to="/stats"
                aria-label={t("me.stats")}
                title={t("me.stats")}
                className="card flex-1 flex items-center justify-center !p-0 text-gray-500 hover:text-primary-500"
              >
                <BarChart3 size={15} />
              </Link>
              <Link
                to="/milk-inventory"
                aria-label={t("me.milkInventory")}
                title={t("me.milkInventory")}
                className="card flex-1 flex items-center justify-center !p-0 text-gray-500 hover:text-primary-500"
              >
                <Refrigerator size={15} />
              </Link>
            </div>
          </div>
        )}

        {prediction?.minutesUntilNext != null &&
          prediction.avgIntervalMinutes != null &&
          summary?.lastFeeding &&
          minutesSince(summary.lastFeeding.time, now) < 12 * 60 && (
            <FeedingPredictionCard
              prediction={prediction}
              pushEnabled={pushEnabled}
              onPush={handleEnablePush}
            />
          )}

        {!isViewer && (
          <QuickRecordBar
            onCreated={() => loadData(true)}
            ongoingTypes={records
              .filter((r) => r.data?.ongoing)
              .map((r) => r.type)}
          />
        )}

        <div className="flex gap-2 items-center">
          <div className="relative flex-1">
            <Search
              size={16}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              type="text"
              placeholder={t("timeline.searchPlaceholder")}
              className="glass-input-ui w-full h-10 pl-9 pr-3 text-sm rounded-lg text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none"
              onChange={(e) => {
                const val = e.target.value;
                if (searchTimerRef.current)
                  clearTimeout(searchTimerRef.current);
                searchTimerRef.current = setTimeout(() => setSearch(val), 300);
              }}
            />
          </div>
          <Select
            value={filter}
            onValueChange={(v) => {
              setFilter(v);
              setTypeFilter("all");
            }}
          >
            <SelectTrigger className="w-24 shrink-0">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">{t("common.all")}</SelectItem>
              <SelectItem value="feeding">{t("categories.feeding")}</SelectItem>
              <SelectItem value="nursing">{t("categories.nursing")}</SelectItem>
              <SelectItem value="activity">{t("categories.activity")}</SelectItem>
            </SelectContent>
          </Select>
          <button
            type="button"
            aria-label={t("common.filter")}
            className={`${chipClass(showFilters || extraFilterActive)} h-10 w-10 !px-0 inline-flex items-center justify-center shrink-0 rounded-lg`}
            onClick={() => setShowFilters((v) => !v)}
          >
            <SlidersHorizontal size={16} />
          </button>
        </div>

        {filter !== "all" && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              type="button"
              className={chipClass(typeFilter === "all")}
              onClick={() => setTypeFilter("all")}
            >
              {t("timeline.allTypes")}
            </button>
            {subtypeOptions.map((item) => (
              <button
                key={item.type}
                type="button"
                className={chipClass(typeFilter === item.type)}
                onClick={() => setTypeFilter(item.type)}
              >
                {recordTypeLabel(item.type, t)}
              </button>
            ))}
          </div>
        )}

        {showFilters && (
          <>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                type="button"
                className={chipClass(hasImages)}
                onClick={() => setHasImages((v) => !v)}
              >
                {t("timeline.hasImages")}
              </button>
              <button
                type="button"
                className={chipClass(mineOnly)}
                onClick={() => setMineOnly((v) => !v)}
              >
                {t("timeline.mineOnly")}
              </button>
            </div>
            <div className="flex gap-2 items-center">
              <DatePicker
                value={startDate}
                onChange={setStartDate}
                placeholder={t("timeline.startDate")}
              />
              <span className="text-xs text-gray-400">{t("common.to")}</span>
              <DatePicker
                value={endDate}
                onChange={setEndDate}
                placeholder={t("timeline.endDate")}
              />
              {(startDate || endDate) && (
                <button
                  type="button"
                  className="text-xs text-gray-400"
                  onClick={() => {
                    setStartDate("");
                    setEndDate("");
                  }}
                >
                  {t("common.clear")}
                </button>
              )}
            </div>
          </>
        )}

        {loading ? (
          <TimelineSkeleton />
        ) : error ? (
          <div className="text-center py-12 text-gray-400">
            <p>{t("common.loadFailed")}</p>
            <button
              onClick={() => loadData(true)}
              className="mt-2 text-sm text-primary-500 hover:underline"
            >
              {t("common.retry")}
            </button>
          </div>
        ) : records.length === 0 ? (
          <div className="text-center py-12 text-gray-400 text-sm">
            {t("timeline.empty")}
          </div>
        ) : (
          <div ref={listRef}>
            <div
              style={{
                height: virtualizer.getTotalSize(),
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((vItem) => {
                const row = flatRows[vItem.index];
                if (!row) return null;
                return (
                  <div
                    key={vItem.key}
                    data-index={vItem.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${vItem.start - (virtualizer.options.scrollMargin ?? 0)}px)`,
                    }}
                  >
                    {row.kind === "header" ? (
                      <h3
                        className={`text-sm font-semibold text-gray-500 dark:text-gray-400 pb-2 ${
                          vItem.index === 0 ? "pt-0" : "pt-5"
                        }`}
                      >
                        {row.group}
                      </h3>
                    ) : (
                      <div className="pb-2.5">
                        <RecordCard record={row.record} isViewer={isViewer} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {loadingMore && (
              <div className="py-4 text-center text-sm text-gray-400">
                {t("common.loading")}
              </div>
            )}
            {!hasMore && records.length > 0 && !loadingMore && (
              <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">
                {t("timeline.loadedAll")}
              </div>
            )}
          </div>
        )}
      </div>

      {!isViewer && (
        <Button
          onClick={() => setShowTypePanel(true)}
          size="icon"
          className="glass-fab fixed right-4 bottom-24 md:bottom-8 w-14 h-14 rounded-full shadow-lg z-40"
        >
          <Plus size={24} />
        </Button>
      )}

      {showTypePanel &&
        createPortal(
          <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center">
            <div
              className="absolute inset-0 bg-black/40 dark:bg-black/60 animate-[dialog-overlay-in_200ms_ease-out]"
              onClick={() => setShowTypePanel(false)}
            />
            <div className="glass-type-panel relative w-full max-w-sm rounded-t-2xl md:rounded-2xl p-6 pb-10 animate-slide-up">
              <div className="flex items-center justify-between mb-5">
                <h3 className="text-lg font-semibold dark:text-gray-100">
                  {t("timeline.addRecord")}
                </h3>
                <button
                  onClick={() => setShowTypePanel(false)}
                  className="p-1 text-gray-400"
                >
                  <X size={20} />
                </button>
              </div>
              <p className="text-sm text-gray-400 mb-3">
                {t("timeline.addHint")}
              </p>
              <div className="grid grid-cols-4 gap-3">
                {allRecordTypes.map((item) => {
                  const Icon = item.icon;
                  if (twoPhaseTypes.includes(item.type)) {
                    return (
                      <TwoPhaseTypeButton
                        key={item.type}
                        label={recordTypeLabel(item.type, t)}
                        icon={Icon}
                        color={`${item.color} bg-white/50 dark:bg-white/[0.06]`}
                        onShortPress={() =>
                          handleAddType(item.type, item.category)
                        }
                        onLongPress={() =>
                          handleStartOngoing(item.type, item.category)
                        }
                      />
                    );
                  }
                  return (
                    <button
                      key={item.type}
                      type="button"
                      onClick={() => handleAddType(item.type, item.category)}
                      className="relative flex flex-col items-center gap-2 p-3 rounded-xl glass-icon-btn transition-colors"
                    >
                      <div
                        className={`w-13 h-13 rounded-full flex items-center justify-center ${item.color} bg-white/50 dark:bg-white/[0.06]`}
                      >
                        <Icon size={24} />
                      </div>
                      <span className="text-sm text-gray-700 dark:text-gray-300">
                        {recordTypeLabel(item.type, t)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
