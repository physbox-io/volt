class PlaybackTicker {
  private listeners = new Set<(elapsedMs: number) => void>();
  private animationFrameId: number | null = null;
  private startTime = 0;
  private duration = 1000;
  private isRunning = false;

  private tick = () => {
    if (!this.isRunning || this.listeners.size === 0) {
      this.animationFrameId = null;
      return;
    }
    const now = performance.now();
    let elapsed = Math.max(0, now - this.startTime);
    if (this.duration > 0 && elapsed >= this.duration) {
      elapsed = elapsed % this.duration;
      this.startTime = now - elapsed;
    }
    for (const listener of this.listeners) {
      try {
        listener(elapsed);
      } catch (err) {
        console.error("Error in playback ticker listener:", err);
      }
    }
    this.animationFrameId = requestAnimationFrame(this.tick);
  };

  start(durationMs: number) {
    this.duration = durationMs;
    this.startTime = performance.now();
    this.isRunning = true;

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    if (this.listeners.size > 0) {
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
  }

  stop() {
    this.isRunning = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    // Reset all listeners to 0 when stopped
    for (const listener of this.listeners) {
      try {
        listener(0);
      } catch (err) {
        console.error("Error in playback ticker listener reset:", err);
      }
    }
  }

  subscribe(listener: (elapsedMs: number) => void) {
    this.listeners.add(listener);
    if (this.isRunning && this.animationFrameId === null) {
      this.animationFrameId = requestAnimationFrame(this.tick);
    }
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0 && this.animationFrameId !== null) {
        cancelAnimationFrame(this.animationFrameId);
        this.animationFrameId = null;
      }
    };
  }
}

export const playbackTicker = new PlaybackTicker();

export function findIndexForTime(timePoints: number[], timeMs: number): number {
  let low = 0;
  let high = timePoints.length - 1;
  if (timePoints.length === 0) return 0;
  if (timeMs >= timePoints[high]) {
    return high;
  }
  while (low < high) {
    const mid = (low + high) >> 1;
    if (timePoints[mid] >= timeMs) {
      high = mid;
    } else {
      low = mid + 1;
    }
  }
  return low;
}
