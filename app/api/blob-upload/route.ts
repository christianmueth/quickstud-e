import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  try {
    const authResult = await auth();
    if (!authResult.userId) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // `handleUpload` returns a Response object (JSON) that the Blob client SDK expects.
    // Import is dynamic to avoid bundling issues and keep this route server-only.
    const { handleUpload } = await import("@vercel/blob/client");

    const body = await request.json().catch(() => null);
    if (!body) {
      return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
    }

    return await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname: string) => {
        // Constrain uploads to a known prefix so clients can't write arbitrary paths.
        if (!pathname.startsWith("uploads/")) {
          throw new Error("Invalid upload pathname");
        }
        return {
          allowedContentTypes: [
            "application/pdf",
            "application/vnd.openxmlformats-officedocument.presentationml.presentation",
            "video/mp4",
            "video/webm",
            "video/quicktime",
            "audio/mpeg",
            "audio/mp4",
            "audio/wav",
            "text/vtt",
            "application/x-subrip",
          ],
          tokenPayload: authResult.userId,
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }: any) => {
        console.log("[BlobUpload] Completed", {
          url: blob?.url,
          pathname: blob?.pathname,
          userId: tokenPayload,
        });
      },
    });
  } catch (err: any) {
    console.error("[BlobUpload] Route error:", err?.message || err);
    return NextResponse.json(
      { error: err?.message || "Blob upload route failed", code: "BLOB_UPLOAD_ROUTE_FAILED" },
      { status: 500 }
    );
  }
}
