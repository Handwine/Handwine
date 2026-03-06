import { getWindowsInfo, probeDockerSocket } from "./platform/windows";
import { WorkspaceSetupError, REMEDIATION } from "./errors";

export interface SetupOptions {
  /** How long (ms) to wait for Docker to respond before giving up. Default: 15 000 */
  dockerTimeoutMs?: number;
  /** How many times to retry Docker probe before failing. Default: 3 */
  dockerRetries?: number;
  /** Called with progress messages so callers can update UI. */
  onProgress?: (message: string) => void;
}

export interface SetupResult {
  success: boolean;
  error?: WorkspaceSetupError;
}

const DEFAULT_TIMEOUT_MS = 15_000;
const DEFAULT_RETRIES = 3;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Sets up Claude's cowork workspace.
 *
 * Fixes the Windows 11 Home hang by:
 *  1. Detecting the Windows edition before touching Docker at all.
 *  2. On Home: verifying WSL2 is present (required; Hyper-V is unavailable).
 *  3. Resolving the correct Docker socket path for the active backend.
 *  4. Probing the socket with a hard timeout + retries instead of blocking forever.
 *  5. Returning a structured error with actionable remediation text on failure.
 */
export async function setupWorkspace(
  opts: SetupOptions = {}
): Promise<SetupResult> {
  const {
    dockerTimeoutMs = DEFAULT_TIMEOUT_MS,
    dockerRetries = DEFAULT_RETRIES,
    onProgress = () => {},
  } = opts;

  onProgress("Detecting platform...");
  const win = await getWindowsInfo();

  // ── Windows-specific pre-flight ──────────────────────────────────────────
  if (win.isWindows) {
    onProgress(`Detected Windows edition: ${win.edition}`);

    if (win.edition === "Home") {
      // Windows 11 Home has no Hyper-V; Docker MUST use WSL2 backend.
      onProgress("Windows 11 Home detected — checking WSL2...");

      if (!win.hasWSL2) {
        return {
          success: false,
          error: new WorkspaceSetupError(
            "WSL2 is not installed. Windows 11 Home requires WSL2 for Docker.",
            "WSL2_NOT_INSTALLED",
            REMEDIATION["WSL2_NOT_INSTALLED"]
          ),
        };
      }

      onProgress("WSL2 is installed.");
    } else {
      // Pro / Enterprise / Education can use Hyper-V *or* WSL2.
      onProgress(`Hyper-V available: ${win.hasHyperV}`);
    }
  }

  // ── Locate the Docker socket ──────────────────────────────────────────────
  onProgress("Locating Docker socket...");
  const socketPath = win.dockerSocketPath;

  if (!socketPath) {
    return {
      success: false,
      error: new WorkspaceSetupError(
        "Docker socket not found. Docker Desktop may not be installed.",
        "DOCKER_NOT_FOUND",
        REMEDIATION["DOCKER_NOT_FOUND"]
      ),
    };
  }

  onProgress(`Docker socket found at: ${socketPath}`);

  // ── Probe Docker with timeout + retries ──────────────────────────────────
  onProgress("Connecting to Docker...");

  let lastSuccess = false;
  for (let attempt = 1; attempt <= dockerRetries; attempt++) {
    onProgress(
      `Checking Docker daemon (attempt ${attempt}/${dockerRetries})...`
    );

    lastSuccess = await probeDockerSocket(socketPath, dockerTimeoutMs);
    if (lastSuccess) break;

    if (attempt < dockerRetries) {
      onProgress("Docker not responding yet, retrying...");
      await sleep(2000 * attempt); // back-off: 2 s, 4 s, …
    }
  }

  if (!lastSuccess) {
    // Distinguish between "socket exists but daemon silent" and a hard timeout.
    const code =
      win.isWindows && win.edition === "Home" && !win.wsl2DistroRunning
        ? "WSL2_DISTRO_NOT_RUNNING"
        : "DOCKER_TIMEOUT";

    return {
      success: false,
      error: new WorkspaceSetupError(
        "Docker daemon did not respond within the allowed time.",
        code,
        REMEDIATION[code]
      ),
    };
  }

  onProgress("Docker is running. Setting up Claude's workspace...");

  // ── Actual workspace initialisation (extend here) ────────────────────────
  onProgress("Workspace setup complete.");
  return { success: true };
}
