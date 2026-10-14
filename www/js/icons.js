// Icons als Inline-SVG (24×24, Strich = currentColor). Kein externes Icon-Paket nötig.
import { h } from './util.js';

const P = {
  list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4 6l1 1 2-2M4 12l1 1 2-2M4 18l1 1 2-2"/>',
  calendar: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  board: '<rect x="3.5" y="4" width="5" height="16" rx="1.2"/><rect x="10" y="4" width="5" height="10" rx="1.2"/><rect x="16.5" y="4" width="4" height="13" rx="1.2"/>',
  lists: '<rect x="4" y="3.5" width="16" height="17" rx="2"/><path d="M8 8.5h8M8 12.5h8M8 16.5h5"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M18.7 5.3l-2.1 2.1M7.4 16.6l-2.1 2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  fit: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
  search: '<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>',
  bell: '<path d="M6 16.5V11a6 6 0 0 1 12 0v5.5l1.5 2h-15z"/><path d="M10 20.5a2.2 2.2 0 0 0 4 0"/>',
  chevL: '<path d="M14.5 5.5L8 12l6.5 6.5"/>',
  chevR: '<path d="M9.5 5.5L16 12l-6.5 6.5"/>',
  chevD: '<path d="M5.5 9.5L12 16l6.5-6.5"/>',
  chevU: '<path d="M5.5 14.5L12 8l6.5 6.5"/>',
  x: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  trash: '<path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10.5 11v6M13.5 11v6"/>',
  edit: '<path d="M4 20l1-4L16.5 4.5a2 2 0 0 1 3 3L8 19z"/><path d="M14.5 6.5l3 3"/>',
  undo: '<path d="M9 8L4.5 12.5 9 17"/><path d="M5 12.5h9a5 5 0 0 1 0 10"/>',
  more: '<circle cx="5.5" cy="12" r="1.3" fill="currentColor"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/><circle cx="18.5" cy="12" r="1.3" fill="currentColor"/>',
  menu: '<path d="M4 6.5h16M4 12h16M4 17.5h16"/>',
  sidebar: '<rect x="3.5" y="4.5" width="17" height="15" rx="2"/><path d="M9.5 4.5v15"/>',
  download: '<path d="M12 4v11M7.5 10.5L12 15l4.5-4.5M5 19.5h14"/>',
  upload: '<path d="M12 16V5M7.5 9.5L12 5l4.5 4.5M5 19.5h14"/>',
  tag: '<path d="M3.5 12.5V4.5h8l9 9-8 8z"/><circle cx="8" cy="9" r="1.2" fill="currentColor"/>',
  clock: '<circle cx="12" cy="12" r="8.5"/><path d="M12 7v5l3.5 2"/>',
  up: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  down: '<path d="M12 5v14M6 13l6 6 6-6"/>',
  inbox: '<path d="M4 13l2.5-7.5h11L20 13v6H4z"/><path d="M4 13h4.5l1 2h5l1-2H20"/>',
  bulb: '<path d="M9.5 17.5h5M10 20.5h4M12 3.5a6 6 0 0 0-3.6 10.8c.7.6 1.1 1.3 1.1 2.2h5c0-.9.4-1.6 1.1-2.2A6 6 0 0 0 12 3.5z"/>',
  grip: '<circle cx="9" cy="6" r="1.2" fill="currentColor"/><circle cx="15" cy="6" r="1.2" fill="currentColor"/><circle cx="9" cy="12" r="1.2" fill="currentColor"/><circle cx="15" cy="12" r="1.2" fill="currentColor"/><circle cx="9" cy="18" r="1.2" fill="currentColor"/><circle cx="15" cy="18" r="1.2" fill="currentColor"/>',
  convert: '<path d="M4 7h13l-3-3M20 17H7l3 3"/>',
  filter: '<path d="M4 5h16l-6 7.5V19l-4 1.5v-8z"/>',
  moon: '<path d="M19.5 14.5A8 8 0 0 1 9.5 4.5a8 8 0 1 0 10 10z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6L7 7M17 17l1.4 1.4M18.4 5.6L17 7M7 17l-1.4 1.4"/>',
  info: '<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5M12 8v.01"/>',
  copy: '<rect x="8" y="8" width="11.5" height="11.5" rx="2"/><path d="M5 15.5V6a1.5 1.5 0 0 1 1.5-1.5H16"/>',
  alert: '<path d="M12 4l9 15.5H3z"/><path d="M12 10v4.5M12 17.5v.01"/>',
  eye: '<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12z"/><circle cx="12" cy="12" r="2.8"/>',
};

export function icon(name, { size = 20, cls = '' } = {}) {
  const span = h('span', { class: `ico ${cls}`.trim(), 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" focusable="false">${P[name] || ''}</svg>`;
  return span;
}

/** Prioritäts-Zeichen aus drei Balken: Stufe 1–3 gefüllt – damit die Priorität nicht nur an der Farbe hängt. */
export function prioIcon(level, { size = 16 } = {}) {
  const span = h('span', { class: 'ico prio-ico', 'aria-hidden': 'true' });
  const bars = [0, 1, 2].map((n) => {
    const hgt = 5 + n * 4;
    return `<rect x="${3 + n * 6}" y="${19 - hgt}" width="4" height="${hgt}" rx="1" fill="currentColor" opacity="${n < level ? 1 : .22}"/>`;
  }).join('');
  span.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" focusable="false">${bars}</svg>`;
  return span;
}

/** Oregano-Logo (stilisiertes Blatt): Stängel mit drei Blattpaaren. */
export function logoSvg(size = 32) {
  const span = h('span', { class: 'logo', 'aria-hidden': 'true' });
  span.innerHTML = `<svg viewBox="0 0 64 64" width="${size}" height="${size}" focusable="false">
    <rect width="64" height="64" rx="14" fill="var(--logo-bg, #2e7d32)"/>
    <g fill="var(--logo-fg, #f4fbf4)">
      <path d="M31 54c0-10 .6-22 1.8-34" stroke="var(--logo-fg, #f4fbf4)" stroke-width="2.6" stroke-linecap="round" fill="none"/>
      <ellipse cx="22" cy="41" rx="9" ry="5" transform="rotate(-38 22 41)"/>
      <ellipse cx="43" cy="39" rx="9" ry="5" transform="rotate(38 43 39)"/>
      <ellipse cx="23" cy="28" rx="8" ry="4.4" transform="rotate(-38 23 28)"/>
      <ellipse cx="42" cy="26" rx="8" ry="4.4" transform="rotate(38 42 26)"/>
      <ellipse cx="33" cy="14" rx="4.2" ry="7.5" transform="rotate(8 33 14)"/>
    </g></svg>`;
  return span;
}
