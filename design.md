# Léo Family Office — Cockpit Workstation V10

> Active design specification for the V10 validation preview.
>
> Core rule: **visual finance first, text second, sources always visible, depth on demand.**

## 1. Corrective direction

V9 is rejected wherever it turns the user journey into explanatory copy, stacked cards or lists of future KPI. The cockpit must not explain the workflow with paragraphs; it must make the workflow visible through a financial workstation.

Default authenticated screen anatomy:

1. compact domain header;
2. persistent source rail;
3. dominant financial canvas;
4. compact analytical inspector;
5. optional detailed engine opened on demand.

Target desktop visual proportion: 68–75% analytical visual content, 15–20% sources/controls, less than 15% explanatory text.

## 2. Text budget

- Domain label: max 2 words.
- Financial question: max 14–16 words.
- No explanatory paragraph under the domain question.
- Source item: title + max 4-word hint.
- Inspector: 4–6 rows visible.
- Operational labels: 10–12 px minimum.
- Body copy when necessary: 13–14 px.

If a paragraph is required before a user can understand the chart, redesign the chart.

## 3. Workstation geometry

Desktop conceptual 16-column grid:

- source rail: 2.5–3 columns;
- main canvas: 9–10.5 columns;
- inspector: 2.5–3 columns.

The main canvas should normally be visible without scrolling on a 1440×900 desktop.

## 4. Header controls

Left:
- financial domain icon;
- short domain name;
- one financial question.

Right:
- `Réel / Simulation` segmented control;
- view-personalization icon;
- `Analyse détaillée` action.

Buttons should feel like financial instrumentation rather than marketing CTAs: 36–40 px height, 8–10 px radius, clear border, 12–13 px label.

## 5. Source rail

Sources are an operational map, not teaching cards.

Each row:
- 32–36 px icon tile;
- concrete source name;
- short source type;
- check if active;
- upload/add state if missing.

Preferred concrete labels:
- Banque;
- Transactions;
- Échéancier;
- Contrat;
- Bulletin;
- Relevé courtier;
- Liasse;
- FEC;
- Acte;
- Devis;
- Avis fiscal.

Clicking a source should focus the linked visual object and expose edit/replace/provenance actions in the inspector.

## 6. Missing data

Never create an empty KPI card labelled `Non calculable`.

Missing information changes the visual geometry:
- unsupported layer is absent or outlined;
- relevant source row shows `+` / upload;
- inspector explains the exact missing field only after interaction.

Example Debt without schedule: no fake amortisation curve. Show contract terms plus an outlined schedule area and highlight `Échéancier +`.

## 7. Réel vs Simulation

### Réel
- solid lines and blocks;
- observed / contractual colors;
- source/date available.

### Simulation
- violet accent;
- dashed lines / translucent scenario range;
- `Simulation isolée` watermark;
- assumptions available in inspector;
- no silent mutation of actual state.

Switching mode transforms the current financial canvas rather than loading a separate text-heavy workflow.

## 8. Forms

Forms never dominate the first screen.

Add/edit action opens a drawer or modal.

Use progressive field levels:
- minimum useful data;
- precision;
- institutional depth.

Use editable rows for repeating structures: recurring flows, capex, works, loan charges, holdings, income sources.

Each row can expose edit, delete, source, date and status.

## 9. Wealth

Default canvas = consolidated balance sheet:

`ACTIFS − DETTES = PATRIMOINE NET`

Assets are stacked and clickable by magnitude:
- liquid cash;
- listed investments;
- real estate;
- business equity;
- other assets.

Debt is separated visually.

Inspector: Net Worth, liquidity ratio, concentration, variation and completeness.

A liquidity action transforms the same canvas into a liquidity ladder instead of creating another page section.

## 10. Cash Flow

Cash Flow is a flow map, not a transaction list.

Default canvas:

`REVENUS → INCOMPRESSIBLE → FLEXIBLE → DETTE → ÉPARGNE / INVESTISSEMENT → LIBERTÉ`

Widths encode magnitude.

Semantic colors:
- inflow = green/cyan;
- incompressible = amber;
- flexible = blue;
- debt = coral;
- remaining freedom = cyan/green.

Click a flow to inspect its components and reclassify/link items.

Alternate visual modes inside the same canvas:
- Flux;
- Récurrents;
- Historique;
- Stress revenu.

Automation anomalies live in a compact inbox/drawer, not a permanent paragraph section.

## 11. Debt

Default canvas = contractual amortisation workstation.

Visible:
- current balance;
- actual provided schedule when available;
- next payment;
- maturity;
- optional refinancing overlay.

Bottom strip:
`Principal | Intérêts | Assurance | Frais`
with widths proportional to payment.

Source priority:
1. bank schedule;
2. contract;
3. observed bank debit;
4. insurance.

Click payment → exact contractual decomposition.
Simulation → refinance curve overlays current contract.

## 12. Investments

Premium portfolio terminal, calmer than a trading application.

Default canvas:
- portfolio value/performance;
- benchmark;
- contributions/withdrawals;
- actual/projected separation.

Side visual: allocation ring or treemap.

View switch:
- Performance;
- Allocation;
- Risque;
- Liquidité;
- Enveloppes fiscales.

The canvas changes; the page does not stack five separate panels.

## 13. Real Estate

Default canvas = investment dossier with three visual columns.

### Property
value/purchase price, area, price/m², location/demand.

### Complete cost stack
purchase + acquisition fees + works + furnishing + contingency.

### Financing
Debt/equity, monthly payment and remaining liquidity.

View switch:
- Acquisition;
- Travaux;
- Exploitation;
- Rendement;
- Sortie.

Rental operations canvas:
`Potential rent → vacancy → charges → NOI → debt → cash → tax → after-tax cash`.

Never mix gross yield and after-tax cash without explicit labels and denominators.

## 14. Career

Default canvas:
`BRUT → COTISATIONS → NET IMPOSABLE → PRÉLÈVEMENT → NET PAYÉ`

Each block is source-linked to payslip data.

Reconciliation line:
`Contrat → Bulletin → Banque → Cash Flow`.

Scenario compares current package with new offer through net cash, savings capacity and relevant cost-of-living effects.

## 15. Business Equity

Default canvas uses two professional finance bridges.

### EBITDA to cash
`EBITDA − ΔBFR − maintenance capex − growth capex − cash taxes ± autres = cash opérationnel`.

Maintenance vs growth capex remain visually distinct.

### EV to Equity
`Enterprise Value − debt-like + cash-like ± adjustments = Equity Value × ownership = user stake`.

View switch:
- P&L;
- Cash conversion;
- BFR;
- Valorisation;
- Détention.

Liasse/FEC imports stay in the source rail.

## 16. Tax

Tax is a transformation visual:

`Résultat économique → base taxable → impôt → cash après impôt`.

Three calculation states:
- deterministic;
- estimated;
- insufficient.

Estimated values show ranges rather than false precision.

Inspector provides jurisdiction, rule date, source, assumptions and confidence.

## 17. Scenarios

Main canvas = trajectory fan.

Observed history ends at today. Projection begins after today.

Controls:
- central;
- stress;
- optimistic;
- assumptions;
- horizon.

Changing an assumption changes trajectory and inspector values directly.

## 18. Decision Lab

Decision Lab is a comparison studio:
- Option A left;
- comparison axis center;
- Option B right.

Compare:
- Net Worth;
- liquidity;
- monthly Cash Flow;
- risk;
- goal feasibility.

Do not declare a winner unless the user's objective function is explicit. Otherwise display trade-offs.

## 19. Goals

Default canvas:
`Current capital + monthly funding + investment contribution → target`.

Progress ring is secondary; funding trajectory is primary.

Goals remain linked to Cash Flow, liquidity, investments and debt constraints.

## 20. Inspector

The inspector answers only the currently selected object:
- exact number;
- definition;
- actual/contractual/projected;
- source;
- date;
- confidence;
- formula;
- linked domains;
- edit action.

The inspector replaces explanatory paragraphs.

## 21. Graph interaction

Hover → highlight linked values.

Click → lock selection.

Open detail → source / formula / raw entry.

Range → time-window update.

Compare → second period / series / scenario.

Use drag only when spatial manipulation improves understanding, mainly Decision Lab.

## 22. Personalization

`Personnaliser la vue` opens a compact overlay with:
- eye icon;
- drag handle;
- default time range;
- density.

Users can save layouts per domain.

Presentation preferences never alter canonical financial truth.

## 23. Color system

Stable semantics:
- observed/actual = blue/cyan;
- positive cash/confirmed = green;
- debt/pressure = coral;
- cost/caution/incomplete = amber;
- scenario/modelled = violet;
- benchmark/neutral = steel.

Domain accents may tint surfaces but cannot redefine semantic colors.

Light and dark modes preserve the same semantic mapping.

## 24. Icon system

Stable mapping:
- Banknote → bank / transaction;
- FileText → contract/document;
- FileCheck → reconciled source;
- Landmark → debt;
- Building → property;
- TrendingUp → investment;
- Briefcase → career;
- Network → ownership/business;
- Receipt → tax;
- Target → goal;
- Flask → scenario;
- Sliders → view/assumptions;
- Shield → verified/privacy;
- Database → detailed records.

Avoid decorative sparkles in analytical surfaces.

## 25. Detailed engine

Existing deep analytical pages remain available behind `Analyse détaillée`.

They contain:
- raw tables;
- schedules;
- full forms;
- advanced options;
- formulas;
- source provenance.

This protects two audiences: the normal user understands meaning first; an expert can descend into records and assumptions.

## 26. Validation checklist

A cockpit domain fails V10 if:
1. more than one paragraph is visible above the fold;
2. it defaults to a generic KPI-card grid;
3. source status is hidden;
4. missing data renders as `Non calculable` KPI cards;
5. advanced capabilities are explained through repeated cards;
6. its main visual could belong unchanged to another domain;
7. real and simulation are visually ambiguous;
8. forms occupy the first screen;
9. raw source/calculation detail cannot be reached;
10. the financial question is not understandable in five seconds.

## 27. Final rule

**LFO should feel like a private financial workstation that happens to be easy to use — not an easy application hiding a pile of finance forms behind it.**

Visual hierarchy:

`financial reality → financial structure → analytical interaction → source/formula depth`.

Text supports the analysis. It never substitutes for the analysis.
