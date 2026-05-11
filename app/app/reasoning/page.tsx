import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ReasoningReplayConsole from "./ReasoningReplayConsole";
import { isInternalOperator } from "@/lib/internalAccess";

export const dynamic = "force-dynamic";

export default async function ReasoningPage() {
  const { userId } = await auth();
  if (!userId) redirect(`/?next=${encodeURIComponent("/app/reasoning")}`);
  if (!isInternalOperator(userId)) redirect("/app");

  return <ReasoningReplayConsole />;
}