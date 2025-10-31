import { NextResponse } from "next/server";
import { put } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 60;

// Accept video upload and store in Vercel Blob, return the URL
export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File | null;
    
    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    console.log("[Blob] Uploading file:", file.name, "size:", file.size, "bytes");
    
    // Upload to Vercel Blob with random suffix to avoid overwrites
    const blob = await put(file.name, file, {
      access: "public",
      contentType: file.type || "video/mp4",
      addRandomSuffix: true,
    });
    
    console.log("[Blob] Upload complete:", blob.url);
    
    return NextResponse.json({ 
      url: blob.url,
      pathname: blob.pathname,
      size: file.size 
    });
  } catch (e: any) {
    console.error("[Blob] Upload failed:", e?.message || e);
    return NextResponse.json({ error: e?.message || "Failed to upload file" }, { status: 500 });
  }
}
