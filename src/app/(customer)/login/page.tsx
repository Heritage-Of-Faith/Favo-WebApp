// Customer sign-in — owner: Nikao (task N6)
// Email + password sign-in (PR #67). Magic-link auth dropped by team decision.

import AuthForm from "@/components/customer/AuthForm";

export const metadata = {
  title: "Sign in · FAVO Café",
  description: "Sign in to your FAVO loyalty account.",
};

export default function CustomerLoginPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-dark-teal px-[var(--spacing-m)] py-[var(--spacing-xl)]">
      <AuthForm mode="signin" />
    </main>
  );
}
