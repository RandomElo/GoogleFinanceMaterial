// Conversion en euros. Yahoo cote les paires EURXXX=X en "XXX pour 1 EUR".

export function symboleChange(devise) {
  const d = normaliserDevise(devise).devise;
  return d === 'EUR' ? null : `EUR${d}=X`;
}

/** Les actions de Londres sont cotées en pence (GBp) : on ramène en livres. */
export function normaliserDevise(devise) {
  if (devise === 'GBp' || devise === 'GBX') return { devise: 'GBP', facteur: 0.01 };
  return { devise: devise.toUpperCase(), facteur: 1 };
}

/** Convertit un montant en euros. `taux` = cours de EURXXX=X ce jour-là (null si EUR). */
export function versEuros(montant, devise, taux) {
  const { devise: d, facteur } = normaliserDevise(devise);
  if (d === 'EUR') return montant * facteur;
  if (!taux) return null;
  return (montant * facteur) / taux;
}
