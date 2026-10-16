import { decaler, ecartJours, jourParis } from "./format";

export type Periode = "1j" | "5j" | "1m" | "3m" | "6m" | "ytd" | "1a" | "5a" | "10a" | "max";

// The ranges of the Google Finance chart.
export const PERIODES: { id: Periode; libelle: string }[] = [
    { id: "1j", libelle: "1 J" },
    { id: "5j", libelle: "5 J" },
    { id: "1m", libelle: "1 M" },
    { id: "6m", libelle: "6 M" },
    { id: "ytd", libelle: "YTD" },
    { id: "1a", libelle: "1 A" },
    { id: "5a", libelle: "5 A" },
    { id: "max", libelle: "MAX" },
];

/** How the x axis is labelled. */
export type Graduation = "heure" | "jour" | "date" | "mois" | "annee";

export interface Plage {
    intraday: boolean;
    du: string;
    au: string;
    /** API interval: 15m/30m for intraday, 1d/1wk/1mo for daily. */
    intervalle: string;
    /** Intraday only: number of most recent trading days kept. */
    jours?: number;
    graduation: Graduation;
}

/**
 * Request window for a period. Intraday windows are wider than needed
 * (weekends, holidays) and trimmed to the last trading days afterwards.
 */
export function plage(p: Periode, premierJour?: string | null, maxAns?: number): Plage {
    const auj = jourParis();
    const plus = (o: Parameters<typeof decaler>[1]) => decaler(auj, o);
    switch (p) {
        case "1j":
            return { intraday: true, du: plus({ jours: -6 }), au: auj, intervalle: "15m", jours: 1, graduation: "heure" };
        case "5j":
            return { intraday: true, du: plus({ jours: -12 }), au: auj, intervalle: "30m", jours: 5, graduation: "jour" };
        case "1m":
            return { intraday: false, du: plus({ mois: -1 }), au: auj, intervalle: "1d", graduation: "date" };
        case "3m":
            return { intraday: false, du: plus({ mois: -3 }), au: auj, intervalle: "1d", graduation: "date" };
        case "6m":
            return { intraday: false, du: plus({ mois: -6 }), au: auj, intervalle: "1d", graduation: "mois" };
        case "ytd": {
            const du = `${auj.slice(0, 4)}-01-01`;
            return { intraday: false, du, au: auj, intervalle: "1d", graduation: ecartJours(du, auj) < 45 ? "date" : "mois" };
        }
        case "1a":
            return { intraday: false, du: plus({ ans: -1 }), au: auj, intervalle: "1d", graduation: "mois" };
        case "5a":
            return { intraday: false, du: plus({ ans: -5 }), au: auj, intervalle: "1wk", graduation: "annee" };
        case "10a":
            return { intraday: false, du: plus({ ans: -10, jours: 1 }), au: auj, intervalle: "1wk", graduation: "annee" };
        case "max": {
            let du = premierJour ?? plus({ ans: -30 });
            if (maxAns) {
                const limite = plus({ ans: -maxAns, jours: 1 });
                if (du < limite) du = limite;
            }
            const ans = ecartJours(du, auj) / 365;
            return {
                intraday: false,
                du,
                au: auj,
                intervalle: ans > 12 ? "1mo" : "1wk",
                graduation: ans > 2 ? "annee" : "mois",
            };
        }
    }
}

/** Keeps the items of the last `n` distinct Paris days. */
export function derniersJours<T>(items: T[], n: number, horodatage: (item: T) => string): T[] {
    const jours: string[] = [];
    for (let i = items.length - 1; i >= 0; i--) {
        const j = jourParis(horodatage(items[i]));
        if (jours[jours.length - 1] !== j) {
            jours.push(j);
            if (jours.length > n) return items.slice(i + 1);
        }
    }
    return items;
}
