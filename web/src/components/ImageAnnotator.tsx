import { useState, useRef, useCallback, useEffect } from 'react';
import { Ruler, Triangle, X, Undo2, Save } from 'lucide-react';
import { Button } from './ui';

export interface AnnotationPoint {
  x: number; // 0-1 normalized
  y: number; // 0-1 normalized
}

export interface Annotation {
  id: string;
  type: 'angle' | 'line';
  points: AnnotationPoint[];
  value?: number; // degrees for angle, no unit for line
  label?: string;
  color?: string;
}

interface ImageAnnotatorProps {
  imageUrl: string;
  annotations: Annotation[];
  onChange?: (annotations: Annotation[]) => void;
  readonly?: boolean;
}

const COLORS = ['#ef4444', '#f59e0b', '#10b981', '#3b82f6', '#8b5cf6'];

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

export function ImageAnnotator({ imageUrl, annotations, onChange, readonly = false }: ImageAnnotatorProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [tool, setTool] = useState<'angle' | 'line' | null>(null);
  const [pendingPoints, setPendingPoints] = useState<AnnotationPoint[]>([]);
  const [colorIdx, setColorIdx] = useState(0);

  const getRelativePoint = useCallback((e: React.MouseEvent | React.TouchEvent): AnnotationPoint | null => {
    const container = containerRef.current;
    if (!container) return null;
    const rect = container.getBoundingClientRect();
    let clientX: number, clientY: number;
    if ('touches' in e) {
      if (e.touches.length === 0) return null;
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    const x = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    const y = Math.max(0, Math.min(1, (clientY - rect.top) / rect.height));
    return { x, y };
  }, []);

  const handleClick = useCallback((e: React.MouseEvent) => {
    if (readonly || !tool) return;
    const pt = getRelativePoint(e);
    if (!pt) return;

    const newPoints = [...pendingPoints, pt];
    const requiredPoints = tool === 'angle' ? 3 : 2;

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
      onChange?.([...annotations, annotation]);
      setPendingPoints([]);
      setColorIdx((i) => i + 1);
    } else {
      setPendingPoints(newPoints);
    }
  }, [readonly, tool, pendingPoints, annotations, onChange, colorIdx, getRelativePoint]);

  const handleTouch = useCallback((e: React.TouchEvent) => {
    if (readonly || !tool) return;
    e.preventDefault();
    const pt = getRelativePoint(e);
    if (!pt) return;

    const newPoints = [...pendingPoints, pt];
    const requiredPoints = tool === 'angle' ? 3 : 2;

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
      onChange?.([...annotations, annotation]);
      setPendingPoints([]);
      setColorIdx((i) => i + 1);
    } else {
      setPendingPoints(newPoints);
    }
  }, [readonly, tool, pendingPoints, annotations, onChange, colorIdx, getRelativePoint]);

  const undoLast = () => {
    if (pendingPoints.length > 0) {
      setPendingPoints((prev) => prev.slice(0, -1));
    } else if (annotations.length > 0) {
      onChange?.(annotations.slice(0, -1));
    }
  };

  const clearAll = () => {
    onChange?.([]);
    setPendingPoints([]);
  };

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      {!readonly && (
        <div className="flex items-center gap-2 flex-wrap">
          <Button
            type="button"
            size="sm"
            variant={tool === 'angle' ? 'default' : 'outline'}
            onClick={() => { setTool(tool === 'angle' ? null : 'angle'); setPendingPoints([]); }}
          >
            <Triangle size={14} /> 角度
          </Button>
          <Button
            type="button"
            size="sm"
            variant={tool === 'line' ? 'default' : 'outline'}
            onClick={() => { setTool(tool === 'line' ? null : 'line'); setPendingPoints([]); }}
          >
            <Ruler size={14} /> 线段
          </Button>
          <div className="flex-1" />
          <Button type="button" size="sm" variant="ghost" onClick={undoLast} disabled={pendingPoints.length === 0 && annotations.length === 0}>
            <Undo2 size={14} />
          </Button>
          <Button type="button" size="sm" variant="ghost" onClick={clearAll} disabled={annotations.length === 0 && pendingPoints.length === 0}>
            <X size={14} /> 清除
          </Button>
        </div>
      )}

      {/* Hint */}
      {!readonly && tool && (
        <p className="text-xs text-gray-500 dark:text-gray-400">
          {tool === 'angle'
            ? `点击标记${pendingPoints.length === 0 ? '第一个端点' : pendingPoints.length === 1 ? '顶点（角的中心）' : '第二个端点'}`
            : `点击标记${pendingPoints.length === 0 ? '起点' : '终点'}`
          }
        </p>
      )}

      {/* Image with annotations overlay */}
      <div
        ref={containerRef}
        className={`relative select-none ${!readonly && tool ? 'cursor-crosshair' : ''}`}
        onClick={handleClick}
        onTouchStart={handleTouch}
      >
        <img src={imageUrl} alt="" className="w-full rounded-lg" draggable={false} />

        {/* SVG Overlay */}
        <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
          {/* Existing annotations */}
          {annotations.map((anno) => (
            <AnnotationOverlay key={anno.id} annotation={anno} />
          ))}

          {/* Pending points */}
          {pendingPoints.map((pt, i) => (
            <circle key={i} cx={pt.x * 100} cy={pt.y * 100} r="1.2" fill={COLORS[colorIdx % COLORS.length]} stroke="white" strokeWidth="0.3" />
          ))}
          {pendingPoints.length === 1 && tool === 'line' && (
            <line x1={pendingPoints[0].x * 100} y1={pendingPoints[0].y * 100} x2={pendingPoints[0].x * 100} y2={pendingPoints[0].y * 100} stroke={COLORS[colorIdx % COLORS.length]} strokeWidth="0.4" strokeDasharray="1 1" />
          )}
          {pendingPoints.length >= 1 && tool === 'angle' && (
            <>
              {pendingPoints.length >= 2 && (
                <line x1={pendingPoints[0].x * 100} y1={pendingPoints[0].y * 100} x2={pendingPoints[1].x * 100} y2={pendingPoints[1].y * 100} stroke={COLORS[colorIdx % COLORS.length]} strokeWidth="0.4" strokeDasharray="1 1" />
              )}
            </>
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

function AnnotationOverlay({ annotation: anno }: { annotation: Annotation }) {
  const color = anno.color || '#ef4444';

  if (anno.type === 'line') {
    const [p1, p2] = anno.points;
    return (
      <g>
        <line x1={p1.x * 100} y1={p1.y * 100} x2={p2.x * 100} y2={p2.y * 100} stroke={color} strokeWidth="0.5" strokeLinecap="round" />
        <circle cx={p1.x * 100} cy={p1.y * 100} r="1" fill={color} stroke="white" strokeWidth="0.3" />
        <circle cx={p2.x * 100} cy={p2.y * 100} r="1" fill={color} stroke="white" strokeWidth="0.3" />
      </g>
    );
  }

  if (anno.type === 'angle') {
    const [p1, vertex, p3] = anno.points;
    return (
      <g>
        <line x1={p1.x * 100} y1={p1.y * 100} x2={vertex.x * 100} y2={vertex.y * 100} stroke={color} strokeWidth="0.5" strokeLinecap="round" />
        <line x1={p3.x * 100} y1={p3.y * 100} x2={vertex.x * 100} y2={vertex.y * 100} stroke={color} strokeWidth="0.5" strokeLinecap="round" />
        <circle cx={p1.x * 100} cy={p1.y * 100} r="0.8" fill={color} stroke="white" strokeWidth="0.2" />
        <circle cx={vertex.x * 100} cy={vertex.y * 100} r="1.2" fill={color} stroke="white" strokeWidth="0.3" />
        <circle cx={p3.x * 100} cy={p3.y * 100} r="0.8" fill={color} stroke="white" strokeWidth="0.2" />
        <ArcPath p1={p1} vertex={vertex} p3={p3} color={color} />
      </g>
    );
  }

  return null;
}

function ArcPath({ p1, vertex, p3, color }: { p1: AnnotationPoint; vertex: AnnotationPoint; p3: AnnotationPoint; color: string }) {
  const radius = 4;
  const v1 = { x: p1.x - vertex.x, y: p1.y - vertex.y };
  const v2 = { x: p3.x - vertex.x, y: p3.y - vertex.y };
  const mag1 = Math.sqrt(v1.x * v1.x + v1.y * v1.y);
  const mag2 = Math.sqrt(v2.x * v2.x + v2.y * v2.y);
  if (mag1 === 0 || mag2 === 0) return null;

  const norm1 = { x: v1.x / mag1, y: v1.y / mag1 };
  const norm2 = { x: v2.x / mag2, y: v2.y / mag2 };

  const arcStart = { x: (vertex.x + norm1.x * radius / 100) * 100, y: (vertex.y + norm1.y * radius / 100) * 100 };
  const arcEnd = { x: (vertex.x + norm2.x * radius / 100) * 100, y: (vertex.y + norm2.y * radius / 100) * 100 };

  const cross = v1.x * v2.y - v1.y * v2.x;
  const sweepFlag = cross > 0 ? 1 : 0;

  const angle = calcAngle(p1, vertex, p3);
  const largeArcFlag = angle > 180 ? 1 : 0;

  const d = `M ${arcStart.x} ${arcStart.y} A ${radius} ${radius} 0 ${largeArcFlag} ${sweepFlag} ${arcEnd.x} ${arcEnd.y}`;

  return <path d={d} fill="none" stroke={color} strokeWidth="0.4" opacity={0.8} />;
}
