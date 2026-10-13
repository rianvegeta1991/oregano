// Drag & Drop per Pointer-Events – funktioniert mit Maus, Stift und Touch (HTML5-DnD kann kein Touch).
// Maus: Ziehen beginnt nach ein paar Pixeln. Touch: erst nach kurzem Gedrückthalten, damit Scrollen
// weiterhin möglich bleibt. Esc bricht ab. Am Rand scrollen die angegebenen Container mit.

let session = null;

/**
 * @param {HTMLElement} el
 * @param {object} o
 *   canStart(e)        – false = dieser Klick startet kein Ziehen (z. B. Klick auf Knopf)
 *   ghost              – true (Standard): Klon folgt dem Zeiger; false: kein Klon
 *   onStart(ctx)       – Ziehen beginnt (false zurückgeben = abbrechen)
 *   onMove(ctx)        – bei jeder Bewegung; ctx.x / ctx.y = Zeigerposition im Fenster
 *   onEnd(ctx, cancelled)
 *   scrollers()        – Elemente, die am Rand automatisch scrollen
 *   threshold, touchDelay
 */
export function makeDraggable(el, o) {
  el.classList.add('draggable');
  el.addEventListener('pointerdown', (e) => {
    if (session) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (o.canStart && o.canStart(e) === false) return;
    const touch = e.pointerType !== 'mouse';
    const rect = el.getBoundingClientRect();
    const s = {
      el, o, touch, id: e.pointerId, active: false,
      startX: e.clientX, startY: e.clientY, x: e.clientX, y: e.clientY,
      offsetX: e.clientX - rect.left, offsetY: e.clientY - rect.top, rect, ghost: null, timer: 0, raf: 0,
    };
    session = s;
    if (touch) s.timer = setTimeout(() => activate(s), o.touchDelay ?? 280);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    window.addEventListener('keydown', onKey, true);
    window.addEventListener('contextmenu', onCtx, true);
  });
}

const ctxOf = (s) => ({ el: s.el, x: s.x, y: s.y, startX: s.startX, startY: s.startY, offsetX: s.offsetX, offsetY: s.offsetY, rect: s.rect, ghost: s.ghost });

function activate(s) {
  if (session !== s || s.active) return;
  if (s.o.onStart && s.o.onStart(ctxOf(s)) === false) { teardown(); return; }
  s.active = true;
  clearTimeout(s.timer);
  document.documentElement.classList.add('is-dragging');
  if (s.o.ghost !== false) {
    const g = s.el.cloneNode(true);
    g.classList.add('drag-ghost');
    g.removeAttribute('id');
    Object.assign(g.style, { position: 'fixed', left: '0', top: '0', width: s.rect.width + 'px', height: s.rect.height + 'px', margin: '0', pointerEvents: 'none', zIndex: '9999' });
    document.body.append(g);
    s.ghost = g;
  }
  place(s);
  window.addEventListener('touchmove', blockTouch, { passive: false });
  loop(s);
  s.o.onMove?.(ctxOf(s));
}
function place(s) {
  if (s.ghost) s.ghost.style.transform = `translate(${s.x - s.offsetX}px, ${s.y - s.offsetY}px)`;
}
const blockTouch = (e) => { if (session?.active && e.cancelable) e.preventDefault(); };
const onCtx = (e) => { if (session && (session.touch || session.active)) e.preventDefault(); };

function onMove(e) {
  const s = session;
  if (!s || e.pointerId !== s.id) return;
  s.x = e.clientX; s.y = e.clientY;
  if (!s.active) {
    const d = Math.hypot(s.x - s.startX, s.y - s.startY);
    if (s.touch) { if (d > 10) teardown(); }          // Finger bewegt sich vor dem Halten = Scrollen
    else if (d > (s.o.threshold ?? 5)) activate(s);
    return;
  }
  place(s);
  s.o.onMove?.(ctxOf(s));
}
function onUp(e) {
  const s = session;
  if (!s || e.pointerId !== s.id) return;
  s.x = e.clientX; s.y = e.clientY;
  const was = s.active;
  if (was) {
    s.o.onEnd?.(ctxOf(s), false);
    suppressClick();
  }
  teardown();
}
function onCancel(e) {
  const s = session;
  if (!s || e.pointerId !== s.id) return;
  if (s.active) s.o.onEnd?.(ctxOf(s), true);
  teardown();
}
function onKey(e) {
  if (e.key === 'Escape' && session?.active) {
    e.preventDefault(); e.stopPropagation();
    session.o.onEnd?.(ctxOf(session), true);
    suppressClick();
    teardown();
  }
}
function suppressClick() {
  const stop = (ev) => { ev.stopPropagation(); ev.preventDefault(); };
  window.addEventListener('click', stop, true);
  setTimeout(() => window.removeEventListener('click', stop, true), 60);
}
function teardown() {
  const s = session;
  if (!s) return;
  clearTimeout(s.timer);
  cancelAnimationFrame(s.raf);
  s.ghost?.remove();
  document.documentElement.classList.remove('is-dragging');
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', onCancel);
  window.removeEventListener('keydown', onKey, true);
  window.removeEventListener('contextmenu', onCtx, true);
  window.removeEventListener('touchmove', blockTouch);
  session = null;
}

/** Scrollt Container, in dessen Randzone der Zeiger steht; ruft danach onMove neu auf (Ziel hat sich verschoben). */
function loop(s) {
  const EDGE = 56, MAX = 18;
  const tick = () => {
    if (session !== s) return;
    let moved = false;
    for (const sc of s.o.scrollers?.() || []) {
      const r = sc.getBoundingClientRect();
      if (s.x < r.left || s.x > r.right || s.y < r.top || s.y > r.bottom) continue;
      const dy = s.y - r.top < EDGE ? -(EDGE - (s.y - r.top)) : r.bottom - s.y < EDGE ? EDGE - (r.bottom - s.y) : 0;
      const dx = s.x - r.left < EDGE ? -(EDGE - (s.x - r.left)) : r.right - s.x < EDGE ? EDGE - (r.right - s.x) : 0;
      if (dy && sc.scrollHeight > sc.clientHeight) { const b = sc.scrollTop; sc.scrollTop += (dy / EDGE) * MAX; moved ||= sc.scrollTop !== b; }
      if (dx && sc.scrollWidth > sc.clientWidth) { const b = sc.scrollLeft; sc.scrollLeft += (dx / EDGE) * MAX; moved ||= sc.scrollLeft !== b; }
    }
    if (moved) s.o.onMove?.(ctxOf(s));
    s.raf = requestAnimationFrame(tick);
  };
  s.raf = requestAnimationFrame(tick);
}

export const isDragging = () => !!session?.active;
