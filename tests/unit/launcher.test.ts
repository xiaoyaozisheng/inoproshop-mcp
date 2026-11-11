import { describe, it, expect } from 'vitest';
import { TiaPortalLauncher } from '../../src/030_Infrastructure/FB_TiaPortalLauncher';
import * as os from 'os';

// These tests validate launcher unit behavior without spawning the watcher.

describe('TiaPortalLauncher', () => {
  it('getStatus reports stopped initially', () => {
    const launcher = new TiaPortalLauncher({
      tiaExePath: '',
      tiaVersion: '',
      workspaceDir: os.tmpdir(),
    });

    const status = launcher.getStatus();
    expect(status.state).toBe('stopped');
    expect(status.pid).toBeNull();
    expect(status.sessionId).toBeNull();
  });

  it('isRunning returns false when not launched', () => {
    const launcher = new TiaPortalLauncher({
      tiaExePath: '',
      tiaVersion: '',
      workspaceDir: os.tmpdir(),
    });

    expect(launcher.isRunning()).toBe(false);
  });

  it('executeScript rejects when not ready', async () => {
    const launcher = new TiaPortalLauncher({
      tiaExePath: '',
      tiaVersion: '',
      workspaceDir: os.tmpdir(),
    });

    await expect(launcher.executeScript('Write-Log "hi"')).rejects.toThrow(/state is 'stopped'/);
  });

  it('resolvePublicApiDll returns a string (empty when TIA is not installed)', () => {
    const launcher = new TiaPortalLauncher({
      tiaExePath: '',
      tiaVersion: '',
      workspaceDir: os.tmpdir(),
    });

    expect(typeof launcher.resolvePublicApiDll()).toBe('string');
  });
});
