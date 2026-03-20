### Backlog

- [ ] 最新メッセージ内の画像ブロック (`type: 'image_url'`) を抽出し、Gemini CLI に渡すように `src/converter.js` を修正
- [ ] `/v1/models` エンドポイントを修正し、モデル属性 (`input: ["text", "image"]`) を返すようにして OpenClaw の機能を解放する
- [ ] 枝刈りされた履歴 (`[image data removed - ...]`) から画像パスを抽出し、可能な場合は復元するロジックの実装
- [ ] ZWC パースの堅牢化（破損時のフォールバック処理）
- [ ] Docker `/tmp` 共有設定の構成 (`docker-compose.yml` のボリュームマウント)
における `/tmp/openclaw` の共有マウント設定の追加
- [ ] [技術負債解消] コンテナ起動時のエントリーポイント(`entrypoint.sh`等)で、ホストマウントされたディレクトリの所有者を動的に修正する機構の導入（Docker環境とホスト間のEACCESエラーの根本解決）
        // --- WebUI / image_url オブジェクト形式のセカンダリスキャン ---
        // Telegram 経由は文字列マーカーだが、WebUI は OpenAI 互換のオブジェクト形式で送るため。
        if (Array.isArray(lastUserMsg?.content)) {
            for (const part of lastUserMsg.content) {
                if (part && part.type === 'image_url' && part.image_url?.url) {
                    const url = part.image_url.url;
                    // data:image/... (base64) は現時点ではスキップ（Gemini CLI はファイルパスが必要）
                    if (url.startsWith('data:')) {
                        log(`[debug] image_url data-URI detected (skipped for now): ${url.substring(0, 60)}...`);
                        continue;
                    }
                    つまりBase64の複合化＋ローカルファイル化が必要。