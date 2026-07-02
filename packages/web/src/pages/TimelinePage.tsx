import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import relativeTime from 'dayjs/plugin/relativeTime';
import 'dayjs/locale/zh-cn';
import { Droplets, Moon, Baby, Pill, Bath, Apple, Milk, GlassWater, Pencil, Trash2 } from 'lucide-react';

dayjs.extend(relativeTime);
dayjs.locale('zh-cn');

interface RecordItem {
  id: string;
  category: string;
  type: string;
  data: any;
  occurredAt: string;
  note?: string;
  user?: { displayName: string };
}

interface Summary {
  lastFeeding: { time: string; minutesAgo: number } | null;
  lastDiaper: { time: string; minutesAgo: number } | null;
  lastSleep: { time: string; minutesAgo: number } | null;
}

const typeConfig: Record<string, { label: string; icon: any; color: string }> = {
  breastfeed: { label: '母乳', icon: Milk, color: 'text-pink-500 bg-pink-50' },
  bottle: { label: '瓶喂', icon: Milk, color: 'text-blue-500 bg-blue-50' },
  solid: { label: '辅食', icon: Apple, color: 'text-green-500 bg-green-50' },
  water: { label: '喝水', icon: GlassWater, color: 'text-cyan-500 bg-cyan-50' },
  diaper: { label: '换尿布', icon: Droplets, color: 'text-yellow-600 bg-yellow-50' },
  bath: { label: '洗澡', icon: Bath, color: 'text-teal-500 bg-teal-50' },
  supplement: { label: '营养补充', icon: Pill, color: 'text-purple-500 bg-purple-50' },
  sleep: { label: '睡眠', icon: Moon, color: 'text-indigo-500 bg-indigo-50' },
  play: { label: '玩耍', icon: Baby, color: 'text-orange-500 bg-orange-50' },
  other: { label: '其他', icon: Baby, color: 'text-gray-500 bg-gray-50' },
};

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
    default:
      return record.note || '';
  }
}

function formatTimeAgo(minutes: number): string {
  if (minutes < 60) return `${minutes}分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时${minutes % 60 > 0 ? `${minutes % 60}分钟` : ''}前`;
  return `${Math.floor(hours / 24)}天前`;
}

export default function TimelinePage() {
  const { currentBaby } = useBaby();
  const navigate = useNavigate();
  const [records, setRecords] = useState<RecordItem[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<string>('');

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

      const [recordsRes, summaryRes] = await Promise.all([
        api.get<{ success: boolean; data: { items: RecordItem[] } }>(`/records?${params}`),
        api.get<{ success: boolean; data: Summary }>(`/stats/summary?babyId=${currentBaby.id}`),
      ]);

      setRecords(recordsRes.data.items);
      setSummary(summaryRes.data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('确定删除这条记录吗？')) return;
    try {
      await api.delete(`/records/${id}`);
      setRecords((prev) => prev.filter((r) => r.id !== id));
    } catch {
      // ignore
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
    <div className="space-y-6">
      {/* Summary Cards */}
      {summary && (
        <div className="grid grid-cols-3 gap-3">
          <div className="card text-center">
            <p className="text-xs text-gray-500">上次喂养</p>
            <p className="text-sm font-semibold mt-1">
              {summary.lastFeeding ? formatTimeAgo(summary.lastFeeding.minutesAgo) : '--'}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-gray-500">上次换尿布</p>
            <p className="text-sm font-semibold mt-1">
              {summary.lastDiaper ? formatTimeAgo(summary.lastDiaper.minutesAgo) : '--'}
            </p>
          </div>
          <div className="card text-center">
            <p className="text-xs text-gray-500">上次睡眠</p>
            <p className="text-sm font-semibold mt-1">
              {summary.lastSleep ? formatTimeAgo(summary.lastSleep.minutesAgo) : '--'}
            </p>
          </div>
        </div>
      )}

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
                : 'bg-white text-gray-600 border border-gray-200'
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
              <h3 className="text-sm font-medium text-gray-500 mb-3">{group}</h3>
              <div className="space-y-2">
                {items.map((record) => {
                  const config = typeConfig[record.type] || typeConfig.other;
                  const Icon = config.icon;
                  return (
                    <div key={record.id} className="card flex items-center gap-3 group">
                      <div className={`w-10 h-10 rounded-full flex items-center justify-center ${config.color}`}>
                        <Icon size={18} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm">{config.label}</span>
                          <span className="text-xs text-gray-400">
                            {dayjs(record.occurredAt).format('HH:mm')}
                          </span>
                        </div>
                        <p className="text-sm text-gray-500 truncate">
                          {formatRecordDetail(record)}
                        </p>
                      </div>
                      <div className="opacity-0 group-hover:opacity-100 flex items-center gap-1 transition-opacity">
                        <button
                          onClick={() => navigate(`/record/${record.id}/edit`)}
                          className="p-1.5 text-gray-400 hover:text-blue-500 rounded-md hover:bg-blue-50 transition-colors"
                          title="编辑"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => handleDelete(record.id)}
                          className="p-1.5 text-gray-400 hover:text-red-500 rounded-md hover:bg-red-50 transition-colors"
                          title="删除"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
