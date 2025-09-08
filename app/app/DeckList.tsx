// app/app/DeckList.tsx
import { prisma } from "@/lib/db";
import Link from "next/link";
import { auth } from "@clerk/nextjs/server"; // <-- server import

export const dynamic = "force-dynamic";

export default async function DeckList() {
  const { userId } = await auth(); // <-- await it
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: {
      id: true,
      decks: {
        orderBy: { createdAt: "desc" },
        select: { id: true, title: true, _count: { select: { cards: true } } },
      },
    },
  });
  if (!user) return null;

  if (user.decks.length === 0) {
    return <p className="text-gray-600">No decks yet — create your first one above.</p>;
  }

  return (
    <ul className="space-y-2">
      {user.decks.map((d) => (
        <li key={d.id} className="border rounded p-3 flex items-center justify-between">
          <Link href={`/app/deck/${d.id}`} className="font-medium underline">
            {d.title}
          </Link>
          <span className="text-sm text-gray-600">{d._count.cards} cards</span>
        </li>
      ))}
    </ul>
  );
}
