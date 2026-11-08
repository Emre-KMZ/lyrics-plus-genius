import assert from "node:assert/strict";
import http from "node:http";
import { after, before, describe, test } from "node:test";
import { createBridge, isAllowedGeniusUrl, SPOTIFY_ORIGIN } from "./bridge.mjs";

const EXT_ORIGIN = "chrome-extension://abcdefghijklmnop";
const LYRICS_URL = "https://genius.com/Se7en-of-34-sulga-and-sanc-crash-out-lyrics";

function request(port, { method = "GET", path, headers = {}, body }) {
	return new Promise((resolve, reject) => {
		const req = http.request({ host: "127.0.0.1", port, method, path, headers }, (res) => {
			let data = "";
			res.on("data", (c) => (data += c));
			res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: data ? JSON.parse(data) : null }));
		});
		req.on("error", reject);
		if (body) req.write(body);
		req.end();
	});
}

const geniusPath = (url, mode = "html") => `/genius?${new URLSearchParams({ url, mode })}`;

describe("isAllowedGeniusUrl", () => {
	test("allows search, annotations, referents and lyrics pages", () => {
		assert.ok(isAllowedGeniusUrl("https://genius.com/api/search/song?per_page=20&q=a%20b"));
		assert.ok(isAllowedGeniusUrl("https://genius.com/api/annotations/39619051"));
		assert.ok(isAllowedGeniusUrl("https://genius.com/api/referents/39619051"));
		assert.ok(isAllowedGeniusUrl(LYRICS_URL));
	});

	test("refuses everything else", () => {
		for (const url of [
			"https://genius.com/api/account",
			"https://genius.com/",
			"https://genius.com/Some-song-lyrics?foo=1",
			"https://genius.com/a/b-lyrics",
			"http://genius.com/Some-song-lyrics",
			"https://evil.com/Some-song-lyrics",
			"https://genius.com.evil.com/Some-song-lyrics",
			"https://user@genius.com/Some-song-lyrics",
			"https://genius.com:8443/Some-song-lyrics",
			"not a url",
		]) {
			assert.equal(isAllowedGeniusUrl(url), false, url);
		}
	});
});

describe("bridge server", () => {
	let server;
	let port;

	before(async () => {
		server = createBridge({ jobTimeoutMs: 300, pollTimeoutMs: 300 });
		await new Promise((r) => server.listen(0, "127.0.0.1", r));
		port = server.address().port;
	});
	after(() => server.close());

	test("hands a Spotify job to the extension and returns its answer", async () => {
		const spotify = request(port, { path: geniusPath(LYRICS_URL), headers: { Origin: SPOTIFY_ORIGIN } });
		const job = await request(port, { path: "/next", headers: { Origin: EXT_ORIGIN } });
		assert.equal(job.status, 200);
		assert.equal(job.body.url, LYRICS_URL);
		assert.equal(job.body.mode, "html");

		const posted = await request(port, {
			method: "POST",
			path: "/result",
			headers: { Origin: EXT_ORIGIN },
			body: JSON.stringify({ id: job.body.id, text: "<html>lyrics</html>" }),
		});
		assert.equal(posted.status, 200);

		const answer = await spotify;
		assert.equal(answer.status, 200);
		assert.equal(answer.body.text, "<html>lyrics</html>");
		assert.equal(answer.headers["access-control-allow-origin"], SPOTIFY_ORIGIN);
	});

	test("refuses /genius from other web pages", async () => {
		const res = await request(port, { path: geniusPath(LYRICS_URL), headers: { Origin: "https://evil.example" } });
		assert.equal(res.status, 403);
		const poll = await request(port, { path: "/next", headers: { Origin: EXT_ORIGIN } });
		assert.deepEqual(poll.body, {}, "no job should have been queued");
	});

	test("refuses /next and /result from non-extension origins", async () => {
		assert.equal((await request(port, { path: "/next", headers: { Origin: SPOTIFY_ORIGIN } })).status, 403);
		const res = await request(port, { method: "POST", path: "/result", headers: { Origin: "https://evil.example" }, body: "{}" });
		assert.equal(res.status, 403);
	});

	test("refuses genius URLs outside the allowlist", async () => {
		const res = await request(port, { path: geniusPath("https://genius.com/api/account"), headers: { Origin: SPOTIFY_ORIGIN } });
		assert.equal(res.status, 400);
	});

	test("refuses requests with a foreign Host header (DNS rebinding)", async () => {
		const res = await request(port, { path: "/health", headers: { Host: `evil.example:${port}` } });
		assert.equal(res.status, 403);
	});

	test("times out when no extension picks the job up", async () => {
		const res = await request(port, { path: geniusPath(LYRICS_URL), headers: { Origin: SPOTIFY_ORIGIN } });
		assert.equal(res.status, 504);
		assert.match(res.body.error, /Chrome/);
	});

	test("answers Spotify's CORS / private network preflight", async () => {
		const res = await request(port, {
			method: "OPTIONS",
			path: geniusPath(LYRICS_URL),
			headers: { Origin: SPOTIFY_ORIGIN, "Access-Control-Request-Private-Network": "true" },
		});
		assert.equal(res.status, 204);
		assert.equal(res.headers["access-control-allow-origin"], SPOTIFY_ORIGIN);
		assert.equal(res.headers["access-control-allow-private-network"], "true");
	});
});
