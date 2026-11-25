/* Sillage — interface client (vanilla, sans build) */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  status: null,
  followers: [],
  filter: 'active',
  sort: 'recent',
  query: '',
  cooldownUntil: 0,
  settings: null,
  busy: false,
};

const fmtDate = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
};

const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '—');

const fmtDateTime = (iso) => {
  if (!iso) return '—';
  const d = new Date(iso);
  const today = new Date().toDateString() === d.toDateString();
  return today ? `aujourd’hui ${fmtTime(iso)}` : `${fmtDate(iso)} · ${fmtTime(iso)}`;
};

function countdownLabel(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return r ? `${m} min ${r} s` : `${m} min`;
}

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Erreur ${res.status}`);
    err.payload = data;
    err.status = res.status;
    throw err;
  }
  return data;
}

/* ---------------- Toasts ---------------- */
function toast(title, message = '', kind = '') {
  const el = document.createElement('div');
  el.className = `toast ${kind}`;
  el.innerHTML = `<strong></strong><span></span>`;
  el.querySelector('strong').textContent = title;
  if (message) el.querySelector('span').textContent = message;
  $('#toastStack').append(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s, transform .3s';
    el.style.opacity = '0';
    el.style.transform = 'translateY(6px)';
    setTimeout(() => el.remove(), 320);
  }, kind === 'error' ? 6000 : 3800);
}

/* ---------------- Modal ---------------- */
function openModal(html) {
  const backdrop = $('#modalBackdrop');
  const modal = $('#modal');
  modal.innerHTML = html;
  backdrop.hidden = false;
  document.body.style.overflow = 'hidden';
  return { modal, close: closeModal };
}

function closeModal() {
  $('#modalBackdrop').hidden = true;
  $('#modal').innerHTML = '';
  document.body.style.overflow = '';
}

$('#modalBackdrop').addEventListener('click', (e) => {
  if (e.target.id === 'modalBackdrop') closeModal();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !$('#modalBackdrop').hidden) closeModal();
});

/* ---------------- Rendu : statut / session ---------------- */
function renderStatus() {
  const st = state.status;
  if (!st) return;

  const badge = $('#modeBadge');
  if (st.demoMode) {
    badge.className = 'badge badge-warn';
    badge.textContent = 'Mode démo';
  } else if (st.account) {
    badge.className = 'badge badge-live';
    badge.textContent = 'Compte lié';
  } else {
    badge.className = 'badge badge-muted';
    badge.textContent = 'Non connecté';
  }

  const acc = st.account;
  $('#accountName').textContent = acc?.displayName || 'Aucun compte';
  $('#accountSub').textContent = acc
    ? st.demoMode
      ? 'démo · aucune action réelle'
      : `@${acc.username || acc.openId?.slice(0, 8) || 'tiktok'}`
    : 'cliquer pour connecter';
  const av = $('#accountAvatar');
  if (acc?.avatarUrl) {
    av.innerHTML = `<img alt="" src="${acc.avatarUrl}" />`;
  } else {
    av.textContent = (acc?.displayName || 'S').slice(0, 1).toUpperCase();
  }

  const s = st.session;
  const dot = $('#pulseDot');
  const label = $('#sessionLabel');
  const sub = $('#sessionSub');
  const controls = $('#sessionControls');

  dot.className = 'pulse';
  if (!s || s.status === 'stopped' || s.status === 'completed') {
    label.textContent = s?.status === 'completed' ? 'Session terminée' : 'Aucune session';
    sub.textContent = s?.status === 'completed'
      ? `${s.removed} retraits effectués, ${s.skipped} cibles reportées.`
      : 'Le compte est au repos — aucune action programmée.';
  } else if (s.status === 'running') {
    dot.classList.add('on');
    label.textContent = 'Session en cours';
    sub.textContent = `Prochaine action ${fmtDateTime(s.nextActionAt)} · profil « ${s.profile} »`;
  } else if (s.status === 'paused') {
    dot.classList.add('paused');
    label.textContent = 'Session en pause';
    sub.textContent = 'Le rythme est suspendu. Vous pouvez reprendre ou arrêter.';
  }

  const done = (s?.index ?? 0) - (s?.skipped ?? 0);
  const total = s?.targets?.length ?? 0;
  $('#statToday').textContent = st.quota?.used ?? 0;
  $('#statCap').textContent = `/ ${st.settings.maxOpsPerDay}`;
  $('#statNext').textContent =
    s && s.status === 'running' ? fmtTime(s.nextActionAt) : s && s.status === 'paused' ? 'en pause' : '—';
  $('#statProgress').textContent = total ? `${Math.max(0, done)}/${total}` : '—';
  $('#progressBar').style.width = total ? `${Math.min(100, (Math.max(0, done) / total) * 100)}%` : '0%';

  controls.innerHTML = '';
  if (!s || s.status === 'stopped' || s.status === 'completed') {
    controls.append(btn('Préparer une session', 'btn btn-primary btn-sm', openStartModal));
  } else if (s.status === 'running') {
    controls.append(btn('Pause', 'btn btn-ghost btn-sm', doPause), btn('Arrêter', 'btn btn-danger btn-sm', confirmStop));
  } else if (s.status === 'paused') {
    controls.append(btn('Reprendre', 'btn btn-primary btn-sm', doResume), btn('Arrêter', 'btn btn-danger btn-sm', confirmStop));
  }

  $('#footMode').textContent = st.demoMode
    ? 'Mode démonstration — followers fictifs, aucun appel réel à TikTok.'
    : st.hasActionChannel
      ? 'Canal d’action configuré.'
      : 'Aucun canal d’action configuré — lecture seule.';

  $('#engineNotice').innerHTML = st.demoMode
    ? '🧪 <strong>Mode démo.</strong> Les retraits sont simulés côté serveur : rien n’est envoyé à TikTok. Ajoutez vos identifiants d’API dans <code>.env</code> pour un compte réel.'
    : st.hasActionChannel
      ? '🔌 Canal d’action connecté. Chaque retrait passe par votre passerelle, une action à la fois.'
      : '⚠️ L’API TikTok publique n’expose aucun endpoint pour retirer un follower à votre place. Sillage prépare le geste et le rythme ; branchez un canal autorisé (<code>ACTION_GATEWAY_URL</code>) pour agir.';
}

function btn(label, className, onClick, disabled = false) {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = label;
  b.disabled = disabled;
  b.addEventListener('click', onClick);
  return b;
}

/* ---------------- Rendu : followers ---------------- */
function renderFollowers(meta) {
  const list = $('#followerList');
  const activeStatus = state.filter;
  const canAct = activeStatus === 'active' || activeStatus === 'all';

  if (meta) {
    $('#followersMeta').textContent =
      `${meta.total} followers au total · ${meta.active} à traiter · ${meta.removed} retirés · ${meta.muted} en pause`;
  }

  if (!state.followers.length) {
    list.innerHTML = '';
    $('#emptyState').hidden = false;
    return;
  }
  $('#emptyState').hidden = true;

  list.innerHTML = state.followers
    .map((f) => {
      const [c1, c2, initials] = f.avatar || ['#6d5efc', '#a78bfa', f.handle.slice(0, 2).toUpperCase()];
      const cooling = state.cooldownUntil > Date.now() || state.busy;
      const isRemoved = f.status === 'removed';
      const isMuted = f.status === 'muted';
      return `
      <li class="follower ${isMuted ? 'is-muted' : ''}" data-id="${f.id}">
        <span class="avatar" style="background:linear-gradient(145deg, ${c1}, ${c2})">${initials}</span>
        <div class="f-identity">
          <div class="f-name">
            <strong>${esc(f.displayName || f.handle)}</strong>
            <span class="handle">@${esc(f.handle)}</span>
            ${f.mutual ? '<span class="tag tag-mutual">abonnement mutuel</span>' : ''}
            ${isMuted ? '<span class="tag">en pause</span>' : ''}
            ${isRemoved ? '<span class="tag tag-removed">retiré</span>' : ''}
          </div>
          <div class="f-meta">
            <span>${esc(f.region || '—')}</span>
            <span>vous suit depuis ${fmtDate(f.followingSince)}</span>
            <span>${formatCount(f.followerCount)} followers</span>
            ${f.removedAt ? `<span>retiré le ${fmtDate(f.removedAt)} · ${f.removedMode === 'manual' ? 'manuel' : 'session'}</span>` : ''}
          </div>
        </div>
        <div class="f-actions">
          ${isRemoved
            ? `<button class="icon-btn" data-act="restore" title="Remettre dans la liste">${icon('undo')}</button>`
            : `<button class="icon-btn" data-act="mute" title="${isMuted ? 'Remettre dans la file' : 'Mettre de côté'}">${isMuted ? icon('play') : icon('pause')}</button>`}
          ${isRemoved || !canAct
            ? ''
            : `<button class="icon-btn danger" data-act="remove" title="Retirer ce follower" ${cooling ? 'disabled' : ''}>${icon('userMinus')}</button>`}
        </div>
      </li>`;
    })
    .join('');

  $$('.follower', list).forEach((row) => {
    const id = row.dataset.id;
    const follower = state.followers.find((f) => f.id === id);
    $$('[data-act]', row).forEach((b) => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'remove') confirmRemove(follower, row);
        if (act === 'mute') toggleMute(follower);
        if (act === 'restore') restoreFollower(follower);
      });
    });
  });
}

function esc(v) {
  return String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function formatCount(n) {
  if (!n && n !== 0) return '—';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace('.0', '')} M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace('.0', '')} k`;
  return String(n);
}

const icons = {
  userMinus: '<svg viewBox="0 0 24 24" fill="none"><path d="M15 19v-1a4 4 0 0 0-4-4H7a4 4 0 0 0-4 4v1" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><circle cx="9" cy="7" r="3.2" stroke="currentColor" stroke-width="1.7"/><path d="M17 11h5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  pause: '<svg viewBox="0 0 24 24" fill="none"><rect x="8" y="6" width="2.6" height="12" rx="1" fill="currentColor"/><rect x="13.4" y="6" width="2.6" height="12" rx="1" fill="currentColor"/></svg>',
  play: '<svg viewBox="0 0 24 24" fill="none"><path d="M8 6.5v11l9-5.5-9-5.5Z" fill="currentColor"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none"><path d="M9 7H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/><path d="M10 4h6a2 2 0 0 1 2 2v6m0 0-3-3m3 3 3-3" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>',
};
const icon = (name) => icons[name] || '';

/* ---------------- Données ---------------- */
async function loadFollowers() {
  const params = new URLSearchParams({ status: state.filter, sort: state.sort });
  if (state.query) params.set('q', state.query);
  const data = await api(`/api/followers?${params}`);
  state.followers = data.followers;
  state.lastManualActionAt = data.lastManualActionAt;
  state.minGap = data.cooldownSeconds;
  renderFollowers(data);
}

async function loadStatus() {
  const data = await api('/api/status');
  state.status = data;
  state.settings = data.settings;
  renderStatus();
  syncSettingsForm(data.settings);
  applyCooldownFromServer(data.lastManualActionAt, data.settings.minGapSeconds);
}

function applyCooldownFromServer(lastAt, minGapSeconds) {
  if (!lastAt) {
    state.cooldownUntil = 0;
    return tickCooldown();
  }
  const until = new Date(lastAt).getTime() + minGapSeconds * 1000;
  state.cooldownUntil = Math.max(0, until);
  tickCooldown();
}

/* ---------------- Cooldown ---------------- */
let lastCooldownSecond = -1;
function tickCooldown() {
  const bar = $('#cooldownBar');
  const remaining = state.cooldownUntil - Date.now();
  const outside =
    state.settings &&
    state.settings.pauseOutsideHours &&
    !isWithinHours(new Date(), state.settings);

  if (outside) {
    bar.hidden = false;
    $('#cooldownTitle').textContent = 'Hors plage active';
    $('#cooldownText').textContent = `Le rythme reprend entre ${state.settings.activeStartHour}h et ${state.settings.activeEndHour}h. Les actions manuelles sont suspendues.`;
  } else if (remaining > 0) {
    bar.hidden = false;
    $('#cooldownTitle').textContent = 'Rythme respecté';
    $('#cooldownText').textContent = `Prochain retrait possible dans ${countdownLabel(remaining)} (intervalle minimum ${state.settings?.minGapSeconds ?? 90} s).`;
  } else {
    bar.hidden = true;
  }

  const seconds = Math.floor(remaining / 1000);
  const cooling = remaining > 0 || outside || state.busy;
  if (seconds !== lastCooldownSecond || cooling !== state.lastCooling) {
    state.lastCooling = cooling;
    lastCooldownSecond = seconds;
    $$('[data-act="remove"]').forEach((b) => (b.disabled = cooling));
  }
}

function isWithinHours(date, settings) {
  const h = date.getHours() + date.getMinutes() / 60;
  return h >= settings.activeStartHour && h < settings.activeEndHour;
}

setInterval(tickCooldown, 1000);

/* ---------------- Actions ---------------- */
function confirmRemove(follower, row) {
  const { modal, close } = openModal(`
    <h3>Retirer @${esc(follower.handle)} ?</h3>
    <p>Cette action s’ajoute à votre rythme du jour. Un humain le ferait sans y penser — mais pas douze fois en dix secondes.</p>
    <div class="profile-facts">
      <div><span>Depuis</span><strong>${fmtDate(follower.followingSince)}</strong></div>
      <div><span>Portée</span><strong>${formatCount(follower.followerCount)} followers</strong></div>
      <div><span>Retraits aujourd’hui</span><strong>${state.status?.quota?.used ?? 0} / ${state.settings.maxOpsPerDay}</strong></div>
      <div><span>Prochain geste autorisé</span><strong>${state.cooldownUntil > Date.now() ? `dans ${countdownLabel(state.cooldownUntil - Date.now())}` : 'maintenant'}</strong></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-danger" data-confirm>Retirer ce follower</button>
    </div>
  `);
  $('[data-close]', modal).addEventListener('click', close);
  $('[data-confirm]', modal).addEventListener('click', async () => {
    const b = $('[data-confirm]', modal);
    b.disabled = true;
    b.textContent = 'Retrait…';
    try {
      await api(`/api/followers/${encodeURIComponent(follower.id)}/remove`, { method: 'POST' });
      close();
      row?.classList.add('is-leaving');
      setTimeout(async () => {
        await Promise.all([loadFollowers(), loadStatus()]);
        if (row) row.classList.remove('is-leaving');
      }, 280);
      toast(`@${follower.handle} retiré`, 'Le compteur du jour a été incrémenté.', '');
    } catch (err) {
      close();
      toast('Action impossible', err.message, 'warn');
      loadStatus();
    }
  });
}

async function toggleMute(follower) {
  try {
    state.busy = true;
    await api(`/api/followers/${encodeURIComponent(follower.id)}/mute`, { method: 'POST' });
    await loadFollowers();
  } catch (err) {
    toast('Erreur', err.message, 'error');
  } finally {
    state.busy = false;
  }
}

async function restoreFollower(follower) {
  try {
    state.busy = true;
    await api(`/api/followers/${encodeURIComponent(follower.id)}/restore`, { method: 'POST' });
    await loadFollowers();
    toast(`@${follower.handle} remis dans la liste`, '', '');
  } catch (err) {
    toast('Erreur', err.message, 'error');
  } finally {
    state.busy = false;
  }
}

/* ---------------- Session ---------------- */
function openStartModal() {
  const s = state.settings;
  const { modal, close } = openModal(`
    <h3>Préparer une session</h3>
    <p>Sillage choisira les cibles dans un ordre aléatoire, puis espacera chaque retrait selon votre profil « ${esc(s.profile)} ».</p>
    <div class="field">
      <div class="field-label"><label for="sessionLimit">Nombre de cibles</label><output id="sessionLimitOut">20</output></div>
      <input id="sessionLimit" type="range" min="1" max="120" step="1" value="20" />
    </div>
    <div class="profile-facts">
      <div><span>Intervalle minimum</span><strong>${s.minGapSeconds} s</strong></div>
      <div><span>Latence maximale</span><strong>${s.maxGapMinutes} min</strong></div>
      <div><span>Pause toutes les</span><strong>${s.breakEvery} actions</strong></div>
      <div><span>Plafond du jour</span><strong>${state.status.quota.used} / ${s.maxOpsPerDay} utilisés</strong></div>
    </div>
    <p class="help" style="font-size:12px">La session démarre à la prochaine heure d’activité si vous êtes hors plage. Vous pouvez la mettre en pause à tout moment.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Annuler</button>
      <button class="btn btn-primary" data-confirm>Lancer la session</button>
    </div>
  `);
  const range = $('#sessionLimit', modal);
  const out = $('#sessionLimitOut', modal);
  range.addEventListener('input', () => (out.textContent = range.value));
  $('[data-close]', modal).addEventListener('click', close);
  $('[data-confirm]', modal).addEventListener('click', async () => {
    const b = $('[data-confirm]', modal);
    b.disabled = true;
    b.textContent = 'Préparation…';
    try {
      await api('/api/session/start', { method: 'POST', body: { limit: Number(range.value) } });
      close();
      await loadStatus();
      toast('Session lancée', 'Le premier geste suivra votre rythme d’activité.', '');
    } catch (err) {
      close();
      toast('Impossible de démarrer', err.message, 'error');
    }
  });
}

async function doPause() {
  try {
    await api('/api/session/pause', { method: 'POST' });
    await loadStatus();
    toast('Session en pause', 'Aucune action ne sera déclenchée avant reprise.', '');
  } catch (err) {
    toast('Erreur', err.message, 'error');
  }
}

async function doResume() {
  try {
    await api('/api/session/resume', { method: 'POST' });
    await loadStatus();
    toast('Session reprise', 'Le rythme reprend là où il s’était arrêté.', '');
  } catch (err) {
    toast('Erreur', err.message, 'error');
  }
}

function confirmStop() {
  const { modal, close } = openModal(`
    <h3>Arrêter la session ?</h3>
    <p>Les retraits déjà effectués restent acquis. Les cibles restantes retournent dans la file.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Continuer</button>
      <button class="btn btn-danger" data-confirm>Arrêter</button>
    </div>
  `);
  $('[data-close]', modal).addEventListener('click', close);
  $('[data-confirm]', modal).addEventListener('click', async () => {
    try {
      await api('/api/session/stop', { method: 'POST' });
      close();
      await loadStatus();
      toast('Session arrêtée', '', 'warn');
    } catch (err) {
      toast('Erreur', err.message, 'error');
    }
  });
}

/* ---------------- Réglages ---------------- */
const FIELD_OUTPUTS = {
  maxOps: (v) => `${v}`,
  minGap: (v) => (Number(v) < 60 ? `${v} s` : `${(v / 60).toFixed(1).replace('.0', '')} min`),
  maxGap: (v) => `${v} min`,
  breakEvery: (v) => `${v}`,
  skipChance: (v) => `${v} %`,
  startHour: (v) => `${v} h`,
  endHour: (v) => `${v} h`,
};

function syncSettingsForm(s) {
  if (!s) return;
  const map = {
    maxOps: s.maxOpsPerDay,
    minGap: s.minGapSeconds,
    maxGap: s.maxGapMinutes,
    breakEvery: s.breakEvery,
    skipChance: s.skipChancePct,
    startHour: s.activeStartHour,
    endHour: s.activeEndHour,
  };
  for (const [id, value] of Object.entries(map)) {
    const el = document.getElementById(id);
    if (el && document.activeElement !== el) el.value = value;
  }
  $('#pauseOutside').checked = s.pauseOutsideHours;
  $$('#profilePicker button').forEach((b) => b.classList.toggle('is-active', b.dataset.profile === s.profile));
  updateOutputs();
}

function updateOutputs() {
  for (const [id, fmt] of Object.entries(FIELD_OUTPUTS)) {
    const el = document.getElementById(id);
    const out = document.getElementById(`${id}Out`);
    if (el && out) out.textContent = fmt(el.value);
  }
}

function readForm() {
  return {
    profile: $('#profilePicker .is-active')?.dataset.profile || 'naturel',
    maxOpsPerDay: Number($('#maxOps').value),
    minGapSeconds: Number($('#minGap').value),
    maxGapMinutes: Number($('#maxGap').value),
    breakEvery: Number($('#breakEvery').value),
    skipChancePct: Number($('#skipChance').value),
    activeStartHour: Number($('#startHour').value),
    activeEndHour: Number($('#endHour').value),
    pauseOutsideHours: $('#pauseOutside').checked,
  };
}

$('#settingsForm').addEventListener('input', () => {
  updateOutputs();
  refreshPreview();
});

$$('#profilePicker button').forEach((b) => {
  b.addEventListener('click', () => {
    $$('#profilePicker button').forEach((x) => x.classList.remove('is-active'));
    b.classList.add('is-active');
    applyProfilePreset(b.dataset.profile);
    refreshPreview();
  });
});

function applyProfilePreset(profile) {
  const presets = {
    calme: { minGapSeconds: 150, maxGapMinutes: 14, breakEvery: 6, skipChancePct: 16 },
    naturel: { minGapSeconds: 90, maxGapMinutes: 9, breakEvery: 8, skipChancePct: 12 },
    actif: { minGapSeconds: 60, maxGapMinutes: 6, breakEvery: 10, skipChancePct: 6 },
  };
  const p = presets[profile];
  if (!p) return;
  $('#minGap').value = p.minGapSeconds;
  $('#maxGap').value = p.maxGapMinutes;
  $('#breakEvery').value = p.breakEvery;
  $('#skipChance').value = p.skipChancePct;
  updateOutputs();
}

$('#settingsForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  updateOutputs();
  const body = readForm();
  if (body.activeEndHour <= body.activeStartHour) {
    toast('Plage horaire incohérente', 'La fin d’activité doit être après le début.', 'error');
    return;
  }
  if (body.maxGapMinutes * 60 <= body.minGapSeconds) {
    toast('Rythme incohérent', 'La latence maximale doit dépasser l’intervalle minimum.', 'error');
    return;
  }
  const saveState = $('#saveState');
  try {
    const { settings } = await api('/api/settings', { method: 'PUT', body });
    state.settings = settings;
    if (state.status) state.status.settings = settings;
    syncSettingsForm(settings);
    renderStatus();
    refreshPreview();
    saveState.textContent = `Enregistré · ${new Date().toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;
    saveState.classList.add('show');
    setTimeout(() => saveState.classList.remove('show'), 2600);
    toast('Rythme enregistré', `Plafond ${settings.maxOpsPerDay}/jour · intervalle ${settings.minGapSeconds} s min.`, '');
  } catch (err) {
    toast('Réglages refusés', err.message, 'error');
  }
});

/* ---------------- Simulation ---------------- */
let previewTimer = null;
function refreshPreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(runPreview, 220);
}

async function runPreview() {
  try {
    const data = await api('/api/simulate', { method: 'POST', body: { count: 12, settings: readForm(), seed: 7 } });
    const times = data.timeline.map((t) => new Date(t.at));
    const maxGap = Math.max(1, ...times.slice(1).map((t, i) => t - times[i]));
    const html = data.timeline
      .map((t, i) => {
        const d = new Date(t.at);
        const gap = i === 0 ? 0 : d - times[i - 1];
        const w = gap ? Math.max(6, Math.round((gap / maxGap) * 100)) : 0;
        return `<li>
          <span class="t-time">${i === 0 ? 'départ' : `+${countdownLabel(gap)}`}</span>
          <span class="t-bar"><i style="width:${w}%"></i></span>
          <span class="t-gap">${d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' })} ${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        </li>`;
      })
      .join('');
    $('#previewTimeline').innerHTML = html || '<li><span class="t-time">—</span><span>aucune action</span><span></span></li>';
    $('#previewDuration').textContent = data.durationLabel;
    const gaps = times.slice(1).map((t, i) => t - times[i]);
    const avg = gaps.length ? gaps.reduce((a, b) => a + b, 0) / gaps.length : 0;
    $('#previewAvg').textContent = avg ? countdownLabel(avg) : '—';
    $('#previewSkips').textContent = `${data.skipped}`;
  } catch (err) {
    $('#previewTimeline').innerHTML = `<li><span class="t-time">—</span><span class="muted">${esc(err.message)}</span><span></span></li>`;
  }
}

/* ---------------- Journal ---------------- */
function logClass(kind) {
  return ({ action: 'l-action', error: 'l-error', break: 'l-break', pause: 'l-pause', start: 'l-start', resume: 'l-resume', limit: 'l-break', skip: 'l-break', stop: 'l-error', settings: 'l-start' })[kind] || '';
}

function renderLog(events) {
  const list = $('#logList');
  if (!events?.length) {
    list.innerHTML = '<li><span class="l-time">—</span><span class="l-dot"></span><span class="l-msg muted">Le journal est vide pour l’instant.</span></li>';
    $('#activityCount').textContent = '';
    return;
  }
  $('#activityCount').textContent = `${events.length} événement${events.length > 1 ? 's' : ''}`;
  list.innerHTML = events
    .map((e) => {
      const d = new Date(e.ts);
      const meta = [
        e.mode === 'manual' ? 'manuel' : e.mode === 'session' ? 'session' : null,
        e.channel ? `canal ${e.channel}` : null,
      ].filter(Boolean).join(' · ');
      return `<li class="${logClass(e.kind)}">
        <span class="l-time">${d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
        <span class="l-dot"></span>
        <span class="l-msg">${esc(e.message)}${meta ? `<span class="l-meta">${esc(meta)}</span>` : ''}</span>
      </li>`;
    })
    .join('');
}

async function loadLog() {
  try {
    const { events } = await api('/api/log');
    renderLog(events);
  } catch { /* silencieux */ }
}

/* ---------------- Compte ---------------- */
$('#accountBtn').addEventListener('click', () => {
  const st = state.status;
  if (!st) return;
  const { modal, close } = openModal(`
    <h3>${st.account ? esc(st.account.displayName || 'Compte lié') : 'Connecter TikTok'}</h3>
    <p>${st.demoMode
      ? 'Vous êtes en mode démonstration : la liste de followers est fictive et rien n’est envoyé à TikTok.'
      : st.account ? 'Votre compte est lié via l’OAuth officiel de TikTok.' : 'Aucun compte lié pour l’instant.'}</p>
    <div class="profile-facts">
      <div><span>Mode</span><strong>${st.demoMode ? 'démonstration' : 'réel'}</strong></div>
      <div><span>Canal d’action</span><strong>${st.hasActionChannel ? 'configuré' : 'aucun'}</strong></div>
      <div><span>Plafond quotidien</span><strong>${st.settings.maxOpsPerDay}</strong></div>
      <div><span>Utilisés aujourd’hui</span><strong>${st.quota.used}</strong></div>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" data-close>Fermer</button>
      ${st.configured ? `<a class="btn btn-primary" href="/auth/tiktok">${st.account && !st.demoMode ? 'Re-lier' : 'Lier mon compte'}</a>` : ''}
      ${st.account && !st.demoMode ? '<button class="btn btn-danger" data-disconnect>Déconnecter</button>' : ''}
    </div>
  `);
  $('[data-close]', modal).addEventListener('click', close);
  $('[data-disconnect]', modal)?.addEventListener('click', async () => {
    try {
      await api('/api/disconnect', { method: 'POST' });
      close();
      await init(true);
      toast('Compte déconnecté', 'Les données locales ont été effacées.', 'warn');
    } catch (err) {
      toast('Erreur', err.message, 'error');
    }
  });
});

/* ---------------- Live (SSE) ---------------- */
function connectStream() {
  const es = new EventSource('/api/stream');
  es.onmessage = async (msg) => {
    let payload;
    try { payload = JSON.parse(msg.data); } catch { return; }
    if (payload.type === 'log') {
      const entry = payload.entry;
      if (entry.kind === 'action') {
        toast(`Retrait · @${entry.follower}`, entry.mode === 'manual' ? 'Action manuelle enregistrée.' : 'Effectué par la session.', '');
        applyCooldownFromServer(entry.ts, state.settings?.minGapSeconds ?? 90);
        loadFollowers();
      } else if (entry.kind === 'error') {
        toast('Action bloquée', entry.message, 'error');
      } else if (entry.kind === 'break' || entry.kind === 'limit') {
        toast('Pause', entry.message, 'warn');
      }
      loadLog();
    }
    if (payload.type === 'session') {
      if (state.status) {
        state.status.session = payload.session;
        state.status.quota = payload.quota;
        renderStatus();
      }
    }
  };
  es.onerror = () => { /* EventSource retente seul */ };
}

/* ---------------- Filtres & recherche ---------------- */
$('#statusFilter').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-status]');
  if (!b) return;
  $$('#statusFilter button').forEach((x) => x.classList.remove('is-active'));
  b.classList.add('is-active');
  state.filter = b.dataset.status;
  loadFollowers().catch((err) => toast('Erreur', err.message, 'error'));
});

let searchTimer;
$('#searchInput').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => {
    state.query = e.target.value.trim();
    loadFollowers().catch(() => {});
  }, 220);
});

$('#sortSelect').addEventListener('change', (e) => {
  state.sort = e.target.value;
  loadFollowers().catch(() => {});
});

$('#startBtn').addEventListener('click', openStartModal);

/* ---------------- Boot ---------------- */
async function init(afterAuth = false) {
  try {
    await loadStatus();
    await loadFollowers();
    await loadLog();
    await runPreview();
    const params = new URLSearchParams(location.search);
    if (params.get('auth') === 'ok') {
      toast('Compte TikTok lié', 'La liste de followers sera chargée côté serveur.', '');
      history.replaceState({}, '', '/');
    } else if (params.get('auth') === 'missing') {
      toast('Identifiants absents', 'Renseignez TIKTOK_CLIENT_KEY et TIKTOK_CLIENT_SECRET dans .env, puis redémarrez.', 'error');
      history.replaceState({}, '', '/');
    } else if (params.get('auth') === 'invalid') {
      toast('Autorisation invalide', 'La réponse OAuth n’a pas pu être vérifiée. Réessayez.', 'error');
      history.replaceState({}, '', '/');
    }
  } catch (err) {
    toast('Connexion au serveur impossible', err.message, 'error');
  }
}

connectStream();
init();

// Rafraîchissement doux du statut
setInterval(() => {
  if (document.hidden) return;
  loadStatus().catch(() => {});
}, 30000);
