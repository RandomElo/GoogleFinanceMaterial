// Response shapes of the bourse API (see GET /doc).

export type TypeInstrument = "INDEX" | "EQUITY" | "ETF" | "CURRENCY" | "FUTURE" | "CRYPTOCURRENCY";

export interface Instrument {
    symbole: string;
    nom: string;
    type: TypeInstrument;
    devise: string;
    fuseau?: string;
    cloture?: "europe" | "us";
    historique_charge?: boolean;
}

export interface CoursJour {
    jour: string;
    ouverture: number | null;
    haut: number | null;
    bas: number | null;
    cloture: number;
    cloture_ajustee?: number | null;
    volume: number | null;
}

export interface FicheInstrument extends Instrument {
    historique: { premier_jour: string | null; dernier_jour: string | null; seances: number };
    dernier_cours: CoursJour | null;
}

export interface ReponseCours {
    symbole: string;
    nom: string;
    devise: string;
    debut: string;
    fin: string;
    intervalle: string;
    cours: CoursJour[];
}

export interface BarreIntraday {
    horodatage: string;
    intervalle: number;
    ouverture: number | null;
    haut: number | null;
    bas: number | null;
    cloture: number;
    volume: number | null;
}

export interface ReponseIntraday {
    symbole: string;
    nom: string;
    devise: string;
    du: string;
    au: string;
    intervalle: number;
    cours: BarreIntraday[];
}

export interface Variations {
    jour?: number | null;
    semaine?: number | null;
    mois?: number | null;
    debut_annee?: number | null;
}

export interface Performance {
    symbole: string;
    nom?: string;
    devise?: string;
    seance?: string;
    cloture?: number;
    variations?: Variations;
    erreur?: string;
}

export interface ReponsePerformances {
    date: string;
    performances: Performance[];
}

export interface Cotation {
    symbole: string;
    nom?: string;
    prix: number;
    variation: number | null;
    variation_pct: number | null;
    devise: string;
    etat_marche?: string;
    heure?: string;
}

export interface Totaux {
    valeur: number;
    investi: number;
    plus_value_latente: number;
    plus_value_realisee: number;
    dividendes: number;
    benefice_total: number;
    rendement_pct: number | null;
    repartition_pct?: number;
    incomplet?: boolean;
}

export interface Position {
    compte: string;
    symbole: string;
    nom: string;
    devise: string;
    quantite: number;
    pru: number;
    cours: number | null;
    date_cours: string | null;
    investi: number;
    valeur: number;
    plus_value_latente: number;
    rendement_pct: number | null;
    plus_value_realisee: number;
    dividendes: number;
    repartition_pct: number;
    valeur_eur: number;
    investi_eur: number;
    plus_value_latente_eur: number;
    plus_value_realisee_eur: number;
    dividendes_eur: number;
    variations?: Variations;
}

export interface ReponsePositions {
    jour: string;
    devise: string;
    totaux: Totaux;
    par_compte: Record<string, Partial<Totaux>>;
    positions: Position[];
}

export interface ReponseComptes {
    jour: string;
    devise: string;
    totaux: Totaux;
    comptes: Record<string, Totaux>;
}

export interface PointValorisation {
    jour?: string;
    horodatage?: string;
    valeur: number;
    investi_net: number;
    par_compte: Record<string, number>;
    incomplet?: boolean;
}

export interface ReponseValorisation {
    devise: string;
    du: string;
    au: string;
    intervalle?: number;
    points: PointValorisation[];
}

export type TypeOperation = "achat" | "vente" | "dividende";

export interface Operation {
    id: number;
    jour: string;
    compte: string;
    type: TypeOperation;
    symbole: string;
    nom: string;
    quantite: number | null;
    prix: number | null;
    courtage: number | null;
    ttf: number | null;
    frais: number | null;
    montant: number | null;
    onglet_source?: string;
    ligne_source?: number;
}

// The aggregates of /dividendes are documented by name only: values may be
// plain amounts or objects carrying a total, so they are read defensively.
export type Agregat = Record<string, number | Record<string, unknown>>;

export interface ReponseDividendes {
    total: number;
    par_annee: Agregat;
    par_symbole: Agregat;
    par_compte: Agregat;
    dividendes: Operation[];
}

export interface ErreurSynchro {
    onglet?: string;
    ligne?: number;
    message?: string;
    erreur?: string;
}

export interface EtatSynchro {
    active: boolean;
    derniere?: {
        date?: string;
        ok?: boolean;
        operations?: number;
        dividendes?: number;
        erreurs?: (ErreurSynchro | string)[];
        message?: string;
    } | null;
}
