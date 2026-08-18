const prisma = require('../../src/lib/prisma');
const LHDNSubmitter = require('./lhdnSubmitter');
const { loadPollConfig } = require('./lhdnRequestGovernor');

function mapSubmissionDocsForInbound(result) {
    const rawDocs = [];
    if (result.data?.documentSummary && Array.isArray(result.data.documentSummary)) {
        rawDocs.push(...result.data.documentSummary);
    } else if (result.documentDetails && Object.keys(result.documentDetails).length > 0) {
        rawDocs.push(result.documentDetails);
    }

    return rawDocs.map((doc) => ({
        ...doc,
        uuid: doc.uuid,
        submissionUid: doc.submissionUid,
        longId: doc.longId,
        internalId: doc.internalId,
        typeName: doc.typeName,
        typeVersionName: doc.typeVersionName,
        issuerTin: doc.issuerTin,
        issuerName: doc.issuerName,
        receiverId: doc.receiverId,
        receiverName: doc.receiverName,
        dateTimeReceived: doc.dateTimeReceived,
        dateTimeValidated: doc.dateTimeValidated,
        status: doc.status,
        documentStatusReason: doc.documentStatusReason,
        totalSales: doc.totalSales || doc.totalPayableAmount,
        totalExcludingTax: doc.totalExcludingTax,
        totalDiscount: doc.totalDiscount,
        totalNetAmount: doc.totalNetAmount,
        totalPayableAmount: doc.totalPayableAmount
    }));
}

async function getStuckOutboundRecords({ afterInvoice = 'ARINV128682' } = {}) {
    return prisma.wP_OUTBOUND_STATUS.findMany({
        where: {
            invoice_number: { gt: afterInvoice },
            status: { in: ['Submitted', 'Processing'] },
            UUID: { not: null, notIn: ['NA', ''] },
            submissionUid: { not: 'NA' }
        },
        orderBy: { invoice_number: 'asc' }
    });
}

async function getMissingInboundOutboundRecords({ afterInvoice = 'ARINV128682' } = {}) {
    return prisma.$queryRaw`
        SELECT o.*
        FROM WP_OUTBOUND_STATUS o
        LEFT JOIN WP_INBOUND_STATUS i ON i.uuid = o.UUID
        WHERE o.invoice_number > ${afterInvoice}
          AND o.status IN ('Valid', 'Partially Valid', 'Submitted', 'Processing')
          AND o.UUID IS NOT NULL AND o.UUID NOT IN ('NA', '')
          AND o.submissionUid IS NOT NULL AND o.submissionUid <> 'NA'
          AND i.uuid IS NULL
        ORDER BY o.invoice_number ASC
    `;
}

function normalizeOutboundStatus(status) {
    const lower = String(status || '').toLowerCase();
    if (lower === 'valid') return 'Valid';
    if (lower === 'invalid') return 'Invalid';
    if (lower === 'partially valid') return 'Partially Valid';
    return 'Processing';
}

function isFinalStatus(status) {
    const lower = String(status || '').toLowerCase();
    return lower === 'valid' || lower === 'invalid' || lower === 'partially valid';
}

async function backfillStuckOutbound(req, { afterInvoice = 'ARINV128682', maxCount } = {}, { onProgress } = {}) {
    const config = await loadPollConfig();
    const emptyResult = {
        processed: 0,
        successCount: 0,
        failedCount: 0,
        remaining: 0,
        failures: []
    };

    if (!config.pollEnabled) {
        return {
            ...emptyResult,
            skipped: true,
            reason: 'polling_disabled'
        };
    }

    const allMissing = await getMissingInboundOutboundRecords({ afterInvoice });
    const cap = maxCount ?? config.maxBackfillPerRefresh;
    const batch = allMissing.slice(0, cap);
    const remaining = Math.max(0, allMissing.length - batch.length);

    if (batch.length === 0) {
        return emptyResult;
    }

    const { getTokenSession } = require('../token-prisma.service');
    const token = await getTokenSession();
    if (!token) {
        return {
            processed: 0,
            successCount: 0,
            failedCount: batch.length,
            remaining,
            failures: [{ reason: 'no_token' }]
        };
    }

    const { saveInboundStatus } = require('../../routes/api/lhdn');
    const submitter = new LHDNSubmitter(req);
    const failures = [];
    let successCount = 0;

    for (let index = 0; index < batch.length; index++) {
        const record = batch[index];
        const current = index + 1;
        const total = batch.length;

        onProgress?.({
            current,
            total,
            invoice_number: record.invoice_number,
            status: 'processing'
        });

        try {
            console.log(`[inbound-sync] Backfilling ${record.invoice_number} (${record.submissionUid})`);
            const pollResult = await submitter.getSubmissionDetails(record.submissionUid, token);

            if (pollResult.success) {
                const statusLabel = normalizeOutboundStatus(pollResult.status);

                await submitter.updateSubmissionStatus({
                    invoice_number: record.invoice_number,
                    uuid: pollResult.documentDetails?.uuid || record.UUID || 'NA',
                    submissionUid: record.submissionUid,
                    fileName: record.fileName,
                    filePath: record.filePath,
                    status: statusLabel,
                    longId: pollResult.longId,
                    type: record.type,
                    company: record.company,
                    date: record.date
                });

                if (isFinalStatus(pollResult.status)) {
                    const docs = mapSubmissionDocsForInbound(pollResult).map((doc) => ({
                        ...doc,
                        internalId: doc.internalId || record.invoice_number,
                        uuid: doc.uuid || record.UUID
                    }));
                    if (docs.length) {
                        await saveInboundStatus({ result: docs }, req);
                    }
                }

                successCount++;
                onProgress?.({
                    current,
                    total,
                    invoice_number: record.invoice_number,
                    status: 'success'
                });
            } else {
                const reason = pollResult.error || 'polling_failed';
                failures.push({
                    invoice_number: record.invoice_number,
                    reason
                });
                onProgress?.({
                    current,
                    total,
                    invoice_number: record.invoice_number,
                    status: 'failed',
                    reason
                });
            }
        } catch (recordError) {
            const reason = recordError.response?.status === 404
                ? '404 not_found'
                : recordError.message;
            console.error(`[inbound-sync] Error for ${record.invoice_number}:`, recordError.message);
            failures.push({
                invoice_number: record.invoice_number,
                reason
            });
            onProgress?.({
                current,
                total,
                invoice_number: record.invoice_number,
                status: 'failed',
                reason
            });
        }
    }

    return {
        processed: batch.length,
        successCount,
        failedCount: batch.length - successCount,
        remaining,
        failures
    };
}

module.exports = {
    getStuckOutboundRecords,
    getMissingInboundOutboundRecords,
    mapSubmissionDocsForInbound,
    backfillStuckOutbound
};
