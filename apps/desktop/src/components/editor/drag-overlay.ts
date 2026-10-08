import { animate, type AnimationPlaybackControls, type Transition } from "framer-motion";

/**
 * The lifted row: a clone of the grabbed element on a card that follows
 * the pointer 1:1 and springs to rest when released. Built imperatively so
 * nothing re-renders while the pointer moves; the engine writes its
 * position straight to the transform.
 */
export interface DragOverlay {
  readonly el: HTMLElement;
  readonly height: number;
  /** Current left/top in viewport coordinates. */
  readonly x: number;
  readonly y: number;
  move(x: number, y: number): void;
  /** Outside its list the card is see-through, so the drop target shows. */
  setFloating(floating: boolean): void;
  /** Spring the card to rest (or away); resolves once settled. */
  settle(
    to: { x?: number; y: number; scale?: number; opacity?: number },
    transition: Transition,
    velocity?: number,
  ): Promise<void>;
  remove(): void;
}

export function createDragOverlay(anchor: HTMLElement, count: number, reducedMotion: boolean): DragOverlay {
  const rect = anchor.getBoundingClientRect();

  const el = document.createElement("div");
  el.setAttribute("aria-hidden", "true");
  el.style.cssText = `position:fixed;left:${rect.left}px;top:0;width:${rect.width}px;height:${rect.height}px;z-index:60;pointer-events:none;will-change:transform;`;

  // A stack behind the card says "several" before the badge is read.
  if (count > 1) {
    for (const [inset, drop] of [
      [10, 8],
      [5, 4],
    ] as const) {
      const ghost = document.createElement("div");
      ghost.className = "absolute rounded-md bg-card ring-1 ring-separator shadow-menu";
      ghost.style.cssText = `left:${inset}px;right:${inset}px;top:${drop}px;height:100%;`;
      el.appendChild(ghost);
    }
  }

  const card = document.createElement("div");
  card.className = "relative h-full overflow-hidden rounded-md bg-card text-foreground shadow-dialog ring-1 ring-separator";
  card.style.transformOrigin = "center";
  card.style.transition = "opacity 150ms ease-out";
  card.style.transform = reducedMotion ? "" : "scale(1.02)";

  const clone = anchor.cloneNode(true) as HTMLElement;
  clone.removeAttribute("data-row-key");
  clone.style.transform = "";
  clone.style.opacity = "";
  // cloneNode copies attributes, not the checked property React sets.
  const srcBoxes = anchor.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
  clone.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((box, i) => {
    box.checked = srcBoxes[i]?.checked ?? false;
  });
  card.appendChild(clone);

  if (count > 1) {
    const badge = document.createElement("span");
    badge.className =
      "absolute top-1/2 right-2 flex h-5 min-w-5 -translate-y-1/2 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground shadow-menu nums";
    badge.textContent = String(count);
    card.appendChild(badge);
  }

  el.appendChild(card);
  document.body.appendChild(el);

  const originX = rect.left;
  let x = rect.left;
  let y = rect.top;
  let scale = reducedMotion ? 1 : 1.02;
  let opacity = 1;
  let running: AnimationPlaybackControls[] = [];

  const paint = () => {
    el.style.transform = `translate3d(${x - originX}px, ${y}px, 0)`;
    card.style.transform = scale === 1 ? "" : `scale(${scale})`;
    el.style.opacity = opacity === 1 ? "" : String(opacity);
  };
  paint();

  const stop = () => {
    for (const c of running) c.stop();
    running = [];
  };

  return {
    el,
    height: rect.height,
    get x() {
      return x;
    },
    get y() {
      return y;
    },
    setFloating(floating) {
      card.style.opacity = floating ? "0.78" : "";
    },
    move(nextX, nextY) {
      stop();
      x = nextX;
      y = nextY;
      paint();
    },
    settle(to, transition, velocity) {
      stop();
      if (reducedMotion) {
        x = to.x ?? x;
        y = to.y;
        scale = to.scale ?? scale;
        opacity = to.opacity ?? opacity;
        paint();
        return Promise.resolve();
      }
      const jobs: Promise<void>[] = [];
      const run = (from: number, target: number, apply: (v: number) => void, vel?: number) => {
        if (from === target) return;
        jobs.push(
          new Promise<void>((resolve) => {
            const controls = animate(from, target, {
              ...transition,
              velocity: vel,
              onUpdate: (v) => {
                apply(v);
                paint();
              },
              onComplete: resolve,
            });
            running.push(controls);
          }),
        );
      };
      run(y, to.y, (v) => (y = v), velocity);
      if (to.x !== undefined) run(x, to.x, (v) => (x = v));
      if (to.scale !== undefined) run(scale, to.scale, (v) => (scale = v));
      if (to.opacity !== undefined) run(opacity, to.opacity, (v) => (opacity = v));
      return Promise.all(jobs).then(() => undefined);
    },
    remove() {
      stop();
      el.remove();
    },
  };
}
