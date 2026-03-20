/**
 * Static Fields Configuration
 *
 * These fields are NOT editable by users. They represent fixed manufacturer
 * information and instructions that must appear on every pharmaceutical label.
 *
 * This configuration serves as the single source of truth for both frontend
 * and backend enforcement.
 */
export const STATIC_FIELDS = {
  manufacturerName: "GUJARAT THEMIS BIOSYN LTD",
  manufacturerAddress: "WORKS: 69/C, GIDC, INDUSTRIAL ESTATE, VAPI - 396195, DIST. VALSAD, GUJARAT (INDIA)",
  storageInstruction: "STORE IN AIR TIGHT CONTAINER PROTECTED FROM LIGHT",
  qrCaption: "QRCODE"
};

export const STATIC_FIELD_KEYS = Object.keys(STATIC_FIELDS);
