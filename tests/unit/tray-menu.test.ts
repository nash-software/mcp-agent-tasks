/**
 * Unit tests for the tray menu — AC-3.
 *
 * Verifies that buildMenuItems returns exactly the expected 5 items
 * with correct titles and wired handlers, without starting systray2.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── Mock supervisor ────────────────────────────────────────────────────────────

// We only need the shape; concrete implementation is tested separately.
const mockSupervisor = {
  update: vi.fn(async () => ({ ok: true, log: '', buildId: 'x' })),
  restart: vi.fn(),
  stop: vi.fn(),
  healthState: 'healthy' as const,
  serverPort: 4242,
};

// Mock fs so serverLogPath works without touching the real filesystem.
vi.mock('node:fs', async () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(),
  unlinkSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 0 })),
  renameSync: vi.fn(),
  createWriteStream: vi.fn(() => ({ pipe: vi.fn(), write: vi.fn() })),
}));

vi.mock('node:child_process', () => ({
  spawn: vi.fn(),
}));

vi.mock('../../src/dev/build-runner.js', () => ({
  runBuild: vi.fn(async () => ({ ok: true, log: '', buildId: 'x' })),
}));

const { buildMenuItems } = await import('../../src/tray/index.js');

// ── Tests ─────────────────────────────────────────────────────────────────────

const SCRATCH = '/fake/scratch';
const PORT = 4242;

describe('buildMenuItems — AC-3: menu structure', () => {
  it('returns exactly 5 items', () => {
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
    );
    expect(items).toHaveLength(5);
  });

  it('items have expected titles in order', () => {
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
    );
    const titles = items.map((i) => i.title);
    expect(titles).toEqual([
      'Open Dashboard',
      'Update',
      'Restart server',
      'Open Logs',
      'Quit',
    ]);
  });

  it('all items are enabled', () => {
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
    );
    for (const item of items) {
      expect(item.enabled).toBe(true);
    }
  });

  it('Open Dashboard handler calls openUrl with correct URL', () => {
    const openUrl = vi.fn();
    const openFile = vi.fn();
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
      openUrl,
      openFile,
    );
    const dashboardItem = items.find((i) => i.title === 'Open Dashboard')!;
    dashboardItem.handler();
    expect(openUrl).toHaveBeenCalledWith(`http://localhost:${PORT}`);
  });

  it('Update handler calls supervisor.update()', async () => {
    mockSupervisor.update.mockResolvedValue({ ok: true, log: '', buildId: 'new' });
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
    );
    const updateItem = items.find((i) => i.title === 'Update')!;
    await updateItem.handler();
    expect(mockSupervisor.update).toHaveBeenCalledOnce();
  });

  it('Restart server handler calls supervisor.restart()', () => {
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
    );
    const restartItem = items.find((i) => i.title === 'Restart server')!;
    restartItem.handler();
    expect(mockSupervisor.restart).toHaveBeenCalledOnce();
  });

  it('Open Logs handler calls openFile with the server log path', () => {
    const openUrl = vi.fn();
    const openFile = vi.fn();
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
      openUrl,
      openFile,
    );
    const logsItem = items.find((i) => i.title === 'Open Logs')!;
    logsItem.handler();
    expect(openFile).toHaveBeenCalledOnce();
    const calledPath = openFile.mock.calls[0]![0] as string;
    expect(calledPath).toContain('server.log');
  });

  it('Quit handler calls supervisor.stop() and process.exit(0)', () => {
    const exitSpy = vi.spyOn(process, 'exit').mockImplementation((_code?: unknown) => {
      throw new Error('EXIT');
    });
    const items = buildMenuItems(
      mockSupervisor as unknown as Parameters<typeof buildMenuItems>[0],
      PORT,
      SCRATCH,
    );
    const quitItem = items.find((i) => i.title === 'Quit')!;
    expect(() => quitItem.handler()).toThrow('EXIT');
    expect(mockSupervisor.stop).toHaveBeenCalledOnce();
    exitSpy.mockRestore();
  });
});

beforeEach(() => {
  mockSupervisor.update.mockReset();
  mockSupervisor.restart.mockReset();
  mockSupervisor.stop.mockReset();
});
