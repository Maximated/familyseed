# Expansión de linaje in situ — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the user reveal any person's not-yet-shown parents/children directly onto the currently-viewed tree — attached to that person's real, already-rendered card, with real relationship/union styling — instead of the existing "más ascendientes" button's current behavior of recentering the whole tree onto that person.

**Architecture:** `family-chart`'s exported pure `calculateTree(data, options)` computes positions for a person's own branch independently of the main tree's own hierarchy (the same layout math, no DOM/zoom side effects). The result is aligned onto that person's real on-screen position, then synthesized as plain DOM cards/links that reuse `family-chart`'s own classes and `__data__` shape (`div.card-inner[data-person-id]`, `path.link`, `path.link.union-line`) inside a sibling container the library's own re-renders never touch — so every existing per-render mechanism in `wireCardAndUnionClicks` (union icons, per-marriage line coloring, pan bounds, edit/quick-add/view-full buttons, PNG/SVG export) picks the added content up automatically, with no new code for those parts. The synthesis re-runs on every render pass (the same "settle" idiom already used throughout this file), since `family-chart` doesn't know about this content and would otherwise never redraw it.

**Tech Stack:** React + TypeScript (Vite), `family-chart` v0.9.0 (`frontend/node_modules/family-chart`), i18next.

**Spec:** `docs/superpowers/specs/2026-08-31-inline-lineage-expansion-design.md`

## Global Constraints

- The `.card-ancestry-toggle` button must appear on **every** card, not just ones with unrendered parents (spec §Interacción; confirmed by the user over the current gated behavior).
- First click on a card with no branch open reveals **one level in both directions** (ancestry and progeny) — never the whole lineage at once.
- Deepening beyond one level happens **only** through the floating per-branch panel's own `+`/`-`, never by re-clicking the card's own toggle.
- Re-clicking the card's own toggle while its branch is open **collapses** it entirely.
- Added cards/lines must be visually and behaviorally identical to the main tree's own — no dashed lines, no "preview" styling, real union icons, real editing.
- Opening a branch never disturbs the currently centered person or their own ancestor/descendant level window.
- All open branches reset to empty the moment the centered person (`main_id`) changes.
- `node_separation: 265`, `level_separation: 245`, `single_parent_empty_card: false`, `show_siblings_of_main: true` — the exact same layout constants already configured for the main chart (`chart.setCardXSpacing(265)` / `chart.setCardYSpacing(245)` / `chart.setSingleParentEmptyCard(false)` / `chart.setShowSiblingsOfMain(true)` in `TreeView.tsx`) — a branch's own spacing must match the main tree's grid exactly, or added rows won't line up.
- Every task that touches `frontend/src/TreeView.tsx` ends with `npx tsc -b --force` (run from `frontend/`) reporting no errors, and a Playwright check against a disposable scratch Prisma tree (created via the backend API, cleaned up — user and tree deleted — at the end of the task). Never claim a UI task done from type-checking alone.

---

## File Structure

- **Modify `frontend/src/TreeView.tsx`** — the vast majority of the work: new state, the `renderLineageBranches` rendering function, click wiring, two small extracted helpers.
- **Create `frontend/src/LineageBranchControls.tsx`** — the floating `+`/`-`/`✕` panel per open branch, modeled directly on the existing `frontend/src/CardActionBubble.tsx` (portal to `document.body`, fixed-pixel positioning, unaffected by canvas zoom).
- **Modify `frontend/src/locales/es.json`, `en.json`, `pl.json`** — rename `card.moreAncestry` to `card.expandLineage` (new copy) and add four new keys for the floating panel's button labels.
- **Modify `frontend/src/App.css`** — new `.lineage-branch-controls*` rules (based on the existing `.level-nav-button` recipe) and a `.card-ancestry-toggle-active` modifier for the "already open" icon state.

---

### Task 1: Extract `sortTreeChildren` as a shared, named function

**Files:**
- Modify: `frontend/src/TreeView.tsx:2203-2219` (the inline arrow passed to `chart.setSortChildrenFunction`)

**Interfaces:**
- Produces: `sortTreeChildren(a: { main?: boolean; data: { birthDateValue?: unknown; ["first name"]?: unknown; ["last name"]?: unknown } }, b: same): number` — a module-level function (declared near the file's other bare helper functions, e.g. right after `pairKey` at line 328-330), so both `chart.setSortChildrenFunction(sortTreeChildren)` and a later `f3.calculateTree(..., { sortChildrenFunction: sortTreeChildren })` call can share the exact same ordering logic without duplicating it.

This is a pure refactor — no behavior change. Needed because Task 5 calls `f3.calculateTree()` directly for a branch, and a branch's own children/siblings must sort exactly the same way the main tree's do (main-first, then birth date, then name) or a person's branch would visibly re-order their kids differently from how they're ordered everywhere else in the same tree.

- [ ] **Step 1: Add the extracted function**

Insert right after `pairKey` (after line 330):

```typescript
// Shared by the main chart's own chart.setSortChildrenFunction below and
// by calculateTree()'s matching option when computing a lineage branch
// (see renderLineageBranches) — a branch's children/siblings must sort
// exactly the same way the main tree's do, or the same person's kids
// would visibly reorder depending on which rendering path drew them.
//
// Reported bug this fixes: selecting one of several siblings as main
// scrambled the rest instead of keeping them in birth-date order. Root
// cause is in family-chart's own setupSiblings (family-chart.esm.js): it
// looks siblings up via a plain data_stash.filter (order = the array we
// handed the chart, unrelated to birth date), then its positionSiblings
// sorts the whole [main, ...siblings] list with this hook — or, absent
// one, not at all — before fanning everyone out left/right of wherever
// main lands in that sorted list. Every data_stash entry already has a
// real `.main` boolean by the time this runs (set by the library itself,
// one step before this hook's first call), so this both keeps main
// pinned at the front (same feel as before — the request was to keep
// main leftmost) and sorts the actual siblings after it by birth date
// instead of that incidental array order. Same hook also runs for
// ordinary parent→children sorting elsewhere, where nothing is ever
// main — there this is just a birth-date sort, matching the order the
// backend's own sortChildren (tree-data.ts) already sends, so it's a
// no-op for that path.
function sortTreeChildren(
  a: { main?: boolean; data: Record<string, unknown> },
  b: { main?: boolean; data: Record<string, unknown> },
): number {
  if (a.main && !b.main) return -1;
  if (b.main && !a.main) return 1;
  const aDate = a.data.birthDateValue as string | undefined;
  const bDate = b.data.birthDateValue as string | undefined;
  if (aDate && bDate) {
    const diff = new Date(aDate).getTime() - new Date(bDate).getTime();
    if (diff !== 0) return diff;
  } else if (aDate) {
    return -1;
  } else if (bDate) {
    return 1;
  }
  const aName = `${a.data["first name"] ?? ""} ${a.data["last name"] ?? ""}`;
  const bName = `${b.data["first name"] ?? ""} ${b.data["last name"] ?? ""}`;
  return aName.localeCompare(bName);
}
```

- [ ] **Step 2: Replace the inline arrow with the extracted function**

At what is now (after Step 1's insertion shifts line numbers) the `chart.setSortChildrenFunction(...)` call, replace the whole inline arrow body with:

```typescript
        chart.setSortChildrenFunction(sortTreeChildren);
```

Delete the now-duplicated comment block above the old inline arrow (it moved to the extracted function in Step 1).

- [ ] **Step 3: Verify no regression**

Run `cd frontend && npx tsc -b --force` — expect no errors.

Then, with the dev servers already running (`npm run dev` in both `backend/` and `frontend/`, MariaDB in Docker — do not start them yourself if already running; ask the user to confirm they're up if unsure), open any existing tree with a person who has 2+ children in Playwright and confirm the children still render left-to-right in birth-date order (same as before this change) — this is a pure refactor, so any visible reordering means the extraction introduced a bug.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/TreeView.tsx
git commit -m "Extract sortTreeChildren so lineage branches can share it"
```

---

### Task 2: Extract `getCardScreenPos` as a shared, module-level function

**Files:**
- Modify: `frontend/src/TreeView.tsx:1812-1818` (the local `cardWrapperPixelPos` const, currently defined inside the only-child-fix section of `wireCardAndUnionClicks`)

**Interfaces:**
- Produces: `getCardScreenPos(container: HTMLElement, personId: string): { wrapper: HTMLElement; x: number; y: number } | null` — a module-level function (declared near `pairKey`/`sortTreeChildren`). Renamed from `cardWrapperPixelPos` to `getCardScreenPos` because it now takes `container` explicitly instead of closing over it, and Task 5 needs the exact same lookup (find a person's already-rendered card, read the pixel `translate(x, y)` off its wrapper's own `style` attribute) to anchor a lineage branch onto that person's real screen position.

This is also a pure refactor. `wireCardAndUnionClicks`'s own only-child-fix code keeps working unchanged — it just calls the module-level version instead of a local const.

- [ ] **Step 1: Add the extracted function**

Insert right after `sortTreeChildren` (from Task 1):

```typescript
// Reads a person's already-rendered card position straight off the DOM
// rather than from family-chart's own internal node objects — the two
// rendering layers (the SVG links layer and this HTML cards layer) apply
// their own independent scale/offset, and this is the one thing that's
// never stale regardless of how many layout passes have happened since
// the card was last positioned. `container` is passed explicitly (rather
// than closed over) so this can be called both from wireCardAndUnionClicks
// (the only-child fix) and from renderLineageBranches (anchoring a new
// branch onto the card that spawned it) without either owning the other.
function getCardScreenPos(container: HTMLElement, personId: string): { wrapper: HTMLElement; x: number; y: number } | null {
  const card = container.querySelector<HTMLElement>(`.card[data-id="${personId}"]`);
  const wrapper = card?.parentElement ?? null;
  const style = wrapper?.getAttribute("style");
  const match = style?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
  return match ? { wrapper: wrapper!, x: Number(match[1]), y: Number(match[2]) } : null;
}
```

- [ ] **Step 2: Replace the local definition with a call to the shared one**

At `frontend/src/TreeView.tsx:1812-1818`, delete the local `const cardWrapperPixelPos = (personId: string) => { ... }` block entirely. Every call site within that same function (`cardWrapperPixelPos(targetId)`, `cardWrapperPixelPos(spouseId)`, etc. — lines 2073, 2074, 2093, 2107 as of this writing) becomes `getCardScreenPos(container, targetId)`, `getCardScreenPos(container, spouseId)`, etc. (`container` is already in scope throughout `wireCardAndUnionClicks`).

- [ ] **Step 3: Verify no regression**

Run `cd frontend && npx tsc -b --force` — expect no errors.

Build a disposable scratch tree via the backend API reproducing the "only-child union desync" scenario this code exists for (a person who is an only child, with 2+ spouses of their own): register a scratch user, create a tree, create the only-child person + two spouse Individuals, create two Family rows (each with the only-child as one partner), add one Individual as a child under each Family so both unions have descendants. Open the tree in Playwright, confirm both marriages' descent trunks still connect cleanly to the only child's card (no visible gap or crooked line) — the exact regression this code was written to prevent. Delete the scratch tree/user afterward via a small script using `prisma.tree.delete` (cascades) + `prisma.user.deleteMany` for that email.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/TreeView.tsx
git commit -m "Extract getCardScreenPos so lineage branches can share it"
```

---

### Task 3: Always show the "expand lineage" button, with new copy

**Files:**
- Modify: `frontend/src/TreeView.tsx:659` (the button's `title`/`aria-label` in `cardTemplate`)
- Modify: `frontend/src/TreeView.tsx:1096-1111` (`updateAncestryToggles` — remove the gating)
- Modify: `frontend/src/locales/es.json`, `frontend/src/locales/en.json`, `frontend/src/locales/pl.json`

**Interfaces:**
- Produces: i18n key `card.expandLineage` (replaces `card.moreAncestry`, which is deleted from all three files since nothing else references it — confirm with `grep -rn "moreAncestry" frontend/src` before deleting, expect zero remaining matches).

This task ships independently: after it, the button visually appears everywhere and reads correctly, even though clicking it still does today's "recenter" behavior until Task 8 rewires it. That's fine as an intermediate state — the button's new meaning ("open a lineage branch from here") isn't live yet, so the temporary mismatch between copy and behavior is invisible to anyone not reading the plan.

- [ ] **Step 1: Update the three locale files**

In `frontend/src/locales/es.json`, replace the `"moreAncestry": "..."` line (currently line 107) with:

```json
    "expandLineage": "Mostrar sus padres/hijos que aún no se ven en el árbol",
```

In `frontend/src/locales/en.json`, replace the equivalent `moreAncestry` line with:

```json
    "expandLineage": "Show their parents/children not yet shown in the tree",
```

In `frontend/src/locales/pl.json`, replace the equivalent `moreAncestry` line with:

```json
    "expandLineage": "Pokaż jego/jej rodziców/dzieci, którzy nie są jeszcze widoczni",
```

Keep each key in the same object position it was in (same `card.` section) so the three files stay in the same key order — this project has previously verified key-parity across the three locale files by comparing total key counts; re-run that check in Step 3.

- [ ] **Step 2: Update the button and remove the gating**

At `frontend/src/TreeView.tsx:659`, change both `i18n.t("card.moreAncestry")` occurrences to `i18n.t("card.expandLineage")`.

At `frontend/src/TreeView.tsx:1096-1111` (`updateAncestryToggles`), replace the whole function body with one that always shows the button:

```typescript
    function updateAncestryToggles() {
      const el = container as HTMLDivElement;
      el.querySelectorAll<HTMLButtonElement>(".card-ancestry-toggle").forEach((btn) => {
        btn.style.display = "";
      });
    }
```

Leave every call site of `updateAncestryToggles()` as-is (it's still needed — Task 9 extends this same function to also toggle the button's "active" visual state per open branch, and Task 5's positioning re-check reuses the same settle timer this function already runs on).

- [ ] **Step 3: Verify**

Run `cd frontend && npx tsc -b --force` — expect no errors.

Run `node -e "for (const f of ['es','en','pl']) { const j = require('./frontend/src/locales/'+f+'.json'); console.log(f, Object.keys(j).reduce((n,k)=>n+Object.keys(j[k]).length,0)); }"` from the repo root — expect the same total key count across all three (confirms the rename didn't drop a key in one file while keeping it in another).

Open any existing tree in Playwright and confirm the "rama de git" icon now appears on **every** visible card — including ones that never showed it before (e.g. the centered person's own children, who have no unrendered-parent condition to trigger the old gating) — and that hovering one shows the new tooltip text.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/TreeView.tsx frontend/src/locales/es.json frontend/src/locales/en.json frontend/src/locales/pl.json
git commit -m "Show the expand-lineage button on every card, with new copy"
```

---

### Task 4: State model for open lineage branches

**Files:**
- Modify: `frontend/src/TreeView.tsx` (new state near the other selection state, ~line 840; reset wiring inside `chart.setAfterUpdate`, ~line 2273-2312)

**Interfaces:**
- Produces:
  ```typescript
  type LineageBranch = { rootPersonId: string; ancestryDepth: number; progenyDepth: number };
  ```
  `const [lineageBranches, setLineageBranches] = useState<LineageBranch[]>([]);`
  `const lineageBranchesRef = useRef<LineageBranch[]>([]);` kept in sync via `useEffect(() => { lineageBranchesRef.current = lineageBranches; }, [lineageBranches]);` — same pattern this file already uses for `orientationRef`/`orientation`. `renderLineageBranches` (Task 5) reads the ref (never stale inside an imperative DOM callback); the JSX for the floating panel (Task 9) reads the plain state (React re-renders correctly on change).
- Consumes: nothing new yet — this task only adds state and its reset wiring; nothing reads `lineageBranches` until Task 5.

- [ ] **Step 1: Add the type and state**

Near `const [ancestorLevels, setAncestorLevels] = useState(DEFAULT_ANCESTOR_LEVELS);` (line 840), add:

```typescript
  type LineageBranch = { rootPersonId: string; ancestryDepth: number; progenyDepth: number };
  const [lineageBranches, setLineageBranches] = useState<LineageBranch[]>([]);
  const lineageBranchesRef = useRef<LineageBranch[]>([]);
  useEffect(() => {
    lineageBranchesRef.current = lineageBranches;
  }, [lineageBranches]);
```

(Move the `type LineageBranch = ...` line to module scope, alongside `LevelState`-style types if this file already declares similar types outside the component — check for an existing `type UnionChild = ...`-style pattern near the top of the file and match it; if all such types already live inside the component function itself, keep it there for consistency.)

- [ ] **Step 2: Reset on navigation**

At `frontend/src/TreeView.tsx:2273-2312` (`chart.setAfterUpdate`'s reset block), inside the `if (newMainId !== currentMainIdRef.current)` branch, alongside the existing `setAncestorLevels(nextAncestorLevels); setDescendantLevels(nextDescendantLevels);` calls, add:

```typescript
              setLineageBranches([]);
```

This must run in both the `chartRef.current` branch (the normal case, which currently does `chart.setAncestryDepth(...); chart.setProgenyDepth(...); chart.updateTree({}); return;`) — add it right before that `return;`.

- [ ] **Step 3: Verify**

Run `cd frontend && npx tsc -b --force` — expect no errors (state with no reader is still valid TypeScript, no unused-variable errors since `lineageBranchesRef` is read in the `useEffect`'s own closure... actually it's only ever written to, never read yet at this point in the plan — if `tsc`/`oxlint` flags an unused-value warning, that's fine to leave since Task 5 starts reading it immediately after; do not add a workaround for a one-task-long gap).

No Playwright check needed for this task alone — there is nothing to observe yet (state with no UI consumer). Task 5's own verification covers this.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/TreeView.tsx
git commit -m "Add lineage-branch state, reset on navigation"
```

---

### Task 5: `renderLineageBranches` — compute and inject cards (no lines yet)

This is the architectural core of the feature. It's split from Task 6 (lines) deliberately: a task a reviewer could reject on its own (cards appear in roughly the right place) without also having to evaluate line-drawing correctness at the same time.

**Files:**
- Modify: `frontend/src/TreeView.tsx` (new `useCallback`, declared right before `wireCardAndUnionClicks` at line 960; wired into `chart.setAfterUpdate` right before the existing `wireCardAndUnionClicks()` call at line 2314)

**Interfaces:**
- Consumes: `LineageBranch` (Task 4), `getCardScreenPos` (Task 2), `sortTreeChildren` (Task 1), `cardTemplate` (existing, line 625), `f3.calculateTree` (library export), `TreePerson` (existing type from `./api`), `orientationRef` (existing ref).
- Produces: `renderLineageBranches(): void` — a `useCallback`, stable across renders the same way `wireCardAndUnionClicks` is (same dependency array pattern: whatever refs/state it closes over that aren't refs). Called from two places: (a) inside `chart.setAfterUpdate`, immediately before `wireCardAndUnionClicks()`; (b) directly after every `setLineageBranches(...)` call (Task 8 and Task 9 add these call sites) — because a plain React state change does **not** trigger `family-chart`'s own `chart.updateTree()`/`setAfterUpdate`, so nothing else would re-run this function when a branch is opened, deepened, or collapsed.

Everything this task's `renderLineageBranches` creates lives inside one container: `<g class="lineage-extra-view">` for cards' SVG-side needs — actually cards are HTML, not SVG (see below) — so precisely: a plain `<div class="lineage-extra-cards">` for cards, sibling to whatever element hosts `family-chart`'s own `#htmlSvg`/card layer, both living directly under `container` (the `.f3` div). `family-chart` only ever calls `d3.select(svg).select(".cards_view")`/`.select(".links_view")` (both scoped **inside its own SVG**, matched by exact class name) — a sibling div with a different class name is never touched by that selector, so nothing here ever gets exit-removed by `family-chart`'s own re-renders.

- [ ] **Step 1: Add the branch-tree data type alias and the container helper**

Right before the `wireCardAndUnionClicks` declaration (`const wireCardAndUnionClicks = useCallback(() => {`, line 960), add:

```typescript
  // The v1/"legacy" input shape f3.calculateTree() expects — same escape
  // hatch (`as unknown as`) the existing f3.createChart(containerRef.current,
  // people as unknown as ChartData) call already uses two lines below this
  // one, for the same reason: TreePerson's own rels shape (parents/children/
  // spouses id arrays) is structurally what family-chart wants but TS can't
  // verify it through the library's own exported types without a cast.
  type BranchTreeInput = Parameters<typeof f3.calculateTree>[0];

  // family-chart only ever queries its own `.cards_view`/`.links_view` by
  // exact class name (see updateCardsSvg/updateLinks in family-chart.esm.js)
  // — a sibling container with a different class, living directly under the
  // same `.f3` root, is never part of that selection, so its own re-renders
  // can never exit-remove anything placed here. Created once and reused
  // (not recreated every render) so DOM identity is stable across passes.
  function getOrCreateLineageExtraLayer(container: HTMLElement): HTMLDivElement {
    let layer = container.querySelector<HTMLDivElement>(":scope > .lineage-extra-view");
    if (!layer) {
      layer = document.createElement("div");
      layer.className = "lineage-extra-view";
      container.appendChild(layer);
    }
    return layer;
  }
```

- [ ] **Step 2: Add `renderLineageBranches` itself**

Right after the helper from Step 1 (still before `wireCardAndUnionClicks`):

```typescript
  const renderLineageBranches = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const layer = getOrCreateLineageExtraLayer(container);
    // Rebuilt from scratch on every pass rather than diffed — the number
    // of open branches is small (a handful at most, opened by hand), so
    // the simplicity of "clear and redraw" outweighs any cost of
    // incremental patching here.
    layer.innerHTML = "";

    const isHorizontal = orientationRef.current === "horizontal";
    const people = treeDataRef.current;

    // Ids already claimed by a real, currently-rendered main-tree card —
    // a branch never duplicates someone already visible there (same
    // reasoning this app already applies to genealogical loops: the
    // already-existing card wins). Mutated as each branch below places its
    // own cards (see the end of the `for (const node of result.data)` cards
    // loop), so a *later* branch in this same pass also skips anyone a
    // *earlier* branch just placed — without this, opening two branches
    // that both reach the same third person in one pass would render that
    // person twice.
    const placedPersonIds = new Set(
      [...container.querySelectorAll<HTMLElement>(".card-inner[data-person-id]")]
        .map((el) => el.dataset.personId)
        .filter((id): id is string => id !== undefined),
    );

    for (const branch of lineageBranchesRef.current) {
      const anchor = getCardScreenPos(container, branch.rootPersonId);
      if (!anchor) continue; // root card isn't currently rendered — nothing to anchor onto

      let result: ReturnType<typeof f3.calculateTree>;
      try {
        result = f3.calculateTree(people as unknown as BranchTreeInput, {
          main_id: branch.rootPersonId,
          node_separation: 265,
          level_separation: 245,
          is_horizontal: isHorizontal,
          single_parent_empty_card: false,
          show_siblings_of_main: true,
          sortChildrenFunction: sortTreeChildren,
          ancestry_depth: branch.ancestryDepth,
          progeny_depth: branch.progenyDepth,
        });
      } catch {
        // Same family-chart crash documented on minAncestorLevels above
        // (setupSiblings needs the parent's own hierarchy node, which
        // ancestry_depth can trim away) — a branch whose root has
        // siblings can't safely go below ancestryDepth 1. Task 9's own
        // "-" button floor already prevents this from being reachable
        // through the UI; this catch is the last line of defense so a
        // stray bad state never crashes the whole tree render.
        continue;
      }

      const rootNode = result.data.find((n) => n.data.id === branch.rootPersonId);
      if (!rootNode) continue;

      // family-chart's own coordinate convention: x is the spread axis
      // (siblings/spouses side by side), y is the depth axis (generation)
      // in vertical mode; swapped in horizontal mode (see
      // correctLinkTextTransform's own comment on this same swap
      // elsewhere in this file).
      const offsetX = isHorizontal ? anchor.x - rootNode.y : anchor.x - rootNode.x;
      const offsetY = isHorizontal ? anchor.y - rootNode.x : anchor.y - rootNode.y;
      const screenX = (n: { x: number; y: number }) => (isHorizontal ? n.y + offsetX : n.x + offsetX);
      const screenY = (n: { x: number; y: number }) => (isHorizontal ? n.x + offsetY : n.y + offsetY);

      for (const node of result.data) {
        if (node.data.id === branch.rootPersonId) continue; // already on screen for real
        if (placedPersonIds.has(node.data.id)) continue; // visible elsewhere already — don't duplicate

        // Two nested elements, matching family-chart's own structure
        // exactly (see updateCardsSvg/CardHtmlWrapper in family-chart.esm.js:
        // an outer wrapper carrying the pixel translate(), and an inner
        // `div.card[data-id]` offset by translate(-50%, -50%) so the outer
        // wrapper's point is the card's *center*, not its top-left corner.
        // getCardScreenPos/applyPanBounds/Task 7's own collision check all
        // key off `.card[data-id]` specifically — without this exact inner
        // element, a branch-added card would silently fail to be found by
        // any of those, and would render offset by half its own size from
        // where a real family-chart card would sit at the same coordinates.
        const wrapper = document.createElement("div");
        wrapper.style.position = "absolute";
        wrapper.style.transform = `translate(${screenX(node)}px, ${screenY(node)}px)`;
        const cardEl = document.createElement("div");
        cardEl.className = "card";
        cardEl.dataset.id = node.data.id;
        cardEl.style.transform = "translate(-50%, -50%)";
        cardEl.style.pointerEvents = "auto";
        cardEl.innerHTML = cardTemplate({ data: node.data });
        wrapper.appendChild(cardEl);
        layer.appendChild(wrapper);
        placedPersonIds.add(node.data.id);
      }
    }
  }, []);
```

Note: this step deliberately omits collision-avoidance (Task 7) and link-drawing (Task 6) — verify cards-only first.

- [ ] **Step 3: Wire it into the render cycle**

At `frontend/src/TreeView.tsx:2314` (inside `chart.setAfterUpdate`, right before the existing `wireCardAndUnionClicks();` call), add the new call immediately above it:

```typescript
          renderLineageBranches();
          wireCardAndUnionClicks();
```

- [ ] **Step 4: Verify with a temporary manual trigger**

This task has no click handler yet (Task 8 adds it) — verify by calling the function directly from the browser console against a real running tree:

Build a disposable scratch tree via the backend API with at least: a person `X` who has one recorded parent `P` not currently rendered from the centered person, and `X` has one child `C`. Open the tree in Playwright, evaluate in-page:

```js
() => {
  // Simulate what Task 8's click handler will eventually do.
  window.__testAddBranch = (rootPersonId) => {
    const event = new CustomEvent("test-add-lineage-branch", { detail: { rootPersonId } });
    window.dispatchEvent(event);
  };
}
```

— actually, simpler: since `renderLineageBranches` reads `lineageBranchesRef.current` and there is no click handler yet, directly exercise React state from Playwright is not practical without one. Instead, temporarily verify by hardcoding a single test entry: add `lineageBranchesRef.current = [{ rootPersonId: "<X's id>", ancestryDepth: 1, progenyDepth: 1 }];` as a **temporary** line inside `renderLineageBranches` right after `const people = treeDataRef.current;`, guarded so it only ever runs once (e.g. behind a module-level `let __devSeeded = false;` flag flipped after use), run the Playwright check, confirm `P` and `C`'s cards now appear as plain absolutely-positioned divs near `X`'s real card, then **delete this temporary line before committing** — Step 3's real wiring plus Task 8's click handler are the actual, permanent way branches get added.

Confirm via `container.querySelector('.lineage-extra-view')` in the browser that the new cards are direct children of that div, and via `getComputedStyle` / a screenshot that they render with the same card visuals (avatar, name, lifespan) as any other card, positioned in the right neighborhood of `X`.

Clean up the scratch tree/user afterward.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/TreeView.tsx
git commit -m "Render lineage-branch cards (no lines yet), anchored to the real card"
```

---

### Task 6: Draw relationship/union lines for a lineage branch

**Files:**
- Modify: `frontend/src/TreeView.tsx` (extend `renderLineageBranches`)

**Interfaces:**
- Consumes: `PathLinkNode`/`PathLinkDatum` types (existing, lines 367-368), `pairKey` (existing, line 328), `unionsByPairKeyRef` (existing ref, built at line ~2044 from the tree's full `unions` list).
- Produces: for every parent-child and spouse relationship among the branch's rendered nodes (or between a rendered node and a real, already-on-screen card), a `<path class="link">` (`class="link union-line"` for a spouse pair with a known union) appended to the SAME `.lineage-extra-view` layer, with a `__data__` property shaped exactly like `family-chart`'s own (`{ source, target }`, each a `PathLinkNode`-shaped `{ data: { id }, x, y, sx? }`) — this is what makes `wireCardAndUnionClicks`'s own existing union-line classification loop (line ~1230), marriage-color loop (added earlier this session), and export color overrides (`handleExportTreeImage`) treat these exactly like real `family-chart` output, since all of those select by `path.link`/`.union-line` class and read `.__data__`, never by "did family-chart create this."

`family-chart`'s own `TreeDatum` (the shape of each entry in `f3.calculateTree()`'s `result.data`) already carries resolved `.parents`, `.children`, `.spouses` arrays of other `TreeDatum` objects (confirmed via `frontend/node_modules/family-chart/dist/types/types/treeData.d.ts`) — this task walks those directly rather than re-deriving relationships from `rels`.

- [ ] **Step 1: Extend `renderLineageBranches` to draw lines**

Inside the same `for (const branch of ...)` loop from Task 5, after the `for (const node of result.data) { ... }` cards loop, add a second pass over the same `result.data` that draws links. First, build a lookup of every node actually placed on screen this pass (both the ones this task just created and any real main-tree/other-branch card, so a line can connect to either):

```typescript
      // `placedPersonIds` at this point also already contains every node
      // *this same branch's* cards loop (Task 5) just placed, not only
      // real main-tree/earlier-branch ones — that's fine, not just "not a
      // bug": by now those cards genuinely exist in the DOM with the exact
      // `.card[data-id]` structure Task 5 gives them, so getCardScreenPos
      // resolves the very same position screenX/screenY would have
      // computed, just read back from the DOM instead of recomputed —
      // one lookup path instead of branching on "mine vs. someone else's".
      const placedScreenPos = new Map<string, { x: number; y: number; sx?: number }>();
      for (const node of result.data) {
        if (placedPersonIds.has(node.data.id) && node.data.id !== branch.rootPersonId) {
          const real = getCardScreenPos(container, node.data.id);
          if (real) placedScreenPos.set(node.data.id, { x: real.x, y: real.y });
          continue;
        }
        placedScreenPos.set(node.data.id, {
          x: screenX(node),
          y: screenY(node),
          sx: typeof node.sx === "number" ? (isHorizontal ? node.sx + offsetY : node.sx + offsetX) : undefined,
        });
      }
      placedScreenPos.set(branch.rootPersonId, { x: anchor.x, y: anchor.y, sx: rootNode.sx });

      function makeLinkPath(sourceIds: [string, string] | string, targetId: string, isSpouse: boolean) {
        const targetPos = placedScreenPos.get(targetId);
        if (!targetPos) return;
        const sourceArr = Array.isArray(sourceIds) ? sourceIds : [sourceIds];
        const sourceNodes = sourceArr
          .map((id) => {
            const pos = placedScreenPos.get(id);
            return pos ? { data: { id }, x: pos.x, y: pos.y, sx: pos.sx } : null;
          })
          .filter((n): n is { data: { id: string }; x: number; y: number; sx?: number } => n !== null);
        if (sourceNodes.length === 0) return;

        const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
        path.setAttribute("class", isSpouse ? "link union-line" : "link");
        const datum = {
          source: isSpouse ? sourceNodes[0] : sourceNodes,
          target: { data: { id: targetId }, x: targetPos.x, y: targetPos.y },
        };
        (path as unknown as { __data__: typeof datum }).__data__ = datum;

        if (isSpouse) {
          const [x1, y1] = [sourceNodes[0].x, sourceNodes[0].y];
          path.setAttribute("d", `M${x1},${y1}L${targetPos.x},${targetPos.y}`);
        } else {
          const parentDepth = isHorizontal ? sourceNodes[0].x : sourceNodes[0].y;
          const childDepth = isHorizontal ? targetPos.y : targetPos.x;
          const anchorSpreadRaw = sourceNodes.length > 1 ? sourceNodes[1].sx : sourceNodes[0].sx;
          const anchorSpread = anchorSpreadRaw ?? (isHorizontal ? sourceNodes[0].y : sourceNodes[0].x);
          const childSpread = isHorizontal ? targetPos.x : targetPos.y;
          const elbow = childDepth + (parentDepth - childDepth) / 2;
          const point = (depth: number, spread: number) => (isHorizontal ? `${depth},${spread}` : `${spread},${depth}`);
          path.setAttribute(
            "d",
            `M${point(childDepth, childSpread)}L${point(elbow, childSpread)}L${point(elbow, anchorSpread)}L${point(parentDepth, anchorSpread)}`,
          );
        }
        const svgHost = document.createElementNS("http://www.w3.org/2000/svg", "svg");
        svgHost.setAttribute("class", "lineage-extra-links-host");
        svgHost.appendChild(path);
        layer.appendChild(svgHost);
      }

      for (const node of result.data) {
        for (const child of node.children ?? []) {
          if (!placedScreenPos.has(child.data.id)) continue;
          const otherParent = (node.spouses ?? []).find((sp) => (child.parents ?? []).some((p) => p.data.id === sp.data.id));
          const parentIds: [string, string] = otherParent ? [node.data.id, otherParent.data.id] : [node.data.id, node.data.id];
          makeLinkPath(parentIds, child.data.id, false);
        }
        for (const spouse of node.spouses ?? []) {
          if (!placedScreenPos.has(spouse.data.id)) continue;
          if (node.data.id > spouse.data.id) continue; // draw each spouse pair once, not twice
          makeLinkPath(node.data.id, spouse.data.id, true);
        }
      }
```

Each `<svg class="lineage-extra-links-host">` is a minimal, unstyled, full-bleed absolutely-positioned SVG purely to legally host an SVG `<path>` outside of `family-chart`'s own SVG document — add the matching CSS in Task 6's Step 2 below so it doesn't clip or offset the path's own absolute coordinates.

- [ ] **Step 2: Add the hosting CSS**

In `frontend/src/App.css`, near the other `.tree-container`/`.f3` rules, add:

```css
/* Each lineage-branch link gets its own tiny host <svg> (see
   renderLineageBranches) purely so a <path> can exist outside family-
   chart's own SVG document — the path's own d attribute already carries
   absolute coordinates in the same space the cards layer uses, so the
   host itself must never clip or transform that: full-bleed, invisible
   overflow, zero own footprint. */
.lineage-extra-links-host {
  position: absolute;
  top: 0;
  left: 0;
  width: 0;
  height: 0;
  overflow: visible;
  pointer-events: none;
}

.lineage-extra-links-host path.link {
  pointer-events: auto;
}
```

- [ ] **Step 3: Verify**

Reuse Task 5's temporary-seed technique (a single hardcoded `lineageBranchesRef.current = [...]` line, removed before committing) against a scratch tree where the branch's root has both an unrendered parent and an unrendered child, and where that parent has a spouse (so a `.union-line` gets drawn too). Confirm in Playwright:
- A `path.link` connects the branch's child to the root card, and another connects the root card to its revealed parent(s), both rendered in the same visual style as the main tree's own lines (reuse the app's existing `.f3 path.link { stroke: var(--color-forest); }` rule — since these paths carry the plain `link` class, they already match that selector with no extra CSS needed).
- If the revealed parent has a real union recorded (create one in the scratch data), hovering the new `path.link.union-line` reveals the same union icon bubble the main tree's own union lines show, and clicking it opens the same `InfoPanel` union view (both are handled by `wireCardAndUnionClicks`'s existing per-render loop, which now also finds this new element — no new code needed for that, but this step is where a hookup mistake in `__data__`'s shape or the `pairKey` lookup would actually surface).

Clean up the scratch tree/user afterward.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/TreeView.tsx frontend/src/App.css
git commit -m "Draw relationship/union lines for lineage-branch cards"
```

---

### Task 7: Collision avoidance between an added branch and existing content

**Files:**
- Modify: `frontend/src/TreeView.tsx` (extend `renderLineageBranches`)

**Interfaces:**
- Consumes: nothing new — this task adds a pre-pass before Task 5/6's placement math runs, shifting the whole branch's `offsetX`/`offsetY` (computed in Task 5's Step 2) sideways in fixed increments until no placed node's box overlaps an already-occupied one.

- [ ] **Step 1: Track occupied rectangles across the whole render pass**

Right before the `for (const branch of lineageBranchesRef.current)` loop in `renderLineageBranches` (Task 5), add:

```typescript
    // Card footprint in the same coordinate space `.x`/`.y` already use —
    // matches the real card size family-chart itself lays out to (see
    // chart.setCardXSpacing(265)/setCardYSpacing(245) above: spacing, not
    // card size directly, but the card itself is comfortably smaller than
    // its own spacing slot, so treating a slightly-smaller box than the
    // full spacing as "occupied" avoids flagging two properly-spaced,
    // legitimately-adjacent cards as colliding with each other).
    const CARD_BOX_WIDTH = 220;
    const CARD_BOX_HEIGHT = 200;
    const occupied: { x: number; y: number }[] = [
      ...[...container.querySelectorAll<HTMLElement>(".card[data-id]")].map((card) => {
        const w = card.parentElement;
        const style = w?.getAttribute("style");
        const match = style?.match(/translate\(([-\d.]+)px,\s*([-\d.]+)px\)/);
        return match ? { x: Number(match[1]), y: Number(match[2]) } : null;
      }),
    ].filter((p): p is { x: number; y: number } => p !== null);
    const overlaps = (ax: number, ay: number, bx: number, by: number) =>
      Math.abs(ax - bx) < CARD_BOX_WIDTH && Math.abs(ay - by) < CARD_BOX_HEIGHT;
```

- [ ] **Step 2: Shift a colliding branch sideways before placing it**

Immediately after computing `offsetX`/`offsetY` in Task 5's Step 2 (right after the `const screenY = ...` line, before the `for (const node of result.data)` cards loop), add:

```typescript
      const SHIFT_STEP = isHorizontal ? 0 : 300;
      const SHIFT_STEP_Y = isHorizontal ? 220 : 0;
      let shiftAttempt = 0;
      let adjustedOffsetX = offsetX;
      let adjustedOffsetY = offsetY;
      const candidateScreenX = (n: { x: number; y: number }) => (isHorizontal ? n.y + adjustedOffsetX : n.x + adjustedOffsetX);
      const candidateScreenY = (n: { x: number; y: number }) => (isHorizontal ? n.x + adjustedOffsetY : n.y + adjustedOffsetY);
      const nonRootNodes = result.data.filter((n) => n.data.id !== branch.rootPersonId && !placedPersonIds.has(n.data.id));
      while (
        shiftAttempt < 20 &&
        nonRootNodes.some((n) => occupied.some((o) => overlaps(candidateScreenX(n), candidateScreenY(n), o.x, o.y)))
      ) {
        shiftAttempt += 1;
        adjustedOffsetX = offsetX + shiftAttempt * SHIFT_STEP;
        adjustedOffsetY = offsetY + shiftAttempt * SHIFT_STEP_Y;
      }
```

Then replace the two `screenX`/`screenY` const declarations from Task 5's Step 2 to close over `adjustedOffsetX`/`adjustedOffsetY` instead of `offsetX`/`offsetY`:

```typescript
      const screenX = (n: { x: number; y: number }) => (isHorizontal ? n.y + adjustedOffsetX : n.x + adjustedOffsetX);
      const screenY = (n: { x: number; y: number }) => (isHorizontal ? n.x + adjustedOffsetY : n.y + adjustedOffsetY);
```

Finally, record each card this branch actually places as newly occupied, so the **next** branch in the same pass avoids it too. Do this inline in Task 5's own cards loop — not as a separate pass afterward — precisely because that loop already applies the right guards (skips the root, skips anyone already placed elsewhere); re-deriving the same "was this really placed by me just now" condition a second time from `placedPersonIds` after the fact doesn't work, since Task 5's own loop has, by that point, already added every one of this branch's ids into `placedPersonIds` itself. In Task 5's Step 2 cards loop, right after `placedPersonIds.add(node.data.id);`, add one line:

```typescript
        placedPersonIds.add(node.data.id);
        occupied.push({ x: screenX(node), y: screenY(node) });
```

So that loop now ends with those two lines in that order, still inside the same `for (const node of result.data) { ... }` block from Task 5.

- [ ] **Step 3: Verify**

Scratch tree with two people, `X` and `Y`, whose cards render close together in the main view and who each have their own separate, unrendered parent. Open both branches (via the temporary seed technique from Task 5, seeding two entries this time) and confirm in Playwright — via each new card's own bounding rect — that no two cards (from either branch, or from either branch and the main tree) visually overlap. Confirm also that a branch opened from a card with plenty of empty space around it is **not** shifted at all (`shiftAttempt` stays 0) — collision avoidance must be a no-op in the common case.

Clean up the scratch tree/user afterward.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/TreeView.tsx
git commit -m "Avoid overlap between a newly opened lineage branch and existing cards"
```

---

### Task 8: Wire the click handler — open and collapse a branch

**Files:**
- Modify: `frontend/src/TreeView.tsx:1154-1161` (the existing `.card-ancestry-toggle` click-wiring loop inside `wireCardAndUnionClicks`)

**Interfaces:**
- Consumes: `lineageBranches`/`setLineageBranches`/`lineageBranchesRef` (Task 4), `renderLineageBranches` (Task 5-7), `wireCardAndUnionClicks` (existing).
- Produces: clicking `.card-ancestry-toggle` on a card with no open branch adds `{ rootPersonId: personId, ancestryDepth: 1, progenyDepth: 1 }`; clicking it again on a card whose branch is already open removes that entry. Either way, immediately (synchronously, not waiting for any `family-chart` update) calls `renderLineageBranches()` then `wireCardAndUnionClicks()` again so the change is visible without needing an unrelated tree update to trigger it.

- [ ] **Step 1: Replace the existing click handler**

At `frontend/src/TreeView.tsx:1154-1161` (currently):

```typescript
    container.querySelectorAll<HTMLButtonElement>(".card-ancestry-toggle").forEach((btn) => {
      const personId = btn.dataset.personId;
      btn.onclick = (e) => {
        e.stopPropagation();
        const chart = chartRef.current;
        if (!chart || !personId) return;
        ensureSafeAncestryDepthFor(chart, personId, treeDataRef.current);
        chart.updateMainId(personId);
        chart.updateTree({});
      };
    });
```

Replace with:

```typescript
    container.querySelectorAll<HTMLButtonElement>(".card-ancestry-toggle").forEach((btn) => {
      const personId = btn.dataset.personId;
      btn.onclick = (e) => {
        e.stopPropagation();
        if (!personId) return;
        const alreadyOpen = lineageBranchesRef.current.some((b) => b.rootPersonId === personId);
        setLineageBranches((prev) =>
          alreadyOpen
            ? prev.filter((b) => b.rootPersonId !== personId)
            : [...prev, { rootPersonId: personId, ancestryDepth: 1, progenyDepth: 1 }],
        );
        // setLineageBranches is async — lineageBranchesRef won't reflect
        // this change until the effect in Task 4 runs on the next render.
        // renderLineageBranches reads the ref, so update it here directly
        // too, the same way ensureSafeAncestryDepthFor-style code
        // elsewhere in this file writes straight into a ref instead of
        // waiting for a state update's own effect to catch up.
        lineageBranchesRef.current = alreadyOpen
          ? lineageBranchesRef.current.filter((b) => b.rootPersonId !== personId)
          : [...lineageBranchesRef.current, { rootPersonId: personId, ancestryDepth: 1, progenyDepth: 1 }];
        renderLineageBranches();
        wireCardAndUnionClicks();
      };
    });
```

This removes the old `ensureSafeAncestryDepthFor`/`chart.updateMainId`/`chart.updateTree` recentring behavior entirely — that's the whole point of this feature (see Task 3's copy change and the spec's own "hoy... recentra todo el árbol" framing of the problem this replaces).

- [ ] **Step 2: Verify open + collapse via the real click, not the temporary seed**

This is the first task where the feature is reachable through the actual UI — delete any temporary seed line left over from Tasks 5-7 if not already removed.

Scratch tree: person `X`, centered, with an unrendered parent `P` and an unrendered child `C`. In Playwright: click `X`'s `.card-ancestry-toggle` (find it via `container.querySelector('.card-ancestry-toggle[data-person-id="<X id>"]')`, dispatch a real click), confirm `P` and `C`'s cards appear with connecting lines. Click the same button again, confirm both cards and their lines are removed and `X`'s own card (and the rest of the tree) is completely unaffected — still centered on whoever was centered before, at the same pan/zoom.

Also confirm the pre-existing "recenter" behavior is genuinely gone: clicking the button must **never** call `chart.updateMainId`, i.e. the centered person (check via `chart.getMainDatum().id` in-page) stays the same before and after the click.

Clean up the scratch tree/user afterward.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/TreeView.tsx
git commit -m "Wire expand-lineage button to open/collapse a branch instead of recentering"
```

---

### Task 9: Floating per-branch controls (`+`/`-`/`✕`) and the "active" icon state

**Files:**
- Create: `frontend/src/LineageBranchControls.tsx`
- Modify: `frontend/src/TreeView.tsx` (position state, rendering the new component, extending `updateAncestryToggles`)
- Modify: `frontend/src/locales/es.json`, `en.json`, `pl.json`
- Modify: `frontend/src/App.css`

**Interfaces:**
- Produces (`LineageBranchControls.tsx`):
  ```typescript
  type Props = {
    x: number;
    y: number;
    canCollapseAncestors: boolean;
    canCollapseDescendants: boolean;
    onAncestorChange: (delta: 1 | -1) => void;
    onDescendantChange: (delta: 1 | -1) => void;
    onClose: () => void;
    labels: { expandAncestors: string; collapseAncestors: string; expandDescendants: string; collapseDescendants: string; close: string };
  };
  export default function LineageBranchControls(props: Props): JSX.Element;
  ```
- Produces (`TreeView.tsx`): `const [lineageBranchPositions, setLineageBranchPositions] = useState<Map<string, { x: number; y: number }>>(new Map());` — recomputed by a new `updateLineageBranchPositions()` function, called from the same place `updateAncestryToggles()` already runs (both inside its own definition call and inside `scheduleAncestryUpdate`'s debounced callback, `frontend/src/TreeView.tsx:1112-1146`), since both need "recompute once the current settle pass has actually finished moving cards."
- Consumes: `lineageBranches`, `setLineageBranches`, `minAncestorLevels` (existing, line 174), `renderLineageBranches`, `wireCardAndUnionClicks`, `hasMoreAncestors`/`hasMoreDescendants` (existing, lines 147-153) — reused here scoped to a branch's own root person rather than the centered one, to decide whether `+` should be disabled once a branch has reached the true end of that person's own recorded lineage in that direction.

- [ ] **Step 1: Add the locale keys**

In each of `es.json`, `en.json`, `pl.json`, alongside the `card.expandLineage` key added in Task 3, add four more keys under a new `lineageBranch` section (matching the file's existing per-feature section convention, e.g. how `infoPanel`/`editPerson` each get their own top-level object):

es.json:
```json
  "lineageBranch": {
    "expandAncestors": "Un nivel más de ascendientes",
    "collapseAncestors": "Un nivel menos de ascendientes",
    "expandDescendants": "Un nivel más de descendientes",
    "collapseDescendants": "Un nivel menos de descendientes",
    "close": "Colapsar esta rama"
  },
```

en.json:
```json
  "lineageBranch": {
    "expandAncestors": "One more level of ancestors",
    "collapseAncestors": "One fewer level of ancestors",
    "expandDescendants": "One more level of descendants",
    "collapseDescendants": "One fewer level of descendants",
    "close": "Collapse this branch"
  },
```

pl.json:
```json
  "lineageBranch": {
    "expandAncestors": "Jeszcze jeden poziom przodków",
    "collapseAncestors": "O jeden poziom mniej przodków",
    "expandDescendants": "Jeszcze jeden poziom potomków",
    "collapseDescendants": "O jeden poziom mniej potomków",
    "close": "Zwiń tę gałąź"
  },
```

- [ ] **Step 2: Create `LineageBranchControls.tsx`**

```typescript
import { createPortal } from "react-dom";
import { MinusIcon, PlusIcon, XIcon } from "./Icons";

type Props = {
  x: number;
  y: number;
  canCollapseAncestors: boolean;
  canExpandAncestors: boolean;
  canCollapseDescendants: boolean;
  canExpandDescendants: boolean;
  onAncestorChange: (delta: 1 | -1) => void;
  onDescendantChange: (delta: 1 | -1) => void;
  onClose: () => void;
  labels: {
    expandAncestors: string;
    collapseAncestors: string;
    expandDescendants: string;
    collapseDescendants: string;
    close: string;
  };
};

// Same portal-to-body + fixed-pixel-position technique as CardActionBubble
// (see its own comment for why: family-chart's own pan/zoom transform
// promotes the canvas to its own GPU compositing layer, and living inside
// that subtree would tie this panel's size to it too, shrinking it away at
// low zoom). Unlike CardActionBubble this isn't a transient popup — it
// stays mounted for as long as its branch is open, so there's no dismiss-
// on-outside-click behavior here.
export default function LineageBranchControls({
  x,
  y,
  canCollapseAncestors,
  canExpandAncestors,
  canCollapseDescendants,
  canExpandDescendants,
  onAncestorChange,
  onDescendantChange,
  onClose,
  labels,
}: Props) {
  return createPortal(
    <div className="lineage-branch-controls" style={{ left: x, top: y }} onClick={(e) => e.stopPropagation()}>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onAncestorChange(-1)}
        disabled={!canCollapseAncestors}
        aria-label={labels.collapseAncestors}
        title={labels.collapseAncestors}
      >
        <MinusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onAncestorChange(1)}
        disabled={!canExpandAncestors}
        aria-label={labels.expandAncestors}
        title={labels.expandAncestors}
      >
        <PlusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onDescendantChange(-1)}
        disabled={!canCollapseDescendants}
        aria-label={labels.collapseDescendants}
        title={labels.collapseDescendants}
      >
        <MinusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button"
        onClick={() => onDescendantChange(1)}
        disabled={!canExpandDescendants}
        aria-label={labels.expandDescendants}
        title={labels.expandDescendants}
      >
        <PlusIcon size={16} />
      </button>
      <button
        type="button"
        className="lineage-branch-controls-button lineage-branch-controls-close"
        onClick={onClose}
        aria-label={labels.close}
        title={labels.close}
      >
        <XIcon size={16} />
      </button>
    </div>,
    document.body,
  );
}
```

- [ ] **Step 3: Add the CSS**

In `frontend/src/App.css`, near `.card-action-bubble` (find its existing rules and place these alongside them for locality):

```css
.lineage-branch-controls {
  position: fixed;
  transform: translate(-50%, 0);
  display: flex;
  gap: 0.25rem;
  background: var(--color-surface);
  border-radius: 999px;
  padding: 0.25rem;
  box-shadow: 0 2px 8px var(--color-union-hover-shadow);
  z-index: 20;
}

.lineage-branch-controls-button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: none;
  color: var(--color-forest);
  cursor: pointer;
}

.lineage-branch-controls-button:disabled {
  opacity: 0.3;
  cursor: default;
}

.lineage-branch-controls-button:hover:not(:disabled) {
  background: color-mix(in srgb, var(--color-forest) 12%, transparent);
}

.lineage-branch-controls-close {
  color: var(--color-tree-black);
}

/* The expand-lineage icon on a card whose branch is already open — filled
   instead of outlined, same idea as any other "currently active" toggle
   in this app, so it's obvious at a glance which cards already have an
   open branch without needing to hunt for their own floating panel. */
.card-ancestry-toggle-active svg {
  fill: currentColor;
}
```

- [ ] **Step 4: Add position tracking + `updateAncestryToggles` extension in `TreeView.tsx`**

Near the `lineageBranches` state from Task 4, add:

```typescript
  const [lineageBranchPositions, setLineageBranchPositions] = useState<Map<string, { x: number; y: number }>>(new Map());
```

At `frontend/src/TreeView.tsx:1096-1111` (`updateAncestryToggles`, already modified in Task 3), extend it to also toggle the "active" class and recompute panel positions:

```typescript
    function updateAncestryToggles() {
      const el = container as HTMLDivElement;
      const openIds = new Set(lineageBranchesRef.current.map((b) => b.rootPersonId));
      el.querySelectorAll<HTMLButtonElement>(".card-ancestry-toggle").forEach((btn) => {
        btn.style.display = "";
        btn.classList.toggle("card-ancestry-toggle-active", openIds.has(btn.dataset.personId ?? ""));
      });
      const positions = new Map<string, { x: number; y: number }>();
      for (const branch of lineageBranchesRef.current) {
        const card = el.querySelector<HTMLElement>(`.card[data-id="${branch.rootPersonId}"]`);
        if (!card) continue;
        const rect = card.getBoundingClientRect();
        positions.set(branch.rootPersonId, { x: rect.left + rect.width / 2, y: rect.bottom + 8 });
      }
      setLineageBranchPositions(positions);
    }
```

- [ ] **Step 5: Render the panels and wire their callbacks**

Find the existing `{cardActions && <CardActionBubble ... />}` block (`frontend/src/TreeView.tsx:3501-3520`) and add, as a sibling right after it:

```typescript
          {lineageBranches.map((branch) => {
            const pos = lineageBranchPositions.get(branch.rootPersonId);
            if (!pos) return null;
            const min = minAncestorLevels(branch.rootPersonId, treeDataRef.current);
            return (
              <LineageBranchControls
                key={branch.rootPersonId}
                x={pos.x}
                y={pos.y}
                canCollapseAncestors={branch.ancestryDepth > min}
                canExpandAncestors={hasMoreAncestors(branch.rootPersonId, branch.ancestryDepth, treeDataRef.current)}
                canCollapseDescendants={branch.progenyDepth > 0}
                canExpandDescendants={hasMoreDescendants(branch.rootPersonId, branch.progenyDepth, treeDataRef.current)}
                onAncestorChange={(delta) => {
                  setLineageBranches((prev) =>
                    prev.map((b) =>
                      b.rootPersonId === branch.rootPersonId
                        ? { ...b, ancestryDepth: Math.max(min, b.ancestryDepth + delta) }
                        : b,
                    ),
                  );
                  lineageBranchesRef.current = lineageBranchesRef.current.map((b) =>
                    b.rootPersonId === branch.rootPersonId
                      ? { ...b, ancestryDepth: Math.max(min, b.ancestryDepth + delta) }
                      : b,
                  );
                  renderLineageBranches();
                  wireCardAndUnionClicks();
                }}
                onDescendantChange={(delta) => {
                  setLineageBranches((prev) =>
                    prev.map((b) =>
                      b.rootPersonId === branch.rootPersonId
                        ? { ...b, progenyDepth: Math.max(0, b.progenyDepth + delta) }
                        : b,
                    ),
                  );
                  lineageBranchesRef.current = lineageBranchesRef.current.map((b) =>
                    b.rootPersonId === branch.rootPersonId
                      ? { ...b, progenyDepth: Math.max(0, b.progenyDepth + delta) }
                      : b,
                  );
                  renderLineageBranches();
                  wireCardAndUnionClicks();
                }}
                onClose={() => {
                  setLineageBranches((prev) => prev.filter((b) => b.rootPersonId !== branch.rootPersonId));
                  lineageBranchesRef.current = lineageBranchesRef.current.filter(
                    (b) => b.rootPersonId !== branch.rootPersonId,
                  );
                  renderLineageBranches();
                  wireCardAndUnionClicks();
                }}
                labels={{
                  expandAncestors: t("lineageBranch.expandAncestors"),
                  collapseAncestors: t("lineageBranch.collapseAncestors"),
                  expandDescendants: t("lineageBranch.expandDescendants"),
                  collapseDescendants: t("lineageBranch.collapseDescendants"),
                  close: t("lineageBranch.close"),
                }}
              />
            );
          })}
```

Add the import at the top of the file: `import LineageBranchControls from "./LineageBranchControls";`.

- [ ] **Step 6: Verify**

Run `cd frontend && npx tsc -b --force` — expect no errors.

Scratch tree: person `X` (centered) with siblings (to exercise `minAncestorLevels`'s floor of 1), an unrendered parent `P` who themself has an unrendered parent `GP`, and an unrendered child `C`. In Playwright:
- Click `X`'s expand-lineage button — confirm the icon turns "active" (filled) and a `LineageBranchControls` panel appears just below `X`'s card.
- Click the ancestors `+` — confirm `GP` now also appears, connected to `P`.
- Click the ancestors `-` twice — confirm it's disabled (not clickable / has no effect) once `ancestryDepth` would drop below `min` (1, since `X` has siblings) rather than crashing the tree (the exact `calculateTree` crash documented at `TreeView.tsx:155-165` is what this floor exists to prevent — confirm no console error appears).
- Click `✕` — confirm the whole branch (all its cards, lines, and the panel itself) disappears, and the icon on `X`'s own card returns to its non-active state.

Clean up the scratch tree/user afterward.

- [ ] **Step 7: Commit**

```bash
git add frontend/src/LineageBranchControls.tsx frontend/src/TreeView.tsx frontend/src/App.css frontend/src/locales/es.json frontend/src/locales/en.json frontend/src/locales/pl.json
git commit -m "Add floating per-branch +/-/close controls for lineage expansion"
```

---

### Task 10: Full end-to-end verification pass

**Files:** none (verification only — fix forward in whichever file if something surfaces here, then re-run this task's checks).

- [ ] **Step 1: Nested branches**

Scratch tree with three generations: `X` (centered) → unrendered parent `P` → `P`'s own unrendered parent `GP`. Open `X`'s branch (reveals `P`), then — from within the newly-added `P` card, which per this plan's architecture already has its own real `.card-ancestry-toggle` (same `cardTemplate()` output as any other card) — click `P`'s own button to open a **second**, nested branch rooted at `P` (revealing `GP` without needing to touch `X`'s own `+`). Confirm both branches' controls panels coexist independently, and collapsing `X`'s branch via its own `✕` also removes `P`'s nested branch and its own panel (since `P`'s card itself disappears once `X`'s branch collapses — confirm this doesn't leave `P`'s branch's `LineageBranch` state entry orphaned in `lineageBranches`: if it does, add a cleanup pass in Task 8/9's `onClose`/toggle handlers that also removes any `LineageBranch` whose `rootPersonId` is no longer present as a real or branch-added card after the change, before calling `renderLineageBranches()`).

- [ ] **Step 2: Export**

With at least one branch open (from Step 1), use the existing "Importar/exportar" → "Exportar imagen del árbol" flow (PNG, "Vista actual") and confirm the exported image includes the branch's added cards and lines, styled identically to the rest of the tree (same black-text override from the PNG-export fix already shipped, same line color).

- [ ] **Step 3: Editing a branch-added card**

Click "Editar" on a card that only exists because a branch revealed it, change its given name, save, and confirm the change persists and the card's own text updates in place (this exercises `wireCardAndUnionClicks`'s existing edit-wiring picking up the branch card for free, and confirms `renderLineageBranches`'s next pass — triggered by the edit's own `chart.updateTree()`/`onRelationsChanged`-style refresh, whichever this codebase's `EditPersonForm` save flow already triggers — correctly re-reads the updated name).

- [ ] **Step 4: Full regression sweep**

Run `cd frontend && npx tsc -b --force` and `cd backend && npx tsc -b --force` — both clean.

Re-open a tree with **no** branches ever opened and confirm the tree behaves exactly as before this whole plan: normal navigation, normal ancestor/descendant level buttons, normal union hover/click, normal export — this plan must ship with zero behavior change for anyone who never touches the new button.

- [ ] **Step 5: Clean up and final commit (if anything changed in this task)**

Delete every scratch tree/user created across this plan's tasks (should already be done per-task, but re-check `prisma.user.findMany({ where: { email: { contains: "@example.com" } } })` — or whatever throwaway domain was used — returns empty before finishing).

If Step 1 surfaced the orphaned-branch cleanup described there, commit that fix:

```bash
git add frontend/src/TreeView.tsx
git commit -m "Clean up orphaned nested lineage branches when their parent branch closes"
```

---

## Self-Review Notes

- **Spec coverage:** every §Interacción behavior (show-on-all-cards, first-click-opens-one-level-both-directions, second-click-collapses, floating +/-/✕, full interactivity including nested branches, reset-on-navigation, real line/union styling, real editability, export inclusion) has a task. The spec's explicitly deferred items (live re-alignment after a later settle-pass moves the origin card, optimal packing, primos) are intentionally not tasked here, matching the spec's own "Qué se deja fuera" section.
- **Type consistency:** `LineageBranch`, `renderLineageBranches`, `getCardScreenPos`, `sortTreeChildren`, `lineageBranchesRef`, `lineageBranchPositions` are named consistently across every task that references them.
- **No placeholders:** every code block is complete, runnable TypeScript/CSS/JSON against this repo's actual current structure (verified via direct reads of `TreeView.tsx`, `Icons.tsx`, `CardActionBubble.tsx`, `App.css`, the locale files, and `family-chart`'s own shipped `.d.ts` files at plan-writing time) — not paraphrased or left as "add appropriate handling."
