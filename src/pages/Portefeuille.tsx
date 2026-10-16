import { ArrowDown, ArrowUp } from "lucide-react";
import { useState, type ReactNode } from "react";
import { Link, useSearchParams } from "react-router-dom";
import Badge from "../components/Badge";
import ChoixPeriode from "../components/ChoixPeriode";
import { Chargement, Erreur } from "../components/Etat";
import Graphique from "../components/Graphique";
import Infos, { si, utile } from "../components/Infos";
import { Pastille, Variation } from "../components/Variation";
import { qs, useApi } from "../lib/api";
import { lienValeur } from "../lib/donnees";
import { couleur, date, euros, horodatage, jourMois, montant, nombre, pct, quantite } from "../lib/format";
import { derniersJours, plage, type Periode } from "../lib/periodes";
import { DEPUIS } from "../lib/periodes-libelles";
import type { Position, ReponseComptes, ReponsePositions, ReponseValorisation, Totaux } from "../lib/types";

/** Day change in euros, derived from the position value and its day change in %. */
const varJourEur = (p: Position) => {
    const j = p.variations?.jour;
    return j === null || j === undefined || !p.valeur_eur ? null : (p.valeur_eur * j) / (100 + j);
};

/** Value curve with the range tabs; the header shows the gain over the range, net of deposits. */
function GraphiqueValorisation({ compte, entete }: { compte?: string; entete: (gain: { valeur: number; pct: number | null; libelle: string } | null) => ReactNode }) {
    const [periode, setPeriode] = useState<Periode>("1a");
    const p = plage(periode, null, 10);
    const chemin = p.intraday ? `/valorisation/intraday${qs({ du: periode === "1j" ? p.au : p.du, au: p.au, intervalle: p.intervalle, compte })}` : `/valorisation${qs({ du: p.du, au: p.au, compte })}`;
    const { donnees, erreur, chargement } = useApi<ReponseValorisation>(chemin);

    let points = donnees?.points ?? [];
    const intraday = points.length > 0 && points[0].horodatage !== undefined;
    if (intraday !== p.intraday) points = [];
    if (intraday && periode === "5j") points = derniersJours(points, 5, (pt) => pt.horodatage!);
    // Before the first purchase the portfolio is empty: start the curve there.
    const premier = points.findIndex((pt) => pt.valeur > 0 || pt.investi_net > 0);
    points = premier > 0 ? points.slice(premier) : points;

    const x = points.map((pt) => (pt.horodatage ?? pt.jour)!);
    const valeurs = points.map((pt) => pt.valeur);
    const debut = valeurs[0];
    const apports = points.length ? points[points.length - 1].investi_net - points[0].investi_net : 0;
    const gain = points.length ? valeurs[valeurs.length - 1] - debut - apports : undefined;

    return (
        <div>
            {entete(gain !== undefined ? { valeur: gain, pct: debut ? (gain / debut) * 100 : null, libelle: DEPUIS[periode] } : null)}
            <ChoixPeriode valeur={periode} onChange={setPeriode} />
            <div className="pt-3">
                {erreur ? (
                    <Erreur erreur={erreur} />
                ) : (
                    <div className={chargement ? "opacity-50 transition-opacity" : "transition-opacity"}>
                        <Graphique
                            x={x}
                            series={[
                                { nom: "Valeur", valeurs },
                                { nom: "Investi net", valeurs: points.map((pt) => pt.investi_net), secondaire: true },
                            ]}
                            sens={gain}
                            infobulle={(i) => {
                                // Value at that date and how far it is above or below the net amount invested.
                                const ecart = points[i].investi_net ? ((points[i].valeur - points[i].investi_net) / points[i].investi_net) * 100 : null;
                                return (
                                    <span className="inline-flex items-center gap-2">
                                        <span className="font-medium tabular-nums">{euros(points[i].valeur)}</span>
                                        <Pastille n={ecart} />
                                    </span>
                                );
                            }}
                            graduation={p.graduation}
                            formatY={(n) => euros(n).replace(",00", "")}
                            formatX={(v) => (p.intraday ? horodatage(v) : date(v))}
                            hauteur={300}
                        />
                        {points.some((pt) => pt.incomplet) && <p className="mt-1 text-xs text-alerte">Certains cours manquent sur la période : la valeur y est sous-estimée.</p>}
                    </div>
                )}
            </div>
        </div>
    );
}

type Colonne = { cle: string; libelle: string; valeur: (p: Position) => number | string | null };

const COLONNES: Colonne[] = [
    { cle: "nom", libelle: "Nom", valeur: (p) => p.nom || p.symbole },
    { cle: "cours", libelle: "Cours", valeur: (p) => p.cours },
    { cle: "quantite", libelle: "Quantité", valeur: (p) => p.quantite },
    { cle: "pru", libelle: "PRU", valeur: (p) => p.pru },
    { cle: "valeur", libelle: "Valeur", valeur: (p) => p.valeur_eur },
    { cle: "pv", libelle: "Plus-value", valeur: (p) => p.plus_value_latente_eur },
    { cle: "repartition", libelle: "Poids", valeur: (p) => p.repartition_pct },
];

function TableauPositions({ positions, totaux, avecCompte, soldees }: { positions: Position[]; totaux: Totaux; avecCompte: boolean; soldees: boolean }) {
    const [tri, setTri] = useState<{ cle: string; desc: boolean }>({ cle: "valeur", desc: true });
    const colonne = COLONNES.find((c) => c.cle === tri.cle)!;
    const triees = [...positions].sort((a, b) => {
        const va = colonne.valeur(a);
        const vb = colonne.valeur(b);
        if (va === null) return 1;
        if (vb === null) return -1;
        const r = typeof va === "string" ? va.localeCompare(String(vb)) : va - (vb as number);
        return tri.desc ? -r : r;
    });
    const gainJour = positions.reduce((s, p) => s + (varJourEur(p) ?? 0), 0);
    // Realised gains and dividends are shown with closed positions, and only if some exist.
    const avecRealisee = soldees && positions.some((p) => utile(p.plus_value_realisee_eur));
    const avecDividendes = soldees && positions.some((p) => utile(p.dividendes_eur));

    const entete = (c: Colonne) => (
        <th key={c.cle}>
            <button type="button" className="inline-flex cursor-pointer items-center gap-0.5 hover:text-texte" onClick={() => setTri({ cle: c.cle, desc: tri.cle === c.cle ? !tri.desc : c.cle !== "nom" })}>
                {c.libelle}
                {tri.cle === c.cle && (tri.desc ? <ArrowDown className="size-3" aria-hidden /> : <ArrowUp className="size-3" aria-hidden />)}
            </button>
        </th>
    );

    return (
        <div className="overflow-x-auto">
            <table className="tableau tableau-serre">
                <thead>
                    <tr>
                        {entete(COLONNES[0])}
                        {COLONNES.slice(1).map(entete)}
                        {avecRealisee && <th>Réalisée</th>}
                        {avecDividendes && <th>Dividendes</th>}
                    </tr>
                </thead>
                <tbody>
                    {triees.map((p) => {
                        const vj = varJourEur(p);
                        return (
                            <tr key={`${p.compte}-${p.symbole}`} className={p.quantite === 0 ? "opacity-60" : ""}>
                                <td className="max-w-64">
                                    <Link to={lienValeur(p.symbole)} className="flex items-center gap-3 text-texte">
                                        <Badge symbole={p.symbole} />
                                        <span className="min-w-0">
                                            <span className="block truncate">{p.nom || p.symbole}</span>
                                            <span className="block text-xs text-muet">{avecCompte ? `${p.compte} · ${p.symbole}` : p.symbole}</span>
                                        </span>
                                    </Link>
                                </td>
                                <td title={p.date_cours ? `Cours du ${date(p.date_cours)}` : undefined}>
                                    <div>{montant(p.cours, p.devise)}</div>
                                    <div className="mt-0.5">
                                        <Pastille n={p.variations?.jour} />
                                    </div>
                                </td>
                                <td>{quantite(p.quantite)}</td>
                                <td>{montant(p.pru, p.devise)}</td>
                                <td>
                                    <div className="font-medium">{euros(p.valeur_eur)}</div>
                                    <div className="mt-0.5 text-xs" title="Gain de la dernière séance">
                                        <Variation valeur={vj} dec={2} />
                                    </div>
                                </td>
                                <td>
                                    <div className={couleur(p.plus_value_latente_eur)}>{euros(p.plus_value_latente_eur, true)}</div>
                                    <div className="mt-0.5">
                                        <Pastille n={p.rendement_pct} />
                                    </div>
                                </td>
                                <td>{pct(p.repartition_pct, false)}</td>
                                {avecRealisee && <td className={couleur(p.plus_value_realisee_eur)}>{euros(p.plus_value_realisee_eur, true)}</td>}
                                {avecDividendes && <td>{euros(p.dividendes_eur)}</td>}
                            </tr>
                        );
                    })}
                </tbody>
                <tfoot>
                    <tr>
                        <td>Total</td>
                        <td />
                        <td />
                        <td />
                        <td>
                            <div>{euros(totaux.valeur)}</div>
                            <div className="mt-0.5 text-xs">
                                <Variation valeur={gainJour} dec={2} />
                            </div>
                        </td>
                        <td className={couleur(totaux.plus_value_latente)}>{euros(totaux.plus_value_latente, true)}</td>
                        <td>100 %</td>
                        {avecRealisee && <td className={couleur(totaux.plus_value_realisee)}>{euros(totaux.plus_value_realisee, true)}</td>}
                        {avecDividendes && <td>{euros(totaux.dividendes)}</td>}
                    </tr>
                </tfoot>
            </table>
        </div>
    );
}

function Chiffres({ positions }: { positions: ReponsePositions }) {
    const t = positions.totaux;
    const gainJour = positions.positions.reduce((s, p) => s + (varJourEur(p) ?? 0), 0);
    // Day changes come from the last stored daily close of each position.
    const derniere = positions.positions.reduce<string | null>((m, p) => (p.date_cours && (!m || p.date_cours > m) ? p.date_cours : m), null);
    const veille = t.valeur - gainJour;
    const gainPct = (n: number, base: number) => (base ? (n / base) * 100 : null);

    return (
        <section className="flex flex-col gap-0">
            <Infos
                parties={[
                    {
                        titre: `Dernière séance${derniere ? ` (${jourMois(derniere)})` : ""}`,
                        lignes: [
                            [
                                "Gain",
                                si(gainJour, (n) => (
                                    <span className="inline-flex items-center gap-2">
                                        <Variation valeur={n} dec={2} />
                                        <Pastille n={gainPct(n, veille)} />
                                    </span>
                                )),
                            ],
                        ],
                    },
                    {
                        titre: "Capital",
                        lignes: [
                            ["Valeur", euros(t.valeur)],
                            ["Investi", si(t.investi, (n) => euros(n))],
                        ],
                    },
                    {
                        titre: "Gains",
                        lignes: [
                            [
                                "Plus-value latente",
                                si(t.plus_value_latente, (n) => (
                                    <span className="inline-flex items-center gap-2">
                                        <Variation valeur={n} dec={2} />
                                        <Pastille n={gainPct(n, t.investi)} />
                                    </span>
                                )),
                            ],
                            ["Plus-value réalisée", si(t.plus_value_realisee, (n) => <Variation valeur={n} dec={2} />)],
                            ["Dividendes", si(t.dividendes, (n) => euros(n))],
                            [
                                "Bénéfice total",
                                si(t.benefice_total, (n) => (
                                    <span className="inline-flex items-center gap-2">
                                        <Variation valeur={n} dec={2} />
                                        <Pastille n={t.rendement_pct} />
                                    </span>
                                )),
                            ],
                        ],
                    },
                ]}
                pied={t.incomplet ? <p className="text-xs text-alerte">Une position n'a pas encore de cours : elle n'est pas comptée dans la valeur.</p> : undefined}
            />
        </section>
    );
}

function CarteComptes({ comptes }: { comptes: ReponseComptes }) {
    return (
        <section className="carte">
            <h2 className="titre-carte">Comptes</h2>
            <ul>
                {Object.entries(comptes.comptes).map(([nom, c]) => (
                    <li key={nom} className="border-t border-filet">
                        <Link to={`/portefeuille${qs({ compte: nom })}`} className="flex items-center gap-3 px-4 py-3 text-texte hover:bg-surface-2/60">
                            <span className="flex-1">
                                <span className="font-medium">{nom}</span>
                                <span className="ml-2 text-xs text-muet">{nombre(c.repartition_pct ?? 0)} %</span>
                            </span>
                            <span className="text-right tabular-nums">
                                <div>{euros(c.valeur)}</div>
                                <div className="text-xs">
                                    <Variation valeur={c.benefice_total} dec={2} />
                                </div>
                            </span>
                            <Pastille n={c.rendement_pct} />
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

export default function Portefeuille() {
    const [params, setParams] = useSearchParams();
    const compte = params.get("compte") ?? undefined;
    const soldees = params.get("soldees") === "true";
    const { donnees: comptes } = useApi<ReponseComptes>("/comptes");
    const { donnees, erreur, recharger } = useApi<ReponsePositions>(`/positions${qs({ compte, soldees: soldees || undefined })}`);

    const changer = (modif: Record<string, string | undefined>) => {
        const p = new URLSearchParams(params);
        for (const [k, v] of Object.entries(modif)) {
            if (v) p.set(k, v);
            else p.delete(k);
        }
        setParams(p);
    };

    return (
        <div>
            <div className="mb-4 flex flex-wrap items-center gap-2">
                <h1 className="mr-2 text-[24px]">Portefeuille</h1>
                {["", ...Object.keys(comptes?.comptes ?? {})].map((o) => (
                    <button key={o || "tous"} type="button" className={`puce ${(compte ?? "") === o ? "puce-active" : ""}`} onClick={() => changer({ compte: o || undefined })}>
                        {o || "Tous les comptes"}
                    </button>
                ))}
            </div>

            {erreur ? (
                <Erreur erreur={erreur} recharger={recharger} />
            ) : !donnees ? (
                <Chargement />
            ) : (
                <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
                    <div className="min-w-0 lg:col-start-1">
                        <GraphiqueValorisation
                            key={compte ?? ""}
                            compte={compte}
                            entete={(gain) => (
                                <div className="mb-4">
                                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                        <span className="text-[36px] leading-tight tabular-nums">{euros(donnees.totaux.valeur)}</span>
                                        {gain && <Pastille n={gain.pct} grande />}
                                        {gain && <Variation valeur={gain.valeur} dec={2} suffixe={gain.libelle} />}
                                    </div>
                                    <div className="mt-1 text-xs text-muet">Valeur au {date(donnees.jour)} · gain hors achats et ventes de la période</div>
                                </div>
                            )}
                        />
                    </div>
                    <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                        <Chiffres positions={donnees} />
                        {!compte && comptes && <CarteComptes comptes={comptes} />}
                    </aside>
                    <div className="flex min-w-0 flex-col gap-6 lg:col-start-1">
                        <section className="carte">
                            <div className="flex flex-wrap items-center justify-between gap-2 px-4 pt-4 pb-2">
                                <h2 className="text-[18px]">Investissements</h2>
                                <label className="flex cursor-pointer items-center gap-2 text-[13px] text-muet">
                                    <input type="checkbox" className="size-4 accent-[var(--accent)]" checked={soldees} onChange={(e) => changer({ soldees: e.target.checked ? "true" : undefined })} />
                                    Positions soldées
                                </label>
                            </div>
                            {donnees.positions.length ? <TableauPositions positions={donnees.positions} totaux={donnees.totaux} avecCompte={!compte} soldees={soldees} /> : <p className="px-4 pb-4 text-muet">Aucune position.</p>}
                        </section>
                    </div>
                </div>
            )}
        </div>
    );
}
