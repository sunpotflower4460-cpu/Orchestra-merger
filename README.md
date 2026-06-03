# Orchestra-merger

Orchestra-merger は、GitHub Issues をキューとして扱い、GitHub Copilot coding agent に 1 件ずつ順番に作業を割り当て、PR の自動マージ・次 Issue への連鎖・全件完了時の通知までを行う小さなオーケストレーターです。

> この README はプロジェクトの土台を整理するためのものです。PWA 画面、JavaScript ロジック、GitHub Actions workflow などの本体実装は今後の Issue で追加されます。

## このアプリがやること

- `queued` ラベルの付いた GitHub Issue を処理対象として扱う
- 先頭の Issue を `queued` → `in-progress` に進める
- Copilot coding agent に順番に割り当てる
- Copilot が作成した PR の CI が通ったら自動マージする
- マージ後に次の `queued` Issue へ連鎖して進む
- すべて完了したら ntfy で通知する

## 全体の流れ

1. 人が GitHub Issue を作成する
2. 対象 Issue に `queued` ラベルを付ける
3. GitHub Pages で配信される PWA から処理を開始する
4. Copilot coding agent が PR を作成する
5. CI 通過後に auto-merge する
6. 次の `queued` Issue に連鎖して進む
7. 全件完了時に ntfy で通知する

## 前提条件

Issue 0 の手動設定が完了している前提で進めます。

- `queued` / `in-progress` / `failed-assignment` ラベルが存在していること
- GitHub Actions Secrets に `ORCHESTRA_PAT` / `NTFY_TOPIC` が登録されていること
- GitHub Pages が `main` ブランチの `/docs` から配信されること
- Copilot coding agent がこのリポジトリで利用可能になっていること

Issue 0.5 の補助スクリプトと確認手順は [`SETUP_AUTOMATION.md`](./SETUP_AUTOMATION.md) を参照してください。

## セットアップ概要

1. Issue 0 の手動設定を完了する
2. 必要なら `npm run setup:dry-run` で初期設定内容を確認する
3. 必要なら `npm run setup:initial` で補助スクリプトを実行する
4. `npm run check:initial` で Issue 1 に進める状態か確認する
5. GitHub Pages の配信元を `main` / `docs` に設定する
6. スマホまたは信頼できる端末で PWA を開き、運用準備を行う

## 今後の Issue で実装される予定の機能

- PWA 画面の実装
- GitHub API を使ったキュー表示と開始操作
- Copilot coding agent への順次割り当て処理
- PR の auto-merge workflow
- 次 Issue への連鎖 workflow
- 完了時の ntfy 通知
- 進捗確認と最低限の運用補助 UI

## 注意点

- PAT をブラウザの `localStorage` に保存する設計です
- 自分用・信頼端末用の小さな管理アプリとして扱ってください
- GitHub / Copilot 側の仕様変更に影響される可能性があります
- 品質は最終的に CI とテストの整備状況に大きく依存します

## リポジトリの現状

この Issue の時点では、README / LICENSE / `.gitignore` / `docs/.nojekyll` などの基盤ファイルを整える段階です。アプリ本体はまだ未実装であり、後続 Issue の実装者が迷わず進められるようにプロジェクトの目的と前提を固定することを目的としています。

## ライセンス

MIT License
