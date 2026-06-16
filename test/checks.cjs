/*
 * Static sanity checks for packaging/CI:
 *  - manifest.json: MV3, required fields, referenced files exist
 *  - _locales: valid JSON, appName/appDesc present (en/ja)
 *  - i18n.js: ja/en key parity
 * Exits non-zero if any check fails.
 */
const fs = require("fs");
const path = require("path");
const assert = require("assert");

const root = path.join(__dirname, "..");
const p = (...a) => path.join(root, ...a);
let failures = 0;

function check(name, fn) {
  try {
    fn();
    console.log("ok   -", name);
  } catch (e) {
    failures++;
    console.error("FAIL -", name, "=>", e.message);
  }
}

const manifest = JSON.parse(fs.readFileSync(p("manifest.json"), "utf8"));

check("manifest_version is 3", () => assert.strictEqual(manifest.manifest_version, 3));
check("manifest has name/version/description/default_locale", () => {
  ["name", "version", "description", "default_locale"].forEach((k) =>
    assert(manifest[k], "missing " + k)
  );
});
check("content_scripts reference existing files", () => {
  const cs = (manifest.content_scripts || [])[0] || {};
  [...(cs.js || []), ...(cs.css || [])].forEach((f) =>
    assert(fs.existsSync(p(f)), "missing " + f)
  );
});
check("icons reference existing PNGs", () => {
  const refs = []
    .concat(Object.values(manifest.icons || {}))
    .concat(Object.values((manifest.action || {}).default_icon || {}));
  assert(refs.length, "no icons declared");
  refs.forEach((f) => assert(fs.existsSync(p(f)), "missing " + f));
});

for (const loc of ["en", "ja"]) {
  check(`_locales/${loc}: valid JSON with appName/appDesc`, () => {
    const m = JSON.parse(fs.readFileSync(p("_locales", loc, "messages.json"), "utf8"));
    assert(m.appName && m.appName.message, "appName.message");
    assert(m.appDesc && m.appDesc.message, "appDesc.message");
  });
}

check("i18n.js: ja/en key parity", () => {
  const src = fs.readFileSync(p("src", "i18n.js"), "utf8");
  const m = src.match(/const STRINGS = (\{[\s\S]*?\n {2}\});/);
  assert(m, "could not locate STRINGS object in i18n.js");
  const STRINGS = eval("(" + m[1] + ")");
  const ja = Object.keys(STRINGS.ja || {});
  const en = Object.keys(STRINGS.en || {});
  assert(ja.length && en.length, "ja/en tables not found");
  const missEn = ja.filter((k) => !en.includes(k));
  const missJa = en.filter((k) => !ja.includes(k));
  assert.strictEqual(
    missEn.length + missJa.length,
    0,
    `key mismatch — missing in en: [${missEn}], missing in ja: [${missJa}]`
  );
});

if (failures) {
  console.error(`\n${failures} check(s) FAILED`);
  process.exit(1);
}
console.log("\nALL CHECKS PASSED");
