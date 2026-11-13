import fs from 'node:fs';
import express from 'express';
import { exigerCleApi } from './auth.js';
import { ajouterJours, aujourdhui, estJourValide } from './dates.js';

const SYMBOLE = /^[A-Za-z0-9^=.\-]{1,32}$/;
const MAX_SYMBOLES = 50;
const MAX_JOURS_VALORISATION = 3700;

// Index renvoyé par GET / : le détail des paramètres et réponses est dans le README
// Documentation en Markdown, sans clé : aucune donnée, exemples fictifs
const DOC = fs.readFileSync(new URL('./doc.md', import.meta.url), 'utf8');

const ROUTES = [
  'GET  /health',
  'GET  /doc',
  'GET  /instruments',
  'GET  /instruments/:symbole',
  'POST /instruments { symbole }',
  'GET  /cours/:symbole?debut=&fin=&intervalle=1d|1wk|1mo',
  'GET  /cours/:symbole/intraday?du=&au=&intervalle=15m|30m|1h',
  'GET  /performances?symboles=^FCHI,^GSPC&date=',
  'GET  /cotations?symboles=',
  'GET  /recherche?q=',
  'GET  /positions?date=&compte=&soldees=true',
  'GET  /comptes?date=',
  'GET  /valorisation?du=&au=&compte=',
  'GET  /valorisation/intraday?du=&au=&intervalle=15m|30m|1h&compte=',
  'GET  /operations?compte=&symbole=&type=achat|vente|dividende&du=&au=',
  'GET  /dividendes?annee=&symbole=&compte=',
  'GET  /operations/synchronisation',
  'POST /operations/synchroniser',
];

export class ErreurRequete extends Error {
  constructor(message, statut = 400) {
    super(message);
    this.statut = statut;
  }
}

function lireSymboles(valeur) {
  const symboles = String(valeur ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (!symboles.length) throw new ErreurRequete('Paramètre "symboles" requis (ex. ^FCHI,^GSPC)');
  if (symboles.length > MAX_SYMBOLES) throw new ErreurRequete(`${MAX_SYMBOLES} symboles maximum`);
  for (const s of symboles) if (!SYMBOLE.test(s)) throw new ErreurRequete(`Symbole invalide : ${s}`);
  return [...new Set(symboles)];
}

function lireSymbole(valeur) {
  const symbole = String(valeur ?? '').trim();
  if (!SYMBOLE.test(symbole)) throw new ErreurRequete(`Symbole invalide : ${symbole}`);
  return symbole;
}

/** Paramètre texte libre (compte…) : undefined si absent, borné en longueur. */
function lireTexte(valeur) {
  if (valeur === undefined || valeur === '') return undefined;
  const texte = String(valeur).trim();
  if (texte.length > 64) throw new ErreurRequete('Paramètre trop long');
  return texte;
}

const INTERVALLES_INTRADAY = { '15m': 15, '30m': 30, '1h': 60 };
const MAX_POINTS_INTRADAY = 20000;

/** du, au (jours, heure de Paris) et intervalle d'une requête intraday, bornés à 20 000 points. */
function lirePeriodeIntraday(query, { jours, intervalle }) {
  const au = lireJour(query.au, 'au', aujourdhui());
  const du = lireJour(query.du, 'du', ajouterJours(au, -(jours - 1)));
  const minutes = INTERVALLES_INTRADAY[query.intervalle ?? intervalle];
  if (!minutes) throw new ErreurRequete('"intervalle" doit valoir 15m, 30m ou 1h');
  if (du > au) throw new ErreurRequete('"du" doit précéder "au"');
  const joursMax = Math.floor((MAX_POINTS_INTRADAY * minutes) / 1440);
  if (ajouterJours(du, joursMax) <= au) throw new ErreurRequete(`Période limitée à ${joursMax} jours en ${query.intervalle ?? intervalle}`);
  return { du, au, minutes };
}

function lireJour(valeur, nom, defaut) {
  if (valeur === undefined || valeur === '') return defaut;
  if (!estJourValide(String(valeur))) throw new ErreurRequete(`"${nom}" doit être une date AAAA-MM-JJ`);
  return String(valeur);
}

/**
 * services : { lecture, chargement, yahoo, synchro, verifierBdd }
 * Tout est injecté pour pouvoir tester les routes sans base ni Yahoo.
 */
export function creerApp({ apiKey, lecture, chargement, yahoo, synchro, verifierBdd }) {
  const app = express();
  app.disable('x-powered-by');
  app.use(express.json({ limit: '10kb' }));

  // Sans clé : sert au healthcheck Docker
  app.get('/health', async (req, res) => {
    try {
      await verifierBdd();
      res.json({ ok: true });
    } catch {
      res.status(503).json({ ok: false, erreur: 'Base de données injoignable' });
    }
  });

  app.get('/doc', (req, res) => {
    res.type('text/markdown; charset=utf-8').send(DOC);
  });

  app.use(exigerCleApi(apiKey));

  app.get('/', (req, res) => {
    res.json({ documentation: '/doc', routes: ROUTES });
  });

  app.get('/instruments', async (req, res) => {
    res.json(await lecture.instruments());
  });

  app.get('/instruments/:symbole', async (req, res) => {
    const symbole = lireSymbole(req.params.symbole);
    const resultat = await lecture.instrument(symbole);
    if (!resultat) throw new ErreurRequete(`Instrument non suivi : ${symbole}`, 404);
    res.json(resultat);
  });

  app.post('/instruments', async (req, res) => {
    const symbole = String(req.body?.symbole ?? '').trim();
    if (!SYMBOLE.test(symbole)) throw new ErreurRequete('Corps attendu : { "symbole": "^FCHI" }');
    const resultat = await chargement.ajouterInstrument(symbole);
    if (!resultat) throw new ErreurRequete(`Symbole inconnu de Yahoo Finance : ${symbole}`, 404);
    // L'historique complet peut prendre quelques secondes : chargé en arrière-plan
    if (resultat.cree) chargement.chargerHistoriquesManquants().catch((e) => console.error('[chargement]', e));
    res.status(resultat.cree ? 201 : 200).json(resultat.instrument);
  });

  app.get('/cours/:symbole', async (req, res) => {
    const symbole = lireSymbole(req.params.symbole);
    const fin = lireJour(req.query.fin, 'fin', aujourdhui());
    const debut = lireJour(req.query.debut, 'debut', ajouterJours(fin, -365));
    const intervalle = req.query.intervalle ?? '1d';
    if (!['1d', '1wk', '1mo'].includes(intervalle)) throw new ErreurRequete('"intervalle" doit valoir 1d, 1wk ou 1mo');
    if (debut > fin) throw new ErreurRequete('"debut" doit précéder "fin"');
    const resultat = await lecture.cours(symbole, { debut, fin, intervalle });
    if (!resultat) throw new ErreurRequete(`Instrument non suivi : ${symbole} (l'ajouter avec POST /instruments)`, 404);
    res.json(resultat);
  });

  app.get('/cours/:symbole/intraday', async (req, res) => {
    const symbole = lireSymbole(req.params.symbole);
    const { du, au, minutes } = lirePeriodeIntraday(req.query, { jours: 5, intervalle: '15m' });
    const resultat = await lecture.coursIntraday(symbole, { du, au, minutes });
    if (!resultat) throw new ErreurRequete(`Instrument non suivi : ${symbole} (l'ajouter avec POST /instruments)`, 404);
    res.json(resultat);
  });

  app.get('/performances', async (req, res) => {
    const symboles = lireSymboles(req.query.symboles);
    const jour = lireJour(req.query.date, 'date', aujourdhui());
    res.json({ date: jour, performances: await lecture.performancesAu(symboles, jour) });
  });

  app.get('/cotations', async (req, res) => {
    res.json(await yahoo.cotations(lireSymboles(req.query.symboles)));
  });

  app.get('/recherche', async (req, res) => {
    const q = String(req.query.q ?? '').trim();
    if (q.length < 2 || q.length > 64) throw new ErreurRequete('Paramètre "q" requis, de 2 à 64 caractères');
    const [resultats, suivis] = await Promise.all([yahoo.rechercher(q), lecture.instruments()]);
    const symbolesSuivis = new Set(suivis.map((i) => i.symbole));
    res.json({ q, resultats: resultats.map((r) => ({ ...r, suivi: symbolesSuivis.has(r.symbole) })) });
  });

  app.get('/positions', async (req, res) => {
    const jour = lireJour(req.query.date, 'date', aujourdhui());
    res.json(await lecture.positionsAu(jour, { compte: lireTexte(req.query.compte), soldees: req.query.soldees === 'true' }));
  });

  app.get('/comptes', async (req, res) => {
    const jour = lireJour(req.query.date, 'date', aujourdhui());
    const { totaux, par_compte: comptes } = await lecture.positionsAu(jour);
    res.json({ jour, devise: 'EUR', totaux, comptes });
  });

  app.get('/valorisation', async (req, res) => {
    const au = lireJour(req.query.au, 'au', aujourdhui());
    const du = lireJour(req.query.du, 'du', ajouterJours(au, -365));
    if (du > au) throw new ErreurRequete('"du" doit précéder "au"');
    if (ajouterJours(du, MAX_JOURS_VALORISATION) < au) throw new ErreurRequete('Période limitée à 10 ans');
    res.json(await lecture.valorisationEntre(du, au, { compte: lireTexte(req.query.compte) }));
  });

  app.get('/valorisation/intraday', async (req, res) => {
    const { du, au, minutes } = lirePeriodeIntraday(req.query, { jours: 7, intervalle: '30m' });
    res.json(await lecture.valorisationIntradayEntre(du, au, { minutes, compte: lireTexte(req.query.compte) }));
  });

  app.get('/operations', async (req, res) => {
    const type = lireTexte(req.query.type);
    if (type && !['achat', 'vente', 'dividende'].includes(type)) throw new ErreurRequete('"type" doit valoir achat, vente ou dividende');
    const du = lireJour(req.query.du, 'du');
    const au = lireJour(req.query.au, 'au');
    const symbole = req.query.symbole === undefined ? undefined : lireSymbole(req.query.symbole);
    res.json(await lecture.operations({ compte: lireTexte(req.query.compte), symbole, type, du, au }));
  });

  app.get('/dividendes', async (req, res) => {
    const annee = lireTexte(req.query.annee);
    if (annee && !/^\d{4}$/.test(annee)) throw new ErreurRequete('"annee" doit être une année sur 4 chiffres');
    const symbole = req.query.symbole === undefined ? undefined : lireSymbole(req.query.symbole);
    res.json(await lecture.dividendes({ annee, symbole, compte: lireTexte(req.query.compte) }));
  });

  app.get('/operations/synchronisation', (req, res) => {
    res.json(synchro.etat());
  });

  app.post('/operations/synchroniser', async (req, res) => {
    if (!synchro.active) throw new ErreurRequete('Synchronisation Google Sheet non configurée', 503);
    res.json(await synchro.synchroniser());
  });

  app.use((req, res) => res.status(404).json({ erreur: 'Route inconnue' }));

  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err instanceof ErreurRequete) return res.status(err.statut).json({ erreur: err.message });
    if (err.type === 'entity.parse.failed') return res.status(400).json({ erreur: 'JSON invalide' });
    console.error('[api]', err);
    res.status(500).json({ erreur: 'Erreur interne' });
  });

  return app;
}
