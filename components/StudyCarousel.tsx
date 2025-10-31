"use client";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { useRouter } from "next/navigation";

type StudyCard = { id: string; question: string; answer: string };

async function safeJson(res: Response) {
  try { const text = await res.text(); return text ? JSON.parse(text) : null; } catch { return null; }
}

export default function StudyCarousel({ deckId }: { deckId: string }) {
  const [queue, setQueue] = useState<StudyCard[]>([]);
  const [idx, setIdx] = useState(0);
  const [showBack, setShowBack] = useState(false);
  const [loading, setLoading] = useState(true);
  const [xpToday, setXpToday] = useState(0);
  const [goal, setGoal] = useState(50);
  const [celebrated, setCelebrated] = useState(false);
  const router = useRouter();

  async function loadQueue() {
    setLoading(true);
    try {
      const [qRes, meRes] = await Promise.all([
        fetch(`/api/deck/${deckId}/study`, { cache: "no-store" }),
        fetch(`/api/me`, { cache: "no-store" }),
      ]);
      const qJson = qRes.ok ? await safeJson(qRes) : null;
      const meJson = meRes.ok ? await safeJson(meRes) : null;

      setQueue(Array.isArray(qJson?.cards) ? qJson.cards : []);
      setIdx(0); setShowBack(false); setCelebrated(false);
      setXpToday(Number(meJson?.xpToday ?? 0));
      setGoal(Number(meJson?.dailyGoal ?? 50));

      if (!qRes.ok) toast.error("Failed to load study queue");
      if (!meRes.ok) toast.error("Failed to load user stats");
    } catch (e: any) {
      toast.error(e?.message || "Network error"); setQueue([]);
    } finally { setLoading(false); }
  }

  useEffect(() => { loadQueue(); /* eslint-disable-next-line */ }, [deckId]);

  const current = queue[idx] || null;
  const progress = useMemo(() => (queue.length ? Math.round(((idx + (current ? 0 : 1)) / queue.length) * 100) : 0), [idx, queue.length, current]);
  function onFlip() { if (current) setShowBack((s) => !s); }

  async function mark(rating: "again" | "good" | "easy") {
    if (!current) return;
    const gain = rating === "easy" ? 5 : rating === "good" ? 3 : 1;
    try {
      await fetch(`/api/review`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ cardId: current.id, rating }) });

      const next = [...queue]; next.splice(idx, 1); if (rating === "again") next.push(current);
      setQueue(next); setShowBack(false); if (idx >= next.length) setIdx(Math.max(0, next.length - 1));

      toast.success(rating === "easy" ? "Perfect! +5 XP" : rating === "good" ? "Nice! +3 XP" : "Keep going! +1 XP");

      const newXP = xpToday + gain; setXpToday(newXP);
      if (!celebrated && goal && newXP >= goal) {
        setCelebrated(true);
        try {
          const confetti = (await import("canvas-confetti")).default;
          confetti({ particleCount: 120, spread: 70, origin: { y: 0.6 } });
        } catch { /* confetti optional */ }
        toast.success("Daily goal reached! 🎉");
      }

      if (next.length === 0) { toast.success("Session complete 🎉"); router.refresh(); }
    } catch (e: any) { toast.error(e?.message || "Could not submit review"); }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (!current) return;
      if (e.key === " " || e.code === "Space") { e.preventDefault(); onFlip(); }
      if (e.key === "1") mark("again");
      if (e.key === "2") mark("good");
      if (e.key === "3") mark("easy");
      if (e.key === "ArrowRight") setIdx((i) => Math.min(i + 1, Math.max(queue.length - 1, 0)));
      if (e.key === "ArrowLeft") setIdx((i) => Math.max(i - 1, 0));
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, queue.length, xpToday, goal, celebrated]);

  if (loading) return <div className="rounded border p-6 text-sm text-gray-500">Loading study set…</div>;
  if (!queue.length)
    return (
      <div className="rounded border p-6 text-sm text-gray-500 flex items-center justify-between">
        <span>No due cards right now.</span>
        <button className="text-sm px-3 py-1.5 rounded border" onClick={loadQueue}>Refresh</button>
      </div>
    );

  const pctDaily = Math.max(0, Math.min(100, Math.round((xpToday / (goal || 50)) * 100)));
  const card = current!;

  return (
    <div className="space-y-4">
      <div>
        <div className="text-xs text-gray-600 mb-1">Daily goal: {xpToday}/{goal} XP</div>
        <div className="h-2 w-full bg-gray-200 rounded">
          <div className="h-2 bg-black rounded" style={{ width: `${pctDaily}%` }} />
        </div>
      </div>

      <div className="h-2 w-full bg-gray-200 rounded">
        <div className="h-2 bg-gray-800/60 rounded" style={{ width: `${progress}%` }} />
      </div>

      <div className="rounded-2xl border p-6 min-h-[220px] flex flex-col justify-between">
        <div className="text-xs text-gray-500">
          Card {idx + 1} / {queue.length} • Press <kbd>Space</kbd> to flip, <kbd>1</kbd>/<kbd>2</kbd>/<kbd>3</kbd> to grade
        </div>
        <div className="text-lg whitespace-pre-wrap my-6">{showBack ? card.answer : card.question}</div>
        <div className="flex items-center gap-2">
          <button className="px-3 py-1.5 rounded border" onClick={() => setIdx((i) => Math.max(0, i - 1))} disabled={idx === 0}>◀ Prev</button>
          <button className="flex-1 px-3 py-1.5 rounded bg-black text-white" onClick={onFlip}>{showBack ? "Hide answer" : "Show answer"}</button>
          <button className="px-3 py-1.5 rounded border" onClick={() => setIdx((i) => Math.min(queue.length - 1, i + 1))} disabled={idx >= queue.length - 1}>Next ▶</button>
        </div>
      </div>

      {showBack && (
        <div className="flex items-center gap-3">
          <button className="px-3 py-1.5 rounded bg-red-600 text-white" onClick={() => mark("again")}>1 · Again</button>
          <button className="px-3 py-1.5 rounded bg-yellow-500 text-white" onClick={() => mark("good")}>2 · Good</button>
          <button className="px-3 py-1.5 rounded bg-green-600 text-white" onClick={() => mark("easy")}>3 · Easy</button>
        </div>
      )}
    </div>
  );
}
