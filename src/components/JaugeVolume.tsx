import { compact } from "../lib/format";

/** Verdict of a session volume compared with its 3-month average. */
function verdict(ratio: number) {
    if (ratio < 0.6) return { libelle: "Faible", couleur: "var(--muet)" };
    if (ratio < 1.3) return { libelle: "Normal", couleur: "var(--accent)" };
    if (ratio < 2) return { libelle: "Élevé", couleur: "var(--hausse-ligne)" };
    return { libelle: "Très élevé", couleur: "var(--baisse-ligne)" };
}

/**
 * Volume of the session on a scale where the middle mark is the average:
 * the bar fills up to twice the average. During the session the average is
 * already scaled to the elapsed time by the caller (`enCours`).
 */
export default function JaugeVolume({ volume, moyenne, enCours = false }: { volume: number; moyenne?: number; enCours?: boolean }) {
    if (!moyenne) return <span>{compact(volume)}</span>;
    const ratio = volume / moyenne;
    const v = verdict(ratio);
    return (
        <span className="flex w-52 max-w-full flex-col items-end gap-1.5" title={enCours ? `Moyenne sur 3 mois ramenée à l'heure actuelle : ${compact(moyenne)}` : `Moyenne sur 3 mois : ${compact(moyenne)}`}>
            <span>{compact(volume)}</span>
            <span className="relative block h-1.5 w-full rounded-full bg-surface-2" aria-hidden>
                <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.min(100, ratio * 50)}%`, background: v.couleur }} />
                <span className="absolute -top-1 left-1/2 h-3.5 w-px bg-muet" />
            </span>
            <span className="text-xs font-normal whitespace-nowrap text-muet">
                <span className="font-medium" style={{ color: v.couleur }}>
                    {v.libelle}
                </span>
                , {ratio.toLocaleString("fr-FR", { maximumFractionDigits: 1 })}× la moyenne{enCours && " à cette heure"}
            </span>
        </span>
    );
}
