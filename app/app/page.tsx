import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import CreateForm from "@/components/CreateForm";
import DeckCarousel from "@/components/DeckCarousel";
import DeleteAllDecksButton from "@/components/DeleteAllDecksButton";

export default async function AppPage() {
  let userId: string | null = null;
  
  try {
    const authResult = await auth();
    userId = authResult.userId;
  } catch (error) {
    console.error("[App] Auth error:", error);
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="border border-red-300 bg-red-50 p-4 rounded">
          <h2 className="font-semibold text-red-900">Authentication Error</h2>
          <p className="text-sm text-red-700 mt-2">
            Unable to authenticate. Please check that Clerk environment variables are configured.
          </p>
        </div>
      </div>
    );
  }
  
  if (!userId) redirect("/sign-in");

  try {
    await prisma.user.upsert({ 
      where: { clerkUserId: userId }, 
      update: {}, 
      create: { clerkUserId: userId } 
    });
  } catch (error) {
    console.error("[App] Database error creating user:", error);
    return (
      <div className="max-w-2xl mx-auto p-6">
        <div className="border border-red-300 bg-red-50 p-4 rounded">
          <h2 className="font-semibold text-red-900">Database Connection Error</h2>
          <p className="text-sm text-red-700 mt-2">
            Unable to connect to database. Please check that POSTGRES_PRISMA_URL is configured.
          </p>
        </div>
      </div>
    );
  }

  let decks = [];
  try {
    decks = await prisma.deck.findMany({
      where: { user: { clerkUserId: userId } },
      orderBy: { createdAt: "desc" },
      select: { id: true, title: true, createdAt: true, _count: { select: { cards: true } } },
    });
  } catch (error) {
    console.error("[App] Error fetching decks:", error);
  }

  return (
    <div className="max-w-6xl mx-auto p-6 space-y-8">
      <DeckCarousel />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
        <section className="space-y-4">
          <h2 className="text-xl font-semibold">Create flashcards</h2>
          <p className="text-sm text-gray-600">Paste text, upload PDF/PPTX/video, or paste a URL.</p>
          <div className="rounded border p-4">
            <CreateForm />
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Your decks</h2>
            {decks.length > 0 && (
              <div>
                <DeleteAllDecksButton />
              </div>
            )}
          </div>
          {decks.length === 0 ? (
            <div className="rounded border p-6 text-sm text-gray-500">No decks yet. Create one on the left!</div>
          ) : (
            <ul className="divide-y rounded border">
              {decks.map((d) => (
                <li key={d.id} className="p-4 flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/app/deck/${d.id}`} className="font-medium hover:underline truncate block">
                      {d.title}
                    </Link>
                    <p className="text-xs text-gray-500">
                      {new Date(d.createdAt).toLocaleString()} • {d._count.cards} card{d._count.cards === 1 ? "" : "s"}
                    </p>
                  </div>
                  <Link href={`/app/deck/${d.id}`} className="text-sm px-3 py-1.5 rounded border hover:bg-gray-50 whitespace-nowrap">
                    Open
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}
