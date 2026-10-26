(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const els = {
    apiForm:$("apiForm"), apiUrl:$("apiUrl"), loadBtn:$("loadBtn"), refreshBtn:$("refreshBtn"),
    jsonInput:$("jsonInput"), loadJsonBtn:$("loadJsonBtn"),
    notice:$("notice"), loading:$("loading"), toolbar:$("toolbar"), search:$("searchInput"),
    sort:$("sortSelect"), grid:$("videoGrid"), empty:$("emptyState"), noResults:$("noResults"),
    resultCount:$("resultCount"), historySection:$("history"), historyGrid:$("historyGrid"),
    historyCount:$("historyCount"), clearHistory:$("clearHistoryBtn"), clearLibrary:$("clearLibraryBtn"), postImage:$("postImage"), modal:$("playerModal"),
    playerShell:$("playerShell"), playerDialog:$("playerModal").querySelector(".player-dialog"), video:$("video"), playerTitle:$("playerTitle"),
    playerDescription:$("playerDescription"), playerDate:$("playerDate"), playerLoading:$("playerLoading"),
    playerError:$("playerError"), playBtn:$("playBtn"), backBtn:$("backBtn"), forwardBtn:$("forwardBtn"), previousVideoBtn:$("previousVideoBtn"), nextVideoBtn:$("nextVideoBtn"),
    timeline:$("timelineTrack"), timelineFill:$("timelineFill"), timelineKnob:$("timelineKnob"),
    timeDisplay:$("timeDisplay"), fullscreenBtn:$("fullscreenBtn"), speed:$("speedSelect"), quality:$ ("qualitySelect"),
    speedIndicator:$("speedIndicator"), closePlayer:$("closePlayer")
  };
  const HISTORY_KEY = "nightwave.watchHistory.v1";
  const LAST_API_KEY = "nightwave.lastApiUrl.v1";
  const LIBRARY_KEY = "nightwave.library.v1";
  const MAX_HISTORY = 30;
  let posts = [], lastApiUrl = "", currentPost = null, hls = null, loadToken = 0;
  let seekDrag = false, holdTimer = null, holdingFast = false, spaceDown = false, spaceHoldTimer = null;

  function safeStorageGet(key, fallback) {
    try { const value = localStorage.getItem(key); return value == null ? fallback : value; } catch { return fallback; }
  }
  function safeStorageSet(key, value) {
    try { localStorage.setItem(key, value); return true; } catch { showNotice("Your browser storage is full or disabled. Watch progress may not be saved.", "error"); return false; }
  }
  function getHistory() {
    try { const parsed = JSON.parse(safeStorageGet(HISTORY_KEY, "[]")); return Array.isArray(parsed) ? parsed.filter(x => x && typeof x.key === "string") : []; } catch { return []; }
  }
  function saveHistory(history) { safeStorageSet(HISTORY_KEY, JSON.stringify(history.slice(0, MAX_HISTORY))); renderHistory(); }
  function persistLibrary() {
    const clean = posts.map(({raw, ...post}) => post);
    safeStorageSet(LIBRARY_KEY, JSON.stringify(clean));
  }
  function normalizePostId(value) {
    return value == null ? "" : String(value).trim();
  }
  function normalizePostTitle(value) {
    return String(value ?? "")
      .normalize("NFKC")
      .trim()
      .replace(/\s+/g, " ")
      .toLocaleLowerCase();
  }
  function normalizePublished(value) {
    const published = String(value ?? "").trim();
    if (!published) return "";
    const timestamp = Date.parse(published);
    return Number.isNaN(timestamp) ? published : new Date(timestamp).toISOString();
  }
  function postIdentity(post) {
    // Treat a post as the same item only when ID, normalized title, and
    // published timestamp all match. This avoids merging separate posts that
    // happen to reuse an ID or title in different feeds.
    return JSON.stringify([
      normalizePostId(post.id),
      normalizePostTitle(post.title),
      normalizePublished(post.published)
    ]);
  }
  function mergePosts(incoming) {
    const merged = [];
    const identityToIndex = new Map();

    function addOrMerge(post) {
      const identity = postIdentity(post);
      const matchIndex = identityToIndex.get(identity);
      if (matchIndex !== undefined) {
        const previous = merged[matchIndex];
        merged[matchIndex] = {
          ...previous,
          ...post,
          id: post.id || previous.id || "",
          title: post.title || previous.title,
          description: post.description || previous.description,
          thumbnail: post.thumbnail || previous.thumbnail,
          videoUrl: post.videoUrl || previous.videoUrl,
          published: post.published || previous.published,
          raw: post.raw || previous.raw
        };
        return;
      }

      identityToIndex.set(identity, merged.length);
      merged.push(post);
    }

    for (const post of posts) addOrMerge(post);
    for (const post of incoming) addOrMerge(post);
    posts = merged;
    // Refresh expiring signed stream URLs in saved watch history without losing progress.
    const refreshedByIdentity = new Map(posts.map(post => [postIdentity(post), post]));
    const history = getHistory().map(item => {
      const refreshed = refreshedByIdentity.get(item.key);
      return refreshed && refreshed.videoUrl ? {...item, videoUrl:refreshed.videoUrl, thumbnail:refreshed.thumbnail || item.thumbnail, title:refreshed.title, published:refreshed.published} : item;
    });
    safeStorageSet(HISTORY_KEY, JSON.stringify(history));
    if (currentPost) {
      const refreshedCurrent = refreshedByIdentity.get(postIdentity(currentPost));
      if (refreshedCurrent) currentPost = refreshedCurrent;
    }
    persistLibrary();
    renderHistory();
    updatePlayerNavigation();
  }
  function postKey(post) { return postIdentity(post); }
  function getHistoryItem(post) { return getHistory().find(x => x.key === postKey(post)); }
  function updateHistory(post, patch) {
    if (!post) return;
    const key = postKey(post), old = getHistory().find(x => x.key === key) || {};
    const item = {...old, key, id:post.id, title:post.title, thumbnail:post.thumbnail, videoUrl:post.videoUrl, description:post.description, published:post.published, ...patch, updated:Date.now()};
    const next = [item, ...getHistory().filter(x => x.key !== key)].slice(0, MAX_HISTORY);
    saveHistory(next);
  }
  function removeHistory(key) { saveHistory(getHistory().filter(x => x.key !== key)); renderPosts(); }
  function showNotice(message, type="") {
    els.notice.textContent = "";
    const span = document.createElement("span"); span.textContent = message;
    els.notice.appendChild(span); els.notice.className = `notice ${type}`; els.notice.hidden = false;
  }
  function hideNotice() { els.notice.hidden = true; }
  function setLoading(on) { els.loading.hidden = !on; els.loadBtn.disabled = on; els.loadBtn.textContent = on ? "Loading…" : "Load library →"; }
  function textFromHtml(html) {
    const doc = new DOMParser().parseFromString(String(html || ""), "text/html");
    return (doc.body.textContent || "").replace(/\s+/g, " ").trim();
  }
  function absolutizeUrl(url, base) {
    if (!url || typeof url !== "string") return "";
    try { const parsed = new URL(url, base || window.location.href); return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : ""; } catch { return ""; }
  }
  function findVideoUrl(post) {
    const candidates = [];
    const add = v => { if (typeof v === "string" && v.trim()) candidates.push(v.trim()); };
    if (Array.isArray(post.attachments)) post.attachments.forEach(a => {
      if (typeof a === "string") add(a);
      else if (a && typeof a === "object") {
        add(a.temp_url); add(a.url); add(a.src); add(a.href); add(a.download_url);
        if (a.file) { add(a.file.url); add(a.file.path); }
      }
    });
    add(post.video_url); add(post.videoUrl); add(post.stream_url); add(post.streamUrl); add(post.playback_url); add(post.url);
    return candidates.find(v => /\.(m3u8|mp4|webm|mov)(?:$|[?#])/i.test(v) || /m3u8|\/v\//i.test(v)) || candidates[0] || "";
  }
  function thumbnailUrl(post, base) {
    // Prefer explicit preview fields, then fall back to an image attachment.
    const nested = post.data && typeof post.data === "object" ? post.data : {};
    let path = (post.file && (post.file.path || post.file.url)) || (nested.file && (nested.file.path || nested.file.url)) || post.thumbnail || post.thumbnail_url || post.image || post.image_url || post.preview || nested.thumbnail || nested.thumbnail_url || nested.image || nested.image_url;
    if (!path && Array.isArray(post.attachments)) {
      const imageAttachment = post.attachments.find(a => {
        if (typeof a === "string") return /\.(png|jpe?g|gif|webp|avif)(?:$|[?#])/i.test(a);
        if (!a || typeof a !== "object") return false;
        const candidate = a.url || a.src || a.href || a.download_url || a.temp_url || (a.file && (a.file.url || a.file.path));
        const type = String(a.type || a.mime_type || a.content_type || (a.file && (a.file.type || a.file.mime_type)) || "");
        return /^image\//i.test(type) || /\.(png|jpe?g|gif|webp|avif)(?:$|[?#])/i.test(String(candidate || ""));
      });
      if (imageAttachment) path = typeof imageAttachment === "string" ? imageAttachment : (imageAttachment.url || imageAttachment.src || imageAttachment.href || imageAttachment.download_url || imageAttachment.temp_url || (imageAttachment.file && (imageAttachment.file.url || imageAttachment.file.path)));
    }
    if (!path) return "";
    if (typeof path === "object") return absolutizeUrl(path.url || path.path || path.src || "", base);
    if (/^https?:\/\//i.test(path)) return absolutizeUrl(path);
    // Pawchive's API example stores a relative thumbnail path; only use this host
    // for that known path pattern, while leaving other relative URLs API-relative.
    if (String(path).startsWith("/") && /[a-f0-9]{40,}\.(png|jpe?g|webp)$/i.test(path)) return `https://img.pawchive.pw/thumbnail/data${path}`;
    return absolutizeUrl(path, base);
  }
  function normalizePost(raw, index, base) {
    if (!raw || typeof raw !== "object") return null;
    const title = String(raw.title || raw.name || raw.subject || `Untitled post ${index + 1}`).trim();
    const videoRaw = findVideoUrl(raw);
    const videoUrl = absolutizeUrl(videoRaw, base);
    const content = raw.content || raw.description || raw.caption || "";
    const description = textFromHtml(content);
    const published = raw.published || raw.published_at || raw.created_at || raw.date || raw.timestamp || "";
    const tags = Array.isArray(raw.tags) ? raw.tags.join(" ") : (typeof raw.tags === "string" ? raw.tags.replace(/[{}"]/g, " ") : "");
    return {
      id: raw.id == null ? "" : String(raw.id), title,
      description, published: String(published || ""), thumbnail: thumbnailUrl(raw, base),
      videoUrl, tags, hasVideo: !!videoUrl, raw
    };
  }
  function extractArray(data) {
    if (Array.isArray(data)) return data;
    if (data && typeof data === "object") {
      for (const key of ["posts","data","items","results","videos","records"]) if (Array.isArray(data[key])) return data[key];
      // Some APIs wrap an array one or two levels deep.
      for (const value of Object.values(data)) if (Array.isArray(value) && value.every(v => v && typeof v === "object")) return value;
    }
    throw new Error("The API returned valid JSON, but no list of posts was found. Expected an array or an object containing posts/data/items/results/videos.");
  }
  function formatDate(value) {
    if (!value) return "Date unavailable";
    const d = new Date(value);
    if (Number.isNaN(d.getTime())) return String(value);
    return new Intl.DateTimeFormat(undefined, {year:"numeric", month:"short", day:"numeric"}).format(d);
  }
  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
    const h = Math.floor(seconds/3600), m = Math.floor((seconds%3600)/60), s = Math.floor(seconds%60);
    return h ? `${h}:${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}` : `${m}:${String(s).padStart(2,"0")}`;
  }
  function escapeText(value) { return String(value ?? ""); }
  function createThumb(post, historyItem) {
    const wrap = document.createElement("div"); wrap.className = "thumb-wrap";
    const fallback = document.createElement("div"); fallback.className = "thumb-fallback"; fallback.textContent = "▶";
    wrap.appendChild(fallback);
    if (post.thumbnail || (historyItem && historyItem.thumbnail)) {
      const img = document.createElement("img"); img.loading = "lazy"; img.alt = ""; img.src = (historyItem && historyItem.thumbnail) || post.thumbnail;
      img.addEventListener("error", () => { img.remove(); }, {once:true});
      wrap.appendChild(img);
    }
    const overlay = document.createElement("div"); overlay.className = "thumb-overlay"; wrap.appendChild(overlay);
    const play = document.createElement("div"); play.className = "play-overlay"; play.textContent = post.hasVideo || (historyItem && historyItem.videoUrl) ? "▶" : "▧"; wrap.appendChild(play);
    if (historyItem && historyItem.time > 0 && historyItem.duration > 0) {
      const badge = document.createElement("span"); badge.className = "duration-badge"; badge.textContent = `${formatTime(historyItem.time)} / ${formatTime(historyItem.duration)}`; wrap.appendChild(badge);
      const track = document.createElement("div"); track.className = "progress-track";
      const fill = document.createElement("span"); fill.style.width = `${Math.min(100, historyItem.time/historyItem.duration*100)}%`; track.appendChild(fill); wrap.appendChild(track);
    } else if (!post.hasVideo && !(historyItem && historyItem.videoUrl)) {
      const badge = document.createElement("span"); badge.className = "duration-badge"; badge.textContent = "POST"; wrap.appendChild(badge);
    }
    return wrap;
  }
  function createVideoCard(post) {
    const card = document.createElement("article"); card.className = "video-card"; card.tabIndex = 0; card.setAttribute("role","button");
    card.setAttribute("aria-label", `${post.hasVideo ? "Play" : "View"} ${post.title}`);
    card.appendChild(createThumb(post, getHistoryItem(post)));
    const title = document.createElement("h3"); title.className = "card-title"; title.textContent = post.title; card.appendChild(title);
    if (post.description) { const desc = document.createElement("p"); desc.className = "card-description"; desc.textContent = post.description; card.appendChild(desc); }
    const meta = document.createElement("div"); meta.className = "card-meta";
    const date = document.createElement("span"); date.className = "card-date"; date.textContent = formatDate(post.published); meta.appendChild(date);
    if (post.tags) { const dot = document.createElement("span"); dot.className = "video-dot"; meta.appendChild(dot); const tag = document.createElement("span"); tag.className = "card-date"; tag.textContent = post.tags.split(/\s+/).filter(Boolean).slice(0,2).join(" · "); tag.style.overflow="hidden"; tag.style.textOverflow="ellipsis"; tag.style.whiteSpace="nowrap"; meta.appendChild(tag); }
    card.appendChild(meta);
    const open = () => post.hasVideo ? openPlayer(post) : openPostViewer(post);
    card.addEventListener("click", open); card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
    return card;
  }
  function filteredPosts() {
    const query = els.search.value.trim().toLowerCase();
    const filtered = posts.filter(p => !query || [p.title,p.description,p.tags,p.id].some(v => String(v||"").toLowerCase().includes(query)));
    const sort = els.sort.value;
    filtered.sort((a,b) => {
      if (sort === "title-asc") return a.title.localeCompare(b.title);
      if (sort === "title-desc") return b.title.localeCompare(a.title);
      const da = new Date(a.published).getTime(), db = new Date(b.published).getTime();
      if (!Number.isFinite(da) && !Number.isFinite(db)) return 0;
      if (!Number.isFinite(da)) return 1; if (!Number.isFinite(db)) return -1;
      return sort === "oldest" ? da-db : db-da;
    });
    return filtered;
  }
  function renderPosts() {
    const filtered = filteredPosts(); els.grid.replaceChildren();
    filtered.forEach(p => els.grid.appendChild(createVideoCard(p)));
    els.resultCount.textContent = posts.length ? `(${filtered.length}${filtered.length !== posts.length ? ` of ${posts.length}` : ""})` : "";
    els.empty.hidden = posts.length > 0;
    els.noResults.hidden = posts.length === 0 || filtered.length > 0;
    els.toolbar.hidden = posts.length === 0;
    updatePlayerNavigation();
  }
  // Delegate history deletion from the grid in capture phase so it cannot bubble to a card opener.
  els.historyGrid.addEventListener("click", e => {
    const button = e.target && e.target.closest ? e.target.closest("button.remove-history") : null;
    if (!button) return;
    e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
    const key = button.dataset.historyKey;
    if (key) removeHistory(key);
  }, true);
  function renderHistory() {
    const history = getHistory(); els.historyGrid.replaceChildren();
    const historyPosts = history.map(item => ({...item, id:item.id || item.key, title:item.title || "Untitled video", description:item.description || "", published:item.published || "", thumbnail:item.thumbnail || "", videoUrl:item.videoUrl || "", hasVideo:!!item.videoUrl, tags:""})).filter(p=>p.videoUrl);
    els.historySection.hidden = historyPosts.length === 0;
    els.historyCount.textContent = historyPosts.length ? `(${historyPosts.length})` : "";
    historyPosts.forEach(post => {
      const item = getHistoryItem(post) || history.find(x=>x.key===postKey(post));
      const card = document.createElement("article"); card.className="history-card"; card.tabIndex=0; card.setAttribute("role","button");
      const remove = document.createElement("button"); remove.className="remove-history"; remove.type="button"; remove.textContent="×"; remove.setAttribute("aria-label","Remove from watch history");
      remove.dataset.historyKey = item && item.key ? item.key : (post.key || postKey(post));
      card.appendChild(remove); card.appendChild(createThumb(post,item));
      const info=document.createElement("div");info.className="history-info";
      const title=document.createElement("h3");title.className="card-title";title.textContent=post.title;info.appendChild(title);
      const time=document.createElement("div");time.className="history-time";time.textContent=item && item.duration>0 ? `Resume at ${formatTime(item.time||0)} · ${Math.round((item.time||0)/item.duration*100)}%` : "Recently watched";info.appendChild(time);
      card.appendChild(info);
      const open=()=>openPlayer(post);card.addEventListener("click",e=>{if(e.target.closest("button.remove-history"))return;open();});card.addEventListener("keydown",e=>{if(e.target.closest && e.target.closest("button.remove-history"))return;if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
      els.historyGrid.appendChild(card);
    });
  }
  function loadPastedJson(text) {
    const source = text.trim();
    if (!source) { showNotice("Paste the full JSON response into the box first.", "error"); return; }
    try {
      const json = JSON.parse(source);
      const array = extractArray(json);
      // If an API URL is present, use it as the base for relative paths; otherwise
      // relative paths resolve against this page and may need to be made absolute.
      const base = lastApiUrl || (els.apiUrl.value.trim().split(/\s+/)[0]) || window.location.href;
      const normalized = array.map((item, i) => normalizePost(item, i, base)).filter(Boolean);
      mergePosts(normalized);
      renderPosts(); renderHistory();
      els.refreshBtn.disabled = !lastApiUrl;
      if (posts.length === 0) showNotice("Valid JSON loaded, but it contains an empty list. Check that the JSON includes posts/videos.", "error");
      else showNotice(`Loaded ${posts.length} ${posts.length === 1 ? "post" : "posts"} from pasted JSON.`, "success");
      els.jsonInput.blur();
    } catch (err) {
      showNotice(err instanceof SyntaxError ? "That is not valid JSON. Paste the complete raw response, including its opening and closing brackets/braces." : (err.message || "Could not find a list of posts in this JSON."), "error");
    }
  }

  async function loadFeed(url, {quiet=false, persist=true}={}) {
    let parsed;
    try { parsed = new URL(url); if (!["http:","https:"].includes(parsed.protocol)) throw new Error(); }
    catch { showNotice("Please enter a valid HTTP or HTTPS API URL.", "error"); return; }
    lastApiUrl = parsed.href; if(persist){safeStorageSet(LAST_API_KEY,lastApiUrl); els.apiUrl.value=lastApiUrl;}
    const token=++loadToken; setLoading(true); hideNotice(); els.refreshBtn.disabled=true;
    try {
      // Fetch through the Cloudflare Worker so public APIs that omit CORS
      // headers can still be loaded from GitHub Pages.
      const workerUrl = "https://nightwave-api-proxy.dirtcoc.workers.dev/";
      const response = await fetch(
        workerUrl + "?url=" + encodeURIComponent(lastApiUrl),
        {method:"GET", headers:{Accept:"application/json"}, cache:"no-store"}
      );
      if (!response.ok) throw new Error(`The API returned HTTP ${response.status} ${response.statusText}.`);
      const type = response.headers.get("content-type") || "";
      const body = await response.text();
      let json;
      try { json=JSON.parse(body); } catch { throw new Error(type.includes("text/html") || /^\s*</.test(body) ? "The URL returned HTML instead of JSON. Paste the API endpoint, not a website page." : "The response was not valid JSON."); }
      const array=extractArray(json);
      const normalized=array.map((item,i)=>normalizePost(item,i,lastApiUrl)).filter(Boolean);
      if(token!==loadToken)return;
      mergePosts(normalized); renderPosts(); renderHistory(); els.refreshBtn.disabled=false;
      if(posts.length===0) showNotice("The API returned an empty list. Try refreshing later.", "");
      else showNotice(`Loaded ${posts.length} ${posts.length===1?"post":"posts"}. Posts without video attachments remain visible but cannot be played.`, "success");
    } catch(err) {
      if(token!==loadToken)return;
      const msg=err instanceof TypeError || /fetch|network|cors/i.test(err.message||"")
        ? "Could not reach the API proxy. Check that the Cloudflare Worker is deployed and accepts a ?url= parameter."
        : (err.message || "Something went wrong while loading the feed.");
      showNotice(msg, "error");
      if(!quiet && posts.length===0) { els.empty.hidden=false; }
    } finally { if(token===loadToken){setLoading(false);els.refreshBtn.disabled=!lastApiUrl;} }
  }
  async function loadFeeds(urls, {quiet=false}={}) {
    const unique = [...new Set(urls.map(u=>u.trim()).filter(Boolean))];
    if (!unique.length) { showNotice("Enter at least one API URL, one per line.", "error"); return; }
    safeStorageSet(LAST_API_KEY, unique.join("\n"));
    els.apiUrl.value = unique.join("\n");
    lastApiUrl = unique[0];
    let successes = 0;
    for (const url of unique) {
      const before = posts.length;
      await loadFeed(url, {quiet:true, persist:false});
      if (posts.length > before) successes++;
    }
    els.apiUrl.value = unique.join("\n");
    lastApiUrl = unique[0];
    els.refreshBtn.disabled = false;
    if (successes) showNotice(`Loaded and merged posts from ${successes} of ${unique.length} feed${unique.length===1?"":"s"}.`, "success");
    else if (!quiet) showNotice("Could not load any feeds. Check the URLs or paste the JSON responses instead if CORS blocks them.", "error");
  }
  function displayedVideoPosts() { return filteredPosts().filter(post => !!post.videoUrl); }
  function updatePlayerNavigation() {
    if (!els.previousVideoBtn || !els.nextVideoBtn) return;
    const list = displayedVideoPosts();
    const index = currentPost ? list.findIndex(post => postIdentity(post) === postIdentity(currentPost)) : -1;
    const canNavigate = index >= 0 && list.length > 1;
    els.previousVideoBtn.disabled = !canNavigate;
    els.nextVideoBtn.disabled = !canNavigate;
    els.previousVideoBtn.title = index <= 0 ? "Previous video (start of current list)" : "Previous video";
    els.nextVideoBtn.title = index < 0 || index >= list.length - 1 ? "Next video (end of current list)" : "Next video";
  }
  function stepDisplayedVideo(direction) {
    const list = displayedVideoPosts();
    if (!currentPost || !list.length) return;
    const index = list.findIndex(post => postIdentity(post) === postIdentity(currentPost));
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= list.length) return;
    openPlayer(list[nextIndex]);
  }
  function destroyHls() { if(hls){try{hls.destroy();}catch{}hls=null;} }
  function getSavedItem(post) { return getHistory().find(x=>x.key===postKey(post)); }
  function saveProgress(force=false) {
    if(!currentPost || !els.video.currentTime || !Number.isFinite(els.video.currentTime)) return;
    const time=els.video.currentTime, duration=Number.isFinite(els.video.duration)?els.video.duration:0;
    updateHistory(currentPost,{time,duration,finished:els.video.ended,videoUrl:currentPost.videoUrl});
  }
  function openPostViewer(post) {
    els.playerDialog.classList.add("image-mode");
    currentPost=post; els.playerTitle.textContent=post.title; els.playerDescription.textContent=post.description || "No description provided."; els.playerDate.textContent=formatDate(post.published); els.modal.hidden=false; document.body.classList.add("modal-open");
    destroyHls(); els.video.pause(); els.video.removeAttribute("src"); els.video.load(); els.video.hidden=true; els.postImage.hidden=false; els.postImage.src=post.thumbnail || ""; els.postImage.alt=post.title; els.playerLoading.hidden=true; els.playerError.hidden=true;
  }
  const QUALITY_KEY = "nightwave.videoQuality.v1";
  function savedQuality() { return safeStorageGet(QUALITY_KEY, "auto") || "auto"; }
  function setQualityOptions(instance) {
    if (!els.quality) return;
    const heights = [...new Set((instance?.levels || []).map(level => Number(level.height)).filter(height => height > 0))].sort((a,b)=>b-a);
    els.quality.innerHTML = '<option value="auto">Auto</option>' + heights.map(height => `<option value="${height}">${height}p</option>`).join("");
    const preference = savedQuality();
    const chosen = heights.includes(Number(preference)) ? preference : "auto";
    els.quality.value = chosen;
    if (instance) applyQualityPreference(instance, chosen);
  }
  function applyQualityPreference(instance, preference = els.quality?.value || savedQuality()) {
    if (!instance || !els.quality) return;
    if (preference === "auto") instance.currentLevel = -1;
    else {
      const height = Number(preference);
      const matches = instance.levels.map((level,index)=>({level,index})).filter(x=>Number(x.level.height)===height);
      if (matches.length) instance.currentLevel = matches[matches.length-1].index;
      else instance.currentLevel = -1;
    }
  }
  function openPlayer(post) {
    if(!post.videoUrl){openPostViewer(post);return;}
    els.playerDialog.classList.remove("image-mode");
    els.video.hidden=false; els.postImage.hidden=true; els.postImage.removeAttribute("src"); els.playerError.hidden=true;
    currentPost=post; els.playerTitle.textContent=post.title; els.playerDescription.textContent=post.description || "No description provided.";
    els.playerDate.textContent=formatDate(post.published); els.modal.hidden=false; document.body.classList.add("modal-open"); updatePlayerNavigation();
    els.playerError.hidden=true; els.playerLoading.hidden=false; els.playerLoading.querySelector("span").textContent="Preparing stream…";
    destroyHls(); els.video.pause(); els.video.removeAttribute("src"); els.video.load(); els.video.playbackRate=Number(els.speed.value)||1;
    if (els.quality) { els.quality.innerHTML = `<option value="auto">Auto</option>`; els.quality.value = savedQuality(); }
    els.timelineFill.style.width="0%";els.timelineKnob.style.left="0%";els.timeDisplay.textContent="0:00 / 0:00";els.playBtn.textContent="▶";
    updateHistory(post,{videoUrl:post.videoUrl});
    const token=++loadToken; // token also prevents a stale feed result/player callback race
    const url=post.videoUrl;
    const resume=getSavedItem(post); const resumeAt=resume && !resume.finished ? Number(resume.time)||0 : 0;
    const showError=message=>{if(token!==loadToken)return;els.playerLoading.hidden=true;els.playerError.textContent=message;els.playerError.hidden=false;};
    els.video.onerror=()=>showError("The video could not be loaded. The stream may have expired, be unavailable, or be blocked by CORS.");
    const onMetadata=()=>{if(token!==loadToken)return;els.playerLoading.hidden=true;els.playerError.hidden=true;if(resumeAt>2 && Number.isFinite(els.video.duration) && resumeAt<els.video.duration-2){try{els.video.currentTime=resumeAt;}catch{}} syncTimeline();els.video.play().catch(()=>{});};
    els.video.onloadedmetadata=onMetadata;
    els.video.onplaying=()=>{if(token===loadToken){els.playerLoading.hidden=true;els.playBtn.textContent="Ⅱ";}};
    els.video.onpause=()=>{if(token===loadToken){els.playBtn.textContent="▶";saveProgress();}};
    els.video.onwaiting=()=>{if(token===loadToken && !els.video.paused){els.playerLoading.hidden=false;els.playerLoading.querySelector("span").textContent="Buffering…";}};
    els.video.oncanplay=()=>{if(token===loadToken)els.playerLoading.hidden=true;};
    els.video.ontimeupdate=()=>{if(token===loadToken){syncTimeline();if(!els.video.paused)saveProgress();}};
    els.video.onended=()=>{if(token===loadToken){updateHistory(currentPost || post,{time:0,duration:Number.isFinite(els.video.duration)?els.video.duration:0,finished:true});els.playBtn.textContent="▶";}};
    const isHls=/\.m3u8(?:$|[?#])/i.test(url);
    if(els.video.canPlayType("application/vnd.apple.mpegurl")){els.video.src=url;els.video.load();}
    else if(isHls && window.Hls && Hls.isSupported()){
      hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});
      hls.on(Hls.Events.MANIFEST_PARSED,()=>{if(token===loadToken)setQualityOptions(hls);});
      hls.on(Hls.Events.LEVELS_UPDATED,()=>{if(token===loadToken)setQualityOptions(hls);});
      hls.on(Hls.Events.ERROR,(_,data)=>{if(token!==loadToken||!data.fatal)return;
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR){showError("Network error loading HLS segments. The stream host may block cross-origin access (CORS), or the signed URL may have expired.");}
        else if(data.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();}
        else showError("This HLS stream could not be played by this browser.");});
      hls.loadSource(url);hls.attachMedia(els.video);
    } else {els.video.src=url;els.video.load();}
    // Browsers may fire loadedmetadata before handler is installed for native HLS only in rare cases.
    if(els.video.readyState>=1)onMetadata();
  }
  function closePlayer() { saveProgress(); els.video.pause(); destroyHls(); els.video.removeAttribute("src");els.video.load();els.modal.hidden=true;document.body.classList.remove("modal-open");els.playerDialog.classList.remove("image-mode");currentPost=null; }
  function syncTimeline() {
    const v=els.video, duration=v.duration;
    if(!Number.isFinite(duration)||duration<=0){els.timeDisplay.textContent=`${formatTime(v.currentTime)} / 0:00`;return;}
    const percent=Math.max(0,Math.min(100,v.currentTime/duration*100));els.timelineFill.style.width=`${percent}%`;els.timelineKnob.style.left=`${percent}%`;els.timeDisplay.textContent=`${formatTime(v.currentTime)} / ${formatTime(duration)}`;
  }
  function seekToPercent(percent){if(Number.isFinite(els.video.duration)&&els.video.duration>0)els.video.currentTime=Math.max(0,Math.min(els.video.duration,percent/100*els.video.duration));}
  function seekBy(seconds){if(els.video.readyState>0){const d=Number.isFinite(els.video.duration)?els.video.duration:Infinity;els.video.currentTime=Math.max(0,Math.min(d,els.video.currentTime+seconds));}}
  async function togglePlay(){if(els.video.paused){try{await els.video.play();}catch{els.playerError.textContent="Playback was blocked. Press play again, or check stream access.";els.playerError.hidden=false;}}else els.video.pause();}
  async function toggleFullscreen(){try{if(document.fullscreenElement)await document.exitFullscreen();else if(els.playerDialog?.requestFullscreen)await els.playerDialog.requestFullscreen();else if(els.video.webkitEnterFullscreen)els.video.webkitEnterFullscreen();}catch{showNotice("Fullscreen is unavailable in this browser.","error");}}
  function enableFast(){if(!els.video.paused&&!holdingFast){holdingFast=true;els.video.playbackRate=2;els.speedIndicator.classList.add("visible");}}
  function disableFast(){if(holdingFast){holdingFast=false;els.video.playbackRate=Number(els.speed.value)||1;els.speedIndicator.classList.remove("visible");}}
  els.apiForm.addEventListener("submit",e=>{e.preventDefault();loadFeeds(els.apiUrl.value.split(/\n+/));});
  els.loadJsonBtn.addEventListener("click",()=>loadPastedJson(els.jsonInput.value));
  els.refreshBtn.addEventListener("click",()=>{const saved=safeStorageGet(LAST_API_KEY,"").split(/\n+/).filter(Boolean);if(saved.length)loadFeeds(saved);});
  els.search.addEventListener("input",renderPosts);els.sort.addEventListener("change",renderPosts);
  els.clearHistory.addEventListener("click",()=>{if(confirm("Clear all locally saved watch history and resume positions?")){safeStorageSet(HISTORY_KEY,"[]");renderHistory();renderPosts();}});
  els.clearLibrary.addEventListener("click",()=>{if(confirm("Clear every post from your saved library? This will not delete watch history or saved API URLs.")){posts=[];safeStorageSet(LIBRARY_KEY,"[]");renderPosts();showNotice("Your library has been cleared.","success");}});
  $("brandHome").addEventListener("click",e=>{e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});});
  els.closePlayer.addEventListener("click",closePlayer);els.modal.querySelector("[data-close-player]").addEventListener("click",closePlayer);
  els.previousVideoBtn.addEventListener("click",()=>stepDisplayedVideo(-1));
  els.nextVideoBtn.addEventListener("click",()=>stepDisplayedVideo(1));

  let suppressVideoClick = false;
  els.video.addEventListener("click", e=>{e.preventDefault();if(suppressVideoClick){suppressVideoClick=false;return;}togglePlay();});
  els.video.addEventListener("dblclick", e=>{e.preventDefault();toggleFullscreen();});
  let controlsHideTimer = null;
  function revealFullscreenControls() {
    if (!document.fullscreenElement || !els.playerDialog) return;
    els.playerDialog.classList.add("controls-visible"); els.playerDialog.classList.remove("cursor-hidden");
    clearTimeout(controlsHideTimer);
    if (!els.video.paused) controlsHideTimer = setTimeout(()=>{els.playerDialog.classList.remove("controls-visible");els.playerDialog.classList.add("cursor-hidden");}, 2200);
  }
  els.playerDialog?.addEventListener("mousemove", revealFullscreenControls);
  els.video.addEventListener("pause", ()=>{if(document.fullscreenElement) {clearTimeout(controlsHideTimer);els.playerDialog.classList.add("controls-visible");els.playerDialog.classList.remove("cursor-hidden");}});
  els.video.addEventListener("play", revealFullscreenControls);
  els.playBtn.addEventListener("click",togglePlay);els.backBtn.addEventListener("click",()=>seekBy(-5));els.forwardBtn.addEventListener("click",()=>seekBy(5));els.fullscreenBtn.addEventListener("click",toggleFullscreen);
  els.speed.addEventListener("change",()=>{if(!holdingFast)els.video.playbackRate=Number(els.speed.value)||1;});
  els.quality?.addEventListener("change",()=>{const choice=els.quality.value || "auto";try{localStorage.setItem(QUALITY_KEY,choice);}catch{}if(hls)applyQualityPreference(hls,choice);});
  els.timeline.addEventListener("pointerdown",e=>{if(!Number.isFinite(els.video.duration)||els.video.duration<=0)return;seekDrag=true;els.timeline.setPointerCapture?.(e.pointerId);const update=ev=>{const r=els.timeline.getBoundingClientRect();const pct=Math.max(0,Math.min(100,(ev.clientX-r.left)/r.width*100));els.timelineFill.style.width=`${pct}%`;els.timelineKnob.style.left=`${pct}%`;els.timeDisplay.textContent=`${formatTime(pct/100*els.video.duration)} / ${formatTime(els.video.duration)}`;seekToPercent(pct);};update(e);const move=ev=>{if(seekDrag)update(ev);};const up=()=>{seekDrag=false;window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);};window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});});
  els.timelineKnob.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"){e.preventDefault();seekBy(-5);}if(e.key==="ArrowRight"){e.preventDefault();seekBy(5);}});
  els.playerShell.addEventListener("mousedown",e=>{if(e.target===els.video){clearTimeout(holdTimer);holdTimer=setTimeout(()=>{if(!els.video.paused){enableFast();suppressVideoClick=true;}},220);}});
  window.addEventListener("mouseup",()=>{clearTimeout(holdTimer);if(holdingFast)suppressVideoClick=true;disableFast();});
  els.playerShell.addEventListener("touchstart",()=>{clearTimeout(holdTimer);holdTimer=setTimeout(enableFast,350);},{passive:true});
  window.addEventListener("touchend",()=>{clearTimeout(holdTimer);disableFast();},{passive:true});
  document.addEventListener("keydown",e=>{
    if(els.modal.hidden)return;
    if(e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey && (e.key.toLowerCase()==="p" || e.key.toLowerCase()==="n")) {
      e.preventDefault(); e.stopPropagation(); stepDisplayedVideo(e.key.toLowerCase()==="p" ? -1 : 1); return;
    }
    if(["INPUT","TEXTAREA","SELECT"].includes(e.target.tagName))return;
    if(e.key==="Escape"){closePlayer();return;}
    if(e.code==="Space"){e.preventDefault();if(!spaceDown){spaceDown=true;spaceHoldTimer=setTimeout(()=>{if(spaceDown)enableFast();},220);}return;}
    if(e.key==="ArrowLeft"){e.preventDefault();seekBy(-5);}else if(e.key==="ArrowRight"){e.preventDefault();seekBy(5);}else if(e.key.toLowerCase()==="k"){e.preventDefault();togglePlay();}else if(e.key.toLowerCase()==="f"){e.preventDefault();toggleFullscreen();}else if(/^[0-9]$/.test(e.key)){seekToPercent(Number(e.key)*10);}
  });
  document.addEventListener("keyup",e=>{if(e.code==="Space"&&spaceDown){clearTimeout(spaceHoldTimer);spaceDown=false;if(holdingFast)disableFast();else togglePlay();}});
  document.addEventListener("visibilitychange",()=>{if(document.hidden)saveProgress();});
  window.addEventListener("pagehide",()=>saveProgress());
  document.addEventListener("fullscreenchange",()=>{
    els.fullscreenBtn.textContent="⛶";
    if(document.fullscreenElement===els.playerDialog){els.playerDialog.classList.add("controls-visible");revealFullscreenControls();}
    else {clearTimeout(controlsHideTimer);els.playerDialog.classList.remove("controls-visible");}
  });
  try { const savedLibrary=JSON.parse(safeStorageGet(LIBRARY_KEY,"[]")); if(Array.isArray(savedLibrary)) posts=savedLibrary.filter(p=>p&&typeof p.title==="string"); } catch {}
  const savedUrl=safeStorageGet(LAST_API_KEY,"");
  if(savedUrl){const urls=savedUrl.split(/\n+/).filter(Boolean);els.apiUrl.value=urls.join("\n");lastApiUrl=urls[0]||"";loadFeeds(urls,{quiet:true});}
  renderHistory();renderPosts();
})();
