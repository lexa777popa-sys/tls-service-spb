const REVEAL_DELAY_STEP = 70;
const REVEAL_DELAY_MAX = 350;

export function prefersReducedMotion(): boolean {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

/** Тень у шапки и полоса прогресса чтения. */
export function initScrollUi(): void {
  const nav = document.querySelector<HTMLElement>(".nav");
  const bar = document.createElement("div");
  bar.className = "scroll-progress";
  bar.setAttribute("aria-hidden", "true");
  document.body.append(bar);

  let frame = 0;

  const update = (): void => {
    frame = 0;
    const doc = document.documentElement;
    const scrollable = doc.scrollHeight - doc.clientHeight;
    const ratio = scrollable > 0 ? Math.min(doc.scrollTop / scrollable, 1) : 0;
    bar.style.transform = `scaleX(${ratio})`;
    nav?.classList.toggle("is-stuck", doc.scrollTop > 8);
  };

  const schedule = (): void => {
    if (!frame) frame = requestAnimationFrame(update);
  };

  update();
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
}

/** Плавное появление блоков при прокрутке. */
export function initReveal(selectors: readonly string[]): void {
  if (prefersReducedMotion() || !("IntersectionObserver" in window)) return;

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add("is-visible");
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  for (const selector of selectors) {
    document.querySelectorAll<HTMLElement>(selector).forEach((el, index) => {
      el.classList.add("reveal");
      el.style.setProperty(
        "--reveal-delay",
        `${Math.min(index * REVEAL_DELAY_STEP, REVEAL_DELAY_MAX)}ms`,
      );
      observer.observe(el);
    });
  }
}
