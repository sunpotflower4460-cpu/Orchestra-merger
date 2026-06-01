# Issue 0.5 セットアップ自動化メモ

## このメモの位置づけ

このメモは、Issue 0 の手動準備が終わった直後に使う最小セットアップ手順です。

```txt
Issue 0: 手動準備
↓
Issue 0.5: 初期設定自動化スクリプトと診断コマンド
↓
Issue 1: README / docs / 基盤ファイル作成
```

README や `docs/` が未完成でも、GitHub API で自動化できる範囲を先に進められるようにしています。

## 先に済ませる手動準備（Issue 0）

- Copilot Cloud agent をこのリポジトリで有効化しておく
- `ORCHESTRA_PAT` を発行しておく
- PAT の権限を確認しておく
  - Metadata read
  - Contents write
  - Issues write
  - Pull requests write
  - Actions write
  - Administration write（repo 設定 / branch protection / Pages まで触る場合）
- ローカルで `ORCHESTRA_PAT` を環境変数として使えるようにしておく
- ntfy アプリのインストール準備をしておく

## 必要な環境変数

- `ORCHESTRA_PAT`
  - GitHub API 実行用の PAT
- `GITHUB_OWNER`
  - 省略時: `sunpotflower4460-cpu`
- `GITHUB_REPO`
  - 省略時: `Orchestra-merger`
- `NTFY_TOPIC`
  - 省略可。未指定ならランダム候補をスクリプトが生成
- `DRY_RUN`
  - `true` のとき変更を加えず予定だけ表示

## dry-run の実行方法

```bash
DRY_RUN=true node scripts/setup-initial-settings.mjs
```

`package.json` を使う場合:

```bash
npm run setup:dry-run
```

## setup の実行方法

```bash
node scripts/setup-initial-settings.mjs
```

`package.json` を使う場合:

```bash
npm run setup:initial
```

このスクリプトが扱う内容:

- `queued` / `in-progress` ラベルの作成または更新
- `Allow auto-merge` の有効化
- GitHub Pages の `main` / `/docs` 設定の試行
- `NTFY_TOPIC` の生成案内
- GitHub Secrets 登録コマンドの案内
- main ブランチ保護の診断と手動境界の案内

## check の実行方法

```bash
node scripts/check-initial-settings.mjs
```

`package.json` を使う場合:

```bash
npm run check:initial
```

出力は以下の 3 種類です。

- `✅ OK`
- `⚠️ Warning`
- `❌ Missing / Error`

最後に次のどちらかを表示します。

- `READY_FOR_ISSUE_1`
- `NEEDS_MANUAL_ACTION`

## Secrets 登録方法

値をログへ出さないため、`gh secret set --body -` を推奨します。

```bash
printf '%s' "$ORCHESTRA_PAT" | gh secret set ORCHESTRA_PAT --repo sunpotflower4460-cpu/Orchestra-merger --body -
printf '%s' "$NTFY_TOPIC" | gh secret set NTFY_TOPIC --repo sunpotflower4460-cpu/Orchestra-merger --body -
```

生成された `NTFY_TOPIC` を使う場合は、先に環境変数へ入れてから登録します。

```bash
export NTFY_TOPIC='orchestra-merger-<generated-random-string>'
printf '%s' "$NTFY_TOPIC" | gh secret set NTFY_TOPIC --repo sunpotflower4460-cpu/Orchestra-merger --body -
```

対話式でも登録できます。

```bash
gh secret set ORCHESTRA_PAT --repo sunpotflower4460-cpu/Orchestra-merger
gh secret set NTFY_TOPIC --repo sunpotflower4460-cpu/Orchestra-merger
```

## 失敗したときの手動代替

### Allow auto-merge

API で有効化できない場合:

- Settings → General → Pull Requests
- **Allow auto-merge** をオンにする

### GitHub Pages

`docs/` がまだ無い、または API が失敗する場合:

- Issue 1 完了後に setup スクリプトを再実行する
- または Settings → Pages で `main` / `/docs` を手動設定する

### main ブランチ保護

この段階では required status checks 名がまだ固まっていない可能性があります。

- `main` が存在することだけ確認する
- branch protection は必要に応じて手動で追加する
- required status checks は workflow 名が確定してから最終設定する

存在しないチェック名を必須にするとマージが詰まるので、最初から固定しすぎないことを推奨します。

### Copilot Cloud agent / ntfy

以下はスクリプトからの完全確認が難しいため、手動確認項目です。

- Copilot Cloud agent の repository access が有効
- スマホの ntfy アプリが `NTFY_TOPIC` を購読済み

## Issue 1 に進む条件

以下が揃ったら Issue 1 に進めます。

- `queued` / `in-progress` ラベルが存在する
- `Allow auto-merge` が有効、または手動でオンにする段取りが明確
- `ORCHESTRA_PAT` / `NTFY_TOPIC` の Secrets 登録手順が明確
- Pages 設定が完了している、または Issue 1 後に再実行する方針が明確
- 診断スクリプトで重大な `❌` が残っていない
