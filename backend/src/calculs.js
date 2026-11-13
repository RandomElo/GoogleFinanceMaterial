import { ajouterJours, finAnneePrecedente, minuitLocal, moisPrecedent, lundi } from './dates.js';
import { symboleChange, versEuros } from './devises.js';

// Fonctions pures : elles reçoivent des tableaux déjà lus en base, ce qui les rend testables.
// Une série de cours est un tableau [{ jour, cloture, ... }] trié par jour croissant.

/** Index de la dernière séance dont le jour est <= `jour`, ou -1. */
export function indexAu(serie, jour) {
  let bas = 0;
  let haut = serie.length - 1;
  let trouve = -1;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    if (serie[milieu].jour <= jour) { trouve = milieu; bas = milieu + 1; } else { haut = milieu - 1; }
  }
  return trouve;
}

export function clotureAu(serie, jour) {
  const i = indexAu(serie, jour);
  return i === -1 ? null : serie[i].cloture;
}

function variation(actuel, reference) {
  if (actuel == null || reference == null || reference === 0) return null;
  return Math.round(((actuel / reference) - 1) * 10000) / 100;
}

/** Performances en % au `jour` : séance précédente, 7 jours, 1 mois, depuis le 1er janvier. */
export function performances(serie, jour) {
  const i = indexAu(serie, jour);
  if (i === -1) return null;
  const { jour: seance, cloture } = serie[i];
  return {
    seance,
    cloture,
    variations: {
      jour: variation(cloture, serie[i - 1]?.cloture),
      semaine: variation(cloture, clotureAu(serie, ajouterJours(seance, -7))),
      mois: variation(cloture, clotureAu(serie, moisPrecedent(seance))),
      debut_annee: variation(cloture, clotureAu(serie, finAnneePrecedente(seance))),
    },
  };
}

/** Regroupe des cours journaliers par semaine (1wk) ou par mois (1mo). */
export function agreger(serie, intervalle) {
  if (intervalle === '1d') return serie;
  const cle = intervalle === '1wk' ? (j) => lundi(j) : (j) => `${j.slice(0, 7)}-01`;
  const groupes = [];
  for (const c of serie) {
    const k = cle(c.jour);
    const g = groupes.at(-1);
    if (g?.jour === k) {
      g.haut = Math.max(g.haut ?? c.haut, c.haut ?? g.haut);
      g.bas = Math.min(g.bas ?? c.bas, c.bas ?? g.bas);
      g.cloture = c.cloture;
      g.cloture_ajustee = c.cloture_ajustee;
      g.volume = Number(g.volume ?? 0) + Number(c.volume ?? 0);
    } else {
      groupes.push({ ...c, jour: k });
    }
  }
  return groupes;
}

/**
 * Rejoue les opérations (triées par jour) jusqu'au `jour` inclus.
 * Retourne une Map "compte|symbole" → { compte, symbole, quantite, pru, dividendes, plus_value_realisee }.
 * PRU = prix de revient unitaire, frais d'achat inclus, dans la devise de l'instrument.
 */
export function rejouerOperations(operations, jour = '9999-12-31') {
  const positions = new Map();
  for (const op of operations) {
    if (op.jour > jour) break;
    const cle = `${op.compte}|${op.symbole}`;
    let p = positions.get(cle);
    if (!p) {
      p = { compte: op.compte, symbole: op.symbole, quantite: 0, pru: 0, dividendes: 0, plus_value_realisee: 0 };
      positions.set(cle, p);
    }
    appliquer(p, op);
  }
  return positions;
}

function appliquer(p, op) {
  if (op.type === 'achat') {
    const cout = p.quantite * p.pru + op.quantite * op.prix + op.frais;
    p.quantite += op.quantite;
    p.pru = p.quantite > 0 ? cout / p.quantite : 0;
  } else if (op.type === 'vente') {
    p.plus_value_realisee += op.quantite * (op.prix - p.pru) - op.frais;
    p.quantite -= op.quantite;
    // Arrondis flottants : une position soldée doit retomber à zéro
    if (Math.abs(p.quantite) < 1e-9) { p.quantite = 0; p.pru = 0; }
  } else if (op.type === 'dividende') {
    p.dividendes += op.montant;
  }
}

/**
 * Valorisation quotidienne en euros entre `du` et `au` (jours calendaires, dernier cours connu
 * reporté les jours sans séance).
 * - operations : triées par jour
 * - instruments : Map symbole → { devise }
 * - series : Map symbole → série de cours (instruments et paires de change EURXXX=X)
 */
export function valorisation({ operations, instruments, series, du, au }) {
  const points = [];
  let iop = 0;
  const positions = new Map();
  let investiNet = 0;

  for (let jour = du; jour <= au; jour = ajouterJours(jour, 1)) {
    // Opérations du jour (et toutes celles d'avant au premier tour)
    while (iop < operations.length && operations[iop].jour <= jour) {
      const op = operations[iop++];
      const cle = `${op.compte}|${op.symbole}`;
      if (!positions.has(cle)) {
        positions.set(cle, { compte: op.compte, symbole: op.symbole, quantite: 0, pru: 0, dividendes: 0, plus_value_realisee: 0 });
      }
      appliquer(positions.get(cle), op);
      investiNet += fluxEuros(op, instruments, series) ?? 0;
    }

    let total = 0;
    let incomplet = false;
    const parCompte = {};
    for (const p of positions.values()) {
      if (p.quantite === 0) continue;
      const valeur = valeurEuros(p.symbole, p.quantite, jour, instruments, series);
      if (valeur == null) { incomplet = true; continue; }
      total += valeur;
      parCompte[p.compte] = arrondi((parCompte[p.compte] ?? 0) + valeur);
    }
    points.push({ jour, valeur: arrondi(total), investi_net: arrondi(investiNet), par_compte: parCompte, ...(incomplet && { incomplet: true }) });
  }
  return points;
}

/** Argent apporté (+) ou retiré (-) par une opération, en euros au taux du jour de l'opération. */
function fluxEuros(op, instruments, series) {
  const devise = instruments.get(op.symbole)?.devise ?? 'EUR';
  const taux = tauxAu(devise, op.jour, series);
  if (op.type === 'achat') return versEuros(op.quantite * op.prix + op.frais, devise, taux);
  if (op.type === 'vente') return -versEuros(op.quantite * op.prix - op.frais, devise, taux);
  return 0;
}

export function valeurEuros(symbole, quantite, jour, instruments, series) {
  const cours = clotureAu(series.get(symbole) ?? [], jour);
  if (cours == null) return null;
  const devise = instruments.get(symbole)?.devise ?? 'EUR';
  return versEuros(quantite * cours, devise, tauxAu(devise, jour, series));
}

function tauxAu(devise, jour, series) {
  const paire = symboleChange(devise);
  return paire ? clotureAu(series.get(paire) ?? [], jour) : null;
}

export function arrondi(n, decimales = 2) {
  const f = 10 ** decimales;
  return Math.round(n * f) / f;
}

// --- Intraday ---
// Une série de prix intraday est un tableau [{ t, cloture }] trié par t (millisecondes) : t est
// l'instant à partir duquel le prix est connu.

/**
 * Fusionne les barres intraday (connues à la fin de la barre) et les clôtures journalières
 * (connues à minuit le lendemain dans le fuseau de la place). Au-delà de 2 ans, ou pour un
 * instrument sans intraday, la valorisation retombe ainsi sur la clôture de la veille.
 */
export function fusionnerPrix(barres, journaliers, fuseau) {
  const prix = [
    ...barres.map((b) => ({ t: new Date(b.horodatage).getTime() + b.intervalle * 60000, cloture: b.cloture })),
    ...journaliers.map((c) => ({ t: minuitLocal(ajouterJours(c.jour, 1), fuseau).getTime(), cloture: c.cloture })),
  ];
  return prix.sort((a, b) => a.t - b.t);
}

export function prixAu(serie, t) {
  let bas = 0;
  let haut = serie.length - 1;
  let trouve = null;
  while (bas <= haut) {
    const milieu = (bas + haut) >> 1;
    if (serie[milieu].t <= t) { trouve = serie[milieu].cloture; bas = milieu + 1; } else { haut = milieu - 1; }
  }
  return trouve;
}

/**
 * Valorisation en euros à chaque instant de `instants` (millisecondes, croissants).
 * Une opération du jour J compte à partir de minuit (heure de Paris) le jour J.
 * - prix : Map symbole → série fusionnée (instruments et paires de change)
 * - series : Map symbole → série journalière, pour convertir les flux au taux du jour
 */
export function valorisationIntraday({ operations, instruments, prix, series, instants, fuseau = 'Europe/Paris' }) {
  const debuts = operations.map((op) => minuitLocal(op.jour, fuseau).getTime());
  const positions = new Map();
  const points = [];
  let iop = 0;
  let investiNet = 0;

  for (const t of instants) {
    while (iop < operations.length && debuts[iop] <= t) {
      const op = operations[iop++];
      const cle = `${op.compte}|${op.symbole}`;
      if (!positions.has(cle)) {
        positions.set(cle, { compte: op.compte, symbole: op.symbole, quantite: 0, pru: 0, dividendes: 0, plus_value_realisee: 0 });
      }
      appliquer(positions.get(cle), op);
      investiNet += fluxEuros(op, instruments, series) ?? 0;
    }

    let total = 0;
    let incomplet = false;
    const parCompte = {};
    for (const p of positions.values()) {
      if (p.quantite === 0) continue;
      const cours = prixAu(prix.get(p.symbole) ?? [], t);
      const devise = instruments.get(p.symbole)?.devise ?? 'EUR';
      const paire = symboleChange(devise);
      const valeur = cours == null ? null : versEuros(p.quantite * cours, devise, paire ? prixAu(prix.get(paire) ?? [], t) : null);
      if (valeur == null) { incomplet = true; continue; }
      total += valeur;
      parCompte[p.compte] = arrondi((parCompte[p.compte] ?? 0) + valeur);
    }
    points.push({ horodatage: new Date(t).toISOString(), valeur: arrondi(total), investi_net: arrondi(investiNet), par_compte: parCompte, ...(incomplet && { incomplet: true }) });
  }
  return points;
}

/** Regroupe des barres intraday en barres de `minutes` (les barres déjà aussi longues passent telles quelles). */
export function agregerIntraday(barres, minutes) {
  const pas = minutes * 60000;
  const groupes = [];
  for (const b of barres) {
    const debut = new Date(b.horodatage).getTime();
    if (b.intervalle >= minutes) { groupes.push({ ...b, horodatage: new Date(debut).toISOString() }); continue; }
    const cle = new Date(Math.floor(debut / pas) * pas).toISOString();
    const g = groupes.at(-1);
    if (g?.horodatage === cle && g.intervalle === minutes) {
      g.haut = Math.max(g.haut ?? b.haut, b.haut ?? g.haut);
      g.bas = Math.min(g.bas ?? b.bas, b.bas ?? g.bas);
      g.cloture = b.cloture;
      g.volume = Number(g.volume ?? 0) + Number(b.volume ?? 0);
    } else {
      groupes.push({ ...b, horodatage: cle, intervalle: minutes });
    }
  }
  return groupes;
}
