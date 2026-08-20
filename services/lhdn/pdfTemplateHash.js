const crypto = require('crypto');

const generateTemplateHash = (templateData) => {
    const keyData = JSON.stringify({
        logo: templateData.CompanyLogo,
        companyInfo: {
            name: templateData.companyName,
            address: templateData.companyAddress,
            phone: templateData.companyPhone,
            email: templateData.companyEmail
        },
        documentInfo: {
            type: templateData.InvoiceType,
            code: templateData.InvoiceCode,
            uuid: templateData.UniqueIdentifier
        },
        items: templateData.items,
        totals: {
            subtotal: templateData.Subtotal,
            tax: templateData.TotalTaxAmount,
            total: templateData.TotalPayableAmount
        },
        additionalDocumentReferences: templateData.additionalDocumentReferences,
        OriginalInvoiceRef: templateData.OriginalInvoiceRef
    });
    return crypto.createHash('md5').update(keyData).digest('hex');
};

module.exports = { generateTemplateHash };
