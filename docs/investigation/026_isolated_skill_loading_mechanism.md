# 026: 隔離環境におけるスキル自動ロードの仕組みと構成 (SSoT 4.0)

## 調査の背景
OpenClaw Adapter において、隔離された Gemini CLI 実行環境（`runner-pool.js` による動的ホーム構築）で、`google-workspace-gogcli` スキルがエージェントに認識されない問題が発生した。

## 確定した真実 (一次情報)
Gemini CLI のソースコード (`@google/gemini-cli-core`) を直接調査した結果、以下の事実が判明した：

1.  **設定パラメーターの非存在**: `settings.json` に `skills.path` や `skills.directory` といったパス指定パラメーターは存在しない。
2.  **自動検出ディレクトリの固定**: `SkillManager` は `Storage.getUserSkillsDir()` および `getProjectSkillsDir()` を検索する。
    - **Global**: `GEMINI_CLI_HOME/skills` (実体は `.gemini/skills`)
    - **Project**: `TARGET_DIR/.gemini/skills`
3.  **制御フラグ**: `settings.json` で制御できるのは `skills.enabled` (Boolean) および `skills.disabled` (Array) のみである。

## 導き出された正しい構成
隔離環境でスキルを認識させるには、以下の条件をすべて満たす必要がある：

1.  **物理配置**: `GEMINI_CLI_HOME/skills` ディレクトリに `SKILL.md` を含むスキルフォルダを物理的に配置する。
2.  **有効化フラグ**: `settings.json` にて `skills.enabled: true` を明示的に設定する。
3.  **パスの正規化**: `GEMINI_CLI_HOME` 環境変数は、`.gemini` 自体ではなく、その親ディレクトリ（例: `/root`）を指す必要がある。Gemini CLI は `GEMINI_CLI_HOME` の直下に `.gemini` フォルダを作成・参照するためである。

## 実装への反映
- `runner-pool.js` にて、隔離ホーム構築時に `skills` ディレクトリを再帰的にコピーする処理を実装。
- 同ファイルにて、`settings.json` 生成時に `skills.enabled: true` を注入するロジックを追加。
- `docker-compose.yml` にて、`GEMINI_CLI_HOME` を `/root` に正規化。

## 結論
LLM の事前知識や他のツールの類推から「パス指定パラメーターがあるはずだ」と推測することは極めて危険である。本件のように、ソースコードを直接読むことでしか辿り着けない「真実」こそが、SSoT 4.0 安定化の鍵であった。
