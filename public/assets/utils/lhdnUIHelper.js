/**
 * LHDN UI Helper
 * Provides consistent UI error handling for LHDN errors
 */

const lhdnUIHelper = (function() {
    const WRAPPER_CODES = new Set(['2', 'REJECTION', 'VALIDATION_ERROR', 'VALIDATIONERROR']);
    const WRAPPER_MESSAGES = new Set(['validation error', 'document was rejected by lhdn']);

    const ERROR_CODES = {
        'DS302': 'This document has already been submitted to LHDN.',
        'CF321': 'Document issue date is invalid. Documents must be submitted within 7 days of issuance.',
        'CF364': 'Invalid item classification code. Please check all item classification codes.',
        'CF401': 'Tax calculation error. Please verify all tax amounts and calculations.',
        'CF402': 'Currency error. Please check that all monetary values use the correct currency code.',
        'CF403': 'Invalid tax code. Please verify the tax codes used in your document.',
        'CF404': 'Missing required field. Please ensure all required fields are completed.',
        'CF405': 'Invalid format. Please check the format of all fields in your document.',
        'CF406': 'Invalid value. One or more fields contain invalid values.',
        'CF407': 'Document number already exists. Please use a unique document number.',
        'CF414': 'The supplier phone number is too short or invalid.',
        'CF417': 'Additional Document Reference ID must be at most 3 characters (e.g. CIF, FOB, EXW). Put cert, P/O, and D/O numbers in Document Description.',
        'CF701': 'Business activity description is required.',
        'AUTH001': 'Authentication failed. Please check your credentials.',
        'AUTH002': 'Session expired. Please log in again.',
        'AUTH003': 'Unauthorized access. You do not have permission to perform this action.',
        'SYS001': 'LHDN system error. Please try again later.',
        'SYS002': 'Connection timeout. Please check your internet connection and try again.',
        'SYS003': 'Service unavailable. LHDN services are currently down or under maintenance.',
        'RATE_LIMIT': 'Rate limit exceeded. Please try again later.',
        'TIN_MISMATCH': 'The supplier TIN does not match the authenticated LHDN account.',
        'VALIDATION_ERROR': 'Document validation failed. Please check the details and try again.',
        'SUBMISSION_ERROR': 'Document submission failed. Please try again later.',
        'EMPTY_RESPONSE': 'No response received from LHDN. The service might be unavailable.',
        'UNKNOWN_ERROR': 'An unknown error occurred. Please try again or contact support.'
    };

    const FIELD_GUIDES = {
        'CF701': {
            field: 'Business activity description',
            issue: 'Business activity description is required.',
            meaning: 'LHDN needs the supplier MSIC activity name, not only the code. An empty name was sent.',
            nextStep: 'Open your Excel file and fill in the supplier Business activity description (column 15 / MSIC name), then resubmit.'
        },
        'CF417': {
            field: 'Incoterms / Additional Document Reference ID',
            issue: 'Additional Document Reference ID exceeds the 3-character Incoterms limit.',
            meaning: 'LHDN treats references with an empty or unknown document type as Incoterms (FOB, CIF, EXW). Incoterms IDs must be at most 3 characters.',
            nextStep: 'For exemption certificate, customer P/O, and D/O numbers, use a 3-letter placeholder such as CIF in the ID field and put the actual number in Document Description. Do not use BR as the document type. For a real bill reference, enter the full bill number in the billing reference field instead of the additional document reference ID.'
        },
        'CF414': {
            field: 'Supplier phone number',
            issue: 'The supplier phone number is too short or invalid.',
            meaning: 'LHDN requires a phone number of at least 8 characters.',
            nextStep: 'Update the supplier phone number in your Excel file so it is at least 8 characters, then resubmit.'
        },
        'CF321': {
            field: 'Issue date',
            issue: 'The invoice issue date is outside the allowed submission window.',
            meaning: 'Documents must be submitted within 7 days of issuance.',
            nextStep: 'Check the issue date in your Excel file. If it is more than 7 days old, create a current invoice before resubmitting.'
        },
        'CF364': {
            field: 'Item classification code',
            issue: 'An item classification code is invalid.',
            meaning: 'LHDN could not match one or more line-item classification codes.',
            nextStep: 'Check all item classification codes in your Excel file against the LHDN list, then resubmit.'
        },
        'CF401': {
            field: 'Tax amounts',
            issue: 'Tax calculation does not match LHDN rules.',
            meaning: 'The tax amounts on the invoice do not add up correctly.',
            nextStep: 'Verify all tax amounts and calculations in your Excel file, then resubmit.'
        },
        'CF402': {
            field: 'Currency',
            issue: 'A currency code is missing or invalid.',
            meaning: 'Every amount must use a valid currency code.',
            nextStep: 'Check that all monetary values use the correct currency code, then resubmit.'
        },
        'CF403': {
            field: 'Tax code',
            issue: 'A tax code is invalid.',
            meaning: 'LHDN did not recognise one or more tax codes on the invoice.',
            nextStep: 'Verify the tax codes in your Excel file, then resubmit.'
        },
        'CF404': {
            field: 'Required field',
            issue: 'A required field is missing.',
            meaning: 'LHDN cannot process the invoice until every required field is filled in.',
            nextStep: 'Complete all required fields in your Excel file, then resubmit.'
        },
        'CF405': {
            field: 'Format',
            issue: 'A field is in the wrong format.',
            meaning: 'LHDN expected a specific format for one or more fields.',
            nextStep: 'Check the format of the highlighted fields in your Excel file, then resubmit.'
        },
        'CF406': {
            field: 'Value',
            issue: 'One or more fields contain invalid values.',
            meaning: 'LHDN rejected a value that is not allowed.',
            nextStep: 'Correct the invalid values in your Excel file, then resubmit.'
        },
        'CF407': {
            field: 'Invoice number',
            issue: 'This invoice number already exists.',
            meaning: 'LHDN requires each invoice number to be unique.',
            nextStep: 'Use a unique invoice number, then resubmit.'
        },
        'DS302': {
            field: 'Invoice',
            issue: 'This document has already been submitted to LHDN.',
            meaning: 'LHDN does not accept the same invoice twice.',
            nextStep: 'Check the document status in the table. You do not need to resubmit this invoice.'
        },
        'DUPLICATE_SUBMISSION': {
            field: 'Invoice',
            issue: 'This document has already been submitted to LHDN.',
            meaning: 'LHDN does not accept the same invoice twice.',
            nextStep: 'Check the document status in the table. You do not need to resubmit this invoice.'
        },
        'AUTH001': {
            field: 'Sign-in',
            issue: 'Authentication failed.',
            meaning: 'LHDN could not verify your credentials.',
            nextStep: 'Log in again or contact your administrator, then try submitting once more.'
        },
        'AUTH002': {
            field: 'Session',
            issue: 'Your session has expired.',
            meaning: 'LHDN requires an active login to accept invoices.',
            nextStep: 'Log in again, then resubmit.'
        },
        'AUTH003': {
            field: 'Access',
            issue: 'You do not have permission to submit this invoice.',
            meaning: 'The signed-in account is not authorised for this action.',
            nextStep: 'Contact your administrator for access, then try again.'
        },
        'SYS001': {
            field: 'LHDN service',
            issue: 'LHDN reported a system error.',
            meaning: 'The issue is on LHDN’s side, not in your invoice fields.',
            nextStep: 'Wait a few minutes and try again. Contact support if it continues.'
        },
        'SYS002': {
            field: 'Connection',
            issue: 'The connection to LHDN timed out.',
            meaning: 'Your network or LHDN did not respond in time.',
            nextStep: 'Check your internet connection and try again.'
        },
        'SYS003': {
            field: 'LHDN service',
            issue: 'LHDN services are currently unavailable.',
            meaning: 'The LHDN portal may be down or under maintenance.',
            nextStep: 'Try again later. Contact support if the outage continues.'
        },
        'RATE_LIMIT': {
            field: 'Submission rate',
            issue: 'Too many submissions were sent in a short time.',
            meaning: 'LHDN temporarily limits how quickly invoices can be sent.',
            nextStep: 'Wait a few minutes, then resubmit.'
        },
        'TIN_MISMATCH': {
            field: 'Supplier TIN',
            issue: 'The supplier TIN does not match the authenticated LHDN account.',
            meaning: 'The TIN on the invoice must match the TIN used to sign in.',
            nextStep: 'Check the supplier TIN in your Excel file, or sign in with the matching LHDN account, then resubmit.'
        }
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function parseMaybeJson(value) {
        if (typeof value !== 'string') {
            return value;
        }

        const trimmed = value.trim();
        if (!trimmed) {
            return value;
        }

        try {
            return JSON.parse(trimmed);
        } catch (parseError) {
            const jsonMatch = trimmed.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
            if (!jsonMatch) {
                return value;
            }
            try {
                return JSON.parse(jsonMatch[0]);
            } catch (nestedParseError) {
                console.error('Unable to parse LHDN error JSON:', nestedParseError);
                return value;
            }
        }
    }

    function normalizeCode(code) {
        return code == null ? '' : String(code).trim().toUpperCase();
    }

    function normalizeMessage(message) {
        return String(message || '').trim().toLowerCase();
    }

    function isWrapperDetail(item) {
        if (!item || typeof item !== 'object') {
            return false;
        }

        const code = normalizeCode(item.code || item.errorCode);
        const message = normalizeMessage(item.message || item.errorMessage);
        const hasFieldHint = Boolean(item.target || item.propertyPath);

        if (WRAPPER_CODES.has(code) && !hasFieldHint) {
            return true;
        }

        if (WRAPPER_MESSAGES.has(message) && !hasFieldHint) {
            return true;
        }

        return false;
    }

    function isHiddenStringDetail(value) {
        const text = String(value || '').trim();
        const lower = text.toLowerCase();
        if (!text) {
            return true;
        }
        if (lower.startsWith('invoicecodenumber')) {
            return true;
        }
        if (/^2\s*:\s*validation error$/.test(lower)) {
            return true;
        }
        if (lower === 'validation error') {
            return true;
        }
        if (lower === 'rejection') {
            return true;
        }
        return false;
    }

    function looksLikeInvoiceNumber(value) {
        const text = String(value || '').trim();
        return Boolean(text) && !/\s/.test(text) && /[A-Za-z]/.test(text) && /\d/.test(text);
    }

    function humanizeTarget(target) {
        if (!target || typeof target !== 'string') {
            return '';
        }

        const lastSegment = target.split('.').pop().replace(/\[.*?\]/g, '');
        const spaced = lastSegment
            .replace(/([a-z])([A-Z])/g, '$1 $2')
            .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
            .replace(/[_-]+/g, ' ')
            .replace(/\s+/g, ' ')
            .trim();

        if (!spaced) {
            return '';
        }

        return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
    }

    function extractReceivedValue(detail) {
        const path = String(detail && detail.propertyPath ? detail.propertyPath : '');
        const attrMatch = path.match(/\[@([A-Za-z]+)='([^']*)'\]/);
        if (attrMatch) {
            return attrMatch[2] === '' ? 'empty' : attrMatch[2];
        }
        return '';
    }

    function extractInvoiceNumber(error) {
        if (!error) {
            return '';
        }

        if (typeof error === 'string') {
            const parsed = parseMaybeJson(error);
            if (parsed !== error) {
                return extractInvoiceNumber(parsed);
            }
            return '';
        }

        if (Array.isArray(error)) {
            return extractInvoiceNumber(error[0]);
        }

        if (typeof error !== 'object') {
            return '';
        }

        const direct = error.invoiceCodeNumber || error.invoice_number || error.docNum;
        if (direct && looksLikeInvoiceNumber(direct)) {
            return String(direct);
        }

        if (error.details && typeof error.details === 'object' && !Array.isArray(error.details)) {
            const nested = error.details.invoiceCodeNumber;
            if (nested && looksLikeInvoiceNumber(nested)) {
                return String(nested);
            }
        }

        return '';
    }

    function collectCandidateArrays(error) {
        const candidates = [];

        const pushArray = (value) => {
            if (Array.isArray(value) && value.length > 0) {
                candidates.push(value);
            }
        };

        if (!error) {
            return candidates;
        }

        if (Array.isArray(error)) {
            pushArray(error);
            return candidates;
        }

        if (typeof error !== 'object') {
            return candidates;
        }

        pushArray(error.details);
        pushArray(error.errorDetails);
        pushArray(error.error && error.error.details);
        pushArray(error.details && error.details.details);
        pushArray(error.details && error.details.error && error.details.error.details);

        if (error.details && typeof error.details === 'object' && !Array.isArray(error.details)) {
            pushArray(error.details.error && error.details.error.details);
        }

        return candidates;
    }

    function isRealValidationDetail(item) {
        if (!item) {
            return false;
        }

        if (typeof item === 'string') {
            return !isHiddenStringDetail(item);
        }

        if (typeof item !== 'object') {
            return false;
        }

        if (isWrapperDetail(item)) {
            return false;
        }

        const code = normalizeCode(item.code || item.errorCode);
        if (/^(CF|DS|AUTH|SYS)\d+/i.test(code)) {
            return true;
        }
        if (item.target || item.propertyPath) {
            return true;
        }
        if (item.message && !WRAPPER_MESSAGES.has(normalizeMessage(item.message))) {
            return true;
        }

        return false;
    }

    /**
     * Walk nested LHDN rejection payloads and return only actionable validation details.
     * Skips wrapper objects such as REJECTION, code "2", and generic "Validation Error".
     * @param {Object|String|Array} error
     * @returns {Array<Object>}
     */
    function extractValidationDetails(error) {
        let source = error;

        if (typeof source === 'string') {
            source = parseMaybeJson(source);
            if (typeof source === 'string') {
                return isHiddenStringDetail(source) ? [] : [{ message: source }];
            }
        }

        if (Array.isArray(source) && source.length === 1 && typeof source[0] === 'object') {
            const onlyItem = source[0];
            if (onlyItem && (onlyItem.details || onlyItem.error || onlyItem.invoiceCodeNumber)) {
                source = onlyItem;
            }
        }

        const candidates = collectCandidateArrays(source);
        const preferred = candidates.find((arr) => arr.some(isRealValidationDetail)) || candidates[0] || [];
        const seen = new Set();
        const collected = [];

        preferred.forEach((item) => {
            let detail = item;

            if (typeof detail === 'string') {
                detail = parseMaybeJson(detail);
            }

            if (typeof detail === 'string') {
                if (isHiddenStringDetail(detail)) {
                    return;
                }
                const key = `str:${detail}`;
                if (seen.has(key)) {
                    return;
                }
                seen.add(key);
                collected.push({ message: detail });
                return;
            }

            if (!detail || typeof detail !== 'object') {
                return;
            }

            if (Array.isArray(detail)) {
                detail.forEach((nested) => {
                    extractValidationDetails(nested).forEach((extracted) => {
                        const nestedKey = `${extracted.code || ''}|${extracted.message || ''}|${extracted.target || ''}`;
                        if (seen.has(nestedKey)) {
                            return;
                        }
                        seen.add(nestedKey);
                        collected.push(extracted);
                    });
                });
                return;
            }

            if (isWrapperDetail(detail) || detail.invoiceCodeNumber) {
                const nested = extractValidationDetails(detail);
                nested.forEach((extracted) => {
                    const nestedKey = `${extracted.code || ''}|${extracted.message || ''}|${extracted.target || ''}`;
                    if (seen.has(nestedKey)) {
                        return;
                    }
                    seen.add(nestedKey);
                    collected.push(extracted);
                });
                return;
            }

            if (!isRealValidationDetail(detail)) {
                return;
            }

            const code = detail.code || detail.errorCode || '';
            const message = detail.message || detail.errorMessage || '';
            const target = detail.target || '';
            const key = `${code}|${message}|${target}|${detail.propertyPath || ''}`;
            if (seen.has(key)) {
                return;
            }
            seen.add(key);
            collected.push(detail);
        });

        return collected;
    }

    function buildIssueCard(detail) {
        const code = normalizeCode(detail.code || detail.errorCode);
        const guide = FIELD_GUIDES[code];
        const fieldName = (guide && guide.field) || humanizeTarget(detail.target) || 'This field';
        const officialMessage = detail.message || detail.errorMessage || '';
        const issue = (guide && guide.issue) || officialMessage || `${fieldName} is invalid.`;
        const meaning = (guide && guide.meaning)
            || (officialMessage
                ? `LHDN rejected ${fieldName.toLowerCase()} with this message: ${officialMessage}`
                : `LHDN rejected this invoice because ${fieldName.toLowerCase()} did not meet their requirements.`);
        const nextStep = (guide && guide.nextStep) || `Update ${fieldName} in your Excel file, then resubmit.`;
        const receivedValue = extractReceivedValue(detail);
        const bullet = receivedValue ? `${fieldName} → ${receivedValue}` : fieldName;

        return {
            code,
            fieldName,
            issue,
            meaning,
            nextStep,
            bullet
        };
    }

    function displayBadgeCode(code, cards) {
        const uniqueCodes = [];
        (cards || []).forEach((card) => {
            if (card.code && !WRAPPER_CODES.has(card.code) && uniqueCodes.indexOf(card.code) === -1) {
                uniqueCodes.push(card.code);
            }
        });

        if (uniqueCodes.length === 1) {
            return uniqueCodes[0];
        }

        const normalized = normalizeCode(code);
        if (!normalized || WRAPPER_CODES.has(normalized)) {
            return 'REJECTION';
        }

        return uniqueCodes.length > 1 ? 'REJECTION' : normalized;
    }

    function isGenericHeadline(message) {
        const normalized = normalizeMessage(message);
        return !normalized
            || WRAPPER_MESSAGES.has(normalized)
            || normalized === 'lhdn validation failed'
            || normalized.startsWith('lhdn validation failed:');
    }

    /**
     * Format LHDN error for display
     * @param {Object|String|Array} error - The error object, string, or array
     * @returns {Object} Formatted error object with code, message, details, cards, and suggestion
     */
    function formatLHDNError(error) {
        let formattedError = {
            code: 'UNKNOWN_ERROR',
            message: 'An unknown error occurred',
            details: [],
            cards: [],
            invoiceCodeNumber: '',
            suggestion: 'Please try again or contact support'
        };

        try {
            console.log('Formatting LHDN error:', error);

            let source = error;
            if (typeof source === 'string') {
                source = parseMaybeJson(source);
                if (typeof source === 'string') {
                    formattedError.message = source;
                    return formattedError;
                }
            }

            if (Array.isArray(source)) {
                source = source[0] || source;
            }

            if (source && typeof source === 'object' && source.message
                && String(source.message).includes('Enter valid phone number')) {
                source = {
                    code: 'CF414',
                    message: source.message,
                    invoiceCodeNumber: source.invoiceCodeNumber,
                    details: [{
                        code: 'CF414',
                        message: 'Enter valid phone number and the minimum length is 8 characters - SUPPLIER',
                        target: 'ContactNumber',
                        propertyPath: 'Invoice.AccountingSupplierParty.Party.Contact.Telephone'
                    }]
                };
            }

            const rawCode = (source && (source.code || source.errorCode)) || 'UNKNOWN_ERROR';
            const rawMessage = (source && (source.message || source.errorMessage)) || 'An unknown error occurred';
            const details = extractValidationDetails(source);
            const cards = details.map(buildIssueCard);
            const invoiceCodeNumber = extractInvoiceNumber(source);
            const headline = cards.length > 0 && isGenericHeadline(rawMessage)
                ? 'Document was rejected by LHDN'
                : (ERROR_CODES[normalizeCode(rawCode)] || rawMessage);

            let suggestion = (cards[0] && cards[0].nextStep) || 'Please check the document and try again';
            const normalizedCode = normalizeCode(rawCode);
            if (!cards.length) {
                if (normalizedCode.indexOf('CF4') === 0) {
                    suggestion = 'Please verify all tax information and calculations';
                } else if (normalizedCode.indexOf('AUTH') === 0) {
                    suggestion = 'Please log in again or contact your administrator';
                } else if (normalizedCode.indexOf('SYS') === 0) {
                    suggestion = 'Please try again later or contact support';
                } else if (normalizedCode === 'RATE_LIMIT') {
                    suggestion = 'Please wait a few minutes before trying again';
                } else if (normalizedCode === 'DS302' || normalizedCode === 'DUPLICATE_SUBMISSION') {
                    suggestion = 'This document has already been submitted. Please check the document status.';
                }
            }

            formattedError = {
                code: displayBadgeCode(rawCode, cards),
                message: headline,
                details,
                cards,
                invoiceCodeNumber,
                target: source && source.target ? source.target : '',
                suggestion
            };

            console.log('Formatted LHDN error:', formattedError);
        } catch (formatError) {
            console.error('Error formatting LHDN error:', formatError);
        }

        return formattedError;
    }

    function renderIssueCards(cards) {
        if (!cards || cards.length === 0) {
            return '';
        }

        const cardsHtml = cards.map((card) => `
            <article class="lhdn-issue-card">
                ${card.code ? `<div class="lhdn-issue-code">${escapeHtml(card.code)}</div>` : ''}
                <section class="lhdn-issue-section lhdn-issue-detected">
                    <h6><i class="fas fa-exclamation-circle"></i> Issue Detected</h6>
                    <p>${escapeHtml(card.issue)}</p>
                    <ul class="lhdn-issue-bullets">
                        <li>${escapeHtml(card.bullet)}</li>
                    </ul>
                </section>
                <section class="lhdn-issue-section lhdn-issue-meaning">
                    <h6><i class="fas fa-info-circle"></i> What this means</h6>
                    <p>${escapeHtml(card.meaning)}</p>
                </section>
                <section class="lhdn-issue-section lhdn-issue-next">
                    <h6><i class="fas fa-lightbulb"></i> Next Step</h6>
                    <p>${escapeHtml(card.nextStep)}</p>
                </section>
            </article>
        `).join('');

        return `<div class="lhdn-issue-card-list">${cardsHtml}</div>`;
    }

    /**
     * Show LHDN error modal
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     */
    function showLHDNErrorModal(error, options = {}) {
        const formattedError = formatLHDNError(error);
        const mergedOptions = {
            title: 'LHDN Error',
            showDetails: true,
            showSuggestion: true,
            onClose: null,
            ...options
        };

        const invoiceContext = formattedError.invoiceCodeNumber
            ? `<div class="lhdn-invoice-context">Invoice <strong>${escapeHtml(formattedError.invoiceCodeNumber)}</strong></div>`
            : '';

        let modalHTML = `
            <div class="modern-modal-content">
                <div class="modal-header-section">
                    <div class="modal-brand">
                        <div class="brand-icon" style="background: rgba(239, 68, 68, 0.1); color: #ef4444;">
                            <i class="fas fa-exclamation-triangle"></i>
                        </div>
                        <div>
                            <h1 class="modal-title">${escapeHtml(mergedOptions.title)}</h1>
                            <p class="modal-subtitle">Please review the details below</p>
                        </div>
                    </div>
                    <div class="modal-meta">
                        <div class="meta-item">
                            <span class="meta-label">Error Code</span>
                            <span class="meta-value">${escapeHtml(formattedError.code)}</span>
                        </div>
                        <div class="meta-item">
                            <span class="meta-label">Status</span>
                            <span class="meta-value">Failed</span>
                        </div>
                    </div>
                </div>

                <div class="modal-content-section" style="padding: 2rem;">
                    <div class="error-code-badge">
                        <i class="fas fa-exclamation-triangle"></i>
                        ${escapeHtml(formattedError.code)}
                    </div>

                    <div class="error-message">
                        <h6><i class="fas fa-exclamation-circle"></i> LHDN Submission Error</h6>
                        <p>${escapeHtml(formattedError.message)}</p>
                        ${invoiceContext}
                    </div>
        `;

        if (mergedOptions.showDetails && formattedError.cards && formattedError.cards.length > 0) {
            modalHTML += renderIssueCards(formattedError.cards);
        }

        if (mergedOptions.showSuggestion && formattedError.suggestion && formattedError.cards.length === 0) {
            modalHTML += `
                    <div class="error-suggestion">
                        <h6><i class="fas fa-lightbulb"></i> Suggestion</h6>
                        <p>${escapeHtml(formattedError.suggestion)}</p>
                    </div>
            `;
        }

        modalHTML += `
                </div>
            </div>
        `;

        Swal.fire({
            html: modalHTML,
            showConfirmButton: true,
            confirmButtonText: 'I Understand',
            width: 640,
            padding: '0',
            background: 'transparent',
            customClass: {
                popup: 'modern-modal enhanced-error-modal',
                confirmButton: 'modern-btn modern-btn-success'
            }
        }).then(() => {
            if (mergedOptions.onClose) {
                mergedOptions.onClose();
            }
        });
    }

    /**
     * Show LHDN error toast
     * @param {Object|String|Array} error - The error object, string, or array
     * @param {Object} options - Display options
     */
    function showLHDNErrorToast(error, options = {}) {
        const formattedError = formatLHDNError(error);
        const mergedOptions = {
            position: 'top-center',
            autoHide: 5000,
            showDetails: false,
            ...options
        };

        let toastHTML = `
            <div class="toast-header bg-danger text-white">
                <strong class="me-auto">${escapeHtml(formattedError.code)}</strong>
                <button type="button" class="btn-close btn-close-white" data-bs-dismiss="toast" aria-label="Close"></button>
            </div>
            <div class="toast-body">
                <div class="fw-bold">${escapeHtml(formattedError.message)}</div>
        `;

        if (formattedError.invoiceCodeNumber) {
            toastHTML += `<div class="small mt-1">Invoice ${escapeHtml(formattedError.invoiceCodeNumber)}</div>`;
        }

        if (mergedOptions.showDetails && formattedError.cards && formattedError.cards.length > 0) {
            toastHTML += `<div class="mt-2 small text-start">${escapeHtml(formattedError.cards[0].issue)}`;
            if (formattedError.cards.length > 1) {
                toastHTML += ` <span class="text-muted">(+${formattedError.cards.length - 1} more)</span>`;
            }
            toastHTML += `</div>`;
        }

        if (formattedError.cards && formattedError.cards.length > 0 && !mergedOptions.showDetails) {
            toastHTML += `
                <div class="mt-2 text-center">
                    <button class="btn btn-sm btn-outline-danger view-details-btn">
                        View Details
                    </button>
                </div>
            `;
        }

        toastHTML += `</div>`;

        return Swal.fire({
            toast: true,
            position: mergedOptions.position.replace('-', '_'),
            html: toastHTML,
            showConfirmButton: false,
            timer: mergedOptions.autoHide > 0 ? mergedOptions.autoHide : undefined,
            timerProgressBar: mergedOptions.autoHide > 0,
            didOpen: (toastEl) => {
                toastEl.addEventListener('mouseenter', Swal.stopTimer);
                toastEl.addEventListener('mouseleave', Swal.resumeTimer);

                const viewDetailsBtn = toastEl.querySelector('.view-details-btn');
                if (viewDetailsBtn) {
                    viewDetailsBtn.addEventListener('click', () => {
                        Swal.close();
                        showLHDNErrorModal(error, {
                            title: 'LHDN Error Details',
                            showDetails: true,
                            showSuggestion: true
                        });
                    });
                }
            }
        });
    }

    return {
        formatLHDNError,
        extractValidationDetails,
        humanizeTarget,
        showLHDNErrorModal,
        showLHDNErrorToast,
        ERROR_CODES,
        FIELD_GUIDES
    };
})();
