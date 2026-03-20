# 調査レポート: Gateway RPC プラグインによる軽量 MCP サーバーの実現

## 1. 目的
OpenClaw の Gateway に専用プラグインを導入し、RPC メソッドを通じてツール実行機能を外部（軽量 MCP サーバー）に公開するための技術的実現性を調査しました。

## 2. 調査結果

### 2.1. OpenClaw プラグインによる RPC 拡張
- **登録メカニズム**: `api.registerGatewayMethod(methodName, handler)` を使用して、任意の RPC メソッドを Gateway に追加可能です。
- **ハンドラー仕様**: `GatewayRequestHandler` は `(opts: GatewayRequestHandlerOptions) => void` の形式であり、`opts.params` (引数) と `opts.respond` (返信関数) にアクセスできます。
- **実装箇所**: `analysis_target_openclaw_stable/src/plugins/registry.ts`

### 2.2. 全ツールの取得と実行
- **ツールレジストリへのアクセス**: `getActivePluginRegistry()` (from `src/plugins/runtime.js`) を使用することで、Gateway プロセス内で現在ロードされているすべてのプラグインとツールのメタデータにアクセス可能です。
- **ツールの解決**: `resolvePluginTools(context)` (from `src/plugins/tools.ts`) を使用することで、各ツールのファクトリを呼び出し、実行可能な `AnyAgentTool` インスタンスを取得できます。
- **ツールの実行**: `tool.execute(toolCallId, arguments)` を呼び出すことで、実際のツールのロジックを実行できます。結果は `AgentToolResult` 形式で返されます。

### 2.3. Gateway RPC プロトコル
Gateway は JSON-RPC (2.0 準拠ではない独自拡張) を使用しています。
- **接続・認証**:
  1. Gateway 側から `connect.challenge` イベントを送信。
  2. クライアント側が `connect` メソッドで応答。この際、`token` (API キー) による認証が必要。
- **フレーム構造**:
  - リクエスト: `{ type: "req", method: string, id: string, params: object }`
  - レスポンス: `{ type: "res", id: string, ok: boolean, payload: object, error?: object }`
- **実装箇所**: `analysis_target_openclaw_stable/src/gateway/server/ws-connection/message-handler.ts`

### 2.4. 軽量 MCP サーバーの構成案
- **Gateway プラグイン**: 以下のメソッドを公開。
  - `mcp.listTools`: すべてのツールの名称、説明、パラメータ（JSON Schema）を返却。
  - `mcp.callTool`: 指定されたツールを実行し、結果（テキスト、画像、メタデータ）を返却。
- **MCP サーバー (クライアント)**:
  - Node.js で動作する軽量スクリプト（OpenClaw コアライブラリへの依存なし）。
  - 標準入出力で MCP プロトコルを処理し、内部で Gateway RPC を呼び出す。

## 3. 実裝に向けた要件
- **コンテキストの提供**: ツール実行には `workspaceDir` や `config` を含む `OpenClawPluginToolContext` が必要です。プラグイン側で適切なデフォルト値を設定するか、RPC 経由で指定可能にする必要があります。
- **型定義の同期**: MCP の Tool 定義と OpenClaw の `AnyAgentTool` 定義（特に TypeBox スキーマ）を相互変換するロジックが必要です。

## 4. 結論
Gateway RPC プラグインを使用した MCP クライアント化は、OpenClaw の既存アーキテクチャを壊すことなく、非常に「クリーンかつ軽量」に実現可能であることが確認されました。
これにより、1.1GB もの依存関係を持つ重い MCP サーバーを各所に配置する必要がなくなり、Gateway 一箇所でツール管理を一元化できます。
