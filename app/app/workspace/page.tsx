import Link from "next/link";
import WorkspaceSectionNav from "@/components/WorkspaceSectionNav";

const instructionalChatLaunchers = [
  {
    title: "Understand A Concept",
    description: "Use the instructional chat as the main tutor layer for explanation, questioning, and next-step guidance.",
    href: "/app/workspace?workspaceMode=instructional-chat&starterPrompt=Help%20me%20understand%20the%20most%20important%20idea%20I%20should%20focus%20on%20today.&reason=Start%20with%20instructional%20chat%20before%20branching%20into%20other%20tools.",
  },
  {
    title: "Plan A Study Session",
    description: "Turn the tutor into a guided session planner that sequences review, practice, and reflection without taking actions for you.",
    href: "/app/workspace?workspaceMode=instructional-chat&starterPrompt=Plan%20a%2030-minute%20study%20session%20using%20my%20current%20workspace%20and%20weak%20areas.&reason=Use%20instructional%20chat%20as%20the%20central%20workspace%20controller.",
  },
  {
    title: "Build From Notes Or Sources",
    description: "Ask the tutor to help structure notes, study sets, and upcoming explanations before whiteboard and presentation tools arrive.",
    href: "/app/workspace?workspaceMode=instructional-chat&starterPrompt=Help%20me%20turn%20my%20current%20study%20material%20into%20a%20clear%20learning%20plan%20with%20key%20ideas%2C%20questions%2C%20and%20next%20steps.&reason=Instructional%20chat%20should%20unify%20notes%2C%20study%20sets%2C%20and%20future%20workspace%20tools.",
  },
];

const expansionRoadmap = [
  {
    stage: "Available Now",
    title: "Instructional Chat",
    body: "This is the first workspace layer: persistent, context-aware tutoring that carries continuity across study sets, progress, and future workspace tools.",
  },
  {
    stage: "Next",
    title: "Whiteboard + Visual Tutoring",
    body: "Spatial reasoning, sketch cleanup, concept maps, diagram overlays, and visual explanations should extend the workspace without the AI operating it for the learner.",
  },
  {
    stage: "After That",
    title: "Guided Presentation Builder",
    body: "Presentation support should grow from notes, transcripts, summaries, and tutoring threads into editable outlines, slide flow, visuals, and speaker guidance.",
  },
];

export default function WorkspacePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <WorkspaceSectionNav currentPath="/app/workspace" />

      <section className="rounded-[2rem] border border-sky-200 bg-gradient-to-br from-sky-50 via-white to-cyan-50 p-7 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-sky-700">Phase 2 Workspace Expansion</p>
        <h1 className="mt-3 max-w-4xl text-3xl font-semibold tracking-tight text-slate-950">Guided cognitive workspace starts with instructional chat.</h1>
        <p className="mt-4 max-w-3xl text-sm leading-7 text-slate-700">
          The chat layer should unify tutoring, study sessions, memory, whiteboard work, and later presentation building. The tutor assists the workspace, but it does not operate the workspace for the learner.
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <Link href={instructionalChatLaunchers[0].href} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Launch instructional chat
          </Link>
          <Link href="/app" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
            Back to study workspace
          </Link>
        </div>
      </section>

      <section className="grid gap-4 lg:grid-cols-3">
        {instructionalChatLaunchers.map((launcher) => (
          <div key={launcher.title} className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Instructional chat starter</p>
            <h2 className="mt-3 text-xl font-semibold text-slate-950">{launcher.title}</h2>
            <p className="mt-3 text-sm leading-7 text-slate-700">{launcher.description}</p>
            <Link href={launcher.href} className="mt-5 inline-flex rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              Open in workspace chat
            </Link>
          </div>
        ))}
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-800">Separate workspace section</p>
          <h2 className="mt-3 text-xl font-semibold text-slate-950">Whiteboard + visual tutoring</h2>
          <p className="mt-3 text-sm leading-7 text-slate-700">
            This lives as its own workspace page so visual reasoning does not get collapsed into the flashcard builder.
          </p>
          <Link href="/app/workspace/whiteboard" className="mt-5 inline-flex rounded-full border border-emerald-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
            Open whiteboard section
          </Link>
        </div>

        <div className="rounded-3xl border border-violet-200 bg-violet-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-800">Separate workspace section</p>
          <h2 className="mt-3 text-xl font-semibold text-slate-950">Guided presentation builder</h2>
          <p className="mt-3 text-sm leading-7 text-slate-700">
            This also gets its own workspace page so presentation planning grows from tutoring and notes rather than from the flashcard flow.
          </p>
          <Link href="/app/workspace/presentations" className="mt-5 inline-flex rounded-full border border-violet-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
            Open presentation section
          </Link>
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="rounded-3xl border border-emerald-200 bg-gradient-to-br from-emerald-50 via-white to-lime-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-700">Implementation order</p>
          <ol className="mt-4 space-y-4 text-sm leading-7 text-slate-700">
            <li>
              <span className="font-semibold text-slate-950">1. Instructional chat first.</span> It centralizes continuity and gives the rest of the workspace a natural interaction layer.
            </li>
            <li>
              <span className="font-semibold text-slate-950">2. Whiteboard + visual tutoring second.</span> This adds spatial cognition, diagramming, overlays, and concept mapping without handing control to the AI.
            </li>
            <li>
              <span className="font-semibold text-slate-950">3. Guided presentation builder third.</span> That should extend from notes, transcripts, summaries, and tutoring threads into editable, human-authored slide construction.
            </li>
          </ol>
        </div>

        <div className="rounded-3xl border border-violet-200 bg-violet-50 p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-violet-800">Workspace roadmap</p>
          <div className="mt-4 space-y-4">
            {expansionRoadmap.map((item) => (
              <div key={item.title} className="rounded-2xl border border-violet-200 bg-white/80 p-4">
                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">{item.stage}</p>
                <h3 className="mt-2 text-base font-semibold text-slate-950">{item.title}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-700">{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}