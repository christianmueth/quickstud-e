"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

export default function EditCardModal({ card }: { card: { id: string; question: string; answer: string } }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState(card.question);
  const [a, setA] = useState(card.answer);
  const [saving, setSaving] = useState(false);
  const router = useRouter();

  async function save() {
    setSaving(true);
    const r = await fetch(`/api/card/${card.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question: q, answer: a }),
    });
    setSaving(false);
    if (r.ok) { setOpen(false); router.refresh(); } else alert("Save failed");
  }

  return (
    <>
      <button className="text-sm underline" onClick={() => setOpen(true)}>Edit</button>
      {open && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-xl w-full max-w-lg p-4 space-y-3">
            <h3 className="font-semibold">Edit Card</h3>
            <input className="w-full border rounded p-2" value={q} onChange={e=>setQ(e.target.value)} />
            <textarea className="w-full border rounded p-2 h-32" value={a} onChange={e=>setA(e.target.value)} />
            <div className="flex gap-2 justify-end">
              <button className="px-3 py-1.5" onClick={() => setOpen(false)}>Cancel</button>
              <button className="px-3 py-1.5 rounded bg-black text-white disabled:opacity-60" disabled={saving} onClick={save}>
                {saving ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
