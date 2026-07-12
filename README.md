# Ko2ak Genealogy

Rebuild of the family research site, starting from a fresh design (see `FRESH_AGENT_PROMPT.md` for the brief this was built from). Currently running on **dummy data** — `data/family.json` is invented placeholder content for a fictional family, matching the real schema shape. Real family data will be imported later.

## Structure

- `index.html` — single-page shell, all tabs.
- `app.js` — all logic: data loading/edge-building, the Family Tree pan/zoom canvas, People table, Research Log / Sources / Open Questions / Business & Property tabs.
- `data/family.json` — dummy data (`persons`, `sources`, `businesses`, `parts`, `_extraEdges`).

No build step. Open `index.html` via a local static server (e.g. `python -m http.server`) or GitHub Pages.

## Family Tree tab

The core relationship view is a real pan/zoom canvas (not an auto-fit-shrink like prior attempts): everyone is placed at fixed, fully legible card size, grouped into rows by computed generation (union-find over spouse edges + condensed parent/child layering, same math verified correct in the prior project). "Fit whole tree" computes an initial zoom from actual content size vs. actual viewport size — never a hardcoded target — and from there zoom/pan is fully under user control (scroll wheel, drag, pinch on touch).
