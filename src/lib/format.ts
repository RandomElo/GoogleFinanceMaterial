const FUSEAU = "Europe/Paris";

const nombres = new Map<string, Intl.NumberFormat>();
function formateur(min: number, max: number, signe = false) {
    const cle = `${min}-${max}-${signe}`;
    let f = nombres.get(cle);
    if (!f) {
        f = new Intl.NumberFormat("fr-FR", {
            minimumFractionDigits: min,
            maximumFractionDigits: max,
            signDisplay: signe ? "exceptZero" : "auto",
        });
        nombres.set(cle, f);
    }
    return f;
}

type Nombre = number | null | undefined;

const vide = (n: Nombre): n is null | undefined => n === null || n === undefined || Number.isNaN(n);

/** Number of decimals that suits a price: 2 in general, more for small values (FX, crypto). */
export function decimales(n: number): number {
    const a = Math.abs(n);
    if (a === 0 || a >= 1) return 2;
    if (a >= 0.01) return 4;
    return 6;
}

export function nombre(n: Nombre, dec = 2): string {
    return vide(n) ? "–" : formateur(dec, dec).format(n);
}

export function prix(n: Nombre): string {
    return vide(n) ? "–" : formateur(decimales(n), decimales(n)).format(n);
}

export function quantite(n: Nombre): string {
    return vide(n) ? "–" : formateur(0, 8).format(n);
}

export function signe(n: Nombre, dec?: number): string {
    if (vide(n)) return "–";
    const d = dec ?? decimales(n);
    return formateur(d, d, true).format(n);
}

export function pct(n: Nombre, avecSigne = true): string {
    return vide(n) ? "–" : `${formateur(2, 2, avecSigne).format(n)} %`;
}

const SYMBOLES_DEVISE: Record<string, string> = { EUR: "€", USD: "$", GBP: "£", GBp: "p", CHF: "CHF", JPY: "¥" };

export function euros(n: Nombre, avecSigne = false): string {
    return vide(n) ? "–" : `${formateur(2, 2, avecSigne).format(n)} €`;
}

export function montant(n: Nombre, devise = "EUR"): string {
    if (vide(n)) return "–";
    return `${formateur(2, 2).format(n)} ${SYMBOLES_DEVISE[devise] ?? devise}`;
}

export function compact(n: Nombre): string {
    if (vide(n)) return "–";
    return new Intl.NumberFormat("fr-FR", { notation: "compact", maximumFractionDigits: 2 }).format(n);
}

/** Tailwind text class for a variation. */
export function couleur(n: Nombre): string {
    if (vide(n) || n === 0) return "text-texte";
    return n > 0 ? "text-hausse" : "text-baisse";
}

// Dates: "AAAA-MM-JJ" strings are calendar days, read at noon UTC to avoid
// any timezone shift; ISO timestamps are shown in Paris time.

function jourEnDate(jour: string): Date {
    return new Date(`${jour.slice(0, 10)}T12:00:00Z`);
}

const fDate = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const fJourMois = new Intl.DateTimeFormat("fr-FR", { day: "numeric", month: "short", timeZone: "UTC" });
const fMois = new Intl.DateTimeFormat("fr-FR", { month: "short", timeZone: "UTC" });
const fMoisAnnee = new Intl.DateTimeFormat("fr-FR", { month: "short", year: "numeric", timeZone: "UTC" });
const fJourSemaine = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric", timeZone: FUSEAU });
const fHeure = new Intl.DateTimeFormat("fr-FR", { hour: "2-digit", minute: "2-digit", timeZone: FUSEAU });
const fHorodatage = new Intl.DateTimeFormat("fr-FR", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: FUSEAU,
});
const fJourParis = new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: FUSEAU,
});

export const date = (jour: string | null | undefined) => (jour ? fDate.format(jourEnDate(jour)) : "–");
export const jourMois = (jour: string) => fJourMois.format(jourEnDate(jour));
export const mois = (jour: string) => fMois.format(jourEnDate(jour));
export const moisAnnee = (jour: string) => fMoisAnnee.format(jourEnDate(jour));
export const annee = (jour: string) => jour.slice(0, 4);
export const jourSemaine = (iso: string) => fJourSemaine.format(new Date(iso));
export const heure = (iso: string) => fHeure.format(new Date(iso));
export const horodatage = (iso: string) => fHorodatage.format(new Date(iso));

/** Calendar day in Paris (AAAA-MM-JJ) of a date or ISO timestamp. */
export function jourParis(d: Date | string = new Date()): string {
    return fJourParis.format(typeof d === "string" ? new Date(d) : d);
}

export function decaler(jour: string, { jours = 0, mois = 0, ans = 0 }: { jours?: number; mois?: number; ans?: number }) {
    const [a, m, j] = jour.split("-").map(Number);
    return new Date(Date.UTC(a + ans, m - 1 + mois, j + jours)).toISOString().slice(0, 10);
}

export function ecartJours(du: string, au: string): number {
    return Math.round((jourEnDate(au).getTime() - jourEnDate(du).getTime()) / 86_400_000);
}

export const TYPES_INSTRUMENT: Record<string, string> = {
    INDEX: "Indice",
    EQUITY: "Action",
    ETF: "ETF",
    CURRENCY: "Devise",
    FUTURE: "Contrat à terme",
    CRYPTOCURRENCY: "Cryptomonnaie",
};

export const ETATS_MARCHE: Record<string, string> = {
    REGULAR: "Marché ouvert",
    CLOSED: "Marché fermé",
    PRE: "Pré-ouverture",
    PREPRE: "Pré-ouverture",
    POST: "Après clôture",
    POSTPOST: "Après clôture",
};
