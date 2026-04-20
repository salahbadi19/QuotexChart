/**
 * 📈 chart.js — v1.2 (Fixed Zoom Direction + All Previous Improvements)
 * =============================================================================
 * ✅ FIXED: Zoom direction now matches user expectation (scroll up = zoom in)
 * ✅ Fixed crosshair to follow mouse smoothly (no magnetic jumping)
 * ✅ Safe DOM initialization with dependency checks
 * ✅ Dynamic price precision based on asset type
 * ✅ Pane management with proper event listener cleanup
 * ✅ Security: textContent instead of innerHTML for dynamic content
 * ✅ Better error logging instead of silent failures
 * ✅ Logarithmic zoom for more natural mouse-wheel scaling
 * 
 * Dependencies: globals.js (AppState, debounceRender, addTrackedEventListener)
 */

// =============================================================================
// 🔒 Dependency Check (Prevent silent failures)
// =============================================================================
(function checkDependencies() {
    const required = ['AppState', 'debounceRender', 'addTrackedEventListener'];
    const missing = required.filter(name => typeof window[name] === 'undefined');
    if (missing.length > 0) {
        console.warn(`⚠️ chart.js requires these globals: ${missing.join(', ')}`);
        console.warn('💡 Ensure globals.js loads before chart.js');
    }
})();

// =============================================================================
// 💎 Dynamic Price Precision by Asset Type
// =============================================================================
const PRICE_PRECISION_MAP = {
    'BTC': { precision: 2, minMove: 0.01 },
    'ETH': { precision: 3, minMove: 0.001 },
    'JPY': { precision: 3, minMove: 0.001 },
    'FOREX': { precision: 5, minMove: 0.00001 },
    'STOCKS': { precision: 2, minMove: 0.01 },
    'DEFAULT': { precision: 5, minMove: 0.00001 }
};

function getPricePrecisionForAsset(asset) {
    const upper = (asset || '').toUpperCase();
    if (upper.includes('BTC')) return PRICE_PRECISION_MAP.BTC;
    if (upper.includes('ETH')) return PRICE_PRECISION_MAP.ETH;
    if (upper.includes('JPY')) return PRICE_PRECISION_MAP.JPY;
    if (upper.includes('OTC') || /[A-Z]{3}\/[A-Z]{3}/.test(upper)) return PRICE_PRECISION_MAP.FOREX;
    return PRICE_PRECISION_MAP.DEFAULT;
}

function updateChartPricePrecision(asset) {
    const { precision, minMove } = getPricePrecisionForAsset(asset);
    try {
        if (window.candleSeries) {
            window.candleSeries.applyOptions({ 
                priceFormat: { type: 'price', precision, minMove } 
            });
            if (window.chart) {
                window.chart.applyOptions({
                    localization: {
                        priceFormatter: (price) => price.toFixed(precision)
                    }
                });
            }
        }
    } catch(e) { 
        console.warn('⚠️ Failed to update price precision:', e); 
    }
}

// =============================================================================
// 🎨 Color Helper — Read from AppState (single source of truth)
// =============================================================================
function getChartColors() {
    const cs = AppState?.chartColors || {};
    return {
        background: cs.background || '#050814',
        text: cs.text || '#93c5fd',
        grid: cs.grid || '#1e3a8a',
        priceText: cs.priceText || '#93c5fd',
        timeText: cs.timeText || '#6b7280',
        crosshair: cs.crosshair || '#60a5fa',
        bullBody: cs.bullBody || '#00C510',
        bullBorder: cs.bullBorder || '#00C510',
        bullWick: cs.bullWick || '#00C510',
        bearBody: cs.bearBody || '#ff0000',
        bearBorder: cs.bearBorder || '#ff0000',
        bearWick: cs.bearWick || '#ff0000'
    };
}

// =============================================================================
// 📊 Lightweight Charts Initialization — FIXED CROSSHAIR
// =============================================================================
function initChartSafely() {
    const container = document.getElementById('mainChartWrap');
    if (!container) {
        console.error('❌ #mainChartWrap not found');
        return false;
    }
    
    const rect = container.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
        setTimeout(initChartSafely, 100);
        return false;
    }
    
    try {
        const colors = getChartColors();
        const assetPrecision = getPricePrecisionForAsset(AppState?.currentAsset);

        window.chart = LightweightCharts.createChart(container, {
            layout: {
                background: { color: colors.background },
                textColor: colors.text,
                fontFamily: "'Cormorant Garamond', serif"
            },
            grid: {
                vertLines: { color: colors.grid, style: 3 },
                horzLines: { color: colors.grid, style: 3 }
            },
            crosshair: {
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { 
                    color: colors.crosshair + '80', 
                    width: 1, 
                    style: LightweightCharts.LineStyle.Solid, 
                    labelBackgroundColor: colors.background,
                    textColor: colors.text,
                    visible: true
                },
                horzLine: { 
                    color: colors.crosshair + '80', 
                    width: 1, 
                    style: LightweightCharts.LineStyle.Solid, 
                    labelBackgroundColor: colors.background,
                    textColor: colors.text,
                    visible: true
                }
            },
            handleScroll: { 
                mouseWheel: true, 
                pressedMouseMove: true,
                horzTouchDrag: true,
                vertTouchDrag: false
            },
            handleScale: { 
                axisPressedMouseMove: { time: false, price: true }, 
                mouseWheel: false,
                pinch: false
            },
            rightPriceScale: {
                visible: true, 
                borderColor: colors.grid + '40',
                textColor: colors.priceText, 
                entireTextOnly: false, 
                minimumWidth: 70,
                scaleMargins: { top: 0.15, bottom: 0.15 },
                autoScale: true,
                invertScale: false
            },
            timeScale: {
                visible: true, 
                borderColor: colors.grid + '40',
                timeVisible: true, 
                secondsVisible: true,
                minBarSpacing: 4, 
                maxBarSpacing: 15,
                fixLeftEdge: false, 
                fixRightEdge: false, 
                borderVisible: true,
                rightOffset: 10,
                barSpacing: 6
            },
            localization: {
                priceFormatter: (price) => price.toFixed(assetPrecision.precision),
                timeFormatter: (time) => new Date(time * 1000).toLocaleTimeString()
            }
        });

        window.candleSeries = window.chart.addCandlestickSeries({
            upColor: colors.bullBody, 
            downColor: colors.bearBody,
            borderUpColor: colors.bullBorder, 
            borderDownColor: colors.bearBorder,
            wickUpColor: colors.bullWick, 
            wickDownColor: colors.bearWick,
            borderVisible: true,
            priceFormat: { 
                type: 'price', 
                precision: assetPrecision.precision, 
                minMove: assetPrecision.minMove 
            },
            lastValueVisible: false, 
            priceLineVisible: false,
            wickVisible: true,
            borderVisible: true
        });

        console.log('✅ Chart initialized with fixed crosshair');
        return true;
    } catch(e) {
        console.error('💥 Chart init failed:', e);
        if (typeof toast === 'function') {
            toast('Chart failed: ' + e.message, 'error');
        }
        return false;
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initChartSafely);
} else {
    setTimeout(initChartSafely, 50);
}

// =============================================================================
// 🖱️ Chart Interactions — FIXED ZOOM DIRECTION
// =============================================================================
function setupChartInteractions() {
    if (!window.chart || !window.candleSeries) return;
    
    window.chart.subscribeCrosshairMove((param) => {
        AppState.isUserInteracting = true;
        clearTimeout(window.userInteractTimer);
        window.userInteractTimer = setTimeout(() => { 
            AppState.isUserInteracting = false; 
        }, 2000);
    });

    window.chart.timeScale().subscribeVisibleTimeRangeChange(() => {
        AppState.isUserInteracting = true;
        clearTimeout(window.userInteractTimer);
        window.userInteractTimer = setTimeout(() => { 
            AppState.isUserInteracting = false; 
        }, 2000);
    });

    const chartContainerEl = document.getElementById('mainChartWrap');
    if (chartContainerEl && typeof addTrackedEventListener === 'function') {
        addTrackedEventListener(chartContainerEl, 'wheel', (e) => {
            e.preventDefault();
            const timeScale = window.chart.timeScale();
            const logicalRange = timeScale.getVisibleLogicalRange();
            if (!logicalRange) return;
            
            const rect = chartContainerEl.getBoundingClientRect();
            const mouseX = e.clientX - rect.left;
            const ratio = mouseX / rect.width;
            const rangeSize = logicalRange.to - logicalRange.from;
            const intensity = Math.min(Math.abs(e.deltaY), 100) / 100;
            
            // ✅ FIXED: Removed negative sign for correct zoom direction
            // Scroll UP (deltaY < 0) → zoomFactor < 1 → zoom IN
            // Scroll DOWN (deltaY > 0) → zoomFactor > 1 → zoom OUT
            const zoomFactor = Math.exp(e.deltaY * 0.001 * intensity);
            
            const newRange = rangeSize * zoomFactor;
            const center = logicalRange.from + rangeSize * ratio;
            
            timeScale.setVisibleLogicalRange({ 
                from: center - newRange * ratio, 
                to: center + newRange * (1 - ratio) 
            });
        }, { passive: false });
    }
}

// =============================================================================
// 🏗️ ChartManager Class — Pane management with proper cleanup
// =============================================================================
class ChartManager {
    constructor() {
        this.mainChart = window.chart;
        this.mainSeries = window.candleSeries;
        this.panes = new Map();
        this._allCharts = window.chart ? [{ 
            chart: window.chart, 
            el: document.getElementById('mainChartWrap'), 
            main: true 
        }] : [];
        this.drawLines = [];
        this._resizeObserver = null;
        this._paneResizeObserver = null;
        this._markersDirty = true;
        this._resizeHandlers = new Map();
        this._initObservers();
    }

    _initObservers() {
        const mainEl = document.getElementById('mainChartWrap');
        if (mainEl && typeof ResizeObserver !== 'undefined') {
            this._resizeObserver = new ResizeObserver(() => this._scheduleResize());
            this._resizeObserver.observe(mainEl);
            this._paneResizeObserver = new ResizeObserver(() => this._scheduleResize());
        }
    }

    createPane(id, name) {
        if (!window.chart) { console.warn('Chart not ready'); return null; }
        if (this.panes.has(id)) { this.panes.get(id).refs++; return this.panes.get(id).chart; }
        
        const area = document.getElementById('indicatorArea');
        if (!area) return null;
        
        const box = document.createElement('div'); box.className = 'pane-box'; box.id = 'pb-' + id;
        const rh = document.createElement('div'); rh.className = 'pane-resize'; rh.dataset.pid = id;
        const lbl = document.createElement('div'); lbl.className = 'pane-label';
        
        const nameSpan = document.createElement('span');
        nameSpan.textContent = name;
        const closeBtn = document.createElement('span');
        closeBtn.className = 'pane-x';
        closeBtn.dataset.pid = id;
        closeBtn.innerHTML = '&#10005;';
        lbl.append(nameSpan, closeBtn);
        
        const cd = document.createElement('div'); cd.className = 'pane-chart'; cd.id = 'pc-' + id;
        box.append(rh, lbl, cd); area.appendChild(box); area.classList.add('has-panes');
        
        const colors = getChartColors();
        const ch = LightweightCharts.createChart(cd, {
            layout: { background: { color: 'transparent' }, textColor: colors.priceText },
            grid: { vertLines: { color: colors.grid + '22', style: 1 }, horzLines: { color: colors.grid + '22', style: 1 } },
            crosshair: { 
                mode: LightweightCharts.CrosshairMode.Normal,
                vertLine: { visible: false },
                horzLine: { visible: true, color: colors.crosshair, width: 1, labelBackgroundColor: colors.background, textColor: colors.text }
            },
            rightPriceScale: { borderColor: colors.grid + '40', textColor: colors.priceText },
            timeScale: { borderColor: colors.grid + '40', visible: true, timeVisible: true },
            handleScroll: false, handleScale: false
        });
        
        this.panes.set(id, { chart: ch, el: cd, box, name, refs: 1 });
        this._allCharts.push({ chart: ch, el: cd, main: false });
        this._sync(ch);
        this._initPaneResize(rh, id);
        if (this._paneResizeObserver) this._paneResizeObserver.observe(cd);
        this._scheduleResize();
        return ch;
    }

    releasePane(id) {
        if (!this.panes.has(id)) return;
        const p = this.panes.get(id); p.refs--;
        if (p.refs <= 0) {
            const handlers = this._resizeHandlers.get(id);
            if (handlers) {
                document.removeEventListener('mousemove', handlers.onMove);
                document.removeEventListener('mouseup', handlers.onUp);
                this._resizeHandlers.delete(id);
            }
            if (this._paneResizeObserver) this._paneResizeObserver.unobserve(p.el);
            try { p.chart.remove(); } catch(e) { console.warn(`⚠️ Error removing chart ${id}:`, e); }
            if (p.box?.parentNode) p.box.parentNode.removeChild(p.box);
            this._allCharts = this._allCharts.filter(x => x.chart !== p.chart);
            this.panes.delete(id);
            if (this.panes.size === 0) document.getElementById('indicatorArea')?.classList.remove('has-panes');
        }
        this._scheduleResize();
    }

    _initPaneResize(handle, pid) {
        let startY = 0, startH = 0;
        const self = this;
        const onMove = e => {
            if (!handle.classList.contains('active')) return;
            const d = e.clientY - startY;
            const nH = Math.max(40, startH + d);
            const pane = self.panes.get(pid);
            if (pane) { pane.box.style.height = nH + 'px'; self._scheduleResize(); }
        };
        const onUp = () => {
            if (!handle.classList.contains('active')) return;
            handle.classList.remove('active');
            document.getElementById('pb-' + pid)?.classList.remove('resizing');
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };
        handle.addEventListener('mousedown', e => {
            startY = e.clientY; startH = document.getElementById('pb-' + pid)?.offsetHeight || 40;
            handle.classList.add('active'); document.getElementById('pb-' + pid)?.classList.add('resizing');
            document.body.style.cursor = 'ns-resize'; document.body.style.userSelect = 'none'; e.preventDefault();
            document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp);
            this._resizeHandlers.set(pid, { onMove, onUp });
        });
    }

    _layout() {
        const mw = document.getElementById('mainChartWrap');
        const ar = document.getElementById('indicatorArea');
        if (!mw || !ar) return;
        if (this.panes.size === 0) { mw.style.flex = '1'; ar.style.flex = '0'; ar.style.height = ''; }
        else { mw.style.flex = '7'; ar.style.flex = '3'; }
    }

    _sync(src) {
        let syncing = false;
        src.timeScale().subscribeVisibleLogicalRangeChange(r => {
            if (!r || syncing) return; syncing = true;
            this._allCharts.forEach(x => { 
                if (x.chart !== src) try { x.chart.timeScale().setVisibleLogicalRange(r); } catch(e) { console.warn('⚠️ Sync failed:', e); } 
            });
            syncing = false;
        });
    }

    _resize() {
        requestAnimationFrame(() => {
            this._allCharts.forEach(x => {
                if (x.el) {
                    const r = x.el.getBoundingClientRect();
                    if (r.width > 0 && r.height > 0) {
                        try { x.chart.resize(r.width, r.height); } catch(e) { console.warn(`⚠️ Resize failed for ${x.el?.id}:`, e); }
                    }
                }
            });
        });
    }

    _scheduleResize() {
        if (!this._resizeDebounce) {
            this._resizeDebounce = debounceRender(() => { this._layout(); this._resize(); }, 16);
        }
        this._resizeDebounce();
    }

    updateAllMarkers() {
        if (!this._markersDirty || !this.mainSeries) return;
        const unique = new Map();
        Object.values(AppState.indicators).forEach(inst => {
            inst._markers?.forEach(m => {
                const k = m.id || `${m.time}_${m.position}`;
                if (!unique.has(k)) unique.set(k, m);
            });
        });
        try { this.mainSeries.setMarkers(Array.from(unique.values())); } catch(e) { console.warn('⚠️ Failed to set markers:', e); }
        this._markersDirty = false;
    }

    markMarkersDirty() { this._markersDirty = true; }

    destroy() {
        if (this._resizeObserver) this._resizeObserver.disconnect();
        if (this._paneResizeObserver) this._paneResizeObserver.disconnect();
        this._resizeHandlers.forEach((handlers, pid) => {
            document.removeEventListener('mousemove', handlers.onMove);
            document.removeEventListener('mouseup', handlers.onUp);
        });
        this._resizeHandlers.clear();
        this.panes.forEach((p, id) => this.releasePane(id));
        this._allCharts = [];
    }
}

// =============================================================================
// ✅ GLOBAL EXPORTS & INITIALIZATION
// =============================================================================
window.ChartManager = ChartManager;
window.setupChartInteractions = setupChartInteractions;
window.updateChartPricePrecision = updateChartPricePrecision;
window.initChartSafely = initChartSafely;
window.getPricePrecisionForAsset = getPricePrecisionForAsset;
window.getChartColors = getChartColors;

function initChartManager() {
    if (window.chart && window.candleSeries && typeof ChartManager !== 'undefined') {
        try {
            window.CM = new ChartManager();
            setupChartInteractions();
            console.log('✅ ChartManager initialized with improvements');
            return true;
        } catch(e) { console.error('❌ ChartManager init failed:', e); return false; }
    }
    return false;
}

(function initCMDeferred() {
    if (!initChartManager()) {
        setTimeout(() => { if (!initChartManager()) { console.warn('⚠️ ChartManager retry...'); setTimeout(initChartManager, 200); } }, 100);
    }
})();

console.log('✅ chart.js v1.2 loaded — Zoom direction fixed, all improvements included');
