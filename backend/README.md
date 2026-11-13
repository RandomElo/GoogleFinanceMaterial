# API bourse

API perso hébergée sur la Raspberry. Elle récupère les cours sur Yahoo Finance (`yahoo-finance2`), les stocke dans le PostgreSQL commun et les sert aux autres projets. C'est le seul service qui parle à Yahoo : si Yahoo change, on ne corrige que `src/yahoo.js`, et l'historique déjà stocké reste disponible.

Yahoo Finance ne demande ni compte ni clé : rien à fournir de ce côté.

## Qui l'utilise

- News IA : performances des indices (jour, semaine, mois, depuis janvier) ajoutées à l'article Bourse (`GET /performances`).
- AnalyseBancaire : historique de valorisation du portefeuille (`GET /valorisation`).
- Site Bourse : graphiques et cotations (`GET /cours`, `GET /cotations`), à la place des appels directs à Yahoo dans `controleurs/bourse.js`.

## Fonctionnement

Un seul conteneur, `bourse-api` (Node 24, Express 5, Sequelize), branché sur le réseau `commun` pour joindre `postgres:5432`, base `bourse`.

Tâches planifiées (`node-cron`, heure de Paris), exécutées une par une :

| Heure | Tâche |
|---|---|
| Toutes les 15 minutes (à :02, :17, :32, :47) | Barres de 15 min de tous les instruments, depuis la dernière stockée (rattrape seul une coupure de moins de 60 jours) |
| 18:15, lundi au vendredi | Recharge les 8 derniers jours (environ 5 séances) des instruments du créneau `europe` |
| 22:30, tous les jours | Synchronise les opérations depuis le Google Sheet (si configuré) |
| 22:45, tous les jours | Recharge les 8 derniers jours des instruments du créneau `us` (places américaines, devises, cryptos) |
| Au démarrage | Synchronise le Sheet, charge les historiques complets manquants, puis recharge les derniers jours et les barres de 15 min de tout (rattrapage si le Pi était éteint) |

Yahoo corrige parfois les dernières séances, d'où le rechargement de plusieurs jours (les cours existants sont mis à jour). Tout est en base avant le traitement de News IA à 23:50.

Le créneau d'un instrument est déduit de sa place de cotation à l'ajout : fuseau `America/*`, devise ou crypto donnent `us`, le reste `europe`.

Quand un instrument est ajouté, tout son historique est chargé une fois, en arrière-plan : journalier depuis l'origine, intraday au plus loin que Yahoo le permet. Si sa devise n'est pas l'euro, la paire de change correspondante (`EURUSD=X`, `EURGBP=X`…) est ajoutée automatiquement, car la valorisation en a besoin.

## Données

| Table | Contenu |
|---|---|
| `instruments` | Symbole Yahoo, nom, type (`INDEX`, `EQUITY`, `ETF`, `CURRENCY`, `FUTURE`, `CRYPTOCURRENCY`), devise, fuseau de la place, créneau de chargement, historique chargé ou non |
| `cours_journaliers` | Un cours par instrument et par jour, clé primaire `(instrument_id, jour)` : ouverture, haut, bas, clôture, clôture ajustée, volume. Le jour est celui de la place de cotation. |
| `cours_intraday` | Barres intraday, clé primaire `(instrument_id, horodatage)`, horodatage = début de la barre en UTC : intervalle en minutes, ouverture, haut, bas, clôture, volume. 15 min sur les 60 derniers jours puis en continu, 1 h de 60 jours à 2 ans en arrière (reprise d'historique). |
| `operations` | Achats, ventes et dividendes, synchronisés depuis le Google Sheet : compte, type, symbole, nom, quantité, prix, courtage, TTF, montant, onglet et ligne d'origine. Le Sheet fait foi : chaque synchro remplace toute la table. |

Profondeur intraday : Yahoo ne fournit le 15 et le 30 min que sur les 60 derniers jours, et l'1 h sur 730 jours. L'historique intraday plus ancien que 2 ans n'existe donc pas : la valorisation intraday y retombe sur la clôture de la veille. À partir de maintenant, le 15 min s'accumule sans limite (environ 50 000 lignes par an pour le portefeuille actuel, quelques Mo).

`GET /cotations` passe par un cache mémoire de 5 minutes et n'est pas stocké. Les performances, positions et valorisations sont calculées à la demande (`src/calculs.js`).

## Reprise de l'historique

`src/reprise.js` reconstruit les données depuis Yahoo : il synchronise le Sheet (ce qui ajoute les instruments achetés), puis recharge pour chaque instrument tout le journalier depuis l'origine, l'1 h sur 2 ans et le 15 min sur 60 jours. Les cours existants sont mis à jour, rien d'autre n'est supprimé que les barres d'1 h remplacées par du 15 min : il peut être relancé sans risque, l'API restant en marche.

```bash
docker compose exec api node src/reprise.js            # tout
docker compose exec api node src/reprise.js ALO.PA     # seulement certains symboles (sans synchro du Sheet)
```

Environ 10 secondes par instrument.

Les tables sont créées au démarrage si elles manquent (`sequelize.sync()`), jamais modifiées ensuite : un changement de schéma se fait à la main en SQL.

## Endpoints

Toutes les routes sauf `/health` et `/doc` exigent la clé : en-tête `X-API-Key: <API_KEY>` ou `Authorization: Bearer <API_KEY>`. Les dates sont au format `AAAA-MM-JJ`, les montants des totaux sont en euros, les erreurs sont renvoyées en `{ "erreur": "..." }`. `GET /` liste les routes. Encoder `^` en `%5E` dans les URL.

### Marché

| Route | Rôle |
|---|---|
| `GET /health` | `{ "ok": true }` si la base répond (healthcheck Docker) |
| `GET /doc` | Documentation de l'API en Markdown, sans clé (`src/doc.md`, à tenir à jour avec ce README) |
| `GET /instruments` | Instruments suivis |
| `GET /instruments/:symbole` | Fiche d'un instrument, étendue de son historique (`premier_jour`, `dernier_jour`, `seances`) et dernier cours stocké |
| `POST /instruments` | Corps `{ "symbole": "CW8.PA" }`. Vérifie le symbole chez Yahoo, l'ajoute et charge son historique en arrière-plan. 201 si créé, 200 s'il existait, 404 si Yahoo ne le connaît pas. |
| `GET /cours/:symbole?debut=&fin=&intervalle=1d\|1wk\|1mo` | Cours stockés (OHLCV, clôture ajustée). Par défaut la dernière année en journalier. En hebdomadaire et mensuel, `jour` est le lundi ou le 1er du mois. |
| `GET /cours/:symbole/intraday?du=&au=&intervalle=15m\|30m\|1h` | Barres intraday stockées entre minuit (Paris) le jour `du` et la fin du jour `au`. Par défaut les 5 derniers jours en 15 min. Les barres d'1 h de la reprise (au-delà de 60 jours) sont renvoyées telles quelles ; `intervalle` de chaque barre indique sa durée. 20 000 barres maximum. |
| `GET /performances?symboles=^FCHI,^GSPC&date=` | Dernière séance au plus tard à `date` (aujourd'hui par défaut), clôture, et variations en % : séance précédente, 7 jours, 1 mois, depuis le 31/12 |
| `GET /cotations?symboles=...` | Cours du moment (prix, variation, devise, état du marché), 50 symboles maximum, même non suivis. Cache de 5 minutes. |
| `GET /recherche?q=` | Recherche Yahoo par nom, ISIN ou début de symbole (2 à 64 caractères), pour trouver le symbole à passer à `POST /instruments`. 15 résultats maximum : `symbole`, `nom`, `type`, `place`, `suivi` (déjà en base). Cache de 5 minutes. |

### Portefeuille

| Route | Rôle |
|---|---|
| `GET /positions?date=&compte=&soldees=true` | Positions ouvertes à cette date (aujourd'hui par défaut), triées par valeur : quantité, PRU, cours et date du cours, investi, valeur, plus-value latente et rendement, plus-value réalisée, dividendes, répartition, variations jour/semaine/mois. Les montants existent en devise de l'instrument et en euros (`_eur`). Avec `totaux` (le portefeuille entier, comme l'onglet Accueil) et `par_compte`. `soldees=true` ajoute les positions entièrement vendues. |
| `GET /comptes?date=` | Totaux par compte (PEA, CTO, Binance…) : valeur, investi, plus-values latente et réalisée, dividendes, bénéfice total, rendement, répartition |
| `GET /valorisation?du=&au=&compte=` | Valeur en euros pour chaque jour calendaire de la période (10 ans maximum, dernière année par défaut), éventuellement pour un seul compte |
| `GET /valorisation/intraday?du=&au=&intervalle=15m\|30m\|1h&compte=` | Valeur du portefeuille en euros toutes les 15 min, 30 min ou 1 h. Par défaut les 7 derniers jours en 30 min, 20 000 points maximum (208 jours en 15 min, 416 en 30 min, 833 en 1 h). |
| `GET /operations?compte=&symbole=&type=achat\|vente\|dividende&du=&au=` | Opérations importées, triées par date, avec l'onglet et la ligne du Sheet d'où elles viennent |
| `GET /dividendes?annee=&symbole=&compte=` | Dividendes reçus, avec totaux par année, par instrument et par compte |
| `GET /operations/synchronisation` | État de la synchro : active ou non, date, nombre d'opérations et de dividendes importés, lignes rejetées |
| `POST /operations/synchroniser` | Relit le Sheet tout de suite (sinon chaque soir à 22:30 et au démarrage). 503 tant qu'elle n'est pas configurée. |

Définitions utilisées :

- PRU : prix moyen pondéré des achats, courtage et TTF inclus. Une vente ne le change pas.
- Plus-value réalisée d'une vente : quantité × (prix de vente − PRU) − frais de la vente. Hors impôts : la colonne "Flat tax" du Sheet n'est pas importée (elle est recalculée par le Sheet avec le cours du jour).
- `investi` : quantité détenue × PRU. `benefice_total` = plus-value latente + plus-value réalisée + dividendes, `rendement_pct` = `benefice_total` / `investi`.

Exemple de réponse de `GET /valorisation` :

```json
{
  "devise": "EUR",
  "du": "2026-10-09",
  "au": "2026-10-10",
  "points": [
    { "jour": "2026-10-09", "valeur": 19296.75, "investi_net": 18070.2, "par_compte": { "Binance": 2570.1, "CTO": 7706.4, "PEA": 9020.25 } },
    { "jour": "2026-10-10", "valeur": 19308.37, "investi_net": 18070.2, "par_compte": { "Binance": 2581.72, "CTO": 7706.4, "PEA": 9020.25 } }
  ]
}
```

- Les jours sans séance (week-end, fériés) reprennent le dernier cours connu ; les cryptos cotent tous les jours.
- `investi_net` : somme des achats (frais compris) moins le produit des ventes depuis le début, convertie au taux de change du jour de chaque opération. `valeur - investi_net` donne la plus-value globale à cette date.
- `incomplet: true` apparaît si le cours d'une position manque ce jour-là (historique pas encore chargé) : `valeur` est alors sous-estimée.

`GET /valorisation/intraday` renvoie le même format avec `horodatage` (ISO, UTC) à la place de `jour`. À chaque instant, chaque position prend le prix le plus récent déjà connu : la clôture de la dernière barre terminée (15 min, ou 1 h au-delà de 60 jours), sinon la clôture journalière de la veille. La nuit et le week-end, la courbe ne bouge donc que pour les cryptos. Une opération du jour J compte à partir de minuit (Paris) le jour J, le Sheet n'ayant pas l'heure.

## Google Sheet des opérations

Lecture seule, avec un compte de service Google :

1. Dans la Google Cloud Console : créer un projet, activer l'API Google Sheets, créer un compte de service et télécharger sa clé JSON.
2. Poser la clé dans `secrets/google.json` (dossier déjà créé, non versionné, monté en lecture seule dans le conteneur).
3. Partager le Sheet avec l'adresse e-mail du compte de service (`...@...iam.gserviceaccount.com`), en lecteur.
4. Dans `.env` : `GOOGLE_SHEET_ID=<id du Sheet>`, puis `docker compose restart api`.

Tant que la clé ou l'identifiant manque, l'API tourne normalement sans synchro (un avertissement au démarrage, 503 sur `POST /operations/synchroniser`). Aucun code à modifier quand ils arrivent.

Deux onglets du classeur "Bourse" sont lus. Les en-têtes sont reconnus par leur nom (accents, majuscules et ponctuation ignorés), dans n'importe quel ordre, et peuvent être sur l'une des 5 premières lignes : dans "Historique d'opérations", la ligne 1 regroupe les colonnes et les vrais en-têtes sont en ligne 2. Les autres onglets (Accueil, Calculateur achats…) et les colonnes calculées par le Sheet sont ignorés : l'API refait les calculs.

Onglet "Historique d'opérations" (`GOOGLE_ONGLET_OPERATIONS`), une ligne par achat ou vente :

| Colonne | Champ | Contenu |
|---|---|---|
| `Nom` | `nom` | Sert aussi à rattacher les dividendes. Si deux colonnes s'appellent `Nom`, la première est prise. |
| `Ticker Yahoo` | `symbole` | `ALO.PA`, `BTC-EUR`… (espaces retirés). La colonne `Ticker` au format Google Finance est ignorée. |
| `Type` | `type` | `Achat` ou `Vente` |
| `Nombre` | `quantite` | Décimales acceptées (cryptos) |
| `Date` | `jour` | `15/05/2025` |
| `Prix u / € achat` | `prix` | Prix unitaire de l'achat ou de la vente, dans la devise de l'instrument (l'euro pour tous les tickers actuels) |
| `Taxe brocker` | `courtage` | Frais de courtage |
| `TTF` | `ttf` | Taxe sur les transactions financières |
| `Portefeuille` | `compte` | `PEA`, `CTO`, `Binance`… |

Onglet "Dividendes" (`GOOGLE_ONGLET_DIVIDENDES`) : `Nom`, `Date`, `Nombre d'actions`, `Montant unitaire`, `Montant total` (calculé nombre × unitaire s'il est vide). Le symbole et le compte sont ceux du dernier achat ou vente du même `Nom` avant la date du dividende.

Une ligne invalide (date, type, nombre illisible, nom de dividende introuvable) n'est pas importée : elle est signalée avec son onglet et son numéro de ligne dans les logs et dans `GET /operations/synchronisation`. Un ticker inconnu en base est ajouté automatiquement, avec son historique.

## Configuration

Fichier `.env` à la racine du projet (jamais commité), modèle dans `.env.example` :

| Variable | Défaut | Rôle |
|---|---|---|
| `API_KEY` | (obligatoire) | Clé des routes, 16 caractères minimum |
| `DATABASE_URL` | (obligatoire) | `postgresql://<user>:<mdp>@postgres:5432/bourse`, identifiants de `../commun/.env` |
| `CACHE_COTATIONS_SECONDES` | `300` | Durée du cache de `GET /cotations` |
| `GOOGLE_SERVICE_ACCOUNT_FILE` | `/app/secrets/google.json` | Chemin de la clé JSON dans le conteneur (`./secrets` y est monté) |
| `GOOGLE_SHEET_ID` | vide | Identifiant du Sheet (entre `/d/` et `/edit` dans l'URL) ; vide = synchro désactivée |
| `GOOGLE_ONGLET_OPERATIONS` | `Historique d'opérations` | Onglet des achats et ventes |
| `GOOGLE_ONGLET_DIVIDENDES` | `Dividendes` | Onglet des dividendes |
| `PORT` | `8140` | Port d'écoute |

## Fichiers

```
bourse/
├── docker-compose.yml
├── Dockerfile
├── .env / .env.example
├── secrets/            # clé du compte de service Google, non versionnée
├── src/
│   ├── server.js       # démarrage, crons
│   ├── reprise.js      # script de reprise de l'historique
│   ├── app.js          # routes Express et validation des paramètres
│   ├── doc.md          # documentation servie par GET /doc
│   ├── auth.js         # clé API (comparaison en temps constant)
│   ├── config.js       # lecture des variables d'environnement
│   ├── bdd.js          # modèles Sequelize
│   ├── yahoo.js        # seul module qui appelle Yahoo
│   ├── chargement.js   # ajout d'instruments, historiques, rechargement quotidien
│   ├── operations.js   # synchro du Google Sheet
│   ├── lecture.js      # lectures en base pour les routes
│   ├── calculs.js      # performances, agrégation, positions, valorisation (fonctions pures)
│   ├── devises.js      # conversion en euros
│   └── dates.js
└── test/               # node --test, sans base ni Yahoo
```

## Commandes

```bash
cd ../commun && docker compose up -d     # Postgres d'abord
docker compose up -d --build
docker compose logs -f api
npm test                                 # tests (Node 22 ou plus)

# Ajouter un instrument
curl -X POST localhost:8140/instruments -H "X-API-Key: $API_KEY" -H "Content-Type: application/json" -d '{"symbole":"^FCHI"}'
# Trouver le symbole d'une valeur
curl "localhost:8140/recherche?q=totalenergies" -H "X-API-Key: $API_KEY"
# Performances
curl "localhost:8140/performances?symboles=%5EFCHI,%5EGSPC" -H "X-API-Key: $API_KEY"
# Valorisation de la journée toutes les 15 min
curl "localhost:8140/valorisation/intraday?du=2026-10-09&au=2026-10-09&intervalle=15m" -H "X-API-Key: $API_KEY"
# Reprise de l'historique
docker compose exec api node src/reprise.js
# Base
docker exec -it commun-postgres psql -U <user> -d bourse
```

Base créée une fois avec `docker exec commun-postgres createdb -U <user> bourse`.
