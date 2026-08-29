/* ============================================================
 * LVR Ranking Engine (pure functions, no DOM dependency)
 *
 * Value = f(Intelligence) x Speed^0.8 / BlendedPrice
 *
 * BlendedPrice = (0.7*input + 0.3*output) USD/M  -> CNY / 100M tokens
 * f(x) with dataset mean u:
 *   x >= u : f(x) = (u + (x-u)^2)^2          (quartic boost above average)
 *   x <  u : f(x) = (u - (u-x)^2)^2          (exclude when inner <= 0)
 * Models with raw intelligence < 25 are excluded.
 * Final scores are normalized so the #1 model = 100.
 * ============================================================ */
(function () {
  const LVR = window.LVR || (window.LVR = {});

  const MIN_INTELLIGENCE = 25;

  function blendedPriceCNY100M(model, weights, usdCny) {
    const usdPerM = weights.input * model.priceInput + weights.output * model.priceOutput;
    return usdPerM * usdCny * 100;
  }

  function fTransform(x, mean) {
    if (x >= mean) {
      const d = x - mean;
      return Math.pow(mean + d * d, 2);
    }
    const inner = mean - Math.pow(mean - x, 2);
    return inner <= 0 ? null : inner * inner;
  }

  function rank(models, weights, usdCny) {
    const excluded = [];
    const eligible = [];
    for (const m of models) {
      if (m.intelligence < MIN_INTELLIGENCE) {
        excluded.push({ model: m, reason: '原始能力分 < ' + MIN_INTELLIGENCE,
          price: blendedPriceCNY100M(m, weights, usdCny) });
      } else {
        eligible.push(m);
      }
    }
    const mean =
      eligible.reduce((s, m) => s + m.intelligence, 0) / Math.max(eligible.length, 1);

    const rows = [];
    for (const model of eligible) {
      const price = blendedPriceCNY100M(model, weights, usdCny);
      const f = fTransform(model.intelligence, mean);
      if (f === null) {
        excluded.push({ model, reason: '低于均分且 f(x) 变换 ≤ 0', price });
        continue;
      }
      const raw = (f * Math.pow(model.speed, 0.8)) / price;
      rows.push({ model, f, price, raw });
    }

    rows.sort((a, b) => b.raw - a.raw);
    const max = rows.length ? rows[0].raw : 1;
    rows.forEach((r, i) => {
      r.rank = i + 1;
      r.value = (100 * r.raw) / max;
    });
    return { rows, excluded, mean, total: models.length, ranked: rows.length };
  }

  /* Pareto frontier over (blended price, intelligence):
   * sweep by ascending price, keep strictly higher intelligence points. */
  function paretoFrontier(rows) {
    const sorted = rows.slice().sort((a, b) => a.price - b.price);
    const frontier = [];
    let best = -Infinity;
    for (const r of sorted) {
      if (r.model.intelligence > best) {
        frontier.push(r);
        best = r.model.intelligence;
      }
    }
    return frontier;
  }

  LVR.ranking = {
    MIN_INTELLIGENCE,
    blendedPriceCNY100M,
    fTransform,
    rank,
    paretoFrontier
  };
  window.LVR = LVR;
})();
