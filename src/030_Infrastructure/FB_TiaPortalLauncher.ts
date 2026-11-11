/**
 * FB_TiaPortalLauncher - TIA Portal watcher 进程启动器
 * （西门子命名规范：FB_ 前缀 = Function Block，有状态实例）
 *
 * Spawns a standalone PowerShell watcher process that loads
 * Siemens.Engineering.dll (TIA Portal Openness) and drives TIA Portal
 * from outside. Tracks watcher lifecycle; delegates to IPC for commands.
 *
 * 层级：030_Infrastructure（基础设施层：与 watcher 进程/文件系统交互）
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { spawn, ChildProcess } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { LauncherConfig, LauncherStatus, TiaState, IpcResult, ScriptExecutor } from '../010_Core/T_Types';
import { IpcClient } from './FB_IpcClient';
import {
  G_DEFAULT_IPC_CONFIG,
  G_SESSION_DIR_PREFIX,
  G_READY_TIMEOUT_MS,
  G_READY_POLL_MS,
  G_SHUTDOWN_WAIT_MS,
  G_HEALTH_CHECK_INTERVAL_MS,
} from '../020_Config/G_Config';
import { ScriptManager } from '../040_Services/FB_ScriptManager';
import { launcherLog } from '../010_Core/FC_Logger';

export class TiaPortalLauncher implements ScriptExecutor {
  private config: LauncherConfig;
  private state: TiaState = 'stopped';
  private pid: number | null = null;
  private sessionId: string | null = null;
  private ipcDir: string | null = null;
  private ipcClient: IpcClient | null = null;
  private process: ChildProcess | null = null;
  private startedAt: number | null = null;
  private lastError: string | null = null;
  private healthInterval: ReturnType<typeof setInterval> | null = null;
  private stateChangeCallbacks: Array<(state: TiaState) => void> = [];

  constructor(config: LauncherConfig) {
    this.config = config;
  }

  /**
   * Resolve the TIA Portal Openness PublicAPI dll:
   * 1. scan C:\Program Files\Siemens\Automation\Portal V*\PublicAPI\V*\Siemens.Engineering.dll
   * 2. prefer the folder matching config.tiaVersion (e.g. "V17"), else newest.
   */
  resolvePublicApiDll(): string {
    const automationRoot = 'C:\\Program Files\\Siemens\\Automation';
    const dlls: string[] = [];
    if (fs.existsSync(automationRoot)) {
      for (const entry of fs.readdirSync(automationRoot)) {
        if (!/^Portal V/i.test(entry)) continue;
        const portalDir = path.join(automationRoot, entry);
        const publicApiRoot = path.join(portalDir, 'PublicAPI');
        if (!fs.existsSync(publicApiRoot)) continue;
        const walk = (dir: string) => {
          for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
            const full = path.join(dir, ent.name);
            if (ent.isDirectory()) walk(full);
            else if (ent.name === 'Siemens.Engineering.dll') dlls.push(full);
          }
        };
        walk(publicApiRoot);
      }
    }
    if (dlls.length === 0) return '';
    const wanted = this.config.tiaVersion.trim();
    if (wanted) {
      const match = dlls.find((d) => d.includes(wanted));
      if (match) return match;
    }
    // Newest by natural version sort (longest version string wins as a
    // simple heuristic; Portal V19 > Portal V17 lexically for the common
    // two-digit scheme).
    return dlls.sort((a, b) => b.localeCompare(a))[0];
  }

  /**
   * Scan %TEMP%/tia-mcp-persistent/ for an existing live watcher session and
   * adopt it. Used at first launch() after an MCP-server restart.
   */
  private async tryAdoptExistingSession(): Promise<boolean> {
    try {
      const sessionsRoot = path.join(os.tmpdir(), G_SESSION_DIR_PREFIX);
      if (!fs.existsSync(sessionsRoot)) return false;
      const entries = fs.readdirSync(sessionsRoot, { withFileTypes: true });
      const candidates: Array<{ dir: string; pid: number; mtime: number }> = [];
      for (const ent of entries) {
        if (!ent.isDirectory()) continue;
        const dir = path.join(sessionsRoot, ent.name);
        const sigPath = path.join(dir, 'ready.signal');
        if (!fs.existsSync(sigPath)) continue;
        let parsed: { pid?: number } = {};
        try {
          parsed = JSON.parse(fs.readFileSync(sigPath, 'utf-8'));
        } catch {
          continue; // malformed ready.signal — skip
        }
        if (typeof parsed.pid !== 'number') continue;
        // Liveness check.
        try { process.kill(parsed.pid, 0); } catch { continue; }
        const mtime = fs.statSync(sigPath).mtimeMs;
        candidates.push({ dir, pid: parsed.pid, mtime });
      }
      if (candidates.length === 0) return false;
      candidates.sort((a, b) => b.mtime - a.mtime);
      const chosen = candidates[0];
      launcherLog.info(`Adopting existing watcher session: PID ${chosen.pid} dir ${chosen.dir}`);
      this.sessionId = path.basename(chosen.dir);
      this.ipcDir = chosen.dir;
      this.ipcClient = new IpcClient({ baseDir: this.ipcDir, ...G_DEFAULT_IPC_CONFIG });
      await this.ipcClient.ensureDirectories();
      this.pid = chosen.pid;
      this.process = null; // we didn't spawn it; no ChildProcess handle
      this.startedAt = chosen.mtime;
      this.lastError = null;
      this.setState('ready');
      this.startHealthMonitor();
      return true;
    } catch (err) {
      launcherLog.warn(`Adoption scan failed: ${err}`);
      return false;
    }
  }

  /** Launch the PowerShell watcher (attach/launch TIA lazily on first command) */
  async launch(): Promise<void> {
    if (this.state === 'ready' || this.state === 'launching') {
      launcherLog.warn(`Cannot launch: state is ${this.state}`);
      return;
    }

    // Adopt an existing live session left by a previous MCP server process.
    if (this.pid === null && this.state === 'stopped') {
      if (await this.tryAdoptExistingSession()) {
        return;
      }
    }

    // Recovery path: watcher alive but ready.signal not yet seen.
    if (this.state === 'error' && this.pid !== null && this.ipcDir && this.ipcClient) {
      const stillAlive = this.isRunning();
      if (stillAlive) {
        const readyNow = await this.ipcClient.isReady();
        if (readyNow) {
          launcherLog.info(`Recovery: live PID ${this.pid} watcher already ready; attaching`);
          this.lastError = null;
          if (this.startedAt === null) this.startedAt = Date.now();
          this.setState('ready');
          this.startHealthMonitor();
          return;
        }
        launcherLog.warn(`Recovery: PID ${this.pid} alive but watcher not ready yet — polling without respawn`);
        this.setState('launching');
        const recoverStart = Date.now();
        while (Date.now() - recoverStart < G_READY_TIMEOUT_MS) {
          if (await this.ipcClient.isReady()) {
            this.lastError = null;
            if (this.startedAt === null) this.startedAt = Date.now();
            this.setState('ready');
            launcherLog.info('TIA watcher is ready (recovery path)');
            this.startHealthMonitor();
            return;
          }
          await this.sleep(G_READY_POLL_MS);
        }
        this.lastError = `Recovery: PID ${this.pid} still no ready.signal after ${G_READY_TIMEOUT_MS}ms`;
        this.setState('error');
        throw new Error(this.lastError);
      }
      launcherLog.info(`Recovery: PID ${this.pid} no longer alive; spawning fresh`);
      this.pid = null;
      this.process = null;
    }

    this.setState('launching');
    this.sessionId = uuidv4();
    this.ipcDir = path.join(os.tmpdir(), G_SESSION_DIR_PREFIX, this.sessionId);

    launcherLog.info(`Session ${this.sessionId} — IPC dir: ${this.ipcDir}`);

    this.ipcClient = new IpcClient({
      baseDir: this.ipcDir,
      ...G_DEFAULT_IPC_CONFIG,
    });
    await this.ipcClient.ensureDirectories();

    // Prepare the interpolated watcher script
    const scriptManager = new ScriptManager();
    const watcherTemplate = scriptManager.loadTemplate('watcher');
    const publicApiDll = this.resolvePublicApiDll();
    const watcherContent = scriptManager.interpolate(watcherTemplate, {
      IPC_BASE_DIR: this.ipcDir,
      SCRIPTS_DIR: path.join(__dirname, '..', '090_Scripts'),
      PUBLIC_API_DLL: publicApiDll,
      TIA_EXE_PATH: this.config.tiaExePath || '',
    });

    const watcherPath = path.join(this.ipcDir, 'watcher.ps1');
    fs.writeFileSync(watcherPath, watcherContent, 'utf-8');

    if (publicApiDll) {
      launcherLog.info(`Openness dll: ${publicApiDll}`);
    } else {
      launcherLog.warn(
        'Siemens.Engineering.dll not found — watcher will start but Openness calls will fail. Install TIA Portal with Openness.'
      );
    }

    // Optional: kill any pre-existing TIA Portal before launching (opt-in).
    if (this.config.killExistingTia === true && process.platform === 'win32') {
      try {
        const { execSync } = require('child_process');
        try {
          execSync('taskkill /F /T /IM Siemens.Automation.Portal.exe', { timeout: 10_000, stdio: 'ignore' });
          launcherLog.info('Killed pre-existing TIA Portal processes (opted-in via --kill-existing-tia).');
          await this.sleep(2_000);
        } catch {
          // Most common failure: no process found. That's the normal case.
        }
      } catch (killErr) {
        launcherLog.warn(`Pre-launch kill skipped: ${killErr}`);
      }
    }

    // Spawn the standalone PowerShell watcher. Openness runs outside TIA,
    // so no IDE injection is needed — ready.signal appears within seconds
    // (TIA itself is started/attached lazily by the first command).
    const psArgs = [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy', 'Bypass',
      '-File', watcherPath,
    ];
    launcherLog.info(`Spawning watcher: powershell.exe ${psArgs.join(' ')}`);

    this.process = spawn('powershell.exe', psArgs, {
      detached: true,
      shell: false,
      windowsHide: false,
      stdio: 'ignore',
      cwd: this.ipcDir,
    });

    this.pid = this.process.pid ?? null;
    this.process.unref();

    launcherLog.info(`Watcher spawned with PID ${this.pid}`);

    this.process.on('exit', (code) => {
      launcherLog.warn(`Watcher process exited with code ${code}`);
      if (this.state !== 'stopping') {
        this.lastError = `Watcher exited unexpectedly (code ${code})`;
        this.setState('error');
      }
      this.pid = null;
      this.process = null;
    });

    // Poll for ready.signal
    const readyStart = Date.now();
    while (Date.now() - readyStart < G_READY_TIMEOUT_MS) {
      if (await this.ipcClient.isReady()) {
        this.setState('ready');
        this.startedAt = Date.now();
        launcherLog.info('TIA Portal watcher is ready');
        this.startHealthMonitor();
        return;
      }
      await this.sleep(G_READY_POLL_MS);
    }

    // Timeout — watcher never signaled ready
    this.lastError = `Watcher did not signal ready within ${G_READY_TIMEOUT_MS}ms`;
    this.setState('error');
    throw new Error(this.lastError);
  }

  /**
   * Graceful shutdown. IMPORTANT: the TIA Portal application itself is
   * NEVER killed — only the watcher PowerShell process is stopped. The
   * user's TIA session (possibly with unsaved work) must stay intact.
   */
  async shutdown(): Promise<void> {
    if (this.state === 'stopped' || this.state === 'stopping') return;

    this.setState('stopping');
    this.stopHealthMonitor();

    // Send terminate signal to the watcher
    if (this.ipcClient) {
      try {
        await this.ipcClient.sendTerminate();
      } catch {
        launcherLog.warn('Failed to send terminate signal');
      }
    }

    // Wait for process exit
    if (this.pid !== null) {
      const waitStart = Date.now();
      while (Date.now() - waitStart < G_SHUTDOWN_WAIT_MS) {
        if (!this.isRunning()) break;
        await this.sleep(500);
      }

      // Force kill the WATCHER only if still alive (never TIA Portal!)
      if (this.isRunning() && this.pid !== null) {
        launcherLog.warn('Force-killing watcher process (TIA Portal left running)');
        try {
          if (process.platform === 'win32') {
            const { execSync } = require('child_process');
            try {
              execSync(`taskkill /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
              await this.sleep(2_000);
            } catch { /* ignore */ }
            if (this.isRunning()) {
              try {
                execSync(`taskkill /F /PID ${this.pid}`, { timeout: 5000, stdio: 'ignore' });
              } catch { /* ignore */ }
            }
          } else if (this.process) {
            this.process.kill('SIGTERM');
            await this.sleep(2_000);
            if (this.isRunning() && this.process) {
              this.process.kill('SIGKILL');
            }
          }
        } catch {
          launcherLog.warn('Failed to kill watcher process');
        }
      }
    }

    // Clean up IPC directory
    if (this.ipcClient) {
      await this.ipcClient.cleanup();
    }

    this.pid = null;
    this.process = null;
    this.ipcClient = null;
    this.setState('stopped');
    launcherLog.info('Shutdown complete (TIA Portal left untouched).');
  }

  /** Execute a script through the IPC channel */
  async executeScript(content: string, timeoutMs?: number): Promise<IpcResult> {
    if (this.state !== 'ready' || !this.ipcClient) {
      throw new Error(`Cannot execute script: launcher state is '${this.state}'`);
    }
    return this.ipcClient.sendCommand(content, timeoutMs);
  }

  /** Get current launcher status */
  getStatus(): LauncherStatus {
    return {
      state: this.state,
      pid: this.pid,
      sessionId: this.sessionId,
      ipcDir: this.ipcDir,
      startedAt: this.startedAt,
      lastError: this.lastError,
    };
  }

  /** Check if the watcher process is still alive */
  isRunning(): boolean {
    if (this.pid === null) return false;
    try {
      process.kill(this.pid, 0); // Signal 0 = test if process exists
      return true;
    } catch {
      return false;
    }
  }

  /** Register callback for state changes */
  onStateChange(callback: (state: TiaState) => void): void {
    this.stateChangeCallbacks.push(callback);
  }

  private setState(state: TiaState): void {
    const prev = this.state;
    this.state = state;
    if (prev !== state) {
      launcherLog.info(`State: ${prev} -> ${state}`);
      for (const cb of this.stateChangeCallbacks) {
        try { cb(state); } catch { /* ignore callback errors */ }
      }
    }
  }

  private startHealthMonitor(): void {
    this.healthInterval = setInterval(() => {
      if (this.state === 'ready' && !this.isRunning()) {
        launcherLog.error('Health check: watcher process died');
        this.lastError = 'Watcher process died unexpectedly';
        this.pid = null;
        this.process = null;
        this.setState('error');
        this.stopHealthMonitor();
      }
    }, G_HEALTH_CHECK_INTERVAL_MS);
  }

  private stopHealthMonitor(): void {
    if (this.healthInterval) {
      clearInterval(this.healthInterval);
      this.healthInterval = null;
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
