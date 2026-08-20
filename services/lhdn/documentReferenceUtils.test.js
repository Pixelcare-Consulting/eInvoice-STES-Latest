const {
  normalizeSubmitDocRef,
  mapAdditionalDocRefsToPdfSlots
} = require('./documentReferenceUtils');

describe('normalizeSubmitDocRef', () => {
  it('submits NA placeholder CIF rows to preserve slot order', () => {
    expect(normalizeSubmitDocRef({ id: 'CIF', description: 'NA' })).toEqual({
      id: 'CIF',
      type: 'Reference',
      description: 'NA'
    });
  });

  it('submits empty-description placeholder rows as NA', () => {
    expect(normalizeSubmitDocRef({ id: 'CIF', description: '' })).toEqual({
      id: 'CIF',
      type: 'Reference',
      description: 'NA'
    });
  });

  it('still drops non-placeholder refs with empty id and description', () => {
    expect(normalizeSubmitDocRef({ id: '', description: '' })).toBeNull();
  });

  it('submits real CIF-style values in description', () => {
    expect(normalizeSubmitDocRef({ id: 'CIF', description: 'RS2607/0873' })).toEqual({
      id: 'CIF',
      type: 'Reference',
      description: 'RS2607/0873'
    });
  });
});

describe('mapAdditionalDocRefsToPdfSlots', () => {
  it('maps ARINV129076 CIF sequence by positional slots', () => {
    const input = [
      { id: 'CIF', description: 'NA' },
      { id: 'CIF', description: 'RS2607/0873' },
      { id: 'CIF', description: '128919' }
    ];

    expect(mapAdditionalDocRefsToPdfSlots(input)).toEqual([
      { label: 'Exemption Cert. No.', id: 'Not Applicable' },
      { label: 'Cust. P/O No.', id: 'RS2607/0873' },
      { label: 'Cust. D/O No.', id: '128919' }
    ]);
  });

  it('does not reclassify PO-like values by content for CIF style', () => {
    const input = [
      { id: 'CIF', description: 'NA' },
      { id: 'CIF', description: 'PO-99999' },
      { id: 'CIF', description: 'DO-88888' }
    ];

    expect(mapAdditionalDocRefsToPdfSlots(input)).toEqual([
      { label: 'Exemption Cert. No.', id: 'Not Applicable' },
      { label: 'Cust. P/O No.', id: 'PO-99999' },
      { label: 'Cust. D/O No.', id: 'DO-88888' }
    ]);
  });

  it('maps legacy label-style refs by description label', () => {
    const input = [
      { id: 'CERT-001', description: 'Exemp. Cert. No.' },
      { id: 'PO-555', description: 'Po No.' },
      { id: 'DO-777', description: 'Do No.' }
    ];

    expect(mapAdditionalDocRefsToPdfSlots(input)).toEqual([
      { label: 'Exemption Cert. No.', id: 'CERT-001' },
      { label: 'Cust. P/O No.', id: 'PO-555' },
      { label: 'Cust. D/O No.', id: 'DO-777' }
    ]);
  });

  it('always returns three slots with Not Applicable fallbacks', () => {
    expect(mapAdditionalDocRefsToPdfSlots([])).toEqual([
      { label: 'Exemption Cert. No.', id: 'Not Applicable' },
      { label: 'Cust. P/O No.', id: 'Not Applicable' },
      { label: 'Cust. D/O No.', id: 'Not Applicable' }
    ]);
  });
});
