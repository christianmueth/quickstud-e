"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

type DeleteStudyNoteButtonProps = {
  noteId?: string;
  removeAll?: boolean;
};

export default function DeleteStudyNoteButton({ noteId, removeAll = false }: DeleteStudyNoteButtonProps) {
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const label = removeAll ? "Remove all notes" : "Remove note";

  function confirmRemoval() {
    if (busy) return;

    toast(removeAll ? "Remove all study notes?" : "Remove this study note?", {
      description: "This cannot be undone.",
      action: {
        label: "Remove",
        onClick: async () => {
          setBusy(true);
          try {
            const endpoint = removeAll ? "/api/study-notes/delete-all" : `/api/study-notes/${noteId}`;
            const response = await fetch(endpoint, { method: "DELETE" });
            if (!response.ok) throw new Error("We couldn't remove the study note.");
            toast.success(removeAll ? "Study notes removed" : "Study note removed");
            if (!removeAll) router.push("/app?tab=flashcards&library=notes");
            router.refresh();
          } catch (error: unknown) {
            toast.error(error instanceof Error ? error.message : "We couldn't remove the study note.");
          } finally {
            setBusy(false);
          }
        },
      },
      cancel: { label: "Cancel" },
      duration: 8000,
    });
  }

  return (
    <button
      type="button"
      onClick={confirmRemoval}
      disabled={busy}
      className="rounded border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 hover:bg-red-50 disabled:opacity-60"
    >
      {busy ? "Removing..." : label}
    </button>
  );
}