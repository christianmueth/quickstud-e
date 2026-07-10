import Link from "next/link";
import WorkspaceSectionNav from "@/components/WorkspaceSectionNav";
import WorkspaceWhiteboard from "@/components/WorkspaceWhiteboard";

const whiteboardCapabilities = [
  "Freehand sketching and annotations for ideas you are still forming.",
  "Diagram and concept-map space for relationships, systems, and processes.",
  "PDF and image overlays so explanations can happen directly on source material.",
  "AI assist actions like clean this sketch, visualize this explanation, or turn this into a flowchart.",
];

const whiteboardRules = [
  "The learner draws, places, edits, and decides what stays on the board.",
  "The AI suggests structure, cleanup, and visual alternatives without taking over the workspace.",
  "The whiteboard should connect back into instructional chat, not replace it.",
];

export default function WorkspaceWhiteboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <WorkspaceSectionNav currentPath="/app/workspace/whiteboard" />

      <section className="rounded-[2rem] border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-700">Workspace Section</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Whiteboard + visual tutoring should live in its own workspace, not inside flashcards.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700">
          This section is the visual reasoning surface for Phase 2. It should support diagrams, annotations, overlays, and concept mapping while keeping authorship and control with the learner.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/app/workspace?workspaceMode=instructional-chat&starterPrompt=Help%20me%20plan%20a%20whiteboard%20for%20this%20topic%20with%20the%20best%20visual%20structure%2C%20labels%2C%20and%20explanation%20sequence.&reason=Whiteboard%20planning%20should%20start%20from%20instructional%20chat%20inside%20the%20workspace."
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Plan a whiteboard with tutor
          </Link>
          <Link href="/app/workspace" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
            Back to workspace hub
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">What this section should support</p>
          <div className="mt-4 space-y-3">
            {whiteboardCapabilities.map((item) => (
              <div key={item} className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-800">Design rule</p>
          <div className="mt-4 space-y-3">
            {whiteboardRules.map((item) => (
              <div key={item} className="rounded-2xl border border-amber-200 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <WorkspaceWhiteboard />
    </div>
  );
}