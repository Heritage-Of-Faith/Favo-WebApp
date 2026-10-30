// Next.js runs register() once when a server instance starts (see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/instrumentation.md).
// It must finish before the server takes requests, so the scheduler is started
// without awaiting its startup catch-up.

export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startScheduler } = await import("@/server/jobs/start");
  startScheduler();
}
