"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function DeleteDeckButton({ deckId }: { deckId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function onAskDelete() {
    if (busy) return;
    toast("Remove this learning space?", {
      description: "This removes the study set and everything inside it.",
      action: {
        label: "Remove",
        onClick: async () => {
          setBusy(true);
          const t = toast.loading("Removing learning space...");
          try {
            const res = await fetch(`/api/deck/${deckId}`, { method: "DELETE" });
            if (!res.ok) throw new Error("We couldn't remove this learning space.");
            toast.success("Learning space removed");
            router.push("/app");
            router.refresh();
          } catch (e: any) {
            toast.error(e?.message || "We couldn't remove this learning space.");
            setBusy(false);
          } finally {
            toast.dismiss(t);
          }
        },
      },
      cancel: { label: "Cancel" },
      duration: 8000,
    });
  }

  return (
    <button
      onClick={onAskDelete}
      disabled={busy}
      className="px-3 py-1.5 rounded bg-red-600 text-white disabled:opacity-60"
    >
      {busy ? "Removing..." : "Remove set"}
    </button>
  );
}
