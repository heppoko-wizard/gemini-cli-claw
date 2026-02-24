#!/usr/bin/env node
'use strict';

/**
 * gemini-cli-claw / scripts / update_models.js
 *
 * Fetches available models from `@google/gemini-cli-core` and syncs them
 * to ~/.openclaw/openclaw.json (the single source of truth for OpenClaw).
 * OpenClaw's Gateway will automatically regenerate models.json from there on startup.
 *
 * Updates two sections of openclaw.json:
 *   1. models.providers.gemini-adapter.models  - provider model definitions
 *   2. agents.defaults.models                  - model ID map shown in UI / models list
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const OPENCLAW_JSON_PATH = path.join(os.homedir(), '.openclaw', 'openclaw.json');

try {
    const core = require('@google/gemini-cli-core');

    if (!core.VALID_GEMINI_MODELS) {
        throw new Error("VALID_GEMINI_MODELS not found in @google/gemini-cli-core. The API might have changed.");
    }

    const validModels = Array.from(core.VALID_GEMINI_MODELS);
    console.log(`[update_models] Found ${validModels.length} models from Gemini CLI Core.`);

    // Map to OpenClaw model entry format
    const modelDefinitions = validModels.map(model => ({
        id: model,
        name: model,
        reasoning: model.includes('pro'),
        input: ["text", "image"],
        contextWindow: 1000000,
        maxTokens: 8192,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
    }));

    // Add auto aliases
    for (const alias of [
        { id: 'auto-gemini-3', name: 'Auto (Gemini 3)' },
        { id: 'auto-gemini-2.5', name: 'Auto (Gemini 2.5)' }
    ]) {
        if (!modelDefinitions.find(m => m.id === alias.id)) {
            modelDefinitions.push({
                id: alias.id,
                name: alias.name,
                reasoning: false,
                input: ["text", "image"],
                contextWindow: 1000000,
                maxTokens: 8192,
                cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }
            });
        }
    }

    if (!fs.existsSync(OPENCLAW_JSON_PATH)) {
        throw new Error(`${OPENCLAW_JSON_PATH} not found. Is OpenClaw installed?`);
    }

    const config = JSON.parse(fs.readFileSync(OPENCLAW_JSON_PATH, 'utf-8'));

    // 1. Update models.providers.gemini-adapter.models
    if (!config.models) config.models = {};
    if (!config.models.providers) config.models.providers = {};
    if (!config.models.providers['gemini-adapter']) {
        config.models.providers['gemini-adapter'] = {
            baseUrl: "http://localhost:3972",
            apiKey: "not-needed",
            api: "openai-completions",
            models: []
        };
    }
    config.models.providers['gemini-adapter'].models = modelDefinitions;

    // 2. Update agents.defaults.models (controls what appears in `openclaw models list` / UI)
    if (!config.agents) config.agents = {};
    if (!config.agents.defaults) config.agents.defaults = {};
    if (!config.agents.defaults.models) config.agents.defaults.models = {};

    // Remove stale gemini-adapter entries
    for (const key of Object.keys(config.agents.defaults.models)) {
        if (key.startsWith('gemini-adapter/')) {
            delete config.agents.defaults.models[key];
        }
    }
    // Register all dynamic models
    for (const modelDef of modelDefinitions) {
        config.agents.defaults.models[`gemini-adapter/${modelDef.id}`] = {};
    }

    fs.writeFileSync(OPENCLAW_JSON_PATH, JSON.stringify(config, null, 4), 'utf-8');
    console.log(`[update_models] Synced ${modelDefinitions.length} models to openclaw.json`);
    process.exit(0);

} catch (err) {
    console.error(`[update_models] Error: ${err.message}`);
    process.exit(1);
}
