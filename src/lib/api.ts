import { useCallback, useEffect, useState } from "react";

// Every call goes through /api, proxied (Vite in dev, nginx in production)
// to the bourse API with the key added server-side.

export class ErreurApi extends Error {
    statut: number;
    constructor(statut: number, message: string) {
        super(message);
        this.statut = statut;
    }
}

export async function requete<T>(chemin: string, init?: RequestInit): Promise<T> {
    let reponse: Response;
    try {
        reponse = await fetch(`/api${chemin}`, init);
    } catch {
        throw new ErreurApi(0, "Impossible de joindre l'API bourse");
    }
    const texte = await reponse.text();
    let donnees: unknown = null;
    try {
        donnees = texte ? JSON.parse(texte) : null;
    } catch {
        // Non-JSON body (proxy error page): handled below.
    }
    if (!reponse.ok) {
        const message = (donnees as { erreur?: string } | null)?.erreur ?? (reponse.status >= 502 ? "L'API bourse ne répond pas" : `Erreur ${reponse.status}`);
        throw new ErreurApi(reponse.status, message);
    }
    return donnees as T;
}

export function envoyer<T>(chemin: string, corps?: unknown): Promise<T> {
    vider();
    return requete<T>(chemin, {
        method: "POST",
        headers: corps === undefined ? undefined : { "Content-Type": "application/json" },
        body: corps === undefined ? undefined : JSON.stringify(corps),
    });
}

// Small in-memory cache so that navigating between pages does not refetch
// the same data. Entries expire after `DUREE_CACHE` ms.
const DUREE_CACHE = 60_000;
const cache = new Map<string, { expire: number; promesse: Promise<unknown> }>();

export function vider() {
    cache.clear();
}

function charger<T>(chemin: string): Promise<T> {
    const entree = cache.get(chemin);
    if (entree && entree.expire > Date.now()) return entree.promesse as Promise<T>;
    const promesse = requete<T>(chemin);
    cache.set(chemin, { expire: Date.now() + DUREE_CACHE, promesse });
    promesse.catch(() => cache.delete(chemin));
    return promesse;
}

export interface EtatApi<T> {
    donnees: T | undefined;
    erreur: ErreurApi | undefined;
    chargement: boolean;
    recharger: () => void;
}

/** Fetches `chemin` (null = nothing to fetch) and keeps the last result while reloading. */
export function useApi<T>(chemin: string | null): EtatApi<T> {
    const [etat, setEtat] = useState<{ chemin: string | null; donnees?: T; erreur?: ErreurApi }>({
        chemin: null,
    });
    const [version, setVersion] = useState(0);

    useEffect(() => {
        if (!chemin) return;
        let actif = true;
        charger<T>(chemin).then(
            (donnees) => actif && setEtat({ chemin, donnees }),
            (erreur: unknown) =>
                actif &&
                setEtat({
                    chemin,
                    erreur: erreur instanceof ErreurApi ? erreur : new ErreurApi(0, String(erreur)),
                }),
        );
        return () => {
            actif = false;
        };
    }, [chemin, version]);

    const recharger = useCallback(() => {
        if (chemin) cache.delete(chemin);
        setVersion((v) => v + 1);
    }, [chemin]);

    const aJour = etat.chemin === chemin;
    return {
        donnees: chemin ? etat.donnees : undefined,
        erreur: aJour ? etat.erreur : undefined,
        chargement: chemin !== null && (!aJour || (etat.donnees === undefined && etat.erreur === undefined)),
        recharger,
    };
}

/** Builds a query string, skipping empty values. */
export function qs(parametres: Record<string, string | number | boolean | undefined | null>): string {
    const p = new URLSearchParams();
    for (const [cle, valeur] of Object.entries(parametres)) {
        if (valeur !== undefined && valeur !== null && valeur !== "") p.set(cle, String(valeur));
    }
    const texte = p.toString();
    return texte ? `?${texte}` : "";
}

export const enc = encodeURIComponent;
