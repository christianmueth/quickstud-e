import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export default async function DeckCarousel() {
  const { userId } = await auth();
  if (!userId) return null;

  const decks = await prisma.deck.findMany({
    where: { user: { clerkUserId: userId } },
    orderBy: { updatedAt: "desc" },
    take: 12,
    select: { id: true, title: true, _count: { select: { cards: true } } },
  });
  if (decks.length === 0) return null;

  return (
    <div className="space-y-3">
      <h2 className="text-xl font-semibold">Recent decks</h2>
      <div className="overflow-x-auto">
        <div className="flex gap-4 pr-2 snap-x">
          {decks.map((d) => (
            <Link
              key={d.id}
              href={`/app/deck/${d.id}`}
              className="min-w-[220px] snap-start rounded border p-4 hover:bg-gray-50"
            >
              <div className="font-medium truncate">{d.title}</div>
              <div className="text-xs text-gray-500 mt-1">{d._count.cards} card{d._count.cards === 1 ? "" : "s"}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
