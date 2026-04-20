/**
 * 📊 indicators.js - Production Ready v3.2 (Fixed Signal Persistence + Full Educational Comments)
 * =============================================================================
 * Responsibilities:
 *   • Base class IndicatorBase for all technical indicators
 *   • Pre-built indicator templates with FULL English educational comments
 *   • Global registry and lifecycle management
 * 
 * Key Fixes:
 *   • Prevents indicator "jittering" by calculating values only on completed candles
 *   • FIX: Signals now persist across candle updates (no more disappearing arrows)
 *   • Live candles extend the last stable value visually without recalculating
 * 
 * Dependencies: AppState, CM (ChartManager), UI, Lightweight Charts v4+
 */

// =============================================================================
// 🧱 BASE CLASS: IndicatorBase
// =============================================================================
class IndicatorBase {
    constructor(opts = {}) {
        this.id = 'ind_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
        this.type = opts.type || 'overlay';
        this.paneId = opts.paneId || null;
        this._seriesList = [];
        this._paneIds = new Set();
        this.settings = {};
        this._buffer = [];
        this._initialized = false;
        this.visible = true;
        this._cm = null;
        this._markers = [];
        this._markerCounter = 0;
        this._lastClosedCandle = null;
        this._lastCalculatedValue = null;
        // ✅ FIX: Persistent storage for confirmed signals (prevents disappearing)
        this._confirmedSignals = new Map();
    }

    init(cm) {
        this._cm = cm;
    }

    update(candles) {
        throw new Error('update(candles) must be implemented by subclass');
    }

    updateLast(candle) {
        if (!this._initialized || !candle || !this._lastCalculatedValue) return;
        this._extendLastValue(candle.time);
    }

    hasCustomUpdateLast() {
        return this.updateLast !== IndicatorBase.prototype.updateLast;
    }

    recalculate(candles) {
        try {
            if (candles && candles.length > 0) {
                this.update(candles);
            }
        } catch (error) {
            console.warn(`Error recalculating indicator ${this.id}:`, error);
        }
    }

    destroy() {
        try {
            this._seriesList.forEach(series => {
                try { this._cm?.mainChart?.removeSeries(series); } catch(e) {}
            });
            this._seriesList = [];
            this._clearOwnMarkers();
            this._markers = [];
            this._confirmedSignals?.clear();
            if (this._cm) {
                this._paneIds.forEach(pid => this._cm.releasePane(pid));
            }
            this._paneIds.clear();
            this._buffer = [];
            this._initialized = false;
            this._cm = null;
            this._markerCounter = 0;
            this._lastClosedCandle = null;
            this._lastCalculatedValue = null;
        } catch (error) {
            console.warn(`Error destroying indicator ${this.id}:`, error);
        }
    }

    toggleVisibility() {
        this.visible = !this.visible;
        this._seriesList.forEach(series => {
            try { series.applyOptions({ visible: this.visible }); } catch(e) {}
        });
    }

    _registerSeries(series) {
        this._seriesList.push(series);
        return series;
    }

    createOverlayLine(options) {
        const defaults = {
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: false
        };
        return this._registerSeries(
            this._cm.mainChart.addLineSeries({ ...defaults, ...options })
        );
    }

    createOverlayArea(options) {
        const defaults = {
            lastValueVisible: true,
            priceLineVisible: false,
            crosshairMarkerVisible: false
        };
        return this._registerSeries(
            this._cm.mainChart.addAreaSeries({ ...defaults, ...options })
        );
    }

    createPaneLine(paneId, name, options) {
        const chart = this._cm.createPane(paneId, name);
        this._paneIds.add(paneId);
        const defaults = {
            priceScaleId: 'right',
            autoScale: true,
            lastValueVisible: true,
            priceLineVisible: false
        };
        return this._registerSeries(
            chart.addLineSeries({ ...defaults, ...options })
        );
    }

    createPaneHistogram(paneId, name, options) {
        const chart = this._cm.createPane(paneId, name);
        this._paneIds.add(paneId);
        const defaults = {
            priceScaleId: 'right',
            autoScale: true,
            lastValueVisible: true,
            priceLineVisible: false
        };
        return this._registerSeries(
            chart.addHistogramSeries({ ...defaults, ...options })
        );
    }

    setMarkers(markers) {
        try {
            this._markers = markers;
            if (this._cm?.updateAllMarkers) {
                this._cm.updateAllMarkers();
            } else if (this._cm?.mainSeries) {
                const existing = this._cm.mainSeries.markers() || [];
                const myKeys = new Set(markers.map(m => m.id || m.time));
                const others = existing.filter(m => !myKeys.has(m.id || m.time));
                this._cm.mainSeries.setMarkers([...others, ...markers]);
            }
        } catch (error) {
            console.warn(`Error setting markers for ${this.id}:`, error);
        }
    }

    _clearOwnMarkers() {
        try {
            if (this._cm?.mainSeries) {
                const all = this._cm.mainSeries.markers() || [];
                const prefix = this.id + '_';
                const others = all.filter(m => !m.id?.startsWith(prefix));
                this._cm.mainSeries.setMarkers(others);
            }
        } catch (error) {
            console.warn(`Error clearing markers for ${this.id}:`, error);
        }
    }

    _generateMarkerId(type, time) {
        return `${this.id}_${type}_${time}`;
    }

    _extendLastValue(currentTime) {
        if (this._lastCalculatedValue !== null && this._seriesList.length > 0) {
            this._seriesList.forEach(series => {
                try {
                    series.update({ time: currentTime, value: this._lastCalculatedValue });
                } catch(e) {}
            });
        }
    }

    _isCandleCompleted(candle, timeframeSeconds = 60) {
        const now = Math.floor(Date.now() / 1000);
        const candleEnd = candle.time + timeframeSeconds;
        return now >= candleEnd;
    }
    
    // ✅ FIX: Helper to add persistent signals that won't disappear
    _addPersistentSignal(time, type, position, color, shape, text) {
        const markerId = this._generateMarkerId(type, time);
        
        // Only add if not already confirmed (prevents duplicates)
        if (!this._confirmedSignals.has(markerId)) {
            const marker = {
                id: markerId,
                time: time,
                position: position,
                color: color,
                shape: shape,
                text: text
            };
            this._confirmedSignals.set(markerId, marker);
            return marker;
        }
        return null; // Already exists
    }
    
    // ✅ FIX: Get all confirmed signals for rendering
    _getConfirmedMarkers() {
        return Array.from(this._confirmedSignals.values());
    }
    
    // ✅ FIX: Clear signals for a specific candle time (optional cleanup)
    _removeSignalForTime(time) {
        for (const [key, marker] of this._confirmedSignals) {
            if (marker.time === time) {
                this._confirmedSignals.delete(key);
                return true;
            }
        }
        return false;
    }
}

// =============================================================================
// 📜 INDICATOR TEMPLATES (FULL English educational comments inside code)
// =============================================================================

/**
 * MyCustomIndicator - Complete Educational Template
 * This template contains FULL detailed comments to teach users how to program
 * custom indicators from scratch. Do not remove or shorten these comments.
 */
const TPL_CUSTOM = `
// =============================================================================
// MyCustomIndicator - Complete Educational Template for Custom Indicators
// =============================================================================
// 
// WELCOME TO CUSTOM INDICATOR DEVELOPMENT!
// 
// This template teaches you how to create professional-grade technical indicators
// that work seamlessly with the trading chart system.
// 
// KEY CONCEPTS YOU WILL LEARN:
// ----------------------------
// 1. Class Structure: How to extend IndicatorBase properly
// 2. Settings Management: How to define user-configurable parameters
// 3. Chart Integration: How to create and manage visual series on the chart
// 4. Data Processing: How to calculate indicator values from candle data
// 5. Real-time Updates: The CRITICAL difference between update() and updateLast()
// 6. Signal Generation: How to add buy/sell markers to the chart (PERSISTENT)
// 7. Memory Management: How to clean up resources to prevent memory leaks
// 8. Stable Live Behavior: How to avoid indicator "jittering" on live candles
// 
// IMPORTANT RULE FOR STABLE INDICATORS:
// -------------------------------------
// • update(candles): Calculate values using CLOSED candles only (stable data)
// • updateLast(candle): Extend the last calculated value to current time (NO recalculation)
// • Why? Because candle.close changes every tick on live candles → recalculating causes jitter
// 
// SIGNAL PERSISTENCE RULE (NEW):
// ------------------------------
// • Use _addPersistentSignal() to add signals that won't disappear on re-render
// • Signals are stored in this._confirmedSignals Map and persist across updates
// • Only add a signal once per candle time to prevent duplicates
// 
// =============================================================================

Indicators.MyCustomIndicator = class extends IndicatorBase {
    
    // =========================================================================
    // CONSTRUCTOR: Initialize your indicator's settings and internal state
    // =========================================================================
    // 
    // The constructor is called once when the indicator is first created.
    // Use it to:
    //   • Call super() with the indicator type ('overlay' or 'pane')
    //   • Define this.settings object with default values for user options
    //   • Initialize buffer arrays for storing historical data
    //   • Set initial values for internal variables
    // 
    // PARAMETERS:
    //   • type: 'overlay' = draws on main price chart, 'pane' = creates separate panel
    // 
    // BEST PRACTICES:
    //   • Keep settings simple and descriptive (period, color, lineWidth, etc.)
    //   • Use meaningful default values that work for most use cases
    //   • Initialize all buffers and variables to avoid undefined errors
    // 
    // =========================================================================
    constructor() {
        // IMPORTANT: Always call super() first with the correct type
        // 'overlay' = indicator draws directly on the price chart (like MA, Bollinger)
        // 'pane' = indicator creates a separate panel below the chart (like RSI, MACD)
        super({ type: 'overlay' });
        
        // USER-CONFIGURABLE SETTINGS
        // These values appear in the indicator settings panel and can be changed by users.
        // Use clear, descriptive property names and sensible defaults.
        this.settings = {
            // period: Number of candles to include in the calculation
            // Common values: 14 (RSI), 20 (Bollinger), 50/200 (trend MAs)
            period: 14,
            
            // color: Hex color code for the indicator line/area
            // Use contrasting colors that are visible on both light/dark backgrounds
            color: '#d4af37',
            
            // lineWidth: Thickness of the indicator line (1-4 recommended)
            // Thicker lines are more visible but may obscure price action
            lineWidth: 2,
            
            // showSignals: Boolean toggle to enable/disable signal markers
            // Useful for indicators that generate buy/sell alerts
            showSignals: true,
            
            // signalColor: Color for signal markers (arrows, dots, etc.)
            // Use green for buy signals, red for sell signals (conventional)
            signalColor: '#00C510'
        };
        
        // INTERNAL BUFFERS FOR CALCULATIONS
        // Store historical price data needed for your indicator's formula.
        // Example: Moving averages need a buffer of recent close prices.
        this._priceBuffer = [];
        
        // CACHE FOR STABLE LIVE UPDATES (CRITICAL - PREVENTS JITTER)
        // Store the last calculated value from a CLOSED candle.
        // During live updates, we extend this value instead of recalculating.
        // This is the KEY to preventing indicator lines from "shaking" on live candles.
        this._lastCalculatedValue = null;
        
        // REFERENCE TO CHART SERIES
        // Store the Lightweight Charts series object created in init().
        // We use this reference to update the visual display.
        this._lineSeries = null;
        
        // ✅ FIX: Persistent signals storage (inherited from IndicatorBase)
        // this._confirmedSignals = new Map(); // Already initialized in base class
    }

    // =========================================================================
    // INIT: Create chart elements when indicator is first loaded
    // =========================================================================
    // 
    // The init() method is called once after the indicator is constructed,
    // when the chart manager (cm) is available.
    // 
    // Use init() to:
    //   • Call super.init(cm) to store the chart manager reference
    //   • Create visual series (lines, areas, histograms) using helper methods
    //   • Configure series appearance (colors, styles, visibility options)
    //   • Set up any one-time chart integrations
    // 
    // HELPER METHODS FOR CREATING SERIES:
    //   • this.createOverlayLine(options) - Line on main price chart
    //   • this.createOverlayArea(options) - Filled area on main chart
    //   • this.createPaneLine(paneId, name, options) - Line in separate panel
    //   • this.createPaneHistogram(paneId, name, options) - Histogram in panel
    // 
    // COMMON SERIES OPTIONS (Lightweight Charts):
    //   • color: Line/area color in hex or rgba format
    //   • lineWidth: Line thickness (1-4)
    //   • lastValueVisible: Show last value label on price scale (true/false)
    //   • priceLineVisible: Show horizontal line at last value (true/false)
    //   • title: Label shown in tooltip when hovering over the series
    //   • lineStyle: 0=solid, 1=dotted, 2=dashed (for LineSeries)
    // 
    // =========================================================================
    init(cm) {
        // IMPORTANT: Always call parent init() first to store chart manager
        super.init(cm);
        
        // CREATE THE VISUAL SERIES ON THE CHART
        // We use createOverlayLine() because this is an overlay-type indicator.
        // The options object configures how the line appears on the chart.
        this._lineSeries = this.createOverlayLine({
            // Visual appearance
            color: this.settings.color,           // Line color from settings
            lineWidth: this.settings.lineWidth,   // Line thickness from settings
            
            // Display options
            lastValueVisible: true,      // Show current value on right price scale
            priceLineVisible: false,     // Hide horizontal line at last value
            crosshairMarkerVisible: false, // Hide marker when crosshair hovers
            
            // Label for tooltip display
            title: 'My Indicator'        // Text shown in data tooltip
        });
        
        // NOTE: For indicators that need a separate panel (like RSI, MACD):
        // ----------------------------------------------------------------
        // this._paneSeries = this.createPaneLine('my_pane_id', 'My Panel', {
        //     color: this.settings.color,
        //     lineWidth: this.settings.lineWidth,
        //     lastValueVisible: true,
        //     priceLineVisible: false,
        //     title: 'My Indicator'
        // });
        // 
        // The first parameter 'my_pane_id' is a unique identifier for the panel.
        // The second parameter 'My Panel' is the label shown on the panel.
    }

    // =========================================================================
    // UPDATE: Calculate indicator values for historical candle array
    // =========================================================================
    // 
    // THE MOST IMPORTANT METHOD - This is where your indicator logic lives.
    // 
    // PARAMETER:
    //   candles: Array of complete candle objects, sorted oldest to newest
    //   Format: [{time, open, high, low, close, volume}, {time, ...}, ...]
    //   • time: Unix timestamp in seconds (e.g., 1712345678)
    //   • open/high/low/close: Price values for the candle
    //   • volume: Trading volume (may be undefined for some data sources)
    // 
    // CRITICAL RULES FOR update():
    // ----------------------------
    // 1. ONLY use CLOSED candles for calculations
    //    • Historical data is stable and won't change
    //    • This ensures your indicator values are accurate and reproducible
    // 
    // 2. Output format must match Lightweight Charts expectations:
    //    • Return array of {time, value} objects
    //    • time must match the candle.time from input
    //    • value is the calculated indicator value for that candle
    // 
    // 3. Handle warm-up period gracefully:
    //    • Many indicators need N candles before producing valid output
    //    • Return shorter result array until buffer is full (this is normal)
    // 
    // 4. Cache the last calculated value for live updates:
    //    • this._lastCalculatedValue = lastValue;
    //    • this._lastClosedCandle = lastCandle;
    //    • This enables stable real-time behavior in updateLast()
    // 
    // 5. Use setData() to render results (not update() in a loop):
    //    • setData() is optimized for bulk updates
    //    • Calling update() repeatedly is slower and may cause flickering
    // 
    // 6. ✅ SIGNAL PERSISTENCE: Use _addPersistentSignal() for markers
    //    • Signals stored in this._confirmedSignals persist across updates
    //    • Prevents signals from disappearing when update() is called again
    // 
    // PERFORMANCE TIPS:
    //   • Avoid nested loops inside the main candle loop when possible
    //   • Pre-calculate constants outside loops (e.g., smoothing factors)
    //   • Use array methods like reduce() for simple aggregations
    //   • For complex indicators, consider incremental calculation algorithms
    // 
    // =========================================================================
    update(candles) {
        // STEP 1: Validate input data
        // Always check that we have enough data before attempting calculations.
        // This prevents errors and ensures indicator only draws when meaningful.
        if (!candles || candles.length < this.settings.period) {
            return; // Not enough data - wait for more candles
        }
        
        // STEP 2: Clear buffer for fresh calculation
        // Reset internal state to avoid mixing old and new data.
        this._priceBuffer = [];
        const result = []; // Output array: [{time, value}, ...]
        
        // STEP 3: Iterate through each candle in the historical array
        // Process candles in order (oldest to newest) for correct calculations.
        for (let i = 0; i < candles.length; i++) {
            const candle = candles[i];
            
            // Add current close price to our calculation buffer
            // Most price-based indicators use candle.close as the primary input
            this._priceBuffer.push(candle.close);
            
            // Maintain buffer size within the configured period limit
            // Remove oldest values when buffer exceeds period length
            if (this._priceBuffer.length > this.settings.period) {
                this._priceBuffer.shift(); // Remove first (oldest) element
            }
            
            // STEP 4: Calculate indicator value when buffer is complete
            // Only compute when we have exactly 'period' values in buffer
            if (this._priceBuffer.length === this.settings.period) {
                
                // === YOUR CUSTOM CALCULATION LOGIC GOES HERE ===
                // 
                // Example: Simple Moving Average (SMA) formula
                // Replace this block with your own indicator formula
                // 
                // Available candle properties for calculations:
                //   • candle.close  - Closing price (most common)
                //   • candle.open   - Opening price
                //   • candle.high   - Highest price in candle
                //   • candle.low    - Lowest price in candle
                //   • candle.volume - Trading volume
                //   • candle.time   - Unix timestamp
                
                let sum = 0;
                for (let j = 0; j < this._priceBuffer.length; j++) {
                    sum += this._priceBuffer[j];
                }
                const value = sum / this._priceBuffer.length;
                
                // === END OF CUSTOM CALCULATION ===
                
                // STEP 5: Add result to output array with candle timestamp
                // Format MUST be {time, value} for Lightweight Charts compatibility
                result.push({ time: candle.time, value: value });
                
                // STEP 6: Cache values for stable live updates (CRITICAL!)
                // Store the last calculated value and candle for updateLast()
                // This prevents jittering by avoiding recalculation on live candles
                this._lastCalculatedValue = value;
                this._lastClosedCandle = candle;
            }
        }
        
        // STEP 7: Render results on the chart
        // Use setData() for bulk updates - it's optimized and prevents flickering
        if (result.length > 0 && this._lineSeries) {
            this._lineSeries.setData(result);
        }
        
        // STEP 8: Mark indicator as initialized
        // This flag prevents updateLast() from running before first calculation
        this._initialized = true;
        
        // STEP 9 (Optional): Add PERSISTENT signal markers if enabled
        // Use _addPersistentSignal() to ensure signals don't disappear on re-render
        if (this.settings.showSignals) {
            this._addExampleSignals(candles, result);
        }
    }

    // =========================================================================
    // UPDATELAST: Stable real-time update for current live candle
    // =========================================================================
    // 
    // THE KEY TO PREVENTING INDICATOR JITTER - READ CAREFULLY!
    // 
    // PARAMETER:
    //   candle: Single candle object for the CURRENT (live) candle
    //   Format: {time, open, high, low, close, volume}
    //   • This candle is NOT closed - its close/high/low values change every tick
    // 
    // CRITICAL PRINCIPLE:
    // -------------------
    // DO NOT recalculate your indicator formula using candle.close in this method!
    // 
    // Why? Because on a live candle:
    //   • candle.close changes with every price tick (every ~100ms)
    //   • Recalculating on each tick makes the indicator line "shake" or "jitter"
    //   • This is visually distracting and makes the indicator unreliable
    // 
    // CORRECT APPROACH:
    // -----------------
    // • Use updateLast() ONLY to extend the last STABLE calculated value
    // • Take this._lastCalculatedValue (from last CLOSED candle)
    // • Display it at the current candle.time using series.update()
    // • This shows the indicator "position" live without recalculating
    // 
    // WHEN MIGHT YOU WANT LIVE RECALCULATION?
    // ----------------------------------------
    // Rare cases only, such as:
    //   • Preview mode where user accepts some instability for "live preview"
    //   • Indicators specifically designed for tick-by-tick analysis
    //   • If you implement smoothing/debouncing to reduce jitter
    // 
    // If you do recalculate live, add a comment warning users about potential jitter.
    // 
    // PERFORMANCE NOTE:
    //   • updateLast() is called on EVERY price tick (potentially 10x/second)
    //   • Keep this method EXTREMELY lightweight - no loops, no heavy math
    //   • A single series.update() call is the ideal implementation
    // 
    // =========================================================================
    updateLast(candle) {
        // STEP 1: Guard clauses - exit early if not ready
        // Prevent errors if indicator hasn't initialized or data is missing
        if (!this._initialized || !candle || !this._lineSeries) {
            return;
        }
        
        // STEP 2: KEY FIX - Extend last stable value, DO NOT recalculate
        // 
        // This is the professional approach used by TradingView, MetaTrader, etc.
        // We show where the indicator WOULD be if calculated, without the jitter.
        // 
        // How it works:
        //   • this._lastCalculatedValue = value from last CLOSED candle (stable)
        //   • series.update({time: candle.time, value: ...}) extends it visually
        //   • User sees the indicator "following" price without shaking
        // 
        if (this._lastCalculatedValue !== null) {
            // Update the series with last stable value at current time
            // This creates a smooth visual extension to the live candle
            this._lineSeries.update({ 
                time: candle.time, 
                value: this._lastCalculatedValue 
            });
        }
        
        // =====================================================================
        // OPTIONAL: Live Preview Calculation (USE WITH CAUTION - MAY JITTER)
        // =====================================================================
        // 
        // Uncomment the block below ONLY if you want a "live preview" that
        // recalculates with the changing candle.close value.
        // 
        // WARNING: This will cause the indicator line to jitter/shake on live
        // candles because candle.close changes with every price tick.
        // 
        // Use this only for:
        //   • Educational/demo purposes where jitter is acceptable
        //   • Indicators specifically designed for tick-level analysis
        //   • When you implement additional smoothing/debouncing logic
        // 
        // =====================================================================
        /*
        if (this._priceBuffer.length >= this.settings.period) {
            // Create a temporary buffer with the live close price
            // This simulates what the calculation would be if candle closed now
            const tempBuffer = [...this._priceBuffer.slice(1), candle.close];
            
            // Perform the same calculation as in update()
            // NOTE: This runs on every price tick - keep it simple!
            let sum = 0;
            for (let i = 0; i < tempBuffer.length; i++) {
                sum += tempBuffer[i];
            }
            const previewValue = sum / tempBuffer.length;
            
            // Update with the preview value (will jitter as close changes)
            this._lineSeries.update({ time: candle.time, value: previewValue });
        }
        */
        // =====================================================================
        // END OPTIONAL LIVE PREVIEW BLOCK
        // =====================================================================
    }

    // =========================================================================
    // HELPER METHOD: Add PERSISTENT signal markers (FIXED - won't disappear)
    // =========================================================================
    // 
    // This method demonstrates how to generate and display signal markers
    // (like buy/sell arrows) on the chart based on your indicator logic.
    // 
    // ✅ KEY FIX: Uses _addPersistentSignal() to store signals permanently
    // • Signals are stored in this._confirmedSignals Map
    // • They persist across update() calls and won't disappear
    // • Each signal is added only once per candle time (prevents duplicates)
    // 
    // MARKER FORMAT (Lightweight Charts):
    // -----------------------------------
    // Each marker is an object with these properties:
    //   • id: UNIQUE identifier string (use _generateMarkerId() helper)
    //   • time: Unix timestamp when marker should appear (candle.time)
    //   • position: 'aboveBar', 'belowBar', or 'inBar' (vertical placement)
    //   • color: Hex or rgba color code for the marker
    //   • shape: 'arrowUp', 'arrowDown', 'circle', 'square', 'diamond'
    //   • text: Optional short label shown next to marker (1-3 chars recommended)
    // 
    // BEST PRACTICES FOR MARKERS:
    // ---------------------------
    // 1. Always use unique IDs to avoid conflicts with other indicators
    //    • Use: this._generateMarkerId('type', candle.time)
    //    • This creates IDs like: "ind_xxx_buy_1712345678"
    // 
    // 2. ✅ Use _addPersistentSignal() for permanent signals
    //    • Returns null if signal already exists (prevents duplicates)
    //    • Signals persist even when update() is called again
    // 
    // 3. Limit marker density for readability
    //    • Don't show a marker on every candle - use meaningful signals only
    //    • Consider adding cooldown periods or confirmation logic
    // 
    // 4. Use conventional colors for signals
    //    • Green (#00C510 or similar) for buy/long signals
    //    • Red (#ff0000 or similar) for sell/short signals
    // 
    // =========================================================================
    _addExampleSignals(candles, values) {
        // Guard: Ensure we have valid data to process
        if (!values || values.length < 2) return;
        
        // ✅ FIX: Get existing confirmed markers to avoid re-adding
        const existingMarkers = this._getConfirmedMarkers();
        
        // Iterate through calculated values to detect signal conditions
        for (let i = 1; i < values.length; i++) {
            const prev = values[i - 1];   // Previous indicator value
            const curr = values[i];       // Current indicator value
            const candle = candles[i];    // Corresponding candle
            
            // EXAMPLE SIGNAL LOGIC: Detect upward curve direction change
            // This is just an example - replace with your own signal criteria
            // 
            // Condition: Current > Previous AND Previous > BeforePrevious
            // This indicates the indicator curve is turning upward
            if (prev.value < curr.value && i > 1 && values[i-2]?.value > prev.value) {
                
                // ✅ FIX: Use _addPersistentSignal to add signal permanently
                // Returns null if already added (prevents duplicates)
                const newMarker = this._addPersistentSignal(
                    candle.time,           // Unique time key
                    'buy',                 // Signal type
                    'belowBar',            // Position below candle
                    this.settings.signalColor, // Green color
                    'arrowUp',             // Upward arrow shape
                    '↗'                    // Short label
                );
                
                // If a new marker was created, we could trigger additional logic here
                // (e.g., play sound, send notification, etc.)
                if (newMarker) {
                    // Optional: console.log('New buy signal at', candle.time);
                }
            }
            
            // You can add more signal conditions here:
            // 
            // Example: SELL signal when curve turns downward
            // if (prev.value > curr.value && i > 1 && values[i-2]?.value < prev.value) {
            //     this._addPersistentSignal(
            //         candle.time,
            //         'sell',
            //         'aboveBar',
            //         '#ff0000',
            //         'arrowDown',
            //         '↘'
            //     );
            // }
        }
        
        // ✅ FIX: Render ALL confirmed signals (not just new ones)
        // This ensures persistent signals stay visible across updates
        const allMarkers = this._getConfirmedMarkers();
        if (allMarkers.length > 0) {
            this.setMarkers(allMarkers);
        }
    }

    // =========================================================================
    // DESTROY: Clean up resources when indicator is removed
    // =========================================================================
    // 
    // CRITICAL FOR MEMORY MANAGEMENT - Never skip this method!
    // 
    // The destroy() method is called when the user removes the indicator
    // from the chart. Proper cleanup prevents memory leaks and ensures
    // the chart remains responsive over long trading sessions.
    // 
    // WHAT TO CLEAN UP:
    // -----------------
    // 1. Clear all buffer arrays that store historical data
    //    • this._priceBuffer = [];
    //    • Prevents arrays from growing indefinitely
    // 
    // 2. Nullify references to chart series and objects
    //    • this._lineSeries = null;
    //    • Allows JavaScript garbage collector to free memory
    // 
    // 3. Remove any markers/signals created by this indicator
    //    • this._clearOwnMarkers();
    //    • Prevents orphaned markers remaining on chart
    // 
    // 4. ✅ Clear persistent signals storage
    //    • this._confirmedSignals?.clear();
    //    • Prevents memory leak from accumulated signal data
    // 
    // 5. ALWAYS call super.destroy() LAST
    //    • This handles base class cleanup (series removal, pane release, etc.)
    //    • Calling it first may cause errors if your code still uses _cm
    // 
    // COMMON MISTAKES TO AVOID:
    // -------------------------
    // ❌ Forgetting to clear buffers → memory leak over time
    // ❌ Not nullifying series references → chart objects not garbage collected
    // ❌ Calling super.destroy() first → your cleanup code may fail
    // ❌ Skipping destroy() entirely → severe memory leaks in long sessions
    // ❌ Not clearing _confirmedSignals → signals accumulate in memory
    // 
    // =========================================================================
    destroy() {
        // Clear internal buffers to free memory
        this._priceBuffer = [];
        
        // Nullify cached values and series references
        this._lastCalculatedValue = null;
        this._lineSeries = null;
        
        // ✅ FIX: Clear persistent signals storage
        this._confirmedSignals?.clear();
        
        // IMPORTANT: Always call parent destroy() LAST
        // This handles base class cleanup: removing series from chart,
        // releasing pane resources, clearing markers, etc.
        super.destroy();
    }
};
`;

/**
 * Moving Average (SMA) - Simple Moving Average with full comments
 */
const TPL_MA = `
// =============================================================================
// MovingAverage - Simple Moving Average (SMA)
// Description: Calculates the arithmetic mean of closing prices over a period
// Use Case: Identify trend direction, dynamic support/resistance levels
// =============================================================================

Indicators.MovingAverage = class extends IndicatorBase {
    // Constructor: Initialize settings and internal state
    constructor() {
        super({ type: 'overlay' }); // Draw on main price chart
        
        // User-configurable settings
        this.settings = {
            period: 20,              // Number of candles for averaging
            color: '#d4af37',        // Golden color for visibility
            lineWidth: 2             // Medium thickness for clarity
        };
        
        // Buffer to store recent closing prices for calculation
        this._buffer = [];
        
        // Reference to the chart series (created in init)
        this._series = null;
    }

    // Init: Create the visual line series on the chart
    init(cm) {
        super.init(cm);
        this._series = this.createOverlayLine({
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            lastValueVisible: true,      // Show value on price scale
            priceLineVisible: false,     // Hide horizontal price line
            title: 'MA(' + this.settings.period + ')' // Tooltip label
        });
    }

    // Update: Calculate SMA values for historical candles
    // Formula: SMA = Sum(close prices) / period
    update(candles) {
        try {
            // Validate: need at least 'period' candles to calculate
            if (!candles || candles.length < this.settings.period) return;
            
            this._buffer = []; // Reset buffer for fresh calculation
            const result = []; // Output array for chart rendering
            
            // Process each candle in chronological order
            for (let i = 0; i < candles.length; i++) {
                const candle = candles[i];
                
                // Add current close price to buffer
                this._buffer.push(candle.close);
                
                // Maintain buffer size: remove oldest when exceeding period
                if (this._buffer.length > this.settings.period) {
                    this._buffer.shift();
                }
                
                // Calculate SMA only when buffer is full
                if (this._buffer.length === this.settings.period) {
                    // Sum all values in buffer and divide by count
                    const sum = this._buffer.reduce((a, b) => a + b, 0);
                    const value = sum / this._buffer.length;
                    
                    // Add result with candle timestamp for chart
                    result.push({ time: candle.time, value: value });
                    
                    // Cache for stable live updates (prevents jitter)
                    this._lastCalculatedValue = value;
                    this._lastClosedCandle = candle;
                }
            }
            
            // Render all calculated points at once (efficient)
            if (result.length > 0 && this._series) {
                this._series.setData(result);
            }
            this._initialized = true;
        } catch (e) { console.warn('MA update error:', e); }
    }

    // UpdateLast: Stable live preview - extend last value, no recalculation
    // This prevents the MA line from jittering on the live candle
    updateLast(candle) {
        // Only extend if we have a valid cached value from closed candles
        if (this._initialized && candle && this._series && this._lastCalculatedValue !== null) {
            // Extend the last stable SMA value to current candle time
            // This shows position without recalculating (no jitter)
            this._series.update({ time: candle.time, value: this._lastCalculatedValue });
        }
    }

    // Destroy: Clean up memory when indicator is removed
    destroy() {
        this._buffer = []; // Clear price buffer
        this._series = null; // Release series reference
        super.destroy(); // Call parent cleanup (critical)
    }
};
`;

/**
 * EMA - Exponential Moving Average with full educational comments
 */
const TPL_EMA = `
// =============================================================================
// EMA - Exponential Moving Average
// Description: Weighted moving average that gives more importance to recent prices
// Formula: EMA = (Close - EMA_prev) * multiplier + EMA_prev
// Where: multiplier = 2 / (period + 1)
// Use Case: More responsive trend tracking than SMA, popular in momentum strategies
// =============================================================================

Indicators.EMA = class extends IndicatorBase {
    // Constructor: Initialize EMA-specific settings and state
    constructor() {
        super({ type: 'overlay' }); // Draw on main price chart
        
        this.settings = {
            period: 21,              // Common EMA period (adjustable)
            color: '#60a5fa',        // Blue color for distinction from SMA
            lineWidth: 2             // Visible but not overwhelming
        };
        
        // Store the current EMA value (recursive calculation)
        this._emaValue = null;
        
        // Reference to chart series
        this._series = null;
    }

    // Init: Create the EMA line series with configured styling
    init(cm) {
        super.init(cm);
        this._series = this.createOverlayLine({
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            lastValueVisible: true,
            priceLineVisible: false,
            title: 'EMA(' + this.settings.period + ')'
        });
    }

    // Helper: Calculate the EMA smoothing multiplier
    // Formula: k = 2 / (period + 1)
    // Higher period = smaller k = smoother, less responsive EMA
    _getMultiplier() {
        return 2 / (this.settings.period + 1);
    }

    // Update: Calculate EMA for historical candle array
    // Key difference from SMA: EMA is recursive (uses previous EMA value)
    update(candles) {
        try {
            // Need at least 2 candles: one to seed, one to start recursion
            if (!candles || candles.length < 2) return;
            
            // Seed EMA with first candle's close price
            this._emaValue = candles[0].close;
            const result = [{ time: candles[0].time, value: this._emaValue }];
            
            const k = this._getMultiplier(); // Pre-calculate multiplier
            
            // Process remaining candles with recursive EMA formula
            for (let i = 1; i < candles.length; i++) {
                // EMA formula: EMA = (Close - EMA_prev) * k + EMA_prev
                // This gives more weight to recent prices
                this._emaValue = (candles[i].close - this._emaValue) * k + this._emaValue;
                result.push({ time: candles[i].time, value: this._emaValue });
            }
            
            // Render results and cache for live updates
            if (result.length > 0 && this._series) {
                this._series.setData(result);
            }
            this._lastCalculatedValue = this._emaValue;
            this._lastClosedCandle = candles[candles.length - 1];
            this._initialized = true;
        } catch (e) { console.warn('EMA update error:', e); }
    }

    // UpdateLast: Extend last EMA value for stable live preview
    // Do NOT recalculate EMA with changing candle.close (causes jitter)
    updateLast(candle) {
        if (this._initialized && candle && this._series && this._emaValue !== null) {
            // Extend the stable EMA value to current time
            this._series.update({ time: candle.time, value: this._emaValue });
        }
    }

    // Destroy: Clean up EMA-specific resources
    destroy() {
        this._emaValue = null; // Clear recursive value
        this._series = null;   // Release series reference
        super.destroy();       // Parent cleanup
    }
};
`;

/**
 * Bollinger Bands - Full educational comments
 */
const TPL_BB = `
// =============================================================================
// BollingerBands - Volatility bands around a moving average
// Description: Three lines - middle (SMA), upper/lower (SMA ± k*stddev)
// Formula: 
//   Middle = SMA(period)
//   Upper = Middle + (stdDev * standardDeviation)
//   Lower = Middle - (stdDev * standardDeviation)
// Use Case: Identify overbought/oversold conditions, volatility breakouts
// =============================================================================

Indicators.BollingerBands = class extends IndicatorBase {
    // Constructor: Initialize Bollinger Bands settings
    constructor() {
        super({ type: 'overlay' }); // Draw on main price chart
        
        this.settings = {
            period: 20,              // Lookback period for SMA and stddev
            stdDev: 2,               // Standard deviation multiplier (common: 2)
            upperColor: 'rgba(248,81,73,0.7)',   // Red-tinted for upper band
            middleColor: '#d4af37',              // Gold for middle SMA
            lowerColor: 'rgba(96,165,250,0.7)'   // Blue-tinted for lower band
        };
        
        // Buffer for price values needed for stddev calculation
        this._buffer = [];
        
        // References to three series: upper, middle, lower bands
        this._series = { upper: null, middle: null, lower: null };
    }

    // Init: Create three line series for the bands
    init(cm) {
        super.init(cm);
        
        // Base options shared by all three lines
        const baseOpts = {
            lineWidth: 1,
            lastValueVisible: false,   // Hide individual values (cluttered)
            priceLineVisible: false,
            crosshairMarkerVisible: false
        };
        
        // Upper band: dashed line, red-tinted
        this._series.upper = this.createOverlayLine({
            ...baseOpts, color: this.settings.upperColor, lineStyle: 2, title: 'BB Upper'
        });
        
        // Middle band (SMA): solid line, gold, slightly thicker
        this._series.middle = this.createOverlayLine({
            ...baseOpts, color: this.settings.middleColor, lineWidth: 2, title: 'BB Middle'
        });
        
        // Lower band: dashed line, blue-tinted
        this._series.lower = this.createOverlayLine({
            ...baseOpts, color: this.settings.lowerColor, lineStyle: 2, title: 'BB Lower'
        });
    }

    // Helper: Calculate mean and standard deviation for a set of values
    // Used for computing the upper/lower band offsets
    _calculateStats(values) {
        // Calculate arithmetic mean (average)
        const mean = values.reduce((a, b) => a + b, 0) / values.length;
        
        // Calculate population standard deviation
        // Formula: sqrt(sum((value - mean)^2) / count)
        const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
        const std = Math.sqrt(variance);
        
        return { mean, std };
    }

    // Update: Calculate all three bands for historical candles
    update(candles) {
        try {
            if (!candles || candles.length < this.settings.period) return;
            
            this._buffer = [];
            const upper = [], middle = [], lower = [];
            
            for (let i = 0; i < candles.length; i++) {
                const candle = candles[i];
                this._buffer.push(candle.close);
                
                if (this._buffer.length > this.settings.period) {
                    this._buffer.shift();
                }
                
                // Calculate bands only when buffer has enough data
                if (this._buffer.length === this.settings.period) {
                    const { mean, std } = this._calculateStats(this._buffer);
                    
                    // Upper band: mean + (stdDev * standard deviation)
                    upper.push({ time: candle.time, value: mean + (this.settings.stdDev * std) });
                    
                    // Middle band: simple moving average
                    middle.push({ time: candle.time, value: mean });
                    
                    // Lower band: mean - (stdDev * standard deviation)
                    lower.push({ time: candle.time, value: mean - (this.settings.stdDev * std) });
                }
            }
            
            // Render all three bands
            if (upper.length > 0) {
                this._series.upper?.setData(upper);
                this._series.middle?.setData(middle);
                this._series.lower?.setData(lower);
                
                // Cache middle band value for stable live extension
                this._lastCalculatedValue = middle[middle.length - 1]?.value;
                this._lastClosedCandle = candles[candles.length - 1];
            }
            this._initialized = true;
        } catch (e) { console.warn('BB update error:', e); }
    }

    // UpdateLast: Extend middle band value for stable live preview
    // Note: For full live bands, you'd cache all three values
    updateLast(candle) {
        if (this._initialized && candle && this._lastCalculatedValue !== null) {
            // Extend middle band (primary reference) to current time
            this._series.middle?.update({ time: candle.time, value: this._lastCalculatedValue });
            // Upper/lower bands could be extended similarly if cached
        }
    }

    // Destroy: Clean up Bollinger Bands resources
    destroy() {
        this._buffer = [];
        this._series = { upper: null, middle: null, lower: null };
        super.destroy();
    }
};
`;

/**
 * VWAP - Volume Weighted Average Price with full comments
 */
const TPL_VWAP = `
// =============================================================================
// VWAP - Volume Weighted Average Price
// Description: Average price weighted by trading volume, resets each session
// Formula: VWAP = Cumulative(TypicalPrice * Volume) / Cumulative(Volume)
// Where: TypicalPrice = (High + Low + Close) / 3
// Use Case: Institutional reference price, intraday support/resistance, fair value
// =============================================================================

Indicators.VWAP = class extends IndicatorBase {
    // Constructor: Initialize VWAP settings and accumulators
    constructor() {
        super({ type: 'overlay' }); // Draw on main price chart
        
        this.settings = { 
            color: '#f59e0b',   // Amber color for visibility
            lineWidth: 2        // Medium thickness
        };
        
        // Cumulative sums for VWAP calculation (reset each session)
        this._cumulativeTPV = 0;        // Sum of (TypicalPrice * Volume)
        this._cumulativeVolume = 0;     // Sum of Volume
        
        // Track session boundary for daily reset
        this._sessionStart = null;      // Timestamp of current session start
        
        // Reference to chart series
        this._series = null;
    }

    // Init: Create the VWAP line series
    init(cm) {
        super.init(cm);
        this._series = this.createOverlayLine({
            color: this.settings.color,
            lineWidth: this.settings.lineWidth,
            lastValueVisible: true,
            priceLineVisible: false,
            title: 'VWAP'
        });
    }

    // Helper: Get start of trading session (day) for a given timestamp
    // Used to detect when to reset VWAP accumulators (new trading day)
    _getSessionStart(timestamp) {
        // Convert Unix timestamp (seconds) to Date object (milliseconds)
        const date = new Date(timestamp * 1000);
        
        // Set time to 00:00:00 UTC to get start of day
        date.setUTCHours(0, 0, 0, 0);
        
        // Convert back to Unix timestamp (seconds)
        return Math.floor(date.getTime() / 1000);
    }

    // Update: Calculate VWAP for historical candles with session reset
    update(candles) {
        try {
            if (!candles || candles.length < 2) return;
            
            // Reset accumulators at start of calculation
            this._cumulativeTPV = 0;
            this._cumulativeVolume = 0;
            this._sessionStart = this._getSessionStart(candles[0].time);
            
            const result = [];
            
            for (let i = 0; i < candles.length; i++) {
                const candle = candles[i];
                const sessionStart = this._getSessionStart(candle.time);
                
                // Reset accumulators when crossing into new session (new day)
                if (sessionStart !== this._sessionStart) {
                    this._cumulativeTPV = 0;
                    this._cumulativeVolume = 0;
                    this._sessionStart = sessionStart;
                }
                
                // Calculate typical price: average of high, low, close
                const typicalPrice = (candle.high + candle.low + candle.close) / 3;
                
                // Accumulate: (typical price * volume) for numerator
                // Use volume || 1 to handle missing volume data gracefully
                this._cumulativeTPV += typicalPrice * (candle.volume || 1);
                
                // Accumulate volume for denominator
                this._cumulativeVolume += (candle.volume || 1);
                
                // Calculate VWAP only if we have volume data
                if (this._cumulativeVolume > 0) {
                    const vwap = this._cumulativeTPV / this._cumulativeVolume;
                    result.push({ time: candle.time, value: vwap });
                    
                    // Cache for stable live extension
                    this._lastCalculatedValue = vwap;
                    this._lastClosedCandle = candle;
                }
            }
            
            if (result.length > 0 && this._series) {
                this._series.setData(result);
            }
            this._initialized = true;
        } catch (e) { console.warn('VWAP update error:', e); }
    }

    // UpdateLast: Extend last VWAP value for stable live preview
    // Do NOT recalculate accumulators with live candle (causes jitter)
    updateLast(candle) {
        if (this._initialized && candle && this._series && this._lastCalculatedValue !== null) {
            // Extend stable VWAP value to current time
            this._series.update({ time: candle.time, value: this._lastCalculatedValue });
        }
    }

    // Destroy: Clean up VWAP accumulators and references
    destroy() {
        this._cumulativeTPV = 0;
        this._cumulativeVolume = 0;
        this._sessionStart = null;
        this._series = null;
        super.destroy();
    }
};
`;

/**
 * Pivot Points - Full educational comments
 */
const TPL_PIVOT = `
// =============================================================================
// PivotPoints - Classic Support/Resistance Levels
// Description: Horizontal lines calculated from previous period's price action
// Formula (Classic):
//   Pivot Point (PP) = (High + Low + Close) / 3
//   Resistance 1 (R1) = (2 * PP) - Low
//   Support 1 (S1) = (2 * PP) - High
//   Resistance 2 (R2) = PP + (High - Low)
//   Support 2 (S2) = PP - (High - Low)
// Use Case: Identify key intraday support/resistance levels for entries/exits
// =============================================================================

Indicators.PivotPoints = class extends IndicatorBase {
    // Constructor: Initialize Pivot Points settings and level storage
    constructor() {
        super({ type: 'overlay' }); // Draw on main price chart
        
        this.settings = { 
            color: '#d4af37',    // Gold for primary PP line
            showR2S2: true       // Toggle secondary levels (R2/S2)
        };
        
        // Store calculated pivot levels from last completed period
        this._levels = { 
            pp: null,   // Pivot Point (primary reference)
            r1: null,   // Resistance 1
            s1: null,   // Support 1
            r2: null,   // Resistance 2 (optional)
            s2: null    // Support 2 (optional)
        };
        
        // Reference to the candle used for calculation (for validation)
        this._lastCompletedCandle = null;
        
        // References to five series: PP, R1, S1, R2, S2
        this._series = { pp: null, r1: null, s1: null, r2: null, s2: null };
    }

    // Init: Create line series for each pivot level
    init(cm) {
        super.init(cm);
        
        // Base options for all pivot lines
        const baseOpts = { 
            lineWidth: 1, 
            lastValueVisible: true,   // Show level value on price scale
            priceLineVisible: false, 
            crosshairMarkerVisible: false 
        };
        
        // Primary Pivot Point: solid gold line, thicker for emphasis
        this._series.pp = this.createOverlayLine({ 
            ...baseOpts, color: this.settings.color, lineWidth: 2, title: 'PP' 
        });
        
        // First Resistance: blue, dashed, semi-transparent
        this._series.r1 = this.createOverlayLine({ 
            ...baseOpts, color: 'rgba(96,165,250,0.6)', lineStyle: 2, title: 'R1' 
        });
        
        // First Support: red, dashed, semi-transparent
        this._series.s1 = this.createOverlayLine({ 
            ...baseOpts, color: 'rgba(248,81,73,0.6)', lineStyle: 2, title: 'S1' 
        });
        
        // Secondary levels (optional): more transparent, thinner
        if (this.settings.showR2S2) {
            this._series.r2 = this.createOverlayLine({ 
                ...baseOpts, color: 'rgba(96,165,250,0.3)', lineStyle: 1, title: 'R2' 
            });
            this._series.s2 = this.createOverlayLine({ 
                ...baseOpts, color: 'rgba(248,81,73,0.3)', lineStyle: 1, title: 'S2' 
            });
        }
    }

    // Helper: Calculate all pivot levels from a single completed candle
    // Uses classic formula based on High, Low, Close of the reference candle
    _calculateLevels(candle) {
        const { high, low, close } = candle;
        
        // Pivot Point: average of high, low, close
        const pp = (high + low + close) / 3;
        
        // First-level support/resistance
        const r1 = (2 * pp) - low;
        const s1 = (2 * pp) - high;
        
        // Second-level support/resistance
        const r2 = pp + (high - low);
        const s2 = pp - (high - low);
        
        // Store all levels for rendering
        this._levels = { pp, r1, s1, r2, s2 };
    }

    // Update: Calculate and render pivot levels for historical candles
    // CRITICAL: Levels are calculated from PREVIOUS completed candle only
    update(candles) {
        try {
            if (!candles || candles.length < 2) return;
            
            // Arrays to collect data points for each level
            const ppData = [], r1Data = [], s1Data = [], r2Data = [], s2Data = [];
            
            for (let i = 0; i < candles.length; i++) {
                const current = candles[i];
                
                // KEY PRINCIPLE: Calculate levels from PREVIOUS completed candle
                // This ensures levels are stable and based on confirmed price action
                if (i > 0) {
                    const prevCandle = candles[i - 1];
                    this._calculateLevels(prevCandle);
                    this._lastCompletedCandle = prevCandle;
                }
                
                // Render calculated levels on current and all subsequent candles
                // This creates horizontal lines that extend across the chart
                if (this._levels.pp !== null) {
                    ppData.push({ time: current.time, value: this._levels.pp });
                    r1Data.push({ time: current.time, value: this._levels.r1 });
                    s1Data.push({ time: current.time, value: this._levels.s1 });
                    
                    if (this.settings.showR2S2) {
                        r2Data.push({ time: current.time, value: this._levels.r2 });
                        s2Data.push({ time: current.time, value: this._levels.s2 });
                    }
                }
            }
            
            // Render all five series if data exists
            if (ppData.length > 0) {
                this._series.pp?.setData(ppData);
                this._series.r1?.setData(r1Data);
                this._series.s1?.setData(s1Data);
                if (this.settings.showR2S2) {
                    this._series.r2?.setData(r2Data);
                    this._series.s2?.setData(s2Data);
                }
                // Cache primary PP value for live extension
                this._lastCalculatedValue = this._levels.pp;
            }
            this._initialized = true;
        } catch (e) { console.warn('Pivot update error:', e); }
    }

    // UpdateLast: Extend pre-calculated pivot levels for stable live preview
    // Levels do NOT recalculate on live candle - they're fixed until next period
    updateLast(candle) {
        if (this._initialized && candle && this._lastCompletedCandle && this._levels.pp !== null) {
            // Extend all calculated levels to current time (horizontal lines)
            this._series.pp?.update({ time: candle.time, value: this._levels.pp });
            this._series.r1?.update({ time: candle.time, value: this._levels.r1 });
            this._series.s1?.update({ time: candle.time, value: this._levels.s1 });
            if (this.settings.showR2S2) {
                this._series.r2?.update({ time: candle.time, value: this._levels.r2 });
                this._series.s2?.update({ time: candle.time, value: this._levels.s2 });
            }
        }
    }

    // Destroy: Clean up pivot levels and series references
    destroy() {
        this._levels = { pp: null, r1: null, s1: null, r2: null, s2: null };
        this._lastCompletedCandle = null;
        this._series = { pp: null, r1: null, s1: null, r2: null, s2: null };
        super.destroy();
    }
};
`;

/**
 * SignalArrows - Full educational comments (with persistent signals)
 */
const TPL_ARROWS = `
// =============================================================================
// SignalArrows - Crossover Signal Generator (PERSISTENT SIGNALS)
// Description: Generates buy/sell arrow markers when fast MA crosses slow MA
// Logic: 
//   BUY: Fast MA crosses ABOVE Slow MA (bullish momentum)
//   SELL: Fast MA crosses BELOW Slow MA (bearish momentum)
// Use Case: Visual entry/exit signals for trend-following strategies
// 
// ✅ KEY FIX: Uses _addPersistentSignal() to prevent signals from disappearing
// • Signals are stored in this._confirmedSignals Map
// • They persist across update() calls when new candles arrive
// • Each signal is added only once per candle time (prevents duplicates)
// =============================================================================

Indicators.SignalArrows = class extends IndicatorBase {
    // Constructor: Initialize crossover signal settings
    constructor() {
        super({ type: 'overlay' }); // Draw markers on main price chart
        
        this.settings = {
            fastPeriod: 10,          // Period for fast moving average
            slowPeriod: 20,          // Period for slow moving average
            buyColor: '#00C510',     // Green for buy signals
            sellColor: '#ff0000'     // Red for sell signals
        };
        
        // Buffers for calculating fast and slow moving averages
        this._fastBuffer = [];
        this._slowBuffer = [];
        
        // Cache previous MA values for crossover detection
        this._lastFast = null;
        this._lastSlow = null;
    }

    // Helper: Calculate simple moving average with buffer management
    // Returns null if buffer doesn't have enough data yet
    _calculateMA(buffer, price, period) {
        // Add new price to buffer
        buffer.push(price);
        
        // Maintain buffer size: remove oldest when exceeding period
        if (buffer.length > period) buffer.shift();
        
        // Safety: prevent unbounded growth in edge cases
        if (buffer.length > 5000) buffer.splice(0, buffer.length - 2000);
        
        // Return null if not enough data for calculation
        if (buffer.length < period) return null;
        
        // Calculate and return simple moving average
        return buffer.reduce((a, b) => a + b, 0) / buffer.length;
    }

    // Update: Detect crossover signals in historical data
    // Generates arrow markers at crossover points (PERSISTENT)
    update(candles) {
        try {
            // Need enough candles for the slower MA period
            if (!candles || candles.length < this.settings.slowPeriod) return;
            
            // Reset buffers and state for fresh calculation
            this._fastBuffer = [];
            this._slowBuffer = [];
            this._lastFast = null;
            this._lastSlow = null;
            
            for (let i = 0; i < candles.length; i++) {
                const candle = candles[i];
                const close = candle.close;
                
                // Calculate both moving averages for current candle
                const fastMA = this._calculateMA(this._fastBuffer, close, this.settings.fastPeriod);
                const slowMA = this._calculateMA(this._slowBuffer, close, this.settings.slowPeriod);
                
                // Detect crossover: need current AND previous values for both MAs
                if (fastMA !== null && slowMA !== null && this._lastFast !== null && this._lastSlow !== null) {
                    
                    // BULLISH CROSSOVER: Fast MA crosses ABOVE Slow MA
                    // Condition: Previously fast <= slow, now fast > slow
                    if (this._lastFast <= this._lastSlow && fastMA > slowMA) {
                        // ✅ FIX: Use _addPersistentSignal for permanent marker
                        this._addPersistentSignal(
                            candle.time,
                            'buy',
                            'belowBar',
                            this.settings.buyColor,
                            'arrowUp',
                            'BUY'
                        );
                    }
                    
                    // BEARISH CROSSOVER: Fast MA crosses BELOW Slow MA
                    // Condition: Previously fast >= slow, now fast < slow
                    else if (this._lastFast >= this._lastSlow && fastMA < slowMA) {
                        // ✅ FIX: Use _addPersistentSignal for permanent marker
                        this._addPersistentSignal(
                            candle.time,
                            'sell',
                            'aboveBar',
                            this.settings.sellColor,
                            'arrowDown',
                            'SELL'
                        );
                    }
                }
                
                // Cache current MA values for next iteration's crossover check
                this._lastFast = fastMA;
                this._lastSlow = slowMA;
            }
            
            // ✅ FIX: Render ALL confirmed signals (not just new ones)
            // This ensures persistent signals stay visible across updates
            const allMarkers = this._getConfirmedMarkers();
            if (allMarkers.length > 0) {
                this.setMarkers(allMarkers);
            }
            
            this._initialized = true;
        } catch (e) { console.warn('SignalArrows update error:', e); }
    }

    // UpdateLast: Signals only appear on closed candles (no live jitter)
    // Markers are not updated live to prevent flickering and false signals
    updateLast(candle) {
        // Intentionally empty: signals are only valid on closed candles
        // Live candle crossovers are not confirmed until candle closes
        // This prevents whipsaw signals from intraday noise
    }

    // Destroy: Clean up buffers and remove markers
    destroy() {
        this._fastBuffer = [];
        this._slowBuffer = [];
        this._lastFast = null;
        this._lastSlow = null;
        this._clearOwnMarkers(); // Remove all markers created by this indicator
        super.destroy();
    }
};
`;

/**
 * AreaFill - Full educational comments
 */
const TPL_AREA = `
// =============================================================================
// AreaFill - Colored Area Indicator
// Description: Displays indicator values as a filled area under the line
// Use Case: Visual emphasis of indicator levels, zone-based strategies
// Styling: Configurable line color, top fill, bottom fill with transparency
// =============================================================================

Indicators.AreaFill = class extends IndicatorBase {
    // Constructor: Initialize area fill settings
    constructor() {
        super({ type: 'overlay' }); // Draw area on main price chart
        
        this.settings = {
            period: 30,                      // Calculation period
            lineColor: '#8b5cf6',            // Purple line color
            topColor: 'rgba(139,92,246,0.35)',  // Semi-transparent purple fill (top)
            bottomColor: 'rgba(139,92,246,0.0)' // Fully transparent fill (bottom)
        };
        
        // Buffer for price values in calculation
        this._buffer = [];
        
        // Reference to the area series
        this._series = null;
    }

    // Init: Create area series with gradient fill styling
    init(cm) {
        super.init(cm);
        this._series = this.createOverlayArea({
            // Line styling
            lineColor: this.settings.lineColor,
            lineWidth: 2,
            
            // Fill styling: gradient from topColor to bottomColor
            topColor: this.settings.topColor,      // Color at top of filled area
            bottomColor: this.settings.bottomColor, // Color at bottom (transparent)
            
            // Display options
            lastValueVisible: true,
            priceLineVisible: false,
            title: 'Area'
        });
    }

    // Update: Calculate area values for historical candles
    // Same calculation logic as SMA, but rendered as filled area
    update(candles) {
        try {
            if (!candles || candles.length < this.settings.period) return;
            
            this._buffer = [];
            const result = [];
            
            for (let i = 0; i < candles.length; i++) {
                const candle = candles[i];
                this._buffer.push(candle.close);
                
                if (this._buffer.length > this.settings.period) {
                    this._buffer.shift();
                }
                
                if (this._buffer.length === this.settings.period) {
                    // Calculate simple moving average
                    const sum = this._buffer.reduce((a, b) => a + b, 0);
                    const value = sum / this._buffer.length;
                    
                    result.push({ time: candle.time, value: value });
                    
                    // Cache for stable live extension
                    this._lastCalculatedValue = value;
                    this._lastClosedCandle = candle;
                }
            }
            
            if (result.length > 0 && this._series) {
                this._series.setData(result);
            }
            this._initialized = true;
        } catch (e) { console.warn('AreaFill update error:', e); }
    }

    // UpdateLast: Extend last area value for stable live preview
    updateLast(candle) {
        if (this._initialized && candle && this._series && this._lastCalculatedValue !== null) {
            this._series.update({ time: candle.time, value: this._lastCalculatedValue });
        }
    }

    // Destroy: Clean up area fill resources
    destroy() {
        this._buffer = [];
        this._series = null;
        super.destroy();
    }
};
`;

// =============================================================================
// 📋 TEMPLATES REGISTRY
// =============================================================================
const TEMPLATES = {
    ma: {
        name: 'MovingAverage',
        type: 'ov',
        code: TPL_MA,
        description: 'Simple Moving Average (SMA) - Track general trend direction'
    },
    ema: {
        name: 'EMA',
        type: 'ov',
        code: TPL_EMA,
        description: 'Exponential Moving Average (EMA) - More responsive to recent prices'
    },
    bb: {
        name: 'BollingerBands',
        type: 'ov',
        code: TPL_BB,
        description: 'Bollinger Bands - Measure volatility and dynamic support/resistance'
    },
    vwap: {
        name: 'VWAP',
        type: 'ov',
        code: TPL_VWAP,
        description: 'Volume Weighted Average Price - Institutional trading reference'
    },
    pivot: {
        name: 'PivotPoints',
        type: 'ov',
        code: TPL_PIVOT,
        description: 'Classic Pivot Points - Daily support/resistance levels'
    },
    arrows: {
        name: 'SignalArrows',
        type: 'ov',
        code: TPL_ARROWS,
        description: 'Signal Arrows - Fast/slow MA crossover for buy/sell signals (PERSISTENT)'
    },
    area: {
        name: 'AreaFill',
        type: 'ov',
        code: TPL_AREA,
        description: 'Area Fill - Visual display of averages with colored zones'
    },
    custom: {
        name: 'MyCustomIndicator',
        type: 'ov',
        code: TPL_CUSTOM,
        description: 'Custom Indicator - Complete educational template with full English comments + PERSISTENT SIGNALS',
        isTemplate: true,
        help: `
📚 Complete Guide to Programming Custom Indicators:

🔹 CLASS STRUCTURE:
   class MyIndicator extends IndicatorBase {
       constructor() { super({type:'overlay'}); ... }
       init(cm) { ... }
       update(candles) { ... }
       updateLast(candle) { ... }
       destroy() { ... }
   }

🔹 SETTINGS MANAGEMENT:
   this.settings = {
       period: 14,           // Calculation period
       color: '#fff',        // Display color
       lineWidth: 2,         // Line thickness
       // Add more options as needed
   };

🔹 CHART INTEGRATION:
   // In init():
   this._series = this.createOverlayLine({
       color: this.settings.color,
       lineWidth: this.settings.lineWidth,
       lastValueVisible: true,
       priceLineVisible: false,
       title: 'My Indicator'
   });

🔹 DATA CALCULATION (update method):
   // 1. Validate input: if (!candles || candles.length < period) return;
   // 2. Process candles in loop: for (let i = 0; i < candles.length; i++)
   // 3. Use candle properties: candle.close, candle.high, candle.low, candle.volume
   // 4. Calculate your formula and store result: {time: candle.time, value: result}
   // 5. Cache for live: this._lastCalculatedValue = result;
   // 6. Render: this._series.setData(resultArray);

🔹 STABLE LIVE UPDATES (updateLast method):
   // CRITICAL: Do NOT recalculate with changing candle.close!
   // Instead, extend last stable value:
   if (this._lastCalculatedValue !== null) {
       this._series.update({ time: candle.time, value: this._lastCalculatedValue });
   }

🔹 SIGNAL MARKERS (PERSISTENT - WON'T DISAPPEAR):
   // ✅ Use _addPersistentSignal() for permanent signals:
   this._addPersistentSignal(
       candle.time,           // Unique time key
       'buy',                 // Signal type: 'buy' or 'sell'
       'belowBar',            // Position: 'aboveBar', 'belowBar', or 'inBar'
       '#00C510',             // Color
       'arrowUp',             // Shape: 'arrowUp', 'arrowDown', 'circle', etc.
       '↗'                    // Short label (1-3 chars)
   );
   
   // ✅ Render ALL confirmed signals:
   const allMarkers = this._getConfirmedMarkers();
   if (allMarkers.length > 0) {
       this.setMarkers(allMarkers);
   }

🔹 MEMORY MANAGEMENT (destroy method):
   // 1. Clear buffers: this._buffer = [];
   // 2. Nullify references: this._series = null;
   // 3. Clear persistent signals: this._confirmedSignals?.clear();
   // 4. ALWAYS call parent last: super.destroy();

💡 PROFESSIONAL BEST PRACTICES:
   • Calculate on CLOSED candles only in update() for accuracy
   • Use updateLast() ONLY to extend visual position, never recalculate
   • Use _addPersistentSignal() for signals that must persist across updates
   • Wrap calculations in try/catch to prevent chart crashes
   • Validate input data before processing
   • Keep updateLast() extremely lightweight (no loops, heavy math)
   • Test with both historical and live data before deployment

🔧 TROUBLESHOOTING:
   • Indicator not drawing? Check: update() returns [{time,value},...] array
   • Line jittering on live candle? You're recalculating in updateLast() - stop!
   • Signals disappearing? Use _addPersistentSignal() instead of direct setMarkers()
   • Memory leak? Ensure destroy() clears buffers AND _confirmedSignals
        `
    }
};

// =============================================================================
// 🌍 GLOBAL EXPORTS
// =============================================================================
window.IndicatorBase = IndicatorBase;
window.Indicators = window.Indicators || {};
window.TEMPLATES = TEMPLATES;

console.log('✅ indicators.js v3.2 initialized - Full educational comments + PERSISTENT SIGNALS');
console.log('📦 Available templates:', Object.keys(TEMPLATES).join(', '));
