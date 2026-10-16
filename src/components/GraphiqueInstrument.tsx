import { useState, type ReactNode } from "react";
import { enc, qs, useApi } from "../lib/api";
import { date, horodatage, jourParis, moisAnnee, prix } from "../lib/format";
import { derniersJours, plage, type Periode } from "../lib/periodes";
import { DEPUIS } from "../lib/periodes-libelles";
import type { BarreIntraday, ReponseCours, ReponseIntraday } from "../lib/types";
import ChoixPeriode from "./ChoixPeriode";
import { Erreur } from "./Etat";
import Graphique from "./Graphique";

export interface VariationPeriode {
    valeur: number;
    pct: number;
    libelle: string;
}

interface Props {
    symbole: string;
    premierJour?: string | null;
    /** Previous close: dotted line and base of the change on the 1-day view. */
    clotureVeille?: number | null;
    hauteur?: number;
    /** Renders the price header from the change over the selected range. */
    entete?: (variation: VariationPeriode | null) => ReactNode;
}

/**
 * End of the current session for the 1-day view, so the curve stops where
 * "now" is: start of today's first bar plus the length of the previous session.
 */
export function finSeance(barres: BarreIntraday[], dernierJour: BarreIntraday[]): string | undefined {
    if (!dernierJour.length) return undefined;
    const jour = jourParis(dernierJour[0].horodatage);
    const veille = barres.filter((b) => jourParis(b.horodatage) < jour);
    const dernierJourVeille = veille.length ? jourParis(veille[veille.length - 1].horodatage) : null;
    const seance = veille.filter((b) => jourParis(b.horodatage) === dernierJourVeille);
    if (seance.length < 2) return undefined;
    const duree = Date.parse(seance[seance.length - 1].horodatage) - Date.parse(seance[0].horodatage);
    return new Date(Date.parse(dernierJour[0].horodatage) + duree).toISOString();
}

/** Price chart of one instrument with the Google Finance range tabs. */
export default function GraphiqueInstrument({ symbole, premierJour, clotureVeille, hauteur = 320, entete }: Props) {
    const [periode, setPeriode] = useState<Periode>("1j");
    const p = plage(periode, premierJour);
    const chemin = p.intraday
        ? `/cours/${enc(symbole)}/intraday${qs({ du: p.du, au: p.au, intervalle: p.intervalle })}`
        : `/cours/${enc(symbole)}${qs({ debut: p.du, fin: p.au, intervalle: p.intervalle })}`;
    const { donnees, erreur, chargement } = useApi<ReponseIntraday | ReponseCours>(chemin);

    let x: string[] = [];
    let y: number[] = [];
    let finTemps: string | undefined;
    // While a new range loads, the previous response is kept: only use it if it matches.
    if (donnees && "du" in donnees === p.intraday) {
        if ("du" in donnees) {
            const barres = derniersJours(donnees.cours, p.jours ?? 1, (b) => b.horodatage);
            x = barres.map((b) => b.horodatage);
            y = barres.map((b) => b.cloture);
            if (periode === "1j") finTemps = finSeance(donnees.cours, barres);
        } else {
            x = donnees.cours.map((c) => c.jour);
            y = donnees.cours.map((c) => c.cloture);
        }
    }

    const reference = periode === "1j" && clotureVeille ? clotureVeille : undefined;
    const depart = reference ?? y[0];
    const arrivee = y[y.length - 1];
    // 1-day change comes from the quote (the header keeps it): only other ranges are computed.
    const variation = periode !== "1j" && y.length && depart ? { valeur: arrivee - depart, pct: ((arrivee - depart) / depart) * 100, libelle: DEPUIS[periode] } : null;

    return (
        <div>
            {entete?.(variation)}
            <ChoixPeriode valeur={periode} onChange={setPeriode} />
            <div className="pt-3">
                {erreur ? (
                    <Erreur erreur={erreur} />
                ) : (
                    <div className={chargement ? "opacity-50 transition-opacity" : "transition-opacity"}>
                        <Graphique
                            x={x}
                            series={[{ nom: symbole, valeurs: y }]}
                            reference={reference ? { valeur: reference, libelle: "Clôture précédente" } : undefined}
                            finTemps={finTemps}
                            graduation={p.graduation}
                            formatY={prix}
                            formatX={(v) => (p.intraday ? horodatage(v) : p.intervalle === "1d" ? date(v) : p.intervalle === "1wk" ? `sem. du ${date(v)}` : moisAnnee(v))}
                            hauteur={hauteur}
                        />
                    </div>
                )}
            </div>
        </div>
    );
}
