/* =========================================================
   AI 解題筆記 — Phase 1 前端視覺雛形
   ---------------------------------------------------------
   ・手寫白板：<canvas> + Pointer Events（Apple Pencil 壓力、防手掌誤觸）
   ・筆跡以「每一筆的座標點」儲存 → 才能做整筆擦除、局部擦除、復原/重做
   ・格線是 CSS 背景，跟筆跡 canvas 分開，橡皮擦不會擦到格線
   ・AI 檢查流程（框選 → 確認算式 → 錯誤標註）全部用寫死的範例資料模擬，
     這個階段「沒有」串接後端、AI API、OCR 或 SymPy。
   ========================================================= */
(function () {
  'use strict';

  // ---------------------------------------------------------
  // 小工具
  // ---------------------------------------------------------
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const uid = () => Math.random().toString(36).slice(2, 10);
  const escapeHtml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const icon = (name) => `<svg class="icon"><use href="#i-${name}"/></svg>`;

  // ---------------------------------------------------------
  // 常數
  // ---------------------------------------------------------
  // 畫筆 6 色（刻意不含紅色：紅色只保留給 AI 標註）
  const PEN_COLORS = ['#1E2340', '#2F5BEA', '#15965A', '#E07A1F', '#7C4DDB', '#0E8C99'];
  const PEN_WIDTHS = [2, 3.5, 6];          // 細 / 中 / 粗（世界座標 px）
  const ERASER_RADII = [8, 16, 28];        // 橡皮擦半徑（螢幕 px）
  const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const ZOOM_MIN = 0.5;
  const ZOOM_MAX = 2;
  const GRID = 32;                         // 方格大小
  const LINE_GAP = 40;                     // 橫線間距
  const HAND_FONT = '"LXGW WenKai TC", "Noto Sans TC", serif';
  const STORAGE_KEY = 'ai-solve-notes/v1';
  const S = 0.9;                           // 設計稿座標 → 畫布世界座標的比例

  // ---------------------------------------------------------
  // 範例資料（第 7 節 Demo Data）
  // ---------------------------------------------------------
  /** 第 2 頁的範例手寫內容（文字物件；不會被橡皮擦擦掉） */
  function createDemoItems() {
    const t = (id, text, x, y, size, color, extra = {}) =>
      ({ type: 'text', id, text, x: x * S, y: y * S, size: size * S, color, ...extra });
    return [
      { type: 'highlight', x: 654 * S, y: 186 * S, w: 280 * S, h: 22 * S, color: 'rgba(253, 224, 71, 0.5)' },

      t('ex3-title', '例題 3　解方程式 2x + 3 = 7', 71, 125, 30, '#2F5BEA'),
      t('ex3-q', '2x + 3 = 7', 106, 200, 44, '#1E2340', { group: 'ex3' }),
      t('ex3-s1', '2x = 7 + 3', 106, 266, 44, '#1E2340', { group: 'ex3' }),
      t('ex3-s2', '2x = 10', 106, 333, 44, '#1E2340', { group: 'ex3' }),
      t('ex3-s3', 'x = 5', 106, 399, 44, '#1E2340', { group: 'ex3' }),

      t('date', '11 / 26（四）', 966, 122, 24, '#5B6178'),
      t('key', '重點：移項要變號！', 662, 181, 32, '#15965A'),
      t('key2', '＋ 移過去變 －，× 移過去變 ÷', 662, 234, 23, '#5B6178'),

      t('ex4-title', '例題 4　3(x − 2) = 12', 662, 335, 30, '#7C4DDB', { group: 'ex4' }),
      t('ex4-s1', '3x − 6 = 12', 696, 406, 44, '#1E2340', { group: 'ex4' }),
      t('ex4-s2', '3x = 18', 696, 473, 44, '#1E2340', { group: 'ex4' }),
      t('ex4-s3', 'x = 6', 696, 539, 44, '#1E2340', { group: 'ex4' }),
      t('ex4-ans', '答案', 862, 540, 26, '#E07A1F'),
    ];
  }

  /** 學生自己用橘色筆圈起來的答案（是一般筆跡，可以擦掉） */
  function createDemoStrokes() {
    const cx = 762 * S, cy = 541 * S, rx = 78 * S, ry = 35 * S, rot = -0.05;
    const pts = [];
    const n = 96, start = -2.7, total = Math.PI * 2 + 0.55;
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      const a = start + total * k;
      const wob = 1 + 0.035 * Math.sin(a * 3 + 0.6);
      const dx = Math.cos(a) * (rx * wob + k * 5);
      const dy = Math.sin(a) * (ry * wob) - k * 3;
      pts.push([
        cx + dx * Math.cos(rot) - dy * Math.sin(rot),
        cy + dx * Math.sin(rot) + dy * Math.cos(rot),
        0.35 + 0.3 * Math.sin(k * Math.PI),
      ]);
    }
    return [{ id: uid(), color: '#E07A1F', width: 3, points: pts }];
  }

  /** AI 檢查的寫死結果 */
  const DATASETS = {
    ex3: {
      lineIds: ['ex3-q', 'ex3-s1', 'ex3-s2', 'ex3-s3'],
      lines: ['2x + 3 = 7', '2x = 7 + 3', '2x = 10', 'x = 5'],
      blurry: 2,                                   // 步驟 2 標示「字跡模糊」
      unit: '一元一次方程式',
      errorStep: 1,                                // 錯在步驟 1
      errorType: '移項變號錯誤',
      tag: '+3 → ?',
      tagAnchor: '2x = 7 ',                        // 標籤放在「+ 3」上方
      hint: '把 +3 從等號左邊移到右邊時，它的符號應該怎麼變？',
      explanation: '移項要變號：+3 移到右邊變成 −3，所以 2x = 7 − 3 = 4，得到 x = 2。',
      affectNote: '之後兩步受第 1 步影響',
    },
    ex4: {
      lineIds: ['ex4-title', 'ex4-s1', 'ex4-s2', 'ex4-s3'],
      lines: ['3(x − 2) = 12', '3x − 6 = 12', '3x = 18', 'x = 6'],
      blurry: -1,
      unit: '一元一次方程式',
      errorStep: null,
      tip: '養成好習慣：把 x = 6 代回原式驗算，3(6 − 2) = 12，等式成立。',
    },
  };

  /** 學習分析頁的假數據 */
  const ANALYTICS = {
    week: {
      stats: [
        { label: '本週檢查', value: 32, unit: '題' },
        { label: '一次就算對', value: 68, unit: '%' },
        { label: '比上週進步', value: 9, unit: '%', prefix: '+', up: true },
        { label: '連續練習', value: 5, unit: '天' },
      ],
      bars: [['移項變號', 12], ['分配律', 8], ['四則運算', 5], ['約分', 3], ['抄錯數字', 2]],
      chartTitle: '每日正確率',
      labels: ['一', '二', '三', '四', '五', '六', '日'],
      tipLabels: ['週一', '週二', '週三', '週四', '週五', '週六', '週日'],
      values: [55, 60, 58, 66, 70, 64, 74],
    },
    month: {
      stats: [
        { label: '本月檢查', value: 128, unit: '題' },
        { label: '一次就算對', value: 64, unit: '%' },
        { label: '比上月進步', value: 6, unit: '%', prefix: '+', up: true },
        { label: '最長連續', value: 12, unit: '天' },
      ],
      bars: [['移項變號', 41], ['分配律', 30], ['四則運算', 18], ['約分', 12], ['抄錯數字', 7]],
      chartTitle: '每週正確率',
      labels: ['第 1 週', '第 2 週', '第 3 週', '第 4 週'],
      values: [56, 61, 59, 68],
    },
    all: {
      stats: [
        { label: '累計檢查', value: 486, unit: '題' },
        { label: '一次就算對', value: 61, unit: '%' },
        { label: '比剛開始進步', value: 18, unit: '%', prefix: '+', up: true },
        { label: '最長連續', value: 21, unit: '天' },
      ],
      bars: [['移項變號', 152], ['分配律', 117], ['四則運算', 74], ['約分', 51], ['抄錯數字', 26]],
      chartTitle: '每月正確率',
      labels: ['7 月', '8 月', '9 月', '10 月', '11 月'],
      values: [47, 52, 58, 57, 66],
    },
  };

  // ---------------------------------------------------------
  // 狀態
  // ---------------------------------------------------------
  const state = {
    view: 'notebook',            // notebook | analysis
    mode: 'draw',                // draw | select | confirm | checking | result
    tool: 'pen',                 // pen | eraser
    colorIdx: 0,
    penSize: 1,
    eraserSize: 1,
    eraserMode: 'stroke',        // stroke（整筆擦除）| partial（局部擦除）
    pages: [],
    current: 1,
    view2d: { x: 0, y: 0, zoom: 1 },
    result: null,                // { group, ds, lines, anchor }
    aiVisible: true,
    range: 'week',
  };

  function makePage({ id = uid(), demo = false, paper = 'grid', strokes = [] } = {}) {
    return { id, demo, paper, items: demo ? createDemoItems() : [], strokes, undo: [], redo: [] };
  }
  function createDefaultPages() {
    return [makePage(), makePage({ demo: true, strokes: createDemoStrokes() }), makePage()];
  }
  const curPage = () => state.pages[state.current];

  // ---------------------------------------------------------
  // DOM
  // ---------------------------------------------------------
  const body = document.body;
  const paperEl = $('#paper');
  const canvas = $('#ink');
  const ctx = canvas.getContext('2d');
  const worldEl = $('#world');
  const annoEl = $('#anno');
  const arrowLayer = $('#arrowLayer');
  const arrowPath = $('#arrowPath');
  const arrowDot = $('#arrowDot');
  const eraserCursor = $('#eraserCursor');
  const toolbar = $('.toolbar');
  const eraserMenu = $('#eraserMenu');
  const pageList = $('#pageList');
  const resultCard = $('#resultCard');
  const zoomLabel = $('#zoomReset');
  const selectLayer = $('#selectLayer');
  const selectBox = $('#selectBox');
  const selectDim = $('#selectDim');
  const selLabel = $('#selLabel');
  const selLabelText = $('#selLabelText');
  const selectActions = $('#selectActions');
  const btnSelectGo = $('#btnSelectGo');
  const ocrList = $('#ocrList');
  const previewCanvas = $('#previewCanvas');
  const btnStartCheck = $('#btnStartCheck');
  const aiToggle = $('#aiToggle');
  const toastEl = $('#toast');

  let dpr = window.devicePixelRatio || 1;

  // ---------------------------------------------------------
  // Toast
  // ---------------------------------------------------------
  let toastTimer = null;
  function toast(msg, ms = 2600) {
    toastEl.textContent = msg;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), ms);
  }

  // ---------------------------------------------------------
  // 自動儲存（存在瀏覽器 localStorage）
  // ---------------------------------------------------------
  let saveTimer = null;
  function setSaveStatus(s) {
    const el = $('#saveStatus');
    el.dataset.state = s;
    $('#saveText').textContent = s === 'saving' ? '儲存中…' : s === 'error' ? '無法自動儲存' : '已自動儲存';
  }
  function scheduleSave() {
    setSaveStatus('saving');
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }
  function encodeStroke(s) {
    const flat = [];
    for (const p of s.points) flat.push(Math.round(p[0] * 10) / 10, Math.round(p[1] * 10) / 10, Math.round(p[2] * 100) / 100);
    return { c: s.color, w: s.width, p: flat };
  }
  function decodeStroke(o) {
    const pts = [];
    for (let i = 0; i + 2 < o.p.length; i += 3) pts.push([o.p[i], o.p[i + 1], o.p[i + 2]]);
    return { id: uid(), color: o.c, width: o.w, points: pts };
  }
  function saveNow() {
    try {
      const data = {
        v: 1,
        current: state.current,
        tools: { colorIdx: state.colorIdx, penSize: state.penSize, eraserSize: state.eraserSize, eraserMode: state.eraserMode },
        pages: state.pages.map((p) => ({ id: p.id, demo: p.demo, paper: p.paper, strokes: p.strokes.map(encodeStroke) })),
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      setSaveStatus('saved');
    } catch (e) {
      setSaveStatus('error');
    }
  }
  function loadSaved() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return false;
      const data = JSON.parse(raw);
      if (!data || !Array.isArray(data.pages) || !data.pages.length) return false;
      state.pages = data.pages.map((p) => makePage({
        id: p.id, demo: !!p.demo, paper: p.paper || 'grid',
        strokes: (p.strokes || []).map(decodeStroke).filter((s) => s.points.length),
      }));
      state.current = clamp(data.current | 0, 0, state.pages.length - 1);
      const t = data.tools || {};
      if (PEN_COLORS[t.colorIdx]) state.colorIdx = t.colorIdx;
      if (PEN_WIDTHS[t.penSize]) state.penSize = t.penSize;
      if (ERASER_RADII[t.eraserSize]) state.eraserSize = t.eraserSize;
      if (t.eraserMode === 'stroke' || t.eraserMode === 'partial') state.eraserMode = t.eraserMode;
      return true;
    } catch (e) {
      return false;
    }
  }

  // ---------------------------------------------------------
  // 繪圖（筆跡 / 範例文字 / 螢光筆）
  // ---------------------------------------------------------
  const measureCtx = document.createElement('canvas').getContext('2d');
  const fontOf = (size) => `${size}px ${HAND_FONT}`;

  function measureItem(it) {
    if (it.type !== 'text') return;
    measureCtx.font = fontOf(it.size);
    const w = measureCtx.measureText(it.text).width;
    it.bbox = { x: it.x, y: it.y - it.size * 0.6, w, h: it.size * 1.2 };
  }
  function measureAll() {
    state.pages.forEach((p) => p.items.forEach(measureItem));
  }
  function textWidth(text, size) {
    measureCtx.font = fontOf(size);
    return measureCtx.measureText(text).width;
  }

  const pressureWidth = (s, p) => s.width * (0.45 + p * 1.1);

  function drawStroke(c, s) {
    const pts = s.points;
    if (!pts.length) return;
    c.strokeStyle = s.color;
    c.fillStyle = s.color;
    c.lineCap = 'round';
    c.lineJoin = 'round';
    if (pts.length === 1) {
      c.beginPath();
      c.arc(pts[0][0], pts[0][1], pressureWidth(s, pts[0][2]) / 2, 0, Math.PI * 2);
      c.fill();
      return;
    }
    // 用相鄰點中點做二次曲線，筆跡比較平滑；每段寬度跟著壓力變化
    let sx = pts[0][0], sy = pts[0][1];
    for (let i = 1; i < pts.length; i++) {
      const cur = pts[i];
      const last = i === pts.length - 1;
      const ex = last ? cur[0] : (cur[0] + pts[i + 1][0]) / 2;
      const ey = last ? cur[1] : (cur[1] + pts[i + 1][1]) / 2;
      c.lineWidth = pressureWidth(s, (pts[i - 1][2] + cur[2]) / 2);
      c.beginPath();
      c.moveTo(sx, sy);
      c.quadraticCurveTo(cur[0], cur[1], ex, ey);
      c.stroke();
      sx = ex; sy = ey;
    }
  }

  function roundRectPath(c, x, y, w, h, r) {
    c.beginPath();
    if (c.roundRect) { c.roundRect(x, y, w, h, r); return; }
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function drawContent(c, page, opts = {}) {
    const dim = opts.dim;
    for (const it of page.items) {
      if (it.type !== 'highlight') continue;
      c.fillStyle = it.color;
      roundRectPath(c, it.x, it.y, it.w, it.h, it.h / 2);
      c.fill();
    }
    c.textBaseline = 'middle';
    c.textAlign = 'left';
    for (const it of page.items) {
      if (it.type !== 'text') continue;
      c.globalAlpha = dim && dim.has(it.id) ? 0.45 : 1;
      c.fillStyle = it.color;
      c.font = fontOf(it.size);
      c.fillText(it.text, it.x, it.y);
    }
    c.globalAlpha = 1;
    for (const s of page.strokes) drawStroke(c, s);
    if (opts.live) drawStroke(c, opts.live);
  }

  /** 縮圖 / 預覽用：在 canvas 上畫紙張底色與格線 */
  function drawPaperBg(c, w, h, type, cell, ox = 0, oy = 0) {
    c.fillStyle = '#FFFDF8';
    c.fillRect(0, 0, w, h);
    if (type === 'blank') return;
    c.strokeStyle = 'rgba(60, 72, 110, 0.13)';
    c.lineWidth = 1;
    c.beginPath();
    const gapY = type === 'lines' ? cell * (LINE_GAP / GRID) : cell;
    for (let y = ((oy % gapY) + gapY) % gapY; y < h; y += gapY) { c.moveTo(0, Math.round(y) + 0.5); c.lineTo(w, Math.round(y) + 0.5); }
    if (type === 'grid') {
      for (let x = ((ox % cell) + cell) % cell; x < w; x += cell) { c.moveTo(Math.round(x) + 0.5, 0); c.lineTo(Math.round(x) + 0.5, h); }
    }
    c.stroke();
  }

  // 主畫布 render（用 requestAnimationFrame 合併多次重畫）
  let renderQueued = false;
  function requestRender() {
    if (renderQueued) return;
    renderQueued = true;
    requestAnimationFrame(() => { renderQueued = false; render(); });
  }
  function activeDims() {
    const r = state.result;
    if (!r || !state.aiVisible || r.ds.errorStep == null) return null;
    return new Set(r.ds.lineIds.slice(r.ds.errorStep + 1));
  }
  function render() {
    const v = state.view2d;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * v.zoom, 0, 0, dpr * v.zoom, dpr * v.x, dpr * v.y);
    drawContent(ctx, curPage(), { dim: activeDims(), live: act && act.kind === 'draw' ? act.stroke : null });
  }

  function resizeCanvas() {
    const r = paperEl.getBoundingClientRect();
    if (!r.width || !r.height) return;
    dpr = window.devicePixelRatio || 1;
    canvas.width = Math.round(r.width * dpr);
    canvas.height = Math.round(r.height * dpr);
    render();
    updateArrow();
  }

  // ---------------------------------------------------------
  // 平移 / 縮放（無邊界白板）
  // ---------------------------------------------------------
  function applyView() {
    const { x, y, zoom } = state.view2d;
    paperEl.style.setProperty('--gx', x + 'px');
    paperEl.style.setProperty('--gy', y + 'px');
    paperEl.style.setProperty('--gs', GRID * zoom + 'px');
    paperEl.style.setProperty('--ls', LINE_GAP * zoom + 'px');
    worldEl.style.transform = `translate(${x}px, ${y}px) scale(${zoom})`;
    zoomLabel.textContent = Math.round(zoom * 100) + '%';
    $('#zoomOut').disabled = zoom <= ZOOM_MIN + 0.001;
    $('#zoomIn').disabled = zoom >= ZOOM_MAX - 0.001;
    requestRender();
    updateArrow();
    if (state.mode === 'select') updateSelectUI();
  }
  function zoomAt(z, clientX, clientY) {
    const v = state.view2d;
    z = clamp(z, ZOOM_MIN, ZOOM_MAX);
    const r = paperEl.getBoundingClientRect();
    const ax = clientX - r.left, ay = clientY - r.top;
    v.x = ax - (ax - v.x) * (z / v.zoom);
    v.y = ay - (ay - v.y) * (z / v.zoom);
    v.zoom = z;
    applyView();
  }
  function zoomStep(dir) {
    const z = state.view2d.zoom;
    const next = dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001);
    if (next == null) return;
    const r = paperEl.getBoundingClientRect();
    zoomAt(next, r.left + r.width / 2, r.top + r.height / 2);
  }
  function resetView() {
    state.view2d = { x: 0, y: 0, zoom: 1 };
    applyView();
  }
  function onWheel(e) {
    if (state.view !== 'notebook' || state.mode === 'confirm' || state.mode === 'checking') return;
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {                 // 觸控板雙指縮放 / Ctrl+滾輪
      zoomAt(state.view2d.zoom * Math.exp(-e.deltaY * 0.01), e.clientX, e.clientY);
      return;
    }
    let dx = e.deltaX, dy = e.deltaY;
    if (e.deltaMode === 1) { dx *= 16; dy *= 16; }
    if (e.shiftKey && !dx) { dx = dy; dy = 0; }
    state.view2d.x -= dx;
    state.view2d.y -= dy;
    applyView();
  }

  // ---------------------------------------------------------
  // 手寫輸入（Pointer Events）
  // ---------------------------------------------------------
  const touches = new Map();   // 目前在畫布上的手指
  let penSeen = false;         // 偵測到 Apple Pencil 後 → 手指只負責移動畫布（防手掌誤觸）
  let act = null;              // 目前進行中的動作：draw | erase | pan | pinch
  let spaceDown = false;

  const canInk = () => state.view === 'notebook' && (state.mode === 'draw' || state.mode === 'result');

  function toWorld(clientX, clientY) {
    const r = paperEl.getBoundingClientRect();
    const v = state.view2d;
    return { x: (clientX - r.left - v.x) / v.zoom, y: (clientY - r.top - v.y) / v.zoom };
  }
  const pressureOf = (e) => (e.pointerType === 'pen' ? (e.pressure > 0 ? e.pressure : 0.5) : 0.5);

  function onPointerDown(e) {
    if (!canInk() || e.target.closest('.anno-badge')) return;
    const type = e.pointerType;

    if (type === 'pen') {
      penSeen = true;
      if (act && act.pointerType !== 'pen') cancelAct();       // 筆優先：取消手指/手掌的動作
    }
    if (type === 'touch') {
      if (act && act.pointerType === 'pen') return;            // 筆正在寫字 → 忽略手掌
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size >= 2) { if (act) cancelAct(); startPinch(); return; }
      if (penSeen) { capture(e); startPan(e); return; }
    }
    if (act) return;

    if (type === 'mouse' && (e.button === 1 || (e.button === 0 && spaceDown))) { capture(e); startPan(e); return; }
    if (type === 'mouse' && e.button !== 0) return;

    e.preventDefault();
    capture(e);
    if (state.tool === 'pen') startDraw(e);
    else startErase(e);
  }

  function capture(e) {
    try { paperEl.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
  }

  function onPointerMove(e) {
    if (e.pointerType === 'touch' && touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (state.tool === 'eraser' && canInk() && (e.pointerType !== 'touch' || (act && act.kind === 'erase'))) {
      showEraserCursor(e.clientX, e.clientY);
    }
    if (!act) return;
    if (act.kind === 'pinch') { updatePinch(); return; }
    if (e.pointerId !== act.pointerId) return;

    if (act.kind === 'pan') {
      state.view2d.x = act.vx + (e.clientX - act.sx);
      state.view2d.y = act.vy + (e.clientY - act.sy);
      applyView();
      return;
    }

    let evs = e.getCoalescedEvents ? e.getCoalescedEvents() : null;
    if (!evs || !evs.length) evs = [e];

    if (act.kind === 'draw') {
      const pts = act.stroke.points;
      const minD = 0.75 / state.view2d.zoom;
      for (const ev of evs) {
        const p = toWorld(ev.clientX, ev.clientY);
        const last = pts[pts.length - 1];
        if (Math.hypot(p.x - last[0], p.y - last[1]) < minD) continue;
        pts.push([p.x, p.y, pressureOf(ev)]);
      }
      requestRender();
    } else if (act.kind === 'erase') {
      for (const ev of evs) {
        const p = toWorld(ev.clientX, ev.clientY);
        eraseSegment(act.last, p);
        act.last = p;
      }
      requestRender();
    }
  }

  function onPointerUp(e) {
    if (e.pointerType === 'touch') touches.delete(e.pointerId);
    if (!act) return;
    if (act.kind === 'pinch') {
      if (touches.size < 2) act = null;
      return;
    }
    if (e.pointerId !== act.pointerId) return;
    if (e.pointerType === 'touch' && act.kind === 'erase') hideEraserCursor();
    finishAct();
  }

  function startDraw(e) {
    const p = toWorld(e.clientX, e.clientY);
    act = {
      kind: 'draw',
      pointerId: e.pointerId,
      pointerType: e.pointerType,
      stroke: { id: uid(), color: PEN_COLORS[state.colorIdx], width: PEN_WIDTHS[state.penSize], points: [[p.x, p.y, pressureOf(e)]] },
    };
    requestRender();
  }
  function startErase(e) {
    const p = toWorld(e.clientX, e.clientY);
    act = { kind: 'erase', pointerId: e.pointerId, pointerType: e.pointerType, prev: curPage().strokes, last: p };
    eraseSegment(p, p);
    showEraserCursor(e.clientX, e.clientY);
    requestRender();
  }
  function startPan(e) {
    const v = state.view2d;
    act = { kind: 'pan', pointerId: e.pointerId, pointerType: e.pointerType, sx: e.clientX, sy: e.clientY, vx: v.x, vy: v.y };
    paperEl.classList.add('is-panning');
  }
  function startPinch() {
    const [a, b] = [...touches.values()];
    act = {
      kind: 'pinch',
      pointerType: 'touch',
      d0: Math.hypot(a.x - b.x, a.y - b.y) || 1,
      m0: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
      v0: { ...state.view2d },
    };
  }
  function updatePinch() {
    const vals = [...touches.values()];
    if (vals.length < 2) return;
    const [a, b] = vals;
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const r = paperEl.getBoundingClientRect();
    const v0 = act.v0;
    const z = clamp(v0.zoom * (d / act.d0), ZOOM_MIN, ZOOM_MAX);
    const wx = (act.m0.x - r.left - v0.x) / v0.zoom;
    const wy = (act.m0.y - r.top - v0.y) / v0.zoom;
    state.view2d = { zoom: z, x: m.x - r.left - wx * z, y: m.y - r.top - wy * z };
    applyView();
  }

  function finishAct() {
    const a = act;
    act = null;
    paperEl.classList.remove('is-panning');
    if (!a) return;
    const page = curPage();
    if (a.kind === 'draw') {
      const prev = page.strokes;
      page.strokes = prev.concat([a.stroke]);
      pushHistory(page, prev);
    } else if (a.kind === 'erase') {
      if (page.strokes !== a.prev) pushHistory(page, a.prev);
    }
    requestRender();
  }
  function cancelAct() {
    if (!act) return;
    if (act.kind === 'erase') curPage().strokes = act.prev;   // 還原被誤擦的筆跡
    act = null;
    paperEl.classList.remove('is-panning');
    hideEraserCursor();
    requestRender();
  }

  // ---------------------------------------------------------
  // 橡皮擦（整筆擦除 / 局部擦除）
  // ---------------------------------------------------------
  const bboxCache = new WeakMap();
  function bboxOf(s) {
    let b = bboxCache.get(s);
    if (b) return b;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of s.points) {
      if (p[0] < x0) x0 = p[0];
      if (p[1] < y0) y0 = p[1];
      if (p[0] > x1) x1 = p[0];
      if (p[1] > y1) y1 = p[1];
    }
    const pad = s.width * 1.2;
    b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    bboxCache.set(s, b);
    return b;
  }
  const nearBox = (b, x, y, r) => x >= b.x0 - r && x <= b.x1 + r && y >= b.y0 - r && y <= b.y1 + r;

  function distToSeg(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const len2 = dx * dx + dy * dy;
    let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function strokeHit(s, x, y, r) {
    if (!nearBox(bboxOf(s), x, y, r)) return false;
    const pts = s.points;
    const rr = r + s.width / 2;
    if (pts.length === 1) return Math.hypot(pts[0][0] - x, pts[0][1] - y) <= rr;
    for (let i = 1; i < pts.length; i++) {
      if (distToSeg(x, y, pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]) <= rr) return true;
    }
    return false;
  }
  /** 補點：讓點距不超過 gap，局部擦除才不會擦出鋸齒 */
  function densify(pts, gap) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i];
      const n = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / gap);
      for (let k = 1; k <= n; k++) {
        const t = k / n;
        out.push([a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]);
      }
    }
    return out;
  }
  /** 局部擦除：把被擦到的點挖掉，剩下的切成數段新筆跡；沒擦到回傳 null */
  function splitStroke(s, x, y, r) {
    if (!nearBox(bboxOf(s), x, y, r)) return null;
    const rr = r + s.width / 2;
    const rr2 = rr * rr;
    const pts = densify(s.points, Math.max(0.8, r / 3));
    const pieces = [];
    let cur = [];
    let hit = false;
    for (const q of pts) {
      const dx = q[0] - x, dy = q[1] - y;
      if (dx * dx + dy * dy <= rr2) {
        hit = true;
        if (cur.length) { pieces.push(cur); cur = []; }
      } else {
        cur.push(q);
      }
    }
    if (cur.length) pieces.push(cur);
    if (!hit) return null;
    return pieces.filter((pc) => pc.length >= 2).map((pc) => ({ id: uid(), color: s.color, width: s.width, points: pc }));
  }
  function eraseAt(x, y, r) {
    const page = curPage();
    const before = page.strokes;
    if (state.eraserMode === 'stroke') {
      const out = before.filter((s) => !strokeHit(s, x, y, r));
      if (out.length !== before.length) page.strokes = out;
    } else {
      let changed = false;
      const out = [];
      for (const s of before) {
        const parts = splitStroke(s, x, y, r);
        if (parts) { changed = true; out.push(...parts); } else out.push(s);
      }
      if (changed) page.strokes = out;
    }
  }
  function eraseSegment(a, b) {
    const r = ERASER_RADII[state.eraserSize] / state.view2d.zoom;
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.ceil(d / (r * 0.5)));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      eraseAt(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, r);
    }
  }
  function showEraserCursor(clientX, clientY) {
    const r = paperEl.getBoundingClientRect();
    const size = ERASER_RADII[state.eraserSize] * 2;
    eraserCursor.style.width = size + 'px';
    eraserCursor.style.height = size + 'px';
    eraserCursor.style.left = clientX - r.left + 'px';
    eraserCursor.style.top = clientY - r.top + 'px';
    eraserCursor.classList.add('is-show');
  }
  function hideEraserCursor() { eraserCursor.classList.remove('is-show'); }

  // ---------------------------------------------------------
  // 復原 / 重做（每頁各自獨立）
  // ---------------------------------------------------------
  function pushHistory(page, prevStrokes) {
    page.undo.push(prevStrokes);
    if (page.undo.length > 100) page.undo.shift();
    page.redo = [];
    afterChange();
  }
  function undo() {
    const p = curPage();
    if (act || !p.undo.length) return;
    p.redo.push(p.strokes);
    p.strokes = p.undo.pop();
    afterChange();
  }
  function redo() {
    const p = curPage();
    if (act || !p.redo.length) return;
    p.undo.push(p.strokes);
    p.strokes = p.redo.pop();
    afterChange();
  }
  function afterChange() {
    requestRender();
    updateUndoRedo();
    scheduleSave();
    scheduleThumb();
  }
  function updateUndoRedo() {
    const p = curPage();
    $('#btnUndo').disabled = !p.undo.length;
    $('#btnRedo').disabled = !p.redo.length;
  }

  // ---------------------------------------------------------
  // 工具列
  // ---------------------------------------------------------
  function setTool(tool) {
    state.tool = tool;
    if (tool !== 'eraser') hideEraserCursor();
    updateToolbarUI();
  }
  function updateToolbarUI() {
    $$('.tool-btn[data-tool]').forEach((b) => {
      const on = b.dataset.tool === state.tool;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-pressed', on);
    });
    $$('.swatch').forEach((b) => {
      const on = +b.dataset.color === state.colorIdx;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on);
    });
    const sizeIdx = state.tool === 'eraser' ? state.eraserSize : state.penSize;
    $$('.size-btn').forEach((b) => {
      const on = +b.dataset.size === sizeIdx;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on);
    });
    toolbar.style.setProperty('--dot', PEN_COLORS[state.colorIdx]);
    toolbar.classList.toggle('is-eraser', state.tool === 'eraser');
    eraserMenu.classList.toggle('is-open', state.tool === 'eraser');
    $$('#eraserMenu button').forEach((b) => b.classList.toggle('is-active', b.dataset.erase === state.eraserMode));
    paperEl.dataset.tool = state.tool;
  }

  // ---------------------------------------------------------
  // 頁面（左側縮圖）
  // ---------------------------------------------------------
  function renderPageList() {
    pageList.innerHTML = '';
    state.pages.forEach((p, i) => {
      const btn = document.createElement('button');
      btn.className = 'page-thumb' + (i === state.current ? ' is-active' : '');
      btn.setAttribute('aria-label', `第 ${i + 1} 頁`);
      const frame = document.createElement('div');
      frame.className = 'thumb-frame';
      const c = document.createElement('canvas');
      frame.appendChild(c);
      const num = document.createElement('span');
      num.textContent = i + 1;
      btn.append(frame, num);
      btn.addEventListener('click', () => switchPage(i));
      pageList.appendChild(btn);
      drawThumb(c, p);
    });
  }
  function drawThumb(c, page) {
    const w = 62, h = 80;
    c.width = w * dpr;
    c.height = h * dpr;
    const x = c.getContext('2d');
    x.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPaperBg(x, w, h, page.paper, 6);
    const sc = w / 1060;
    x.setTransform(dpr * sc, 0, 0, dpr * sc, 0, 0);
    drawContent(x, page);
  }
  let thumbTimer = null;
  function scheduleThumb() {
    clearTimeout(thumbTimer);
    thumbTimer = setTimeout(() => {
      const c = pageList.children[state.current] && pageList.children[state.current].querySelector('canvas');
      if (c) drawThumb(c, curPage());
    }, 250);
  }
  function switchPage(i) {
    if (i === state.current || act) return;
    if (state.result) clearResult();
    state.current = i;
    $$('.page-thumb', pageList).forEach((b, k) => b.classList.toggle('is-active', k === i));
    updatePaperUI();
    updateUndoRedo();
    requestRender();
    scheduleSave();
  }
  function addPage() {
    state.pages.push(makePage({ paper: curPage().paper }));
    renderPageList();
    switchPage(state.pages.length - 1);
    pageList.lastElementChild.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    toast(`已新增第 ${state.pages.length} 頁`);
  }

  // ---------------------------------------------------------
  // 紙張樣式
  // ---------------------------------------------------------
  function setPaper(type) {
    curPage().paper = type;
    updatePaperUI();
    scheduleSave();
    scheduleThumb();
  }
  function updatePaperUI() {
    const type = curPage().paper;
    paperEl.dataset.paper = type;
    $$('.paper-switch button').forEach((b) => {
      const on = b.dataset.paper === type;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-checked', on);
    });
  }

  // ---------------------------------------------------------
  // 模式切換
  // ---------------------------------------------------------
  function setMode(m) {
    state.mode = m;
    body.dataset.mode = m;
    if (m !== 'draw' && m !== 'result') hideEraserCursor();
    updateArrow();
  }

  // =========================================================
  // 畫面二：框選
  // =========================================================
  let sel = null;       // 選取框（螢幕座標）{ x, y, w, h }
  let selDrag = null;
  let selInfo = null;

  function enterSelect() {
    if (act) cancelAct();
    if (state.result) clearResult();
    sel = null;
    selInfo = null;
    setMode('select');
    updateSelectUI();
    if (!curPage().demo) toast('示範版：請切換到第 2 頁，框選例題的算式');
  }
  function exitSelect() {
    sel = null;
    setMode('draw');
  }
  function paperBounds() {
    return paperEl.getBoundingClientRect();
  }
  function analyzeSelection(rect) {
    const a = toWorld(rect.x, rect.y);
    const b = toWorld(rect.x + rect.w, rect.y + rect.h);
    const wr = { x: a.x, y: a.y, w: b.x - a.x, h: b.y - a.y };
    const page = curPage();
    const counts = {};
    for (const it of page.items) {
      if (!it.group || !it.bbox) continue;
      const cx = it.bbox.x + it.bbox.w / 2, cy = it.bbox.y + it.bbox.h / 2;
      if (cx >= wr.x && cx <= wr.x + wr.w && cy >= wr.y && cy <= wr.y + wr.h) counts[it.group] = (counts[it.group] || 0) + 1;
    }
    let group = null;
    for (const g of Object.keys(counts)) if (!group || counts[g] > counts[group]) group = g;
    const hasInk = page.strokes.some((s) => s.points.some((p) => p[0] >= wr.x && p[0] <= wr.x + wr.w && p[1] >= wr.y && p[1] <= wr.y + wr.h));
    return { group, count: group ? counts[group] : 0, hasInk, worldRect: wr };
  }
  function updateSelectUI() {
    const has = !!sel && sel.w > 0 && sel.h > 0;
    selectBox.hidden = !has;
    const settled = has && !selDrag;
    selectActions.hidden = !settled;
    if (!has) { selectDim.style.clipPath = ''; return; }

    // 遮罩挖一個洞：只有選取框內清楚可見
    const x1 = sel.x, y1 = sel.y, x2 = sel.x + sel.w, y2 = sel.y + sel.h;
    selectDim.style.clipPath =
      `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${x1}px ${y1}px, ${x2}px ${y1}px, ${x2}px ${y2}px, ${x1}px ${y2}px, ${x1}px ${y1}px)`;

    Object.assign(selectBox.style, { left: sel.x + 'px', top: sel.y + 'px', width: sel.w + 'px', height: sel.h + 'px' });

    selInfo = analyzeSelection(sel);
    const ok = !!selInfo.group;
    selLabel.classList.toggle('is-warn', !ok);
    selLabelText.textContent = ok
      ? `已選取 ${selInfo.count} 行算式`
      : selInfo.hasInk ? '示範版只能檢查例題，請框住例題 3 或例題 4' : '框內沒有算式，請重新框選';
    btnSelectGo.disabled = !ok;

    if (settled) {
      const aw = selectActions.offsetWidth || 230;
      const ah = selectActions.offsetHeight || 52;
      let top = sel.y + sel.h + 14;
      if (top + ah > window.innerHeight - 12) top = Math.max(12, sel.y + sel.h - ah - 12);
      const left = clamp(sel.x, 12, window.innerWidth - aw - 12);
      selectActions.style.left = left + 'px';
      selectActions.style.top = top + 'px';
    }
  }
  function onSelectDown(e) {
    if (e.target.closest('.select-guide, .select-actions')) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    const pr = paperBounds();
    const px = clamp(e.clientX, pr.left, pr.right);
    const py = clamp(e.clientY, pr.top, pr.bottom);
    const handle = e.target.closest('.sel-handle');
    if (handle && sel) {
      const k = handle.dataset.h;
      selDrag = {
        kind: 'resize',
        ax: k.includes('w') ? sel.x + sel.w : sel.x,
        ay: k.includes('n') ? sel.y + sel.h : sel.y,
      };
    } else if (sel && e.target.closest('.select-box')) {
      selDrag = { kind: 'move', sx: px, sy: py, orig: { ...sel } };
    } else {
      selDrag = { kind: 'new', ax: px, ay: py };
      sel = { x: px, y: py, w: 0, h: 0 };
    }
    try { selectLayer.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    selectLayer.classList.add('is-dragging');
    updateSelectUI();
  }
  function onSelectMove(e) {
    if (!selDrag) return;
    const pr = paperBounds();
    const px = clamp(e.clientX, pr.left, pr.right);
    const py = clamp(e.clientY, pr.top, pr.bottom);
    if (selDrag.kind === 'move') {
      const o = selDrag.orig;
      sel = {
        x: clamp(o.x + px - selDrag.sx, pr.left, pr.right - o.w),
        y: clamp(o.y + py - selDrag.sy, pr.top, pr.bottom - o.h),
        w: o.w, h: o.h,
      };
    } else {
      sel = {
        x: Math.min(selDrag.ax, px), y: Math.min(selDrag.ay, py),
        w: Math.abs(px - selDrag.ax), h: Math.abs(py - selDrag.ay),
      };
    }
    updateSelectUI();
  }
  function onSelectUp() {
    if (!selDrag) return;
    selDrag = null;
    selectLayer.classList.remove('is-dragging');
    if (sel && (sel.w < 24 || sel.h < 24)) sel = null;
    updateSelectUI();
  }

  // =========================================================
  // 畫面三：確認算式
  // =========================================================
  let pending = null;

  function enterConfirm(info) {
    pending = info;
    const ds = DATASETS[info.group];
    ocrList.innerHTML = '';
    ds.lines.forEach((text, i) => {
      const row = document.createElement('div');
      row.className = 'ocr-row' + (i === ds.blurry ? ' is-warn' : '');
      const label = i === 0 ? '題目' : `步驟 ${i}`;
      row.innerHTML =
        `<span class="ocr-tag${i === 0 ? ' is-q' : ''}">${label}</span>` +
        `<input class="ocr-input" type="text" spellcheck="false" autocomplete="off" autocapitalize="off" aria-label="${label}">` +
        (i === ds.blurry ? `<p class="ocr-warn">${icon('warn')}這行字跡較模糊，請再確認一次</p>` : '');
      const input = row.querySelector('input');
      input.value = text;
      input.addEventListener('input', () => {
        row.classList.remove('is-warn');
        row.classList.toggle('is-edited', input.value !== text);
      });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter') btnStartCheck.click(); });
      ocrList.appendChild(row);
    });
    setUnit(ds.unit, true);
    $('#unitMenu').hidden = true;
    setStepper(2);
    btnStartCheck.disabled = false;
    btnStartCheck.querySelector('span').textContent = '正確，開始檢查';
    setMode('confirm');
    requestAnimationFrame(() => drawPreview(info.worldRect));
  }
  function setUnit(name, auto) {
    $('#unitName').textContent = name;
    $('#unitHint').textContent = auto ? '（自動判斷）' : '（手動選擇）';
    $$('#unitMenu button').forEach((b) => b.classList.toggle('is-active', b.dataset.unit === name));
  }
  function setStepper(step) {
    $$('#stepper .st').forEach((li) => {
      const n = +li.dataset.step;
      li.classList.toggle('is-done', n < step);
      li.classList.toggle('is-active', n === step);
    });
    $$('#stepper .st-line').forEach((l, i) => l.classList.toggle('is-done', i + 2 <= step));
  }
  /** 「你的手寫」小畫布：把框選範圍畫出來給使用者對照 */
  function drawPreview(wr) {
    const r = previewCanvas.getBoundingClientRect();
    const w = r.width, h = r.height;
    if (!w || !h) return;
    previewCanvas.width = Math.round(w * dpr);
    previewCanvas.height = Math.round(h * dpr);
    const c = previewCanvas.getContext('2d');
    const pad = 14;
    const sc = Math.min((w - pad * 2) / wr.w, (h - pad * 2) / wr.h, 1.2);
    const ox = (w - wr.w * sc) / 2 - wr.x * sc;
    const oy = (h - wr.h * sc) / 2 - wr.y * sc;
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPaperBg(c, w, h, curPage().paper, GRID * sc, ox, oy);
    c.save();
    c.beginPath();
    c.rect((w - wr.w * sc) / 2, (h - wr.h * sc) / 2, wr.w * sc, wr.h * sc);
    c.clip();
    c.setTransform(dpr * sc, 0, 0, dpr * sc, dpr * ox, dpr * oy);
    drawContent(c, curPage());
    c.restore();
  }
  function closeConfirm() {
    $('#unitMenu').hidden = true;
    setMode('draw');
  }
  function startCheck() {
    if (state.mode !== 'confirm' || !pending) return;
    const lines = $$('.ocr-input', ocrList).map((i) => i.value.trim());
    if (lines.some((l) => !l)) {
      toast('有一行是空白的，請填入算式或重新框選');
      return;
    }
    $('#unitMenu').hidden = true;
    setMode('checking');
    setStepper(3);
    btnStartCheck.disabled = true;
    btnStartCheck.querySelector('span').textContent = 'AI 檢查中…';
    // 靜態模擬：假裝在等 AI 回應
    setTimeout(() => {
      if (state.mode !== 'checking') return;
      showResult(pending.group, lines);
    }, 1400);
  }

  // =========================================================
  // 畫面四：錯誤標註與提示
  // =========================================================
  function showResult(group, lines) {
    const ds = DATASETS[group];
    state.result = { group, ds, lines, anchor: null };
    state.aiVisible = true;
    aiToggle.classList.add('is-on');
    aiToggle.setAttribute('aria-checked', 'true');
    body.classList.remove('ai-hidden');
    body.classList.add('has-result', 'has-card');
    setMode('result');
    buildResultCard();
    buildAnnotations();
    ensureAnnotationVisible();
    requestRender();
  }
  function clearResult() {
    state.result = null;
    annoEl.innerHTML = '';
    resultCard.innerHTML = '';
    body.classList.remove('has-result', 'has-card', 'ai-hidden');
    updateArrow();
    requestRender();
  }
  function openCard() {
    if (!state.result) return;
    if (!state.aiVisible) toggleAI(true);
    body.classList.add('has-card');
    updateArrow();
  }
  function closeCard() {
    body.classList.remove('has-card');
    updateArrow();
  }

  function buildResultCard() {
    const { ds, lines } = state.result;
    const err = ds.errorStep;
    const rows = lines.map((text, i) => {
      let cls = '', st = 'ok', ic = 'check';
      if (err != null && i === err) { cls = 'is-err'; st = 'err'; ic = 'x'; }
      else if (err != null && i > err) { cls = 'is-pend'; st = 'pend'; ic = 'dash'; }
      return `<li class="${cls}"><span class="rc-st ${st}">${icon(ic)}</span>` +
        `<span class="rc-lbl">${i === 0 ? '題目' : '步驟 ' + i}</span>` +
        `<span class="rc-expr">${escapeHtml(text)}</span></li>`;
    }).join('');

    if (err != null) {
      resultCard.innerHTML = `
        <div class="rc-head">
          <div class="rc-icon">${icon('alert')}</div>
          <div class="rc-text">
            <div class="rc-title">第 ${err} 步出了點問題</div>
            <div class="rc-sub">錯誤類型：<b>${ds.errorType}</b></div>
          </div>
          <button class="rc-close" data-act="close" aria-label="關閉">${icon('x')}</button>
        </div>
        <ul class="rc-steps">${rows}</ul>
        <div class="rc-hint">
          ${icon('bulb')}
          <div><div class="rc-hint-label">提示</div><p>${ds.hint}</p></div>
        </div>
        <details class="rc-more">
          <summary>還是想不到？看完整解釋${icon('chev-down')}</summary>
          <p>${ds.explanation}</p>
        </details>
        <div class="rc-actions">
          <button class="btn btn-secondary" data-act="self">我自己訂正</button>
          <button class="btn btn-primary" data-act="recheck">訂正後再檢查</button>
        </div>`;
    } else {
      resultCard.innerHTML = `
        <div class="rc-head">
          <div class="rc-icon is-ok">${icon('check')}</div>
          <div class="rc-text">
            <div class="rc-title">全部正確，做得好！</div>
            <div class="rc-sub">這題沒有發現出錯的步驟</div>
          </div>
          <button class="rc-close" data-act="close" aria-label="關閉">${icon('x')}</button>
        </div>
        <ul class="rc-steps">${rows}</ul>
        <div class="rc-hint is-ok">
          ${icon('bulb')}
          <div><div class="rc-hint-label">小習慣</div><p>${ds.tip}</p></div>
        </div>
        <div class="rc-actions single">
          <button class="btn btn-primary" data-act="close">回到筆記</button>
        </div>`;
    }
  }

  function buildAnnotations() {
    annoEl.innerHTML = '';
    const r = state.result;
    if (!r) return;
    const page = curPage();
    const byId = (id) => page.items.find((it) => it.id === id);
    const add = (cls, style, html = '', tag = 'div') => {
      const el = document.createElement(tag);
      el.className = cls;
      Object.keys(style).forEach((k) => { el.style[k] = typeof style[k] === 'number' ? style[k] + 'px' : style[k]; });
      el.innerHTML = html;
      annoEl.appendChild(el);
      return el;
    };
    const ds = r.ds;

    if (ds.errorStep != null) {
      const errItem = byId(ds.lineIds[ds.errorStep]);
      const lastItem = byId(ds.lineIds[ds.lineIds.length - 1]);
      if (!errItem || !errItem.bbox) return;
      const b = errItem.bbox;
      const box = { x: b.x - 16, y: b.y - 2, w: b.w + 32, h: b.h + 4 };

      // 出錯那一行：紅色虛線框
      add('anno-box', { left: box.x, top: box.y, width: box.w, height: box.h });
      // 左上角數字徽章（點一下可以重新打開提示卡）
      const badge = add('anno-badge', { left: box.x - 15, top: box.y - 15 }, String(ds.errorStep), 'button');
      badge.setAttribute('aria-label', '查看第 ' + ds.errorStep + ' 步的提示');
      badge.addEventListener('click', openCard);
      // 關鍵詞小標籤
      const tagX = b.x + textWidth(ds.tagAnchor, errItem.size) - 8;
      add('anno-tag', { left: tagX, top: box.y - 14 }, escapeHtml(ds.tag));
      // 往下的淺紅色豎線 + 說明
      if (lastItem && lastItem.bbox) {
        const top = box.y + box.h + 8;
        const bottom = lastItem.bbox.y + lastItem.bbox.h;
        add('anno-vline', { left: box.x - 3, top, height: Math.max(10, bottom - top) });
        add('anno-note', { left: box.x + 2, top: bottom + 10 }, ds.affectNote);
      }
      r.anchor = { x: box.x + box.w, y: box.y + box.h / 2 };
    } else {
      const title = byId(ds.lineIds[0]);
      if (title && title.bbox) {
        add('anno-ok', { left: title.bbox.x + title.bbox.w + 14, top: title.bbox.y + title.bbox.h / 2 - 14 }, icon('check') + 'AI：全部正確');
        r.focus = { x: title.bbox.x + title.bbox.w + 150, y: title.bbox.y + 100 };
      }
      r.anchor = null;
    }
  }

  /** 如果出錯的那一行被提示卡蓋住或在畫面外，自動把畫布移過去 */
  function ensureAnnotationVisible() {
    const r = state.result;
    const target = r && (r.anchor || r.focus);
    if (!target) return;
    const pr = paperEl.getBoundingClientRect();
    const v = state.view2d;
    const cardLeft = pr.width - (resultCard.offsetWidth || 392) - 24;
    const sx = target.x * v.zoom + v.x;
    const sy = target.y * v.zoom + v.y;
    let dx = 0, dy = 0;
    if (sx > cardLeft - 40) dx = cardLeft - 60 - sx;
    if (sx < 80) dx = 80 - sx;
    if (sy < 120 || sy > pr.height - 120) dy = pr.height / 2 - sy;
    if (dx || dy) {
      v.x += dx;
      v.y += dy;
      applyView();
    }
  }

  /** 錯誤步驟 → 提示卡片 的紅色虛線箭頭（螢幕座標，平移/縮放時重算） */
  function updateArrow() {
    const r = state.result;
    const visible = r && r.anchor && state.aiVisible && state.mode === 'result' && body.classList.contains('has-card');
    if (!visible) { arrowLayer.classList.add('is-off'); return; }
    const pr = paperEl.getBoundingClientRect();
    const cr = resultCard.getBoundingClientRect();
    const v = state.view2d;
    const sx = r.anchor.x * v.zoom + v.x + 2;
    const sy = r.anchor.y * v.zoom + v.y;
    const ex = cr.left - pr.left;
    if (!cr.width || ex - sx < 30) { arrowLayer.classList.add('is-off'); return; }
    const ey = clamp(sy, cr.top - pr.top + 28, cr.bottom - pr.top - 28);
    const mx = (sx + ex) / 2;
    arrowPath.setAttribute('d', Math.abs(ey - sy) < 1
      ? `M${sx} ${sy} H${ex}`
      : `M${sx} ${sy} C${mx} ${sy} ${mx} ${ey} ${ex} ${ey}`);
    arrowDot.setAttribute('cx', ex);
    arrowDot.setAttribute('cy', ey);
    arrowLayer.classList.remove('is-off');
  }

  function toggleAI(force) {
    state.aiVisible = typeof force === 'boolean' ? force : !state.aiVisible;
    aiToggle.classList.toggle('is-on', state.aiVisible);
    aiToggle.setAttribute('aria-checked', String(state.aiVisible));
    body.classList.toggle('ai-hidden', !state.aiVisible);
    requestRender();
    requestAnimationFrame(updateArrow);
  }

  // =========================================================
  // 畫面五：學習分析
  // =========================================================
  function setView(v) {
    state.view = v;
    body.dataset.view = v;
    $('#viewNotebook').hidden = v !== 'notebook';
    $('#viewAnalysis').hidden = v !== 'analysis';
    if (v === 'analysis') {
      if (act) cancelAct();
      renderAnalysis();
    } else {
      requestAnimationFrame(resizeCanvas);
    }
  }
  function renderAnalysis() {
    const d = ANALYTICS[state.range];
    $$('#rangeTabs button').forEach((b) => {
      const on = b.dataset.range === state.range;
      b.classList.toggle('is-active', on);
      b.setAttribute('aria-selected', on);
    });

    // 統計卡片（數字跑動）
    $$('#stats .stat-card').forEach((card, i) => {
      const s = d.stats[i];
      card.classList.toggle('is-up', !!s.up);
      card.querySelector('.stat-label').textContent = s.label;
      card.querySelector('.stat-value span').textContent = s.unit;
      countUp(card.querySelector('.stat-value b'), s.value, s.prefix || '');
    });

    // 最常錯的步驟（長條圖）
    const max = Math.max(...d.bars.map((b) => b[1]));
    const bars = $('#bars');
    bars.innerHTML = d.bars.map(([name, n]) =>
      `<li><span>${name}</span><span class="bar-track"><span class="bar-fill" data-w="${(n / max) * 100}"></span></span><span class="bar-num">${n}</span></li>`
    ).join('');
    requestAnimationFrame(() => requestAnimationFrame(() => {
      $$('.bar-fill', bars).forEach((el) => { el.style.width = el.dataset.w + '%'; });
    }));

    // 正確率折線圖
    $('#chartTitle').textContent = d.chartTitle;
    buildLineChart($('#lineChart'), d.labels, d.values, d.tipLabels || d.labels);
  }
  function countUp(el, to, prefix) {
    const from = 0;
    const t0 = performance.now();
    const dur = 650;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur);
      const e = 1 - Math.pow(1 - k, 3);
      el.textContent = prefix + Math.round(from + (to - from) * e);
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }
  function buildLineChart(el, labels, values, tipLabels) {
    const W = 560, H = 232;
    const padL = 34, padR = 18, padT = 16, padB = 34;
    const lo = 40, hi = 80;
    const n = values.length;
    const x = (i) => padL + 18 + (i * (W - padL - padR - 36)) / Math.max(1, n - 1);
    const y = (v) => padT + ((hi - v) / (hi - lo)) * (H - padT - padB);
    const maxIdx = values.indexOf(Math.max(...values));

    let g = '';
    for (let t = hi; t >= lo; t -= 10) {
      g += `<line class="lc-grid" x1="${padL}" x2="${W - padR}" y1="${y(t)}" y2="${y(t)}"/>`;
      g += `<text class="lc-tick" x="${padL - 10}" y="${y(t) + 4}" text-anchor="end">${t}</text>`;
    }
    const pts = values.map((v, i) => [x(i), y(v)]);
    const line = pts.map((p, i) => (i ? 'L' : 'M') + p[0].toFixed(1) + ' ' + p[1].toFixed(1)).join(' ');
    const area = `${line} L${pts[n - 1][0].toFixed(1)} ${y(lo)} L${pts[0][0].toFixed(1)} ${y(lo)} Z`;
    const xl = labels.map((l, i) => `<text class="lc-xlabel" x="${x(i)}" y="${H - 8}" text-anchor="middle">${l}</text>`).join('');
    const dots = pts.map((p, i) => {
      const tip = `${tipLabels[i]} ${values[i]}%`;
      const tw = tip.length * 7.2 + 16;
      return `<g class="lc-pt${i === maxIdx ? ' is-max' : ''}">
          <circle class="hit" cx="${p[0]}" cy="${p[1]}" r="16"/>
          <circle cx="${p[0]}" cy="${p[1]}" r="${i === maxIdx ? 6.5 : 5.5}"/>
          <g class="lc-tip${i === maxIdx ? ' always' : ''}" transform="translate(${p[0]}, ${p[1] - 18})">
            <rect x="${-tw / 2}" y="-24" width="${tw}" height="22" rx="7"/>
            <text x="0" y="-9" text-anchor="middle">${tip}</text>
          </g>
        </g>`;
    }).join('');

    el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="正確率折線圖">
        ${g}
        <path class="lc-area" d="${area}"/>
        <path class="lc-line" d="${line}" pathLength="1"/>
        ${dots}
        ${xl}
      </svg>`;
  }

  // =========================================================
  // 事件綁定
  // =========================================================
  function bindEvents() {
    // 畫布
    paperEl.addEventListener('pointerdown', onPointerDown);
    paperEl.addEventListener('pointermove', onPointerMove);
    paperEl.addEventListener('pointerup', onPointerUp);
    paperEl.addEventListener('pointercancel', (e) => {
      if (e.pointerType === 'touch') touches.delete(e.pointerId);
      if (act && (act.kind === 'pinch' ? touches.size < 2 : e.pointerId === act.pointerId)) finishAct();
    });
    paperEl.addEventListener('pointerleave', (e) => { if (!act || act.kind !== 'erase') hideEraserCursor(); });
    paperEl.addEventListener('wheel', onWheel, { passive: false });
    paperEl.addEventListener('contextmenu', (e) => e.preventDefault());
    // Safari 的手勢事件（避免整頁被縮放）
    ['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => e.preventDefault()));

    new ResizeObserver(() => resizeCanvas()).observe(paperEl);
    window.addEventListener('resize', () => { if (state.mode === 'select') updateSelectUI(); updateArrow(); });

    // 工具列
    $$('.tool-btn[data-tool]').forEach((b) => b.addEventListener('click', () => setTool(b.dataset.tool)));
    $$('.swatch').forEach((b) => b.addEventListener('click', () => {
      state.colorIdx = +b.dataset.color;
      setTool('pen');
      scheduleSave();
    }));
    $$('.size-btn').forEach((b) => b.addEventListener('click', () => {
      if (state.tool === 'eraser') state.eraserSize = +b.dataset.size;
      else state.penSize = +b.dataset.size;
      updateToolbarUI();
      scheduleSave();
    }));
    $$('#eraserMenu button').forEach((b) => b.addEventListener('click', () => {
      state.eraserMode = b.dataset.erase;
      updateToolbarUI();
      scheduleSave();
    }));
    $('#btnUndo').addEventListener('click', undo);
    $('#btnRedo').addEventListener('click', redo);

    // 紙張 / 縮放 / 頁面
    $$('.paper-switch button').forEach((b) => b.addEventListener('click', () => setPaper(b.dataset.paper)));
    $('#zoomIn').addEventListener('click', () => zoomStep(1));
    $('#zoomOut').addEventListener('click', () => zoomStep(-1));
    $('#zoomReset').addEventListener('click', resetView);
    $('#btnAddPage').addEventListener('click', addPage);

    // Header
    $('#btnAICheck').addEventListener('click', enterSelect);
    $('#btnShare').addEventListener('click', () => toast('分享功能會在之後串接後端時開放'));
    $('#btnAnalysis').addEventListener('click', () => { location.hash = 'analysis'; });
    aiToggle.addEventListener('click', () => toggleAI());

    // 框選
    selectLayer.addEventListener('pointerdown', onSelectDown);
    selectLayer.addEventListener('pointermove', onSelectMove);
    selectLayer.addEventListener('pointerup', onSelectUp);
    selectLayer.addEventListener('pointercancel', onSelectUp);
    selectLayer.addEventListener('wheel', onWheel, { passive: false });
    $('#btnSelectCancel').addEventListener('click', exitSelect);
    $('#btnReselect').addEventListener('click', () => { sel = null; updateSelectUI(); });
    btnSelectGo.addEventListener('click', () => { if (selInfo && selInfo.group) enterConfirm(selInfo); });

    // 確認算式
    $('#btnConfirmReselect').addEventListener('click', () => { if (state.mode === 'confirm') enterSelect(); });
    btnStartCheck.addEventListener('click', startCheck);
    $('#btnUnitChange').addEventListener('click', (e) => {
      const m = $('#unitMenu');
      m.hidden = !m.hidden;
      e.currentTarget.setAttribute('aria-expanded', String(!m.hidden));
    });
    $$('#unitMenu button').forEach((b) => b.addEventListener('click', () => {
      setUnit(b.dataset.unit, false);
      $('#unitMenu').hidden = true;
    }));

    // 提示卡片
    resultCard.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-act]');
      if (!btn) return;
      const a = btn.dataset.act;
      if (a === 'close') closeCard();
      else if (a === 'self') {
        closeCard();
        setTool('pen');
        toast('直接在旁邊寫下訂正，寫好再按「AI 檢查」');
      } else if (a === 'recheck') enterSelect();
    });
    resultCard.addEventListener('animationend', updateArrow);
    resultCard.addEventListener('toggle', () => requestAnimationFrame(updateArrow), true);

    // 學習分析
    $('#btnBack').addEventListener('click', () => {
      if (history.length > 1 && cameFromNotebook) history.back();
      else location.hash = '';
    });
    $$('#rangeTabs button').forEach((b) => b.addEventListener('click', () => {
      if (state.range === b.dataset.range) return;
      state.range = b.dataset.range;
      renderAnalysis();
    }));
    $('#btnPractice').addEventListener('click', () => toast('練習題功能會在之後的版本開放'));
    $$('[data-retry]').forEach((b) => b.addEventListener('click', () => {
      if (b.dataset.retry === 'ex3') {
        location.hash = '';
        const idx = state.pages.findIndex((p) => p.demo);
        if (idx >= 0) switchPage(idx);
        toast('回到例題 3 了，試著重新算一次吧');
      } else {
        toast('這題的練習會在之後的版本開放');
      }
    }));

    let cameFromNotebook = false;
    window.addEventListener('hashchange', () => {
      const toAnalysis = location.hash === '#analysis';
      cameFromNotebook = toAnalysis && state.view === 'notebook';
      setView(toAnalysis ? 'analysis' : 'notebook');
    });

    // 鍵盤快捷鍵
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', (e) => {
      if (e.code === 'Space') { spaceDown = false; paperEl.classList.remove('can-pan'); }
    });
    window.addEventListener('blur', () => { spaceDown = false; paperEl.classList.remove('can-pan'); });
  }

  function onKeyDown(e) {
    const typing = e.target.matches && e.target.matches('input, textarea, select, [contenteditable="true"]');
    if (e.key === 'Escape') {
      if (state.mode === 'select') exitSelect();
      else if (state.mode === 'confirm') closeConfirm();
      else if (state.mode === 'result' && body.classList.contains('has-card')) closeCard();
      return;
    }
    if (typing || state.view !== 'notebook') return;
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (state.mode !== 'draw' && state.mode !== 'result') return;
    if (mod && k === 'z') { e.preventDefault(); if (e.shiftKey) redo(); else undo(); return; }
    if (mod && k === 'y') { e.preventDefault(); redo(); return; }
    if (mod || e.altKey) return;
    if (k === 'p') setTool('pen');
    else if (k === 'e') setTool('eraser');
    else if (/^[1-6]$/.test(e.key)) { state.colorIdx = +e.key - 1; setTool('pen'); }
    else if (e.code === 'Space') {
      e.preventDefault();
      spaceDown = true;
      paperEl.classList.add('can-pan');
    }
  }

  // =========================================================
  // 啟動
  // =========================================================
  function init() {
    if (!loadSaved()) {
      state.pages = createDefaultPages();
      state.current = 1;
    }
    measureAll();
    bindEvents();
    renderPageList();
    updateToolbarUI();
    updatePaperUI();
    updateUndoRedo();
    applyView();
    setSaveStatus('saved');
    setView(location.hash === '#analysis' ? 'analysis' : 'notebook');
    resizeCanvas();

    // 手寫字型載入後重新量測與重畫（canvas 不會自動換字型）
    if (document.fonts && document.fonts.load) {
      const sample = '例題解方程式重點移項要變號過去答案四０123456789x+−=()÷×＋－，！（）/ ';
      const refresh = () => {
        measureAll();
        requestRender();
        renderPageList();
        if (state.result) buildAnnotations();
      };
      document.fonts.load(`40px "LXGW WenKai TC"`, sample).then(refresh).catch(() => {});
      document.fonts.ready.then(refresh).catch(() => {});
    }
  }

  init();
})();
