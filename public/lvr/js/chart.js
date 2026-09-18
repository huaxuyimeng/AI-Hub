/* ============================================================
 * LVR Pareto Chart - self-contained SVG renderer (no libraries)
 * X axis: blended price (log scale)   Y axis: intelligence
 * v2: frontier name labels, legend, hollow dots for excluded
 *     models, tighter axis padding (no right-edge clipping).
 * ============================================================ */
(function () {
  const LVR = window.LVR || (window.LVR = {});

  const W = 760, H = 400;
  const M = { l: 58, r: 26, t: 30, b: 46 };
  const MEDAL = ['#f59e0b', '#9ca3af', '#b45309'];

  function fmtPrice(v) {
    if (v >= 100) return '¥' + v.toFixed(0) + '/亿';
    if (v >= 10) return '¥' + v.toFixed(1) + '/亿';
    return '¥' + v.toFixed(2) + '/亿';
  }

  function esc(s) {
    return String(s).replace(/[&<>'"]/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
    }[c]));
  }

  function shortName(name) {
    return name.length > 14 ? name.slice(0, 13) + '…' : name;
  }

  function renderChart(container, rows, frontier, onPick, excluded) {
    excluded = excluded || [];
    if (!rows.length) {
      container.innerHTML = '<p class="lvr-empty">暂无可绘图数据</p>';
      return;
    }
    const all = rows.concat(excluded);
    /* Fix #B3: intelligence / price 为负数或 NaN 时过滤掉（防止坐标 NaN） */
    const validRows = rows.filter((r) =>
      typeof r.model.intelligence === 'number' && isFinite(r.model.intelligence) &&
      typeof r.price === 'number' && isFinite(r.price) && r.price > 0
    );
    const validEx = excluded.filter((ex) =>
      typeof ex.model.intelligence === 'number' && isFinite(ex.model.intelligence) &&
      typeof ex.price === 'number' && isFinite(ex.price) && ex.price > 0
    );
    const validAll = validRows.concat(validEx);
    const prices = validAll.map((r) => r.price);
    const intels = validAll.map((r) => r.model.intelligence);
    if (!prices.length || !validRows.length) {
      container.innerHTML = '<p class="lvr-empty">价格数据异常，无法绘制对数轴</p>';
      return;
    }
    let lo = Math.log10(Math.min.apply(null, prices));
    let hi = Math.log10(Math.max.apply(null, prices));
    /* Fix #B4: lo === hi 时（所有价格相同）扩展范围防止 /0 */
    if (lo === hi) { lo -= 0.5; hi += 0.5; }
    lo -= 0.06;
    hi += 0.06;
    const iMin = Math.floor(Math.min.apply(null, intels) - 4);
    const iMax = Math.ceil(Math.max.apply(null, intels) + 4);

    const x = (p) => M.l + ((Math.log10(p) - lo) / (hi - lo)) * (W - M.l - M.r);
    const y = (v) => M.t + ((iMax - v) / (iMax - iMin)) * (H - M.t - M.b);

    const parts = [];
    parts.push(
      `<svg class="lvr-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="能力-价格帕累托前沿图">`
    );

    /* grid + y ticks */
    const yStep = Math.max(2, Math.round((iMax - iMin) / 6 / 2) * 2);
    for (let v = Math.ceil(iMin / yStep) * yStep; v <= iMax; v += yStep) {
      const yy = y(v).toFixed(1);
      parts.push(`<line class="lvr-grid" x1="${M.l}" y1="${yy}" x2="${W - M.r}" y2="${yy}"/>`);
      parts.push(`<text class="lvr-tick" x="${M.l - 8}" y="${+yy + 4}" text-anchor="end">${v}</text>`);
    }
    /* x ticks: 5 log-spaced */
    for (let i = 0; i < 5; i++) {
      const p = Math.pow(10, lo + ((hi - lo) * i) / 4);
      const xx = x(p).toFixed(1);
      parts.push(`<line class="lvr-grid" x1="${xx}" y1="${M.t}" x2="${xx}" y2="${H - M.b}"/>`);
      parts.push(
        `<text class="lvr-tick" x="${xx}" y="${H - M.b + 18}" text-anchor="middle">${fmtPrice(p)}</text>`
      );
    }
    /* axes */
    parts.push(`<line class="lvr-axis" x1="${M.l}" y1="${H - M.b}" x2="${W - M.r}" y2="${H - M.b}"/>`);
    parts.push(`<line class="lvr-axis" x1="${M.l}" y1="${M.t}" x2="${M.l}" y2="${H - M.b}"/>`);

    /* frontier path */
    const fSorted = frontier.slice().sort((a, b) => a.price - b.price);
    if (fSorted.length > 1) {
      const d = fSorted.map((r, i) =>
        `${i ? 'L' : 'M'} ${x(r.price).toFixed(1)} ${y(r.model.intelligence).toFixed(1)}`
      ).join(' ');
      parts.push(`<path class="lvr-frontier" d="${d}"/>`);
    }

    /* excluded models: hollow dots (not ranked) */
    for (const ex of excluded) {
      const cx = x(ex.price).toFixed(1);
      const cy = y(ex.model.intelligence).toFixed(1);
      parts.push(
        `<g class="lvr-pt lvr-pt-excluded" data-model-id="${esc(ex.model.id)}" data-reason="${esc(ex.reason)}" tabindex="0" role="button"` +
        ` aria-label="${esc(ex.model.name)}（未排名）">` +
        `<circle class="lvr-pt-hit" cx="${cx}" cy="${cy}" r="12" fill="transparent"/>` +
        `<circle cx="${cx}" cy="${cy}" r="4" fill="#fff" stroke="#cbd5e1" stroke-width="1.5" stroke-dasharray="2 2"/>` +
        `</g>`
      );
    }

    /* ranked points */
    const frontierIds = new Set(fSorted.map((r) => r.model.id));
    for (const r of rows) {
      const cx = x(r.price).toFixed(1);
      const cy = y(r.model.intelligence).toFixed(1);
      const isTop3 = r.rank <= 3;
      const onFrontier = frontierIds.has(r.model.id);
      const fill = isTop3 ? MEDAL[r.rank - 1] : onFrontier ? '#38bdf8' : 'rgba(148,163,184,.6)';
      const rad = isTop3 ? 6.5 : onFrontier ? 5 : 3.5;
      parts.push(
        `<g class="lvr-pt" data-model-id="${esc(r.model.id)}" tabindex="0" role="button"` +
        ` aria-label="#${r.rank} ${esc(r.model.name)}">` +
        `<circle class="lvr-pt-hit" cx="${cx}" cy="${cy}" r="12" fill="transparent"/>` +
        `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="${fill}"/>` +
        (isTop3
          ? `<text class="lvr-pt-num" x="${cx}" y="${cy - 11}" text-anchor="middle">${r.rank}</text>`
          : '') +
        `</g>`
      );
    }

    /* frontier name labels (flip anchor near right edge) */
    for (const r of fSorted) {
      const px = x(r.price);
      const py = y(r.model.intelligence);
      const flip = px > W - 150;
      parts.push(
        `<text class="lvr-pt-label" x="${(px + (flip ? -10 : 10)).toFixed(1)}" y="${(py - 8).toFixed(1)}" text-anchor="${flip ? 'end' : 'start'}">${esc(shortName(r.model.name))}</text>`
      );
    }

    /* axis titles + corner hint */
    parts.push(`<text class="lvr-axis-title" x="${(M.l + W - M.r) / 2}" y="${H - 6}" text-anchor="middle">混合价格 (¥/亿 tokens，对数轴)</text>`);
    parts.push(`<text class="lvr-axis-title" x="16" y="${(M.t + H - M.b) / 2}" text-anchor="middle" transform="rotate(-90 16 ${(M.t + H - M.b) / 2})">AA 能力指数</text>`);
    parts.push(`<text class="lvr-corner-hint" x="${M.l + 8}" y="${M.t + 14}">左上更优 ↑</text>`);
    parts.push('</svg>');

    container.innerHTML = parts.join('');

    /* Fix #B7: 清理旧的 tooltip/legend（避免重复 DOM 元素） */
    const wrap = container.parentElement;
    const oldTip = wrap.querySelector('.lvr-tooltip');
    if (oldTip) oldTip.remove();
    const oldLegend = wrap.querySelector('.lvr-legend');
    if (oldLegend) oldLegend.remove();

    /* legend (HTML, above the svg) */
    const legend = document.createElement('div');
    legend.className = 'lvr-legend';
    wrap.insertBefore(legend, container);
    legend.innerHTML =
      `<span><i class="lg-line"></i>帕累托前沿</span>` +
      `<span><i class="lg-dot" style="background:#f59e0b"></i>Top 3</span>` +
      `<span><i class="lg-dot" style="background:#38bdf8"></i>前沿模型</span>` +
      `<span><i class="lg-dot" style="background:rgba(148,163,184,.6)"></i>其他参排</span>` +
      `<span><i class="lg-dot lg-hollow"></i>未排名 (${validEx.length})</span>`;

    /* tooltip + click, event delegation（一次性绑定，不重复） */
    const tip = document.createElement('div');
    tip.className = 'lvr-tooltip';
    tip.hidden = true;
    wrap.appendChild(tip);
    const byId = {};
    validRows.forEach((r) => { byId[r.model.id] = r; });
    const exById = {};
    validEx.forEach((ex) => { exById[ex.model.id] = ex; });

    container.addEventListener('mouseover', (e) => {
      const g = e.target.closest('.lvr-pt');
      if (!g) return;
      const id = g.dataset.modelId;
      if (byId[id]) {
        const r = byId[id];
        tip.innerHTML =
          `<strong>#${r.rank} ${esc(r.model.name)}</strong><br>` +
          `能力 ${r.model.intelligence} · ${Math.round(r.model.speed)} tok/s<br>` +
          `混合价 ${fmtPrice(r.price)} · 性价比 ${r.value.toFixed(1)}`;
      } else if (exById[id]) {
        const ex = exById[id];
        tip.innerHTML =
          `<strong>${esc(ex.model.name)}</strong>（未排名）<br>` +
          `能力 ${ex.model.intelligence} · ${fmtPrice(ex.price)}<br>` +
          `原因：${esc(ex.reason)}`;
      } else return;
      tip.hidden = false;
    });
    container.addEventListener('mousemove', (e) => {
      if (tip.hidden) return;
      const box = wrap.getBoundingClientRect();
      tip.style.left = Math.min(Math.max(4, e.clientX - box.left + 14), box.width - 200) + 'px';
      tip.style.top = (e.clientY - box.top + 14) + 'px';
    });
    container.addEventListener('mouseout', (e) => {
      if (e.target.closest('.lvr-pt')) tip.hidden = true;
    });
    container.addEventListener('click', (e) => {
      const g = e.target.closest('.lvr-pt');
      if (g && onPick && byId[g.dataset.modelId]) onPick(byId[g.dataset.modelId]);
    });
    container.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const g = e.target.closest('.lvr-pt');
      if (g && onPick && byId[g.dataset.modelId]) { e.preventDefault(); onPick(byId[g.dataset.modelId]); }
    });
  }

  LVR.chart = { renderChart };
  window.LVR = LVR;
})();
