import { DataTypes, Sequelize } from 'sequelize';

export function creerBdd(databaseUrl) {
  const sequelize = new Sequelize(databaseUrl, {
    dialect: 'postgres',
    logging: false,
    define: { underscored: true, timestamps: false },
  });

  const Instrument = sequelize.define('Instrument', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    symbole: { type: DataTypes.STRING(32), allowNull: false, unique: true },
    nom: { type: DataTypes.STRING, allowNull: false },
    // INDEX, EQUITY, ETF, CURRENCY, FUTURE, CRYPTOCURRENCY… (quoteType de Yahoo)
    type: { type: DataTypes.STRING(32), allowNull: false },
    devise: { type: DataTypes.STRING(8), allowNull: false },
    fuseau: { type: DataTypes.STRING(64), allowNull: false },
    // Créneau du chargement quotidien : "europe" (18 h 15) ou "us" (22 h 45)
    cloture: { type: DataTypes.STRING(8), allowNull: false },
    historique_charge: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false },
    cree_le: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
  }, { tableName: 'instruments' });

  const CoursJournalier = sequelize.define('CoursJournalier', {
    instrument_id: { type: DataTypes.INTEGER, primaryKey: true, references: { model: Instrument, key: 'id' }, onDelete: 'CASCADE' },
    jour: { type: DataTypes.DATEONLY, primaryKey: true },
    ouverture: DataTypes.DOUBLE,
    haut: DataTypes.DOUBLE,
    bas: DataTypes.DOUBLE,
    cloture: { type: DataTypes.DOUBLE, allowNull: false },
    cloture_ajustee: DataTypes.DOUBLE,
    volume: DataTypes.BIGINT,
  }, { tableName: 'cours_journaliers' });

  // Barres intraday : 15 min sur les 60 derniers jours (limite de Yahoo), 1 h au-delà jusqu'à
  // 2 ans pour la reprise d'historique. Horodatage = début de la barre, en UTC.
  const CoursIntraday = sequelize.define('CoursIntraday', {
    instrument_id: { type: DataTypes.INTEGER, primaryKey: true, references: { model: Instrument, key: 'id' }, onDelete: 'CASCADE' },
    horodatage: { type: DataTypes.DATE, primaryKey: true },
    // Durée de la barre en minutes (15 ou 60)
    intervalle: { type: DataTypes.SMALLINT, allowNull: false },
    ouverture: DataTypes.DOUBLE,
    haut: DataTypes.DOUBLE,
    bas: DataTypes.DOUBLE,
    cloture: { type: DataTypes.DOUBLE, allowNull: false },
    volume: DataTypes.BIGINT,
  }, { tableName: 'cours_intraday' });

  const Operation = sequelize.define('Operation', {
    id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
    jour: { type: DataTypes.DATEONLY, allowNull: false },
    // PEA, CTO, Binance… (colonne "Portefeuille" du Sheet)
    compte: { type: DataTypes.STRING(32), allowNull: false },
    // achat, vente, dividende
    type: { type: DataTypes.STRING(16), allowNull: false },
    symbole: { type: DataTypes.STRING(32), allowNull: false },
    nom: DataTypes.STRING,
    quantite: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    // Prix unitaire dans la devise de l'instrument (l'euro pour tout le portefeuille actuel)
    prix: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    courtage: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    // Taxe sur les transactions financières (achats d'actions françaises)
    ttf: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    // courtage + ttf : ajoutés au PRU à l'achat, déduits du produit à la vente
    frais: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    // Montant total d'un dividende
    montant: { type: DataTypes.DOUBLE, allowNull: false, defaultValue: 0 },
    // Onglet et ligne du Google Sheet, pour retrouver une opération mal saisie
    onglet_source: DataTypes.STRING,
    ligne_source: DataTypes.INTEGER,
  }, { tableName: 'operations', indexes: [{ fields: ['jour'] }] });

  Instrument.hasMany(CoursJournalier, { foreignKey: 'instrument_id' });
  CoursJournalier.belongsTo(Instrument, { foreignKey: 'instrument_id' });

  Instrument.hasMany(CoursIntraday, { foreignKey: 'instrument_id' });
  CoursIntraday.belongsTo(Instrument, { foreignKey: 'instrument_id' });

  return { sequelize, Instrument, CoursJournalier, CoursIntraday, Operation };
}
