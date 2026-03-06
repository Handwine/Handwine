import { setupWorkspace } from "../workspace-setup";
import * as windowsPlatform from "../platform/windows";

jest.mock("../platform/windows");

const mockGetWindowsInfo = windowsPlatform.getWindowsInfo as jest.MockedFunction<
  typeof windowsPlatform.getWindowsInfo
>;
const mockProbeDockerSocket =
  windowsPlatform.probeDockerSocket as jest.MockedFunction<
    typeof windowsPlatform.probeDockerSocket
  >;

const BASE_LINUX_INFO: windowsPlatform.WindowsInfo = {
  isWindows: false,
  edition: "Unknown",
  hasHyperV: false,
  hasWSL2: false,
  wsl2DistroRunning: false,
  dockerSocketPath: "/var/run/docker.sock",
};

const BASE_WIN_HOME_INFO: windowsPlatform.WindowsInfo = {
  isWindows: true,
  edition: "Home",
  hasHyperV: false,
  hasWSL2: true,
  wsl2DistroRunning: true,
  dockerSocketPath: "\\\\.\\pipe\\docker_engine",
};

beforeEach(() => {
  jest.clearAllMocks();
});

describe("setupWorkspace — success paths", () => {
  it("succeeds on Linux when Docker is running", async () => {
    mockGetWindowsInfo.mockResolvedValue(BASE_LINUX_INFO);
    mockProbeDockerSocket.mockResolvedValue(true);

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 1 });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it("succeeds on Windows 11 Home when WSL2 is present and Docker responds", async () => {
    mockGetWindowsInfo.mockResolvedValue(BASE_WIN_HOME_INFO);
    mockProbeDockerSocket.mockResolvedValue(true);

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 1 });

    expect(result.success).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

describe("setupWorkspace — Windows 11 Home failure paths", () => {
  it("fails with WSL2_NOT_INSTALLED when WSL2 is missing on Home", async () => {
    mockGetWindowsInfo.mockResolvedValue({
      ...BASE_WIN_HOME_INFO,
      hasWSL2: false,
    });

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("WSL2_NOT_INSTALLED");
    expect(result.error?.remediation).toMatch(/wsl --install/);
  });

  it("fails with DOCKER_NOT_FOUND when socket is absent", async () => {
    mockGetWindowsInfo.mockResolvedValue({
      ...BASE_WIN_HOME_INFO,
      dockerSocketPath: null,
    });

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("DOCKER_NOT_FOUND");
  });

  it("fails with WSL2_DISTRO_NOT_RUNNING when WSL2 distro is stopped and Docker times out", async () => {
    mockGetWindowsInfo.mockResolvedValue({
      ...BASE_WIN_HOME_INFO,
      wsl2DistroRunning: false,
    });
    mockProbeDockerSocket.mockResolvedValue(false);

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("WSL2_DISTRO_NOT_RUNNING");
    expect(result.error?.remediation).toMatch(/WSL Integration/);
  });

  it("fails with DOCKER_TIMEOUT on Home when WSL2 is running but Docker is unresponsive", async () => {
    mockGetWindowsInfo.mockResolvedValue(BASE_WIN_HOME_INFO);
    mockProbeDockerSocket.mockResolvedValue(false);

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 1 });

    expect(result.success).toBe(false);
    expect(result.error?.code).toBe("DOCKER_TIMEOUT");
  });
});

describe("setupWorkspace — retry behaviour", () => {
  it("succeeds on the second probe attempt after an initial failure", async () => {
    mockGetWindowsInfo.mockResolvedValue(BASE_LINUX_INFO);
    mockProbeDockerSocket
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);

    const result = await setupWorkspace({ dockerTimeoutMs: 100, dockerRetries: 2 });

    expect(result.success).toBe(true);
    expect(mockProbeDockerSocket).toHaveBeenCalledTimes(2);
  });
});
