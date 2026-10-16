import type { IncomingMessage, ServerResponse } from "node:http";
import type { Connect, Plugin } from "vite";

// Dev/preview proxy for /api. The bourse API is reachable either through the
// VPN (Tailscale) or on the local network: both addresses are probed on
// /health and the first one that answers is used, re-probed after a failure
// or every minute. The key is added here and never reaches the browser.

const DUREE_CHOIX = 60_000;
const DELAI_SONDE = 1_500;

export function proxyApi({ adresses, cle }: { adresses: string[]; cle: string }): Plugin {
    let choix: { adresse: string; expire: number } | null = null;
    let enCours: Promise<string> | null = null;

    async function sonder(adresse: string): Promise<string> {
        const r = await fetch(`${adresse}/health`, { signal: AbortSignal.timeout(DELAI_SONDE) });
        if (!r.ok) throw new Error(`${adresse} : ${r.status}`);
        return adresse;
    }

    function adresseActive(): Promise<string> {
        if (choix && choix.expire > Date.now()) return Promise.resolve(choix.adresse);
        enCours ??= Promise.any(adresses.map(sonder))
            .then((adresse) => {
                if (choix?.adresse !== adresse) console.log(`[api] API bourse jointe sur ${adresse}`);
                choix = { adresse, expire: Date.now() + DUREE_CHOIX };
                return adresse;
            })
            .finally(() => {
                enCours = null;
            });
        return enCours;
    }

    async function lireCorps(req: IncomingMessage): Promise<Buffer | undefined> {
        if (req.method === "GET" || req.method === "HEAD") return undefined;
        const morceaux: Buffer[] = [];
        for await (const m of req) morceaux.push(m as Buffer);
        return Buffer.concat(morceaux);
    }

    async function relayer(req: IncomingMessage, corps: Buffer | undefined) {
        const adresse = await adresseActive();
        try {
            return await fetch(`${adresse}${req.url ?? "/"}`, {
                method: req.method,
                headers: {
                    "X-API-Key": cle,
                    ...(req.headers["content-type"] ? { "Content-Type": req.headers["content-type"] } : {}),
                },
                body: corps,
                signal: AbortSignal.timeout(120_000),
            });
        } catch (erreur) {
            choix = null; // Network changed (VPN on/off): probe again next time.
            throw erreur;
        }
    }

    const middleware: Connect.NextHandleFunction = async (req, res: ServerResponse) => {
        try {
            const corps = await lireCorps(req);
            let reponse: Response;
            try {
                reponse = await relayer(req, corps);
            } catch {
                reponse = await relayer(req, corps); // One retry on the other address.
            }
            res.statusCode = reponse.status;
            const type = reponse.headers.get("content-type");
            if (type) res.setHeader("Content-Type", type);
            res.end(Buffer.from(await reponse.arrayBuffer()));
        } catch {
            res.statusCode = 502;
            res.setHeader("Content-Type", "application/json; charset=utf-8");
            res.end(JSON.stringify({ erreur: `API bourse injoignable (${adresses.join(", ")})` }));
        }
    };

    return {
        name: "proxy-api-bourse",
        configureServer(server) {
            server.middlewares.use("/api", middleware);
        },
        configurePreviewServer(server) {
            server.middlewares.use("/api", middleware);
        },
    };
}
