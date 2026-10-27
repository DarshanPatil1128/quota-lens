(() => {
  const { $, $$, fmt, esc } = Kit;

  const STAGES = ['Discover', 'Qualify', 'Propose', 'Negotiate', 'Commit'];
  const DEFAULT_RATES = [10, 20, 40, 60, 85];
  const SLIP_FACTOR = [1, 0.8, 0.6, 0.4, 0.2]; // later stages slip less
  const STALE_DAYS = 45;
  const STAGE_COLORS = ['var(--c6)', 'var(--c4)', 'var(--c3)', 'var(--c1)', 'var(--c2)'];

  // ───────── Sample data ─────────
  function samplePipeline() {
    const r = Kit.rng(42);
    const accounts = ['Halcyon Health', 'Granite Mutual', 'Bluefin Logistics', 'Meridian Bank', 'Orchard Retail', 'Keystone Energy',
      'Summit Insurance', 'Larkspur Pharma', 'Ironwood Manufacturing', 'Cobalt Telecom', 'Riverbend University', 'Pinecrest County',
      'Atlas Freight', 'Sterling Credit Union', 'Evergreen Foods', 'Northstar Airlines', 'Beacon Media', 'Willow Health System',
      'Copperline Utilities', 'Redwood State Agency', 'Harbor Point Hotels', 'Quarry Lane Capital'];
    const products = ['Data platform', 'AI assistants', 'Automation suite', 'Security services', 'Hybrid cloud migration', 'Observability'];
    const owners = ['A. Rivera', 'J. Chen', 'M. Okafor', 'S. Patel', 'K. Novak'];
    const rows = [];
    for (let i = 0; i < 48; i++) {
      const stage = r.weighted([['Discover', 9], ['Qualify', 11], ['Propose', 12], ['Negotiate', 9], ['Commit', 7]]);
      const amount = Math.round(Math.min(650000, Math.max(15000, Math.exp(11.0 + r.normal() * 0.75))) / 1000) * 1000;
      const month = r.weighted([[10, 2], [11, 4], [12, 6], [1, 2]]);
      const year = month === 1 ? 2027 : 2026;
      const day = month === 10 ? r.int(28, 31) : r.int(1, 28);
      rows.push({
        deal_id: 'OPP-' + (1040 + i),
        deal: r.pick(products) + (r() < 0.4 ? ' expansion' : ''),
        account: r.pick(accounts),
        owner: r.pick(owners),
        stage,
        amount,
        close_date: `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`,
        days_in_stage: Math.round(Math.abs(r.normal()) * 28 + 4),
      });
    }
    return rows;
  }

  // ───────── State ─────────
  let raw = samplePipeline();
  let sortKey = 'swing', sortDir = -1;
  let runs = 10000;

  // Stage sliders
  const sliderBox = $('#stageSliders');
  sliderBox.innerHTML = STAGES.map((s, i) => `
    <div class="field">
      <div class="field__row"><label for="rate${i}">${s}</label><output for="rate${i}"></output></div>
      <input type="range" id="rate${i}" min="0" max="100" value="${DEFAULT_RATES[i]}" />
    </div>`).join('');
  Kit.bindOutputs(document, { stale: (v) => v + '%', slip: (v) => v + '%', ...Object.fromEntries(STAGES.map((_, i) => ['rate' + i, (v) => v + '%'])) });

  function normalize(rows) {
    const bad = [];
    const out = rows.map((d, i) => {
      const stageIdx = STAGES.findIndex((s) => s.toLowerCase() === String(d.stage || '').toLowerCase());
      const amount = Number(String(d.amount).replace(/[$,]/g, ''));
      if (stageIdx < 0 || !isFinite(amount)) bad.push(i + 2);
      return {
        id: d.deal_id || 'Row ' + (i + 2),
        deal: d.deal || d.name || d.opportunity || 'Untitled deal',
        account: d.account || '',
        owner: d.owner || 'Unassigned',
        stageIdx, stage: STAGES[stageIdx],
        amount: isFinite(amount) ? amount : 0,
        close: d.close_date || '',
        days: Number(d.days_in_stage) || 0,
      };
    }).filter((d) => d.stageIdx >= 0 && d.amount > 0);
    return { deals: out, bad };
  }

  function settings() {
    return {
      quota: Number($('#quota').value) || 0,
      closed: Number($('#closed').value) || 0,
      qend: $('#qend').value,
      rates: STAGES.map((_, i) => Number($('#rate' + i).value) / 100),
      stale: Number($('#stale').value) / 100,
      slip: Number($('#slip').value) / 100,
    };
  }

  // ───────── Simulation ─────────
  function simulate(deals, s) {
    const n = deals.length;
    const p = new Float64Array(n);
    deals.forEach((d, i) => {
      let win = s.rates[d.stageIdx];
      if (d.days > STALE_DAYS) win *= 1 - s.stale;
      const inQ = 1 - s.slip * SLIP_FACTOR[d.stageIdx];
      d.pWin = win;
      d.p = win * inQ;
      p[i] = d.p;
    });
    const totals = new Float64Array(runs);
    const won = new Uint32Array(n), wonHit = new Uint32Array(n);
    const flags = new Uint8Array(n);
    const rnd = Kit.rng(7);
    let hits = 0;
    for (let k = 0; k < runs; k++) {
      let t = s.closed;
      for (let i = 0; i < n; i++) {
        const w = rnd() < p[i];
        flags[i] = w;
        if (w) t += deals[i].amount;
      }
      totals[k] = t;
      const hit = t >= s.quota;
      if (hit) hits++;
      for (let i = 0; i < n; i++) if (flags[i]) { won[i]++; if (hit) wonHit[i]++; }
    }
    deals.forEach((d, i) => {
      const pHitWon = won[i] ? wonHit[i] / won[i] : 0;
      const lost = runs - won[i];
      const pHitLost = lost ? (hits - wonHit[i]) / lost : 0;
      d.swing = won[i] && lost ? pHitWon - pHitLost : 0;
      d.ev = d.p * d.amount;
    });
    const sorted = Array.from(totals).sort((a, b) => a - b);
    const q = (x) => sorted[Math.min(runs - 1, Math.floor(x * runs))];
    return { totals: sorted, pHit: hits / runs, p10: q(0.1), p20: q(0.2), p50: q(0.5), p90: q(0.9), mean: sorted.reduce((a, b) => a + b, 0) / runs };
  }

  // ───────── Render ─────────
  function render() {
    const s = settings();
    const { deals: all, bad } = normalize(raw);
    const inQ = all.filter((d) => !s.qend || !d.close || d.close <= s.qend);
    const nextQ = all.length - inQ.length;
    const res = simulate(inQ, s);

    const remaining = Math.max(0, s.quota - s.closed);
    const openAmt = inQ.reduce((a, d) => a + d.amount, 0);
    const cov = remaining ? openAmt / remaining : Infinity;

    $('#kHit').textContent = fmt.pct(res.pHit);
    $('#kHitHint').textContent = `of ${fmt.compact(s.quota)} quota`;
    $('#kP50').textContent = fmt.compact(res.p50);
    $('#kP50Hint').textContent = `${fmt.pct(res.p50 / s.quota)} of quota`;
    $('#kRange').textContent = res.p10 >= 1e6 ? `$${(res.p10 / 1e6).toFixed(1)}–${(res.p90 / 1e6).toFixed(1)}M` : `${fmt.compact(res.p10)}–${fmt.compact(res.p90)}`;
    $('#kCov').textContent = isFinite(cov) ? cov.toFixed(1) + '×' : '—';
    $('#kCovHint').textContent = `${fmt.compact(openAmt)} open vs ${fmt.compact(remaining)} to go`;
    $('#distSub').textContent = `${fmt.num(runs)} simulated quarters · ${inQ.length} deals closing this quarter${nextQ ? ` · ${nextQ} later excluded` : ''}`;
    $('#dataNote').textContent = bad.length ? `Skipped ${bad.length} row(s) with unknown stage or amount` : $('#dataNote').textContent;

    Kit.mount('#hist', (w) => Kit.svg.histogram({
      w, h: 270, values: res.totals, bins: Math.min(48, Math.floor(w / 14)), xfmt: fmt.compact,
      hi: (v) => v >= s.quota,
      markers: [
        { x: s.quota, label: 'Quota', dash: true },
        { x: res.p50, label: 'P50', color: 'var(--muted)' },
      ],
    }));

    // Narrative
    const top = [...inQ].sort((a, b) => b.swing - a.swing).slice(0, 3);
    const shortfall80 = Math.max(0, s.quota - res.p20);
    const verdict = res.pHit >= 0.8 ? 'You’re in strong shape' : res.pHit >= 0.5 ? 'It’s a coin flip leaning your way' : res.pHit >= 0.25 ? 'The number is at risk' : 'The number is unlikely without new pipeline';
    $('#story').innerHTML = `<strong>${verdict}.</strong> There’s a <strong>${fmt.pct(res.pHit)}</strong> chance of reaching ${fmt.compact(s.quota)}, and the most likely finish is ${fmt.compact(res.p50)}.
      ${shortfall80 > 0 ? `To be 80% confident, you’d need about <strong>${fmt.compact(shortfall80)}</strong> more in expected bookings.` : 'Even a weak quarter (bottom 20%) clears quota.'}
      ${top.length ? `The deals that matter most: ${top.map((d) => `<strong>${esc(d.account || d.deal)}</strong> (${fmt.signedPct(d.swing)})`).join(', ')}.` : ''}`;

    renderTable(inQ);

    // By rep
    const reps = {};
    inQ.forEach((d) => { (reps[d.owner] ||= { ev: 0, n: 0, commit: 0 }); reps[d.owner].ev += d.ev; reps[d.owner].n++; if (d.stageIdx >= 3) reps[d.owner].commit += d.amount; });
    const repItems = Object.entries(reps).sort((a, b) => b[1].ev - a[1].ev).map(([k, v]) => ({
      label: k, value: v.ev, tip: `${k}\nExpected: ${fmt.compact(v.ev)}\n${v.n} deals · ${fmt.compact(v.commit)} in Negotiate/Commit`,
    }));
    Kit.mount('#reps', (w) => Kit.svg.hbars({ w, items: repItems, fmt: fmt.compact, labelW: 90 }));

    const byStage = STAGES.map((st, i) => {
      const ds = inQ.filter((d) => d.stageIdx === i);
      return { label: st, value: ds.reduce((a, d) => a + d.amount, 0), color: STAGE_COLORS[i], tip: `${st}: ${ds.length} deals, ${fmt.compact(ds.reduce((a, d) => a + d.amount, 0))}` };
    });
    Kit.mount('#stages', (w) => Kit.svg.hbars({ w, items: byStage, fmt: fmt.compact, labelW: 90 }));
  }

  function renderTable(deals) {
    const maxSwing = Math.max(0.0001, ...deals.map((d) => d.swing));
    const rows = [...deals].sort((a, b) => {
      const x = a[sortKey], y = b[sortKey];
      return (typeof x === 'string' ? x.localeCompare(y) : x - y) * sortDir;
    });
    $('#deals tbody').innerHTML = rows.map((d) => `
      <tr>
        <td class="deal-cell"><span class="deal-name">${esc(d.account || d.deal)}</span><span class="deal-acct">${esc(d.deal)} · ${esc(d.id)}</span></td>
        <td class="hide-sm">${esc(d.owner)}</td>
        <td><span class="chip" style="color:${STAGE_COLORS[d.stageIdx]};background:color-mix(in srgb, ${STAGE_COLORS[d.stageIdx]} 14%, transparent)"><i></i>${d.stage}</span>${d.days > STALE_DAYS ? `<span class="stale" data-tip="${d.days} days in stage — haircut applied">● stale</span>` : ''}</td>
        <td class="num">${fmt.money(d.amount)}</td>
        <td class="hide-sm">${esc(d.close)}</td>
        <td class="num">${fmt.pct(d.p)}</td>
        <td class="num">${fmt.compact(d.ev)}</td>
        <td class="num"><span class="swing">${fmt.signedPct(d.swing)}<span class="meter"><span style="width:${Math.max(0, (d.swing / maxSwing) * 100)}%"></span></span></span></td>
      </tr>`).join('');
    $$('#deals th').forEach((th) => {
      th.removeAttribute('aria-sort');
      if (th.dataset.sort === sortKey) th.setAttribute('aria-sort', sortDir > 0 ? 'ascending' : 'descending');
    });
  }

  // ───────── Events ─────────
  const rerender = Kit.debounce(render, 80);
  $$('aside input').forEach((el) => el.addEventListener('input', rerender));
  $$('#runs button').forEach((b) => b.addEventListener('click', () => {
    $$('#runs button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    runs = Number(b.dataset.v);
    render();
  }));
  $$('#deals th[data-sort]').forEach((th) => th.addEventListener('click', () => {
    const k = th.dataset.sort;
    sortDir = k === sortKey ? -sortDir : (['deal', 'owner', 'close'].includes(k) ? 1 : -1);
    sortKey = k;
    render();
  }));
  $('#file').addEventListener('change', async (e) => {
    const f = e.target.files[0];
    if (!f) return;
    try {
      const rows = Kit.csv.parse(await Kit.csv.readFile(f));
      if (!rows.length || !('stage' in rows[0]) || !('amount' in rows[0])) throw new Error('Missing stage/amount columns');
      raw = rows;
      $('#dataNote').textContent = `Loaded ${f.name} · ${rows.length} rows`;
      render();
      Kit.toast('Pipeline loaded');
    } catch (err) {
      Kit.toast('Couldn’t read that file — check the column names below.');
    }
    e.target.value = '';
  });
  $('#dlSample').addEventListener('click', () => Kit.csv.download('quota-lens-sample.csv', Kit.csv.stringify(samplePipeline())));
  $('#reset').addEventListener('click', () => {
    raw = samplePipeline();
    $('#dataNote').textContent = 'Showing synthetic sample data · files stay in your browser';
    render();
  });

  render();
})();
