# Orchestra-merger

Orchestra-merger は、個人運用向けの小さな GitHub オーケストレーションアプリです。Launch Gate を通過した `queued` Issue を作業キューとして扱い、Copilot coding agent に 1 件ずつ渡し、PR の自動マージ・次 Issue への前進・全件完了時の通知までをまとめて補助します。

## 1. Overview

このリポジトリは次の流れを前提にしています。

- Launch Gate で Issue を整備・承認してから `queued` に進める
- `queued` を実行可能キューとして使う（`queued` のみ実行対象）
- Copilot coding agent に 1 件ずつ順番に渡す
- チェック通過後に Copilot PR を auto-merge する
- マージ後に次の Issue へ進める
- すべて完了したら通知する

## 2. What Orchestra-merger does

通常の運用では、人が Issue を作成して Launch Gate を進め、`queued` になった Issue を PWA から「次の Issue を開始」で実行します。するとアプリと GitHub Actions が連携し、以下を進めます。

1. 先頭の `queued` Issue を確認する
2. `in-progress` ラベルを付けて Copilot に割り当てる
3. Copilot が PR を作成したら CI 完了を待つ
4. 条件を満たした Copilot PR を auto-merge する
5. マージ済み PR の関連 Issue を finalize する
6. まだ `queued` が残っていれば次に進む
7. すべて完了したら `ntfy` に通知する

## 2.1 Launch Gate states

Issue のライフサイクルは次を想定します。

1. `draft`
   - たたき台。まだ実行しない。
2. `needs-polish`
   - 要件や受け入れ条件の明確化が必要。まだ実行しない。
3. `ready-for-launch`
   - 人手レビューで実行準備ができた状態。まだ実行しない。
4. `queued`
   - 実行可能。ここで初めてオーケストレーション対象になる。
5. `in-progress`
   - Copilot へ割り当て済みで実行中。
6. `completed` / `closed`
   - 完了。
7. `failed-assignment`
   - 割り当て失敗。再試行前の可視化用。

重要: **実行可能なのは`queued`のみ**です。

## 2.2 Issue polish workflow (pre-launch)

`draft` のまま実装に進めず、次の順で内容を磨いてから launch します。

```txt
rough issue created
→ label: needs-polish
→ polishing pass（AI または人）で title / body / scope / acceptance criteria を明確化
→ label: ready-for-launch
→ 人手で launch 承認
→ label: queued
```

運用ルール:

- `needs-polish` / `ready-for-launch` は **非実行状態**
- `ready-for-launch` へ移しても自動実行されない
- 人手承認が終わるまで `queued` にしない
- `Launch Ready Issues` workflow の `launch` スイッチが `true` のときだけ `ready-for-launch` を `queued` に変換する

polish 後の Issue 本文テンプレート（最小要件）:

```markdown
## Purpose
- この Issue で達成したい目的

## Scope
- この Issue で実装する範囲

## Out of scope
- 今回やらないこと（境界を明示）

## Tasks
- [ ] 実装タスク 1
- [ ] 実装タスク 2

## Acceptance criteria
- [ ] 振る舞いが検証可能な受け入れ条件
- [ ] 回帰しないことを確認できる条件
```

## 3. Current architecture

主な構成要素は以下です。

- GitHub Pages PWA: `/docs`
- 画面ロジック: `/docs/app.js`
  - queued Issue 表示
  - PAT 認証
  - start アクション
  - 進捗ポーリング
  - PWA 更新操作
- Service Worker: `/docs/sw.js`
  - オフラインキャッシュ
  - コアファイルの network-first 更新
- GitHub Actions workflows:
  - `.github/workflows/automerge.yml`
  - `.github/workflows/orchestrate.yml`
  - `.github/workflows/launch-ready-issues.yml`
  - `.github/workflows/notify-complete.yml`
  - `.github/workflows/check.yml`
- セットアップ補助スクリプト: `/scripts`
  - `setup-initial-settings.mjs`
  - `check-initial-settings.mjs`
  - `validate-target-repo.mjs`
- ターゲットリポジトリレジストリ: `config/target-repos.yml`

## 4. Implemented features

現時点で実装済みの主な機能:

- PWA 画面
- PAT 保存
- queued Issue 取得
- 開始アクション
- 進捗ポーリング
- Copilot PR auto-merge guard
- minimal CI watchdog
- orchestration workflow
- linked issue finalization
- notify-complete workflow
- rollback / failed-assignment behavior
- target repository registry (`config/target-repos.yml`)

## 5. Target repository registry

`config/target-repos.yml` は、将来の Phase 3 マルチリポジトリオーケストレーションに備えた許可リストです。現時点ではクロスリポジトリの実行は行われません。

- 許可リストに存在し `enabled: true` のリポジトリのみ、将来の自動化でターゲットにできます。
- リストにないリポジトリ、または `enabled: false` のリポジトリはすべて拒否されます。
- フィールドの詳細は [`docs/TARGET_REPOS.md`](./docs/TARGET_REPOS.md) を参照してください。

リポジトリが許可リストに含まれているかを確認するには:

```bash
npm run validate:target-repo -- --repo owner/repo
# または
TARGET_REPO=owner/repo node scripts/validate-target-repo.mjs
```

## 6. Remaining / known limitations

現状の制限も明示しておきます。

- PAT をブラウザ保存する場合は、信頼できる端末での運用が前提です
- GitHub / Copilot の bot 名や識別方法が将来変わる可能性があります
- 一部の初期セットアップは GitHub 側で手動設定が必要です
- branch protection は手動で確認・設定する必要があります
- `ntfy` のトピック購読はアプリ外で設定します

## 7. Initial setup

まず、GitHub 側の前提を揃えます。

1. `draft` / `needs-polish` / `ready-for-launch` / `queued` / `in-progress` / `failed-assignment` ラベルを用意する
2. GitHub Actions secrets に `ORCHESTRA_PAT` と `NTFY_TOPIC` を登録する
3. GitHub Pages を `main` ブランチの `/docs` から配信する
4. Copilot coding agent がこのリポジトリで利用可能なことを確認する
5. 必要に応じて次の補助コマンドを使う
   - `npm run setup:dry-run`
   - `npm run setup:initial`
   - `npm run check:initial`

詳細は [`SETUP_AUTOMATION.md`](./SETUP_AUTOMATION.md) を参照してください。

## 8. Normal operation

通常の使い方は次のとおりです。

1. 作業させたい Issue を作成し、`draft` → `needs-polish` → `ready-for-launch` まで進める
2. Actions の `Launch Ready Issues` を実行し、`issue_numbers` に対象 Issue 番号を入れて preview する（`launch=false`）
3. preview 内容を確認後、`launch=true` で再実行して `ready-for-launch` から `queued` に変換する
4. GitHub Pages の PWA を開く
5. PAT を入力する
6. 保存方法を選ぶ
   - persistent mode: `localStorage`
   - session mode: `sessionStorage`
7. 初回保存時の「信頼できる端末」確認に同意する
8. 必要なら「最新に更新」で最新 PWA を読み直す
9. 「次の Issue を開始」を押す
10. 進捗欄で `in-progress` Issue / open PR / recent merge を確認する
11. 全件完了後は `ntfy` 通知を確認する

## 9. Manual follow-ups

自動化の外で、人が確認したほうがよい項目:

- Pages 配信設定が維持されているか
- branch protection と required checks が意図どおりか
- Copilot が対象リポジトリに割り当て可能か
- `ntfy` の購読先が現在使っている端末で有効か
- 必要がなくなった PAT を PWA から削除したか

## 10. Troubleshooting

### automerge が動かない

- `.github/workflows/automerge.yml` が有効か確認する
- PR が Copilot 作成 PR として判定されているか確認する
- `check.yml` の `ci-check` など required checks が成功しているか確認する
- branch protection が auto-merge を阻害していないか確認する

### Copilot assignment が失敗する

- PWA の認証状態を確認する
- PAT 権限不足や期限切れを疑う
- `failed-assignment` ラベルが付いていないか確認する
- Copilot coding agent がこのリポジトリで利用可能か確認する

### stale PWA / old app version が出る

- 画面の「最新に更新」を押す
- オンライン時は `index.html` / `app.js` / `sw.js` が network-first で取り直される
- それでも古ければブラウザの PWA を再読み込みし、必要に応じて再インストールする

### ntfy が通知しない

- `NTFY_TOPIC` secret が正しいか確認する
- 端末側で対象トピックを購読しているか確認する
- `.github/workflows/notify-complete.yml` の実行結果を確認する

### PAT / auth が失敗する

- PAT の文字列に空白が入っていないか確認する
- 権限が不足していないか確認する
- 一時端末なら `sessionStorage` モードを使う
- 不要な PAT は「PAT を削除」で消してから再設定する

## 11. Security notes

このアプリはブラウザから GitHub PAT を使うため、以下を守ってください。

- trusted personal device でのみ使う
- 一時端末では `sessionStorage` モードを優先する
- 不要になったら PWA から PAT を削除する
- PAT を GitHub Issue / PR / スクリーンショット / ログに貼らない

推奨する最小権限:

- `metadata`: read
- `contents`: read/write
- `issues`: read/write
- `pull requests`: read/write
- `actions`: read/write
- `administration`: setup scripts や Pages / branch settings の変更が必要な場合のみ

## License

MIT License
