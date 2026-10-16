import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Chargement, Erreur } from "../components/Etat";
import TableauOperations from "../components/TableauOperations";
import { qs, useApi } from "../lib/api";
import { lienValeur } from "../lib/donnees";
import { euros } from "../lib/format";
import type { Agregat, ReponseDividendes } from "../lib/types";

/** Aggregates are plain amounts; objects carrying a total are accepted too. */
function montantDe(v: Agregat[string]): number {
    if (typeof v === "number") return v;
    const o = v as Record<string, unknown>;
    const n = o.total ?? o.montant ?? o.montant_eur;
    return typeof n === "number" ? n : 0;
}

function BarresAnnees({ parAnnee, choisie, choisir }: { parAnnee: Agregat; choisie: string; choisir: (a: string) => void }) {
    const [survol, setSurvol] = useState<string | null>(null);
    const lignes = Object.entries(parAnnee)
        .map(([a, v]) => [a, montantDe(v)] as const)
        .sort(([a], [b]) => a.localeCompare(b));
    const max = Math.max(...lignes.map(([, v]) => v), 1);
    return (
        <div className="mx-4 flex h-44 items-end gap-4 border-b border-filet pt-6">
            {lignes.map(([a, v]) => (
                <button
                    key={a}
                    type="button"
                    className="group relative flex h-full w-14 cursor-pointer flex-col items-center justify-end"
                    onClick={() => choisir(choisie === a ? "" : a)}
                    onMouseEnter={() => setSurvol(a)}
                    onMouseLeave={() => setSurvol(null)}
                    aria-label={`${a} : ${euros(v)}`}
                >
                    <span className={`mb-1 text-xs tabular-nums ${survol === a || choisie === a ? "font-medium text-texte" : "text-muet"}`}>{euros(v)}</span>
                    <span className="w-9 rounded-t" style={{ height: `${(v / max) * 100}%`, minHeight: 2, background: "var(--accent)", opacity: !choisie || choisie === a ? (survol === a ? 0.8 : 1) : 0.35 }} />
                    <span className={`absolute -bottom-6 text-xs ${choisie === a ? "font-medium text-accent" : "text-muet"}`}>{a}</span>
                </button>
            ))}
        </div>
    );
}

function TableauAgregat({ titre, agregat, lien }: { titre: string; agregat: Agregat; lien?: (cle: string) => string }) {
    const lignes = Object.entries(agregat)
        .map(([k, v]) => [k, montantDe(v)] as const)
        .sort(([, a], [, b]) => b - a);
    return (
        <table className="tableau">
            <thead>
                <tr>
                    <th>{titre}</th>
                    <th>Montant</th>
                </tr>
            </thead>
            <tbody>
                {lignes.map(([k, v]) => (
                    <tr key={k}>
                        <td>{lien ? <Link to={lien(k)}>{k}</Link> : k}</td>
                        <td>{euros(v)}</td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

export default function Dividendes() {
    const [params, setParams] = useSearchParams();
    const annee = params.get("annee") ?? "";
    // The yearly bars always show every year; the rest follows the selected year.
    const { donnees: tout } = useApi<ReponseDividendes>("/dividendes");
    const { donnees, erreur, recharger } = useApi<ReponseDividendes>(`/dividendes${qs({ annee })}`);

    const choisir = (a: string) => setParams(a ? { annee: a } : {});

    if (erreur) return <Erreur erreur={erreur} recharger={recharger} />;
    if (!donnees) return <Chargement />;

    return (
        <div className="flex flex-col gap-6">
            <div>
                <h1 className="text-[24px]">Dividendes</h1>
                <div className="mt-2 text-[36px] leading-tight tabular-nums">{euros(donnees.total)}</div>
                <div className="mt-1 text-xs text-muet">{annee ? `Reçus en ${annee}` : "Reçus depuis le début"}</div>
            </div>

            {tout && Object.keys(tout.par_annee).length > 0 && (
                <section className="carte">
                    <div className="flex items-center justify-between pr-4">
                        <h2 className="titre-carte">Par année</h2>
                        {annee && (
                            <button type="button" className="puce puce-active" onClick={() => choisir("")}>
                                {annee} ✕
                            </button>
                        )}
                    </div>
                    <div className="pb-10">
                        <BarresAnnees parAnnee={tout.par_annee} choisie={annee} choisir={choisir} />
                    </div>
                </section>
            )}

            <div className="grid gap-6 sm:grid-cols-2">
                <section className="carte">
                    <h2 className="titre-carte">Par valeur</h2>
                    <TableauAgregat titre="Symbole" agregat={donnees.par_symbole} lien={lienValeur} />
                </section>
                <section className="carte">
                    <h2 className="titre-carte">Par compte</h2>
                    <TableauAgregat titre="Compte" agregat={donnees.par_compte} />
                </section>
            </div>

            <section className="carte">
                <h2 className="titre-carte">Versements</h2>
                {donnees.dividendes.length ? <TableauOperations operations={[...donnees.dividendes].reverse()} /> : <p className="px-4 pb-4 text-muet">Aucun dividende.</p>}
            </section>
        </div>
    );
}
