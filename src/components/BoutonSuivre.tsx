import { Plus } from "lucide-react";
import { useState } from "react";
import { envoyer, ErreurApi } from "../lib/api";

/** Adds a symbol to the API (POST /instruments); its history then loads in the background. */
export default function BoutonSuivre({ symbole, apres }: { symbole: string; apres: () => void }) {
    const [etat, setEtat] = useState<{ phase: "repos" | "envoi" | "ajoute" | "erreur"; message?: string }>({ phase: "repos" });

    const suivre = async () => {
        setEtat({ phase: "envoi" });
        try {
            await envoyer("/instruments", { symbole });
            setEtat({ phase: "ajoute" });
            setTimeout(apres, 4000);
        } catch (e) {
            const message = e instanceof ErreurApi && e.statut === 404 ? `Yahoo Finance ne connaît pas le symbole ${symbole}.` : (e as Error).message;
            setEtat({ phase: "erreur", message });
        }
    };

    if (etat.phase === "ajoute") return <p className="text-hausse">Ajouté. L'historique se charge, la page se met à jour dans quelques secondes.</p>;
    return (
        <div className="flex flex-col items-center gap-2">
            <button type="button" className="bouton" onClick={suivre} disabled={etat.phase === "envoi"}>
                <Plus className="size-4" aria-hidden /> Suivre {symbole}
            </button>
            {etat.message && <p className="text-baisse">{etat.message}</p>}
        </div>
    );
}
