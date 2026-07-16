# tab-groups-for-github

GitHub の Repositories ページにグループタブを追加する Chrome 拡張（MV3・素の JavaScript・ビルド無し）。公開リポジトリ。

## テスト / パッケージ

`package.json` は無く、テストは Node（24.x）で直接実行する:

- `node test/storage.test.cjs` — 保存層の単体テスト
- `node test/checks.cjs` — manifest / locale / i18n 整合の静的チェック

CI（`.github/workflows/ci.yml`）は上記に `node --check` の構文チェックを加えて `release` ブランチで回す。配布 zip の生成は `scripts/package.sh`（Mac/Linux）/ `scripts/package.ps1`（Windows）。

## 入口

- 利用者向け概要・導入手順 … `README.md`
- ストア提出文・アセット … `STORE_LISTING.md`、プライバシー … `PRIVACY.md`
