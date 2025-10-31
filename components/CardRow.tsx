"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export default function CardRow({ id, question, answer }: { id: string; question: string; answer: string }) {
  const [editing, setEditing] = useState(false);
  const [q, setQ] = useState(question);
  const [a, setA] = useState(answer);
  const [busy, setBusy] = useState(false);
  const router = useRouter();

  async function save() {
    if (busy) return;
    setBusy(true);
    const t = toast.loading("Saving…");
    try {
      const res = await fetch(`/api/card/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, answer: a }),
      });
      if (!res.ok) throw new Error("Save failed");
      toast.success("Saved");
      setEditing(false);
      router.refresh();
    } catch (e: any) {
      toast.error(e?.message || "Save failed");
    } finally {
      toast.dismiss(t);
      setBusy(false);
    }
  }

  async function del() {
    if (busy) return;
    toast("Delete this card?", {
      action: {
        label: "Delete",
        onClick: async () => {
          setBusy(true);
          const t = toast.loading("Deleting…");
          try {
            const res = await fetch(`/api/card/${id}`, { method: "DELETE" });
            if (!res.ok) throw new Error("Delete failed");
            toast.success("Card deleted");
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

  if (!editing) {
    return (
      <div className="p-4 flex items-start gap-3">
        <div className="flex-1">
          <p className="font-medium whitespace-pre-wrap">{q}</p>
          <p className="text-sm text-gray-700 mt-1 whitespace-pre-wrap">{a}</p>
        </div>
        <div className="flex gap-2">
          <button className="text-sm px-2 py-1 rounded border" onClick={() => setEditing(true)}>Edit</button>
          <button className="text-sm px-2 py-1 rounded bg-red-600 text-white" onClick={del} disabled={busy}>
            Delete
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 space-y-2 rounded border">
      <input
        value={q} onChange={(e) => setQ(e.target.value)}
        className="w-full border rounded p-2" maxLength={500}
      />
      <textarea
        value={a} onChange={(e) => setA(e.target.value)}
        className="w-full border rounded p-2 h-28" maxLength={2000}
      />
      <div className="flex gap-2">
        <button className="text-sm px-3 py-1.5 rounded bg-black text-white disabled:opacity-60" onClick={save} disabled={busy}>
          Save
        </button>
        <button className="text-sm px-3 py-1.5 rounded border" onClick={() => setEditing(false)} disabled={busy}>
          Cancel
        </button>
      </div>
    </div>
  );
}
