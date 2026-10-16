import { useState } from "react";
import { Link } from "react-router-dom";
import Badge from "../components/Badge";
import { Chargement, Erreur } from "../components/Etat";
import MiniCourbe from "../components/MiniCourbe";
import { Pastille, Variation } from "../components/Variation";
import { envoyer, useApi } from "../lib/api";
import { lienValeur, useCotations, useInstruments } from "../lib/donnees";
import { decimales, euros, montant, prix } from "../lib/format";
import { positionsDuJour, totalJour, type LigneJour } from "../lib/jour";
import type { Cotation, ReponsePositions } from "../lib/types";

// Market strip: Europe, United States and Japan. /cotations accepts any
// Yahoo symbol; the intraday line needs the index to be tracked by the API.
const MARCHES = [
    { symbole: "^FCHI", nom: "CAC 40" },
    { symbole: "^STOXX50E", nom: "Euro Stoxx 50" },
    { symbole: "^GSPC", nom: "S&P 500" },
    { symbole: "^IXIC", nom: "Nasdaq" },
    { symbole: "^N225", nom: "Nikkei 225" },
];

/** Today's performance of the portfolio, as a whole and per account. */
function CartePortefeuille({ cotations }: { cotations: Map<string, Cotation> }) {
    const { donnees, erreur } = useApi<ReponsePositions>("/positions");
    const lignes = donnees ? positionsDuJour(donnees.positions, cotations) : [];
    const total = totalJour(lignes);
    const comptes = [...new Set(lignes.map((l) => l.compte))].map((nom) => ({ nom, ...totalJour(lignes.filter((l) => l.compte === nom)) })).sort((a, b) => b.valeur - a.valeur);

    return (
        <section className="carte">
            <h2 className="titre-carte">
                <Link to="/portefeuille" className="text-texte">
                    Portefeuille
                </Link>
            </h2>
            {erreur ? (
                <p className="px-4 pb-4 text-muet">{erreur.message}</p>
            ) : !donnees ? (
                <p className="px-4 pb-4 text-muet">Chargement…</p>
            ) : (
                <>
                    <div className="px-4 pb-3">
                        <div className="text-[28px] leading-9 tabular-nums">{euros(total.valeur)}</div>
                        <div className="mt-1 flex items-center gap-2 text-[13px]">
                            <Pastille n={total.pct} />
                            <Variation valeur={total.gain} dec={2} suffixe="aujourd'hui" />
                        </div>
                    </div>
                    <ul>
                        {comptes.map((c) => (
                            <li key={c.nom} className="border-t border-filet">
                                <Link to={`/portefeuille?compte=${encodeURIComponent(c.nom)}`} className="flex items-center gap-3 px-4 py-3 text-texte hover:bg-surface-2/60">
                                    <span className="flex-1">
                                        <span className="block font-medium">{c.nom}</span>
                                        <span className="block text-xs text-muet tabular-nums">{euros(c.valeur)}</span>
                                    </span>
                                    <span className="text-[13px]">
                                        <Variation valeur={c.gain} dec={2} />
                                    </span>
                                    <Pastille n={c.pct} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                </>
            )}
        </section>
    );
}

function CarteMarche({ symbole, nom, cotation, suivi, apres }: { symbole: string; nom: string; cotation?: Cotation; suivi: boolean; apres: () => void }) {
    const veille = cotation && cotation.variation !== null ? cotation.prix - cotation.variation : undefined;
    return (
        <div className="carte flex flex-col p-3 hover:shadow-carte">
            <Link to={lienValeur(symbole)} className="text-texte">
                <div className="flex items-center justify-between gap-2">
                    <span className="truncate text-[13px] font-medium">{nom}</span>
                    <Pastille n={cotation?.variation_pct} />
                </div>
                <div className="mt-1 flex items-baseline justify-between gap-2">
                    <span className="tabular-nums">{cotation ? prix(cotation.prix) : "–"}</span>
                    <span className="text-xs">
                        <Variation valeur={cotation?.variation} dec={cotation && decimales(cotation.prix)} />
                    </span>
                </div>
                {suivi && (
                    <div className="mt-2">
                        <MiniCourbe symbole={symbole} clotureVeille={veille} />
                    </div>
                )}
            </Link>
            {!suivi && <SuivreDiscret symbole={symbole} apres={apres} />}
        </div>
    );
}

/** Small text link variant of the follow button, for the market cards. */
function SuivreDiscret({ symbole, apres }: { symbole: string; apres: () => void }) {
    const [etat, setEtat] = useState<"repos" | "envoi" | "fait" | "erreur">("repos");
    const suivre = async () => {
        setEtat("envoi");
        try {
            await envoyer("/instruments", { symbole });
            setEtat("fait");
            setTimeout(apres, 4000);
        } catch {
            setEtat("erreur");
        }
    };
    return (
        <div className="mt-2 flex h-11 items-center justify-center text-xs">
            {etat === "fait" ? (
                <span className="text-muet">Historique en chargement…</span>
            ) : (
                <button type="button" className="cursor-pointer font-medium text-accent disabled:opacity-50" onClick={suivre} disabled={etat === "envoi"}>
                    {etat === "erreur" ? "Échec, réessayer" : "Suivre pour la courbe"}
                </button>
            )}
        </div>
    );
}

type Vue = "actives" | "toutes" | "hausses" | "baisses";
const VUES: { id: Vue; libelle: string }[] = [
    { id: "actives", libelle: "Plus actives" },
    { id: "toutes", libelle: "Toutes mes valeurs" },
    { id: "hausses", libelle: "Hausses" },
    { id: "baisses", libelle: "Baisses" },
];
const TITRES: Record<Vue, string> = {
    actives: "Les plus actives de mon portefeuille",
    toutes: "Toutes mes valeurs",
    hausses: "Mes valeurs en hausse",
    baisses: "Mes valeurs en baisse",
};

/**
 * Positions of the portfolio today (live quote when available) with their
 * impact in euros. Chips switch between the biggest movers and all lines.
 */
function MesValeurs({ cotations }: { cotations: Map<string, Cotation> }) {
    const [vue, setVue] = useState<Vue>("actives");
    const { donnees, erreur } = useApi<ReponsePositions>("/positions");
    if (erreur) return <Erreur erreur={erreur} />;
    if (!donnees) return <Chargement />;

    // One line per instrument even when it is held on several accounts.
    const parSymbole = new Map<string, LigneJour>();
    for (const l of positionsDuJour(donnees.positions, cotations)) {
        const deja = parSymbole.get(l.symbole);
        parSymbole.set(l.symbole, deja ? { ...deja, valeur: deja.valeur + l.valeur, gain: (deja.gain ?? 0) + (l.gain ?? 0) } : l);
    }
    const toutes = [...parSymbole.values()];
    const pct = (l: (typeof toutes)[number]) => l.pct ?? 0;
    const lignes =
        vue === "actives"
            ? toutes.filter((l) => l.pct !== null).sort((a, b) => Math.abs(pct(b)) - Math.abs(pct(a))).slice(0, 6)
            : vue === "toutes"
              ? toutes.sort((a, b) => b.valeur - a.valeur)
              : vue === "hausses"
                ? toutes.filter((l) => pct(l) > 0).sort((a, b) => pct(b) - pct(a))
                : toutes.filter((l) => pct(l) < 0).sort((a, b) => pct(a) - pct(b));

    return (
        <section className="carte">
            <div className="flex items-baseline justify-between gap-3 px-4 pt-4">
                <h2 className="text-[18px]">{TITRES[vue]}</h2>
                <Link to="/portefeuille" className="shrink-0 text-[13px] font-medium">
                    Portefeuille
                </Link>
            </div>
            <div className="flex gap-2 overflow-x-auto px-4 pt-3 pb-3">
                {VUES.map((v) => (
                    <button key={v.id} type="button" className={`puce shrink-0 ${v.id === vue ? "puce-active" : ""}`} onClick={() => setVue(v.id)}>
                        {v.libelle}
                    </button>
                ))}
            </div>
            {lignes.length === 0 ? (
                <p className="border-t border-filet px-4 py-6 text-muet">Aucune valeur.</p>
            ) : (
                <ul>
                    {lignes.map((l) => (
                        <li key={l.symbole} className="border-t border-filet">
                            <Link to={lienValeur(l.symbole)} className="flex items-center gap-3 px-4 py-3 text-texte hover:bg-surface-2/60">
                                <Badge symbole={l.symbole} />
                                <span className="min-w-0 flex-1">
                                    <span className="block truncate">{l.nom || l.symbole}</span>
                                    <span className="block text-xs text-muet">{euros(l.valeur)} détenus</span>
                                </span>
                                <span className="hidden w-24 text-right tabular-nums sm:inline">{montant(l.cours, l.devise)}</span>
                                <span className="w-24 text-right text-[13px]">
                                    <Variation valeur={l.gain} dec={2} />
                                </span>
                                <span className="w-20 text-right">
                                    <Pastille n={l.pct} />
                                </span>
                            </Link>
                        </li>
                    ))}
                </ul>
            )}
        </section>
    );
}

export default function Accueil() {
    const { donnees: instruments, erreur, recharger } = useInstruments();
    const suivis = new Set((instruments ?? []).map((i) => i.symbole));
    const { parSymbole: cotations } = useCotations([...suivis, ...MARCHES.map((m) => m.symbole)]);

    if (erreur) return <Erreur erreur={erreur} recharger={recharger} />;
    if (!instruments) return <Chargement />;

    return (
        <div className="flex flex-col gap-6">
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5" aria-label="Marchés">
                {MARCHES.map((m) => (
                    <CarteMarche key={m.symbole} symbole={m.symbole} nom={m.nom} cotation={cotations.get(m.symbole)} suivi={suivis.has(m.symbole)} apres={recharger} />
                ))}
            </section>

            <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
                <div className="min-w-0">
                    <MesValeurs cotations={cotations} />
                </div>
                <aside className="flex flex-col gap-6">
                    <CartePortefeuille cotations={cotations} />
                </aside>
            </div>
        </div>
    );
}
