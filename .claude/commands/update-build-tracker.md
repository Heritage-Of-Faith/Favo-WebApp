---
description: Sync the FAVO Build Tracker artifact with live Jira status — pulls the 11 epics and their stories from project AT, rebuilds the tracker's data, and republishes it. Use whenever tasks have moved in Jira and you want the tracker to reflect it.
---

# Update the FAVO Build Tracker

The tracker is a published Artifact (a standalone HTML page) showing the two-week
build plan's progress, filterable by owner (Mia / Nikao / Both) and week. It reads
its data from one embedded JSON blob; this command refreshes that blob from Jira
and republishes it.

**Live artifact URL:** `https://claude.ai/artifact/8ZnGWSvtb9yiv4Sy8cDeJT`

**Trigger this whenever the user says things like:** "update the tracker", "sync
the build tracker", "refresh the Jira dashboard", "mark [ticket] done and update
the tracker", "how are we doing on the build plan" (if they want the page
refreshed, not just a verbal answer).

If the user just closed out a specific ticket in conversation (e.g. "AT-183 is
done"), update that ticket in Jira first (`transitionJiraIssue`), *then* run this
whole sync — don't hand-edit the tracker's data to reflect one ticket, always
resync from Jira so the page can't drift from reality.

---

## Step 1 — Read the artifact's current HTML

```
Artifact({ action: "read", url: "https://claude.ai/artifact/8ZnGWSvtb9yiv4Sy8cDeJT" })
```

This confirms you still have writer access and gives you the saved local file
path — you'll pass that path to the script in Step 3 as `--html`.

If the read comes back as a non-writer summary (shared view-only), stop and tell
the user — something changed about who owns this artifact.

---

## Step 2 — Pull the epics and stories from Jira

Cloud ID: `c5930bf9-65e6-4e72-b211-233db8f3f085` (hofmi.atlassian.net)

**Epics** (fixed set of 11 — only add to this list if a new phase is created):

```
searchJiraIssuesUsingJql({
  cloudId: "c5930bf9-65e6-4e72-b211-233db8f3f085",
  jql: "key in (AT-147,AT-148,AT-149,AT-150,AT-151,AT-152,AT-153,AT-154,AT-155,AT-156,AT-157)",
  fields: ["summary", "status", "labels"],
  maxResults: 20
})
```

**Stories** (everything parented to those epics — this picks up new tickets
automatically, no list to maintain):

```
searchJiraIssuesUsingJql({
  cloudId: "c5930bf9-65e6-4e72-b211-233db8f3f085",
  jql: "parent in (AT-147,AT-148,AT-149,AT-150,AT-151,AT-152,AT-153,AT-154,AT-155,AT-156,AT-157)",
  fields: ["summary", "status", "assignee", "labels", "description", "issuelinks", "parent"],
  responseContentFormat: "markdown",
  maxResults: 100
})
```

If `pageInfo.hasNextPage` is true (more than 100 stories now exist), repeat with
`nextPageToken` and concatenate the `issues.nodes` arrays before saving — the
transform script expects one `{"issues":{"nodes":[...]}}` file per input.

Either result may come back large enough to get auto-saved to a file instead of
inlined (you'll see a message naming the path). Whichever way it arrives — inline
or saved — make sure both the epics result and the stories result end up each in
their own JSON file, in the exact `{"issues":{"nodes":[...]}}` shape the tool
returns. Use your scratchpad directory for these two files.

---

## Step 3 — Run the transform script

```bash
bun run scripts/build-plan/update-tracker-data.ts \
  --html   <path from Step 1's read> \
  --epics  <path to the epics JSON from Step 2> \
  --stories <path to the stories JSON from Step 2> \
  --out    <scratchpad path>/favo-build-tracker.html
```

The script:
- classifies every issue's status as `todo` / `inprogress` / `done` from Jira's
  own status category (so it tracks whatever workflow states the project
  actually has, not a hardcoded list of status names)
- reads `week-1` / `week-2` / `backlog-deferred` labels for the week filter
- reads the `shared-owner` label to mean "assigned to both of you" (Jira only
  allows one assignee, so this is how a joint ticket is marked — see the
  labelling conventions below)
- maps the real Jira assignee to "Mia" or "Nikao" by account ID
- pulls "blocked by" from real Jira issue links (type `Blocks`), not free text
- pulls "reviewer" from a `Reviewer: <name>` line in the description, if present
- prints a plain-English diff — status changes and any new tickets it picked up
  — **read this output and relay it to the user**; it's the actual point of
  running this command, not just the republish

---

## Step 4 — Publish

```
Artifact({
  url: "https://claude.ai/artifact/8ZnGWSvtb9yiv4Sy8cDeJT",
  file_path: "<scratchpad path>/favo-build-tracker.html"
})
```

Omit `title` and `icon` — redeploying keeps both.

---

## Step 5 — Tell the user what changed

Give a short summary from the script's diff output: which tickets moved status,
any newly-created tickets it picked up, and the new totals. Don't just say
"updated" — the changes are the useful part.

---

## Labelling conventions this depends on

If either of you creates a **new** story under one of the 11 epics and want the
tracker to place it correctly, give it:

- **One of** `week-1` / `week-2` / `backlog-deferred` — which run of the plan
  it belongs to. Missing this just means it won't show under the Week filter's
  specific buttons (it still shows under "All").
- **`shared-owner`**, only if the ticket is joint work for both of you and you
  deliberately leave the Jira Assignee field empty. Otherwise just set the
  normal Jira Assignee to Mia or Nikao — no label needed for a single owner.
- A `Reviewer: <name>` line in the description (own paragraph, own line) if you
  want a named reviewer to show on the card. Optional.
- A real "Blocks" issue link to whatever it's blocked by, instead of writing
  that in prose — the tracker reads actual Jira links now, not text.

None of this is enforced by a Jira workflow rule — it's just what the script
looks for. A ticket missing all of it still shows up correctly assigned and
statused; it just won't have a week bucket, a reviewer chip, or a blocked-by
note.

---

## If the script errors

- **"doesn't look like a searchJiraIssuesUsingJql result"** — you passed it
  something other than the raw tool output (e.g. a summary you wrote by hand).
  Re-run the query and save its actual JSON.
- **"Couldn't find the data `<script>` tag"** — the `--html` file isn't the
  tracker page (or someone changed its structure). Re-read the artifact
  (Step 1) and confirm the URL.
- Both account IDs and the `shared-owner`/`week-*` label names are hardcoded at
  the top of `scripts/build-plan/update-tracker-data.ts`. If either of you gets
  a new Atlassian account, or you rename a convention label in Jira, update the
  constants there — that's the one place they're defined.
