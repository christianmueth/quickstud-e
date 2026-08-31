import Link from "next/link";
import { redirect } from "next/navigation";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import DeleteStudyNoteButton from "@/components/DeleteStudyNoteButton";

// Simple markdown to HTML converter for basic formatting
function markdownToHtml(markdown: string): string {
  let html = markdown
    // Headers
    .replace(/^### (.*$)/gim, '<h3 class="text-xl font-semibold mt-4 mb-2">$1</h3>')
    .replace(/^## (.*$)/gim, '<h2 class="text-2xl font-bold mt-6 mb-3">$1</h2>')
    .replace(/^# (.*$)/gim, '<h1 class="text-3xl font-bold mt-8 mb-4">$1</h1>')
    // Bold
    .replace(/\*\*(.*?)\*\*/g, '<strong class="font-semibold text-gray-900">$1</strong>')
    // Bullet lists
    .replace(/^\s*[-*]\s+(.*)$/gim, '<li>$1</li>')
    // Paragraphs
    .replace(/\n\n/g, '</p><p class="my-3">');
  
  // Wrap consecutive <li> in <ul>
  html = html.replace(/(<li>.*<\/li>(\s|\n)*)+/g, (match) => `<ul class="list-disc pl-6 space-y-1 my-3">${match}</ul>`);
  
  // Wrap in paragraph tags
  if (!html.startsWith('<')) {
    html = `<p class="my-3">${html}</p>`;
  }
  
  return html;
}

export default async function StudyNotesViewPage({
  searchParams,
}: {
  searchParams: Promise<{ id?: string }>;
}) {
  const { userId } = await auth();
  const { id } = await searchParams;

  if (!userId) redirect(`/?next=${encodeURIComponent(`/app/study-notes/view?id=${id || ""}`)}`);
  if (!id) redirect("/app?tab=flashcards&library=notes");

  const note = await prisma.deck.findFirst({
    where: { id, user: { clerkUserId: userId } },
    select: {
      title: true,
      source: true,
      cards: {
        where: { question: "__STUDY_NOTE__" },
        select: { answer: true },
        take: 1,
      },
    },
  });

  const content = note?.cards[0]?.answer;
  if (!note || !content) redirect("/app?tab=flashcards&library=notes");

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{note.title}</h1>
          {note.source ? <p className="text-sm text-gray-500 mt-1">{note.source}</p> : null}
        </div>
        <div className="flex items-center gap-2">
          <DeleteStudyNoteButton noteId={id} />
          <Link href="/app?tab=flashcards&library=notes" className="px-4 py-2 border rounded hover:bg-gray-50">Back</Link>
        </div>
      </div>

      <div className="prose prose-sm max-w-none border rounded-lg p-6 bg-white">
        <div 
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(content) }}
        />
      </div>
    </div>
  );
}
