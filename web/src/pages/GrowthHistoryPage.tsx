import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { ArrowLeft } from 'lucide-react';
import { Button, Input, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DatePicker } from '../components/ui';

interface GrowthItem {
  id: string;
  date: string;
  height?: number;
  weight?: number;
  headCircumference?: number;
  note?: string;
}

export default function GrowthHistoryPage() {
  const navigate = useNavigate();
  const { currentBaby } = useBaby();
  const { isViewer } = useAuth();
  const [records, setRecords] = useState<GrowthItem[]>([]);
  const [editingRecord, setEditingRecord] = useState<GrowthItem | null>(null);
  const [gDate, setGDate] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gHeight, setGHeight] = useState('');
  const [gHead, setGHead] = useState('');
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [total, setTotal] = useState(0);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const PAGE_SIZE = 20;

  useEffect(() => {
    if (currentBaby) loadRecords(1, true);
  }, [currentBaby]);

  useEffect(() => {
    const sentinel = sentinelRef.current;
    if (!sentinel || !hasMore || loadingMore) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !loadingMore) {
          loadRecords(page + 1, false);
        }
      },
      { rootMargin: '200px' }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [hasMore, loadingMore, page]);

  const loadRecords = async (p: number, replace: boolean) => {
    if (!currentBaby) return;
    if (p > 1) setLoadingMore(true);
    try {
      const res = await api.get<{ success: boolean; data: { items: GrowthItem[]; total: number; hasMore: boolean } | GrowthItem[] }>(
        `/growth?babyId=${currentBaby.id}&page=${p}&pageSize=${PAGE_SIZE}`
      );
      const items = Array.isArray(res.data) ? res.data : res.data.items;
      const more = Array.isArray(res.data) ? false : res.data.hasMore;
      const t = Array.isArray(res.data) ? items.length : res.data.total;
      setHasMore(more);
      setTotal(t);
      setRecords((prev) => replace ? items : [...prev, ...items]);
      setPage(p);
    } finally {
      setLoadingMore(false);
    }
  };

  const openEdit = (r: GrowthItem) => {
    setEditingRecord(r);
    setGDate(dayjs(r.date).format('YYYY-MM-DD'));
    setGWeight(r.weight?.toString() || '');
    setGHeight(r.height?.toString() || '');
    setGHead(r.headCircumference?.toString() || '');
  };

  const saveEdit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRecord) return;
    await api.put(`/growth/${editingRecord.id}`, {
      date: gDate,
      height: gHeight ? +gHeight : undefined,
      weight: gWeight ? +gWeight : undefined,
      headCircumference: gHead ? +gHead : undefined,
    });
    setEditingRecord(null);
    loadRecords(1, true);
  };

  const confirmDelete = (id: string) => {
    setDeleteTarget(id);
    setShowDeleteConfirm(true);
  };

  const doDelete = async () => {
    if (!deleteTarget) return;
    await api.delete(`/growth/${deleteTarget}`);
    setShowDeleteConfirm(false);
    setDeleteTarget(null);
    loadRecords(1, true);
  };

  return (
    <div className="fixed inset-0 md:top-0 md:bottom-0 md:left-64 z-30 flex flex-col bg-gray-50 dark:bg-gray-900">
      {/* Fixed Header */}
      <div className="flex items-center gap-3 px-4 md:px-8 py-3 border-b border-gray-100 dark:border-gray-800 flex-shrink-0">
        <Button variant="ghost" size="icon" onClick={() => navigate('/growth')}>
          <ArrowLeft size={20} />
        </Button>
        <h2 className="flex-1 text-xl font-semibold dark:text-gray-100">成长记录历史</h2>
        <span className="text-sm text-gray-400">{total}条</span>
      </div>

      {/* Scrollable Content */}
      <div className="flex-1 overflow-y-auto px-4 md:px-8 py-4">
        {records.length === 0 ? (
          <p className="text-center text-gray-400 py-12">暂无记录</p>
        ) : (
          <div className="space-y-2 max-w-4xl mx-auto">
            {records.map((r) => (
              <Card
                key={r.id}
                className={`transition-colors ${!isViewer ? 'cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800 active:bg-gray-100 dark:active:bg-gray-700' : ''}`}
                onClick={() => !isViewer && openEdit(r)}
              >
                <CardContent className="flex items-center justify-between py-3">
                  <div className="flex-1">
                    <p className="text-sm font-medium dark:text-gray-100">{dayjs(r.date).format('YYYY-MM-DD')}</p>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
                      {r.weight != null && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">体重 <span className="font-medium text-orange-500">{r.weight}</span> kg</span>
                      )}
                      {r.height != null && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">身高 <span className="font-medium text-green-500">{r.height}</span> cm</span>
                      )}
                      {r.headCircumference != null && (
                        <span className="text-xs text-gray-500 dark:text-gray-400">头围 <span className="font-medium text-indigo-500">{r.headCircumference}</span> cm</span>
                      )}
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}
            {loadingMore && (
              <div className="flex justify-center py-4">
                <div className="w-5 h-5 border-2 border-primary-400 border-t-transparent rounded-full animate-spin" />
              </div>
            )}
            {hasMore && !loadingMore && (
              <div ref={sentinelRef} className="h-4" />
            )}
            {!hasMore && records.length > 0 && !loadingMore && (
              <div className="py-4 text-center text-xs text-gray-300 dark:text-gray-600">
                已加载全部记录
              </div>
            )}
          </div>
        )}
      </div>

      {/* Edit Dialog */}
      <Dialog open={!!editingRecord} onOpenChange={(open) => { if (!open) setEditingRecord(null); }}>
        <DialogContent className="w-[calc(100%-2rem)] max-w-sm">
          <DialogHeader>
            <DialogTitle>编辑记录</DialogTitle>
          </DialogHeader>
          <form onSubmit={saveEdit} className="space-y-4">
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">日期</label>
              <DatePicker value={gDate} onChange={setGDate} placeholder="选择日期" />
            </div>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">体重(kg)</label>
              <Input type="number" value={gWeight} onChange={(e) => setGWeight(e.target.value)} step="0.1" placeholder="如：3.5" />
            </div>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">身高(cm)</label>
              <Input type="number" value={gHeight} onChange={(e) => setGHeight(e.target.value)} step="0.1" placeholder="如：50" />
            </div>
            <div>
              <label className="block text-sm text-gray-700 dark:text-gray-300 mb-1">头围(cm)</label>
              <Input type="number" value={gHead} onChange={(e) => setGHead(e.target.value)} step="0.1" placeholder="如：34" />
            </div>
            <div className="flex gap-3">
              <Button type="button" variant="outline" className="flex-1" onClick={() => setEditingRecord(null)}>取消</Button>
              <Button type="submit" className="flex-1">保存</Button>
            </div>
            <button
              type="button"
              onClick={() => { setEditingRecord(null); confirmDelete(editingRecord!.id); }}
              className="w-full py-2 text-sm text-red-500 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors"
            >
              删除此记录
            </button>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete Confirm Dialog */}
      <Dialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>确认删除</DialogTitle>
            <DialogDescription>确定要删除此成长记录吗？此操作不可撤销。</DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 mt-4">
            <Button variant="outline" className="flex-1" onClick={() => setShowDeleteConfirm(false)}>取消</Button>
            <Button variant="destructive" className="flex-1" onClick={doDelete}>删除</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
