import { useState, useRef, useCallback, useEffect } from 'react';
import { Ruler, Triangle, X, Undo2, Redo2, Circle, MapPin } from 'lucide-react';
import { Button } from './ui';

export interface AnnotationPoint {
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
}

export type AnnotationType = 'angle' | 'line' | 'circle' | 'point';

export interface Annotation {
  id: string;
  type: AnnotationType;
  points: AnnotationPoint[];
  value?: number; // degrees for angle, radius px for circle
  label?: string;
  color?: string;
}

interface ImageAnnotatorProps {
  imageUrl: string;
  annotations: Annotation[];
  onChange?: (annotations: Annotation[]) => void;
  readonly?: boolean;
}

const COLORS = [
  '#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6',
  '#ec4899', '#14b8a6', '#f97316', '#06b6d4', '#a855f7',
  '#84cc16', '#e11d48', '#0ea5e9', '#d946ef', '#facc15',
  '#22d3ee', '#fb923c', '#a3e635', '#c084fc', '#f43f5e',
];
const DOT_RADIUS_PX = 6;

function calcAngle(p1: AnnotationPoint, vertex: AnnotationPoint, p3: AnnotationPoint): number {
  const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
  const v2 = { x: p3.x - vertex.x, y: p3.y - vertex.y };
  const dot = v1.x * v2.x + v1.y * v2.y;
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 === 0 || mag2 === 0) return 0;
  const cos = Math.max(-1, Math.min(1, dot / (mag1 * mag2)));
  return Math.round((Math.acos(cos) * 180) / Math.PI * 10) / 10;
}

interface DragTarget {
  annoId: string;
  pointIdx: number;
}

const HIT_RADIUS_PX = 16;

const REQUIRED_POINTS: Record<AnnotationType, number> = { angle: 3, line: 2, circle: 2, point: 1 };

export function ImageAnnotator({ imageUrl, annotations, onChange, readonly = false }: ImageAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<AnnotationType | null>(null);
  const [pendingPoints, setPendingPoints] = useState<AnnotationPoint[]>([]);
  const [colorIdx, setColorIdx] = useState(0);
  const [containerSize, setContainerSize] = useState({ w: 100, h: 100 });

  const dragRef = useRef<DragTarget | null>(null);
  const didDragRef = useRef(false);
  const annotationsRef = useRef(annotations);
  annotationsRef.current = annotations;

  const undoStackRef = useRef<Annotation[][]>([]);
  const redoStackRef = useRef<Annotation[][]>([]);
  const [, forceUpdate] = useState(0);

  const pushUndo = useCallback((prev: Annotation[]) => {
    undoStackRef.current = [...undoStackRef.current, prev];
    redoStackRef.current = [];
    forceUpdate((n) => n + 1);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const { width, height } = entry.contentRect;
        if (width > 0 && height > 0) {
          setContainerSize({ w: width, h: height });
        }
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const clientToNormalized = useCallback((clientX: number, clientY: number): AnnotationPoint | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
    };
  }, []);

  const findHitPoint = useCallback((pt: AnnotationPoint): DragTarget | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    const threshX = HIT_RADIUS_PX / rect.width;
    const threshY = HIT_RADIUS_PX / rect.height;

    for (let ai = annotations.length - 1; ai >= 0; ai--) {
      const anno = annotations[ai];
      for (let pi = anno.points.length - 1; pi >= 0; pi--) {
        const ap = anno.points[pi];
        if (Math.abs(pt.x - ap.x) < threshX && Math.abs(pt.y - ap.y) < threshY) {
          return { annoId: anno.id, pointIdx: pi };
        }
      }
    }
    return null;
  }, [annotations]);

  const dragSnapshotRef = useRef<Annotation[] | null>(null);

  const updateDraggedPoint = useCallback((pt: AnnotationPoint) => {
    const target = dragRef.current;
    if (!target) return;
    if (!dragSnapshotRef.current) {
      dragSnapshotRef.current = annotationsRef.current;
    }
    const updated = annotationsRef.current.map((anno) => {
      if (anno.id !== target.annoId) return anno;
      const newPoints = [...anno.points];

      if (anno.type === 'circle' && target.pointIdx === 0) {
        const dx = pt.x - newPoints[0].x;
        const dy = pt.y - newPoints[0].y;
        newPoints[0] = pt;
        newPoints[1] = { x: newPoints[1].x + dx, y: newPoints[1].y + dy };
      } else {
        newPoints[target.pointIdx] = pt;
      }

      const result = { ...anno, points: newPoints };
      if (anno.type === 'angle' && newPoints.length === 3) {
        result.value = calcAngle(newPoints[0], newPoints[1], newPoints[2]);
      }
      return result;
    });
    onChange?.(updated);
  }, [onChange]);

  const addPoint = useCallback((pt: AnnotationPoint) => {
    if (!tool) return;
    const newPoints = [...pendingPoints, pt];
    const requiredPoints = REQUIRED_POINTS[tool];

    if (newPoints.length >= requiredPoints) {
      const color = COLORS[colorIdx % COLORS.length];
      const annotation: Annotation = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: tool,
        points: newPoints.slice(0, requiredPoints),
        color,
      };
      if (tool === 'angle') {
        annotation.value = calcAngle(newPoints[0], newPoints[1], newPoints[2]);
      }
      pushUndo(annotations);
      onChange?.([...annotations, annotation]);
      setPendingPoints([]);
      setColorIdx((i) => i + 1);
    } else {
      setPendingPoints(newPoints);
    }
  }, [tool, pendingPoints, annotations, onChange, colorIdx, pushUndo]);

  // --- Mouse events ---
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (readonly) return;
    const pt = clientToNormalized(e.clientX, e.clientY);
    if (!pt) return;

    const hit = findHitPoint(pt);
    if (hit) {
      e.preventDefault();
      dragRef.current = hit;
      didDragRef.current = false;
      return;
    }
  }, [readonly, clientToNormalized, findHitPoint]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragRef.current) return;
    e.preventDefault();
    didDragRef.current = true;
    const pt = clientToNormalized(e.clientX, e.clientY);
    if (pt) updateDraggedPoint(pt);
  }, [clientToNormalized, updateDraggedPoint]);

  const handleMouseUp = useCallback((e: React.MouseEvent) => {
    if (dragRef.current) {
      if (didDragRef.current) {
        const pt = clientToNormalized(e.clientX, e.clientY);
        if (pt) updateDraggedPoint(pt);
        if (dragSnapshotRef.current) {
          pushUndo(dragSnapshotRef.current);
        }
      }
      dragRef.current = null;
      didDragRef.current = false;
      dragSnapshotRef.current = null;
      return;
    }
    if (!tool) return;
    const pt = clientToNormalized(e.clientX, e.clientY);
    if (pt) addPoint(pt);
  }, [tool, clientToNormalized, updateDraggedPoint, addPoint, pushUndo]);

  // --- Touch events ---
  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (readonly) return;
    const touch = e.touches[0];
    if (!touch) return;
    const pt = clientToNormalized(touch.clientX, touch.clientY);
    if (!pt) return;

    const hit = findHitPoint(pt);
    if (hit) {
      e.preventDefault();
      dragRef.current = hit;
      didDragRef.current = false;
      return;
    }
    if (tool) e.preventDefault();
  }, [readonly, tool, clientToNormalized, findHitPoint]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (dragRef.current) {
      e.preventDefault();
      didDragRef.current = true;
      const touch = e.touches[0];
      if (!touch) return;
      const pt = clientToNormalized(touch.clientX, touch.clientY);
      if (pt) updateDraggedPoint(pt);
      return;
    }
    if (tool) {
      didDragRef.current = true;
      e.preventDefault();
    }
  }, [tool, clientToNormalized, updateDraggedPoint]);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (dragRef.current) {
      e.preventDefault();
      if (didDragRef.current) {
        const touch = e.changedTouches[0];
        if (touch) {
          const pt = clientToNormalized(touch.clientX, touch.clientY);
          if (pt) updateDraggedPoint(pt);
        }
        if (dragSnapshotRef.current) {
          pushUndo(dragSnapshotRef.current);
        }
      }
      dragRef.current = null;
      didDragRef.current = false;
      dragSnapshotRef.current = null;
      return;
    }
    if (!tool) return;
    e.preventDefault();
    if (didDragRef.current) { didDragRef.current = false; return; }
    const touch = e.changedTouches[0];
    if (!touch) return;
    const pt = clientToNormalized(touch.clientX, touch.clientY);
    if (pt) addPoint(pt);
  }, [tool, clientToNormalized, updateDraggedPoint, addPoint, pushUndo]);

  const canUndo = pendingPoints.length > 0 || undoStackRef.current.length > 0;
  const canRedo = redoStackRef.current.length > 0;

  const undoLast = () => {
    if (pendingPoints.length > 0) {
      setPendingPoints((prev) => prev.slice(0, -1));
      return;
    }
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const prev = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    redoStackRef.current = [...redoStackRef.current, annotations];
    onChange?.(prev);
    forceUpdate((n) => n + 1);
  };

  const redoLast = () => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const next = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    undoStackRef.current = [...undoStackRef.current, annotations];
    onChange?.(next);
    forceUpdate((n) => n + 1);
  };

  const clearAll = () => {
    if (annotations.length > 0) {
      pushUndo(annotations);
    }
    onChange?.([]);
    setPendingPoints([]);
  };

  const isDragging = dragRef.current !== null;
  const { w, h } = containerSize;
  const cursorClass = isDragging ? 'cursor-grabbing' : !readonly && tool ? 'cursor-crosshair' : !readonly ? 'cursor-default' : '';

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      {!readonly && (
        <div className="flex items-center gap-1 sm:gap-2">
          {([
            { key: 'point' as const, icon: MapPin, label: '点' },
            { key: 'line' as const, icon: Ruler, label: '线段' },
            { key: 'circle' as const, icon: Circle, label: '圆' },
            { key: 'angle' as const, icon: Triangle, label: '角度' },
          ] as const).map(({ key, icon: Icon, label }) => (
            <Button
              key={key}
              type="button"
              size="sm"
              variant={tool === key ? 'default' : 'outline'}
              className="px-2 sm:px-3 h-7 sm:h-8"
              onClick={() => { setTool(tool === key ? null : key); setPendingPoints([]); }}
            >
              <Icon size={14} /> <span className="hidden sm:inline">{label}</span>
            </Button>
          ))}
          <div className="flex-1 min-w-0" />
          <Button type="button" size="sm" variant="ghost" className="px-1.5 sm:px-2 h-7 sm:h-8" onClick={undoLast} disabled={!canUndo}>
            <Undo2 size={14} />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="px-1.5 sm:px-2 h-7 sm:h-8" onClick={redoLast} disabled={!canRedo}>
            <Redo2 size={14} />
          </Button>
          <Button type="button" size="sm" variant="ghost" className="px-1.5 sm:px-3 h-7 sm:h-8" onClick={clearAll} disabled={annotations.length === 0 && pendingPoints.length === 0}>
            <X size={14} /> <span className="hidden sm:inline">清除</span>
          </Button>
        </div>
      )}

      {/* Hint */}
      {!readonly && tool && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {tool === 'point' && '点击放置标记点（可拖拽已有端点调整位置）'}
          {tool === 'line' && `点击标记${pendingPoints.length === 0 ? '起点' : '终点'}（可拖拽已有端点调整位置）`}
          {tool === 'circle' && `点击标记${pendingPoints.length === 0 ? '圆心' : '边缘（确定半径）'}（可拖拽已有端点调整位置）`}
          {tool === 'angle' && `点击标记${pendingPoints.length === 0 ? '第一个端点' : pendingPoints.length === 1 ? '顶点（角的中心）' : '第二个端点'}（可拖拽已有端点调整位置）`}
        </p>
      )}

      {/* Image with annotations overlay */}
      <div
        ref={containerRef}
        className={`relative select-none ${cursorClass}`}
        style={{ touchAction: !readonly ? 'none' : undefined }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      >
        <img src={imageUrl} alt="" className="w-full rounded-lg" draggable={false} />

        {/* SVG Overlay — viewBox matches container pixels so circles stay round */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox={`0 0 ${w} ${h}`}>
          {annotations.map((anno) => (
            <AnnotationOverlay key={anno.id} annotation={anno} w={w} h={h} />
          ))}

          {/* Pending points */}
          {pendingPoints.map((pt, i) => (
            <circle key={i} cx={pt.x * w} cy={pt.y * h} r={DOT_RADIUS_PX} fill={COLORS[colorIdx % COLORS.length]} stroke="white" strokeWidth="2" />
          ))}
          {pendingPoints.length === 1 && tool === 'line' && (
            <line x1={pendingPoints[0].x * w} y1={pendingPoints[0].y * h} x2={pendingPoints[0].x * w} y2={pendingPoints[0].y * h} stroke={COLORS[colorIdx % COLORS.length]} strokeWidth="2" strokeDasharray="4 4" />
          )}
          {pendingPoints.length === 1 && tool === 'circle' && (
            <circle cx={pendingPoints[0].x * w} cy={pendingPoints[0].y * h} r="1" fill="none" stroke={COLORS[colorIdx % COLORS.length]} strokeWidth="2" strokeDasharray="4 4" />
          )}
          {pendingPoints.length >= 2 && tool === 'angle' && (
            <line x1={pendingPoints[0].x * w} y1={pendingPoints[0].y * h} x2={pendingPoints[1].x * w} y2={pendingPoints[1].y * h} stroke={COLORS[colorIdx % COLORS.length]} strokeWidth="2" strokeDasharray="4 4" />
          )}
        </svg>

        {/* Angle/value labels */}
        {annotations.map((anno) => {
          if (anno.type === 'angle' && anno.value != null) {
            const vertex = anno.points[1];
            return (
              <div
                key={`label-${anno.id}`}
                className="absolute text-[10px] font-bold px-1 py-0.5 rounded shadow-sm pointer-events-none"
                style={{
                  left: `${vertex.x * 100}%`,
                  top: `${vertex.y * 100}%`,
                  transform: 'translate(-50%, -150%)',
                  backgroundColor: 'rgba(0,0,0,0.7)',
                  color: anno.color || '#fff',
                }}
              >
                {anno.value}°
              </div>
            );
          }
          return null;
        })}
      </div>
    </div>
  );
}

function calcCircleRadius(center: AnnotationPoint, edge: AnnotationPoint, w: number, h: number): number {
  const dx = (edge.x - center.x) * w;
  const dy = (edge.y - center.y) * h;
  return Math.sqrt(dx * dx + dy * dy);
}

function AnnotationOverlay({ annotation: anno, w, h }: { annotation: Annotation; w: number; h: number }) {
  const color = anno.color || '#ef4444';

  if (anno.type === 'point') {
    const p = anno.points[0];
    return (
      <g>
        <circle cx={p.x * w} cy={p.y * h} r={DOT_RADIUS_PX + 2} fill={color} stroke="white" strokeWidth="2" />
        <circle cx={p.x * w} cy={p.y * h} r={2} fill="white" />
      </g>
    );
  }

  if (anno.type === 'line') {
    const [p1, p2] = anno.points;
    return (
      <g>
        <line x1={p1.x * w} y1={p1.y * h} x2={p2.x * w} y2={p2.y * h} stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx={p1.x * w} cy={p1.y * h} r={DOT_RADIUS_PX} fill={color} stroke="white" strokeWidth="2" />
        <circle cx={p2.x * w} cy={p2.y * h} r={DOT_RADIUS_PX} fill={color} stroke="white" strokeWidth="2" />
      </g>
    );
  }

  if (anno.type === 'circle') {
    const [center, edge] = anno.points;
    const radius = calcCircleRadius(center, edge, w, h);
    return (
      <g>
        <circle cx={center.x * w} cy={center.y * h} r={radius} fill="none" stroke={color} strokeWidth="2" />
        <circle cx={center.x * w} cy={center.y * h} r={DOT_RADIUS_PX} fill={color} stroke="white" strokeWidth="2" />
        <circle cx={edge.x * w} cy={edge.y * h} r={DOT_RADIUS_PX - 1} fill={color} stroke="white" strokeWidth="1.5" />
      </g>
    );
  }

  if (anno.type === 'angle') {
    const [p1, vertex, p3] = anno.points;
    return (
      <g>
        <line x1={p1.x * w} y1={p1.y * h} x2={vertex.x * w} y2={vertex.y * h} stroke={color} strokeWidth="2" strokeLinecap="round" />
        <line x1={p3.x * w} y1={p3.y * h} x2={vertex.x * w} y2={vertex.y * h} stroke={color} strokeWidth="2" strokeLinecap="round" />
        <circle cx={p1.x * w} cy={p1.y * h} r={DOT_RADIUS_PX - 1} fill={color} stroke="white" strokeWidth="1.5" />
        <circle cx={vertex.x * w} cy={vertex.y * h} r={DOT_RADIUS_PX} fill={color} stroke="white" strokeWidth="2" />
        <circle cx={p3.x * w} cy={p3.y * h} r={DOT_RADIUS_PX - 1} fill={color} stroke="white" strokeWidth="1.5" />
        <ArcPath p1={p1} vertex={vertex} p3={p3} color={color} w={w} h={h} />
      </g>
    );
  }

  return null;
}

function ArcPath({ p1, vertex, p3, color, w, h }: { p1: AnnotationPoint; vertex: AnnotationPoint; p3: AnnotationPoint; color: string; w: number; h: number }) {
  const arcRadiusPx = 20;
  const v1 = { x: (p1.x - vertex.x) * w, y: (p1.y - vertex.y) * h };
  const v2 = { x: (p3.x - vertex.x) * w, y: (p3.y - vertex.y) * h };
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 === 0 || mag2 === 0) return null;

  const norm1 = { x: v1.x / mag1, y: v1.y / mag1 };
  const norm2 = { x: v2.x / mag2, y: v2.y / mag2 };

  const cx = vertex.x * w;
  const cy = vertex.y * h;
  const arcStart = { x: cx + norm1.x * arcRadiusPx, y: cy + norm1.y * arcRadiusPx };
  const arcEnd = { x: cx + norm2.x * arcRadiusPx, y: cy + norm2.y * arcRadiusPx };

  const cross = v1.x * v2.y - v1.y * v2.x;
  const sweepFlag = cross > 0 ? 1 : 0;

  const angle = calcAngle(p1, vertex, p3);
  const largeArcFlag = angle > 180 ? 1 : 0;

  const d = `M ${arcStart.x} ${arcStart.y} A ${arcRadiusPx} ${arcRadiusPx} 0 ${largeArcFlag} ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`;

  return <path d={d} fill="none" stroke={color} strokeWidth="2" opacity={0.8} />;
}
