import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { formatStudentState } from "@/lib/reasoningEngine/studentState";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const user = await prisma.user.findFirst({
      where: { clerkUserId: userId },
      select: { id: true },
    });

    if (!user) {
      return NextResponse.json({ ok: true, studentState: formatStudentState(null) });
    }

    const state = await prisma.studentState.findUnique({ where: { userId: user.id } });
    return NextResponse.json({ ok: true, studentState: formatStudentState(state) });
  } catch (error: any) {
    const message = String(error?.message || "");
    const missingTable = /StudentState|relation .* does not exist|table .* does not exist/i.test(message);
    return NextResponse.json(
      {
        ok: false,
        error: missingTable
          ? "Student state is not available yet. Apply the latest Prisma migration before using this endpoint."
          : "Failed to load student state.",
      },
      { status: missingTable ? 503 : 500 }
    );
  }
}