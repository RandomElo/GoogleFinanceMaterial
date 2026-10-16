# Site Bourse

Interface web de l'API bourse de la Raspberry, dans le style de Google Finance tel qu'il était de 2020 à 2025 (avant la refonte actuelle) : indices du jour, fiche de chaque valeur avec graphique 1 J à MAX, cours historiques, portefeuille, opérations et dividendes. Le thème sombre suit le réglage du système.

C'est un frontend seul (Vite, React, TypeScript, Tailwind, Lucide). Toutes les données viennent de l'API bourse : il n'y a ni backend ni base de données ici, et le site n'appelle jamais Yahoo lui-même.

## Accès à l'API

Le navigateur n'appelle jamais l'API directement : il appelle `/api/...` sur le site, qui relaie vers l'API en ajoutant la clé. La clé reste donc côté serveur et n'apparaît pas dans le JavaScript servi. Ce relais est aussi nécessaire parce que l'API n'envoie pas d'en-têtes CORS.

L'API est joignable à deux adresses, par le VPN (Tailscale) et sur le réseau local. Le choix est automatique :

- en développement (`npm run dev`), le proxy de Vite (`proxy-api.ts`) interroge `/health` sur les deux adresses et garde celle qui répond en premier. Il refait le test chaque minute, ou tout de suite après une erreur réseau (VPN coupé ou rallumé) ;
- dans le conteneur, nginx essaie d'abord l'adresse locale. Si elle ne répond pas en 1 seconde, il passe sur l'adresse VPN et ne retente l'adresse locale que 2 minutes plus tard.

Le site lui-même n'a pas d'authentification : toute personne qui l'atteint voit le portefeuille et peut utiliser les deux actions d'écriture (suivre un instrument, relancer la synchro du Sheet). Il est fait pour rester sur le réseau local ou le VPN, jamais exposé sur Internet.

## Configuration

Copier `.env.example` en `.env` et renseigner la clé :

| Variable  | Défaut              | Rôle                                              |
| --------- | ------------------- | ------------------------------------------------- |
| `API_KEY` | (obligatoire)       | Clé de l'API bourse (la même que dans son `.env`) |
| `API_VPN` | `100.64.0.8:8140`   | Adresse de l'API par le VPN                       |
| `API_LAN` | `192.168.1.31:8140` | Adresse de l'API sur le réseau local              |
| `PORT`    | `8150`              | Port publié par le conteneur                      |

## Commandes

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # typage puis build dans dist/
npm run preview      # sert dist/ avec le même proxy

docker compose up -d --build   # http://<machine>:8150
docker compose logs -f web
```

Node 22 ou plus.

## Pages

| Route                         | Contenu                                                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/`                           | Cinq indices (CAC 40, Euro Stoxx 50, S&P 500, Nasdaq, Nikkei 225) avec la courbe de la journée réduite au trait ; mes valeurs du jour (plus actives, toutes, hausses, baisses) avec leur gain en euros ; performance du jour du portefeuille, au total et par compte.                                               |
| `/valeur/:symbole`            | Cours du moment ; graphique 1 J à MAX, vert ou rouge selon le sens de la période, avec la clôture précédente en pointillés ; séance (clôture précédente, ouverture, plage du jour, jauge de volume) ; performances et plage sur 1 an, sauf pour un indice ; à propos ; ma position et mes opérations sur la valeur. |
| `/valeur/:symbole/historique` | Cours historiques en journalier, hebdomadaire ou mensuel, sur une période au choix, 30 lignes par page, export CSV.                                                                                                                                                                                                 |
| `/portefeuille`               | Valeur et gain sur la période choisie (hors achats et ventes) ; courbe de valorisation avec l'investi net ; investissements triables, par compte ou tous, positions soldées en option ; dernière séance, capital et gains ; comptes.                                                                                |
| `/operations`                 | Opérations du Sheet filtrables par compte, type et dates, avec la ligne d'origine ; état de la synchro et bouton pour la relancer.                                                                                                                                                                                  |
| `/dividendes`                 | Total, barres par année (un clic filtre l'année), répartition par valeur et par compte, liste des versements.                                                                                                                                                                                                       |

Les lignes et colonnes sans valeur (dividendes ou plus-value réalisée à zéro, volume absent, frais vides) sont masquées.

## Détails de fonctionnement

- Recherche : la barre propose d'abord les instruments suivis, puis les résultats de `GET /recherche?q=` de l'API, pour trouver une valeur hors portefeuille (« société générale » donne `GLE.PA`). Les accents sont retirés avant l'envoi, la recherche Yahoo ne trouvant rien avec. Les cotations à Paris passent en tête.
- Instrument non suivi : sa fiche affiche le cours du moment (`/cotations` accepte n'importe quel symbole Yahoo) et un bouton « Suivre » qui l'ajoute à l'API (`POST /instruments`) avec son historique. Sur l'accueil, un indice non suivi propose le même ajout pour afficher sa courbe.
- Jauge de volume : le volume de la séance est comparé à la moyenne des 3 derniers mois (faible, normal, élevé, très élevé). Pendant la séance, la moyenne est ramenée à la part de séance écoulée et le volume vient des barres de 15 min, plus à jour que le volume journalier stocké.
- Performance du jour (accueil) : calculée au cours en direct de `/cotations`. Sur la page Portefeuille, la ligne « Dernière séance » vient des clôtures journalières stockées par l'API (`/positions`).
- Cache : chaque réponse de l'API est gardée 60 secondes dans le navigateur, et `/cotations` a son propre cache de 5 minutes côté API.

## Fichiers

```
site-bourse/
├── vite.config.ts                # Vite, Tailwind, proxy /api
├── proxy-api.ts                  # proxy de dev : choix VPN / réseau local, ajout de la clé
├── nginx/default.conf.template   # proxy de production, même rôle
├── Dockerfile                    # build Node puis nginx
├── docker-compose.yml
└── src/
    ├── lib/                      # appels API et cache, types, formats français, périodes, calculs du jour
    ├── components/               # mise en page, recherche, graphiques SVG, cartes, tableaux
    └── pages/                    # une page par route
```
