/* ============================================================
   AIHub 落地站 · 早报生成控制台（只在 briefing.html 加载）

   为什么单独一张表：
     assets/js/main.js 是全站唯一脚本，负责导航 / 动效这类**每页都要**的东西。
     这个控制台只服务早报页，而且它要发请求、要轮询 —— 塞进 main.js 会让
     「点左上角 logo 打开调参面板」这类无关行为也背上一份网络逻辑。
     单独一张表意味着：其他 7 页完全不受影响，也不必多引任何依赖。

   它做什么：
     调本机 ai-news-kit 的生成服务，真实跑一次「抓取 → 选稿 → 渲染 → 打包」。
     服务地址可配：?api=http://127.0.0.1:8787  >  window.AIHUB_GEN_API
                  > 本元素 data-gen-api  > localStorage  > 默认 127.0.0.1:8787

   ⚠ 刻意**不做**的事：不画假进度条。
     服务没起来就直说「没起来」并把启动命令给出来，而不是演一遍动画、最后给个
     固定样张 —— 那是骗人，而且真用一次就会发现对不上。这个项目所有的卖点都是
     「这条消息能不能信」，界面自己更不能演。

   约定：只读 tokens.css 的令牌取色，不写死颜色（遵守「颜色只有一个真相源」）；
        类名统一 `genx-` 前缀，与主站任何类都不冲突。
   ============================================================ */
(function () {
  "use strict";

  var root = document.querySelector("[data-gen]");
  if (!root) return;

  var DEFAULT_API = "http://127.0.0.1:8787";
  var STORE_KEY = "aihub.gen.api";
  var POLL_EVERY = 700;        // 轮询间隔（ms）
  var POLL_LIMIT = 900;        // 最多轮询次数 ≈ 10 分钟
  var REQ_TIMEOUT = 20000;

  /* ---------- 服务地址 ---------- */
  function apiBase() {
    var q = null;
    try { q = new URLSearchParams(location.search).get("api"); } catch (e) {}
    var pick = q || window.AIHUB_GEN_API || root.getAttribute("data-gen-api");
    if (pick) {
      try { localStorage.setItem(STORE_KEY, pick); } catch (e) {}
      return String(pick).replace(/\/+$/, "");
    }
    try {
      var saved = localStorage.getItem(STORE_KEY);
      if (saved) return String(saved).replace(/\/+$/, "");
    } catch (e) {}
    return DEFAULT_API;
  }
  var API = apiBase();

  /* ---------- DOM ---------- */
  var $ = function (sel) { return root.querySelector(sel); };
  var elStatus = $("[data-gen-status]");
  var elStatusText = $("[data-gen-status-text]");
  var elDate = $("[data-gen-date]");
  var elMode = $("[data-gen-mode]");
  var elNoFetch = $("[data-gen-nofetch]");
  var elGo = $("[data-gen-go]");
  var elGoLabel = $("[data-gen-go-label]");
  var elHint = $("[data-gen-hint]");
  var elPanel = $("[data-gen-panel]");
  var elSteps = $("[data-gen-steps]");
  var elResult = $("[data-gen-result]");

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function fmtSize(n) {
    if (!n) return "";
    if (n < 1024) return n + " B";
    if (n < 1024 * 1024) return (n / 1024).toFixed(0) + " KB";
    return (n / 1024 / 1024).toFixed(1) + " MB";
  }
  function setStatus(state, text) {
    if (elStatus) elStatus.setAttribute("data-state", state);
    if (elStatusText) elStatusText.textContent = text;
  }
  function setHint(html, state) {
    if (!elHint) return;
    elHint.innerHTML = html;
    if (state) elHint.setAttribute("data-state", state);
    else elHint.removeAttribute("data-state");
  }

  function startHelpHtml(reason) {
    return (
      '<strong>生成服务没起来</strong>（' + esc(reason) + '）。这个按钮调的是本机服务，不是远端接口。' +
      '<br>到项目里跑一次下面这条命令，再刷新本页：' +
      '<div class="genx-cmd"><code>node ai-news-kit/scripts/serve.mjs</code></div>' +
      '<span class="genx-hint__foot">默认监听 <code>127.0.0.1:8787</code>；要换端口就加 ' +
      '<code>--port 9000</code>，再用 <code>?api=http://127.0.0.1:9000</code> 打开本页。' +
      '若本机开着系统代理（Clash 之类）而没把 <code>127.0.0.1</code> 加进绕过列表，' +
      '浏览器会拒连 —— 这是最常见的「服务明明起来了却连不上」。</span>'
    );
  }

  /* ---------- 请求（带超时；任何异常都转成可读原因） ---------- */
  function call(path, opts) {
    opts = opts || {};
    var ctl = typeof AbortController !== "undefined" ? new AbortController() : null;
    var timer = window.setTimeout(function () { if (ctl) ctl.abort(); }, REQ_TIMEOUT);
    var init = { method: opts.method || "GET", signal: ctl ? ctl.signal : undefined };
    if (opts.body) {
      init.headers = { "Content-Type": "application/json" };
      init.body = JSON.stringify(opts.body);
    }
    return fetch(API + path, init)
      .then(function (r) {
        window.clearTimeout(timer);
        return r.text().then(function (t) {
          var data = null;
          try { data = JSON.parse(t); } catch (e) { data = { raw: t }; }
          return { status: r.status, ok: r.ok, data: data };
        });
      })
      .catch(function (e) {
        window.clearTimeout(timer);
        var msg = e && e.name === "AbortError" ? "请求超时" : (e && e.message) || "网络错误";
        throw new Error(msg);
      });
  }

  /* ---------- 日期下拉（用户明确要求：下拉展开，收起时就要显示年月日） ---------- */
  /* 本地时区（GMT+8）的今天。
     ⚠ 不用 toISOString()：那是 UTC，凌晨 00:00–08:00 会把日期算成前一天，
       表现为「默认日期比实际少一天」—— 服务端的 /api/health 也刻意避开了这个写法。 */
  function localToday() {
    try {
      var p = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai", year: "numeric", month: "2-digit", day: "2-digit"
      }).formatToParts(new Date());
      var o = {};
      p.forEach(function (x) { o[x.type] = x.value; });
      return o.year + "-" + o.month + "-" + o.day;
    } catch (e) {
      var d = new Date();
      var pad = function (n) { return String(n).padStart(2, "0"); };
      return d.getFullYear() + "-" + pad(d.getMonth() + 1) + "-" + pad(d.getDate());
    }
  }

  function fillDates(today, dates) {
    if (!elDate) return;
    var list = [];
    if (today) list.push(today);
    (dates || []).forEach(function (d) { if (list.indexOf(d) === -1) list.push(d); });
    if (!list.length) list.push(localToday());
    elDate.innerHTML = list
      .map(function (d) { return '<option value="' + esc(d) + '">' + esc(d) + "</option>"; })
      .join("");
    elDate.value = list[0];
  }

  /* ---------- 状态徽标渲染 ---------- */
  var MARK = {
    pending: "○",
    running: "◌",
    done: "✓",
    skip: "–",
    warn: "!",
    error: "✕",
  };
  function renderSteps(job) {
    if (!elSteps) return;
    if (!job || !job.steps) { elSteps.innerHTML = ""; return; }
    elSteps.innerHTML = job.steps
      .map(function (s) {
        var detail = s.detail ? '<span class="genx-step__detail">' + esc(s.detail) + "</span>" : "";
        var ms = s.ms ? '<span class="genx-step__ms">' + (s.ms / 1000).toFixed(1) + "s</span>" : "";
        return (
          '<li class="genx-step" data-state="' + esc(s.status) + '">' +
          '<span class="genx-step__mark" aria-hidden="true">' + (MARK[s.status] || "○") + "</span>" +
          '<span class="genx-step__label">' + esc(s.label) + "</span>" +
          detail + ms +
          "</li>"
        );
      })
      .join("");
  }

  function lvBadge(lv) {
    return '<span class="genx-lv genx-lv--' + esc(lv) + '">' + esc(lv) + "</span>";
  }

  function renderResult(job) {
    if (!elResult) return;
    var r = job.result || {};
    var isDraft = r.mode === "draft";
    var dlPptx = API + "/api/download?date=" + encodeURIComponent(r.date) + "&kind=pptx" + (isDraft ? "&draft=1" : "");
    var dlMd = API + "/api/download?date=" + encodeURIComponent(r.date) + "&kind=md" + (isDraft ? "&draft=1" : "");

    var warnHtml = (job.warnings || []).length
      ? '<ul class="genx-warn">' + job.warnings.map(function (w) { return "<li>" + esc(w) + "</li>"; }).join("") + "</ul>"
      : "";

    elResult.innerHTML =
      '<div class="genx-result__top">' +
        '<span class="genx-chip genx-chip--' + (isDraft ? "warn" : "ok") + '">' +
          (isDraft ? "机器草稿" : "Agent 选稿") +
        "</span>" +
        '<span class="genx-result__meta">' +
          esc(r.date) + " · " + (r.pages != null ? r.pages + " 页" : "页数未知") + " · " + esc(fmtSize(r.pptx && r.pptx.bytes)) +
        "</span>" +
      "</div>" +
      '<p class="genx-result__note">' +
        (isDraft
          ? "这次没有 Agent 选稿，走的是机器草稿：条目由机器按「时效 + 分类」直出，<strong>没有写点评、没有核验一手来源、没有查重</strong>，PPT 封面与每一页页脚都打了「机器草稿」标记。"
          : "这次用的是 Agent 写好的选稿（brief.json），置信度经过 A/B/C/D 分级，渲染前已过业务规则校验。") +
      "</p>" +
      warnHtml +
      '<div class="genx-downloads">' +
        '<a class="btn btn--primary btn--sm" href="' + esc(dlPptx) + '">下载 PPTX</a>' +
        '<a class="btn btn--secondary btn--sm" href="' + esc(dlMd) + '">下载 Markdown</a>' +
        '<span class="genx-result__file">' + esc(r.pptx && r.pptx.name || "") + "</span>" +
      "</div>" +
      '<div class="genx-picks" data-gen-picks></div>';

    renderPicks(r.date);
  }

  /* 从 /api/brief 拉这次选中的条目，让「生成完了」这件事有内容可看 */
  function renderPicks(date) {
    var box = elResult && elResult.querySelector("[data-gen-picks]");
    if (!box) return;
    call("/api/brief?date=" + encodeURIComponent(date))
      .then(function (res) {
        if (!res.ok || !res.data || !res.data.picks) {
          box.innerHTML = "";
          return;
        }
        var picks = res.data.picks;
        box.innerHTML =
          '<div class="genx-picks__head">本次选中 ' + picks.length + " 条 · " +
          (res.data.draft ? "机器草稿" : "Agent 选稿") + "</div>" +
          '<ul class="genx-picks__list">' +
          picks
            .map(function (p) {
              return (
                "<li>" + lvBadge(p.lv) +
                '<span class="genx-picks__topic">' + esc(p.topic) + "</span>" +
                '<span class="genx-picks__title">' + esc(p.title) + "</span></li>"
              );
            })
            .join("") +
          "</ul>";
      })
      .catch(function () { box.innerHTML = ""; });
  }

  /* ---------- 生成流程 ---------- */
  var polling = false;

  function busy(on) {
    if (elGo) {
      elGo.disabled = !!on;
      elGo.setAttribute("aria-busy", on ? "true" : "false");
    }
    if (elGoLabel) elGoLabel.textContent = on ? "正在生成…" : "立即生成今日早报";
  }

  function generate() {
    if (polling) return;
    var date = elDate ? elDate.value : null;
    var mode = elMode ? elMode.value : "auto";
    var noFetch = elNoFetch && elNoFetch.checked;

    polling = true;
    busy(true);
    if (elPanel) elPanel.hidden = false;
    if (elResult) elResult.innerHTML = "";
    renderSteps(null);
    setStatus("busy", "正在生成…");
    setHint("已提交任务，正在执行四步流水线。这一步是真实运行，不要关页面。", "busy");

    call("/api/generate", { method: "POST", body: { date: date, mode: mode, noFetch: noFetch, force: true } })
      .then(function (res) {
        if (!res.ok || !res.data || !res.data.jobId) {
          throw new Error((res.data && res.data.error) || "服务返回 " + res.status);
        }
        return poll(res.data.jobId, 0);
      })
      .catch(function (e) {
        polling = false;
        busy(false);
        setStatus("error", "生成失败");
        var msg = String(e && e.message ? e.message : e);
        if (/Failed to fetch|NetworkError|Load failed|网络错误|请求超时/.test(msg)) {
          setHint(startHelpHtml(msg), "error");
        } else {
          setHint("<strong>生成失败：</strong>" + esc(msg), "error");
        }
      });
  }

  function poll(jobId, n) {
    if (n > POLL_LIMIT) throw new Error("等待超时（服务仍在跑，可稍后刷新看结果）");
    return call("/api/jobs/" + encodeURIComponent(jobId)).then(function (res) {
      var job = res.data && res.data.job;
      if (!job) throw new Error("取不到任务状态");
      renderSteps(job);
      if (job.status === "done") return finish(job);
      if (job.status === "error") return failed(job);
      setStatus("busy", job.phase || "生成中…");
      return new Promise(function (r) { window.setTimeout(r, POLL_EVERY); }).then(function () {
        return poll(jobId, n + 1);
      });
    });
  }

  function finish(job) {
    polling = false;
    busy(false);
    var isDraft = job.result && job.result.mode === "draft";
    setStatus(isDraft ? "warn" : "ok", isDraft ? "完成（机器草稿）" : "完成（Agent 选稿）");
    setHint(
      isDraft
        ? "已产出 PPTX 与 Markdown，但这次是<strong>机器草稿</strong>：只代表「有哪些报道」，不代表「已经核实」。"
        : "已产出 PPTX 与 Markdown，选稿来自 Agent 的判断。",
      isDraft ? "warn" : "ok"
    );
    renderResult(job);
    revealConsole();
  }

  /* 生成结束后把控制台带回视野。
     ⚠ 不要用 elResult.scrollIntoView({block:'nearest'})：当结果块比视口还高时，
       'nearest' 会对齐它的**下边缘**，于是页面一路滚到面板底部 —— 进度四步和
       标题全被顶出屏幕，用户刚点的按钮反而看不见了。这里改成对齐控制台顶部，
       并且只在它已经滚出视野时才动，避免把正在看别处的用户拽走。 */
  function revealConsole() {
    var r = root.getBoundingClientRect();
    var out = r.top < 0 || r.bottom > window.innerHeight;
    if (!out) return;
    var html = document.documentElement;
    var prev = html.style.scrollBehavior;
    // 站内 html 设了 scroll-behavior:smooth，直接用 scrollTo 也能滚，
    // 但自动化截图（无头 + virtual-time）下平滑动画走不完，故临时改成 auto。
    var instant = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (instant) html.style.scrollBehavior = "auto";
    window.scrollTo({ top: window.scrollY + r.top - 80, behavior: instant ? "auto" : "smooth" });
    if (instant) html.style.scrollBehavior = prev;
  }

  function failed(job) {
    polling = false;
    busy(false);
    setStatus("error", job.phase || "生成失败");
    setHint(
      "<strong>" + esc(job.phase || "生成失败") + "：</strong><br><code class=\"genx-err\">" +
      esc(job.error || "服务未给出原因") + "</code>",
      "error"
    );
    renderSteps(job);
  }

  /* ---------- 首屏：探服务 + 铺日期 ---------- */
  function boot() {
    setStatus("idle", "正在检查生成服务…");
    return call("/api/health")
      .then(function (res) {
        if (!res.ok || !res.data || !res.data.ok) throw new Error("服务返回 " + res.status);
        var h = res.data;
        var st = h.todayState || {};
        setStatus("ok", "生成服务在线 · v" + h.version);
        var state = st.hasBrief
          ? "今天已有 Agent 选稿，默认会用它。"
          : st.hasNews
            ? "今天只有抓取数据，还没有 Agent 选稿 —— 直接生成会走「机器草稿」。"
            : "今天还没抓过数据，点按钮会先抓一遍。";
        setHint(
          "服务在线（<code>" + esc(API) + "</code>），默认日期 " + esc(h.today) + "。" + state +
          "<br>生成过程真实执行抓取与渲染，通常十几秒到半分钟。",
          st.hasBrief ? "ok" : "warn"
        );
        return call("/api/history").then(function (hr) {
          var dates = (hr.data && hr.data.items ? hr.data.items : []).map(function (x) { return x.date; });
          fillDates(h.today, dates);
        });
      })
      .catch(function (e) {
        setStatus("error", "生成服务未启动");
        setHint(startHelpHtml(e && e.message ? e.message : "连接失败"), "error");
        fillDates(null, []);
      });
  }

  if (elGo) elGo.addEventListener("click", generate);
  if (elNoFetch) {
    elNoFetch.addEventListener("change", function () {
      if (!elGo || polling) return;
      // 勾了「跳过抓取」后，服务在线的前提下就没有外部依赖了，提示同步改一下
      if (elNoFetch.checked) setHint("已勾选「跳过抓取」：将复用今天已有的抓取结果，只重跑选稿与渲染。", "ok");
      else boot();
    });
  }

  /* 深链：?autogen=1 打开即生成一次；再加 &nofetch=1 则跳过抓取（复用已有数据）。
     用途是自动化验证与「从别处一键生成」的入口 —— 不用手点，也就意味着
     验证脚本可以真的把这条链路跑通，而不是只检查 DOM 里有没有按钮。 */
  var AUTOGEN = false;
  try {
    var qs = new URLSearchParams(location.search);
    AUTOGEN = qs.get("autogen") === "1";
    if (qs.get("nofetch") === "1" && elNoFetch) elNoFetch.checked = true;
  } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", onReady);
  } else {
    onReady();
  }

  function onReady() {
    boot().then(function () {
      if (AUTOGEN) generate();
    });
  }
})();
