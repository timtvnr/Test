// Jeu de données de démonstration : aucun accès réel au compte TikTok.
// Les prénoms/avatars sont fictifs.

const avatars = [
  ['#6d5efc', '#a78bfa', 'LM'],
  ['#f97362', '#fb923c', 'KD'],
  ['#0ea5e9', '#22d3ee', 'SB'],
  ['#16a34a', '#4ade80', 'TR'],
  ['#e11d48', '#fb7185', 'AB'],
  ['#7c3aed', '#c084fc', 'NO'],
  ['#0891b2', '#67e8f9', 'JP'],
  ['#ca8a04', '#facc15', 'EL'],
  ['#475569', '#94a3b8', 'MS'],
  ['#be123c', '#fda4af', 'CV'],
  ['#4f46e5', '#818cf8', 'YG'],
  ['#0284c7', '#38bdf8', 'HP'],
];

const people = [
  ['lucie.mrt', 'Lucie Moreau', 'France', '2023-04-11', true],
  ['theo_dv', 'Théo Dubois', 'France', '2024-01-19', false],
  ['ines.blnc', 'Inès Blanchard', 'Belgique', '2022-11-02', true],
  ['marc.antoine.k', 'Marc-Antoine Kelly', 'Canada', '2024-06-27', false],
  ['sofia.rdrg', 'Sofia Rodrigues', 'Portugal', '2023-08-14', true],
  ['yanis_bk', 'Yanis Boukhelifa', 'France', '2024-03-05', false],
  ['cami.leval', 'Camille Leval', 'France', '2021-12-30', true],
  ['noor.hasn', 'Noor Hasni', 'Maroc', '2024-09-08', false],
  ['jules.prr', 'Jules Perrier', 'Suisse', '2023-02-17', true],
  ['emma.lgr', 'Emma Legrand', 'France', '2024-07-21', false],
  ['nathan.oy', 'Nathan Oyono', 'Cameroun', '2022-05-09', false],
  ['chloe.vnd', 'Chloé Vandermeer', 'Pays-Bas', '2023-10-12', true],
  ['adam.brt', 'Adam Berthier', 'France', '2024-04-02', false],
  ['lea.font', 'Léa Fontaine', 'France', '2022-09-25', true],
  ['hugo.lln', 'Hugo Lelann', 'France', '2023-06-30', false],
  ['maya.sngh', 'Maya Singh', 'Inde', '2024-02-11', false],
  ['tom.escr', 'Tom Escriva', 'Espagne', '2023-01-23', false],
  ['alix.mrn', 'Alix Marin', 'France', '2021-10-07', true],
  ['ryan.bkk', 'Ryan Bekkali', 'France', '2024-08-16', false],
  ['zoe.dlcr', 'Zoé Delacroix', 'France', '2022-07-04', true],
  ['malik.trr', 'Malik Traoré', 'Sénégal', '2023-12-19', false],
  ['eva.krs', 'Eva Kristensen', 'Danemark', '2024-05-22', true],
  ['paul.ghm', 'Paul Guihème', 'France', '2023-03-14', false],
  ['nina.str', 'Nina Stora', 'France', '2022-02-28', true],
  ['oscar.vlt', 'Oscar Vialatte', 'France', '2024-01-06', false],
  ['lina.mss', 'Lina Messaoudi', 'Algérie', '2023-09-03', false],
  ['ben.htl', 'Ben Hatuel', 'Israël', '2024-10-11', false],
  ['clara.dbs', 'Clara Dubosc', 'France', '2022-12-05', true],
  ['seb.mrl', 'Sébastien Merle', 'France', '2021-08-21', false],
  ['aya.kkr', 'Aya Kikori', 'Japon', '2023-05-17', false],
  ['gabriel.snz', 'Gabriel Sanchez', 'Argentine', '2024-11-02', false],
  ['iris.lmb', 'Iris Lambert', 'France', '2022-03-09', true],
];

export function buildDemoFollowers() {
  return people.map(([handle, displayName, region, followingSince, mutual], i) => ({
    id: `demo_${String(i + 1).padStart(3, '0')}`,
    handle,
    displayName,
    region,
    followingSince,
    mutual,
    followerCount: 30 + ((i * 137) % 4800),
    avatar: avatars[i % avatars.length],
    status: 'active',
    lastInteraction: null,
    notes: '',
  }));
}

export function demoAccount() {
  return {
    openId: 'demo-account',
    username: 'studio.sillage',
    displayName: 'Studio Sillage',
    avatarUrl: '',
    followerCount: people.length + 812,
    followingCount: 240,
    demo: true,
    connectedAt: null,
  };
}
