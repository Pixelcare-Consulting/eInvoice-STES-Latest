const moment = require('moment');
const path = require('path');
const fs = require('fs');
const XLSX = require('xlsx');
const { processExcelData } = require('./processExcelData');

class ValidationError extends Error {
    constructor(message, validationErrors = [], fileName = null) {
        super(message);
        this.name = 'ValidationError';
        this.validationErrors = validationErrors;
        this.fileName = fileName;
    }
}

async function validateExcelFile(fileName, type, company, date, networkPath) {
    console.log('Starting validation with params:', { fileName, type, company, date });
    
    if (!fileName || !type || !company || !date) {
        console.error('Missing required parameters:', { fileName, type, company, date });
        throw new ValidationError('Missing required parameters for validation', [], fileName);
    }

    // Format date consistently
    const formattedDate = moment(date).format('YYYY-MM-DD');
    const filePath = path.join(networkPath, type, company, formattedDate, fileName);

    try {
        // Check if file exists
        if (!fs.existsSync(filePath)) {
            throw new ValidationError(`File not found: ${fileName}`, [{
                code: 'FILE_NOT_FOUND',
                message: 'The Excel file could not be found in the specified location',
                target: 'file',
                propertyPath: null,
                validatorType: 'System'
            }], fileName);
        }

        // Read Excel file
        const workbook = XLSX.readFile(filePath);
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const excelData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        
        console.log('Excel data structure:', {
            sheetCount: workbook.SheetNames.length,
            firstSheetName: workbook.SheetNames[0],
            rowCount: excelData.length,
            firstRow: excelData[0]
        });

        const processedData = processExcelData(excelData);
        
        if (!Array.isArray(processedData) || processedData.length === 0) {
            throw new ValidationError('Invalid file content', [{
                code: 'INVALID_CONTENT',
                message: 'The Excel file structure does not match the expected format. Please ensure it contains description row, field mappings row, and data rows.',
                target: 'content',
                propertyPath: null,
                validatorType: 'Format'
            }], fileName);
        }

        const rawData = processedData[0];

        if (!rawData) {
            throw new ValidationError('Invalid file content', [{
                code: 'INVALID_CONTENT',
                message: 'No valid document data found in the Excel file. Please check the file format and content.',
                target: 'content',
                propertyPath: null,
                validatorType: 'Format'
            }], fileName);
        }

        const validationErrors = [];

        // Header Validation (Mandatory fields)
        if (!rawData.header) {
            validationErrors.push({
                row: 'Header',
                errors: ['Missing header information']
            });
        } else {
            const headerErrors = [];
            const header = rawData.header;
            
            if (!header.invoiceNo) headerErrors.push('Missing invoice number');
            if (!header.invoiceType) headerErrors.push('Missing invoice type');

            if (header.invoiceNo && String(header.invoiceNo).length > 50) {
                headerErrors.push({
                    code: 'CF_INV_LEN',
                    message: 'e-Invoice Number must not exceed 50 characters',
                    target: 'InvoiceNo',
                    propertyPath: 'Invoice.ID'
                });
            }

            if (header.documentCurrencyCode
                && String(header.documentCurrencyCode).toUpperCase() !== 'MYR'
                && (!(Number(header.exchangeRate) > 0))) {
                headerErrors.push({
                    code: 'CF_FX_RATE',
                    message: 'Currency exchange rate is required and must be greater than 0 when document currency is not MYR',
                    target: 'TaxExchangeRate',
                    propertyPath: 'Invoice.TaxExchangeRate.CalculationRate'
                });
            }

            const periodStart = header.invoicePeriod?.startDate;
            const periodEnd = header.invoicePeriod?.endDate;
            const datePattern = /^\d{4}-\d{2}-\d{2}$/;
            if (periodStart && !datePattern.test(String(periodStart))) {
                headerErrors.push('Invoice period start date must be YYYY-MM-DD');
            }
            if (periodEnd && !datePattern.test(String(periodEnd))) {
                headerErrors.push('Invoice period end date must be YYYY-MM-DD');
            }
            
            // Validate issue date
            if (!header.issueDate?.[0]?._) {
                headerErrors.push('Missing issue date');
            } else {
                const issueDate = moment(header.issueDate[0]._);
                const today = moment();
                const daysDiff = today.diff(issueDate, 'days');
                
                if (daysDiff > 7) {
                    headerErrors.push({
                        code: 'CF321',
                        message: 'Issuance date time value of the document is too old that cannot be submitted.',
                        target: 'DatetimeIssued',
                        propertyPath: 'Invoice.IssueDate AND Invoice.IssueTime'
                    });
                }
            }
            
            if (!header.issueTime?.[0]?._) headerErrors.push('Missing issue time');
            if (!header.currency) headerErrors.push('Missing currency');
          
            if (headerErrors.length > 0) {
                validationErrors.push({
                    row: 'Header',
                    errors: headerErrors
                });
            }
        }

        // Party / payment length and address checks
        const pushPartyErrors = (label, party) => {
            if (!party) return;
            const partyErrors = [];

            if (party.address) {
                const country = party.address.country;
                const postcode = party.address.postcode;
                const state = party.address.state;
                const isMY = !country
                    || ['MYS', 'MY', 'MALAYSIA'].includes(String(country).toUpperCase());

                if (postcode && String(postcode).toUpperCase() !== 'NA') {
                    if (isMY && !/^\d{1,5}$/.test(String(postcode))) {
                        partyErrors.push(`${label} postcode for Malaysia must be 1-5 digits`);
                    }
                    if (!isMY && String(postcode).length > 50) {
                        partyErrors.push(`${label} postcode must not exceed 50 characters`);
                    }
                }

                if (state && String(state).toUpperCase() !== 'NA' && String(state).length > 50) {
                    partyErrors.push(`${label} state must not exceed 50 characters`);
                }
            }

            (party.identifications || []).forEach((id) => {
                if (String(id.schemeId || '').toUpperCase() === 'PASSPORT'
                    && id.id
                    && String(id.id).toUpperCase() !== 'NA'
                    && String(id.id).length > 12) {
                    partyErrors.push(`${label} PASSPORT ID must not exceed 12 characters`);
                }
            });

            if (partyErrors.length > 0) {
                validationErrors.push({
                    row: label,
                    errors: partyErrors
                });
            }
        };

        pushPartyErrors('Supplier', rawData.supplier);
        pushPartyErrors('Buyer', rawData.buyer);
        pushPartyErrors('Delivery', rawData.delivery);

        if (rawData.payment) {
            const paymentErrors = [];
            if (rawData.payment.payeeFinancialAccount
                && String(rawData.payment.payeeFinancialAccount).length > 150) {
                paymentErrors.push('Bank account number must not exceed 150 characters');
            }
            if (rawData.payment.paymentTerms
                && String(rawData.payment.paymentTerms).length > 300) {
                paymentErrors.push('Payment terms must not exceed 300 characters');
            }
            if (rawData.payment.prepaidPayment?.id
                && String(rawData.payment.prepaidPayment.id).length > 150) {
                paymentErrors.push('Prepayment reference must not exceed 150 characters');
            }
            if (rawData.payment.prepaidPayment?.date) {
                const prepaidDate = String(rawData.payment.prepaidPayment.date);
                if (!/^\d{4}-\d{2}-\d{2}$/.test(prepaidDate)) {
                    paymentErrors.push('Prepaid payment date must be YYYY-MM-DD');
                }
            }
            if (paymentErrors.length > 0) {
                validationErrors.push({
                    row: 'Payment',
                    errors: paymentErrors
                });
            }
        }

        // Items Validation
        if (!rawData.items || !Array.isArray(rawData.items)) {
            validationErrors.push({
                row: 'Items',
                errors: ['No items found in document']
            });
        } else {
            const validItems = rawData.items.filter(item => 
                item && 
                item.lineId &&
                item.quantity > 0 && 
                item.unitPrice > 0 &&
                item.item?.classification?.code &&
                item.item?.classification?.type &&
                item.item?.description
            );

            if (validItems.length === 0) {
                validationErrors.push({
                    row: 'Items',
                    errors: ['No valid items found in document']
                });
            } else {
                validItems.forEach((item, index) => {
                    const itemErrors = [];
                    const lineNumber = index + 1;

                    // Validate tax information
                    if (item.taxTotal) {
                        const taxSubtotal = item.taxTotal.taxSubtotal?.[0];
                        if (!taxSubtotal) {
                            itemErrors.push({
                                code: 'CF366',
                                message: 'Missing tax subtotal information',
                                target: 'TaxSubtotal',
                                propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal`
                            });
                        } else {
                            const taxTypeCode = taxSubtotal.taxCategory?.id;
                            
                            if (!['01', '02', '03', '04', '05', '06', 'E'].includes(taxTypeCode)) {
                                itemErrors.push({
                                    code: 'CF366',
                                    message: 'Invalid tax type code',
                                    target: 'TaxTypeCode',
                                    propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal[0].TaxCategory.ID`
                                });
                            }

                            if (taxTypeCode === '06') {
                                if (taxSubtotal.taxAmount !== 0 || taxSubtotal.taxCategory?.percent !== 0) {
                                    itemErrors.push({
                                        code: 'CF367',
                                        message: 'For tax type 06 (Not Applicable), all tax amounts and rates must be zero',
                                        target: 'TaxTotal',
                                        propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal`
                                    });
                                }
                            } else if (taxTypeCode === 'E') {
                                // SDK (17 Jul 2026): TaxAmount may be the amount that would have been payable
                                if (!taxSubtotal.taxCategory?.exemptionReason) {
                                    itemErrors.push({
                                        code: 'CF369',
                                        message: 'Tax exemption reason is required for tax type E',
                                        target: 'TaxExemptionReason',
                                        propertyPath: `Invoice.InvoiceLine[${lineNumber}].TaxTotal.TaxSubtotal[0].TaxCategory.ExemptionReason`
                                    });
                                }
                            }
                        }
                    }

                    if (itemErrors.length > 0) {
                        validationErrors.push({
                            row: `Item ${lineNumber}`,
                            errors: itemErrors
                        });
                    }
                });
            }
        }

        // Summary Validation
        if (!rawData.summary) {
            validationErrors.push({
                row: 'Summary',
                errors: ['Missing document summary']
            });
        } else {
            const summaryErrors = [];
            const summary = rawData.summary;

            // Validate amounts
            if (!summary.amounts?.lineExtensionAmount) summaryErrors.push('Missing line extension amount');
            if (!summary.amounts?.taxExclusiveAmount) summaryErrors.push('Missing tax exclusive amount');
            if (!summary.amounts?.taxInclusiveAmount) summaryErrors.push('Missing tax inclusive amount');
            if (!summary.amounts?.payableAmount) summaryErrors.push('Missing payable amount');

            // Validate tax total
            if (!summary.taxTotal) {
                summaryErrors.push({
                    code: 'CF380',
                    message: 'Missing TaxTotal information',
                    target: 'TaxTotal',
                    propertyPath: 'Invoice.TaxTotal'
                });
            } else {
                const taxTotal = summary.taxTotal;
                
                if (!taxTotal.taxSubtotal || !Array.isArray(taxTotal.taxSubtotal)) {
                    summaryErrors.push({
                        code: 'CF381',
                        message: 'Missing or invalid tax subtotal information',
                        target: 'TaxSubtotal',
                        propertyPath: 'Invoice.TaxTotal.TaxSubtotal'
                    });
                }
            }

            if (summaryErrors.length > 0) {
                validationErrors.push({
                    row: 'Summary',
                    errors: summaryErrors
                });
            }
        }

        if (validationErrors.length > 0) {
            throw new ValidationError('Validation failed', validationErrors, fileName);
        }

        return {
            success: true,
            data: rawData,
            message: 'Validation successful'
        };

    } catch (error) {
        if (error instanceof ValidationError) {
            throw error;
        }
        throw new ValidationError('Validation failed', [{
            code: 'VALIDATION_ERROR',
            message: error.message,
            target: 'file',
            propertyPath: null,
            validatorType: 'System'
        }], fileName);
    }
}

module.exports = {
    validateExcelFile,
    ValidationError
}; 