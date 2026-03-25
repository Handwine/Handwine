import { execSync, spawnSync, spawn } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export interface SlackLaunchResult {
  success: boolean;
  action: "launched" | "focused" | "restarted" | "failed";
  message: string;
}

/**
 * Returns the path to Slack's SingletonLock file.
 *
 * Electron writes this file when the first instance starts. If the process
 * exits uncleanly (e.g. killed after closing from the tray) the file may be
 * left behind, causing the next launch to think an instance is already running
 * and silently exit without showing a window.
 */
export function getSlackLockPath(): string {
  if (process.platform === "win32") {
    const appData =
      process.env.APPDATA ??
      path.join(os.homedir(), "AppData", "Roaming");
    return path.join(appData, "Slack", "SingletonLock");
  }
  return path.join(os.homedir(), ".config", "Slack", "SingletonLock");
}

/**
 * Returns the PIDs of all running Slack processes, or an empty array if none.
 */
export function getSlackPids(): number[] {
  try {
    if (process.platform === "win32") {
      const out = execSync(
        'tasklist /FI "IMAGENAME eq slack.exe" /FO CSV /NH',
        { encoding: "utf8", timeout: 5000 }
      );
      return out
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const parts = line.split(",");
          return parts[1] ? parseInt(parts[1].replace(/"/g, ""), 10) : NaN;
        })
        .filter((pid) => !isNaN(pid));
    }

    const result = spawnSync("pgrep", ["-x", "slack"], {
      encoding: "utf8",
      timeout: 5000,
    });
    if (result.status !== 0 || !result.stdout?.trim()) return [];
    return result.stdout
      .trim()
      .split("\n")
      .map((p) => parseInt(p, 10))
      .filter((pid) => !isNaN(pid));
  } catch {
    return [];
  }
}

/**
 * Returns true when at least one Slack window is currently visible on screen.
 *
 * On Linux, wmctrl is used when available. This distinguishes the common
 * "tray-closed" state — process alive, window destroyed — from an actually
 * visible window.
 */
export function isSlackWindowVisible(): boolean {
  if (process.platform === "linux") {
    try {
      const result = spawnSync("wmctrl", ["-l"], {
        encoding: "utf8",
        timeout: 3000,
      });
      if (result.status === 0 && result.stdout) {
        return result.stdout.toLowerCase().includes("slack");
      }
    } catch {
      // wmctrl not installed; fall through to the process-based heuristic
    }
  }
  // Windows (or Linux without wmctrl): assume visible if the process is alive.
  return getSlackPids().length > 0;
}

/** Terminates all running Slack processes. */
export function killSlack(): void {
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/F", "/IM", "slack.exe"], { timeout: 5000 });
  } else {
    spawnSync("pkill", ["-x", "slack"], { timeout: 5000 });
  }
}

/**
 * Deletes Slack's SingletonLock file if it exists.
 *
 * A stale lock file is left behind when the process is killed (e.g. after
 * the user closes Slack from the tray). The next Electron launch reads this
 * file, decides another instance owns the lock, tries to forward the
 * "second-instance" event to a process that no longer exists, and silently
 * exits — leaving the user with nothing on screen.
 */
export function clearStaleLockFile(): void {
  const lockPath = getSlackLockPath();
  try {
    if (fs.existsSync(lockPath)) {
      fs.unlinkSync(lockPath);
    }
  } catch {
    // Best-effort; if the file can't be removed the launch will handle it.
  }
}

/**
 * Resolves the Slack executable path for the current platform.
 * Returns null when Slack is not installed in any expected location.
 */
export function resolveSlackExecutable(): string | null {
  if (process.platform === "win32") {
    const localAppData =
      process.env.LOCALAPPDATA ??
      path.join(os.homedir(), "AppData", "Local");
    const candidates = [
      path.join(localAppData, "slack", "slack.exe"),
      path.join(localAppData, "Programs", "slack", "Slack.exe"),
    ];
    for (const c of candidates) {
      if (fs.existsSync(c)) return c;
    }
    return null;
  }

  // Linux
  const linuxCandidates = [
    "/usr/bin/slack",
    "/usr/local/bin/slack",
    "/opt/slack/slack",
    `${os.homedir()}/.local/bin/slack`,
  ];
  for (const c of linuxCandidates) {
    if (fs.existsSync(c)) return c;
  }

  const which = spawnSync("which", ["slack"], {
    encoding: "utf8",
    timeout: 3000,
  });
  if (which.status === 0 && which.stdout?.trim()) {
    return which.stdout.trim();
  }

  return null;
}

/** Spawns Slack detached from the current process. */
function spawnSlack(executablePath: string): boolean {
  try {
    const child = spawn(executablePath, [], {
      detached: true,
      stdio: "ignore",
    });
    child.unref();
    return true;
  } catch {
    return false;
  }
}

/**
 * Launches Slack, correctly handling the tray-closed state.
 *
 * ## The bug
 * When the user closes Slack from the system tray the BrowserWindow is
 * destroyed but the Electron main process stays alive, holding the
 * SingletonLock. Clicking the Slack icon starts a new instance; Electron
 * detects the existing lock, fires the `second-instance` event on the first
 * process, and the new instance exits immediately. But the first process has
 * no window to show in response to that event — so nothing appears on screen.
 *
 * ## The fix
 * 1. If Slack is running **and** a window is visible → already open; do nothing.
 * 2. If Slack is running **but** no window is visible (tray-closed state) →
 *    kill the stale process, remove the SingletonLock, then start fresh.
 * 3. If Slack is not running → remove any stale lock file, then start fresh.
 */
export async function launchSlack(
  executablePath?: string
): Promise<SlackLaunchResult> {
  const slackPath = executablePath ?? resolveSlackExecutable();

  if (!slackPath) {
    return {
      success: false,
      action: "failed",
      message: "Slack executable not found. Please install Slack.",
    };
  }

  const pids = getSlackPids();

  if (pids.length > 0) {
    if (isSlackWindowVisible()) {
      // Window is already on screen — nothing to do.
      return {
        success: true,
        action: "focused",
        message: "Slack is already running and visible.",
      };
    }

    // Process alive but window is gone (tray-closed state).
    // Kill the stale process so Electron's single-instance lock is released.
    killSlack();

    // Give the OS a moment to release the lock-file handle.
    await new Promise<void>((resolve) => setTimeout(resolve, 500));

    clearStaleLockFile();

    const ok = spawnSlack(slackPath);
    return {
      success: ok,
      action: "restarted",
      message: ok
        ? "Slack was in tray-closed state — restarted successfully."
        : "Failed to restart Slack after clearing the tray process.",
    };
  }

  // No process running at all — clear any stale lock file then launch.
  clearStaleLockFile();

  const ok = spawnSlack(slackPath);
  return {
    success: ok,
    action: "launched",
    message: ok ? "Slack launched successfully." : "Failed to launch Slack.",
  };
}
