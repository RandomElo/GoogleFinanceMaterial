import { enc, qs, useApi } from "./api";
import type { Cotation, Instrument, ReponsePerformances } from "./types";

// Shared fetches, cached by path in api.ts.

export const useInstruments = () => useApi<Instrument[]>("/instruments");

const liste = (symboles: string[]) => [...new Set(symboles)].sort().slice(0, 50).join(",");

export function useCotations(symboles: string[]) {
    const s = liste(symboles);
    const etat = useApi<Cotation[]>(s ? `/cotations${qs({ symboles: s })}` : null);
    const parSymbole = new Map((etat.donnees ?? []).map((c) => [c.symbole, c]));
    return { ...etat, parSymbole };
}

export function usePerformances(symboles: string[]) {
    const s = liste(symboles);
    const etat = useApi<ReponsePerformances>(s ? `/performances${qs({ symboles: s })}` : null);
    const parSymbole = new Map((etat.donnees?.performances ?? []).map((p) => [p.symbole, p]));
    return { ...etat, parSymbole };
}

export const lienValeur = (symbole: string) => `/valeur/${enc(symbole)}`;
