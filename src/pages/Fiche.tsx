import { ChevronRight } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import BoutonSuivre from "../components/BoutonSuivre";
import { Chargement, Erreur } from "../components/Etat";
import GraphiqueInstrument, { finSeance } from "../components/GraphiqueInstrument";
import Infos, { si, utile, type Partie } from "../components/Infos";
import JaugeVolume from "../components/JaugeVolume";
import TableauOperations from "../components/TableauOperations";
import { Pastille, Pct, Variation } from "../components/Variation";
import { enc, qs, useApi } from "../lib/api";
import { lienValeur, useCotations, usePerformances } from "../lib/donnees";
import { couleur, date, jourParis, decimales, ETATS_MARCHE, euros, horodatage, montant, prix, quantite, TYPES_INSTRUMENT } from "../lib/format";
import { derniersJours, plage } from "../lib/periodes";
import type { Cotation, FicheInstrument, Operation, ReponseCours, ReponseIntraday, ReponsePositions } from "../lib/types";

function FilAriane({ symbole }: { symbole: string }) {
    return (
        <nav className="mb-3 flex items-center gap-1 text-xs font-medium text-muet uppercase" aria-label="Fil d'Ariane">
            <Link to="/" className="text-muet hover:text-accent">
                Accueil
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <span>{symbole}</span>
        </nav>
    );
}

function LigneMeta({ cotation, fiche }: { cotation?: Cotation; fiche?: FicheInstrument }) {
    const parties = [cotation?.etat_marche && `${ETATS_MARCHE[cotation.etat_marche] ?? cotation.etat_marche}${cotation.heure ? ` : ${horodatage(cotation.heure)}` : ""}`, !cotation && fiche?.dernier_cours && `Clôture du ${date(fiche.dernier_cours.jour)}`, cotation?.devise ?? fiche?.devise, fiche?.fuseau].filter(Boolean);
    return <div className="mt-1 text-xs text-muet">{parties.join(" · ")}</div>;
}

function NonSuivi({ symbole, recharger }: { symbole: string; recharger: () => void }) {
    const { parSymbole } = useCotations([symbole]);
    const cotation = parSymbole.get(symbole);
    return (
        <div>
            <FilAriane symbole={symbole} />
            <h1 className="text-[24px]">{cotation?.nom ?? symbole}</h1>
            {cotation && (
                <>
                    <div className="mt-2 flex flex-wrap items-center gap-x-3">
                        <span className="text-[36px] leading-tight tabular-nums">{prix(cotation.prix)}</span>
                        <Pastille n={cotation.variation_pct} grande />
                        <Variation valeur={cotation.variation} dec={decimales(cotation.prix)} suffixe="aujourd'hui" />
                    </div>
                    <LigneMeta cotation={cotation} />
                </>
            )}
            <div className="carte mt-6 flex flex-col items-center gap-3 px-4 py-10 text-center text-muet">
                <p>Cet instrument n'est pas suivi par l'API : son historique n'est pas stocké.</p>
                <BoutonSuivre symbole={symbole} apres={recharger} />
            </div>
        </div>
    );
}

function Statistiques({ fiche, cotation }: { fiche: FicheInstrument; cotation?: Cotation }) {
    const { donnees: an } = useApi<ReponseCours>(`/cours/${enc(fiche.symbole)}`);
    const { parSymbole } = usePerformances([fiche.symbole]);
    const v = parSymbole.get(fiche.symbole)?.variations;
    const d = fiche.dernier_cours;
    const cours = an?.cours ?? [];
    const haut52 = cours.length ? Math.max(...cours.map((c) => c.haut ?? c.cloture)) : undefined;
    const bas52 = cours.length ? Math.min(...cours.map((c) => c.bas ?? c.cloture)) : undefined;
    const recents = cours.slice(-63).map((c) => c.volume ?? 0);
    const volMoyen = recents.length ? recents.reduce((a, b) => a + b, 0) / recents.length : undefined;
    const variationAn = cours.length > 1 ? (cours[cours.length - 1].cloture / cours[0].cloture - 1) * 100 : undefined;
    const veille = cotation && cotation.variation !== null ? cotation.prix - cotation.variation : d?.cloture;
    const indice = fiche.type === "INDEX";
    // While the market is open the session volume is partial: compare it with
    // the share of the average volume expected at this time (linear over the session).
    const p1 = plage("1j");
    const { donnees: jour } = useApi<ReponseIntraday>(`/cours/${enc(fiche.symbole)}/intraday${qs({ du: p1.du, au: p1.au, intervalle: p1.intervalle })}`);
    let fraction = 1;
    let volumeSeance = d?.volume ?? null;
    if (jour && d && cotation?.etat_marche === "REGULAR") {
        const barres = derniersJours(jour.cours, 1, (b) => b.horodatage);
        const fin = barres.length && jourParis(barres[0].horodatage) === d.jour ? finSeance(jour.cours, barres) : undefined;
        if (fin) {
            // Same span for volume and average: up to the end of the last bar received.
            const t0 = Date.parse(barres[0].horodatage);
            const dernier = barres[barres.length - 1];
            const tFin = Date.parse(dernier.horodatage) + dernier.intervalle * 60_000;
            fraction = Math.min(1, Math.max(0.05, (tFin - t0) / (Date.parse(fin) - t0)));
            // The stored daily volume lags behind the 15-min bars during the session.
            volumeSeance = Math.max(volumeSeance ?? 0, barres.reduce((t, b) => t + (b.volume ?? 0), 0));
        }
    }
    const plageJour = d?.bas != null && d?.haut != null && d.haut > 0 ? `${prix(d.bas)} - ${prix(d.haut)}` : null;

    return (
        <Infos
            parties={[
                {
                    titre: `Séance${d ? ` du ${date(d.jour)}` : ""}`,
                    lignes: [
                        ["Clôture précédente", si(veille, prix)],
                        ["Ouverture", si(d?.ouverture, prix)],
                        ["Plage du jour", plageJour],
                        ["Volume", si(volumeSeance, (n) => <JaugeVolume volume={n} moyenne={volMoyen && volMoyen * fraction} enCours={fraction < 1} />)],
                    ],
                },
                // An index keeps only the session: performances and the yearly range are left out.
                !indice && {
                    titre: "Performances",
                    lignes: [
                        ["1 semaine", si(v?.semaine, (n) => <Pct n={n} />)],
                        ["1 mois", si(v?.mois, (n) => <Pct n={n} />)],
                        ["Depuis le 1er janvier", si(v?.debut_annee, (n) => <Pct n={n} />)],
                        ["1 an", si(variationAn, (n) => <Pct n={n} />)],
                    ],
                },
                !indice && {
                    titre: "Sur 1 an",
                    lignes: [
                        ["Plus bas - plus haut", bas52 !== undefined && haut52 !== undefined ? `${prix(bas52)} - ${prix(haut52)}` : null],
                    ],
                },
            ].filter((p): p is Partie => !!p)}
        />
    );
}

function APropos({ fiche }: { fiche: FicheInstrument }) {
    return (
        <Infos
            titre="À propos"
            parties={[
                {
                    titre: "Instrument",
                    lignes: [
                        ["Type", TYPES_INSTRUMENT[fiche.type] ?? fiche.type],
                        ["Devise", fiche.devise || null],
                        ["Fuseau de la place", fiche.fuseau || null],
                    ],
                },
                {
                    titre: "Historique stocké",
                    lignes: [
                        ["Depuis le", fiche.historique?.premier_jour ? date(fiche.historique.premier_jour) : null],
                        ["Séances", si(fiche.historique?.seances, (n) => n.toLocaleString("fr-FR"))],
                    ],
                },
            ]}
            pied={
                <Link to={`${lienValeur(fiche.symbole)}/historique`} className="font-medium">
                    Cours historiques
                </Link>
            }
        />
    );
}

function MaPosition({ symbole }: { symbole: string }) {
    const { donnees } = useApi<ReponsePositions>("/positions?soldees=true");
    const lignes = (donnees?.positions ?? []).filter((p) => p.symbole === symbole);
    if (!lignes.length) return null;
    const avecRealisee = lignes.some((p) => utile(p.plus_value_realisee_eur));
    const avecDividendes = lignes.some((p) => utile(p.dividendes_eur));
    return (
        <section className="carte">
            <h2 className="titre-carte">Ma position</h2>
            <div className="overflow-x-auto">
                <table className="tableau">
                    <thead>
                        <tr>
                            <th>Compte</th>
                            <th>Quantité</th>
                            <th>PRU</th>
                            <th>Valeur</th>
                            <th>Plus-value</th>
                            {avecRealisee && <th>Réalisée</th>}
                            {avecDividendes && <th>Dividendes</th>}
                        </tr>
                    </thead>
                    <tbody>
                        {lignes.map((p) => (
                            <tr key={p.compte}>
                                <td>
                                    <Link to={`/portefeuille?compte=${enc(p.compte)}`}>{p.compte}</Link>
                                </td>
                                <td>{quantite(p.quantite)}</td>
                                <td>{montant(p.pru, p.devise)}</td>
                                <td className="font-medium">{euros(p.valeur_eur)}</td>
                                <td>
                                    <span className="inline-flex items-center gap-2">
                                        <span className={couleur(p.plus_value_latente_eur)}>{euros(p.plus_value_latente_eur, true)}</span>
                                        <Pastille n={p.rendement_pct} />
                                    </span>
                                </td>
                                {avecRealisee && <td className={couleur(p.plus_value_realisee_eur)}>{euros(p.plus_value_realisee_eur, true)}</td>}
                                {avecDividendes && <td>{euros(p.dividendes_eur)}</td>}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </section>
    );
}

function Operations({ symbole }: { symbole: string }) {
    const { donnees } = useApi<Operation[]>(`/operations${qs({ symbole })}`);
    if (!donnees?.length) return null;
    return (
        <section className="carte">
            <h2 className="titre-carte">Mes opérations</h2>
            <TableauOperations operations={[...donnees].reverse()} sansNom />
        </section>
    );
}

export default function Fiche() {
    const symbole = useParams().symbole ?? "";
    const { donnees: fiche, erreur, recharger } = useApi<FicheInstrument>(`/instruments/${enc(symbole)}`);
    const { parSymbole } = useCotations([symbole]);
    const cotation = parSymbole.get(symbole);

    if (erreur?.statut === 404) return <NonSuivi symbole={symbole} recharger={recharger} />;
    if (erreur) return <Erreur erreur={erreur} recharger={recharger} />;
    if (!fiche || fiche.symbole.toUpperCase() !== symbole.toUpperCase()) return <Chargement />;

    const cours = cotation?.prix ?? fiche.dernier_cours?.cloture;
    const veille = cotation && cotation.variation !== null ? cotation.prix - cotation.variation : undefined;

    return (
        <div>
            <FilAriane symbole={fiche.symbole} />
            <h1 className="text-[24px] leading-8">{fiche.nom}</h1>
            {fiche.historique_charge === false && <p className="mt-1 text-xs text-alerte">Historique en cours de chargement.</p>}

            <div className="mt-2 grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_360px] lg:grid-rows-[auto_1fr]">
                <div className="min-w-0 lg:col-start-1">
                    <GraphiqueInstrument
                        key={fiche.symbole}
                        symbole={fiche.symbole}
                        premierJour={fiche.historique?.premier_jour}
                        clotureVeille={veille}
                        entete={(v) => (
                            <div className="mb-4">
                                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                                    <span className="text-[36px] leading-tight tabular-nums">
                                        {prix(cours)} <span className="text-[16px] text-muet">{fiche.devise}</span>
                                    </span>
                                    <Pastille n={v?.pct ?? cotation?.variation_pct} grande />
                                    <Variation valeur={v?.valeur ?? cotation?.variation} dec={decimales(cours ?? 1)} suffixe={v?.libelle ?? "aujourd'hui"} />
                                </div>
                                <LigneMeta cotation={cotation} fiche={fiche} />
                            </div>
                        )}
                    />
                </div>
                <aside className="flex flex-col gap-6 lg:col-start-2 lg:row-span-2 lg:row-start-1">
                    <Statistiques fiche={fiche} cotation={cotation} />
                    <APropos fiche={fiche} />
                </aside>
                <div className="flex min-w-0 flex-col gap-6 lg:col-start-1">
                    <MaPosition symbole={fiche.symbole} />
                    <Operations symbole={fiche.symbole} />
                </div>
            </div>
        </div>
    );
}
