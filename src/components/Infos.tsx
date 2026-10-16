import type { ReactNode } from "react";

/** A label and its value; `null` hides the line (empty or zero value). */
export type Ligne = [string, ReactNode | null];

export interface Partie {
    titre: string;
    lignes: Ligne[];
}

/** True for a number worth showing: not missing, not NaN, not zero. */
export const utile = (n: number | null | undefined): n is number => n !== null && n !== undefined && !Number.isNaN(n) && n !== 0;

/** Renders `rendu(n)` only when `n` is worth showing, else null (line hidden). */
export function si(n: number | null | undefined, rendu: (n: number) => ReactNode): ReactNode | null {
    return utile(n) ? rendu(n) : null;
}

/** Side card split into titled parts; empty lines and empty parts are left out. */
export default function Infos({ titre, parties, pied }: { titre?: string; parties: Partie[]; pied?: ReactNode }) {
    const visibles = parties.map((p) => ({ ...p, lignes: p.lignes.filter(([, v]) => v !== null && v !== undefined && v !== false) })).filter((p) => p.lignes.length);
    if (!visibles.length && !pied) return null;
    return (
        <section className="carte">
            {titre && <h2 className="titre-carte">{titre}</h2>}
            {visibles.map((p, i) => (
                <div key={p.titre} className={i > 0 || titre ? "border-t border-filet" : ""}>
                    <h3 className="px-4 pt-3 pb-1 text-[13px] font-medium text-muet">{p.titre}</h3>
                    <ul className="pb-2">
                        {p.lignes.map(([libelle, valeur]) => (
                            <li key={libelle} className="flex items-start justify-between gap-4 px-4 py-2">
                                <span className="text-muet">{libelle}</span>
                                <span className="text-right font-medium tabular-nums">{valeur}</span>
                            </li>
                        ))}
                    </ul>
                </div>
            ))}
            {pied && <div className="border-t border-filet px-4 py-3">{pied}</div>}
        </section>
    );
}
