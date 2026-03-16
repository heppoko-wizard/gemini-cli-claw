# 調査レポート：Gemini CLI stream-json 出力における思考プロセス（Thoughts）の構造と欠落の原因

## 1. 調査目的
Gemini CLIの生履歴データにおいて、思考プロセス（Thoughts）、ツール実行、ユーザープロンプト、最終回答がどのように分離・格納されているか、および `--output-format stream-json` による出力でなぜ思考プロセスが欠落するのか、その構造的要因を調査する。

## 2. 実績としての生履歴ファイルの構造確認
`docs/samples/` 配下のセッションログ（JSON形式）を調査した結果、Gemini CLIは内部状態を明確に分離・構造化して保持していることを確認した。

- `role: "user"` の `content` にユーザープロンプトが格納。
- `role: "model"` の `parts` 配列内に、以下の要素が明確に混ざらず分離されている。
  - `thought`: 思考プロセス（ブール値のフラグとともにテキストが格納）
  - `functionCall`: ツール呼び出し要求
  - `text`: 一般的な回答テキスト
- 結論として、生の履歴において思考と回答がごちゃ混ぜになっていることはなく、完全な分離構造を持つ。

## 3. stream-json で思考（Thoughts）が欠落する「真の原因」
コードのコールスタックを逆探知した結果、ストリームの処理は以下の3レイヤーで行われていることが判明した。

1. **API連携層 (`geminiChat.js`)**: `processStreamResponse` 内で思考プロセスを記録（`ChatRecordingService`）しつつ、ここでは単純なチャンクへと変換している。
2. **コアロジック層 (`turn.js` / `client.js`)**: ストリームからチャンクをイベント化して抽出し、**`GeminiEventType.Thought` イベントとして正しく上位レイヤーへと `yield`（送出）している**。つまり、コア部分では思考データは破棄されていない。
3. **CLI アプリケーション層 (`nonInteractiveCli.js`)**: コマンドラインフロントであるここが `geminiClient.sendMessageStream` を呼び出し、`for await (const event of responseStream)` のループで出力を処理する。**しかし、このループ内の `if` / `else if` チェインにおいて `GeminiEventType.Thought` を処理する分岐が意図的に実装されておらず、事実上データが握りつぶされ「無視」されている。**

### 結論
`stream-json` オプションで思考が欠落するのは、APIやCoreが思考データを送っていないからではなく、CLIの終端フォーマッタ部分（`nonInteractiveCli.js`）が `Thought` イベントの処理を未実装として無視しているからである。

## 4. [追記] 全イベント傍受 ＋ IPC 通信アプローチの妥当性評価
ユーザーからの提案である「`sendMessageStream` をラップして Thought だけでなく全イベントを傍受し、そこだけで OpenClaw に渡すメッセージを加工する」アプローチについて妥当性を評価した結果、**極めて妥当であり、現在のアーキテクチャの根本的な負債を解消するベストプラクティス（特効薬）である**と判断した。

### 評価の根拠（メリット）
1. **脱・標準出力パース（不安定性の排除）**
   現在、Adapter (`streaming.js`) は Runner プロセスが出力する「JSON Lines（文字列）」を `stdout.on('data')` で監視してパースしている。しかし、チャンクが途切れた際の結合や、Gemini CLI の余計な警告ログ（[WARNING]など）が混入して `JSON.parse` が壊れる問題を抱えている。
   `sendMessageStream` をラップし、傍受した生の JS オブジェクト（イベント）を `process.send({ type: 'gemini_event', event })` のように **IPC通信** で直接 OpenClaw Adapter へ送れば、文字列表現を解釈するオーバーヘッドとエラーリスクが完全に消滅する。

2. **Thought等を含む完全なデータロスレス復元**
   `sendMessageStream` のジェネレータが吐き出す `GeminiEventType.Thought`, `Content`, `ToolCallRequest` といった生のオブジェクト（一次情報）を直接キャッチできるため、データ加工が極めて容易になり、Thoughtの欠落も100%防げる。

3. **副作用ゼロでの共存設計（パススルー）**
   ラップした関数（Proxy）側でイベントを IPC 送信した後、そのまま元の利用元（`nonInteractiveCli.js`）に対して `yield event` と横流し（パススルー）することで、既存の「ツール実行スケジュール」や「エラーハンドリング」等のCLIコアの挙動は一切壊さずに維持できる。

### 懸念と対策
- **懸念**: `nonInteractiveCli.js` が標準出力に大量に JSON を吐き出し続ける無駄が発生する。
- **対策**: `streaming.js` 側で `runner.stdout.on('data')` に流れるデータを無視する（ログに出すだけにする）か、CLI 起動時のログフォーマットを `text` などの別形式にしてしまうことで解決する。機能的な競合は発生しない。

### 結論
『全イベントの傍受 ＋ IPC 通信』は、実装を劇的に安定化しシンプルにする、非常に優れたアーキテクチャ改修案である。

---

## 5. [追記] SSoT 5.0 実装の経緯と不具合記録

### 5-1. 計画フェーズ（docs/plans/029/）

ZWC（ゼロ幅文字）ポインタ方式には以下の限界があった。

1. **ツール実行コンテキストのZWCエンコード**: 巨大なツール引数・結果をZWCでテキストに埋め込みOpenClawの会話履歴に記録していたが、
   - ZWCデータの視認性ゼロで手動デバッグ不可
   - テキストパースの脆弱性（JSON.parseの失敗リスク）
   - 1ターンのテキストが膨大になりHTTPレイテンシが増大
2. **上り方向（Adapter→OpenClaw）の問題**: ツール実行ターンの履歴をopenclaw側でもテキスト内ZWCから取り出す必要があった

これらを解消するため、SSoT 5.0 として以下の設計を立案：
- **下り方向（IPC via `process.send`）**: `sendMessageStream` をラップし、全 Gemini CLI イベントを IPC で親プロセスへ送出
- **上り方向（OpenAI互換形式）**: `tool_calls` / `tool` 形式の履歴を直接生成し、ZWC埋め込みを廃止

実装計画は `docs/plans/029/implementation_plan.md` に記録。

---

### 5-2. 実装フェーズ（2026-03-16）

#### `src/runner.mjs` への変更
`process.on('message', ...)` ハンドラ内（`runNonInteractive` 呼び出し直前）に以下のラッパーを挿入：

```javascript
// SSoT 5.0: sendMessageStream をラップし全イベントをIPC送信
if (config && config.getGeminiClient) {
    const geminiClient = config.getGeminiClient();
    const originalSendMessageStream = geminiClient.sendMessageStream.bind(geminiClient);
    geminiClient.sendMessageStream = async function* (...args) {
        const gen = originalSendMessageStream(...args);
        for await (const event of gen) {
            if (process.send) {
                process.send({ type: 'gemini_event', event: { type, value, traceId, reason } });
            }
            yield event;  // パススルー（nonInteractiveCli.js の動作を維持）
        }
    };
}
```

> 初回実装では `yield* (async function* () { ... })()` のネスト構造を使用したが、
> これが TypeError の原因となったため後に修正（詳細は §5-3）。

#### `src/streaming.js` への変更
- ZWC関連の定数・関数（エンコード・デコード・スキャン）をすべて削除
- `runner.stdout.on('data')` のパースロジックを `runner.on('message')` ハンドラに置き換え
- 受信イベントタイプに応じて以下のSSEチャンクを生成：
  | イベントタイプ | SSE `delta` の内容 |
  |---|---|
  | `content` | `delta.content` に本文テキスト |
  | `thought` | `delta.content` に `💭` 付きテキスト（暫定策 ※後述の課題あり） |
  | `tool_call_request` | `delta.tool_calls` に OpenAI 互換の `function` オブジェクト |
  | `error` / `loop_detected` / `agent_execution_stopped` | `delta.content` に警告テキスト |
- `skipZwcProcessing` 引数を `streaming.js` および `server.js` から削除
- 履歴復元ロジックを簡素化（ZWCデコード不要。`msg.tool_calls` からOpenAI互換形式で組み立て）

---

### 5-3. 第1の不具合：ツール実行時にRunner がクラッシュ

**症状**: ツールが一つでも呼ばれると Runner プロセスが `exit code 1` で即死し、OpenClaw 側でリトライが繰り返される。ログ上では同じ思考プロセスが何度も繰り返されているように見えた（実態はリトライループ）。

**エラーメッセージ**（`/app/logs/adapter.log` より）:
```
[stdout-passthrough] {"type":"result","status":"error","error":{"type":"TypeError",
  "message":"[API Error: Cannot read properties of undefined (reading 'Symbol(Symbol.asyncIterator)')
```

**原因**: `runner.mjs` の `sendMessageStream` ラッパーにおいて、`async function*` の中で `yield*` を使って別の `async function*` の即時実行結果をネストした際に、非同期イテレータとして正しく機能しなかった。

```javascript
// ❌ 壊れていた実装（二重ネスト）
geminiClient.sendMessageStream = async function* (...args) {
    const stream = yield* (async function* () {  // ← ここが問題
        ...
        yield event;
    })();
    yield* stream;  // ← stream は undefined になる
};
```

**修正後**:
```javascript
// ✅ 修正後（シンプルな for-await ループ）
geminiClient.sendMessageStream = async function* (...args) {
    const gen = originalSendMessageStream(...args);
    for await (const event of gen) {
        process.send({ type: 'gemini_event', event: { ... } });
        yield event;
    }
};
```

修正後に `docker compose build && up` で再ビルド・再デプロイ済み。

---

### 5-4. 第2の不具合：`Tool google_web_search not found`（未解決）

**症状**: 会話中に Gemini CLI が Google Web Search などのツールを実行しようとした際、UI 上に `Tool google_web_search not found` というエラーが表示される。

**2つの側面がある可能性**:
1. **OpenClaw側の問題**: OpenClaw が受け取った `delta.tool_calls` を解釈し、アダプターに対して「そのツールは登録されていない」と返している
2. **Gemini CLI 側の問題**: ラッパー実装後、ツール実行スケジュールに何らかの副作用が生じ、CLIコアが実際にツールを呼べなくなっている

**未解決事項（次の調査課題）**:
- OpenClaw は `delta.tool_calls` をどのように処理するか？ OpenClaw 自身がツールを「実行」して結果を返すのか、それとも Adapter/CLI 側が実行した結果を受け取るだけなのか？
- `tool_call_request` の IPC 受信後、Gemini CLI コアはそのままツールを実行し、その結果は `tool_result` として続くイベントで来るはずだが、OpenClaw 側が先に `tool_calls` を受け取って「自分で実行しようとして失敗する」のではないか？

---

### 5-5. 第3の課題：Thought を content に誤変換している問題（設計上の懸念）

**現状の実装**:
`thought` イベントを受け取った際、OpenAI 互換フォーマットに `delta.thought` のようなフィールドが存在しないため、暫定策として `delta.content` に `💭` マークを付けて流し込んでいる。

**問題点**:
- 思考トークンが本文（content）のストリームに混入し、UI 上のテキストを圧迫・汚染する
- 思考はあくまで内部プロセスであり、本文と同列に表示すべきでない

**次の調査課題**:
- OpenClaw（Gateway）が思考プロセスを受け取るための**正式なフォーマット**を調査する
- 例えば Anthropic の Extended Thinking や、OpenAI の o1 モデルが使う `reasoning_content` / `thinking` フィールドに相当するものが OpenClaw で定義されているか確認する
---

## 6. [2026-03-16] Session b73ad2a7: SSoT 5.1/5.2 による最終解決と安定化

### Discussion & Investigation (SSoT 5.1)
- **課題**: IPC化 (SSoT 5.0) により Thought や Tool ログの取得には成功したが、OpenAI 規格の `tool_calls` をそのまま OpenClaw に流すと、OpenClaw が自身でツールを実行しようとして `Tool not found` エラーが発生する競合問題を特定（§5-4の課題）。
- **調査事実**: [030_openclaw_thought_tool_spec.md](030_openclaw_thought_tool_spec.md) にて、OpenClaw が `reasoning_content` フィールドをサポートしている事実を発見。

### Implementation (SSoT 5.1)
- **内容**: 思考プロセスとツール実行ログを、正規の `delta.tool_calls` ではなく、すべて非正規の `delta.reasoning_content` に統合して流し込む「案A＋C」を適用した。
- **解説**: これにより、OpenClaw Gateway は「ツール実行の依頼」を受け取らなくなり、アダプター/Gemini CLI 側での自律的なツール実行フローが中断されなくなった。

### Discussion & Investigation (SSoT 5.2)
- **課題**: `read_file` ツールによるスキルマニュアル参照時の `Path not in workspace` エラーを特定。
- **調査事実**: 隔離環境の `skills` パスが `WorkspaceContext` に未登録であった。

### Implementation (SSoT 5.2)
- **内容**: `src/runner.mjs` にて、隔離環境のスキルディレクトリに対する `addReadOnlyPath` 登録処理を追加し、イメージのリビルドを行った。

### 結論
- SSoT 5.0 (IPC下地) -> 5.1 (UI/履歴整合) -> 5.2 (自律権限) の 3 段階により、Gemini CLI アダプターの現代的アーキテクチャが完成した。
- `stream-json` のパース不安定性に端を発した一連の課題は、IPC 通信と `reasoning_content` への戦略的集約によって完全に解消された。

## 結論
本調査の結果に基づき、SSoT 5.1/5.2 での思考ログ分離実装が完了しました。
- **対応ステータス**: 完了 (Completed)
