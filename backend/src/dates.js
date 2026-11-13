// Les jours sont manipulés en chaînes "AAAA-MM-JJ" : pas d'heure, pas de fuseau caché.

const FORMAT_JOUR = /^\d{4}-\d{2}-\d{2}$/;

export function estJourValide(jour) {
  if (!FORMAT_JOUR.test(jour)) return false;
  const d = new Date(`${jour}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === jour;
}

/** Jour calendaire d'un instant dans un fuseau donné (ex. date d'une séance à Paris). */
export function jourDansFuseau(date, fuseau) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: fuseau }).format(date);
}

export function aujourdhui(fuseau = 'Europe/Paris') {
  return jourDansFuseau(new Date(), fuseau);
}

export function ajouterJours(jour, n) {
  const d = new Date(`${jour}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Même jour le mois précédent, ramené au dernier jour du mois si besoin (31/03 → 28/02). */
export function moisPrecedent(jour) {
  const [a, m, j] = jour.split('-').map(Number);
  const dernierJour = new Date(Date.UTC(a, m - 1, 0)).getUTCDate();
  const d = new Date(Date.UTC(a, m - 2, Math.min(j, dernierJour)));
  return d.toISOString().slice(0, 10);
}

export function finAnneePrecedente(jour) {
  return `${Number(jour.slice(0, 4)) - 1}-12-31`;
}

/** Lundi de la semaine ISO du jour (clé de regroupement hebdomadaire). */
export function lundi(jour) {
  const d = new Date(`${jour}T00:00:00Z`);
  return ajouterJours(jour, -((d.getUTCDay() + 6) % 7));
}

/** Minuit du `jour` dans le `fuseau`, en instant UTC (Date). */
export function minuitLocal(jour, fuseau = 'Europe/Paris') {
  const approx = new Date(`${jour}T00:00:00Z`);
  return new Date(approx.getTime() - decalageMinutes(approx, fuseau) * 60000);
}

/** Décalage du fuseau par rapport à UTC à cet instant, en minutes (Paris : 60 ou 120). */
function decalageMinutes(date, fuseau) {
  const parties = new Intl.DateTimeFormat('en-US', {
    timeZone: fuseau, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  }).formatToParts(date);
  const v = Object.fromEntries(parties.map((p) => [p.type, Number(p.value)]));
  return (Date.UTC(v.year, v.month - 1, v.day, v.hour, v.minute) - date.getTime()) / 60000;
}
