日本語で記述する/とりあえず実装禁止/推測の事実確認調査必須/１次情報へのアクセス義務/調査手順はwebで最善手→公式docsおよびcode baseで裏どり/調査報告書類は追記のみ要約圧縮削除禁止/徹底します。

# 実装計画：SSoT 6.4 ハイブリッドDTOパターンによる起動遅延の解消

## 1. 計画概要
本計画は、`server.js` から `runner.mjs` への環境変数全転送を廃止し、リクエストに真に必要なコンテキストのみを明示的なオブジェクト（DTO）として受け渡す構造へ刷新します。これにより、ウォームアップ済みの隔離環境（`GEMINI_CLI_HOME`）が破壊されることを防ぎ、TTFT（Time To First Token）を約22秒から理論値（10秒以下）へ短縮します。

- **総フェーズ数**: 3
- **関与するエージェント**: `coder`, `tester`
- **推定工数**: 小（1時間以内）

## 2. 依存関係グラフ
```mermaid
graph TD
    P1[Phase 1: 通信プロトコルの刷新 (server/streaming)] --> P2[Phase 2: ランナー側のコンテキスト束縛 (runner)]
    P2 --> P3[Phase 3: 疎通確認とパフォーマンス計測]
```

## 3. 実行戦略
| ステージ | フェーズ | エージェント | 実行モード |
| :--- | :--- | :--- | :--- |
| Foundation | Phase 1 | coder | Sequential |
| Core | Phase 2 | coder | Sequential |
| Quality | Phase 3 | tester | Sequential |

## 4. フェーズ詳細

### Phase 1: 通信プロトコルの刷新
- **目的**: `server.js` および `streaming.js` から `...process.env` の送信を削除し、必要なパス情報のみを送信するように変更する。
- **エージェント**: `coder`
- **修正ファイル**:
  - `src/server.js`: `env` オブジェクトの構築ロジックを簡略化。
  - `src/streaming.js`: `runnerPool.acquireRunner` に渡す引数を環境変数からプロパティへ変更。
- **実装詳細**:
  - `env` プロパティを削除し、`systemMdPath` と `sessionKey` をトップレベルのプロパティとして追加。

### Phase 2: ランナー側のコンテキスト束縛
- **目的**: `runner.mjs` で `Object.assign(process.env, env)` を廃止し、受け取った DTO から最小限の環境変数のみを自己責任でセットする。
- **エージェント**: `coder`
- **修正ファイル**:
  - `src/runner.mjs`: 受信メッセージのパース処理と、`process.env` へのピンポイント注入を実装。
- **実装詳細**:
  - `process.env.GEMINI_SYSTEM_MD = systemMdPath`
  - `process.env.OPENCLAW_SESSION_KEY = sessionKey`
  - それ以外の環境変数は、`runner-pool.js` で設定された値を維持する。

### Phase 3: 疎通確認とパフォーマンス計測
- **目的**: 修正後のアダプターが正常に動作し、かつ TTFT が劇的に改善していることを実測する。
- **エージェント**: `tester`
- **検証手順**:
  - `node tools_test.mjs` による回帰テスト。
  - ログ出力における `[Runner:perf]` の数値を比較し、12秒の再初期化税が消失したことを確認。

## 5. ファイル在庫表
| ファイルパス | フェーズ | 変更内容 |
| :--- | :--- | :--- |
| `src/server.js` | Phase 1 | `env` 生成ロジックの DTO化 |
| `src/streaming.js` | Phase 1 | IPC 送信ペイロードの変更 |
| `src/runner.mjs` | Phase 2 | `Object.assign` 廃止とピンポイント注入 |

## 6. リスク評価
| フェーズ | リスク | 理由と対策 |
| :--- | :--- | :--- |
| Phase 1 | LOW | 既存の動作に影響を与えない純粋なデータ削減。 |
| Phase 2 | MEDIUM | 必須な変数を漏らすと Gemini CLI が動作しない。`GEMINI_SYSTEM_MD` は必須。 |

## 7. コスト見積もり
| フェーズ | エージェント | モデル | 推定 Input | 推定 Output | 推定コスト |
| :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | coder | Pro | 10K | 2K | $0.18 |
| 2 | coder | Pro | 5K | 1K | $0.09 |
| 3 | tester | Pro | 2K | 0.5K | $0.04 |
| **Total** | | | **17K** | **3.5K** | **$0.31** |
