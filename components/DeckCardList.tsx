"use client";
import { useMemo, useState } from "react";
import CardRow from "@/components/CardRow";

type CardLite = { id: string; question: string; answer: string };

export default function DeckCardList({ cards }: { cards: CardLite[] }) {
  const [q, setQ] = useState("");
  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return cards;
    return cards.filter(c => c.question.toLowerCase().includes(s) || c.answer.toLowerCase().includes(s));
  }, [q, cards]);

  return (
    <div className="space-y-3">
      <input
        placeholder="Search cards…"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        className="w-full border rounded p-2"
      />
      <div className="divide-y rounded border">
        {filtered.length === 0 ? (
          <div className="p-6 text-sm text-gray-500">No matching cards.</div>
        ) : (
          filtered.map((c) => <CardRow key={c.id} id={c.id} question={c.question} answer={c.answer} />)
        )}
      </div>
    </div>
  );
}
