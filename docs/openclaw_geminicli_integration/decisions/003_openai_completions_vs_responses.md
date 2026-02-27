# ADR-003: OpenAI Completions API vs Responses APIの選定

- **日付**: 2026-02-21
- **ステータス**: 採用（Completions形式へ回帰）
- **関連**: なし

## 背景（Context）

OpenClawは `@mariozechner/pi-ai` ライブラリを利用して各プロバイダと通信している。
当初、`openclaw.json` で指定するGemini AdapterのAPIとして、新仕様である `openai-responses`形式を指定していた。しかし、この形式ではAdapterの `adapter.js` 側でリクエストをパースする際、ツールコール等の構造が意図しない形（生配列など）で飛んできてしまい、エラーが多発（`Cannot read properties of undefined (reading '0')`）した。

## 検討した選択肢（Options）

### 案A: `openai-responses` 指定を維持し、Adapter側で無理やりJSONをパース・再構築
- **利点**: OpenClaw（pi-ai）の最新の仕様に合わせて通信できる。
- **欠点**: 送られてくる `messages` や `tool_calls` のJSON構造がドキュメントされておらず、場当たり的なパッチ修正になりやすい。また、Gemini CLIのレスポンスストリームをResponses形式（`response.output_text.delta`等）で正確に模擬する必要があり、手書きのSSEコードが非常に煩雑になる。

### 案B: 枯れた仕様である `openai-completions` APIに切り替える（本案）
- **概要**: `openclaw.json` のプロバイダ設定を `openai-completions` に戻し、Adapter側が受信するJSONや、クライアント（OpenClaw）へ返すSSEのチャンクを標準的な `chat.completion.chunk` 形式（内包オブジェクトとして `choices` を持つ昔ながらの形）に統一する。
- **利点**: APIのスキーマ仕様がWeb上に豊富にあり挙動が安定している。また、各種AIツールがデフォルトで想定しているフォーマットであるため、通信上の不整合（Undefinedエラー）が出にくい。
- **欠点**: pi-aiが内部で一度変換をかけるため、極一部の最新の機能が使えなくなる可能性がある。

## 決定（Decision）

**案B（`openai-completions` API形式の採用）を決定する。**

## 結果（Consequences）

- `openclaw.json` の対象行を修正した。
- `adapter.js` の `runGeminiStreaming` メソッド内で吐き出すSSEテキストの構造をすべて `chat.completion.chunk` 形式に修正。これにより、接続拒否とクラッシュが完全に解消し、正常なテキストストリーミングとツールコールの授受が可能なアーキテクチャ基盤が確立した。

## 参考資料
- 該当チャットログ: `2109bafb-6346-4586-abf6-83638a72bc8c` (ストリーミング形式不一致・エラー解消フェーズ)
