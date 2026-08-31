import WorkspaceSectionNav from "@/components/WorkspaceSectionNav";
import WorkspacePresentationPlanner from "@/components/WorkspacePresentationPlanner";

export default function WorkspacePresentationsPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <WorkspaceSectionNav currentPath="/app/workspace/presentations" />

      <section className="border-b border-slate-200 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Presentations</h1>
        <p className="mt-2 text-sm text-slate-600">Build an editable outline.</p>
      </section>

      <WorkspacePresentationPlanner />
    </div>
  );
}