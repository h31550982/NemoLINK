import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Workbook, SpreadsheetFile } from '@oai/artifact-tool';

const work = path.dirname(fileURLToPath(import.meta.url));
const output = path.dirname(work);
const workbook = Workbook.create();
const form = workbook.worksheets.add('Cargo declaration');
const details = workbook.worksheets.add('CGA details');
const ink = '#0F0F2A', blue = '#363ADD', light = '#F3F4F8', line = '#D5D6DD';
const source = 'https://www.emsw.fi/en/cga-cargo-declaration-arrival';

function set(sheet, cell, value) { sheet.getRange(cell).values = [[value]]; }
function formula(sheet, cell, value) { sheet.getRange(cell).formulas = [[value]]; }
function header(sheet, range, height = 46) {
  sheet.getRange(range).format = {
    fill: blue, font: { name: 'Arial', size: 10, bold: true, color: '#FFFFFF' },
    wrapText: true, horizontalAlignment: 'center', verticalAlignment: 'center', rowHeight: height,
    borders: { insideVertical: { style: 'thin', color: '#FFFFFF' } },
  };
}
function section(sheet, range, title) {
  set(sheet, range.split(':')[0], title);
  sheet.getRange(range).format = {
    fill: light, font: { name: 'Arial', size: 10, bold: true, color: ink }, rowHeight: 26,
    borders: { bottom: { style: 'thin', color: line } },
  };
}
function base(sheet, lastRow, widths) {
  sheet.showGridLines = false;
  sheet.getRange(`A1:I${lastRow}`).format = {
    font: { name: 'Arial', size: 10, color: ink }, rowHeight: 24, verticalAlignment: 'center',
  };
  widths.forEach((width, i) => sheet.getRangeByIndexes(0, i, lastRow, 1).format.columnWidth = width);
  sheet.tabColor = blue;
}
base(form, 18, [23, 27, 24, 34, 17, 20, 19, 19, 20]);
base(details, 42, [25, 27, 24, 27, 34, 25, 19, 23, 22]);

set(form, 'A2', 'Cargo declaration (IMO FAL Form 2)');
form.getRange('A2:I2').format = { font: { name: 'Arial', size: 16, bold: true, color: ink }, rowHeight: 32, borders: { bottom: { style: 'thin', color: blue } } };
set(form, 'A3', 'Testing example. Fictitious shipment.');
form.getRange('A3:I3').format.font = { name: 'Arial', size: 10, color: '#8A5A00' };
set(form, 'A4', 'Arrival'); set(form, 'B4', 'X'); set(form, 'H4', 'Departure');
for (const [cell, value] of Object.entries({
  A5: '1.1 Name of ship', C5: '1.2 IMO number', E5: '1.3 Call sign', G5: '1.4 Voyage number', I5: 'Flag state',
  A6: 'BLACK PEARL', C6: '1236668', E6: 'MBPL7', G6: 'EX-CGA-001', I6: 'GB',
  A8: '2. Port of discharge', C8: '3. Date of arrival', E8: '4. Name of master', G8: 'Port of loading',
  E9: 'Jack Sparrow', A11: 'Cargo to discharge (kg)', E11: 'Cargo remaining (kg)',
  A12: 'Remarks', B12: 'Testing example. 19,000 kg discharged at FIHMN. 8,000 kg of steel remain on board.',
})) set(form, cell, value);
set(form, 'C9', new Date('2026-11-10T00:00:00Z'));
form.getRange('C9').setNumberFormat('yyyy-mm-dd');
formula(form, 'A9', "='CGA details'!C13");
formula(form, 'G9', "='CGA details'!B13");
formula(form, 'C11', '=SUM(F16:F18)');
formula(form, 'G11', "='CGA details'!D33");
form.getRange('C11').setNumberFormat('#,##0');
form.getRange('G11').setNumberFormat('#,##0');
for (const r of [5, 8]) form.getRange(`A${r}:I${r}`).format.font = { name: 'Arial', size: 10, bold: true, color: '#545162' };
form.getRange('A6:I6').format.fill = '#FFF8E5';
form.getRange('A9:I9').format.fill = '#FFF8E5';
form.getRange('A11:I11').format.font = { name: 'Arial', size: 10, bold: true, color: ink };
form.getRange('A15:I15').values = [['B/L', 'Marks and numbers', 'Number and kind of packages', 'Description of goods', 'HS code', 'Gross weight (kg)', 'Measurement (m³)', 'Port of loading', 'Port of discharge']];
header(form, 'A15:I15', 48);
for (let r = 16; r <= 18; r++) {
  const sourceRow = r + 2;
  set(form, `A${r}`, `EX-CGA-001/0${r - 15}`);
  set(form, `C${r}`, 'Bundles (BE)');
  formula(form, `D${r}`, `='CGA details'!E${sourceRow}`);
  formula(form, `E${r}`, `='CGA details'!D${sourceRow}`);
  formula(form, `F${r}`, `='CGA details'!F${sourceRow}`);
  formula(form, `H${r}`, "='CGA details'!B13");
  formula(form, `I${r}`, "='CGA details'!C13");
}
formula(form, 'B16', "='CGA details'!D25");
formula(form, 'B17', "='CGA details'!D26&\" / \"&'CGA details'!D27");
formula(form, 'B18', "='CGA details'!D28");
form.getRange('A16:I18').format.rowHeight = 38;
form.getRange('A16:I18').format.borders = { insideHorizontal: { style: 'thin', color: line } };
form.getRange('F16:G18').setNumberFormat('#,##0');
form.getRange('E16:E18').setNumberFormat('@');

set(details, 'A2', 'CGA cargo declaration at arrival');
details.getRange('A2:I2').format = { font: { name: 'Arial', size: 16, bold: true, color: ink }, rowHeight: 32, borders: { bottom: { style: 'thin', color: blue } } };
set(details, 'A3', 'Testing example. Fictitious shipment.');
details.getRange('A3:I3').format.font = { name: 'Arial', size: 10, color: '#8A5A00' };
set(details, 'A5', `Source: EMSWe CGA guide, accessed 2026-11-10. ${source}`);
details.getRange('A5:I5').format.font = { name: 'Arial', size: 10, color: '#545162' };
section(details, 'A7:I7', 'Declaration');
set(details, 'A8', 'Notification'); set(details, 'B8', 'CGA');
set(details, 'D8', 'Shipment reference'); set(details, 'E8', 'EX-CGA-001');
set(details, 'A9', 'Remarks (DE-003-01)');
set(details, 'B9', 'Fictitious testing shipment. Discharge the listed consignments at FIHMN. No offshore transfer.');

section(details, 'A11:F11', 'Supply chain consignments');
details.getRange('A12:F12').values = [['Consignment ID', 'Loading port\nDE-047-01', 'Discharge port\nDE-047-04', 'Transit goods\nDE-045-01', 'Manifest type', '']];
header(details, 'A12:E12');
details.getRange('A13:E13').values = [['C1', 'SESTO', 'FIHMN', 'No', 'IMPORT']];
details.getRange('D13').dataValidation = { rule: { type: 'list', values: ['Yes', 'No'] } };
details.getRange('E13').dataValidation = { rule: { type: 'list', values: ['IMPORT', 'EXPORT', 'TRANSIT', 'CONTAINER'] } };

section(details, 'A16:I16', 'Goods items to discharge');
details.getRange('A17:I17').values = [['Goods ID', 'Consignment ID', 'Empty equipment', 'HS code\nDE-048-05', 'Description\nDE-048-04', 'Gross weight (kg)\nDE-048-03', 'Origin country', 'Package type\nDE-048-10', 'Quantity\nDE-048-09']];
header(details, 'A17:I17');
details.getRange('A18:I20').values = [
  ['G1', 'C1', 'No', '481190', 'Paper and pulp', 10000, 'SE', 'BE', null],
  ['G2', 'C1', 'No', '481160', 'Paperboard', 5000, 'SE', 'BE', null],
  ['G3', 'C1', 'No', '441210', 'Plywood', 4000, 'SE', 'BE', null],
];
details.getRange('D18:D20').setNumberFormat('@');
details.getRange('F18:F20').setNumberFormat('#,##0');
details.getRange('C18:C20').dataValidation = { rule: { type: 'list', values: ['Yes', 'No'] } };
details.dataValidations.add({ range: 'F18:F20', rule: { type: 'decimal', operator: 'greaterThan', formula1: 0 } });

section(details, 'A23:E23', 'Transport equipment');
details.getRange('A24:E24').values = [['Goods ID', 'Category\nDE-051-22', 'Size and type\nDE-051-17', 'Equipment identifier', 'Equipment count']];
header(details, 'A24:E24');
details.getRange('A25:E28').values = [
  ['G1', 'BPO', null, 'ABC123', 1],
  ['G2', 'BPO', null, 'XYZ123', 1],
  ['G2', 'BPO', null, 'CCC222', 1],
  ['G3', 'SM', null, 'CBB111', 1],
];
details.getRange('B25:B28').dataValidation = { rule: { type: 'list', values: ['AI', 'CN', 'SM', 'TE', 'TN', 'VT', 'BPO', 'BPP', 'RR', 'PL', 'AJ', 'AM', 'BPX', 'BR'] } };

section(details, 'A31:D31', 'Specified cargo remaining on board');
details.getRange('A32:D32').values = [['Cargo type\nDE-045-17', 'Description', 'Quantity on board\nDE-045-26', 'Weight on board (kg)\nDE-045-27']];
header(details, 'A32:D32');
details.getRange('A33:D33').values = [['92', 'Iron and steel products', null, 8000]];
details.getRange('A33').setNumberFormat('@');
details.getRange('D33').setNumberFormat('#,##0');
details.dataValidations.add({ range: 'D33', rule: { type: 'decimal', operator: 'greaterThan', formula1: 0 } });
set(details, 'A36', 'Example assumptions');
details.getRange('A36:I36').format.font = { name: 'Arial', size: 10, bold: true, color: ink };
const notes = [
  ['Ports and origin', 'Stockholm (SESTO), Hamina (FIHMN) and origin SE are example choices.'],
  ['Equipment and packaging', 'Vehicle identifiers follow the guide examples. Bundles (BE) are assumed.'],
  ['Retained cargo', '8,000 kg of steel (type 92) remaining on board is an added test scenario.'],
  ['Quantities', 'No live animals or sale vehicles. Package and retained-unit quantities are not applicable.'],
  ['Weight allocation', '5,000 kg belongs to G2 across two trucks. Count this weight once.'],
  ['Format', 'Custom testing workbook. Not the official National Spreadsheet upload template.'],
];
details.getRange('A37:B42').values = notes;
details.getRange('A37:A42').format.font = { name: 'Arial', size: 10, bold: true, color: '#545162' };
details.getRange('B37:I42').format.font = { name: 'Arial', size: 10, color: '#545162' };
for (const range of ['A13:E13', 'A18:I20', 'A25:E28', 'A33:D33']) {
  details.getRange(range).format.fill = '#FFF8E5';
  details.getRange(range).format.borders = { insideHorizontal: { style: 'thin', color: line } };
}

workbook.recalculate();
const actual = form.getRange('C11').values[0][0];
if (actual !== 19000) throw new Error(`Discharge total mismatch: ${actual}`);
if (form.getRange('G11').values[0][0] !== 8000) throw new Error('Retained weight mismatch');
details.getRange('F19').values = [[5100]];
workbook.recalculate();
if (form.getRange('C11').values[0][0] !== 19100) throw new Error('Linked weight recalculation failed');
details.getRange('F19').values = [[5000]];
workbook.recalculate();
const errors = await workbook.inspect({ kind: 'match', searchTerm: '#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!', options: { useRegex: true, maxResults: 30 }, maxChars: 1800 });
console.log(errors.ndjson);
console.log((await workbook.inspect({ kind: 'region', sheetId: 'Cargo declaration', range: 'A15:I18', maxChars: 2400, tableMaxRows: 5, tableMaxCols: 9 })).ndjson);
for (const [sheetName, range, name] of [['Cargo declaration', 'A1:I18', 'form'], ['CGA details', 'A1:I42', 'details']]) {
  const preview = await workbook.render({ sheetName, range, scale: 1, format: 'png' });
  await fs.writeFile(path.join(work, `${name}.png`), new Uint8Array(await preview.arrayBuffer()));
}
await fs.mkdir(output, { recursive: true });
await (await SpreadsheetFile.exportXlsx(workbook)).save(path.join(output, 'CGA_Cargo_Declaration_Filled_Test_Example.xlsx'));
console.log('Exported filled example. Discharge: 19000 kg. Remaining: 8000 kg.');
