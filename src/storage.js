/*
 * GitHub Tab Group - shared storage layer
 *
 * content.js と popup.js の両方から読み込まれる。
 * グローバルに `GHTG` を公開する（content scriptは同一スコープを共有、
 * popupは <script> タグで先に読み込む）。
 *
 * 保存データ構造（論理ビュー。state）:
 * {
 *   groups: [{ id, name, color, owner, order }],   // owner(user/org)ごとに独立
 *   repos: {
 *     "owner/repo": {
 *       fullName, repoId, owner, name, url, description, language,
 *       isPrivate, isFork, isArchived, addedAt, groups: [groupId, ...]
 *     }
 *   },
 *   sort: { key, dir }, lang
 * }
 *
 * 物理的な保存先:
 *  - 同期ON（既定）: chrome.storage.sync に分割保存
 *      ghtg_meta        … { groups, sort, lang, chunks, v }
 *      ghtg_repos_0..N  … repos をUTF-8バイト単位で ~6KB ごとに分割したシャード
 *    （sync の「1項目8KB / 全体100KB」上限のため。容量上限はバイトのみ・件数上限なし）
 *  - 同期OFF: chrome.storage.local の 'ghtg' キーに state 全体を1件で保存（容量無制限）
 *  - ghtg_sync_enabled（local）… 同期 ON/OFF（端末ごと・既定 ON）
 */
(function () {
  "use strict";

  // ---- 保存キー ----
  // クラウド同期は任意（既定ON）。ON のときは chrome.storage.sync に保存し、
  // OFF のときは chrome.storage.local に全体を1キーで保存する。
  // sync は「1項目8KB / 全体100KB」の上限があるため、ON 時のみリポジトリを分割保存する:
  //   ghtg_meta        … { groups, sort, lang, chunks, v }（グループ等のメタ）
  //   ghtg_repos_0..N  … リポジトリをバイト単位で分割した塊（各 ~6KB）
  // ON 時は「最大100グループ・1グループ最大100リポジトリ」に制限する（フォールバックは無し）。
  const KEY = "ghtg"; // 同期OFF時の全体保存キー（local）
  const META_KEY = "ghtg_meta";
  const REPO_PREFIX = "ghtg_repos_";
  const SYNC_FLAG = "ghtg_sync_enabled"; // local: クラウド同期 ON/OFF（既定 ON）
  // ---- 上限は同期容量（バイト）のみ。件数の上限は設けない。----
  // ---- バイト安全策（sync の 1項目8KB / 全体100KB に対する保護）----
  const MAX_DESC = 120; // 保存する説明文の最大文字数
  const CHUNK_BYTES = 6000; // 1シャードの目標サイズ（UTF-8バイト、8KB上限に余裕）
  const SYNC_TOTAL_SAFE = 92000; // sync 全体の安全上限（100KB に余裕）

  // 文字列の UTF-8 バイト長
  const _enc = typeof TextEncoder !== "undefined" ? new TextEncoder() : null;
  function utf8Bytes(str) {
    if (_enc) return _enc.encode(str).length;
    return unescape(encodeURIComponent(str)).length; // フォールバック
  }
  function truncDesc(s) {
    if (typeof s !== "string") return s;
    return s.length > MAX_DESC ? s.slice(0, MAX_DESC) : s;
  }

  // 保存・描画する URL は https://github.com/ のみ許可する。
  // （インポートした JSON 等に javascript: などの危険な URL が混じっても無害化する）
  function cleanUrl(url, fullName) {
    if (typeof url === "string" && /^https:\/\/github\.com\//i.test(url)) return url;
    return "https://github.com/" + (fullName || "");
  }

  // グループに自動割り当てする色（GitHub Primer 寄りの配色）
  const PALETTE = [
    "#0969da", // blue
    "#1a7f37", // green
    "#9a6700", // yellow/brown
    "#cf222e", // red
    "#8250df", // purple
    "#bf3989", // pink
    "#bc4c00", // orange
    "#0a3069", // navy
    "#1b7c83", // teal
    "#57606a", // gray
  ];

  function uid() {
    return "g_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  }

  const SORT_KEYS = ["name", "added", "language"];
  const LANG_PREFS = ["auto", "ja", "en"];

  function emptyState() {
    return { groups: [], repos: {}, sort: { key: "name", dir: "asc" }, lang: "auto" };
  }

  function normalize(raw) {
    const state = raw && typeof raw === "object" ? raw : {};
    if (!Array.isArray(state.groups)) state.groups = [];
    if (!state.repos || typeof state.repos !== "object") state.repos = {};
    // 言語設定の既定値補完
    if (!LANG_PREFS.includes(state.lang)) state.lang = "auto";
    // ソート設定の既定値補完
    if (!state.sort || typeof state.sort !== "object") state.sort = {};
    if (!SORT_KEYS.includes(state.sort.key)) state.sort.key = "name";
    if (state.sort.dir !== "asc" && state.sort.dir !== "desc") state.sort.dir = "asc";
    // 旧データ（owner を持たないグループ）= owner 分離前の形式。
    // 「既存グループは破棄して作り直す」方針なので、検出したら一度だけクリアする。
    if (state.groups.some((g) => g && typeof g.owner !== "string")) {
      state.groups = [];
      state.repos = {};
    }
    // order が無ければ index で補完。表示は owner ごとに絞り込み＋order で並べる。
    state.groups.forEach((g, i) => {
      if (typeof g.order !== "number") g.order = i;
    });
    state.groups.sort((a, b) =>
      a.owner === b.owner ? a.order - b.order : String(a.owner).localeCompare(String(b.owner))
    );
    // 説明文の短縮と URL のサニタイズ（import/移行/同期読込のすべての経路を通る）
    for (const k of Object.keys(state.repos)) {
      const r = state.repos[k];
      if (!r || typeof r !== "object") continue;
      if (typeof r.description === "string") r.description = truncDesc(r.description);
      r.url = cleanUrl(r.url, r.fullName || k);
    }
    return state;
  }

  // 指定 owner のグループ（order 順）
  function groupsForOwner(state, owner) {
    return state.groups.filter((g) => g.owner === owner).sort((a, b) => a.order - b.order);
  }

  // ---- chrome.storage の Promise ラッパ ----
  // 拡張をリロード/更新すると、開いたままのページに残る旧コンテンツスクリプトは
  // 「Extension context invalidated」になる。その状態でも例外で溢れさせず、静かに no-op する。
  function contextValid() {
    try {
      return !!(typeof chrome !== "undefined" && chrome.runtime && chrome.runtime.id);
    } catch (e) {
      return false;
    }
  }
  function syncGetAll() {
    return new Promise((resolve) => {
      if (!contextValid()) return resolve({});
      try {
        chrome.storage.sync.get(null, (res) => resolve(res || {}));
      } catch (e) {
        resolve({});
      }
    });
  }
  function localGet(keys) {
    return new Promise((resolve) => {
      if (!contextValid()) return resolve({});
      try {
        chrome.storage.local.get(keys, (res) => resolve(res || {}));
      } catch (e) {
        resolve({});
      }
    });
  }
  function syncSet(obj) {
    return new Promise((resolve) => {
      if (!contextValid()) return resolve(new Error("context invalidated"));
      try {
        chrome.storage.sync.set(obj, () => resolve(chrome.runtime && chrome.runtime.lastError));
      } catch (e) {
        resolve(e);
      }
    });
  }
  function syncRemove(keys) {
    return new Promise((resolve) => {
      if (!keys.length || !contextValid()) return resolve();
      try {
        chrome.storage.sync.remove(keys, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }
  function localSet(obj) {
    return new Promise((resolve) => {
      if (!contextValid()) return resolve();
      try {
        chrome.storage.local.set(obj, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }
  function localRemove(keys) {
    return new Promise((resolve) => {
      if (!contextValid()) return resolve();
      try {
        chrome.storage.local.remove(keys, () => resolve());
      } catch (e) {
        resolve();
      }
    });
  }

  // sync のシャードから state を復元
  function assemble(items) {
    const meta = items[META_KEY] || {};
    const repos = {};
    const n = typeof meta.chunks === "number" ? meta.chunks : 0;
    for (let i = 0; i < n; i++) {
      const c = items[REPO_PREFIX + i];
      if (c && typeof c === "object") Object.assign(repos, c);
    }
    return normalize({ groups: meta.groups, sort: meta.sort, lang: meta.lang, repos });
  }

  // クラウド同期 ON/OFF（既定 ON）。local に保存される端末ごとの設定。
  async function getSyncEnabled() {
    const r = await localGet([SYNC_FLAG]);
    return r[SYNC_FLAG] === undefined ? true : !!r[SYNC_FLAG];
  }
  function setSyncFlag(enabled) {
    return localSet({ [SYNC_FLAG]: !!enabled });
  }

  // リポジトリをバイト単位で分割（各シャードを CHUNK_BYTES 以下に保つ）
  function chunkRepos(repos) {
    const keys = Object.keys(repos);
    const chunks = [];
    let cur = {};
    let curBytes = 2; // "{}"
    for (const k of keys) {
      const entryBytes = utf8Bytes(JSON.stringify(k)) + utf8Bytes(JSON.stringify(repos[k])) + 2;
      if (Object.keys(cur).length > 0 && curBytes + entryBytes > CHUNK_BYTES) {
        chunks.push(cur);
        cur = {};
        curBytes = 2;
      }
      cur[k] = repos[k];
      curBytes += entryBytes;
    }
    if (Object.keys(cur).length) chunks.push(cur);
    return chunks;
  }

  // sync 表現（meta + 全シャード）の合計 UTF-8 バイト数を見積もる
  function syncRepresentationBytes(state) {
    const chunks = chunkRepos(state.repos);
    const meta = {
      groups: state.groups,
      sort: state.sort,
      lang: state.lang,
      chunks: chunks.length,
      v: 3,
    };
    let total = META_KEY.length + utf8Bytes(JSON.stringify(meta));
    chunks.forEach((c, i) => {
      total += (REPO_PREFIX + i).length + utf8Bytes(JSON.stringify(c));
    });
    return total;
  }

  // 上限は「同期容量（バイト）」のみ。件数の上限は設けない。
  // 追加できるかどうか（同期OFF時は常に可）。
  function canAddGroup(state) {
    if (!state.syncEnabled) return true;
    return syncRepresentationBytes(state) <= SYNC_TOTAL_SAFE - 512;
  }
  function canAddRepoToGroup(state /*, groupId */) {
    if (!state.syncEnabled) return true;
    return syncRepresentationBytes(state) <= SYNC_TOTAL_SAFE - 1024;
  }
  // OFF→ON 切替の可否（容量に収まるか）
  function withinLimits(state) {
    return syncRepresentationBytes(state) <= SYNC_TOTAL_SAFE;
  }
  // 現在の使用容量（同期した場合のサイズ）と安全上限
  function syncUsage(state) {
    return { bytes: syncRepresentationBytes(state), cap: SYNC_TOTAL_SAFE };
  }

  // sync へシャード保存（古いシャードも掃除）
  async function writeSync(state) {
    const chunks = chunkRepos(state.repos);
    const meta = { groups: state.groups, sort: state.sort, lang: state.lang, chunks: chunks.length, v: 3 };
    const setObj = { [META_KEY]: meta };
    chunks.forEach((c, i) => (setObj[REPO_PREFIX + i] = c));
    const err = await syncSet(setObj);
    const existing = await syncGetAll();
    const stale = Object.keys(existing).filter((k) => {
      if (!k.startsWith(REPO_PREFIX)) return false;
      return parseInt(k.slice(REPO_PREFIX.length), 10) >= chunks.length;
    });
    await syncRemove(stale);
    return err; // 失敗時は lastError（フォールバックはしない）
  }

  async function clearSyncKeys() {
    const existing = await syncGetAll();
    const keys = Object.keys(existing).filter(
      (k) => k === META_KEY || k.startsWith(REPO_PREFIX)
    );
    await syncRemove(keys);
  }

  // 読み取り（書き込みなし）。state.syncEnabled を付与して返す。
  async function load() {
    const syncOn = await getSyncEnabled();
    let state;
    if (syncOn) {
      const sync = await syncGetAll();
      state = sync[META_KEY] ? assemble(sync) : normalize(null);
    } else {
      const local = await localGet([KEY]);
      state = normalize(local[KEY]);
    }
    state.syncEnabled = syncOn;
    return state;
  }

  // state を現在の保存先（ON=sync / OFF=local）へ保存。フォールバックは無し。
  async function save(state) {
    const syncOn = state.syncEnabled !== undefined ? state.syncEnabled : await getSyncEnabled();
    if (syncOn) {
      const err = await writeSync(state);
      if (err) console.warn("[GHTG] sync write failed:", err.message || err);
    } else {
      await localSet({ [KEY]: { groups: state.groups, repos: state.repos, sort: state.sort, lang: state.lang } });
    }
    return state;
  }

  // 初回ロード＋必要なら移行（レガシーlocal → sync）。
  // ON 既定だが、既存データが上限超過なら ON にできないので OFF にして local 継続。
  async function init() {
    const syncOn = await getSyncEnabled();
    const sync = await syncGetAll();
    const local = await localGet([KEY]);
    if (syncOn) {
      if (sync[META_KEY]) {
        const st = assemble(sync);
        st.syncEnabled = true;
        return st;
      }
      // sync 未作成 → local（レガシー）を移行
      const st = normalize(local[KEY]);
      if (withinLimits({ ...st, syncEnabled: true })) {
        st.syncEnabled = true;
        await writeSync(st);
        await localRemove([KEY]);
        return st;
      }
      // 上限超過で同期できない → OFF にして local 継続
      await setSyncFlag(false);
      st.syncEnabled = false;
      return st;
    }
    const st = normalize(local[KEY]);
    st.syncEnabled = false;
    return st;
  }

  // クラウド同期 ON/OFF の切替。
  //  OFF→ON: 現データが上限超過なら拒否（{ok:false,reason:'limit'}）。
  //  ON→OFF: sync の内容を local に移し、sync は掃除。
  function setSyncEnabled(enabled) {
    return enqueue(async () => {
      const cur = await getSyncEnabled();
      if (cur === enabled) return { ok: true, enabled };
      const state = await load(); // 現在の保存先から読む
      if (enabled) {
        if (!withinLimits({ ...state, syncEnabled: true })) {
          return { ok: false, reason: "limit", enabled: false };
        }
        const err = await writeSync(state);
        if (err) return { ok: false, reason: "write", enabled: false };
        await localRemove([KEY]);
        await setSyncFlag(true);
        return { ok: true, enabled: true };
      }
      // ON → OFF
      await localSet({ [KEY]: { groups: state.groups, repos: state.repos, sort: state.sort, lang: state.lang } });
      await clearSyncKeys();
      await setSyncFlag(false);
      return { ok: true, enabled: false };
    });
  }

  // 直列実行キュー（更新と同期切替の競合を防ぐ）
  let chain = Promise.resolve();
  function enqueue(fn) {
    chain = chain.then(fn, fn);
    return chain;
  }

  // state を読み込み→更新関数を適用→保存する。
  // mutator が false を返したら「変更なし」で保存しない（再描画ループ防止）。
  function update(mutator) {
    return enqueue(async () => {
      const state = await load();
      const result = mutator(state);
      if (result === false) return state;
      const next = result && typeof result === "object" ? result : state;
      next.syncEnabled = state.syncEnabled;
      await save(next);
      return next;
    });
  }

  function nextColor(state) {
    const used = new Set(state.groups.map((g) => g.color));
    for (const c of PALETTE) {
      if (!used.has(c)) return c;
    }
    return PALETTE[state.groups.length % PALETTE.length];
  }

  // グループは owner（user/org）ごとに独立。owner 未指定の作成は不可。
  function createGroup(name, color, owner) {
    return update((state) => {
      if (!owner || typeof owner !== "string") return false;
      // 同期ON時は容量上限に達していたら作成しない
      if (!canAddGroup(state)) return false;
      const trimmed = (name || "").trim() || "新しいグループ";
      const group = {
        id: uid(),
        name: trimmed,
        color: color || nextColor(state),
        owner: owner,
        order: groupsForOwner(state, owner).length,
      };
      state.groups.push(group);
      return state;
    });
  }

  function renameGroup(id, name) {
    return update((state) => {
      const g = state.groups.find((x) => x.id === id);
      if (g) g.name = (name || "").trim() || g.name;
      return state;
    });
  }

  function setGroupColor(id, color) {
    return update((state) => {
      const g = state.groups.find((x) => x.id === id);
      if (g) g.color = color;
      return state;
    });
  }

  function deleteGroup(id) {
    return update((state) => {
      const removed = state.groups.find((g) => g.id === id);
      state.groups = state.groups.filter((g) => g.id !== id);
      // 同じ owner のグループの order を詰め直す
      if (removed) {
        groupsForOwner(state, removed.owner).forEach((g, i) => (g.order = i));
      }
      // 各リポジトリのメンバーシップから除去
      for (const key of Object.keys(state.repos)) {
        const r = state.repos[key];
        if (Array.isArray(r.groups)) {
          r.groups = r.groups.filter((gid) => gid !== id);
          // どのグループにも属さなくなったリポジトリは掃除する
          if (r.groups.length === 0) delete state.repos[key];
        }
      }
      return state;
    });
  }

  // orderedIds は同一 owner のグループ ID 列（新しい並び順）。その owner 内だけ order を振り直す。
  function reorderGroups(orderedIds) {
    return update((state) => {
      orderedIds.forEach((id, i) => {
        const g = state.groups.find((x) => x.id === id);
        if (g) g.order = i;
      });
      return state;
    });
  }

  // repoMeta: { fullName, owner, name, url, description, language, isPrivate, isFork, isArchived }
  function setRepoGroups(repoMeta, groupIds) {
    return update((state) => {
      const key = repoMeta.fullName;
      if (!key) return state;
      const ids = Array.isArray(groupIds) ? groupIds.slice() : [];
      if (ids.length === 0) {
        delete state.repos[key];
        return state;
      }
      const existing = state.repos[key] || {};
      state.repos[key] = {
        fullName: key,
        repoId: repoMeta.repoId || existing.repoId || null,
        owner: repoMeta.owner || existing.owner || key.split("/")[0],
        name: repoMeta.name || existing.name || key.split("/")[1],
        url: cleanUrl(repoMeta.url || existing.url, key),
        description: truncDesc(
          repoMeta.description !== undefined ? repoMeta.description : existing.description || ""
        ),
        language:
          repoMeta.language !== undefined ? repoMeta.language : existing.language || "",
        isPrivate:
          repoMeta.isPrivate !== undefined ? repoMeta.isPrivate : !!existing.isPrivate,
        isFork: repoMeta.isFork !== undefined ? repoMeta.isFork : !!existing.isFork,
        isArchived:
          repoMeta.isArchived !== undefined ? repoMeta.isArchived : !!existing.isArchived,
        addedAt: existing.addedAt || Date.now(),
        groups: ids,
      };
      return state;
    });
  }

  function toggleRepoInGroup(repoMeta, groupId) {
    return update((state) => {
      const key = repoMeta.fullName;
      if (!key) return state;
      const existing = state.repos[key];
      const alreadyIn =
        existing && Array.isArray(existing.groups) && existing.groups.includes(groupId);
      // 追加方向で、同期ON時に容量上限に達していたら拒否
      if (!alreadyIn && !canAddRepoToGroup(state, groupId)) return false;
      let ids = existing && Array.isArray(existing.groups) ? existing.groups.slice() : [];
      if (ids.includes(groupId)) {
        ids = ids.filter((g) => g !== groupId);
      } else {
        ids.push(groupId);
      }
      if (ids.length === 0) {
        delete state.repos[key];
        return state;
      }
      const base = existing || {};
      state.repos[key] = {
        fullName: key,
        repoId: repoMeta.repoId || base.repoId || null,
        owner: repoMeta.owner || base.owner || key.split("/")[0],
        name: repoMeta.name || base.name || key.split("/")[1],
        url: cleanUrl(repoMeta.url || base.url, key),
        description: truncDesc(
          repoMeta.description !== undefined && repoMeta.description !== ""
            ? repoMeta.description
            : base.description || ""
        ),
        language:
          repoMeta.language !== undefined && repoMeta.language !== ""
            ? repoMeta.language
            : base.language || "",
        isPrivate:
          repoMeta.isPrivate !== undefined ? repoMeta.isPrivate : !!base.isPrivate,
        isFork: repoMeta.isFork !== undefined ? repoMeta.isFork : !!base.isFork,
        isArchived:
          repoMeta.isArchived !== undefined ? repoMeta.isArchived : !!base.isArchived,
        addedAt: base.addedAt || Date.now(),
        groups: ids,
      };
      return state;
    });
  }

  // 表示中の一覧から取得した行（repoId 付き）で、保存済みリポジトリを
  // 照合・自己修復する。
  //  - repoId 一致で fullName が変わっていたら → 改名/移管とみなしキーを移行
  //  - 説明・言語・公開状態などが変わっていたら → 最新に更新
  // 変更が無ければ false を返して保存をスキップ（再描画ループ防止）。
  // rows: [{ repoId, fullName, owner, name, url, description, language, isPrivate, isFork, isArchived }]
  function syncVisibleRepos(rows) {
    return update((state) => {
      let changed = false;
      // repoId → 現在の保存キー の索引
      const byId = {};
      for (const key of Object.keys(state.repos)) {
        const r = state.repos[key];
        if (r && r.repoId) byId[String(r.repoId)] = key;
      }
      for (const row of rows || []) {
        if (!row || !row.repoId) continue;
        const id = String(row.repoId);
        let storedKey = byId[id];
        if (!storedKey) continue; // 未登録のリポジトリは対象外

        // 改名/移管: 保存キーと現在の fullName が食い違う
        if (storedKey !== row.fullName) {
          const r = state.repos[storedKey];
          const merged = Object.assign({}, r, {
            fullName: row.fullName,
            owner: row.owner || row.fullName.split("/")[0],
            name: row.name || row.fullName.split("/")[1],
            url: cleanUrl(row.url, row.fullName),
          });
          // 移行先が既に存在する場合（旧名・新名の両方が登録済み）はグループを統合
          if (state.repos[row.fullName] && row.fullName !== storedKey) {
            const tgt = state.repos[row.fullName];
            const gset = new Set([...(tgt.groups || []), ...(r.groups || [])]);
            merged.groups = Array.from(gset);
          }
          delete state.repos[storedKey];
          state.repos[row.fullName] = merged;
          byId[id] = row.fullName;
          storedKey = row.fullName;
          changed = true;
        }

        // メタデータの差分更新（説明文は保存上限まで短縮して比較・保存）
        const cur = state.repos[storedKey];
        const desc = truncDesc(row.description);
        if (desc !== undefined && desc !== "" && cur.description !== desc) {
          cur.description = desc;
          changed = true;
        }
        if (row.language !== undefined && row.language !== "" && cur.language !== row.language) {
          cur.language = row.language;
          changed = true;
        }
        const boolFields = ["isPrivate", "isFork", "isArchived"];
        for (const f of boolFields) {
          if (row[f] !== undefined && cur[f] !== row[f]) {
            cur[f] = row[f];
            changed = true;
          }
        }
        if (row.name && cur.name !== row.name) {
          cur.name = row.name;
          changed = true;
        }
      }
      return changed ? state : false;
    });
  }

  // 表示中の行（fullName ベース）で、登録済みリポジトリの説明・言語・公開状態を更新する。
  // Organization（安定IDが無く改名追従できない）一覧で、既存メンバーのメタを充実させる用途。
  // rows: [{ fullName, description, language, isPrivate }]
  function refreshRepoMeta(rows) {
    return update((state) => {
      let changed = false;
      for (const row of rows || []) {
        if (!row || !row.fullName) continue;
        const r = state.repos[row.fullName];
        if (!r) continue; // 登録済みのみ
        const desc = truncDesc(row.description);
        if (desc && r.description !== desc) {
          r.description = desc;
          changed = true;
        }
        if (row.language && r.language !== row.language) {
          r.language = row.language;
          changed = true;
        }
        if (row.isPrivate !== undefined && r.isPrivate !== row.isPrivate) {
          r.isPrivate = row.isPrivate;
          changed = true;
        }
      }
      return changed ? state : false;
    });
  }

  function reposInGroup(state, groupId) {
    const list = Object.values(state.repos).filter(
      (r) => Array.isArray(r.groups) && r.groups.includes(groupId)
    );
    return sortRepos(list, state.sort);
  }

  // リポジトリ配列を sort 設定に従って並べ替える（非破壊）
  function sortRepos(list, sort) {
    const key = (sort && sort.key) || "name";
    const dir = (sort && sort.dir) === "desc" ? -1 : 1;
    const arr = list.slice();
    arr.sort((a, b) => {
      let r = 0;
      if (key === "added") {
        r = (a.addedAt || 0) - (b.addedAt || 0);
      } else if (key === "language") {
        r = (a.language || "").localeCompare(b.language || "");
      } else {
        r = 0;
      }
      // 同値・名前ソートは fullName で安定化
      if (r === 0) r = a.fullName.localeCompare(b.fullName);
      return r * dir;
    });
    return arr;
  }

  function setSort(key, dir) {
    return update((state) => {
      state.sort = {
        key: SORT_KEYS.includes(key) ? key : state.sort.key,
        dir: dir === "desc" ? "desc" : "asc",
      };
      return state;
    });
  }

  function setLang(lang) {
    return update((state) => {
      state.lang = LANG_PREFS.includes(lang) ? lang : "auto";
      return state;
    });
  }

  function groupsForRepo(state, fullName) {
    const r = state.repos[fullName];
    return r && Array.isArray(r.groups) ? r.groups : [];
  }

  // sync / local いずれかの ghtg_* キーが変わったら、全体を読み直して通知する
  // （他デバイスからの sync 反映・フォールバックの両方に対応）。
  function onChange(callback) {
    let pending = false;
    chrome.storage.onChanged.addListener((changes) => {
      const relevant = Object.keys(changes).some(
        (k) => k === META_KEY || k.startsWith(REPO_PREFIX) || k === KEY || k === SYNC_FLAG
      );
      if (!relevant || pending) return;
      pending = true;
      // 同一更新で複数キーが変化するため、まとめて1回だけ読み直す
      Promise.resolve().then(async () => {
        pending = false;
        callback(await load());
      });
    });
  }

  function exportJSON(state) {
    return JSON.stringify(state, null, 2);
  }

  function importJSON(json) {
    return update(() => normalize(JSON.parse(json)));
  }

  globalThis.GHTG = {
    KEY,
    PALETTE,
    init,
    load,
    update,
    getSyncEnabled,
    setSyncEnabled,
    canAddGroup,
    canAddRepoToGroup,
    syncUsage,
    createGroup,
    renameGroup,
    setGroupColor,
    deleteGroup,
    reorderGroups,
    setRepoGroups,
    toggleRepoInGroup,
    syncVisibleRepos,
    refreshRepoMeta,
    reposInGroup,
    groupsForOwner,
    sortRepos,
    setSort,
    setLang,
    groupsForRepo,
    onChange,
    exportJSON,
    importJSON,
    emptyState,
    normalize,
  };
})();
