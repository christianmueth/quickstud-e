import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      request,
      body,
      onBeforeGenerateToken: async (pathname: string) => {
        // ⚠️ Authenticate and authorize users before generating the token.
        const authResult = await auth();
        if (!authResult.userId) {
          throw new Error("Unauthorized");
        }

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
          tokenPayload: JSON.stringify({ userId: authResult.userId }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        let userId: string | null = null;
        try {
          const parsed = tokenPayload ? JSON.parse(tokenPayload) : null;
          userId = parsed?.userId || null;
        } catch {
          userId = null;
        }

        console.log("[BlobUpload] Completed", {
          url: blob?.url,
          pathname: blob?.pathname,
          userId,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : String(error) },
      { status: 400 }
    );
  }
}
