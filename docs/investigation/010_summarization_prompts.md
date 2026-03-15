### 調査レポート：OpenClaw 要約プロンプトの特定

【調査の道筋（仮説と検証のトレイル）】
- **仮説**: OpenClaw Gateway からアダプタへ送信される「要約リクエスト」には、一意に特定可能なシステムプロンプトや XML タグが含まれているはずである。
- **検証**: `/usr/lib/node_modules/openclaw/` 以下のソースコード（特に `dist/compact-*.js` および依存ライブラリ `@mariozechner/pi-coding-agent`）を `grep` および `view_file` で精査。
- **事実の発見**: 
    - `SUMMARIZATION_SYSTEM_PROMPT` という定数が存在し、`You are a context summarization assistant.` という文字列で開始されることが判明。
    - 会話履歴は `<conversation>` タグで囲われ、以前の要約は `<previous-summary>` タグで提供される。
    - `IDENTIFIER_PRESERVATION_INSTRUCTIONS` により、UUID や API キーなどの不変性が要求される。

【コードベース・仕様から確認された最終的な事実】
- **システムプロンプト (System Prompt)**:
  - 場所: `@mariozechner/pi-coding-agent/dist/core/compaction/utils.js` (Line 150)
  - 内容: `You are a context summarization assistant. Your task is to read a conversation between a user and an AI coding assistant, then produce a structured summary following the exact format specified.`
- **要約指示 (Summarization Instructions)**:
  - 場所: `@mariozechner/pi-coding-agent/dist/core/compaction/compaction.js` (Line 349)
  - 内容: `The messages above are a conversation to summarize. Create a structured context checkpoint summary that another LLM will use to continue the work.`
  - 形式規定: `## Goal`, `## Constraints & Preferences`, `## Progress`, `## Key Decisions`, `## Next Steps`, `## Critical Context`
- **識別子保持命令 (Identifier Preservation)**:
  - 場所: `openclaw/dist/compact-D3emcZgv.js` (Line 13433)
  - 内容: `Preserve all opaque identifiers exactly as written (no shortening or reconstruction), including UUIDs, hashes, IDs, tokens, API keys, hostnames, IPs, ports, URLs, and file names.`
- **タグ構造**:
  - `serializeConversation` 関数により、履歴は `[User]: ...`, `[Assistant]: ...`, `[Assistant tool calls]: ...` の形式でテキスト化され、`<conversation>` タグ内に配置される。

※ 本レポートは事実と検証プロセスの列挙のみであり、推測や修正案の提案は含まれていません。実装・修正を進める場合はご指示をお願いします。
