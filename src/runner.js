import { loadSettings } from '../node_modules/@google/gemini-cli/dist/src/config/settings.js';
import { loadCliConfig, parseArguments } from '../node_modules/@google/gemini-cli/dist/src/config/config.js';
import { validateNonInteractiveAuth } from '../node_modules/@google/gemini-cli/dist/src/validateNonInterActiveAuth.js';
import { runNonInteractive } from '../node_modules/@google/gemini-cli/dist/src/nonInteractiveCli.js';
import { SessionSelector } from '../node_modules/@google/gemini-cli/dist/src/utils/sessionUtils.js';
import { initializeOutputListenersAndFlush } from '../node_modules/@google/gemini-cli/dist/src/gemini.js';
import { sessionId, ExitCodes, debugLogger } from '@google/gemini-cli-core';

async function main() {
    // 1. 設定のロード
    const settings = loadSettings();
    const argv = await parseArguments(settings.merged);
    const config = await loadCliConfig(settings.merged, sessionId, argv, {
        projectHooks: settings.workspace.settings.hooks,
    });
    await config.storage.initialize();
    await config.initialize();

    // 2. 認証のロード (非対話用)
    const authType = await validateNonInteractiveAuth(
        settings.merged.security.auth.selectedType,
        settings.merged.security.auth.useExternal,
        config,
        settings
    );
    await config.refreshAuth(authType);

    // 3. リスナのセットアップ (これがないと何も出力されない)
    initializeOutputListenersAndFlush();

    // 4. 準備完了の報告 (IPC)
    if (process.send) {
        process.send({ type: 'ready' });
    } else {
        console.log("[Runner] Ready. Waiting for IPC message...");
    }

    // 5. プロンプトの受信と実行
    process.on('message', async (message) => {
        if (message.type === 'run') {
            const { input, prompt_id, resumedSessionData, model } = message;
            
            try {
                if (resumedSessionData && resumedSessionData.conversation) {
                    config.setSessionId(resumedSessionData.conversation.sessionId);
                }
                
                if (model) {
                    settings.merged.model.name = model;
                    if (config.settings && config.settings.model) {
                        config.settings.model.name = model;
                    }
                    console.log(`[Runner] Using model: ${model}`);
                }

                // gemini.js のメインループを呼び出す
                await runNonInteractive({
                    config,
                    settings,
                    input,
                    prompt_id: prompt_id || Math.random().toString(16).slice(2),
                    resumedSessionData,
                });
                
                // ストリーミング・実行が終わったら終了
                process.exit(ExitCodes.SUCCESS);
            } catch (error) {
                console.error("[Runner] Error during execution:", error);
                process.exit(ExitCodes.FATAL_INPUT_ERROR);
            }
        }
    });

    // メッセージが永遠に来ない場合のフェイルセーフ (例えば30分)
    setTimeout(() => {
        debugLogger.error("[Runner] Timed out waiting for input.");
        process.exit(ExitCodes.FATAL_INPUT_ERROR);
    }, 30 * 60 * 1000);
}

main().catch((err) => {
    console.error("[Runner] Unhandled initialization error:", err);
    process.exit(1);
});
