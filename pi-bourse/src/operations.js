import fs from 'node:fs';
import { GoogleAuth } from 'google-auth-library';
import { estJourValide } from './dates.js';

// Synchronisation des opérations depuis le Google Sheet "Bourse", avec un compte de service
// Google en lecture seule. Le Sheet fait foi : chaque synchro remplace toute la table.
//
// Deux onglets sont lus :
// - "Historique d'opérations" : achats et ventes. La ligne 1 regroupe les colonnes
//   ("Données à renseigner", "Calcul intermédiaire"…), les vrais en-têtes sont en ligne 2.
//   Seules les colonnes saisies à la main sont importées : les colonnes calculées par le Sheet
//   (PRU, bénéfice, flat tax…) dépendent du cours du jour et sont recalculées par l'API.
// - "Dividendes" : sans ticker ni compte, retrouvés par le nom de l'instrument.

const TYPES = { achat: 'achat', vente: 'vente', dividende: 'dividende', dividendes: 'dividende' };

// En-têtes reconnus (sans accents ni ponctuation, en minuscules) → champ
const COLONNES_OPERATIONS = {
  nom: 'nom',
  'ticker yahoo': 'symbole', symbole: 'symbole',
  type: 'type', operation: 'type',
  nombre: 'quantite', quantite: 'quantite',
  date: 'jour', jour: 'jour',
  'prix u achat': 'prix', 'prix unitaire': 'prix', prix: 'prix',
  'taxe brocker': 'courtage', 'taxe broker': 'courtage', courtage: 'courtage',
  ttf: 'ttf',
  portefeuille: 'compte', compte: 'compte',
};
const COLONNES_DIVIDENDES = {
  nom: 'nom',
  date: 'jour',
  'nombre d actions': 'quantite',
  'montant unitaire': 'unitaire',
  'montant total': 'montant',
};

export function normaliser(texte) {
  return String(texte ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** "15/03/2024", "2024-03-15" → "2024-03-15", ou null. */
export function lireJour(valeur) {
  const texte = String(valeur ?? '').trim();
  const fr = texte.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  const jour = fr ? `${fr[3]}-${fr[2].padStart(2, '0')}-${fr[1].padStart(2, '0')}` : texte;
  return estJourValide(jour) ? jour : null;
}

/** 12.5, "12,50 €", "1 954,49" → nombre ; vide → 0 ; illisible → NaN. */
export function lireNombre(valeur) {
  if (valeur === '' || valeur == null) return 0;
  if (typeof valeur === 'number') return valeur;
  const n = Number(String(valeur).replace(/[\s  €%]/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Trouve la ligne d'en-têtes parmi les premières lignes (celle qui contient toutes les colonnes
 * requises) et renvoie { indexEntetes, champs } où champs[j] est le champ de la colonne j.
 * En cas de doublon (deux colonnes "Nom"), la première l'emporte.
 */
export function trouverEntetes(lignes, colonnes, requis) {
  for (let i = 0; i < Math.min(lignes.length, 5); i++) {
    const champs = [];
    const vus = new Set();
    for (const entete of lignes[i]) {
      const champ = colonnes[normaliser(entete)];
      champs.push(champ && !vus.has(champ) ? champ : undefined);
      if (champ) vus.add(champ);
    }
    if (requis.every((r) => vus.has(r))) return { indexEntetes: i, champs };
  }
  throw new Error(`En-têtes introuvables (colonnes attendues : ${requis.join(', ')})`);
}

function lignesDeDonnees(lignes, colonnes, requis) {
  const { indexEntetes, champs } = trouverEntetes(lignes, colonnes, requis);
  const resultat = [];
  lignes.slice(indexEntetes + 1).forEach((ligne, i) => {
    const brut = {};
    champs.forEach((champ, j) => { if (champ) brut[champ] = ligne[j]; });
    // Ligne vide, ou ligne de total en bas d'onglet (aucune colonne requise remplie)
    if (requis.every((r) => String(brut[r] ?? '').trim() === '')) return;
    resultat.push({ brut, numero: indexEntetes + i + 2 });
  });
  return resultat;
}

/** Onglet "Historique d'opérations" → { operations, erreurs }. */
export function analyserOperations(lignes, onglet = "Historique d'opérations") {
  const operations = [];
  const erreurs = [];
  for (const { brut, numero } of lignesDeDonnees(lignes, COLONNES_OPERATIONS, ['symbole', 'type', 'quantite', 'jour', 'compte'])) {
    const courtage = lireNombre(brut.courtage);
    const ttf = lireNombre(brut.ttf);
    const op = {
      jour: lireJour(brut.jour),
      compte: String(brut.compte ?? '').trim(),
      type: TYPES[normaliser(brut.type)],
      symbole: String(brut.symbole ?? '').trim().toUpperCase(),
      nom: String(brut.nom ?? '').replace(/\s+/g, ' ').trim() || null,
      quantite: lireNombre(brut.quantite),
      prix: lireNombre(brut.prix),
      courtage,
      ttf,
      frais: courtage + ttf,
      montant: 0,
      onglet_source: onglet,
      ligne_source: numero,
    };
    const probleme =
      !op.jour ? `date invalide "${brut.jour}"`
      : !op.compte ? 'portefeuille vide'
      : !op.type || op.type === 'dividende' ? `type inconnu "${brut.type}" (Achat ou Vente)`
      : !op.symbole ? 'ticker Yahoo vide'
      : [op.quantite, op.prix, op.frais].some(Number.isNaN) ? 'nombre illisible'
      : op.quantite <= 0 ? 'quantité nulle'
      : null;
    if (probleme) erreurs.push(`${onglet}, ligne ${numero} : ${probleme}`);
    else operations.push(op);
  }
  return { operations, erreurs };
}

/**
 * Onglet "Dividendes" → { operations, erreurs }. Le symbole et le compte sont ceux du dernier
 * achat ou vente du même nom avant la date du dividende.
 */
export function analyserDividendes(lignes, operations, onglet = 'Dividendes') {
  const parNom = new Map();
  for (const op of [...operations].sort((a, b) => a.jour.localeCompare(b.jour))) {
    if (!op.nom) continue;
    const cle = normaliser(op.nom);
    if (!parNom.has(cle)) parNom.set(cle, []);
    parNom.get(cle).push(op);
  }

  const dividendes = [];
  const erreurs = [];
  for (const { brut, numero } of lignesDeDonnees(lignes, COLONNES_DIVIDENDES, ['nom', 'jour'])) {
    const jour = lireJour(brut.jour);
    const quantite = lireNombre(brut.quantite);
    const unitaire = lireNombre(brut.unitaire);
    const total = lireNombre(brut.montant);
    const montant = total || quantite * unitaire;
    const historique = parNom.get(normaliser(brut.nom)) ?? [];
    const reference = historique.filter((o) => jour && o.jour <= jour).at(-1) ?? historique[0];

    const probleme =
      !jour ? `date invalide "${brut.jour}"`
      : [quantite, unitaire, total].some(Number.isNaN) ? 'nombre illisible'
      : !montant ? 'montant vide'
      : !reference ? `"${brut.nom}" introuvable dans l'historique d'opérations`
      : null;
    if (probleme) { erreurs.push(`${onglet}, ligne ${numero} : ${probleme}`); continue; }
    dividendes.push({
      jour,
      compte: reference.compte,
      type: 'dividende',
      symbole: reference.symbole,
      nom: reference.nom,
      quantite,
      prix: unitaire,
      courtage: 0,
      ttf: 0,
      frais: 0,
      montant,
      onglet_source: onglet,
      ligne_source: numero,
    });
  }
  return { operations: dividendes, erreurs };
}

export function creerSynchroOperations({ bdd, chargement, google, log = console.log }) {
  // La clé du compte de service arrive plus tard : sans elle, l'API tourne sans synchro
  const active = Boolean(google.sheetId) && fs.existsSync(google.fichierCompteService);
  let derniere = null;
  let client = null;

  async function lireOnglet(onglet) {
    if (!client) {
      const credentials = JSON.parse(fs.readFileSync(google.fichierCompteService, 'utf8'));
      client = await new GoogleAuth({ credentials, scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'] }).getClient();
    }
    const plage = `'${onglet.replace(/'/g, "''")}'!A1:Z`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(google.sheetId)}/values/${encodeURIComponent(plage)}`
      + '?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING';
    const { data } = await client.request({ url });
    return data.values ?? [];
  }

  async function synchroniser() {
    if (!active) throw new Error('Synchronisation Google Sheet non configurée (clé du compte de service absente ou GOOGLE_SHEET_ID vide)');
    const debut = new Date();
    try {
      const ops = analyserOperations(await lireOnglet(google.ongletOperations), google.ongletOperations);
      const div = analyserDividendes(await lireOnglet(google.ongletDividendes), ops.operations, google.ongletDividendes);
      const operations = [...ops.operations, ...div.operations];
      const erreurs = [...ops.erreurs, ...div.erreurs];

      await bdd.sequelize.transaction(async (transaction) => {
        await bdd.Operation.destroy({ where: {}, transaction });
        await bdd.Operation.bulkCreate(operations, { transaction });
      });

      // Un symbole acheté mais pas encore suivi : on l'ajoute pour pouvoir le valoriser
      const inconnus = [];
      for (const symbole of new Set(operations.map((o) => o.symbole))) {
        if (!(await chargement.ajouterInstrument(symbole))) inconnus.push(symbole);
      }
      if (inconnus.length) erreurs.push(`symboles inconnus de Yahoo : ${inconnus.join(', ')}`);

      derniere = {
        date: debut.toISOString(),
        ok: true,
        operations: ops.operations.length,
        dividendes: div.operations.length,
        erreurs,
      };
      log(`[operations] ${ops.operations.length} opérations et ${div.operations.length} dividendes synchronisés${erreurs.length ? `, ${erreurs.length} problème(s) : ${erreurs.join(' ; ')}` : ''}`);
    } catch (e) {
      derniere = { date: debut.toISOString(), ok: false, erreurs: [e.message] };
      throw e;
    }
    // Historique des instruments ajoutés par la synchro : hors du résultat, ça peut être long
    chargement.chargerHistoriquesManquants().catch((e) => log(`[chargement] ${e.message}`));
    return derniere;
  }

  return { active, synchroniser, etat: () => ({ active, derniere }) };
}
