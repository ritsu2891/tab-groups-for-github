/* storage.js のロジック検証（chrome.storage をメモリでモック） */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

// chrome.storage.sync / local をメモリでモック
const syncMem = {};
const localMem = {};
const listeners = [];
const clone = (v) => JSON.parse(JSON.stringify(v));
function fire(changes, area) {
  listeners.forEach((l) => l(changes, area));
}
function getImpl(store, keys, cb) {
  if (keys === null || keys === undefined) return cb(clone(store));
  const out = {};
  (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
    if (store[k] !== undefined) out[k] = clone(store[k]);
  });
  cb(out);
}
function setImpl(store, obj, area, cb) {
  const changes = {};
  Object.keys(obj).forEach((k) => {
    changes[k] = { oldValue: store[k], newValue: obj[k] };
    store[k] = clone(obj[k]);
  });
  if (cb) cb();
  fire(changes, area);
}
function removeImpl(store, keys, area, cb) {
  const changes = {};
  (Array.isArray(keys) ? keys : [keys]).forEach((k) => {
    if (store[k] !== undefined) {
      changes[k] = { oldValue: store[k] };
      delete store[k];
    }
  });
  if (cb) cb();
  if (Object.keys(changes).length) fire(changes, area);
}
global.chrome = {
  runtime: { id: "test-extension-id" },
  storage: {
    sync: {
      get: (k, cb) => getImpl(syncMem, k, cb),
      set: (o, cb) => {
        if (global.__failSync) {
          chrome.runtime.lastError = { message: "QUOTA_BYTES quota exceeded" };
          if (cb) cb();
          chrome.runtime.lastError = undefined;
          return;
        }
        setImpl(syncMem, o, "sync", cb);
      },
      remove: (k, cb) => removeImpl(syncMem, k, "sync", cb),
    },
    local: {
      get: (k, cb) => getImpl(localMem, k, cb),
      set: (o, cb) => setImpl(localMem, o, "local", cb),
      remove: (k, cb) => removeImpl(localMem, k, "local", cb),
    },
    onChanged: { addListener: (l) => listeners.push(l) },
  },
};

const code = fs.readFileSync(path.join(__dirname, "..", "src", "storage.js"), "utf8");
eval(code);
const S = globalThis.GHTG;

(async () => {
  // 初期状態
  let st = await S.load();
  assert.deepStrictEqual(st.groups, [], "groups empty initially");

  // createGroup（owner 必須）。owner 無しは作成されない。
  st = await S.createGroup("NoOwner");
  assert.strictEqual(st.groups.length, 0, "createGroup without owner is rejected");
  st = await S.createGroup("Work", null, "octocat");
  st = await S.createGroup("OSS", null, "octocat");
  assert.strictEqual(st.groups.length, 2, "two groups created");
  assert.strictEqual(st.groups[0].name, "Work");
  assert.notStrictEqual(st.groups[0].color, st.groups[1].color, "colors differ");
  assert.strictEqual(st.groups[0].owner, "octocat", "group has owner");
  const [work, oss] = st.groups;

  // toggleRepoInGroup（追加）
  const repoA = { fullName: "octocat/Hello-World", owner: "octocat", name: "Hello-World", url: "https://github.com/octocat/Hello-World", description: "desc", language: "Ruby" };
  st = await S.toggleRepoInGroup(repoA, work.id);
  assert.deepStrictEqual(S.groupsForRepo(st, repoA.fullName), [work.id], "repoA in work");
  assert.strictEqual(st.repos[repoA.fullName].language, "Ruby", "metadata stored");

  // 同じリポジトリを2つ目のグループにも
  st = await S.toggleRepoInGroup(repoA, oss.id);
  assert.deepStrictEqual(S.groupsForRepo(st, repoA.fullName).sort(), [work.id, oss.id].sort(), "repoA in both");

  // reposInGroup
  const repoB = { fullName: "torvalds/linux", owner: "torvalds", name: "linux", url: "https://github.com/torvalds/linux", description: "", language: "C" };
  st = await S.toggleRepoInGroup(repoB, oss.id);
  assert.strictEqual(S.reposInGroup(st, oss.id).length, 2, "oss has 2");
  assert.strictEqual(S.reposInGroup(st, work.id).length, 1, "work has 1");

  // toggle（解除）-> work から外すと repoA は oss のみ
  st = await S.toggleRepoInGroup(repoA, work.id);
  assert.deepStrictEqual(S.groupsForRepo(st, repoA.fullName), [oss.id], "repoA only oss now");

  // 全グループから外すとリポジトリ自体が消える
  st = await S.toggleRepoInGroup(repoA, oss.id);
  assert.strictEqual(st.repos[repoA.fullName], undefined, "repoA removed entirely");

  // reorderGroups（owner 内の順序）
  st = await S.reorderGroups([oss.id, work.id]);
  const ordered = S.groupsForOwner(st, "octocat");
  assert.strictEqual(ordered[0].id, oss.id, "oss first after reorder");
  assert.strictEqual(ordered[0].order, 0, "order updated");

  // deleteGroup -> メンバーシップのクリーンアップ
  st = await S.toggleRepoInGroup(repoB, work.id); // repoB を work にも入れておく
  assert.strictEqual(S.groupsForRepo(st, repoB.fullName).length, 2);
  st = await S.deleteGroup(oss.id);
  assert.strictEqual(st.groups.length, 1, "one group left");
  assert.deepStrictEqual(S.groupsForRepo(st, repoB.fullName), [work.id], "repoB only work after oss deleted");

  // export / import の往復
  const json = S.exportJSON(st);
  const parsed = JSON.parse(json);
  assert.strictEqual(parsed.groups.length, 1);
  st = await S.importJSON(json);
  assert.strictEqual(st.groups.length, 1, "import round-trip ok");

  // --- syncVisibleRepos: repoId による改名追従とメタ更新 ---
  st = await S.createGroup("Sync", null, "octocat");
  const syncG = st.groups[st.groups.length - 1].id;
  const repoC = {
    fullName: "octocat/old-name",
    repoId: "999001",
    owner: "octocat",
    name: "old-name",
    url: "https://github.com/octocat/old-name",
    description: "before",
    language: "Go",
  };
  st = await S.toggleRepoInGroup(repoC, syncG);
  assert.ok(st.repos["octocat/old-name"], "repoC stored under old name");
  assert.strictEqual(st.repos["octocat/old-name"].repoId, "999001", "repoId saved");

  // 変更が無ければ何も動かない（保存スキップ）
  const noChange = await S.syncVisibleRepos([
    { repoId: "999001", fullName: "octocat/old-name", owner: "octocat", name: "old-name", description: "before", language: "Go" },
  ]);
  assert.ok(noChange.repos["octocat/old-name"], "old name still present (no spurious migration)");
  assert.strictEqual(noChange.repos["octocat/new-name"], undefined, "no new key created on no-op sync");

  // 同じ repoId で fullName が変わった → 改名追従（キー移行＋メタ更新）
  st = await S.syncVisibleRepos([
    { repoId: "999001", fullName: "octocat/new-name", owner: "octocat", name: "new-name", url: "https://github.com/octocat/new-name", description: "after", language: "Rust" },
  ]);
  assert.strictEqual(st.repos["octocat/old-name"], undefined, "old key removed after rename");
  assert.ok(st.repos["octocat/new-name"], "new key present after rename");
  assert.deepStrictEqual(S.groupsForRepo(st, "octocat/new-name"), [syncG], "membership migrated");
  assert.strictEqual(st.repos["octocat/new-name"].description, "after", "description refreshed");
  assert.strictEqual(st.repos["octocat/new-name"].language, "Rust", "language refreshed");
  assert.strictEqual(st.repos["octocat/new-name"].repoId, "999001", "repoId preserved");

  // 未登録 repoId は無視（勝手に作らない）
  const before = JSON.stringify(st.repos);
  st = await S.syncVisibleRepos([{ repoId: "123456", fullName: "someone/unknown", owner: "someone", name: "unknown" }]);
  assert.strictEqual(JSON.stringify(st.repos), before, "untracked repoId ignored");

  // --- 並べ替え ---
  const sample = [
    { fullName: "a/zzz", language: "Go", addedAt: 100 },
    { fullName: "a/aaa", language: "Python", addedAt: 300 },
    { fullName: "a/mmm", language: "C", addedAt: 200 },
  ];
  assert.deepStrictEqual(
    S.sortRepos(sample, { key: "name", dir: "asc" }).map((r) => r.fullName),
    ["a/aaa", "a/mmm", "a/zzz"], "name asc"
  );
  assert.deepStrictEqual(
    S.sortRepos(sample, { key: "name", dir: "desc" }).map((r) => r.fullName),
    ["a/zzz", "a/mmm", "a/aaa"], "name desc"
  );
  assert.deepStrictEqual(
    S.sortRepos(sample, { key: "added", dir: "desc" }).map((r) => r.fullName),
    ["a/aaa", "a/mmm", "a/zzz"], "added newest first"
  );
  assert.deepStrictEqual(
    S.sortRepos(sample, { key: "language", dir: "asc" }).map((r) => r.language),
    ["C", "Go", "Python"], "language asc"
  );
  // 設定の保存と reposInGroup への反映
  st = await S.setSort("added", "desc");
  assert.deepStrictEqual(st.sort, { key: "added", dir: "desc" }, "sort persisted");

  // --- sync シャーディング（バイト単位）: 分割保存され復元できる ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  st = await S.createGroup("Many", null, "o");
  const manyG = st.groups[0].id;
  const desc = "x".repeat(120); // 上限いっぱいの説明（バイトを稼ぐ）
  for (let i = 0; i < 90; i++) {
    await S.toggleRepoInGroup(
      { fullName: "o/r" + i, owner: "o", name: "r" + i, repoId: "id" + i, language: "Go", description: desc },
      manyG
    );
  }
  assert.ok(syncMem["ghtg_meta"], "sync meta written");
  const chunkN = syncMem["ghtg_meta"].chunks;
  assert.ok(chunkN >= 2, "multiple byte-based shards (" + chunkN + ")");
  // 各シャードは 8KB 未満（per-item 上限）
  for (let i = 0; i < chunkN; i++) {
    const bytes = Buffer.byteLength(JSON.stringify(syncMem["ghtg_repos_" + i]), "utf8");
    assert.ok(bytes < 8192, "shard " + i + " under 8KB (" + bytes + ")");
  }
  st = await S.load();
  assert.strictEqual(S.reposInGroup(st, manyG).length, 90, "all 90 reassembled from sync");
  assert.ok(!localMem["ghtg"], "legacy local cleared when sync ok");

  // 件数が減ったら余分なシャードが掃除される
  for (let i = 30; i < 90; i++) await S.toggleRepoInGroup({ fullName: "o/r" + i }, manyG);
  st = await S.load();
  assert.strictEqual(S.reposInGroup(st, manyG).length, 30, "30 remain");
  assert.ok(syncMem["ghtg_meta"].chunks < chunkN, "fewer chunks after removal");
  assert.ok(!syncMem["ghtg_repos_" + (chunkN - 1)], "stale shard removed");

  // --- 説明文は保存時に MAX_DESC(120) まで短縮される ---
  st = await S.toggleRepoInGroup(
    { fullName: "o/long", repoId: "idlong", description: "a".repeat(500) },
    manyG
  );
  st = await S.load();
  assert.strictEqual(st.repos["o/long"].description.length, 120, "description truncated to 120");

  // --- 容量上限ガード: 件数は上限内でも合計バイト超過で 'bytes' 拒否 ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  const big = { groups: [], repos: {}, sort: { key: "name", dir: "asc" }, lang: "auto" };
  for (let g = 0; g < 4; g++) big.groups.push({ id: "bg" + g, name: "BG" + g, color: "#0969da", owner: "o", order: g });
  // 4グループ × 80件 = 320件（各グループ80<100）、説明120字で合計を上限付近へ
  for (let i = 0; i < 320; i++) {
    big.repos["o/b" + i] = {
      fullName: "o/b" + i, repoId: "bid" + i, owner: "o", name: "b" + i,
      url: "https://github.com/o/b" + i, description: "x".repeat(120),
      language: "Go", isPrivate: false, isFork: false, isArchived: false,
      addedAt: 1, groups: ["bg" + (i % 4)],
    };
  }
  st = await S.importJSON(JSON.stringify(big));
  st = await S.load();
  // 件数制限は無いが、合計バイトが上限付近なので追加は容量で拒否される
  assert.strictEqual(S.canAddRepoToGroup(st, "bg0"), false, "blocked by byte budget");
  assert.strictEqual(S.canAddGroup(st), false, "group add blocked by byte budget");
  const cnt0 = S.reposInGroup(st, "bg0").length;
  await S.toggleRepoInGroup({ fullName: "o/new", repoId: "idnew" }, "bg0");
  st = await S.load();
  assert.strictEqual(S.reposInGroup(st, "bg0").length, cnt0, "add rejected at byte limit");

  // --- 旧データ（owner 無しグループ）は破棄される ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  localMem["ghtg"] = {
    groups: [{ id: "old1", name: "Old", color: "#0969da", order: 0 }],
    repos: { "x/y": { fullName: "x/y", groups: ["old1"] } },
    sort: { key: "name", dir: "asc" },
    lang: "auto",
  };
  st = await S.init();
  assert.strictEqual(st.groups.length, 0, "owner-less legacy groups are discarded");
  assert.deepStrictEqual(st.repos, {}, "legacy repos discarded with old groups");

  // --- レガシー local（owner あり）→ sync 移行 (init) ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  localMem["ghtg"] = {
    groups: [{ id: "g1", name: "Legacy", color: "#0969da", owner: "a", order: 0 }],
    repos: { "a/b": { fullName: "a/b", owner: "a", groups: ["g1"] } },
    sort: { key: "name", dir: "asc" },
    lang: "auto",
  };
  st = await S.init();
  assert.strictEqual(st.groups[0].name, "Legacy", "legacy loaded by init");
  assert.ok(syncMem["ghtg_meta"], "init migrated to sync");
  assert.ok(!localMem["ghtg"], "legacy local removed after migration");
  // 移行後は load() が sync から読める
  st = await S.load();
  assert.deepStrictEqual(S.groupsForRepo(st, "a/b"), ["g1"], "membership survived migration");

  // --- 件数制限は無い: 同期ONでも100グループ・100リポジトリ超を作れる（容量内なら） ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  assert.strictEqual(await S.getSyncEnabled(), true, "sync default ON");
  for (let i = 0; i < 105; i++) st = await S.createGroup("G" + i, null, "o");
  assert.strictEqual(st.groups.length, 105, "over 100 groups allowed (no count limit)");
  st = await S.createGroup("Cap", null, "c");
  const capG = st.groups[st.groups.length - 1].id;
  for (let i = 0; i < 105; i++) {
    st = await S.toggleRepoInGroup({ fullName: "c/r" + i, repoId: "cid" + i }, capG);
  }
  assert.strictEqual(S.reposInGroup(st, capG).length, 105, "over 100 repos in a group allowed");

  // --- 同期トグル ON→OFF / OFF→ON ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  st = await S.createGroup("T", null, "t");
  const tG = st.groups[0].id;
  st = await S.toggleRepoInGroup({ fullName: "t/a", repoId: "ta" }, tG);
  assert.ok(syncMem["ghtg_meta"], "data on sync while ON");

  // ON → OFF: local に移り sync は掃除される
  let res = await S.setSyncEnabled(false);
  assert.deepStrictEqual(res, { ok: true, enabled: false }, "toggled OFF");
  assert.ok(localMem["ghtg"], "data moved to local");
  assert.ok(!syncMem["ghtg_meta"], "sync cleared on OFF");
  assert.strictEqual(await S.getSyncEnabled(), false, "flag OFF");
  st = await S.load();
  assert.deepStrictEqual(S.groupsForRepo(st, "t/a"), [tG], "data intact after OFF");
  assert.strictEqual(st.syncEnabled, false, "state.syncEnabled reflects OFF");

  // OFF → ON（上限内）: sync に移行
  res = await S.setSyncEnabled(true);
  assert.deepStrictEqual(res, { ok: true, enabled: true }, "toggled ON");
  assert.ok(syncMem["ghtg_meta"], "data back on sync");
  assert.ok(!localMem["ghtg"], "local cleared on ON");

  // --- OFF中に容量超過させ、ON にできないことを確認 ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  await S.setSyncEnabled(false); // OFF（容量無制限）
  // 同期容量を超える大量データを OFF 状態で投入（OFFなので可能）
  const over = { groups: [{ id: "og", name: "Over", color: "#0969da", owner: "o", order: 0 }], repos: {}, sort: { key: "name", dir: "asc" }, lang: "auto" };
  for (let i = 0; i < 400; i++) {
    over.repos["o/o" + i] = {
      fullName: "o/o" + i, repoId: "oid" + i, owner: "o", name: "o" + i,
      url: "https://github.com/o/o" + i, description: "x".repeat(120),
      language: "Go", isPrivate: false, isFork: false, isArchived: false,
      addedAt: 1, groups: ["og"],
    };
  }
  st = await S.importJSON(JSON.stringify(over));
  st = await S.load();
  assert.strictEqual(st.syncEnabled, false, "still OFF");
  res = await S.setSyncEnabled(true);
  assert.strictEqual(res.ok, false, "enable blocked when over byte capacity");
  assert.strictEqual(res.reason, "limit", "reason is limit");
  assert.strictEqual(await S.getSyncEnabled(), false, "stays OFF when blocked");

  // --- refreshRepoMeta: 登録済みリポジトリの説明/言語/公開状態を充実（Org用） ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  st = await S.createGroup("OrgG", null, "o");
  const orgG = st.groups[0].id;
  st = await S.toggleRepoInGroup({ fullName: "o/app", description: "", language: "" }, orgG);
  // 表示中の行から説明/言語を補完
  st = await S.refreshRepoMeta([
    { fullName: "o/app", description: "An app", language: "JavaScript", isPrivate: true },
    { fullName: "o/unregistered", description: "ignored", language: "Go" },
  ]);
  assert.strictEqual(st.repos["o/app"].description, "An app", "description enriched");
  assert.strictEqual(st.repos["o/app"].language, "JavaScript", "language enriched");
  assert.strictEqual(st.repos["o/app"].isPrivate, true, "visibility enriched");
  assert.strictEqual(st.repos["o/unregistered"], undefined, "untracked repo not created");
  // 変更が無ければ false（保存スキップ）
  const noop = await S.refreshRepoMeta([{ fullName: "o/app", description: "An app", language: "JavaScript" }]);
  assert.strictEqual(noop.repos["o/app"].description, "An app", "idempotent");

  // --- URL サニタイズ: 危険な URL は import/書き込みで無害化される ---
  for (const k of Object.keys(syncMem)) delete syncMem[k];
  for (const k of Object.keys(localMem)) delete localMem[k];
  // import: javascript: などは https://github.com/<fullName> に置換
  const evil = {
    groups: [{ id: "gx", name: "G", color: "#000", owner: "victim", order: 0 }],
    repos: {
      "victim/repo": { fullName: "victim/repo", owner: "victim", name: "repo", url: "javascript:alert(1)", groups: ["gx"] },
      "victim/data": { fullName: "victim/data", owner: "victim", name: "data", url: "data:text/html,x", groups: ["gx"] },
      "victim/ok": { fullName: "victim/ok", owner: "victim", name: "ok", url: "https://github.com/victim/ok", groups: ["gx"] },
    },
  };
  st = await S.importJSON(JSON.stringify(evil));
  assert.strictEqual(st.repos["victim/repo"].url, "https://github.com/victim/repo", "javascript: URL sanitized on import");
  assert.strictEqual(st.repos["victim/data"].url, "https://github.com/victim/data", "data: URL sanitized on import");
  assert.strictEqual(st.repos["victim/ok"].url, "https://github.com/victim/ok", "valid github URL preserved");
  // 書き込み経路（toggleRepoInGroup）でも無害化
  st = await S.toggleRepoInGroup({ fullName: "victim/x", owner: "victim", name: "x", url: "javascript:evil()" }, "gx");
  assert.strictEqual(st.repos["victim/x"].url, "https://github.com/victim/x", "toggleRepoInGroup sanitizes URL");

  console.log("ALL STORAGE TESTS PASSED");
})().catch((e) => {
  console.error("TEST FAILED:", e.message);
  process.exit(1);
});
