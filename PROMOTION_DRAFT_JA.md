# 各プラットフォーム向け記事ドラフト（日本語版）v2

---

## ✅ AI文章アンチパターン（書く前に意識すること）

- 「〜することができます」「実現しています」→【NG】
- 「革命的」「圧倒的」「最強」「強力な」→【NG】
- 「本記事では〜について解説します」で始まる→【NG】
- 箇条書きを連打する構成→【NG】
- 「まとめ」で「いかがでしたか？」→【絶対NG】
- すべての文末が「〜です」「〜ます」で単調→【NG】
- 抽象的な賞賛・具体性のない「すごい」→【NG】

---

# 📝 Zenn 向けドラフト

> **Zennの空気感**: 実体験ベース、個人の格闘の話が刺さる。技術的な詰め込みより「なぜ作ったか」「何が難しかったか」を先に出す。砕けたです・ます調。

---

**タイトル案**: `OpenClawのcliBackendsは「テキストを返すだけ」の仕様だった。ツールもスキルも画像も使えない。なんとかした。`

---

OpenClaw には `cliBackends` という仕組みがある。`~/.openclaw/openclaw.json` に好きなCLIツールをバックエンドとして登録しておくと、OpenClawがそのツールをstdin/stdout経由で呼び出してLLMとして使ってくれる、というものだ。

Claude CodeやGemini CLIを差し込めれば面白いと思って試してみたのだが、使い込んでいくとすぐに限界に当たった。

### cliBackendsの限界

`cliBackends` の通信仕様は、OpenClawがstdinにテキストを流し込んで、バックエンドがstdoutにテキストを返す、それだけ。

このシンプルな設計ゆえに、こういう問題が出る：

**1. ツールが使えない**  
OpenClawとしてはテキストのやり取りしかしていないので、LLM側でファイルを読んだりコマンドを叩いたりするツール呼び出しも、その結果も、OpenClawには届かない。Gemini CLIが内部でツールを使って考えたとしても、OpenClawの目にはその過程が一切見えず、最終的なテキスト応答だけが返ってくる。

**2. スキルが使えない**  
OpenClawはスキル（`SKILL.md`）を持つ概念だが、`cliBackends` インターフェースにはスキルをバックエンドに渡す仕組みがない。Gemini CLIのスキルとは全くの別物なので、そのまま流し込んでも意味がないという問題もある。

**3. マルチモーダルが使えない**  
OpenClawがユーザーから画像を受け取っても、`cliBackends` はそのパスをテキストとしてstdinに流すだけで、バイナリを渡す方法がない。

正直、この仕様のままだと「ChatGPTみたいなことをするには足りなすぎる」という感想だった。

---

### ひとつずつ回避した

**ツールの問題 → Gemini CLI自身のツールを使わせる**

Gemini CLIは `--yolo` フラグを付けると、ファイル操作やコマンド実行などのツールを確認なしで使う。つまり、OpenClawからテキストを受け取るだけだとしても、Gemini CLI側で自律的にツールを呼んでもらえばいい。

OpenClawのツール群については別のアプローチが必要だった。Gemini CLIは公式でMCP（Model Context Protocol）に対応しているので、OpenClawのツールをMCPサーバーとして立ち上げて、Gemini CLIに接続させることにした。

```
OpenClaw → adapter.js → Gemini CLI
                              ↑ MCP
                         mcp-server.mjs
                              ↑
                         OpenClaw tools (Slack送信, Cron, Web検索...)
```

`mcp-server.mjs` はOpenClawの `dist/index.js` をimportして、OpenClawのネイティブツールをMCPのスキーマに変換して公開する。これでGemini CLIがOpenClawの世界のツールを呼び出せるようになった。

---

**スキルの問題 → 仮想ホームディレクトリ + シンボリックリンク**

Gemini CLIは `GEMINI_CLI_HOME` という環境変数でホームディレクトリを差し替えられる。これを使って、起動ごとに一時的なホームディレクトリを生成することにした。

```
~/.openclaw/gemini-sessions/{session-id}/.gemini/
├── settings.json         ← MCPサーバーの登録（openclaw-toolsだけ）
├── skills/               ← OpenClawが許可したスキルだけをリンク
│   └── -> /path/to/approved-skill/
├── oauth_creds.json      ← 本物の認証ファイルをコピー
└── ...
```

OpenClawは `--allowed-skills` 引数でサンドボックス検証を通過したスキルのパス一覧を渡してくれるので、それだけをこの仮想ホームの `skills/` にリンクする。

副作用として、グローバルに置いてある無関係なスキルがGemini CLIに読み込まれることもなくなった。

---

**マルチモーダルの問題 → stdinの [media attached: path] をパースして @パス記法に変換**

OpenClawがメディアをstdinで送る際のフォーマットは、テキストの中に `[media attached: /path/to/image.png]` という記法でパスを埋め込む形式になっている。

Gemini CLIには `@/path/to/file` という記法でファイルを参照させる機能がある。

なので `adapter.js` 内でstdinをパースして `[media attached: ...]` のパスを抜き出し、Gemini CLIの起動引数に `@パス` として渡すことで、Gemini CLI側でGeminiのネイティブな画像認識能力を呼び出せるようにした。

`[media attached N/M: path (type) | url]` のような複数添付の記法や `[Image: source: path]` のような別形式にも対応している。

---

**セッション継続の問題 → セッションIDのマッピングファイル**

`cliBackends` はリクエストのたびにプロセスを起動しては終了する設計で、セッションの継続も仕様にない。

Gemini CLIには `--resume <session-id>` で前のセッションを引き継ぐ機能があるので、`~/.gemini/openclaw-session-map.json` にOpenClawのセッションIDとGemini CLIのセッションIDの対応表を保持することで、OpenClaw側のセッション粒度で会話を継続させるようにした。

---

v0.1なのでLinuxでしか動作確認は取れていないが、Windows・macOS向けの処理（junction、ファイルコピーによるシンボリックリンク代替）は組み込んである。

GitHub: https://github.com/hepowiz/gemini-cli-claw

---

---

# 📝 Qiita 向けドラフト

> **Qiitaの空気感**: 問題定義→解決策という構成が好まれる。技術的な解説は省略しない。検索ワードを意識した見出し。

---

**タイトル案**: `OpenClawのcliBackendsでツール・スキル・マルチモーダルが全部使えなかった問題をどう回避したか`

---

## cliBackendsとは

[OpenClaw](https://github.com/openclaw/openclaw) は自律型エージェントフレームワークで、LLMのバックエンドを `cliBackends` として設定ファイルに登録する仕組みを持っている。

```json
"cliBackends": {
  "my-backend": {
    "command": "node",
    "args": ["./my-adapter.js"]
  }
}
```

このバックエンドはstdinでプロンプトを受け取り、stdoutに応答テキストを返せばいい。シンプルな設計だが、逆にいうと**それ以外のことができない**。

## 問題：この仕様ではGemini CLIの能力を引き出せない

`cliBackends` がstdin/stdoutのテキストのみを扱う設計なので、次の問題が生じる。

### 1. ツール呼び出し結果がOpenClawに見えない

Gemini CLIが内部でファイルを読むなどのツールを使っても、OpenClawとのやり取りはテキストのみ。OpenClawのツール（Slack送信、スケジューラ等）をGemini CLIに持たせる手段もない。

### 2. スキルを渡す仕組みがない

OpenClawは実行時に `--allowed-skills` として検証済みスキルのパスを渡すが、受け取ったスキルをGemini CLIに届けるインターフェースが存在しない。さらにGemini CLIのスキルはOpenClawの `SKILL.md` とは形式が異なるため、単純な文字列受け渡しも意味がない。

### 3. メディアパスをバイナリで渡せない

OpenClawはstdin内に `[media attached: /path/to/image.png]` とテキストでパスを埋め込む形式でメディアを伝達するが、`cliBackends` の仕様ではバイナリ転送の手段がない。

## 解決策

### ① OpenClawのツールをMCPで公開する

Gemini CLIはMCP（Model Context Protocol）対応なので、`mcp-server.mjs` でOpenClawのツールをMCPサーバーとして立ち上げ、Gemini CLIに接続させた。

OpenClawの `dist/index.js` をそのままimportして `createOpenClawCodingTools()` を呼ぶことで、OpenClaw本来のツールをMCPスキーマに変換して公開できる。

Gemini CLI起動時に `--allowed-mcp-server-names openclaw-tools` を指定し、既存のグローバルMCPサーバーは読み込まれないようにした（これはスキル隔離と絡んでいる、後述）。

### ② 仮想ホームディレクトリでスキルを制御する

Gemini CLIは `GEMINI_CLI_HOME` 環境変数でホームディレクトリを上書きできる。これを利用して、セッションごとに `~/.openclaw/gemini-sessions/{session-id}/` 以下に専用の `.gemini/` を生成する。

```
~/.openclaw/gemini-sessions/{session-id}/.gemini/
├── settings.json    ← openclaw-toolsのMCPサーバーのみ登録
├── skills/          ← --allowed-skillsで渡されたスキルのみリンク
├── oauth_creds.json ← 本物から複製（認証はそのまま使用）
```

`settings.json` には `openclaw-tools` のMCPサーバーだけを書くので、グローバルに設定している他のMCPサーバーも、無関係なスキルも、一切読み込まれない。

`--allowed-skills` で渡されたパスはここにリンクするだけなので、スキルの実ファイルは動かさなくていい。

Windowsではシンボリックリンクに管理者権限が必要なため、ファイルは `copyFileSync`、ディレクトリは `junction` タイプのリンクを使った。

### ③ stdinから画像パスを抽出して @記法で渡す

OpenClawのstdinに含まれる `[media attached: /path/to/image.png]` をパースして、Gemini CLI起動時の引数に `@/path/to/image.png` として追加した。

```js
// adapter.js 抜粋
const mediaAttachedPattern = /\[media attached(?:\s+\d+\/\d+)?:\s*([^\]]+)\]/gi;
while ((match = mediaAttachedPattern.exec(userMessage)) !== null) {
    // パスを抽出してbaseGeminiArgsに @パス として追加
}
```

これでOpenClawのユーザーが画像を送ると、Gemini CLIの `@file` 引数に変換されてGeminiのネイティブな画像認識が動く。

### ④ セッションIDのマッピングで会話を継続させる

`cliBackends` はリクエストごとにプロセスを起動・終了するため、セッション継続の概念がない。

Gemini CLIの `--resume <session-id>` を使って前のセッションに接続できるので、`openclaw-session-map.json` にOpenClawのセッションIDとGemini CLIが返すセッションIDの対応を保持するようにした。次回呼び出し時に `--resume` を付けて会話を繋ぐ。

## リポジトリ

https://github.com/hepowiz/gemini-cli-claw

v0.1 / Linuxのみ動作確認済み。Windows・macOSは実装済みだが実機テスト未実施。

---

---

# 📝 X (Twitter) 向けドラフト

---

**ツイート案（スレッド形式）**:

---

[1/4]
OpenClawの `cliBackends` でGemini CLIをバックエンドにしようとしたら、ツールもスキルも画像も何も使えないことが分かって途方に暮れた。

なんとかなったので作ったもの置いときます。
→ https://github.com/hepowiz/gemini-cli-claw

[2/4]
仕様の問題：cliBackendsはstdin→stdoutのテキスト往復しかできない設計。

つまりGemini CLIがツールを呼んでも結果がOpenClawに伝わらないし、OpenClaw側のツールをGemini CLIに渡す手段もない。スキルも。画像も。

[3/4]
回避策3つ：

・ツール問題 → OpenClawのツールをMCPサーバーで公開して、Gemini CLIに繋ぐ
・スキル問題 → GEMINI_CLI_HOME環境変数で仮想ホームを起動ごとに生成。許可されたスキルだけリンク
・画像問題 → stdinの[media attached: path]をパースして @path 記法でGemini CLIに渡す

[4/4]
あとセッション継続も cliBackends には仕様がないので、OpenClawのセッションID↔GeminiのセッションIDをJSONで対応させておいて --resume で繋ぐようにした。

v0.1でLinuxのみ確認済み。
https://github.com/hepowiz/gemini-cli-claw #個人開発

---

**シングルポスト案（要約版）**:

---

OpenClawのcliBackendsにGemini CLIを繋いだ。ただしcliBackendsはstdin/stdoutのテキストのみの仕様なので、そのままだとツールもスキルも画像も全部死ぬ。

・ツール → OpenClawのツールをMCPサーバー化してGemini CLI側で使わせる
・スキル → GEMINI_CLI_HOME仮想化でセッションごとに隔離
・画像 → stdinをパースして@記法に変換
・セッション → IDマッピングで--resume

Linux確認済み。
https://github.com/hepowiz/gemini-cli-claw

---
