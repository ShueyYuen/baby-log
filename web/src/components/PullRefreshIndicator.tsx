interface Props {
  pullDistance: number;
  refreshing: boolean;
  threshold?: number;
}

export function PullRefreshIndicator({ pullDistance, refreshing, threshold = 60 }: Props) {
  if (pullDistance <= 0 && !refreshing) return null;

  const progress = Math.min(pullDistance / threshold, 1);
  const rotation = progress * 360;

  return (
    <div
      className="flex items-center justify-center overflow-hidden transition-[height] duration-200 ease-out"
      style={{ height: refreshing ? threshold : pullDistance }}
    >
      <div
        className={`w-7 h-7 rounded-full border-2 border-primary-400 border-t-transparent ${refreshing ? 'animate-spin' : ''}`}
        style={refreshing ? undefined : { transform: `rotate(${rotation}deg)`, opacity: progress }}
      />
    </div>
  );
}
