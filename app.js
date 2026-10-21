(() => {
  "use strict";
  const $ = (id) => document.getElementById(id);
  const els = {
    apiForm:$("apiForm"), apiUrl:$("apiUrl"), loadBtn:$("loadBtn"), refreshBtn:$("refreshBtn"),
    jsonInput:$("jsonInput"), loadJsonBtn:$("loadJsonBtn"),
    notice:$("notice"), loading:$("loading"), toolbar:$("toolbar"), search:$("searchInput"),
    sort:$("sortSelect"), grid:$("videoGrid"), empty:$("emptyState"), noResults:$("noResults"),
    resultCount:$("resultCount"), historySection:$("history"), historyGrid:$("historyGrid"),
    historyCount:$("historyCount"), clearHistory:$("clearHistoryBtn"), modal:$("playerModal"),
    playerShell:$("playerShell"), playerDialog:$("playerModal").querySelector(".player-dialog"), video:$("video"), playerTitle:$("playerTitle"),
    playerDescription:$("playerDescription"), playerDate:$("playerDate"), playerLoading:$("playerLoading"),
    playerError:$("playerError"), playBtn:$("playBtn"), backBtn:$("backBtn"), forwardBtn:$("forwardBtn"),
    timeline:$("timelineTrack"), timelineFill:$("timelineFill"), timelineKnob:$("timelineKnob"),
    timeDisplay:$("timeDisplay"), fullscreenBtn:$("fullscreenBtn"), speed:$("speedSelect"),
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
  function mergePosts(incoming) {
    const libraryKey = post => String(post.videoUrl || post.id || post.title || "post");
    const merged = new Map(posts.map(post => [libraryKey(post), post]));
    for (const post of incoming) {
      const key = libraryKey(post);
      const previous = merged.get(key);
      merged.set(key, previous ? {...previous, ...post, thumbnail:post.thumbnail || previous.thumbnail, videoUrl:post.videoUrl || previous.videoUrl} : post);
    }
    posts = Array.from(merged.values());
    persistLibrary();
  }
  function postKey(post) { return String(post.id || post.videoUrl || post.title || "post"); }
  function getHistoryItem(post) { return getHistory().find(x => x.key === postKey(post)); }
  function updateHistory(post, patch) {
    if (!post) return;
    const key = postKey(post), old = getHistory().find(x => x.key === key) || {};
    const item = {...old, key, id:post.id, title:post.title, thumbnail:post.thumbnail, videoUrl:post.videoUrl, description:post.description, published:post.published, ...patch, updated:Date.now()};
    const next = [item, ...getHistory().filter(x => x.key !== key)].slice(0, MAX_HISTORY);
    saveHistory(next);
  }
  function removeHistory(key) { saveHistory(getHistory().filter(x => x.key !== key)); }
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
    const path = post.file && (post.file.path || post.file.url) || post.thumbnail || post.thumbnail_url || post.image || post.image_url || post.preview;
    if (!path) return "";
    if (typeof path === "object") return absolutizeUrl(path.url || path.path || "", base);
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
      id: raw.id == null ? String(index) : String(raw.id), title,
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
    const open = () => post.hasVideo ? openPlayer(post) : showNotice(`“${post.title}” has no video attachment, so it is shown as a post only.`, "");
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
  }
  function renderHistory() {
    const history = getHistory(); els.historyGrid.replaceChildren();
    const historyPosts = history.map(item => ({...item, id:item.id || item.key, title:item.title || "Untitled video", description:item.description || "", published:item.published || "", thumbnail:item.thumbnail || "", videoUrl:item.videoUrl || "", hasVideo:!!item.videoUrl, tags:""})).filter(p=>p.videoUrl);
    els.historySection.hidden = historyPosts.length === 0;
    els.historyCount.textContent = historyPosts.length ? `(${historyPosts.length})` : "";
    historyPosts.forEach(post => {
      const item = getHistoryItem(post) || history.find(x=>x.key===postKey(post));
      const card = document.createElement("article"); card.className="history-card"; card.tabIndex=0; card.setAttribute("role","button");
      const remove = document.createElement("button"); remove.className="remove-history"; remove.type="button"; remove.textContent="×"; remove.setAttribute("aria-label","Remove from watch history");
      remove.addEventListener("click",e=>{e.stopPropagation();removeHistory(postKey(post));});
      card.appendChild(remove); card.appendChild(createThumb(post,item));
      const info=document.createElement("div");info.className="history-info";
      const title=document.createElement("h3");title.className="card-title";title.textContent=post.title;info.appendChild(title);
      const time=document.createElement("div");time.className="history-time";time.textContent=item && item.duration>0 ? `Resume at ${formatTime(item.time||0)} · ${Math.round((item.time||0)/item.duration*100)}%` : "Recently watched";info.appendChild(time);
      card.appendChild(info);
      const open=()=>openPlayer(post);card.addEventListener("click",open);card.addEventListener("keydown",e=>{if(e.key==="Enter"||e.key===" "){e.preventDefault();open();}});
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
      const base = lastApiUrl || els.apiUrl.value.trim() || window.location.href;
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

  async function loadFeed(url, {quiet=false}={}) {
    let parsed;
    try { parsed = new URL(url); if (!["http:","https:"].includes(parsed.protocol)) throw new Error(); }
    catch { showNotice("Please enter a valid HTTP or HTTPS API URL.", "error"); return; }
    lastApiUrl = parsed.href; safeStorageSet(LAST_API_KEY,lastApiUrl); els.apiUrl.value=lastApiUrl;
    const token=++loadToken; setLoading(true); hideNotice(); els.refreshBtn.disabled=true;
    try {
      const response = await fetch(lastApiUrl, {method:"GET", headers:{Accept:"application/json"}, cache:"no-store"});
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
        ? "The browser could not access this API. This is often a CORS restriction: the API must send an Access-Control-Allow-Origin header permitting this GitHub Pages site. A static site cannot bypass CORS; use an API endpoint that allows browser requests."
        : (err.message || "Something went wrong while loading the feed.");
      showNotice(msg, "error");
      if(!quiet && posts.length===0) { els.empty.hidden=false; }
    } finally { if(token===loadToken){setLoading(false);els.refreshBtn.disabled=!lastApiUrl;} }
  }
  function destroyHls() { if(hls){try{hls.destroy();}catch{}hls=null;} }
  function getSavedItem(post) { return getHistory().find(x=>x.key===postKey(post)); }
  function saveProgress(force=false) {
    if(!currentPost || !els.video.currentTime || !Number.isFinite(els.video.currentTime)) return;
    const time=els.video.currentTime, duration=Number.isFinite(els.video.duration)?els.video.duration:0;
    updateHistory(currentPost,{time,duration,finished:els.video.ended,videoUrl:currentPost.videoUrl});
  }
  function openPlayer(post) {
    if(!post.videoUrl){showNotice("This post has no playable video attachment.","");return;}
    currentPost=post; els.playerTitle.textContent=post.title; els.playerDescription.textContent=post.description || "No description provided.";
    els.playerDate.textContent=formatDate(post.published); els.modal.hidden=false; document.body.classList.add("modal-open");
    els.playerError.hidden=true; els.playerLoading.hidden=false; els.playerLoading.querySelector("span").textContent="Preparing stream…";
    destroyHls(); els.video.pause(); els.video.removeAttribute("src"); els.video.load(); els.video.playbackRate=Number(els.speed.value)||1;
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
    els.video.onended=()=>{if(token===loadToken){updateHistory(post,{time:0,duration:Number.isFinite(els.video.duration)?els.video.duration:0,finished:true});els.playBtn.textContent="▶";}};
    const isHls=/\.m3u8(?:$|[?#])/i.test(url);
    if(els.video.canPlayType("application/vnd.apple.mpegurl")){els.video.src=url;els.video.load();}
    else if(isHls && window.Hls && Hls.isSupported()){
      hls=new Hls({enableWorker:true,lowLatencyMode:true,backBufferLength:30});
      hls.on(Hls.Events.ERROR,(_,data)=>{if(token!==loadToken||!data.fatal)return;
        if(data.type===Hls.ErrorTypes.NETWORK_ERROR){showError("Network error loading HLS segments. The stream host may block cross-origin access (CORS), or the signed URL may have expired.");}
        else if(data.type===Hls.ErrorTypes.MEDIA_ERROR){hls.recoverMediaError();}
        else showError("This HLS stream could not be played by this browser.");});
      hls.loadSource(url);hls.attachMedia(els.video);
    } else {els.video.src=url;els.video.load();}
    // Browsers may fire loadedmetadata before handler is installed for native HLS only in rare cases.
    if(els.video.readyState>=1)onMetadata();
  }
  function closePlayer() { saveProgress(); els.video.pause(); destroyHls(); els.video.removeAttribute("src");els.video.load();els.modal.hidden=true;document.body.classList.remove("modal-open");currentPost=null; }
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
  els.apiForm.addEventListener("submit",e=>{e.preventDefault();loadFeed(els.apiUrl.value.trim());});
  els.loadJsonBtn.addEventListener("click",()=>loadPastedJson(els.jsonInput.value));
  els.refreshBtn.addEventListener("click",()=>{if(lastApiUrl)loadFeed(lastApiUrl);});
  els.search.addEventListener("input",renderPosts);els.sort.addEventListener("change",renderPosts);
  els.clearHistory.addEventListener("click",()=>{if(confirm("Clear all locally saved watch history and resume positions?")){safeStorageSet(HISTORY_KEY,"[]");renderHistory();renderPosts();}});
  $("brandHome").addEventListener("click",e=>{e.preventDefault();window.scrollTo({top:0,behavior:"smooth"});});
  els.closePlayer.addEventListener("click",closePlayer);els.modal.querySelector("[data-close-player]").addEventListener("click",closePlayer);

  els.video.addEventListener("click", e=>{e.preventDefault();togglePlay();});
  els.video.addEventListener("dblclick", e=>{e.preventDefault();toggleFullscreen();});
  let controlsHideTimer = null;
  function revealFullscreenControls() {
    if (!document.fullscreenElement || !els.playerDialog) return;
    els.playerDialog.classList.add("controls-visible");
    clearTimeout(controlsHideTimer);
    if (!els.video.paused) controlsHideTimer = setTimeout(()=>els.playerDialog.classList.remove("controls-visible"), 2200);
  }
  els.playerDialog?.addEventListener("mousemove", revealFullscreenControls);
  els.video.addEventListener("pause", ()=>{if(document.fullscreenElement) {clearTimeout(controlsHideTimer);els.playerDialog.classList.add("controls-visible");}});
  els.video.addEventListener("play", revealFullscreenControls);
  els.playBtn.addEventListener("click",togglePlay);els.backBtn.addEventListener("click",()=>seekBy(-5));els.forwardBtn.addEventListener("click",()=>seekBy(5));els.fullscreenBtn.addEventListener("click",toggleFullscreen);
  els.speed.addEventListener("change",()=>{if(!holdingFast)els.video.playbackRate=Number(els.speed.value)||1;});
  els.timeline.addEventListener("pointerdown",e=>{if(!Number.isFinite(els.video.duration)||els.video.duration<=0)return;seekDrag=true;els.timeline.setPointerCapture?.(e.pointerId);const update=ev=>{const r=els.timeline.getBoundingClientRect();const pct=Math.max(0,Math.min(100,(ev.clientX-r.left)/r.width*100));els.timelineFill.style.width=`${pct}%`;els.timelineKnob.style.left=`${pct}%`;els.timeDisplay.textContent=`${formatTime(pct/100*els.video.duration)} / ${formatTime(els.video.duration)}`;seekToPercent(pct);};update(e);const move=ev=>{if(seekDrag)update(ev);};const up=()=>{seekDrag=false;window.removeEventListener("pointermove",move);window.removeEventListener("pointerup",up);};window.addEventListener("pointermove",move);window.addEventListener("pointerup",up,{once:true});});
  els.timelineKnob.addEventListener("keydown",e=>{if(e.key==="ArrowLeft"){e.preventDefault();seekBy(-5);}if(e.key==="ArrowRight"){e.preventDefault();seekBy(5);}});
  els.playerShell.addEventListener("mousedown",e=>{if(e.target===els.video){clearTimeout(holdTimer);holdTimer=setTimeout(enableFast,220);}});
  window.addEventListener("mouseup",()=>{clearTimeout(holdTimer);disableFast();});
  els.playerShell.addEventListener("touchstart",()=>{clearTimeout(holdTimer);holdTimer=setTimeout(enableFast,350);},{passive:true});
  window.addEventListener("touchend",()=>{clearTimeout(holdTimer);disableFast();},{passive:true});
  document.addEventListener("keydown",e=>{
    if(els.modal.hidden)return;
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
  if(savedUrl){els.apiUrl.value=savedUrl;lastApiUrl=savedUrl;loadFeed(savedUrl,{quiet:true});}
  renderHistory();renderPosts();
})();