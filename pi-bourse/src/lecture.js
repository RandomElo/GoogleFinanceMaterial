import { Op, fn, col } from 'sequelize';
import { ajouterJours, minuitLocal } from './dates.js';
import { symboleChange, versEuros } from './devises.js';
import { agreger, agregerIntraday, arrondi, clotureAu, fusionnerPrix, performances, rejouerOperations, valorisation, valorisationIntraday } from './calculs.js';

// Lectures en base pour les endpoints. Les calculs eux-mêmes sont dans calculs.js.

// Marge avant la date demandée : dernier cours connu (week-end, fériés) et variation sur 1 mois
const MARGE_JOURS = 40;
const ATTRIBUTS_COURS = ['jour', 'ouverture', 'haut', 'bas', 'cloture', 'cloture_ajustee', 'volume'];
const ATTRIBUTS_OPERATION = ['id', 'jour', 'compte', 'type', 'symbole', 'nom', 'quantite', 'prix', 'courtage', 'ttf', 'frais', 'montant', 'onglet_source', 'ligne_source'];

const pct = (part, total) => (total ? arrondi((part / total) * 100) : null);
// pg renvoie les BIGINT en chaînes (ils peuvent dépasser la précision d'un nombre JS) ;
// un volume tient largement dans un nombre, et "1" + "2" donnerait "12" à l'agrégation
const volumeEnNombre = (c) => ({ ...c, volume: c.volume == null ? null : Number(c.volume) });

export function creerLecture(bdd) {
  const { Instrument, CoursJournalier, CoursIntraday, Operation } = bdd;

  async function instruments() {
    return Instrument.findAll({ order: [['symbole', 'ASC']] });
  }

  /** Fiche d'un instrument avec l'étendue de son historique et son dernier cours. null si non suivi. */
  async function instrument(symbole) {
    const i = await Instrument.findOne({ where: { symbole } });
    if (!i) return null;
    const [stats] = await CoursJournalier.findAll({
      where: { instrument_id: i.id },
      attributes: [[fn('MIN', col('jour')), 'premier_jour'], [fn('MAX', col('jour')), 'dernier_jour'], [fn('COUNT', col('jour')), 'seances']],
      raw: true,
    });
    const dernier = await CoursJournalier.findOne({ where: { instrument_id: i.id }, attributes: ATTRIBUTS_COURS, order: [['jour', 'DESC']], raw: true });
    return { ...i.toJSON(), historique: { ...stats, seances: Number(stats.seances) }, dernier_cours: dernier && volumeEnNombre(dernier) };
  }

  async function instrumentsParSymbole(symboles) {
    const liste = await Instrument.findAll({ where: { symbole: symboles } });
    return new Map(liste.map((i) => [i.symbole, i]));
  }

  async function serie(instrumentId, debut, fin) {
    const lignes = await CoursJournalier.findAll({
      where: { instrument_id: instrumentId, jour: { [Op.between]: [debut, fin] } },
      attributes: ATTRIBUTS_COURS,
      order: [['jour', 'ASC']],
      raw: true,
    });
    return lignes.map(volumeEnNombre);
  }

  async function series(symboles, debut, fin) {
    const parSymbole = await instrumentsParSymbole(symboles);
    const resultat = new Map();
    for (const [symbole, i] of parSymbole) resultat.set(symbole, await serie(i.id, debut, fin));
    return resultat;
  }

  async function cours(symbole, { debut, fin, intervalle }) {
    const i = await Instrument.findOne({ where: { symbole } });
    if (!i) return null;
    return { symbole, nom: i.nom, devise: i.devise, debut, fin, intervalle, cours: agreger(await serie(i.id, debut, fin), intervalle) };
  }

  async function performancesAu(symboles, jour) {
    // Il faut remonter jusqu'au 31/12 de l'année précédente pour la performance annuelle
    const debut = `${Number(jour.slice(0, 4)) - 1}-12-01`;
    const parSymbole = await instrumentsParSymbole(symboles);
    const resultats = [];
    for (const symbole of symboles) {
      const i = parSymbole.get(symbole);
      if (!i) { resultats.push({ symbole, erreur: 'Instrument non suivi' }); continue; }
      const perf = performances(await serie(i.id, debut, jour), jour);
      resultats.push(perf ? { symbole, nom: i.nom, devise: i.devise, ...perf } : { symbole, erreur: 'Aucun cours à cette date' });
    }
    return resultats;
  }

  /** Opérations filtrées, triées par jour croissant. */
  async function operations({ compte, symbole, type, du, au } = {}) {
    const jour = {};
    if (du) jour[Op.gte] = du;
    if (au) jour[Op.lte] = au;
    return Operation.findAll({
      where: {
        ...(compte && { compte }),
        ...(symbole && { symbole }),
        ...(type && { type }),
        ...((du || au) && { jour }),
      },
      attributes: ATTRIBUTS_OPERATION,
      order: [['jour', 'ASC'], ['id', 'ASC']],
      raw: true,
    });
  }

  /** Dividendes avec totaux par année, par instrument et par compte. */
  async function dividendes({ annee, symbole, compte } = {}) {
    const liste = await operations({
      type: 'dividende', symbole, compte,
      ...(annee && { du: `${annee}-01-01`, au: `${annee}-12-31` }),
    });
    const parAnnee = {};
    const parSymbole = {};
    const parCompte = {};
    let total = 0;
    for (const d of liste) {
      total += d.montant;
      const a = d.jour.slice(0, 4);
      parAnnee[a] = arrondi((parAnnee[a] ?? 0) + d.montant);
      parSymbole[d.symbole] = arrondi((parSymbole[d.symbole] ?? 0) + d.montant);
      parCompte[d.compte] = arrondi((parCompte[d.compte] ?? 0) + d.montant);
    }
    return { total: arrondi(total), par_annee: parAnnee, par_symbole: parSymbole, par_compte: parCompte, dividendes: liste };
  }

  /** Instruments et séries nécessaires pour valoriser des opérations (paires de change comprises). */
  async function donneesValorisation(ops, debut, fin) {
    const symboles = [...new Set(ops.map((o) => o.symbole))];
    const parSymbole = await instrumentsParSymbole(symboles);
    const paires = [...new Set([...parSymbole.values()].map((i) => symboleChange(i.devise)).filter(Boolean))];
    return { instruments: parSymbole, series: await series([...symboles, ...paires], debut, fin) };
  }

  /**
   * Positions à une date, avec les totaux du portefeuille.
   * soldees : inclure les positions entièrement vendues (utiles pour leur plus-value réalisée).
   */
  async function positionsAu(jour, { compte, soldees = false } = {}) {
    const ops = await operations({ au: jour, compte });
    const vide = { jour, devise: 'EUR', totaux: totaux([]), par_compte: {}, positions: [] };
    if (!ops.length) return vide;
    const { instruments: parSymbole, series: s } = await donneesValorisation(ops, ajouterJours(jour, -MARGE_JOURS), jour);
    const taux = (devise) => {
      const paire = symboleChange(devise);
      return paire ? clotureAu(s.get(paire) ?? [], jour) : null;
    };

    const toutes = [];
    for (const p of rejouerOperations(ops, jour).values()) {
      const i = parSymbole.get(p.symbole);
      const devise = i?.devise ?? 'EUR';
      const serieSymbole = s.get(p.symbole) ?? [];
      const perf = performances(serieSymbole, jour);
      const coursAu = perf?.cloture ?? null;
      const investi = p.quantite * p.pru;
      const valeur = coursAu == null ? null : p.quantite * coursAu;
      const enEuros = (montant) => (montant == null ? null : versEuros(montant, devise, taux(devise)));
      toutes.push({
        compte: p.compte,
        symbole: p.symbole,
        nom: i?.nom ?? null,
        devise,
        quantite: p.quantite,
        pru: arrondi(p.pru, 4),
        cours: coursAu,
        date_cours: perf?.seance ?? null,
        investi: arrondi(investi),
        valeur: valeur == null ? null : arrondi(valeur),
        valeur_eur: valeur == null ? null : arrondi(enEuros(valeur)),
        plus_value_latente: valeur == null ? null : arrondi(valeur - investi),
        plus_value_latente_eur: valeur == null ? null : arrondi(enEuros(valeur - investi)),
        rendement_pct: valeur == null ? null : pct(valeur - investi, investi),
        plus_value_realisee: arrondi(p.plus_value_realisee),
        plus_value_realisee_eur: arrondi(enEuros(p.plus_value_realisee) ?? 0),
        dividendes: arrondi(p.dividendes),
        dividendes_eur: arrondi(enEuros(p.dividendes) ?? 0),
        investi_eur: arrondi(enEuros(investi) ?? 0),
        variations: perf ? { jour: perf.variations.jour, semaine: perf.variations.semaine, mois: perf.variations.mois } : null,
      });
    }

    const ouvertes = toutes.filter((p) => p.quantite > 0);
    const total = totaux(toutes);
    for (const p of ouvertes) p.repartition_pct = pct(p.valeur_eur ?? 0, total.valeur);

    const parCompte = {};
    for (const c of [...new Set(toutes.map((p) => p.compte))].sort()) {
      parCompte[c] = totaux(toutes.filter((p) => p.compte === c));
      parCompte[c].repartition_pct = pct(parCompte[c].valeur, total.valeur);
    }
    return {
      jour,
      devise: 'EUR',
      totaux: total,
      par_compte: parCompte,
      positions: (soldees ? toutes : ouvertes).sort((a, b) => (b.valeur_eur ?? 0) - (a.valeur_eur ?? 0)),
    };
  }

  async function valorisationEntre(du, au, { compte } = {}) {
    const ops = await operations({ au, compte });
    if (!ops.length) return { devise: 'EUR', du, au, points: [] };
    // Les flux sont convertis au taux du jour de l'opération : séries depuis la première opération
    const debut = [ops[0].jour, ajouterJours(du, -MARGE_JOURS)].sort()[0];
    const { instruments: parSymbole, series: s } = await donneesValorisation(ops, debut, au);
    return { devise: 'EUR', du, au, points: valorisation({ operations: ops, instruments: parSymbole, series: s, du, au }) };
  }

  async function barresIntraday(instrumentId, debut, fin) {
    const lignes = await CoursIntraday.findAll({
      where: { instrument_id: instrumentId, horodatage: { [Op.gte]: debut, [Op.lt]: fin } },
      attributes: ['horodatage', 'intervalle', 'ouverture', 'haut', 'bas', 'cloture', 'volume'],
      order: [['horodatage', 'ASC']],
      raw: true,
    });
    return lignes.map(volumeEnNombre);
  }

  /** Barres intraday entre minuit (Paris) le jour `du` et minuit le lendemain de `au`. null si non suivi. */
  async function coursIntraday(symbole, { du, au, minutes }) {
    const i = await Instrument.findOne({ where: { symbole } });
    if (!i) return null;
    const barres = await barresIntraday(i.id, minuitLocal(du), minuitLocal(ajouterJours(au, 1)));
    return {
      symbole, nom: i.nom, devise: i.devise, du, au, intervalle: minutes,
      cours: agregerIntraday(barres, minutes),
    };
  }

  /** Valorisation toutes les `minutes` entre minuit le jour `du` et la fin de `au` (ou maintenant). */
  async function valorisationIntradayEntre(du, au, { minutes, compte }) {
    const debut = minuitLocal(du).getTime();
    const fin = Math.min(minuitLocal(ajouterJours(au, 1)).getTime(), Date.now());
    const pas = minutes * 60000;
    const instants = [];
    for (let t = debut + pas; t <= fin; t += pas) instants.push(t);

    const ops = await operations({ au, compte });
    if (!ops.length || !instants.length) return { devise: 'EUR', du, au, intervalle: minutes, points: [] };

    const debutJour = [ops[0].jour, ajouterJours(du, -MARGE_JOURS)].sort()[0];
    const { instruments: parSymbole, series: s } = await donneesValorisation(ops, debutJour, au);
    // Barres intraday depuis la veille : le premier point a besoin du dernier prix connu
    const debutBarres = new Date(debut - 24 * 60 * 60 * 1000);
    const prix = new Map();
    for (const [symbole, serieJour] of s) {
      const i = parSymbole.get(symbole) ?? await Instrument.findOne({ where: { symbole } });
      const barres = i ? await barresIntraday(i.id, debutBarres, new Date(fin)) : [];
      prix.set(symbole, fusionnerPrix(barres, serieJour, i?.fuseau ?? 'Europe/Paris'));
    }
    return {
      devise: 'EUR', du, au, intervalle: minutes,
      points: valorisationIntraday({ operations: ops, instruments: parSymbole, prix, series: s, instants }),
    };
  }

  return { instruments, instrument, cours, coursIntraday, performancesAu, operations, dividendes, positionsAu, valorisationEntre, valorisationIntradayEntre };
}

/** Totaux en euros d'un ensemble de positions (comme l'onglet Accueil du Sheet). */
export function totaux(positions) {
  const somme = (champ) => arrondi(positions.reduce((t, p) => t + (p[champ] ?? 0), 0));
  const valeur = somme('valeur_eur');
  const investi = somme('investi_eur');
  const latente = somme('plus_value_latente_eur');
  const realisee = somme('plus_value_realisee_eur');
  const dividendes = somme('dividendes_eur');
  const benefice = arrondi(latente + realisee + dividendes);
  return {
    valeur,
    investi,
    plus_value_latente: latente,
    plus_value_realisee: realisee,
    dividendes,
    benefice_total: benefice,
    rendement_pct: pct(benefice, investi),
    // Une position sans cours (historique pas encore chargé) n'est pas comptée dans la valeur
    ...(positions.some((p) => p.quantite > 0 && p.valeur_eur == null) && { incomplet: true }),
  };
}
