import { auth } from "@clerk/nextjs/server";
import { redirect } from "next/navigation";
import ReasoningReplayConsole from "./ReasoningReplayConsole";
import { isInternalOperator } from "@/lib/internalAccess";

export const dynamic = "force-dynamic";

export default async function ReasoningPage() {
  const { userId } = await auth();
  if (!userId) redirect("/sign-in");
  if (!isInternalOperator(userId)) redirect("/app");

  return <ReasoningReplayConsole />;
}