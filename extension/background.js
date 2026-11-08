// Long-polls the local bridge for genius.com URLs, loads them with this browser and posts the text back.
const BRIDGE = "http://127.0.0.1:47123";

// Same allowlist as bridge/bridge.mjs: only what Lyrics Plus needs.
function isAllowedGeniusUrl(raw) {
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

let polling = false;

async function poll() {
	if (polling) return;
	polling = true;
	try {
		while (true) {
			const res = await fetch(`${BRIDGE}/next`);
			if (!res.ok) throw new Error(`bridge answered ${res.status}`);
			const job = await res.json();
			if (job.id) handle(job);
		}
	} catch {
		// Bridge not running or refused us; the alarm tries again.
	} finally {
		polling = false;
	}
}

async function handle(job) {
	let result;
	try {
		if (!isAllowedGeniusUrl(job.url)) throw new Error("url not allowed");
		const res = await fetch(job.url, { credentials: "include" });
		if (res.status === 403) throw new Error("Genius refused the request (403). Open genius.com in Chrome once, then try again.");
		if (!res.ok) throw new Error(`Genius answered HTTP ${res.status}`);
		result = { text: await res.text() };
	} catch (e) {
		result = { error: String(e?.message || e) };
	}
	await fetch(`${BRIDGE}/result`, { method: "POST", body: JSON.stringify({ id: job.id, ...result }) }).catch(() => {});
}

// Chrome stops idle service workers; the alarm restarts polling.
chrome.alarms.create("poll", { periodInMinutes: 0.5 });
chrome.alarms.onAlarm.addListener(poll);
chrome.runtime.onStartup.addListener(poll);
chrome.runtime.onInstalled.addListener(poll);
poll();
