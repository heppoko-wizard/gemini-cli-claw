### 調査レポート：履歴汚染（SSoTパッチ無効化）の再発原因

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: ブランチ切り替えなどにより、過去の「SSoT化（履歴汚染防止）パッチ」のコミットが脱落・無効化しているのではないか？
- **検証**: `git log` および `git show 29dab0cb` を用いて、SSoTパッチが現在の `feature/docker-setup` ブランチに存在しているかを確認。
- **事実の発見**: コミット `29dab0cb` は確実に現在の履歴に存在し、有効に機能している。このコミットで `src/server.js` 内の `overwriteSessionHistory`（Gemini CLIの内部JSONファイルを直接書き換える処理） は正常に削除されていた。

- **新仮説**: では、なぜ OpenClaw 画面上のプレースホルダーテキスト（`⚙️ Using tool...`）が Gemini に履歴として伝わってしまっているのか？ Adapter から Gemini への履歴受け渡し経路に別の穴があるのではないか。
- **検証**: `src/streaming.js` の `messages` 処理部を調査。
- **事実の発見**: `src/streaming.js` の 117行目〜140行目において、OpenClaw から受信した `messages` 配列から `resumedSessionData` というオブジェクトを組み立て、それを `runnerPool.acquireRunner()` 経由で Gemini CLI のワーカーへ渡すロジックが残存・稼働している事実を確認した。

【コードベース・仕様から確認された最終的な事実】
- `src/server.js` における物理ファイル（JSON）への履歴上書き処理は、SSoTパッチにより確かに削除されている。
- しかし、`src/streaming.js` の `117行目周辺` にて、OpenClaw クライアントから送られてきたチャット履歴全体を `resumedSessionData` に変換し、Gemini CLI の `runNonInteractive()` インメモリコンテキストとして**毎リクエスト時に強制注入している事実**が存在する。
- ツール呼び出し時、Adapter は UI 向けの進捗テキストとして `⚙️ Using tool [cron] ...` 等を返却している（`src/streaming.js:243`）。
- OpenClaw 側はこれを「AIの返答（モデルのメッセージ）」として UI 履歴に保存し、次のリクエスト時にそのまま Adapter へ送り返す。
- Adapter はそれを `resumedSessionData` として Gemini に丸投げするため、Gemini CLI 自身のセッションJSONの有無にかかわらず、**インメモリで履歴汚染（UI表示テキストの幻覚化）が成立しているメカニズムが確認された。**

【追加の議論と検証ループ】
- **議論/指摘**: 「GeminiとOpenClaw間の完全な1:1翻訳（コンバート）があれば、ゴミをフィルターで消すようなその場しのぎではなく、そもそもシステムとして正しく履歴が同期されるのではないか？」
- **新仮説**: OpenClaw（OpenAI API形式）の履歴をGemini形式にマッピングする `src/converter.js` を `src/streaming.js` に適用すれば、ツールコールのメタデータが正しく翻訳され、テキストとしての汚染がなくなるのではないか。
- **再検証と事実**:
  - `src/converter.js` 内に確かに `convertToGeminiMessages` という OpenAI → Gemini の 1:1翻訳関数が存在する事実を確認した。
  - しかし、**「ツールの実行主体」** が問題の鍵であった。現在、ツールの実行（Bashやgogcliの呼び出し）はすべて **Gemini CLI 側（バックエンド）**で完結している。
  - そのため、Adapter は OpenClaw（フロントエンド）に対して、構造化データ（JSONの `tool_calls`）ではなく、**ただの文字列表現として「⚙️ Using tool [cron] ...」という進捗報告テキストを流し込んでいる**。
  - 結果として、OpenClaw側の履歴には「AIが "⚙️ Using tool [cron] ..." という文字列を喋った」という**純粋なテキストの会話**として記録されてしまう。
  - したがって、いくら完璧な1:1のフォーマット翻訳（`convertToGeminiMessages`）を適用しても、OpenClawの履歴上ではそれが「ただのテキスト」である以上、Geminiへは「アシスタントの発言テキスト」としてそのまま忠実に翻訳・注入されてしまう事実が判明した。

【修正難易度とアプローチの考察】
- **修正の難易度**: **非常に簡単（Very Easy）**
- **必要な作業量**: 約10行のコード追加のみ。システムアーキテクチャやツールの根本的な挙動を変更する必要はない。
- **具体的アプローチ**: 
  - 汚染の根源は「アダプタが親切心でUIにストリーミング返却したシステムテキスト（Using tool等）」が、そのまま次のターンで「AI自身の記憶」として戻ってきてしまうことにある。
  - したがって、`src/streaming.js` の `118行目付近`（`messages.map` で `resumedSessionData` を組み立てる直前）に、以下のような **SSoTフィルター（ブラックリスト）** を1枚挟むだけで完全に解決する。
  ```javascript
  // 履歴の中に「⚙️ Using tool」や「Tool finished.」といったUI用テキストが含まれていたら、Geminiへ渡す前に除外する
  const cleanMessages = messages.filter(msg => {
      // (テキスト抽出ロジック)
      if (text.includes('⚙️ Using tool')) return false;
      if (text.includes('Tool finished.')) return false;
      return true;
  });
  ```
- **安全性**: 
  - このフィルター処理は、OpenClaw側のUI表示には一切干渉せず、Gemini側に渡る「インメモリの記憶」だけを浄化するため、副作用なく即座に汚染の循環を断ち切ることができる極めて安全な手法であると評価できる。

※ 本レポートは事実と検証プロセスの列挙・考察のみであり、実際のコード改修は含まれていません。実装を進める場合は通常モードでのご指示をお願いします。
