const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

// Exercise the real workflow and capability validators. Only browser I/O and
// React hooks are simulated; no uploads, database writes or publishing occur.
function loader(overrides = {}) {
  const cache = new Map();
  return function load(file) {
    const filename = path.resolve(__dirname, file);
    if (cache.has(filename)) return cache.get(filename).exports;
    const module = { exports: {} };
    cache.set(filename, module);
    const source = fs.readFileSync(filename, "utf8");
    const js = ts.transpileModule(source, { compilerOptions: {
      module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true,
    } }).outputText;
    vm.runInNewContext(js, { module, exports: module.exports, Date, URL, Error, SyntaxError,
      fetch: overrides.fetch || (async () => ({ ok: true, headers: new Headers({ "content-type": "image/png" }) })),
      require(name) {
        if (Object.hasOwn(overrides, name)) return overrides[name];
        if (!name.startsWith(".")) return require(name);
        const base = path.resolve(path.dirname(filename), name);
        const target = [base, `${base}.ts`, `${base}.tsx`].find((candidate) => fs.existsSync(candidate) && fs.statSync(candidate).isFile());
        if (!target) throw Error(`Missing test module: ${name}`);
        return load(target);
      },
    }, { filename });
    return module.exports;
  };
}

const entry = (index, changes = {}) => ({ platform: "th", contentType: "Text", content: `Unique post ${index}`,
  date: "2099-01-01", time: "09:30", ...changes });
const documentFor = (posts, changes = {}) => JSON.stringify({ schemaVersion: 1, posts, ...changes });
const workflow = () => loader()("../src/lib/bulkJsonWorkflow.ts");

test("accepts 1 and 100 posts, including all preview rows in selection order", async () => {
  const { MAX_BULK_JSON_POSTS, BULK_JSON_SCHEMA_VERSION, validateBulkJson } = workflow();
  assert.equal(MAX_BULK_JSON_POSTS, 100);
  assert.equal(BULK_JSON_SCHEMA_VERSION, 1);
  assert.equal((await validateBulkJson(documentFor([entry(1)]), [])).valid, true);
  const result = await validateBulkJson(documentFor(Array.from({ length: 100 }, (_, index) => entry(index))), []);
  assert.equal(result.valid, true);
  assert.equal(result.rootErrors.length, 0);
  assert.equal(result.rows.length, 100);
  assert.equal(result.rows[99].row, 100);
  assert.equal(result.rows[99].destination.key, "json-row-100");
  assert.equal(result.rows[99].values.content, "Unique post 99");
  assert.ok(result.rows.every((row) => row.action === "planner-scheduled" && row.errors.length === 0));
});

test("rejects 101 posts and zero posts without changing preview validation behavior", async () => {
  const { validateBulkJson } = workflow();
  const oversized = await validateBulkJson(documentFor(Array.from({ length: 101 }, (_, index) => entry(index))), []);
  assert.equal(oversized.valid, false);
  assert.match(oversized.rootErrors.join(" "), /at most 100 entries/);
  assert.equal(oversized.rows.length, 101);
  const empty = await validateBulkJson(documentFor([]), []);
  assert.equal(empty.valid, false);
  assert.match(empty.rootErrors.join(" "), /at least one entry/);
});

test("preserves exact root schema, field validation, capabilities, dates and times", async () => {
  const { validateBulkJson } = workflow();
  for (const source of ["{", JSON.stringify([entry(1)]), documentFor([entry(1)], { schemaVersion: 2 }),
    documentFor([entry(1)], { extra: true }), documentFor("not-an-array")]) {
    const result = await validateBulkJson(source, []);
    assert.equal(result.valid, false);
    assert.ok(result.rootErrors.length > 0);
  }
  const posts = [entry(1, { extra: "forbidden" }), entry(2, { content: 123 }), entry(3, { platform: "li" }),
    entry(4, { contentType: "Unknown" }), entry(5, { date: "2099-02-30" }), entry(6, { time: "25:00" }),
    entry(7, { content: "" }), entry(8, { mediaUrl: "https://example.com/image.png" })];
  const result = await validateBulkJson(documentFor(posts), []);
  assert.equal(result.valid, false);
  assert.ok(result.rows.every((row) => row.errors.length > 0));
});

test("keeps duplicate detection within the batch and against existing planner posts", async () => {
  const { validateBulkJson } = workflow();
  const posts = Array.from({ length: 100 }, (_, index) => entry(index));
  posts[99] = entry(0);
  const duplicate = await validateBulkJson(documentFor(posts), []);
  assert.equal(duplicate.valid, false);
  assert.match(duplicate.rows[0].errors.join(" "), /Duplicates/);
  assert.match(duplicate.rows[99].errors.join(" "), /Duplicates/);
  const existing = await validateBulkJson(documentFor([entry(3)]), [{ ...entry(3), id: "existing-post", status: "scheduled" }]);
  assert.equal(existing.valid, false);
  assert.match(existing.rows[0].errors.join(" "), /existing scheduled post existing-post/);
});

test("keeps remote media validation and shared-URL metadata deduplication", async () => {
  let requests = 0;
  const { validateBulkJson } = loader({ fetch: async (url, options) => {
    requests++;
    assert.equal(options.method, "HEAD");
    return { ok: true, headers: new Headers({ "content-type": "image/png" }) };
  } })("../src/lib/bulkJsonWorkflow.ts");
  const image = (date) => ({ platform: "ig", contentType: "Image", mediaUrl: "https://example.com/shared.png", caption: "Caption", date, time: "09:30" });
  const valid = await validateBulkJson(documentFor([image("2099-01-01"), image("2099-01-02")]), []);
  assert.equal(valid.valid, true);
  assert.equal(requests, 1);
  const wrongMedia = await validateBulkJson(documentFor([{ ...image("2099-01-03"), contentType: "Reel" }]), []);
  assert.equal(wrongMedia.valid, false);
  assert.match(wrongMedia.rows[0].errors.join(" "), /requires video media/);
});

function nodes(node, predicate, found = []) {
  if (Array.isArray(node)) node.forEach((item) => nodes(item, predicate, found));
  else if (node && typeof node === "object" && node.props) {
    if (predicate(node)) found.push(node);
    nodes(node.props.children, predicate, found);
  }
  return found;
}
function text(node) {
  return Array.isArray(node) ? node.map(text).join("") : node?.props ? text(node.props.children) : node == null || node === false ? "" : String(node);
}

test("previews and progressively processes all 100 rows, preserving independent failures", async () => {
  const hooks = [];
  let cursor = 0;
  const react = {
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial;
      return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
  };
  const jsx = (type, props) => ({ type, props });
  const { BulkImportModal } = loader({ react, "react/jsx-runtime": { jsx, jsxs: jsx } })("../src/components/BulkImport/BulkImportModal.tsx");
  let tree;
  const created = [];
  const processingFlags = [];
  let releaseFirst;
  const props = { posts: [], onClose() {}, onModeChange() {}, onProcessingChange: (flag) => processingFlags.push(flag),
    async onCreate(post) {
      created.push(post);
      if (created.length === 1) await new Promise((resolve) => { releaseFirst = resolve; });
      if (created.length === 57) throw Error("Mock row failure");
      return { post: { ...post, id: `created-${created.length}` }, nativeAttempted: created.length === 88, nativeSucceeded: created.length !== 88,
        error: created.length === 88 ? "Mock native failure" : undefined };
    } };
  const render = () => { cursor = 0; tree = BulkImportModal(props); };
  const button = (label) => nodes(tree, (node) => node.type === "button" && text(node) === label)[0];
  render();
  assert.match(text(tree), /up to 100 independent posts/);
  nodes(tree, (node) => node.type === "textarea")[0].props.onChange({ target: {
    value: documentFor(Array.from({ length: 100 }, (_, index) => entry(index))),
  } });
  render();
  await button("Validate & Preview").props.onClick();
  render();
  assert.equal(nodes(tree, (node) => node.type === "tbody")[0].props.children.length, 100);
  assert.equal(button("Confirm & Process").props.disabled, false);
  const pending = button("Confirm & Process").props.onClick();
  render();
  let results = nodes(tree, (node) => node.props.className === "create-results")[0].props.children;
  assert.equal(results.length, 100);
  assert.equal(results[0].props.className, "create-result processing");
  assert.equal(results[99].props.className, "create-result queued");
  releaseFirst();
  await pending;
  render();
  results = nodes(tree, (node) => node.props.className === "create-results")[0].props.children;
  assert.equal(created.length, 100);
  assert.deepEqual(created.map((post) => post.content), Array.from({ length: 100 }, (_, index) => `Unique post ${index}`));
  assert.ok(created.every((post) => post.status === "scheduled" && post.scheduledAt));
  assert.equal(results.length, 100);
  assert.equal(results[56].props.className, "create-result failed");
  assert.equal(results[87].props.className, "create-result failed");
  assert.equal(results[99].props.className, "create-result success");
  assert.match(text(tree), /Successful: 98Failed: 2/);
  assert.deepEqual(processingFlags, [true, false]);
  assert.ok(button("Done"));
});
