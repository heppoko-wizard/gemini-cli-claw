### 調査レポート：docs/investigation の時系列整理

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: ファイルの作成日（OS上のタイムスタンプ）は不正確である可能性があるが、Gitの `git log --diff-filter=A` を使用することで、そのファイルがリポジトリに初めて追加された正確な日時を取得できる。
- **検証**: 
  1. `docs/investigation` 内の全ファイルリストを取得する。（完了）
  2. 各ファイルに対して `git log --diff-filter=A --format="%ai" -- <file> | tail -1` を実行し、初回コミット日時を取得する。
  3. 取得した日時を元にファイルを昇順（古い順）にソートする。
- **事実の発見**: `git log --follow --diff-filter=A` を使用して調査した結果、各ファイルの本来の作成日（初回コミット時）が判明しました。2026-03-12のコミットは、既存ファイルを一括で `docs/investigation` ディレクトリに移動した際のものであり、それ以前の履歴を辿ることで正確な順序を特定できました。

【コードベース・仕様から確認された最終的な事実】
- 以下の順序でファイルが作成されていることが確認されました（同一日時の場合はファイル名の昇順）。

1. 2026-02-21:
   - adapter_feasibility_report.md
   - architecture_report.md
   - context_architecture.md
2. 2026-02-22: tool_history_architecture.md
3. 2026-03-04: auth_protocol_guide.md
4. 2026-03-10: 
   - gogcli_auth_mechanism.md
   - gogcli_least_privilege_scopes.md
   - hang_analysis.md
   - history_pollution_analysis.md
5. 2026-03-10 (Later): summarization_prompts.md
6. 2026-03-11:
   - openclaw_dockerfile_investigation.md
   - production_env_error_facts.md
7. 2026-03-11 (Evening):
   - ssot_inline_metadata_architecture.md
   - ssot_pollution_recurrence.md
8. 2026-03-11 (Night): ssot_3.1_zwc_architecture_report.md
9. 2026-03-12 (Batch move):
   - dependency_and_build_requirements.md
   - docker_setup_architecture_review.md
   - document_creation_best_practices.md
   - documentation_inventory_audit.md
10. 2026-03-15: tailscale_serve_onboarding.md
11. 2026-03-15 (Later):
    - pairing_connection_failure.md
    - pairing_connection_failure_v2.md
    - tailscale_latest_research.md

※ 以下のファイルは未追跡またはGit履歴がないため、末尾に配置します。
- openclaw_summarization_mechanism.md
- context_architecture.md.resolved

---
本レポートは Git 履歴に基づいた事実の列挙です。これに基づき、リネームを実行するための実装計画を作成しました。
