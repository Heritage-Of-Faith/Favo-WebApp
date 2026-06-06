// Customer sign-in — owner: Nikao (task N6)
// Email magic-link sign-in (frontend). Replaces the old static placeholder.
// Backend magic-link send wired by Gian (Phase 3). Tailwind/tokens only.

import AuthForm from "@/components/customer/AuthForm";

export const metadata = {
  title: "Sign in · FAVO Café",
  description: "Sign in to your FAVO loyalty account with a secure email link.",
};

export default function CustomerLoginPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-dark-teal px-[var(--spacing-m)] py-[var(--spacing-xl)]">
      <AuthForm mode="signin" />
    </main>
  );
}
