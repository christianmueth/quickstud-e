"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Card = { id: string; question: string; answer: string; dueAt: string };

export default function StudyMode({ cards }: { cards: Card[] }) {
  const router = useRouter();
  const today = useMemo(() => new Date(), []);
  const due = cards.filter(c => new Date(c.dueAt) <= today);
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const deck = due.length ? due : cards; // show due; fall back to all if none due
  if (!deck.length) return <p className="text-gray-500">No cards to study.</p>;
  const c = deck[idx];

  async function grade(g: number) {
    await fetch("/api/review", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: c.id, grade: g }) });
    setFlipped(false);
    const next = (idx + 1) % deck.length;
    setIdx(next);
    router.refresh(); // refresh due lists
  }

  return (
    <div className="space-y-4">
      <div className="text-sm text-gray-600">Studying {due.length ? "due" : "all"} cards — {idx + 1}/{deck.length}</div>
      <div className="relative h-56 [perspective:1000px]">
        <div
          onClick={() => setFlipped(f => !f)}
          className={`absolute inset-0 cursor-pointer rounded-2xl border p-6 shadow-sm bg-white transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
        >
          <div className="absolute inset-0 flex items-center justify-center text-center text-lg font-medium [backface-visibility:hidden]">
            {c.question}
          </div>
          <div className="absolute inset-0 flex items-center justify-center text-center text-base text-gray-800 [transform:rotateY(180deg)] [backface-visibility:hidden]">
            {c.answer}
          </div>
        </div>
      </div>
      <div className="flex gap-2 justify-center">
        <button className="px-3 py-1.5 rounded border" onClick={() => grade(0)}>Again</button>
        <button className="px-3 py-1.5 rounded border" onClick={() => grade(1)}>Hard</button>
        <button className="px-3 py-1.5 rounded border" onClick={() => grade(2)}>Good</button>
        <button className="px-3 py-1.5 rounded border" onClick={() => grade(3)}>Easy</button>
      </div>
    </div>
  );
}
