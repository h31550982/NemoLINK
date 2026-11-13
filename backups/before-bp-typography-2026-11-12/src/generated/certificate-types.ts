/**
 * GENERATED FILE — do not edit. Source of truth:
 * vendor/national-spreadsheet/codelists/certificate_type.json
 * vendor/nemo/hub/codelists.json (certificate_type fiPreferred flags)
 * Regenerate: node tools/gen-cert-types.js  (docs/specs/0020)
 */

export interface CertificateType {
  code: string;
  name: string;
  /** Most commonly used in the Finnish implementation (hub flag). */
  fiPreferred: boolean;
}

export const CERTIFICATE_TYPES: CertificateType[] = [
  { code: "CL", name: "Classification certificate", fiPreferred: true },
  { code: "ISPS", name: "International Ship Security Certificate or Interim International Ship Security Certificate", fiPreferred: true },
  { code: "LL", name: "International Load Line Certificate or Exception", fiPreferred: true },
  { code: "REG", name: "Certificate of Registry", fiPreferred: true },
  { code: "TM", name: "International Tonnage Certificate", fiPreferred: true },
  { code: "OTHER", name: "Other type of certificate", fiPreferred: true },
  { code: "AFS", name: "International Anti-Fouling System Certificate", fiPreferred: false },
  { code: "APP", name: "International Air Pollution Prevention Certificate", fiPreferred: false },
  { code: "BCARD", name: "ITF Blue Card", fiPreferred: false },
  { code: "BCH", name: "International Certificate of Fitness for the carriage of Dangerous Chemicals in Bulk", fiPreferred: false },
  { code: "BUNKER", name: "Certificate of insurance or other financial security in respect of civil liability for bunker oil pollution damage", fiPreferred: false },
  { code: "BWM", name: "International Ballast Water Managment Certificate", fiPreferred: false },
  { code: "CAS", name: "Condition Assessment Scheme Statement of compliance", fiPreferred: false },
  { code: "CLC", name: "Certificate of Insurance in Respect of Civil Liability for Oil Pollution Damage", fiPreferred: false },
  { code: "CS", name: "Cargo Ship Safety Certificate", fiPreferred: false },
  { code: "CY_CPVS", name: "Coastal Passenger Vessel Safety Certificate", fiPreferred: false },
  { code: "CY_FWT", name: "Fresh Water Tank Certificate", fiPreferred: false },
  { code: "CY_SPVS", name: "Small Passenger Vessel Safety Certificate", fiPreferred: false },
  { code: "DOC", name: "Document of Compliance (ISM)", fiPreferred: false },
  { code: "DOCDG", name: "Document of compliance with the special requirements for ships carrying dangerous goods (for any ship carrying dangerous goods) - SOLAS 1974/Reg.II-2/19.4", fiPreferred: false },
  { code: "EE", name: "International Energy Efficiency Certificate", fiPreferred: false },
  { code: "EEDI", name: "Energy Efficiency Design Index", fiPreferred: false },
  { code: "EIAPP", name: "Engine International Air Pollution Prevention Certificate", fiPreferred: false },
  { code: "GC", name: "Certificate of Fitness for the Carriage of Liquified Gases in Bulk", fiPreferred: false },
  { code: "HSC", name: "High-Speed Craft Safety Certificate", fiPreferred: false },
  { code: "IMC", name: "Insurance for Maritime Claims", fiPreferred: false },
  { code: "INF", name: "International certificate of Fitness for the Carriage of INF cargo", fiPreferred: false },
  { code: "IT_CDG", name: "Statement of compliance for the carriage of dangerous goods (Italy)", fiPreferred: false },
  { code: "IT_CFS", name: "Certificate of fitness/safety proof (Italy)", fiPreferred: false },
  { code: "IT_CI", name: "Crew insurance (Italy)", fiPreferred: false },
  { code: "IT_CMF", name: "Statement of compliance for the carriage of motor vehicles with fuel in their tank (Italy)", fiPreferred: false },
  { code: "IT_CR", name: "Crew role document (Italy)", fiPreferred: false },
  { code: "IT_CS", name: "Certificate of seaworthiness (Italy)", fiPreferred: false },
  { code: "IT_CSDG", name: "Statement of compliance for the carriage of solid dangerous goods in bulk (Italy)", fiPreferred: false },
  { code: "IT_CSGB", name: "Statement of compliance for the carriage of solid goods in bulk having a moisture content in excess of the TML (Italy)", fiPreferred: false },
  { code: "IT_OES", name: "On-board equipment and services survey (Italy)", fiPreferred: false },
  { code: "IT_TH", name: "Technical - health survey (Italy)", fiPreferred: false },
  { code: "MLC", name: "Maritime Labour Certificate", fiPreferred: false },
  { code: "MODU", name: "Mobile Offshore Drilling Unit Safety Certificate", fiPreferred: false },
  { code: "MSDS", name: "Material Safety Data Sheets: ships carrying oil or oil fuel", fiPreferred: false },
  { code: "MT_CA", name: "Class Attestations / Certificate", fiPreferred: false },
  { code: "MT_HM", name: "Hull & Machinery", fiPreferred: false },
  { code: "NCS", name: "Nuclear Cargo Ship Safety Certificate", fiPreferred: false },
  { code: "NLS", name: "International Pollution Prevention Certificate for the Carriage of Noxious Liquid Substances in Bulk", fiPreferred: false },
  { code: "NPSS", name: "Nuclear Passenger Ship Safety Certificate", fiPreferred: false },
  { code: "OPP", name: "International Oil Pollution Prevention Certificate", fiPreferred: false },
  { code: "OSV", name: "Offshore Supply vessel Document of Compliance", fiPreferred: false },
  { code: "PAL", name: "Certificate of insurance or other financial security in respect of liability for the death of and personal injury to passengers", fiPreferred: false },
  { code: "POLAR", name: "Polar Ship Certificate", fiPreferred: false },
  { code: "PSS", name: "Passenger Ship Safety Certificate", fiPreferred: false },
  { code: "SC", name: "Cargo Ship Safety Construction Certificate", fiPreferred: false },
  { code: "SE", name: "Cargo Ship Safety Equipment Certificate", fiPreferred: false },
  { code: "SEEMP", name: "Shipboard Energy Efficiency Management Plan", fiPreferred: false },
  { code: "SM", name: "Safety Management Certificate", fiPreferred: false },
  { code: "SMAN", name: "Minimum Safe Manning Document", fiPreferred: false },
  { code: "SPP", name: "International Sewage Pollution Prevention certificate", fiPreferred: false },
  { code: "SPS", name: "Special Purpose Ship Safety Certificate", fiPreferred: false },
  { code: "SR", name: "Cargo Ship Safety Radio Certificate", fiPreferred: false },
  { code: "SSC", name: "Ship Sanitation Control Certificate", fiPreferred: false },
  { code: "SSCEX", name: "Ship Sanitation Control Exemption Certificate", fiPreferred: false },
  { code: "SSTP", name: "Special Trade Passenger Ship Space Certificate", fiPreferred: false },
  { code: "STP", name: "Special Trade Passenger Ship Safety Certificate", fiPreferred: false },
  { code: "TOW", name: "Towage certificate", fiPreferred: false },
  { code: "WRC", name: "Certificate of Insurance in Respect of Civil Liability for the Removal of Wrecks", fiPreferred: false },
];

const BY_CODE = new Map(CERTIFICATE_TYPES.map((t) => [t.code, t.name]));

/** Vendored EN name for a code; falls back to the raw code. */
export function certificateName(code: string): string {
  return BY_CODE.get(code) ?? code;
}
