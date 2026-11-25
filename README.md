# Sillage

> Gestion douce de vos followers TikTok — à rythme humain, pas à cadence de robot.

Sillage est une petite application web locale (Node + Express, UI sans build) qui aide à
**retirer des followers un par un**, en imitant le comportement d'une personne :
intervalles irréguliers, micro-pauses, hésitations, heures d'activité, plafond quotidien.

## Lancer

```bash
npm install
npm start
# → http://localhost:3000
```

Sans identifiants TikTok, l'app démarre en **mode démo** : 32 followers fictifs, toutes
les actions sont simulées côté serveur (rien n'est envoyé à TikTok). C'est le moyen le
plus rapide de tester le rythme et l'interface.

## Ce que fait l'app

- **Liste des followers** avec recherche, tri (récents, anciens, alphabétique, portée),
  filtres (à traiter / en pause / retirés) et étiquettes « abonnement mutuel ».
- **Retrait manuel** : un clic = un retrait, mais soumis à trois garde-fous —
  intervalle minimum, plafond quotidien, plage horaire d'activité. Le bouton se
  désactive avec un compte à rebours quand le rythme est atteint.
- **Session assistée** : le moteur choisit des cibles, les espace selon une distribution
  en cloche, insère des pauses toutes N actions, « hésite » parfois et reporte une cible.
- **Simulation** : chronologie prévisionnelle (aucun appel réseau) pour voir l'étalement
  avant de lancer quoi que ce soit.
- **Journal** temps réel (SSE) de tout ce qui se passe.

## Le point important : l'API TikTok

L'API publique de TikTok **n'expose aucun endpoint permettant de retirer un follower à la
place du titulaire du compte**. Le retrait d'un abonné est une action qui se fait dans
l'application TikTok, par la personne propriétaire du compte. Sillage ne prétend pas le
contraire et ne contourne pas cette limite :

1. **OAuth officiel** (Login Kit) : `GET /auth/tiktok` lie le compte, récupère le profil
   via `user/info`. Les scopes demandés sont configurables (`TIKTOK_SCOPES`).
2. **Canal d'action** : si vous disposez d'un canal autorisé (par exemple une automatisation
   sur un appareil dont vous êtes propriétaire, ou un outil interne conforme aux CGU),
   renseignez `ACTION_GATEWAY_URL` / `ACTION_GATEWAY_TOKEN`. Le moteur appellera alors
   `POST {gateway}/followers/:id/remove` — **une action à la fois**, jamais en rafale.
   Sans ce canal, l'app reste en lecture/planification et refuse les retraits réels.

Configurer TikTok : créez une app sur <https://developers.tiktok.com/>, activez Login Kit,
ajoutez `http://localhost:3000/auth/tiktok/callback` aux URI de redirection autorisées,
puis copiez `.env.example` en `.env` et remplissez les clés.

## Garde-fous (non contournables depuis l'UI)

| Limite | Plancher / plafond |
| --- | --- |
| Retraits par jour | max **200** |
| Intervalle minimum | **45 s** |
| Plage d'activité | heures ouvrées de votre choix |
| Une seule session à la fois | oui |

## Structure

```
server/
  config.js     réglages + variables d'environnement
  store.js      persistance JSON atomique (data/)
  tiktok.js     OAuth, profil, passerelle d'actions
  humanize.js   calcul des délais, pauses, simulation
  engine.js     orchestration de session, quotas, journal, SSE
  demo-data.js  followers fictifs
public/         interface (HTML/CSS/JS natif)
data/           état local (ignoré par git)
```

## Responsabilité

Retirer massivement des abonnés pour manipuler des métriques peut violer les conditions
d'utilisation de TikTok et, selon les juridictions, la loi. Sillage est conçu pour rester
lent et borné — utilisez-le sur **votre** compte, avec discernement.
