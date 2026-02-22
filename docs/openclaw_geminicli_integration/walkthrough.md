# Walkthrough: adapter.js → OpenAI互換HTTPサーバー化

## 変更概要
`adapter.js` をstdin/stdout CLIツールからHTTPサーバー（ポート3972）に完全書き直し。OpenClawの `runEmbeddedPiAgent` 経路（履歴剪定済み）から直接呼び出せるようにした。

## アーキテクチャ

```
OpenClaw (runEmbeddedPiAgent)
  ↓ POST /v1/chat/completions (messages配列＝剪定済み！)
adapter.js HTTPサーバー (localhost:3972)
  ↓ 初回: gemini -p <prompt> → session_idキャプチャ → 保存
  ↓ 2回目〜: 既存ファイルのmessages上書き → gemini --resume <UUID>
Gemini CLI → SSE → OpenClaw
```

## コアメカニズム: セッション履歴上書き

1. **初回呼び出し**: `--resume`なしでGemini CLI実行。`init`/`result`イベントからsession_id(UUID)をキャプチャし、`~/.openclaw/gemini-session-map.json`に保存
2. **2回目以降**: マッピングからUUIDを取得→Gemini CLIが作ったセッションファイル(`session-*.json`)を検索→**messages配列をOpenClawの剪定済み履歴で上書き**→`--resume <UUID>`で実行

これにより、OpenClawの`limitHistoryTurns`や`sanitizeSessionHistory`で処理された**クリーンな履歴**がGemini CLI側に常に反映される。

## テスト結果

| テスト | 結果 |
|--------|------|
| `GET /health` | ✅ `{"status":"ok"}` |
| `GET /v1/models` | ✅ モデル一覧返却 |
| Step 1: 初回（resumeなし） | ✅ 応答あり、session_idキャプチャ成功 |
| Step 2: 2回目（resume+上書き） | ✅ 前の文脈を参照した正しい回答 |

## コミット
- `d25183bd` — 旧adapter.jsの状態保存
- `48124108` — HTTPサーバー化 + セッション履歴上書き
