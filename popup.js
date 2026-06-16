/* GitHub Tab Group - popup */
(function () {
  "use strict";
  const Store = globalThis.GHTG;
  const I18N = globalThis.GHTGI18N || { t: (k) => k, apply: () => {} };
  const t = (...args) => I18N.t(...args);

  function fmtKB(bytes) {
    return (bytes / 1024).toFixed(1) + " KB";
  }

  let state = { groups: [], repos: {} };
  let currentRepo = null; // { fullName, owner, name, url }
  let activeOwner = null; // 開いているアカウント（user/org）

  // GitHub の予約パス（owner/repo に見えても実際はリポジトリでないもの）
  const RESERVED = new Set([
    "settings", "marketplace", "notifications", "explore", "topics", "collections",
    "sponsors", "orgs", "organizations", "new", "login", "logout", "join", "search",
    "pulls", "issues", "dashboard", "features", "about", "pricing", "team",
    "enterprise", "customer-stories", "readme", "apps", "codespaces", "account",
  ]);
  // owner/repo の後にあってもリポジトリページとみなせない第2セグメント
  const NON_REPO_SECOND = new Set(["", "?", "#"]);

  function parseRepoFromUrl(urlStr) {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return null;
    }
    if (u.hostname !== "github.com") return null;
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length < 2) return null;
    const owner = seg[0];
    const name = seg[1];
    if (RESERVED.has(owner.toLowerCase())) return null;
    if (NON_REPO_SECOND.has(name)) return null;
    return {
      fullName: owner + "/" + name,
      owner,
      name,
      url: "https://github.com/" + owner + "/" + name,
    };
  }

  // アクティブタブの URL から所有者（user/org）を求める。
  //  /orgs/<org>/...  → org,  /<user>?tab=repositories や /<user>/<repo> → user
  function parseOwnerFromUrl(urlStr) {
    let u;
    try {
      u = new URL(urlStr);
    } catch (e) {
      return null;
    }
    if (u.hostname !== "github.com") return null;
    const seg = u.pathname.split("/").filter(Boolean);
    if (seg.length === 0) return null;
    if (seg[0] === "orgs" && seg[1]) return seg[1];
    if (RESERVED.has(seg[0].toLowerCase())) return null;
    return seg[0];
  }

  function el(tag, props, children) {
    const node = document.createElement(tag);
    if (props) {
      for (const k of Object.keys(props)) {
        if (k === "class") node.className = props[k];
        else if (k === "text") node.textContent = props[k];
        else if (k.startsWith("on") && typeof props[k] === "function")
          node.addEventListener(k.slice(2).toLowerCase(), props[k]);
        else if (props[k] !== undefined && props[k] !== null) node.setAttribute(k, props[k]);
      }
    }
    (children || []).forEach((c) => {
      if (c == null) return;
      node.appendChild(typeof c === "string" ? document.createTextNode(c) : c);
    });
    return node;
  }

  function renderGroups() {
    const listEl = document.getElementById("group-list");
    listEl.innerHTML = "";
    // 開いているアカウント名を見出しに表示
    const ownerLabel = document.getElementById("group-owner");
    if (ownerLabel) ownerLabel.textContent = activeOwner ? "@" + activeOwner : "";
    if (!activeOwner) {
      listEl.appendChild(el("li", { class: "group-empty", text: t("popup_open_repos_page") }));
      return;
    }
    const groups = Store.groupsForOwner(state, activeOwner);
    if (groups.length === 0) {
      listEl.appendChild(el("li", { class: "group-empty", text: t("popup_no_groups") }));
    }
    groups.forEach((g, idx) => {
      const count = Store.reposInGroup(state, g.id).length;

      const colorInput = el("input", {
        type: "color",
        value: g.color,
        class: "g-color",
        title: t("popup_change_color"),
        onChange: (e) => Store.setGroupColor(g.id, e.target.value),
      });

      const nameInput = el("input", {
        type: "text",
        value: g.name,
        class: "g-name",
        onChange: (e) => Store.renameGroup(g.id, e.target.value),
      });

      const up = el("button", {
        class: "g-move",
        type: "button",
        title: t("popup_move_up"),
        text: "↑",
        ...(idx === 0 ? { disabled: "disabled" } : {}),
        onClick: () => move(idx, idx - 1),
      });
      const down = el("button", {
        class: "g-move",
        type: "button",
        title: t("popup_move_down"),
        text: "↓",
        ...(idx === groups.length - 1 ? { disabled: "disabled" } : {}),
        onClick: () => move(idx, idx + 1),
      });

      const del = el("button", {
        class: "g-del",
        type: "button",
        title: t("popup_delete"),
        text: "🗑",
        onClick: () => {
          if (confirm(t("popup_confirm_delete", g.name))) {
            Store.deleteGroup(g.id);
          }
        },
      });

      const row = el("li", { class: "group-row" }, [
        colorInput,
        nameInput,
        el("span", { class: "g-count", text: String(count) }),
        up,
        down,
        del,
      ]);
      listEl.appendChild(row);
    });
  }

  function move(from, to) {
    // 並べ替えは開いているアカウントのグループ内のみ
    const ids = Store.groupsForOwner(state, activeOwner).map((g) => g.id);
    if (to < 0 || to >= ids.length) return;
    const [moved] = ids.splice(from, 1);
    ids.splice(to, 0, moved);
    Store.reorderGroups(ids);
  }

  function renderCurrentRepo() {
    const section = document.getElementById("current-repo");
    if (!currentRepo) {
      section.hidden = true;
      return;
    }
    section.hidden = false;
    document.getElementById("current-repo-name").textContent = currentRepo.fullName;

    const box = document.getElementById("current-repo-groups");
    box.innerHTML = "";
    const repoGroups = Store.groupsForOwner(state, currentRepo.owner);
    if (repoGroups.length === 0) {
      box.appendChild(el("div", { class: "hint", text: t("popup_create_first") }));
      return;
    }
    const memberIds = new Set(Store.groupsForRepo(state, currentRepo.fullName));
    repoGroups.forEach((g) => {
      const label = el("label", { class: "chk" }, [
        el("input", {
          type: "checkbox",
          ...(memberIds.has(g.id) ? { checked: "checked" } : {}),
          onChange: (e) => {
            if (e.target.checked && !Store.canAddRepoToGroup(state, g.id)) {
              e.target.checked = false;
              alert(t("limit_sync_bytes"));
              return;
            }
            Store.toggleRepoInGroup(currentRepo, g.id);
          },
        }),
        el("span", { class: "dot", style: "background:" + g.color }),
        el("span", { text: g.name }),
      ]);
      box.appendChild(label);
    });
  }

  function renderAll() {
    localizeStatic();
    renderSync();
    renderGroups();
    renderCurrentRepo();
  }

  // ---- イベント結線 ----
  function wire() {
    document.getElementById("new-group-add").addEventListener("click", async () => {
      const input = document.getElementById("new-group-name");
      const name = input.value.trim();
      if (!name) return;
      if (!activeOwner) {
        alert(t("popup_open_repos_page"));
        return;
      }
      if (!Store.canAddGroup(state)) {
        alert(t("limit_sync_bytes"));
        return;
      }
      await Store.createGroup(name, null, activeOwner);
      input.value = "";
      input.focus();
    });
    document.getElementById("new-group-name").addEventListener("keydown", (e) => {
      if (e.key === "Enter") document.getElementById("new-group-add").click();
    });

    document.getElementById("export-btn").addEventListener("click", () => {
      const json = Store.exportJSON(state);
      const blob = new Blob([json], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "github-tab-group.json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    document.getElementById("import-btn").addEventListener("click", () => {
      document.getElementById("import-file").click();
    });
    document.getElementById("import-file").addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = async () => {
        try {
          await Store.importJSON(String(reader.result));
          alert(t("popup_imported"));
        } catch (err) {
          alert(t("popup_import_failed", err.message));
        }
      };
      reader.readAsText(file);
      e.target.value = "";
    });

    document.getElementById("lang-select").addEventListener("change", (e) => {
      Store.setLang(e.target.value);
    });

    document.getElementById("sync-toggle").addEventListener("change", async (e) => {
      const want = e.target.checked;
      const res = await Store.setSyncEnabled(want);
      if (!res || !res.ok) {
        // 上限超過などで有効化できなかった → チェックを戻して通知
        e.target.checked = false;
        if (res && res.reason === "limit") alert(t("sync_enable_blocked"));
      }
      renderSync();
    });
  }

  function renderSync() {
    const on = state.syncEnabled !== false;
    const toggle = document.getElementById("sync-toggle");
    if (toggle) toggle.checked = on;
    const hint = document.getElementById("sync-hint");
    if (hint) hint.textContent = on ? t("sync_on_hint") : t("sync_off_hint");

    // 使用容量の表示（同期した場合のサイズ / 安全上限）
    const usage = Store.syncUsage(state);
    const percent = Math.min(100, Math.round((usage.bytes / usage.cap) * 100));
    const fill = document.getElementById("usage-fill");
    if (fill) {
      fill.style.width = percent + "%";
      fill.className =
        "usage-fill" + (percent >= 100 ? " is-full" : percent >= 80 ? " is-warn" : "");
    }
    const text = document.getElementById("usage-text");
    if (text) {
      const sizes = fmtKB(usage.bytes) + " / " + fmtKB(usage.cap) + " (" + percent + "%)";
      text.textContent = on ? t("sync_usage", sizes) : t("sync_usage_off", sizes);
    }
  }

  // data-i18n / data-i18n-ph 属性を持つ静的要素を翻訳
  function localizeStatic() {
    document.querySelectorAll("[data-i18n]").forEach((node) => {
      node.textContent = t(node.getAttribute("data-i18n"));
    });
    document.querySelectorAll("[data-i18n-ph]").forEach((node) => {
      node.setAttribute("placeholder", t(node.getAttribute("data-i18n-ph")));
    });
    const sel = document.getElementById("lang-select");
    if (sel) sel.value = state.lang || "auto";
    document.documentElement.lang = I18N.resolve ? I18N.resolve(state.lang) : "ja";
  }

  async function detectCurrentRepo() {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (tab && tab.url) {
        currentRepo = parseRepoFromUrl(tab.url);
        activeOwner = parseOwnerFromUrl(tab.url);
      }
    } catch (e) {
      currentRepo = null;
      activeOwner = null;
    }
  }

  async function boot() {
    state = await Store.init();
    I18N.apply(state.lang);
    await detectCurrentRepo();
    wire();
    renderAll();
    Store.onChange((next) => {
      state = next;
      I18N.apply(next.lang);
      renderAll();
    });
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
