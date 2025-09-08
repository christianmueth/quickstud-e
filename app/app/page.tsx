// app/app/page.tsx
"use client";
import { useState } from "react";

export default function CreateForm() {
  const [pending, setPending] = useState(false);

  return (
    <form
      action="/api/flashcards"
      method="post"
      encType="multipart/form-data"
      className="space-y-3"
      onSubmit={() => setPending(true)}
    >
      <input name="title" required className="w-full border rounded p-2" placeholder="Deck title" />
      <textarea name="source" className="w-full h-40 border rounded p-2" placeholder="Optional if uploading a file" />
      <div className="text-sm text-gray-600">
        Upload PPTX or PDF:
        <input
          type="file"
          name="file"  // <-- the API looks for this
          accept=".pptx,.pdf,application/pdf,application/vnd.openxmlformats-officedocument.presentationml.presentation"
        />
      </div>
      <button className="px-4 py-2 rounded bg-black text-white disabled:opacity-60" type="submit" disabled={pending}>
        {pending ? "Generating…" : "Generate Flashcards"}
      </button>
    </form>
  );
}
