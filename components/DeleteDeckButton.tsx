"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function DeleteDeckButton({ deckId }: { deckId: string }) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  function onAskDelete() {
    if (busy) return;
    toast("Delete this deck?", {
      description: "This removes the deck and all its cards.",
      action: {
        label: "Delete",
        onClick: async () => {
          setBusy(true);
          const t = toast.loading("Deleting…");
          try {
            const res = await fetch(`/api/deck/${deckId}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Delete failed");
            toast.success("Deck deleted");
            router.push("/app");
            router.refresh();
          } catch (e: any) {
            toast.error(e?.message || "Delete failed");
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
      {busy ? "Deleting…" : "Delete Deck"}
    </button>
  );
}
