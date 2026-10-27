import path from "node:path";

/**
 * Every file this app reads or writes lives under one directory, `COURSEWORK_DATA_DIR`
 * (default `./data`). Nothing in it is committed: it holds your scraped course content and
 * your own progress marks. `npm run seed` copies the fake sample course into it.
 */
export const DATA_DIR = path.resolve(process.cwd(), process.env.COURSEWORK_DATA_DIR || "data");

export const dataFile = (name: string) => path.join(DATA_DIR, name);

export const COURSEWORK_FILE = dataFile("coursework.json");
export const STATE_FILE = dataFile("coursework-state.json");
export const PREP_MANIFEST_FILE = dataFile("coursework-prep.json");
export const REVIEW_STATE_FILE = dataFile("coursework-review-state.json");
export const ARTIFACT_ROOT = dataFile("coursework-prep");
