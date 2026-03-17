'use strict';

const crypto = require('crypto');

function getTimestamp() {
    const now = new Date();
    return now.toISOString().replace('Z', '').split('T')[1]; // HH:mm:ss.SSS
}

function log(...args) {
    console.error(`[${getTimestamp()}] [adapter]`, ...args);
}

function debug(...args) {
    if (process.env.DEBUG === '1' || process.env.DEBUG === 'true') {
        console.error(`[${getTimestamp()}] [adapter:debug]`, ...args);
    }
}

function randomId() {
    return crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).substring(2, 11);
}

/**
 * Write an SSE event to the response.
 * If eventType is provided, sends `event: <type>\n` before data line.
 */
function sseWrite(res, data, eventType) {
    if (eventType) {
        res.write(`event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`);
    } else {
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
}

module.exports = { log, debug, randomId, sseWrite };
