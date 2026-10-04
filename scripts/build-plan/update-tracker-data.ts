// update-tracker-data.ts — rebuild the FAVO Build Tracker's embedded JSON blob from Jira.
//
// Usage:
//   bun run scripts/build-plan/update-tracker-data.ts --html <tracker.html> --stories <stories.json> --out <out.html> [--epics <epics.json>]
// Called by .claude/commands/update-build-tracker.md (Step 3).
//
// --stories : raw searchJiraIssuesUsingJql result for
//             parent in (AT-147..AT-157), fields summary,status,assignee,labels,description,issuelinks,parent
// --epics   : optional raw searchJiraIssuesUsingJql result for key in (AT-147..AT-157), fields summary,status,labels.
//             If omitted, epic summary + status come from each story's `parent` field (live Jira data),
//             and epic labels/week come from the existing blob.
//
// Every story field is derived from the Jira JSON. Nothing is hand-typed.

import { readFileSync, writeFileSync } from "node:fs";

// ---- conventions (the one place they are defined) ----
const DISPLAYNAME_OWNERS: Record<string, string> = {
  "Mia Ligthelm": "Mia",
  "Nikao du Toit": "Nikao",
};
const SHARED_LABEL = "shared-owner";
const WEEK_LABELS: Record<string, string> = {
  "week-1": "Week 1",
  "week-2": "Week 2",
  "backlog-deferred": "Backlog (deferred)",
};
const HIDDEN_LABELS = new Set([SHARED_LABEL, ...Object.keys(WEEK_LABELS)]);
const EPIC_KEYS = Array.from({ length: 11 }, (_, i) => `AT-${147 + i}`);

// ---- args ----
const args: Record<string, string> = {};
for (let i = 2; i < process.argv.length; i += 2) args[process.argv[i].replace(/^--/, "")] = process.argv[i + 1];
for (const k of ["html", "stories", "out"]) if (!args[k]) throw new Error(`missing --${k}`);

function loadNodes(path: string): any[] {
  const j = JSON.parse(readFileSync(path, "utf8"));
  if (!j?.issues || !Array.isArray(j.issues.nodes))
    throw new Error(`${path} doesn't look like a searchJiraIssuesUsingJql result`);
  if (j.issues.pageInfo?.hasNextPage) throw new Error(`${path} has more pages — concatenate them first`);
  return j.issues.nodes;
}

function statusOf(st: any): "todo" | "inprogress" | "done" {
  const cat = st?.statusCategory?.key;
  if (cat === "done") return "done";
  if (cat === "indeterminate") return "inprogress";
  if (cat === "new") return "todo";
  throw new Error(`unknown status category: ${JSON.stringify(st?.statusCategory)}`);
}

function weekOf(labels: string[]): string | null {
  const hits = labels.filter((l) => WEEK_LABELS[l]);
  if (hits.length > 1) console.warn(`  ! multiple week labels ${hits.join(",")} — using ${hits[0]}`);
  return hits.length ? WEEK_LABELS[hits[0]] : null;
}

function ownerOf(f: any, key: string): string {
  if ((f.labels || []).includes(SHARED_LABEL)) return "Both";
  const a = f.assignee;
  if (!a) return "Both";
  const o = DISPLAYNAME_OWNERS[a.displayName];
  if (!o) throw new Error(`${key}: unknown assignee ${a.displayName} (${a.accountId})`);
  return o;
}

function reviewerOf(desc: string | null | undefined): string | null {
  if (!desc) return null;
  for (const raw of desc.split("\n")) {
    const line = raw.replace(/\*\*/g, "").trim();
    const m = line.match(/^Reviewer:\s*(.+?)\s*$/);
    if (m) return m[1].replace(/\s*\(.*\)[.\s]*$/, "").trim() || null;
  }
  return null;
}

function blockedByOf(f: any): string | null {
  const blockers = (f.issuelinks || [])
    .filter((l: any) => l.type?.name === "Blocks" && l.inwardIssue)
    .map((l: any) => l.inwardIssue.fields?.summary || l.inwardIssue.key);
  return blockers.length ? blockers.join("; ") : null;
}

function splitEpicSummary(s: string): { title: string; day: string | null } {
  const m = s.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
  return m ? { title: m[1], day: m[2] } : { title: s, day: null };
}

// ---- load ----
const html = readFileSync(args.html, "utf8");
const re = /(<script id="data" type="application\/json">\s*)([\s\S]*?)(\s*<\/script>)/;
const m = html.match(re);
if (!m) throw new Error("Couldn't find the data <script> tag");
const old = JSON.parse(m[2]);
const oldEpics = new Map<string, any>(old.epics.map((e: any) => [e.key, e]));
const oldStories = new Map<string, any>(old.stories.map((s: any) => [s.key, s]));

const storyNodes = loadNodes(args.stories);
const epicNodes = args.epics ? loadNodes(args.epics) : null;

// ---- epics ----
const epicSrc = new Map<string, { summary: string; status: any; labels: string[] | null }>();
if (epicNodes) {
  for (const n of epicNodes) epicSrc.set(n.key, { summary: n.fields.summary, status: n.fields.status, labels: n.fields.labels });
} else {
  for (const n of storyNodes) {
    const p = n.fields.parent;
    if (p && !epicSrc.has(p.key)) epicSrc.set(p.key, { summary: p.fields.summary, status: p.fields.status, labels: null });
  }
}
const epics = EPIC_KEYS.map((key) => {
  const src = epicSrc.get(key);
  const prev = oldEpics.get(key);
  if (!src && !prev) throw new Error(`epic ${key} not found in Jira or the existing page`);
  if (!src) {
    console.warn(`  ! ${key}: no Jira data (epic has no stories?) — keeping previous entry`);
    return prev;
  }
  const { title, day } = splitEpicSummary(src.summary);
  const labels = src.labels ? src.labels.filter((l) => !HIDDEN_LABELS.has(l)) : prev?.labels ?? [];
  const week = src.labels ? weekOf(src.labels) ?? prev?.week ?? null : prev?.week ?? null;
  return { key, title, day: day ?? prev?.day ?? null, week, status: statusOf(src.status), labels };
});

// ---- stories ----
const stories = storyNodes
  .map((n: any) => {
    const f = n.fields;
    const labels: string[] = f.labels || [];
    return {
      key: n.key,
      summary: f.summary,
      assignee_name: ownerOf(f, n.key),
      reviewer: reviewerOf(f.description),
      blocked_by: blockedByOf(f),
      labels: labels.filter((l) => !HIDDEN_LABELS.has(l)),
      week: weekOf(labels),
      parent: f.parent?.key ?? null,
      status: statusOf(f.status),
    };
  })
  .sort((a: any, b: any) => Number(a.key.split("-")[1]) - Number(b.key.split("-")[1]));

for (const s of stories) if (!EPIC_KEYS.includes(s.parent)) throw new Error(`${s.key}: parent ${s.parent} not one of the 11 epics`);

// ---- diff (plain English) ----
const LBL: Record<string, string> = { todo: "To do", inprogress: "In progress", done: "Done" };
console.log("Changes since last sync (" + old.generated_at + "):");
let changes = 0;
for (const s of stories) {
  const p = oldStories.get(s.key);
  if (!p) { console.log(`  NEW  ${s.key} ${s.summary} — ${s.assignee_name}, ${LBL[s.status]}`); changes++; continue; }
  if (p.status !== s.status) { console.log(`  ${s.key} ${s.summary}: ${LBL[p.status]} -> ${LBL[s.status]}`); changes++; }
  for (const k of ["summary", "assignee_name", "reviewer", "blocked_by", "week", "parent"] as const)
    if (JSON.stringify(p[k]) !== JSON.stringify((s as any)[k])) {
      console.log(`  ${s.key} ${k}: ${JSON.stringify(p[k])} -> ${JSON.stringify((s as any)[k])}`); changes++;
    }
}
for (const k of oldStories.keys()) if (!stories.find((s: any) => s.key === k)) { console.log(`  GONE ${k}`); changes++; }
for (const e of epics) {
  const p = oldEpics.get(e.key);
  for (const k of ["title", "day", "week", "status"]) if (p && JSON.stringify(p[k]) !== JSON.stringify(e[k])) {
    console.log(`  epic ${e.key} ${k}: ${JSON.stringify(p[k])} -> ${JSON.stringify(e[k])}`); changes++;
  }
}
if (!changes) console.log("  (none)");

// ---- totals ----
console.log(`\nEpics: ${epics.length}  Stories: ${stories.length}`);
for (const o of ["Mia", "Nikao", "Both"]) {
  const mine = stories.filter((s: any) => s.assignee_name === o);
  const c = (st: string) => mine.filter((s: any) => s.status === st).length;
  console.log(`  ${o.padEnd(6)} total ${mine.length}: done ${c("done")}, in progress ${c("inprogress")}, to do ${c("todo")}`);
}

// ---- write ----
const blob = { generated_at: new Date().toISOString(), epics, stories };
const json = JSON.stringify(blob).replace(/<\//g, "<\\/");
const out = html.replace(re, (_a, pre, _b, post) => pre + json + post);
JSON.parse(out.match(re)![2]); // sanity: blob round-trips
writeFileSync(args.out, out);
console.log(`\nWrote ${args.out}`);
