import { Search } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { ErreurApi, qs, requete } from "../lib/api";
import { useNavigate } from "react-router-dom";
import { lienValeur, useInstruments } from "../lib/donnees";
import Badge from "./Badge";
import { TYPES_INSTRUMENT } from "../lib/format";

const sansAccents = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "");
const normaliser = (s: string) => sansAccents(s).toLowerCase();

interface Suggestion {
    symbole: string;
    nom: string;
    type?: string;
    place?: string;
    suivi: boolean;
}

interface ReponseRecherche {
    resultats: { symbole: string; nom?: string; type?: string; place?: string; suivi?: boolean }[];
}

// GET /recherche (Yahoo symbol search through the API). Until the API has
// that route, the box only suggests tracked instruments.
let rechercheDisponible = true;

// Yahoo ranks results worldwide: listings in Paris come first for this
// portfolio (PEA/CTO), the rest keeps Yahoo's relevance order.
const PLACES_PREFEREES = ["Paris"];
function trierParPlace(resultats: Suggestion[]): Suggestion[] {
    const rang = (r: Suggestion) => (PLACES_PREFEREES.includes(r.place ?? "") ? 0 : 1);
    return resultats.map((r, i) => ({ r, i })).sort((a, b) => rang(a.r) - rang(b.r) || a.i - b.i).map(({ r }) => r);
}

/** Big search box of the header: tracked instruments first, then Yahoo matches. */
export default function Recherche() {
    const { donnees: instruments = [] } = useInstruments();
    const [texte, setTexte] = useState("");
    const [ouvert, setOuvert] = useState(false);
    const [actif, setActif] = useState(0);
    const [distants, setDistants] = useState<{ texte: string; resultats: Suggestion[] }>({ texte: "", resultats: [] });
    const navigate = useNavigate();
    const champ = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const q = texte.trim();
        if (q.length < 2 || !rechercheDisponible) return;
        let actif = true;
        const minuterie = setTimeout(() => {
            // Yahoo finds nothing with accents ("société" → no result): send them stripped.
            requete<ReponseRecherche>(`/recherche${qs({ q: sansAccents(q) })}`).then(
                (r) =>
                    actif &&
                    setDistants({
                        texte: q,
                        resultats: trierParPlace((r.resultats ?? []).map((x) => ({ symbole: x.symbole, nom: x.nom ?? x.symbole, type: x.type, place: x.place, suivi: !!x.suivi }))),
                    }),
                (e: unknown) => {
                    if (e instanceof ErreurApi && e.statut === 404) rechercheDisponible = false;
                },
            );
        }, 250);
        return () => {
            actif = false;
            clearTimeout(minuterie);
        };
    }, [texte]);

    const suggestions = useMemo<Suggestion[]>(() => {
        const t = normaliser(texte.trim());
        if (!t) return [];
        const locales = instruments
            .map((i) => {
                const s = normaliser(i.symbole);
                const n = normaliser(i.nom ?? "");
                // Symbol or start of a word of the name, not any substring ("sg" must not match "ESG").
                const mots = n.split(/[^a-z0-9]+/);
                const score = s === t ? 0 : s.startsWith(t) ? 1 : n.startsWith(t) ? 2 : mots.some((m) => m.startsWith(t)) ? 3 : 9;
                return { i, score };
            })
            .filter((x) => x.score < 9)
            .sort((a, b) => a.score - b.score || a.i.symbole.localeCompare(b.i.symbole))
            .slice(0, 5)
            .map(({ i }) => ({ symbole: i.symbole, nom: i.nom, type: i.type, suivi: true }));
        const suivis = new Set(instruments.map((i) => i.symbole));
        const autres = distants.texte === texte.trim() ? distants.resultats.filter((r) => !suivis.has(r.symbole)) : [];
        return [...locales, ...autres].slice(0, 10);
    }, [texte, instruments, distants]);

    const aller = (symbole: string) => {
        setTexte("");
        setOuvert(false);
        champ.current?.blur();
        navigate(lienValeur(symbole));
    };

    const valider = (e: FormEvent) => {
        e.preventDefault();
        const choisi = ouvert ? suggestions[actif] : undefined;
        const symbole = choisi?.symbole ?? texte.trim().toUpperCase().replace(/\s+/g, "");
        if (symbole) aller(symbole);
    };

    const clavier = (e: KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "ArrowDown") {
            e.preventDefault();
            setOuvert(true);
            setActif((a) => Math.min(a + 1, suggestions.length - 1));
        } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActif((a) => Math.max(a - 1, 0));
        } else if (e.key === "Escape") {
            setOuvert(false);
        }
    };

    return (
        <form onSubmit={valider} className="relative w-full max-w-[640px]" role="search">
            <div
                className={`flex h-12 items-center gap-3 rounded-full px-4 transition-shadow ${
                    ouvert && suggestions.length ? "rounded-b-none bg-surface shadow-carte" : "bg-surface-2 focus-within:bg-surface focus-within:shadow-carte"
                }`}
            >
                <button type="submit" className="cursor-pointer text-muet" aria-label="Rechercher">
                    <Search className="size-5" aria-hidden />
                </button>
                <input
                    ref={champ}
                    className="h-full min-w-0 flex-1 bg-transparent text-[16px] text-texte outline-none placeholder:text-muet"
                    placeholder="Rechercher des actions, ETF, indices…"
                    value={texte}
                    onChange={(e) => {
                        setTexte(e.target.value);
                        setOuvert(true);
                        setActif(0);
                    }}
                    onFocus={() => setOuvert(true)}
                    onBlur={() => setTimeout(() => setOuvert(false), 150)}
                    onKeyDown={clavier}
                    aria-label="Rechercher une valeur"
                    autoComplete="off"
                    spellCheck={false}
                />
            </div>
            {ouvert && suggestions.length > 0 && (
                <ul className="absolute top-12 right-0 left-0 z-30 overflow-hidden rounded-b-3xl border-t border-filet bg-surface pb-2 shadow-carte">
                    {suggestions.map((i, n) => (
                        <li key={i.symbole}>
                            <button
                                type="button"
                                className={`flex w-full cursor-pointer items-center gap-3 px-4 py-2 text-left ${n === actif ? "bg-surface-2" : ""}`}
                                onMouseDown={(e) => e.preventDefault()}
                                onMouseEnter={() => setActif(n)}
                                onClick={() => aller(i.symbole)}
                            >
                                <Badge symbole={i.symbole} />
                                <span className="min-w-0 flex-1 truncate">{i.nom}</span>
                                <span className="shrink-0 text-right text-xs text-muet">
                                    {i.symbole}
                                    {i.place ? ` · ${i.place}` : ""}
                                    {i.type ? ` · ${TYPES_INSTRUMENT[i.type] ?? i.type}` : ""}
                                    {i.suivi && <span className="ml-2 rounded bg-accent-fond px-1.5 py-0.5 font-medium text-accent-texte">Suivi</span>}
                                </span>
                            </button>
                        </li>
                    ))}
                </ul>
            )}
        </form>
    );
}
