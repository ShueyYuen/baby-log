import { useNavigate } from 'react-router-dom';
import dayjs from 'dayjs';
import type { MouseEvent } from 'react';
import { useI18n } from '../contexts/I18nContext';
import type { TimelineRecord } from '../lib/api';
import { formatRecordDetail, recordTypeLabel, typeConfig } from '../lib/record-types';
import { MediaThumbs, toViewerImages } from './ui';

interface RecordCardProps {
  record: TimelineRecord;
  isViewer: boolean;
}

export function RecordCard({ record, isViewer }: RecordCardProps) {
  const navigate = useNavigate();
  const { t } = useI18n();
  const href = `/record/${record.id}/edit`;
  const config = typeConfig[record.type] || typeConfig.other;
  const Icon = config.icon;

  const handleClick = (e: MouseEvent) => {
    if (isViewer) return;
    if ((e.target as HTMLElement).closest('[data-media-thumbs]')) return;
    navigate(href, { state: { record } });
  };

  const urls = toViewerImages(record.images ?? []);

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
          <span className="font-medium text-base dark:text-gray-100">{recordTypeLabel(record.type, t)}</span>
          <span className="text-sm text-gray-400 dark:text-gray-500">
            {dayjs(record.occurredAt).format('HH:mm')}
          </span>
        </div>
        <p className="text-sm text-gray-500 dark:text-gray-400 truncate mt-0.5">
          {formatRecordDetail(record, t)}
        </p>
        {record.user?.displayName && (
          <p className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">{record.user.displayName}</p>
        )}
      </div>
      {urls.length > 0 && (
        <MediaThumbs
          images={urls}
          max={2}
          className="flex-shrink-0 overflow-visible"
          thumbClassName="w-11 h-11 rounded-lg"
        />
      )}
    </div>
  );
}
