"use client";

import { useEffect, useMemo, useState } from "react";

type Card = { id: string; question: string; answer: string };

export default function FlashcardViewer({ cards }: { cards: Card[] }) {
  const [idx, setIdx] = useState(0);
  const [flipped, setFlipped] = useState(false);

  // optional: shuffle once per mount
  const deck = useMemo(() => [...cards], [cards]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === " ") { e.preventDefault(); setFlipped(f => !f); }
      if (e.key === "ArrowRight") next();
      if (e.key === "ArrowLeft") prev();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  function next() { setIdx(i => (i + 1) % deck.length); setFlipped(false); }
  function prev() { setIdx(i => (i - 1 + deck.length) % deck.length); setFlipped(false); }

  if (!deck.length) return <p className="text-gray-500">No cards yet.</p>;

  const c = deck[idx];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="text-sm text-gray-600">Card {idx + 1} / {deck.length}</div>
        <div className="space-x-2">
          <button onClick={prev} className="px-3 py-1.5 rounded border">Prev</button>
          <button onClick={() => setFlipped(f => !f)} className="px-3 py-1.5 rounded border">Flip (Space)</button>
          <button onClick={next} className="px-3 py-1.5 rounded border">Next</button>
        </div>
      </div>

      {/* Flip card */}
      <div className="relative h-56 [perspective:1000px]">
        <div
          onClick={() => setFlipped(f => !f)}
          className={`absolute inset-0 cursor-pointer rounded-2xl border p-6 shadow-sm bg-white transition-transform duration-500 [transform-style:preserve-3d] ${flipped ? "[transform:rotateY(180deg)]" : ""}`}
        >
          {/* Front */}
          <div className="absolute inset-0 flex items-center justify-center text-center text-lg font-medium [backface-visibility:hidden]">
            {c.question}
          </div>
          {/* Back */}
          <div className="absolute inset-0 flex items-center justify-center text-center text-base text-gray-800 [transform:rotateY(180deg)] [backface-visibility:hidden]">
            {c.answer}
          </div>
        </div>
      </div>
    </div>
  );
}
