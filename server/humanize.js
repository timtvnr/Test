// Moteur de « humanisation » : calcule QUAND une action aura lieu.
// Rien ici ne parle au réseau — uniquement de la logique de rythme, testable.

export const DEFAULTS = {
  maxOpsPerDay: 60,
  minGapSeconds: 90,
  maxGapMinutes: 9,
  breakEvery: 8,
  breakMinMinutes: 6,
  breakMaxMinutes: 18,
  activeStartHour: 9,
  activeEndHour: 22,
  maxConcurrentSessions: 1,
  skipChancePct: 12,
  pauseOutsideHours: true,
};

// Les réglages ne peuvent que DURCIR les limites basses du produit.
export const HARD_LIMITS = {
  maxOpsPerDay: { min: 1, max: 200 },
  minGapSeconds: { min: 45, max: 3600 },
  maxGapMinutes: { min: 2, max: 120 },
  breakEvery: { min: 3, max: 50 },
  breakMinMinutes: { min: 2, max: 60 },
  breakMaxMinutes: { min: 2, max: 120 },
  profile: ['calme', 'naturel', 'actif'],
};

const PROFILES = {
  calme: { gapFactor: 1.45, breakFactor: 1.3, skipBonus: 6 },
  naturel: { gapFactor: 1, breakFactor: 1, skipBonus: 0 },
  actif: { gapFactor: 0.7, breakFactor: 0.8, skipBonus: -4 },
};

export function clamp(n, min, max) {
  return Math.min(max, Math.max(min, n));
}

export function normalizeSettings(input = {}) {
  const out = { ...DEFAULTS };
  for (const [key, limit] of Object.entries(HARD_LIMITS)) {
    if (key === 'profile') {
      out.profile = limit.includes(input.profile) ? input.profile : 'naturel';
      continue;
    }
    const n = Number(input[key]);
    out[key] = Number.isFinite(n) ? clamp(Math.round(n), limit.min, limit.max) : DEFAULTS[key];
  }
  // Cohérence des plages
  if (out.maxGapMinutes * 60 <= out.minGapSeconds) {
    out.maxGapMinutes = clamp(Math.ceil(out.minGapSeconds / 60) + 2, HARD_LIMITS.maxGapMinutes.min, HARD_LIMITS.maxGapMinutes.max);
  }
  if (out.activeEndHour <= out.activeStartHour) {
    out.activeStartHour = DEFAULTS.activeStartHour;
    out.activeEndHour = DEFAULTS.activeEndHour;
  }
  if (out.breakMaxMinutes < out.breakMinMinutes) {
    out.breakMaxMinutes = out.breakMinMinutes;
  }
  out.skipChancePct = Number.isFinite(Number(input.skipChancePct))
    ? clamp(Math.round(Number(input.skipChancePct)), 0, 40)
    : DEFAULTS.skipChancePct;
  out.pauseOutsideHours = input.pauseOutsideHours !== false;
  return out;
}

// Générateur pseudo-aléatoire reproductible (utile pour la simulation/prévisualisation).
export function rng(seed = Date.now()) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

// Distribution en cloche bornée : évite les intervalles trop réguliers.
function bell(rand, min, max) {
  const a = rand() + rand() + rand();
  return min + ((a - 1.5) / 1.5 + 1) * 0.5 * (max - min);
}

export const businessHoursFor = (settings) => ({
  startHour: settings.activeStartHour,
  endHour: settings.activeEndHour,
});

export function isWithinActiveHours(date, settings) {
  const h = date.getHours() + date.getMinutes() / 60;
  return h >= settings.activeStartHour && h < settings.activeEndHour;
}

// Prochain créneau d'activité (aujourd'hui ou demain) à partir de `date`.
export function nextActiveMoment(date, settings, rand = Math.random) {
  const d = new Date(date);
  if (isWithinActiveHours(d, settings)) return d;
  d.setSeconds(0, 0);
  if (d.getHours() + d.getMinutes() / 60 >= settings.activeEndHour) {
    d.setDate(d.getDate() + 1);
  }
  d.setHours(settings.activeStartHour, 0, 0, 0);
  // petite dérive pour ne pas démarrer pile à l'heure ronde
  d.setMinutes(Math.floor(rand() * 38));
  return d;
}

export function computeGapMs(settings, rand = Math.random, profileName = settings.profile) {
  const p = PROFILES[profileName] ?? PROFILES.naturel;
  const minMs = settings.minGapSeconds * 1000 * p.gapFactor;
  const maxMs = settings.maxGapMinutes * 60 * 1000 * p.gapFactor;
  const base = bell(rand, minMs, maxMs);
  // 1 chance sur 9 : micro-pause « je regarde le profil » plus longue
  const drift = rand() < 1 / 9 ? base * (0.55 + rand() * 0.9) : base * 0.35;
  return Math.round(Math.max(minMs, base + drift * 0.5));
}

export function computeBreakMs(settings, rand = Math.random) {
  const p = PROFILES[settings.profile] ?? PROFILES.naturel;
  return Math.round(bell(rand, settings.breakMinMinutes * 60000, settings.breakMaxMinutes * 60000) * p.breakFactor);
}

// Simule un lot d'actions et renvoie la chronologie. Aucun appel réseau.
export function simulate(count, settings, { startAt = new Date(), seed = 42, profile = settings.profile } = {}) {
  const rand = rng(seed);
  const s = { ...settings, profile };
  const p = PROFILES[profile] ?? PROFILES.naturel;
  const timeline = [];
  let cursor = nextActiveMoment(startAt, s, rand);
  let sinceBreck = 0;
  let doneToday = 0;
  let day = cursor.toDateString();
  let skipped = 0;

  for (let i = 0; i < count; i++) {
    if (cursor.toDateString() !== day) {
      day = cursor.toDateString();
      doneToday = 0;
      sinceBreck = 0;
    }
    if (s.pauseOutsideHours && !isWithinActiveHours(cursor, s)) {
      cursor = nextActiveMoment(cursor, s, rand);
      day = cursor.toDateString();
      doneToday = 0;
      sinceBreck = 0;
    }
    const atCap = doneToday >= s.maxOpsPerDay;
    if (atCap) {
      cursor = new Date(cursor);
      cursor.setDate(cursor.getDate() + 1);
      cursor.setHours(s.activeStartHour, 5, 0, 0);
      day = cursor.toDateString();
      doneToday = 0;
      sinceBreck = 0;
    }

    // « hésitation » : on saute parfois une cible pour y revenir plus tard
    if (rand() * 100 < Math.max(0, s.skipChancePct + p.skipBonus)) {
      skipped++;
      cursor = new Date(cursor.getTime() + computeGapMs(s, rand, profile));
      continue;
    }

    timeline.push({ index: timeline.length, at: cursor.toISOString() });
    doneToday++;
    sinceBreck++;

    let wait = computeGapMs(s, rand, profile);
    if (sinceBreck >= s.breakEvery) {
      wait += computeBreakMs(s, rand);
      sinceBreck = 0;
    }
    cursor = new Date(cursor.getTime() + wait);
  }

  const last = timeline.at(-1);
  return {
    actions: timeline,
    skipped,
    firstAt: timeline[0]?.at ?? null,
    lastAt: last?.at ?? null,
    totalMs: timeline.length ? new Date(last.at) - new Date(timeline[0].at) : 0,
    days: timeline.length
      ? new Set(timeline.map((t) => t.at.slice(0, 10))).size
      : 0,
  };
}

// Estimation « lisible » : durée moyenne + libellé fr
export function describeDuration(ms) {
  if (!ms || ms < 60000) return 'moins d’une minute';
  const mins = Math.round(ms / 60000);
  const days = Math.floor(mins / 1440);
  const hours = Math.floor((mins % 1440) / 60);
  const rem = mins % 60;
  const parts = [];
  if (days) parts.push(`${days} j`);
  if (hours) parts.push(`${hours} h`);
  if (rem && !days) parts.push(`${rem} min`);
  return parts.join(' ') || `${mins} min`;
}
