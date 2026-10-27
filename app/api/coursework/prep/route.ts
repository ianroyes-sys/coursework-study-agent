import { NextResponse } from "next/server";
import { type ReviewStatus } from "@/lib/courseworkPrep";
import { readPrepData, updateReview } from "@/lib/server/courseworkPrep";
import { runnable, startRun } from "@/lib/server/prepRunner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(readPrepData());
}

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({})) as { action?: string; id?: string; status?: ReviewStatus; note?: string };
  if (body.action === "run") {
    const can = runnable();
    if (can.ok) startRun();
    return NextResponse.json({ ok: can.ok, started: can.ok, blockedBy: can.why ?? null });
  }
  if (body.action === "review") {
    if (!body.id || !body.status || !["pending", "reviewed", "needs-revision", "dismissed"].includes(body.status)) {
      return NextResponse.json({ ok: false, error: "invalid-review" }, { status: 400 });
    }
    try {
      const review = updateReview(body.id, body.status, body.note ?? "");
      let started = false;
      if (body.status === "needs-revision") {
        const can = runnable();
        if (can.ok) { startRun(); started = true; }
      }
      return NextResponse.json({ ok: true, review, started });
    } catch {
      return NextResponse.json({ ok: false, error: "unknown-item" }, { status: 404 });
    }
  }
  return NextResponse.json({ ok: false, error: "unknown-action" }, { status: 400 });
}
