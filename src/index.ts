import { setupWorkspace } from "./workspace-setup";

async function main(): Promise<void> {
  const result = await setupWorkspace({
    dockerTimeoutMs: 15_000,
    dockerRetries: 3,
    onProgress: (msg) => console.log(`[cowork] ${msg}`),
  });

  if (!result.success && result.error) {
    console.error(`\nSetup failed: ${result.error.message}\n`);
    console.error("How to fix:\n");
    console.error(result.error.remediation);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error("Unexpected error:", err);
  process.exit(1);
});
