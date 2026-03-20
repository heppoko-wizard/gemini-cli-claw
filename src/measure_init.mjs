import { loadSettings } from '../node_modules/@google/gemini-cli/dist/src/config/settings.js';
import { loadCliConfig, parseArguments } from '../node_modules/@google/gemini-cli/dist/src/config/config.js';
import { sessionId } from '@google/gemini-cli-core';

async function measure() {
    const start = Date.now();
    console.log(`[Init] Start: ${new Date().toISOString()}`);

    const settings = loadSettings();
    console.log(`[Init] Settings loaded: ${Date.now() - start}ms`);

    const argv = await parseArguments(settings.merged);
    console.log(`[Init] Args parsed: ${Date.now() - start}ms`);

    const config = await loadCliConfig(settings.merged, sessionId, argv, {
        projectHooks: settings.workspace.settings.hooks,
    });
    console.log(`[Init] Config loaded (pre-init): ${Date.now() - start}ms`);

    await config.storage.initialize();
    console.log(`[Init] Storage initialized: ${Date.now() - start}ms`);

    const initStart = Date.now();
    await config.initialize();
    console.log(`[Init] config.initialize() took: ${Date.now() - initStart}ms`);

    console.log(`[Init] Total: ${Date.now() - start}ms`);
    process.exit(0);
}

measure().catch(e => {
    console.error(e);
    process.exit(1);
});
