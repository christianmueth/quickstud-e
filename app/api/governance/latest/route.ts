import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { getLatestGovernanceReport } from "@/lib/governanceReports";
import { isInternalOperator } from "@/lib/internalAccess";

export const dynamic = "force-dynamic";

export async function GET() {
  const { userId } = await auth();
  if (!userId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!isInternalOperator(userId)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  try {
    const report = getLatestGovernanceReport();
    return NextResponse.json({ ok: true, report });
  } catch (error: any) {
    return NextResponse.json(
      { ok: false, error: error?.message || "Failed to load governance report." },
      { status: 500 }
    );
  }
}