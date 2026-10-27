#!/usr/bin/env node
// Copies the fake sample course into the data directory, shifting every date so the
// sample's `anchor` day becomes today. Refuses to overwrite real data unless --force.
//   node scripts/seed-sample.mjs [--force]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DATA_DIR = path.resolve(ROOT, process.env.COURSEWORK_DATA_DIR || "data");
const SAMPLE = path.join(ROOT, "data", "example", "coursework.sample.json");
const TARGET = path.join(DATA_DIR, "coursework.json");
const DAY = 86_400_000;

export function shiftDates(value, days) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T[\d:.]+Z)?$/.test(value)) {
    const shifted = new Date(Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value) + days * DAY).toISOString();
    return value.length === 10 ? shifted.slice(0, 10) : shifted;
  }
  if (Array.isArray(value)) return value.map((v) => shiftDates(v, days));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, shiftDates(v, days)]));
  return value;
}

export function seed({ now = new Date(), force = false } = {}) {
  if (fs.existsSync(TARGET) && !force) throw new Error(`${path.relative(ROOT, TARGET)} already exists. Pass --force to replace it with the sample.`);
  const sample = JSON.parse(fs.readFileSync(SAMPLE, "utf8"));
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((today - Date.parse(`${sample.anchor}T00:00:00Z`)) / DAY);
  const { anchor, _note, ...rest } = sample;
  const shifted = shiftDates(rest, days);
  shifted.generatedAt = now.toISOString();
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(TARGET, `${JSON.stringify({ _note, ...shifted }, null, 2)}\n`);
  return { target: TARGET, shiftedDays: days, items: shifted.items.length };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const r = seed({ force: process.argv.includes("--force") });
    console.log(`Seeded ${r.items} sample items into ${path.relative(ROOT, r.target)} (dates shifted ${r.shiftedDays} days).`);
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
