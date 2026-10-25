import React, { useEffect, useState } from 'react';
import { JobCompleteDialog } from '@physbox-io/ui';
import { webSerialManager } from '../utils/webSerialManager';

/**
 * The job ran to its last line. Mounted at the top level, because a board can
 * be milled by an agent over MCP with no export dialog open. Shown only for
 * `lastCompletedJob`, which a cancel, an alarm or a dropped link never set.
 */
export const JobCompleteNotice: React.FC = () => {
  const [job, setJob] = useState(() => webSerialManager.getState().lastCompletedJob ?? null);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  useEffect(() => webSerialManager.addListener((s) => setJob(s.lastCompletedJob ?? null)), []);
  if (!job || job.finishedAt === dismissedAt) return null;
  return <JobCompleteDialog job={job} machine="cnc" onClose={() => setDismissedAt(job.finishedAt)} />;
};
