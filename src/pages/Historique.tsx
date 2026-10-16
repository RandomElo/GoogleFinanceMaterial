import { Download } from "lucide-react";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import { Chargement, Erreur } from "../components/Etat";
import { enc, qs, useApi } from "../lib/api";
import { lienValeur } from "../lib/donnees";
import { date, decaler, jourParis, moisAnnee, nombre, prix } from "../lib/format";
import type { ReponseCours } from "../lib/types";

const PAR_PAGE = 30;
const INTERVALLES = [
    { id: "1d", libelle: "Journalier" },
    { id: "1wk", libelle: "Hebdomadaire" },
    { id: "1mo", libelle: "Mensuel" },
];

function exporterCsv(r: ReponseCours) {
    const lignes = ["jour;ouverture;haut;bas;cloture;cloture_ajustee;volume", ...r.cours.map((c) => [c.jour, c.ouverture, c.haut, c.bas, c.cloture, c.cloture_ajustee, c.volume].map((v) => (v ?? "").toString().replace(".", ",")).join(";"))];
    const url = URL.createObjectURL(new Blob([lignes.join("\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `${r.symbole}_${r.debut}_${r.fin}_${r.intervalle}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

/** Historical prices table, like the old "Historical prices" page. */
export default function Historique() {
    const symbole = useParams().symbole ?? "";
    const [params, setParams] = useSearchParams();
    const auj = jourParis();
    const fin = params.get("fin") ?? auj;
    const debut = params.get("debut") ?? decaler(auj, { ans: -1 });
    const intervalle = params.get("intervalle") ?? "1d";
    const [page, setPage] = useState(0);
    const [saisie, setSaisie] = useState({ debut, fin, intervalle });

    const { donnees, erreur, chargement, recharger } = useApi<ReponseCours>(`/cours/${enc(symbole)}${qs({ debut, fin, intervalle })}`);
    const cours = donnees ? [...donnees.cours].reverse() : [];
    const pages = Math.max(1, Math.ceil(cours.length / PAR_PAGE));
    const visibles = cours.slice(page * PAR_PAGE, (page + 1) * PAR_PAGE);

    const appliquer = (e: React.FormEvent) => {
        e.preventDefault();
        setPage(0);
        setParams(saisie);
    };

    return (
        <div className="flex flex-col gap-4">
            <div>
                <nav className="mb-3 text-xs font-medium text-muet uppercase">
                    <Link to="/" className="text-muet hover:text-accent">Accueil</Link> › <Link to={lienValeur(symbole)} className="text-muet hover:text-accent">{symbole}</Link> › Historique
                </nav>
                <h1 className="text-[24px]">
                    Cours historiques : <Link to={lienValeur(symbole)}>{donnees?.nom ?? symbole}</Link>
                </h1>
                {donnees && (
                    <div className="text-xs text-muet">
                        {symbole} · {donnees.devise}
                    </div>
                )}
            </div>

            <form onSubmit={appliquer} className="carte flex flex-wrap items-end gap-3 p-4">
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Du
                    <input type="date" className="champ text-texte" value={saisie.debut} max={saisie.fin} onChange={(e) => setSaisie({ ...saisie, debut: e.target.value })} required />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Au
                    <input type="date" className="champ text-texte" value={saisie.fin} min={saisie.debut} max={auj} onChange={(e) => setSaisie({ ...saisie, fin: e.target.value })} required />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Intervalle
                    <select className="champ text-texte" value={saisie.intervalle} onChange={(e) => setSaisie({ ...saisie, intervalle: e.target.value })}>
                        {INTERVALLES.map((i) => (
                            <option key={i.id} value={i.id}>
                                {i.libelle}
                            </option>
                        ))}
                    </select>
                </label>
                <button type="submit" className="bouton-plein">
                    Mettre à jour
                </button>
                {donnees && donnees.cours.length > 0 && (
                    <button type="button" className="bouton ml-auto" onClick={() => exporterCsv(donnees)}>
                        <Download className="size-3.5" aria-hidden /> Télécharger (CSV)
                    </button>
                )}
            </form>

            {erreur ? (
                <Erreur erreur={erreur} recharger={recharger} />
            ) : chargement && !donnees ? (
                <Chargement />
            ) : (
                <>
                    <div className="carte overflow-x-auto">
                        <table className="tableau">
                            <thead>
                                <tr>
                                    <th>Date</th>
                                    <th>Ouverture</th>
                                    <th>Plus haut</th>
                                    <th>Plus bas</th>
                                    <th>Clôture</th>
                                    <th>Clôture ajustée</th>
                                    <th>Volume</th>
                                </tr>
                            </thead>
                            <tbody>
                                {visibles.map((c) => (
                                    <tr key={c.jour}>
                                        <td>{intervalle === "1mo" ? moisAnnee(c.jour) : date(c.jour)}</td>
                                        <td>{prix(c.ouverture)}</td>
                                        <td>{prix(c.haut)}</td>
                                        <td>{prix(c.bas)}</td>
                                        <td className="font-medium">{prix(c.cloture)}</td>
                                        <td>{prix(c.cloture_ajustee)}</td>
                                        <td>{nombre(c.volume, 0)}</td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                    {cours.length === 0 ? (
                        <p className="text-muet">Aucun cours sur cette période.</p>
                    ) : (
                        <div className="flex items-center justify-end gap-3 text-[13px]">
                            <span className="text-muet">
                                {page * PAR_PAGE + 1} – {Math.min((page + 1) * PAR_PAGE, cours.length)} sur {cours.length}
                            </span>
                            <button type="button" className="bouton" disabled={page === 0} onClick={() => setPage(page - 1)}>
                                ‹ Plus récents
                            </button>
                            <button type="button" className="bouton" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
                                Plus anciens ›
                            </button>
                        </div>
                    )}
                </>
            )}
        </div>
    );
}
