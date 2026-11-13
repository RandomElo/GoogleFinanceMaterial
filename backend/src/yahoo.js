import YahooFinance from 'yahoo-finance2';
import { jourDansFuseau } from './dates.js';

// Seul module qui parle à Yahoo : si Yahoo change, c'est ici qu'on corrige.

export function creerYahoo({ cacheSecondes = 300 } = {}) {
  const yf = new YahooFinance({
    suppressNotices: ['yahooSurvey'],
    // Requêtes une par une et espacées : on reste discret pour ne pas se faire bloquer
    queue: { concurrency: 1, interval: 500 },
  });
  const cache = new Map();
  const cacheRecherches = new Map();

  /** Fiche d'un symbole pour l'ajouter en base, ou null s'il n'existe pas chez Yahoo. */
  async function decrire(symbole) {
    const [q] = await yf.quote([symbole]);
    if (!q) return null;
    return {
      symbole: q.symbol,
      nom: q.longName ?? q.shortName ?? q.symbol,
      type: q.quoteType,
      devise: q.currency ?? 'EUR',
      fuseau: q.exchangeTimezoneName ?? 'Europe/Paris',
    };
  }

  /** Cours journaliers depuis `debut` (AAAA-MM-JJ), datés dans le fuseau de la place. */
  async function historique(symbole, debut, fuseau) {
    const { quotes } = await yf.chart(symbole, { period1: debut, interval: '1d' });
    return quotes
      // Séance sans clôture (jour férié mal renseigné, séance en cours) : rien à stocker
      .filter((q) => q.close != null)
      .map((q) => ({
        jour: jourDansFuseau(q.date, fuseau),
        ouverture: q.open,
        haut: q.high,
        bas: q.low,
        cloture: q.close,
        cloture_ajustee: q.adjclose ?? q.close,
        volume: q.volume,
      }));
  }

  /**
   * Barres intraday depuis `debut` (Date). Yahoo limite la profondeur : 60 jours en 15 min,
   * 730 jours en 1 h. La barre en cours est renvoyée par Yahoo avec un horodatage non aligné
   * (ex. 20:53:59) : elle est écartée, la barre complète arrivera au passage suivant.
   */
  async function intraday(symbole, debut, minutes) {
    const { quotes } = await yf.chart(symbole, { period1: debut, interval: minutes === 60 ? '1h' : `${minutes}m` });
    const pas = minutes * 60 * 1000;
    return quotes
      .filter((q) => q.close != null && q.date.getTime() % pas === 0)
      .map((q) => ({
        horodatage: q.date,
        intervalle: minutes,
        ouverture: q.open,
        haut: q.high,
        bas: q.low,
        cloture: q.close,
        volume: q.volume,
      }));
  }

  /** Cotations du moment, avec un cache mémoire de quelques minutes par symbole. */
  async function cotations(symboles) {
    const maintenant = Date.now();
    const manquants = symboles.filter((s) => !(cache.get(s)?.expire > maintenant));
    if (manquants.length) {
      const resultats = await yf.quote(manquants);
      for (const q of resultats) {
        cache.set(q.symbol, {
          expire: maintenant + cacheSecondes * 1000,
          donnees: {
            symbole: q.symbol,
            nom: q.longName ?? q.shortName ?? q.symbol,
            prix: q.regularMarketPrice ?? null,
            variation: q.regularMarketChange ?? null,
            variation_pct: q.regularMarketChangePercent ?? null,
            devise: q.currency ?? null,
            etat_marche: q.marketState ?? null,
            heure: q.regularMarketTime ?? null,
          },
        });
      }
    }
    return symboles.map((s) => cache.get(s)?.donnees).filter(Boolean);
  }

  /**
   * Symboles Yahoo correspondant à un nom, un ISIN ou un début de symbole, pour trouver quoi
   * ajouter avec POST /instruments. Résultats hors Yahoo (Crunchbase…) écartés.
   */
  async function rechercher(texte) {
    const cle = texte.toLowerCase();
    const maintenant = Date.now();
    const enCache = cacheRecherches.get(cle);
    if (enCache?.expire > maintenant) return enCache.donnees;
    const { quotes } = await yf.search(texte, { quotesCount: 15, newsCount: 0 });
    const donnees = quotes
      .filter((q) => q.isYahooFinance)
      .map((q) => ({
        symbole: q.symbol,
        nom: q.longname ?? q.shortname ?? q.symbol,
        type: q.quoteType,
        place: q.exchDisp ?? q.exchange ?? null,
      }));
    cacheRecherches.set(cle, { expire: maintenant + cacheSecondes * 1000, donnees });
    // Borne la mémoire : les recherches sont libres, contrairement aux symboles
    if (cacheRecherches.size > 500) cacheRecherches.delete(cacheRecherches.keys().next().value);
    return donnees;
  }

  return { decrire, historique, intraday, cotations, rechercher };
}
