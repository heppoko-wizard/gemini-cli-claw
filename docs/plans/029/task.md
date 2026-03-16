# SSoT 5.0 Task List

## 📊 Overall Progress
- [/] Phase 1: Planning (Current)
- [ ] Phase 2: Implementation
- [ ] Phase 3: Verification

## 📝 Checklists

### Phase 2: Implementation

- [ ] Task 1: `src/runner.mjs` — `sendMessageStream` のラップ（全イベント傍受＋IPC送信）
  - **目的**: Gemini CLIコアの `geminiClient.sendMessageStream` をプロキシし、全イベントを `process.send()` で親プロセスに送信する。同時に元のジェネレータへパススルーして `nonInteractiveCli.js` の動作を一切壊さない。
  - **実装詳細**:
    - [ ] `runner.mjs` の `process.on('message', async (message) => {` ハンドラ内（38行目付近）の `await runNonInteractive(...)` 呼び出し（79行目）の**直前**に、`geminiClient.sendMessageStream` をラップするコードを挿入する。
    - [ ] ラップの実装コード:
      ```javascript
      // --- SSoT 5.0: 全イベント傍受＋IPC送信 ---
      const geminiClient = config.getGeminiClient();
      const originalSendMessageStream = geminiClient.sendMessageStream.bind(geminiClient);
      
      geminiClient.sendMessageStream = async function* (...args) {
          const stream = yield* (async function* () {
              // originalの非同期ジェネレータを取得
              const gen = originalSendMessageStream(...args);
              for await (const event of gen) {
                  // 全イベントをIPCで親プロセスへ送信
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
                          // IPC送信失敗は無視（親プロセスが切断された場合等）
                          console.error('[Runner] IPC send failed:', e.message);
                      }
                  }
                  // 元のジェネレータにパススルー
                  yield event;
              }
          })();
          yield* stream;
      };
      ```
    - [ ] 上記コードの挿入位置は、`config.getGeminiClient()` が利用可能になった後（`await config.initialize()` の後、17行目より後）、かつ `runNonInteractive(...)` の呼び出し（79行目）の前であること。具体的には `process.on('message', ...)` のコールバック冒頭、`const { input, prompt_id, ... } = message;` の直後（41行目付近）に配置。
    - [ ] **注意**: `sendMessageStream` は `GeminiClient` のメソッドであり、`async *` ジェネレータ関数。ラッパーも同じ `async *` シグネチャを維持すること。
  - **検証方法**:
    - [ ] Docker コンテナを起動し、`node src/runner.mjs --approval-mode=yolo --sandbox=false -o stream-json` を手動実行。IPC の代わりに `console.log` でイベントが流れることを目視確認。
    - [ ] `nonInteractiveCli.js` の通常出力（stdout の JSON Lines）が従来通り動作していることを確認（パススルーの検証）。

- [ ] Task 2: `src/streaming.js` — IPC メッセージ受信ハンドラの実装
  - **目的**: `runner.on('message')` で IPC イベントを受信し、OpenAI 互換 SSE チャンクに変換して `res` に書き込む。
  - **実装詳細**:
    - [ ] `streaming.js` の `runGeminiStreaming` 関数内、`runner.stdout.on('data', ...)` ブロック（388行目）の**直前**に、以下の IPC メッセージハンドラを追加する:
      ```javascript
      // --- SSoT 5.0: IPC によるイベント受信 ---
      let toolCallIndex = 0; // tool_calls の index 管理用
      
      runner.on('message', (msg) => {
          if (msg.type !== 'gemini_event') return;
          const event = msg.event;
          
          switch (event.type) {
              case 'content': {
                  if (!event.value) break;
                  if (!perfFirstToken) {
                      perfFirstToken = Date.now();
                      log(`[perf] Time To First Token: ${((perfFirstToken - perfStart) / 1000).toFixed(2)}s`);
                  }
                  fullText += event.value;
                  sseWrite(res, {
                      id: responseId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini',
                      choices: [{
                          index: 0,
                          delta: { content: event.value },
                          finish_reason: null
                      }]
                  });
                  break;
              }
              
              case 'thought': {
                  // 思考プロセスをテキストとしてストリーミング（OpenAI互換では思考専用フィールドがないため content として送出）
                  if (!event.value) break;
                  const thoughtText = event.value.subject
                      ? `\n💭 **${event.value.subject}**\n${event.value.description || ''}\n`
                      : `\n💭 ${event.value.description || ''}\n`;
                  sseWrite(res, {
                      id: responseId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini',
                      choices: [{
                          index: 0,
                          delta: { content: thoughtText },
                          finish_reason: null
                      }]
                  });
                  break;
              }
              
              case 'tool_call_request': {
                  // OpenAI 互換: delta.tool_calls 配列で送出
                  const tc = event.value;
                  const currentIndex = toolCallIndex++;
                  sseWrite(res, {
                      id: responseId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini',
                      choices: [{
                          index: 0,
                          delta: {
                              tool_calls: [{
                                  index: currentIndex,
                                  id: tc.callId,
                                  type: 'function',
                                  function: {
                                      name: tc.name,
                                      arguments: JSON.stringify(tc.args || {})
                                  }
                              }]
                          },
                          finish_reason: null
                      }]
                  });
                  break;
              }
              
              case 'finished': {
                  // finish_reason を送出（ただしプロセス終了時の close イベントでも送るため、二重送信に注意）
                  // ここでは toolCallIndex をリセット
                  toolCallIndex = 0;
                  break;
              }
              
              case 'error': {
                  const errMsg = event.value?.error?.message || JSON.stringify(event.value);
                  sseWrite(res, {
                      id: responseId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini',
                      choices: [{
                          index: 0,
                          delta: { content: `\n⚠️ [Gemini Error] ${errMsg}` },
                          finish_reason: null
                      }]
                  });
                  break;
              }
              
              case 'loop_detected': {
                  sseWrite(res, {
                      id: responseId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini',
                      choices: [{
                          index: 0,
                          delta: { content: '\n⚠️ Loop detected, stopping execution.' },
                          finish_reason: null
                      }]
                  });
                  break;
              }
              
              case 'agent_execution_stopped': {
                  const reason = event.value?.systemMessage || event.value?.reason || 'stopped';
                  sseWrite(res, {
                      id: responseId,
                      object: 'chat.completion.chunk',
                      created: Math.floor(Date.now() / 1000),
                      model: 'gemini',
                      choices: [{
                          index: 0,
                          delta: { content: `\n🛑 Agent stopped: ${reason}` },
                          finish_reason: null
                      }]
                  });
                  break;
              }
              
              // model_info, retry, citation, chat_compressed, context_window_will_overflow,
              // invalid_stream, max_session_turns, user_cancelled, agent_execution_blocked,
              // tool_call_confirmation, tool_call_response は IPC 経由で受信可能だが
              // SSE に何を出すかは個別に判断。ここでは無視（ログのみ）。
              default:
                  log(`[ipc] Unhandled gemini_event type: ${event.type}`);
                  break;
          }
      });
      ```
  - **検証方法**:
    - [ ] `curl` で `/v1/chat/completions` にテスト送信し、`delta.content` と `delta.tool_calls` が正しく含まれる SSE レスポンスが返ることを確認。
    - [ ] ツール呼び出しを含むプロンプト（例: 「hello worldを書いてファイルに保存して」）で `tool_calls` フィールドが正しく出力されることを確認。

- [ ] Task 3: `src/streaming.js` — 旧 stdout パースロジックの無効化
  - **目的**: `runner.stdout.on('data', ...)` の既存ロジック（388行目〜553行目）を無効化し、IPC に一本化する。
  - **実装詳細**:
    - [ ] `runner.stdout.on('data', ...)` ブロック（388行目〜553行目）の処理内容を、デバッグログのみに簡素化する:
      ```javascript
      // --- SSoT 5.0: stdout は IPC に移行したためログ出力のみ ---
      runner.stdout.on('data', chunk => {
          const raw = chunk.toString('utf-8');
          log(`[stdout-passthrough] ${raw.substring(0, 200)}`);
      });
      ```
    - [ ] **ただし**、`runner.on('close', ...)` ハンドラ（560行目〜578行目）はそのまま残す。プロセスの終了検知と `finish_reason: 'stop'` + `[DONE]` の送出はこちらが担うため。
  - **検証方法**:
    - [ ] 実行中のログに `[stdout-passthrough]` が表示され、かつ SSE 出力は IPC ハンドラ側からのみ生成されていることを確認。

- [ ] Task 4: `src/streaming.js` — ZWC 関連コードの完全削除
  - **目的**: ZWC エンコード/デコード、プレーンテキストポインタスキャン、ローカルコンテキストファイル保存/リハイドレーションの全コードを削除する。
  - **実装詳細**:
    - [ ] **削除対象1**: ZWC 定数＋関数（11行目〜35行目）: `ZWC_START`, `ZWC_END`, `encodeZwc()`, `decodeZwc()` を完全に削除。
    - [ ] **削除対象2**: `runGeminiStreaming` 関数内の履歴復元ループ（147行目〜340行目付近）内の ZWC デコード処理（165行目〜264行目: `ZWC_START` スキャン、`decodeZwc` 呼び出し、壊れた ZWC の補修）を完全に削除。
    - [ ] **削除対象3**: 同ループ内のプレーンテキストポインタスキャン（265行目〜311行目: `[id:xxx]`, `[res:xxx]` パターン、`logs/contexts/` からのリハイドレーション）を完全に削除。
    - [ ] **削除対象4**: 同ループ内のゴミテキスト除去（315行目〜320行目: ZWC残骸除去、`⚙️ Using tool` / `✅ Tool finished` の正規表現削除）を完全に削除。
    - [ ] **代替処理**: 上記すべてを削除した後、`assistant` メッセージの処理は `converter.js` の `convertToGeminiMessages` 関数に委任する。`streaming.js` の履歴復元ループの `else if (msg.role === 'assistant')` ブロックは以下のようにシンプルにする:
      ```javascript
      } else if (msg.role === 'assistant') {
          // SSoT 5.0: OpenAI互換の tool_calls は converter.js で処理される
          // テキストのみを抽出して gemini メッセージに変換
          geminiMessages.push({
              type: 'gemini',
              content: [{ text: text }],
              ...(msg.tool_calls && msg.tool_calls.length > 0 ? {
                  toolCalls: msg.tool_calls.map(tc => {
                      let parsedArgs = {};
                      try {
                          parsedArgs = typeof tc.function?.arguments === 'string'
                              ? JSON.parse(tc.function.arguments)
                              : (tc.function?.arguments || {});
                      } catch (e) { parsedArgs = tc.function?.arguments || {}; }
                      return {
                          id: tc.id,
                          name: tc.function?.name,
                          args: parsedArgs,
                          status: 'success',
                          timestamp: new Date().toISOString(),
                      };
                  })
              } : {})
          });
      } else if (msg.role === 'tool') {
          // SSoT 5.0: tool ロールのメッセージからツール結果を復元
          const resultToolCallId = msg.tool_call_id || '';
          const result = typeof msg.content === 'string' ? msg.content : '';
          const lastGemini = [...geminiMessages].reverse().find(m => m.type === 'gemini');
          if (lastGemini && lastGemini.toolCalls) {
              const matchingCall = lastGemini.toolCalls.find(tc => tc.id === resultToolCallId);
              if (matchingCall) {
                  matchingCall.result = [{
                      functionResponse: {
                          name: matchingCall.name,
                          response: { output: result }
                      }
                  }];
              }
          }
      }
      ```
    - [ ] **削除対象5**: 旧 stdout パース内の `tool_use` ケース（459行目〜489行目: `logs/contexts/` への保存＋ZWCポインタSSE出力）と `tool_result` ケース（492行目〜536行目）を完全削除（Task 3 で stdout パース自体を無効化するため、実質的に不要になる）。
  - **検証方法**:
    - [ ] `grep -r 'ZWC\|encodeZwc\|decodeZwc\|\\u200B\|\\u200C\|\\u200D\|ZWC_START\|ZWC_END' src/streaming.js` の結果が空であること。
    - [ ] `grep -r 'logs/contexts' src/streaming.js` の結果が空であること。

- [ ] Task 5: `src/streaming.js` — `skipZwcProcessing` パラメータの廃止
  - **目的**: ZWC が完全に廃止されたため、`runGeminiStreaming` の `skipZwcProcessing` パラメータを削除する。
  - **実装詳細**:
    - [ ] `runGeminiStreaming` 関数のパラメータリスト（121行目）から `skipZwcProcessing = false` を削除する。
    - [ ] `if (!skipZwcProcessing && messages && messages.length > 0)` の条件（147行目）を `if (messages && messages.length > 0)` に変更する。
    - [ ] `server.js` の `sendFakeSummaryResponse` 付近の `skipZwcProcessing: true` 引数（339行目付近）を削除する。
  - **検証方法**:
    - [ ] `grep -r 'skipZwcProcessing' src/` の結果が空であること。

- [ ] Task 6: 統合検証
  - **目的**: 全変更が正しく動作することを確認する。
  - **実装詳細**: コード変更なし。テストのみ。
  - **検証方法**:
    - [ ] `docker compose build && docker compose up` でコンテナを再起動。
    - [ ] OpenClaw WebUI から「hello」を送信し、テキスト応答がストリーミングされることを確認。
    - [ ] ツール呼び出しを含むプロンプト（例: 「このディレクトリの構成を教えて」）を送信し、SSE レスポンスに `delta.tool_calls` が入っていることを確認。
    - [ ] 2ターン目以降の会話で、`req.body.messages` に `tool_calls` 付き `assistant` メッセージと `role: 'tool'` メッセージが含まれていることを `logs/adapter_last_req.json` で確認。
    - [ ] 思考プロセス（💭）がUI上に表示されることを確認。
    - [ ] ZWC 文字列がレスポンスに一切含まれないことを確認。

> [!IMPORTANT]
> **エスカレーション・ルール**: 実装中に計画の矛盾、未知の副作用、または「この通りに進めると問題が出る」と判断した場合は、直ちに作業を中断して報告してください。独断での計画変更（ad-hoc fix）は禁止します。
