"use client";

/**
 * WasteStandalone — task M8.
 * Wrapper around WasteDialog for the standalone /pos/waste route. Keeps the
 * dialog open; navigating back returns to the workspace.
 */

import { useRouter } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import WasteDialog from "@/components/pos/WasteDialog";

export default function WasteStandalone() {
  const router = useRouter();
  const back = () => router.push("/pos/queue");

  return (
    <main className="min-h-screen bg-dark-teal">
      <div className="flex items-center gap-3 border-b border-cool-steel/20 px-4 py-3">
        <button
          type="button"
          onClick={back}
          aria-label="Back to POS"
          className="flex h-9 w-9 items-center justify-center rounded-[4px] text-cool-steel hover:bg-porcelain/10 hover:text-porcelain"
        >
          <ArrowLeft size={18} strokeWidth={2} />
        </button>
        <span className="favo-h3 text-porcelain">Report Waste</span>
      </div>
      <WasteDialog onClose={back} onLogged={back} />
    </main>
  );
}
