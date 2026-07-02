import { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useBaby } from '../contexts/BabyContext';
import { api } from '../lib/api';
import { ArrowLeft } from 'lucide-react';

type CategoryType = 'feeding' | 'nursing' | 'activity';

const categories: { value: CategoryType; label: string }[] = [
  { value: 'feeding', label: '喂养' },
  { value: 'nursing', label: '护理' },
  { value: 'activity', label: '活动' },
];

const subTypes: Record<CategoryType, { value: string; label: string }[]> = {
  feeding: [
    { value: 'breastfeed', label: '母乳' },
    { value: 'bottle', label: '瓶喂' },
    { value: 'solid', label: '辅食' },
    { value: 'water', label: '喝水' },
  ],
  nursing: [
    { value: 'diaper', label: '换尿布' },
    { value: 'bath', label: '洗澡' },
    { value: 'supplement', label: '营养补充' },
  ],
  activity: [
    { value: 'sleep', label: '睡眠' },
    { value: 'play', label: '玩耍' },
    { value: 'other', label: '其他' },
  ],
};

const quickTimes = [
  { label: '现在', offset: 0 },
  { label: '5分钟前', offset: -5 },
  { label: '10分钟前', offset: -10 },
  { label: '30分钟前', offset: -30 },
  { label: '1小时前', offset: -60 },
];

export default function RecordFormPage() {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditing = !!id;
  const { currentBaby } = useBaby();
  const [category, setCategory] = useState<CategoryType>('feeding');
  const [type, setType] = useState('breastfeed');
  const [occurredAt, setOccurredAt] = useState(new Date().toISOString().slice(0, 16));
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingRecord, setLoadingRecord] = useState(false);

  // Dynamic form data
  const [leftMinutes, setLeftMinutes] = useState(10);
  const [rightMinutes, setRightMinutes] = useState(10);
  const [milkType, setMilkType] = useState<'breast_milk' | 'formula'>('formula');
  const [amountMl, setAmountMl] = useState(120);
  const [solidName, setSolidName] = useState('');
  const [solidAmount, setSolidAmount] = useState('');
  const [waterMl, setWaterMl] = useState(30);
  const [diaperType, setDiaperType] = useState<'wet' | 'dirty' | 'both'>('wet');
  const [sleepDuration, setSleepDuration] = useState(60);
  const [supplementName, setSupplementName] = useState('维生素D');

  useEffect(() => {
    if (isEditing && currentBaby) {
      loadRecord();
    }
  }, [id, currentBaby]);

  const loadRecord = async () => {
    if (!currentBaby || !id) return;
    setLoadingRecord(true);
    try {
      const res = await api.get<{ success: boolean; data: { items: any[] } }>(`/records?babyId=${currentBaby.id}&pageSize=100`);
      const record = res.data.items.find((r: any) => r.id === id);
      if (record) {
        setCategory(record.category as CategoryType);
        setType(record.type);
        setOccurredAt(new Date(record.occurredAt).toISOString().slice(0, 16));
        setNote(record.note || '');
        populateData(record.type, record.data);
      }
    } catch {
      // ignore
    } finally {
      setLoadingRecord(false);
    }
  };

  const populateData = (recordType: string, data: any) => {
    switch (recordType) {
      case 'breastfeed':
        setLeftMinutes(data.leftMinutes || 0);
        setRightMinutes(data.rightMinutes || 0);
        break;
      case 'bottle':
        setMilkType(data.milkType || 'formula');
        setAmountMl(data.amountMl || 0);
        break;
      case 'solid':
        setSolidName(data.name || '');
        setSolidAmount(data.amount || '');
        break;
      case 'water':
        setWaterMl(data.amountMl || 0);
        break;
      case 'diaper':
        setDiaperType(data.type || 'wet');
        break;
      case 'supplement':
        setSupplementName(data.name || '');
        break;
      case 'sleep':
        setSleepDuration(data.durationMinutes || 0);
        break;
    }
  };

  const handleCategoryChange = (cat: CategoryType) => {
    setCategory(cat);
    setType(subTypes[cat][0].value);
  };

  const setQuickTime = (offsetMinutes: number) => {
    const d = new Date(Date.now() + offsetMinutes * 60 * 1000);
    setOccurredAt(d.toISOString().slice(0, 16));
  };

  const buildData = (): Record<string, unknown> => {
    switch (type) {
      case 'breastfeed':
        return { leftMinutes, rightMinutes };
      case 'bottle':
        return { milkType, amountMl };
      case 'solid':
        return { name: solidName, amount: solidAmount };
      case 'water':
        return { amountMl: waterMl };
      case 'diaper':
        return { type: diaperType };
      case 'bath':
        return {};
      case 'supplement':
        return { name: supplementName };
      case 'sleep':
        return { startTime: new Date(occurredAt).toISOString(), durationMinutes: sleepDuration };
      case 'play':
        return {};
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
      };

      if (isEditing) {
        await api.put(`/records/${id}`, payload);
      } else {
        await api.post('/records', payload);
      }
      navigate('/');
    } catch {
      alert(isEditing ? '修改失败' : '添加失败');
    } finally {
      setLoading(false);
    }
  };

  const renderDataFields = () => {
    switch (type) {
      case 'breastfeed':
        return (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">左侧(分钟)</label>
              <input type="number" value={leftMinutes} onChange={(e) => setLeftMinutes(+e.target.value)} className="input" min={0} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">右侧(分钟)</label>
              <input type="number" value={rightMinutes} onChange={(e) => setRightMinutes(+e.target.value)} className="input" min={0} />
            </div>
          </div>
        );
      case 'bottle':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">奶类型</label>
              <div className="flex gap-3">
                <button type="button" onClick={() => setMilkType('formula')} className={`flex-1 py-2 rounded-lg border-2 text-sm ${milkType === 'formula' ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}>配方奶</button>
                <button type="button" onClick={() => setMilkType('breast_milk')} className={`flex-1 py-2 rounded-lg border-2 text-sm ${milkType === 'breast_milk' ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}>母乳</button>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">奶量(ml)</label>
              <input type="number" value={amountMl} onChange={(e) => setAmountMl(+e.target.value)} className="input" min={0} step={10} />
            </div>
          </div>
        );
      case 'solid':
        return (
          <div className="space-y-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">食物名称</label>
              <input type="text" value={solidName} onChange={(e) => setSolidName(e.target.value)} className="input" placeholder="如：米糊" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">食用量</label>
              <input type="text" value={solidAmount} onChange={(e) => setSolidAmount(e.target.value)} className="input" placeholder="如：半碗" />
            </div>
          </div>
        );
      case 'water':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">水量(ml)</label>
            <input type="number" value={waterMl} onChange={(e) => setWaterMl(+e.target.value)} className="input" min={0} step={5} />
          </div>
        );
      case 'diaper':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">类型</label>
            <div className="flex gap-3">
              {[
                { value: 'wet' as const, label: '尿' },
                { value: 'dirty' as const, label: '便' },
                { value: 'both' as const, label: '尿+便' },
              ].map((item) => (
                <button
                  key={item.value}
                  type="button"
                  onClick={() => setDiaperType(item.value)}
                  className={`flex-1 py-2 rounded-lg border-2 text-sm ${diaperType === item.value ? 'border-primary-400 bg-primary-50' : 'border-gray-200'}`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        );
      case 'supplement':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">名称</label>
            <input type="text" value={supplementName} onChange={(e) => setSupplementName(e.target.value)} className="input" placeholder="如：维生素D" />
          </div>
        );
      case 'sleep':
        return (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">持续时间(分钟)</label>
            <input type="number" value={sleepDuration} onChange={(e) => setSleepDuration(+e.target.value)} className="input" min={0} step={5} />
          </div>
        );
      default:
        return null;
    }
  };

  if (loadingRecord) {
    return <div className="text-center py-12 text-gray-400">加载中...</div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded-lg">
          <ArrowLeft size={20} />
        </button>
        <h2 className="text-xl font-semibold">{isEditing ? '编辑记录' : '添加记录'}</h2>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Category Selection */}
        <div className="flex gap-2">
          {categories.map((cat) => (
            <button
              key={cat.value}
              type="button"
              onClick={() => handleCategoryChange(cat.value)}
              className={`flex-1 py-2 rounded-lg font-medium text-sm transition-colors ${
                category === cat.value ? 'bg-primary-500 text-white' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {cat.label}
            </button>
          ))}
        </div>

        {/* Sub Type Selection */}
        <div className="flex flex-wrap gap-2">
          {subTypes[category].map((st) => (
            <button
              key={st.value}
              type="button"
              onClick={() => setType(st.value)}
              className={`px-4 py-1.5 rounded-full text-sm transition-colors ${
                type === st.value ? 'bg-primary-100 text-primary-700 border border-primary-300' : 'bg-white text-gray-600 border border-gray-200'
              }`}
            >
              {st.label}
            </button>
          ))}
        </div>

        {/* Quick Time */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">时间</label>
          <div className="flex flex-wrap gap-2 mb-2">
            {quickTimes.map((qt) => (
              <button
                key={qt.label}
                type="button"
                onClick={() => setQuickTime(qt.offset)}
                className="px-3 py-1 text-xs bg-gray-100 text-gray-600 rounded-full hover:bg-gray-200"
              >
                {qt.label}
              </button>
            ))}
          </div>
          <input
            type="datetime-local"
            value={occurredAt}
            onChange={(e) => setOccurredAt(e.target.value)}
            className="input"
          />
        </div>

        {/* Dynamic Data Fields */}
        <div className="card">
          {renderDataFields()}
        </div>

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">备注</label>
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="input"
            rows={2}
            placeholder="可选备注..."
          />
        </div>

        {/* Submit */}
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? '保存中...' : isEditing ? '保存修改' : '保存记录'}
        </button>
      </form>
    </div>
  );
}
