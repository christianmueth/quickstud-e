import { notFound } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

import DeleteDeckButton from "@/components/DeleteDeckButton";
import DeckTitleInline from "@/components/DeckTitleInline";
import AddCardForm from "@/components/AddCardForm";
import StudyCarousel from "@/components/StudyCarousel";
import ExportButtons from "@/components/ExportButtons";
import RegenerateDeckButton from "@/components/RegenerateDeckButton";
import DeckCardList from "@/components/DeckCardList";

export const dynamic = "force-dynamic";

export default async function DeckPage({ params }: { params: Promise<{ id: string }> }) {
  const { userId } = await auth();
  if (!userId) return notFound();

  const { id } = await params; // Next 15: await params

  const deck = await prisma.deck.findFirst({
    where: { id, user: { clerkUserId: userId } },
    include: { cards: { orderBy: { createdAt: "asc" }, select: { id: true, question: true, answer: true } } },
  });
  if (!deck) return notFound();

  return (
    <div className="max-w-3xl mx-auto p-6 space-y-8">
      <div className="flex items-center justify-between gap-3">
        <DeckTitleInline deckId={deck.id} initial={deck.title} />
        <div className="flex items-center gap-2">
          <ExportButtons deckId={deck.id} />
          <RegenerateDeckButton deckId={deck.id} />
          <DeleteDeckButton deckId={deck.id} />
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Study</h2>
        <StudyCarousel deckId={deck.id} />
      </section>

      <section className="space-y-3">
        <h2 className="text-lg font-semibold">Manage cards</h2>
        <AddCardForm deckId={deck.id} />
        <DeckCardList cards={deck.cards} />
      </section>
    </div>
  );
}
