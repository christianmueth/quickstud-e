import WorkspaceSectionNav from "@/components/WorkspaceSectionNav";
import WorkspaceWhiteboard from "@/components/WorkspaceWhiteboard";

export default function WorkspaceWhiteboardPage() {
  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-8 p-6">
      <WorkspaceSectionNav currentPath="/app/workspace/whiteboard" />

      <section className="border-b border-slate-200 pb-6">
        <h1 className="text-3xl font-semibold tracking-tight text-slate-950">Whiteboard</h1>
        <p className="mt-2 text-sm text-slate-600">Sketch, connect, and explain.</p>
      </section>

      <WorkspaceWhiteboard />
    </div>
  );
}