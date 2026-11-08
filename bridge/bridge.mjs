// Bridge between Lyrics Plus (inside Spotify) and the Chrome extension.
//
// Spotify:    GET  /genius?url=<genius.com url>&mode=text|html  -> waits for Chrome's answer
// Extension:  GET  /next    long-poll; returns a job { id, url, mode } or {} when nothing came in
//             POST /result  { id, text } or { id, error }
//
// Genius blocks requests that don't come from a real browser, so the user's own Chrome
// loads the pages. Only Spotify and the extension may use the bridge, and only for the
// genius.com URLs that Lyrics Plus needs.
import http from "node:http";
import { pathToFileURL } from "node:url";

export const PORT = 47123;
export const SPOTIFY_ORIGIN = "https://xpui.app.spotify.com";
const MAX_BODY_BYTES = 10 * 1024 * 1024;

export function isAllowedGeniusUrl(raw) {
	let url;
	try {
		url = new URL(raw);
	} catch {
		return false;
	}
	if (url.protocol !== "https:" || url.hostname !== "genius.com" || url.port || url.username || url.password) return false;
	if (url.pathname === "/api/search/song") return true;
	if (/^\/api\/(annotations|referents)\/\d+$/.test(url.pathname)) return !url.search;
	return /^\/[\w%.-]+-lyrics$/.test(url.pathname) && !url.search;
}

const isSpotify = (origin) => origin === SPOTIFY_ORIGIN;
const isExtension = (origin) => typeof origin === "string" && origin.startsWith("chrome-extension://");

// Browsers always send Origin on cross-origin requests that can read the response,
// so a request without Origin is a local tool (curl), which could reach genius.com anyway.
const originAllowed = (origin, check) => origin === undefined || check(origin);

export function createBridge({ jobTimeoutMs = 20000, pollTimeoutMs = 25000, log = () => {} } = {}) {
	const queue = []; // jobs waiting for the extension
	const pollers = []; // extension long-poll responses waiting for a job
	const pending = new Map(); // job id -> { res, timer, origin }
	let nextId = 1;

	function send(res, status, body, origin) {
		const headers = { "Content-Type": "application/json", Vary: "Origin" };
		if (origin) headers["Access-Control-Allow-Origin"] = origin;
		res.writeHead(status, headers);
		res.end(body === undefined ? "" : JSON.stringify(body));
	}

	function dispatch() {
		while (queue.length && pollers.length) {
			const { res, origin } = pollers.shift();
			send(res, 200, queue.shift(), origin);
		}
	}

	function readBody(req) {
		return new Promise((resolve, reject) => {
			let size = 0;
			const chunks = [];
			req.on("data", (c) => {
				size += c.length;
				if (size > MAX_BODY_BYTES) {
					reject(new Error("body too large"));
					req.destroy();
				} else chunks.push(c);
			});
			req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
			req.on("error", reject);
		});
	}

	const server = http.createServer(async (req, res) => {
		const port = server.address().port;
		if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(req.headers.host)) return send(res, 403, { error: "bad host" });

		const url = new URL(req.url, `http://127.0.0.1:${port}`);
		const origin = req.headers.origin;
		const forSpotify = url.pathname === "/genius";
		const forExtension = url.pathname === "/next" || url.pathname === "/result";
		const check = forSpotify ? isSpotify : forExtension ? isExtension : null;

		if (url.pathname === "/health") {
			return send(res, 200, { ok: true, chromeConnected: pollers.length > 0 });
		}
		if (!check) return send(res, 404, { error: "not found" });
		if (!originAllowed(origin, check)) return send(res, 403, { error: "origin not allowed" });

		if (req.method === "OPTIONS") {
			res.writeHead(204, {
				"Access-Control-Allow-Origin": origin,
				"Access-Control-Allow-Methods": "GET, POST",
				"Access-Control-Allow-Headers": "Content-Type",
				"Access-Control-Allow-Private-Network": "true",
				Vary: "Origin",
			});
			return res.end();
		}

		if (url.pathname === "/genius" && req.method === "GET") {
			const job = { id: nextId++, url: url.searchParams.get("url"), mode: url.searchParams.get("mode") === "html" ? "html" : "text" };
			if (!isAllowedGeniusUrl(job.url)) return send(res, 400, { error: "url not allowed" }, origin);

			const timer = setTimeout(() => {
				pending.delete(job.id);
				const i = queue.indexOf(job);
				if (i !== -1) queue.splice(i, 1);
				log(`job ${job.id} timed out`);
				send(res, 504, { error: "No answer from Chrome. Is Chrome open with the Genius Bridge extension?" }, origin);
			}, jobTimeoutMs);
			pending.set(job.id, { res, timer, origin });
			res.on("close", () => {
				if (res.writableFinished) return;
				clearTimeout(timer);
				pending.delete(job.id);
				const i = queue.indexOf(job);
				if (i !== -1) queue.splice(i, 1);
			});
			log(`job ${job.id}: ${job.mode} ${job.url}`);
			queue.push(job);
			dispatch();
			return;
		}

		if (url.pathname === "/next" && req.method === "GET") {
			const poller = { res, origin };
			pollers.push(poller);
			const timer = setTimeout(() => {
				const i = pollers.indexOf(poller);
				if (i !== -1) {
					pollers.splice(i, 1);
					send(res, 200, {}, origin);
				}
			}, pollTimeoutMs);
			res.on("close", () => {
				clearTimeout(timer);
				const i = pollers.indexOf(poller);
				if (i !== -1) pollers.splice(i, 1);
			});
			dispatch();
			return;
		}

		if (url.pathname === "/result" && req.method === "POST") {
			let result;
			try {
				result = JSON.parse(await readBody(req));
			} catch {
				return send(res, 400, { error: "bad body" }, origin);
			}
			const p = pending.get(result.id);
			if (p) {
				clearTimeout(p.timer);
				pending.delete(result.id);
				log(`result ${result.id}: ${result.error ? `error: ${result.error}` : `${result.text?.length ?? 0} chars`}`);
				send(p.res, result.error ? 502 : 200, result.error ? { error: result.error } : { text: result.text }, p.origin);
			}
			return send(res, 200, { ok: true }, origin);
		}

		send(res, 405, { error: "method not allowed" }, origin);
	});
	return server;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
	const server = createBridge({ log: (msg) => console.log(new Date().toISOString(), msg) });
	server.listen(PORT, "127.0.0.1", () => console.log(new Date().toISOString(), `bridge listening on http://127.0.0.1:${PORT}`));
}
