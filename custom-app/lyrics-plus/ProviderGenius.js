const ProviderGenius = (() => {
	function getChildDeep(parent, isDeep = false) {
		let acc = "";

		if (!parent.children) {
			return acc;
		}

		for (const child of parent.children) {
			if (typeof child === "string") {
				acc += child;
			} else if (child.children) {
				acc += getChildDeep(child, true);
			}
			if (!isDeep) {
				acc += "\n";
			}
		}
		return acc.trim();
	}

	async function getNote(id) {
		const body = await getJSON(`https://genius.com/api/annotations/${id}`);
		const response = body.response;
		let note = "";

		// Authors annotations
		if (response.referent && response.referent.classification === "verified") {
			const referentsBody = await getJSON(`https://genius.com/api/referents/${id}`);
			const referents = referentsBody.response;
			for (const ref of referents.referent.annotations) {
				note += getChildDeep(ref.body.dom);
			}
		}

		// Users annotations
		if (!note && response.annotation) {
			note = getChildDeep(response.annotation.body.dom);
		}

		// Users comments
		if (!note && response.annotation && response.annotation.top_comment) {
			note += getChildDeep(response.annotation.top_comment.body.dom);
		}
		note = note.replace(/\n\n\n?/, "\n");

		return note;
	}

	// Genius blocks requests from Spotify, so genius.com pages are loaded by the user's Chrome
	// through a local bridge (see bridge/ and extension/ in this repo).
	const BRIDGE = "http://127.0.0.1:47123";

	async function viaBridge(url, mode) {
		const res = await fetch(`${BRIDGE}/genius?${new URLSearchParams({ url, mode })}`);
		const data = await res.json();
		if (data.error) throw new Error(data.error);
		return data.text;
	}

	async function getJSON(url) {
		return JSON.parse(await viaBridge(url, "text"));
	}

	async function fetchHTML(url) {
		return JSON.stringify({ body: await viaBridge(url, "html") });
	}

	async function fetchLyricsVersion(results, index) {
		const result = results[index];
		if (!result) {
			console.warn(result);
			return;
		}

		const site = await fetchHTML(result.url);
		const body = JSON.parse(site)?.body;
		if (!body) {
			return null;
		}

		let lyrics = "";
		const parser = new DOMParser();
		const htmlDoc = parser.parseFromString(body, "text/html");
		const lyricsDiv = htmlDoc.querySelectorAll('div[data-lyrics-container="true"]');

		// Genius puts a header (contributors, info icon) inside the first container and marks it as not part of the lyrics.
		for (const el of htmlDoc.querySelectorAll('div[data-lyrics-container="true"] [data-exclude-from-selection="true"]')) {
			el.remove();
		}

		for (const i of lyricsDiv) {
			lyrics += `${i.innerHTML}<br>`;
		}

		if (!lyrics?.length) {
			console.warn("forceError");
			return null;
		}

		return lyrics;
	}

	async function fetchLyrics(info) {
		const titles = new Set([info.title]);

		const titleNoExtra = Utils.removeExtraInfo(info.title);
		titles.add(titleNoExtra);
		titles.add(Utils.removeSongFeat(info.title));
		titles.add(Utils.removeSongFeat(titleNoExtra));

		let lyrics;
		let hits;
		for (const title of titles) {
			const query = new URLSearchParams({ per_page: 20, q: `${info.artist} ${title}` });
			const url = `https://genius.com/api/search/song?${query.toString()}`;

			const geniusSearch = await getJSON(url);

			hits = geniusSearch.response.sections[0].hits.map((item) => ({
				title: item.result.full_title,
				url: item.result.url,
			}));

			if (!hits.length) {
				continue;
			}

			lyrics = await fetchLyricsVersion(hits, 0);
			break;
		}

		if (!lyrics) {
			return { lyrics: null, versions: [] };
		}

		return { lyrics, versions: hits };
	}

	return { fetchLyrics, getNote, fetchLyricsVersion };
})();
