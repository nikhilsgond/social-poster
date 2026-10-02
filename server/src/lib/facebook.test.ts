import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { FacebookGraphClient } from "./facebook";
import { FacebookPublisher } from "../platforms/publishers/facebook";
import { PLATFORM_CAPABILITIES, validatePlatformPostCapability } from "../platform-capabilities";
import type { Post } from "../types";

type Call = { url: URL; options: RequestInit };
const originalFetch = globalThis.fetch;
function mockApi(t: TestContext, answer?: (call: Call) => unknown) {
  const calls: Call[] = [];
  globalThis.fetch = (async (input: string | URL | Request, options: RequestInit = {}) => {
    const call = { url: new URL(String(input)), options };
    calls.push(call);
    if (options.method === "HEAD") return new Response(null, { headers: { "content-type": call.url.pathname.endsWith(".mp4") ? "video/mp4" : "image/jpeg" } });
    const custom = answer?.(call);
    if (custom instanceof Error) throw custom;
    if (custom !== undefined) return Response.json(custom);
    if (call.url.hostname === "rupload.facebook.com") return Response.json({ success: true });
    if (options.method === "GET") return Response.json({ status: { video_status: "ready", processing_phase: { status: "complete" }, publishing_phase: { status: "complete" } } });
    const phase = call.url.searchParams.get("upload_phase");
    if (phase === "start") return Response.json({ video_id: "reel-id", upload_url: "https://rupload.facebook.com/video-upload/v26.0/reel-id" });
    if (phase === "finish") return Response.json({ success: true });
    return Response.json({ id: call.url.pathname.endsWith("/photos") ? `photo-${calls.length}` : "page_post" });
  }) as typeof fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  return calls;
}
const client = () => new FacebookGraphClient({ pageId: "page", pageAccessToken: "test-page-token", reelPollingAttempts: 2, reelPollingIntervalMs: 0 });
const post = (contentType: string, changes: Partial<Post> = {}): Post => ({ id: "test-post", platform: "fb", contentType, date: "2099-01-01", time: "09:30", content: "Caption", status: "scheduled", ...changes });

test("Facebook has exactly four canonical types; Video, Stories and unknown types fail", () => {
  assert.deepEqual(PLATFORM_CAPABILITIES.fb.contentTypes.map((type) => type.name), ["Text", "Image", "Multiple Images", "Reel"]);
  for (const item of [post("Text"), post("Image", { mediaUrl: "https://cdn.example/a.jpg" }), post("Multiple Images", { mediaUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"] }), post("Reel", { mediaUrl: "https://cdn.example/a.mp4" })]) {
    assert.deepEqual(validatePlatformPostCapability(item).errors, []);
  }
  for (const type of ["Video", "Story Image", "Story Video", "Unknown"]) assert.ok(validatePlatformPostCapability(post(type)).errors.length);
  for (const mediaUrls of [undefined, "https://cdn.example/a.jpg", [], ["https://cdn.example/a.jpg"], ["https://cdn.example/a.jpg", "file:///bad"], ["https://cdn.example/a.jpg", 5]]) {
    assert.ok(validatePlatformPostCapability({ ...post("Multiple Images"), mediaUrls }).errors.length);
  }
  assert.ok(validatePlatformPostCapability(post("Image", { mediaUrl: "https://cdn.example/a.jpg", mediaUrls: [] })).errors.length);
});

test("multi-photo publisher uploads unpublished photos in order and creates one captioned feed post", async (t) => {
  const calls = mockApi(t);
  const result = await client().publishMultipleImages(["https://cdn.example/b.jpg", "https://cdn.example/a.jpg"], "Caption");
  assert.equal(result.success, true);
  assert.equal(result.platformPostId, "page_post");
  const photos = calls.filter((call) => call.url.pathname.endsWith("/photos"));
  assert.deepEqual(photos.map((call) => call.url.searchParams.get("url")), ["https://cdn.example/b.jpg", "https://cdn.example/a.jpg"]);
  assert.ok(photos.every((call) => call.url.searchParams.get("published") === "false" && !call.url.searchParams.has("message")));
  const feeds = calls.filter((call) => call.url.pathname.endsWith("/feed"));
  assert.equal(feeds.length, 1);
  assert.equal(feeds[0].url.searchParams.get("message"), "Caption");
  assert.deepEqual(JSON.parse(feeds[0].url.searchParams.get("attached_media")!), photos.map((_, index) => ({ media_fbid: `photo-${index + 3}` })));
});

test("multi-photo validation rejects one image and videos before any Graph writes", async (t) => {
  const calls = mockApi(t);
  assert.equal((await client().publishMultipleImages(["https://cdn.example/a.jpg"])).success, false);
  assert.equal((await client().publishMultipleImages(["https://cdn.example/a.jpg", "https://cdn.example/a.mp4"])).success, false);
  assert.ok(calls.every((call) => call.options.method === "HEAD"));
});

test("multi-photo upload failure prevents the final visible feed post", async (t) => {
  const calls = mockApi(t, (call) => call.url.pathname.endsWith("/photos") ? new Error("Mock photo failure") : undefined);
  assert.equal((await client().publishMultipleImages(["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"])).success, false);
  assert.equal(calls.filter((call) => call.url.pathname.endsWith("/feed")).length, 0);
});

test("Reel uses start, hosted transfer, finish and processing polling; never photos/feed", async (t) => {
  let polls = 0;
  const calls = mockApi(t, (call) => call.options.method === "GET" && ++polls === 1 ? { status: { video_status: "processing", processing_phase: { status: "in_progress" } } } : undefined);
  const result = await client().publishReel("https://cdn.example/a.mp4", "Reel caption");
  assert.equal(result.success, true);
  assert.equal(result.platformPostId, "reel-id");
  assert.equal(polls, 2);
  assert.deepEqual(calls.map((call) => call.url.searchParams.get("upload_phase")).filter(Boolean), ["start", "finish"]);
  const transfer = calls.find((call) => call.url.hostname === "rupload.facebook.com")!;
  assert.deepEqual(transfer.options.headers, { Authorization: "OAuth test-page-token", file_url: "https://cdn.example/a.mp4" });
  const finish = calls.find((call) => call.url.searchParams.get("upload_phase") === "finish")!;
  assert.equal(finish.url.searchParams.get("description"), "Reel caption");
  assert.equal(finish.url.searchParams.get("video_state"), "PUBLISHED");
  assert.ok(!calls.some((call) => /\/(photos|feed)$/.test(call.url.pathname)));
});

test("Reel image media is rejected before initialization", async (t) => {
  const calls = mockApi(t);
  assert.equal((await client().publishReel("https://cdn.example/a.jpg")).success, false);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, "HEAD");
});

test("future multi-photo and Reel scheduling uses endpoint-supported parameters", async (t) => {
  const calls = mockApi(t, (call) => call.options.method === "GET" ? { status: { video_status: "ready", processing_phase: { status: "complete" }, publishing_phase: { status: "not_started" } } } : undefined);
  const time = Math.floor(new Date("2099-01-01T09:30:00Z").getTime() / 1000);
  assert.equal((await client().publishMultipleImages(["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"], "Caption", time)).success, true);
  assert.equal((await client().publishReel("https://cdn.example/a.mp4", "Caption", time)).success, true);
  const feed = calls.find((call) => call.url.pathname.endsWith("/feed"))!;
  assert.equal(feed.url.searchParams.get("published"), "false");
  assert.equal(feed.url.searchParams.get("scheduled_publish_time"), String(time));
  const finish = calls.find((call) => call.url.searchParams.get("upload_phase") === "finish")!;
  assert.equal(finish.url.searchParams.get("video_state"), "SCHEDULED");
  assert.equal(finish.url.searchParams.get("scheduled_publish_time"), String(time));
});

test("pending/error Reel status and ambiguous finish retain ID to prevent blind retries", async (t) => {
  for (const kind of ["pending", "error", "finish-error"]) {
    mockApi(t, (call) => {
      if (kind === "finish-error" && call.url.searchParams.get("upload_phase") === "finish") return new Error("Mock ambiguous finish test-page-token");
      if (call.options.method === "GET") return { status: { video_status: kind === "error" ? "error" : "processing" } };
      return undefined;
    });
    const result = await client().publishReel("https://cdn.example/a.mp4");
    assert.equal(result.success, false);
    assert.equal(result.platformPostId, "reel-id");
    assert.ok(!result.error?.includes("test-page-token"));
  }
});

test("untrusted upload host and transfer failures do not finalize the Reel", async (t) => {
  for (const kind of ["host", "transfer"]) {
    const calls = mockApi(t, (call) => {
      if (kind === "host" && call.url.searchParams.get("upload_phase") === "start") return { video_id: "reel-id", upload_url: "https://bad.example/upload" };
      if (kind === "transfer" && call.url.hostname === "rupload.facebook.com") return { success: false };
      return undefined;
    });
    assert.equal((await client().publishReel("https://cdn.example/a.mp4")).success, false);
    assert.ok(!calls.some((call) => call.url.hostname === "bad.example" || call.url.searchParams.get("upload_phase") === "finish"));
  }
});

test("Facebook publisher dispatches all four types and rejects unsupported types before API I/O", async (t) => {
  const calls = mockApi(t);
  const publisher = new FacebookPublisher("page", "test-page-token");
  for (const item of [post("Text"), post("Image", { mediaUrl: "https://cdn.example/a.jpg" }), post("Multiple Images", { mediaUrls: ["https://cdn.example/a.jpg", "https://cdn.example/b.jpg"] }), post("Reel", { mediaUrl: "https://cdn.example/a.mp4" })]) {
    assert.equal((await publisher.publish(item)).success, true);
  }
  const count = calls.length;
  for (const type of ["Video", "Story Image", "Story Video", "Unknown"]) assert.equal((await publisher.publish(post(type))).success, false);
  assert.equal(calls.length, count);
});
