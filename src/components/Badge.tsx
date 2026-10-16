// Coloured ticker badge of the Google Finance lists. The colour is derived
// from the symbol so that a given instrument always gets the same one.
const COULEURS = ["#1a73e8", "#188038", "#e37400", "#d93025", "#9334e6", "#129eaf", "#c5221f", "#1967d2", "#b06000", "#e52592"];

function teinte(symbole: string) {
    let h = 0;
    for (const c of symbole) h = (h * 31 + c.charCodeAt(0)) >>> 0;
    return COULEURS[h % COULEURS.length];
}

export const tickerCourt = (symbole: string) => symbole.replace(/^\^/, "").replace(/(\.[A-Z]+|=X|-[A-Z]{3})$/, "");

export default function Badge({ symbole }: { symbole: string }) {
    return (
        <span
            className="inline-flex h-6 min-w-14 shrink-0 items-center justify-center rounded px-1.5 text-[11px] font-medium tracking-wide text-white"
            style={{ background: teinte(symbole) }}
            title={symbole}
        >
            {tickerCourt(symbole).slice(0, 7)}
        </span>
    );
}
