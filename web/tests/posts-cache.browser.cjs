// Uses an isolated temporary Chrome profile and never connects to Supabase.
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const cp = require("node:child_process");
const ts = require("typescript");
const tmpRoot = fs.realpathSync(os.tmpdir());
const directory = fs.mkdtempSync(path.join(tmpRoot, "social-planner-cache-check-"));
const source = fs.readFileSync(path.join(__dirname, "../src/lib/postsCache.ts"), "utf8")
  .replace("import.meta.env.VITE_SUPABASE_URL", JSON.stringify("https://cache-test.invalid"));
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const browserChecks = `
const {clearPostsCache,getPostsCacheSnapshot,getCachedPublishedPosts,upsertCachedPosts,removeCachedPost,
  getPostsCacheMetadata,setPostsCacheMetadata,createPostsCacheMetadata,isValidPostsCache}=exports;
(async()=>{
  let count=0;
  const check=(condition,message)=>{if(!condition)throw Error(message);count++};
  await clearPostsCache();check(!(await getPostsCacheMetadata()),'clear metadata');
  const p={id:'one',platform:'ig',status:'published',contentType:'Image',date:'2025-01-01',time:'10:00',
    title:'full title',caption:'full caption',mediaUrl:'https://example.com/video.mp4',shares:7,views:12};
  await upsertCachedPosts([p,{...p,id:'active',status:'scheduled'}],createPostsCacheMetadata('2026-10-02T00:00:00.000Z'),true);
  let state=await getPostsCacheSnapshot();
  check(isValidPostsCache(state),'valid atomic snapshot');check(state.metadata.publishedCount===1,'count only published');
  check(state.posts[0].caption==='full caption','full objects');check(state.posts[0].shares===7,'shares');
  await upsertCachedPosts([{...p,views:33}]);check((await getCachedPublishedPosts())[0].views===33,'upsert identity');
  await upsertCachedPosts([{...p,status:'draft'}]);check((await getCachedPublishedPosts()).length===0,'active removes cached');
  check((await getPostsCacheMetadata()).publishedCount===0,'active count');
  await upsertCachedPosts([p,{...p,id:'two'}]);await removeCachedPost('one');
  check((await getCachedPublishedPosts())[0].id==='two','remove identity');check((await getPostsCacheMetadata()).publishedCount===1,'delete count');
  await setPostsCacheMetadata(createPostsCacheMetadata('2026-10-02T01:00:00.000Z'));
  check((await getPostsCacheMetadata()).publishedCount===1,'metadata retains count');
  await Promise.all([upsertCachedPosts([{...p,id:'three'}]),removeCachedPost('two')]);state=await getPostsCacheSnapshot();
  check(isValidPostsCache(state),'concurrent transaction count');check(state.posts.length===1&&state.posts[0].id==='three','native writes');
  await clearPostsCache();check((await getCachedPublishedPosts()).length===0,'reset records');check(!(await getPostsCacheMetadata()),'reset initialization');
  document.getElementById('result').textContent='PASS: '+count+' native IndexedDB assertions';
})().catch(error=>document.getElementById('result').textContent='FAIL: '+error.message);
`;

(async () => {
let browser;
let socket;
try {
  const html = path.join(directory, "index.html");
  fs.writeFileSync(html, `<html><body><pre id="result">RUNNING</pre><script>var exports=(()=>{var exports={};${js};return exports;})();${browserChecks}</script></body></html>`);
  const executable = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
  const profile = path.join(directory, "profile");
  browser = cp.spawn(executable, ["--headless", "--disable-gpu", "--no-first-run", "--no-default-browser-check",
    "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`], { windowsHide: true, stdio: "ignore" });
  browser.on("error", () => {});
  const portFile = path.join(profile, "DevToolsActivePort");
  for (let attempt = 0; !fs.existsSync(portFile) && attempt < 100; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  if (!fs.existsSync(portFile)) throw Error("Headless Chrome did not start.");
  const [port, endpoint] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
  socket = new WebSocket(`ws://127.0.0.1:${port}${endpoint}`);
  await new Promise((resolve, reject) => { socket.onopen = resolve; socket.onerror = reject; });
  let id = 0;
  const responses = new Map();
  socket.onmessage = (event) => {
    const message = JSON.parse(event.data);
    const waiting = responses.get(message.id);
    if (waiting) { responses.delete(message.id); message.error ? waiting.reject(Error(message.error.message)) : waiting.resolve(message.result); }
  };
  const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const nextId = ++id; responses.set(nextId, { resolve, reject }); socket.send(JSON.stringify({ id: nextId, method, params, sessionId }));
  });
  const { targetId } = await call("Target.createTarget", { url: `file:///${html.replaceAll("\\", "/")}` });
  const { sessionId } = await call("Target.attachToTarget", { targetId, flatten: true });
  const evaluation = await call("Runtime.evaluate", {
    expression: `new Promise(resolve => { const poll = () => { const value = document.getElementById('result')?.textContent; if (value && value !== 'RUNNING') resolve(value); else setTimeout(poll, 50); }; poll(); setTimeout(() => resolve('TIMEOUT'), 15000); })`,
    awaitPromise: true, returnByValue: true,
  }, sessionId);
  const output = `<pre id="result">${evaluation.result.value}</pre>`;
  await call("Browser.close").catch(() => undefined);
  for (let attempt = 0; browser.exitCode === null && attempt < 20; attempt++) await new Promise(resolve => setTimeout(resolve, 100));
  socket.close();

  const result = output.match(/<pre id="result">([^<]*)<\/pre>/)?.[1];
  console.log(result || "No browser result");
  if (!result?.startsWith("PASS:")) process.exitCode = 1;
} catch (error) {
  console.error(error.message);
  if (error.stderr) console.error(String(error.stderr).slice(-1500));
  process.exitCode = 1;
} finally {
  if (socket) socket.close();
  if (browser && browser.exitCode === null) browser.kill();
  const target = fs.realpathSync(directory);
  // Verify the absolute target belongs to this test before recursive cleanup.
  if (path.dirname(target).toLowerCase() === tmpRoot.toLowerCase() && path.basename(target).startsWith("social-planner-cache-check-")) {
    try { fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { console.log(`Temporary browser fixture retained at ${target}`); }
  }
}

})().catch(error => { console.error(error); process.exitCode = 1; });
