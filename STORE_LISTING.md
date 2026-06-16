# Chrome Web Store submission cheat sheet — Tab Groups for GitHub

提出時に各フィールドへコピペできる文面集。`PRIVACY.md` の GitHub URL をポリシー URL に使う前提。

---

## 1. Listing (store listing tab)

- **Name:** `Tab Groups for GitHub`
- **Category:** Developer Tools
- **Language:** English (primary) + 日本語

### Short description (≤132 chars)

**EN**
```
Organize GitHub repositories into custom groups and view them as tabs on the Repositories page. No servers, fully private. Unofficial.
```

**JA**
```
GitHub のリポジトリを自由なグループに整理し、Repositories ページにグループタブで一覧表示。外部送信なし・完全プライベート・非公式。
```

### Detailed description

**EN**
```
Tab Groups for GitHub adds custom group tabs to the Repositories page of any GitHub user or
organization, so you can sort your repos into your own categories and browse each group as a
list — across pagination, all in one place.

Features
• Group tabs injected above the repository list. "All" shows GitHub's native list; each group
  tab shows just that group's repositories (spanning all pages).
• Assign repositories to groups in one click, with a familiar GitHub-style picker.
• Manage groups right on the page: rename, recolor, reorder, delete, and create.
• Groups are kept completely separate per account (user vs organization) — no mixing.
• Bookmarkable: each group has its own URL, and the page title reflects the active group.
• Works on both profile and organization Repositories pages, light and dark themes.
• English / Japanese UI (auto-detected, switchable).
• Optional cloud sync across your Chrome browsers using Chrome's built-in account sync — no
  external server, no tokens.

Privacy
Everything you create stays in your own browser storage. The extension has no server and
sends nothing to the developer or any third party. No analytics, no tracking.

Note: This is an unofficial tool and is not affiliated with or endorsed by GitHub, Inc.
"GitHub" is a trademark of GitHub, Inc.
```

**JA**
```
Tab Groups for GitHub は、GitHub の任意のユーザー／Organization の Repositories ページに
独自の「グループタブ」を追加する拡張機能です。リポジトリを自分のカテゴリに整理し、
グループごとにページネーションをまたいで一覧表示できます。

主な機能
・リポジトリ一覧の上にグループタブを追加。「すべて」は GitHub 標準の一覧、各グループタブは
  そのグループのリポジトリだけを全件表示。
・各リポジトリ行のボタンからワンクリックでグループに割り当て（GitHub 風のピッカー）。
・ページ内でグループ管理（改名・色変更・並べ替え・削除・新規作成）。
・グループは user / organization ごとに完全独立。混在しません。
・各グループに専用 URL（ブックマーク可）、ページタイトルにも反映。
・プロフィール／Organization のどちらにも対応、ライト/ダーク両対応。
・日本語／英語 UI（自動判定・切替可）。
・任意でクラウド同期（Chrome のアカウント同期を利用。外部サーバー・トークン不要）。

プライバシー
作成したデータはすべて自分のブラウザ内にとどまります。独自サーバーは無く、開発者や
第三者へ送信しません。解析・トラッキングもありません。

※ 本拡張は非公式ツールで、GitHub, Inc. とは無関係です。「GitHub」は GitHub, Inc. の商標です。
```

---

## 2. Privacy practices tab (ダッシュボードで入力)

### Single purpose
```
Organize a user's GitHub repositories into custom groups and display those groups as tabs on
the GitHub Repositories page.
```

### Permission justifications

- **storage**
```
Used to save the user's groups, group memberships, and settings (sort order, language, cloud-
sync toggle) in the browser. No other use.
```

- **Host permission `https://github.com/*`**
```
The extension's only function is on github.com Repositories pages. It needs to run a content
script there to add the group-tab UI and read the on-page repository list the user is viewing.
It does not transmit page contents anywhere.
```
(リモートコード: **No**。`remote code` は使用していません。)

### Data usage disclosures
- Collected/used data categories: **none of the listed categories are collected.**
  （フォームのチェックボックスはすべて未選択。本拡張はユーザーデータを開発者へ収集/送信しません。）
- Certifications (すべて該当 = チェック):
  - I do not sell or transfer user data to third parties, outside of the approved use cases.
  - I do not use or transfer user data for purposes unrelated to my item's single purpose.
  - I do not use or transfer user data to determine creditworthiness or for lending purposes.

### Privacy policy URL
`PRIVACY.md` をリポジトリに置き、その URL を貼る。例:
```
https://github.com/<your-account>/tab-groups-for-github/blob/main/PRIVACY.md
```

---

## 3. Graphic assets

| Asset | Size | 必須 | メモ |
|---|---|---|---|
| Store icon | 128×128 | ✅ | `icons/icon128.png` を使用 |
| Screenshots | 1280×800 or 640×400 | ✅（最低1枚） | 下記の3枚を推奨 |
| Small promo tile | 440×280 | 任意 | `store-assets/promo-440x280.png`（生成済み） |
| Marquee promo | 1400×560 | 任意 | 必要なら作成可 |

### おすすめスクリーンショット（1280×800 で撮影）
1. グループタブを選択した一覧表示（タブバー＋グループのリポジトリ一覧）
2. 「グループに追加」ピッカーを開いた状態（割り当ての分かりやすさ）
3. ページ内のグループ管理モーダル（改名・色・並べ替え・削除）

撮影のコツ: ウィンドウ幅を広めにして該当部分が中央に来るようにし、1280×800 に切り出す。ダークテーマの方がアイコンの色が映える。
