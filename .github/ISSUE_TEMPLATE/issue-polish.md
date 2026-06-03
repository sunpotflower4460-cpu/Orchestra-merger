---
name: Launch Gate issue polish
about: Rough issue を launch 前に polishing するためのテンプレート
title: "[Polish] "
labels: ["needs-polish"]
---

## Purpose
- この Issue で達成したい目的を 1-3 行で記載

## Scope
- 今回の実装対象
- 必要なら対象ファイル / コンポーネント

## Out of scope
- 今回は実施しない内容
- 別 Issue に分離すべき内容

## Tasks
- [ ] 実装タスクを小さく分割して列挙
- [ ] テスト / 検証タスクを列挙

## Acceptance criteria
- [ ] 完了判定できる振る舞いが明確
- [ ] 失敗時の期待動作または境界条件が明確

## Launch approval
- [ ] 人手レビューで `ready-for-launch` を確認
- [ ] 人手承認後にのみ `queued` へ変更
