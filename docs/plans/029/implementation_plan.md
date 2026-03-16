# SSoT 5.0: IPC全イベント傍受＋ZWC完全廃止アーキテクチャ

## Purpose
Gemini CLIコアが送出する全イベント（`GeminiEventType`）を `runner.mjs` 内で傍受し、IPC（`process.send`）で親プロセス（`streaming.js`）に直接送信する。これにより、以下の負債を一掃する。

1. **標準出力のJSON Linesパース廃止**: `runner.stdout.on('data')` による不安定な文字列パースを完全に除去。
2. **ZWC（ゼロ幅文字ステガノグラフィ）完全廃止**: テキスト中にツール情報を隠蔽する仕組み（SSoT 3.1〜4.2）が不要になる。
3. **OpenAI互換 `tool_calls` の正規利用**: ツール実行情報を OpenAI 互換の `delta.tool_calls` / `role: "tool"` フォーマットで正規に返却し、OpenClaw の履歴管理に完全に委ねる。

## データフロー（Before → After）

### Before (SSoT 4.2)
```
Gemini API → geminiChat.js → turn.js → client.js → nonInteractiveCli.js
  → stdout (JSON Lines: stream-json) → streaming.js (文字列パース)
    → SSE delta.content にテキスト＋ZWCポインタを混在させて送出
      → OpenClaw が保存 → 次ターンで ZWC を再デコードして復元
```

### After (SSoT 5.0)
```
Gemini API → geminiChat.js → turn.js → client.js
  → [runner.mjs 内で sendMessageStream をラップ]
    → 全イベントを process.send(IPC) で親プロセスへ直接送信
      → streaming.js が IPC メッセージを受信
        → Content → SSE delta.content
        → Thought → SSE delta.content（思考テキスト）
        → ToolCallRequest → SSE delta.tool_calls（OpenAI互換）
        → ToolCallResponse → SSE role:"tool" メッセージ（非ストリーミング）
        → Finished → SSE finish_reason:"stop"
        → Error → SSE delta.content（エラー表示）
  → nonInteractiveCli.js はそのまま動作（パススルー）するが stdout は事実上無視
```

## Major Changes

### レイヤー1: Runner 側（イベント傍受＋IPC送信）
`runner.mjs` において、`geminiClient.sendMessageStream` をプロキシ（ラップ）する。ラッパーは返される非同期ジェネレータを`for await`で消費し、全イベントを `process.send()` でIPCに流しつつ、元のジェネレータに `yield` でパススルーする。これにより `nonInteractiveCli.js` の機能（ツール実行スケジューラ等）は一切壊れない。

### レイヤー2: Streaming 側（IPC受信＋SSE出力）
`streaming.js` において、`runner.stdout.on('data')` による JSON Lines パースを完全に廃止し、`runner.on('message')` による IPC メッセージ受信に切り替える。受信したイベントを OpenAI 互換の SSE チャンクに変換して `res` に書き込む。

### レイヤー3: ZWC 関連コードの完全削除
`streaming.js` から ZWC エンコード/デコード関数、プレーンテキストポインタのスキャン、`logs/contexts/` へのローカルファイル保存・リハイドレーションロジックをすべて削除する。

### レイヤー4: 受信側（OpenAI互換 tool_calls の復元強化）
`converter.js` は既に `tool_calls` 付きメッセージと `role: 'tool'` メッセージをサポートしている（行71-89, 96-112）。大きな変更は不要だが、`streaming.js` の履歴復元ロジック（`messages` ループ内の ZWC デコード処理）を `converter.js` への委任に置き換える。

## Target Files

- [MODIFY] `/home/heppo/DEV/openclaw-gemini-cli-adapter/src/runner.mjs`
- [MODIFY] `/home/heppo/DEV/openclaw-gemini-cli-adapter/src/streaming.js`
- [MODIFY] `/home/heppo/DEV/openclaw-gemini-cli-adapter/src/converter.js`（軽微: 必要に応じて調整）

## Verification Plan

### 自動検証
- `docker compose build && docker compose up` でコンテナを起動し、curl で `/v1/chat/completions` にリクエストを送信。SSE レスポンスに以下が含まれることを確認:
  1. `delta.content` にテキストが正しく流れること
  2. ツール呼び出し時に `delta.tool_calls` が正しく含まれること
  3. ZWC 文字列（`\u200B`, `\u200C`, `\u200D`）がレスポンスに一切含まれないこと

### 手動検証
- OpenClaw WebUI からプロンプトを送信し、ツール呼び出しを含む会話が正常に動作すること
- 2ターン目以降の会話で、履歴にツール実行結果が正しく含まれていること
- 思考プロセス（Thought）がストリーミング中にUIに表示されること
