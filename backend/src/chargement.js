import { Op } from 'sequelize';
import { ajouterJours, aujourdhui } from './dates.js';
import { symboleChange } from './devises.js';

const CHAMPS_COURS = ['ouverture', 'haut', 'bas', 'cloture', 'cloture_ajustee', 'volume'];
// Yahoo corrige parfois les dernières séances : on recharge 5 séances, soit ~8 jours calendaires
const JOURS_A_RECHARGER = 8;
const CHAMPS_INTRADAY = ['intervalle', 'ouverture', 'haut', 'bas', 'cloture', 'volume'];
const JOUR_MS = 24 * 60 * 60 * 1000;
// Profondeur maximale acceptée par Yahoo, avec un jour de marge
const PROFONDEUR_15M = 59 * JOUR_MS;
const PROFONDEUR_1H = 729 * JOUR_MS;

/** Créneau du chargement quotidien d'après la place de cotation. */
export function creneauCloture({ type, fuseau }) {
  if (type === 'CURRENCY' || type === 'CRYPTOCURRENCY') return 'us';
  return fuseau.startsWith('America/') ? 'us' : 'europe';
}

export function creerChargement({ bdd, yahoo, log = console.log }) {
  const { Instrument, CoursJournalier, CoursIntraday } = bdd;

  async function enregistrer(instrument, cours) {
    if (!cours.length) return 0;
    await CoursJournalier.bulkCreate(
      cours.map((c) => ({ ...c, instrument_id: instrument.id })),
      { updateOnDuplicate: CHAMPS_COURS },
    );
    return cours.length;
  }

  async function chargerDepuis(instrument, debut) {
    const cours = await yahoo.historique(instrument.symbole, debut, instrument.fuseau);
    return enregistrer(instrument, cours);
  }

  async function chargerIntraday(instrument, debut, minutes) {
    const barres = await yahoo.intraday(instrument.symbole, debut, minutes);
    if (!barres.length) return { n: 0 };
    await CoursIntraday.bulkCreate(
      barres.map((b) => ({ ...b, instrument_id: instrument.id })),
      { updateOnDuplicate: CHAMPS_INTRADAY },
    );
    return { n: barres.length, premiere: barres[0].horodatage };
  }

  /**
   * Reprise de l'historique intraday au plus loin que Yahoo le permet : 1 h sur 2 ans, puis
   * 15 min sur les 60 derniers jours. Les barres d'1 h recouvertes par du 15 min sont retirées.
   */
  async function repriseIntraday(instrument) {
    const maintenant = Date.now();
    const horaires = await chargerIntraday(instrument, new Date(maintenant - PROFONDEUR_1H), 60);
    const quarts = await chargerIntraday(instrument, new Date(maintenant - PROFONDEUR_15M), 15);
    if (quarts.premiere) {
      await CoursIntraday.destroy({ where: { instrument_id: instrument.id, intervalle: 60, horodatage: { [Op.gte]: quarts.premiere } } });
    }
    return { horaires: horaires.n, quarts: quarts.n };
  }

  /** Tout l'historique d'un instrument (journalier depuis l'origine, intraday sur 2 ans). */
  async function chargerHistoriqueComplet(instrument) {
    const n = await chargerDepuis(instrument, '1970-01-01');
    let detailIntraday = '';
    try {
      const { horaires, quarts } = await repriseIntraday(instrument);
      detailIntraday = `, ${horaires} barres d'1 h et ${quarts} barres de 15 min`;
    } catch (e) {
      // L'intraday n'est pas indispensable : le cron des 15 minutes rattrapera les 60 derniers jours
      detailIntraday = `, intraday en échec (${e.message})`;
    }
    await instrument.update({ historique_charge: true });
    log(`[chargement] ${instrument.symbole} : historique complet, ${n} séances${detailIntraday}`);
  }

  /**
   * Ajoute un instrument après l'avoir vérifié chez Yahoo. Si sa devise n'est pas l'euro,
   * la paire de change EURXXX=X est ajoutée aussi (nécessaire à la valorisation).
   * Retourne { instrument, cree } ou null si Yahoo ne connaît pas le symbole.
   */
  async function ajouterInstrument(symbole) {
    const existant = await Instrument.findOne({ where: { symbole } });
    if (existant) return { instrument: existant, cree: false };

    const fiche = await yahoo.decrire(symbole);
    if (!fiche) return null;
    const [instrument, cree] = await Instrument.findOrCreate({
      where: { symbole: fiche.symbole },
      defaults: { ...fiche, cloture: creneauCloture(fiche) },
    });

    const paire = symboleChange(fiche.devise);
    if (paire && paire !== fiche.symbole) await ajouterInstrument(paire);
    return { instrument, cree };
  }

  /**
   * Charge l'historique des instruments qui ne l'ont pas encore (ajout récent, crash).
   * Un seul passage à la fois : un appel pendant un passage en cours attend ce passage, qui
   * reprend tant que des instruments ont été ajoutés entre-temps.
   */
  let passageEnCours = null;
  function chargerHistoriquesManquants() {
    passageEnCours ??= (async () => {
      const echecs = new Set();
      for (;;) {
        const instruments = (await Instrument.findAll({ where: { historique_charge: false }, order: [['id', 'ASC']] }))
          .filter((i) => !echecs.has(i.id));
        if (!instruments.length) return;
        for (const instrument of instruments) {
          try {
            await chargerHistoriqueComplet(instrument);
          } catch (e) {
            echecs.add(instrument.id);
            log(`[chargement] ${instrument.symbole} : échec de l'historique complet (${e.message}), nouvel essai au prochain passage`);
          }
        }
      }
    })().finally(() => { passageEnCours = null; });
    return passageEnCours;
  }

  /** Recharge les dernières séances des instruments d'un créneau ("europe", "us" ou tous). */
  async function chargerRecents(cloture) {
    const where = { historique_charge: true, ...(cloture && { cloture }) };
    const instruments = await Instrument.findAll({ where, order: [['id', 'ASC']] });
    const debut = ajouterJours(aujourdhui(), -JOURS_A_RECHARGER);
    let ok = 0;
    const echecs = [];
    for (const instrument of instruments) {
      try {
        await chargerDepuis(instrument, debut);
        ok++;
      } catch (e) {
        echecs.push(`${instrument.symbole} (${e.message})`);
      }
    }
    log(`[chargement] Créneau ${cloture ?? 'tous'} : ${ok}/${instruments.length} instruments à jour${echecs.length ? `, échecs : ${echecs.join(', ')}` : ''}`);
  }

  /**
   * Barres de 15 min depuis la dernière stockée (moins 1 h, pour remplacer les barres corrigées),
   * ou depuis 60 jours si l'instrument n'en a pas encore. Lancé toutes les 15 minutes : rattrape
   * aussi tout seul une coupure du Pi de moins de 60 jours.
   */
  async function chargerIntradayRecents() {
    const instruments = await Instrument.findAll({ where: { historique_charge: true }, order: [['id', 'ASC']] });
    const limite = Date.now() - PROFONDEUR_15M;
    const echecs = [];
    for (const instrument of instruments) {
      try {
        const derniere = await CoursIntraday.max('horodatage', { where: { instrument_id: instrument.id, intervalle: 15 } });
        const debut = Math.max(derniere ? new Date(derniere).getTime() - 60 * 60 * 1000 : 0, limite);
        await chargerIntraday(instrument, new Date(debut), 15);
      } catch (e) {
        echecs.push(`${instrument.symbole} (${e.message})`);
      }
    }
    // Pas de log quand tout va bien : ce serait une ligne toutes les 15 minutes
    if (echecs.length) log(`[intraday] échecs : ${echecs.join(', ')}`);
  }

  /** Reprise complète (script de reprise) : journalier depuis l'origine et intraday sur 2 ans. */
  async function reprendre(instrument) {
    const seances = await chargerDepuis(instrument, '1970-01-01');
    const intraday = await repriseIntraday(instrument);
    await instrument.update({ historique_charge: true });
    return { seances, ...intraday };
  }

  return { ajouterInstrument, chargerHistoriquesManquants, chargerRecents, chargerIntradayRecents, reprendre };
}
