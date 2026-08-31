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
        <div className="border-b border-slate-200 pb-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <div>
              <p className="text-sm font-semibold text-slate-950">Operator tools</p>
            </div>
            <Link href="/app/reasoning/workspace-context" className="rounded-full border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-900 hover:bg-slate-50">
              Context
            </Link>
          </div>
        </div>
      </div>
      <ReasoningReplayConsole />
    </>
  );
}