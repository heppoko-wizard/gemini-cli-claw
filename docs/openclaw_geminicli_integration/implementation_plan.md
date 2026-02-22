# 実装計画: Gemini CLIをStreamFnとして組み込む

## 背景と目的
現在のアーキテクチャ（`runCliAgent`経由）の根本問題：OpenClaw側の履歴剪定（`limitHistoryTurns`、`sanitizeSessionHistory`）が**Gemini CLIには一切届かない**。

解決策：Ollamaがやっているのとまったくおなじパターンを踏み、**Gemini CLIを`agent.streamFn`として実装**する。これにより`runEmbeddedPiAgent`の全前処理パイプラインが無償で使える。

> [!IMPORTANT]
> これは `adapter.js` の廃止ではない。`adapter.js` は「OpenClawのstdinをGemini CLIのpromptに変換する橋」だったが、今後は**「剪定済みのmessages配列をGemini CLIに渡してその結果をstreamFnのインターフェースで返す橋」**に役割が変わる。

## 変更内容

### openclaw本体への設定変更が必要

#### `openclaw.json` のバックエンド登録を変更
```diff
- "provider": "cli",
- "command": "node",
- "args": ["adapter.js"],
+ "provider": "gemini-cli",
+ "api": "gemini-cli",
```
Ollamaと同様に、`api` フィールドで独自のstreamFnを呼び出すよう登録する。

---

### gemini-cli-claw 側の変更

#### [MODIFY] [adapter.js](file:///home/heppo/ドキュメント/DEV/openclaw/gemini-cli-claw/adapter.js) → **廃止または役割変更**

現在の `adapter.js` が担っていた「Gemini CLIをspawn」する処理は、新しい `gemini-cli-stream.js`（StreamFn）に移管する。

#### [NEW] `gemini-cli-stream.js`
`createOllamaStreamFn` と同じシグネチャの `createGeminiCliStreamFn` を実装する。

```javascript
// StreamFn シグネチャ: (model, context, options) => AssistantMessageEventStream
export function createGeminiCliStreamFn(workspaceDir) {
  return (model, context, options) => {
    const stream = createAssistantMessageEventStream();
    
    const run = async () => {
      // 1. context.messages（剪定済み！）をGemini CLI形式に変換
      const historyJson = convertMessagesToGeminiHistory(context.messages);
      
      // 2. 変換した履歴からGemini CLI用の一時session-xxx.jsonを書き出す
      const sessionFile = await writeGeminiSessionFile(historyJson);
      
      // 3. Gemini CLIを --resume <sessionFile> で spawn（最新の1メッセージのみをプロンプトとして渡す）
      const lastUserMessage = extractLastUserMessage(context.messages);
      const geminiProcess = spawn('gemini', ['-p', lastUserMessage, '--resume', sessionFile, '-o', 'stream-json']);
      
      // 4. JSONL出力をパースしてAssistantMessageEventStreamに流し込む
      for await (const event of parseGeminiJsonlStream(geminiProcess.stdout)) {
        if (event.type === 'message' && event.delta) {
          stream.push({ type: 'text', text: event.content });
        }
        if (event.type === 'result') {
          stream.push({ type: 'done', reason: 'stop', message: buildAssistantMessage(event) });
        }
      }
    };
    
    queueMicrotask(() => void run());
    return stream;
  };
}
```

#### [NEW] OpenClawプラグイン設定 or `openclawrc` のパッチ
OpenClawの `attempt.ts` を**変更せず**に `gemini-cli` という `api` 識別子を認識させるには、現実的には以下の2案がある：

**案A（OpenClaw本体を微修正）**: `attempt.ts` に `else if (params.model.api === "gemini-cli")` 分岐を追加。
```typescript
} else if (params.model.api === "gemini-cli") {
    const { createGeminiCliStreamFn } = await import("../../gemini-cli-stream.js");
    activeSession.agent.streamFn = createGeminiCliStreamFn(resolvedWorkspace);
}
```

**案B（MCPツール化せず、プロキシAPIサーバーとして動かす）**: `adapter.js` をHTTPサーバー（OpenAI互換エンドポイント）として改造し、Gemini CLIを裏で呼び出す。この場合は `openclaw.json` に `baseUrl: "http://localhost:3999"` で登録できる。

> [!NOTE]
> **案Bが最もOpenClaw本体に無侵襲**。`adapter.js` を `/v1/chat/completions` エンドポイントを持つサーバーとして実装し、OpenAI互換プロトコルで受け取ったmessages配列をGemini CLIに転送するだけで済む。MCPサーバー（`mcp-server.mjs`）はそのまま流用できる。

## 検証計画
1. 通常会話: 剪定済み履歴が正しくGeminiに渡り、前の文脈を参照した返答が来ること
2. Cronタスク: `promptMode=minimal`が適用され、Geminiに渡る履歴が短く保たれること
3. MCPツール: `mcp-server.mjs`がそのまま機能すること
