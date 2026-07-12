# Prompt for a fresh LLM/agent — full redesign of kozak-genealogy site

Copy everything below into a new session.

---

You're redesigning a genealogy research website end to end. The owner has rejected three separate attempts (by a different agent, in a prior session) at the site's core relationship-visualization tab and is now asking for a completely new plan for the layout of **every tab on the site**, not just that one. Read this whole prompt before touching anything.

## 1. What this is

- Repo: `https://github.com/helioskozak-cloud/kozak-genealogy` (main branch)
- Live site: `https://helioskozak-cloud.github.io/kozak-genealogy/` (GitHub Pages, static)
- Entire front end is **one file**, `index.html` (~3,500 lines: inline `<style>`, inline `<script>` blocks per tab, no build step, no framework, no backend). Data lives in `data/family.json` (~7,450 lines), fetched client-side.
- This is a hobbyist genealogy research site for one family (Kozak/Relihan/Shomsky/Demchak/McGivney), built and maintained by the owner (a non-developer) working with AI coding agents. It documents ~100 people across several generations, with real uncertainty: disputed identities, unconfirmed hypotheses, disproven leads, and prose research notes as well as structured facts.
- Owner's own words on the long-term goal, verbatim: *"I really want a whole re-work of the site that presents the mounds and mounds of data you have in a way that makes it clear to a viewer how all these points are related."*

**Do not assume the existing `index.html` structure, tab list, or any of the four planning markdown files in the repo root (`PRESENTATION_REDESIGN_PLAN.md`, `SITE_REWORK_PLAN.md`, `GENERATIONAL_TREE_PLAN.md`, `SITE_REBUILD_PLAN.md`) represent the right design.** They're the prior agent's own reasoning, and that reasoning produced three rejected results. Read the actual code and data directly to understand what content exists; form your own judgment about how to present it. You are free to change the tab list, information architecture, and visual design of the entire site, not just patch what's there.

## 2. The data, concretely

`data/family.json` top-level keys: `meta`, `branches[]`, `persons{}`, `sources{}`, `businesses{}`, `parts{}`.

- **`persons`** (100 entries): each has `id`, `name`, `branch` (one of `kozak`/`rel`/`shom`/`mcg`/other — paternal Kozak line, maternal Relihan line, Shomsky/Demchak in-laws, McGivney research thread, or married-in/other), `sourceTree` + `sourceKey` (ahnentafel numbering — see below), `kind` (`persons` | `childGroup` | prose-mined), `note` (free text, often containing an informal `b.~YYYY` / `d.~YYYY` fragment plus prose), `facts[][2]` (structured key/value pairs), `prob` (boolean — true means "probable/unconfirmed," should be visually distinguished), `confirm` (links to a user confirm/deny control), `crossRef`, `childGroupInfo`, `partRefs[]`, `openQuestions[]`.
- **Ahnentafel structure**: the data originated as 4 *separate* numbered pedigree trees (`sourceTree` values: `grant`, `tpr`, `mcn`, `mcgivney_family`), each using standard ahnentafel numbering (person `k`'s father is `2k`, mother is `2k+1`). These 4 trees are **not naturally connected** — they were manually cross-linked later via a hand-curated `EXTRA_EDGES` array in `index.html` (currently ~30 entries, each a `[sourceId, targetId, type, prob?]` tuple, types are `parent-child` / `spouse` / `disproven-link`) representing real-world connections between the trees (marriages, disputed sibling relationships, etc.) that the ahnentafel math alone can't express. If you rebuild any relationship view, you need to fold both the ahnentafel-derived edges *and* `EXTRA_EDGES` together — the existing `index.html` fetch callback (search for `fetch('data/family.json')`) shows exactly how this is done today and is a reliable reference for the edge-building logic even if you discard everything else.
- **37 of the 100 people have no traced parent/child link to anyone else** — mostly names mentioned in prose research notes (letters, obituaries, census records) that haven't been connected to the tree yet. Any relationship view needs an honest way to represent "we know this person exists and roughly who they might relate to, but we haven't proven a link" — don't force them into a chart they don't belong in, but don't hide them either.
- **`sources`** (123 entries): `num` (S01-S123), `person`, `relatedPerson`, `clue`, `type`, `citation`, `date`, `confidenceClass`/`confidence` (Confirmed/Probable/Tenuous/Research Only), `notes`, `dataQuirk`, `personRefs[]`, `url` (nullable — most are still null, real source links are rare).
- **`parts`** (46 entries): numbered narrative research write-ups (`number`, `date`, `title`, `sourceRefs[]`, `personRefs[]`, `summary`) — this is the actual prose research log content.
- **`businesses`** (5 entries): business/property records tangentially related to the family (`kind`, `name`, `status`, `personRefs[]`, `sourceRefs[]`, `facts[][2]`, `leadText`).

## 3. Current tabs (what exists today — subject to complete redesign)

1. **Research Log** — the 46 `parts`, chronological prose write-ups, now has search/sort/filter.
2. **Pedigree** — 4 separate static ahnentafel tree charts (one per `sourceTree`), each has a known bug: the auto-fit zoom hardcodes a 200px height target regardless of actual content size, so trees render as a small illegible cluster in a large empty box. Needs fixing or replacing either way.
3. **Open Questions** — flattened `openQuestions[]` from every person, replacing two older redundant tabs (Missing Links, Search Queue) that used to duplicate each other.
4. **Sources** — the 123 sources, data-driven, filterable by person/confidence/branch.
5. **Business & Property** — the 5 business records.
6. **Graph / "Family Tree"** — the tab with the rejected history below. Currently shows a "Full Family" poster (everyone grouped into rows by computed generation) and a "Focus View" (click a person, see their ancestors/descendants in a chart) — **the owner's most recent verbatim reaction to this current state: "Not even a little bit close to right."** No further detail was given on what's specifically wrong with it.

## 4. What's already been tried and rejected for the relationship view — don't repeat blind

In order, all in one prior session, all presented to the owner as finished/verified, all rejected:

1. **A D3 force-directed node graph**, 3 toggle-able modes (physics-simulated "Branch" layout, birth-year "Chronological" timeline, computed-generation "Generational" rows). Owner reaction: *"graph is a mess,"* later *"even worse."* Root cause, confirmed by the prior agent only after the fact: an auto-fit-to-canvas step scaled everything down to fit a small fixed pixel budget regardless of actual content size, so ~100 people rendered as an illegible tiny cluster surrounded by empty canvas — a real, structural bug, not a matter of taste.
2. **A traditional expand/collapse ancestor/descendant tree**, one focus person at a time (click a name to re-center), built in plain CSS/flexbox specifically to avoid the auto-fit bug above. This actually worked well *for what it was* — legible cards, correct generational grouping, real connector lines — but it only ever shows ~15-20 people around one focus person at a time. Owner reaction: *"this still doesn't let me see the big picture."*
3. **A "poster" view**: everyone (all generation-connected people) laid out in one continuous page, one row per computed generation, top (earliest ancestors) to bottom, spouse pairs grouped adjacent, unconnected people in a separate labeled section below. Verified rendering correctly (row counts, card counts, zero console errors, screenshots reviewed directly). Owner reaction: *"Not even a little bit close to right."*

**The actual failure pattern across all three, be aware of it so you don't repeat it**: every attempt was fully built, then "verified" by checking that it rendered correctly / matched the underlying data / had no errors — but that verification never actually confirmed the *design concept* matched what the owner had in mind, because the concept was never checked with the owner *before* building. Do not spend hours building a fully-realized version of your own interpretation of "the big picture" or any other tab's design before getting the owner to confirm the concept. Describe your plan concretely — what will be on screen, roughly how it's organized, what a person does to explore it — and get explicit sign-off on that description before writing the implementation.

## 5. What you're being asked to do

A **complete new layout plan for every tab on the site** — not just the relationship view. Don't assume the current 6-tab structure is right; feel free to propose a different set of tabs/pages if it serves the content better. Ground every decision in the real data above (its actual scale — 100 people, 123 sources, 46 parts, 5 businesses — and its real messiness — unconfirmed hypotheses, disproven leads, 37 unlinked people) rather than a generic "genealogy site" template.

Constraints to respect:
- Static site, one HTML file (or split into multiple files/a small static build if you think that's actually better — just don't introduce a server/backend), deployed via GitHub Pages, no build pipeline currently exists.
- `data/family.json`'s schema can be extended if needed but changes should be additive/backward-compatible-minded — it's hand-maintained data, not something to casually restructure.
- The owner is not a developer. Optimize for them being able to actually look at and understand their own family research, not for engineering elegance.

Before writing implementation code: produce a clear written (or sketched) description of the new plan for **every tab**, including specifically what the relationship/"big picture" view will look like and how it addresses the fact that three prior concrete attempts at that specific problem were all rejected. Get that plan confirmed before building it out.
