# Orchestra-merger

# 🎻 Orchestra-merger

整備済みの GitHub イシュー群を、**一度キックするだけ**で GitHub Copilot coding agent に1件ずつ順番に割り当て、自動マージしながら最後まで自走させ、**全部終わったらスマホに通知**するシンプルな自動化アプリです。

人はコードを見ません。品質の最終防衛線は CI（テスト）が担います。

---

## コンセプト

すでに丁寧に分割・記述されたイシューが大量にあるリポジトリで、人間に残された作業は「順番に Copilot へ投げてマージするだけ」になっています。Orchestra-merger は、その単調な反復だけを自動化します。

具体的には次のサイクルを自走させます。

1. **割り当て** — `queued` ラベルの付いたイシューのうち最も若い番号を1件選び、Copilot coding agent に割り当てる
2. **マージ** — Copilot が作った PR の CI（テスト）が通れば自動マージする
3. **次へ** — マージされたら次の `queued` イシューを割り当てる
4. **通知** — キューが空になったら、スマホ（ntfy）に「全部終わったよ」と通知する

人が触るのは最初の「開始」ボタンだけ。あとはクラウド側（GitHub Actions）が最後まで回します。

---

## 全体の仕組み

```
スマホ PWA（操作盤）──①開始ボタン──▶ 先頭イシューを Copilot に割り当て
                                          │
                                          ▼
                                   Copilot が PR を作成
                                          │
                       ┌──────────────────┘
                       ▼
        Workflow B: CI が緑なら自動マージ
                       │
                       ▼ （マージで起動）
        Workflow A: 次の queued を Copilot に割り当て  ←─ 繰り返し
                       │
                       ▼ （キューが空に）
        Workflow C: 5分ごとに完了を検知 → ntfy へ通知 ──▶ スマホに着信
```

自走の心臓はクラウド側にあります。スマホ PWA は「最初のキック」と「進捗の可視化」だけを担当します。

---

## 構成ファイル

| パス | 役割 |
|------|------|
| `docs/index.html` | PWA の画面（キュー表示・開始ボタン） |
| `docs/app.js` | GitHub API 呼び出し・進捗ポーリング |
| `docs/manifest.json` | ホーム画面アプリ化の設定 |
| `docs/sw.js` | 最小 Service Worker（インストール用） |
| `.github/workflows/orchestrate.yml` | Workflow A：マージ後に次の1件を割り当て |
| `.github/workflows/automerge.yml` | Workflow B：Copilot PR の自動マージ |
| `.github/workflows/notify-complete.yml` | Workflow C：完了検知 → ntfy 通知 |

---

## イシューの状態管理

3つの状態をラベルで表現します。

| ラベル / 状態 | 意味 |
|---------------|------|
| `queued` | 順番待ち（事前に人が付ける） |
| `in-progress` | Copilot が作業中（割り当て時に自動で切り替わる） |
| クローズ済み | 完了（PR マージで自動クローズ） |

処理したいイシューすべてに、あらかじめ `queued` ラベルを付けておいてください。

---

## 初回セットアップ（最初の1回だけ）

### 1. Copilot cloud agent を有効化
[Copilot 設定 → Cloud agent](https://github.com/settings/copilot/coding_agent) を開き、Repository access を **All repositories** または **このリポジトリを選択** にする。
（必要プラン：Copilot Pro / **Pro+** / Business / Enterprise のいずれか）

### 2. ラベルを作成
リポジトリの Issues → Labels で `queued` と `in-progress` を作成する。

### 3. 自動マージとブランチ保護
- Settings → General → Pull Requests で **Allow auto-merge** をオンにする
- Settings → Branches で `main` にブランチ保護ルールを追加し、**テストの必須ステータスチェック**を設定する
  （これが品質の最後の砦になります。テストが薄いと意図と違う PR でも通ってしまいます）

### 4. シークレットを登録
Settings → Secrets and variables → Actions で以下を登録する。

| 名前 | 内容 |
|------|------|
| `ORCHESTRA_PAT` | fine-grained PAT（連鎖を切らさないために使用） |
| `NTFY_TOPIC` | ntfy の秘密トピック名（推測されにくい文字列） |

> **PAT の権限**：metadata（読み取り）、Actions・Contents・Issues・Pull requests（読み書き）。対象は Orchestra-merger のみで構いません。
>
> なぜ PAT が必要か：GitHub Actions の `GITHUB_TOKEN` が起こしたイベントは別ワークフローを連鎖起動しません。マージ→次の割り当ての連鎖を成立させるために、要所で PAT を使います。

### 5. GitHub Pages を有効化
Settings → Pages で、Source を **Deploy from a branch**、ブランチを `main` / フォルダを `/docs` にする。数分後に `https://<ユーザー名>.github.io/Orchestra-merger/` で PWA が開けます。

### 6. スマホに ntfy を入れる
App Store / Google Play で **ntfy** アプリを入れ、手順4で決めた `NTFY_TOPIC` と同じトピック名を購読する。

### 7. PWA をホーム画面に追加
スマホのブラウザで PWA の URL を開き、共有メニューから「ホーム画面に追加」する。初回に fine-grained PAT を貼り付けて保存する（端末ローカルにのみ保存されます）。

---

## 使い方

1. 処理したいイシューすべてに `queued` ラベルを付ける
2. ホーム画面の Orchestra-merger を開く
3. キュー一覧を確認し、**「開始」**をタップする
4. あとは放置。アプリを開いている間は進捗（残りキュー数・処理中・最近のマージ）が見られます
5. すべて完了すると、ntfy アプリに通知が届きます

---

## 注意点・割り切り

- **品質は CI 任せ**：人はコードを見ない前提です。テストの網羅性がそのまま成果物の品質になります。
- **通知は即時ではない**：完了検知は GitHub Actions の cron（最短5分間隔・混雑時は遅延あり）で動くため、完了から通知まで数分かかります。
- **起動はイシュー割り当て経由のみ**：プロンプトを直接投げる Agent tasks API は Business / Enterprise 限定のため使いません。Pro+ でも確実に動く方式を採用しています。
- **Copilot の利用枠**：coding agent のタスクは1件あたりプレミアムリクエストを1回消費します。キューの件数が枠を超えないか事前に確認してください。

---

## 動作確認のコツ

最初は **2〜3件だけ** `queued` を付けて試運転してください。特に「マージ → 次の割り当て」の連鎖が途切れないか（PAT が正しく効いているか）を確認するのが重要です。連鎖が止まる場合は、`ORCHESTRA_PAT` の権限とワークフロー内のトークン指定を見直してください。

---

## ライセンス

（任意。MIT などを置く場合はここに記載）
