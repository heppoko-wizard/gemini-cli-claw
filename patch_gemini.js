const fs = require('fs');
const path = require('path');

const targetFile = path.join(__dirname, 'node_modules', '@google', 'gemini-cli-core', 'dist', 'src', 'utils', 'authConsent.js');
let content = fs.readFileSync(targetFile, 'utf8');

// The race condition occurs because listenerCount is 0 momentarily.
// We can bypass this by simply returning getOauthConsentInteractive() and letting the event queue up,
// OR we can make getConsentForOauth always return true non-interactively in our adapter.
// Actually, since we are an automated adapter, we ALWAYS want to grant consent.
content = content.replace(
    /export async function getConsentForOauth\(prompt\) \{([\s\S]*?)\}/,
    `export async function getConsentForOauth(prompt) {
    if (process.env.OPENCLAW_AUTO_CONSENT === 'true') {
        const { coreEvents, CoreEvent } = require('./events.js');
        coreEvents.emit(CoreEvent.UserFeedback, { severity: 'info', message: 'Auto-consenting to OAuth via OpenClaw Adapter.' });
        return true;
    }
    $1
}`
);

fs.writeFileSync(targetFile, content, 'utf8');
console.log("Patched authConsent.js");
