import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as net from "net";
import * as os from "os";

export interface WindowsInfo {
  isWindows: boolean;
  edition: "Home" | "Pro" | "Enterprise" | "Education" | "Unknown";
  hasHyperV: boolean;
  hasWSL2: boolean;
  wsl2DistroRunning: boolean;
  dockerSocketPath: string | null;
}

/**
 * Detects Windows edition from the registry.
 * Returns "Unknown" on non-Windows or if detection fails.
 */
export function getWindowsEdition(): WindowsInfo["edition"] {
  if (process.platform !== "win32") return "Unknown";
  try {
    const result = execSync(
      'reg query "HKLM\\SOFTWARE\\Microsoft\\Windows NT\\CurrentVersion" /v EditionID',
      { encoding: "utf8", timeout: 5000 }
    );
    const match = result.match(/EditionID\s+REG_SZ\s+(\S+)/i);
    if (!match) return "Unknown";
    const id = match[1].toLowerCase();
    if (id.includes("home")) return "Home";
    if (id.includes("pro")) return "Pro";
    if (id.includes("enterprise")) return "Enterprise";
    if (id.includes("education")) return "Education";
    return "Unknown";
  } catch {
    return "Unknown";
  }
}

/**
 * Checks whether Hyper-V is available.
 * Windows 11 Home does NOT support Hyper-V; only Pro/Enterprise/Education do.
 */
export function checkHyperV(): boolean {
  if (process.platform !== "win32") return false;
  try {
    const result = execSync(
      'powershell -NoProfile -Command "(Get-WindowsOptionalFeature -Online -FeatureName Microsoft-Hyper-V).State"',
      { encoding: "utf8", timeout: 10000 }
    );
    return result.trim() === "Enabled";
  } catch {
    return false;
  }
}

/**
 * Checks whether WSL2 is installed and has at least one distribution available.
 */
export function checkWSL2(): { installed: boolean; distroRunning: boolean } {
  if (process.platform !== "win32") {
    return { installed: false, distroRunning: false };
  }
  try {
    const result = spawnSync("wsl", ["--status"], {
      encoding: "utf8",
      timeout: 8000,
    });
    if (result.status !== 0 && result.error) {
      return { installed: false, distroRunning: false };
    }

    const listResult = spawnSync("wsl", ["--list", "--running", "--quiet"], {
      encoding: "utf8",
      timeout: 8000,
    });
    const distroRunning =
      !listResult.error &&
      listResult.status === 0 &&
      (listResult.stdout?.trim().length ?? 0) > 0;

    return { installed: true, distroRunning };
  } catch {
    return { installed: false, distroRunning: false };
  }
}

/**
 * Resolves the correct Docker socket path for the current platform and backend.
 *
 * On Windows 11 Home (WSL2 backend), the named pipe is:
 *   \\.\pipe\docker_engine
 * which maps to the WSL2-hosted daemon — this is the only working path on Home.
 *
 * On Windows Pro/Enterprise with Hyper-V, the same pipe is used but via Hyper-V.
 */
export function resolveDockerSocketPath(): string | null {
  if (process.platform === "win32") {
    const pipe = "\\\\.\\pipe\\docker_engine";
    return fs.existsSync(pipe) ? pipe : null;
  }
  // Linux / macOS
  const candidates = [
    process.env.DOCKER_HOST?.replace("unix://", "") ?? "",
    "/var/run/docker.sock",
    `${os.homedir()}/.docker/run/docker.sock`,
    `${os.homedir()}/.colima/docker.sock`,
  ].filter(Boolean);

  for (const p of candidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Probes a Docker socket to verify the daemon is actually accepting connections.
 * Returns true if a connection was established within `timeoutMs`.
 */
export function probeDockerSocket(
  socketPath: string,
  timeoutMs = 5000
): Promise<boolean> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, timeoutMs);

    const socket = net.createConnection(socketPath, () => {
      clearTimeout(timer);
      socket.destroy();
      resolve(true);
    });

    socket.on("error", () => {
      clearTimeout(timer);
      resolve(false);
    });
  });
}

/**
 * Gathers a full snapshot of the Windows environment relevant to cowork setup.
 */
export async function getWindowsInfo(): Promise<WindowsInfo> {
  const isWindows = process.platform === "win32";
  const edition = getWindowsEdition();
  const hasHyperV = isWindows ? checkHyperV() : false;
  const { installed: hasWSL2, distroRunning: wsl2DistroRunning } = isWindows
    ? checkWSL2()
    : { installed: false, distroRunning: false };
  const dockerSocketPath = resolveDockerSocketPath();

  return {
    isWindows,
    edition,
    hasHyperV,
    hasWSL2,
    wsl2DistroRunning,
    dockerSocketPath,
  };
}
