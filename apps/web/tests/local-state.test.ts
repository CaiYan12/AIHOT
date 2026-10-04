import assert from "node:assert/strict";
import { after, test } from "node:test";
import { beijingDate, beijingTime } from "@aihot/contracts/time";

const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
after(() => {
  if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
  else Reflect.deleteProperty(globalThis, "window");
});

let instance = 0;
async function reader(starred: unknown[] = []) {
  const values = new Map([["aihot-starred-items", JSON.stringify(starred)]]);
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value); },
      removeItem: (key: string) => { values.delete(key); },
    } },
  });
  // Reopening the page starts with an empty snapshot cache.
  const state: typeof import("../app/lib/local-state.ts") = await import(`../app/lib/local-state.ts?test=${instance++}`);
  return { state, values };
}

const displayDate = (value: string) => `${beijingDate(value)} ${beijingTime(value)}`;

test("import keeps bookmarks with invalid dates and persists displayable replacements", async () => {
  const invalid = ["broken", "", "999999-01-01", "+275760-09-13T00:00:00.000Z", null, 42, {}];
  const { state, values } = await reader();
  const before = Date.now();
  const report = state.importBundle(JSON.stringify({ version: 1, starred: invalid.map((date, i) => ({
    id: `import-${i}`, title: `Bookmark ${i}`, savedAt: date, publishedAt: date,
  })) }));
  assert.equal(report.starredAdded, invalid.length);
  const saved = JSON.parse(values.get(state.KEYS.starred)!);
  assert.equal(saved.length, invalid.length);
  for (const item of saved) {
    assert.equal(item.publishedAt, null);
    assert.ok(Date.parse(item.savedAt) >= before && Date.parse(item.savedAt) <= Date.now());
    assert.doesNotThrow(() => displayDate(item.savedAt));
  }
});

test("stored bookmarks with damaged dates remain readable, exportable and removable", async () => {
  const { state } = await reader([{ id: "stored", title: "Keep me", savedAt: "broken", publishedAt: "broken" }]);
  const starred = state.getStarred();
  assert.equal(starred.length, 1);
  assert.equal(starred[0]!.title, "Keep me");
  assert.equal(starred[0]!.publishedAt, null);
  assert.doesNotThrow(() => displayDate(starred[0]!.savedAt));
  assert.strictEqual(state.getStarred(), starred, "React snapshots must stay stable between changes");
  assert.deepEqual(state.exportBundle().starred, starred);
  state.removeStar("stored");
  assert.deepEqual(state.getStarred(), []);
});

test("valid dates are preserved and an import cannot replace an existing bookmark", async () => {
  const existing = { id: "valid", title: "Original", savedAt: "2026-09-29T08:30:00+08:00", publishedAt: "2026-09-28T23:00:00Z" };
  const { state } = await reader([existing]);
  const report = state.importBundle(JSON.stringify({ version: 1, starred: [{ ...existing, title: "Replacement", savedAt: "broken" }] }));
  assert.equal(report.starredAdded, 0);
  const [saved] = state.getStarred();
  assert.equal(saved!.title, existing.title);
  assert.equal(saved!.savedAt, existing.savedAt);
  assert.equal(saved!.publishedAt, existing.publishedAt);
});

// Failure cases before changing storage: another tab's writes must survive a cached-tab edit;
// unreadable bookmarks must not be overwritten and failed writes must not report success.
test("a cached tab merges newer saved bookmarks and read marks before writing", async () => {
  const { state, values } = await reader([{ id: "old", title: "Old" }]);
  state.getStarred();
  state.getReadIds();
  values.set(state.KEYS.starred, JSON.stringify([{ id: "other-tab", title: "Other tab" }, { id: "old", title: "Old" }]));
  values.set(state.KEYS.read, JSON.stringify(["other-tab"]));
  state.toggleStar({ id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false });
  state.markRead("new");
  assert.deepEqual(state.getStarred().map((s) => s.id), ["new", "other-tab", "old"]);
  assert.deepEqual(state.getReadIds(), ["new", "other-tab"]);
});

test("failed bookmark writes and damaged existing data do not report a successful toggle", async () => {
  const { state, values } = await reader();
  const item = { id: "new", title: "New", summary: null, sourceName: "", publishedAt: null, score: null, aiSelected: false };
  values.set(state.KEYS.starred, "damaged original data");
  assert.equal(state.toggleStar(item), false);
  assert.equal(values.get(state.KEYS.starred), "damaged original data");
  window.localStorage.setItem = () => { throw new Error("quota"); };
  assert.equal(state.toggleStar(item), false);
});

// The desktop sidebar's width is reader state like the theme. A stored width is a run of digits and
// nothing else; a reader who edited storage by hand keeps the direction they meant.
test("the sidebar width is the default when nothing is stored or the value is not a run of digits", async () => {
  const { state } = await reader();
  const fallback = state.SIDEBAR_WIDTH.default;
  for (const raw of [null, "", " ", "abc", "180px", "18.5", "1e3", "NaN", "-", "1 80", "+180", "-400", "0x10", "１８０"]) {
    assert.equal(state.normalizeSidebarWidth(raw), fallback, `raw=${JSON.stringify(raw)}`);
  }
});

test("a sidebar width outside the range is clamped to the nearest end, and a fractional drag is rounded", async () => {
  const { state } = await reader();
  const { min, max, default: fallback } = state.SIDEBAR_WIDTH;
  assert.equal(state.normalizeSidebarWidth(String(min)), min);
  assert.equal(state.normalizeSidebarWidth(String(fallback)), fallback);
  assert.equal(state.normalizeSidebarWidth(String(max)), max);
  assert.equal(state.normalizeSidebarWidth("179"), 179);
  assert.equal(state.normalizeSidebarWidth("220"), 220);
  // Leading zeros are still a run of digits, so they are read rather than thrown away.
  assert.equal(state.normalizeSidebarWidth("0180"), fallback);
  assert.equal(state.normalizeSidebarWidth("0200"), 200);
  for (const raw of [String(min - 1), "0"]) assert.equal(state.normalizeSidebarWidth(raw), min, `raw=${raw}`);
  for (const raw of [String(max + 1), "100000"]) assert.equal(state.normalizeSidebarWidth(raw), max, `raw=${raw}`);
  // A drag reports fractions; what reaches storage is a whole number of pixels.
  assert.equal(state.clampSidebarWidth(180.4), 180);
  assert.equal(state.clampSidebarWidth(180.6), 181);
  assert.equal(state.clampSidebarWidth(min - 1), min);
  assert.equal(state.clampSidebarWidth(max + 1), max);
});

test("the sidebar width is read back from this browser through the same rules", async () => {
  const { state, values } = await reader();
  const { max, default: fallback } = state.SIDEBAR_WIDTH;
  assert.equal(state.getSidebarWidth(), fallback, "nothing stored yet");
  values.set(state.KEYS.sidebarWidth, "220");
  assert.equal(state.getSidebarWidth(), 220);
  values.set(state.KEYS.sidebarWidth, "999");
  assert.equal(state.getSidebarWidth(), max);
  values.set(state.KEYS.sidebarWidth, "abc");
  assert.equal(state.getSidebarWidth(), fallback);
});

// The pre-paint script repeats the module's rules in the page's own words (it runs before any bundle),
// so the two must agree: the reader's width has to be on the page in the first frame, not after
// hydration. This runs it the way a browser does — bare globals, then reads back what it set.
function runBootScript(state: typeof import("../app/lib/local-state.ts"), stored: string | null): string | null {
  const saved = new Map<string, string>();
  const applied = new Map<string, string>();
  const keys = ["localStorage", "document"] as const;
  const before = keys.map((k) => [k, Object.getOwnPropertyDescriptor(globalThis, k)] as const);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: {
    getItem: (key: string) => saved.get(key) ?? null,
    setItem: (key: string, value: string) => { saved.set(key, value); },
    removeItem: (key: string) => { saved.delete(key); },
  } });
  Object.defineProperty(globalThis, "document", { configurable: true, value: {
    documentElement: { style: { setProperty: (name: string, value: string) => { applied.set(name, value); } } },
  } });
  try {
    if (stored !== null) saved.set(state.KEYS.sidebarWidth, stored);
    new Function(state.SIDEBAR_BOOT_SCRIPT)();
  } finally {
    for (const [k, descriptor] of before) {
      if (descriptor) Object.defineProperty(globalThis, k, descriptor);
      else Reflect.deleteProperty(globalThis, k);
    }
  }
  return applied.get("--sidebar-width") ?? null;
}

test("the pre-paint script puts the stored sidebar width on the page, by the same rules", async () => {
  const { state } = await reader();
  const { min, max, default: fallback } = state.SIDEBAR_WIDTH;
  const applied = (stored: string | null) => runBootScript(state, stored);
  assert.equal(applied(String(min)), `${min}px`);
  assert.equal(applied(String(fallback)), `${fallback}px`);
  assert.equal(applied("220"), "220px");
  assert.equal(applied("0200"), "200px");
  assert.equal(applied(String(max)), `${max}px`);
  for (const stored of [String(max + 1), "100000"]) assert.equal(applied(stored), `${max}px`, `stored=${stored}`);
  for (const stored of [String(min - 1), "0"]) assert.equal(applied(stored), `${min}px`, `stored=${stored}`);
  for (const stored of [null, "", " ", "abc", "18.5", "180px", "1e3", "-400", "+180"]) {
    assert.equal(applied(stored), `${fallback}px`, `stored=${JSON.stringify(stored)}`);
  }
});
