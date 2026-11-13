import cron from 'node-cron';
import { creerApp } from './app.js';
import { creerBdd } from './bdd.js';
import { creerChargement } from './chargement.js';
import { lireConfig } from './config.js';
import { creerLecture } from './lecture.js';
import { creerSynchroOperations } from './operations.js';
import { creerYahoo } from './yahoo.js';

const config = lireConfig();
const bdd = creerBdd(config.databaseUrl);
const yahoo = creerYahoo({ cacheSecondes: config.cacheCotationsSecondes });
const chargement = creerChargement({ bdd, yahoo });
const synchro = creerSynchroOperations({ bdd, chargement, google: config.google });
const lecture = creerLecture(bdd);

await bdd.sequelize.authenticate();
// Crée les tables manquantes, sans jamais modifier ni supprimer les existantes
await bdd.sequelize.sync();

const serveur = creerApp({
  apiKey: config.apiKey,
  lecture,
  chargement,
  yahoo,
  synchro,
  verifierBdd: () => bdd.sequelize.query('SELECT 1'),
}).listen(config.port, () => console.log(`[api] Écoute sur le port ${config.port}`));

// Une tâche à la fois : un chargement long ne doit pas en chevaucher un autre
let file = Promise.resolve();
function enFile(nom, tache) {
  file = file.then(tache).catch((e) => console.error(`[${nom}]`, e));
  return file;
}

const options = { timezone: config.fuseau };
// Après la clôture de Paris/Francfort/Londres (17 h 30) : cours définitifs vers 18 h
cron.schedule('15 18 * * 1-5', () => enFile('europe', () => chargement.chargerRecents('europe')), options);
// Après la clôture de New York (22 h heure de Paris) ; tous les jours pour les cryptos
cron.schedule('45 22 * * *', () => enFile('us', () => chargement.chargerRecents('us')), options);
// Barres de 15 min de tous les instruments (rattrape aussi les trous de moins de 60 jours).
// 2 minutes après chaque quart d'heure : à l'heure pile, Yahoo n'a pas encore clos la barre
cron.schedule('2,17,32,47 * * * *', () => enFile('intraday', () => chargement.chargerIntradayRecents()), options);
if (synchro.active) {
  // Avant le chargement US, pour que les nouveaux symboles aient leurs cours le soir même
  cron.schedule('30 22 * * *', () => enFile('operations', () => synchro.synchroniser()), options);
} else {
  console.warn(`[operations] Synchronisation désactivée : il faut la clé ${config.google.fichierCompteService} et GOOGLE_SHEET_ID (prise en compte au redémarrage)`);
}

// Au démarrage : opérations à jour, historiques manquants, puis rattrapage des derniers jours
// si le Pi était éteint à l'heure du cron
enFile('demarrage', async () => {
  if (synchro.active) await synchro.synchroniser().catch((e) => console.error('[operations]', e.message));
  await chargement.chargerHistoriquesManquants();
  await chargement.chargerRecents();
  await chargement.chargerIntradayRecents();
});

async function arreter(signal) {
  console.log(`[api] ${signal} reçu, arrêt...`);
  serveur.close();
  await bdd.sequelize.close();
  process.exit(0);
}

process.on('SIGTERM', () => arreter('SIGTERM'));
process.on('SIGINT', () => arreter('SIGINT'));
