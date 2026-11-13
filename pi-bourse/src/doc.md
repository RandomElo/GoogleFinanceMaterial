# API bourse

API perso hébergée sur la Raspberry Pi. Elle récupère les cours sur Yahoo Finance, les stocke dans PostgreSQL et calcule les positions et la valorisation du portefeuille à partir du Google Sheet « Bourse ».

## Fonctionnement

C'est le seul service qui parle à Yahoo Finance. Les autres projets (News IA, AnalyseBancaire, site Bourse) interrogent cette API et non Yahoo : si Yahoo change, une seule correction suffit, et l'historique déjà stocké reste disponible.

- Un cours de clôture par instrument et par jour est stocké (ouverture, haut, bas, clôture, clôture ajustée, volume) depuis l'origine de l'instrument. Le jour est celui de la place de cotation.
- Des barres intraday sont stockées aussi : 15 min à partir de 60 jours en arrière et en continu, 1 h de 60 jours à 2 ans en arrière. Yahoo ne fournit pas plus loin.
- Quand un instrument est ajouté, tout son historique est chargé une fois. Si sa devise n'est pas l'euro, la paire de change (`EURUSD=X`…) est ajoutée aussi pour la conversion.
- Les opérations (achats, ventes, dividendes) viennent du Google Sheet, en lecture seule. Le Sheet fait foi : chaque synchronisation remplace toutes les opérations.
- Positions, performances et valorisation sont calculées à la demande à partir des cours et des opérations stockés.

Tâches automatiques (heure de Paris), exécutées une par une :

| Heure | Tâche |
|---|---|
| Toutes les 15 minutes (à :02, :17, :32, :47) | Barres de 15 min de tous les instruments |
| 18:15, lundi au vendredi | Recharge les 8 derniers jours des instruments européens (Yahoo corrige parfois les dernières séances) |
| 22:30, tous les jours | Synchronise les opérations depuis le Google Sheet |
| 22:45, tous les jours | Recharge les 8 derniers jours des instruments américains, des devises et des cryptos |
| Au démarrage | Synchronise le Sheet, charge les historiques manquants, rattrape les derniers jours |

Tout est donc en base avant le traitement de News IA à 23:50.

## Accès et conventions

- Adresse : `http://<raspberry>:8140`, en réseau local ou par Tailscale.
- Toutes les routes sauf `/health` et `/doc` exigent la clé API, dans l'en-tête `X-API-Key: <clé>` ou `Authorization: Bearer <clé>`.
- Dates au format `AAAA-MM-JJ`. Sans date, c'est aujourd'hui (heure de Paris).
- Symboles au format Yahoo : `ALO.PA`, `AAPL`, `^FCHI`, `BTC-EUR`, `EURUSD=X`. Encoder `^` en `%5E` dans les URL.
- Variations et rendements en pourcentage, arrondis à 2 décimales. Les montants suffixés `_eur` et tous les totaux sont en euros.

```bash
curl -H "X-API-Key: $API_KEY" "http://raspberrypi.local:8140/performances?symboles=%5EFCHI,%5EGSPC"
```

## Endpoints marché

### GET /health

Sans clé. `{ "ok": true }` si la base répond, sinon 503. Sert au healthcheck Docker.

### GET /doc

Sans clé. Cette documentation, en Markdown.

### GET /instruments

Instruments suivis : `symbole`, `nom`, `type` (`INDEX`, `EQUITY`, `ETF`, `CURRENCY`, `FUTURE`, `CRYPTOCURRENCY`), `devise`, `fuseau`, `cloture` (créneau de chargement `europe` ou `us`), `historique_charge`.

### GET /instruments/:symbole

Fiche d'un instrument, plus l'étendue de son historique et son dernier cours stocké. 404 s'il n'est pas suivi.

```json
{
  "symbole": "TTE.PA", "nom": "TotalEnergies SE", "type": "EQUITY", "devise": "EUR",
  "historique": { "premier_jour": "1999-01-04", "dernier_jour": "2026-10-09", "seances": 7012 },
  "dernier_cours": { "jour": "2026-10-09", "ouverture": 61.2, "haut": 62, "bas": 60.9, "cloture": 61.5, "cloture_ajustee": 61.5, "volume": 4100000 }
}
```

### POST /instruments

Corps `{ "symbole": "CW8.PA" }`. Vérifie le symbole chez Yahoo, l'ajoute et charge tout son historique en arrière-plan (quelques secondes). 201 si créé, 200 s'il existait déjà, 404 si Yahoo ne le connaît pas.

### GET /cours/:symbole?debut=&fin=&intervalle=

| Paramètre | Défaut | Rôle |
|---|---|---|
| `debut` | `fin` moins 1 an | Premier jour |
| `fin` | aujourd'hui | Dernier jour |
| `intervalle` | `1d` | `1d`, `1wk` ou `1mo`. En hebdomadaire et mensuel, `jour` est le lundi ou le 1er du mois, et les valeurs sont agrégées (ouverture du premier jour, plus haut, plus bas, dernière clôture, volume cumulé). |

```json
{
  "symbole": "^FCHI", "nom": "CAC 40", "devise": "EUR", "debut": "2026-10-01", "fin": "2026-10-09", "intervalle": "1d",
  "cours": [ { "jour": "2026-10-01", "ouverture": 7650.1, "haut": 7702.3, "bas": 7641, "cloture": 7690.4, "cloture_ajustee": 7690.4, "volume": 61000000 } ]
}
```

### GET /cours/:symbole/intraday?du=&au=&intervalle=

Barres intraday entre minuit (heure de Paris) le jour `du` et la fin du jour `au`. Par défaut les 5 derniers jours, `intervalle` `15m` (ou `30m`, `1h`). Au-delà de 60 jours, seules des barres d'1 h existent : elles sont renvoyées telles quelles, le champ `intervalle` de chaque barre donne sa durée en minutes. 20 000 barres maximum.

```json
{
  "symbole": "ALO.PA", "nom": "Alstom SA", "devise": "EUR", "du": "2026-10-09", "au": "2026-10-09", "intervalle": 30,
  "cours": [ { "horodatage": "2026-10-09T07:00:00.000Z", "intervalle": 30, "ouverture": 15.5, "haut": 15.62, "bas": 15.48, "cloture": 15.6, "volume": 90092 } ]
}
```

`horodatage` est le début de la barre, en UTC.

### GET /performances?symboles=^FCHI,^GSPC&date=

Pour chaque symbole (50 maximum) : dernière séance au plus tard à `date`, sa clôture et les variations en % par rapport à la séance précédente, au dernier cours d'il y a 7 jours, d'il y a 1 mois et du 31 décembre précédent. Un symbole non suivi renvoie `erreur` à sa place sans faire échouer les autres.

```json
{
  "date": "2026-10-11",
  "performances": [
    { "symbole": "^FCHI", "nom": "CAC 40", "devise": "EUR", "seance": "2026-10-09", "cloture": 7803.33,
      "variations": { "jour": 0.95, "semaine": 1.2, "mois": -0.8, "debut_annee": 5.4 } },
    { "symbole": "^XXX", "erreur": "Instrument non suivi" }
  ]
}
```

### GET /cotations?symboles=

Cours du moment demandés à Yahoo (cache de 5 minutes), 50 symboles maximum, même non suivis : `prix`, `variation`, `variation_pct`, `devise`, `etat_marche` (`REGULAR`, `CLOSED`…), `heure`. Un symbole inconnu de Yahoo est absent de la réponse.

### GET /recherche?q=

Cherche chez Yahoo les symboles correspondant à un nom, un ISIN ou un début de symbole (`q` de 2 à 64 caractères), pour trouver quoi passer à `POST /instruments`. 15 résultats maximum, par pertinence, avec un cache de 5 minutes. `suivi` indique si l'instrument est déjà en base. Aucun résultat : liste vide.

```json
{
  "q": "cac 40",
  "resultats": [
    { "symbole": "^FCHI", "nom": "CAC 40", "type": "INDEX", "place": "Paris", "suivi": true },
    { "symbole": "CAC.PA", "nom": "Amundi CAC 40 UCITS ETF Dist", "type": "ETF", "place": "Paris", "suivi": false }
  ]
}
```

`type` reprend celui de Yahoo (`EQUITY`, `ETF`, `INDEX`, `MUTUALFUND`, `CURRENCY`, `CRYPTOCURRENCY`, `FUTURE`…), `place` est le nom de la place de cotation.

## Endpoints portefeuille

### GET /positions?date=&compte=&soldees=true

Positions ouvertes à la date, triées par valeur décroissante, avec les totaux du portefeuille entier et par compte. `compte` limite à un compte (`PEA`, `CTO`, `Binance`…). `soldees=true` ajoute les positions entièrement vendues (quantité 0), utiles pour leur plus-value réalisée.

```json
{
  "jour": "2026-10-11", "devise": "EUR",
  "totaux": { "valeur": 10500, "investi": 9000, "plus_value_latente": 1500, "plus_value_realisee": 120,
              "dividendes": 80, "benefice_total": 1700, "rendement_pct": 18.89 },
  "par_compte": { "PEA": { "valeur": 10500, "investi": 9000, "repartition_pct": 100 } },
  "positions": [ {
    "compte": "PEA", "symbole": "CW8.PA", "nom": "Amundi MSCI World", "devise": "EUR",
    "quantite": 20, "pru": 450, "cours": 525, "date_cours": "2026-10-09",
    "investi": 9000, "valeur": 10500, "plus_value_latente": 1500, "rendement_pct": 16.67,
    "plus_value_realisee": 120, "dividendes": 80, "repartition_pct": 100,
    "valeur_eur": 10500, "investi_eur": 9000, "plus_value_latente_eur": 1500, "plus_value_realisee_eur": 120, "dividendes_eur": 80,
    "variations": { "jour": 0.4, "semaine": 1.1, "mois": 2.3 }
  } ]
}
```

Les champs sans suffixe sont dans la devise de l'instrument, ceux en `_eur` en euros. `totaux.incomplet: true` apparaît si une position n'a pas de cours (historique en cours de chargement) : elle n'est alors pas comptée dans la valeur.

### GET /comptes?date=

Les mêmes totaux que `/positions`, sans le détail des lignes : `{ jour, devise, totaux, comptes: { PEA: {...}, CTO: {...} } }`, chaque compte avec sa `repartition_pct`.

### GET /valorisation?du=&au=&compte=

Valeur en euros pour chaque jour calendaire de la période (dernière année par défaut, 10 ans maximum), éventuellement pour un seul compte. Les jours sans séance reprennent le dernier cours connu.

```json
{
  "devise": "EUR", "du": "2026-10-09", "au": "2026-10-10",
  "points": [
    { "jour": "2026-10-09", "valeur": 10480.5, "investi_net": 9200, "par_compte": { "PEA": 8200.5, "CTO": 2280 } },
    { "jour": "2026-10-10", "valeur": 10480.5, "investi_net": 9200, "par_compte": { "PEA": 8200.5, "CTO": 2280 } }
  ]
}
```

- `investi_net` : achats (frais compris) moins produit des ventes depuis la première opération, convertis au taux de change du jour de chaque opération. `valeur - investi_net` = plus-value globale à cette date.
- `incomplet: true` sur un point si le cours d'une position manque ce jour-là : la valeur est alors sous-estimée.

### GET /valorisation/intraday?du=&au=&intervalle=&compte=

Valeur du portefeuille en euros toutes les 15 min, 30 min ou 1 h (`intervalle` : `15m`, `30m`, `1h`). Par défaut les 7 derniers jours en 30 min. 20 000 points maximum : 208 jours en 15 min, 416 en 30 min, 833 en 1 h.

```json
{
  "devise": "EUR", "du": "2026-10-09", "au": "2026-10-09", "intervalle": 30,
  "points": [
    { "horodatage": "2026-10-08T22:30:00.000Z", "valeur": 10480.5, "investi_net": 9200, "par_compte": { "PEA": 8200.5, "CTO": 2280 } },
    { "horodatage": "2026-10-08T23:00:00.000Z", "valeur": 10482.1, "investi_net": 9200, "par_compte": { "PEA": 8200.5, "CTO": 2281.6 } }
  ]
}
```

- `horodatage` en UTC : chaque point donne la valeur à cet instant, à partir du prix le plus récent déjà connu de chaque position (dernière barre terminée, sinon clôture journalière de la veille).
- La nuit et le week-end, seules les cryptos font bouger la courbe.
- Une opération du jour J compte à partir de minuit (heure de Paris) le jour J, le Sheet n'ayant pas l'heure.
- `investi_net`, `par_compte` et `incomplet` ont le même sens que dans `/valorisation`.

### GET /operations?compte=&symbole=&type=&du=&au=

Opérations importées du Sheet, triées par date. `type` : `achat`, `vente` ou `dividende`.

```json
[
  { "id": 1, "jour": "2025-05-15", "compte": "CTO", "type": "achat", "symbole": "ALO.PA", "nom": "Alstom",
    "quantite": 100, "prix": 19, "courtage": 0, "ttf": 7.6, "frais": 7.6, "montant": 0,
    "onglet_source": "Historique d'opérations", "ligne_source": 3 }
]
```

`onglet_source` et `ligne_source` indiquent où corriger une opération dans le Sheet.

### GET /dividendes?annee=&symbole=&compte=

Dividendes reçus, avec `total`, `par_annee`, `par_symbole`, `par_compte` et la liste `dividendes` (même format que `/operations`, `montant` = montant total reçu).

### GET /operations/synchronisation

État de la synchronisation du Sheet : `active`, puis `derniere` avec la date, le succès, le nombre d'opérations et de dividendes importés et les lignes rejetées (`erreurs`).

### POST /operations/synchroniser

Relit le Sheet tout de suite et renvoie le même état. 503 si la synchronisation n'est pas configurée.

## Définitions des calculs

| Valeur | Calcul |
|---|---|
| PRU | Prix moyen pondéré des achats, courtage et TTF inclus. Une vente ne le modifie pas. |
| Investi | Quantité détenue × PRU |
| Plus-value latente | Quantité × dernier cours − investi |
| Plus-value réalisée | Pour chaque vente : quantité × (prix de vente − PRU) − frais de la vente. Avant impôts. |
| Bénéfice total | Plus-value latente + plus-value réalisée + dividendes |
| Rendement | Bénéfice total / investi |
| Conversion en euros | Cours de la paire `EURXXX=X` du jour (dernier connu). Les cotations de Londres en pence sont ramenées en livres. |

## Google Sheet

Lecture seule avec un compte de service Google, chaque soir à 22:30, au démarrage et sur `POST /operations/synchroniser`. Les en-têtes sont reconnus par leur nom, dans n'importe quel ordre ; les colonnes calculées par le Sheet sont ignorées.

| Onglet | Colonnes lues |
|---|---|
| Historique d'opérations | Nom, Ticker Yahoo, Type (Achat / Vente), Nombre, Date, Prix u / € achat, Taxe brocker, TTF, Portefeuille |
| Dividendes | Nom, Date, Nombre d'actions, Montant unitaire, Montant total. Le symbole et le compte sont retrouvés par le nom dans l'historique d'opérations. |

Une ligne invalide n'est pas importée : elle est listée avec son onglet et son numéro dans `/operations/synchronisation`. Un ticker inconnu est ajouté automatiquement avec son historique.

## Erreurs

Toujours au format `{ "erreur": "message" }`.

| Code | Cas |
|---|---|
| 400 | Paramètre invalide (date, symbole, intervalle, période trop longue, texte de recherche, JSON mal formé) |
| 401 | Clé API absente ou fausse |
| 404 | Instrument non suivi, symbole inconnu de Yahoo, route inconnue |
| 503 | Base injoignable (`/health`) ou synchronisation non configurée |
| 500 | Erreur interne, détail dans `docker compose logs api` |
