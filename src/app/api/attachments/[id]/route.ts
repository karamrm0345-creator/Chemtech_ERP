import { NextResponse, type NextRequest } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { readAttachment } from "@/server/services/attachments";
import { AppError } from "@/server/errors";

/** Authenticated, permission-checked file download. Files are never served statically. */
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { id } = await params;
    const { meta, data } = await readAttachment(user, id);
    const inline = !req.nextUrl.searchParams.get("download") && (meta.mimeType === "application/pdf" || meta.mimeType.startsWith("image/"));
    return new NextResponse(new Uint8Array(data), {
      headers: {
        "Content-Type": meta.mimeType,
        "Content-Length": String(data.length),
        "Content-Disposition": `${inline ? "inline" : "attachment"}; filename="${encodeURIComponent(meta.fileName)}"`,
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox",
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    const status = e instanceof AppError ? (e.code === "FORBIDDEN" ? 403 : 404) : 500;
    return NextResponse.json({ error: e instanceof AppError ? e.message : "Error" }, { status });
  }
}
