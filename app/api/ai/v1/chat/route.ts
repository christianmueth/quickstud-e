import { NextResponse } from "next/server";
import { chatV1, type ChatV1Request } from "@/lib/aiGateway";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ChatV1Request;

    if (!body || !Array.isArray(body.messages) || body.messages.length === 0) {
      return NextResponse.json(
        { error: "Invalid request: messages[] is required", code: "BAD_REQUEST" },
        { status: 400 }
      );
    }

    const out = await chatV1(body);
    return NextResponse.json(out, { status: 200 });
  } catch (e: any) {
    if (e?.code === "UNAUTHORIZED") {
      return NextResponse.json({ error: "Unauthorized", code: "UNAUTHORIZED" }, { status: 401 });
    }

    return NextResponse.json(
      {
        error: e?.message || "Internal error",
        code: e?.code || "INTERNAL_ERROR",
        jobId: e?.jobId || null,
        lastStatus: e?.lastStatus || null,
      },
      { status: 500 }
    );
  }
}
