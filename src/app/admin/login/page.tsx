// Admin HOFMI SSO login page — owner: Mia (task A3)
// Public (ungated) page that starts the HOFMI single-sign-on flow.
// Lives OUTSIDE the (dashboard) gated layout so it is reachable when signed out.
// Docs: docs/DESIGN.md → Admin Rules.
//
// ⚠️ Backend follow-up (Gian, not in scope for this frontend task):
//   1. Add the "hofmi-sso" OAuth provider to auth.ts (G4 marks it TODO).
//   2. Exclude "/admin/login" from the proxy.ts redirect so it is reachable
//      while signed out (proxy currently bounces all /admin/* to "/").
// Until both land, the button below renders correctly but the sign-in call
// will fail at runtime because the provider does not yet exist.

import { signIn } from "../../../../auth";
import { Button } from "@/components/ui/button";

async function startHofmiSso() {
  "use server";
  await signIn("hofmi-sso", { redirectTo: "/admin" });
}

export default function AdminLoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-surface p-6">
      <div className="w-full max-w-sm rounded-lg border border-border-subtle bg-elevated p-8 text-center">
        <h1 className="text-2xl font-semibold text-text-strong">FAVO Admin</h1>
        <p className="mt-2 text-sm text-text-muted">
          Sign in with your Heritage of Faith account to manage the café.
        </p>

        <form action={startHofmiSso} className="mt-6">
          <Button type="submit" size="lg" className="min-h-10 w-full">
            Sign in with HOFMI
          </Button>
        </form>

        <p className="mt-4 text-xs text-text-muted">
          Staff using the till should use the{" "}
          <a href="/pos" className="underline">
            POS PIN login
          </a>{" "}
          instead.
        </p>
      </div>
    </main>
  );
}
