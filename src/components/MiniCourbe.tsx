import { enc, qs, useApi } from "../lib/api";
import { derniersJours, plage } from "../lib/periodes";
import type { ReponseIntraday } from "../lib/types";
import { finSeance } from "./GraphiqueInstrument";

/**
 * Bare intraday line of the last session: no axis, no fill, green or red
 * against the previous close. The x axis covers the whole session.
 */
export default function MiniCourbe({ symbole, clotureVeille, hauteur = 44 }: { symbole: string; clotureVeille?: number; hauteur?: number }) {
    const p = plage("1j");
    const { donnees } = useApi<ReponseIntraday>(`/cours/${enc(symbole)}/intraday${qs({ du: p.du, au: p.au, intervalle: p.intervalle })}`);
    const barres = donnees ? derniersJours(donnees.cours, 1, (b) => b.horodatage) : [];
    if (barres.length < 2) return <div style={{ height: hauteur }} />;

    const t = barres.map((b) => Date.parse(b.horodatage));
    const fin = finSeance(donnees!.cours, barres);
    const t0 = t[0];
    const t1 = Math.max(fin ? Date.parse(fin) : 0, t[t.length - 1]);
    const v = barres.map((b) => b.cloture);
    const min = Math.min(...v);
    const max = Math.max(...v);
    const etendue = max - min || 1;
    const points = v.map((y, i) => `${(((t[i] - t0) / (t1 - t0)) * 100).toFixed(2)},${(((max - y) / etendue) * 92 + 4).toFixed(2)}`).join(" ");
    const reference = clotureVeille ?? v[0];
    const dernier = v[v.length - 1];
    const couleur = dernier > reference ? "var(--hausse-ligne)" : dernier < reference ? "var(--baisse-ligne)" : "var(--neutre-ligne)";

    return (
        <svg viewBox="0 0 100 100" preserveAspectRatio="none" width="100%" height={hauteur} aria-hidden className="block">
            <polyline points={points} fill="none" style={{ stroke: couleur }} strokeWidth="1.5" vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>
    );
}
