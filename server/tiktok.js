// Couche TikTok. Deux familles d'appels :
//  1. API officielle (OAuth v2) — lecture de profil, et tout ce que TikTok
//     autorise réellement via scopes (aucun scope officiel ne permet de retirer
//     un follower à la place de l'utilisateur : le retrait se fait côté titulaire
//     du compte, dans l'app TikTok).
//  2. Passerelle d'actions optionnelle (ACTION_GATEWAY_URL) — point d'extension
//     à brancher seulement sur un canal autorisé (ex. automatisation sur un
//     appareil dont vous êtes propriétaire, respectant les CGU et la loi).
import crypto from 'node:crypto';
import { config } from './config.js';
import { buildDemoFollowers, demoAccount } from './demo-data.js';

const { tiktok } = config;

export function isConfigured() {
  return Boolean(tiktok.clientKey && tiktok.clientSecret);
}

export function authorizeUrl(state) {
  if (!isConfigured()) return null;
  const params = new URLSearchParams({
    client_key: tiktok.clientKey,
    scope: tiktok.scopes.join(','),
    response_type: 'code',
    redirect_uri: tiktok.redirectUri,
    state,
  });
  return `${tiktok.authBase}?${params.toString()}`;
}

export function pkcePair() {
  const verifier = crypto.randomBytes(48).toString('base64url').slice(0, 64);
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

async function tokenRequest(body) {
  const res = await fetch(tiktok.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_key: tiktok.clientKey, client_secret: tiktok.clientSecret, ...body }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error) {
    throw new Error(`TikTok token: ${json.error_description || json.error || res.status}`);
  }
  return normalizeToken(json);
}

function normalizeToken(json) {
  return {
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + (json.expires_in ?? 86400) * 1000,
    refreshExpiresAt: Date.now() + (json.refresh_expires_in ?? 31536000) * 1000,
    scope: json.scope ?? '',
    openId: json.open_id,
  };
}

export async function exchangeCode(code, codeVerifier) {
  return tokenRequest({ grant_type: 'authorization_code', code, redirect_uri: tiktok.redirectUri, code_verifier: codeVerifier });
}

export async function refreshToken(refresh) {
  return tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh });
}

export async function fetchUserInfo(token) {
  const res = await fetch(`${tiktok.apiBase}/user/info/?fields=open_id,union_id,avatar_url,display_name`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.error?.code) {
    throw new Error(`TikTok user/info: ${json.error?.message || res.status}`);
  }
  const u = json.data?.user ?? {};
  return {
    openId: u.open_id,
    displayName: u.display_name,
    avatarUrl: u.avatar_url,
    username: '',
    demo: false,
    connectedAt: new Date().toISOString(),
  };
}

// Liste des followers. L'API officielle n'expose pas la liste complète des
// followers ; on utilise donc, en mode démo, un jeu local, et sinon la
// passerelle si elle est configurée.
export async function listFollowers(account, existing) {
  if (config.demoMode || !account || account.demo) {
    if (existing?.length) return existing;
    return buildDemoFollowers();
  }
  if (config.actionGateway.url) {
    const res = await fetch(`${config.actionGateway.url.replace(/\/$/, '')}/followers`, {
      headers: { Authorization: `Bearer ${config.actionGateway.token}` },
    });
    if (!res.ok) throw new Error(`Passerelle followers: ${res.status}`);
    const json = await res.json();
    return json.followers ?? [];
  }
  return existing ?? [];
}

export async function currentAccount(stored) {
  if (config.demoMode || !stored) return stored ?? demoAccount();
  return stored;
}

// Exécute une action « retirer ce follower ».
// dryRun=true : on ne fait qu'estimer (utilisé pour la simulation complète).
export async function performUnfollow(account, follower) {
  if (config.demoMode || account?.demo) {
    await new Promise((r) => setTimeout(r, 120 + Math.random() * 260));
    return { ok: true, mode: 'demo', at: new Date().toISOString() };
  }
  if (!config.actionGateway.url) {
    return {
      ok: false,
      mode: 'unavailable',
      code: 'NO_ACTION_CHANNEL',
      message:
        "Aucun canal d'action configuré. L'API TikTok publique ne permet pas de retirer un follower : renseignez ACTION_GATEWAY_URL ou effectuez le retrait dans l'application TikTok.",
    };
  }
  const res = await fetch(`${config.actionGateway.url.replace(/\/$/, '')}/followers/${encodeURIComponent(follower.id)}/remove`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.actionGateway.token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ openId: account?.openId, handle: follower.handle }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    return { ok: false, mode: 'gateway', code: json.code || String(res.status), message: json.message || 'Échec de la passerelle' };
  }
  return { ok: true, mode: 'gateway', at: new Date().toISOString() };
}
