"use client";

// HOFMI SSO sign-in button — owner: Nikao (task A3 — AT-19)
// Uses loginWithHofmiSso server action as the form action so it works
// without client-side JavaScript (progressive enhancement).

import { useFormStatus } from "react-dom";
import { loginWithHofmiSso } from "@/server/actions/auth";

export type Props = Record<string, never>;

function SubmitButton() {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: "10px",
        width: "100%",
        maxWidth: "320px",
        height: "48px",
        borderRadius: "var(--radius-btn)",
        border: "2px solid var(--color-coffee-bean)",
        background: "var(--color-paper)",
        color: "var(--color-coffee-bean)",
        fontFamily: "var(--font-sans)",
        fontWeight: 600,
        fontSize: "var(--text-base)",
        cursor: pending ? "not-allowed" : "pointer",
        opacity: pending ? 0.6 : 1,
        transition: "opacity 0.15s",
      }}
    >
      {pending ? (
        "Redirecting…"
      ) : (
        <>
          <HofmiLogoMark />
          Sign in with HOFMI
        </>
      )}
    </button>
  );
}

function HofmiLogoMark() {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 20 20"
      fill="none"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <circle cx="10" cy="10" r="9" stroke="var(--color-coffee-bean)" strokeWidth="2" />
      <path
        d="M6 10h8M10 6v8"
        stroke="var(--color-coffee-bean)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export default function SsoSignInButton(_props: Props) {
  return (
    <form action={loginWithHofmiSso} style={{ width: "100%" }}>
      <SubmitButton />
    </form>
  );
}
