function obligatoire(nom) {
  const valeur = process.env[nom];
  if (!valeur) throw new Error(`Variable d'environnement manquante : ${nom}`);
  return valeur;
}

export function lireConfig() {
  const apiKey = obligatoire('API_KEY');
  if (apiKey.length < 16) throw new Error('API_KEY doit faire au moins 16 caractères');

  return {
    port: Number(process.env.PORT ?? 8140),
    apiKey,
    databaseUrl: obligatoire('DATABASE_URL'),
    fuseau: process.env.TZ ?? 'Europe/Paris',
    cacheCotationsSecondes: Number(process.env.CACHE_COTATIONS_SECONDES ?? 300),
    // Synchronisation des opérations : active dès que la clé est posée et le Sheet renseigné
    google: {
      fichierCompteService: process.env.GOOGLE_SERVICE_ACCOUNT_FILE || '/app/secrets/google.json',
      sheetId: process.env.GOOGLE_SHEET_ID ?? '',
      ongletOperations: process.env.GOOGLE_ONGLET_OPERATIONS || "Historique d'opérations",
      ongletDividendes: process.env.GOOGLE_ONGLET_DIVIDENDES || 'Dividendes',
    },
  };
}
