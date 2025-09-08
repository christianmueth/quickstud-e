"use client";
import { useRouter } from "next/navigation";
export default function DeleteDeckButton({ deckId }: { deckId: string }) {
  const router = useRouter();
  async function onDelete() {
    if (!confirm("Delete this deck? This cannot be undone.")) return;
    const r = await fetch(`/api/deck/${deckId}`, { method: "DELETE" });
    if (r.ok) router.push("/app");
    else alert("Delete failed");
  }
  return <button onClick={onDelete} className="px-3 py-1.5 rounded border text-red-600">Delete deck</button>;
}
