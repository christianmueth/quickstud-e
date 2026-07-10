import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { isInternalOperator } from "@/lib/internalAccess";
import { getLatestPersistedWorkspaceContext } from "@/lib/workspaceContextPersistence";
import { summarizeWorkspaceContext } from "@/lib/workspaceContext";
import {
  getWorkspaceConstitutionChecklist,
  getWorkspaceConstitutionChecklistSummary,
} from "@/lib/workspaceConstitution";

export const dynamic = "force-dynamic";

export default async function WorkspaceContextInspectorPage() {
  const { userId } = await auth();
  if (!userId) redirect(`/?next=${encodeURIComponent("/app/reasoning/workspace-context")}`);
  if (!isInternalOperator(userId)) redirect("/app");

  const user = await prisma.user.findUnique({
    where: { clerkUserId: userId },
    select: { id: true },
  });

  const latest = user ? await getLatestPersistedWorkspaceContext(user.id) : { context: null, savedAt: null };
  const governanceChecklist = getWorkspaceConstitutionChecklist();
  const governanceSummary = getWorkspaceConstitutionChecklistSummary();

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
      <section className="flex flex-col gap-4 rounded-3xl border border-slate-200 bg-white p-6 shadow-sm md:flex-row md:items-end md:justify-between">
        <div className="space-y-3">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Operator workspace context</p>
          <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Bounded workspace context inspector</h1>
          <p className="text-sm leading-7 text-slate-600">
            This surface shows the latest persisted cross-surface workspace context. It is intentionally bounded to the active study thread, current workspace artifacts, and recent tutor continuity.
          </p>
        </div>
        <div className="flex gap-3">
          <Link href="/app/reasoning" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
            Back to reasoning
          </Link>
        </div>
      </section>

      <section className="rounded-3xl border border-sky-200 bg-sky-50 p-6 shadow-sm">
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-sky-700">Summary</p>
        <p className="mt-3 text-sm leading-7 text-slate-700">{summarizeWorkspaceContext(latest.context)}</p>
        <p className="mt-3 text-xs text-slate-500">Last persisted: {latest.savedAt ? new Date(latest.savedAt).toLocaleString() : "No persisted snapshot yet"}</p>
      </section>

      <section className="rounded-3xl border border-amber-200 bg-amber-50 p-6 shadow-sm">
        <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-amber-700">Governance checklist</p>
            <h2 className="mt-2 text-xl font-semibold tracking-tight text-slate-950">Workspace constitutional coverage</h2>
            <p className="mt-2 text-sm leading-7 text-slate-700">{governanceSummary.headline}</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-medium text-slate-700">
            <span className="rounded-full bg-white px-3 py-1">{governanceSummary.guarded} guarded</span>
            <span className="rounded-full bg-white px-3 py-1">{governanceSummary.notApplicable} non-agentic</span>
            <span className={`rounded-full px-3 py-1 ${governanceSummary.needsReview > 0 ? "bg-red-100 text-red-800" : "bg-emerald-100 text-emerald-800"}`}>
              {governanceSummary.needsReview} need review
            </span>
          </div>
        </div>
        <div className="mt-5 grid gap-3 md:grid-cols-2">
          {governanceChecklist.map((item) => (
            <article key={item.id} className="rounded-2xl border border-amber-100 bg-white/90 p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-slate-950">{item.label}</p>
                  <p className="text-xs uppercase tracking-[0.14em] text-slate-500">{item.route}</p>
                </div>
                <span className={`rounded-full px-2.5 py-1 text-xs font-medium ${statusClasses[item.status]}`}>
                  {statusLabels[item.status]}
                </span>
              </div>
              <p className="mt-3 text-sm leading-6 text-slate-700">{item.detail}</p>
            </article>
          ))}
        </div>
      </section>

      {latest.context ? (
        <div className="grid gap-6 xl:grid-cols-2">
          <InspectorCard title="Active study set" value={latest.context.activeStudySet} />
          <InspectorCard title="Current guided session" value={latest.context.currentGuidedSession} />
          <InspectorCard title="Tutor memory" value={latest.context.tutorMemory} />
          <InspectorCard title="Whiteboard reference" value={latest.context.whiteboardReference} />
          <InspectorCard title="Presentation reference" value={latest.context.presentationReference} />
          <InspectorCard title="Uploaded assets" value={latest.context.uploadedAssets} />
          <InspectorCard title="Recent tutor interactions" value={latest.context.recentTutorInteractions} />
          <InspectorCard title="Weak concepts" value={latest.context.weakConcepts} />
        </div>
      ) : (
        <section className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 text-sm leading-7 text-slate-600 shadow-sm">
          No persisted workspace context has been written for this operator account yet. Open a study session or workspace tool to seed the shared context.
        </section>
      )}

      {latest.context ? (
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Raw JSON</p>
          <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-950 p-4 text-xs leading-6 text-slate-100">
            {JSON.stringify(latest.context, null, 2)}
          </pre>
        </section>
      ) : null}
    </main>
  );
}

const statusLabels = {
  guarded: "Guarded",
  not_applicable: "Non-agentic",
  needs_review: "Needs review",
} as const;

const statusClasses = {
  guarded: "bg-emerald-100 text-emerald-800",
  not_applicable: "bg-slate-100 text-slate-700",
  needs_review: "bg-red-100 text-red-800",
} as const;

function InspectorCard({ title, value }: { title: string; value: unknown }) {
  return (
    <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">{title}</p>
      <pre className="mt-4 overflow-x-auto rounded-2xl bg-slate-50 p-4 text-xs leading-6 text-slate-800">
        {JSON.stringify(value, null, 2)}
      </pre>
    </section>
  );
}