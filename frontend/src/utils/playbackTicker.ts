class PlaybackTicker {
  private listeners = new Set<(elapsedMs: number) => void>();
  private animationFrameId: number | null = null;
  private startTime = 0;
  private duration = 1000;
  private isRunning = false;

  start(durationMs: number) {
    this.duration = durationMs;
    this.startTime = Date.now();
    this.isRunning = true;

    const tick = () => {
      if (!this.isRunning) return;
      let elapsed = Date.now() - this.startTime;
      if (elapsed > this.duration) {
        this.startTime = Date.now();
        elapsed = 0;
      }
      for (const listener of this.listeners) {
        try {
          listener(elapsed);
        } catch (err) {
          console.error("Error in playback ticker listener:", err);
        }
      }
      this.animationFrameId = requestAnimationFrame(tick);
    };

    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animationFrameId = requestAnimationFrame(tick);
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
    return () => {
      this.listeners.delete(listener);
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
