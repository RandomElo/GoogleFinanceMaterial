// Reprise de l'historique : recharge depuis Yahoo, pour tous les instruments suivis (ou ceux
// passés en argument), tout le journalier depuis l'origine et l'intraday au plus loin que Yahoo
// le permet (1 h sur 2 ans, 15 min sur 60 jours). Sans risque à relancer : les cours existants
// sont mis à jour, rien n'est supprimé hors des barres d'1 h remplacées par du 15 min.
//
// Dans le conteneur :  docker compose exec api node src/reprise.js [SYMBOLE...]

import { creerBdd } from './bdd.js';
import { creerChargement } from './chargement.js';
import { lireConfig } from './config.js';
import { creerSynchroOperations } from './operations.js';
import { creerYahoo } from './yahoo.js';

const config = lireConfig();
const bdd = creerBdd(config.databaseUrl);
const yahoo = creerYahoo();
const chargement = creerChargement({ bdd, yahoo });
const synchro = creerSynchroOperations({ bdd, chargement, google: config.google });

await bdd.sequelize.authenticate();
await bdd.sequelize.sync();

// Les opérations d'abord : elles ajoutent les instruments achetés qui ne seraient pas encore suivis
if (synchro.active && process.argv.length <= 2) {
  const { operations, dividendes, erreurs } = await synchro.synchroniser();
  console.log(`Sheet : ${operations} opérations, ${dividendes} dividendes${erreurs.length ? `, problèmes : ${erreurs.join(' ; ')}` : ''}`);
}

const demandes = process.argv.slice(2);
const instruments = await bdd.Instrument.findAll({
  where: demandes.length ? { symbole: demandes } : {},
  order: [['symbole', 'ASC']],
});
if (demandes.length && instruments.length < demandes.length) {
  const trouves = new Set(instruments.map((i) => i.symbole));
  console.log(`Non suivis (à ajouter avec POST /instruments) : ${demandes.filter((s) => !trouves.has(s)).join(', ')}`);
}

let echecs = 0;
for (const instrument of instruments) {
  const debut = Date.now();
  try {
    const { seances, horaires, quarts } = await chargement.reprendre(instrument);
    console.log(`${instrument.symbole.padEnd(12)} ${String(seances).padStart(6)} séances, ${String(horaires).padStart(6)} barres 1 h, ${String(quarts).padStart(5)} barres 15 min (${((Date.now() - debut) / 1000).toFixed(1)} s)`);
  } catch (e) {
    echecs++;
    console.log(`${instrument.symbole.padEnd(12)} ÉCHEC : ${e.message}`);
  }
}

const [[totaux]] = await bdd.sequelize.query(
  'SELECT (SELECT count(*) FROM cours_journaliers) AS journaliers, (SELECT count(*) FROM cours_intraday) AS intraday',
);
console.log(`Base : ${totaux.journaliers} cours journaliers, ${totaux.intraday} barres intraday${echecs ? `, ${echecs} échec(s)` : ''}`);
await bdd.sequelize.close();
process.exit(echecs ? 1 : 0);
