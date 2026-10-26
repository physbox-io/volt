import { AlertTriangle } from 'lucide-react';

/**
 * Connected, and the controller has stopped answering.
 *
 * The machine package raises `controllerSilent` after a few seconds with no
 * reply at all, status reports included. Nothing here showed it, so a job that
 * could not stream sat on its first line looking merely slow. Mesh's wording.
 */
export function ControllerSilenceBanner({ connected, silent }: { connected: boolean; silent?: boolean }) {
  if (!connected || !silent) return null;
  return (
    <div className="flex items-start gap-2 rounded-lg bg-red-500/10 border border-red-500/50 px-3 py-2 text-[11px] leading-relaxed text-red-700 dark:text-red-300">
      <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
      <span>
        <strong className="font-bold">The controller is not answering.</strong> Commands are going
        out (the machine may well still move) but nothing has come back for several seconds, and a
        job cannot stream without the replies. Seen from a second controller sharing a USB hub, a
        lead with no receive line, the wrong baud rate (GRBL is 115200), and a controller that
        needed power-cycling. Try going straight into the machine rather than through a hub first.
      </span>
    </div>
  );
}
