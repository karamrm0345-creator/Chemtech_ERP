import { NextResponse, type NextRequest } from "next/server";
import { readCompanyLogo } from "@/server/services/attachments";

/** Company logo: the uploaded image if configured, otherwise the bundled default. Public (used on sign-in). */
export async function GET(req: NextRequest) {
  const logo = await readCompanyLogo();
  if (!logo) return NextResponse.redirect(new URL("/chemtech-logo.svg", req.url));
  return new NextResponse(new Uint8Array(logo.data), {
    headers: { "Content-Type": logo.mimeType, "Cache-Control": "public, max-age=300", ETag: `"${logo.etag}"`, "X-Content-Type-Options": "nosniff" },
  });
}
