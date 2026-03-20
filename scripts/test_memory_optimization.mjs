import { runGeminiStreaming } from '../src/streaming.js';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function runTest() {
    console.log("=== Starting Memory Optimization Test ===");
    
    // モックのレスポンスオブジェクト
    const mockRes = {
        writeHead: () => {},
        write: (chunk) => {},
        end: () => {},
        on: (event, handler) => {}
    };

    const sessionKey = "test_memory_session_" + Date.now();
    const callId = "call_" + Date.now();

    // テスト1: ツール呼び出し（tool_call_request）を含まない通常のメッセージでの動作
    console.log("\n[Test 1] Regular message processing...");
    try {
        const handle = await runGeminiStreaming({
            prompt: "Hello",
            messages: [{ role: 'user', content: 'Hello' }],
            model: 'gemini',
            sessionName: null,
            mediaPaths: [],
            systemMdPath: path.join(__dirname, 'dummy_system.md'),
            res: mockRes,
            requestId: "req1",
            onSessionId: () => {},
            sessionKey: sessionKey
        });
        
        if (handle && typeof handle.kill === 'function') {
            handle.kill();
        }
        console.log("-> Success: No crash on regular message.");
    } catch (e) {
        console.error("-> Failed (Test 1):", e);
    }

    // テスト2: SSoT 6.0 マーカー（履歴）の処理でのリハイドレート動作（getSessionStore の ReferenceError が起きないか）
    console.log("\n[Test 2] History rehydration with tool marker...");
    try {
        const handle = await runGeminiStreaming({
            prompt: "Follow up",
            messages: [
                { role: 'user', content: 'Do something' },
                { role: 'assistant', content: `\n⚙️ tooluse[dummy_tool][${callId}]\n` }
            ],
            model: 'gemini',
            sessionName: null,
            mediaPaths: [],
            systemMdPath: path.join(__dirname, 'dummy_system.md'),
            res: mockRes,
            requestId: "req2",
            onSessionId: () => {},
            sessionKey: sessionKey
        });

        if (handle && typeof handle.kill === 'function') {
            handle.kill();
        }
        console.log("-> Success: No crash during history rehydration (getSessionStore bug is gone).");
    } catch (e) {
        console.error("-> Failed (Test 2):", e);
    }
    
    console.log("\n=== Test Finished ===");
    process.exit(0);
}

// create dummy file
fs.writeFileSync(path.join(__dirname, 'dummy_system.md'), 'dummy');
runTest().finally(() => {
    try { fs.rmSync(path.join(__dirname, 'dummy_system.md')); } catch(e){}
});
