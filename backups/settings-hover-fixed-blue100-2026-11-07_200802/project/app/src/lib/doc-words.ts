/**
 * Plain words for the values of uploaded ship forms (specs 0049, 0093):
 * the parser's camelCase keys as a person reads them. Shared by the port
 * call's document view and the forms wizard.
 */

const FIELD_WORDS: Record<string, string> = {
  imo: 'IMO number',
  no: 'No',
  unNumber: 'UN number',
  blNumber: 'B/L number',
  facilityGisis: 'Port facility (GISIS)',
  portLocode: 'Port (LOCODE)',
  typeCode: 'Waste type',
  onBoard: 'Retained on board',
  idDocument: 'Identity document',
  idDocumentNature: 'Identity document type',
};

/** camelCase → plain words, with the domain acronyms kept upright. */
export function fieldWords(key: string): string {
  const named = FIELD_WORDS[key];
  if (named) return named;
  const words = key.replace(/([A-Z])/g, ' $1').toLowerCase().trim();
  return (words[0]?.toUpperCase() ?? '') + words.slice(1);
}

/** Which person, article or port a table row is about — its first telling value. */
export function rowWords(row: Record<string, string>, index: number): string {
  const name =
    row['name'] ??
    ([row['lastName'], row['firstName']].filter(Boolean).join(', ') || undefined) ??
    row['article'] ??
    row['type'] ??
    row['portLocode'] ??
    row['portName'];
  return name ? `${index + 1} · ${name}` : `Row ${index + 1}`;
}
