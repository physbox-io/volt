import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * circuit_machine_resume_from_line is the Run From panel for an agent, so it
 * has to refuse what the panel refuses: a disarmed machine, a line the program
 * does not have, a machine that would not start a job — before anything streams.
 */

const state = { connected: true, status: 'IDLE', totalLines: 2000, mpos: {}, wpos: {} };
const machine = {
  getState: () => state,
  getTransportMode: () => 'usb',
  isRunning: () => false,
  isJobPaused: () => false,
  jobOrigin: () => null,
  getCurrentLayer: () => null,
  cancelJob: vi.fn(),
  addStopListener: vi.fn(() => () => {}),
  startBlockedReason: vi.fn((): string | null => null),
  runFromLine: vi.fn(() => new Promise<void>(() => {})),
};
vi.mock('../src/utils/webSerialManager', () => ({ webSerialManager: machine }));
vi.mock('../src/utils/apiClient', () => ({ fetchMachineDevices: vi.fn().mockResolvedValue([]) }));
vi.mock('../src/utils/cloudDocuments', () => ({ cloudAutosave: { getStatus: () => ({}) } }));

const { createVoltMachineHandlers, machineArming } = await import('../src/utils/machineMcp');
const handlers = createVoltMachineHandlers();

beforeEach(() => {
  vi.clearAllMocks();
  machineArming.arm();
});

describe('resume from a line over MCP', () => {
  it('runs the program from the line, as a mill', async () => {
    const reply = (await handlers.MACHINE_RESUME_FROM_LINE({ fromLine: 1180 })) as { message: string };
    expect(machine.runFromLine).toHaveBeenCalledWith(1180, { isLaser: false });
    expect(reply.message).toMatch(/1180/);
  });

  it('refuses a line past the end, a negative one, or none', async () => {
    for (const fromLine of [2000, -1, 3.5, undefined]) {
      await expect(handlers.MACHINE_RESUME_FROM_LINE({ fromLine })).rejects.toThrow();
    }
    expect(machine.runFromLine).not.toHaveBeenCalled();
  });

  it("passes on the machine's reason not to start", async () => {
    machine.startBlockedReason.mockReturnValueOnce('Zero Z on the copper first.');
    await expect(handlers.MACHINE_RESUME_FROM_LINE({ fromLine: 10 })).rejects.toThrow(/Zero Z/);
    expect(machine.runFromLine).not.toHaveBeenCalled();
  });

  it('reports a refusal the stream makes before its first line', async () => {
    machine.runFromLine.mockReturnValueOnce(Promise.reject(new Error('Runs off the end of Y.')));
    await expect(handlers.MACHINE_RESUME_FROM_LINE({ fromLine: 10 })).rejects.toThrow(/end of Y/);
  });

  it('is refused while disarmed', async () => {
    machineArming.disarm('operator');
    await expect(handlers.MACHINE_RESUME_FROM_LINE({ fromLine: 10 })).rejects.toThrow(/not armed/);
    expect(machine.runFromLine).not.toHaveBeenCalled();
  });
});
