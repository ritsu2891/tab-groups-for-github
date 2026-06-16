/*
 * GitHub Tab Group - i18n
 *
 * content.js / popup.js から読み込まれ、グローバルに `GHTGI18N` を公開する。
 *  GHTGI18N.t(key, ...args)   現在の言語の文字列を返す（{0},{1}.. を args で置換）
 *  GHTGI18N.apply(pref)       'auto' | 'ja' | 'en' を解決して現在言語を設定
 *  GHTGI18N.resolve(pref)     pref を実際の言語コードに解決
 *  GHTGI18N.detect()          ユーザー設定言語から 'ja' | 'en' を推定
 *  GHTGI18N.LANG_PREFS        ['auto','ja','en']
 */
(function () {
  "use strict";

  const STRINGS = {
    ja: {
      // タブ・ボタン
      all_tab: "すべて",
      add_group_tab: "＋ グループ",
      group_label: "グループ",
      new_group_tab_title: "新しいグループを作成",
      prompt_new_group: "新しいグループ名を入力してください",
      assign_tooltip: "グループに割り当て",
      assigned_tooltip_prefix: "グループ: ",
      manage_groups: "管理",
      manage_groups_title: "グループを管理",
      manage_groups_tooltip: "グループの編集・並べ替え・削除",
      // 割り当てメニュー
      menu_title: "グループに追加",
      close: "閉じる",
      no_groups_menu: "グループがありません。下で作成できます。",
      new_group_placeholder: "新しいグループ名…",
      create: "作成",
      // グループ一覧
      count_repos: "{0} 件",
      empty_group_1: "このグループにはまだリポジトリがありません。",
      empty_group_2: "「すべて」タブで各リポジトリの「グループ」ボタンから追加できます。",
      remove_from_group: "× 外す",
      remove_tooltip: "このグループから外す",
      // 並べ替え
      sort_label: "並べ替え:",
      sort_name_asc: "名前 (A→Z)",
      sort_name_desc: "名前 (Z→A)",
      sort_added_desc: "追加が新しい順",
      sort_added_asc: "追加が古い順",
      sort_language: "言語",
      // ポップアップ
      popup_subtitle: "リポジトリをグループに整理",
      popup_current_title: "このリポジトリを追加",
      popup_groups_title: "グループ",
      popup_add: "追加",
      popup_data_title: "データ",
      popup_export: "エクスポート",
      popup_import: "インポート",
      popup_data_hint: "設定（グループとメンバー）をJSONで保存・復元します。",
      popup_footer: "GitHubのプロフィール/Organizationの「Repositories」タブでグループタブが表示されます。",
      disclaimer: "本拡張は GitHub, Inc. とは無関係の非公式ツールです。「GitHub」は GitHub, Inc. の商標です。",
      popup_lang_title: "言語 / Language",
      popup_no_groups: "まだグループがありません。",
      popup_open_repos_page: "GitHub のリポジトリ一覧ページ（ユーザー / Organization）を開くと、その所有者のグループを管理できます。",
      popup_create_first: "先に下でグループを作成してください。",
      popup_move_up: "上へ",
      popup_move_down: "下へ",
      popup_delete: "削除",
      popup_change_color: "色を変更",
      popup_confirm_delete: "グループ「{0}」を削除しますか？\n（このグループのメンバー登録も解除されます）",
      popup_imported: "インポートしました。",
      popup_import_failed: "インポートに失敗しました: {0}",
      lang_auto: "自動",
      // 同期・上限
      sync_title: "クラウド同期",
      sync_toggle_label: "クラウド同期を有効にする（Chromeアカウント）",
      sync_on_hint: "同じGoogleアカウントのChrome間で自動同期します。容量の上限まで保存できます。",
      sync_off_hint: "この端末にのみ保存します（同期しません・容量無制限）。",
      sync_enable_blocked: "データが同期容量の上限を超えているため、同期を有効にできません。",
      sync_usage: "使用容量: {0}",
      sync_usage_off: "同期した場合の見込み: {0}",
      limit_sync_bytes: "クラウド同期の容量上限に達したため、これ以上追加できません。",
    },
    en: {
      all_tab: "All",
      add_group_tab: "+ Group",
      group_label: "Group",
      new_group_tab_title: "Create a new group",
      prompt_new_group: "Enter a name for the new group",
      assign_tooltip: "Assign to group",
      assigned_tooltip_prefix: "Groups: ",
      manage_groups: "Manage",
      manage_groups_title: "Manage groups",
      manage_groups_tooltip: "Edit, reorder, and delete groups",
      menu_title: "Add to group",
      close: "Close",
      no_groups_menu: "No groups yet. Create one below.",
      new_group_placeholder: "New group name…",
      create: "Create",
      count_repos: "{0}",
      empty_group_1: "No repositories in this group yet.",
      empty_group_2: "Add them from the “Group” button on each repository in the All tab.",
      remove_from_group: "× Remove",
      remove_tooltip: "Remove from this group",
      sort_label: "Sort:",
      sort_name_asc: "Name (A→Z)",
      sort_name_desc: "Name (Z→A)",
      sort_added_desc: "Recently added",
      sort_added_asc: "Oldest added",
      sort_language: "Language",
      popup_subtitle: "Organize repositories into groups",
      popup_current_title: "Add this repository",
      popup_groups_title: "Groups",
      popup_add: "Add",
      popup_data_title: "Data",
      popup_export: "Export",
      popup_import: "Import",
      popup_data_hint: "Back up or restore your groups and members as JSON.",
      popup_footer: "Group tabs appear on the Repositories tab of GitHub profiles and organizations.",
      disclaimer: "An unofficial tool, not affiliated with or endorsed by GitHub, Inc. “GitHub” is a trademark of GitHub, Inc.",
      popup_lang_title: "Language",
      popup_no_groups: "No groups yet.",
      popup_open_repos_page: "Open a GitHub repositories page (user or organization) to manage that owner's groups.",
      popup_create_first: "Create a group below first.",
      popup_move_up: "Move up",
      popup_move_down: "Move down",
      popup_delete: "Delete",
      popup_change_color: "Change color",
      popup_confirm_delete: "Delete group “{0}”?\n(Members will also be unassigned from this group.)",
      popup_imported: "Imported.",
      popup_import_failed: "Import failed: {0}",
      lang_auto: "Auto",
      sync_title: "Cloud sync",
      sync_toggle_label: "Enable cloud sync (Chrome account)",
      sync_on_hint: "Syncs across Chrome on the same Google account. Store up to the storage limit.",
      sync_off_hint: "Stored on this device only (no sync, unlimited).",
      sync_enable_blocked: "Can't enable sync: your data exceeds the sync storage limit.",
      sync_usage: "Used: {0}",
      sync_usage_off: "Estimated if synced: {0}",
      limit_sync_bytes: "Cloud sync storage is full; can't add more.",
    },
  };

  const LANG_PREFS = ["auto", "ja", "en"];

  function detect() {
    let ui = "";
    try {
      if (typeof chrome !== "undefined" && chrome.i18n && chrome.i18n.getUILanguage) {
        ui = chrome.i18n.getUILanguage() || "";
      }
    } catch (e) {
      /* ignore */
    }
    if (!ui && typeof navigator !== "undefined") ui = navigator.language || "";
    return /^ja\b/i.test(ui) || /^ja-/i.test(ui) || ui.toLowerCase() === "ja" ? "ja" : "en";
  }

  function resolve(pref) {
    return pref === "ja" || pref === "en" ? pref : detect();
  }

  let current = resolve("auto");

  function apply(pref) {
    current = resolve(pref);
    return current;
  }

  function t(key) {
    const table = STRINGS[current] || STRINGS.en;
    let str = table[key];
    if (str === undefined) str = (STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
    if (arguments.length > 1) {
      for (let i = 1; i < arguments.length; i++) {
        str = str.replace("{" + (i - 1) + "}", String(arguments[i]));
      }
    }
    return str;
  }

  globalThis.GHTGI18N = { t, apply, resolve, detect, LANG_PREFS, current: () => current };
})();
