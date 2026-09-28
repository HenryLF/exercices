# Adding a generated exercise

This guide explains how to add a new family of generated exercises, like the existing
*Calculs commerciaux* (`src/lib/generators/billing.ts`). It is written for developers and coding
agents working on this repository. Read [CLAUDE.md](../CLAUDE.md) first for the stack and
conventions.

The worked example below adds a *Pourcentages* family: a price rises or falls by a random rate,
and the student finds the multiplier, the amount of the change and the final price. The example
was compiled, tested and run in the app before being written here. Copy it as a starting point.

## 1. How generated exercises work

A generated exercise is a **template**. The admin creates it once, with a name and optional
settings (`params`). Nothing else is stored on the exercise: `blocks` stays empty.

Each time a student starts it, the app draws a **seed** (16 hex characters) and stores it on the
student's attempt. The exercise the student sees is rebuilt from the seed on every request:

```
blocksFor(exercise, attempt.seed)
  → generator.paramsSchema.parse(exercise.generated.params)
  → generator.generate(seed, params)          // your code
  → withStableKeys(blocks)                    // keys b_00000001, b_00000002… by position
```

This design has four consequences, and each one is a rule for your code:

- **The same seed and params must always give the same exercise.** The student's tries are
  checked against numbers recomputed at every request, and the admin preview replays any seed.
- **Block keys come from positions.** Tries are stored under those keys, and the results tables
  line up every seed question by question. The number, order and types of blocks may depend on
  the params, never on the seed.
- **Params lock at the first attempt.** Until a student starts, the admin can change them. After
  that, the form is disabled, so existing seeds keep their meaning.
- **Old exercises keep their stored params.** `paramsSchema` must accept every params object
  ever saved, including `{}`.

The rest is generic and already works for any family: the generator list, the creation form, the
"Infini" retry option, class assignment, the student page, the preview with a chosen seed,
results per seed, the CSV export and deletion.

## 2. Rules for a generator

1. **Deterministic.** Draw every random value from `seedrandom(seed)`. Never call `Math.random`,
   `Date.now` or `crypto` inside `generate`.
2. **Fixed structure.** The list of blocks must have the same length, order and types for every
   seed. Vary the numbers and texts, not the shape. If a choice changes the shape, make it a
   param.
3. **Tolerant of the seed format.** Result tables call `generate('template', params)` to read the
   question labels. Any string must work as a seed.
4. **Defaults for every param.** Give each field of `paramsSchema` a `.default(...)`, so `{}`
   parses. When you add a field later, its default must reproduce the old behaviour.
5. **Exact arithmetic.** Compute money in integer cents and rates in percent or per-mille
   integers. Round once per line, with `Math.round` on an integer divided by 100 or 1000. Halves
   are then exact and rounded up, like commercial rounding. See `computeBilling` in `billing.ts`.
6. **Coherent numbers.** Draw values a teacher would write: realistic prices, round costs, rates
   from a short list. Avoid degenerate cases such as zero or negative margins.
7. **Hints never use the exercise's own numbers.** Tooltips explain the method with a fixed
   example; otherwise they give the answer away.
8. **French text, French typography.** Every string a student or admin sees is in French. Put a
   non-breaking space before `: ; ! ? %` and after `«`. In TypeScript, write it as `' '`,
   because ESLint rejects the raw character. Use the typographic apostrophe `’`.
9. **Never send answers to the browser yourself.** You only return blocks. The server strips
   expected values before rendering (`buildSegments`), except in the admin preview.

## 3. Blocks you can return

`generate` returns `{ blocks: NewBlock[] }`, blocks without keys. There are three types
(`src/lib/blocks.ts`):

| Type | Fields | Shown as |
|---|---|---|
| `markdown` | `body` | Text: instructions, context. Raw HTML is escaped. |
| `given` | `label`, `amount`, `hint?`, `unit?` | A table row with a value the student is told. |
| `question` | `label`, `answer`, `hint?`, `tooltip?` | A table row with an input and a "Valider" button. |

- Consecutive `given` and `question` blocks form **one table**. A `markdown` block ends it.
- `hint` fills the *Taux* column, for example `'4 %'`. The column appears only if a row has
  one.
- `tooltip` is Markdown, shown when the student clicks "Indice". Opening it is recorded.
- A `given` amount shows with 2 decimals. Its `unit` is displayed only when it is `'%'`.

The `answer` of a question is one of two kinds:

```ts
// A number: the input is rounded to `decimals`, then correct if within `tolerance`.
{ type: 'number', value: 40.85, decimals: 2, tolerance: 0.01, unit: '€' }

// A choice: a select list; correct if the chosen option equals `value`.
{ type: 'enum', options: ['1,07', '0,93', '1,7', '0,3'], value: '0,93' }
```

Students may type `40,85`, `40.85`, `1 021,24` or `45,50 €`: the checker accepts all of them. Use
`tolerance: 0.01` for amounts rounded line by line, so a student who carries full precision is not
marked wrong by one cent. Keep the enum options in the same order for every seed.

## 4. Step by step

The example adds the kind `percent`. Replace it with your own kind: lowercase ASCII letters, no
spaces. It is stored in the database, so never rename it once exercises exist.

### Step 1: the generator module

Create `src/lib/generators/percent.ts`:

```ts
import seedrandom from 'seedrandom';
import { z } from 'zod';
import type { NewBlock } from '../blocks.js';
import type { ExerciseInput, Generator } from './index.js';

const NB = ' '; // French typography: non-breaking space before ":" and "%"

// 1. Settings. Every field has a default, so `{}` (an exercise saved before the field existed)
//    still parses, and to the behaviour it had then.
export const percentParamsSchema = z.object({
  level: z.enum(['simple', 'avance'], { error: 'Niveau inconnu' }).default('simple'),
});
export type PercentParams = z.infer<typeof percentParamsSchema>;

// 2. Pure computation, in integer cents so rounding is exact.
export function computePercent(priceC: number, ratePct: number, up: boolean) {
  const changeC = Math.round((priceC * ratePct) / 100);
  return { change: changeC / 100, final: (up ? priceC + changeC : priceC - changeC) / 100 };
}

/** 1 + t or 1 − t, written the French way: 1,03 or 0,97. */
function coefText(ratePct: number, up: boolean): string {
  return String((100 + (up ? ratePct : -ratePct)) / 100).replace('.', ',');
}

/** Always the same four options, in the same order, whatever the direction. */
function coefOptions(ratePct: number): string[] {
  const wrongScale = ratePct * 10 < 100 ? ratePct * 10 : ratePct / 10;
  return [
    coefText(ratePct, true),
    coefText(ratePct, false),
    coefText(wrongScale, true),
    coefText(wrongScale, false),
  ];
}

// 3. The generator: same seed + same params => same blocks, in the same order.
export function generatePercent(seed: string, params: PercentParams): ExerciseInput {
  const rng = seedrandom(seed);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rng() * xs.length)]!;

  const priceC = (20 + Math.floor(rng() * 480)) * 100 + pick([0, 50, 90, 99]);
  const ratePct = params.level === 'simple' ? pick([10, 20, 25, 50]) : pick([3, 7, 12, 15, 35]);
  const up = rng() < 0.5;
  const r = computePercent(priceC, ratePct, up);

  const blocks: NewBlock[] = [
    {
      type: 'markdown',
      body: `Le prix d’un article ${up ? 'augmente' : 'baisse'} de ${ratePct}${NB}%. Complétez le tableau.`,
    },
    { type: 'given', label: 'Prix initial', amount: priceC / 100, unit: '€' },
    {
      // A choice question: the right coefficient among plausible mistakes.
      type: 'question',
      label: 'Coefficient multiplicateur',
      answer: { type: 'enum', options: coefOptions(ratePct), value: coefText(ratePct, up) },
    },
    {
      type: 'question',
      label: 'Montant de la variation',
      hint: `${ratePct}${NB}%`,
      tooltip: `**Montant**${NB}: prix initial × taux.\n\n*Exemple*${NB}: 80${NB}€ × 25${NB}% = **20${NB}€**.`,
      answer: { type: 'number', value: r.change, decimals: 2, tolerance: 0.01, unit: '€' },
    },
    {
      type: 'question',
      label: 'Prix final',
      tooltip: `*Exemple*${NB}: 80 + 20 = **100${NB}€** (ou 80 − 20 pour une baisse).`,
      answer: { type: 'number', value: r.final, decimals: 2, tolerance: 0.01, unit: '€' },
    },
  ];
  return { blocks };
}

// 4. What the admin pages need.
export const percentGenerator: Generator<PercentParams> = {
  kind: 'percent',
  label: 'Pourcentages',
  description: 'Augmentation ou baisse d’un prix, avec un prix et un taux tirés au hasard.',
  paramsSchema: percentParamsSchema,
  paramsView: 'generate-percent-params',
  defaultName: (p) => (p.level === 'simple' ? 'Pourcentages' : 'Pourcentages – avancé'),
  describeParams: (p) => `Niveau ${p.level === 'simple' ? 'simple' : 'avancé'}.`,
  formData: () => ({
    levels: [
      { id: 'simple', label: 'Simple (10, 20, 25 ou 50 %)' },
      { id: 'avance', label: 'Avancé (3, 7, 12, 15 ou 35 %)' },
    ],
  }),
  generate: generatePercent,
};
```

What each field of the `Generator` object is for:

| Field | Used by |
|---|---|
| `kind` | Stored on the exercise; the URL `/admin/exercises/generate/<kind>`. |
| `label`, `description` | The "Générer un exercice" list and the exercise page. `label` is also the *Type* column. |
| `paramsSchema` | Validates the form (errors are shown next to the field of the same name) and the stored params. |
| `paramsView` | The settings partial under `views/admin/`, or `null` for a family without settings. |
| `defaultName` | The name when the admin leaves it empty. The route adds ` – 2`, ` – 3`… if it is taken. |
| `describeParams` | One line on the exercise page, summarising the settings. |
| `formData` | Extra locals for the settings partial, such as select options. |
| `generate` | Builds the blocks for one seed. |

### Step 2: register it

In `src/lib/generators/index.ts`, import the generator and add it to `GENERATORS`:

```ts
import { billingGenerator } from './billing.js';
import { percentGenerator } from './percent.js';

export const GENERATORS: Record<string, Generator<unknown>> = {
  [billingGenerator.kind]: billingGenerator as Generator<unknown>,
  [percentGenerator.kind]: percentGenerator as Generator<unknown>,
};
```

It now appears in the "Générer un exercice" list, and `KIND_LABELS` picks up its label.

### Step 3: the settings partial

Create `views/admin/generate-percent-params.ejs`. It receives `values` (the current params, or
what the admin just submitted), `errors` (keyed by field name) and everything from `formData()`.
Name each input after its param. The same partial serves the creation form and the exercise
page, where it is disabled once students have started.

```ejs
<label>Niveau
  <select name="level" data-testid="level">
    <% levels.forEach((l) => { %><option value="<%= l.id %>" <%- values.level === l.id ? 'selected' : '' %>><%= l.label %></option><% }) %>
  </select>
  <% if (errors.level) { %><small class="error"><%= errors.level %></small><% } %>
</label>
```

Nested params work too. Name inputs `lines[remise]` and the form body arrives as
`{ lines: { remise: … } }`, as in `generate-billing-params.ejs`. Avoid purely numeric keys such as
`choice[2]`: the form parser turns them into a compacted array. Use `choice[L2]` instead.

Skip this step if your family has no settings. In that case, set `paramsView: null` and
`paramsSchema: z.object({})`.

### Step 4: the creation page

The route renders `views/admin/generate-<kind>.ejs`, so create
`views/admin/generate-percent.ejs`. Copy `generate-billing.ejs` and adapt the introduction:

```ejs
<%- include('../partials/head') %>
<h1><%= generator.label %></h1>
<p><%= generator.description %></p>
<form method="post" action="/admin/exercises/generate/<%= generator.kind %>" data-testid="generate-form">
  <label>Nom (facultatif, proposé d’après les réglages)
    <input name="name" value="<%= values.name ?? '' %>" maxlength="150" <%- errors.name ? 'aria-invalid="true"' : '' %>>
    <% if (errors.name) { %><small data-testid="error-name"><%= errors.name %></small><% } %>
  </label>
  <% if (paramsView) { %><%- include(paramsView) %><% } %>
  <%- include('retry-option') %>
  <button type="submit">Créer l’exercice</button>
</form>
<%- include('../partials/foot') %>
```

Keep the `name` field and the `retry-option` include: the route reads them for every family.

### Step 5: tests

Create `tests/unit/percent.test.ts`. Cover at least these four points:

```ts
import { describe, expect, it } from 'vitest';
import { computePercent, generatePercent, percentGenerator } from '../../src/lib/generators/percent.js';
import { getGenerator } from '../../src/lib/generators/index.js';
import { questionBlocks, withStableKeys } from '../../src/lib/blocks.js';
import { blocksFor } from '../../src/lib/content.js';

describe('percent generator', () => {
  it('computes known values exactly', () => {
    expect(computePercent(8000, 25, true)).toEqual({ change: 20, final: 100 });
    expect(computePercent(1999, 15, false)).toEqual({ change: 3, final: 16.99 });
  });

  it('is deterministic, and its structure does not depend on the seed', () => {
    const p = percentGenerator.paramsSchema.parse({});
    expect(generatePercent('a', p)).toEqual(generatePercent('a', p));
    const shape = (seed: string) =>
      withStableKeys(generatePercent(seed, p).blocks).map((b) => [b.key, b.type]);
    for (let i = 0; i < 100; i++) expect(shape(`s${i}`)).toEqual(shape('a'));
  });

  it('accepts {} (older exercises) and refuses unknown settings', () => {
    expect(percentGenerator.paramsSchema.parse({})).toEqual({ level: 'simple' });
    expect(percentGenerator.paramsSchema.safeParse({ level: 'x' }).success).toBe(false);
  });

  it('is registered and works through blocksFor, like any stored exercise', () => {
    expect(getGenerator('percent')).toBe(percentGenerator);
    const ex = { blocks: [], generated: { kind: 'percent', params: { level: 'avance' } } };
    expect(questionBlocks(blocksFor(ex, 'seed'))).toHaveLength(3);
  });
});
```

Add these when they apply:

- **A reference exercise.** If a worksheet exists, reproduce its numbers exactly from fixed
  inputs. The billing tests do this with both examples of `sample/CalculComerciaux.pdf`.
- **Invariants over many seeds.** Loop over a few hundred seeds and check what must always hold,
  such as a positive margin or a price within its band.
- **Cross-field settings.** If some combinations of params are invalid, refuse them with
  `superRefine` and test the message (see `unsolvableLines` in `billing.ts`).

One existing test lists the registered families and fails as soon as you add one. In
`tests/unit/billing.test.ts`, update the expected list:

```ts
expect(Object.keys(GENERATORS)).toEqual(['billing', 'percent']);
```

The HTTP flows (creation, assignment, solving, retries, results) are generic and already tested
with the billing family. You don't need to repeat them.

### Step 6: check

```bash
npm run check          # types, lint and tests: must pass
npm run dev
```

Then walk through it in the browser as an admin:

1. **Exercices → Générer un exercice**: your family is listed. Create one, once with the
   defaults and once with settings.
2. On the exercise page, click **Aperçu** a few times: each load is a new draw. Check that the
   numbers are realistic and the expected answers right. Paste a seed into **Tirage** to replay
   it.
3. Assign it to a class from the exercise list, then sign in as a student (the link under the QR
   code) on a phone-sized window. Solve it, open a hint, make a wrong try.
4. Check **Résultats**: one row per attempt, each seed linking to its preview.

Finally, add a line for the new family to the Layout section of `CLAUDE.md`.

## 5. Changing a generator later

Existing attempts store only their seed, so any change to `generate` changes what those seeds
produce. That is a problem for exercises that students have already started.

| Change | Safe? |
|---|---|
| Wording of `markdown` text, labels or tooltips | Yes. Labels are shown from the current code. |
| A new param with a default that reproduces the old output | Yes |
| New options in the admin form (a new level, a new product in a list the admin picks from) | Yes, if the default draw is unchanged |
| Different numbers for the same seed: new catalogue entries in a random draw, another formula, another order of `rng()` calls | **No**: past attempts would show numbers that don't match their recorded tries |
| Adding, removing or reordering blocks | **No**: keys are positions, so tries would move to other questions |

When a change is not safe, add it as a new param whose default keeps the old behaviour. Or
create a new family with a new `kind`, and let teachers create new exercises from it.

## 6. Checklist

- [ ] `src/lib/generators/<kind>.ts` with a `Generator` object and its exported pure functions
- [ ] Every random value comes from `seedrandom(seed)`
- [ ] Same shape of blocks for every seed; any string works as a seed
- [ ] Every param has a default, and `{}` parses
- [ ] Exact arithmetic in integer cents; `tolerance: 0.01` on amounts
- [ ] Tooltips use fixed examples, never the exercise's numbers
- [ ] French text with ` ` where needed
- [ ] Registered in `GENERATORS`
- [ ] `views/admin/generate-<kind>.ejs`, plus `generate-<kind>-params.ejs` if it has settings
- [ ] Unit tests: known values, determinism, fixed shape, `{}` params, `blocksFor`
- [ ] Registry list updated in `tests/unit/billing.test.ts`
- [ ] `npm run check` green, then checked in the browser as admin and as a student
- [ ] `CLAUDE.md` Layout updated
