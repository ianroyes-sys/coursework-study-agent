import { NextResponse } from "next/server";
import { refreshCourseworkFromBrowser } from "@/lib/server/courseworkRefresh";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function refreshError(error: unknown) {
  const message = error instanceof Error ? error.message : "";
  const readable = message.match(/(?:(?:Opera|Chrome) has no open windows|Open your signed-in Brightspace tab|Set D2L_BASE_URL|Live refresh drives)[^.]*\./)?.[0];
  return readable || "Unable to refresh Brightspace coursework. Keep a signed-in Brightspace tab open in Opera or Chrome and try again.";
}

export async function POST() {
  try {
    const result = await refreshCourseworkFromBrowser();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: refreshError(error) },
      { status: 502 },
    );
  }
}
