import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import dayjs from 'dayjs';
import { ArrowLeft, Pencil, Trash2 } from 'lucide-react';
import { Button, Input, Card, CardContent, Dialog, DialogContent, DialogHeader, DialogTitle, DatePicker } from '../components/ui';

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
  const [records, setRecords] = useState<GrowthItem[]>([]);
  const [editingRecord, setEditingRecord] = useState<GrowthItem | null>(null);
  const [gDate, setGDate] = useState('');
  const [gWeight, setGWeight] = useState('');
  const [gHeight, setGHeight] = useState('');
  const [gHead, setGHead] = useState('');

  useEffect(() => {
    if (currentBaby) loadRecords();
  }, [currentBaby]);

  const loadRecords = async () => {
    if (!currentBaby) return;
    const res = await api.get<{ success: boolean; data: GrowthItem[] }>(`/growth?babyId=${currentBaby.id}`);
    setRecords(res.data);
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
    loadRecords();
  };

  const deleteRecord = async (id: string) => {
    if (!confirm('确定删除此记录？')) return;
    await api.delete(`/growth/${id}`);
    loadRecords();
  };

  const sorted = [...records].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate('/growth')}>
          <ArrowLeft size={20} />
        </Button>
        <h2 className="text-xl font-semibold dark:text-gray-100">历史记录</h2>
      </div>

      {sorted.length === 0 ? (
        <p className="text-center text-gray-400 py-12">暂无记录</p>
      ) : (
        <div className="space-y-2">
          {sorted.map((r) => (
            <Card key={r.id}>
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
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button
                    onClick={() => openEdit(r)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-primary-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Pencil size={14} />
                  </button>
                  <button
                    onClick={() => deleteRecord(r.id)}
                    className="p-1.5 rounded-md text-gray-400 hover:text-red-500 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors"
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Dialog */}
      <Dialog open={!!editingRecord} onOpenChange={(open) => { if (!open) setEditingRecord(null); }}>
        <DialogContent className="max-w-sm mx-4">
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
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
