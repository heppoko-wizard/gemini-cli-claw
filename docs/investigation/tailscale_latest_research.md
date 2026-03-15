### 調査レポート：OpenClaw Tailscale 連携の最新仕様と妥当性確認（2026年3月）

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: 現在の実装（`bind: "loopback"` への一本化）が最新の OpenClaw 仕様と整合しているか、また認証バイパス等の脆弱性情報がないかを確認する。
- **検証**: `search_web` にて OpenClaw GitHub Issue および公式ドキュメント（2026年時点）を検索。
- **事実の発見**: 
    - **`gateway.bind: "loopback"` の強制**: 2026年の最新ドキュメントにおいて、`tailscale.mode: "serve"` 時は `gateway.bind: "loopback"` が**必須**であることが明記されている。これは Tailscale プロキシ経由の正当なリクエスト（x-forwarded-* ヘッダを含む）を識別するためのセキュリティ要件である。
    - **WebSocket 接続のセキュリティブロック**: OpenClaw 2026.2.19 (2026年2月20日リリース) 以降、セキュリティ強化のため非ループバックアドレスへの WebSocket (`ws://`) 接続が CLI レベルで制限されるようになった。`bind: "lan"` 等を設定していると、Tailscale 経由のダッシュボードアクセスが失敗する既知の不具合が報告されており、その推奨回避策がまさに `bind: "loopback"` への変更である。
    - **`allowTailscale` の挙動**: `allowTailscale: true` を設定することで、Control UI および WebSocket 認証において Tailscale の ID ヘッダーが利用可能になる。ただし、HTTP API エンドポイントには引き続きトークン認証が必要であり、現在の `token` モードとの併用設定は正しい。
    - **`process.exit` 問題**: セットアップスクリプトにおける非同期処理（setInterval 等）の中断問題は、Node.js プロセスモデルに起因する一般的な不具合であり、除去することが正当な修正である。

【コードベース・仕様から確認された最終的な事実】
- [GitHub Issue [2]] によると、2026.2.19 バージョン以降の回帰バグにより、`gateway.bind: "loopback"` 以外では Tailscale 環境下の WebSocket 疎通が阻害される。
- [公式ドキュメント [3]] では、Tailscale Serve 使用時の `bind: "loopback"` 設定を HTTPS 運用のための「セキュリティ・ベストプラクティス」として強く推奨している。
- `01_config.js` における「存在しないキー（`secret`, `sessionKey`）」の削除処理は、2026年の現行スキーマ (`zod-schema.ts`) に照らしても依然として不要であり、削除は妥当である。

※ 本レポートは事実と検証プロセスの列挙のみであり、推測や修正案の提案は含まれていません。実装・修正を進める場合はご指示をお願いします。
