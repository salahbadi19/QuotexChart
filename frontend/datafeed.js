/**
 * 📡 datafeed.js — v1.1 (Improved & Hardened)
 * =============================================================================
 * ✅ Lazy-cached UI getters for better performance
 * ✅ CONFIG constants instead of magic numbers
 * ✅ Protected countdown animation against memory leaks
 * ✅ Dependency validation in critical functions
 * ✅ Safe candle snapshot for concurrent indicator updates
 * ✅ Immediate indicator cleanup on error
 * ✅ Resilient countdown label with auto-recovery
 * ✅ Enhanced connection state with visual feedback
 * ✅ Proper error logging throughout
 * 
 * Dependencies: chart.js, indicators.js, editor.js
 */

// =============================================================================
// ⚙️ CONFIGURATION CONSTANTS (No more magic numbers)
// =============================================================================
const CONFIG = {
    // Storage
    STORAGE_VERSION: 1,
    STORAGE_KEY: 'qx_data_v1',
    MAX_STORAGE_SIZE: 4 * 1024 * 1024,  // 4MB limit
    
    // Connection & Eel
    EEL_TIMEOUT_MS: 5000,               // Timeout for Eel calls before fallback
    CONNECTION_TIMEOUT_MS: 10000,       // Time without data before marking connection weak
    CONNECTION_CHECK_INTERVAL_MS: 5000, // How often to check connection health
    
    // Chart & Data
    MAX_CANDLES_FALLBACK: 200,          // Number of candles to keep on restore
    MAX_CANDLES_DISPLAY: 1000,          // Max candles to send to chart at once
    
    // Countdown Timer
    COUNTDOWN_UPDATE_MS: 1000,          // Update countdown display every second
    COUNTDOWN_COLOR: '#d4af37',         // Gold color for countdown label
    
    // Performance
    DEBOUNCE_RENDER_MS: 16,             // ~60fps for visual updates
    DEBOUNCE_LOGIC_MS: 500,             // 2Hz for logic/storage updates
    
    // UI
    TOAST_DURATION_MS: 3000,            // Default toast notification duration
    INTERACTION_TIMEOUT_MS: 2000        // Time after user stops interacting
};

// =============================================================================
// 🌍 GLOBAL UI CACHE (Lazy-loaded for performance)
// =============================================================================
const UI = {
    _cache: {},
    
    // Helper: Lazy-load and cache DOM element
    _get(id) {
        return this._cache[id] || (this._cache[id] = document.getElementById(id));
    },
    
    // DOM getters (cached after first access)
    get currentAsset() { return this._get('currentAsset'); },
    get currentTimeframe() { return this._get('currentTimeframe'); },
    get editorStatus() { return this._get('editorStatus'); },
    get btnRun() { return this._get('btnRun'); },
    get btnStop() { return this._get('btnStop'); },
    get indicatorName() { return this._get('indicatorName'); },
    get errorCard() { return this._get('errorCard'); },
    get assetsModal() { return this._get('assetsModal'); },
    get timeframesModal() { return this._get('timeframesModal'); },
    get indicatorsModal() { return this._get('indicatorsModal'); },
    get indSettingsModal() { return this._get('indSettingsModal'); },
    get editorPanel() { return this._get('editorPanel'); },
    get monacoContainer() { return this._get('monacoEditorContainer'); },
    get tabBar() { return this._get('tabBar'); },
    get newFileCard() { return this._get('newFileCard'); },
    get nfFileName() { return this._get('nfFileName'); },
    get nfError() { return this._get('nfError'); },
    get nfTemplates() { return this._get('nfTemplates'); },
    get templateSelect() { return this._get('templateSelect'); },
    get settingsPanel() { return this._get('settings-panel'); },
    get indicatorsList() { return this._get('indicatorsList'); },
    get modalAssetSearch() { return this._get('modalAssetSearch'); },
    get assetsModalContent() { return this._get('assetsModalContent'); },
    get timeframesModalContent() { return this._get('timeframesModalContent'); },
    get indSettingsTitle() { return this._get('indSettingsTitle'); },
    get indSettingsContent() { return this._get('indSettingsContent'); },
    get errorType() { return this._get('errorType'); },
    get errorLineBadge() { return this._get('errorLineBadge'); },
    get errorMsg() { return this._get('errorMsg'); },
    get editorInfo() { return this._get('editorInfo'); },
    get chartBgColor() { return this._get('chartBgColor'); },
    get gridColor() { return this._get('gridColor'); },
    get textColor() { return this._get('textColor'); },
    get upColor() { return this._get('upColor'); },
    get downColor() { return this._get('downColor'); }
};

// =============================================================================
// 📊 APP STATE
// =============================================================================
const AppState = {
    currentAsset: "AUD/CAD (OTC)",
    currentTimeframe: "1m",
    timeframeSeconds: 60,
    serverTimeOffset: 0,
    isFirstLoad: true,
    currentCandles: [],
    allCategories: null,
    needsFullRedraw: false,
    isUserInteracting: false,
    previousCandleTime: null,
    indicators: {},
    editorFiles: {},
    editorActive: null,
    monacoEditor: null,
    monacoReady: false,
    errorDecorations: [],
    chartColors: { background: '#0a0f1c', grid: '#1e293b', text: '#bfdbfe' },
    debugMode: false,
    connectionHealthy: true,
    lastDataTime: Date.now(),
    _eventListeners: []
};

// Global handles
let CM = null;
let countdownLabel = null;
let countdownAnimationId = null;
let userInteractTimer = null;
let connectionCheckInterval = null;

// =============================================================================
// 🛡️ UTILITIES & VALIDATION
// =============================================================================
const RESERVED_WORDS = new Set([
    'break','case','catch','class','const','continue','debugger','default',
    'delete','do','else','export','extends','false','finally','for','function',
    'if','import','in','instanceof','new','null','return','super','switch',
    'this','throw','true','try','typeof','var','void','while','with','yield',
    'IndicatorBase','Indicators','AppState','UI','CM'
]);

function sanitizeIndicatorName(name) {
    let s = String(name || '').replace(/[^a-zA-Z0-9_]/g, '');
    return (s && /^[0-9]/.test(s)) ? 'Ind_' + s : s;
}

function isValidIndicatorName(name) {
    return /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name) && !RESERVED_WORDS.has(name.toLowerCase());
}

function debugLog(...args) { 
    if (AppState.debugMode) console.log(`[DEBUG]`, ...args); 
}

function isValidCandle(c) {
    return c && typeof c === 'object' &&
        typeof c.time === 'number' && typeof c.open === 'number' &&
        typeof c.high === 'number' && typeof c.low === 'number' && typeof c.close === 'number' &&
        !isNaN(c.open) && !isNaN(c.high) && !isNaN(c.low) && !isNaN(c.close) &&
        c.high >= c.low && c.high >= c.open && c.high >= c.close && 
        c.low <= c.open && c.low <= c.close;
}

function validateCandleData(candles) { 
    return Array.isArray(candles) && candles.every(isValidCandle); 
}

// =============================================================================
// 💾 STORAGE & EVENT MANAGEMENT
// =============================================================================
function safeSaveStorage(data) {
    try {
        const str = JSON.stringify(data);
        if (str.length > CONFIG.MAX_STORAGE_SIZE) {
            console.warn('⚠️ Storage near limit, consider clearing old data');
        }
        localStorage.setItem(CONFIG.STORAGE_KEY, str); 
        return true;
    } catch(e) { 
        console.warn('❌ Storage save failed:', e); 
        return false; 
    }
}

function safeLoadStorage() {
    try {
        const raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        return raw ? JSON.parse(raw) : null;
    } catch(e) { 
        console.warn('❌ Storage load failed:', e); 
        return null; 
    }
}

function addTrackedEventListener(target, event, handler, options) {
    target.addEventListener(event, handler, options);
    AppState._eventListeners.push({ target, event, handler, options });
    return handler;
}

function removeAllTrackedEventListeners() {
    AppState._eventListeners.forEach(({ target, event, handler, options }) => {
        try { 
            target.removeEventListener(event, handler, options); 
        } catch(e) {
            console.warn('⚠️ Failed to remove event listener:', e);
        }
    });
    AppState._eventListeners = [];
}

// =============================================================================
// ⚡ PERFORMANCE: DEBOUNCER & SAFE EEL
// =============================================================================
function createDebouncer(useRaf = true, defaultDelay = CONFIG.DEBOUNCE_RENDER_MS) {
    return function(fn, delay) {
        let t;
        return (...args) => {
            const exec = () => fn.apply(this, args);
            if (useRaf) { 
                if (t) cancelAnimationFrame(t); 
                t = requestAnimationFrame(exec); 
            } else { 
                clearTimeout(t); 
                t = setTimeout(exec, delay !== undefined ? delay : defaultDelay); 
            }
        };
    };
}

const debounceRender = createDebouncer(true, CONFIG.DEBOUNCE_RENDER_MS);
const debounceLogic = createDebouncer(false, CONFIG.DEBOUNCE_LOGIC_MS);

function safeEelCall(fn, ...args) {
    return new Promise((resolve) => {
        const timeout = setTimeout(() => {
            console.warn(`⏱ EEL call timeout after ${CONFIG.EEL_TIMEOUT_MS}ms, using fallback`);
            // ✅ Mark connection as weak for UI feedback
            AppState.connectionHealthy = false;
            if (typeof toast === 'function') {
                toast('Weak connection - displaying cached data', 'warning');
            }
            resolve(fallbackData());
        }, CONFIG.EEL_TIMEOUT_MS);
        
        try {
            const result = fn(...args)();
            if (result && typeof result.then === 'function') {
                result
                    .then(data => { 
                        clearTimeout(timeout); 
                        // ✅ Restore connection health on success
                        AppState.connectionHealthy = true;
                        resolve(data); 
                    })
                    .catch(err => { 
                        clearTimeout(timeout); 
                        console.warn('⚠️ EEL promise rejected:', err);
                        resolve(fallbackData()); 
                    });
            } else { 
                clearTimeout(timeout); 
                AppState.connectionHealthy = true;
                resolve(result); 
            }
        } catch(e) { 
            clearTimeout(timeout); 
            console.warn('❌ EEL call error:', e); 
            resolve(fallbackData()); 
        }
    });
}

function fallbackData() {
    return { 
        candles: AppState.currentCandles || [], 
        asset: AppState.currentAsset, 
        timeframe: AppState.currentTimeframe, 
        timeframe_seconds: AppState.timeframeSeconds 
    };
}

// =============================================================================
// ⏱ COUNTDOWN TIMER — Hardened Version
// =============================================================================

// ✅ Create countdown label (single instance) with auto-recovery
function ensureCountdownLabel() {
    // ✅ Check if chart series exists before creating label
    if (!countdownLabel && window.candleSeries) {
        try {
            countdownLabel = window.candleSeries.createPriceLine({
                price: 0,
                color: CONFIG.COUNTDOWN_COLOR,
                lineWidth: 0,               // Invisible line, label only
                axisLabelVisible: true,     // Show on right price scale
                title: '⏱ --:--',           // Countdown placeholder
                priceLineVisible: true      // Required for label visibility
            });
            debugLog('✅ Countdown label created');
        } catch(e) {
            console.warn('⚠️ Failed to create countdown label:', e);
            countdownLabel = null;
        }
    }
    return countdownLabel;
}

// ✅ Call on new candle - initializes countdown with candle end time
function updateCountdown(candle) {
    if (!candle || !window.candleSeries) return;
    const label = ensureCountdownLabel();
    if (label) {
        label.candleEndTime = candle.time + AppState.timeframeSeconds;
        // Initial update with current price
        animateCountdown(candle.close);
    }
}

// ✅ Animation loop: updates price + countdown together (no jitter)
function animateCountdown(currentPrice) {
    // ✅ Safety check: stop if chart/label removed during animation
    if (!window.candleSeries || !countdownLabel) {
        if (countdownAnimationId) {
            clearTimeout(countdownAnimationId);
            countdownAnimationId = null;
        }
        return;
    }
    
    const label = ensureCountdownLabel();
    if (!label || AppState.currentCandles.length === 0) {
        if (countdownAnimationId) clearTimeout(countdownAnimationId);
        countdownAnimationId = null;
        return;
    }
    
    const now = (Date.now() / 1000) + AppState.serverTimeOffset;
    let remaining = Math.max(0, Math.floor(label.candleEndTime - now));
    const mins = Math.floor(remaining / 60).toString().padStart(2, '0');
    const secs = (remaining % 60).toString().padStart(2, '0');
    
    // ✅ Update price and countdown together in single applyOptions call
    try {
        // ✅ Check label is still valid before updating
        if (typeof label.applyOptions === 'function') {
            label.applyOptions({ 
                price: currentPrice, 
                title: `⏱ ${mins}:${secs}` 
            });
        }
    } catch(e) { 
        console.warn('⚠️ Countdown update failed:', e);
        // ✅ Attempt recovery: clear and recreate label
        countdownLabel = null;
        ensureCountdownLabel();
        countdownAnimationId = null;
        return; 
    }
    
    if (remaining > 0) {
        // ✅ Update every second only (not every tick) to prevent visual jitter
        countdownAnimationId = setTimeout(() => {
            // ✅ Double-check chart still exists before recursing
            if (!window.candleSeries || !countdownLabel) {
                countdownAnimationId = null;
                return;
            }
            const lastPrice = AppState.currentCandles[AppState.currentCandles.length - 1]?.close || currentPrice;
            animateCountdown(lastPrice);
        }, CONFIG.COUNTDOWN_UPDATE_MS);
    } else {
        countdownAnimationId = null;
    }
}

// =============================================================================
// 📥 MAIN DATA HANDLER (Eel Exposed)
// =============================================================================
if (typeof eel !== 'undefined' && eel.expose) {
    eel.expose(updateChart);
}

function updateChart(data) {
    try {
        AppState.lastDataTime = Date.now();
        AppState.connectionHealthy = true;

        if (AppState.needsFullRedraw) {
            AppState.needsFullRedraw = false;
            AppState.isFirstLoad = true;
        }

        if (!data || !data.candles || !Array.isArray(data.candles)) { 
            debugLog('📥 Invalid data structure'); 
            return; 
        }
        
        const validCandles = data.candles.filter(isValidCandle);
        if (!validCandles.length) { 
            debugLog('📥 No valid candles after filtering'); 
            return; 
        }

        // ✅ Create snapshot for safe concurrent reading by indicators
        const candlesSnapshot = [...validCandles];
        
        // Update main state
        AppState.currentCandles = validCandles;
        
        if (UI.currentAsset) {
            UI.currentAsset.textContent = data.asset || AppState.currentAsset;
        }
        AppState.currentTimeframe = data.timeframe || AppState.currentTimeframe;
        AppState.timeframeSeconds = data.timeframe_seconds || AppState.timeframeSeconds;
        AppState.serverTimeOffset = (data.server_time || 0) - (Date.now() / 1000);

        const lastCandle = validCandles[validCandles.length - 1];
        const isNewCandle = lastCandle.time !== AppState.previousCandleTime;
        AppState.previousCandleTime = lastCandle.time;

        // ✅ First Load: Initialize chart with full dataset
        if (AppState.isFirstLoad && window.candleSeries) {
            try { 
                // Limit initial load for performance
                const initialData = validCandles.slice(-CONFIG.MAX_CANDLES_DISPLAY);
                window.candleSeries.setData(initialData); 
            } catch(e) { 
                console.warn('⚠️ Initial setData failed, trying fallback:', e);
                if (AppState.currentCandles.length) {
                    window.candleSeries.setData(AppState.currentCandles.slice(-CONFIG.MAX_CANDLES_FALLBACK)); 
                }
            }
            if (lastCandle) updateCountdown(lastCandle);
            if (CM && typeof CM._scheduleResize === 'function') {
                CM._scheduleResize(); 
            }
            if (!AppState.isUserInteracting && window.chart) {
                window.chart.timeScale().fitContent(); 
            }
            // Initialize indicators with snapshot
            for (const inst of Object.values(AppState.indicators)) { 
                try { 
                    inst.update(candlesSnapshot); 
                } catch(e) { 
                    debugLog('⚠️ Indicator init error:', e); 
                } 
            }
            AppState.isFirstLoad = false;
            return;
        }

        // ✅ Live Update: Update candle series with latest price
        if (window.candleSeries) {
            try { 
                window.candleSeries.update(lastCandle); 
            } catch(e) { 
                console.warn('⚠️ Live candle update failed:', e); 
            }
        }
        
        // ✅ Update countdown with new price (moves together with candle)
        if (isNewCandle) {
            updateCountdown(lastCandle);
        } else {
            animateCountdown(lastCandle.close); // ✅ Pass live price for smooth update
        }

        // ✅ Indicator Updates: Use snapshot to avoid read/write conflicts
        for (const [name, inst] of Object.entries(AppState.indicators)) {
            try {
                if (!inst._initialized) continue;
                
                if (isNewCandle) {
                    // Full recalculation on new candle
                    inst.update(candlesSnapshot);
                } else if (inst.hasCustomUpdateLast && inst.hasCustomUpdateLast()) {
                    // Lightweight update for live candle
                    inst.updateLast(lastCandle);
                }
            } catch(e) {
                console.error(`❌ Indicator [${name}] error:`, e);
                
                // ✅ Immediate cleanup: remove from state regardless of cleanupIndicator result
                try {
                    if (typeof window.cleanupIndicator === 'function') {
                        window.cleanupIndicator(name);
                    }
                } catch(cleanupErr) {
                    console.warn(`⚠️ cleanupIndicator failed for ${name}:`, cleanupErr);
                } finally {
                    // ✅ Always remove from AppState to prevent further errors
                    delete AppState.indicators[name];
                }
                
                // Update UI state
                if (AppState.editorFiles[name]) {
                    AppState.editorFiles[name].runState = 'error';
                }
                if (typeof window.renderTabs === 'function') {
                    window.renderTabs();
                }
            }
        }
        
        // ✅ Update markers if chart manager available
        if (CM && typeof CM.markMarkersDirty === 'function') { 
            CM.markMarkersDirty(); 
            CM.updateAllMarkers(); 
        }

    } catch(e) {
        console.error('💥 Critical updateChart error:', e);
        
        // ✅ Attempt graceful recovery with limited dataset
        try { 
            if (AppState.currentCandles?.length && window.candleSeries) {
                window.candleSeries.setData(
                    AppState.currentCandles.slice(-CONFIG.MAX_CANDLES_FALLBACK)
                ); 
            }
        } catch(restoreErr) { 
            console.error('❌ Failed to restore chart after error:', restoreErr); 
        }
    }
}

// =============================================================================
// 📡 CONNECTION MONITOR & CLEANUP
// =============================================================================
function startConnectionMonitor() {
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
    }
    
    connectionCheckInterval = setInterval(() => {
        const timeSinceData = Date.now() - AppState.lastDataTime;
        
        if (timeSinceData > CONFIG.CONNECTION_TIMEOUT_MS) {
            if (AppState.connectionHealthy) {
                AppState.connectionHealthy = false;
                debugLog(`📡 Connection timeout after ${timeSinceData}ms`);
                
                if (typeof window.toast === 'function') {
                    window.toast('Connection lost, reconnecting...', 'info');
                }
                
                // ✅ Attempt reconnection via Eel
                if (typeof eel?.change_asset === 'function') {
                    safeEelCall(eel.change_asset, AppState.currentAsset);
                }
            }
        } else {
            // ✅ Restore healthy state when data resumes
            if (!AppState.connectionHealthy) {
                AppState.connectionHealthy = true;
                debugLog('📡 Connection restored');
                if (typeof window.toast === 'function') {
                    window.toast('Connection restored', 'success');
                }
            }
        }
    }, CONFIG.CONNECTION_CHECK_INTERVAL_MS);
}

function cleanupAll() {
    debugLog('🧹 Starting full cleanup...');
    
    // Clear intervals and timeouts
    if (connectionCheckInterval) {
        clearInterval(connectionCheckInterval);
        connectionCheckInterval = null;
    }
    if (countdownAnimationId) {
        clearTimeout(countdownAnimationId);
        countdownAnimationId = null;
    }
    if (userInteractTimer) {
        clearTimeout(userInteractTimer);
        userInteractTimer = null;
    }
    
    // ✅ Safely remove countdown label from chart
    if (countdownLabel && window.candleSeries) {
        try { 
            window.candleSeries.removePriceLine(countdownLabel); 
        } catch(e) {
            console.warn('⚠️ Failed to remove countdown label:', e);
        }
        countdownLabel = null;
    }
    
    // ✅ Clean up all indicators with error handling
    Object.entries(AppState.indicators).forEach(([name, inst]) => {
        try { 
            inst.destroy(); 
        } catch(e) {
            console.warn(`⚠️ Failed to destroy indicator "${name}":`, e);
        }
    });
    AppState.indicators = {};
    
    // Clean up chart manager
    if (CM && typeof CM.destroy === 'function') { 
        try { 
            CM.destroy(); 
        } catch(e) {
            console.warn('⚠️ ChartManager cleanup failed:', e);
        }
    }
    
    // Remove all tracked event listeners
    removeAllTrackedEventListeners();
    
    // Dispose Monaco editor
    if (AppState.monacoEditor) { 
        try { 
            AppState.monacoEditor.dispose(); 
        } catch(e) {
            console.warn('⚠️ Monaco disposal failed:', e);
        }
        AppState.monacoEditor = null; 
    }
    
    // Clear UI cache to free references
    if (UI._cache) {
        UI._cache = {};
    }
    
    debugLog('✅ Full cleanup completed');
}

// =============================================================================
// ✅ CHART MANAGER INITIALIZATION
// =============================================================================
function initChartManager() {
    // ✅ Validate dependencies before initialization
    if (typeof ChartManager === 'undefined') {
        console.warn('⚠️ ChartManager class not loaded yet');
        return false;
    }
    
    if (window.chart && window.candleSeries) {
        try {
            window.CM = new ChartManager();
            CM = window.CM; // ✅ Sync local reference
            
            if (typeof setupChartInteractions === 'function') {
                setupChartInteractions();
            }
            console.log('✅ ChartManager initialized');
            return true;
        } catch(e) { 
            console.error('❌ ChartManager init failed:', e); 
            return false; 
        }
    }
    return false;
}

(function initCMDeferred() {
    if (!initChartManager()) {
        // ✅ Retry with exponential backoff
        let retryCount = 0;
        const maxRetries = 5;
        
        function tryInit() {
            retryCount++;
            if (!initChartManager() && retryCount < maxRetries) {
                const delay = Math.min(200 * retryCount, 2000); // Cap at 2s
                console.warn(`⚠️ ChartManager retry ${retryCount}/${maxRetries} in ${delay}ms...`);
                setTimeout(tryInit, delay);
            } else if (retryCount >= maxRetries) {
                console.error('❌ ChartManager initialization failed after max retries');
            }
        }
        setTimeout(tryInit, 100);
    }
})();

// =============================================================================
// ✅ GLOBAL EXPORTS
// =============================================================================
window.UI = UI;
window.AppState = AppState;
window.CONFIG = CONFIG;  // ✅ Export config for external access/debugging
window.sanitizeIndicatorName = sanitizeIndicatorName;
window.isValidIndicatorName = isValidIndicatorName;
window.isValidCandle = isValidCandle;
window.validateCandleData = validateCandleData;
window.safeSaveStorage = safeSaveStorage;
window.safeLoadStorage = safeLoadStorage;
window.addTrackedEventListener = addTrackedEventListener;
window.removeAllTrackedEventListeners = removeAllTrackedEventListeners;
window.debounceRender = debounceRender;
window.debounceLogic = debounceLogic;
window.safeEelCall = safeEelCall;
window.updateCountdown = updateCountdown;
window.animateCountdown = animateCountdown;
window.startConnectionMonitor = startConnectionMonitor;
window.cleanupAll = cleanupAll;
window.debugLog = debugLog;
window.ensureCountdownLabel = ensureCountdownLabel;
window.initChartManager = initChartManager;

console.log('✅ datafeed.js v1.1 loaded — Hardened, cached, and connection-aware');
