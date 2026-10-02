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

const facebook = (contentType, changes = {}) => ({ platform: "fb", contentType, content: "Caption", date: "2099-01-01", time: "09:30", ...changes });
const imageUrls = ["https://cdn.example/second.jpg", "https://cdn.example/first.jpg"];
const facebookLoader = () => loader({ fetch: async (url) => ({ ok: true, headers: new Headers({ "content-type": url.endsWith(".mp4") ? "video/mp4" : "image/jpeg" }) }) });

test("Create Post and Bulk JSON accept exactly the four Facebook types and retain ordered media", async () => {
  const load = facebookLoader();
  const { validateBulkJson } = load("../src/lib/bulkJsonWorkflow.ts");
  const { destinationToPost, compatibleDestinations, validateDestination } = load("../src/lib/createPostWorkflow.ts");
  const accepted = await validateBulkJson(documentFor([
    facebook("Text"), facebook("Image", { mediaUrl: imageUrls[0] }),
    facebook("Multiple Images", { mediaUrls: imageUrls }), facebook("Reel", { mediaUrl: "https://cdn.example/reel.mp4" }),
  ]), []);
  assert.equal(accepted.valid, true, accepted.rows.map((row) => row.errors.join(" ")).join(" "));
  assert.ok(accepted.rows.every((row) => row.action === "facebook-native-scheduled"));
  const posts = accepted.rows.map((row) => destinationToPost(row.destination, row.media));
  assert.deepEqual(Array.from(posts[2].mediaUrls), imageUrls);
  assert.equal(posts[2].mediaUrl, null);
  assert.equal(posts[1].mediaUrl, imageUrls[0]);
  assert.equal(posts[3].mediaUrl, "https://cdn.example/reel.mp4");
  assert.ok(accepted.rows.every((row) => !validateDestination(row.destination, row.media).errors.length));
  assert.deepEqual(Array.from(compatibleDestinations("image", true), (option) => option.key), ["fb:Multiple Images"]);
  assert.ok(compatibleDestinations("video").some((option) => option.key === "fb:Reel"));
  assert.ok(!compatibleDestinations("image").some((option) => option.contentType === "Multiple Images"));
  for (const type of ["Video", "Story Image", "Story Video", "Unknown"]) {
    assert.equal((await validateBulkJson(documentFor([facebook(type, { mediaUrl: imageUrls[0] })]), [])).valid, false);
  }
});

test("Facebook media cardinality, field and actual media-type validation reject malformed inputs", async () => {
  const { validateBulkJson } = facebookLoader()("../src/lib/bulkJsonWorkflow.ts");
  const invalid = [
    facebook("Multiple Images"), facebook("Multiple Images", { mediaUrls: imageUrls[0] }),
    facebook("Multiple Images", { mediaUrls: [] }), facebook("Multiple Images", { mediaUrls: [imageUrls[0]] }),
    facebook("Multiple Images", { mediaUrls: [imageUrls[0], "https://cdn.example/video.mp4"] }),
    facebook("Multiple Images", { mediaUrls: [imageUrls[0], "file:///bad.jpg"] }),
    facebook("Multiple Images", { mediaUrls: [imageUrls[0], 5] }),
    facebook("Multiple Images", { mediaUrls: imageUrls, mediaUrl: imageUrls[0] }),
    facebook("Reel", { mediaUrl: imageUrls[0] }), facebook("Reel", { mediaUrls: imageUrls }),
    facebook("Image", { mediaUrl: "https://cdn.example/video.mp4" }),
    facebook("Image", { mediaUrl: imageUrls[0], mediaUrls: imageUrls }),
    facebook("Text", { mediaUrls: imageUrls }),
    entry(1, { mediaUrls: imageUrls }),
  ];
  const result = await validateBulkJson(documentFor(invalid), []);
  assert.equal(result.valid, false);
  assert.ok(result.rows.every((row) => row.errors.length));
});

test("Multiple Images duplicate identity uses normalized URLs in order, including persisted posts", async () => {
  const load = facebookLoader();
  const { validateBulkJson } = load("../src/lib/bulkJsonWorkflow.ts");
  const { destinationToPost, duplicateIdentity } = load("../src/lib/createPostWorkflow.ts");
  const first = facebook("Multiple Images", { mediaUrls: imageUrls });
  const normalized = facebook("Multiple Images", { mediaUrls: ["https://CDN.example/second.jpg#preview", imageUrls[1]] });
  const same = await validateBulkJson(documentFor([first, normalized]), []);
  assert.equal(same.valid, false);
  assert.ok(same.rows.every((row) => row.errors.some((error) => /Duplicates/.test(error))));
  const reordered = await validateBulkJson(documentFor([first, { ...first, mediaUrls: [...imageUrls].reverse() }]), []);
  assert.equal(reordered.valid, true);
  const prior = { ...destinationToPost(reordered.rows[0].destination, reordered.rows[0].media), id: "prior", status: "scheduled" };
  const existing = await validateBulkJson(documentFor([normalized]), [prior]);
  assert.match(existing.rows[0].errors.join(" "), /existing scheduled post prior/);
  assert.notEqual(duplicateIdentity(reordered.rows[0].destination, null, imageUrls), duplicateIdentity(reordered.rows[0].destination, null, [imageUrls[0], "https://cdn.example/another.jpg"]));
});

test("ordered media arrays round-trip through persistence while old single-media rows remain valid", async () => {
  let written;
  const query = { insert(row) { written = row; return this; }, select() { return this; }, order() { return this; }, limit() { return this; },
    async single() { return { data: { ...written, id: "persisted", created_at: "now", updated_at: "now" }, error: null }; } };
  const { createPost } = loader({ "./supabase": { supabase: { from() { return query; } } } })("../src/lib/supabasePosts.ts");
  const multi = await createPost({ ...facebook("Multiple Images"), status: "scheduled", mediaUrl: null, mediaUrls: imageUrls });
  assert.deepEqual(written.media_urls, imageUrls);
  assert.deepEqual(multi.mediaUrls, imageUrls);
  const image = await createPost({ ...facebook("Image"), status: "scheduled", mediaUrl: imageUrls[0] });
  assert.equal(Object.hasOwn(written, "media_urls"), false);
  assert.equal(image.mediaUrl, imageUrls[0]);
  assert.equal(image.mediaUrls, null);
});

test("Facebook immediate claims exclude accepted native posts; ambiguous Reel IDs are persisted", async () => {
  const calls = [];
  let updated;
  const row = { id: "post", platform: "fb", content_type: "Multiple Images", media_urls: imageUrls, status: "scheduled" };
  const query = {};
  for (const method of ["select", "eq", "or", "not", "lte", "gt", "is", "in", "order"]) query[method] = (...args) => { calls.push([method, ...args]); return query; };
  query.update = (value) => { updated = value; return query; };
  query.maybeSingle = query.single = async () => ({ data: { ...row, ...updated }, error: null });
  query.then = (resolve, reject) => Promise.resolve({ data: [row], error: null }).then(resolve, reject);
  const posts = loader({ "./lib/supabase": { supabaseServer: { from() { return query; } } } })("../../server/src/posts.ts");
  assert.deepEqual(Array.from((await posts.claimDuePostForPublishing("post")).mediaUrls), imageUrls);
  assert.ok(calls.some((call) => call[0] === "or" && call[1] === "platform.in.(ig,th),and(platform.eq.fb,platform_post_id.is.null)"));
  calls.length = 0;
  await posts.claimPostForNativeScheduling("post");
  assert.ok(calls.some((call) => call[0] === "is" && call[1] === "platform_post_id" && call[2] === null));
  assert.ok(calls.some((call) => call[0] === "gt" && call[1] === "scheduled_at"));
  await posts.updatePublishingError("post", "Reel processing pending", "reel-id");
  assert.equal(updated.platform_post_id, "reel-id");
  assert.equal(updated.status, "failed");
});

test("Create Post multi-image input uploads in selection order, previews, removes and rejects videos", async () => {
  const hooks = [];
  const effects = [];
  let cursor = 0;
  const react = {
    useRef(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = { current: initial }; return hooks[index]; },
    useState(initial) { const index = cursor++; if (!(index in hooks)) hooks[index] = initial; return [hooks[index], (value) => { hooks[index] = typeof value === "function" ? value(hooks[index]) : value; }]; },
    useEffect(callback, deps) { const index = cursor++; const previous = hooks[index];
      if (!previous || deps.some((dep, i) => dep !== previous.deps[i])) effects.push(() => { previous?.cleanup?.(); hooks[index] = { deps, cleanup: callback() }; }); },
  };
  const originalCreate = URL.createObjectURL, originalRevoke = URL.revokeObjectURL;
  const revoked = [];
  const uploads = [];
  URL.createObjectURL = (file) => `blob:${file.name}`;
  URL.revokeObjectURL = (url) => revoked.push(url);
  try {
    const jsx = (type, props) => ({ type, props });
    const { MultipleImagesSource } = loader({ react, "react/jsx-runtime": { jsx, jsxs: jsx },
      "../../lib/cloudinary": {
        isImageFile: (file) => file.type.startsWith("image/"), validateMediaFile: () => ({ valid: true }),
        async uploadMediaFile(file) { uploads.push(file.name); return { secure_url: `https://cdn.example/${file.name}`, public_id: file.name }; },
      },
    })("../src/components/CreatePost/MultipleImagesSource.tsx");
    let tree, images;
    const flags = [];
    const props = { onChange: (value) => { images = value; }, onBusy: (value) => flags.push(value) };
    const render = () => { cursor = 0; tree = MultipleImagesSource(props); while (effects.length) effects.shift()(); };
    const input = () => nodes(tree, (node) => node.type === "input")[0];
    render();
    assert.equal(input().props.multiple, true);
    await input().props.onChange({ target: { files: [{ name: "bad.mp4", type: "video/mp4" }], value: "" } });
    render();
    assert.match(text(tree), /images only/);
    assert.equal(uploads.length, 0);
    await input().props.onChange({ target: { files: ["third.jpg", "first.jpg", "second.jpg"].map((name) => ({ name, type: "image/jpeg", size: 10 })), value: "" } });
    render();
    assert.deepEqual(uploads, ["third.jpg", "first.jpg", "second.jpg"]);
    assert.deepEqual(Array.from(images, (image) => image.url), uploads.map((name) => `https://cdn.example/${name}`));
    assert.equal(nodes(tree, (node) => node.type === "img").length, 3);
    nodes(tree, (node) => node.type === "button" && text(node) === "Remove image 2")[0].props.onClick();
    render();
    assert.deepEqual(Array.from(images, (image) => image.url), ["https://cdn.example/third.jpg", "https://cdn.example/second.jpg"]);
    assert.deepEqual(revoked, ["blob:third.jpg", "blob:first.jpg", "blob:second.jpg"]);
    assert.deepEqual(flags, [true, false]);
    hooks.forEach((hook) => hook?.cleanup?.());
    assert.equal(revoked.length, 3);
  } finally { URL.createObjectURL = originalCreate; URL.revokeObjectURL = originalRevoke; }
});
