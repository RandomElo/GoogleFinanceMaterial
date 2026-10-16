import { RefreshCw } from "lucide-react";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Chargement, Erreur } from "../components/Etat";
import TableauOperations, { montantOperation } from "../components/TableauOperations";
import { envoyer, ErreurApi, qs, useApi } from "../lib/api";
import { euros, horodatage } from "../lib/format";
import type { EtatSynchro, Operation, ReponseComptes } from "../lib/types";

function Synchronisation() {
    const { donnees, recharger } = useApi<EtatSynchro>("/operations/synchronisation");
    const [envoi, setEnvoi] = useState(false);
    const [message, setMessage] = useState<string | null>(null);

    const synchroniser = async () => {
        setEnvoi(true);
        setMessage(null);
        try {
            await envoyer("/operations/synchroniser");
            recharger();
        } catch (e) {
            setMessage(e instanceof ErreurApi && e.statut === 503 ? "La synchronisation n'est pas configurée sur l'API." : (e as Error).message);
        } finally {
            setEnvoi(false);
        }
    };

    const d = donnees?.derniere;
    const erreurs = d?.erreurs ?? [];
    return (
        <div className="carte px-4 py-3 text-[13px]">
            <div className="flex flex-wrap items-center gap-3">
                <span>
                    Google Sheet :{" "}
                    {!donnees ? "…" : !donnees.active ? "synchronisation non configurée" : d?.date ? `synchronisé le ${horodatage(d.date)}${d.ok === false ? " (échec)" : ""}, ${d.operations ?? 0} opérations et ${d.dividendes ?? 0} dividendes` : "jamais synchronisé"}
                </span>
                <button type="button" className="bouton ml-auto" onClick={synchroniser} disabled={envoi || donnees?.active === false}>
                    <RefreshCw className={`size-3.5 ${envoi ? "animate-spin" : ""}`} aria-hidden /> Synchroniser
                </button>
            </div>
            {message && <p className="mt-1 text-baisse">{message}</p>}
            {erreurs.length > 0 && (
                <details className="mt-2 text-alerte">
                    <summary className="cursor-pointer">{erreurs.length} ligne(s) rejetée(s)</summary>
                    <ul className="mt-1 list-disc pl-5">
                        {erreurs.map((e, i) => (
                            <li key={i}>{typeof e === "string" ? e : `${e.onglet ?? ""} ligne ${e.ligne ?? "?"} : ${e.message ?? e.erreur ?? ""}`}</li>
                        ))}
                    </ul>
                </details>
            )}
        </div>
    );
}

export default function Operations() {
    const [params, setParams] = useSearchParams();
    const filtres = {
        compte: params.get("compte") ?? "",
        type: params.get("type") ?? "",
        du: params.get("du") ?? "",
        au: params.get("au") ?? "",
    };
    const { donnees: comptes } = useApi<ReponseComptes>("/comptes");
    const { donnees, erreur, chargement, recharger } = useApi<Operation[]>(`/operations${qs(filtres)}`);
    const operations = donnees ? [...donnees].reverse() : [];

    const changer = (cle: string, valeur: string) => {
        const p = new URLSearchParams(params);
        if (valeur) p.set(cle, valeur);
        else p.delete(cle);
        setParams(p);
    };

    const somme = (type: string) => operations.filter((o) => o.type === type).reduce((s, o) => s + (montantOperation(o) ?? 0), 0);

    return (
        <div className="flex flex-col gap-4">
            <h1 className="text-[24px]">Opérations</h1>
            <Synchronisation />
            <div className="flex flex-wrap items-end gap-3">
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Compte
                    <select className="champ text-texte" value={filtres.compte} onChange={(e) => changer("compte", e.target.value)}>
                        <option value="">Tous</option>
                        {Object.keys(comptes?.comptes ?? {}).map((c) => (
                            <option key={c}>{c}</option>
                        ))}
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Type
                    <select className="champ text-texte" value={filtres.type} onChange={(e) => changer("type", e.target.value)}>
                        <option value="">Tous</option>
                        <option value="achat">Achats</option>
                        <option value="vente">Ventes</option>
                        <option value="dividende">Dividendes</option>
                    </select>
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Du
                    <input type="date" className="champ text-texte" value={filtres.du} onChange={(e) => changer("du", e.target.value)} />
                </label>
                <label className="flex flex-col gap-1 text-xs font-medium text-muet">
                    Au
                    <input type="date" className="champ text-texte" value={filtres.au} onChange={(e) => changer("au", e.target.value)} />
                </label>
            </div>

            {erreur ? (
                <Erreur erreur={erreur} recharger={recharger} />
            ) : chargement && !donnees ? (
                <Chargement />
            ) : (
                <>
                    <div className="flex flex-wrap gap-2">
                        {[
                            ["Opérations", String(operations.length)],
                            ["Achats", euros(somme("achat"))],
                            ["Ventes", euros(somme("vente"))],
                            ["Dividendes", euros(somme("dividende"))],
                        ].map(([l, v]) => (
                            <span key={l} className="carte px-3 py-2">
                                <span className="etiquette mr-2">{l}</span>
                                <span className="font-medium tabular-nums">{v}</span>
                            </span>
                        ))}
                    </div>
                    <section className="carte">{operations.length ? <TableauOperations operations={operations} /> : <p className="p-4 text-muet">Aucune opération.</p>}</section>
                </>
            )}
        </div>
    );
}
