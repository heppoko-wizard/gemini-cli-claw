# ツール実行履歴の双方向変換 — 調査結果と実装計画

## 1. 両サイドのJSON構造（実データからの確定情報）

### A. OpenClaw 側のツール呼び出し構造

**ソース**: `pi-embedded-helpers-CRCHcTJP.js` の `extractToolCallsFromAssistant()`, `extractToolCallNames()`, `countToolResults()`

#### アシスタントのツール呼び出し (`role: "assistant"`)
```json
{
  "role": "assistant",
  "content": [
    { "type": "output_text", "text": "検索してみますね。" },
    {
      "type": "tool_use",
      "id": "call_abc123",
      "name": "google_web_search",
      "input": { "query": "宇都宮 イベント 2026年2月22日" }
    }
  ]
}
```
- `TOOL_CALL_TYPES = ["tool_use", "toolcall", "tool_call"]` のいずれかの `type` を持つ
- `id` (string, 必須) と `name` (string) が必要
- `input` にツールへの引数が入る

#### ツール結果 (`role: "tool"` or `role: "toolResult"`)
```json
{
  "role": "tool",
  "content": [
    {
      "type": "tool_result",
      "tool_use_id": "call_abc123",
      "content": "Search results for ..."
    }
  ]
}
```
- `TOOL_RESULT_TYPES = ["tool_result", "tool_result_error"]`
- `toolCallId` または `toolUseId` でツール呼び出しと紐付け（`extractToolResultId()` 参照）
- `is_error: true` でエラー判定

---

### B. Gemini CLI 側のツール呼び出し構造

**ソース**: 実際のセッションファイル `session-*.json` から抽出

#### Geminiのツール呼び出し（`type: "gemini"` メッセージ内の `toolCalls` 配列）
```json
{
  "type": "gemini",
  "content": "",
  "toolCalls": [
    {
      "id": "google_web_search_1771683377321_0",
      "name": "google_web_search",
      "args": { "query": "宇都宮 イベント 2026年2月22日" },
      "result": [
        {
          "functionResponse": {
            "name": "google_web_search",
            "response": { "output": "Search results for ..." }
          }
        }
      ],
      "status": "success",
      "timestamp": "2026-02-21T14:37:13.082Z"
    }
  ]
}
```

---

## 2. 変換マッピング

| 項目 | OpenClaw | Gemini CLI |
|------|----------|------------|
| ツール呼び出し | `content[].type = "tool_use"` | `toolCalls[].name` |
| ツールID | `content[].id` | `toolCalls[].id` |
| 引数 | `content[].input` | `toolCalls[].args` |
| 結果 | 別メッセージ `role: "tool"` | `toolCalls[].result[].functionResponse.response.output` |
| エラー | `type: "tool_result_error"` | `status: "error"` |

---

## 3. 実装計画

### ステップ1: SSEでツール呼び出しと結果をOpenClawに通知
`adapter.js` の `runGeminiStreaming` で、`tool_use` と `tool_result` イベントを受け取り、OpenClawが理解できるSSEに変換して送信する。

**Gemini CLI → OpenClaw (SSE)**:
- `tool_use` イベント受信時: 新しい `output_item` (type=function_call) をSSEで送信
- `tool_result` イベント受信時: 新しい `output_item` (type=function_call_output) をSSEで送信

### ステップ2: OpenClawからの履歴変換を改善
`convertToGeminiMessages` 関数で、OpenClawの `tool_use` パーツと `role: "tool"` メッセージを、Gemini CLI の `toolCalls` 配列に正しく変換する。

**OpenClaw → Gemini CLI (セッション上書き)**:
- `content[].type == "tool_use"` → `toolCalls[{id, name, args}]`
- `role: "tool"` メッセージ → `toolCalls[].result[{functionResponse}]`

### ステップ3: テスト
1. ツール実行を伴う会話を行う（例: google検索）
2. 2ターン目のリクエストで `tool_use` と `tool` の履歴が正しく含まれているか確認
3. Geminiセッションファイルにも正しく `toolCalls` が復元されているか確認
