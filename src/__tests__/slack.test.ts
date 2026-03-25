import * as child_process from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

import {
  launchSlack,
  getSlackLockPath,
  getSlackPids,
  isSlackWindowVisible,
  killSlack,
  clearStaleLockFile,
  resolveSlackExecutable,
} from "../apps/slack";

// ── Module mocks ────────────────────────────────────────────────────────────

jest.mock("child_process", () => ({
  execSync: jest.fn(),
  spawnSync: jest.fn(),
  spawn: jest.fn(),
}));

jest.mock("fs", () => ({
  existsSync: jest.fn(),
  unlinkSync: jest.fn(),
}));

const mockExecSync = child_process.execSync as jest.MockedFunction<
  typeof child_process.execSync
>;
const mockSpawnSync = child_process.spawnSync as jest.MockedFunction<
  typeof child_process.spawnSync
>;
const mockSpawn = child_process.spawn as jest.MockedFunction<
  typeof child_process.spawn
>;
const mockExistsSync = fs.existsSync as jest.MockedFunction<
  typeof fs.existsSync
>;
const mockUnlinkSync = fs.unlinkSync as jest.MockedFunction<
  typeof fs.unlinkSync
>;

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Returns a minimal SpawnSyncReturns-shaped object. */
function spawnOk(stdout = ""): ReturnType<typeof child_process.spawnSync> {
  return {
    pid: 1,
    output: [],
    stdout,
    stderr: "",
    status: 0,
    signal: null,
    error: undefined,
  };
}

function spawnFail(): ReturnType<typeof child_process.spawnSync> {
  return { ...spawnOk(), status: 1, stdout: "" };
}

/** Returns a minimal ChildProcess stub for spawn(). */
function makeChildStub(): ReturnType<typeof child_process.spawn> {
  return { unref: jest.fn() } as unknown as ReturnType<
    typeof child_process.spawn
  >;
}

// ── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  // resetAllMocks clears call history AND queued mockReturnValueOnce values,
  // preventing leaked state from one test polluting the next.
  jest.resetAllMocks();
  // Default: no file exists; spawn always succeeds.
  mockExistsSync.mockReturnValue(false);
  mockSpawn.mockReturnValue(makeChildStub());
});

// ── getSlackLockPath ─────────────────────────────────────────────────────────

describe("getSlackLockPath", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns a path under APPDATA on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    process.env.APPDATA = "C:\\Users\\test\\AppData\\Roaming";
    const p = getSlackLockPath();
    expect(p).toContain("Slack");
    expect(p).toContain("SingletonLock");
  });

  it("returns a path under ~/.config on Linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    const p = getSlackLockPath();
    expect(p).toBe(path.join(os.homedir(), ".config", "Slack", "SingletonLock"));
  });
});

// ── getSlackPids ─────────────────────────────────────────────────────────────

describe("getSlackPids", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns an empty array when no slack process is running (Linux)", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockSpawnSync.mockReturnValue(spawnFail());
    expect(getSlackPids()).toEqual([]);
  });

  it("returns pids from pgrep output (Linux)", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockSpawnSync.mockReturnValue(spawnOk("1234\n5678\n"));
    expect(getSlackPids()).toEqual([1234, 5678]);
  });

  it("returns pids from tasklist output (Windows)", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockExecSync.mockReturnValue(
      '"slack.exe","1234","Console","1","50,000 K"\n' as unknown as ReturnType<typeof child_process.execSync>
    );
    const pids = getSlackPids();
    expect(pids).toContain(1234);
  });

  it("returns an empty array on error", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockSpawnSync.mockImplementation(() => {
      throw new Error("pgrep not found");
    });
    expect(getSlackPids()).toEqual([]);
  });
});

// ── isSlackWindowVisible ──────────────────────────────────────────────────────

describe("isSlackWindowVisible", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns true when wmctrl lists a Slack window (Linux)", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockSpawnSync.mockReturnValue(
      spawnOk("0x05200005 -1 my-host Slack - General\n")
    );
    expect(isSlackWindowVisible()).toBe(true);
  });

  it("returns false when wmctrl output has no Slack entry (Linux)", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockSpawnSync.mockReturnValue(spawnOk("0x0200001 -1 my-host Firefox\n"));
    expect(isSlackWindowVisible()).toBe(false);
  });

  it("falls back to pid check when wmctrl is unavailable", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    // First call (wmctrl) throws; second call (pgrep) succeeds with a pid.
    mockSpawnSync
      .mockImplementationOnce(() => {
        throw new Error("wmctrl: command not found");
      })
      .mockReturnValueOnce(spawnOk("9999\n"));
    expect(isSlackWindowVisible()).toBe(true);
  });
});

// ── killSlack ────────────────────────────────────────────────────────────────

describe("killSlack", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("calls pkill on Linux", () => {
    Object.defineProperty(process, "platform", { value: "linux" });
    mockSpawnSync.mockReturnValue(spawnOk());
    killSlack();
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "pkill",
      ["-x", "slack"],
      expect.any(Object)
    );
  });

  it("calls taskkill on Windows", () => {
    Object.defineProperty(process, "platform", { value: "win32" });
    mockSpawnSync.mockReturnValue(spawnOk());
    killSlack();
    expect(mockSpawnSync).toHaveBeenCalledWith(
      "taskkill",
      ["/F", "/IM", "slack.exe"],
      expect.any(Object)
    );
  });
});

// ── clearStaleLockFile ────────────────────────────────────────────────────────

describe("clearStaleLockFile", () => {
  it("deletes the lock file when it exists", () => {
    mockExistsSync.mockReturnValue(true);
    clearStaleLockFile();
    expect(mockUnlinkSync).toHaveBeenCalledWith(getSlackLockPath());
  });

  it("does nothing when the lock file is absent", () => {
    mockExistsSync.mockReturnValue(false);
    clearStaleLockFile();
    expect(mockUnlinkSync).not.toHaveBeenCalled();
  });

  it("silently swallows errors from unlinkSync", () => {
    mockExistsSync.mockReturnValue(true);
    mockUnlinkSync.mockImplementation(() => {
      throw new Error("EPERM");
    });
    expect(() => clearStaleLockFile()).not.toThrow();
  });
});

// ── launchSlack ───────────────────────────────────────────────────────────────

describe("launchSlack", () => {
  const originalPlatform = process.platform;

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
  });

  it("returns 'failed' when the executable is not found", async () => {
    // existsSync always false → resolveSlackExecutable returns null
    // spawnSync for 'which' also fails
    mockSpawnSync.mockReturnValue(spawnFail());
    const result = await launchSlack();
    expect(result.success).toBe(false);
    expect(result.action).toBe("failed");
  });

  it("returns 'launched' when Slack is not running", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    // existsSync: /usr/bin/slack exists (resolveSlackExecutable finds it without
    // calling spawnSync, so only one spawnSync call is needed for pgrep)
    mockExistsSync.mockImplementation((p) => p === "/usr/bin/slack");

    // pgrep returns nothing → no Slack process
    mockSpawnSync.mockReturnValueOnce(spawnFail()); // pgrep (getSlackPids)

    const result = await launchSlack();

    expect(result.success).toBe(true);
    expect(result.action).toBe("launched");
    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/slack",
      [],
      expect.objectContaining({ detached: true })
    );
  });

  it("returns 'focused' when Slack is running with a visible window", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    // existsSync: executable and lock file both present
    mockExistsSync.mockImplementation((p) =>
      p === "/usr/bin/slack" || (p as string).includes("SingletonLock")
    );

    mockSpawnSync
      // getSlackPids → pgrep returns pid
      .mockReturnValueOnce(spawnOk("4321\n"))
      // isSlackWindowVisible → wmctrl lists Slack
      .mockReturnValueOnce(spawnOk("0x1 -1 host Slack - General\n"));

    const result = await launchSlack();

    expect(result.success).toBe(true);
    expect(result.action).toBe("focused");
    expect(mockSpawn).not.toHaveBeenCalled();
  });

  it("kills the stale process and restarts when Slack is in tray-closed state", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    // existsSync: executable present, lock file present
    mockExistsSync.mockImplementation((p) =>
      p === "/usr/bin/slack" || (p as string).includes("SingletonLock")
    );

    mockSpawnSync
      // getSlackPids → process running
      .mockReturnValueOnce(spawnOk("4321\n"))
      // isSlackWindowVisible → wmctrl shows NO Slack window (tray-closed)
      .mockReturnValueOnce(spawnOk("0x1 -1 host Firefox\n"))
      // killSlack → pkill
      .mockReturnValueOnce(spawnOk());

    const result = await launchSlack();

    expect(result.success).toBe(true);
    expect(result.action).toBe("restarted");

    // Lock file must have been cleared
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("SingletonLock")
    );

    // Fresh Slack process must have been spawned
    expect(mockSpawn).toHaveBeenCalledWith(
      "/usr/bin/slack",
      [],
      expect.objectContaining({ detached: true })
    );
  });

  it("clears a stale lock file before launching when Slack is not running", async () => {
    Object.defineProperty(process, "platform", { value: "linux" });

    // existsSync: executable exists, stale lock file exists
    mockExistsSync.mockImplementation((p) =>
      p === "/usr/bin/slack" || (p as string).includes("SingletonLock")
    );

    // pgrep returns no pids
    mockSpawnSync.mockReturnValue(spawnFail());

    const result = await launchSlack();

    expect(result.action).toBe("launched");
    expect(mockUnlinkSync).toHaveBeenCalledWith(
      expect.stringContaining("SingletonLock")
    );
  });
});
