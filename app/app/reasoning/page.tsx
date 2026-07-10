import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ReasoningReplayConsole from "./ReasoningReplayConsole";
import { isInternalOperator } from "@/lib/internalAccess";

export const dynamic = "force-dynamic";

export default async function ReasoningPage() {
  const { userId } = await auth();
  if (!userId) redirect(`/?next=${encodeURIComponent("/app/reasoning")}`);
  if (!isInternalOperator(userId)) redirect("/app");

  return (
    <>
      <div className="mx-auto max-w-7xl px-6 pt-6">
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">Operator tools</p>
              <p className="mt-1 text-sm text-slate-700">Inspect the bounded cross-surface workspace context that now feeds tutor continuity and recommendation carry-over.</p>
            </div>
            <Link href="/app/reasoning/workspace-context" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              Open workspace context inspector
            </Link>
          </div>
        </div>
      </div>
      <ReasoningReplayConsole />
    </>
  );
}