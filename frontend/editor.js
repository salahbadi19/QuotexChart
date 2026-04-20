/**
 * 🛠️ editor.js — FINAL STABLE VERSION (Fixed STORAGE_VERSION & Scope Issues)
 * =============================================================================
 * ✅ FIXED: ReferenceError: STORAGE_VERSION is not defined (Added local constant)
 * ✅ FIXED: "not a valid class constructor" error (fixed scope injection)
 * ✅ FIXED: "object is not extensible" error (sandbox Indicators is mutable)
 * ✅ Dependency validation at startup
 * ✅ Safe DOM rendering with data-attributes
 * ✅ Optimized indicator→file lookup with reverse mapping
 * ✅ Proper error logging & clear user messages
 * ✅ Enhanced Monaco IntelliSense
 * ✅ Efficient DOM updates using DocumentFragment
 * 
 * Dependencies: globals.js, indicators.js, chart.js
 */

// =============================================================================
// ⚙️ LOCAL CONSTANTS (Fallbacks for constants defined in datafeed.js)
// =============================================================================
// These ensure editor.js works even if datafeed.js hasn't exported them to window
const STORAGE_VERSION = window.CONFIG?.STORAGE_VERSION || 1;
const STORAGE_KEY = 'qx_data_v1'; 

// =============================================================================
// 🔒 Dependency Validation (Prevent silent failures)
// =============================================================================
(function validateDependencies() {
    const required = [
        'AppState', 'UI', 'CM', 'TEMPLATES', 
        'debounceRender', 'debounceLogic',
        'safeSaveStorage', 'safeLoadStorage',
        'sanitizeIndicatorName', 'isValidIndicatorName'
    ];
    const missing = required.filter(name => typeof window[name] === 'undefined');
    if (missing.length > 0) {
        console.error(`❌ editor.js requires these globals: ${missing.join(', ')}`);
        console.warn('💡 Ensure all dependencies load before editor.js');
        if (typeof toast === 'function') {
            toast('Editor missing dependencies. Please reload.', 'error');
        }
    }
})();

// =============================================================================
// 🚨 ERROR CARD MANAGEMENT
// =============================================================================
function showErrorCard(error) {
    const card = document.getElementById('errorCard'); 
    if (!card) return;
    const typeEl = document.getElementById('errorType'); 
    const lineEl = document.getElementById('errorLineBadge'); 
    const msgEl = document.getElementById('errorMsg');
    if (!typeEl || !lineEl || !msgEl) return;

    const errMsg = error.message || String(error);
    let errLine = null, errColumn = null;
    
    if (error.lineNumber) errLine = error.lineNumber; 
    if (error.columnNumber) errColumn = error.columnNumber;
    
    if (!errLine) { 
        const match = errMsg.match(/(?:line|at)\s+(\d+)(?::(\d+))?/i) || (error.stack?.match(/:(\d+):(\d+)/)); 
        if (match) { 
            errLine = parseInt(match[1], 10); 
            errColumn = match[2] ? parseInt(match[2], 10) : null; 
        } 
    }

    let errType = 'Runtime Error'; 
    if (errMsg.includes('TypeError')) errType = 'TypeError'; 
    else if (errMsg.includes('ReferenceError')) errType = 'ReferenceError'; 
    else if (errMsg.includes('SyntaxError')) errType = 'SyntaxError';

    typeEl.textContent = errType; 
    msgEl.textContent = errMsg;

    if (errLine !== null && errLine > 0) { 
        let lineText = 'Line ' + errLine; 
        if (errColumn) lineText += ':' + errColumn; 
        lineEl.textContent = lineText; 
        lineEl.style.opacity = '1'; 
        lineEl.style.cursor = 'pointer'; 
        lineEl.onclick = () => goToErrorLine(errLine, errColumn); 
    } else { 
        lineEl.textContent = 'No line info'; 
        lineEl.style.opacity = '0.4'; 
        lineEl.style.cursor = 'default'; 
        lineEl.onclick = null; 
    }

    highlightErrorLine(errLine, errColumn); 
    card.classList.add('visible');
}

function hideErrorCard() { 
    const card = document.getElementById('errorCard');
    if (card) card.classList.remove('visible'); 
    clearErrorHighlight(); 
}

function goToErrorLine(lineNum, column = 1) {
    if (!AppState.monacoEditor || !AppState.monacoReady || !lineNum) return;
    AppState.monacoEditor.revealLineInCenter(lineNum); 
    AppState.monacoEditor.setPosition({ lineNumber: lineNum, column: column || 1 }); 
    AppState.monacoEditor.focus(); 
    highlightErrorLine(lineNum, column);
}

function highlightErrorLine(lineNum, column) {
    if (!AppState.monacoEditor || !AppState.monacoReady) return; 
    clearErrorHighlight();
    if (!lineNum || lineNum < 1) return;
    try {
        const range = column 
            ? new monaco.Range(lineNum, column, lineNum, column + 10) 
            : new monaco.Range(lineNum, 1, lineNum, 1);
        AppState.errorDecorations = AppState.monacoEditor.deltaDecorations(AppState.errorDecorations, [{ 
            range, 
            options: { 
                isWholeLine: !column, 
                className: 'error-line-highlight', 
                glyphMarginClassName: 'error-glyph', 
                overviewRuler: { color: '#f85149', position: monaco.editor.OverviewRulerLane.Full } 
            } 
        }]);
    } catch(e) { 
        console.warn('⚠️ Highlight error failed:', e); 
    }
}

function clearErrorHighlight() { 
    if (!AppState.monacoEditor || !AppState.monacoReady) return; 
    try {
        AppState.errorDecorations = AppState.monacoEditor.deltaDecorations(AppState.errorDecorations, []); 
    } catch(e) {
        console.warn('⚠️ Clear highlight failed:', e);
    }
}

// =============================================================================
// 💾 STORAGE & FILE MANAGEMENT
// =============================================================================
const saveStorageDebounced = debounceLogic(() => {
    try {
        if (AppState.editorActive && AppState.editorFiles[AppState.editorActive] && AppState.monacoReady) {
            AppState.editorFiles[AppState.editorActive].code = AppState.monacoEditor.getValue();
        }
        
        const storable = {}; 
        for (const k in AppState.editorFiles) {
            storable[k] = { 
                code: AppState.editorFiles[k].code, 
                runState: AppState.editorFiles[k].runState, 
                indicatorName: AppState.editorFiles[k].indicatorName 
            };
        }
        
        // ✅ Uses local STORAGE_VERSION to fix ReferenceError
        window.safeSaveStorage({ version: STORAGE_VERSION, files: storable, active: AppState.editorActive });
    } catch(e) { 
        console.warn('⚠️ Save failed:', e); 
    }
}, 500);

function saveStorage() { saveStorageDebounced(); }

function loadStorage() {
    try {
        const data = window.safeLoadStorage();
        // ✅ Uses local STORAGE_VERSION for validation
        if (!data || data.version !== STORAGE_VERSION) return;
        if (data.files) AppState.editorFiles = data.files;
        if (data.active) AppState.editorActive = data.active;
        
        AppState.indicatorToFile = {};
        for (const fileName in AppState.editorFiles) {
            const indName = AppState.editorFiles[fileName].indicatorName || fileName;
            AppState.indicatorToFile[indName] = fileName;
        }
    } catch(e) { 
        console.warn('⚠️ Load failed:', e); 
    }
}

// =============================================================================
// 🖥️ MONACO EDITOR INITIALIZATION
// =============================================================================
function initMonaco() {
    if (AppState.monacoReady) return;

    if (typeof require === 'undefined') { 
        console.error('❌ Monaco loader not found'); 
        return; 
    }
    
    require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.45.0/min/vs' } });
    require(['vs/editor/editor.main'], function() {
        try {
            monaco.languages.typescript.javascriptDefaults.addExtraLib(`
declare class IndicatorBase {
    id: string; type: string; paneId: string | null; 
    _buffer: number[]; _initialized: boolean; visible: boolean; settings: any;
    init(cm: any): void; update(candles: Array<any>): void; updateLast(candle: any): void; 
    recalculate?(candles: Array<any>): void; destroy(): void; toggleVisibility(): void; 
    createOverlayLine(options: any): any; createOverlayArea(options: any): any;
    createPaneLine(paneId: string, paneName: string, options: any): any; 
    createPaneHistogram(paneId: string, paneName: string, options: any): any;
    setMarkers(markers: Array<any>): void; hasCustomUpdateLast(): boolean; 
    _clearOwnMarkers(): void; _generateMarkerId(type: string, time: number): string;
}
declare const Indicators: Record<string, any>;
declare const CM: { mainChart: any; mainSeries: any; createPane(id:string,name:string):any; releasePane(id:string):void; markMarkersDirty():void; updateAllMarkers():void; _scheduleResize():void; };
declare const AppState: { currentCandles:Array<any>; currentAsset:string; currentTimeframe:string; indicators:Record<string,any>; editorFiles:Record<string,{code:string,runState:string,indicatorName:string}>; editorActive:string|null; monacoEditor:any; monacoReady:boolean; isUserInteracting:boolean; debugMode:boolean; chartColors:any; };
declare const UI: { monacoContainer:HTMLElement; tabBar:HTMLElement; editorPanel:HTMLElement; indicatorName:HTMLInputElement; editorStatus:HTMLElement; btnRun:HTMLElement; btnStop:HTMLElement; indicatorsList:HTMLElement; indSettingsModal:HTMLElement; indSettingsContent:HTMLElement; indSettingsTitle:HTMLElement; templateSelect:HTMLSelectElement; newFileCard:HTMLElement; nfFileName:HTMLInputElement; nfError:HTMLElement; editorInfo:HTMLElement; };
declare function debounceRender(fn:Function,delay:number):Function;
declare function debounceLogic(fn:Function,delay:number):Function;
declare function safeSaveStorage(any):void;
declare function safeLoadStorage():any;
declare function sanitizeIndicatorName(name:string):string;
declare function isValidIndicatorName(name:string):boolean;
declare function toast(message:string,type:'success'|'error'|'warning'|'info'):void;
            `, 'globals.d.ts');

            monaco.editor.defineTheme('qx', {
                base: 'vs-dark', inherit: true,
                rules: [
                    {token: 'keyword', foreground: '60a5fa', fontStyle: 'bold'},
                    {token: 'string', foreground: '00C510'}, 
                    {token: 'number', foreground: 'd4af37'},
                    {token: 'comment', foreground: '6b7280', fontStyle: 'italic'}, 
                    {token: 'type', foreground: 'f472b6'},
                    {token: 'class', foreground: 'f472b6'}, 
                    {token: 'function', foreground: 'c084fc'},
                    {token: 'variable', foreground: 'bfdbfe'}, 
                    {token: 'constant', foreground: 'fbbf24'},
                    {token: 'operator', foreground: '94a3b8'}, 
                    {token: 'delimiter', foreground: '64748b'}
                ],
                colors: {
                    'editor.background': '#0d1117', 'editor.foreground': '#c9d1d9',
                    'editor.lineHighlightBackground': '#161b22', 'editor.selectionBackground': '#1e3a8a',
                    'editorCursor.foreground': '#60a5fa', 'editorLineNumber.foreground': '#484f58',
                    'editorLineNumber.activeForeground': '#93c5fd', 'scrollbarSlider.background': '#30363d80'
                }
            });

            const container = UI?.monacoContainer;
            if (!container) { 
                console.error('❌ Monaco container missing'); 
                return; 
            }
            
            const defaultCode = (typeof TEMPLATES !== 'undefined' && TEMPLATES.custom) 
                ? TEMPLATES.custom.code 
                : '// Write your indicator here...\nIndicators.MyIndicator = class extends IndicatorBase {\n    constructor() { super({type:"overlay"}); }\n    init(cm) { super.init(cm); }\n    update(c) { this._initialized = true; }\n};';
            
            AppState.monacoEditor = monaco.editor.create(container, {
                value: defaultCode, language: 'javascript', theme: 'qx', fontSize: 13, 
                fontFamily: "'Fira Code', monospace", fontLigatures: true, lineHeight: 1.6,
                minimap: { enabled: false }, scrollBeyondLastLine: false, tabSize: 4, insertSpaces: true, 
                matchBrackets: 'always', bracketPairColorization: { enabled: true }, smoothScrolling: true,
                cursorSmoothCaretAnimation: 'on', padding: { top: 12, bottom: 12 }, 
                suggestOnTriggerCharacters: true, quickSuggestions: true, parameterHints: { enabled: true }, 
                automaticLayout: true, glyphMargin: true
            });

            AppState.monacoEditor.onDidChangeModelContent(() => {
                if (!AppState.monacoEditor) return; 
                const model = AppState.monacoEditor.getModel(); 
                if (model && UI.editorInfo) {
                    UI.editorInfo.textContent = 'JavaScript | ' + model.getLineCount() + ' lines';
                }
                if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) {
                    AppState.editorFiles[AppState.editorActive].code = AppState.monacoEditor.getValue();
                }
                saveStorageDebounced();
            });

            AppState.monacoReady = true;
            console.log('✅ Monaco ready');
            
            const keys = Object.keys(AppState.editorFiles);
            if (keys.length > 0) { 
                let activeFile = AppState.editorActive || keys[0]; 
                if (!AppState.editorFiles[activeFile]) activeFile = keys[0]; 
                _loadFileIntoEditor(activeFile); 
                updateTabs(activeFile); 
            } else { 
                loadTemplate(); 
            }
            
            if (typeof toast === 'function') toast('Editor loaded', 'success');
        } catch(e) { 
            console.error('❌ Monaco init failed:', e); 
        }
    });
}

function getCode() { 
    return (AppState.monacoEditor && AppState.monacoReady) ? AppState.monacoEditor.getValue() : ''; 
}

function setCode(c) { 
    if (AppState.monacoEditor && AppState.monacoReady) {
        AppState.monacoEditor.setValue(c); 
    }
}

window._resizeMonaco = function() { 
    if (AppState.monacoEditor && AppState.monacoReady && UI.monacoContainer) { 
        const r = UI.monacoContainer.getBoundingClientRect(); 
        AppState.monacoEditor.layout({ width: r.width, height: r.height }); 
    } 
};

// =============================================================================
// 📑 TABS & FILE UI MANAGEMENT
// =============================================================================
function updateTabDot(indicatorName, state) {
    const fileName = AppState.indicatorToFile?.[indicatorName];
    if (fileName && AppState.editorFiles[fileName]) { 
        AppState.editorFiles[fileName].runState = state; 
        renderTabs(); 
        return; 
    }
    for (const k in AppState.editorFiles) { 
        if (AppState.editorFiles[k].indicatorName === indicatorName) { 
            AppState.editorFiles[k].runState = state; 
            renderTabs(); 
            return; 
        } 
    } 
}

let _renderTabsPending = false;

function renderTabs() {
    if (_renderTabsPending) return; 
    _renderTabsPending = true;
    
    debounceRender(() => {
        _renderTabsPending = false; 
        const bar = UI.tabBar; 
        const keys = Object.keys(AppState.editorFiles);
        
        if (!bar) return;
        if (!keys.length) { 
            bar.innerHTML = ''; 
            return; 
        }
        
        const fragment = document.createDocumentFragment();
        
        keys.forEach(k => { 
            const f = AppState.editorFiles[k]; 
            const rs = f.runState || 'stopped'; 
            const isActive = (k === AppState.editorActive);
            
            const tab = document.createElement('div');
            tab.className = 'tab' + (isActive ? ' active' : '');
            tab.dataset.file = k;
            
            const dot = document.createElement('span');
            dot.className = 'tab-status-dot ' + rs;
            
            const name = document.createElement('span');
            name.className = 'tab-name';
            name.textContent = k;
            
            const close = document.createElement('span');
            close.className = 'tab-x';
            close.dataset.action = 'close';
            close.dataset.file = k;
            close.innerHTML = '&#215;';
            
            tab.append(dot, name, close);
            fragment.appendChild(tab);
        });
        
        bar.innerHTML = '';
        bar.appendChild(fragment);
    }, 16)();
}

function updateTabs(active) { 
    AppState.editorActive = active; 
    renderTabs(); 
}

function _loadFileIntoEditor(name) {
    const f = AppState.editorFiles[name]; 
    if (!f) return;
    
    if (AppState.editorActive && AppState.editorActive !== name && 
        AppState.editorFiles[AppState.editorActive] && AppState.monacoReady) {
        AppState.editorFiles[AppState.editorActive].code = AppState.monacoEditor.getValue();
    }
    
    AppState.editorActive = name; 
    if (AppState.monacoEditor && AppState.monacoReady) {
        AppState.monacoEditor.setValue(f.code || '');
    }
    
    const indName = f.indicatorName || name; 
    UI.indicatorName.value = indName; 
    UI.editorStatus.textContent = 'File: ' + name; 
    UI.editorStatus.style.color = '#22c55e';
    _syncRunButtons(f.runState); 
    hideErrorCard(); 
    renderTabs();
}

function _syncRunButtons(runState) {
    if (runState === 'running') { 
        UI.btnRun.style.display = 'none'; 
        UI.btnStop.style.display = 'inline-flex'; 
        UI.editorStatus.style.color = '#00C510'; 
    } else { 
        UI.btnRun.style.display = 'inline-flex'; 
        UI.btnStop.style.display = 'none'; 
        if (runState === 'error') {
            UI.editorStatus.style.color = '#f85149'; 
        }
    }
}

function swFile(name) { 
    if (name === AppState.editorActive) return; 
    if (AppState.editorActive && AppState.editorFiles[AppState.editorActive] && AppState.monacoReady) {
        AppState.editorFiles[AppState.editorActive].code = AppState.monacoEditor.getValue(); 
    }
    _loadFileIntoEditor(name); 
    updateTabs(name); 
    saveStorageDebounced(); 
}

function rmFile(name) {
    const f = AppState.editorFiles[name]; 
    if (f) { 
        const indName = f.indicatorName || name; 
        if (AppState.indicators[indName]) { 
            cleanupIndicator(indName); 
            renderIndList(); 
        }
        if (AppState.indicatorToFile) {
            delete AppState.indicatorToFile[indName];
        }
    }
    delete AppState.editorFiles[name]; 
    const keys = Object.keys(AppState.editorFiles);
    
    if (keys.length > 0) {
        swFile(keys[0]); 
    } else { 
        AppState.editorActive = null; 
        updateTabs(null); 
        if (AppState.monacoReady) {
            setCode(typeof TEMPLATES !== 'undefined' && TEMPLATES.custom ? TEMPLATES.custom.code : ''); 
        }
        UI.indicatorName.value = 'MyIndicator'; 
        UI.btnRun.style.display = 'inline-flex'; 
        UI.btnStop.style.display = 'none'; 
    }
    saveStorageDebounced();
}

function openEditor() { 
    if (UI.editorPanel) { 
        UI.editorPanel.classList.add('open'); 
        requestAnimationFrame(() => requestAnimationFrame(() => window._resizeMonaco?.())); 
    } 
}

function closeEditor() { 
    UI.editorPanel?.classList.remove('open'); 
}

// =============================================================================
// ▶️ INDICATOR EXECUTION — ROBUST & ERROR-FREE
// =============================================================================
function runIndicator() {
    const manager = window.CM || (typeof CM !== 'undefined' ? CM : null);
    if (!manager) {
        if (typeof toast === 'function') toast('⚠️ Chart is still initializing... Please wait 2 seconds.', 'warning');
        return;
    }

    let name = UI.indicatorName.value.trim();
    name = sanitizeIndicatorName(name);
    
    if (!name || !isValidIndicatorName(name)) {
        showErrorCard({ message: 'Indicator name must start with a letter/underscore and not be a reserved word' });
        return;
    }
    if (!AppState.currentCandles || AppState.currentCandles.length < 10) {
        if (typeof toast === 'function') toast('Waiting for market data...', 'info');
        return;
    }
    
    const code = getCode();
    if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) {
        AppState.editorFiles[AppState.editorActive].code = code;
        AppState.editorFiles[AppState.editorActive].indicatorName = name;
    }
    
    hideErrorCard();
    
    try {
        // ✅ PREPARE SANDBOX: Extensible Indicators object
        const sandboxIndicators = { ...window.Indicators };
        
        const sandbox = {
            Indicators: sandboxIndicators,  // Mutable, allows user to add new indicators
            IndicatorBase: window.IndicatorBase,
            console: { log: console.log, warn: console.warn, error: console.error },
            Math, Date, Array, Object, Number, String, Boolean, parseFloat, parseInt
        };
        
        // ✅ ROBUST EXECUTION: Explicitly inject variables into function scope
        // This avoids scoping bugs with destructuring in strict mode
        const body = `"use strict";
            var Indicators = sandbox.Indicators;
            var IndicatorBase = sandbox.IndicatorBase;
            var console = sandbox.console;
            var Math = sandbox.Math;
            var Date = sandbox.Date;
            var Array = sandbox.Array;
            var Object = sandbox.Object;
            var Number = sandbox.Number;
            var String = sandbox.String;
            var Boolean = sandbox.Boolean;
            var parseFloat = sandbox.parseFloat;
            var parseInt = sandbox.parseInt;

            ${code}

            return Indicators["${name}"];
        `;
        
        const factory = new Function('sandbox', body);
        const Cls = factory(sandbox);
        
        // ✅ Clear validation messages
        if (!Cls) {
            throw new Error(`Indicator "${name}" was not registered.\n✅ Ensure your code contains: Indicators.${name} = class extends IndicatorBase { ... }`);
        }
        if (typeof Cls !== 'function') {
            throw new Error(`"${name}" is not a valid class constructor (got ${typeof Cls}).\n✅ Make sure you used "Indicators.${name} = class ..." not just "class ..." `);
        }
        
        const instance = new Cls();
        if (!(instance instanceof IndicatorBase)) {
            throw new Error(`"${name}" must extend IndicatorBase.`);
        }
        
        // Clean up existing instance
        if (AppState.indicators[name]) cleanupIndicator(name);
        
        // Initialize and run
        instance.init(manager);
        instance.update(AppState.currentCandles);
        AppState.indicators[name] = instance;
        
        // Update reverse mapping
        if (AppState.editorActive) {
            AppState.indicatorToFile = AppState.indicatorToFile || {};
            AppState.indicatorToFile[name] = AppState.editorActive;
        }
        
        if (typeof manager.markMarkersDirty === 'function') manager.markMarkersDirty();
        if (typeof manager.updateAllMarkers === 'function') manager.updateAllMarkers();
        
        if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) {
            AppState.editorFiles[AppState.editorActive].runState = 'running';
        }
        
        UI.btnRun.style.display = 'none'; 
        UI.btnStop.style.display = 'inline-flex';
        UI.editorStatus.textContent = 'Running: ' + name; 
        UI.editorStatus.style.color = '#00C510';
        renderTabs(); 
        
        if (typeof toast === 'function') toast('Indicator started: ' + name, 'success');
        renderIndList(); 
        saveStorageDebounced();
        
    } catch(e) {
        console.error('❌ Indicator Error:', e);
        showErrorCard(e);
        
        if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) {
            AppState.editorFiles[AppState.editorActive].runState = 'error';
        }
        UI.editorStatus.textContent = 'Error: ' + (e.name || 'Runtime Error'); 
        UI.editorStatus.style.color = '#f85149';
        UI.btnRun.style.display = 'inline-flex'; 
        UI.btnStop.style.display = 'none';
        renderTabs();
    }
}

function stopIndicator() {
    const name = sanitizeIndicatorName(UI.indicatorName.value.trim());
    let targetName = name;
    
    if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) {
        const fileIndName = AppState.editorFiles[AppState.editorActive].indicatorName;
        if (fileIndName && AppState.indicators[fileIndName]) targetName = fileIndName;
    }
    
    if (AppState.indicators[targetName]) {
        cleanupIndicator(targetName);
        if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) {
            AppState.editorFiles[AppState.editorActive].runState = 'stopped';
        }
        UI.btnRun.style.display = 'inline-flex'; 
        UI.btnStop.style.display = 'none';
        UI.editorStatus.textContent = 'Stopped'; 
        UI.editorStatus.style.color = '#f87171';
        hideErrorCard(); 
        renderTabs(); 
        if (typeof toast === 'function') toast('Indicator stopped & removed', 'info');
        renderIndList(); 
        saveStorageDebounced(); 
        return;
    }
    
    if (AppState.indicators[name]) {
        cleanupIndicator(name); 
        updateTabDot(name, 'stopped'); 
        hideErrorCard();
        UI.btnRun.style.display = 'inline-flex'; 
        UI.btnStop.style.display = 'none';
        UI.editorStatus.textContent = 'Stopped'; 
        UI.editorStatus.style.color = '#f87171';
        renderTabs(); 
        if (typeof toast === 'function') toast('Indicator stopped', 'info'); 
        renderIndList(); 
        saveStorageDebounced();
    }
}

window.cleanupIndicator = function(name) { 
    if (AppState.indicators[name]) { 
        try { AppState.indicators[name].destroy(); } catch(e) { console.warn(`⚠️ Destroy failed: ${name}`, e); } 
        delete AppState.indicators[name];
        if (AppState.indicatorToFile?.[name]) delete AppState.indicatorToFile[name];
        if (CM) { CM.markMarkersDirty(); CM.updateAllMarkers(); } 
    } 
};

function clearAll() { 
    Object.keys(AppState.indicators).forEach(key => cleanupIndicator(key)); 
    Object.keys(AppState.editorFiles).forEach(k => { AppState.editorFiles[k].runState = 'stopped'; }); 
    AppState.indicatorToFile = {};
    hideErrorCard(); 
    UI.btnRun.style.display = 'inline-flex'; 
    UI.btnStop.style.display = 'none'; 
    UI.editorStatus.textContent = 'Cleared'; 
    UI.editorStatus.style.color = '#bfdbfe'; 
    renderTabs(); 
    if (typeof toast === 'function') toast('All indicators cleared', 'info'); 
    renderIndList(); 
    saveStorageDebounced(); 
}

// =============================================================================
// ⚙️ INDICATORS LIST & SETTINGS MODAL
// =============================================================================
function renderIndList() {
    const list = UI.indicatorsList; 
    if (!list) return;
    const fragment = document.createDocumentFragment();
    
    Object.keys(TEMPLATES).forEach(k => { 
        const t = TEMPLATES[k]; 
        const isActive = (t.name in AppState.indicators);
        const row = document.createElement('div');
        row.className = 'ind-row' + (isActive ? ' active' : '');
        
        const nameSpan = document.createElement('span');
        nameSpan.className = 'ind-name';
        nameSpan.dataset.indicator = t.name;
        nameSpan.dataset.key = k;
        nameSpan.textContent = t.name;
        
        const typeTag = document.createElement('span');
        typeTag.className = 'ind-type-tag ' + t.type;
        typeTag.textContent = t.type;
        nameSpan.appendChild(typeTag);
        row.appendChild(nameSpan);
        
        const btnContainer = document.createElement('span');
        if (isActive) {
            const gear = document.createElement('span');
            gear.className = 'ind-btn gear';
            gear.dataset.action = 'settings';
            gear.dataset.indicator = t.name;
            gear.innerHTML = '&#9881;';
            const toggle = document.createElement('span');
            toggle.className = 'ind-btn on';
            toggle.dataset.action = 'toggle';
            toggle.dataset.indicator = t.name;
            toggle.innerHTML = '&#10003;';
            btnContainer.append(gear, toggle);
        } else {
            const add = document.createElement('span');
            add.className = 'ind-btn off';
            add.dataset.action = 'add';
            add.dataset.indicator = t.name;
            add.dataset.key = k;
            add.textContent = '+';
            btnContainer.appendChild(add);
        }
        row.appendChild(btnContainer);
        fragment.appendChild(row);
    });
    
    list.innerHTML = '';
    list.appendChild(fragment);
}

function toggleInd(name, key) { 
    if (name in AppState.indicators) { 
        cleanupIndicator(name); 
        updateTabDot(name, 'stopped'); 
        hideErrorCard(); 
        renderIndList(); 
    } else { 
        const t = TEMPLATES[key]; 
        if (t) { UI.indicatorName.value = name; setCode(t.code); runIndicator(); } 
    } 
}

function toggleVis(name) { 
    if (AppState.indicators[name]) AppState.indicators[name].toggleVisibility(); 
    renderIndList(); 
}

function showIndSet(name) { 
    const inst = AppState.indicators[name]; 
    if (!inst || !inst.settings) return; 
    UI.indSettingsTitle.textContent = name; 
    let html = ''; 
    for (const k in inst.settings) { 
        const v = inst.settings[k]; 
        if (typeof v === 'number') html += `<div class="set-row"><label>${k}:</label><input type="number" value="${v}" id="iset_${k}"></div>`; 
        else if (typeof v === 'string' && v.charAt(0)==='#') html += `<div class="set-row"><label>${k}:</label><input type="color" value="${v}" id="iset_${k}"></div>`; 
        else html += `<div class="set-row"><label>${k}:</label><input type="text" value="${v}" id="iset_${k}"></div>`; 
    } 
    html += `<button class="set-btn apply" onclick="applyIndSet('${name}')">Apply</button><button class="set-btn remove" onclick="rmInd('${name}')">Remove</button>`; 
    UI.indSettingsContent.innerHTML = html; 
    UI.indSettingsModal.style.display = 'flex'; 
}

function applyIndSet(name) { 
    const inst = AppState.indicators[name]; 
    if (!inst) return; 
    const oldSettings = {...inst.settings}; 
    for (const k in inst.settings) { 
        const el = document.getElementById('iset_'+k); 
        if (!el) continue; 
        inst.settings[k] = typeof inst.settings[k]==='number' ? Number(el.value) : el.value; 
    } 
    try { 
        if (typeof inst.recalculate === 'function') { inst.recalculate(AppState.currentCandles); if (typeof toast === 'function') toast('Settings applied (fast): ' + name, 'success'); } 
        else { inst.update(AppState.currentCandles); if (typeof toast === 'function') toast('Settings applied: ' + name, 'success'); } 
    } catch(e) { 
        inst.settings = oldSettings; 
        showErrorCard(e); 
        if (typeof toast === 'function') toast('Error applying settings', 'error'); 
    } 
    closeModal('indSettingsModal'); 
    renderIndList(); 
    saveStorageDebounced(); 
}

function rmInd(name) { 
    cleanupIndicator(name); 
    updateTabDot(name, 'stopped'); 
    hideErrorCard(); 
    closeModal('indSettingsModal'); 
    renderIndList(); 
    saveStorageDebounced(); 
}

function closeModal(id) { document.getElementById(id).style.display = 'none'; }

// =============================================================================
// 📤 EXPORT & NEW FILE UI
// =============================================================================
function exportCSV() {
    if (!AppState.currentCandles.length) { if (typeof toast === 'function') toast('No data to export','error'); return; }
    const header = 'Time,Open,High,Low,Close'; 
    const rows = AppState.currentCandles.map(c => c.time + ',' + c.open + ',' + c.high + ',' + c.low + ',' + c.close);
    const csv = [header].concat(rows).join('\n'); 
    const blob = new Blob([csv], { type:'text/csv' }); 
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a'); a.href = url; a.download = AppState.currentAsset.replace(/[^a-z0-9]/gi,'_') + '_' + AppState.currentTimeframe + '.csv';
    document.body.appendChild(a); a.click(); document.body.removeChild(a); URL.revokeObjectURL(url); 
    if (typeof toast === 'function') toast('CSV exported','success');
}

function loadTemplate() { 
    const id = UI.templateSelect.value; 
    const t = typeof TEMPLATES !== 'undefined' ? TEMPLATES[id] : null;
    if (!t) return; 
    UI.indicatorName.value = t.name; setCode(t.code); 
    if (AppState.editorActive && AppState.editorFiles[AppState.editorActive]) { 
        AppState.editorFiles[AppState.editorActive].code = t.code; AppState.editorFiles[AppState.editorActive].indicatorName = t.name; 
    } 
    UI.editorStatus.textContent = t.name; UI.editorStatus.style.color = '#d4af37'; 
    UI.btnRun.style.display = 'inline-flex'; UI.btnStop.style.display = 'none'; hideErrorCard(); 
}

let nfTpl = 'custom';
function buildNfTpl() { 
    const c = UI.nfTemplates; if (!c) return; 
    let html = ''; 
    Object.keys(TEMPLATES).forEach(k => { html += `<div class="nf-tpl${k===nfTpl?' sel':''}" data-tpl="${k}">${k}</div>`; }); 
    c.innerHTML = html;
    c.querySelectorAll('.nf-tpl').forEach(el => { el.onclick = () => pickNfTpl(el.dataset.tpl); });
}
function pickNfTpl(k) { nfTpl = k; document.querySelectorAll('.nf-tpl').forEach(el => { el.classList.toggle('sel', el.getAttribute('data-tpl') === k); }); }
function hideNewFile() { UI.newFileCard.style.display = 'none'; }

// =============================================================================
// 🔌 INITIALIZATION & DOM EVENTS
// =============================================================================
function initEditor() {
    const required = ['AppState', 'UI', 'CM', 'TEMPLATES', 'debounceRender'];
    const missing = required.filter(name => typeof window[name] === 'undefined');
    if (missing.length > 0) { console.error(`❌ editor.js requires: ${missing.join(', ')}`); return; }
    
    console.log('🔧 Initializing editor UI...');
    AppState.indicatorToFile = AppState.indicatorToFile || {};
    for (const fileName in AppState.editorFiles) {
        const indName = AppState.editorFiles[fileName].indicatorName || fileName;
        AppState.indicatorToFile[indName] = fileName;
    }
    
    const errClose = document.getElementById('errorCardClose');
    if(errClose) errClose.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); hideErrorCard(); });
    const editorClose = document.getElementById('editorCloseBtn');
    if(editorClose) editorClose.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); closeEditor(); });

    ['assetsModal','timeframesModal','indicatorsModal','indSettingsModal'].forEach(id => {
        const el = document.getElementById(id);
        if(el) el.addEventListener('click', (e) => { if (e.target.classList.contains('modal-overlay')) closeModal(id); });
    });

    (function() {
        const h = document.getElementById('resizeHandle'); const p = UI.editorPanel; const hint = document.getElementById('sizeHint');
        if (!h || !p) return; let rz = false;
        const onMove = (e) => { if (!rz) return; const w = Math.max(320, Math.min(window.innerWidth-200, window.innerWidth-e.clientX)); p.style.width = w+'px'; p.style.transition = 'none'; if (hint) { hint.textContent = Math.round(w)+'px'; hint.classList.add('visible'); } window._resizeMonaco(); };
        const onUp = () => { if (!rz) return; rz = false; h.classList.remove('active'); if (hint) hint.classList.remove('visible'); document.body.style.cursor = ''; document.body.style.userSelect = ''; p.style.transition = ''; if (CM) CM._scheduleResize(); document.removeEventListener('mousemove', onMove); document.removeEventListener('mouseup', onUp); };
        h.addEventListener('mousedown', (e) => { rz = true; h.classList.add('active'); document.body.style.cursor = 'ew-resize'; document.body.style.userSelect = 'none'; e.preventDefault(); document.addEventListener('mousemove', onMove); document.addEventListener('mouseup', onUp); });
    })();

    document.getElementById('newFileBtn2')?.addEventListener('click', () => { UI.nfFileName.value = ''; UI.nfError.style.display = 'none'; buildNfTpl(); UI.newFileCard.style.display = 'block'; setTimeout(() => UI.nfFileName.focus(), 100); });
    document.getElementById('nfCreateBtn')?.addEventListener('click', () => {
        const nameInput = UI.nfFileName; const err = UI.nfError; let name = nameInput.value.trim().replace(/[^a-zA-Z0-9_]/g, '');
        if (!name) { err.textContent='Invalid name'; err.style.display='block'; return; }
        if (AppState.editorFiles[name]) { err.textContent='File exists'; err.style.display='block'; return; }
        const tpl = TEMPLATES[nfTpl] || TEMPLATES.custom; let code = tpl.code.replace(/(window\.)?Indicators\.(\w+)/g, 'Indicators.' + name);
        if (AppState.editorActive && AppState.editorFiles[AppState.editorActive] && AppState.monacoReady) AppState.editorFiles[AppState.editorActive].code = AppState.monacoEditor.getValue();
        AppState.editorFiles[name] = { code, runState: 'stopped', indicatorName: name }; AppState.editorActive = name;
        AppState.indicatorToFile = AppState.indicatorToFile || {}; AppState.indicatorToFile[name] = name;
        if (AppState.monacoReady) AppState.monacoEditor.setValue(code); UI.indicatorName.value = name; UI.editorStatus.textContent = 'File: ' + name; UI.editorStatus.style.color = '#22c55e';
        UI.btnRun.style.display = 'inline-flex'; UI.btnStop.style.display = 'none'; updateTabs(name); hideNewFile(); hideErrorCard(); saveStorageDebounced(); if (typeof toast === 'function') toast('Created: ' + name, 'success');
    });
    UI.nfFileName?.addEventListener('keydown', (e) => { if (e.key === 'Enter') document.getElementById('nfCreateBtn').click(); });

    document.addEventListener('keydown', (e) => {
        if (AppState.monacoReady && AppState.monacoEditor && AppState.monacoEditor.hasTextFocus()) {
            if (e.ctrlKey && e.key === 's') { e.preventDefault(); saveStorageDebounced(); if (typeof toast === 'function') toast('Saved','success'); }
            if (e.ctrlKey && e.key === 'Enter') { e.preventDefault(); runIndicator(); }
        }
        if (e.key === 'F12') { e.preventDefault(); AppState.debugMode = !AppState.debugMode; if (typeof toast === 'function') toast('Debug: ' + (AppState.debugMode ? 'ON' : 'OFF'), 'info'); }
    });

    UI.tabBar?.addEventListener('click', (e) => {
        const tab = e.target.closest('.tab');
        if (tab) { const file = tab.dataset.file; if (e.target.dataset.action === 'close') { e.stopPropagation(); rmFile(file); } else { swFile(file); } }
    });
    
    UI.indicatorsList?.addEventListener('click', (e) => {
        const nameSpan = e.target.closest('.ind-name'); const btn = e.target.closest('.ind-btn');
        if (nameSpan && !btn) { const name = nameSpan.dataset.indicator; const key = nameSpan.dataset.key; toggleInd(name, key); } 
        else if (btn) { const name = btn.dataset.indicator; const action = btn.dataset.action; if (action === 'settings') showIndSet(name); else if (action === 'toggle') toggleVis(name); else if (action === 'add') { const key = btn.dataset.key; toggleInd(name, key); } }
    });

    document.getElementById('assetsBtn')?.addEventListener('click', () => { if(typeof openAssetsModal==='function') openAssetsModal(); });
    document.getElementById('timeframesBtn')?.addEventListener('click', () => { if(typeof openTimeframesModal==='function') openTimeframesModal(); });
    document.getElementById('indicatorsBtn')?.addEventListener('click', () => { renderIndList(); UI.indicatorsModal.style.display = 'flex'; });
    document.getElementById('editorBtn')?.addEventListener('click', openEditor);

    window.Indicators = window.Indicators || {};
    loadStorage();
    initMonaco();
    console.log('✅ Editor UI initialized');
}

// =============================================================================
// ✅ GLOBAL EXPORTS
// =============================================================================
window.initEditor = initEditor;
window.runIndicator = runIndicator;
window.stopIndicator = stopIndicator;
window.clearAll = clearAll;
window.exportCSV = exportCSV;
window.loadTemplate = loadTemplate;
window.hideNewFile = hideNewFile;
window.closeModal = closeModal;
window.rmFile = rmFile;
window.swFile = swFile;
window.renderIndList = renderIndList;

console.log('✅ editor.js loaded — FULLY WORKING VERSION');
