import fs from "node:fs";
import { NextResponse } from "next/server";
import { COURSEWORK_FILE, STATE_FILE } from "@/lib/server/paths";
import { crunchWeeks, hydrate, type Course, type ItemState, type RawItem } from "@/lib/coursework";

export const dynamic = "force-dynamic";

const DATA = COURSEWORK_FILE;
const STATE = STATE_FILE;

type Scraped = {
  generatedAt?: string;
  term?: string;
  termStart?: string;
  termEnd?: string;
  courses?: Course[];
  items?: RawItem[];
  gaps?: string[];
};

function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

/** Temp file + rename — a half-written state file would take the room down. */
function writeState(state: Record<string, ItemState>) {
  const tmp = `${STATE}.tmp`;
  fs.writeFileSync(tmp, `${JSON.stringify(state, null, 2)}\n`, "utf8");
  fs.renameSync(tmp, STATE);
}

export async function GET() {
  const scraped = readJson<Scraped>(DATA, {});
  if (!scraped.items) {
    return NextResponse.json({ found: false, courses: [], items: [], crunch: [], gaps: [] });
  }

  const state = readJson<Record<string, ItemState>>(STATE, {});
  const items = hydrate(scraped.items, state);

  return NextResponse.json({
    found: true,
    generatedAt: scraped.generatedAt ?? null,
    term: scraped.term ?? "",
    termStart: scraped.termStart ?? null,
    termEnd: scraped.termEnd ?? null,
    courses: scraped.courses ?? [],
    items,
    crunch: crunchWeeks(items),
    gaps: scraped.gaps ?? [],
  });
}

export async function POST(req: Request) {
  let body: { id?: string; status?: string; note?: string; effortMin?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "bad json" }, { status: 400 });
  }

  const { id } = body;
  if (!id) return NextResponse.json({ ok: false, error: "id required" }, { status: 400 });

  const scraped = readJson<Scraped>(DATA, {});
  if (!scraped.items?.some((i) => i.id === id)) {
    return NextResponse.json({ ok: false, error: "unknown item" }, { status: 404 });
  }

  const state = readJson<Record<string, ItemState>>(STATE, {});
  const entry: ItemState = { ...state[id] };

  if (body.status) {
    if (!["todo", "doing", "done", "skipped"].includes(body.status)) {
      return NextResponse.json({ ok: false, error: "bad status" }, { status: 400 });
    }
    entry.status = body.status as ItemState["status"];
    if (body.status === "done") entry.doneAt = new Date().toISOString();
    else delete entry.doneAt;
  }
  if (body.note !== undefined) entry.note = body.note;
  if (body.effortMin !== undefined) entry.effortMin = body.effortMin;

  state[id] = entry;
  writeState(state);

  return NextResponse.json({ ok: true, id, state: entry });
}
