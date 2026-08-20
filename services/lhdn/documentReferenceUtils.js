const INCOTERM_PLACEHOLDER_IDS = new Set([
  'CIF', 'FOB', 'EXW', 'CFR', 'DDP', 'DAP', 'CIP', 'CPT', 'FCA', 'FAS', 'DPU'
]);

const CERT_PO_DO_DOCUMENT_TYPE = 'Reference';

const PDF_DOC_REF_SLOTS = [
  'Exemption Cert. No.',
  'Cust. P/O No.',
  'Cust. D/O No.'
];

const isPlaceholderRefId = (id) => {
  if (!id) return false;
  const normalized = String(id).trim().toUpperCase();
  return INCOTERM_PLACEHOLDER_IDS.has(normalized) || normalized.length <= 3;
};

const isEmptyDocRefValue = (value) => {
  if (value === null || value === undefined) return true;
  const normalized = String(value).trim().toUpperCase();
  return normalized === '' || normalized === 'NA' || normalized === 'N/A' || normalized === 'NOT APPLICABLE';
};

const classifyAdditionalDocRef = (description) => {
  if (!description || isEmptyDocRefValue(description)) return null;
  const descUpper = description.toUpperCase();

  if (descUpper.includes('EXEMP')) {
    return 'Exemption Cert. No.';
  }

  if (/\bP\s*\/?\s*O\b/.test(descUpper) || descUpper.includes('P.O') ||
      descUpper.includes('PO NO') || descUpper.includes('PURCHASE ORDER')) {
    return 'Cust. P/O No.';
  }

  if (!descUpper.includes('DOCUMENT')) {
    if (/\bD\s*\/?\s*O\b/.test(descUpper) || descUpper.includes('D.O') ||
        descUpper.includes('DO NO') || descUpper.includes('DELIVERY ORDER')) {
      return 'Cust. D/O No.';
    }
  }

  return null;
};

const classifyExcelPoPattern = (description) => {
  if (!description) return false;
  const descUpper = description.toUpperCase();
  return /\bP\s*\/?\s*O\b/.test(descUpper) || descUpper.includes('P.O') ||
    /^PO[-\s]/i.test(description) || descUpper.includes('PO NO') ||
    descUpper.includes('PURCHASE ORDER');
};

const classifyExcelDoPattern = (description) => {
  if (!description) return false;
  const descUpper = description.toUpperCase();
  if (descUpper.includes('DOCUMENT')) return false;
  return /\bD\s*\/?\s*O\b/.test(descUpper) || descUpper.includes('D.O') ||
    /^DO[-\s]/i.test(description) || descUpper.includes('DO NO') ||
    descUpper.includes('DELIVERY ORDER');
};

const normalizeSubmitDocRef = (ref) => {
  if (!ref) return null;

  const id = String(ref.id || '').trim();
  const description = String(ref.description || '').trim();
  const legacySlot = classifyAdditionalDocRef(description);

  let printedValue = '';
  if (legacySlot && !isPlaceholderRefId(id)) {
    printedValue = id;
  } else if (isPlaceholderRefId(id) && !isEmptyDocRefValue(description)) {
    printedValue = description;
  } else if (!isEmptyDocRefValue(description)) {
    printedValue = description;
  } else if (!isEmptyDocRefValue(id) && !isPlaceholderRefId(id)) {
    printedValue = id;
  }

  if ((!printedValue || isEmptyDocRefValue(printedValue)) && isPlaceholderRefId(id)) {
    return {
      id: id.toUpperCase(),
      type: CERT_PO_DO_DOCUMENT_TYPE,
      description: 'NA'
    };
  }

  if (!printedValue || isEmptyDocRefValue(printedValue)) {
    return null;
  }

  const placeholderId = isPlaceholderRefId(id) ? id.toUpperCase() : 'CIF';
  return {
    id: placeholderId,
    type: CERT_PO_DO_DOCUMENT_TYPE,
    description: printedValue
  };
};

const mapAdditionalDocRefsToPdfSlots = (parsedRefs) => {
  const refsMap = {
    'Exemption Cert. No.': null,
    'Cust. P/O No.': null,
    'Cust. D/O No.': null
  };

  for (const ref of parsedRefs) {
    const legacySlot = classifyAdditionalDocRef(ref.description);
    if (legacySlot && !isPlaceholderRefId(ref.id)) {
      if (!refsMap[legacySlot]) {
        refsMap[legacySlot] = ref.id;
      }
    }
  }

  const cifStyleRefs = parsedRefs.filter(ref => isPlaceholderRefId(ref.id));

  cifStyleRefs.forEach((ref, index) => {
    if (index >= PDF_DOC_REF_SLOTS.length) {
      return;
    }

    const slot = PDF_DOC_REF_SLOTS[index];
    if (refsMap[slot]) {
      return;
    }

    refsMap[slot] = isEmptyDocRefValue(ref.description)
      ? 'Not Applicable'
      : ref.description;
  });

  return PDF_DOC_REF_SLOTS.map(label => ({
    label,
    id: refsMap[label] || 'Not Applicable'
  }));
};

const isRealBillReference = (value) => {
  if (!value || isEmptyDocRefValue(value)) return false;
  return !isPlaceholderRefId(value);
};

module.exports = {
  CERT_PO_DO_DOCUMENT_TYPE,
  PDF_DOC_REF_SLOTS,
  INCOTERM_PLACEHOLDER_IDS,
  isPlaceholderRefId,
  isEmptyDocRefValue,
  classifyAdditionalDocRef,
  classifyExcelPoPattern,
  classifyExcelDoPattern,
  normalizeSubmitDocRef,
  mapAdditionalDocRefsToPdfSlots,
  isRealBillReference
};
