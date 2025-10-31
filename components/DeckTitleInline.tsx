"use client";
import { useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

export default function DeckTitleInline({ deckId, initial }: { deckId: string; initial: string }) {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(initial);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save() {
    if (!title.trim() || busy) return;
    setBusy(true);
    const t = toast.loading("Renaming…");
    try {
      const res = await fetch(`/api/deck/${deckId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title }),
      });
      if (!res.ok) throw new Error("Rename failed");
      toast.success("Renamed");
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Rename failed");
    } finally {
      toast.dismiss(t);
      setBusy(false);
    }
  }

  if (!editing) {
    return (
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-semibold truncate">{title}</h1>
        <button className="text-sm px-2 py-1 rounded border hover:bg-gray-50" onClick={() => setEditing(true)}>
          Rename
        </button>
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        className="border rounded px-2 py-1"
        maxLength={120}
        autoFocus
      />
      <button className="text-sm px-2 py-1 rounded bg-black text-white disabled:opacity-60" onClick={save} disabled={busy}>
        Save
      </button>
      <button className="text-sm px-2 py-1 rounded border" onClick={() => { setTitle(initial); setEditing(false); }}>
        Cancel
      </button>
    </div>
  );
}
