import path from 'path';
import fs from 'fs';
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

    // SSoT 5.2: 隔離環境内のスキルディレクトリを WorkspaceContext の許可リストに追加
    // これにより read_file 等のツールでスキルドキュメントを自律的に参照可能にする
    const isolatedGeminiDir = process.env.GEMINI_CLI_HOME ? path.join(process.env.GEMINI_CLI_HOME, '.gemini') : null;
    if (isolatedGeminiDir) {
        const skillsDir = path.join(isolatedGeminiDir, 'skills');
        if (fs.existsSync(skillsDir)) {
            try {
                config.getWorkspaceContext().addReadOnlyPath(skillsDir);
                console.log(`[Runner] Added skills directory to read-only workspace: ${skillsDir}`);
            } catch (e) {
                console.warn(`[Runner] Failed to add skills path to workspace: ${e.message}`);
            }
        }
    }

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

    process.on('message', async (message) => {
        if (message.type === 'run') {
            const { input, prompt_id, resumedSessionData, model, mediaPaths } = message;

            // --- SSoT 5.0: 全イベント傍受＋IPC送信 ---
            if (config && config.getGeminiClient) {
                const geminiClient = config.getGeminiClient();
                const originalSendMessageStream = geminiClient.sendMessageStream.bind(geminiClient);
                
                geminiClient.sendMessageStream = async function* (...args) {
                    const gen = originalSendMessageStream(...args);
                    for await (const event of gen) {
                        if (process.send) {
                            try {
                                process.send({
                                    type: 'gemini_event',
                                    event: {
                                        type: event.type,
                                        value: event.value,
                                        traceId: event.traceId,
                                        reason: event.reason,
                                    }
                                });
                            } catch (e) {
                                console.error('[Runner] IPC send failed:', e.message);
                            }
                        }
                        yield event;
                    }
                };
            }
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

                // メディアパスを @path 形式で入力に付加し、同時にアクセス許可のためにWorkspaceContextに追加する
                // Gemini CLI は @/path/to/file 構文でローカルファイルを読み込むが、TargetDir外のファイルは弾くため
                let finalInput = input;
                if (Array.isArray(mediaPaths) && mediaPaths.length > 0) {
                    const atPaths = [];
                    for (const p of mediaPaths) {
                        if (typeof p === 'string' && p.startsWith('/')) {
                            // Gemini CLIのセキュリティ制約（Workspace外ファイル読み取り禁止）を回避するため、
                            // パスを ReadOnlyPath として登録する
                            try {
                                config.getWorkspaceContext().addReadOnlyPath(p);
                            } catch (e) {
                                console.warn(`[Runner] Failed to add read-only path for ${p}:`, e);
                            }
                            atPaths.push(`@${p}`);
                        }
                    }
                    if (atPaths.length > 0) {
                        console.log(`[Runner] Injecting ${atPaths.length} media path(s): ${atPaths.join(', ')}`);
                        finalInput = atPaths.join(' ') + '\n' + (input || '');
                    }
                }

                // gemini.js のメインループを呼び出す
                await runNonInteractive({
                    config,
                    settings,
                    input: finalInput,
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
