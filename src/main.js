import './style.css';
import { haversineKm, rotateShape, unwrapAround } from './geo.js';
import { detectLang, formatNumber, getLang, riverName, setLang, t, translatePage } from './i18n.js';
import { createMap } from './map.js';
import { isRepeat, matchCity } from './match.js';
import { isValidSeed, randomSeed } from './rng.js';
import { buildGame, MODES } from './rounds.js';
import { citiesScore, citiesTarget, distanceScore, planformScore, ROUND_MAX } from './scoring.js';
import { outlineSvg, planformSvg } from './shapes.js';

const $ = (id) => document.getElementById(id);
const ui = {
  home: $('home'), panel: $('panel'), results: $('results'), hud: $('hud'),
  hudRound: $('hud-round'), hudScore: $('hud-score'), play: $('play'), status: $('status'),
  roundLabel: $('round-label'), prompt: $('prompt'), help: $('help'), stage: $('round-stage'),
  feedback: $('feedback'), primary: $('primary'), timerFill: $('timer-fill'), timerSecs: $('timer-secs'),
  total: $('total'), outOf: $('out-of'), breakdown: $('breakdown'), share: $('share'),
  again: $('again'), toHome: $('to-home'), shareNote: $('share-note'), lang: $('lang-toggle'),
  synthetic: $('synthetic'),
};

const params = new URLSearchParams(location.search);
const state = {
  rivers: [],
  byId: new Map(),
  challenge: isValidSeed(params.get('seed')) ? params.get('seed') : null,
  challengeMode: MODES.includes(params.get('mode')) ? params.get('mode') : 'mix',
  game: null,
  index: 0,
  results: [],
  round: null,
  screen: 'home',
};

let stored = null;
try { stored = localStorage.getItem('cuenca.lang'); } catch { /* storage unavailable */ }
setLang(detectLang(params, stored, navigator.languages || [navigator.language]));

const globe = createMap($('map'));

// ---------------------------------------------------------------- timer

const timer = {
  raf: 0, start: 0, seconds: 0, onEnd: null, stopped: true,
  run(seconds, onEnd) {
    this.stop();
    Object.assign(this, { start: performance.now(), seconds, onEnd, stopped: false });
    const tick = (now) => {
      const left = Math.max(0, this.seconds - (now - this.start) / 1000);
      ui.timerFill.style.transform = `scaleX(${left / this.seconds})`;
      ui.timerFill.classList.toggle('low', left < 5);
      ui.timerSecs.textContent = `${Math.ceil(left)}s`;
      if (left <= 0) {
        this.stop();
        this.onEnd?.();
      } else {
        this.raf = requestAnimationFrame(tick);
      }
    };
    this.raf = requestAnimationFrame(tick);
  },
  fractionLeft() {
    return Math.max(0, 1 - (performance.now() - this.start) / 1000 / this.seconds);
  },
  stop() {
    cancelAnimationFrame(this.raf);
    this.stopped = true;
  },
};

// ---------------------------------------------------------------- helpers

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children.filter((c) => c != null));
  return node;
}

function setFeedback(text, tone = '') {
  ui.feedback.textContent = text;
  ui.feedback.className = `feedback ${tone}`;
}

function setPrimary(label, onClick, enabled = true) {
  ui.primary.textContent = label;
  ui.primary.disabled = !enabled;
  ui.primary.onclick = onClick;
}

function facts(river) {
  const bits = [t('lengthKm', { km: formatNumber(river.lengthKm) })];
  if (river.basinKm2) bits.push(t('basinKm2', { km2: formatNumber(river.basinKm2) }));
  return el('p', { className: 'facts', textContent: bits.join(' · ') });
}

// ---------------------------------------------------------------- round modes

const MODE_HANDLERS = {
  planform(river, spec, finish) {
    ui.prompt.textContent = t('prompt.planform');
    ui.help.textContent = t('help.planform');
    globe.overview();
    const options = spec.options.map((id, i) => {
      const r = state.byId.get(id);
      const btn = el('button', { type: 'button', className: 'option' }, el('kbd', { textContent: i + 1 }), riverName(r));
      btn.dataset.id = id;
      btn.onclick = () => choose(id);
      return btn;
    });
    ui.stage.append(planformSvg(river.line), el('div', { className: 'options' }, ...options));
    setPrimary(t('confirm'), null, false);
    ui.primary.hidden = true;

    let done = false;
    function choose(id) {
      if (done) return;
      done = true;
      const correct = id === river.id;
      const score = planformScore(correct, timer.fractionLeft());
      for (const btn of options) {
        btn.disabled = true;
        if (btn.dataset.id === river.id) btn.classList.add('right');
        else if (btn.dataset.id === id) btn.classList.add('wrong');
      }
      ui.primary.hidden = false;
      setFeedback(correct ? t('correct') : id ? t('wrong', { river: riverName(river) }) : t('timeUp'), correct ? 'good' : 'bad');
      ui.stage.append(facts(river));
      globe.showRiver(river.line);
      if (river.basin) globe.showBasin(river.basin);
      globe.fit(river.basin ? river.basin.flat(2) : river.line);
      finish(score, [correct ? 'correct' : 'missed']);
    }
    return {
      timeout: () => choose(null),
      key(e) {
        const n = Number(e.key);
        if (n >= 1 && n <= options.length) choose(options[n - 1].dataset.id);
      },
    };
  },

  basin(river, spec, finish) {
    const name = riverName(river);
    ui.prompt.textContent = t('prompt.basin', { river: name });
    ui.help.textContent = t('help.basin');
    ui.stage.append(outlineSvg(river.basin, river.basinCentroid));
    globe.overview();
    let placed = null;
    let done = false;
    let ghost = null;
    globe.onClick((lngLat) => {
      if (done) return;
      placed = lngLat;
      ghost = unwrapAround(rotateShape(river.basin, river.basinCentroid, placed), placed[0]);
      globe.showGhost(ghost);
      ui.primary.disabled = false;
    });
    setPrimary(t('confirm'), () => submit(), false);

    function submit() {
      if (done) return;
      done = true;
      globe.onClick(null);
      globe.showBasin(river.basin);
      globe.showRiver(river.line);
      globe.addMarker(river.basinCentroid, { className: 'truth' });
      let score = 0;
      if (placed) {
        const km = Math.round(haversineKm(placed, river.basinCentroid));
        score = distanceScore(km);
        globe.addMarker(placed, { className: 'guess' });
        globe.showLink(placed, river.basinCentroid);
        setFeedback(t('distance', { km: formatNumber(km) }), score >= 2500 ? 'good' : 'bad');
        globe.fit([...river.basin.flat(2), ...ghost.flat(2)], { maxZoom: 5 });
        finish(score, ['distance', { km }]);
      } else {
        setFeedback(t('noPlacement'), 'bad');
        globe.fit(river.basin.flat(2));
        finish(0, ['noPlacement']);
      }
      ui.stage.append(facts(river));
    }
    return { timeout: submit, key() {} };
  },

  cities(river, spec, finish) {
    const name = riverName(river);
    const target = citiesTarget(river.cities.length);
    ui.prompt.textContent = t('prompt.cities', { river: name });
    ui.help.textContent = t('help.cities', { target });
    globe.showRiver(river.line);
    globe.fit(river.line, { maxZoom: 6 });

    const found = new Set();
    const input = el('input', {
      type: 'text', autocomplete: 'off', autocapitalize: 'words', spellcheck: false,
      placeholder: t('cityPlaceholder'), enterKeyHint: 'enter',
    });
    input.setAttribute('aria-label', t('cityPlaceholder'));
    const form = el('form', { className: 'city-form' }, input);
    const count = el('p', { className: 'found-count' });
    const list = el('ul', { className: 'found' });
    ui.stage.append(form, count, list);
    const updateCount = () => { count.textContent = t('found', { n: found.size, target }); };
    updateCount();
    setPrimary(t('giveUp'), () => end(), true);
    setTimeout(() => input.focus({ preventScroll: true }), 50);

    let done = false;
    form.onsubmit = (e) => {
      e.preventDefault();
      if (done) return;
      const guess = input.value;
      if (!guess.trim()) return;
      // check repeats first so a re-typed city can't fuzzy-match a neighbour
      const repeat = isRepeat(guess, river.cities, found);
      const hit = repeat ? null : matchCity(guess, river.cities, found);
      input.value = '';
      if (hit) {
        found.add(hit.city.id);
        list.append(el('li', { textContent: hit.city.name }));
        globe.addMarker([hit.city.lon, hit.city.lat], { label: hit.city.name });
        setFeedback(hit.exact ? `✓ ${hit.city.name}` : t('typoAccepted', { name: hit.city.name }), 'good');
        updateCount();
        if (found.size >= target) end();
      } else {
        setFeedback(repeat ? t('already') : t('notOnRiver'), 'bad');
        input.classList.remove('shake');
        void input.offsetWidth;
        input.classList.add('shake');
      }
    };

    function end() {
      if (done) return;
      done = true;
      input.disabled = true;
      for (const c of river.cities) {
        if (found.has(c.id)) continue;
        list.append(el('li', { className: 'missed', textContent: c.name }));
        globe.addMarker([c.lon, c.lat], { label: c.name, className: 'missed' });
      }
      const score = citiesScore(found.size, river.cities.length);
      if (found.size < target) setFeedback(t('found', { n: found.size, target }), found.size ? '' : 'bad');
      ui.stage.append(facts(river));
      finish(score, ['found', { n: found.size, target }]);
    }
    return { timeout: end, key() {} };
  },
};

// ---------------------------------------------------------------- game flow

function show(screen) {
  state.screen = screen;
  ui.home.hidden = screen !== 'home';
  ui.panel.hidden = screen !== 'round';
  ui.results.hidden = screen !== 'results';
  ui.hud.hidden = screen === 'home';
  globe.spin(screen !== 'round');
  requestAnimationFrame(() => globe.resize());
}

function startGame(seed, mode) {
  state.game = buildGame(state.rivers, seed, mode);
  state.index = 0;
  state.results = [];
  const url = new URL(location.href);
  url.searchParams.set('seed', seed);
  if (mode === 'mix') url.searchParams.delete('mode');
  else url.searchParams.set('mode', mode);
  history.replaceState(null, '', url);
  show('round');
  startRound();
}

function totalScore() {
  return state.results.reduce((sum, r) => sum + r.score, 0);
}

function startRound() {
  const spec = state.game.rounds[state.index];
  const river = state.byId.get(spec.riverId);
  globe.clear();
  ui.stage.replaceChildren();
  ui.primary.hidden = false;
  setFeedback('');
  ui.panel.querySelector('.panel-body').scrollTop = 0;
  const total = state.game.rounds.length;
  ui.roundLabel.textContent = `${t(`mode.${spec.mode}`)} · ${state.index + 1}/${total}`;
  ui.hudRound.textContent = t('round', { n: state.index + 1, total });
  ui.hudScore.textContent = formatNumber(totalScore());

  let finished = false;
  const finish = (score, summary) => {
    if (finished) return;
    finished = true;
    timer.stop();
    state.results.push({ mode: spec.mode, riverId: river.id, score, summary });
    ui.hudScore.textContent = formatNumber(totalScore());
    const last = state.index === total - 1;
    ui.primary.hidden = false;
    setPrimary(last ? t('results') : t('next'), () => {
      if (last) showResults();
      else {
        state.index += 1;
        startRound();
      }
    });
    ui.primary.focus({ preventScroll: true });
  };
  state.round = MODE_HANDLERS[spec.mode](river, spec, finish);
  timer.run(spec.seconds, () => state.round.timeout());
}

// Round summaries are stored as [key, vars] so they re-render in the current language.
function summaryText([key, vars = {}]) {
  return t(key, 'km' in vars ? { ...vars, km: formatNumber(vars.km) } : vars);
}

const SQUARES = (score) => (score >= 4000 ? '🟦' : score >= 2000 ? '🟨' : score > 0 ? '🟧' : '⬜');

function showResults() {
  globe.clear();
  globe.overview();
  const max = state.game.rounds.length * ROUND_MAX;
  ui.total.textContent = formatNumber(totalScore());
  ui.outOf.textContent = t('outOf', { max: formatNumber(max) });
  ui.shareNote.textContent = '';
  ui.breakdown.replaceChildren(
    ...state.results.map((r) => {
      const river = state.byId.get(r.riverId);
      return el(
        'li', {},
        el('span', { textContent: `${t(`mode.${r.mode}`)} · ${riverName(river)}` }),
        el('b', { textContent: formatNumber(r.score) }),
        el('small', { textContent: summaryText(r.summary) }),
        el('span', { className: 'bar' }, el('i', { style: `width:${(100 * r.score) / ROUND_MAX}%` })),
      );
    }),
  );
  ui.hudRound.textContent = t('round', { n: state.game.rounds.length, total: state.game.rounds.length });
  show('results');
  ui.again.focus({ preventScroll: true });
}

async function share() {
  const max = state.game.rounds.length * ROUND_MAX;
  const url = new URL(location.href);
  url.searchParams.set('seed', state.game.seed);
  const text = `${t('shareText', { score: formatNumber(totalScore()), max: formatNumber(max) })} ${state.results.map((r) => SQUARES(r.score)).join('')}`;
  try {
    if (navigator.share && matchMedia('(pointer: coarse)').matches) {
      await navigator.share({ text, url: url.toString() });
      return;
    }
    await navigator.clipboard.writeText(`${text}\n${url}`);
    ui.shareNote.textContent = t('copied');
  } catch {
    ui.shareNote.textContent = url.toString();
  }
}

function goHome() {
  timer.stop();
  globe.clear();
  globe.overview();
  history.replaceState(null, '', location.pathname);
  state.challenge = null;
  renderHome();
  show('home');
}

function renderHome() {
  translatePage();
  ui.lang.textContent = t('language');
  ui.play.textContent = state.challenge ? t('playChallenge', { seed: state.challenge }) : t('play');
  if (state.rivers.length) ui.status.textContent = t('rivers', { n: state.rivers.length });
}

// ---------------------------------------------------------------- events

ui.play.onclick = () => startGame(state.challenge || randomSeed(), state.challenge ? state.challengeMode : 'mix');
for (const btn of document.querySelectorAll('[data-mode]')) {
  btn.onclick = () => startGame(randomSeed(), btn.dataset.mode);
}
ui.again.onclick = () => startGame(randomSeed(), state.game.mode);
ui.toHome.onclick = goHome;
ui.share.onclick = share;
$('brand').onclick = (e) => {
  e.preventDefault();
  goHome();
};
ui.lang.onclick = () => {
  setLang(getLang() === 'en' ? 'es' : 'en');
  try { localStorage.setItem('cuenca.lang', getLang()); } catch { /* ignore */ }
  renderHome();
  if (state.game) ui.hudScore.textContent = formatNumber(totalScore());
  if (state.screen === 'results') showResults();
  if (state.screen === 'round') relabelRound();
};

// Language switches mid-round only relabel static text; the round itself keeps going.
function relabelRound() {
  const spec = state.game.rounds[state.index];
  const river = state.byId.get(spec.riverId);
  const total = state.game.rounds.length;
  ui.roundLabel.textContent = `${t(`mode.${spec.mode}`)} · ${state.index + 1}/${total}`;
  ui.hudRound.textContent = t('round', { n: state.index + 1, total });
  ui.prompt.textContent = t(`prompt.${spec.mode}`, { river: riverName(river) });
  ui.help.textContent = t(`help.${spec.mode}`, { target: citiesTarget(river.cities.length) });
  for (const btn of ui.stage.querySelectorAll('.option')) {
    btn.lastChild.textContent = riverName(state.byId.get(btn.dataset.id));
  }
}

document.addEventListener('keydown', (e) => {
  if (state.screen !== 'round' || e.target.tagName === 'INPUT') return;
  if (e.key === 'Enter' && !ui.primary.hidden && !ui.primary.disabled && document.activeElement !== ui.primary) {
    e.preventDefault();
    ui.primary.click();
    return;
  }
  if (!timer.stopped) state.round?.key(e);
});

// ---------------------------------------------------------------- boot

async function boot() {
  renderHome();
  try {
    const res = await fetch(`${import.meta.env.BASE_URL}data/rivers.json`);
    if (!res.ok) throw new Error(res.statusText);
    const data = await res.json();
    state.rivers = data.rivers;
    state.byId = new Map(data.rivers.map((r) => [r.id, r]));
    ui.synthetic.hidden = !data.synthetic;
    ui.play.disabled = false;
    for (const btn of document.querySelectorAll('[data-mode]')) btn.disabled = false;
    renderHome();
  } catch (err) {
    console.error(err);
    ui.status.textContent = t('loadError');
  }
}

show('home');
boot();
