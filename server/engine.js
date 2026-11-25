// Moteur de session : orchestre les retraits dans le temps, avec les mêmes
// garde-fous que le mode manuel (quota, intervalle minimum, plages horaires).
import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import { config } from './config.js';
import { readStore, writeStore, updateStore } from './store.js';
import * as tiktok from './tiktok.js';
import {
  DEFAULTS,
  normalizeSettings,
  computeGapMs,
  computeBreakMs,
  nextActiveMoment,
  isWithinActiveHours,
  describeDuration,
} from './humanize.js';

export const bus = new EventEmitter();
bus.setMaxListeners(50);

const STATE = 'engine';
const FOLLOWERS = 'followers';

const todayKey = () => new Date().toISOString().slice(0, 10);

async function blankState() {
  return {
    settings: normalizeSettings(config.defaults),
    session: null,
    quota: { date: todayKey(), used: 0 },
    log: [],
    lastManualActionAt: null,
    processed: {},
  };
}

export async function getState() {
  const st = await readStore(STATE, await blankState());
  if (st.quota.date !== todayKey()) {
    st.quota = { date: todayKey(), used: 0 };
  }
  return st;
}

function pushLog(st, entry) {
  const item = { id: crypto.randomUUID(), ts: new Date().toISOString(), ...entry };
  st.log.push(item);
  if (st.log.length > 400) st.log = st.log.slice(-400);
  bus.emit('event', { type: 'log', entry: item });
  return item;
}

async function save(st) {
  await writeStore(STATE, st);
  bus.emit('state', publicState(st));
  return st;
}

// ---------- Minuteur ----------
let timer = null;
let running = false;

function clearTimer() {
  if (timer) clearTimeout(timer);
  timer = null;
}

function schedule(ms) {
  clearTimer();
  const delay = Math.max(250, Math.min(ms, 24 * 3600 * 1000));
  timer = setTimeout(() => {
    tick().catch((err) => {
      console.error('[engine] tick', err);
      bus.emit('event', { type: 'error', message: String(err?.message || err) });
    });
  }, delay);
  if (typeof timer.unref === 'function') timer.unref();
}

function publicState(st) {
  return {
    settings: st.settings,
    session: st.session,
    quota: st.quota,
    lastManualActionAt: st.lastManualActionAt,
  };
}

export async function stateSnapshot() {
  const st = await getState();
  return publicState(st);
}

// ---------- Réglages ----------
export async function saveSettings(input) {
  const st = await getState();
  st.settings = normalizeSettings({ ...st.settings, ...input });
  pushLog(st, { kind: 'settings', message: 'Réglages de rythme mis à jour', settings: st.settings });
  await save(st);
  return st.settings;
}

// ---------- Mode manuel ----------
export async function manualRemove(followerId) {
  const st = await getState();
  const now = Date.now();

  if (st.quota.used >= st.settings.maxOpsPerDay) {
    throw httpError(429, `Quota quotidien atteint (${st.settings.maxOpsPerDay}). Reprise demain à ${st.settings.activeStartHour}h.`);
  }
  if (st.settings.pauseOutsideHours && !isWithinActiveHours(new Date(), st.settings)) {
    throw httpError(423, `Hors plage active (${st.settings.activeStartHour}h–${st.settings.activeEndHour}h). Le rythme humain reprend aux heures d'activité.`);
  }
  if (st.lastManualActionAt) {
    const elapsed = now - new Date(st.lastManualActionAt).getTime();
    const minGap = st.settings.minGapSeconds * 1000;
    if (elapsed < minGap) {
      throw httpError(429, `Trop rapide : encore ${Math.ceil((minGap - elapsed) / 1000)} s avant le prochain retrait (intervalle minimum ${st.settings.minGapSeconds} s).`);
    }
  }

  const followers = await readStore(FOLLOWERS, []);
  const follower = followers.find((f) => f.id === followerId);
  if (!follower) throw httpError(404, 'Follower introuvable');

  const account = await tiktok.currentAccount(await readStore('account', null));
  const result = await tiktok.performUnfollow(account, follower);

  if (!result.ok) {
    pushLog(st, { kind: 'error', message: result.message, code: result.code, follower: follower.handle });
    await save(st);
    throw httpError(409, result.message, { code: result.code });
  }

  follower.status = 'removed';
  follower.removedAt = new Date().toISOString();
  follower.removedMode = 'manual';
  await writeStore(FOLLOWERS, followers);

  st.quota.used += 1;
  st.processed[follower.id] = { at: follower.removedAt, mode: 'manual' };
  st.lastManualActionAt = follower.removedAt;
  pushLog(st, {
    kind: 'action',
    mode: 'manual',
    channel: result.mode,
    follower: follower.handle,
    displayName: follower.displayName,
    message: `Retrait manuel de @${follower.handle}`,
  });
  await save(st);
  return { follower, channel: result.mode, quota: st.quota };
}

// ---------- Mode session (file humanisée) ----------
export async function startSession(body = {}) {
  const st = await getState();
  if (st.session && ['running', 'paused'].includes(st.session.status)) {
    throw httpError(409, 'Une session est déjà en cours.');
  }
  if (body.settings) st.settings = normalizeSettings({ ...st.settings, ...body.settings });
  if (st.quota.used >= st.settings.maxOpsPerDay) {
    throw httpError(429, 'Quota quotidien déjà atteint.');
  }

  const followers = await readStore(FOLLOWERS, []);
  const eligible = followers.filter((f) => f.status === 'active');
  if (!eligible.length) throw httpError(400, 'Aucun follower éligible dans la file.');

  const limit = Math.min(Number(body.limit) || eligible.length, eligible.length, 500);
  const shuffled = [...eligible].sort(() => Math.random() - 0.5).slice(0, limit);

  const now = new Date();
  const firstAt = st.settings.pauseOutsideHours
    ? nextActiveMoment(now, st.settings)
    : new Date(now.getTime() + 4000);

  st.session = {
    id: crypto.randomUUID(),
    status: 'running',
    createdAt: now.toISOString(),
    startedAt: firstAt.toISOString(),
    targets: shuffled.map((f) => f.id),
    index: 0,
    nextActionAt: firstAt.toISOString(),
    sinceBreak: 0,
    removed: 0,
    skipped: 0,
    profile: st.settings.profile,
    note: body.note || '',
  };
  pushLog(st, {
    kind: 'start',
    message: `Session démarrée — ${shuffled.length} cibles, profil « ${st.settings.profile} », première action ${firstAt.toLocaleString('fr-FR')}`,
  });
  await save(st);
  armTimer(st);
  return st.session;
}

function armTimer(st) {
  if (!st.session || st.session.status !== 'running') return clearTimer();
  const at = new Date(st.session.nextActionAt).getTime();
  schedule(at - Date.now());
}

export async function pauseSession(reason = 'Pause demandée') {
  const st = await getState();
  if (!st.session || st.session.status !== 'running') throw httpError(409, 'Aucune session active.');
  st.session.status = 'paused';
  st.session.pausedAt = new Date().toISOString();
  clearTimer();
  pushLog(st, { kind: 'pause', message: reason });
  await save(st);
  return st.session;
}

export async function resumeSession() {
  const st = await getState();
  if (!st.session || st.session.status !== 'paused') throw httpError(409, 'Aucune session en pause.');
  const resumedAt = new Date();
  st.session.status = 'running';
  st.session.nextActionAt = new Date(
    Math.max(resumedAt.getTime() + st.settings.minGapSeconds * 1000, Date.now() + 5000)
  ).toISOString();
  pushLog(st, { kind: 'resume', message: 'Session reprise' });
  await save(st);
  armTimer(st);
  return st.session;
}

export async function stopSession(reason = 'Session arrêtée') {
  const st = await getState();
  if (!st.session) throw httpError(409, 'Aucune session.');
  st.session.status = 'stopped';
  st.session.stoppedAt = new Date().toISOString();
  clearTimer();
  pushLog(st, { kind: 'stop', message: reason });
  await save(st);
  return st.session;
}

// Une « pulsation » : exécute au plus UNE action, puis replanifie.
async function tick() {
  if (running) return;
  running = true;
  try {
    const st = await getState();
    const s = st.session;
    if (!s || s.status !== 'running') return;

    const now = new Date();
    if (s.nextActionAt && new Date(s.nextActionAt) > now) return armTimer(st);

    if (st.settings.pauseOutsideHours && !isWithinActiveHours(now, st.settings)) {
      s.nextActionAt = nextActiveMoment(now, st.settings).toISOString();
      pushLog(st, {
        kind: 'break',
        message: `Hors plage active — reprise ${new Date(s.nextActionAt).toLocaleString('fr-FR')}`,
        nextAt: s.nextActionAt,
      });
      await save(st);
      return armTimer(st);
    }

    if (st.quota.used >= st.settings.maxOpsPerDay) {
      s.nextActionAt = nextActiveMoment(new Date(now.getTime() + 3600_000), st.settings).toISOString();
      pushLog(st, { kind: 'limit', message: `Quota quotidien atteint (${st.settings.maxOpsPerDay}) — reprise demain` });
      await save(st);
      return armTimer(st);
    }

    if (s.index >= s.targets.length) {
      s.status = 'completed';
      s.completedAt = new Date().toISOString();
      pushLog(st, { kind: 'stop', message: `Session terminée — ${s.removed} retraits, ${s.skipped} cibles laissées de côté` });
      await save(st);
      clearTimer();
      return;
    }

    const followers = await readStore(FOLLOWERS, []);
    const followerId = s.targets[s.index];
    const follower = followers.find((f) => f.id === followerId);
    s.index += 1;

    if (!follower || follower.status !== 'active') {
      s.nextActionAt = new Date(now.getTime() + 1500).toISOString();
      await save(st);
      return armTimer(st);
    }

    // « Hésitation » : on passe son tour de temps en temps, la cible revient plus tard.
    // Garde-fou : une session ne peut pas tourner indéfiniment sur des hésitations.
    const hesitationCap = Math.max(40, s.targets.length * 2);
    if (s.skipped < hesitationCap && Math.random() * 100 < st.settings.skipChancePct) {
      s.skipped += 1;
      s.targets.push(followerId);
      s.nextActionAt = new Date(now.getTime() + computeGapMs(st.settings)).toISOString();
      pushLog(st, { kind: 'skip', follower: follower.handle, message: `@${follower.handle} laissé pour plus tard` });
      await save(st);
      return armTimer(st);
    }

    const account = await tiktok.currentAccount(await readStore('account', null));
    const result = await tiktok.performUnfollow(account, follower);

    if (result.ok) {
      follower.status = 'removed';
      follower.removedAt = new Date().toISOString();
      follower.removedMode = 'session';
      await writeStore(FOLLOWERS, followers);
      st.quota.used += 1;
      st.processed[follower.id] = { at: follower.removedAt, mode: 'session' };
      s.removed += 1;
      pushLog(st, {
        kind: 'action',
        mode: 'session',
        channel: result.mode,
        follower: follower.handle,
        displayName: follower.displayName,
        message: `Retrait de @${follower.handle}`,
      });
    } else {
      s.targets.push(followerId);
      s.index = Math.max(0, s.index - 1);
      pushLog(st, { kind: 'error', follower: follower.handle, message: result.message, code: result.code });
      s.status = 'paused';
      s.pausedAt = new Date().toISOString();
      pushLog(st, { kind: 'pause', message: 'Session mise en pause : le canal d’action ne répond pas.' });
      await save(st);
      clearTimer();
      return;
    }

    // Planification du suivant
    s.sinceBreak = (s.sinceBreak ?? 0) + 1;
    let wait = computeGapMs(st.settings);
    let willBreak = false;
    if (s.sinceBreak >= st.settings.breakEvery) {
      wait += computeBreakMs(st.settings);
      s.sinceBreak = 0;
      willBreak = true;
    }
    s.nextActionAt = new Date(Date.now() + wait).toISOString();
    if (willBreak) {
      pushLog(st, {
        kind: 'break',
        message: `Pause humaine de ${describeDuration(wait)} — reprise à ${new Date(s.nextActionAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`,
      });
    }
    await save(st);
    armTimer(st);
  } finally {
    running = false;
  }
}

// Reprise après redémarrage du serveur
export async function bootstrap() {
  const st = await getState();
  if (st.session && ['running', 'paused'].includes(st.session.status)) {
    pushLog(st, {
      kind: 'resume',
      message: `Serveur redémarré — session « ${st.session.status} » restaurée`,
    });
    await save(st);
    armTimer(st);
  }
}

export function httpError(status, message, extra = {}) {
  const err = new Error(message);
  err.status = status;
  err.extra = extra;
  return err;
}

export { DEFAULTS };
