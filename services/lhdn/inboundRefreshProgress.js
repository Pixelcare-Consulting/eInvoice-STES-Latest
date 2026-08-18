function createProgressEmitter(res) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no');

    if (typeof res.flushHeaders === 'function') {
        res.flushHeaders();
    }

    let closed = false;

    return {
        emit(event, payload = {}) {
            if (closed) {
                return;
            }
            res.write(`event: ${event}\n`);
            res.write(`data: ${JSON.stringify(payload)}\n\n`);
        },
        close() {
            if (closed) {
                return;
            }
            closed = true;
            res.end();
        },
        isClosed() {
            return closed;
        }
    };
}

module.exports = {
    createProgressEmitter
};
