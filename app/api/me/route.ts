import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const { userId } = await auth();
    if (!userId) {
      return NextResponse.json({ ok: true, signedIn: false, xp: 0, streak: 0, xpToday: 0, dailyGoal: 50 });
    }

    // Don't "select" fields you haven't migrated yet.
    // Fetch whole row (whatever columns exist), then read optional values safely.
    const user: any = await prisma.user.findFirst({ where: { clerkUserId: userId } });

    const goal = user?.dailyGoal ?? 50;
    const today = new Date(); today.setHours(0, 0, 0, 0);

    let xpToday = 0;
    if (user?.xpTodayDate) {
      const d = new Date(user.xpTodayDate); d.setHours(0, 0, 0, 0);
      if (Number(d) === Number(today)) xpToday = user?.xpToday ?? 0;
    }

    return NextResponse.json({
      ok: true,
      signedIn: true,
      xp: user?.xp ?? 0,
      streak: user?.studyStreak ?? 0,
      xpToday,
      dailyGoal: goal,
    });
  } catch {
    // Always return JSON
    return NextResponse.json({ ok: false, signedIn: false, xp: 0, streak: 0, xpToday: 0, dailyGoal: 50 });
  }
}
