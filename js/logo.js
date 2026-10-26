// The league crest: a shield in the team colors with a football and the league's initials. It reads the
// colorway's CSS variables, so it changes with the look.
import { CONFIG } from './config.js';
import { esc } from './ui.js';

const SKIP = /^(the|of|and|a|an|league|fantasy|ff|football|ffl|nfl)$/i;

/** Up to three letters from the league name: "Sunday Funday League" -> "SF". */
export function monogram(name = CONFIG.SITE_NAME) {
  const words = String(name || '').replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const keep = words.filter(w => !SKIP.test(w));
  const use = keep.length ? keep : words;
  let m = use.length === 1 ? use[0].slice(0, 2) : use.slice(0, 3).map(w => w[0]).join('');
  m = m.toUpperCase();
  return m || 'FF';
}

/** The crest. `name` gives the initials; an empty name draws the plain crest with just the football. */
export function logo(cls = 'logo', name = CONFIG.SITE_NAME) {
  const m = name === '' ? '' : monogram(name);
  const size = m.length >= 3 ? 19 : 24;
  return `<svg class="${cls}" viewBox="0 0 100 100" role="img" aria-label="${esc(name || 'League')} crest">
    <path d="M50 4 L89 15 V47 C89 71 73 88 50 97 C27 88 11 71 11 47 V15 Z" style="fill:var(--brand);stroke:var(--trim)" stroke-width="4" stroke-linejoin="round"/>
    <path d="M50 12 L81 21 V47 C81 66 68 80 50 88 C32 80 19 66 19 47 V21 Z" fill="none" style="stroke:var(--trim)" stroke-width="1.4" opacity=".55"/>
    <g transform="translate(50 ${m ? 37 : 50}) rotate(-28)${m ? '' : ' scale(1.35)'}">
      <path d="M-22 0 C-14 -13 14 -13 22 0 C14 13 -14 13 -22 0 Z" style="fill:var(--trim)"/>
      <path d="M-15 -5.5 C-13 -2 -13 2 -15 5.5 M15 -5.5 C13 -2 13 2 15 5.5" fill="none" style="stroke:var(--brand)" stroke-width="1.6" stroke-linecap="round"/>
      <path d="M-8 0 H8 M-5 -3 V3 M-1.7 -3 V3 M1.7 -3 V3 M5 -3 V3" fill="none" style="stroke:var(--brand)" stroke-width="1.6" stroke-linecap="round"/>
    </g>
    ${m ? `<text x="50" y="${m.length >= 3 ? 73 : 75}" text-anchor="middle" font-size="${size}" style="fill:var(--trim-ink);font-family:var(--varsity, Georgia, serif)" letter-spacing="1">${esc(m)}</text>` : ''}
  </svg>`;
}
