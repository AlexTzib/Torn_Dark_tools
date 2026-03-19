  /* ===================================================================
   *  TPDA Common Code — shared across all Torn Dark Tools scripts
   *  This file is injected by build.py at the // #COMMON_CODE marker.
   *  It assumes these are already defined in scope:
   *    SCRIPT_KEY, BUBBLE_ID, PANEL_ID, HEADER_ID, BUBBLE_SIZE, STATE
   * =================================================================== */

  /* ── Shared API key storage ────────────────────────────────── */
  const SHARED_API_KEY_STORAGE = 'tpda_shared_api_key';

  /* ── Utility functions ─────────────────────────────────────── */

  function nowTs() { return Date.now(); }
  function nowUnix() { return Math.floor(Date.now() / 1000); }

  function safeJsonParse(text) {
    try { return JSON.parse(text); } catch { return null; }
  }

  function formatNumber(n) { return Number(n ?? 0).toLocaleString(); }

  function formatMoney(n) {
    const v = Number(n || 0);
    if (!v) return '\u2014';
    return '$' + Math.round(v).toLocaleString();
  }

  function formatSeconds(sec) {
    sec = Math.floor(Number(sec || 0));
    if (sec <= 0) return 'now';
    const d = Math.floor(sec / 86400);
    const h = Math.floor((sec % 86400) / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = sec % 60;
    const parts = [];
    if (d) parts.push(`${d}d`);
    if (h) parts.push(`${h}h`);
    if (m) parts.push(`${m}m`);
    parts.push(`${s}s`);
    return parts.join(' ');
  }

  function ageText(ts) {
    if (!ts) return 'never';
    return `${formatSeconds(Math.floor((Date.now() - ts) / 1000))} ago`;
  }

  function escapeHtml(str) {
    return String(str ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  }

  /* ── Storage helpers ───────────────────────────────────────── */

  function getStorage(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch {
      return fallback;
    }
  }

  function setStorage(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {}
  }

  /* ── Debug log ─────────────────────────────────────────────── */

  function addLog(msg) {
    const ts = new Date().toLocaleTimeString();
    STATE._logs.push(`[${ts}] ${msg}`);
    if (STATE._logs.length > 200) STATE._logs.shift();
  }

  /* ── Shared API key management ─────────────────────────────── */

  function getSharedApiKey() {
    return getStorage(SHARED_API_KEY_STORAGE, '');
  }

  function setSharedApiKey(key) {
    setStorage(SHARED_API_KEY_STORAGE, key || '');
  }

  function migrateApiKeyToShared() {
    /* If shared key already exists, nothing to do */
    if (getSharedApiKey()) return;
    /* Try to migrate from per-script key */
    const legacy = getStorage(`${SCRIPT_KEY}_api_key`, '') || getStorage(`${SCRIPT_KEY}_apikey`, '');
    if (legacy) {
      setSharedApiKey(legacy);
      addLog('Migrated API key to shared storage');
    }
  }

  function extractApiKeyFromUrl(url) {
    if (STATE.apiKeySource === 'manual' || STATE.apiKeySource === 'pda') return;
    try {
      const u = new URL(url, location.origin);
      const key = u.searchParams.get('key');
      if (key && key.length >= 16) {
        STATE.apiKey = key;
        STATE.apiKeySource = 'intercepted';
        addLog('API key captured from network traffic');
      }
    } catch {}
  }

  /* ── API key UI (collapsed by default) ─────────────────────── */

  function renderApiKeyCard() {
    const keyDisplay = STATE.apiKey
      ? `Active (${escapeHtml(STATE.apiKeySource || 'unknown')})`
      : 'Not available';
    const sourceHint = STATE.apiKeySource === 'pda'
      ? 'Using Torn PDA key automatically. Manual entry below is optional (overrides PDA key).'
      : 'In Torn PDA the key is loaded automatically. Outside PDA, paste your key below.';
    return `
      <div style="margin-bottom:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#141821;">
        <div class="tpda-apikey-toggle" style="font-weight:bold;cursor:pointer;user-select:none;">
          \u25B6 API Key: ${keyDisplay}
        </div>
        <div class="tpda-apikey-body" style="display:none;margin-top:8px;">
          <div style="font-size:11px;color:#bbb;margin-bottom:6px;">${sourceHint}</div>
          <div style="display:flex;gap:8px;">
            <input class="tpda-apikey-input" type="password" value="${escapeHtml(getSharedApiKey())}" placeholder="Your Torn API key"
                   style="flex:1;background:#0f1116;color:#fff;border:1px solid #444;border-radius:8px;padding:8px;" />
            <button class="tpda-apikey-save" style="background:#444;color:white;border:none;border-radius:8px;padding:8px 10px;">Save</button>
          </div>
        </div>
      </div>
    `;
  }

  function handleApiKeyClick(e, container, onSave) {
    /* Toggle collapsed/expanded */
    const toggle = e.target.closest('.tpda-apikey-toggle');
    if (toggle) {
      const body = container.querySelector('.tpda-apikey-body');
      if (body) {
        const show = body.style.display === 'none';
        body.style.display = show ? 'block' : 'none';
        toggle.textContent = (show ? '\u25BC' : '\u25B6') + toggle.textContent.slice(1);
      }
      return true;
    }
    /* Save button */
    const save = e.target.closest('.tpda-apikey-save');
    if (save) {
      const input = container.querySelector('.tpda-apikey-input');
      const val = String(input?.value || '').trim();
      setSharedApiKey(val);
      if (val) {
        STATE.apiKey = val;
        STATE.apiKeySource = 'manual';
      } else {
        STATE.apiKeySource = '';
      }
      addLog('API key saved (shared)');
      if (onSave) onSave();
      return true;
    }
    return false;
  }

  /* ── Debug log UI ──────────────────────────────────────────── */

  function renderLogCard() {
    return `
      <div style="margin-top:10px;padding:10px;border:1px solid #2f3340;border-radius:10px;background:#0f1116;">
        <div class="tpda-log-toggle" style="display:flex;justify-content:space-between;align-items:center;cursor:pointer;">
          <div style="font-weight:bold;font-size:12px;">Debug Log (${STATE._logs.length})</div>
          <button class="tpda-log-copy" style="background:#333;color:#bbb;border:none;border-radius:6px;padding:4px 8px;font-size:11px;cursor:pointer;">Copy Log</button>
        </div>
        <div class="tpda-log-body" style="display:none;margin-top:8px;max-height:200px;overflow-y:auto;font-size:11px;color:#aaa;font-family:monospace;white-space:pre-wrap;word-break:break-all;">${STATE._logs.map(l => escapeHtml(l)).join('\n')}</div>
      </div>
    `;
  }

  function handleLogClick(e, container) {
    const toggle = e.target.closest('.tpda-log-toggle');
    if (toggle && !e.target.closest('.tpda-log-copy')) {
      const body = container.querySelector('.tpda-log-body');
      if (body) body.style.display = body.style.display === 'none' ? 'block' : 'none';
      return true;
    }
    const copyBtn = e.target.closest('.tpda-log-copy');
    if (copyBtn) {
      const text = STATE._logs.join('\n');
      navigator.clipboard.writeText(text).then(() => {
        copyBtn.textContent = 'Copied!';
        setTimeout(() => { copyBtn.textContent = 'Copy Log'; }, 1200);
      }).catch(() => {});
      return true;
    }
    return false;
  }

  /* ── UI core ───────────────────────────────────────────────── */

  function getBubbleEl() { return document.getElementById(BUBBLE_ID); }
  function getPanelEl() { return document.getElementById(PANEL_ID); }

  function bringToFront(el) {
    STATE.ui.zIndexBase += 1;
    if (el) el.style.zIndex = String(STATE.ui.zIndexBase);
  }

  function clampToViewport(left, top, width, height) {
    const maxLeft = Math.max(0, window.innerWidth - width - 4);
    const maxTop = Math.max(0, window.innerHeight - height - 4);
    return {
      left: Math.min(Math.max(4, left), maxLeft),
      top: Math.min(Math.max(4, top), maxTop)
    };
  }

  function bubbleRightBottomToLeftTop(pos, size) {
    return {
      left: window.innerWidth - size - pos.right,
      top: window.innerHeight - size - pos.bottom
    };
  }

  function leftTopToBubbleRightBottom(left, top, size) {
    return {
      right: Math.max(0, window.innerWidth - size - left),
      bottom: Math.max(0, window.innerHeight - size - top)
    };
  }

  function getDefaultBubblePosition() {
    const existing = document.querySelectorAll('[data-tpda-bubble="1"]').length;
    return { right: 12, bottom: 12 + existing * (BUBBLE_SIZE + 12) };
  }

  function getBubblePosition() { return getStorage(`${SCRIPT_KEY}_bubble_pos`, getDefaultBubblePosition()); }
  function setBubblePosition(pos) { setStorage(`${SCRIPT_KEY}_bubble_pos`, pos); }
  function getPanelPosition() { return getStorage(`${SCRIPT_KEY}_panel_pos`, null); }
  function setPanelPosition(pos) { setStorage(`${SCRIPT_KEY}_panel_pos`, pos); }

  function copyToClipboard(text, buttonEl) {
    navigator.clipboard.writeText(text).then(() => {
      if (buttonEl) {
        const orig = buttonEl.textContent;
        buttonEl.textContent = 'Copied!';
        setTimeout(() => { buttonEl.textContent = orig; }, 1200);
      }
    }).catch(() => {});
  }

  /* ── Draggable bubble ──────────────────────────────────────── */

  function makeDraggableBubble(el) {
    let startX = null, startY = null, originLeft = 0, originTop = 0, dragging = false;

    el.addEventListener('pointerdown', (e) => {
      dragging = false;
      el.dataset.dragged = '0';
      el.setPointerCapture?.(e.pointerId);
      bringToFront(el);
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      startX = e.clientX; startY = e.clientY;
      originLeft = current.left; originTop = current.top;
    });

    el.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      if (Math.abs(dx) > 4 || Math.abs(dy) > 4) dragging = true;
      if (!dragging) return;
      const clamped = clampToViewport(originLeft + dx, originTop + dy, BUBBLE_SIZE, BUBBLE_SIZE);
      el.style.left = `${clamped.left}px`;
      el.style.top = `${clamped.top}px`;
      el.style.right = ''; el.style.bottom = '';
      el.dataset.dragged = '1';
    });

    function finishDrag() {
      if (startX === null) return;
      if (dragging) {
        const left = parseFloat(el.style.left || '0'), top = parseFloat(el.style.top || '0');
        setBubblePosition(leftTopToBubbleRightBottom(left, top, BUBBLE_SIZE));
      }
      startX = null; startY = null;
    }
    el.addEventListener('pointerup', finishDrag);
    el.addEventListener('pointercancel', finishDrag);
  }

  /* ── Draggable panel ───────────────────────────────────────── */

  function makeDraggablePanel(panel, handle) {
    let startX = null, startY = null, originLeft = 0, originTop = 0;

    handle.addEventListener('pointerdown', (e) => {
      if (e.target.closest('button') || e.target.closest('input')) return;
      handle.setPointerCapture?.(e.pointerId);
      bringToFront(panel);
      const rect = panel.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      originLeft = rect.left; originTop = rect.top;
    });

    handle.addEventListener('pointermove', (e) => {
      if (startX === null) return;
      const dx = e.clientX - startX, dy = e.clientY - startY;
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(originLeft + dx, originTop + dy, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
    });

    function finish() {
      if (startX === null) return;
      const rect = panel.getBoundingClientRect();
      setPanelPosition({ left: rect.left, top: rect.top });
      startX = null; startY = null;
    }
    handle.addEventListener('pointerup', finish);
    handle.addEventListener('pointercancel', finish);
  }

  /* ── Expand / collapse / resize ────────────────────────────── */

  function expandPanelNearBubble() {
    STATE.ui.minimized = false;
    const bubble = getBubbleEl(), panel = getPanelEl();
    if (!bubble || !panel) return;

    bringToFront(panel);
    bubble.style.display = 'none';
    panel.style.display = 'flex';

    const pw = panel.offsetWidth || 400, ph = panel.offsetHeight || 500;
    const saved = getPanelPosition();
    if (saved && typeof saved.left === 'number' && typeof saved.top === 'number') {
      const clamped = clampToViewport(saved.left, saved.top, pw, ph);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
    } else {
      const bRect = bubble.getBoundingClientRect();
      let left = bRect.left - pw + 60, top = bRect.top - 120;
      if (left < 4) left = 4;
      if (top < 4) top = 4;
      const clamped = clampToViewport(left, top, pw, ph);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
      setPanelPosition(clamped);
    }

    /* Script-specific hook — called after positioning */
    if (typeof onPanelExpand === 'function') onPanelExpand();
  }

  function collapseToBubble() {
    /* Script-specific hook — called before hiding */
    if (typeof onPanelCollapse === 'function') onPanelCollapse();
    STATE.ui.minimized = true;
    const bubble = getBubbleEl(), panel = getPanelEl();
    if (!bubble || !panel) return;
    panel.style.display = 'none';
    bubble.style.display = 'flex';
    bringToFront(bubble);
  }

  function onResize() {
    const bubble = getBubbleEl(), panel = getPanelEl();

    if (bubble && bubble.style.display !== 'none') {
      const pos = getBubblePosition();
      const current = bubbleRightBottomToLeftTop(pos, BUBBLE_SIZE);
      const clamped = clampToViewport(current.left, current.top, BUBBLE_SIZE, BUBBLE_SIZE);
      const next = leftTopToBubbleRightBottom(clamped.left, clamped.top, BUBBLE_SIZE);
      setBubblePosition(next);
      bubble.style.left = ''; bubble.style.top = '';
      bubble.style.right = `${next.right}px`;
      bubble.style.bottom = `${next.bottom}px`;
    }

    if (panel && panel.style.display !== 'none') {
      const rect = panel.getBoundingClientRect();
      const clamped = clampToViewport(rect.left, rect.top, rect.width, rect.height);
      panel.style.left = `${clamped.left}px`;
      panel.style.top = `${clamped.top}px`;
      panel.style.right = ''; panel.style.bottom = '';
      setPanelPosition({ left: clamped.left, top: clamped.top });
    }
  }

  /* ── Common API key initialization ─────────────────────────── */

  function initApiKey(pdaInjectedKey) {
    migrateApiKeyToShared();
    /* Priority 1: PDA-injected key */
    if (pdaInjectedKey && pdaInjectedKey.length >= 16 && !pdaInjectedKey.includes('#')) {
      STATE.apiKey = pdaInjectedKey;
      STATE.apiKeySource = 'pda';
      addLog('API key loaded from Torn PDA');
      return;
    }
    /* Priority 2: shared manual key */
    const saved = getSharedApiKey();
    if (saved) {
      STATE.apiKey = saved;
      STATE.apiKeySource = 'manual';
      addLog('API key loaded from shared storage');
      return;
    }
    /* Priority 3: will be filled by network interception */
    addLog('No API key yet \u2014 waiting for PDA injection or manual entry');
  }
