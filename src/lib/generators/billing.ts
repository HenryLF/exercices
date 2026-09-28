import seedrandom from 'seedrandom';
import { z } from 'zod';
import type { NewBlock } from '../blocks.js';
import type { ExerciseInput, Generator } from './index.js';

// "Calculs commerciaux" as in sample/CalculComerciaux.pdf: a price table from the gross purchase
// price to the margin rates. Every amount is computed in integer cents (rates in per-mille), so
// Math.round on exact halves behaves like commercial rounding and nothing drifts.

export const TVA_REGIMES = {
  normal: { label: 'normal', perMille: 200 },
  intermediaire: { label: 'intermédiaire', perMille: 100 },
  reduit: { label: 'réduit', perMille: 55 },
  particulier: { label: 'particulier', perMille: 21 },
} as const;
export type TvaRegime = keyof typeof TVA_REGIMES;

export interface Product {
  id: string;
  activity: string;
  product: string;
  tva: TvaRegime;
  /** Band of the purchase cost excl. VAT (coût d'achat HT), in whole euros. */
  min: number;
  max: number;
}

const MUSIC = 'magasin de musique, commercialisant des instruments de musique';

export const CATALOGUE: Product[] = [
  {
    id: 'guitare',
    activity: MUSIC,
    product: 'Guitare électrique Fender Jimi Hendrix Strat MN 3',
    tva: 'normal',
    min: 400,
    max: 1500,
  },
  {
    id: 'piano-livre',
    activity: MUSIC,
    product: 'Livre - Technique et répertoire pianistique',
    tva: 'reduit',
    min: 15,
    max: 60,
  },
  {
    id: 'batterie',
    activity: MUSIC,
    product: 'Batterie acoustique 5 fûts',
    tva: 'normal',
    min: 300,
    max: 1200,
  },
  {
    id: 'velo',
    activity: 'magasin de sport, commercialisant des articles de sport',
    product: 'Vélo de route cadre aluminium',
    tva: 'normal',
    min: 400,
    max: 1800,
  },
  {
    id: 'raquette',
    activity: 'magasin de sport, commercialisant des articles de sport',
    product: 'Raquette de tennis Babolat Pure Drive',
    tva: 'normal',
    min: 80,
    max: 200,
  },
  {
    id: 'veste',
    activity: 'boutique de prêt-à-porter',
    product: 'Veste en cuir',
    tva: 'normal',
    min: 90,
    max: 350,
  },
  {
    id: 'baskets',
    activity: 'magasin de chaussures',
    product: 'Paire de baskets en toile',
    tva: 'normal',
    min: 30,
    max: 90,
  },
  {
    id: 'ordinateur',
    activity: 'magasin d’informatique',
    product: 'Ordinateur portable 15 pouces',
    tva: 'normal',
    min: 400,
    max: 1400,
  },
  {
    id: 'smartphone',
    activity: 'magasin de téléphonie',
    product: 'Smartphone 128 Go',
    tva: 'normal',
    min: 200,
    max: 900,
  },
  {
    id: 'canape',
    activity: 'magasin d’ameublement',
    product: 'Canapé 3 places en tissu',
    tva: 'normal',
    min: 300,
    max: 1200,
  },
  {
    id: 'parfum',
    activity: 'parfumerie',
    product: 'Eau de parfum 100 ml',
    tva: 'normal',
    min: 30,
    max: 110,
  },
  {
    id: 'roman',
    activity: 'librairie',
    product: 'Roman - édition brochée',
    tva: 'reduit',
    min: 8,
    max: 25,
  },
  {
    id: 'bd',
    activity: 'librairie',
    product: 'Bande dessinée - album cartonné',
    tva: 'reduit',
    min: 8,
    max: 20,
  },
  {
    id: 'cafe',
    activity: 'épicerie fine',
    product: 'Café en grains 1 kg',
    tva: 'reduit',
    min: 12,
    max: 40,
  },
  {
    id: 'chocolat',
    activity: 'chocolaterie',
    product: 'Coffret de chocolats 500 g',
    tva: 'reduit',
    min: 12,
    max: 45,
  },
  {
    id: 'panier',
    activity: 'primeur, commercialisant des fruits et légumes',
    product: 'Panier de fruits de saison 5 kg',
    tva: 'reduit',
    min: 10,
    max: 30,
  },
  {
    id: 'plat',
    activity: 'restaurant, proposant de la vente à emporter',
    product: 'Plateau repas à emporter',
    tva: 'intermediaire',
    min: 8,
    max: 25,
  },
  {
    id: 'nuitee',
    activity: 'hôtel',
    product: 'Nuitée en chambre double',
    tva: 'intermediaire',
    min: 50,
    max: 180,
  },
  {
    id: 'transport',
    activity: 'compagnie de transport de voyageurs',
    product: 'Billet de car Paris - Lyon',
    tva: 'intermediaire',
    min: 15,
    max: 60,
  },
  {
    id: 'medicament',
    activity: 'pharmacie',
    product: 'Médicament remboursable - boîte de 30 comprimés',
    tva: 'particulier',
    min: 5,
    max: 40,
  },
  {
    id: 'presse',
    activity: 'marchand de journaux',
    product: 'Abonnement annuel à un quotidien',
    tva: 'particulier',
    min: 120,
    max: 350,
  },
];

// ---------------------------------------------------------------------------
// Computation

export interface BillingInput {
  brutC: number; // gross purchase price, cents
  remisePct: number; // discount, percent (integer)
  fraisPct: number; // delivery costs, percent of the net purchase price (integer)
  tvaPerMille: number; // 200 = 20 %
  pvHTC: number; // selling price excl. VAT, cents
}

export interface BillingResult {
  brut: number;
  remise: number;
  net: number;
  frais: number;
  coutHT: number;
  tvaDed: number;
  coutTTC: number;
  pvHT: number;
  tvaCol: number;
  pvTTC: number;
  coef: number;
  marge: number;
  tauxMarge: number;
  tauxMarque: number;
}

/** The table of the PDF, line by line, each amount rounded to the cent (in euros). */
export function computeBilling(i: BillingInput): BillingResult {
  const remiseC = Math.round((i.brutC * i.remisePct) / 100);
  const netC = i.brutC - remiseC;
  const fraisC = Math.round((netC * i.fraisPct) / 100);
  const coutHTC = netC + fraisC;
  const tvaDedC = Math.round((coutHTC * i.tvaPerMille) / 1000);
  const tvaColC = Math.round((i.pvHTC * i.tvaPerMille) / 1000);
  const pvTTCC = i.pvHTC + tvaColC;
  const margeC = i.pvHTC - coutHTC;
  const e = (c: number) => c / 100;
  return {
    brut: e(i.brutC),
    remise: e(remiseC),
    net: e(netC),
    frais: e(fraisC),
    coutHT: e(coutHTC),
    tvaDed: e(tvaDedC),
    coutTTC: e(coutHTC + tvaDedC),
    pvHT: e(i.pvHTC),
    tvaCol: e(tvaColC),
    pvTTC: e(pvTTCC),
    coef: Math.round((pvTTCC * 100) / coutHTC) / 100,
    marge: e(margeC),
    tauxMarge: Math.round((margeC * 10000) / coutHTC) / 100,
    tauxMarque: Math.round((margeC * 10000) / i.pvHTC) / 100,
  };
}

// ---------------------------------------------------------------------------
// Tooltips: definitions and worked examples from page 3 of the PDF, never the exercise's numbers.

const NB = '\u00a0';
export const TOOLTIPS = {
  remise: `**Remise**${NB}: réduction commerciale accordée sur le prix initial d’un produit (quantité importante, type de client, etc.).\n\n*Exemple*${NB}: prix initial 200${NB}€, remise 20${NB}€ → prix final = 200 − 20 = **180${NB}€**.`,
  net: `**Prix d’achat net**${NB}: prix d’achat après déduction des remises.\n\n*Exemple*${NB}: prix catalogue 40${NB}€, remise 5${NB}€ → prix d’achat net = 40 − 5 = **35${NB}€**.`,
  frais: `**Frais de livraison**${NB}: coût du transport des marchandises jusqu’au lieu de vente.\n\n*Exemple*${NB}: achat du produit 80${NB}€, transport 10${NB}€ → total à payer = 80 + 10 = **90${NB}€**.`,
  coutHT: `**Coût d’achat HT**${NB}: somme du prix d’achat net et des frais annexes, sans compter la TVA.\n\n*Exemple*${NB}: prix net 150${NB}€, livraison 10${NB}€ → coût d’achat HT = 150 + 10 = **160${NB}€**.`,
  tvaDed: `**TVA déductible**${NB}: TVA payée par l’entreprise sur ses achats, qu’elle peut déduire de la TVA qu’elle collecte.\n\n*Exemple*${NB}: achat de fournitures 100${NB}€ HT, taux de TVA 20${NB}% → TVA déductible = 100 × 20${NB}% = **20${NB}€**.`,
  coutTTC: `**Coût d’achat TTC**${NB}: coût d’achat total, TVA comprise.\n\n*Exemple*${NB}: coût HT 100${NB}€, TVA (20${NB}%) 20${NB}€ → coût TTC = 100 + 20 = **120${NB}€**.`,
  tvaCol: `**TVA collectée**${NB}: TVA que l’entreprise facture à ses clients lors de la vente.\n\n*Exemple*${NB}: vente 50${NB}€ HT, taux de TVA 20${NB}% → TVA collectée = 50 × 20${NB}% = **10${NB}€**.`,
  pvTTC: `**Prix de vente TTC**${NB}: prix final payé par le client, TVA comprise.\n\n*Exemple*${NB}: prix HT 20${NB}€, taux de TVA 20${NB}% → prix TTC = 20 + (20 × 20${NB}%) = **24${NB}€**.`,
  coef: `**Coefficient multiplicateur TTC**${NB}: nombre par lequel on multiplie le coût d’achat HT pour obtenir le prix de vente TTC.\n\n*Exemple*${NB}: coût HT 50${NB}€, prix TTC 100${NB}€ → coefficient = 100 ÷ 50 = **2**.`,
  marge: `**Marge commerciale**${NB}: différence entre le prix de vente HT et le coût d’achat HT.\n\n*Exemple*${NB}: achat 200${NB}€ HT, vente 300${NB}€ HT → marge = 300 − 200 = **100${NB}€**.`,
  tauxMarge: `**Taux de marge**${NB}: rapport entre la marge commerciale et le coût d’achat HT, exprimé en pourcentage.\n\n*Exemple*${NB}: marge 60${NB}€, coût d’achat HT 40${NB}€ → taux de marge = (60 ÷ 40) × 100 = **150${NB}%**.`,
  tauxMarque: `**Taux de marque**${NB}: rapport entre la marge commerciale et le prix de vente HT, exprimé en pourcentage.\n\n*Exemple*${NB}: marge 60${NB}€, prix de vente HT 100${NB}€ → taux de marque = (60 ÷ 100) × 100 = **60${NB}%**.`,
} as const;

// ---------------------------------------------------------------------------
// Exercise

const pct = (n: number) => `${String(n).replace('.', ',')}${NB}%`;

// ---------------------------------------------------------------------------
// Lines of the table. Each computed line is asked, given, or hidden, as the admin chooses.

export const LINE_MODES = ['ask', 'give', 'hide'] as const;
export type LineMode = (typeof LINE_MODES)[number];
export const LINE_MODE_LABELS: Record<LineMode, string> = {
  ask: 'Question',
  give: 'Donnée',
  hide: 'Masquée',
};

type Value = keyof BillingResult;
type Rate = 'r' | 'f' | 't';

interface Line {
  id: string;
  label: string;
  value: Value;
  tooltip: string;
  unit: '€' | '%' | '';
  /** The rate printed in the "Taux" column: shown whenever the line is visible. */
  rate?: Rate;
}

export const LINES = [
  {
    id: 'remise',
    label: 'Remise',
    value: 'remise',
    tooltip: TOOLTIPS.remise,
    unit: '€',
    rate: 'r',
  },
  { id: 'net', label: 'Prix d’achat net', value: 'net', tooltip: TOOLTIPS.net, unit: '€' },
  {
    id: 'frais',
    label: 'Frais de livraison',
    value: 'frais',
    tooltip: TOOLTIPS.frais,
    unit: '€',
    rate: 'f',
  },
  { id: 'coutHT', label: 'Coût d’achat HT', value: 'coutHT', tooltip: TOOLTIPS.coutHT, unit: '€' },
  {
    id: 'tvaDed',
    label: 'TVA déductible',
    value: 'tvaDed',
    tooltip: TOOLTIPS.tvaDed,
    unit: '€',
    rate: 't',
  },
  {
    id: 'coutTTC',
    label: 'Coût d’achat TTC',
    value: 'coutTTC',
    tooltip: TOOLTIPS.coutTTC,
    unit: '€',
  },
  {
    id: 'tvaCol',
    label: 'TVA collectée',
    value: 'tvaCol',
    tooltip: TOOLTIPS.tvaCol,
    unit: '€',
    rate: 't',
  },
  { id: 'pvTTC', label: 'Prix de vente TTC', value: 'pvTTC', tooltip: TOOLTIPS.pvTTC, unit: '€' },
  {
    id: 'coef',
    label: 'Coefficient multiplicateur TTC',
    value: 'coef',
    tooltip: TOOLTIPS.coef,
    unit: '',
  },
  { id: 'marge', label: 'Marge commerciale', value: 'marge', tooltip: TOOLTIPS.marge, unit: '€' },
  {
    id: 'tauxMarge',
    label: 'Taux de marge',
    value: 'tauxMarge',
    tooltip: TOOLTIPS.tauxMarge,
    unit: '%',
  },
  {
    id: 'tauxMarque',
    label: 'Taux de marque',
    value: 'tauxMarque',
    tooltip: TOOLTIPS.tauxMarque,
    unit: '%',
  },
] as const satisfies readonly Line[];
export type LineId = (typeof LINES)[number]['id'];
export type LineModes = Record<LineId, LineMode>;

// Each relation links three quantities; knowing any two gives the third. Used to refuse a
// setting where an asked line can't be computed from what the student sees.
const RELATIONS: [string, string, string][] = [
  ['brut', 'r', 'remise'],
  ['brut', 'remise', 'net'],
  ['net', 'f', 'frais'],
  ['net', 'frais', 'coutHT'],
  ['coutHT', 't', 'tvaDed'],
  ['coutHT', 'tvaDed', 'coutTTC'],
  ['pvHT', 't', 'tvaCol'],
  ['pvHT', 'tvaCol', 'pvTTC'],
  ['pvTTC', 'coutHT', 'coef'],
  ['pvHT', 'coutHT', 'marge'],
  ['marge', 'coutHT', 'tauxMarge'],
  ['marge', 'pvHT', 'tauxMarque'],
];

/** Labels of the asked lines the student can't compute from the visible lines and rates. */
export function unsolvableLines(modes: LineModes): string[] {
  const known = new Set<string>(['brut', 'pvHT']);
  for (const line of LINES) {
    const mode = modes[line.id];
    if (mode !== 'hide' && 'rate' in line) known.add(line.rate);
    if (mode === 'give') known.add(line.value);
  }
  for (let changed = true; changed;) {
    changed = false;
    for (const rel of RELATIONS) {
      const unknown = rel.filter((v) => !known.has(v));
      if (unknown.length === 1) {
        known.add(unknown[0]!);
        changed = true;
      }
    }
  }
  return LINES.filter((l) => modes[l.id] === 'ask' && !known.has(l.value)).map((l) => l.label);
}

export function billingBlocks(
  p: Product,
  i: BillingInput,
  modes: LineModes = ALL_ASKED,
): NewBlock[] {
  const r = computeBilling(i);
  const regime = TVA_REGIMES[p.tva].label;
  const rates: Record<Rate, string> = {
    r: pct(i.remisePct),
    f: pct(i.fraisPct),
    t: pct(i.tvaPerMille / 10),
  };
  const line = (l: (typeof LINES)[number]): NewBlock[] => {
    const mode = modes[l.id];
    if (mode === 'hide') return [];
    const hint = 'rate' in l ? { hint: rates[l.rate] } : {};
    const unit = l.unit ? { unit: l.unit } : {};
    if (mode === 'give')
      return [{ type: 'given', label: l.label, ...hint, amount: r[l.value], ...unit }];
    return [
      {
        type: 'question',
        label: l.label,
        ...hint,
        tooltip: l.tooltip,
        answer: { type: 'number', value: r[l.value], decimals: 2, tolerance: 0.01, ...unit },
      },
    ];
  };
  const [remise, net, frais, coutHT, tvaDed, coutTTC, ...sale] = LINES;
  return [
    {
      type: 'markdown',
      body:
        `*Activité*${NB}: ${p.activity}. *Taux de TVA*${NB}: ${regime}.\n\n` +
        `Calculez les éléments du prix du produit en complétant le tableau. ` +
        `Arrondissez chaque montant au centime et chaque taux au centième.\n\n` +
        `**Produit${NB}:** ${p.product}`,
    },
    { type: 'given', label: 'Prix d’achat brut', amount: r.brut, unit: '€' },
    ...[remise, net, frais, coutHT, tvaDed, coutTTC].flatMap(line),
    { type: 'given', label: 'Prix de vente HT', amount: r.pvHT, unit: '€' },
    ...sale.flatMap(line),
  ];
}

const lineMode = z.enum(LINE_MODES, { error: 'Choix inconnu' }).default('ask');

/** The product is drawn from the catalogue and the VAT rate is always its own; the admin only
 * chooses, line by line, what the student answers, sees, or doesn't see. */
export const billingParamsSchema = z
  .object({
    lines: z
      .object({
        remise: lineMode,
        net: lineMode,
        frais: lineMode,
        coutHT: lineMode,
        tvaDed: lineMode,
        coutTTC: lineMode,
        tvaCol: lineMode,
        pvTTC: lineMode,
        coef: lineMode,
        marge: lineMode,
        tauxMarge: lineMode,
        tauxMarque: lineMode,
      })
      .prefault({}),
  })
  .superRefine(({ lines }, ctx) => {
    if (!Object.values(lines).includes('ask'))
      ctx.addIssue({ code: 'custom', path: ['lines'], message: 'Gardez au moins une question.' });
    const missing = unsolvableLines(lines);
    if (missing.length > 0)
      ctx.addIssue({
        code: 'custom',
        path: ['lines'],
        message: `Impossible à calculer avec les lignes affichées\u00a0: ${missing.join(', ')}. Affichez (en donnée ou en question) une ligne dont dépend chacune.`,
      });
  });
export type BillingParams = z.infer<typeof billingParamsSchema>;

const ALL_ASKED = Object.fromEntries(LINES.map((l) => [l.id, 'ask'])) as LineModes;

/** Random but coherent numbers: the purchase cost falls in the product's band, the selling
 * price is 15 % to 120 % above it and rounded like a shop price. */
export function randomBillingInput(seed: string): { product: Product; input: BillingInput } {
  const rng = seedrandom(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;
  const int = (min: number, max: number) => min + Math.floor(rng() * (max - min + 1));

  const product = pick(CATALOGUE);

  const remisePct = pick([1, 2, 3, 4, 5, 10]);
  const fraisPct = pick([1, 2, 3, 5]);
  // Aim for a round purchase cost, as the PDF does, then work back to the gross price.
  let target = int(product.min, product.max);
  if (target >= 500) target = Math.round(target / 10) * 10;
  const brutC = Math.round((target * 100) / ((1 - remisePct / 100) * (1 + fraisPct / 100)));
  const { coutHT } = computeBilling({ brutC, remisePct, fraisPct, tvaPerMille: 0, pvHTC: 1 });
  const coutHTC = Math.round(coutHT * 100);

  const step = coutHTC < 20000 ? 50 : coutHTC < 100000 ? 500 : 1000;
  let pvHTC = Math.round((coutHTC * (1.15 + rng() * 1.05)) / step) * step;
  if (pvHTC <= coutHTC) pvHTC += step;

  return {
    product,
    input: { brutC, remisePct, fraisPct, tvaPerMille: TVA_REGIMES[product.tva].perMille, pvHTC },
  };
}

export function generateBilling(seed: string, params?: BillingParams): ExerciseInput {
  const { product, input } = randomBillingInput(seed);
  return { blocks: billingBlocks(product, input, params?.lines) };
}

export const billingGenerator: Generator<BillingParams> = {
  kind: 'billing',
  label: 'Calculs commerciaux',
  description:
    'Tableau du prix d’achat brut aux taux de marge et de marque, avec un produit, des taux et des prix tirés au hasard.',
  paramsSchema: billingParamsSchema,
  paramsView: 'generate-billing-params',
  defaultName: () => 'Calculs commerciaux',
  describeParams: ({ lines }) => {
    const n = (m: LineMode) => Object.values(lines).filter((v) => v === m).length;
    const parts = [`${n('ask')} question${n('ask') > 1 ? 's' : ''}`];
    if (n('give') > 0) parts.push(`${n('give')} donnée${n('give') > 1 ? 's' : ''}`);
    if (n('hide') > 0)
      parts.push(
        `${n('hide')} ligne${n('hide') > 1 ? 's' : ''} masquée${n('hide') > 1 ? 's' : ''}`,
      );
    return `Produit tiré au hasard, avec son propre taux de TVA. ${parts.join(', ')}.`;
  },
  formData: () => ({
    lines: LINES.map((l) => ({ id: l.id, label: l.label })),
    modes: LINE_MODES.map((m) => ({ id: m, label: LINE_MODE_LABELS[m] })),
  }),
  generate: generateBilling,
};
