/* ============================================================
 * LVR App - rendering pipeline & interactions
 * Public API:
 *   LVR.init(containerEl, { data })  -> mount the whole widget
 * All DOM is generated at runtime; no server / fetch required.
 * ============================================================ */
(function () {
  const LVR = window.LVR || (window.LVR = {});

  function esc(s) {
    return String(s).replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
  }
  function fmtPrice(v) {
    if (v >= 100) return '¥' + v.toFixed(0) + '/亿';
    if (v >= 10) return '¥' + v.toFixed(1) + '/亿';
    return '¥' + v.toFixed(2) + '/亿';
  }
  function fmtSpeed(v) { return Math.round(v) + ' tok/s'; }

  function init(container, opts) {
    opts = opts || {};
    const data = opts.data || window.LVR_DATA;
    const { rows, excluded, mean, total, ranked } = LVR.ranking.rank(
      data.models, data.blendWeights, data.usdCny
    );
    const frontier = LVR.ranking.paretoFrontier(rows);

    if (!rows.length) {
      container.innerHTML =
        '<div class="lvr-root"><p class="lvr-empty">暂无可排名模型：检查数据是否提供能力分与价格。</p></div>';
      return;
    }

    container.innerHTML = `
      <div class="lvr-root">
        <header class="lvr-header">
          <div>
            <h2 class="lvr-title">LLM Value Ranking <span class="lvr-lite">Lite</span></h2>
            <p class="lvr-sub">性价比 = f(能力) × 速度<sup>0.8</sup> / 价格 · 数据快照 ${esc(data.updatedAt)}</p>
          </div>
          <div class="lvr-stats">
            <div class="lvr-stat"><span class="lvr-stat-v">${total}</span><span class="lvr-stat-l">收录模型</span></div>
            <div class="lvr-stat"><span class="lvr-stat-v">${ranked}</span><span class="lvr-stat-l">参与排名</span></div>
            <div class="lvr-stat"><span class="lvr-stat-v">${mean.toFixed(1)}</span><span class="lvr-stat-l">能力均分</span></div>
          </div>
        </header>

        <section class="lvr-podium" id="lvr-podium" aria-label="性价比 Top 3"></section>

        <section class="lvr-chart-outer">
          <h3 class="lvr-section-title">能力 × 价格 帕累托前沿</h3>
          <div class="lvr-chart-wrap" id="lvr-chart"></div>
        </section>

        <section class="lvr-method">
          <h3 class="lvr-section-title">能力分是怎么算的？</h3>
          <div class="lvr-method-grid">
            <div class="lvr-method-card">
              <strong>① 能力指数（外部权威来源）</strong>
              <p>采用 <a href="https://artificialanalysis.ai/evaluations/artificial-analysis-intelligence-index" target="_blank" rel="noopener noreferrer">Artificial Analysis Intelligence Index v4</a>：
              9 项评测（GDPval-AA v2、τ³-Banking、Terminal-Bench v2.1、SciCode、Humanity's Last Exam、GPQA Diamond、CritPt、AA-Omniscience、AA-LCR）的加权平均，
              智能体 / 编码 / 通用 / 科学推理四大领域各占 25%，0–100 分制。本页不自行打分，只引用并可溯源。</p>
            </div>
            <div class="lvr-method-card">
              <strong>② 性价比变换（本页算法）</strong>
              <p>混合价 = (0.7×输入 + 0.3×输出)，按 1 USD = ${data.usdCny} CNY 折算；
              性价比 = f(能力) × 速度<sup>0.8</sup> / 混合价，其中 f(x) 以参排均分 μ=${mean.toFixed(1)} 为中心：
              x≥μ 时 (μ+(x−μ)²)²，x&lt;μ 时 (μ−(μ−x)²)²（内层 ≤0 剔除）；原始能力分 &lt; 25 不参排；榜首归一化为 100。
              被剔除的模型在图中以空心点展示。</p>
            </div>
          </div>
        </section>

        <section class="lvr-table-outer">
          <div class="lvr-toolbar">
            <h3 class="lvr-section-title">完整排行榜</h3>
            <input id="lvr-search" class="lvr-search" type="search" placeholder="搜索模型 / 厂商..." aria-label="搜索模型">
            <span class="lvr-count" id="lvr-count"></span>
          </div>
          <div class="lvr-table-scroll">
            <table class="lvr-table">
              <thead>
                <tr>
                  <th>#</th><th>模型</th><th>厂商</th><th>能力</th>
                  <th>速度</th><th>混合价 (亿)</th><th>性价比</th><th></th>
                </tr>
              </thead>
              <tbody id="lvr-tbody"></tbody>
            </table>
          </div>
        </section>

        <footer class="lvr-footer">
          <p>能力分与速度来自 <a href="https://artificialanalysis.ai/models" target="_blank" rel="noopener noreferrer">Artificial Analysis</a>（标注 AA-LIVE 的为 2026-08-28 实时抓取，AA-SNAPSHOT 为 2026-08-27 榜单快照）；
          价格为各厂商官方挂牌价，详见每个模型的详情弹窗。</p>
        </footer>

        <div class="lvr-modal" id="lvr-modal" role="dialog" aria-modal="true" hidden>
          <div class="lvr-modal-overlay" data-close></div>
          <div class="lvr-modal-card">
            <button class="lvr-modal-close" data-close aria-label="关闭">×</button>
            <div class="lvr-modal-body" id="lvr-modal-body"></div>
          </div>
        </div>
      </div>`;

    const $ = (id) => container.querySelector(id);

    renderPodium($('#lvr-podium'), rows.slice(0, 3), openModal);
    LVR.chart.renderChart($('#lvr-chart'), rows, frontier, (r) => openModal(r), excluded);
    renderTable($('#lvr-tbody'), rows, openModal);
    $('#lvr-count').textContent = `共 ${rows.length} 个`;

    $('#lvr-search').addEventListener('input', (e) => {
      const q = e.target.value.trim().toLowerCase();
      const list = q
        ? rows.filter((r) =>
            (r.model.name + r.model.provider + r.model.id).toLowerCase().includes(q))
        : rows;
      renderTable($('#lvr-tbody'), list, openModal);
      $('#lvr-count').textContent = `共 ${list.length} 个`;
    });

    const modal = $('#lvr-modal');
    let lastFocus = null;
    modal.addEventListener('click', (e) => {
      if (e.target.dataset.close !== undefined) closeModal();
    });
    modal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.hidden) { closeModal(); return; }
      if (e.key !== 'Tab' || modal.hidden) return;
      const focusables = modal.querySelectorAll('a[href], button');
      if (!focusables.length) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    });

    function closeModal() {
      modal.hidden = true;
      if (lastFocus && lastFocus.focus) lastFocus.focus();
      lastFocus = null;
    }

    function openModal(r) {
      const m = r.model;
      $('#lvr-modal-body').innerHTML = `
        <div class="lvr-modal-head">
          <span class="lvr-badge">${esc(m.provider)}</span>
          <h3>${esc(m.name)} <span class="lvr-modal-rank">#${r.rank}</span></h3>
        </div>
        <div class="lvr-modal-metrics">
          <div><b>${r.value.toFixed(1)}</b><span>性价比</span></div>
          <div><b>${m.intelligence}</b><span>能力指数</span></div>
          <div><b>${fmtSpeed(m.speed)}</b><span>输出速度</span></div>
          <div><b>${fmtPrice(r.price)}</b><span>混合价格</span></div>
        </div>
        <p class="lvr-modal-desc">${esc(m.desc)}</p>
        <table class="lvr-modal-price">
          <tr><td>输入价格</td><td>$${m.priceInput.toFixed(2)} / M tokens（≈ ¥${(m.priceInput * data.usdCny).toFixed(2)}）</td></tr>
          <tr><td>输出价格</td><td>$${m.priceOutput.toFixed(2)} / M tokens（≈ ¥${(m.priceOutput * data.usdCny).toFixed(2)}）</td></tr>
          <tr><td>价格来源</td><td>${esc(m.priceSource)}</td></tr>
          <tr><td>能力分来源</td><td>${m.scoreSource === 'AA-SNAPSHOT'
            ? 'AA 榜单快照 (2026-08-27)'
            : 'AA 模型页实时抓取 (2026-08-28)'}</td></tr>
          ${m.estimated ? '<tr><td>备注</td><td>能力分 / 速度为榜单快照估计值</td></tr>' : ''}
        </table>
        <div class="lvr-modal-actions">
          <a class="lvr-btn lvr-btn-primary" href="${esc(m.apiKeyUrl)}" target="_blank" rel="noopener noreferrer">获取官方 API Key →</a>
          <a class="lvr-btn" href="${esc(m.officialUrl)}" target="_blank" rel="noopener noreferrer">官方网站</a>
          <a class="lvr-btn" href="${esc(m.docsUrl)}" target="_blank" rel="noopener noreferrer">API 文档</a>
        </div>`;
      lastFocus = document.activeElement;
      modal.hidden = false;
      modal.querySelector('.lvr-modal-close').focus();
    }
  }

  function renderPodium(el, top3, onPick) {
    el.innerHTML = top3.map((r) => `
      <button type="button" class="lvr-podium-card lvr-place-${r.rank}" data-model-id="${esc(r.model.id)}">
        <span class="lvr-medal">#${r.rank}</span>
        <span class="lvr-podium-name">${esc(r.model.name)}</span>
        <span class="lvr-podium-provider">${esc(r.model.provider)}</span>
        <span class="lvr-podium-metrics">
          <span>能力 ${r.model.intelligence}</span>
          <span>${fmtSpeed(r.model.speed)}</span>
          <span>${fmtPrice(r.price)}</span>
        </span>
        <span class="lvr-podium-value">性价比 ${r.value.toFixed(1)}</span>
      </button>`).join('');
    const byId = {};
    top3.forEach((r) => { byId[r.model.id] = r; });
    el.addEventListener('click', (e) => {
      const card = e.target.closest('.lvr-podium-card');
      if (card) onPick(byId[card.dataset.modelId]);
    });
  }

  function renderTable(tbody, list, onPick) {
    tbody.innerHTML = list.map((r) => {
      const rankCls = r.rank <= 3 ? ` lvr-rank-${r.rank}` : '';
      return `
      <tr>
        <td><span class="lvr-rank${rankCls}">${r.rank}</span></td>
        <td>
          <span class="lvr-model-name">${esc(r.model.name)}${r.model.estimated ? ' <em class="lvr-est" title="能力分/速度为估计值">*</em>' : ''}</span>
          <span class="lvr-model-id">${esc(r.model.id)}</span>
        </td>
        <td><span class="lvr-badge">${esc(r.model.provider)}</span></td>
        <td>${r.model.intelligence}</td>
        <td>${fmtSpeed(r.model.speed)}</td>
        <td>${fmtPrice(r.price)}</td>
        <td>
          <span class="lvr-value">${r.value.toFixed(1)}</span>
          <span class="lvr-bar"><span class="lvr-bar-fill" style="width:${Math.max(1.5, r.value).toFixed(1)}%"></span></span>
        </td>
        <td><button type="button" class="lvr-btn lvr-btn-sm" data-model-id="${esc(r.model.id)}">详情</button></td>
      </tr>`;
    }).join('');
    const byId = {};
    list.forEach((r) => { byId[r.model.id] = r; });
    tbody.querySelectorAll('.lvr-btn').forEach((btn) => {
      btn.addEventListener('click', () => onPick(byId[btn.dataset.modelId]));
    });
  }

  LVR.init = init;
  window.LVR = LVR;
})();
