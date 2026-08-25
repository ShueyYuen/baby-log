import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import { Play } from 'lucide-react';
import type { TimelineRecord } from '../lib/api';
import { formatRecordDetail, typeConfig } from '../lib/record-types';
import type { ViewerImage } from './ui';

function getViewerImages(images: TimelineRecord['images']): ViewerImage[] {
  return (images ?? []).map((img) => ({ url: img.url, rawUrl: img.rawUrl }));
}

interface RecordCardProps {
  record: TimelineRecord;
  isViewer: boolean;
  onImageClick: (images: ViewerImage[], index: number) => void;
}

export function RecordCard({ record, isViewer, onImageClick }: RecordCardProps) {
  const navigate = useNavigate();
  const href = `/record/${record.id}/edit`;
  const config = typeConfig[record.type] || typeConfig.other;
  const Icon = config.icon;

  const handleClick = () => {
    if (isViewer) return;
    navigate(href, { state: { record } });
  };

  const urls = getViewerImages(record.images);

  return (
    <div
      className={`${!isViewer ? 'card-interactive' : 'card'} flex items-center gap-3 border-l-[3px] ${config.accent}`}
      onClick={handleClick}
    >
      <div className={`w-10 h-10 rounded-full flex items-center justify-center flex-shrink-0 bg-white/50 dark:bg-white/[0.06] ${config.color}`}>
        <Icon size={18} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="font-medium text-base dark:text-gray-100">{config.label}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {dayjs(record.occurredAt).format('HH:mm')}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {formatRecordDetail(record)}
        </p>
        {record.user?.displayName && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{record.user.displayName}</p>
        )}
      </div>
      {record.images && record.images.length > 0 && (
        <div className="flex gap-1.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
          {record.images.slice(0, 2).map((img, i) => (
            img.mediaType === 'video' ? (
              <div key={i} className="w-11 h-11 rounded-lg glass-media-thumb flex items-center justify-center">
                <Play size={14} className="text-gray-500" />
              </div>
            ) : (
              <img
                key={i}
                src={img.url}
                alt=""
                className="w-11 h-11 rounded-lg object-cover cursor-zoom-in"
                onClick={() => onImageClick(urls, i)}
              />
            )
          ))}
          {record.images.length > 2 && (
            <span
              className="w-11 h-11 rounded-lg glass-info-strip flex items-center justify-center text-xs text-gray-500 cursor-zoom-in"
              onClick={() => onImageClick(urls, 2)}
            >
              +{record.images.length - 2}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
