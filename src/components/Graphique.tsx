import { useCallback, useId, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { annee, heure, nombre, jourMois, jourParis, jourSemaine, mois, moisAnnee } from "../lib/format";
import type { Graduation } from "../lib/periodes";

export interface Serie {
    nom: string;
    valeurs: (number | null)[];
    /** Dashed neutral line without area (secondary series). */
    secondaire?: boolean;
}

interface Props {
    /** x values: "AAAA-MM-JJ" days or ISO timestamps, one per point. */
    x: string[];
    /** The first series is the main one: line + area, green if up, red if down. */
    series: Serie[];
    reference?: { valeur: number; libelle: string };
    /** Time axis up to this ISO instant (1-day view: the whole session is drawn). */
    finTemps?: string;
    /** Sign that picks the line colour, when it is not "last point vs first" (portfolio: gain net of deposits). */
    sens?: number;
    /** Custom tooltip content for point i (replaces the series values; the date is still shown). */
    infobulle?: (i: number) => ReactNode;
    graduation: Graduation;
    formatY: (n: number) => string;
    formatX: (x: string) => string;
    hauteur?: number;
}

const MARGE = { haut: 34, droite: 12, bas: 26 };

function pasLisible(etendue: number, n: number) {
    const brut = etendue / n;
    const puissance = 10 ** Math.floor(Math.log10(brut));
    const r = brut / puissance;
    return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * puissance;
}

function etiquette(x: string, graduation: Graduation): string {
    switch (graduation) {
        case "heure":
            return heure(x);
        case "jour":
            return jourSemaine(x);
        case "date":
            return jourMois(x);
        case "mois":
            return x.slice(5, 7) === "01" ? moisAnnee(x) : mois(x);
        case "annee":
            return annee(x);
    }
}

function cle(v: string, graduation: Graduation) {
    switch (graduation) {
        case "heure":
            return heure(v).slice(0, 2);
        case "jour":
            return jourParis(v);
        case "date":
            return v;
        case "mois":
            return v.slice(0, 7);
        case "annee":
            return v.slice(0, 4);
    }
}

/** Indices where the x axis gets a label: where the hour/day/month/year changes. */
function graduationsX(x: string[], graduation: Graduation, largeur: number): number[] {
    const candidats: number[] = [];
    for (let i = 1; i < x.length; i++) if (cle(x[i], graduation) !== cle(x[i - 1], graduation)) candidats.push(i);
    const max = Math.max(2, Math.floor(largeur / 80));
    const pas = Math.ceil(candidats.length / max);
    return candidats.filter((_, i) => i % pas === 0);
}

export default function Graphique({ x, series, reference, finTemps, sens, infobulle, graduation, formatY, formatX, hauteur = 300 }: Props) {
    const [largeur, setLargeur] = useState(600);
    const [survol, setSurvol] = useState<number | null>(null);
    const [largeurBulle, setLargeurBulle] = useState(220);
    const idDegrade = useId();

    // Callback ref: the empty state and the chart render different elements,
    // so the observer follows whichever one is mounted.
    const observateur = useRef<ResizeObserver | null>(null);
    const conteneur = useCallback((el: HTMLDivElement | null) => {
        observateur.current?.disconnect();
        if (!el) return;
        setLargeur(Math.max(240, el.getBoundingClientRect().width));
        observateur.current = new ResizeObserver(([e]) => setLargeur(Math.max(240, e.contentRect.width)));
        observateur.current.observe(el);
    }, []);

    const n = x.length;
    const hautPlot = hauteur - MARGE.haut - MARGE.bas;

    const echelle = useMemo(() => {
        const valeurs = series.flatMap((s) => s.valeurs).filter((v): v is number => v !== null && Number.isFinite(v));
        if (reference) valeurs.push(reference.valeur);
        if (!valeurs.length) return null;
        let min = Math.min(...valeurs);
        let max = Math.max(...valeurs);
        if (min === max) {
            const d = Math.abs(min) * 0.01 || 1;
            min -= d;
            max += d;
        }
        const pas = pasLisible(max - min, 4);
        const bas = Math.floor(min / pas) * pas;
        const haut = Math.ceil(max / pas) * pas;
        const graduations: number[] = [];
        for (let v = bas; v <= haut + pas / 2; v += pas) graduations.push(Number(v.toPrecision(12)));
        const dec = Math.max(0, Math.min(6, -Math.floor(Math.log10(pas))));
        return { bas, haut, graduations, dec };
    }, [series, reference]);

    // Time axis (1-day view) or one slot per point.
    const temps = useMemo(() => (finTemps ? x.map((v) => Date.parse(v)) : null), [x, finTemps]);
    const t0 = temps?.[0] ?? 0;
    const t1 = finTemps ? Math.max(Date.parse(finTemps), temps?.[temps.length - 1] ?? 0) : 0;

    if (!n || !echelle) {
        return (
            <div ref={conteneur} className="flex items-center justify-center text-muet" style={{ height: hauteur }}>
                Pas de données sur cette période
            </div>
        );
    }

    // Left margin sized to the longest y label.
    const etiquettesY = echelle.graduations.map((v) => nombre(v, echelle.dec));
    const MARGE_GAUCHE = Math.max(36, Math.max(...etiquettesY.map((t) => t.length)) * 7 + 14);
    const larg = largeur - MARGE_GAUCHE - MARGE.droite;

    const px = (i: number) => {
        if (temps && t1 > t0) return MARGE_GAUCHE + ((temps[i] - t0) / (t1 - t0)) * larg;
        return MARGE_GAUCHE + (n <= 1 ? larg / 2 : (i * larg) / (n - 1));
    };
    const py = (v: number) => MARGE.haut + hautPlot - ((v - echelle.bas) / (echelle.haut - echelle.bas)) * hautPlot;
    const basPlot = MARGE.haut + hautPlot;

    const tracer = (valeurs: (number | null)[]) => {
        let d = "";
        let enCours = false;
        valeurs.forEach((v, i) => {
            if (v === null || !Number.isFinite(v)) {
                enCours = false;
                return;
            }
            d += `${enCours ? "L" : "M"}${px(i).toFixed(1)},${py(v).toFixed(1)}`;
            enCours = true;
        });
        return d;
    };

    const principale = series[0];
    const valides = principale.valeurs.flatMap((v, i) => (v === null ? [] : [i]));
    const premiere = valides.length ? principale.valeurs[valides[0]]! : 0;
    const derniere = valides.length ? principale.valeurs[valides[valides.length - 1]]! : 0;
    const depart = reference?.valeur ?? premiere;
    const signe = sens ?? derniere - depart;
    const ligne = signe > 0 ? "var(--hausse-ligne)" : signe < 0 ? "var(--baisse-ligne)" : "var(--neutre-ligne)";
    const aire = valides.length > 1 ? `${tracer(principale.valeurs)}L${px(valides[valides.length - 1]).toFixed(1)},${basPlot}L${px(valides[0]).toFixed(1)},${basPlot}Z` : "";

    const graduations = graduationsX(x, graduation, larg);

    const indiceProche = (mx: number) => {
        if (temps && t1 > t0) {
            const t = t0 + (mx / larg) * (t1 - t0);
            let meilleur = 0;
            for (let i = 1; i < n; i++) if (Math.abs(temps[i] - t) < Math.abs(temps[meilleur] - t)) meilleur = i;
            return meilleur;
        }
        return Math.max(0, Math.min(n - 1, Math.round(n <= 1 ? 0 : (mx / larg) * (n - 1))));
    };

    const deplacer = (e: PointerEvent<SVGSVGElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const mx = e.clientX - rect.left - MARGE_GAUCHE;
        if (mx < -10 || mx > larg + 10) return setSurvol(null);
        setSurvol(indiceProche(Math.max(0, Math.min(larg, mx))));
    };

    const iSurvol = survol !== null && survol < n ? survol : null;
    const xSurvol = iSurvol !== null ? px(iSurvol) : 0;

    return (
        <div ref={conteneur} className="relative select-none">
            {series.length > 1 && (
                <div className="mb-1 flex gap-4 text-xs text-muet">
                    {series.map((s, i) => (
                        <span key={s.nom} className="flex items-center gap-1.5">
                            <svg width="18" height="6" aria-hidden>
                                <line x1="0" y1="3" x2="18" y2="3" style={{ stroke: i === 0 ? ligne : "var(--neutre-ligne)" }} strokeWidth="2" strokeDasharray={s.secondaire ? "4 3" : undefined} />
                            </svg>
                            {s.nom}
                        </span>
                    ))}
                </div>
            )}
            <svg width={largeur} height={hauteur} className="block touch-pan-y" onPointerMove={deplacer} onPointerDown={deplacer} onPointerLeave={() => setSurvol(null)} role="img" aria-label={`Graphique ${principale.nom}`}>
                <defs>
                    <linearGradient id={idDegrade} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0" style={{ stopColor: ligne, stopOpacity: 0.18 }} />
                        <stop offset="1" style={{ stopColor: ligne, stopOpacity: 0 }} />
                    </linearGradient>
                </defs>

                {echelle.graduations.map((v, i) => (
                    <g key={v}>
                        <line x1={MARGE_GAUCHE} x2={MARGE_GAUCHE + larg} y1={py(v)} y2={py(v)} style={{ stroke: "var(--filet)" }} />
                        <text x={MARGE_GAUCHE - 10} y={py(v) + 4} fontSize="12" textAnchor="end" style={{ fill: "var(--muet)" }}>
                            {etiquettesY[i]}
                        </text>
                    </g>
                ))}
                {graduations.map((i) => (
                    <text key={i} x={px(i)} y={basPlot + 18} fontSize="12" textAnchor="middle" style={{ fill: "var(--muet)" }}>
                        {etiquette(x[i], graduation)}
                    </text>
                ))}

                {aire && <path d={aire} fill={`url(#${idDegrade})`} />}
                {series.slice(1).map((s) => (
                    <path key={s.nom} d={tracer(s.valeurs)} fill="none" style={{ stroke: "var(--neutre-ligne)" }} strokeWidth={1.5} strokeDasharray="5 4" />
                ))}
                <path d={tracer(principale.valeurs)} fill="none" style={{ stroke: ligne }} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />

                {reference && (
                    <g>
                        <line x1={MARGE_GAUCHE} x2={MARGE_GAUCHE + larg} y1={py(reference.valeur)} y2={py(reference.valeur)} style={{ stroke: "var(--muet)" }} strokeWidth="1" strokeDasharray="1 3" strokeLinecap="round" />
                        <text x={MARGE_GAUCHE + larg} y={py(reference.valeur) - 18} fontSize="11" textAnchor="end" style={{ fill: "var(--muet)" }}>
                            {reference.libelle}
                        </text>
                        <text x={MARGE_GAUCHE + larg} y={py(reference.valeur) - 5} fontSize="12" textAnchor="end" style={{ fill: "var(--texte)" }}>
                            {formatY(reference.valeur)}
                        </text>
                    </g>
                )}

                {iSurvol !== null && (
                    <g pointerEvents="none">
                        <line x1={xSurvol} x2={xSurvol} y1={MARGE.haut - 6} y2={basPlot} style={{ stroke: "var(--muet)" }} strokeWidth="1" />
                        {series.map((s, i) => {
                            const v = s.valeurs[iSurvol];
                            return v === null || v === undefined ? null : <circle key={s.nom} cx={xSurvol} cy={py(v)} r="4.5" style={{ fill: i === 0 ? ligne : "var(--neutre-ligne)", stroke: "var(--surface)" }} strokeWidth="2" />;
                        })}
                    </g>
                )}
                {/* Transparent layer so the whole plot is a hit target. */}
                <rect x="0" y="0" width={largeur} height={hauteur} fill="transparent" />
            </svg>

            {iSurvol !== null && (
                <div
                    // Measured so the tooltip stays inside the chart whatever its content.
                    ref={(el) => {
                        if (el && Math.abs(el.offsetWidth - largeurBulle) > 1) setLargeurBulle(el.offsetWidth);
                    }}
                    className="pointer-events-none absolute z-10 rounded-md bg-surface px-2 py-1 text-[13px] whitespace-nowrap shadow-carte"
                    style={{
                        top: series.length > 1 ? 20 : 0,
                        left: Math.max(largeurBulle / 2, Math.min(largeur - largeurBulle / 2, xSurvol)),
                        transform: "translateX(-50%)",
                    }}
                >
                    {infobulle
                        ? infobulle(iSurvol)
                        : series.map((s, i) => (
                              <span key={s.nom} className={i === 0 ? "font-medium" : "ml-2 text-muet"}>
                                  {i > 0 && `${s.nom} `}
                                  {s.valeurs[iSurvol] === null ? "–" : formatY(s.valeurs[iSurvol]!)}
                              </span>
                          ))}
                    <span className="ml-2 text-muet">{formatX(x[iSurvol])}</span>
                </div>
            )}
        </div>
    );
}
