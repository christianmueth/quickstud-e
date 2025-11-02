"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export default function StudyNotesViewPage() {
  const router = useRouter();
  const [notes, setNotes] = useState<string>("");
  const [title, setTitle] = useState<string>("");
  const [source, setSource] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Retrieve notes from sessionStorage
    const storedData = sessionStorage.getItem("latestStudyNotes");
    if (!storedData) {
      router.push("/app");
      return;
    }

    try {
      const data = JSON.parse(storedData);
      setNotes(data.notes || "");
      setTitle(data.title || "Study Notes");
      setSource(data.source || "");
    } catch (err) {
      console.error("Failed to parse study notes:", err);
      router.push("/app");
    } finally {
      setLoading(false);
    }
  }, [router]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 rounded w-1/3"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-full"></div>
          <div className="h-4 bg-gray-200 rounded w-2/3"></div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">{title}</h1>
          <p className="text-sm text-gray-500 mt-1">Source: {source}</p>
        </div>
        <button
          onClick={() => router.push("/app")}
          className="px-4 py-2 border rounded hover:bg-gray-50"
        >
          ← Back to Decks
        </button>
      </div>

      {/* Action buttons */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            navigator.clipboard.writeText(notes);
            alert("Notes copied to clipboard!");
          }}
          className="px-4 py-2 border rounded hover:bg-gray-50"
        >
          📋 Copy Notes
        </button>
        <button
          onClick={() => window.print()}
          className="px-4 py-2 border rounded hover:bg-gray-50"
        >
          🖨️ Print
        </button>
      </div>

      {/* Notes content */}
      <div className="prose prose-sm max-w-none border rounded-lg p-6 bg-white">
        <div 
          className="markdown-content"
          dangerouslySetInnerHTML={{ __html: markdownToHtml(notes) }}
        />
      </div>
    </div>
  );
}
