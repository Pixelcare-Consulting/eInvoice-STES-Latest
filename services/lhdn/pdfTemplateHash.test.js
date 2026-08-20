const { generateTemplateHash } = require('./pdfTemplateHash');

const baseTemplateData = {
    CompanyLogo: 'logo.png',
    companyName: 'Test Co',
    companyAddress: '123 Street',
    companyPhone: '0123456789',
    companyEmail: 'test@example.com',
    InvoiceType: 'Invoice',
    InvoiceCode: 'INV-001',
    UniqueIdentifier: 'uuid-123',
    items: [{ description: 'Item A', amount: 100 }],
    Subtotal: 100,
    TotalTaxAmount: 6,
    TotalPayableAmount: 106,
    additionalDocumentReferences: [
        { label: 'Exemption Cert. No.', id: 'Not Applicable' },
        { label: 'Cust. P/O No.', id: 'RS2607/0873' },
        { label: 'Cust. D/O No.', id: '128919' }
    ],
    OriginalInvoiceRef: 'Not Applicable'
};

describe('generateTemplateHash', () => {
    it('changes when additionalDocumentReferences change', () => {
        const before = generateTemplateHash(baseTemplateData);
        const after = generateTemplateHash({
            ...baseTemplateData,
            additionalDocumentReferences: [
                { label: 'Exemption Cert. No.', id: 'Not Applicable' },
                { label: 'Cust. P/O No.', id: 'RS2607/0873' },
                { label: 'Cust. D/O No.', id: 'DIFFERENT' }
            ]
        });

        expect(before).not.toEqual(after);
    });

    it('changes when OriginalInvoiceRef changes', () => {
        const before = generateTemplateHash(baseTemplateData);
        const after = generateTemplateHash({
            ...baseTemplateData,
            OriginalInvoiceRef: 'CN-999'
        });

        expect(before).not.toEqual(after);
    });

    it('is stable for identical template data', () => {
        expect(generateTemplateHash(baseTemplateData)).toEqual(generateTemplateHash(baseTemplateData));
    });
});
