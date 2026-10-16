import { LoaderCircle, TriangleAlert } from "lucide-react";
import type { ErreurApi } from "../lib/api";

export function Chargement({ texte = "Chargement…" }: { texte?: string }) {
    return (
        <div className="flex items-center gap-2 py-8 text-muet">
            <LoaderCircle className="size-5 animate-spin text-accent" aria-hidden />
            {texte}
        </div>
    );
}

export function Erreur({ erreur, recharger }: { erreur: ErreurApi; recharger?: () => void }) {
    const conseil =
        erreur.statut === 401
            ? "La clé API est absente ou fausse : vérifier API_KEY dans le .env du site."
            : erreur.statut === 0 || erreur.statut >= 502
              ? "Vérifier que la Raspberry est allumée et que le VPN ou le réseau local est disponible."
              : null;
    return (
        <div className="my-3 flex items-start gap-3 rounded-lg bg-alerte-fond px-4 py-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-alerte" aria-hidden />
            <div>
                <div className="font-medium">{erreur.message}</div>
                {conseil && <div className="text-muet">{conseil}</div>}
                {recharger && (
                    <button type="button" className="mt-1 cursor-pointer font-medium text-accent" onClick={recharger}>
                        Réessayer
                    </button>
                )}
            </div>
        </div>
    );
}
