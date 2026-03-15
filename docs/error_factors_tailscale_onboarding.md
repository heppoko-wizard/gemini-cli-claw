# Error Factors: Tailscale Serve & Mobile Onboarding

Tailscale Serve を利用したモバイル連携セットアップにおいて、正常に完了しない、あるいはハングアップする原因を特定しました。

## 1. 致命的なバグ (Critical Bugs)

- **`07_autopair.js`: プロセスの強制終了**
  - デバイス承認完了時、またはタイムアウト時に `process.exit(0)` を実行している。これにより、セットアップ全体のメインプロセスが終了し、QRコードの表示まで辿り着けない。
- **`07_autopair.js`: ポーリングの不全**
  - `setInterval` 内で `docker exec` を連発しているが、コンテナが完全に立ち上がる前に実行されるとエラーになり、そのエラーハンドリングが JSON パースエラーの無視に留まっている。

## 2. 設計上の問題 (Design Issues)

- **`01_config.js`: 冗長かつ不透明な設定更新**
  - 大量の `delete` 処理がスキーマの可読性を下げており、かつ「本来あるべき設定」を誤って削除するリスクがある（例: `gateway.auth.secret` の削除に伴う整合性不良）。
- **`06_mobile.js`: HTTPS 疎通確認のタイムアウト**
  - `waitAndCheckHttps` が最大 60 秒（2秒×30回）待機するが、Tailscale Serve の DNS 反映が遅い場合にタイムアウトし、ユーザーを放置してしまう。

## 3. 依存関係のリスク (Infrastructure Risks)

- **network_mode: host の制限**
  - ホストネットワークを使用しているため、ホスト側の `3971` (Gateway) や `3972` (Adapter) 番ポートが既に使用されていると衝突し、コンテナがサイレントに失敗する。
- **Tailscale Socket Access**
  - `/var/run/tailscale/tailscaled.sock` へのパーミッションが root 限定の場合、コンテナ内から操作できない可能性がある（`chown` 処理が必要な場合がある）。

## 4. 解決策 (Action Plan)

1. `01_config.js` の `delete` を全廃し、宣言的な構成に変更。
2. `07_autopair.js` の `process.exit(0)` を廃止し、正常な Promise 制御に移行。
3. `06_mobile.js` に「現在 Tailscale Serve の起動を待っています」といった詳細なフィードバックを追加。
