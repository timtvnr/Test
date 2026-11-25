import path from 'node:path';
import crypto from 'node:crypto';
import express from 'express';
import { config } from './config.js';
import { readStore, writeStore } from './store.js';
import * as tiktok from './tiktok.js';
import * as engine from './engine.js';
import { DEFAULTS, normalizeSettings, simulate, describeDuration } from './humanize.js';
import { demoAccount } from './demo-data.js';

const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(import.meta.dirname, '..', 'public'), { extensions: ['html'] }));

const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

const FOLLOWERS = 'followers';

async function ensureFollowers() {
  let followers = await readStore(FOLLOWERS, []);
  if (!followers.length) {
    const account = await tiktok.currentAccount(await readStore('account', null));
    followers = await tiktok.listFollowers(account, []);
    await writeStore(FOLLOWERS, followers);
  }
  return followers;
}

// ---------- État global ----------
app.get('/api/status', wrap(async (req, res) => {
  await ensureFollowers();
  const st = await engine.stateSnapshot();
  const account = await tiktok.currentAccount(await readStore('account', null));
  res.json({
    demoMode: config.demoMode,
    configured: tiktok.isConfigured(),
    hasActionChannel: Boolean(config.actionGateway.url),
    account,
    settings: st.settings,
    session: st.session,
    quota: st.quota,
    lastManualActionAt: st.lastManualActionAt,
    limits: {
      maxOpsPerDay: 200,
      minGapSeconds: 45,
      activeHours: `${st.settings.activeStartHour}h–${st.settings.activeEndHour}h`,
    },
  });
}));

// ---------- Followers ----------
app.get('/api/followers', wrap(async (req, res) => {
  const followers = await ensureFollowers();
  const q = String(req.query.q || '').trim().toLowerCase();
  const status = String(req.query.status || 'active');
  const sort = String(req.query.sort || 'recent');
  let list = followers;
  if (status !== 'all') list = list.filter((f) => f.status === status);
  if (q) {
    list = list.filter((f) =>
      [f.handle, f.displayName, f.region].filter(Boolean).some((v) => v.toLowerCase().includes(q))
    );
  }
  const cmp = {
    recent: (a, b) => (b.followingSince || '').localeCompare(a.followingSince || ''),
    oldest: (a, b) => (a.followingSince || '').localeCompare(b.followingSince || ''),
    alpha: (a, b) => a.handle.localeCompare(b.handle),
    reach: (a, b) => (b.followerCount || 0) - (a.followerCount || 0),
  }[sort] || (() => 0);
  list = [...list].sort(cmp);
  const st = await engine.stateSnapshot();
  res.json({
    total: followers.length,
    active: followers.filter((f) => f.status === 'active').length,
    removed: followers.filter((f) => f.status === 'removed').length,
    muted: followers.filter((f) => f.status === 'muted').length,
    cooldownSeconds: st.settings.minGapSeconds,
    lastManualActionAt: st.lastManualActionAt,
    followers: list,
  });
}));

app.post('/api/followers/:id/remove', wrap(async (req, res) => {
  const result = await engine.manualRemove(req.params.id);
  res.json({ ok: true, ...result });
}));

app.post('/api/followers/:id/mute', wrap(async (req, res) => {
  const followers = await ensureFollowers();
  const f = followers.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Follower introuvable' });
  f.status = f.status === 'muted' ? 'active' : 'muted';
  await writeStore(FOLLOWERS, followers);
  res.json({ ok: true, follower: f });
}));

app.post('/api/followers/:id/restore', wrap(async (req, res) => {
  const followers = await ensureFollowers();
  const f = followers.find((x) => x.id === req.params.id);
  if (!f) return res.status(404).json({ error: 'Follower introuvable' });
  f.status = 'active';
  delete f.removedAt;
  delete f.removedMode;
  await writeStore(FOLLOWERS, followers);
  res.json({ ok: true, follower: f });
}));

// ---------- Réglages / moteur ----------
app.get('/api/settings', wrap(async (req, res) => {
  const st = await engine.stateSnapshot();
  res.json({ settings: st.settings, defaults: DEFAULTS });
}));

app.put('/api/settings', wrap(async (req, res) => {
  const settings = await engine.saveSettings(req.body || {});
  res.json({ ok: true, settings });
}));

app.post('/api/session/start', wrap(async (req, res) => {
  const session = await engine.startSession(req.body || {});
  res.json({ ok: true, session });
}));

app.post('/api/session/pause', wrap(async (req, res) => {
  res.json({ ok: true, session: await engine.pauseSession() });
}));

app.post('/api/session/resume', wrap(async (req, res) => {
  res.json({ ok: true, session: await engine.resumeSession() });
}));

app.post('/api/session/stop', wrap(async (req, res) => {
  res.json({ ok: true, session: await engine.stopSession() });
}));

app.post('/api/simulate', wrap(async (req, res) => {
  const st = await engine.stateSnapshot();
  const settings = normalizeSettings({ ...st.settings, ...(req.body?.settings || {}) });
  const count = Math.max(1, Math.min(Number(req.body?.count) || 10, 200));
  const result = simulate(count, settings, { seed: Number(req.body?.seed) || 42, profile: settings.profile });
  res.json({
    count,
    timeline: result.actions.slice(0, 60),
    skipped: result.skipped,
    days: result.days,
    firstAt: result.firstAt,
    lastAt: result.lastAt,
    durationLabel: describeDuration(result.totalMs),
  });
}));

app.get('/api/log', wrap(async (req, res) => {
  const raw = await readStore('engine', { log: [] });
  res.json({ events: (raw.log || []).slice(-80).reverse() });
}));

// Flux temps réel (SSE)
app.get('/api/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 3000\n\n`);
  const send = (payload) => res.write(`data: ${JSON.stringify(payload)}\n\n`);
  send({ type: 'hello', at: new Date().toISOString() });
  const onEvent = (p) => send(p);
  const onState = (p) => send({ type: 'session', session: p.session, quota: p.quota });
  engine.bus.on('event', onEvent);
  engine.bus.on('state', onState);
  const ping = setInterval(() => res.write(`: ping\n\n`), 20000);
  req.on('close', () => {
    clearInterval(ping);
    engine.bus.off('event', onEvent);
    engine.bus.off('state', onState);
  });
});

// ---------- OAuth TikTok ----------
app.get('/auth/tiktok', wrap(async (req, res) => {
  if (!tiktok.isConfigured()) {
    return res.redirect('/?auth=missing');
  }
  const { verifier, challenge } = tiktok.pkcePair();
  const state = crypto.randomBytes(16).toString('hex');
  const pending = await readStore('oauth', {});
  pending[state] = { verifier, at: Date.now() };
  await writeStore('oauth', pending);
  const url = tiktok.authorizeUrl(state);
  res.redirect(`${url}&code_challenge=${encodeURIComponent(challenge)}&code_challenge_method=S256`);
}));

app.get('/auth/tiktok/callback', wrap(async (req, res) => {
  const { code, state } = req.query;
  const pending = await readStore('oauth', {});
  const entry = pending[state];
  if (!code || !entry) return res.redirect('/?auth=invalid');
  delete pending[state];
  await writeStore('oauth', pending);
  const token = await tiktok.exchangeCode(String(code), entry.verifier);
  const profile = await tiktok.fetchUserInfo(token.accessToken);
  await writeStore('token', token);
  await writeStore('account', { ...profile, ...(await demoAccountShape(profile)) });
  await writeStore(FOLLOWERS, []);
  res.redirect('/?auth=ok');
}));

async function demoAccountShape(profile) {
  return { demo: false, connectedAt: new Date().toISOString() };
}

app.post('/api/disconnect', wrap(async (req, res) => {
  await writeStore('token', null);
  await writeStore('account', null);
  await writeStore(FOLLOWERS, []);
  res.json({ ok: true });
}));

// ---------- Erreurs ----------
app.use((err, req, res, next) => {
  const status = err.status || 500;
  if (status >= 500) console.error(err);
  res.status(status).json({ error: err.message || 'Erreur interne', ...(err.extra || {}) });
});

app.use((req, res) => {
  if (req.path.startsWith('/api/')) return res.status(404).json({ error: 'Not found' });
  res.sendFile(path.join(import.meta.dirname, '..', 'public', 'index.html'));
});

const server = app.listen(config.port, config.host, async () => {
  await ensureFollowers().catch((e) => console.error('seed', e));
  await engine.bootstrap().catch((e) => console.error('bootstrap', e));
  console.log(`Sillage prêt sur http://${config.host}:${config.port}  (démo: ${config.demoMode})`);
});

export { app, server };
