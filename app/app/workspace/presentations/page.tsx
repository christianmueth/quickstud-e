import Link from "next/link";
import WorkspaceSectionNav from "@/components/WorkspaceSectionNav";
import WorkspacePresentationPlanner from "@/components/WorkspacePresentationPlanner";

const presentationOutputs = [
  "Editable outline instead of locked slide automation.",
  "Slide sequence with the learning arc made explicit.",
  "Speaker guidance that supports delivery and explanation quality.",
  "Suggested visuals and exports while preserving human authorship.",
];

const presentationInputs = [
  "Study notes",
  "Study sets",
  "Tutoring summaries",
  "Transcripts",
  "PDFs",
  "Workspace chat threads",
];

export default function WorkspacePresentationsPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <WorkspaceSectionNav currentPath="/app/workspace/presentations" />

      <section className="rounded-[2rem] border border-violet-200 bg-gradient-to-br from-violet-50 via-white to-fuchsia-50 p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-violet-700">Workspace Section</p>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-slate-950">Presentation building belongs in the workspace, not in the flashcard editor.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700">
          This section should extend from notes, tutoring context, and study materials into guided presentation construction. The product should help structure the presentation without auto-authoring the whole thing.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link
            href="/app/workspace?workspaceMode=instructional-chat&starterPrompt=Help%20me%20build%20a%20presentation%20outline%20from%20my%20current%20workspace%20materials%2C%20with%20slide%20flow%2C%20speaker%20guidance%2C%20and%20suggested%20visuals.&reason=Presentation%20building%20should%20be%20a%20guided%20workspace%20feature%20separate%20from%20flashcards."
            className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
          >
            Start presentation planning
          </Link>
          <Link href="/app/workspace" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
            Back to workspace hub
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-[0.9fr_1.1fr]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Best starting materials</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {presentationInputs.map((item) => (
              <span key={item} className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-700">
                {item}
              </span>
            ))}
          </div>
        </div>

        <div className="rounded-3xl border border-fuchsia-200 bg-fuchsia-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-fuchsia-800">What the output should include</p>
          <div className="mt-4 space-y-3">
            {presentationOutputs.map((item) => (
              <div key={item} className="rounded-2xl border border-fuchsia-200 bg-white/80 px-4 py-3 text-sm leading-6 text-slate-700">
                {item}
              </div>
            ))}
          </div>
        </div>
      </section>

      <WorkspacePresentationPlanner />
    </div>
  );
}