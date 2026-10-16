import type { Cotation, Position } from "./types";

export interface LigneJour {
    symbole: string;
    nom: string;
    devise: string;
    compte: string;
    cours: number | null;
    /** Value in euros at the live price. */
    valeur: number;
    /** Change of the day in %, from the live quote (else the last stored session). */
    pct: number | null;
    /** Change of the day in euros. */
    gain: number | null;
}

/**
 * Today's view of the positions. The stored value is rescaled to the live
 * price; the day gain is then value × pct / (100 + pct), which holds whether
 * the stored price is yesterday's close or already today's.
 */
export function positionsDuJour(positions: Position[], cotations: Map<string, Cotation>): LigneJour[] {
    return positions
        .filter((p) => p.quantite > 0)
        .map((p) => {
            const c = cotations.get(p.symbole);
            const valeur = c && p.cours ? (p.valeur_eur * c.prix) / p.cours : p.valeur_eur;
            const pct = c?.variation_pct ?? p.variations?.jour ?? null;
            return {
                symbole: p.symbole,
                nom: p.nom,
                devise: p.devise,
                compte: p.compte,
                cours: c?.prix ?? p.cours,
                valeur,
                pct,
                gain: pct === null ? null : (valeur * pct) / (100 + pct),
            };
        });
}

/** Sums lines into one value and day gain, with the gain in % of yesterday's value. */
export function totalJour(lignes: LigneJour[]) {
    const valeur = lignes.reduce((s, l) => s + l.valeur, 0);
    const gain = lignes.reduce((s, l) => s + (l.gain ?? 0), 0);
    const veille = valeur - gain;
    return { valeur, gain, pct: veille ? (gain / veille) * 100 : null };
}
