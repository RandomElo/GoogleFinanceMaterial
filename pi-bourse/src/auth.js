import crypto from 'node:crypto';

/** Exige la clé API dans l'en-tête X-API-Key ou Authorization: Bearer <clé>. */
export function exigerCleApi(apiKey) {
  const attendu = crypto.createHash('sha256').update(apiKey).digest();

  return (req, res, next) => {
    const bearer = req.get('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
    const fournie = req.get('x-api-key') ?? bearer ?? '';
    // Comparaison des empreintes : longueur fixe, temps constant
    const recu = crypto.createHash('sha256').update(fournie).digest();
    if (!fournie || !crypto.timingSafeEqual(recu, attendu)) {
      return res.status(401).json({ erreur: 'Clé API manquante ou invalide' });
    }
    next();
  };
}
