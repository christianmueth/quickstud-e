import { prisma } from "@/lib/db";
import Link from "next/link";
import FlashcardViewer from "@/components/FlashcardViewer";
import StudyMode from "@/components/StudyMode";
import DeleteDeckButton from "@/components/DeleteDeckButton";
import EditCardModal from "@/components/EditCardModal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function DeckPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const deck = await prisma.deck.findUnique({
    where: { id },
    include: {
      cards: {
        orderBy: { createdAt: "asc" },
        select: { id: true, question: true, answer: true, dueAt: true },
      },
    },
  });

  if (!deck) {
    return (
      <main className="mx-auto max-w-3xl p-6 space-y-4">
        <h2 className="text-2xl font-semibold">Deck not found</h2>
        <p className="text-gray-600">
          ID: <code className="px-1.5 py-0.5 bg-gray-100 rounded">{id}</code>
        </p>
        <Link href="/app" className="underline">
          ← Back to decks
        </Link>
      </main>
    );
  }

  // Prepare typed props for client components (Dates → ISO strings)
  const browseCards = deck.cards.map((c) => ({
    id: c.id,
    question: c.question,
    answer: c.answer,
  }));
  const studyCards = deck.cards.map((c) => ({
    id: c.id,
    question: c.question,
    answer: c.answer,
    dueAt: c.dueAt.toISOString(),
  }));

  return (
    <main className="mx-auto max-w-3xl p-6 space-y-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">{deck.title}</h2>
          <p className="text-sm text-gray-500">Cards: {deck.cards.length}</p>
        </div>
        <div className="flex items-center gap-2">
          <a className="px-3 py-1.5 rounded border" href={`/api/deck/${deck.id}/export?fmt=xlsx`}>
            Export Excel
          </a>
          <a className="px-3 py-1.5 rounded border" href={`/api/deck/${deck.id}/export?fmt=csv`}>
            Export CSV
          </a>
          <a className="px-3 py-1.5 rounded border" href={`/api/deck/${deck.id}/export?fmt=anki`}>
            Export Anki
          </a>
          <DeleteDeckButton deckId={deck.id} />
        </div>
      </div>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Study</h3>
        <StudyMode cards={studyCards} />
      </section>

      <section className="space-y-2">
        <h3 className="text-lg font-medium">Browse</h3>
        <FlashcardViewer cards={browseCards} />
      </section>

      <section className="space-y-3">
        <h3 className="text-lg font-medium">All cards</h3>
        {deck.cards.map((c) => (
          <div key={c.id} className="border rounded p-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                <p className="font-medium">Q: {c.question}</p>
                <p className="text-gray-700">A: {c.answer}</p>
              </div>
              <EditCardModal card={{ id: c.id, question: c.question, answer: c.answer }} />
            </div>
          </div>
        ))}
      </section>

      <div>
        <Link href="/app" className="underline">
          ← Back to decks
        </Link>
      </div>
    </main>
  );
}
