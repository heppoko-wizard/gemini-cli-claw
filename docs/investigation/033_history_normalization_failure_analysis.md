# 調査レポート：履歴復元プロセスにおける正規化の欠落 (Fact Finding Report)

## 1. 調査目的
会話履歴が OpenClaw からアダプターに戻り、Gemini CLI に渡される過程で、なぜ Thought（思考）や Tool Log（ツールログ）が「会話（テキスト）」として混入して汚染を引き起こすのか、その技術的要因を特定する。

---

## 2. 履歴復元フローの再精査

### 2-1. アダプターによるメッセージ変換ロジック
`src/streaming.js` L118-186 にて、OpenAI 互換の `messages` を Gemini CLI 内部形式 (`resumedSessionData`) に変換する処理を確認した。

```javascript
// src/streaming.js L123-130
for (const msg of messages) {
    let text = '';
    if (typeof msg.content === 'string') {
        text = msg.content;
    } else if (Array.isArray(msg.content)) {
        text = msg.content.map(p => p.type === 'text' ? p.text : '').join('\n');
    }
    // ...
}
```

### 2-2. 致命的な欠陥：`reasoning_content` の無視とマージ
OpenClaw 側では、アダプターの出力した `content` と `reasoning_content` を最終的に 1 つのメッセージオブジェクトとして管理している。履歴リクエストで送り返されてくる際、アダプターが提供した **`reasoning_content`（装飾テキスト）が `msg.content` の中に混ざってしまっている。**

しかし、現在の変換コードには以下の重大な不備がある：
1.  **文脈分離の喪失**: `msg.content` 内に含まれる「地の文」と「装飾されたログ（⚙️等）」を区別せず、すべてを一塊の `text` として Gemini CLI の `content` フィールドに流し込んでいる。
2.  **正規化（逆パース）の欠如**: 本来であれば、`⚙️` などのパターンを検出し、Gemini の内部スキーマである `toolCalls` 構造や `thought` フィールドへ**復元（デコード）**して戻すべきだが、これを「ただの会話履歴」として扱っている。

---

## 3. 【回答】ユーザーの疑義に対する事実確認

> 実際は結局全部会話として返していたってこと？

**結論：その通りです。**
- アダプターは、Gemini CLI が出力した情報を「人間が見るための装飾（⚙️等）」をして OpenClaw に渡し、OpenClaw から戻ってきたその装飾テキストを、**再び「生のテキスト」として Gemini CLI に投げ返しています。**
- これにより、Gemini CLI（および背後の LLM）は、自分が以前「思考」や「ツール呼び出し」として出力したはずのものが、履歴上では「自分が喋った普通のテキスト」として現れるため、文脈の一貫性が崩壊し、汚染が発生しています。

---

## 4. コードベースから確認された最終的な事実
- `src/streaming.js` L139: `assistant` ロールのメッセージを復元する際、`content` 全体を `text` フィールドに格納して Gemini に渡している。
- `msg.tool_calls`（OpenAI正規形式）の復元ロジック (L140-156) は存在するが、SSoT 5.1 で出力先を `reasoning_content` に変更したため、戻ってくる履歴には `tool_calls` オブジェクトが含まれず、この復元ロジックは実質的に** dead code（機能停止）**している。
- **結論**: 現在、Thought も Tool Log も、Gemini から見れば「ただの過去の発言」として汚染された状態で入力されている。

---
## 結論
履歴正規化の失敗は、**SSoT 6.0（ツールマーカー ID 方式）**における「リハイドレーション・ループ」の実装によって解決されました。マーカー ID をキーに実データを復元することで、Gemini CLI 側での矛盾が解消されました。

- **対応ステータス**: 完了 (Completed)
- **解決策の詳細**: `src/streaming.js` の `resumedSessionData` 生成ロジックを参照。

### 追記：ハリティ（Hallucination Artifacts）の発生について
調査の過程でログに現れた `ctrl46` という異常なタグ、および `⚙️ tooluse[name]{args}` という不正なマーカー形式は、コードベースの不備ではなく、LLM が過去の断片的なコンテキスト（汚染された履歴）から生成した**「履歴ハルシネーション（幻覚）」**であることが確定しました。SSoT 6.0 への移行により、マーカー形式が `[name][callId]` に厳密に固定されたことで、この現象も収束に向かうものと判断されます。
