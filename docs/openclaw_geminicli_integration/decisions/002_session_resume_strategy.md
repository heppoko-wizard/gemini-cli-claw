# ADR-002: コンテキストとツール履歴の同期戦略 (Session Resume Strategy)

- **日付**: 2026-02-21
- **ステータス**: 採用
- **関連**: なし

## 背景（Context）

Gemini CLIとOpenClawを接続した初期段階において、Gemini側の「記憶喪失」問題が発生した。
単純に `gemini --prompt "こんにちは"` と毎回単発で呼び出すと、内部で保持している過去の文脈（何について話しているか、結果はどうだったか）が毎回リセットされてしまう現象である。
Gemini CLIは過去のセッションを引き継ぐための `--resume <session_id>` オプションを備えているが、OpenClaw側の会話IDとどうマッピングし、どのように同期するかが課題だった。

## 検討した選択肢（Options）

### 案A: OpenClawから送られてくる全メッセージ配列を毎回 `--prompt` で渡す
- **利点**: 実装がもっとも単純。
- **欠点**: Gemini CLIには、構造化された会話履歴（JSONオブジェクトでの `role`, `content`, `toolCalls` など）を「テキストの引数」としてそのまま注入する標準的な方法が存在しない。（すべてAssistantの発言もUserの発言として解釈されてしまう）。

### 案B: Gemini内部の `.gemini/tmp/chats/` JSONを直接上書きする（本案）
- **概要**: 
  1. OpenClawの各セッションキーに対し、初回通信時にGeminiCLIに発行させた `session_id` を `openclaw-session-map.json` に保存・マッピングする。
  2. 2回目以降の通信時、Adapterが通信傍受した OpenClaw 由来の `messages` 配列から最新のユーザー入力以外（過去の履歴とシステムプロンプト）を抽出し、GeminiCLIが裏で持っている `~/.gemini/tmp/chats/<session_id>.json` の `history` 配列に強制上書き（同期）する。
  3. その上で `--resume <session_id>` 付きで呼び出す。
- **利点**: Gemini CLI側の内部状態を「正しい過去」に上書きできるため、完全なコンテキストを持った状態でストリーム推論を開始できる。
- **欠点**: Gemini CLIの非公開の内部ファイル構造（`tmp/chats/` 以下のJSON）に強く依存しており、CLIのバージョンアップで構造が変わると即座に破綻する。

## 決定（Decision）

**案B（内部Session JSONの強制同期アプローチ）を採用する。**
コンテキストとツールコールの連携を維持するためには、現在のところこの強引な手法以外に解決策が存在しないため。

## 結果（Consequences）

- `adapter.js` 内にファイルの走査とJSONの上書きロジック（`fs.writeFileSync` を用いた同期処理）が実装された。
- このアプローチにより、OpenClaw側でPruning（履歴の刈り込み）が行われた際も、それがGemini側に正しく反映されるようになった（Gemini側の肥大化も防げる）。
- だが、この仕組みだけでは「そのターンで行われたツールコールの結果」をOpenClaw側にどう戻すかの問題が解決しなかった。（→ `ADR-004` へ続く）。

## 参考資料
- 該当チャットログ: `2109bafb-6346-4586-abf6-83638a72bc8c` (セッション同期・履歴注入フェーズ)
