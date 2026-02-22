# ADR-004: ツール履歴の非同期注入 (Tool History Injection)

- **日付**: 2026-02-21
- **ステータス**: 採用
- **関連**: ADR-002

## 背景（Context）

Gemini CLIと連携する中で、最大の難関だったのが「MCPによるツールの使用履歴をどうOpenClaw側に認知させるか」である。
OpenClaw Gatewayは通常、LLMとの通信結果の全体（Function Callを含む）を受け取り、それを独自の `sessions` フォルダ以下に `.jsonl` 形式でスナップショット保存する。
しかしプロキシ方式（SSEストリーム送信）では、OpenClawは「流れてきたテキスト」しか受信できない。そのため、GeminiCLIがバックグラウンドでどんなツールを使用し、どんな結果を得たかがOpenClaw側には伝わらず、会話が2ターン目に進んだ瞬間に「さっき調べた情報」をすべて忘れてしまうという現象が起きた。

## 検討した選択肢（Options）

### 案A: OpenClaw側でSSEデータをパースしツール履歴を取り込む（ボツ）
- **概要**: OpenClaw本体（Node.js）のストリーム処理周りを改造し、ツール使用時のメタデータを出力させる。
- **欠点**: ADR-001で「OpenClaw本体は無改造」という方針を定めたため却下。

### 案B: Adapter側でOpenClawのセッションJSONLファイルを直接改ざんする（本案）
- **概要**: 
  1. AdapterはGeminiCLIが返すストリームイベントの中に `tool_use`、`tool_result` を見つけると、それをメモリ (`collectedTools` 配列) に退避する。
  2. チャットの完了（`response.completed` の送信後）から約1秒後（OpenClawがレスポンスの受信とファイル保存を終えるのを待つタイムアウト等を利用）に、非同期処理を走らせる。
  3. `~/.openclaw/agents/main/sessions/<session_id>.jsonl` を直接 `fs` で開き、末尾の `assistant` メッセージブロック（`{"role":"assistant", ...}`）を探す。
  4. そのブロックのJSONの中に、退避しておいたツールコールの構造データ（`toolCalls: [...]` と `toolResults: [...]`）を正規表現を用いて無理やり文字列置換で挿入（Inject）し、保存・上書きする。
- **利点**: OpenClaw側での追加実装が不要になる。次ターンの会話時、OpenClawは「自分の保存した履歴」としてツール情報をパースし、再びAdapterへと投げてくれる。
- **欠点**: OpenClawの保存処理（非同期ファイルのクローズ）と競合する可能性や、JSONLの構造が変わった際に正規表現の置換が盛大に失敗しセッション全体が壊れるリスクが伴う。

## 決定（Decision）

**案B（セッションJSONLの非同期注入）を決定し、採用する。**
非常に泥臭く「ハック」に近い手段だが、現在のOpenClawの仕様と完全互換を保つためにはこれ以外にツールコール履歴を復元する手段がないと判断した。

## 結果（Consequences）

- `adapter.js` に `injectToolHistoryIntoOpenClaw` 関数を実装し、これによってツール使用が次の会話に連鎖可能となった。
- ログには `[inject] Successfully injected X toolCall(s)` と出力され、デバッグの指標となっている。

## 参考資料
- 該当チャットログ: `2109bafb-6346-4586-abf6-83638a72bc8c`
