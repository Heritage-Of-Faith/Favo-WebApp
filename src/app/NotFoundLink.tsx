"use client";

// Back link for the global 404. Inside the POS it must stay in the POS
// (the queue), never hand a barista to the customer site.

import Link from "next/link";
import type { Route } from "next";
import { usePathname } from "next/navigation";

export function notFoundTarget(pathname: string | null): { href: string; label: string } {
  const inPos = pathname === "/pos" || (pathname ?? "").startsWith("/pos/");
  return inPos
    ? { href: "/pos/queue", label: "← Back to the queue" }
    : { href: "/", label: "← Back to FAVO" };
}

export default function NotFoundLink() {
  const { href, label } = notFoundTarget(usePathname());
  return (
    <Link
      href={href as Route}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 8,
        backgroundColor: "var(--color-crimson-carrot)",
        color: "var(--color-paper)",
        fontFamily: "var(--font-sans)",
        fontWeight: 700,
        fontSize: 12,
        letterSpacing: "0.12em",
        textTransform: "uppercase",
        textDecoration: "none",
        padding: "14px 28px",
        borderRadius: 2,
      }}
    >
      {label}
    </Link>
  );
}
