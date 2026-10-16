import type { Periode } from "./periodes";

/** Suffix of the change shown next to the price for each range. */
export const DEPUIS: Record<Periode, string> = {
    "1j": "aujourd'hui",
    "5j": "sur 5 jours",
    "1m": "sur 1 mois",
    "3m": "sur 3 mois",
    "6m": "sur 6 mois",
    ytd: "depuis le 1er janvier",
    "1a": "sur 1 an",
    "5a": "sur 5 ans",
    "10a": "sur 10 ans",
    max: "depuis l'origine",
};
