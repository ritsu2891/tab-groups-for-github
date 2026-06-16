# Privacy Policy — Tab Groups for GitHub

_Last updated: 2026-06-16_

Tab Groups for GitHub ("the extension") is a browser extension that lets you organize
GitHub repositories into custom groups and view them as tabs on the GitHub Repositories
page. This document explains exactly what data the extension handles.

**Short version: the extension does not collect, transmit, sell, or share any personal
data. Everything you create stays in your own browser storage.**

## What the extension stores

The extension stores only the data you explicitly create while using it:

- **Groups** you create: name, color, display order, and the owner (GitHub user or
  organization) they belong to.
- **Repository entries** you add to a group: a snapshot of public metadata taken from the
  GitHub page you are viewing — repository name, URL, description, primary language,
  visibility (public/private flag), fork/archive flags, and GitHub's numeric repository ID.
- **Your settings**: sort order, language preference, and the cloud-sync on/off toggle.

It does **not** store passwords, tokens, cookies, browsing history, or any GitHub account
credentials.

## Where the data is stored

- **Cloud sync ON (default):** data is saved with the Chrome `storage.sync` API. Chrome
  itself synchronizes it across browsers signed in to the same Google account. This sync is
  performed entirely by Google Chrome's built-in mechanism — the extension has no server and
  sends nothing to the developer or any third party.
- **Cloud sync OFF:** data is saved with the Chrome `storage.local` API and never leaves the
  device.

You can switch between these at any time from the extension popup, and you can export or
delete all data from there as well.

## Data the extension does NOT do

- No data is sent to the developer or to any external/third-party server.
- No analytics, telemetry, tracking, advertising, or fingerprinting.
- No data is sold or shared with anyone.
- No remotely hosted/executed code is loaded.

## Permissions and why they are needed

- **`storage`** — to save your groups and settings (as described above).
- **Host access to `https://github.com/*`** — so the extension can add its UI to the GitHub
  Repositories page and read the on-page repository list you are viewing. It accesses GitHub
  pages only to render this feature; it does not transmit page contents anywhere.

## Data retention and deletion

Your data persists in browser storage until you delete it. You can remove individual groups
or repositories in the extension, clear everything by removing the extension, or use the
export/import controls to manage backups. Removing the extension deletes its local data;
data previously synced via your Chrome account is managed by Chrome's sync settings.

## Children's privacy

The extension is a developer productivity tool and is not directed to children.

## Changes to this policy

If this policy changes, the updated version will be published at this same location with a
new "Last updated" date.

## Contact

Questions about this policy: ritsu2891 (via the project's GitHub repository issues).

---

## 日本語訳（参考）

**要約: 本拡張は個人データを収集・送信・販売・共有しません。あなたが作成したデータは、すべてあなた自身のブラウザのストレージ内にとどまります。**

### 保存するデータ
あなたが操作で作成したものだけを保存します。
- **グループ**: 名前・色・並び順・所属する所有者（GitHub ユーザー/Organization）。
- **リポジトリ情報**: グループに追加した時点で、表示中の GitHub ページから取得した公開メタデータのスナップショット（リポジトリ名・URL・説明・主要言語・公開/非公開フラグ・fork/archive フラグ・GitHub の数値リポジトリ ID）。
- **設定**: 並べ替え・言語設定・クラウド同期の ON/OFF。

パスワード・トークン・Cookie・閲覧履歴・GitHub の認証情報は一切保存しません。

### 保存先
- **同期 ON（既定）**: Chrome の `storage.sync` に保存し、同じ Google アカウントの Chrome 間で **Chrome の標準機能により**同期されます。本拡張は独自サーバーを持たず、開発者や第三者へは何も送信しません。
- **同期 OFF**: Chrome の `storage.local` に保存し、端末外には出ません。

### 行わないこと
外部送信・解析・トラッキング・広告・データの販売や共有・リモートコードの実行は行いません。

### 権限の理由
- `storage`: グループと設定の保存のため。
- `https://github.com/*` へのアクセス: GitHub の Repositories ページに UI を追加し、表示中のリポジトリ一覧を読み取るため。ページ内容を外部へ送信することはありません。

### 削除
データは削除するまでブラウザに残ります。拡張内で個別削除、拡張のアンインストールでローカルデータ削除、エクスポート/インポートでバックアップ管理ができます。
