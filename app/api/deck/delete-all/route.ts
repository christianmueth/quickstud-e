import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";

export async function DELETE(req: Request) {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  try {
    // First delete all cards from user's decks
    await prisma.card.deleteMany({
      where: {
        deck: {
          user: {
            clerkUserId: userId
          }
        }
      }
    });

    // Then delete all decks
    await prisma.deck.deleteMany({
      where: {
        user: {
          clerkUserId: userId
        }
      }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting all decks:", error);
    return NextResponse.json({ error: "Failed to delete decks" }, { status: 500 });
  }
}