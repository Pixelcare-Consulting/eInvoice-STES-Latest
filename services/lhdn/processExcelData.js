const fs = require('fs');
const path = require('path');
const { logRawToJson, logLhdnMapping } = require('./excelLogger');
const { mapToLHDNFormat, assertMaxLength } = require('./lhdnMapper');

/**
 * Constants for Excel field mapping and default values
 */
// Define possible Excel column name prefixes for field mapping
const EXCEL_FIELD_PREFIXES = [
  '__EMPTY_',  // Original format with double underscore EMPTY first
  '',         // Direct field name (e.g. "Invoice")
  '_',        // Alternative format with single underscore
  'EMPTY_',   // Another possible format
  '__',       // Double underscore without EMPTY
  'Column',   // Column prefix format
  'Field',    // Field prefix format
  'col',      // col prefix format
  'field'     // field prefix format
];

// Define row type indicators to identify header, line items, and footer rows
const ROW_TYPE_INDICATORS = {
  HEADER: {
    type: 'H',
    identifiers: ['Invoice', 'InvoiceNumber', 'DocumentNumber']
  },
  LINE: {
    type: 'L',
    identifiers: ['InvoiceLine', 'LineNumber', 'ItemNumber']
  },
  FOOTER: {
    type: 'F',
    identifiers: ['LegalMonetaryTotal', 'TotalAmount', 'Invoice_TaxTotal']
  }
};

// Define party identification scheme types for tax and business registration
const PARTY_SCHEME_TYPES = {
  TIN: 'TIN', // Tax Identification Number
  BRN: 'BRN', // Business Registration Number
  NRIC: 'NRIC',
  PASSPORT: 'PASSPORT',
  ARMY: 'ARMY',
  SST: 'SST', // Sales and Service Tax
  TTX: 'TTX'  // Tax Registration Number
};

const IDENTITY_SCHEME_IDS = new Set(['BRN', 'NRIC', 'PASSPORT', 'ARMY']);
const MALAYSIAN_STATE_CODES = new Set([
  '01', '02', '03', '04', '05', '06', '07', '08', '09',
  '10', '11', '12', '13', '14', '15', '16', '17'
]);

const FIELD_LIMITS = {
  INVOICE_NO: 50,
  BANK_ACCOUNT: 150,
  CERT_EX: 300,
  INDUSTRY_NAME: 300,
  PAYMENT_TERMS: 300,
  PREPAID_ID: 150,
  PASSPORT: 12,
  MY_POSTCODE: 5,
  NON_MY_POSTCODE: 50,
  STATE: 50
};

const isNaToken = (value) => {
  if (value === null || value === undefined) {
    return false;
  }
  const normalized = String(value).trim().toUpperCase();
  return normalized === 'NA' || normalized === 'N/A';
};

const isBlank = (value) => value === null || value === undefined || String(value).trim() === '';

const resolveIdentityScheme = (rawScheme, partyLabel) => {
  if (isBlank(rawScheme)) {
    return PARTY_SCHEME_TYPES.BRN;
  }

  const scheme = String(rawScheme).trim().toUpperCase();
  if (!IDENTITY_SCHEME_IDS.has(scheme)) {
    throw new Error(
      `Invalid ${partyLabel} identification scheme "${rawScheme}". Expected one of: BRN, NRIC, PASSPORT, ARMY`
    );
  }
  return scheme;
};

const assertYyyyMmDd = (value, fieldName, { required = false } = {}) => {
  if (isBlank(value)) {
    if (required) {
      throw new Error(`${fieldName} is required and must be YYYY-MM-DD`);
    }
    return null;
  }

  if (isNaToken(value)) {
    throw new Error(`${fieldName} must be YYYY-MM-DD and cannot be NA/N/A`);
  }

  const dateStr = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`${fieldName} must be in YYYY-MM-DD format, got: ${dateStr}`);
  }
  return dateStr;
};

const isMalaysiaCountry = (country) => {
  if (isBlank(country)) {
    return true;
  }
  const normalized = String(country).trim().toUpperCase();
  return normalized === 'MYS' || normalized === 'MY' || normalized === 'MALAYSIA';
};

const requireAddressValue = (value, fieldName) => {
  if (isBlank(value) || isNaToken(value)) {
    throw new Error(`${fieldName} is required and cannot be NA/N/A`);
  }
  return String(value).trim();
};

const validatePostcode = (postcode, country, fieldName) => {
  const value = requireAddressValue(postcode, fieldName);
  if (isMalaysiaCountry(country)) {
    if (!/^\d{1,5}$/.test(value)) {
      throw new Error(`${fieldName} for Malaysia must be 1-5 digits only`);
    }
    assertMaxLength(value, FIELD_LIMITS.MY_POSTCODE, fieldName, { allowEmpty: false });
  } else {
    assertMaxLength(value, FIELD_LIMITS.NON_MY_POSTCODE, fieldName, { allowEmpty: false });
  }
  return value;
};

const validateStateCode = (state, country, fieldName, { isConsolidated = false } = {}) => {
  const value = requireAddressValue(state, fieldName);
  assertMaxLength(value, FIELD_LIMITS.STATE, fieldName, { allowEmpty: false });

  if (isMalaysiaCountry(country)) {
    if (!MALAYSIAN_STATE_CODES.has(value)) {
      throw new Error(`${fieldName} must be a valid Malaysia state code (01-17)`);
    }
    if (value === '17' && !isConsolidated) {
      throw new Error(
        `${fieldName}: state code 17 is only allowed for consolidated e-Invoices or addresses outside Malaysia`
      );
    }
  }
  return value;
};

const validatePartyIdentificationValue = (id, schemeId, partyLabel) => {
  if (isBlank(id) || isNaToken(id)) {
    return id;
  }

  const idValue = String(id).trim();
  const scheme = String(schemeId || '').toUpperCase();

  if (scheme === 'PASSPORT') {
    assertMaxLength(idValue, FIELD_LIMITS.PASSPORT, `${partyLabel} PASSPORT ID`, { allowEmpty: false });
  }

  return idValue;
};

/**
 * Main function to process Excel data and convert it to e-Invoice format
 * @param {Array} rawData - Raw Excel data array where:
 *   - rawData[0] = Descriptions row
 *   - rawData[1] = Field mappings row
 *   - rawData[2+] = Actual data rows
 * @returns {Array} Array of processed invoice documents
 */
const processExcelData = (rawData) => {
    // Setup logger for tracking processing
    const logger = {
      info: (msg, data) => console.log(`[INFO] ${msg}`, data || ''),
      error: (msg, data) => console.error(`[ERROR] ${msg}`, data || '')
    };

    /**
     * Helper function to get field value with support for different Excel column formats
     * Tries multiple format variations to find the correct field value
     * @param {Object} row - Excel row data
     * @param {string} baseField - Base field name to look for
     * @returns {any} Field value if found, undefined otherwise
     */
    const getField = (row, baseField) => {
      // Try different field name formats in order of preference
      const fieldFormats = EXCEL_FIELD_PREFIXES.map(prefix => `${prefix}${baseField}`);

      // First try exact matches
      for (const field of fieldFormats) {
        if (row[field] !== undefined) {
          return row[field];
        }
      }

      // If no exact match found, try case-insensitive matches
      const lowerBaseField = baseField.toLowerCase();
      for (const key of Object.keys(row)) {
        if (key.toLowerCase() === lowerBaseField ||
            EXCEL_FIELD_PREFIXES.some(prefix =>
              key.toLowerCase() === `${prefix.toLowerCase()}${lowerBaseField}`)) {
          return row[key];
        }
      }

      // If no match found, try numeric index fields
      const numericField = baseField.match(/^_(\d+)$/);
      if (numericField) {
        const index = numericField[1];
        const alternateFormats = EXCEL_FIELD_PREFIXES.map(prefix => `${prefix}${index}`);

        for (const format of alternateFormats) {
          if (row[format] !== undefined) {
            return row[format];
          }
        }
      }

      return undefined;
    };

    /**
     * Helper function to determine the type of row (Header, Line, Footer)
     * @param {Object} row - Excel row data
     * @returns {string|null} Row type ('H', 'L', 'F') or null if not determined
     */
    const getRowType = (row) => {
      // Check all possible column names for row type
      const rowType = row[''] || row['__EMPTY'] || row['_'] ||
                     row['RowType'] || row['Type'] || row['Row_Type'] ||
                     row['Row Type'] || row['RowIdentifier'] || row['Row Identifier'] ||
                     null;

      if (!rowType && row) {
        // Check if this looks like a specific row type using the indicators
        for (const [type, config] of Object.entries(ROW_TYPE_INDICATORS)) {
          if (config.identifiers.some(id => row[id])) {
            return config.type;
          }
        }
      }

      return rowType;
    };

    /**
     * Process flow:
     * 1. Initialize log buffers for tracking processing steps
     * 2. Extract descriptions, field mappings, and data rows from raw data
     * 3. Process each row to create invoice documents
     */
    let processLogs = {
      steps: [],
      identifications: [],
      documents: [],
      mappingResults: []
    };

    // Helper function to add to process log
    const addToProcessLog = (data, type) => {
      processLogs[type] = processLogs[type] || [];
      processLogs[type].push({
        timestamp: new Date().toISOString(),
        data
      });
    };

    try {
      // Log processing steps
      const logStep = (step, data) => {
        processLogs.steps.push({
          timestamp: new Date().toISOString(),
          step,
          data
        });
      };

      // Extract structure rows and data rows
      const descriptions = rawData[0];     // First row contains field descriptions
      const fieldMappings = rawData[1];    // Second row contains field mappings
      const dataRows = rawData.slice(2);   // Remaining rows contain actual data

      // Log initial data structure
      logStep('Initial Data', {
        totalRows: dataRows.length,
        firstRow: dataRows[0]
      });

      /**
       * Document Processing:
       * 1. Track current document being processed
       * 2. Maintain array of processed documents
       */
      let currentDocument = null;
      const documents = [];

      /**
       * Helper function to process party identifications
       * Extracts and validates identification information for parties
       * @param {Array} rows - Array of rows containing identification data
       * @returns {Array} Processed identifications
       */
      const getIdentifications = (rows) => {
        const identifications = [];

        logStep('Processing Identifications', {
          inputRows: rows
        });

        if (rows && rows.length > 0) {
          rows.forEach((row) => {
            if (row?.PartyIdentification_ID && row?.schemeId) {
              identifications.push({
                id: String(row.PartyIdentification_ID),
                schemeId: row.schemeId
              });
            }
          });
        }

        processLogs.identifications.push({
          input: rows,
          output: identifications,
          timestamp: new Date().toISOString()
        });

        return identifications;
      };

      /**
       * Helper function to collect all AdditionalDocumentReference entries
       * from rows belonging to the same invoice
       * @param {Object} headerRow - Header row for the invoice
       * @param {Array} dataRows - All data rows
       * @param {number} currentIndex - Current processing index
       * @returns {Array} Array of additional document references with id, type, and description
       */
      const collectAdditionalDocumentReferences = (headerRow, dataRows, currentIndex) => {
        const additionalRefs = [];
        const invoiceNo = headerRow.Invoice;
        const seenIds = new Set(); // Track IDs to prevent duplicates
        
        if (!invoiceNo) {
          return additionalRefs;
        }

        // Find the range of rows that belong to this invoice
        // Start from currentIndex and go until we find the next header (H) or footer (F)
        // Also check a reasonable number of rows after the header to catch AdditionalDocumentReference entries
        let endIndex = dataRows.length;
        for (let i = currentIndex + 1; i < dataRows.length; i++) {
          const rowType = getRowType(dataRows[i]);
          const normalizedType = rowType ? rowType.toString().toUpperCase().charAt(0) : null;
          
          // Stop at next header (but allow footer to be included)
          if (normalizedType === 'H') {
            endIndex = i;
            break;
          }
          
          // Include footer row in the range, but stop after it
          if (normalizedType === 'F') {
            endIndex = i + 1;
            break;
          }
        }
        
        // Also check up to 10 rows after the header to catch AdditionalDocumentReference entries
        // that might not have row type indicators
        const maxCheckRows = Math.min(currentIndex + 10, dataRows.length);
        if (endIndex < maxCheckRows) {
          endIndex = maxCheckRows;
        }

        // Helper function to find field value with flexible matching (handles spaces, case variations)
        const findFieldValue = (row, possibleNames) => {
          if (!row) return undefined;
          
          // Try exact matches first
          for (const name of possibleNames) {
            if (row[name] !== undefined && row[name] !== null && row[name] !== '') {
              return row[name];
            }
          }
          
          // Try case-insensitive and space-normalized matching
          const rowKeys = Object.keys(row);
          for (const name of possibleNames) {
            const normalizedName = name.toLowerCase().replace(/\s+/g, '');
            for (const key of rowKeys) {
              const normalizedKey = key.toLowerCase().replace(/\s+/g, '');
              if (normalizedName === normalizedKey && row[key] !== undefined && row[key] !== null && row[key] !== '') {
                return row[key];
              }
            }
          }
          
          return undefined;
        };

        // Helper function to process a single row for AdditionalDocumentReference
        const processRowForAdditionalDocRef = (row, rowIndex) => {
          // Try multiple field name variations for AdditionalDocumentReference (column N)
          const possibleIdNames = [
            'AdditionalDocumentReference',
            'Additional Document Reference',
            'AdditionalDocumentReference_ID',
            'ID',
            '__EMPTY_13',  // Column N is index 13 (0-based)
            '_13'
          ];
          
          const additionalDocRef = findFieldValue(row, possibleIdNames);
          
          if (additionalDocRef && 
              additionalDocRef !== '' && 
              additionalDocRef !== 'NA' && 
              additionalDocRef !== DEFAULT_VALUES.NOT_APPLICABLE) {
            
            // Try multiple field name variations for DocumentType
            // Based on Excel structure: __EMPTY_11 contains DocumentType
            const possibleTypeNames = [
              'DocumentType',
              'Additional Document Reference Type',
              'AdditionalDocumentReferenceType',
              'AdditionalDocumentReference_Type',
              '__EMPTY_11',  // DocumentType is in __EMPTY_11 (not index 14!)
              '_11',
              '11'
            ];
            
            let documentType = findFieldValue(row, possibleTypeNames);
            // Fallback to getField if not found
            if (!documentType) {
              documentType = getField(row, '11') || '';
            }
            
            // Try multiple field name variations for DocumentDescription
            // Based on Excel structure: __EMPTY_12 contains DocumentDescription
            const possibleDescNames = [
              'DocumentDescription',
              'Additional Document Reference Description',
              'AdditionalDocumentReferenceDescription',
              'AdditionalDocumentReference_Description',
              '__EMPTY_12',  // DocumentDescription is in __EMPTY_12 (not index 15!)
              '_12',
              '12'
            ];
            
            const documentDescription = findFieldValue(row, possibleDescNames) || '';
            
            // Only add if we have at least an ID and it's not a duplicate
            if (additionalDocRef) {
              const refId = String(additionalDocRef).trim();
              
              // Skip if we've already seen this ID (prevent duplicates)
              if (seenIds.has(refId)) {
                logStep('Skipping duplicate AdditionalDocumentReference', {
                  rowIndex,
                  id: refId
                });
                return false;
              }
              
              const refEntry = {
                id: refId,
                type: documentType ? String(documentType).trim() : '',
                description: documentDescription ? String(documentDescription).trim() : ''
              };
              
              seenIds.add(refId);
              additionalRefs.push(refEntry);
              
              // Debug logging
              logStep('Found AdditionalDocumentReference', {
                rowIndex,
                entry: refEntry,
                rowKeys: Object.keys(row).filter(k => k.includes('Document') || k.includes('Additional') || k.includes('EMPTY_1') || k === 'ID')
              });
              return true; // Found an entry
            }
          }
          return false; // No entry found
        };

        // Debug: Log the row range and sample row keys for debugging
        logStep('Collecting AdditionalDocumentReferences', {
          invoiceNo,
          startIndex: currentIndex,
          endIndex,
          rowCount: endIndex - currentIndex,
          sampleRowKeys: dataRows[currentIndex] ? Object.keys(dataRows[currentIndex]).slice(0, 20) : []
        });

        // Collect AdditionalDocumentReference entries from all rows in this invoice's range
        // Include the header row to capture all entries
        for (let i = currentIndex; i < endIndex; i++) {
          processRowForAdditionalDocRef(dataRows[i], i);
        }
        
        // Also check rows near the header that might have AdditionalDocumentReference data
        // but don't have Invoice field (they might be continuation rows)
        // Check up to 5 rows after the header row, but skip rows that are marked as new headers
        for (let i = currentIndex + 1; i <= Math.min(currentIndex + 5, dataRows.length - 1); i++) {
          const row = dataRows[i];
          const rowType = getRowType(row);
          const normalizedType = rowType ? rowType.toString().toUpperCase().charAt(0) : null;
          
          // Skip if this is a new header row (H) with a different invoice
          if (normalizedType === 'H' && row.Invoice && row.Invoice !== invoiceNo) {
            break; // Stop if we hit a new invoice header
          }
          
          // Check if this row has AdditionalDocumentReference but no Invoice field
          // (meaning it's a continuation row for the same invoice)
          // OR if it has the same Invoice number
          if ((!row.Invoice || row.Invoice === invoiceNo) && normalizedType !== 'F') {
            processRowForAdditionalDocRef(row, i);
          }
        }
        
        // If still no entries found, try scanning all rows as fallback
        // This handles cases where AdditionalDocumentReference rows might be outside the normal range
        if (additionalRefs.length === 0) {
          logStep('No AdditionalDocumentReferences found in invoice range, scanning all rows', {
            invoiceNo,
            totalRows: dataRows.length
          });
          
          for (let i = 0; i < dataRows.length; i++) {
            // Skip if this row belongs to a different invoice (has Invoice field with different value)
            if (dataRows[i].Invoice && dataRows[i].Invoice !== invoiceNo) {
              continue;
            }
            processRowForAdditionalDocRef(dataRows[i], i);
          }
        }

        // Debug: Log final collection result
        logStep('AdditionalDocumentReferences Collection Complete', {
          invoiceNo,
          totalFound: additionalRefs.length,
          entries: additionalRefs
        });

        return additionalRefs;
      };

      /**
       * Creates a new invoice document from header row data
       * @param {Object} headerRow - Excel row containing header information
       * @param {Array} dataRows - All data rows
       * @param {number} currentIndex - Current processing index
       * @returns {Object} Processed invoice document
       */
      const createNewDocument = (headerRow, dataRows, currentIndex) => {
        // logRawExcelData(headerRow, dataRows, currentIndex);

        logStep('Creating New Document', {
          headerRow,
          currentIndex
        });

        // Find the footer row for tax scheme data
        const footerRow = dataRows.slice(currentIndex).find(row => row.__EMPTY === 'F');
        
        // Collect all AdditionalDocumentReference entries
        const additionalRefs = collectAdditionalDocumentReferences(headerRow, dataRows, currentIndex);

        // Update scheme ID rows with consistent naming
        const supplierIdentityScheme = resolveIdentityScheme(
          dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '17') : undefined,
          'Supplier'
        );
        const buyerIdentityScheme = resolveIdentityScheme(
          dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '28') : undefined,
          'Buyer'
        );
        const deliveryIdentityScheme = resolveIdentityScheme(
          dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '39') : undefined,
          'Delivery'
        );

        const partyIdentifications = {
          supplier: [
            {
              PartyIdentification_ID: getField(headerRow, '16'),
              schemeId: getField(headerRow, '17') || PARTY_SCHEME_TYPES.TIN
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 1] ? getField(dataRows[currentIndex + 1], '16') : undefined,
              schemeId: supplierIdentityScheme
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 2] ? getField(dataRows[currentIndex + 2], '16') : undefined,
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 3] ? getField(dataRows[currentIndex + 3], '16') : undefined,
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ],
          buyer: [
            {
              PartyIdentification_ID: headerRow.Buyer,
              schemeId: getField(headerRow, '28')
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 1]?.Buyer,
              schemeId: buyerIdentityScheme
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 2]?.Buyer,
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 3]?.Buyer,
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ],
          delivery: [
            {
              PartyIdentification_ID: headerRow.Delivery,
              schemeId: getField(headerRow, '39')
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 1]?.Delivery,
              schemeId: deliveryIdentityScheme
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 2]?.Delivery,
              schemeId: PARTY_SCHEME_TYPES.SST
            },
            {
              PartyIdentification_ID: dataRows[currentIndex + 3]?.Delivery,
              schemeId: PARTY_SCHEME_TYPES.TTX
            }
          ]
        };

        // Enforce PASSPORT max length before mapping
        ['supplier', 'buyer', 'delivery'].forEach((partyKey) => {
          partyIdentifications[partyKey].forEach((entry) => {
            validatePartyIdentificationValue(
              entry.PartyIdentification_ID,
              entry.schemeId,
              partyKey.charAt(0).toUpperCase() + partyKey.slice(1)
            );
          });
        });

        // Add detailed logging for document creation
        const documentLog = {
          timestamp: new Date().toISOString(),
          documentId: headerRow.Invoice,
          partyIdentifications
        };
        processLogs.documents.push(documentLog);

        const currentDate = new Date();
        const formattedDate = currentDate.toISOString().split('T')[0];
        const formattedTime = currentDate.toISOString().split('T')[1].split('.')[0] + 'Z';

        const documentCurrencyCode = getField(headerRow, '6');
        const rawExchangeRate = getField(headerRow, '8');
        let exchangeRate;
        if (documentCurrencyCode && String(documentCurrencyCode).toUpperCase() !== 'MYR') {
          const rate = Number(rawExchangeRate);
          if (isBlank(rawExchangeRate) || !Number.isFinite(rate) || rate <= 0) {
            throw new Error(
              'Currency exchange rate is required and must be greater than 0 when document currency is not MYR'
            );
          }
          exchangeRate = rate;
        } else if (!isBlank(rawExchangeRate)) {
          const rate = Number(rawExchangeRate);
          if (!Number.isFinite(rate) || rate < 0) {
            throw new Error('Currency exchange rate must be a valid non-negative number');
          }
          if (rate === 0 && String(documentCurrencyCode || '').toUpperCase() !== 'MYR') {
            throw new Error('Currency exchange rate must be greater than 0 when document currency is not MYR');
          }
          exchangeRate = rate > 0 ? rate : undefined;
        } else {
          exchangeRate = undefined;
        }

        const invoiceNo = assertMaxLength(
          headerRow.Invoice,
          FIELD_LIMITS.INVOICE_NO,
          'e-Invoice Number',
          { allowEmpty: false }
        );

        const invoicePeriodStart = assertYyyyMmDd(headerRow.InvoicePeriod, 'Invoice period start date');
        const invoicePeriodEnd = assertYyyyMmDd(getField(headerRow, '9'), 'Invoice period end date');
        const prepaidDate = assertYyyyMmDd(getField(headerRow, '54'), 'Prepaid payment date');

        const supplierCountry = getField(headerRow, '22');
        const buyerCountry = getField(headerRow, '33');
        const deliveryCountry = getField(headerRow, '44');
        const isConsolidated = (() => {
          for (let i = currentIndex + 1; i < dataRows.length; i++) {
            const rowType = getRowType(dataRows[i]);
            const normalizedType = rowType ? rowType.toString().toUpperCase().charAt(0) : null;
            if (normalizedType === 'H') {
              break;
            }
            if (normalizedType === 'L') {
              const classificationCode = String(getField(dataRows[i], 'InvoiceItem') || '').trim();
              if (classificationCode === '004') {
                return true;
              }
            }
            if (normalizedType === 'F') {
              break;
            }
          }
          return false;
        })();

        const supplierCity = requireAddressValue(getField(headerRow, '18'), 'Supplier city');
        const supplierPostcode = validatePostcode(getField(headerRow, '19'), supplierCountry, 'Supplier postcode');
        const supplierState = validateStateCode(
          getField(headerRow, '20'),
          supplierCountry,
          'Supplier state',
          { isConsolidated }
        );
        const supplierCountryCode = requireAddressValue(supplierCountry, 'Supplier country');

        const buyerCity = requireAddressValue(getField(headerRow, '29'), 'Buyer city');
        const buyerPostcode = validatePostcode(getField(headerRow, '30'), buyerCountry, 'Buyer postcode');
        const buyerState = validateStateCode(
          getField(headerRow, '31'),
          buyerCountry,
          'Buyer state',
          { isConsolidated }
        );
        const buyerCountryCode = requireAddressValue(buyerCountry, 'Buyer country');

        // Delivery/shipping is optional — validate only when address fields are present
        const hasDeliveryAddress = !isBlank(getField(headerRow, '40'))
          || !isBlank(getField(headerRow, '41'))
          || !isBlank(getField(headerRow, '42'))
          || !isBlank(deliveryCountry);

        let deliveryCity;
        let deliveryPostcode;
        let deliveryState;
        let deliveryCountryCode;
        if (hasDeliveryAddress) {
          deliveryCity = requireAddressValue(getField(headerRow, '40'), 'Delivery city');
          deliveryPostcode = validatePostcode(getField(headerRow, '41'), deliveryCountry, 'Delivery postcode');
          deliveryState = validateStateCode(
            getField(headerRow, '42'),
            deliveryCountry,
            'Delivery state',
            { isConsolidated }
          );
          deliveryCountryCode = requireAddressValue(deliveryCountry, 'Delivery country');
        }

        const schemeAgencyName = assertMaxLength(
          getField(headerRow, '13') || 'CertEx',
          FIELD_LIMITS.CERT_EX,
          'Certificate / Scheme Agency Name'
        );
        const industryName = assertMaxLength(
          getField(headerRow, '15'),
          FIELD_LIMITS.INDUSTRY_NAME,
          'Business activity description'
        );
        const payeeFinancialAccount = assertMaxLength(
          getField(headerRow, '52'),
          FIELD_LIMITS.BANK_ACCOUNT,
          'Bank account number'
        );
        const paymentTerms = assertMaxLength(
          getField(headerRow, 'PaymentTerms'),
          FIELD_LIMITS.PAYMENT_TERMS,
          'Payment terms'
        );
        const prepaidPaymentId = assertMaxLength(
          getField(headerRow, 'PrepaidPayment'),
          FIELD_LIMITS.PREPAID_ID,
          'Prepayment reference'
        );

        const doc = {
          header: {
            invoiceNo,
            invoiceType: getField(headerRow, '5'),
            documentCurrencyCode,
            //taxCurrencyCode: getField(headerRow, '7'),
            currency: documentCurrencyCode,
            taxCurrencyCode: getField(headerRow, '7') || documentCurrencyCode,
            exchangeRate,
            invoiceDocumentReference:getField(headerRow, '1') || '',
            InvoiceDocumentReference_ID: getField(headerRow, '2') || '',
            documentReference: {
              uuid: getField(headerRow, '1') || '',
              internalId: getField(headerRow, '2') || '',
              billingReference: headerRow.AdditionalDocumentReference || DEFAULT_VALUES.NOT_APPLICABLE,
              billingReferenceType: getField(headerRow, '11') || DEFAULT_VALUES.NOT_APPLICABLE,
              additionalRefs: additionalRefs
            },
            issueDate: [{ _: formattedDate }],
            issueTime: [{ _: formattedTime }],
            invoicePeriod: {
              startDate: invoicePeriodStart || '',
              endDate: invoicePeriodEnd || '',
              description: getField(headerRow, '10') || ''
            }
          },
          supplier: {
            id: getField(headerRow, '16'),
            additionalAccountID: headerRow.Supplier || DEFAULT_VALUES.NOT_APPLICABLE,
            schemeAgencyName,
            industryClassificationCode: getField(headerRow, '14'),
            identifications: getIdentifications(partyIdentifications.supplier),
            industryName,
            name: getField(headerRow, '25'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, headerRow, dataRows, currentIndex, '21'),
              city: supplierCity,
              postcode: supplierPostcode,
              state: supplierState,
              country: supplierCountryCode,
              countryListID: getField(headerRow, '23') || DEFAULT_VALUES.COUNTRY_SCHEME.listId,
              countryListAgencyID: getField(headerRow, '24') || DEFAULT_VALUES.COUNTRY_SCHEME.agencyId
            },
            contact: {
              phone: getField(headerRow, '26'),
              email: getField(headerRow, '27')
            }
          },
          buyer: {
            id: headerRow.Buyer,
            identifications: getIdentifications(partyIdentifications.buyer),
            name: getField(headerRow, '36'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, headerRow, dataRows, currentIndex, '32'),
              city: buyerCity,
              postcode: buyerPostcode,
              state: buyerState,
              country: buyerCountryCode,
              countryListID: getField(headerRow, '34') || DEFAULT_VALUES.COUNTRY_SCHEME.listId,
              countryListAgencyID: getField(headerRow, '35') || DEFAULT_VALUES.COUNTRY_SCHEME.agencyId
            },
            contact: {
              phone: getField(headerRow, '37'),
              email: getField(headerRow, '38')
            }
          },
          delivery: {
            id: headerRow.Delivery,
            identifications: getIdentifications(partyIdentifications.delivery),
            name: getField(headerRow, '47'),
            address: {
              // Process address line with proper formatting - collect from multiple rows
              line: processAddressLine(null, headerRow, dataRows, currentIndex, '43'),
              city: deliveryCity,
              postcode: deliveryPostcode,
              state: deliveryState,
              country: deliveryCountryCode,
              countryListID: getField(headerRow, '45') || DEFAULT_VALUES.COUNTRY_SCHEME.listId,
              countryListAgencyID: String(getField(headerRow, '46') || DEFAULT_VALUES.COUNTRY_SCHEME.agencyId)
            },
            shipment: {
              id: getField(headerRow, '48') || DEFAULT_VALUES.NOT_APPLICABLE,
              freightAllowanceCharge: {
                indicator: getField(headerRow, '49') === true ||
                          getField(headerRow, '49') === 'true' ||
                          getField(headerRow, '49') === 1,
                reason: getField(headerRow, '50') || DEFAULT_VALUES.NOT_APPLICABLE,
                amount: getField(headerRow, '51') || DEFAULT_VALUES.ZERO
              }
            }
          },
          payment: {
            paymentMeansCode: getField(headerRow, 'PaymentMeans') || '',
            payeeFinancialAccount: isBlank(payeeFinancialAccount) ? undefined : payeeFinancialAccount,
            paymentTerms: isBlank(paymentTerms) ? undefined : paymentTerms,
            prepaidPayment: {
              id: isBlank(prepaidPaymentId) ? undefined : prepaidPaymentId,
              amount: getField(headerRow, '53') || DEFAULT_VALUES.ZERO,
              date: prepaidDate,
              time: getField(headerRow, '55') || null
            }
          },
          items: [],
          summary: {
            amounts: {
              lineExtensionAmount: DEFAULT_VALUES.ZERO,
              taxExclusiveAmount: DEFAULT_VALUES.ZERO,
              taxInclusiveAmount: DEFAULT_VALUES.ZERO,
              allowanceTotalAmount: DEFAULT_VALUES.ZERO,
              chargeTotalAmount: DEFAULT_VALUES.ZERO,
              payableRoundingAmount: DEFAULT_VALUES.ZERO,
              payableAmount: DEFAULT_VALUES.ZERO
            },
            tax: {
              totalAmount: DEFAULT_VALUES.ZERO,
              taxableAmount: DEFAULT_VALUES.ZERO,
              taxExemptedAmount: DEFAULT_VALUES.ZERO,
              taxRate: DEFAULT_VALUES.ZERO,
              taxAmount: DEFAULT_VALUES.ZERO,
              taxTypeCode: DEFAULT_VALUES.NOT_APPLICABLE,
              taxExemptionReason: DEFAULT_VALUES.NOT_APPLICABLE,
              taxSubtotal: {
                taxableAmount: DEFAULT_VALUES.ZERO,
                taxAmount: DEFAULT_VALUES.ZERO
              },
              category: {
                id: DEFAULT_VALUES.NOT_APPLICABLE,
                exemptionReason: DEFAULT_VALUES.NOT_APPLICABLE,
                scheme: DEFAULT_VALUES.TAX_SCHEME
              }
            }
          },
          allowanceCharge: {
            indicator: getField(headerRow, 'InvoiceAllowanceCharge') === true ||
                      getField(headerRow, 'InvoiceAllowanceCharge') === 'true' ||
                      getField(headerRow, 'InvoiceAllowanceCharge') === 1,
            reason: getField(headerRow, '56') || DEFAULT_VALUES.NOT_APPLICABLE,
            amount: getField(headerRow, '57') || DEFAULT_VALUES.ZERO
          }

        };

        logRawToJson(doc, `${doc.header.invoiceNo}_eInvoice`);

        return doc;
      };

      const processLineItem = (lineRow, headerData) => {
        return {
          lineId: getField(lineRow, 'InvoiceLine'),
          quantity: getField(lineRow, '70'),
          unitCode: getField(lineRow, '71'),
          unitPrice: getField(lineRow, '88'),
          lineExtensionAmount: getField(lineRow, '72'),
          allowanceCharges: [{
            chargeIndicator: getField(lineRow, '73') === true ||
                            getField(lineRow, '73') === 'true' ||
                            getField(lineRow, '73') === 1,
            reason: getField(lineRow, '74') || null,
            multiplierFactorNumeric: getField(lineRow, '75') || 0,
            amount: getField(lineRow, '76') || 0
          }],
          taxTotal: {
            taxAmount: getField(lineRow, 'InvoiceLine_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxSubtotal: [{
              taxableAmount: getField(lineRow, '77') || DEFAULT_VALUES.ZERO,
              taxAmount: getField(lineRow, '78') || DEFAULT_VALUES.ZERO,
              taxCategory: {
                id: getField(lineRow, '80') || DEFAULT_VALUES.TAX_CATEGORY.id,
                percent: getField(lineRow, '79') || DEFAULT_VALUES.ZERO,
                exemptionReason: getField(lineRow, '81') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
                taxScheme: {
                  id: getField(lineRow, '82') || 'OTH',
                  schemeId: getField(lineRow, '83') || 'UN/ECE 5153',
                  schemeAgencyId: String(getField(lineRow, '84') || '6')
                }
              }
            }]
          },
          item: {
            classification: {
              code: getField(lineRow, 'InvoiceItem'),
              type: getField(lineRow, '85')
            },
            description: getField(lineRow, '86'),
            originCountry: getField(lineRow, '87')
          },
          price: {
            amount: getField(lineRow, '88'),
            subtotal: getField(lineRow, '89'),
            extension: getField(lineRow, '89')
          }
        };
      };

      // Helper function to collect all address lines from multiple rows with the same field
      const collectAddressLines = (baseField, headerRow, dataRows, currentIndex) => {
        const addressLines = [];

        // Get address from header row
        const headerAddress = getField(headerRow, baseField);
        if (headerAddress && headerAddress !== 'NA') {
          // Convert to string and check if it's not empty after trimming
          const headerAddressStr = String(headerAddress);
          if (headerAddressStr.trim() !== '') {
            addressLines.push(headerAddressStr);
          }
        }

        // Get addresses from subsequent rows (typically 3 more rows for additional address lines)
        for (let i = 1; i <= 3; i++) {
          if (dataRows[currentIndex + i]) {
            const additionalAddress = getField(dataRows[currentIndex + i], baseField);
            if (additionalAddress && additionalAddress !== 'NA') {
              // Convert to string and check if it's not empty after trimming
              const additionalAddressStr = String(additionalAddress);
              if (additionalAddressStr.trim() !== '') {
                addressLines.push(additionalAddressStr);
              }
            }
          }
        }

        return addressLines;
      };

      // Helper function to process address lines
      const processAddressLine = (addressLine, headerRow, dataRows, currentIndex, baseField) => {
        // If we have headerRow and dataRows, collect all address lines
        if (headerRow && dataRows && currentIndex !== undefined && baseField) {
          const addressLines = collectAddressLines(baseField, headerRow, dataRows, currentIndex);

          if (addressLines.length === 0) return "NA";

          // Join all address lines with commas
          return addressLines.join(', ');
        }

        // If we only have a single address line (legacy behavior)
        if (!addressLine) return "NA";

        // Convert to string and handle special cases
        const addressStr = String(addressLine);
        if (addressStr.toLowerCase() === 'na' || addressStr.trim() === '') {
          return "NA";
        }

        // If address already has commas, return as is
        if (addressStr.includes(',')) {
          return addressStr;
        }

        // Try to intelligently split address based on common patterns
        // This handles all address types, not just PLO addresses
        const commonAddressPatterns = /\s+(?=\d+[A-Za-z]|\d+,|Jalan|Taman|Persiaran|Lorong|Kampung|Kg\.|Bandar|Street|Road|Lane|Avenue|Block|Unit|Floor|Level|Plaza|Tower|Building|Complex|Park|Garden|Heights|Court|Apartment|Suite|Room|House|No\.|No\s+\d+)/i;

        if (addressStr.match(commonAddressPatterns)) {
          const addressParts = addressStr.split(commonAddressPatterns);
          if (addressParts.length > 1) {
            return addressParts.join(', ');
          }
        }

        // If no patterns found, return as is
        return addressStr;
      };

      const DEFAULT_VALUES = {
        CURRENCY: 'MYR',
        COUNTRY: 'MYS',
        COUNTRY_SCHEME: {
          listId: 'ISO3166-1',
          agencyId: '6'
        },
        TAX_SCHEME: {
          id: 'OTH'  // Changed from 'OTH' to 'VAT' as per LHDN
        },
        NOT_APPLICABLE: 'NA',
        ZERO: 0,
        TAX_CATEGORY: {
          id: '01',
          exemptionReason: 'NA',
          scheme: {
            id: 'OTH'  // Changed from 'OTH' to 'VAT'
          }
        }
      };

      // Add helper function to support multiple tax types if needed
      const createTaxSubtotal = (taxTypeCode, taxAmount, taxableAmount, percent, exemptionReason) => {
        return {
          taxableAmount: taxableAmount || DEFAULT_VALUES.ZERO,
          taxAmount: taxAmount || DEFAULT_VALUES.ZERO,
          taxCategory: {
            id: taxTypeCode || DEFAULT_VALUES.TAX_CATEGORY.id,
            percent: percent || DEFAULT_VALUES.ZERO,
            exemptionReason: exemptionReason || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
            taxScheme: {
              id: DEFAULT_VALUES.TAX_SCHEME.id
            }
          }
        };
      };

      // Add function to process multiple tax types if needed
      const processMultipleTaxTypes = (taxRows) => {
        let totalTaxAmount = 0;
        const taxSubtotals = taxRows.map(row => {
          const taxAmount = getField(row, '78') || DEFAULT_VALUES.ZERO;
          totalTaxAmount += taxAmount;

          return createTaxSubtotal(
            getField(row, '80'),
            taxAmount,
            getField(row, '77'),
            getField(row, '79'),
            getField(row, '81')
          );
        });

        return {
          taxAmount: totalTaxAmount,
          taxSubtotal: taxSubtotals
        };
      };

      const processFooter = (footerRow) => {
        return {
          amounts: {
            lineExtensionAmount: getField(footerRow, 'LegalMonetaryTotal') || DEFAULT_VALUES.ZERO,
            taxExclusiveAmount: getField(footerRow, '64') || DEFAULT_VALUES.ZERO,
            taxInclusiveAmount: getField(footerRow, '65') || DEFAULT_VALUES.ZERO,
            allowanceTotalAmount: getField(footerRow, '66') || DEFAULT_VALUES.ZERO,
            chargeTotalAmount: getField(footerRow, '67') || DEFAULT_VALUES.ZERO,
            payableRoundingAmount: getField(footerRow, '68') || DEFAULT_VALUES.ZERO,
            payableAmount: getField(footerRow, '69') || DEFAULT_VALUES.ZERO
          },
          taxTotal: {                // Changed from 'tax' to 'taxTotal'
            taxAmount: getField(footerRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
            taxSubtotal: [{        // Changed to array structure
              taxableAmount: getField(footerRow, '58') || DEFAULT_VALUES.ZERO,
              taxAmount: getField(footerRow, 'Invoice_TaxTotal') || DEFAULT_VALUES.ZERO,
              taxCategory: {
                id: getField(footerRow, '60') || DEFAULT_VALUES.TAX_CATEGORY.id,      // Was taxTypeCode
                percent: getField(footerRow, '79') || DEFAULT_VALUES.ZERO,            // Was taxRate
                exemptionReason: getField(footerRow, '81') || DEFAULT_VALUES.TAX_CATEGORY.exemptionReason,
                taxScheme: {
                  id: getField(footerRow, '61') || DEFAULT_VALUES.TAX_CATEGORY.scheme.id
                }
              }
            }]
          }
        };
      };

      /**
       * Process each row in the Excel data:
       * 1. Determine row type (Header, Line, Footer)
       * 2. Process according to type:
       *    - Header: Create new document
       *    - Line: Add line item to current document
       *    - Footer: Finalize current document
       */
      dataRows.forEach((row, index) => {
        const rowType = getRowType(row);
        const normalizedType = rowType ? rowType.toString().toUpperCase().charAt(0) : null;

        switch(normalizedType) {
          case 'H': // Header row - start new document
            if (row.Invoice) {
              if (currentDocument) {
                documents.push(currentDocument);
              }
              currentDocument = createNewDocument(row, dataRows, index);
            }
            break;

          case 'L': // Line item row - add to current document
            if (currentDocument) {
              const lineItem = processLineItem(row, currentDocument.header);

              // Initialize items array if it doesn't exist
              if (!currentDocument.items) {
                currentDocument.items = [];
              }

              if (lineItem.lineId && lineItem.quantity !== undefined &&
                (lineItem.lineExtensionAmount !== undefined || lineItem.lineExtensionAmount === 0)) {

                const existingLineIndex = currentDocument.items.findIndex(item => item.lineId === lineItem.lineId);

                if (existingLineIndex >= 0) {
                  // Add allowance/charge to existing line
                  currentDocument.items[existingLineIndex].allowanceCharges.push({
                    chargeIndicator: lineItem.allowanceCharges[0].chargeIndicator,
                    reason: lineItem.allowanceCharges[0].reason || 'NA',
                    multiplierFactorNumeric: lineItem.allowanceCharges[0].multiplierFactorNumeric || 0,
                    amount: lineItem.allowanceCharges[0].amount || 0
                  });
                } else {
                  // Ensure allowanceCharges has at least one item
                  if (!lineItem.allowanceCharges || lineItem.allowanceCharges.length === 0) {
                    lineItem.allowanceCharges = [{
                      chargeIndicator: false,
                      reason: 'NA',
                      multiplierFactorNumeric: 0,
                      amount: 0
                    }];
                  }
                  // Add new line item
                  currentDocument.items.push(lineItem);
                }
              }
            }
            break;

          case 'F': // Footer row - finalize document
            if (currentDocument) {
              // Process footer data with current document for tax calculations
              const footerData = processFooter(row);

              // Update document summary with footer data
              currentDocument.summary = footerData;

              // Log raw document
              if (currentDocument?.header?.invoiceNo) {
                logRawToJson(currentDocument, `${currentDocument.header.invoiceNo}_eInvoice`);
              }

              // Add to documents array
              documents.push(currentDocument);
              currentDocument = null;
            }
            break;
        }
      });

      // Add the last document if exists
      if (currentDocument) {
        documents.push(currentDocument);
      }

      logger.info('Processed documents:', documents.length);

      // Always write logs for debugging
      try {
        const logsDir = path.join(process.cwd(), 'logs', 'excel');
        if (!fs.existsSync(logsDir)) {
          fs.mkdirSync(logsDir, { recursive: true });
        }

        // Log raw data structure
        const rawDataLog = {
          timestamp: new Date().toISOString(),
          descriptions,
          fieldMappings,
          sampleDataRow: dataRows[0],
          rowTypes: {
            header: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'H'),
            line: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'L'),
            footer: dataRows.find(row => getRowType(row)?.toString().toUpperCase().charAt(0) === 'F')
          }
        };

        // Log all raw Excel data for address debugging
        const rawExcelData = {
          timestamp: new Date().toISOString(),
          allRows: dataRows.map((row, index) => {
            // Extract only address-related fields for clarity
            const addressFields = {};
            for (const key of Object.keys(row)) {
              if (key.includes('21') || key.includes('32') || key.includes('43')) {
                addressFields[key] = row[key];
              }
            }
            return {
              rowIndex: index,
              rowType: getRowType(row),
              supplier: row.Supplier,
              buyer: row.Buyer,
              delivery: row.Delivery,
              addressFields
            };
          })
        };

        // Write raw Excel data log specifically for address debugging
        const rawExcelLogPath = path.join(logsDir, `excel_raw_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(rawExcelLogPath, JSON.stringify(rawExcelData, null, 2));

        // Write raw data log
        const rawDataLogPath = path.join(logsDir, `raw_data_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(rawDataLogPath, JSON.stringify(rawDataLog, null, 2));

        // Write process logs
        const processLogPath = path.join(logsDir, `process_${new Date().toISOString().replace(/[:.]/g, '-')}.json`);
        fs.writeFileSync(processLogPath, JSON.stringify(processLogs, null, 2));

        logger.info('Logs written to:', logsDir);
      } catch (logError) {
        logger.error('Error writing logs:', logError);
        // Don't throw the error as logging failure shouldn't stop processing
      }

      return documents;

    } catch (error) {
      logger.error('Error processing Excel data:', error);
      addToProcessLog({
        error: error.message,
        stack: error.stack
      }, 'errors');
      throw error;
    }
  };

  module.exports = { processExcelData };