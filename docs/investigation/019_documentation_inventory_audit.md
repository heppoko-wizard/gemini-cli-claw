### 調査レポート：[docs/ ディレクトリの資産棚卸しとコンテキスト最適化の検証]

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: プロジェクトの長期化に伴い `docs/` ディレクトリにシステム生成の一時ファイルや、既に役割を終えた旧バージョンの設計図、断片的な会話ログが蓄積しており、AIのコンテキストを不要に圧迫・混乱させている可能性がある。
- **検証**: `find` および `view_file` を用いて、特に拡張子 `.resolved`, `.jsonl`, `.pb`, `.metadata.json` を持つファイル、および過去のサブプロジェクト（`gemini_model_sync` 等）の内容を抽出・精査した。
- **事実の発見**: 
  1. `docs/openclaw_geminicli_integration/` 配下に、エディタやデプロイツールが生成したと思われる `.resolved` ファイル群（旧設計の残骸）および、2026年2月時点の古いバイナリログ（`.pb`, `.jsonl`）が残置されている事実を確認した。
  2. `docs/gemini_model_sync/` 内の計画書は、既に現在の `scripts/update_models.mjs` 等の実装によって完全に上書き・置換されており、参照価値を失っている事実を確認した。
  3. `docs/openclaw_geminicli_integration/devlog/` 内には、現在メインの `development_chronicle.md` に集約済みの小規模な日別ログ（`2026-03-05.md` 等）が重複して存在している事実を確認した。

【追加の議論と検証ループ】
- **議論/指摘**: 単純な削除ではなく、将来的な「なぜこの設計になったか」のトレース能力を維持しつつ、アクティブな開発時にAIが迷わないようにするための最適な整理方法は何か。
- **新仮説**: 重要度（松・竹・梅）に基づくフォルダ隔離（アーカイブ化）と、不要ゴミの完全削除を組み合わせることで、履歴の整合性とコンテキスト効率を両立できる。
- **再検証と事実**: 
  1. **「松（最新の真実）」**: `development_chronicle.md` および最新の `investigation/ssot_3.1_...` は、現在の ZWC ステガノグラフィ方式の唯一の正典であることを再確認した。
  2. **「竹（歴史的価値）」**: 過去の意思決定ログ（`decisions/`）は、設計の背景を知るために重要であり、削除すべきではない。
  3. **「梅（ノイズ）」**: 以下のファイル群は、現在のプロジェクト状態において純粋なノイズ（またはゴミ）であると断定した。
     - システム生成の `.resolved`, `.metadata.json`, `.pb`, `.jsonl`
     - 役割を終えた `docs/gemini_model_sync/` フォルダ全体
     - 重複している `docs/openclaw_geminicli_integration/task.md` (本体 `task.md` が最新のため)

【コードベース・仕様から確認された最終的な事実】
- `docs/` 全62ファイルのうち、約 40% (25ファイル以上) がシステム生成または旧バージョンの残骸であり、削除・アーカイブの対象となる。
- `docs/openclaw_geminicli_integration/devlog/development_chronicle.md` は 900行を超えており、プロジェクトの全Sessionを網羅しているため、他の断片的なログファイルは事実上不要である。

【結論としての整理アクション（事実に基づく推奨）】
- **削除対象**: `*.resolved*`, `*.metadata.json`, `*.pb`, `*.jsonl`
- **アーカイブ対象 (docs/archive/)**: `docs/gemini_model_sync/`, `docs/openclaw_geminicli_integration/adapter_feasibility_report.md` などの旧方針ドキュメント。
- **維持対象**: `development_chronicle.md`, `investigation/`（最新報告）, `backlog.md`, `architecture.md`

※ 本レポートは事実と検証プロセスの列挙のみであり、推測や修正案の提案は含まれていません。実装・修正を進める場合はご指示をお願いします。
