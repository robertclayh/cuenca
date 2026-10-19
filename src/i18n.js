const STRINGS = {
  en: {
    tagline: 'A river and watershed geography game',
    intro: 'Three rounds, under a minute. Know a river by its shape, put its basin back on the globe, then name the cities along it.',
    play: 'Play',
    playChallenge: 'Play challenge {seed}',
    newGame: 'New game',
    practice: 'Practice one mode',
    'mode.planform': 'Planform',
    'mode.basin': 'Watershed',
    'mode.cities': 'Cities',
    'modeHint.planform': 'Name the river from its shape alone',
    'modeHint.basin': 'Drop the basin outline where it belongs',
    'modeHint.cities': 'Type the cities on its banks',
    round: 'Round {n} of {total}',
    score: 'Score',
    'prompt.planform': 'Which river is this?',
    'prompt.basin': 'Place the {river} watershed',
    'prompt.cities': 'Name cities on the {river}',
    'help.planform': 'North is up. Pick one, or press 1–4.',
    'help.basin': 'Tap the globe to drop the outline. Tap again to move it.',
    'help.cities': 'Type a city and press Enter. {target} gets you full marks.',
    confirm: 'Confirm',
    giveUp: 'Done',
    next: 'Next',
    results: 'See results',
    cityPlaceholder: 'City name…',
    found: '{n} of {target} found',
    notOnRiver: 'Not on this river in our data',
    already: 'Already found',
    typoAccepted: 'Close enough: {name}',
    timeUp: "Time's up",
    correct: 'Correct',
    wrong: 'It was the {river}',
    distance: '{km} km off',
    noPlacement: 'No placement',
    missed: 'Missed',
    lengthKm: '{km} km long',
    basinKm2: 'Basin {km2} km²',
    final: 'Final score',
    outOf: 'out of {max}',
    share: 'Share',
    copied: 'Link copied',
    shareText: 'Cuenca {score}/{max}',
    again: 'Play again',
    home: 'Home',
    loading: 'Loading rivers…',
    loadError: "River data isn't available yet. Run the data build (see README).",
    synthetic: 'Development data: synthetic rivers, not real geography',
    attribution: 'River and basin data: HydroSHEDS. Settlements: GeoNames. Coastlines: Natural Earth.',
    seed: 'Game {seed}',
    language: 'Español',
    rivers: '{n} rivers',
  },
  es: {
    tagline: 'Un juego de geografía de ríos y cuencas',
    intro: 'Tres rondas, menos de un minuto. Reconoce un río por su forma, devuelve su cuenca al globo y nombra las ciudades a su orilla.',
    play: 'Jugar',
    playChallenge: 'Jugar el reto {seed}',
    newGame: 'Partida nueva',
    practice: 'Practicar un modo',
    'mode.planform': 'Trazado',
    'mode.basin': 'Cuenca',
    'mode.cities': 'Ciudades',
    'modeHint.planform': 'Adivina el río solo por su forma',
    'modeHint.basin': 'Coloca la silueta de la cuenca en su sitio',
    'modeHint.cities': 'Escribe las ciudades de sus orillas',
    round: 'Ronda {n} de {total}',
    score: 'Puntos',
    'prompt.planform': '¿Qué río es este?',
    'prompt.basin': 'Coloca la cuenca del {river}',
    'prompt.cities': 'Nombra ciudades del {river}',
    'help.planform': 'El norte está arriba. Elige una o pulsa 1–4.',
    'help.basin': 'Toca el globo para soltar la silueta. Vuelve a tocar para moverla.',
    'help.cities': 'Escribe una ciudad y pulsa Intro. Con {target} tienes la puntuación máxima.',
    confirm: 'Confirmar',
    giveUp: 'Listo',
    next: 'Siguiente',
    results: 'Ver resultados',
    cityPlaceholder: 'Nombre de la ciudad…',
    found: '{n} de {target} encontradas',
    notOnRiver: 'No está en este río según nuestros datos',
    already: 'Ya la encontraste',
    typoAccepted: 'Casi: {name}',
    timeUp: 'Se acabó el tiempo',
    correct: 'Correcto',
    wrong: 'Era el {river}',
    distance: 'A {km} km',
    noPlacement: 'Sin colocar',
    missed: 'Sin encontrar',
    lengthKm: '{km} km de largo',
    basinKm2: 'Cuenca de {km2} km²',
    final: 'Puntuación final',
    outOf: 'de {max}',
    share: 'Compartir',
    copied: 'Enlace copiado',
    shareText: 'Cuenca {score}/{max}',
    again: 'Jugar otra vez',
    home: 'Inicio',
    loading: 'Cargando ríos…',
    loadError: 'Los datos de los ríos aún no están disponibles. Ejecuta la generación de datos (ver README).',
    synthetic: 'Datos de desarrollo: ríos sintéticos, no geografía real',
    attribution: 'Ríos y cuencas: HydroSHEDS. Localidades: GeoNames. Costas: Natural Earth.',
    seed: 'Partida {seed}',
    language: 'English',
    rivers: '{n} ríos',
  },
};

export const LANGS = Object.keys(STRINGS);
let lang = 'en';

export function detectLang(params, stored, navigatorLangs = []) {
  for (const cand of [params.get('lang'), stored, ...navigatorLangs]) {
    const code = cand?.slice(0, 2).toLowerCase();
    if (LANGS.includes(code)) return code;
  }
  return 'en';
}

export function setLang(code) {
  lang = LANGS.includes(code) ? code : 'en';
  document.documentElement.lang = lang;
}

export function getLang() {
  return lang;
}

export function t(key, vars = {}) {
  const str = STRINGS[lang][key] ?? STRINGS.en[key] ?? key;
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? vars[k] : `{${k}}`));
}

export function riverName(river) {
  return river.name[lang] || river.name.en;
}

export function formatNumber(n) {
  return new Intl.NumberFormat(lang === 'es' ? 'es-ES' : 'en-US').format(n);
}

export function translatePage(root = document) {
  for (const el of root.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  for (const el of root.querySelectorAll('[data-i18n-placeholder]')) el.placeholder = t(el.dataset.i18nPlaceholder);
}

export { STRINGS };
