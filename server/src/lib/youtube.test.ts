import assert from "node:assert/strict";
import test from "node:test";
import {
  buildYouTubeMultipartBody,
  buildYouTubeVideoMetadata,
  formatYouTubeApiFailure,
  resolveYouTubeMediaType,
} from "./youtube";

test("builds a valid multipart media part with the downloaded MIME type", () => {
  const boundary = "youtube_test_boundary";
  const metadata = buildYouTubeVideoMetadata(
    "Test title",
    "Test description",
    "2026-10-02T15:15:00+05:30"
  );
  const body = buildYouTubeMultipartBody(
    metadata,
    Buffer.from([0, 1, 2, 3]),
    resolveYouTubeMediaType("video/mp4; charset=binary"),
    boundary
  );
  const text = body.toString("latin1");

  assert.match(text, /^--youtube_test_boundary\r\nContent-Type: application\/json; charset=UTF-8\r\n\r\n/);
  assert.match(text, /\r\n--youtube_test_boundary\r\nContent-Type: video\/mp4\r\n\r\n/);
  assert.match(text, /\r\n--youtube_test_boundary--\r\n$/);
  assert.equal(text.includes("selfMadeMadeForKids"), false);
  assert.equal(text.includes("selfDeclaredMadeForKids"), false);
});

test("falls back to an accepted generic MIME type", () => {
  assert.equal(resolveYouTubeMediaType(null), "application/octet-stream");
  assert.equal(resolveYouTubeMediaType("text/plain"), "application/octet-stream");
});

test("formats only sanitized Google API diagnostics", () => {
  const body = JSON.stringify({
    error: {
      code: 400,
      message: "Invalid value at 'video.status'",
      errors: [{ reason: "invalidValue" }],
    },
  });

  assert.equal(
    formatYouTubeApiFailure("YouTube upload failed", 400, body),
    "YouTube upload failed (400): Invalid value at 'video.status' [invalidValue]"
  );
  assert.equal(
    formatYouTubeApiFailure("YouTube upload failed", 500, "<html>internal details</html>"),
    "YouTube upload failed (500): Google API request failed"
  );
});
