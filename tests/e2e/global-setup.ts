import { request } from "@playwright/test";

/** Pre-warm Turbopack routes before tests run to avoid cold-start timeouts. */
async function globalSetup() {
  const ctx = await request.newContext({ baseURL: "http://localhost:3000" });
  const routes = ["/", "/pos", "/customer", "/admin/login", "/api/healthz"];
  await Promise.allSettled(
    routes.map(r => ctx.get(r, { timeout: 30_000 }).catch(() => {}))
  );
  await ctx.dispose();
}

export default globalSetup;
