import { Link } from "react-router-dom";
import { lienValeur } from "../lib/donnees";
import Badge from "./Badge";
import { date, montant, quantite } from "../lib/format";
import type { Operation } from "../lib/types";

const TYPES = { achat: "Achat", vente: "Vente", dividende: "Dividende" } as const;

/** Cash amount of an operation: what was paid (purchase) or received (sale, dividend). */
export function montantOperation(o: Operation): number | null {
    if (o.type === "dividende") return o.montant ?? (o.quantite ?? 0) * (o.prix ?? 0);
    if (o.quantite === null || o.prix === null) return o.montant;
    const brut = o.quantite * o.prix;
    const frais = o.frais ?? (o.courtage ?? 0) + (o.ttf ?? 0);
    return o.type === "achat" ? brut + frais : brut - frais;
}

export default function TableauOperations({ operations, sansNom = false }: { operations: Operation[]; sansNom?: boolean }) {
    const avecFrais = operations.some((o) => o.type !== "dividende" && (o.frais ?? 0) !== 0);
    return (
        <div className="overflow-x-auto">
            <table className="tableau">
                <thead>
                    <tr>
                        <th>Date</th>
                        <th className="text-left!">Type</th>
                        {!sansNom && <th className="text-left!">Nom</th>}
                        <th className="text-left!">Compte</th>
                        <th>Quantité</th>
                        <th>Prix</th>
                        {avecFrais && <th>Frais</th>}
                        <th>Montant</th>
                        <th>Source</th>
                    </tr>
                </thead>
                <tbody>
                    {operations.map((o) => (
                        <tr key={o.id}>
                            <td>{date(o.jour)}</td>
                            <td className={`text-left! ${o.type === "vente" ? "text-baisse" : o.type === "dividende" ? "text-hausse" : ""}`}>{TYPES[o.type] ?? o.type}</td>
                            {!sansNom && (
                                <td className="max-w-56 truncate text-left!">
                                    <Link to={lienValeur(o.symbole)} className="flex items-center gap-3 text-texte">
                                        <Badge symbole={o.symbole} />
                                        <span className="truncate">{o.nom || o.symbole}</span>
                                    </Link>
                                </td>
                            )}
                            <td className="text-left!">{o.compte}</td>
                            <td>{quantite(o.quantite)}</td>
                            <td>{montant(o.prix)}</td>
                            {avecFrais && <td>{o.type === "dividende" || !o.frais ? "" : montant(o.frais)}</td>}
                            <td className="font-medium">{montant(montantOperation(o))}</td>
                            <td className="text-xs text-muet" title={o.onglet_source}>
                                {o.onglet_source === "Dividendes" ? "Div." : "Hist."} l. {o.ligne_source}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
}
