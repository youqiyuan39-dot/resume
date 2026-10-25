/* V16 (V15 motion layer at the end of this file). */
(() => {
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  /* ===== Split-flap cell ===== */
  const setCell = (cell, ch, dur = 240) => {
    const old = cell.dataset.v !== undefined ? cell.dataset.v : cell.textContent;
    if (old === ch) return;
    cell.dataset.v = ch;
    clearTimeout(cell._t);
    if (reduce || !dur) { cell.textContent = ch; return; }
    cell.textContent = '';
    cell.style.setProperty('--fd', dur + 'ms');
    [['f-top', ch], ['f-bot', old], ['f-leaf-top', old], ['f-leaf-bot', ch]].forEach(([cls, t]) => {
      const s = document.createElement('span'); s.className = 'f ' + cls; s.textContent = t; cell.appendChild(s);
    });
    cell._t = setTimeout(() => { cell.textContent = ch; }, dur * 2 + 40);
  };
  const setWord = (cells, word, dur = 240, stagger = 60) => {
    const chars = [...word];
    cells.forEach((c, i) => {
      const ch = chars[i] || ' ';
      if (reduce || !stagger || !dur) setCell(c, ch, dur); else setTimeout(() => setCell(c, ch, dur), i * stagger);
    });
  };

  /* ===== Departure board (mirrors autonomous_flow_v3: serial, six stages) ===== */
  const dataEl = $('#sim-data');
  const STAGES = ['evidence', 'process', 'validate', 'prepare', 'publish', 'reconcile'];
  const CN = { evidence: '证据', process: '处理', validate: '校验', prepare: '冻结', publish: '发布', reconcile: '回查' };
  const SYM = { passed: '✓', fix: '→', retry: '~', unknown: '?', blocked: '✗' };
  let rowsApi = null;

  if (dataEl) {
    const items = JSON.parse(dataEl.textContent);
    const list = $('#rows'); const verdict = $('#verdict');
    const pauseBtn = $('#b-pause'); const rerunBtn = $('#b-rerun'); const fault = $('#b-fault');
    const T = { done: $('#t-done'), quar: $('#t-quar'), recon: $('#t-recon') };
    const R = {};
    let token = 0; let paused = false; let running = false;

    const build = () => {
      list.textContent = '';
      items.forEach((it) => {
        const li = document.createElement('li'); li.id = 'row-' + it.id;
        const btn = document.createElement('button');
        btn.type = 'button'; btn.className = 'row';
        btn.setAttribute('aria-expanded', 'false'); btn.setAttribute('aria-controls', 'log-' + it.id);
        btn.innerHTML = '<span class="r-code"></span><span class="r-name"><b></b><small></small></span>' +
          '<span class="pips" aria-hidden="true">' + '<i></i>'.repeat(6) + '</span>' +
          '<span class="r-status idle"><span class="cell"></span><span class="cell"></span><span class="cell"></span></span>' +
          '<span class="r-last"></span>';
        btn.querySelector('.r-code').textContent = it.code;
        btn.querySelector('.r-name b').textContent = it.name;
        btn.querySelector('.r-name small').textContent = it.meta;
        const log = document.createElement('div'); log.className = 'r-log'; log.id = 'log-' + it.id; log.hidden = true;
        li.append(btn, log); list.appendChild(li);
        R[it.id] = { li, btn, log, pips: $$('.pips i', btn), status: $('.r-status', btn), cells: $$('.r-status .cell', btn), last: $('.r-last', btn), lines: [], why: '' };
        btn.addEventListener('click', () => {
          const open = btn.getAttribute('aria-expanded') !== 'true';
          btn.setAttribute('aria-expanded', String(open)); log.hidden = !open;
          if (open) renderLog(it.id);
        });
      });
    };
    const renderLog = (id) => {
      const r = R[id]; if (r.log.hidden) return;
      r.log.textContent = '';
      if (!r.lines.length) { const e = document.createElement('span'); e.className = 'empty'; e.textContent = '还没轮到它：协调器是串行的，一次只推进一件商品。'; r.log.appendChild(e); return; }
      r.lines.forEach(([s, o, t]) => {
        const p = document.createElement('p'); p.className = 'o-' + o;
        p.innerHTML = '<span class="sym"></span><span class="who"></span><span class="txt"></span>';
        p.children[0].textContent = SYM[o] || '·'; p.children[1].textContent = s; p.children[2].textContent = t;
        r.log.appendChild(p);
      });
      if (r.why) { const w = document.createElement('p'); w.className = 'why'; w.textContent = '待处理：' + r.why; r.log.appendChild(w); }
    };
    const status = (id, word, cls, dur) => {
      const r = R[id]; r.status.className = 'r-status ' + cls; setWord(r.cells, word, dur);
    };
    const pips = (id, idx, state) => {
      R[id].pips.forEach((p, n) => { p.className = n < idx ? 'pass' : n === idx ? state : ''; });
    };
    const reset = () => {
      Object.keys(R).forEach((id) => {
        const r = R[id]; r.lines = []; r.why = ''; r.last.textContent = '';
        r.li.classList.remove('is-current'); pips(id, -1, '');
        r.cells.forEach((c) => { delete c.dataset.v; c.textContent = ''; });
        status(id, '排队', 'idle', 0); renderLog(id);
      });
      Object.values(T).forEach((el) => { el.textContent = '0'; });
      verdict.textContent = '';
    };

    const wait = async (ms, my) => {
      let left = ms;
      while (left > 0) {
        if (my !== token) throw new Error('stop');
        await sleep(Math.min(left, 50));
        if (!paused) left -= 50;
      }
      if (my !== token) throw new Error('stop');
    };
    const stepsOf = (it, withFault) => it.steps.filter((st) => !(st.fault && !withFault) && !(st.nofault && withFault));
    const summary = (n) => `${items.length} 件商品跑完：${n.done} 件上架并通过平台回查，${n.quar} 件自动隔离并写明缺项` +
      (n.recon ? `，${n.recon} 次发布结果未知靠回查避免了重复刊登` : '') + '，全程没有人工点击。';

    const run = async () => {
      const my = ++token; running = true; paused = false;
      pauseBtn.textContent = '暂停'; pauseBtn.setAttribute('aria-pressed', 'false');
      reset();
      const n = { done: 0, quar: 0, recon: 0 };
      const withFault = fault.checked;
      try {
        await wait(500, my);
        for (const it of items) {
          const r = R[it.id]; r.li.classList.add('is-current');
          let recon = false;
          for (const st of stepsOf(it, withFault)) {
            const idx = STAGES.indexOf(st.s);
            pips(it.id, idx, 'active'); status(it.id, CN[st.s], '');
            await wait(st.o === 'passed' ? 420 : 640, my);
            if (st.o === 'retry') { pips(it.id, idx, 'wait'); status(it.id, '重试', 'warn'); }
            if (st.o === 'unknown') { pips(it.id, idx, 'wait'); status(it.id, '回查', 'warn'); recon = true; }
            if (st.o === 'blocked') pips(it.id, idx, 'fail');
            r.lines.push([st.s, st.o, st.t]); r.last.textContent = st.t; renderLog(it.id);
            await wait(st.o === 'passed' ? 220 : 620, my);
          }
          if (it.end === 'done') {
            pips(it.id, 6, ''); status(it.id, '已上架', 'done'); n.done++; T.done.textContent = n.done;
            if (recon) { n.recon++; T.recon.textContent = n.recon; }
          } else {
            r.why = it.why; status(it.id, '已隔离', 'quar'); n.quar++; T.quar.textContent = n.quar; renderLog(it.id);
          }
          await wait(380, my);
          r.li.classList.remove('is-current');
        }
        verdict.textContent = summary(n);
      } catch (e) { /* superseded by a rerun */ }
      if (my === token) { running = false; pauseBtn.textContent = '暂停'; pauseBtn.setAttribute('aria-pressed', 'false'); }
    };

    const runInstant = () => {
      token++; running = false; reset();
      const n = { done: 0, quar: 0, recon: 0 };
      items.forEach((it) => {
        const r = R[it.id]; let recon = false; let lastIdx = 0;
        stepsOf(it, fault.checked).forEach((st) => { r.lines.push([st.s, st.o, st.t]); r.last.textContent = st.t; lastIdx = STAGES.indexOf(st.s); if (st.o === 'unknown') recon = true; });
        if (it.end === 'done') { pips(it.id, 6, ''); status(it.id, '已上架', 'done', 0); n.done++; if (recon) n.recon++; }
        else { r.why = it.why; pips(it.id, lastIdx, 'fail'); status(it.id, '已隔离', 'quar', 0); n.quar++; }
        renderLog(it.id);
      });
      T.done.textContent = n.done; T.quar.textContent = n.quar; T.recon.textContent = n.recon;
      verdict.textContent = summary(n);
    };

    build();
    reset();
    pauseBtn.addEventListener('click', () => {
      if (!running) return;
      paused = !paused; pauseBtn.textContent = paused ? '继续' : '暂停'; pauseBtn.setAttribute('aria-pressed', String(paused));
    });
    rerunBtn.addEventListener('click', () => (reduce ? runInstant() : run()));
    fault.addEventListener('change', () => (reduce ? runInstant() : run()));

    if (reduce) runInstant();
    else {
      const board = $('#board');
      const start = () => run();
      if ('IntersectionObserver' in window) {
        const io = new IntersectionObserver((es) => { if (es.some((e) => e.isIntersecting)) { io.disconnect(); start(); } }, { threshold: 0.2 });
        io.observe(board);
      } else start();
    }

    rowsApi = {
      gate(pass, price, pct) {
        const r = R.shears; if (running || !r || !r.why) return; // only after the run has quarantined it
        if (pass) { status('shears', '可放行', 'done'); r.last.textContent = `市场价调到 ¥${price}，利润率 ${pct}%：可放行，等协调器重新核验`; }
        else { status('shears', '已隔离', 'quar'); r.last.textContent = r.lines.length ? r.lines[r.lines.length - 1][2] : ''; }
      },
    };
  }

  /* ===== Profit gate (source formula: market_follow_v3.solve) ===== */
  const price = $('#g-price');
  if (price) {
    const out = $('#g-price-out'); const table = $('#g-table'); const result = $('#g-result');
    const mini = $('.mini-board'); const mbPct = $('#mb-pct'); const mbCells = $$('#mb-flaps .cell');
    const C = { platform: 0.175, ads: 0.05, tax: 0.05, returns: 0.03, purchase: 38, domestic: 4, forwarder: 9.5, packing: 0.6 };
    const yuan = (v) => (v < 0 ? '−¥ ' : '¥ ') + Math.abs(v).toFixed(2);
    let lastPass = null; let first = true;
    const pctStr = (m) => (m < 0 ? '−' : '') + Math.abs(m).toFixed(2) + '%';
    const update = () => {
      const p = Number(price.value);
      const net = p * (1 - C.platform);
      const ads = net * C.ads; const tax = net * C.tax;
      const base = C.purchase + C.domestic + C.forwarder + C.packing;
      const reserve = base * C.returns;
      const contrib = net - base - reserve - ads - tax;
      const margin = (contrib / p) * 100;
      const pass = contrib * 100 > p * 10; // strictly greater, buyer-price basis
      const pct = (margin < 0 ? '−' : '') + Math.abs(margin).toFixed(1);
      out.textContent = '¥ ' + p;
      const rows = [
        ['市场售价', p, ''], ['平台费（示例 17.5%）', -p * C.platform, ''], ['净回款', net, 'sub'],
        ['广告预算 5% × 净回款', -ads, ''], ['税费预留 5% × 净回款', -tax, ''],
        ['采购 + 国内运费 + 货代（示例）+ 包材', -base, ''], ['退货预留 3% × 变动成本', -reserve, ''],
      ];
      table.textContent = '';
      rows.forEach(([k, v, cls]) => {
        const dt = document.createElement('dt'); dt.textContent = k; const dd = document.createElement('dd'); dd.textContent = yuan(v);
        if (cls) { dt.className = cls; dd.className = cls; } table.append(dt, dd);
      });
      const dt = document.createElement('dt'); dt.className = 'sum'; dt.textContent = '贡献利润 ÷ 市场售价';
      const dd = document.createElement('dd'); dd.className = 'sum'; dd.textContent = `${yuan(contrib)} ÷ ${p} = ${pctStr(margin)}`;
      table.append(dt, dd);
      result.className = 'gate-result ' + (pass ? 'pass' : 'fail');
      result.textContent = pass ? `${pctStr(margin)} 大于 10%：放行，进入冻结和发布。` : `${pctStr(margin)} 没有超过 10%：隔离，不自动抬价。`;
      mbPct.textContent = pct + '%';
      if (pass !== lastPass) {
        mini.classList.toggle('pass', pass); mini.classList.toggle('fail', !pass);
        setWord(mbCells, pass ? '可放行' : '已隔离', first ? 0 : 220, first ? 0 : 70);
        lastPass = pass;
      }
      first = false;
      if (rowsApi) rowsApi.gate(pass, p, pct);
    };
    price.addEventListener('input', update);
    update();
  }

  /* Screenshot pins <-> notes */
  $$('.pin').forEach((pin) => {
    const note = document.getElementById(pin.getAttribute('aria-describedby'));
    const on = () => { pin.classList.add('is-on'); note && note.classList.add('is-on'); };
    const off = () => { pin.classList.remove('is-on'); note && note.classList.remove('is-on'); };
    pin.addEventListener('mouseenter', on); pin.addEventListener('mouseleave', off);
    pin.addEventListener('focus', on); pin.addEventListener('blur', off);
    pin.addEventListener('click', () => { on(); note && note.scrollIntoView({ block: 'nearest', behavior: reduce ? 'auto' : 'smooth' }); });
  });

  /* ===== Lightbox ===== */
  const box = $('#lightbox');
  if (!box) return;
  const stage = $('.lightbox-stage', box); const img = $('[data-role="lightbox-img"]', box); const closeBtn = $('.lightbox-close', box);
  const background = [...document.body.children].filter((el) => el !== box && el.tagName !== 'SCRIPT');
  let opener = null;
  const open = (btn) => {
    opener = btn;
    img.src = btn.dataset.lightbox; img.width = Number(btn.dataset.w) || 1600; img.height = Number(btn.dataset.h) || 900;
    img.alt = btn.querySelector('img')?.alt || '放大的截图';
    box.hidden = false; background.forEach((el) => { el.inert = true; });
    document.documentElement.classList.add('lightbox-open');
    stage.scrollLeft = 0; stage.scrollTop = 0; closeBtn.focus();
  };
  const close = () => {
    if (box.hidden) return;
    box.hidden = true; background.forEach((el) => { el.inert = false; });
    document.documentElement.classList.remove('lightbox-open');
    if (opener) opener.focus(); opener = null;
  };
  $$('[data-lightbox]').forEach((btn) => btn.addEventListener('click', () => open(btn)));
  closeBtn.addEventListener('click', close);
  box.addEventListener('click', (e) => { if (e.target === box || e.target === stage) close(); });
  addEventListener('keydown', (e) => {
    if (box.hidden) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); return; }
    if (e.key === 'Tab') {
      const inside = box.contains(document.activeElement);
      if (e.shiftKey && (document.activeElement === closeBtn || !inside)) { e.preventDefault(); stage.focus(); }
      else if (!e.shiftKey && (document.activeElement === stage || !inside)) { e.preventDefault(); closeBtn.focus(); }
    }
  });
})();

/* ===== V15 motion layer =====
   Progressive: without JS or with reduced motion, nothing is hidden and nothing moves. */
(() => {
  const $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const fine = window.matchMedia('(pointer: fine)').matches;

  /* Nav: active section + compact after scroll (works in every mode) */
  const navWrap = document.querySelector('.nav-wrap');
  const links = $$('.nav-links a');
  const targets = links.map((a) => document.querySelector(a.getAttribute('href'))).filter(Boolean);
  const onNav = () => {
    navWrap && navWrap.classList.toggle('is-scrolled', scrollY > 40);
    let cur = targets[0];
    targets.forEach((t) => { if (t.getBoundingClientRect().top < innerHeight * 0.35) cur = t; });
    links.forEach((a) => a.classList.toggle('is-active', document.querySelector(a.getAttribute('href')) === cur));
  };
  addEventListener('scroll', onNav, { passive: true }); onNav();

  if (reduce || !('IntersectionObserver' in window)) return;
  const root = document.documentElement;
  root.classList.add('motion');

  /* Hero entrance */
  $$('.hero-text > *').forEach((el, i) => el.style.setProperty('--i', i));
  const heroHl = $$('.hero .hl');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    root.classList.add('loaded');
    heroHl.forEach((el, i) => setTimeout(() => el.classList.add('in'), 450 + i * 380));
  }));

  /* Highlights outside the hero wipe in when seen */
  // Observe the heading, not the clipped highlight itself: a fully clipped element can report zero visible area.
  const hlIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; hlIO.unobserve(e.target);
    $$('.hl', e.target).forEach((el, i) => setTimeout(() => el.classList.add('in'), 120 + i * 200));
  }), { threshold: 0.4 });
  [...new Set($$('.hl').filter((el) => !el.closest('.hero')).map((el) => el.closest('h1, h2, h3, p') || el.parentElement))].forEach((h) => hlIO.observe(h));

  /* Cards and blocks land in, staggered per group */
  const groups = [
    ['.svc-grid', '.svc', true], ['.about', '.about-art, .about-text', false], ['.works', '.work', true],
    ['.stages', 'li', false], ['.timeline', '.tl', true], ['.status', '.status-card', true],
    ['.skill-grid', '.skill', true], ['.about-list', 'li', false], ['.foot', '.foot-top, .foot-cols', false],
  ];
  const rv = [];
  groups.forEach(([g, item, card]) => $$(g).forEach((box) => $$(item, box).forEach((el, i) => {
    el.classList.add('rv'); if (card) el.classList.add('rv-card'); el.style.setProperty('--i', i % 6); rv.push(el);
  })));
  const rvIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; e.target.classList.add('in'); rvIO.unobserve(e.target);
    setTimeout(() => e.target.style.removeProperty('--i'), 1600); // later hovers react instantly
  }), { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
  rv.forEach((el) => rvIO.observe(el));

  /* Service icons draw themselves */
  $$('.svc-art svg').forEach((svg) => $$('path, rect, ellipse, circle', svg).forEach((s) => {
    try { const len = Math.ceil(s.getTotalLength()); s.style.setProperty('--len', len); s.classList.add('draw'); } catch (e) { /* not measurable */ }
  }));

  /* Count-up numbers */
  const cIO = new IntersectionObserver((es) => es.forEach((e) => {
    if (!e.isIntersecting) return; cIO.unobserve(e.target);
    const el = e.target; const to = Number(el.dataset.count); const pre = el.dataset.prefix || ''; const suf = el.dataset.suffix || '';
    const t0 = performance.now(); const dur = 1200;
    const tick = (now) => {
      const k = Math.min(1, (now - t0) / dur); const v = Math.round(to * (1 - Math.pow(1 - k, 3)));
      el.textContent = pre + v + suf; if (k < 1) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }), { threshold: 0.6 });
  $$('[data-count]').forEach((el) => cIO.observe(el));

  /* Marquee band: base drift, scroll speeds it up and sets direction */
  const track = document.querySelector('.band-track');
  if (track) {
    let x = 0; let dir = -1; let boost = 0; let lastY = scrollY; let visible = true; let half = track.scrollWidth / 2;
    addEventListener('resize', () => { half = track.scrollWidth / 2; });
    new IntersectionObserver((es) => { visible = es[0].isIntersecting; }).observe(track);
    addEventListener('scroll', () => {
      const dy = scrollY - lastY; lastY = scrollY;
      if (dy) dir = dy > 0 ? -1 : 1;
      boost = Math.min(18, boost + Math.abs(dy) * 0.08);
    }, { passive: true });
    const loop = () => {
      if (visible) {
        x += dir * (0.6 + boost); boost *= 0.92;
        if (x <= -half) x += half; if (x > 0) x -= half;
        track.style.transform = `translate3d(${x.toFixed(1)}px,0,0)`;
      }
      requestAnimationFrame(loop);
    };
    requestAnimationFrame(loop);
  }

  /* Hero: portrait card tilts toward the pointer, doodles drift with depth */
  const hero = document.querySelector('.hero'); const card = document.querySelector('.hero-card');
  const dds = $$('.dd');
  if (hero && card && fine) {
    let raf = 0; let px = 0; let py = 0;
    const apply = () => {
      raf = 0;
      card.style.setProperty('--ry', (px * 8).toFixed(2) + 'deg');
      card.style.setProperty('--rx', (-py * 8).toFixed(2) + 'deg');
      dds.forEach((d) => {
        const z = Number(getComputedStyle(d).getPropertyValue('--z')) || 1;
        d.style.setProperty('--mx', (px * 18 * z).toFixed(1) + 'px'); d.style.setProperty('--my', (py * 18 * z).toFixed(1) + 'px');
      });
    };
    hero.addEventListener('pointermove', (e) => {
      const r = hero.getBoundingClientRect();
      px = (e.clientX - r.left) / r.width - 0.5; py = (e.clientY - r.top) / r.height - 0.5;
      card.classList.add('tilting'); if (!raf) raf = requestAnimationFrame(apply);
    });
    hero.addEventListener('pointerleave', () => { px = 0; py = 0; card.classList.remove('tilting'); if (!raf) raf = requestAnimationFrame(apply); });
  }
})();
