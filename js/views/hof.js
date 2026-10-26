// The Hall of Fame: every manager in league history rated out of 100, grouped into tiers, each with a
// title of their own. The rating and titles come from js/hof.js.
import { setQuery } from '../app.js';
import { esc, ordinal, initials, empty } from '../ui.js';
import { hallOfFame, plaque, TIERS, HOF_WEIGHTS as W } from '../hof.js';

const BARS = [['hardware', 'Hardware'], ['postseason', 'Postseason'], ['dominance', 'Dominance'], ['winning', 'Winning'], ['longevity', 'Longevity']];

function seasonChip(year, t) {
  if (!t) return `<span class="hs none" title="${year}: not in the league">·</span>`;
  if (t.skipped) return `<span class="hs unk" title="${year}: took over a team mid-season, so this season doesn't count">–</span>`;
  if (t.live) return `<span class="hs live" title="${year}: ${ordinal(t.seed)} right now, season in progress">${ordinal(t.seed)}*</span>`;
  if (t.champ) return `<span class="hs champ" title="${year}: champion">🏆</span>`;
  if (t.place === 2) return `<span class="hs silver" title="${year}: runner-up">2nd</span>`;
  if (t.last) return `<span class="hs last" title="${year}: last place">🚽</span>`;
  if (t.place === 3) return `<span class="hs bronze" title="${year}: third place">3rd</span>`;
  if (t.place) return `<span class="hs" title="${year}: finished ${ordinal(t.place)}">${ordinal(t.place)}</span>`;
  return `<span class="hs unk" title="${year}: in the league, finish not on file">✓</span>`;
}

function hardware(r) {
  const item = (icon, n, label, years) => (n ? `<span class="hw" title="${esc(`${label}: ${years.join(', ')}`)}">${icon}${n > 1 ? `<b>×${n}</b>` : ''}</span>` : '');
  const html = [
    item('🏆', r.titles.length, 'Champion', r.titles),
    item('🥈', r.runnerUps.length, 'Runner-up', r.runnerUps),
    item('🥉', r.thirds.length, 'Third place', r.thirds),
    item('👑', r.crowns.length, 'Regular-season crown', r.crowns),
    item('💰', r.pfKings.length, 'Points-for crown', r.pfKings),
    r.lastPlaces ? `<span class="hw shame" title="Last place ×${r.lastPlaces}">🚽${r.lastPlaces > 1 ? `<b>×${r.lastPlaces}</b>` : ''}</span>` : '',
  ].join('');
  return html || '<span class="muted small">No hardware yet</span>';
}

function card(r, years) {
  const av = r.avatar ? `<img src="${esc(r.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span>${esc(initials(r.name))}</span>`;
  return `<article class="hof-card t-${r.tier.key}${r.active ? '' : ' retired'}" aria-label="${esc(`${r.name}, rated ${r.ovr}, ${r.title}`)}">
    <div class="hc-head">
      <span class="hc-av">${av}</span>
      <div class="hc-id"><a class="hc-name" href="#/managers/${encodeURIComponent(r.id)}">${esc(r.name)}</a><div class="hc-title">${esc(r.title)}${r.active ? '' : ' <span class="hc-ret">Retired</span>'}</div></div>
      <div class="hc-ovr"><b>${r.ovr}</b><small>#${r.rank}</small></div>
    </div>
    <div class="hc-hw">${hardware(r)}</div>
    ${r.titleNote ? `<p class="hc-note">${esc(r.titleNote)}</p>` : ''}
    <div class="hc-bars">${BARS.map(([k, label]) => `<div class="hb"><span>${label}</span><i><em style="width:${Math.max(2, r.bars[k])}%"></em></i></div>`).join('')}</div>
    <div class="hc-time" aria-label="Finish by season">${years.map(y => `<div><small>'${y.slice(2)}</small>${seasonChip(y, r.timeline[y])}</div>`).join('')}</div>
    <p class="hc-plaque">${esc(plaque(r))}</p>
    <div class="hc-foot"><span>${r.w + r.l + r.t ? `${r.w}-${r.l}${r.t ? `-${r.t}` : ''} on Sleeper` : 'No Sleeper games'}</span><span>${r.seasons.length} season${r.seasons.length === 1 ? '' : 's'}</span><span>${Math.round(r.raw)} legacy pts</span></div>
  </article>`;
}

export function hallOfFamePage(model, { q }, el) {
  const all = hallOfFame(model);
  if (!all.length) { el.innerHTML = `<h1>Hall of Fame</h1>${empty('🏛️', 'No careers to rate yet', 'The Hall of Fame fills in once a season has games.')}`; return; }
  const activeOnly = q.active === '1';
  const list = activeOnly ? all.filter(r => r.active) : all;
  const years = [...new Set([...model.seasons.map(s => s.season), ...(model.legacy?.seasons || []).map(s => s.season)])].sort();
  const legacyNote = model.legacy?.seasons?.length ? ` Seasons before Sleeper (${model.legacy.seasons.map(s => s.season).join(', ')}) count their champion, runner-up and last place; their full standings aren't on file yet.` : '';

  el.innerHTML = `<h1>Hall of Fame</h1>
    <p class="sub">Every manager in league history, rated out of 100. Rings count most, then playoff runs, then how often you outscored the league week to week. Every manager gets a tier and a title.</p>
    <div class="toolbar"><label class="muted"><input type="checkbox" id="hofact" ${activeOnly ? 'checked' : ''}> Current managers only</label></div>
    ${TIERS.map(t => {
      const members = list.filter(r => r.tier.key === t.key);
      if (!members.length) return '';
      return `<section class="hof-tier t-${t.key}"><div class="hof-th"><h2>${esc(t.label)}</h2><span>${esc(t.blurb)}</span><span class="cnt">${members.length}</span></div>
        <div class="hof-grid">${members.map(r => card(r, years)).join('')}</div></section>`;
    }).join('')}
    <details class="card hof-how"><summary>How the rating works</summary>
      <p>Each career earns legacy points, and the ratings spread everyone from 45 (fewest points) to 99 (most), with a curve that lifts the middle of the pack.</p>
      <table class="hof-w"><tbody>
        <tr><th>Hardware</th><td>${W.title} a title, ${W.runnerUp} a runner-up, ${W.third} a third place, ${W.crown} a regular-season crown (1st seed), ${W.pfKing} a points-for crown</td></tr>
        <tr><th>Postseason</th><td>${W.trip} a playoff trip, ${W.playoffWin} a playoff win</td></tr>
        <tr><th>Dominance</th><td>(all-play % − 50%) × ${W.dominance} a season. All-play is how often your score would beat everyone else's that week, so luck of the schedule doesn't count. A 65% season is worth +9</td></tr>
        <tr><th>Winning</th><td>(win % − 50%) × ${W.winning} a season, so a 10-4 season is worth about +5</td></tr>
        <tr><th>Longevity</th><td>${W.season} a season in the league</td></tr>
        <tr><th>Shame</th><td>${W.lastPlace} a last place</td></tr>
      </tbody></table>
      <p class="muted small">A season still in progress counts for dominance and winning in proportion to the games played, and earns hardware once it's final. The bars on each card compare that part of the career with the league's best at it. Titles go out in rating order, and no two managers share one.${legacyNote}</p>
    </details>`;
  el.querySelector('#hofact').onchange = e => setQuery({ active: e.target.checked ? '1' : '' });
}
