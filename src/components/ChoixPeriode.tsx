import { PERIODES, type Periode } from "../lib/periodes";

/** Range tabs "1 J  5 J  1 M …", the active one underlined in blue. */
export default function ChoixPeriode({ valeur, onChange }: { valeur: Periode; onChange: (p: Periode) => void }) {
    return (
        <div className="flex overflow-x-auto border-b border-filet" role="tablist" aria-label="Période">
            {PERIODES.map((p) => {
                const actif = p.id === valeur;
                return (
                    <button
                        key={p.id}
                        type="button"
                        role="tab"
                        aria-selected={actif}
                        onClick={() => onChange(p.id)}
                        className={`-mb-px shrink-0 cursor-pointer border-b-[3px] px-3 py-2 text-[13px] font-medium whitespace-nowrap ${
                            actif ? "border-accent text-accent" : "border-transparent text-muet hover:bg-surface-2 hover:text-texte"
                        }`}
                    >
                        {p.libelle}
                    </button>
                );
            })}
        </div>
    );
}
