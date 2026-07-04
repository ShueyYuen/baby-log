import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Droplets, Moon, Baby, Pill, Bath, Apple, Milk, GlassWater, Plus, X, Gamepad2, Thermometer, Heart, Bell, BellOff, AlarmClock } from 'lucide-react';
import { ImageViewer, useToast } from '../components/ui';
import { isPushSupported, subscribePush, isSubscribed } from '../lib/push';
import { addFeedingReminderToCalendar } from '../lib/calendar';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface RecordItem {
  id: string;
  category: string;
  type: string;
  data: any;
  occurredAt: string;
  note?: string;
  images?: string[];
  user?: { displayName: string };
}

interface Summary {
  lastFeeding: { time: string; minutesAgo: number } | null;
  lastDiaper: { time: string; minutesAgo: number } | null;
  lastSleep: { time: string; minutesAgo: number } | null;
}

interface FeedingPrediction {
  minutesUntilNext: number | null;
  avgIntervalMinutes: number | null;
  method: 'bottle' | 'breastfeed' | 'average' | null;
}

const typeConfig: Record<string, { label: string; icon: any; color: string }> = {
  breastfeed: { label: '母乳', icon: Heart, color: 'text-pink-500 bg-pink-50 dark:bg-pink-950/40' },
  bottle: { label: '瓶喂', icon: Milk, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' },
  solid: { label: '辅食', icon: Apple, color: 'text-green-500 bg-green-50 dark:bg-green-950/40' },
  water: { label: '喝水', icon: GlassWater, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-950/40' },
  diaper: { label: '换尿布', icon: Droplets, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' },
  bath: { label: '洗澡', icon: Bath, color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40' },
  supplement: { label: '营养补充', icon: Pill, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40' },
  temperature: { label: '体温', icon: Thermometer, color: 'text-red-500 bg-red-50 dark:bg-red-950/40' },
  sleep: { label: '睡眠', icon: Moon, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' },
  play: { label: '玩耍', icon: Baby, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/40' },
  other: { label: '其他', icon: Baby, color: 'text-gray-500 bg-gray-50 dark:bg-gray-700' },
};

const allRecordTypes = [
  { type: 'breastfeed', category: 'feeding', label: '母乳', icon: Heart, color: 'text-pink-500 bg-pink-50 dark:bg-pink-950/40' },
  { type: 'bottle', category: 'feeding', label: '瓶喂', icon: Milk, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40' },
  { type: 'solid', category: 'feeding', label: '辅食', icon: Apple, color: 'text-green-500 bg-green-50 dark:bg-green-950/40' },
  { type: 'water', category: 'feeding', label: '喝水', icon: GlassWater, color: 'text-cyan-500 bg-cyan-50 dark:bg-cyan-950/40' },
  { type: 'diaper', category: 'nursing', label: '换尿布', icon: Droplets, color: 'text-yellow-600 bg-yellow-50 dark:bg-yellow-950/40' },
  { type: 'bath', category: 'nursing', label: '洗澡', icon: Bath, color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40' },
  { type: 'supplement', category: 'nursing', label: '营养补充', icon: Pill, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40' },
  { type: 'temperature', category: 'nursing', label: '体温', icon: Thermometer, color: 'text-red-500 bg-red-50 dark:bg-red-950/40' },
  { type: 'sleep', category: 'activity', label: '睡眠', icon: Moon, color: 'text-indigo-500 bg-indigo-50 dark:bg-indigo-950/40' },
  { type: 'play', category: 'activity', label: '玩耍', icon: Gamepad2, color: 'text-orange-500 bg-orange-50 dark:bg-orange-950/40' },
  { type: 'other', category: 'activity', label: '其他', icon: Baby, color: 'text-gray-500 bg-gray-50 dark:bg-gray-700' },
];


function formatRecordDetail(record: RecordItem): string {
  const { type, data } = record;
  switch (type) {
    case 'breastfeed':
      return `左${data.leftMinutes || 0}分钟 / 右${data.rightMinutes || 0}分钟`;
    case 'bottle':
      return `${data.milkType === 'formula' ? '配方奶' : '母乳'} ${data.amountMl}ml`;
    case 'solid':
      return `${data.name}${data.amount ? ` (${data.amount})` : ''}`;
    case 'water':
      return `${data.amountMl}ml`;
    case 'diaper':
      return data.type === 'wet' ? '尿' : data.type === 'dirty' ? '便' : '尿+便';
    case 'sleep':
      return data.durationMinutes ? `${data.durationMinutes}分钟` : '进行中';
    case 'supplement':
      return data.name || '';
    case 'temperature': {
      const loc: Record<string, string> = { axillary: '腋下', ear: '耳温', forehead: '额温', rectal: '肛温' };
      return `${data.value}°C (${loc[data.location] || data.location})`;
    }
    case 'play':
      return data.durationMinutes ? `${data.durationMinutes}分钟` : '';
    case 'bath':
      return data.durationMinutes ? `${data.durationMinutes}分钟` : '';
    default:
      return record.note || '';
  }
}

function formatTimeAgo(minutes: number): string {
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 > 0 ? `${minutes % 60}分钟` : ''}前`;
  return `${Math.floor(hours / 24)}天前`;
}

function minutesSince(time: string, now: number): number {
  return Math.max(0, Math.round((now - new Date(time).getTime()) / 60000));
}

export default function TimelinePage() {
  const { currentBaby } = useBaby();
  const { toast } = useToast();
  const navigate = useNavigate();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [prediction, setPrediction] = useState<FeedingPrediction | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');
  const [showTypePanel, setShowTypePanel] = useState(false);
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(isSubscribed());
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    setPushEnabled(isSubscribed());
  }, []);

  // 每分钟刷新一次“X分钟前”，由前端自行计算
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 60 * 1000);
    return () => clearInterval(timer);
  }, []);

  const handleAddType = (type: string, category: string) => {
    setShowTypePanel(false);
    navigate(`/record/new?type=${type}&category=${category}`);
  };

  const handleEnablePush = async () => {
    if (pushEnabled) {
      // Already enabled — set a manual reminder for the predicted time
      if (prediction?.minutesUntilNext && prediction.minutesUntilNext > 0 && currentBaby) {
        const remindAt = new Date(Date.now() + prediction.minutesUntilNext * 60000);
        try {
          await api.post('/push/reminder', {
            babyId: currentBaby.id,
            remindAt: remindAt.toISOString(),
            source: 'feeding_manual',
            title: '🍼 喂奶提醒',
            body: '您设置的喂奶提醒时间已到',
          });
          toast('提醒已设置！将在预计喂奶时间通知您', 'success');
        } catch {
          toast('设置提醒失败', 'error');
        }
      }
      return;
    }
    const success = await subscribePush();
    setPushEnabled(success);
    if (success) {
      toast('通知已开启！喂奶提醒将自动推送', 'success');
    }
  };

  useEffect(() => {
    if (!currentBaby) return;
    loadData();
  }, [currentBaby, filter]);

  const loadData = async () => {
    if (!currentBaby) return;
    setLoading(true);
    try {
      const params = new URLSearchParams({ babyId: currentBaby.id, pageSize: '50' });
      if (filter) params.set('category', filter);

      const [recordsRes, summaryRes, predictRes] = await Promise.all([
        api.get<{ success: boolean; data: { items: RecordItem[] } }>(`/records?${params}`),
        api.get<{ success: boolean; data: Summary }>(`/stats/summary?babyId=${currentBaby.id}`),
        api.get<{ success: boolean; data: FeedingPrediction }>(`/stats/predict?babyId=${currentBaby.id}`),
      ]);

      setRecords(recordsRes.data.items);
      setSummary(summaryRes.data);
      setPrediction(predictRes.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };


  const groupedRecords = records.reduce<Record<string, RecordItem[]>>((acc, record) => {
    const date = dayjs(record.occurredAt);
    const today = dayjs().startOf('day');
    const yesterday = today.subtract(1, 'day');

    let group: string;
    if (date.isAfter(today)) group = '今天';
    else if (date.isAfter(yesterday)) group = '昨天';
    else group = date.format('MM月DD日');

    if (!acc[group]) acc[group] = [];
    acc[group].push(record);
    return acc;
  }, {});

  return (
    <>
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">上次喂养</p>
            <p className="text-sm font-semibold mt-1 dark:text-gray-100">
              {summary.lastFeeding ? formatTimeAgo(minutesSince(summary.lastFeeding.time, now)) : '--'}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">上次换尿布</p>
            <p className="text-sm font-semibold mt-1 dark:text-gray-100">
              {summary.lastDiaper ? formatTimeAgo(minutesSince(summary.lastDiaper.time, now)) : '--'}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-gray-500 dark:text-gray-400">上次睡眠</p>
            <p className="text-sm font-semibold mt-1 dark:text-gray-100">
              {summary.lastSleep ? formatTimeAgo(minutesSince(summary.lastSleep.time, now)) : '--'}
            </p>
          </div>
        </div>
      )}

      {/* Feeding Prediction */}
      {prediction?.minutesUntilNext != null && prediction.avgIntervalMinutes && (() => {
        const min = prediction.minutesUntilNext!;
        const interval = prediction.avgIntervalMinutes!;
        const ratio = min / interval;

        let cardBg: string, iconBg: string, iconColor: string, labelColor: string, badgeColor: string;
        if (min <= 0) {
          cardBg = 'bg-gradient-to-r from-red-50 to-rose-50 dark:from-red-950/30 dark:to-rose-950/30 border border-red-200 dark:border-red-900/50';
          iconBg = 'bg-red-100 dark:bg-red-900/50';
          iconColor = 'text-red-600 dark:text-red-400';
          labelColor = 'text-red-600 dark:text-red-400';
          badgeColor = 'text-red-500 dark:text-red-400';
        } else if (ratio <= 0.25) {
          cardBg = 'bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-amber-950/30 border border-orange-200 dark:border-orange-900/50';
          iconBg = 'bg-orange-100 dark:bg-orange-900/50';
          iconColor = 'text-orange-600 dark:text-orange-400';
          labelColor = 'text-orange-600 dark:text-orange-400';
          badgeColor = 'text-orange-500 dark:text-orange-400';
        } else if (ratio <= 0.5) {
          cardBg = 'bg-gradient-to-r from-yellow-50 to-amber-50 dark:from-yellow-950/30 dark:to-amber-950/30 border border-yellow-200 dark:border-yellow-900/50';
          iconBg = 'bg-yellow-100 dark:bg-yellow-900/50';
          iconColor = 'text-yellow-600 dark:text-yellow-500';
          labelColor = 'text-yellow-600 dark:text-yellow-500';
          badgeColor = 'text-yellow-600 dark:text-yellow-500';
        } else {
          cardBg = 'bg-gradient-to-r from-green-50 to-emerald-50 dark:from-green-950/30 dark:to-emerald-950/30 border border-green-200 dark:border-green-900/50';
          iconBg = 'bg-green-100 dark:bg-green-900/50';
          iconColor = 'text-green-600 dark:text-green-400';
          labelColor = 'text-green-600 dark:text-green-400';
          badgeColor = 'text-green-500 dark:text-green-400';
        }

        return (
          <div className={`card flex items-center gap-3 ${cardBg}`}>
            <div className={`w-9 h-9 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0`}>
              <Milk size={16} className={iconColor} />
            </div>
            <div className="flex-1 min-w-0">
              <p className={`text-xs font-medium ${labelColor}`}>
                预计下次喂奶
                {prediction.method === 'bottle' && ' (基于奶量)'}
                {prediction.method === 'breastfeed' && ' (基于哺乳时长)'}
              </p>
              <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                {(() => {
                  if (min <= 0) {
                    const overdue = Math.abs(min);
                    if (overdue < 60) return `已超时 ${overdue} 分钟，建议尽快喂奶`;
                    return `已超时 ${Math.floor(overdue / 60)}小时${overdue % 60 > 0 ? `${overdue % 60}分钟` : ''}，建议尽快喂奶`;
                  }
                  if (min < 60) return `约 ${min} 分钟后`;
                  return `约 ${Math.floor(min / 60)}小时${min % 60 > 0 ? `${min % 60}分钟` : ''}后`;
                })()}
              </p>
            </div>
            <span className={`text-xs whitespace-nowrap ${badgeColor}`}>
              间隔 {interval >= 60
                ? `${Math.floor(interval / 60)}h${interval % 60 > 0 ? `${interval % 60}m` : ''}`
                : `${interval}m`}
            </span>
            {isPushSupported() && (
              <button
                onClick={handleEnablePush}
                className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 transition-colors ${
                  pushEnabled
                    ? 'bg-green-100 dark:bg-green-900/50 text-green-600 dark:text-green-400'
                    : 'bg-gray-100 dark:bg-gray-700 text-gray-400 dark:text-gray-500'
                }`}
                title={pushEnabled ? '设置提醒' : '开启推送提醒'}
              >
                {pushEnabled ? <Bell size={14} /> : <BellOff size={14} />}
              </button>
            )}
            {min > 0 && (
              <button
                onClick={() => addFeedingReminderToCalendar(min)}
                className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 bg-gray-100 dark:bg-gray-700 text-gray-500 dark:text-gray-400 hover:bg-blue-100 hover:text-blue-600 dark:hover:bg-blue-900/50 dark:hover:text-blue-400 transition-colors"
                title="设置系统闹钟提醒"
              >
                <AlarmClock size={14} />
              </button>
            )}
          </div>
        );
      })()}

      {/* Filter */}
      <div className="flex gap-2 overflow-x-auto pb-2">
        {[
          { value: '', label: '全部' },
          { value: 'feeding', label: '喂养' },
          { value: 'nursing', label: '护理' },
          { value: 'activity', label: '活动' },
        ].map((item) => (
          <button
            key={item.value}
            onClick={() => setFilter(item.value)}
            className={`px-4 py-1.5 rounded-full text-sm whitespace-nowrap transition-colors ${
              filter === item.value
                ? 'bg-primary-500 text-white'
                : 'bg-white dark:bg-gray-800 text-gray-600 dark:text-gray-300 border border-gray-200 dark:border-gray-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {/* Timeline */}
      {loading ? (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      ) : records.length === 0 ? (
        <div className="text-center py-12 text-gray-400">暂无记录，点击 + 添加</div>
      ) : (
        <div className="space-y-6">
          {Object.entries(groupedRecords).map(([group, items]) => (
            <div key={group}>
              <h3 className="text-sm font-medium text-gray-500 dark:text-gray-400 mb-3">{group}</h3>
              <div className="space-y-2">
                {items.map((record) => {
                  const config = typeConfig[record.type] || typeConfig.other;
                  const Icon = config.icon;
                  return (
                    <div
                      key={record.id}
                      className="card flex items-center gap-3 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700 transition-colors"
                      onClick={() => navigate(`/record/${record.id}/edit`)}
                    >
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 ${config.color}`}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm dark:text-gray-100">{config.label}</span>
                          <span className="text-xs text-gray-400 dark:text-gray-500">
                            {dayjs(record.occurredAt).format('HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 dark:text-gray-400 truncate">
                          {formatRecordDetail(record)}
                        </p>
                      </div>
                      {record.images && record.images.length > 0 && (
                        <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                          {record.images.slice(0, 2).map((url, i) => (
                            <img
                              key={i}
                              src={url}
                              alt=""
                              className="w-10 h-10 rounded-lg object-cover cursor-zoom-in"
                              onClick={() => { setViewerImages(record.images!); setViewerIndex(i); setViewerOpen(true); }}
                            />
                          ))}
                          {record.images.length > 2 && (
                            <span
                              className="w-10 h-10 rounded-lg bg-gray-100 dark:bg-gray-700 flex items-center justify-center text-xs text-gray-500 cursor-zoom-in"
                              onClick={() => { setViewerImages(record.images!); setViewerIndex(2); setViewerOpen(true); }}
                            >
                              +{record.images.length - 2}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>

      {/* FAB */}
      <button
        onClick={() => setShowTypePanel(true)}
        className="fixed right-4 bottom-24 md:bottom-8 w-14 h-14 bg-primary-500 text-white rounded-full flex items-center justify-center shadow-lg hover:bg-primary-600 transition-colors z-40"
      >
        <Plus size={24} />
      </button>

      {/* Type Selection Panel */}
      {showTypePanel && (
        <div className="fixed inset-0 z-[100] flex items-end md:items-center justify-center">
          <div className="absolute inset-0 bg-black/40" onClick={() => setShowTypePanel(false)} />
          <div className="relative w-full max-w-sm bg-white dark:bg-gray-800 rounded-t-2xl md:rounded-2xl p-6 pb-10 animate-slide-up">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold dark:text-gray-100">添加记录</h3>
              <button onClick={() => setShowTypePanel(false)} className="p-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200">
                <X size={20} />
              </button>
            </div>
            <div className="grid grid-cols-4 gap-4">
              {allRecordTypes.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.type}
                    onClick={() => handleAddType(item.type, item.category)}
                    className="flex flex-col items-center gap-2 p-3 rounded-xl hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                  >
                    <div className={`w-12 h-12 rounded-full flex items-center justify-center ${item.color}`}>
                      <Icon size={22} />
                    </div>
                    <span className="text-xs text-gray-700 dark:text-gray-300">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      <ImageViewer
        images={viewerImages}
        initialIndex={viewerIndex}
        open={viewerOpen}
        onOpenChange={setViewerOpen}
      />
    </>
  );
}
