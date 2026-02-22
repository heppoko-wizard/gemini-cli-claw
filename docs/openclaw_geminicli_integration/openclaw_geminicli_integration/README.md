# OpenClaw ↔ Gemini CLI 統合（Adapter）開発ドキュメント

## 概要
OpenClawの各フロントエンド（Telegram等）から、Google公式の推論エンジンである **Gemini CLI** をシームレスに利用するための「中継アダプタAPI（プロキシ）」の開発・保守ドキュメントです。

## ドキュメント構成

| ファイル | 内容 | 更新頻度 |
|----------|------|----------|
| [architecture.md](architecture.md) | システム全体像・構成データフロー | アーキテクチャ変更時 |
| [runbook.md](runbook.md) | 2つのプロセスの起動・停止・障害対応手順 | 手順の変更時 |
| [troubleshooting_reference.md](troubleshooting_reference.md) | 不安定な挙動やデバッグ時に参照すべきファイル一覧 | 障害調査時 |
| [decisions/](decisions/) | なぜこの実装になったか（ADR） | 設計判断のたびに追加 |
| [devlog/](devlog/) | デバッグや開発の日次ログ（クロニクル） | 毎セッション記録 |

### ⚠️ 重要：最初に読むべきファイル
本システムを保守・再起動する際は、必ず **[runbook.md](runbook.md)** を参照してください。
特に、AIが記憶喪失になる・接続が拒否される等の障害が発生した場合は、Runbookの「障害対応」セクションを確認してください。

---

## Architecture Decision Records (ADR) 一覧
システム特有の「泥臭いハック構造」の理由が記されています。コードを修正する前に必ず目を通してください。

| # | タイトル | 日付 | ステータス |
|---|---------|------|-----------|
| [ADR-001](decisions/001_proxy_vs_streamfn.md) | プロキシサーバー（Adapter）方式の選定 | 2026-02-21 | 採用 |
| [ADR-002](decisions/002_session_resume_strategy.md) | コンテキストとツール履歴の同期戦略 | 2026-02-21 | 採用 |
| [ADR-003](decisions/003_openai_completions_vs_responses.md) | API形式（Completions vs Responses）の選定 | 2026-02-21 | 採用 |
| [ADR-004](decisions/004_tool_history_injection.md) | ツール使用履歴の非同期直接注入（Inject） | 2026-02-21 | 採用 |

---

## 開発クロニクル（泥沼のデバッグの歴史）
過去の失敗とトラブルシューティングの全容です。同じ過ちを繰り返さないための記録です。

- [**2026年2月中旬の全開発ログ**](devlog/development_chronicle.md)
  - セッション1 (2/13): StreamFn改造案の挫折とAPIプロキシ案の立案
  - セッション2 (2/21): Gemini記憶喪失問題とJSONLファイル手動注入（Inject）との格闘
  - セッション3 (2/21): `undefined reading '0'`（ストリーム形式不整合）解決による最終安定化
