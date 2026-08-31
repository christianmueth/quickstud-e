import Link from "next/link";
import WorkspaceSectionNav from "@/components/WorkspaceSectionNav";

const instructionalChatLaunchers = [
  {
    title: "Understand a concept",
    href: "/app/workspace?workspaceMode=instructional-chat&starterPrompt=Help%20me%20understand%20the%20most%20important%20idea%20I%20should%20focus%20on%20today.&reason=Start%20with%20instructional%20chat%20before%20branching%20into%20other%20tools.",
  },
  {
    title: "Plan a study session",
    href: "/app/workspace?workspaceMode=instructional-chat&starterPrompt=Plan%20a%2030-minute%20study%20session%20using%20my%20current%20workspace%20and%20weak%20areas.&reason=Use%20instructional%20chat%20as%20the%20central%20workspace%20controller.",
  },
  {
    title: "Build from sources",
    href: "/app/workspace?workspaceMode=instructional-chat&starterPrompt=Help%20me%20turn%20my%20current%20study%20material%20into%20a%20clear%20learning%20plan%20with%20key%20ideas%2C%20questions%2C%20and%20next%20steps.&reason=Instructional%20chat%20should%20unify%20notes%2C%20study%20sets%2C%20and%20future%20workspace%20tools.",
  },
];

export default function WorkspacePage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <WorkspaceSectionNav currentPath="/app/workspace" />

      <section className="flex flex-wrap items-center justify-between gap-4 border-b border-slate-200 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Workspace</h1>
        <div className="flex flex-wrap gap-3">
          <Link href={instructionalChatLaunchers[0].href} className="rounded-full bg-slate-950 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800">
            Open tutor
          </Link>
          <Link href="/app" className="rounded-full border border-slate-300 px-4 py-2 text-sm font-medium text-slate-900 hover:bg-white">
            Study
          </Link>
        </div>
      </section>

      <section className="grid gap-3 lg:grid-cols-3">
        {instructionalChatLaunchers.map((launcher) => (
          <div key={launcher.title} className="border border-slate-200 bg-white p-5">
            <h2 className="text-base font-semibold text-slate-950">{launcher.title}</h2>
            <Link href={launcher.href} className="mt-4 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4">
              Open
            </Link>
          </div>
        ))}
      </section>

      <section className="grid gap-3 lg:grid-cols-2">
        <div className="border border-emerald-200 bg-emerald-50 p-5">
          <h2 className="font-semibold text-slate-950">Whiteboard</h2>
          <Link href="/app/workspace/whiteboard" className="mt-3 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4">
            Open
          </Link>
        </div>

        <div className="border border-violet-200 bg-violet-50 p-5">
          <h2 className="font-semibold text-slate-950">Presentations</h2>
          <Link href="/app/workspace/presentations" className="mt-3 inline-flex text-sm font-medium text-slate-700 underline underline-offset-4">
            Open
          </Link>
        </div>
      </section>

    </div>
  );
}