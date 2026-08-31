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
          <p className="text-sm font-semibold text-slate-950">Operator tools</p>
        </div>
      </div>
      <ReasoningReplayConsole />
    </>
  );
}