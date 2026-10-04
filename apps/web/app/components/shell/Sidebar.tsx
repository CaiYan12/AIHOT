import { useEffect, useRef, useState } from "react";
import { Link, useLocation } from "react-router";
import { SITE } from "@aihot/site";
import { Wordmark } from "@aihot/site/brand/Logo.tsx";
import { applySidebarWidth, clampSidebarWidth, getSidebarWidth, setSidebarWidth, SIDEBAR_WIDTH, useChangelogSeen, useSidebarWidth } from "../../lib/local-state";
import { sidebar, sidebarIsActive, type NavItem } from "./nav";
import { ThemeSwitch } from "./ThemeSwitch";
import { IconGithub } from "../icons";

/** True while the changelog has an entry newer than the one this reader last opened. */
export function useChangelogDot(latestVersion: string | null): boolean {
  const seen = useChangelogSeen();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || !latestVersion) return false;
  return !seen || seen < latestVersion;
}

function SideLink({ item, dot }: { item: NavItem; dot: boolean }) {
  const { pathname } = useLocation();
  const isActive = sidebarIsActive(item, pathname);
  const Icon = item.icon;
  return (
    <Link
      to={item.to}
      prefetch="intent"
      aria-current={isActive ? "page" : undefined}
      className={`flex h-10 items-center gap-2.5 rounded-control px-2.5 text-[14px] transition-colors duration-150 ${
        isActive ? "bg-accent/10 font-semibold text-ink dark:bg-accent-soft" : "font-medium text-ink-3 hover:bg-bg-sunk hover:text-ink"
      }`}
    >
      <span className={`flex w-[22px] shrink-0 justify-center ${isActive ? "text-accent" : ""}`}>
        <Icon size={17} />
      </span>
      {/* One line, and the tail fades instead of wrapping: a narrow sidebar must not reflow the menu.
          The label fills the row so the fade sits past the text of short labels, where it shows nothing. */}
      <span className="min-w-0 flex-1 overflow-hidden whitespace-nowrap [mask-image:linear-gradient(to_right,#000_calc(100%-10px),transparent)]">{item.label}</span>
      {dot && item.changelog && <span className="ml-auto size-1.5 shrink-0 rounded-full bg-hot" aria-label="有新的更新" />}
    </Link>
  );
}

/**
 * The sidebar's right edge: drag it, or use the arrow keys, to set the width. Dragging writes
 * --sidebar-width directly so the page follows the pointer, and saves on release; a cancelled pointer
 * puts back the width the drag started from. The line thickens while the reader is on it.
 */
function SidebarResizer() {
  const stored = useSidebarWidth();
  const ref = useRef<HTMLDivElement>(null);
  // The width this tab has put on the page while it is not the one in storage: a drag in flight, or a
  // browser that refused the write. The sidebar stays where the reader put it either way.
  const [applied, setApplied] = useState<number | null>(null);
  const [dragging, setDragging] = useState(false);
  const width = applied ?? stored;

  // Another tab's write, and this tab's own save, are the new truth.
  useEffect(() => { setApplied(null); }, [stored]);
  // ...and move the page onto them. The stored width is read here rather than taken from the hook:
  // during hydration the hook still reports the server's default, and writing that would undo what the
  // pre-paint script already put on the page.
  useEffect(() => { applySidebarWidth(getSidebarWidth()); }, [stored]);

  // Every change this tab makes goes through here, so what the page shows, what aria reports and the
  // width the next key step starts from all agree even when the browser will not store the width.
  const change = (next: number) => {
    const value = clampSidebarWidth(next);
    setApplied(value);
    setSidebarWidth(value);
  };

  // The drag reads the saved width, which must not re-register the pointer listeners mid-drag.
  const storedRef = useRef(stored);
  storedRef.current = stored;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // from: the width the drag started at (what a cancel puts back). at: where the pointer has it now.
    let drag: { x: number; from: number; at: number } | null = null;
    const onDown = (e: PointerEvent) => {
      if (!e.isPrimary) return;
      if (e.pointerType === "mouse" && e.button !== 0) return;
      el.setPointerCapture(e.pointerId);
      drag = { x: e.clientX, from: storedRef.current, at: storedRef.current };
      setDragging(true);
      setApplied(storedRef.current);
    };
    const onMove = (e: PointerEvent) => {
      if (!drag) return;
      drag.at = clampSidebarWidth(drag.from + e.clientX - drag.x);
      setApplied(drag.at);
      applySidebarWidth(drag.at);
    };
    const onUp = () => {
      if (!drag) return;
      const { at } = drag;
      drag = null;
      setDragging(false);
      change(at);
    };
    // A cancelled pointer puts back the width the drag started from, without saving it.
    const onCancel = () => {
      if (!drag) return;
      const { from } = drag;
      drag = null;
      setDragging(false);
      setApplied(null);
      applySidebarWidth(from);
    };
    el.addEventListener("pointerdown", onDown);
    el.addEventListener("pointermove", onMove);
    el.addEventListener("pointerup", onUp);
    el.addEventListener("pointercancel", onCancel);
    // A drag across the sidebar can make the browser start a native drag of a link under it, which
    // cancels our pointer capture and drops the drag. Refused while ours is in flight.
    const onDragStart = (e: DragEvent) => { if (drag) e.preventDefault(); };
    document.addEventListener("dragstart", onDragStart);
    return () => {
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onCancel);
      document.removeEventListener("dragstart", onDragStart);
    };
  }, []);

  // Mid-drag the pointer is usually off this 8px strip: hold the cursor and stop the page selecting
  // text under it. Cleared on release, and on unmount.
  useEffect(() => {
    if (!dragging) return;
    const root = document.documentElement;
    root.style.userSelect = "none";
    root.style.cursor = "col-resize";
    return () => {
      root.style.removeProperty("user-select");
      root.style.removeProperty("cursor");
    };
  }, [dragging]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    // A drag is a pointer gesture: while one is in flight the keys do nothing, Escape included.
    if (dragging) return;
    const step = e.shiftKey ? 32 : 8;
    if (e.key === "ArrowLeft") change(width - step);
    else if (e.key === "ArrowRight") change(width + step);
    else if (e.key === "Home") change(SIDEBAR_WIDTH.min);
    else if (e.key === "End") change(SIDEBAR_WIDTH.max);
    else if (e.key === "Escape") change(SIDEBAR_WIDTH.default);
    else return;
    e.preventDefault();
  };

  return (
    <div
      ref={ref}
      role="separator"
      aria-orientation="vertical"
      aria-label="调整侧栏宽度"
      aria-valuemin={SIDEBAR_WIDTH.min}
      aria-valuemax={SIDEBAR_WIDTH.max}
      aria-valuenow={width}
      tabIndex={0}
      onKeyDown={onKeyDown}
      onDoubleClick={() => change(SIDEBAR_WIDTH.default)}
      className="group absolute inset-y-0 -right-1 z-20 w-2 cursor-col-resize touch-none focus-visible:outline-offset-[-2px]"
    >
      {/* Sits on the sidebar's own 1px border and grows into the main area's padding, so the line can
          thicken without moving anything beside it. Hover and focus-visible are the stylesheet's, not
          React's: a click focuses this element, and a click must not leave the line lit up. */}
      <span
        aria-hidden="true"
        className={`absolute inset-y-0 left-1/2 transition-[width,background-color] duration-150 ease-[var(--ease-out-quart)] ${
          dragging
            ? "w-[2px] bg-accent"
            : "w-px bg-transparent group-hover:w-[2px] group-hover:bg-accent group-focus-visible:w-[2px] group-focus-visible:bg-accent"
        }`}
      />
    </div>
  );
}

export function Sidebar({ changelogVersion }: { changelogVersion: string | null }) {
  const dot = useChangelogDot(changelogVersion);
  return (
    <aside className="sticky top-0 hidden h-dvh w-[var(--sidebar-width)] shrink-0 flex-col border-r border-line bg-sidebar px-3 pb-3.5 pt-6 lg:flex">
      <Link to="/" className="mb-4 flex h-[50px] items-center px-1 text-ink" aria-label={`${SITE.name} 首页`}>
        <Wordmark size={26} />
      </Link>
      <nav className="-mx-1 flex-1 overflow-y-auto px-1" aria-label="主导航">
        {sidebar().map((section) => (
          <div key={section.title}>
            <div className="truncate px-2.5 pb-1 pt-3.5 text-[11px] text-ink-4">{section.title}</div>
            <div className="flex flex-col gap-1">
              {section.items.map((item) => (
                <SideLink key={item.to} item={item} dot={dot} />
              ))}
            </div>
          </div>
        ))}
      </nav>
      <div className="mt-2 space-y-2.5 px-1 pt-1">
        {SITE.github && (
          <a
            href={SITE.github}
            target="_blank"
            rel="noopener noreferrer"
            className="mx-1 flex h-[34px] items-center justify-center gap-1.5 rounded-full border border-line text-[12.5px] text-ink-3 transition-colors hover:bg-bg-sunk hover:text-ink"
          >
            <IconGithub size={14} />
            GitHub 开源
          </a>
        )}
        <ThemeSwitch className="mx-1" />
        {SITE.icp && (
          <a href="https://beian.miit.gov.cn/" target="_blank" rel="noopener noreferrer" className="block px-2 text-[10px] text-ink-4 hover:text-ink-3">
            {SITE.icp}
          </a>
        )}
      </div>
      <SidebarResizer />
    </aside>
  );
}
