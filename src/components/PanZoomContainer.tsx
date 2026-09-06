import React, { useState, useRef, useCallback, useEffect } from 'react';
import { ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';

interface PanZoomContainerProps {
  children: React.ReactNode;
  className?: string;
  minZoom?: number;
  maxZoom?: number;
  initialZoom?: number;
  resetKey?: string | number;
}

export const PanZoomContainer: React.FC<PanZoomContainerProps> = ({
  children,
  className = '',
  minZoom = 0.4,
  maxZoom = 25,
  initialZoom = 1.0,
  resetKey,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(initialZoom);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const isDraggingRef = useRef(false);
  const dragStartRef = useRef({ x: 0, y: 0 });
  const panStartRef = useRef({ x: 0, y: 0 });
  const [isGrabbing, setIsGrabbing] = useState(false);

  const touchDistRef = useRef<number | null>(null);

  const resetView = useCallback(() => {
    setZoom(initialZoom);
    setPan({ x: 0, y: 0 });
  }, [initialZoom]);

  useEffect(() => {
    if (resetKey !== undefined) {
      resetView();
    }
  }, [resetKey, resetView]);

  // React attaches `wheel` at the document root as a *passive* listener, so a
  // preventDefault() from the JSX prop is ignored and the modal scrolls behind
  // the zoom. The listener has to be bound to the element non-passively.
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const container = containerRef.current;
    if (!container) return;

    const rect = container.getBoundingClientRect();
    const cursorX = e.clientX - rect.left;
    const cursorY = e.clientY - rect.top;

    const factor = e.deltaY < 0 ? 1.15 : 1 / 1.15;
    const nextZoom = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
    if (nextZoom === zoom) return;

    const scaleChange = nextZoom / zoom;
    const nextPanX = cursorX - (cursorX - pan.x) * scaleChange;
    const nextPanY = cursorY - (cursorY - pan.y) * scaleChange;

    setZoom(nextZoom);
    setPan({ x: nextPanX, y: nextPanY });
  }, [zoom, pan, minZoom, maxZoom]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const handlePointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0 && e.button !== 1) return;
    const container = containerRef.current;
    if (!container) return;

    container.setPointerCapture(e.pointerId);
    isDraggingRef.current = true;
    dragStartRef.current = { x: e.clientX, y: e.clientY };
    panStartRef.current = { ...pan };
    setIsGrabbing(true);
  };

  const handlePointerMove = (e: React.PointerEvent) => {
    if (!isDraggingRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    setPan({
      x: panStartRef.current.x + dx,
      y: panStartRef.current.y + dy,
    });
  };

  const handlePointerUp = (e: React.PointerEvent) => {
    if (isDraggingRef.current) {
      try {
        containerRef.current?.releasePointerCapture(e.pointerId);
      } catch {
        // Ignored
      }
      isDraggingRef.current = false;
      setIsGrabbing(false);
    }
  };

  const zoomBy = (factor: number) => {
    const container = containerRef.current;
    if (!container) return;
    const rect = container.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    const nextZoom = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
    if (nextZoom === zoom) return;

    const scaleChange = nextZoom / zoom;
    const nextPanX = centerX - (centerX - pan.x) * scaleChange;
    const nextPanY = centerY - (centerY - pan.y) * scaleChange;

    setZoom(nextZoom);
    setPan({ x: nextPanX, y: nextPanY });
  };

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      touchDistRef.current = Math.hypot(dx, dy);
    }
  };

  const handleTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && touchDistRef.current !== null) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const factor = dist / touchDistRef.current;
      touchDistRef.current = dist;

      const container = containerRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const midX = (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left;
      const midY = (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top;

      const nextZoom = Math.min(maxZoom, Math.max(minZoom, zoom * factor));
      const scaleChange = nextZoom / zoom;
      setZoom(nextZoom);
      setPan({
        x: midX - (midX - pan.x) * scaleChange,
        y: midY - (midY - pan.y) * scaleChange,
      });
    }
  };

  const handleTouchEnd = () => {
    touchDistRef.current = null;
  };

  return (
    <div
      ref={containerRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onDoubleClick={resetView}
      className={`relative w-full h-full overflow-hidden select-none touch-none ${
        isGrabbing ? 'cursor-grabbing' : 'cursor-grab'
      } ${className}`}
    >
      <div
        className="w-full h-full flex items-center justify-center pointer-events-none"
        style={{
          transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
          transformOrigin: '0 0',
          transition: isGrabbing ? 'none' : 'transform 0.05s ease-out',
        }}
      >
        {children}
      </div>

      <div
        className="absolute top-2 right-2 z-20 flex items-center gap-1 bg-slate-900/80 backdrop-blur-sm border border-slate-700/70 rounded-md p-1 shadow-md text-slate-300 pointer-events-auto"
        onClick={e => e.stopPropagation()}
      >
        <button
          type="button"
          onClick={() => zoomBy(1.25)}
          className="p-1 hover:text-white hover:bg-slate-700/60 rounded cursor-pointer transition-colors"
          title="Zoom In (+)"
        >
          <ZoomIn className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={() => zoomBy(0.8)}
          className="p-1 hover:text-white hover:bg-slate-700/60 rounded cursor-pointer transition-colors"
          title="Zoom Out (-)"
        >
          <ZoomOut className="w-3.5 h-3.5" />
        </button>
        <button
          type="button"
          onClick={resetView}
          className="p-1 hover:text-white hover:bg-slate-700/60 rounded cursor-pointer transition-colors"
          title="Reset View / Fit (Double click canvas)"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>
        <span className="px-1 font-mono text-[10px] text-slate-400 min-w-[38px] text-right">
          {Math.round(zoom * 100)}%
        </span>
      </div>
    </div>
  );
};
