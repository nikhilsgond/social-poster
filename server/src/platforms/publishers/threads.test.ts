import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { test, type TestContext } from "node:test";
import { ThreadsPublisher } from "./threads";
import type { Post } from "../../types";

const containerId = "18131143948768709";
const platformPostId = "published-thread";
const permalink = "https://www.threads.net/@test/post/example";
const temporaryError = {
  error: {
    message: "The requested resource does not exist",
    code: 24,
    error_subcode: 4279009,
  },
};
const post: Post = {
  id: "scheduled-thread",
  platform: "th",
  contentType: "Text",
  caption: "Threads caption",
  date: "2020-01-01",
  time: "09:30",
  scheduledAt: "2020-01-01T09:30:00Z",
  status: "publishing",
};

type Call = { url: URL; options: RequestInit };
type Reply = { body: unknown; status?: number };

function setup(t: TestContext, replies: Reply[]) {
  const calls: Call[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];
  let publishCalls = 0;

  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, options: RequestInit = {}) => {
    const url = new URL(String(input));
    calls.push({ url, options });
    if (url.pathname.endsWith("/threads")) return Response.json({ id: containerId });
    assert.ok(url.pathname.endsWith("/threads_publish"), `Unexpected API request: ${url.pathname}`);
    const reply = replies[publishCalls++];
    assert.ok(reply, "Unexpected extra publish attempt");
    if (reply.body instanceof Error) throw reply.body;
    if (typeof reply.body === "string") return new Response(reply.body, { status: reply.status ?? 200 });
    return Response.json(reply.body, { status: reply.status ?? 200 });
  });
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const timeout = t.mock.method(globalThis, "setTimeout");
  t.mock.method(console, "log", () => {});
  t.mock.method(console, "warn", (message: string) => { warnings.push(message); });
  t.mock.method(console, "error", (message: string) => { errors.push(message); });

  const publisher = new ThreadsPublisher("threads-user", "test-threads-token");
  return { calls, timeout, warnings, errors, publisher };
}

const success: Reply = { body: { id: platformPostId, permalink } };
const notReady: Reply = { body: temporaryError, status: 400 };
const successfulResult = { success: true, platformPostId, socialUrl: permalink, error: null };

function assertSameContainer(calls: Call[], expectedPublishCalls: number) {
  const creations = calls.filter((call) => call.url.pathname.endsWith("/threads"));
  const publishes = calls.filter((call) => call.url.pathname.endsWith("/threads_publish"));
  assert.equal(creations.length, 1, "Retries must not create another container");
  assert.equal(publishes.length, expectedPublishCalls);
  assert.deepEqual(publishes.map((call) => call.url.searchParams.get("creation_id")), Array(expectedPublishCalls).fill(containerId));
  assert.ok(calls.every((call) => call.options.method === "POST"));
  assert.ok(calls.every((call) => call.url.searchParams.get("access_token") === "test-threads-token"));
}

test("Threads retries code 24/subcode 4279009 after 5 seconds using the same container", async (t) => {
  const { publisher, calls, timeout, warnings, errors } = setup(t, [notReady, success]);
  let settled = false;
  const publishing = publisher.publish(post).then((result) => {
    settled = true;
    return result;
  });
  await setImmediate();

  assert.equal(timeout.mock.callCount(), 1, "A container-readiness failure must schedule a retry");
  assert.equal(timeout.mock.calls[0].arguments[1], 5000);
  assert.equal(settled, false, "Do not return failure to the scheduler while a retry is pending");
  assertSameContainer(calls, 1);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, [
    `[WARN] Threads container not ready; retrying publish ${JSON.stringify({ postId: post.id, containerId, attempt: 1, retryInMs: 5000 })}`,
  ]);

  t.mock.timers.tick(4999);
  await setImmediate();
  assertSameContainer(calls, 1);
  assert.equal(settled, false);
  t.mock.timers.tick(1);
  assert.deepEqual(await publishing, successfulResult);
  assertSameContainer(calls, 2);
  assert.deepEqual(errors, []);
});

test("Threads publishes immediately without waiting or retrying", async (t) => {
  const { publisher, calls, timeout, warnings, errors } = setup(t, [success]);
  assert.deepEqual(await publisher.publish(post), successfulResult);
  assertSameContainer(calls, 1);
  assert.equal(timeout.mock.callCount(), 0);
  assert.deepEqual(warnings, []);
  assert.deepEqual(errors, []);
  assert.equal(calls[0].url.searchParams.get("media_type"), "TEXT");
  assert.equal(calls[0].url.searchParams.get("text"), post.caption);
});

for (const temporaryFailures of [2, 3]) {
  test(`Threads succeeds after ${temporaryFailures} temporary failures with exact backoff delays`, async (t) => {
    const { publisher, calls, timeout, warnings, errors } = setup(t, [
      ...Array(temporaryFailures).fill(notReady), success,
    ]);
    let settled = false;
    const publishing = publisher.publish(post).then((result) => {
      settled = true;
      return result;
    });

    for (const [index, delay] of [5000, 10000, 20000].slice(0, temporaryFailures).entries()) {
      await setImmediate();
      assert.equal(settled, false);
      assertSameContainer(calls, index + 1);
      assert.deepEqual(errors, [], "Intermediate failures must not enter the final failure flow");
      assert.equal(timeout.mock.calls[index].arguments[1], delay);
      assert.equal(warnings[index], `[WARN] Threads container not ready; retrying publish ${JSON.stringify({ postId: post.id, containerId, attempt: index + 1, retryInMs: delay })}`);
      t.mock.timers.tick(delay - 1);
      await setImmediate();
      assertSameContainer(calls, index + 1);
      assert.equal(settled, false);
      t.mock.timers.tick(1);
    }

    assert.deepEqual(await publishing, successfulResult);
    assertSameContainer(calls, temporaryFailures + 1);
    assert.equal(timeout.mock.callCount(), temporaryFailures);
    assert.equal(warnings.length, temporaryFailures);
    assert.deepEqual(errors, []);
    assert.ok(warnings.every((warning) => !warning.includes("test-threads-token")));
  });
}

test("Threads returns failure only after all four same-container attempts are exhausted", async (t) => {
  const lastError = { error: { ...temporaryError.error, message: `Object ${containerId} not found on final attempt` } };
  const { publisher, calls, timeout, warnings, errors } = setup(t, [
    notReady, notReady, notReady, { body: lastError, status: 400 },
  ]);
  let settled = false;
  const publishing = publisher.publish(post).then((result) => {
    settled = true;
    return result;
  });

  for (const [index, delay] of [5000, 10000, 20000].entries()) {
    await setImmediate();
    assert.equal(settled, false, "The scheduler must not receive failure before retries are exhausted");
    assertSameContainer(calls, index + 1);
    assert.deepEqual(errors, []);
    assert.equal(timeout.mock.calls[index].arguments[1], delay);
    t.mock.timers.tick(delay - 1);
    await setImmediate();
    assertSameContainer(calls, index + 1);
    assert.equal(settled, false);
    t.mock.timers.tick(1);
  }

  assert.deepEqual(await publishing, {
    success: false,
    platformPostId: null,
    socialUrl: null,
    error: `Threads API error 400: ${JSON.stringify(lastError)}`,
  });
  assertSameContainer(calls, 4);
  assert.equal(timeout.mock.callCount(), 3);
  assert.equal(warnings.length, 3);
  assert.equal(errors.length, 1);
  assert.ok(errors[0].startsWith("[ERROR] Threads publish failed"));
  t.mock.timers.tick(60000);
  await setImmediate();
  assertSameContainer(calls, 4);
});

const nonRecoverableReplies: { name: string; reply: Reply }[] = [
  { name: "unrelated HTTP 400 error", reply: { status: 400, body: { error: { message: "Invalid parameter", code: 100 } } } },
  { name: "code 24 with a different subcode", reply: { status: 400, body: { error: { ...temporaryError.error, error_subcode: 123 } } } },
  { name: "readiness subcode with a different code", reply: { status: 400, body: { error: { ...temporaryError.error, code: 100 } } } },
  { name: "resource-not-found message without the code/subcode pair", reply: { status: 400, body: { error: { message: temporaryError.error.message } } } },
  { name: "code 24 without a subcode", reply: { status: 400, body: { error: { message: temporaryError.error.message, code: 24 } } } },
  { name: "matching codes with HTTP 500", reply: { status: 500, body: temporaryError } },
  { name: "string codes rather than numeric API codes", reply: { status: 400, body: { error: { code: "24", error_subcode: "4279009" } } } },
  { name: "malformed HTTP 400 body", reply: { status: 400, body: "The requested resource does not exist" } },
  { name: "null HTTP 400 body", reply: { status: 400, body: null } },
  { name: "unclassified network failure", reply: { body: new Error("The requested resource does not exist (24/4279009)") } },
];

for (const { name, reply } of nonRecoverableReplies) {
  test(`Threads does not retry ${name}`, async (t) => {
    const { publisher, calls, timeout, warnings, errors } = setup(t, [reply]);
    const result = await publisher.publish(post);
    assert.equal(result.success, false);
    assert.ok(result.error);
    assertSameContainer(calls, 1);
    assert.equal(timeout.mock.callCount(), 0);
    assert.deepEqual(warnings, []);
    assert.equal(errors.length, 1);
  });
}

test("Threads stops retrying if a readiness failure is followed by an unrelated 400", async (t) => {
  const { publisher, calls, timeout, warnings, errors } = setup(t, [
    notReady, { status: 400, body: { error: { message: "Invalid parameter", code: 100 } } },
  ]);
  const publishing = publisher.publish(post);
  await setImmediate();
  assertSameContainer(calls, 1);
  assert.deepEqual(errors, []);
  t.mock.timers.tick(5000);
  const result = await publishing;
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("Invalid parameter"));
  assertSameContainer(calls, 2);
  assert.equal(timeout.mock.callCount(), 1);
  assert.equal(warnings.length, 1);
  assert.equal(errors.length, 1);
});

test("Threads preserves successful publishing when the response has no permalink", async (t) => {
  const { publisher, calls, timeout } = setup(t, [{ body: { id: platformPostId } }]);
  assert.deepEqual(await publisher.publish(post), { ...successfulResult, socialUrl: null });
  assertSameContainer(calls, 1);
  assert.equal(timeout.mock.callCount(), 0);
});

for (const [contentType, mediaType, mediaParam, mediaUrl] of [
  ["Image", "IMAGE", "image_url", "https://cdn.example/thread.jpg"],
  ["Video", "VIDEO", "video_url", "https://cdn.example/thread.mp4"],
]) {
  test(`Threads preserves ${contentType} container creation when publishing requires a retry`, async (t) => {
    const { publisher, calls, timeout } = setup(t, [notReady, success]);
    const publishing = publisher.publish({ ...post, contentType, mediaUrl });
    await setImmediate();
    assertSameContainer(calls, 1);
    assert.equal(calls[0].url.searchParams.get("media_type"), mediaType);
    assert.equal(calls[0].url.searchParams.get(mediaParam), mediaUrl);
    assert.equal(calls[0].url.searchParams.get("text"), post.caption);
    t.mock.timers.tick(5000);
    assert.deepEqual(await publishing, successfulResult);
    assertSameContainer(calls, 2);
    assert.equal(timeout.mock.callCount(), 1);
  });
}

test("Threads does not create or publish a container for a future scheduled post", async (t) => {
  const { publisher, calls, timeout, warnings } = setup(t, []);
  const result = await publisher.publish({ ...post, scheduledAt: "2099-01-01T09:30:00Z", status: "scheduled" });
  assert.deepEqual(result, { success: false, error: "Post is scheduled and not yet due", isScheduled: true });
  assert.deepEqual(calls, []);
  assert.equal(timeout.mock.callCount(), 0);
  assert.deepEqual(warnings, []);
});

test("Threads preserves capability validation before API requests", async (t) => {
  const { publisher, calls, timeout } = setup(t, []);
  const result = await publisher.publish({ ...post, contentType: "Unsupported" });
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("contentType"));
  assert.deepEqual(calls, []);
  assert.equal(timeout.mock.callCount(), 0);
});

test("Threads does not retry container creation failures, even with readiness codes", async (t) => {
  const { publisher, calls, timeout, warnings } = setup(t, []);
  t.mock.method(globalThis, "fetch", async (input: string | URL | Request, options: RequestInit = {}) => {
    calls.push({ url: new URL(String(input)), options });
    return Response.json(temporaryError, { status: 400 });
  });
  const result = await publisher.publish(post);
  assert.equal(result.success, false);
  assert.ok(result.error?.includes("Threads API error 400"));
  assert.equal(calls.length, 1);
  assert.ok(calls[0].url.pathname.endsWith("/threads"));
  assert.equal(timeout.mock.callCount(), 0);
  assert.deepEqual(warnings, []);
});
