import { ArrowDown, ArrowUp } from "lucide-react";
import { couleur, pct, signe } from "../lib/format";

/** Change pill: arrow and percentage on a light green or red background. */
export function Pastille({ n, grande = false }: { n?: number | null; grande?: boolean }) {
    if (n === null || n === undefined || Number.isNaN(n)) return <span className="text-muet">–</span>;
    const hausse = n > 0;
    const baisse = n < 0;
    const Fleche = baisse ? ArrowDown : ArrowUp;
    return (
        <span
            className={`inline-flex items-center gap-0.5 rounded-md font-medium tabular-nums ${grande ? "px-2 py-1 text-[15px]" : "px-1.5 py-0.5 text-[13px]"} ${
                hausse ? "bg-hausse-fond text-hausse" : baisse ? "bg-baisse-fond text-baisse" : "bg-surface-2 text-muet"
            }`}
        >
            {(hausse || baisse) && <Fleche className={grande ? "size-4" : "size-3.5"} strokeWidth={2.5} aria-hidden />}
            {pct(Math.abs(n), false)}
        </span>
    );
}

/** Signed amount in green or red, optionally followed by a suffix ("aujourd'hui"). */
export function Variation({ valeur, dec, suffixe }: { valeur?: number | null; dec?: number; suffixe?: string }) {
    return (
        <span className={`font-medium tabular-nums ${couleur(valeur)}`}>
            {signe(valeur, dec)}
            {suffixe && valeur !== null && valeur !== undefined && <span className="ml-1 font-normal text-muet">{suffixe}</span>}
        </span>
    );
}

/** Percentage as coloured text, for dense tables. */
export function Pct({ n }: { n?: number | null }) {
    return <span className={`tabular-nums ${couleur(n)}`}>{pct(n)}</span>;
}
