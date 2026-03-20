### 調査レポート：mcp-gateway プラグインのモジュール解決エラーについて

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: プラグインディレクトリを `analysis_target_openclaw_stable/extensions/` からプロジェクトルートの `extensions/` に移動したことで、内部モジュールへの相対インポートパスが壊れたことがエラー（`Cannot find module '../../src/plugins/tools.js'`）の原因である。また、正規のプラグインAPIに内部ツールを取得するメソッドが存在するのではないか。
- **検証**: 
  1. `OpenClawPluginApi` および `PluginRuntimeCore` の型定義 (`src/plugins/types.ts`, `src/plugins/runtime/types-core.ts`) を `view_file` ツールで確認した。
  2. Dockerfileの構成 (`COPY . .`) およびディレクトリ構造から、コンテナ内でのファイル配置を特定した。
- **事実の発見**: 
  - `OpenClawPluginApi` や `PluginRuntime` には、ロード済みの全ツールを取得・列挙するためのパブリックAPI（例: `api.tools.getAll()` のようなもの）は**存在しない**。
  - したがって、この特殊なプラグイン（Gatewayで全ツールをラップするもの）では、OpenClaw内部の `resolvePluginTools` モジュールを直接インポートして使用するアプローチが既存の実装事実であった。
  - コンテナ内の配置は `/app/extensions/mcp-gateway/index.ts` と `/app/analysis_target_openclaw_stable/src/plugins/tools.ts` となる。
  - 現在の配置から正しく内部モジュールを参照するための相対パスは `../../analysis_target_openclaw_stable/src/plugins/tools.js` であることが数学的に確認された。

【コードベース・仕様から確認された最終的な事実】
- `src/plugins/runtime/types-core.ts` 等の型定義によると、他プラグインから汎用的にツールレジストリをダンプする正規APIは存在しない。
- `extensions/mcp-gateway/index.ts` から OpenClaw コアソースへの正しい相対パスは、`../../analysis_target_openclaw_stable/src/...` である。

---
※ 本レポートは事実の列挙です。この結果に基づき、Phase 3 の実装計画作成へ進んでよいか、ご指示をお願いします。
