/*
 * GitHub Tab Group - content script
 *
 * プロフィール/Organization の Repositories タブページに、
 * 任意のグループタブを注入する。
 *  - 「すべて」タブ : GitHub ネイティブのリポジトリ一覧をそのまま表示
 *  - 各グループタブ : 保存済みデータから独立して一覧を描画（ページをまたいで全件表示）
 * 各リポジトリ行には「グループ」割り当てボタンを注入する。
 */
(function () {
  "use strict";

  const Store = globalThis.GHTG;
  if (!Store) {
    console.error("[GHTG] storage layer not loaded");
    return;
  }

  // i18n（読み込み失敗時はキーをそのまま返すフォールバック）
  const I18N = globalThis.GHTGI18N || {
    t: (k) => k,
    apply: () => {},
    resolve: (p) => p,
  };
  const t = (...args) => I18N.t(...args);

  let state = { groups: [], repos: {}, sort: { key: "name", dir: "asc" } };
  let activeGroupId = "all"; // 'all' | groupId
  let lastUrl = location.href;

  // ブックマーク用 URL クエリパラメータ名
  const URL_PARAM = "ghtg";
  // タイトル退避用
  let baseTitle = document.title;
  let titleOverridden = false;

  // グループ割り当てボタンに使う octicon（タグ型）
  const TAG_ICON_PATH =
    "M1 7.775V2.75C1 1.784 1.784 1 2.75 1h5.025c.464 0 .91.184 1.238.513l6.25 6.25a1.75 " +
    "1.75 0 0 1 0 2.474l-5.026 5.026a1.75 1.75 0 0 1-2.474 0l-6.25-6.25A1.752 1.752 0 0 1 1 " +
    "7.775Zm1.5 0c0 .066.026.13.073.177l6.25 6.25a.25.25 0 0 0 .354 0l5.025-5.025a.25.25 0 0 " +
    "0 0-.354l-6.25-6.25a.25.25 0 0 0-.177-.073H2.75a.25.25 0 0 0-.25.25ZM6 5a1 1 0 1 1 0 2 1 " +
    "1 0 0 1 0-2Z";

  function tagIconSvg() {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "octicon ghtg-octicon");
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", TAG_ICON_PATH);
    svg.appendChild(path);
    return svg;
  }

  // ---- ページ判定とアダプタ ----
  // プロフィール（旧来の server-rendered）と Organization（React, CSS-module）で
  // マークアップが全く違うため、ページ種別ごとに探索方法を切り替える。
  function orgName() {
    const m = location.pathname.match(/^\/orgs\/([^/]+)\/repositories/);
    return m ? m[1] : null;
  }

  // Org の表示密度（ネイティブ行の構造から判定）。プロフィールでは null。
  // グループタブ表示中は一覧が隠れていても DOM 上に行は残るため判定可能。
  function orgDensity() {
    if (!orgName()) return null;
    if (document.querySelector('[class*="MetadataContainer"]')) return "compact";
    return "comfortable";
  }

  // いま開いている所有者（org または user）。グループ表示はこの所有者のリポジトリに絞る。
  function currentOwner() {
    const org = orgName();
    if (org) return org;
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length === 1) return seg[0]; // /<user>?tab=repositories
    return null;
  }

  // 現在開いている所有者のグループ（order 順）。グループ自体が owner ごとに独立。
  function ownerGroups() {
    const owner = currentOwner();
    return owner ? Store.groupsForOwner(state, owner) : [];
  }

  function findListContainer() {
    // プロフィール（安定: #user-repositories-list）
    const profile = document.querySelector("#user-repositories-list");
    if (profile) return profile;
    // Organization（React）: リポジトリ行のアンカーから ul[role=list] を辿る（最も堅牢）
    const org = orgName();
    if (org) {
      const anchor = orgRepoAnchor(org);
      if (anchor) {
        const ul = anchor.closest('ul[role="list"]');
        if (ul) return ul;
      }
    }
    return null;
  }

  // /<owner>/<repo> 形式（2セグメント）の最初のリポジトリリンク
  function orgRepoAnchor(org) {
    return Array.from(document.querySelectorAll('a[href^="/' + org + '/"]')).find((a) => {
      const seg = a.getAttribute("href").split("?")[0].split("#")[0].split("/").filter(Boolean);
      return seg.length === 2 && seg[0] === org;
    });
  }

  function findRepoItems(container) {
    // Organization: ul[role=list] 直下で、リポジトリリンクを持つ li
    const org = orgName();
    if (org) {
      return Array.from(container.querySelectorAll(":scope > li")).filter((li) => {
        const a = li.querySelector('a[href^="/' + org + '/"]');
        if (!a) return false;
        const seg = a.getAttribute("href").split("?")[0].split("#")[0].split("/").filter(Boolean);
        return seg.length === 2 && seg[0] === org;
      });
    }
    // プロフィール: 1) schema.org/Code の li
    let items = container.querySelectorAll('li[itemtype*="schema.org/Code"]');
    if (items.length) return Array.from(items);
    // 2) リスト直下の li
    const ul = container.querySelector("ul");
    if (ul) {
      items = ul.querySelectorAll(":scope > li");
      if (items.length) return Array.from(items);
    }
    // 3) フォールバック
    return Array.from(container.querySelectorAll("li"));
  }

  // li 要素から GitHub の数値リポジトリID を取り出す
  // （改名・移管しても変わらない安定キー。複数箇所に埋め込まれているので順に試す）
  function extractRepoId(li) {
    const direct = li.querySelector("[data-repository-id]");
    if (direct) {
      const v = direct.getAttribute("data-repository-id");
      if (/^\d+$/.test(v)) return v;
    }
    const hydro = li.querySelector("[data-hydro-click]");
    if (hydro) {
      try {
        const j = JSON.parse(hydro.getAttribute("data-hydro-click"));
        const id = j && j.payload && j.payload.repository_id;
        if (id) return String(id);
      } catch (e) {
        /* ignore */
      }
    }
    const m = li.innerHTML.match(/user-list-(\d+)-/);
    if (m) return m[1];
    return null;
  }

  // Organization（React一覧）の行からメタデータを取り出す。
  // 安定して取れるのは name/url/可視性のみ（説明・言語・IDは不安定なため空/None）。
  function extractOrgRepo(li) {
    const org = orgName();
    const link = li.querySelector('a[href^="/' + org + '/"]');
    if (!link) return null;
    const href = link.getAttribute("href").split("?")[0].split("#")[0];
    const seg = href.split("/").filter(Boolean);
    if (seg.length < 2) return null;
    const vis = li.querySelector("[data-listview-item-visibility-label]");
    const isPrivate = vis ? /private/i.test(vis.textContent) : false;
    const descEl = li.querySelector('[class*="Description"]');
    const langEl = li.querySelector('[class*="PrimaryLanguageName"]');
    return {
      fullName: seg[0] + "/" + seg[1],
      repoId: null, // org React 一覧では安定IDが取れない（改名追従は不可）
      owner: seg[0],
      name: seg[1],
      url: "https://github.com" + href,
      description: descEl ? descEl.textContent.trim() : "",
      language: langEl ? langEl.textContent.trim() : "",
      isPrivate,
      isFork: false,
      isArchived: false,
    };
  }

  // li 要素からリポジトリのメタデータを取り出す
  function extractRepoFromItem(li) {
    if (orgName()) return extractOrgRepo(li);
    // リポジトリ名リンク（/owner/repo の形を持つ最初のアンカー）
    let link =
      li.querySelector('a[itemprop="name codeRepository"]') ||
      li.querySelector("h3 a[href]") ||
      Array.from(li.querySelectorAll('a[href^="/"]')).find((a) => {
        const seg = a.getAttribute("href").split("?")[0].split("#")[0].split("/").filter(Boolean);
        return seg.length === 2;
      });
    if (!link) return null;

    const href = link.getAttribute("href").split("?")[0].split("#")[0];
    const seg = href.split("/").filter(Boolean);
    if (seg.length < 2) return null;
    const owner = seg[0];
    const name = seg[1];
    const fullName = owner + "/" + name;

    const descEl =
      li.querySelector('[itemprop="description"]') || li.querySelector("p.color-fg-muted");
    const description = descEl ? descEl.textContent.trim() : "";

    const langEl = li.querySelector('[itemprop="programmingLanguage"]');
    const language = langEl ? langEl.textContent.trim() : "";

    const labelText = li.textContent;
    const isPrivate = !!li.querySelector(".Label") && /Private/i.test(labelText)
      ? /Private/i.test((li.querySelector(".Label") || {}).textContent || "")
      : /\bPrivate\b/.test(labelText) && !/\bPublic\b.*\bPrivate\b/.test(labelText)
      ? false
      : li.classList.contains("private");
    const isFork = li.classList.contains("fork") || !!li.querySelector(".octicon-repo-forked");
    const isArchived = /Public archive|Archived/i.test(labelText);

    return {
      fullName,
      repoId: extractRepoId(li),
      owner,
      name,
      url: "https://github.com" + href,
      description,
      language,
      isPrivate: li.classList.contains("private") || isPrivate,
      isFork,
      isArchived,
    };
  }

  // ---- 言語色（よく使われる言語のみ。無ければグレー） ----
  const LANG_COLORS = {
    JavaScript: "#f1e05a",
    TypeScript: "#3178c6",
    Python: "#3572A5",
    Java: "#b07219",
    "C++": "#f34b7d",
    C: "#555555",
    "C#": "#178600",
    Go: "#00ADD8",
    Rust: "#dea584",
    Ruby: "#701516",
    PHP: "#4F5D95",
    Swift: "#F05138",
    Kotlin: "#A97BFF",
    Dart: "#00B4AB",
    HTML: "#e34c26",
    CSS: "#563d7c",
    Vue: "#41b883",
    Shell: "#89e051",
    "Jupyter Notebook": "#DA5B0B",
    Elixir: "#6e4a7e",
    Scala: "#c22d40",
    Haskell: "#5e5086",
    Lua: "#000080",
    "Objective-C": "#438eff",
  };

  function langColor(lang) {
    return LANG_COLORS[lang] || "#8b949e";
  }

  // ---- UI 構築 ----

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === "class") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function") {
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        } else if (k === "style" && typeof props[k] === "object") {
          Object.assign(node.style, props[k]);
        } else if (props[k] !== undefined && props[k] !== null) {
          node.setAttribute(k, props[k]);
        }
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function removeInjected() {
    document.querySelectorAll(".ghtg-tabbar, .ghtg-group-list").forEach((n) => n.remove());
  }

  function injectUI(container) {
    removeInjected();

    const tabbar = buildTabBar();
    container.parentNode.insertBefore(tabbar, container);

    const groupList = el("div", { class: "ghtg-group-list", style: { display: "none" } });
    container.parentNode.insertBefore(groupList, container.nextSibling);

    decorateNativeItems(container);
    // ネイティブ一覧がまだ見えているうちに左インデントを計測（グループ表示で隠れる前）
    if (orgName()) measureOrgInset(tabbar);
    applyActiveView(container, groupList);
    // タブバーとグループ一覧を、ネイティブのリポジトリ名の左端に揃える（Org のみ）
    if (orgName()) applyOrgInset(tabbar, groupList);
  }

  // Org の一覧は左にマーカー列ぶんのインデントがある。注入要素（タブバー/グループ一覧）の左を
  // ネイティブのリポジトリ名に合わせるためのインセットを計測（隠れて測れない時は前回値を再利用）。
  let orgInset = 0;
  function measureOrgInset(refEl) {
    const org = orgName();
    const anchor = Array.from(document.querySelectorAll('a[href^="/' + org + '/"]')).find((a) => {
      const seg = a.getAttribute("href").split("?")[0].split("#")[0].split("/").filter(Boolean);
      return seg.length === 2 && seg[0] === org && a.getBoundingClientRect().left > 0;
    });
    if (anchor && refEl) {
      const v = anchor.getBoundingClientRect().left - refEl.getBoundingClientRect().left;
      if (v > 0 && v < 200) orgInset = Math.round(v);
    }
    return orgInset;
  }
  function applyOrgInset(tabbar, groupList) {
    if (orgInset <= 0) return;
    const px = orgInset + "px";
    if (tabbar) {
      tabbar.style.paddingLeft = px;
      tabbar.style.paddingRight = px;
    }
    if (groupList) {
      groupList.style.paddingLeft = px;
      groupList.style.paddingRight = px;
    }
  }

  function buildTabBar() {
    const bar = el("div", { class: "ghtg-tabbar", role: "tablist" });

    const allTab = el("button", {
      class: "ghtg-tab" + (activeGroupId === "all" ? " ghtg-tab--active" : ""),
      type: "button",
      "data-group": "all",
      onClick: () => setActiveGroup("all"),
    }, [
      el("span", { class: "ghtg-tab-label", text: t("all_tab") }),
    ]);
    bar.appendChild(allTab);

    // 現在開いている所有者（user/org）のグループのみ表示
    ownerGroups().forEach((g) => {
      const count = Store.reposInGroup(state, g.id).length;
      const tab = el("button", {
        class: "ghtg-tab" + (activeGroupId === g.id ? " ghtg-tab--active" : ""),
        type: "button",
        "data-group": g.id,
        onClick: () => setActiveGroup(g.id),
      }, [
        el("span", { class: "ghtg-dot", style: { background: g.color } }),
        el("span", { class: "ghtg-tab-label", text: g.name }),
        el("span", { class: "ghtg-tab-count", text: String(count) }),
      ]);
      bar.appendChild(tab);
    });

    // ＋ 新規グループ
    const addBtn = el("button", {
      class: "ghtg-tab ghtg-tab-add",
      type: "button",
      title: t("new_group_tab_title"),
      onClick: async (e) => {
        e.preventDefault();
        if (!Store.canAddGroup(state)) {
          alert(t("limit_sync_bytes"));
          return;
        }
        const name = prompt(t("prompt_new_group"));
        if (name && name.trim()) {
          await Store.createGroup(name.trim(), null, currentOwner());
        }
      },
    }, [el("span", { class: "ghtg-tab-label", text: t("add_group_tab") })]);
    bar.appendChild(addBtn);

    // ⚙ グループ管理（編集・並べ替え・削除）をページ内で開くリンク。グループが1つ以上ある時だけ表示
    if (ownerGroups().length > 0) {
      const manageBtn = el("button", {
        class: "ghtg-tab ghtg-tab-manage",
        type: "button",
        title: t("manage_groups_tooltip"),
        "aria-label": t("manage_groups_tooltip"),
        onClick: (e) => {
          e.preventDefault();
          e.stopPropagation();
          onManageBtnClick(manageBtn);
        },
      }, [
        svgIcon(GEAR_ICON_PATH, "ghtg-octicon"),
        el("span", { class: "ghtg-tab-label", text: t("manage_groups") }),
      ]);
      bar.appendChild(manageBtn);
      // 管理モーダルを開いたまま再描画された場合、アンカーを新しいボタンへ付け替える
      // （外側クリック判定の対象を最新にし、開閉トグルのちらつきを防ぐ）
      if (openMenu && openMenu.classList && openMenu.classList.contains("ghtg-manage")) {
        openMenuAnchor = manageBtn;
      }
    }

    // グループ選択中は、並べ替えをタブバー右側に配置（.ghtg-sort は margin-left:auto で右寄せ）
    if (activeGroupId !== "all" && Store.reposInGroup(state, activeGroupId).length > 0) {
      bar.appendChild(buildSortControl());
    }

    return bar;
  }

  // ネイティブのリポジトリ行に「グループ」割り当てボタンとバッジを付ける
  function decorateNativeItems(container) {
    const items = findRepoItems(container);
    const rows = [];
    items.forEach((li) => {
      const meta = extractRepoFromItem(li);
      if (!meta) return;
      rows.push(meta);
      li.dataset.ghtgFullname = meta.fullName;

      // 既存の装飾を消して付け直す（再描画時の重複防止・旧版からの移行クリーンアップ）
      li.querySelectorAll(
        ".ghtg-row-tools, .ghtg-star-btn, .ghtg-org-btn, .ghtg-org-iconbtn, " +
          ".ghtg-org-sep, .ghtg-chip-row, .ghtg-org-chip-row, .ghtg-meta-chip"
      ).forEach((n) => n.remove());

      const memberIds = Store.groupsForRepo(state, meta.fullName);

      if (orgName()) {
        // Organization（React）: 行に独自スタイルの「グループ」ボタン＋チップ
        injectOrgButton(li, meta, memberIds);
        if (memberIds.length) injectOrgChipRow(li, memberIds);
      } else {
        // プロフィール: Star の左隣に同スタイルのボタン＋言語行の上にチップ
        injectStarButton(li, meta, memberIds);
        if (memberIds.length) injectChipRow(li, memberIds);
      }
    });

    // プロフィール: 数値IDで照合し改名追従＋メタ更新。
    // Org: 安定IDが無いので fullName ベースで既存メンバーの説明/言語/公開状態を充実させる。
    if (orgName()) Store.refreshRepoMeta(rows);
    else Store.syncVisibleRepos(rows);
  }

  // 割り当てボタン共通: 同じボタン再クリックでトグル開閉
  function onAssignBtnClick(btn, meta, e) {
    e.preventDefault();
    e.stopPropagation();
    if (openMenu && openMenuAnchor === btn) closeAssignMenu();
    else openAssignMenu(btn, meta);
  }

  // Compact 密度かどうか（MetadataContainer は Compact の単一行メタ領域）
  function orgIsCompact(li) {
    return !!li.querySelector('[class*="MetadataContainer"]');
  }

  // Org 行の言語/統計行（言語チップ・各統計・歯車を含む行）。Comfortable=LabelsContainer。
  function orgMetaRow(li) {
    return (
      li.querySelector('[class*="LabelsContainer"]') ||
      li.querySelector('[class*="MetadataContainer"]') ||
      (li.querySelector('[class*="LanguageLabelContainer"]') || {}).parentElement ||
      null
    );
  }

  // Organization 行: 歯車の「次」に、アイコン＋所属グループ数のボタンを続ける。
  // fork/issue などの IconLabel（アイコン＋数字）に倣う。両密度対応。
  function injectOrgButton(li, meta, memberIds) {
    const assigned = memberIds.length > 0;
    const btn = el("button", {
      class: "ghtg-org-iconbtn" + (assigned ? " ghtg-org-iconbtn--active" : ""),
      type: "button",
      title: assigned
        ? t("assigned_tooltip_prefix") + groupNames(memberIds).join(", ")
        : t("assign_tooltip"),
      "aria-label": t("assign_tooltip"),
      onClick: (e) => onAssignBtnClick(btn, meta, e),
    }, [
      tagIconSvg(),
      el("span", { class: "ghtg-org-iconbtn-count", text: String(memberIds.length) }),
    ]);

    const gear = li.querySelector('a[href$="/settings"]');
    if (gear && gear.parentNode) {
      // メタ行が「・」区切りを使う（Comfortable）なら同じく区切りを挟む。
      const usesBullets = Array.from(gear.parentNode.children).some(
        (c) => c.textContent.trim() === "•"
      );
      if (usesBullets) {
        const sep = el("span", { class: "ghtg-org-sep", text: "•" });
        gear.parentNode.insertBefore(sep, gear.nextSibling);
        gear.parentNode.insertBefore(btn, sep.nextSibling);
      } else {
        btn.classList.add("ghtg-org-iconbtn--spaced");
        gear.parentNode.insertBefore(btn, gear.nextSibling);
      }
      return;
    }
    const metaRow = orgMetaRow(li);
    if (metaRow) metaRow.appendChild(btn);
    else (li.querySelector("[data-listview-item-title-container]") || li).appendChild(btn);
  }

  // Organization 行: 所属グループチップを言語/統計行の「上」に独立行で（言語チップと同じ見た目）。
  // Compact（単一行）はスペースが無いため出さず、アイコンの件数で所属を示す。
  function injectOrgChipRow(li, memberIds) {
    if (orgIsCompact(li)) return;
    const groups = memberIds
      .map((id) => state.groups.find((g) => g.id === id))
      .filter(Boolean);
    if (!groups.length) return;
    const chips = groups.map((g) =>
      el("span", { class: "ghtg-org-chip", title: t("group_label") + ": " + g.name }, [
        el("span", { class: "ghtg-org-chip-dot", style: { backgroundColor: g.color } }),
        el("span", { class: "ghtg-org-chip-label", text: g.name }),
      ])
    );
    const row = el("div", { class: "ghtg-org-chip-row" }, chips);
    const metaRow = orgMetaRow(li);
    if (metaRow && metaRow.parentNode) {
      metaRow.parentNode.insertBefore(row, metaRow); // 言語行の直前（上）
    } else {
      const titleC = li.querySelector("[data-listview-item-title-container]");
      if (titleC && titleC.parentNode) titleC.parentNode.insertBefore(row, titleC.nextSibling);
      else li.appendChild(row);
    }
  }

  // Star ボタン群（.starring-container）の先頭に、GitHub 純正 .btn スタイルの
  // 「グループ」ボタンを挿入する。なければ名前ブロック横にフォールバック。
  function injectStarButton(li, meta, memberIds) {
    const assigned = memberIds.length > 0;
    const btn = el("button", {
      // BtnGroup-item は付けない（単独ボタンとして全方向に角丸＋標準の .btn:hover）
      class: "btn btn-sm ghtg-star-btn" + (assigned ? " ghtg-star-btn--active" : ""),
      type: "button",
      title: assigned
        ? t("assigned_tooltip_prefix") + groupNames(memberIds).join(", ")
        : t("assign_tooltip"),
      "aria-label": t("assign_tooltip"),
      onClick: (e) => onAssignBtnClick(btn, meta, e),
    }, [
      tagIconSvg(),
      el("span", { class: "ghtg-star-btn-label", text: t("group_label") }),
      assigned
        ? el("span", { class: "ghtg-star-btn-count", text: String(memberIds.length) })
        : null,
    ]);

    const starWrap = li.querySelector(".starring-container");
    if (starWrap) {
      starWrap.insertBefore(btn, starWrap.firstChild);
      return;
    }
    // フォールバック: Star が見つからなければ名前ブロック横に置く
    const tools = el("div", { class: "ghtg-row-tools" }, [btn]);
    const anchor = li.querySelector("h3") || li.firstElementChild || li;
    if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(tools, anchor.nextSibling);
    else li.appendChild(tools);
  }

  function groupNames(ids) {
    return ids.map((id) => (state.groups.find((g) => g.id === id) || {}).name).filter(Boolean);
  }

  // 所属グループのチップを、言語/更新日のメタ行の「上」に独立した1行として挿入する。
  // （言語チップとの混同を避けるため、ラベル風のピルで別行に出す）
  function injectChipRow(li, memberIds) {
    const langEl = li.querySelector('[itemprop="programmingLanguage"]');
    const relEl = li.querySelector("relative-time");
    const metaRow =
      (langEl && langEl.closest("div")) ||
      (relEl && relEl.closest("div")) ||
      li.querySelector(".f6.color-fg-muted");
    const groups = memberIds
      .map((id) => state.groups.find((g) => g.id === id))
      .filter(Boolean);
    if (!groups.length) return;

    // 主要言語チップと同じ見た目（repo-language-color ドット ＋ 空白 ＋ 文字）に揃える
    const chips = groups.map((g) =>
      el("span", { class: "ghtg-chip", title: t("group_label") + ": " + g.name }, [
        el("span", {
          class: "repo-language-color ghtg-chip-dot",
          style: { backgroundColor: g.color },
        }),
        " ",
        el("span", { class: "ghtg-chip-label", text: g.name }),
      ])
    );
    const row = el("div", { class: "ghtg-chip-row" }, chips);

    if (metaRow && metaRow.parentNode) {
      // メタ行の直前（＝言語行の上）に独立した行として差し込む
      metaRow.parentNode.insertBefore(row, metaRow);
    } else {
      // フォールバック: メタ行が無ければ名前の下に置く
      const anchor = li.querySelector("h3") || li.firstElementChild || li;
      if (anchor && anchor.parentNode) anchor.parentNode.insertBefore(row, anchor.nextSibling);
      else li.appendChild(row);
    }
  }

  // 閉じる(×)アイコン
  const X_ICON_PATH =
    "M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.749.749 0 0 1 1.275.326.749.749 0 0 1" +
    "-.215.734L9.06 8l3.22 3.22a.749.749 0 0 1-.326 1.275.749.749 0 0 1-.734-.215L8 9.06l-3.22 " +
    "3.22a.751.751 0 0 1-1.042-.018.751.751 0 0 1-.018-1.042L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z";
  // 管理（歯車）アイコン
  const GEAR_ICON_PATH =
    "M8 0a8.2 8.2 0 0 1 .701.031C9.444.095 9.99.645 10.16 1.29l.288 1.107c.018.066.079.158.212." +
    "224.231.114.454.243.668.386.123.082.233.09.299.071l1.103-.303c.644-.176 1.392.021 1.82.63." +
    "27.385.506.792.704 1.218.315.675.111 1.422-.364 1.891l-.814.806c-.049.048-.098.147-.088.294." +
    "016.257.016.515 0 .772-.01.147.039.246.088.294l.814.806c.475.469.679 1.216.364 1.891a7.977 " +
    "7.977 0 0 1-.704 1.217c-.428.61-1.176.807-1.82.63l-1.103-.302c-.066-.019-.176-.011-.299.071a" +
    "4.909 4.909 0 0 1-.668.386c-.133.066-.194.158-.212.224l-.288 1.106c-.17.646-.716 1.196-1.459 " +
    "1.26a8.006 8.006 0 0 1-1.402 0c-.743-.064-1.289-.614-1.459-1.26l-.288-1.106c-.018-.066-.079-." +
    "158-.212-.224a4.738 4.738 0 0 1-.668-.386c-.123-.082-.233-.09-.299-.071l-1.103.303c-.644.175-" +
    "1.392-.021-1.82-.63a8.12 8.12 0 0 1-.704-1.218c-.315-.675-.111-1.422.364-1.891l.814-.806c.049" +
    "-.048.098-.147.088-.294a6.214 6.214 0 0 1 0-.772c.01-.147-.039-.246-.088-.294l-.814-.806C.635 " +
    "6.045.431 5.298.746 4.623a7.92 7.92 0 0 1 .704-1.217c.428-.61 1.176-.807 1.82-.63l1.103.302c." +
    "066.019.176.011.299-.071.214-.143.437-.272.668-.386.133-.066.194-.158.212-.224L5.84 1.29C6.01" +
    ".645 6.556.095 7.299.03 7.53.01 7.764 0 8 0Zm-.571 1.525c-.036.003-.108.036-.137.146l-.289 " +
    "1.105c-.147.561-.549.967-.998 1.189-.173.086-.34.183-.5.29-.417.278-.97.423-1.529.27l-1.103-." +
    "303c-.109-.03-.176.016-.196.045-.22.312-.412.644-.573.99-.014.031-.021.11.059.19l.815.806c." +
    "411.406.562.96.53 1.456a4.709 4.709 0 0 0 0 .582c.032.495-.119 1.05-.53 1.456l-.815.806c-." +
    "081.08-.073.159-.059.19.162.346.353.677.573.989.02.03.085.076.196.046l1.103-.303c.559-.153 " +
    "1.112-.008 1.529.27.16.107.327.204.5.29.449.222.851.628.998 1.189l.289 1.105c.029.109.101." +
    "143.137.146a6.6 6.6 0 0 0 1.142 0c.036-.003.108-.037.137-.146l.289-1.105c.147-.561.549-.967." +
    "998-1.189.173-.086.34-.183.5-.29.417-.278.97-.423 1.529-.27l1.103.303c.109.029.176-.016.196-." +
    "045.22-.313.411-.644.573-.99.014-.031.021-.11-.059-.19l-.815-.806c-.411-.406-.562-.96-.53-" +
    "1.456a4.709 4.709 0 0 0 0-.582c-.032-.495.119-1.05.53-1.456l.815-.806c.081-.08.073-.159.059-." +
    "19a6.464 6.464 0 0 0-.573-.989c-.02-.03-.085-.076-.196-.046l-1.103.303c-.559.153-1.112.008-" +
    "1.529-.27a3.39 3.39 0 0 0-.5-.29c-.449-.222-.851-.628-.998-1.189l-.289-1.105c-.029-.11-.101-." +
    "143-.137-.146a6.6 6.6 0 0 0-1.142 0ZM11 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9.5 8a1.5 1.5 0 1 0-3." +
    "001.001A1.5 1.5 0 0 0 9.5 8Z";
  function svgIcon(pathD, cls) {
    const NS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 16 16");
    svg.setAttribute("width", "16");
    svg.setAttribute("height", "16");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("class", "octicon " + (cls || ""));
    svg.setAttribute("fill", "currentColor");
    const path = document.createElementNS(NS, "path");
    path.setAttribute("d", pathD);
    svg.appendChild(path);
    return svg;
  }

  // 割り当てメニュー（GitHub 純正 Lists ダイアログを Primer クラスで再現）
  let openMenu = null;
  let openMenuAnchor = null;
  let openMenuMeta = null;
  function closeAssignMenu() {
    if (openMenu) {
      openMenu.remove();
      openMenu = null;
      openMenuAnchor = null;
      openMenuMeta = null;
      document.removeEventListener("click", onDocClickForMenu, true);
      document.removeEventListener("keydown", onKeyForMenu, true);
    }
  }

  // メニュー本文（このリポジトリの所有者のグループの ActionList）を生成
  function buildAssignList(meta) {
    const memberIds = new Set(Store.groupsForRepo(state, meta.fullName));
    const ownerGroupList = Store.groupsForOwner(state, meta.owner);
    const list = el("ul", { class: "ghtg-ol-list" });
    if (ownerGroupList.length === 0) {
      list.appendChild(el("li", { class: "ghtg-ol-empty", text: t("no_groups_menu") }));
    }
    ownerGroupList.forEach((g) => {
      const checked = memberIds.has(g.id);
      const item = el("li", { class: "ghtg-ol-item" + (checked ? " ghtg-ol-item--on" : "") }, [
        el("label", { class: "ghtg-ol-content" }, [
          el("span", { class: "ghtg-ol-lead" }, [
            el("input", {
              type: "checkbox",
              class: "ghtg-ol-check",
              ...(checked ? { checked: "checked" } : {}),
              onChange: (e) => {
                if (e.target.checked && !Store.canAddRepoToGroup(state, g.id)) {
                  e.target.checked = false;
                  alert(t("limit_sync_bytes"));
                  return;
                }
                Store.toggleRepoInGroup(meta, g.id);
              },
            }),
          ]),
          el("span", {
            class: "repo-language-color ghtg-ol-dot",
            style: { backgroundColor: g.color },
          }),
          el("span", { class: "ghtg-ol-label", text: g.name }),
        ]),
      ]);
      list.appendChild(item);
    });
    return list;
  }

  // 開いているメニューの一覧を最新の状態で描き直す（グループ作成・トグル後など）
  function refreshAssignMenu() {
    if (!openMenu || !openMenuMeta) return;
    const body = openMenu.querySelector(".ghtg-ol-body");
    const existing = body && body.querySelector(".ghtg-ol-list");
    if (!body || !existing) return;
    body.replaceChild(buildAssignList(openMenuMeta), existing);
  }
  function onDocClickForMenu(e) {
    // メニュー内・アンカーボタンのクリックは閉じない（ボタンはトグル用）
    if (!openMenu) return;
    if (openMenu.contains(e.target)) return;
    if (openMenuAnchor && openMenuAnchor.contains(e.target)) return;
    closeAssignMenu();
  }
  function menuFocusables() {
    if (!openMenu) return [];
    return Array.from(
      openMenu.querySelectorAll(
        'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )
    ).filter((n) => !n.disabled && n.offsetParent !== null);
  }
  function onKeyForMenu(e) {
    if (e.key === "Escape") {
      closeAssignMenu();
      if (openMenuAnchor) openMenuAnchor.focus();
      return;
    }
    // フォーカストラップ（Tab がメニュー外へ出ないように循環）
    if (e.key === "Tab" && openMenu) {
      const f = menuFocusables();
      if (!f.length) return;
      const first = f[0];
      const last = f[f.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  }

  function openAssignMenu(anchorBtn, meta) {
    closeAssignMenu();

    // ---- ヘッダー（タイトル + 閉じる）----
    const closeBtn = el("button", {
      class: "close-button Overlay-closeButton",
      type: "button",
      "aria-label": t("close"),
      onClick: closeAssignMenu,
    }, [svgIcon(X_ICON_PATH)]);
    const header = el("div", { class: "Overlay-header" }, [
      el("div", { class: "Overlay-headerContentWrap" }, [
        el("div", { class: "Overlay-titleWrap" }, [
          el("h1", { class: "Overlay-title ghtg-ol-title", text: t("menu_title") }),
          el("span", { class: "Overlay-description ghtg-ol-desc", text: meta.fullName }),
        ]),
        el("div", { class: "Overlay-actionWrap" }, [closeBtn]),
      ]),
    ]);

    // ---- 本文（このリポジトリの所有者のグループのみ）----
    const body = el("div", { class: "Overlay-body ghtg-ol-body" }, [buildAssignList(meta)]);

    // ---- フッター（新規グループ作成）----
    const input = el("input", {
      class: "ghtg-ol-input form-control",
      type: "text",
      placeholder: t("new_group_placeholder"),
      onKeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          createAndAssign(input, meta);
        }
        // メニュー内のキー入力で Esc 以外は伝播を止める
        e.stopPropagation();
      },
    });
    const createBtn = el("button", {
      class: "btn btn-sm btn-primary ghtg-ol-create",
      type: "button",
      text: t("create"),
      onClick: () => createAndAssign(input, meta),
    });
    const footer = el("div", { class: "Overlay-footer ghtg-ol-footer" }, [input, createBtn]);

    const menu = el("div", {
      class: "Overlay Overlay--size-small ghtg-overlay",
      role: "dialog",
      "aria-label": t("menu_title"),
    }, [header, body, footer]);

    document.body.appendChild(menu);
    positionMenu(menu, anchorBtn);

    openMenu = menu;
    openMenuAnchor = anchorBtn;
    openMenuMeta = meta;
    // 開いたら最初の操作要素にフォーカス（既存グループのチェック or 作成欄）
    const firstFocusable = menu.querySelector(".ghtg-ol-check") || input;
    if (firstFocusable) firstFocusable.focus();
    setTimeout(() => {
      document.addEventListener("click", onDocClickForMenu, true);
      document.addEventListener("keydown", onKeyForMenu, true);
    }, 0);
  }

  async function createAndAssign(input, meta) {
    const name = input.value.trim();
    if (!name) return;
    if (!Store.canAddGroup(state)) {
      alert(t("limit_sync_bytes"));
      return;
    }
    const next = await Store.createGroup(name, null, meta.owner);
    const owned = Store.groupsForOwner(next, meta.owner);
    const created = owned[owned.length - 1];
    if (created) await Store.toggleRepoInGroup(meta, created.id);
    input.value = "";
    input.focus();
  }

  function positionMenu(menu, anchorBtn) {
    const rect = anchorBtn.getBoundingClientRect();
    const menuWidth = 300;
    const top = rect.bottom + window.scrollY + 6;
    let left = rect.right + window.scrollX - menuWidth; // ボタン右端に揃える
    const maxLeft = window.scrollX + document.documentElement.clientWidth - menuWidth - 12;
    if (left > maxLeft) left = maxLeft;
    left = Math.max(8, left);
    // GitHub の .Overlay が持つ位置指定(!important)に勝つため inline !important で上書き
    menu.style.setProperty("top", top + "px", "important");
    menu.style.setProperty("left", left + "px", "important");
    menu.style.setProperty("right", "auto", "important");
    menu.style.setProperty("bottom", "auto", "important");
  }

  // ===== グループ管理モーダル（ページ内で編集・並べ替え・削除・新規作成）=====
  // 割り当てメニューと同じ openMenu スロット／開閉ハンドラを共有する（同時に1つだけ開く）。
  function onManageBtnClick(btn) {
    // 開いている管理モーダルがあればトグルで閉じる（再描画でアンカーが差し替わっても確実に判定）
    if (openMenu && openMenu.classList.contains("ghtg-manage")) closeAssignMenu();
    else openManageMenu(btn);
  }

  // 現在の所有者のグループ行（色・名前・件数・上下移動・削除）を生成
  function buildManageList() {
    const owner = currentOwner();
    const groups = Store.groupsForOwner(state, owner);
    const list = el("ul", { class: "ghtg-mg-list" });
    if (groups.length === 0) {
      list.appendChild(el("li", { class: "ghtg-mg-empty", text: t("popup_no_groups") }));
      return list;
    }
    groups.forEach((g, idx) => {
      const count = Store.reposInGroup(state, g.id).length;
      const colorInput = el("input", {
        type: "color",
        value: g.color,
        class: "ghtg-mg-color",
        title: t("popup_change_color"),
        "aria-label": t("popup_change_color"),
        onChange: (e) => Store.setGroupColor(g.id, e.target.value),
      });
      const nameInput = el("input", {
        type: "text",
        value: g.name,
        class: "ghtg-mg-name",
        onChange: (e) => Store.renameGroup(g.id, e.target.value),
        onKeydown: (e) => {
          if (e.key === "Enter") e.target.blur(); // Enter で確定（change を発火）
          e.stopPropagation();
        },
      });
      const up = el("button", {
        class: "ghtg-mg-move",
        type: "button",
        title: t("popup_move_up"),
        "aria-label": t("popup_move_up"),
        ...(idx === 0 ? { disabled: "disabled" } : {}),
        onClick: () => manageMove(idx, idx - 1),
      }, [el("span", { class: "ghtg-mg-arrow", text: "↑" })]);
      const down = el("button", {
        class: "ghtg-mg-move",
        type: "button",
        title: t("popup_move_down"),
        "aria-label": t("popup_move_down"),
        ...(idx === groups.length - 1 ? { disabled: "disabled" } : {}),
        onClick: () => manageMove(idx, idx + 1),
      }, [el("span", { class: "ghtg-mg-arrow", text: "↓" })]);
      const del = el("button", {
        class: "ghtg-mg-del",
        type: "button",
        title: t("popup_delete"),
        "aria-label": t("popup_delete"),
        onClick: () => {
          if (confirm(t("popup_confirm_delete", g.name))) Store.deleteGroup(g.id);
        },
      }, [svgIcon(X_ICON_PATH, "ghtg-octicon")]);
      list.appendChild(
        el("li", { class: "ghtg-mg-item" }, [
          colorInput,
          nameInput,
          el("span", { class: "ghtg-mg-count", text: String(count) }),
          el("span", { class: "ghtg-mg-actions" }, [up, down, del]),
        ])
      );
    });
    return list;
  }

  function manageMove(from, to) {
    const ids = Store.groupsForOwner(state, currentOwner()).map((g) => g.id);
    if (to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    Store.reorderGroups(ids);
  }

  async function createFromManage(input) {
    const name = input.value.trim();
    if (!name) return;
    if (!Store.canAddGroup(state)) {
      alert(t("limit_sync_bytes"));
      return;
    }
    await Store.createGroup(name, null, currentOwner());
    input.value = "";
    input.focus();
  }

  // 開いている管理モーダルの一覧を最新化（作成・削除・並べ替え後）
  function refreshManageMenu() {
    if (!openMenu) return;
    const body = openMenu.querySelector(".ghtg-mg-body");
    if (!body) return;
    const existing = body.querySelector(".ghtg-mg-list");
    const list = buildManageList();
    if (existing) body.replaceChild(list, existing);
    else body.appendChild(list);
  }

  function openManageMenu(anchorBtn) {
    closeAssignMenu();
    const owner = currentOwner();

    const closeBtn = el("button", {
      class: "close-button Overlay-closeButton",
      type: "button",
      "aria-label": t("close"),
      onClick: closeAssignMenu,
    }, [svgIcon(X_ICON_PATH)]);
    const header = el("div", { class: "Overlay-header" }, [
      el("div", { class: "Overlay-headerContentWrap" }, [
        el("div", { class: "Overlay-titleWrap" }, [
          el("h1", { class: "Overlay-title ghtg-ol-title", text: t("manage_groups_title") }),
          el("span", { class: "Overlay-description ghtg-ol-desc", text: owner ? "@" + owner : "" }),
        ]),
        el("div", { class: "Overlay-actionWrap" }, [closeBtn]),
      ]),
    ]);

    const body = el("div", { class: "Overlay-body ghtg-mg-body" }, [buildManageList()]);

    // フッター（新規グループ作成）
    const input = el("input", {
      class: "ghtg-ol-input form-control",
      type: "text",
      placeholder: t("new_group_placeholder"),
      onKeydown: (e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          createFromManage(input);
        }
        e.stopPropagation();
      },
    });
    const createBtn = el("button", {
      class: "btn btn-sm btn-primary ghtg-ol-create",
      type: "button",
      text: t("create"),
      onClick: () => createFromManage(input),
    });
    const footer = el("div", { class: "Overlay-footer ghtg-ol-footer" }, [input, createBtn]);

    const menu = el("div", {
      class: "Overlay Overlay--size-small ghtg-overlay ghtg-manage",
      role: "dialog",
      "aria-label": t("manage_groups_title"),
    }, [header, body, footer]);

    document.body.appendChild(menu);
    positionManageMenu(menu);

    openMenu = menu;
    openMenuAnchor = anchorBtn;
    openMenuMeta = null;
    const first = menu.querySelector(".ghtg-mg-name") || input;
    if (first) first.focus();
    setTimeout(() => {
      document.addEventListener("click", onDocClickForMenu, true);
      document.addEventListener("keydown", onKeyForMenu, true);
    }, 0);
  }

  // 管理モーダルはビューポート上部中央に固定的に配置（アンカー非依存）
  function positionManageMenu(menu) {
    const width = 360;
    const vw = document.documentElement.clientWidth;
    const left = window.scrollX + Math.max(12, Math.round((vw - width) / 2));
    const top = window.scrollY + 72;
    menu.style.setProperty("width", width + "px", "important");
    menu.style.setProperty("top", top + "px", "important");
    menu.style.setProperty("left", left + "px", "important");
    menu.style.setProperty("right", "auto", "important");
    menu.style.setProperty("bottom", "auto", "important");
  }

  // 並べ替えセレクトの選択肢（key:dir の複合値）。言語切替に追従するため関数で生成。
  function sortOptions() {
    return [
      { value: "name:asc", label: t("sort_name_asc") },
      { value: "name:desc", label: t("sort_name_desc") },
      { value: "added:desc", label: t("sort_added_desc") },
      { value: "added:asc", label: t("sort_added_asc") },
      { value: "language:asc", label: t("sort_language") },
    ];
  }

  function buildSortControl() {
    const cur = (state.sort && state.sort.key + ":" + state.sort.dir) || "name:asc";
    const select = el("select", {
      class: "ghtg-sort-select",
      title: t("sort_label"),
      onChange: (e) => {
        const [key, dir] = e.target.value.split(":");
        Store.setSort(key, dir);
      },
    });
    sortOptions().forEach((o) => {
      const opt = el("option", { value: o.value, text: o.label });
      if (o.value === cur) opt.setAttribute("selected", "selected");
      select.appendChild(opt);
    });
    return el("label", { class: "ghtg-sort" }, [
      el("span", { class: "ghtg-sort-label", text: t("sort_label") }),
      select,
    ]);
  }

  // グループ一覧（カスタム描画）。Org の Compact 密度では 1 行の凝縮表示にする。
  let lastGroupDensity = null;
  function renderGroupList(groupList, group) {
    groupList.innerHTML = "";
    const repos = Store.reposInGroup(state, group.id);
    const compact = orgDensity() === "compact";
    lastGroupDensity = orgDensity();

    // グループ名はタブバーの選択状態で分かるため見出しは省略。
    // 並べ替えはタブバー右側に配置する（buildTabBar 側）。
    if (repos.length === 0) {
      groupList.appendChild(
        el("div", { class: "ghtg-glist-empty" }, [
          el("p", { text: t("empty_group_1") }),
          el("p", { class: "ghtg-glist-empty-sub", text: t("empty_group_2") }),
        ])
      );
      return;
    }

    const ul = el("ul", { class: "ghtg-glist" + (compact ? " ghtg-glist--compact" : "") });
    repos.forEach((r) => {
      const badges = [];
      if (r.isPrivate) badges.push(el("span", { class: "ghtg-badge", text: "Private" }));
      if (r.isFork) badges.push(el("span", { class: "ghtg-badge", text: "Fork" }));
      if (r.isArchived) badges.push(el("span", { class: "ghtg-badge ghtg-badge--archived", text: "Archived" }));

      const lang = r.language
        ? el("span", { class: "ghtg-glist-lang" }, [
            el("span", { class: "ghtg-lang-dot", style: { background: langColor(r.language) } }),
            document.createTextNode(r.language),
          ])
        : null;

      // 他グループへの追加用ボタン（「すべて」タブと同じ割り当てメニューを開く）
      const assignBtn = el("button", {
        class: "ghtg-glist-assign",
        type: "button",
        title: t("assign_tooltip"),
        "aria-label": t("assign_tooltip"),
        onClick: (e) => onAssignBtnClick(assignBtn, r, e),
      }, [tagIconSvg()]);

      const removeBtn = el("button", {
        class: "ghtg-glist-remove",
        type: "button",
        title: t("remove_tooltip"),
        "aria-label": t("remove_tooltip"),
        onClick: async (e) => {
          e.preventDefault();
          await Store.toggleRepoInGroup(r, group.id);
        },
      }, [svgIcon(X_ICON_PATH, "ghtg-octicon")]);

      // 削除ボタンの左隣にグループ追加ボタンを置き、右寄せでまとめる
      const actions = el("span", { class: "ghtg-glist-actions" }, [assignBtn, removeBtn]);

      let li;
      if (compact) {
        // Compact: 1 行（名前・説明・言語・操作）
        li = el("li", { class: "ghtg-glist-item" }, [
          el("div", { class: "ghtg-glist-row" }, [
            el("a", { class: "ghtg-glist-name", href: r.url, text: r.name || String(r.fullName || "").split("/").pop() }),
            ...badges,
            r.description
              ? el("span", { class: "ghtg-glist-desc-inline", text: r.description })
              : null,
            lang,
            actions,
          ]),
        ]);
      } else {
        // Comfortable: 名前＋バッジ＋操作 / 説明 / 言語
        li = el("li", { class: "ghtg-glist-item" }, [
          el("div", { class: "ghtg-glist-row" }, [
            el("a", { class: "ghtg-glist-name", href: r.url, text: r.name || String(r.fullName || "").split("/").pop() }),
            ...badges,
            actions,
          ]),
          r.description ? el("p", { class: "ghtg-glist-desc", text: r.description }) : null,
          lang ? el("div", { class: "ghtg-glist-meta" }, [lang]) : null,
        ]);
      }
      ul.appendChild(li);
    });
    groupList.appendChild(ul);
  }

  // Organization ページのネイティブ「件数」「ソート」要素（密度トグルは残す）。CSS-module ハッシュは可変なので部分一致で取得
  function orgCountSortEls() {
    if (!orgName()) return [];
    const els = [];
    const heading = document.querySelector('[class*="Metadata-module__heading"]'); // 「N repositories」
    if (heading) els.push(heading);
    const sortBtn = document.querySelector('[class*="SortingDropdown-module__sortDropdownButton"]'); // 「Last pushed」など
    if (sortBtn) els.push(sortBtn.closest("div") || sortBtn); // ボタン外側のラッパ（余白）ごと隠す
    return els;
  }
  // グループ表示中はネイティブの件数・ソートが意味を持たないので隠す（表示密度トグルは維持。「すべて」で復帰）
  function applyOrgMetaBar(hidden) {
    orgCountSortEls().forEach((el) => {
      el.style.display = hidden ? "none" : "";
    });
  }

  function applyActiveView(container, groupList) {
    // 「すべて」= ネイティブ一覧、グループ = 保存データから独自描画（全メンバーをページ非依存で表示）
    if (activeGroupId === "all") {
      container.style.display = "";
      groupList.style.display = "none";
      applyOrgMetaBar(false);
    } else {
      const group = state.groups.find((g) => g.id === activeGroupId);
      if (!group) {
        activeGroupId = "all";
        container.style.display = "";
        groupList.style.display = "none";
        applyOrgMetaBar(false);
        applyTitle();
        return;
      }
      container.style.display = "none";
      groupList.style.display = "block";
      applyOrgMetaBar(true);
      renderGroupList(groupList, group);
    }
    applyTitle();
  }

  function setActiveGroup(id) {
    activeGroupId = id;
    applyUrl(id);
    rerender();
  }

  // ---- ブックマーク用 URL クエリパラメータ ----

  // 指定グループを URL の ?ghtg= に反映（リロードなし。'all' なら除去）
  function applyUrl(id) {
    try {
      const url = new URL(location.href);
      if (id && id !== "all") url.searchParams.set(URL_PARAM, id);
      else url.searchParams.delete(URL_PARAM);
      history.replaceState(history.state, "", url.toString());
      lastUrl = location.href; // 自分の変更はポーラに拾わせない
    } catch (e) {
      /* ignore */
    }
  }

  function readGroupFromUrl() {
    try {
      return new URL(location.href).searchParams.get(URL_PARAM) || "all";
    } catch (e) {
      return "all";
    }
  }

  // URL の値を検証（存在しない、または現在の所有者以外のグループIDなら 'all'）
  function validateGroup(id) {
    if (id === "all") return "all";
    const owner = currentOwner();
    return state.groups.some((g) => g.id === id && g.owner === owner) ? id : "all";
  }

  // ---- ページタイトル（ブックマーク名に反映させる） ----
  function applyTitle() {
    const group =
      activeGroupId !== "all" && state.groups.find((g) => g.id === activeGroupId);
    if (group) {
      if (!titleOverridden) baseTitle = document.title; // GitHub のタイトルを退避
      document.title = group.name + " · " + baseTitle;
      titleOverridden = true;
    } else if (titleOverridden) {
      document.title = baseTitle;
      titleOverridden = false;
    }
  }

  // 状態が変わったら UI を作り直す
  function rerender() {
    const container = findListContainer();
    if (!container) return;
    injectUI(container);
  }

  // ---- 初期化・再注入 ----

  function isRepoListPage() {
    return !!findListContainer();
  }

  // URL だけで「リポジトリ一覧ページ候補」か判定する（DOM 描画前でも判定可能）。
  // MutationObserver をこのページ群に限定し、無関係な github.com ページでの常駐コストを避ける。
  function isRepoListUrl() {
    if (/^\/orgs\/[^/]+\/repositories\/?$/.test(location.pathname)) return true; // Org
    const seg = location.pathname.split("/").filter(Boolean);
    if (seg.length === 1) {
      try {
        return new URLSearchParams(location.search).get("tab") === "repositories"; // プロフィール
      } catch (e) {
        return false;
      }
    }
    return false;
  }

  function tryInit() {
    const container = findListContainer();
    if (!container) return;
    // 既に注入済み（同じ container）ならスキップ
    if (container.dataset.ghtgInjected === "1" && document.querySelector(".ghtg-tabbar")) return;
    container.dataset.ghtgInjected = "1";
    // URL に ?ghtg= があればそのグループを初期表示（ブックマーク対応）
    activeGroupId = validateGroup(readGroupFromUrl());
    injectUI(container);
  }

  // 拡張リロード/更新で旧コンテンツスクリプトのコンテキストが無効化されたか
  function contextValid() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }

  // GitHub は Turbo でページ内容を差し替えるため、URL 変化と DOM 変化を監視
  let watchMo = null;
  let watchInterval = null;
  let observing = false;
  // Observer はリポジトリ一覧ページ候補でのみ接続する（無関係ページの監視コストを避ける）
  function connectObserver() {
    if (!watchMo || observing) return;
    watchMo.observe(document.body, { childList: true, subtree: true });
    observing = true;
  }
  function disconnectObserver() {
    if (!watchMo || !observing) return;
    watchMo.disconnect();
    observing = false;
  }
  function applyObserverForUrl() {
    if (isRepoListUrl()) connectObserver();
    else disconnectObserver();
  }
  function teardown() {
    if (watchInterval) clearInterval(watchInterval);
    disconnectObserver();
    closeAssignMenu();
  }

  function watch() {
    // URL ポーリング（Turbo / pushState 対応）
    watchInterval = setInterval(() => {
      if (!contextValid()) return teardown(); // 拡張リロード後は監視を停止
      if (location.href !== lastUrl) {
        lastUrl = location.href;
        closeAssignMenu();
        applyObserverForUrl(); // 一覧ページに出入りしたら Observer を接続/切断
        setTimeout(() => {
          const container = findListContainer();
          if (!container) return;
          // URL の ?ghtg= に追従（外部からの遷移やブックマーク経由を含む）
          activeGroupId = validateGroup(readGroupFromUrl());
          if (document.querySelector(".ghtg-tabbar")) rerender();
          else {
            container.dataset.ghtgInjected = "1";
            injectUI(container);
          }
        }, 150);
      }
    }, 400);

    ["turbo:load", "turbo:render", "pjax:end"].forEach((ev) => {
      document.addEventListener(ev, () => setTimeout(tryInit, 50));
    });

    // リスト DOM の出現を検知（デバウンスで高頻度ミューテーションのコストを抑える）
    watchMo = new MutationObserver(
      debounce(() => {
        if (!contextValid()) return teardown();
        if (!isRepoListPage()) return;
        if (!document.querySelector(".ghtg-tabbar")) {
          tryInit();
          return;
        }
        // Organization は React の遅延描画/密度切替で行が差し替わるため、未装飾の行に付け直す
        if (orgName()) {
          const c = findListContainer();
          if (c) decorateNativeItems(c);
          // グループタブ表示中に密度が変わったら、その密度で一覧を描き直す
          if (activeGroupId !== "all" && orgDensity() !== lastGroupDensity) {
            const gl = document.querySelector(".ghtg-group-list");
            const group = state.groups.find((g) => g.id === activeGroupId);
            if (gl && group) renderGroupList(gl, group);
          }
        }
      }, 300)
    );
    applyObserverForUrl(); // 現在のページが一覧候補なら接続
  }

  // 末尾デバウンス（連続呼び出しを 1 回にまとめる）
  function debounce(fn, ms) {
    let timer = null;
    return function () {
      if (timer) clearTimeout(timer);
      timer = setTimeout(fn, ms);
    };
  }

  async function boot() {
    state = await Store.init(); // 初回ロード＋レガシーlocal→sync 移行
    I18N.apply(state.lang); // 保存済み言語設定（auto/ja/en）を反映
    Store.onChange((next) => {
      state = next;
      I18N.apply(next.lang);
      if (isRepoListPage()) rerender();
      refreshAssignMenu(); // 開いている割り当てメニューも最新化（グループ作成・トグル後）
      refreshManageMenu(); // 開いている管理モーダルも最新化（作成・削除・並べ替え後）
    });
    tryInit();
    watch();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
