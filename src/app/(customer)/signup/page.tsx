// Customer sign-up — owner: Nikao (task N6)
// Email magic-link account creation (frontend). Backend send wired by Gian (Phase 3).

import AuthForm from "@/components/customer/AuthForm";

export const metadata = {
  title: "Create your account · FAVO Café",
  description: "Join FAVO — earn rewards on every cup.",
};

export default function SignUpPage() {
  return (
    <main className="flex min-h-[100dvh] items-center justify-center bg-dark-teal px-[var(--spacing-m)] py-[var(--spacing-xl)]">
      <AuthForm mode="signup" />
    </main>
  );
}
