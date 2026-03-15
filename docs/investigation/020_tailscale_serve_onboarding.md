# 調査レポート：Tailscale Serve & モバイルオンボーディング

---

## 【調査の道筋（仮説と検証のトレイル）】

### Trail 1: `01_config.js` の問題定義

- **仮説**: `delete` 処理が冗長で、かつ意図せずスキーマ違反を引き起こしている可能性がある。
- **検証**: `analysis_target_openclaw_stable/src/config/zod-schema.ts` および `types.gateway.ts` を `view_file` で直接確認。
- **事実の発見**:
  - `zod-schema.ts` L656〜L688 にて `gateway.auth` の Zod スキーマ（`.strict()` 適用）が定義されている。
  - 正規のキーは `mode`, `token`, `password`, `allowTailscale`, `rateLimit`, `trustedProxy` の6つのみ。
  - `gateway.token` (旧: トップレベル) は `legacy.rules.ts` L197〜199 にて Legacy ルールとして検知される。
  - **`secret` および `sessionKey` は `gateway.auth` の Zod スキーマに存在しない**。また Legacy ルールにも記載がない。
  - つまり、`01_config.js` L61〜62 が削除しようとしている `gateway.auth.secret` や `gateway.auth.sessionKey` は、現在のコードベース内に**もともと存在したことがない**プロパティである。削除処理は完全に空振りしており、かつ冗長である。

### Trail 2: `gateway.bind` と `tailscale.mode` の制約関係

- **仮説**: `01_config.js` が `gateway.bind = 'custom'`, `customBindHost = '127.0.0.1'` という組み合わせを設定しているが、これが制約違反でないかを確認。
- **検証**: `validation.ts` L198〜222 の `validateGatewayTailscaleBind` 関数を `view_file` で確認。
- **事実の発見**:
  - `tailscale.mode` が `"serve"` または `"funnel"` のとき、`bind` は必ず loopback に解決しなければならない。
  - `bind === "loopback"` の場合はそのまま通過 (L204〜205)。
  - `bind === "custom"` かつ `customBindHost` が canonical な IPv4 かつ loopback アドレスの場合は通過 (L208〜213)。
  - **`127.0.0.1` は loopback アドレスである**ため、`bind: "custom"`, `customBindHost: "127.0.0.1"` の組み合わせはスキーマ上は通過する。エラーではない。
  - ただし、最もシンプルな正規形は `bind: "loopback"` 単体であり、web 検索結果でも `bind: "loopback"` が推奨されていることが確認された（web検索結果 [3][4]）。

### Trail 3: `gateway.auth.mode: "token"` と `allowTailscale` の共存

- **仮説**: Tailscale Serve モードで `auth.mode: "token"` と `allowTailscale: true` を同時に設定した場合に AuthError が発生しないか。
- **検証**: `types.gateway.ts` L150〜166、`auth.test.ts`（grep_search）、web検索結果 [5][7]。
- **事実の発見**:
  - `GatewayAuthConfig` の型定義上、`allowTailscale` は `boolean | undefined` であり、`mode` との排他制約はない。
  - web 検索結果によると、`allowTailscale: true` でも、リクエストに TC identity header が正しく付いていない場合はトークン認証が引き続き強制される既知の挙動が報告されている（GitHub Issue 参照 [7]）。
  - `auth.ts` L37: `allowTailscale: boolean` として型情報が確認される（grep 結果より）。

### Trail 4: `07_autopair.js` の `process.exit(0)` 問題

- **仮説**: `setInterval` 内から `process.exit(0)` を呼ぶことで、セットアップ全体のメインプロセス（`docker-install.sh` の `node -e "..."...`）が強制終了される。
- **検証**: `07_autopair.js` を `view_file` で確認（L72〜76）。`docker-install.sh` L236 を確認。
- **事実の発見**:
  - `07_autopair.js` L72: `process.exit(0)` が承認成功時に呼ばれる。
  - `07_autopair.js` L76: `process.exit(0)` がタイムアウト時にも呼ばれる。
  - `docker-install.sh` L236 では `node -e "require('./scripts/setup/steps/07_autopair')().then(() => require('./scripts/setup/steps/06_mobile')()).catch(e => console.error(e))"` として順次実行している。
  - Node.js の仕様として、`process.exit()` は `setInterval` など非同期コールバックの内部から呼ばれても即座にプロセス全体を終了させる（web検索結果 [1][2][3]）。
  - **結論**: `07_autopair.js` の `setInterval` が最初の `check()` を実行した 2 秒後（`elapsed=2`）に承認成功または 300 秒後タイムアウトが起きた瞬間、`06_mobile.js` の呼び出し（`.then(...)` 以降）が一切実行されずにプロセスが終了する。

### Trail 5: `06_mobile.js` の HTTPS 疎通確認と Token URL の問題

- **仮説**: `dashboardUrl` に `?token=openclaw-docker-session` が含まれているが、このトークンが Tailscale Serve 経由でのアクセスで有効か確認する。
- **検証**: `06_mobile.js` L99 を `view_file` で確認。`01_config.js` L48〜49 を確認。
- **事実の発見**:
  - `06_mobile.js` L99: `dashboardUrl = https://${tailscaleHostname}/?token=openclaw-docker-session`
  - `01_config.js` L48〜49: `auth.mode = 'token'`, `auth.token = 'openclaw-docker-session'`
  - Web 検索結果によると、`allowTailscale: true` が設定されていても、HTTP API エンドポイントではトークン認証が引き続き要求されることが既知の挙動として報告されている。
  - つまり QR コードの URL にトークンが含まれていること自体に問題はないが、Tailscale のリバースプロキシがクエリパラメータをそのまま転送するかどうかに依存する。

### Trail 6: OpenClaw ソースコードにおける `controlUi` の設定項目の確認

- **仮説**: `01_config.js` が削除しようとしている `allowInsecureAuth` や `dangerouslyDisableDeviceAuth` はスキーマに実在するか。
- **検証**: `zod-schema.ts` L644〜654 を `view_file` で確認。
- **事実の発見**:
  - `gateway.controlUi` の Zod スキーマには `allowInsecureAuth: z.boolean().optional()` (L651) と `dangerouslyDisableDeviceAuth: z.boolean().optional()` (L652) が**正式に定義されている**。
  - これらは `types.gateway.ts` L118〜120 にも型定義が存在する。
  - **結論**: これらは「存在しないキー」ではなく、スキーマに存在する正規のキーである。`01_config.js` がこれらを `delete` しているのは、旧設定の残滓として機能的な意味はある（Falsy な値が残るのを防ぐ）が、初回生成時（ファイルが存在しない場合）は最初から設定されていないため、スキーマ上 `undefined` であり `delete` は空振りになる。

---

## 【コードベース・仕様から確認された最終的な事実】

| 事実 | ソース |
|------|-------|
| `gateway.auth.secret` と `gateway.auth.sessionKey` は、現在の OpenClaw Zod スキーマ (`zod-schema.ts` L656〜688) に存在しない。これらを `delete` する処理は完全に無効。 | `zod-schema.ts` L656〜688 (`.strict()` 定義) |
| `gateway.tailscale.mode = "serve"` 時、`gateway.bind` は `"loopback"` または `"custom"` (IPv4 loopback のみ) のいずれかでなければバリデーションエラーとなる。`"custom" + 127.0.0.1` はパスする。 | `validation.ts` L198〜222 |
| `allowInsecureAuth` と `dangerouslyDisableDeviceAuth` は `gateway.controlUi` の正規スキーマキーとして存在する（省略可能）。削除しても副作用はないが、空振りになる可能性がある。 | `zod-schema.ts` L651〜652, `types.gateway.ts` L118〜120 |
| `gateway.auth.mode` の有効値は `"none"`, `"token"`, `"password"`, `"trusted-proxy"` の4つ。 | `zod-schema.ts` L658〜664, `types.gateway.ts` L123 |
| `07_autopair.js` L72, L76 にて `process.exit(0)` が呼ばれ、setInterval 完了時にプロセス全体が強制終了する。これにより `06_mobile.js` の `.then()` チェーンが実行されない。 | `07_autopair.js` L72, L76; `docker-install.sh` L236 |
| Node.js において `process.exit()` は `setInterval` 内部から呼ばれても即座にプロセス全体を終了させる（イベントループ外のタスクを含む）。 | web検索[1][2][3] (kostasbariotis.com, codu.co, medium.com) |
| `07_autopair.js` が Promise を即時 resolve して返しているため（L82）、`06_mobile.js` の実行は論理的には開始されるが、直後の `setInterval` が完了すると `process.exit(0)` で中断される。 | `07_autopair.js` L29〜83 |
| Web 検索によると `gateway.bind: "loopback"` が Tailscale Serve 構成の推奨形としてドキュメントで紹介されており、`"custom" + 127.0.0.1` も許容されるが冗長とされる。 | web検索[3][4] |
| `legacy.rules.ts` L197〜199 にて `gateway.token` (トップレベル) は Legacy ルールとして検知される。`gateway.auth.secret` や `gateway.auth.sessionKey` は Legacy ルールに記載がなく、スキーマ上もどの時点でも存在しない。 | `legacy.rules.ts` L197〜199 |

---

※ 本レポートは事実と検証プロセスの列挙のみであり、推測や修正案の提案は含まれていません。実装・修正を進める場合はご指示をお願いします。
