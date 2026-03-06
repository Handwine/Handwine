export class WorkspaceSetupError extends Error {
  constructor(
    message: string,
    public readonly code: SetupErrorCode,
    public readonly remediation: string
  ) {
    super(message);
    this.name = "WorkspaceSetupError";
  }
}

export type SetupErrorCode =
  | "DOCKER_NOT_FOUND"
  | "DOCKER_NOT_RUNNING"
  | "DOCKER_TIMEOUT"
  | "WSL2_NOT_INSTALLED"
  | "WSL2_DISTRO_NOT_RUNNING"
  | "HYPERV_NOT_AVAILABLE"
  | "WINDOWS_HOME_REQUIRES_WSL2"
  | "UNKNOWN";

export const REMEDIATION: Record<SetupErrorCode, string> = {
  DOCKER_NOT_FOUND: [
    "Docker Desktop is not installed.",
    "Download and install Docker Desktop from https://www.docker.com/products/docker-desktop/",
    "After installation, start Docker Desktop and wait until the whale icon in the taskbar shows 'Docker Desktop is running'.",
  ].join("\n"),

  DOCKER_NOT_RUNNING: [
    "Docker Desktop is installed but not running.",
    "Open Docker Desktop from the Start menu and wait for it to finish starting up.",
    "Then retry cowork setup.",
  ].join("\n"),

  DOCKER_TIMEOUT: [
    "Docker Desktop is taking too long to respond.",
    "Ensure Docker Desktop is fully started (taskbar icon should show 'Docker Desktop is running').",
    "If Docker appears stuck, try restarting it from the taskbar icon → Restart.",
  ].join("\n"),

  WSL2_NOT_INSTALLED: [
    "WSL2 (Windows Subsystem for Linux 2) is not installed.",
    "Windows 11 Home requires WSL2 for Docker Desktop.",
    "Run the following in an elevated PowerShell or Command Prompt:",
    "  wsl --install",
    "Then restart your computer and try again.",
  ].join("\n"),

  WSL2_DISTRO_NOT_RUNNING: [
    "WSL2 is installed but no distribution is currently running.",
    "Docker Desktop (WSL2 backend) needs an active WSL2 distribution.",
    "Open Docker Desktop settings → Resources → WSL Integration and ensure",
    "your distro is enabled. Then restart Docker Desktop.",
  ].join("\n"),

  HYPERV_NOT_AVAILABLE: [
    "Hyper-V is not available on your system.",
    "Windows 11 Home does not support Hyper-V.",
    "Docker Desktop must use the WSL2 backend instead.",
    "In Docker Desktop settings → General, select 'Use the WSL2 based engine'.",
  ].join("\n"),

  WINDOWS_HOME_REQUIRES_WSL2: [
    "Windows 11 Home detected. Hyper-V is not available on this edition.",
    "Docker Desktop must use the WSL2 backend.",
    "Steps to fix:",
    "  1. Install WSL2:  wsl --install  (elevated prompt, then reboot)",
    "  2. Install Docker Desktop and select WSL2 backend during setup.",
    "  3. In Docker Desktop → Settings → General → check 'Use the WSL2 based engine'.",
    "  4. Retry cowork setup.",
  ].join("\n"),

  UNKNOWN: [
    "An unexpected error occurred during workspace setup.",
    "Check that Docker Desktop is running and try again.",
    "If the problem persists, restart Docker Desktop and your machine.",
  ].join("\n"),
};
