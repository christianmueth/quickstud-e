import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import Link from "next/link";

export default async function DeckList() {
  const { userId } = auth();
  if (!userId) return null;

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    include: { decks: { orderBy: { createdAt: "desc" }, take: 10 } },
  });

  if (!user || user.decks.length === 0) {
    return <p className="text-gray-600">No decks yet.</p>;
  }

  return (
    <div className="space-y-2">
      <h3 className="text-xl font-medium">Recent Decks</h3>
      <ul className="list-disc pl-6">
        {user.decks.map((d) => (
          <li key={d.id}>
            <Link className="underline" href={`/app/deck/${d.id}`}>{d.title}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
