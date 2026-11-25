// Configuration centrale de Sillage.
// Tout est surchargeable par variables d'environnement (.env ou shell).

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  port: num(process.env.PORT, 3000),
  host: process.env.HOST || '0.0.0.0',
  dataDir: process.env.DATA_DIR || new URL('../data/', import.meta.url).pathname,

  // --- TikTok ---
  tiktok: {
    clientKey: process.env.TIKTOK_CLIENT_KEY || '',
    clientSecret: process.env.TIKTOK_CLIENT_SECRET || '',
    redirectUri:
      process.env.TIKTOK_REDIRECT_URI || 'http://localhost:3000/auth/tiktok/callback',
    // Scopes demandés à l'utilisateur. Les scopes de gestion ne sont accordés
    // qu'après validation de votre app par TikTok (revue de l'application).
    scopes: (process.env.TIKTOK_SCOPES || 'user.info.basic,follower.list').split(','),
    apiBase: 'https://open.tiktokapis.com/v2',
    authBase: 'https://www.tiktok.com/v2/auth/authorize/',
    tokenUrl: 'https://open.tiktokapis.com/v2/oauth/token/',
    revokeUrl: 'https://open.tiktokapis.com/v2/oauth/revoke/',
  },

  // Mode de démonstration : liste de followers fictive, aucune action réelle.
  // Activé automatiquement si aucun identifiant TikTok n'est configuré.
  demoMode: !(process.env.TIKTOK_CLIENT_KEY && process.env.TIKTOK_CLIENT_SECRET),

  // Passerelle d'actions ("suppression d'abonnement") — voir README pour le
  // cadre légal et les conditions d'utilisation. Laisser vide pour désactiver.
  actionGateway: {
    url: process.env.ACTION_GATEWAY_URL || '',
    token: process.env.ACTION_GATEWAY_TOKEN || '',
  },

  // Garde-fous : valeurs de repli si le fichier de réglages est vide.
  defaults: {
    maxOpsPerDay: 60,
    minGapSeconds: 90,
    maxGapMinutes: 9,
    breakEvery: 8,
    breakMinMinutes: 6,
    breakMaxMinutes: 18,
    activeStartHour: 9,
    activeEndHour: 22,
    maxConcurrentSessions: 1,
  },
};
