import fs from 'node:fs/promises';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

// Pièces entièrement synthétiques de recette ; aucun calcul du prêt canonique.
const output = process.argv[2];
if (!output) throw new Error('Indiquer le répertoire de sortie des fixtures');
await fs.mkdir(output, { recursive: true });
const headers = ['date','ouverture','principal','interet','assurance','frais','cloture','total'];
const cases = [
  { name: 'echeancier-partiel', dates: ['2026-12-05'], rows: [[1000,1000,0,5,0,0,1005]] },
  { name: 'echeancier-dates-anormales', dates: ['2026-11-05','2026-12-05','2026-12-05','2027-01-05','2027-03-05'], rows: [[2000,400,0,5,0,1600,405],[1600,400,0,5,0,1200,405],[1200,400,0,5,0,800,405],[800,400,0,5,0,400,405],[400,400,0,5,0,0,405]] },
  { name: 'echeancier-formules', dates: ['2026-11-05','2026-12-05'], rows: [[2000,1000,0,5,0,1000,1005],[1000,1000,0,5,0,0,1005]], formulas: true },
];
for (const scenario of cases) {
  const workbook = Workbook.create();
  const sheet = workbook.worksheets.add('Échéancier synthétique');
  sheet.showGridLines = false;
  sheet.getRange('A1:H1').values = [headers];
  sheet.getRange('A1:H1').format = { fill: '#14332F', font: { name: 'Arial', bold: true, color: '#FFFFFF' } };
  const last = scenario.rows.length + 1;
  sheet.getRange(`A2:H${last}`).values = scenario.rows.map((row,i) => [new Date(scenario.dates[i]+'T00:00:00Z'),...row]);
  sheet.getRange(`A2:A${last}`).setNumberFormat('yyyy-mm-dd');
  sheet.getRange(`B2:H${last}`).setNumberFormat('#,##0.00');
  sheet.getRange(`A1:H${last}`).format.font.name = 'Arial';
  sheet.getRange(`A1:H${last}`).format.font.size = 11;
  sheet.getRange(`A1:H${last}`).format.columnWidth = 16;
  if (scenario.formulas) {
    sheet.getRange('H2').formulas = [['=SUM(C2:F2)']];
    sheet.getRange(`H2:H${last}`).fillDown();
  }
  workbook.recalculate();
  console.log(scenario.name, (await workbook.inspect({kind:'table', range:`'Échéancier synthétique'!A1:H${last}`, include:'values,formulas', tableMaxRows:7,tableMaxCols:8,maxChars:1800})).ndjson);
  const errors=await workbook.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!',options:{useRegex:true,maxResults:10},maxChars:1000});
  console.log(errors.ndjson);
  const preview = await workbook.render({sheetName:sheet.name,range:`A1:H${last}`,scale:1.5,format:'png'});
  await fs.writeFile(`${output}/${scenario.name}.png`,new Uint8Array(await preview.arrayBuffer()));
  await (await SpreadsheetFile.exportXlsx(workbook)).save(`${output}/${scenario.name}.xlsx`);
}
