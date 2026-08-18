const prisma = require('../../src/lib/prisma');

const DEFAULTS = {
    pollEnabled: true,
    pollIntervalMs: 5000,
    maxBackfillPerRefresh: 10,
    maxPollRetries: 2,
    respectRateLimitHeaders: true
};

const CONFIG_TTL_MS = 60000;
let configCache = null;
let configCacheTime = 0;

let queue = [];
let processing = false;
let lastCallTime = 0;
let rateLimitResetAt = 0;

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function isNotFoundError(error) {
    return error?.response?.status === 404;
}

function isRateLimitError(error) {
    return error?.response?.status === 429;
}

function isRetryableError(error) {
    const status = error?.response?.status;
    return !status || status >= 500;
}

function parseRateLimitHeaders(headers = {}) {
    const remaining = parseInt(
        headers['x-rate-limit-remaining'] ?? headers['X-RateLimit-Remaining'],
        10
    );
    const reset = parseInt(
        headers['x-rate-limit-reset'] ?? headers['X-RateLimit-Reset'],
        10
    );
    return {
        remaining: Number.isNaN(remaining) ? null : remaining,
        reset: Number.isNaN(reset) ? null : reset
    };
}

function updateRateLimitFromResponse(response) {
    if (!response?.headers) return;
    const { remaining, reset } = parseRateLimitHeaders(response.headers);
    if (remaining !== null && remaining <= 0 && reset) {
        const waitMs = Math.max(0, reset * 1000 - Date.now());
        if (waitMs > 0) {
            rateLimitResetAt = Date.now() + waitMs;
        }
    }
}

async function loadPollConfig() {
    const now = Date.now();
    if (configCache && (now - configCacheTime) < CONFIG_TTL_MS) {
        return configCache;
    }

    const keys = [
        'LHDN.PollEnabled',
        'LHDN.PollIntervalMs',
        'LHDN.MaxBackfillPerRefresh',
        'LHDN.MaxPollRetries'
    ];

    let settings = [];
    try {
        settings = await prisma.wP_ADMIN_SETTINGS.findMany({
            where: { SettingKey: { in: keys } },
            select: { SettingKey: true, SettingValue: true }
        });
    } catch (e) {
        console.warn('[LHDN Governor] Could not load WP_ADMIN_SETTINGS, using defaults');
    }

    const map = Object.fromEntries(settings.map((s) => [s.SettingKey, s.SettingValue]));

    configCache = {
        pollEnabled: String(map['LHDN.PollEnabled'] ?? '1').trim() !== '0',
        pollIntervalMs: parseInt(map['LHDN.PollIntervalMs'], 10) || DEFAULTS.pollIntervalMs,
        maxBackfillPerRefresh: parseInt(map['LHDN.MaxBackfillPerRefresh'], 10) || DEFAULTS.maxBackfillPerRefresh,
        maxPollRetries: parseInt(map['LHDN.MaxPollRetries'], 10) || DEFAULTS.maxPollRetries,
        respectRateLimitHeaders: DEFAULTS.respectRateLimitHeaders
    };
    configCacheTime = now;
    return configCache;
}

async function waitForGovernorInterval(intervalMs) {
    if (rateLimitResetAt > Date.now()) {
        await delay(rateLimitResetAt - Date.now());
    }

    const elapsed = Date.now() - lastCallTime;
    if (elapsed < intervalMs) {
        await delay(intervalMs - elapsed);
    }
}

async function processQueue() {
    if (processing) return;
    processing = true;

    while (queue.length > 0) {
        const { workFn, resolve, reject } = queue.shift();
        const config = await loadPollConfig();

        if (!config.pollEnabled) {
            resolve({
                skipped: true,
                reason: 'polling_disabled',
                success: false
            });
            continue;
        }

        await waitForGovernorInterval(config.pollIntervalMs);
        lastCallTime = Date.now();

        try {
            const result = await workFn({
                config,
                updateRateLimitFromResponse
            });
            resolve(result);
        } catch (error) {
            if (isNotFoundError(error)) {
                console.warn('[LHDN Governor] GetSubmission 404, skipping (no retry)');
                resolve({
                    success: false,
                    status: 'not_found',
                    error: '404 not_found'
                });
                continue;
            }

            if (isRateLimitError(error)) {
                const retryAfter = parseInt(error.response.headers['retry-after'] || '30', 10);
                console.log(`[LHDN Governor] 429 rate limited, waiting ${retryAfter}s`);
                rateLimitResetAt = Date.now() + retryAfter * 1000;
                await delay(retryAfter * 1000);
                reject(error);
                continue;
            }

            reject(error);
        }
    }

    processing = false;
}

function enqueueGetSubmission(workFn) {
    return new Promise((resolve, reject) => {
        queue.push({ workFn, resolve, reject });
        processQueue();
    });
}

module.exports = {
    loadPollConfig,
    enqueueGetSubmission,
    updateRateLimitFromResponse,
    isNotFoundError,
    isRateLimitError,
    isRetryableError
};
