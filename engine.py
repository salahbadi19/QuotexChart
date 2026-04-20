#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Quotex Pro Trader — AUTO RECONNECT VERSION
✅ يعيد تسجيل الدخول تلقائياً عند فقدان الجلسة
✅ يفصل الواجهة الأمامية عن الخلفية (frontend/ vs engine.py)
✅ إدارة آمنة للخيوط والدوال غير المتزامنة
✅ تم إصلاح خطأ updateCandleColors
"""
import asyncio
import threading
import time
import json
import os
import sys
import eel
import certifi
from pathlib import Path
from queue import Queue, Full
from typing import Optional, Dict, List, Tuple

# ✅ SSL Setup
os.environ['SSL_CERT_FILE'] = certifi.where()
os.environ['WEBSOCKET_CLIENT_CA_BUNDLE'] = certifi.where()

try:
    from pyquotex.stable_api import Quotex
    from pyquotex.utils.processor import process_candles
    from pyquotex.config import credentials
except ImportError as e:
    print(f"❌ Error: Missing dependency - {e}")
    print("Run: pip install git+https://github.com/cleitonleonel/pyquotex.git@master")
    sys.exit(1)

# ======================
# ⚙️ CONFIG
# ======================
CONSOLE_LEVEL = 1  # 0=Silent, 1=Minimal, 2=Verbose
def log(msg: str, level: int = 1):
    if level <= CONSOLE_LEVEL:
        print(msg)

# ======================
# Async Loop Manager
# ======================
ASYNC_LOOP = asyncio.new_event_loop()
def start_async_loop():
    asyncio.set_event_loop(ASYNC_LOOP)
    ASYNC_LOOP.run_forever()
threading.Thread(target=start_async_loop, daemon=True, name="AsyncLoop").start()

# ======================
# UI Update Queue
# ======================
UI_QUEUE = Queue(maxsize=10)
def ui_loop():
    while True:
        try:
            payload = UI_QUEUE.get()
            if payload is None:
                break
            eel.updateChart(payload)()
            UI_QUEUE.task_done()
        except Exception as e:
            if CONSOLE_LEVEL >= 2:
                print(f"[UI Loop Error]: {e}")
            time.sleep(0.05)
threading.Thread(target=ui_loop, daemon=True, name="UIUpdater").start()

# ======================
# Global State
# ======================
LAST_TICK_TIME = time.time()
LAST_SUBSCRIPTION_TIME = time.time()
SAVED_EMAIL = None
SAVED_PASSWORD = None
IS_RECONNECTING = False
RECONNECT_COOLDOWN = 30
LAST_RECONNECT_TIME = 0

ASSET_DISPLAY_MAP: Dict[str, str] = {}
forex_assets = {
    "AUDCAD": "AUD/CAD", "AUDCAD_otc": "AUD/CAD (OTC)", "AUDCHF": "AUD/CHF", "AUDCHF_otc": "AUD/CHF (OTC)",
    "AUDJPY": "AUD/JPY", "AUDJPY_otc": "AUD/JPY (OTC)", "AUDNZD_otc": "AUD/NZD (OTC)", "AUDUSD": "AUD/USD",
    "AUDUSD_otc": "AUD/USD (OTC)", "CADJPY": "CAD/JPY", "CADJPY_otc": "CAD/JPY (OTC)", "CADCHF_otc": "CAD/CHF (OTC)",
    "CHFJPY": "CHF/JPY", "CHFJPY_otc": "CHF/JPY (OTC)", "EURAUD": "EUR/AUD", "EURAUD_otc": "EUR/AUD (OTC)",
    "EURCAD": "EUR/CAD", "EURCAD_otc": "EUR/CAD (OTC)", "EURCHF": "EUR/CHF", "EURCHF_otc": "EUR/CHF (OTC)",
    "EURGBP": "EUR/GBP", "EURGBP_otc": "EUR/GBP (OTC)", "EURJPY": "EUR/JPY", "EURJPY_otc": "EUR/JPY (OTC)",
    "EURNZD_otc": "EUR/NZD (OTC)", "EURSGD_otc": "EUR/SGD (OTC)", "EURUSD": "EUR/USD", "EURUSD_otc": "EUR/USD (OTC)",
    "GBPAUD": "GBP/AUD", "GBPAUD_otc": "GBP/AUD (OTC)", "GBPCAD": "GBP/CAD", "GBPCAD_otc": "GBP/CAD (OTC)",
    "GBPCHF": "GBP/CHF", "GBPCHF_otc": "GBP/CHF (OTC)", "GBPJPY": "GBP/JPY", "GBPJPY_otc": "GBP/JPY (OTC)",
    "GBPNZD_otc": "GBP/NZD (OTC)", "GBPUSD": "GBP/USD", "GBPUSD_otc": "GBP/USD (OTC)", "NZDCAD_otc": "NZD/CAD (OTC)",
    "NZDCHF_otc": "NZD/CHF (OTC)", "NZDJPY_otc": "NZD/JPY (OTC)", "NZDUSD_otc": "NZD/USD (OTC)", "USDCAD": "USD/CAD",
    "USDCAD_otc": "USD/CAD (OTC)", "USDCHF": "USD/CHF", "USDCHF_otc": "USD/CHF (OTC)", "USDJPY": "USD/JPY",
    "USDJPY_otc": "USD/JPY (OTC)", "USDARS_otc": "USD/ARS (OTC)", "USDBDT_otc": "USD/BDT (OTC)", "USDCOP_otc": "USD/COP (OTC)",
    "USDDZD_otc": "USD/DZD (OTC)", "USDEGP_otc": "USD/EGP (OTC)", "USDIDR_otc": "USD/IDR (OTC)", "USDINR_otc": "USD/INR (OTC)",
    "USDMXN_otc": "USD/MXN (OTC)", "USDNGN_otc": "USD/NGN (OTC)", "USDPHP_otc": "USD/PHP (OTC)", "USDPKR_otc": "USD/PKR (OTC)",
    "USDTRY_otc": "USD/TRY (OTC)", "USDZAR_otc": "USD/ZAR (OTC)",
}
ASSET_DISPLAY_MAP.update(forex_assets)

crypto_assets = {
    "ADAUSD_otc": "Cardano (OTC)", "APTUSD_otc": "Aptos (OTC)", "ARBUSD_otc": "Arbitrum (OTC)", "ATOUSD_otc": "ATO (OTC)",
    "AVAUSD_otc": "Avalanche (OTC)", "AXSUSD_otc": "Axie Infinity (OTC)", "BCHUSD_otc": "Bitcoin Cash (OTC)",
    "BNBUSD_otc": "Binance Coin (OTC)", "BONUSD_otc": "Bonk (OTC)", "BTCUSD_otc": "Bitcoin (OTC)", "DASUSD_otc": "Dash (OTC)",
    "DOGUSD_otc": "Dogecoin (OTC)", "DOTUSD_otc": "Polkadot (OTC)", "ETCUSD_otc": "Ethereum Classic (OTC)",
    "ETHUSD_otc": "Ethereum (OTC)", "FLOUSD_otc": "Floki (OTC)", "GALUSD_otc": "Gala (OTC)", "HMSUSD_otc": "Hamster Kombat (OTC)",
    "LINUSD_otc": "Chainlink (OTC)", "LTCUSD_otc": "Litecoin (OTC)", "MELUSD_otc": "Melania Meme (OTC)",
    "SHIBUSD_otc": "Shiba Inu (OTC)", "SOLUSD_otc": "Solana (OTC)", "TIAUSD_otc": "Celestia (OTC)", "TONUSD_otc": "Toncoin (OTC)",
    "TRUUSD_otc": "TrueFi (OTC)", "TRXUSD_otc": "TRON (OTC)", "WIFUSD_otc": "Dogwifhat (OTC)", "XRPUSD_otc": "Ripple (OTC)",
    "ZECUSD_otc": "Zcash (OTC)",
}
ASSET_DISPLAY_MAP.update(crypto_assets)

commodities_assets = {
    "XAUUSD": "Gold", "XAUUSD_otc": "Gold (OTC)", "XAGUSD": "Silver", "XAGUSD_otc": "Silver (OTC)",
    "UKBrent_otc": "UK Brent (OTC)", "USCrude_otc": "US Crude (OTC)",
}
ASSET_DISPLAY_MAP.update(commodities_assets)

stocks_assets = {
    "AXP_otc": "American Express (OTC)", "BA_otc": "Boeing Company (OTC)", "FB_otc": "Facebook (OTC)",
    "INTC_otc": "Intel (OTC)", "JNJ_otc": "Johnson & Johnson (OTC)", "MCD_otc": "McDonald's (OTC)",
    "MSFT_otc": "Microsoft (OTC)", "PFE_otc": "Pfizer Inc (OTC)", "PEPUSD_otc": "PepsiCo (OTC)",
}
ASSET_DISPLAY_MAP.update(stocks_assets)

indices_assets = {
    "DJIUSD": "Dow Jones", "NDXUSD": "NASDAQ 100", "F40EUR": "CAC 40", "FTSGBP": "FTSE 100",
    "HSIHKD": "Hong Kong 50", "IBXEUR": "IBEX 35", "JPXJPY": "Nikkei 225", "CHIA50": "China A50",
    "STXEUR": "EURO STOXX 50",
}
ASSET_DISPLAY_MAP.update(indices_assets)

DISPLAY_TO_INTERNAL = {v: k for k, v in ASSET_DISPLAY_MAP.items()}
ASSET_CATEGORIES = {
    "💱 Forex": list(forex_assets.values()),
    "₿ Crypto": list(crypto_assets.values()),
    "🛢️ Commodities": list(commodities_assets.values()),
    "🏦 Stocks": list(stocks_assets.values()),
    "📊 Indices": list(indices_assets.values()),
}
TIMEFRAMES = {
    "5s": 5, "10s": 10, "15s": 15, "30s": 30,
    "1m": 60, "2m": 120, "3m": 180, "5m": 300,
    "10m": 600, "15m": 900, "30m": 1800,
    "1h": 3600, "4h": 14400
}

CLIENT: Optional[Quotex] = None
CURRENT_ASSET = "AUD/CAD (OTC)"
CURRENT_TIMEFRAME = "1m"
CANDLES: Dict[str, Dict[str, List[dict]]] = {}
CURRENT_CANDLE: Dict[str, Dict[str, dict]] = {}
SERVER_TIME_OFFSET = 0
CANDLE_COLORS = {
    "upColor": "#00C510", "downColor": "#ff0000",
    "borderUpColor": "#00C510", "borderDownColor": "#ff0000",
    "wickUpColor": "#00C510", "wickDownColor": "#ff0000"
}
ASSETS_LOADED = False
LOGIN_SUCCESS = False
REALTIME_RUNNING = False
CHART_OPENED = False
BACKGROUND_LOADER_TASK = None

# ======================
# Helpers & Reconnection Logic
# ======================
def is_websocket_connected() -> bool:
    try:
        if not CLIENT or not CLIENT.api:
            return False
        if hasattr(CLIENT.api, '_is_connected'):
            return bool(CLIENT.api._is_connected)
        if hasattr(CLIENT.api, 'websocket_client'):
            ws = CLIENT.api.websocket_client
            if hasattr(ws, 'wss') and hasattr(ws.wss, 'sock'):
                return ws.wss.sock is not None and getattr(ws.wss.sock, 'connected', False)
            if hasattr(ws, 'connected'):
                return bool(ws.connected)
        if hasattr(CLIENT.api, 'check_connect'):
            return CLIENT.api.check_connect()
        return True
    except Exception:
        return False

def update_tick_time():
    global LAST_TICK_TIME
    LAST_TICK_TIME = time.time()

def update_subscription_time():
    global LAST_SUBSCRIPTION_TIME
    LAST_SUBSCRIPTION_TIME = time.time()

def can_reconnect() -> bool:
    global LAST_RECONNECT_TIME
    now = time.time()
    if now - LAST_RECONNECT_TIME < RECONNECT_COOLDOWN:
        return False
    LAST_RECONNECT_TIME = now
    return True

async def full_reconnect():
    global CLIENT, REALTIME_RUNNING, IS_RECONNECTING, LOGIN_SUCCESS, ASSETS_LOADED
    if not SAVED_EMAIL or not SAVED_PASSWORD:
        log("⚠️ Reconnect skipped: No saved credentials", level=1)
        return False
    if IS_RECONNECTING or not can_reconnect():
        return False
    IS_RECONNECTING = True
    log("🔄 Full re-login initiated...", level=1)
    REALTIME_RUNNING = False
    try:
        session_file = Path("session.json")
        if session_file.exists():
            session_file.unlink()
        if CLIENT:
            try: await asyncio.wait_for(CLIENT.api.close(), timeout=2)
            except: pass
        CLIENT = None
        await asyncio.sleep(1.5)
        CLIENT = Quotex(email=SAVED_EMAIL, password=SAVED_PASSWORD, host="qxbroker.com", lang="en")
        check, reason = await CLIENT.connect()
        if not check:
            log(f"❌ Re-login failed: {reason}", level=1)
            return False
        await CLIENT.change_account("PRACTICE")
        await CLIENT.get_all_assets()
        ASSETS_LOADED = True
        LOGIN_SUCCESS = True
        update_tick_time()
        update_subscription_time()
        asyncio.create_task(realtime_heartbeat())
        asyncio.create_task(market_activity_ping())
        if CHART_OPENED and CURRENT_ASSET:
            await start_streaming(CURRENT_ASSET)
        log("✅ Re-login successful & streaming resumed", level=1)
        return True
    except Exception as e:
        log(f"❌ Reconnection error: {e}", level=1)
        return False
    finally:
        IS_RECONNECTING = False

async def realtime_heartbeat():
    global CLIENT, CURRENT_ASSET
    while True:
        await asyncio.sleep(45)
        try:
            if CLIENT and CURRENT_ASSET:
                if is_websocket_connected():
                    log("💓 heartbeat ok", level=2)
                else:
                    log("⚠️ Heartbeat: Connection lost, triggering reconnect...", level=1)
                    asyncio.create_task(full_reconnect())
        except Exception as e:
            if CONSOLE_LEVEL >= 2:
                print(f"⚠️ Heartbeat error: {e}")

async def market_activity_ping():
    global CLIENT, CURRENT_ASSET, CURRENT_TIMEFRAME
    while True:
        await asyncio.sleep(180)
        try:
            if not CLIENT or not CLIENT.api or CURRENT_ASSET is None:
                continue
            internal_asset = DISPLAY_TO_INTERNAL.get(CURRENT_ASSET, "AUDCAD_otc")
            period_sec = TIMEFRAMES.get(CURRENT_TIMEFRAME, 60)
            candles = await CLIENT.get_candles(
                asset=internal_asset,
                end_from_time=time.time(),
                offset=period_sec * 2,
                period=period_sec
            )
            log(f"📡 Market ping: {len(candles) if candles else 0} candles", level=2)
        except Exception as e:
            if CONSOLE_LEVEL >= 2:
                print(f"⚠️ Market ping failed: {str(e)[:80]}")

def price_sleep_watcher():
    while True:
        time.sleep(15)
        diff = time.time() - LAST_TICK_TIME
        if diff > 90 and not IS_RECONNECTING:
            log(f"♻️ Stream idle {int(diff)}s — initiating full re-login", level=1)
            asyncio.run_coroutine_threadsafe(full_reconnect(), ASYNC_LOOP)
threading.Thread(target=price_sleep_watcher, daemon=True, name="PriceWatcher").start()

def safe_stop_realtime_price(asset: str):
    if CLIENT and CLIENT.api:
        try:
            future = asyncio.run_coroutine_threadsafe(CLIENT.stop_realtime_price(asset), ASYNC_LOOP)
            future.result(timeout=5)
        except Exception as e:
            if CONSOLE_LEVEL >= 2:
                print(f"⚠️ stop_realtime_price error: {e}")

def process_candle_data(raw_candles: List[dict], period: int) -> List[dict]:
    if not raw_candles:
        return []
    if raw_candles and not raw_candles[0].get("open"):
        try:
            return process_candles(raw_candles, period)
        except Exception as e:
            if CONSOLE_LEVEL >= 2:
                print(f"⚠️ process_candles failed: {e}")
    formatted = []
    for c in raw_candles:
        if not isinstance(c, dict):
            continue
        try:
            if not all(k in c for k in ("time", "open", "high", "low", "close")):
                continue
            candle_time = int(float(c["time"]))
            aligned_time = (candle_time // period) * period
            formatted.append({
                "time": aligned_time,
                "open": float(c["open"]), "high": float(c["high"]),
                "low": float(c["low"]), "close": float(c["close"])
            })
        except (ValueError, KeyError, TypeError):
            continue
    formatted.sort(key=lambda x: x["time"])
    return formatted

def update_candle(asset: str, frame: str, price: float, ts_sec: int):
    global CANDLES, CURRENT_CANDLE
    duration = TIMEFRAMES.get(frame, 60)
    candle_start = (ts_sec // duration) * duration
    curr = CURRENT_CANDLE.get(asset, {}).get(frame, {})
    if not curr or curr.get("time") != candle_start:
        if curr:
            if asset not in CANDLES:
                CANDLES[asset] = {}
            if frame not in CANDLES[asset]:
                CANDLES[asset][frame] = []
            CANDLES[asset][frame].append(curr.copy())
            if len(CANDLES[asset][frame]) > 200:
                CANDLES[asset][frame] = CANDLES[asset][frame][-200:]
        if asset not in CURRENT_CANDLE:
            CURRENT_CANDLE[asset] = {}
        CURRENT_CANDLE[asset][frame] = {
            "time": int(candle_start), "open": float(price), "high": float(price),
            "low": float(price), "close": float(price)
        }
    else:
        if price > curr["high"]: curr["high"] = float(price)
        if price < curr["low"]: curr["low"] = float(price)
        curr["close"] = float(price)

def send_to_ui(asset: str, timeframe: str) -> bool:
    global CANDLES, CURRENT_CANDLE, SERVER_TIME_OFFSET
    all_candles = CANDLES.get(asset, {}).get(timeframe, []).copy()
    curr = CURRENT_CANDLE.get(asset, {}).get(timeframe)
    if curr:
        if all_candles and all_candles[-1]["time"] == curr["time"]:
            all_candles[-1] = curr
        else:
            all_candles.append(curr)
    all_candles.sort(key=lambda x: x["time"])
    payload = {
        "candles": [
            {"time": int(c["time"]), "open": float(c["open"]), "high": float(c["high"]),
             "low": float(c["low"]), "close": float(c["close"])} for c in all_candles
        ],
        "asset": asset, "timeframe": timeframe,
        "timeframe_seconds": TIMEFRAMES.get(timeframe, 60),
        "server_time": time.time() + SERVER_TIME_OFFSET,
        "last_candle_time": int(curr["time"]) if curr else 0
    }
    try:
        UI_QUEUE.put_nowait(payload)
        return True
    except Full:
        return False

# 🔥 Realtime price loop
async def realtime_price_loop(asset_display: str):
    global REALTIME_RUNNING
    if REALTIME_RUNNING:
        return
    internal = DISPLAY_TO_INTERNAL.get(asset_display)
    if not internal or not CLIENT:
        return
    REALTIME_RUNNING = True
    update_subscription_time()
    log(f"🔄 realtime_price_loop started for {asset_display}", level=1)
    consecutive_errors = 0
    try:
        while True:
            if not REALTIME_RUNNING:
                break
            try:
                if consecutive_errors >= 10 and not is_websocket_connected():
                    log("⚠️ WebSocket dropped, reconnecting...", level=1)
                    await CLIENT.start_realtime_price(internal, TIMEFRAMES.get(CURRENT_TIMEFRAME, 60))
                    update_subscription_time()
                    consecutive_errors = 0
                data = await CLIENT.get_realtime_price(internal)
                update_tick_time()
                if data and len(data) > 0:
                    latest = data[-1]
                    price = float(latest.get("price", latest.get("close", 0)))
                    timestamp = latest.get("time", time.time())
                    if price > 0 and timestamp > 0:
                        ts_sec = int(float(timestamp))
                        SERVER_TIME_OFFSET = timestamp - time.time()
                        for frame in TIMEFRAMES:
                            update_candle(asset_display, frame, price, ts_sec)
                        send_to_ui(asset_display, CURRENT_TIMEFRAME)
                        consecutive_errors = 0
                await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                break
            except Exception as e:
                consecutive_errors += 1
                if consecutive_errors >= 15:
                    log("⚠️ Too many errors, triggering full reconnect...", level=1)
                    asyncio.create_task(full_reconnect())
                    break
                await asyncio.sleep(1)
    finally:
        REALTIME_RUNNING = False

def stop_realtime_loop():
    global REALTIME_RUNNING
    REALTIME_RUNNING = False

# ======================
# Data Loading & Streaming
# ======================
async def load_timeframe_data(asset_display: str, tf_name: str, period_sec: int) -> List[dict]:
    global CANDLES
    if not CLIENT or not CLIENT.api:
        return []
    internal = DISPLAY_TO_INTERNAL.get(asset_display, "AUDCAD_otc")
    if not internal:
        return []
    try:
        hist_data = await CLIENT.get_candles(
            asset=internal, end_from_time=time.time(),
            offset=199 * period_sec, period=period_sec
        )
        loaded = process_candle_data(hist_data, period_sec)
        if asset_display not in CANDLES:
            CANDLES[asset_display] = {}
        CANDLES[asset_display][tf_name] = loaded[-199:]
        return loaded[-199:]
    except Exception:
        return []

async def chart_opened_loader(asset_display: str):
    global CHART_OPENED, BACKGROUND_LOADER_TASK
    if CHART_OPENED:
        return
    CHART_OPENED = True
    log(f"📊 Chart opened — loading candles...", level=1)
    await load_timeframe_data(asset_display, "1m", TIMEFRAMES["1m"])
    send_to_ui(asset_display, "1m")
    internal = DISPLAY_TO_INTERNAL.get(asset_display)
    if internal:
        for i in range(3):
            try:
                await CLIENT.start_realtime_price(internal, TIMEFRAMES["1m"])
                update_subscription_time()
                break
            except:
                await asyncio.sleep(2)
    asyncio.create_task(realtime_price_loop(asset_display))
    BACKGROUND_LOADER_TASK = asyncio.create_task(smart_background_loader(asset_display))

async def smart_background_loader(asset_display: str):
    priority_order = ["5m", "15m", "30m", "1h", "10s", "30s", "2m", "3m", "10m", "4h", "5s", "15s"]
    for tf in priority_order:
        if CURRENT_ASSET != asset_display:
            break
        if tf == CURRENT_TIMEFRAME or tf in CANDLES.get(asset_display, {}):
            continue
        try:
            await load_timeframe_data(asset_display, tf, TIMEFRAMES[tf])
            await asyncio.sleep(2)
        except asyncio.CancelledError:
            break
        except:
            await asyncio.sleep(3)

# ======================
# Login & Connection
# ======================
async def connect_with_retry(max_attempts: int = 5) -> Tuple[bool, str]:
    global CLIENT
    for attempt in range(1, max_attempts + 1):
        try:
            email, password = credentials()
            CLIENT = Quotex(email=email, password=password, host="qxbroker.com", lang="en")
            check, reason = await CLIENT.connect()
            if check:
                return True, reason
            session_file = Path("session.json")
            if session_file.exists():
                session_file.unlink()
            if attempt < max_attempts:
                await asyncio.sleep(2)
        except Exception:
            if attempt < max_attempts:
                await asyncio.sleep(2)
    return False, "Connection failed"

async def connect_to_quotex(email: str, password: str) -> Tuple[bool, str]:
    global CLIENT, ASSETS_LOADED, LOGIN_SUCCESS, SAVED_EMAIL, SAVED_PASSWORD
    try:
        log("🔐 Connecting...", level=1)
        config_dir = Path.home() / ".pyquotex"
        config_dir.mkdir(parents=True, exist_ok=True)
        creds_file = config_dir / "credentials.json"
        with open(creds_file, 'w') as f:
            json.dump({"email": email, "password": password}, f)
        SAVED_EMAIL = email
        SAVED_PASSWORD = password
        success, reason = await connect_with_retry(max_attempts=5)
        if not success:
            if creds_file.exists():
                creds_file.unlink()
            return False, reason
        await CLIENT.change_account("PRACTICE")
        await CLIENT.get_all_assets()
        ASSETS_LOADED = True
        update_subscription_time()
        asyncio.create_task(realtime_heartbeat())
        asyncio.create_task(market_activity_ping())
        LOGIN_SUCCESS = True
        log("✅ Login successful", level=1)
        return True, ""
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"

async def start_streaming(asset_display: str):
    global CURRENT_ASSET, CANDLES, CURRENT_CANDLE, REALTIME_RUNNING, BACKGROUND_LOADER_TASK
    if IS_RECONNECTING:
        return
    if REALTIME_RUNNING:
        stop_realtime_loop()
        await asyncio.sleep(0.5)
    if BACKGROUND_LOADER_TASK:
        BACKGROUND_LOADER_TASK.cancel()
        await asyncio.sleep(0.2)
    if not CLIENT or not CLIENT.api:
        return
    internal = DISPLAY_TO_INTERNAL.get(asset_display)
    if not internal:
        return
    if CURRENT_ASSET and CLIENT:
        old_internal = DISPLAY_TO_INTERNAL.get(CURRENT_ASSET)
        if old_internal:
            safe_stop_realtime_price(old_internal)
    CURRENT_ASSET = asset_display
    if asset_display not in CANDLES:
        CANDLES[asset_display] = {}
    if asset_display not in CURRENT_CANDLE:
        CURRENT_CANDLE[asset_display] = {}
    period_sec = TIMEFRAMES.get(CURRENT_TIMEFRAME, 60)
    await load_timeframe_data(asset_display, CURRENT_TIMEFRAME, period_sec)
    send_to_ui(CURRENT_ASSET, CURRENT_TIMEFRAME)
    await asyncio.sleep(1)
    subscription_success = False
    for i in range(3):
        try:
            await CLIENT.start_realtime_price(internal, period_sec)
            update_subscription_time()
            subscription_success = True
            break
        except:
            await asyncio.sleep(2)
    if subscription_success:
        asyncio.create_task(realtime_price_loop(asset_display))
        BACKGROUND_LOADER_TASK = asyncio.create_task(smart_background_loader(asset_display))

# ======================
# Eel Functions
# ======================
@eel.expose
def login(email: str, password: str):
    def run():
        try:
            future = asyncio.run_coroutine_threadsafe(connect_to_quotex(email, password), ASYNC_LOOP)
            success, reason = future.result(timeout=60)
            if success:
                eel.onLoginSuccess()()
            else:
                eel.onLoginError(reason)()
        except Exception as e:
            eel.onLoginError(f"{type(e).__name__}: {str(e)}")()
    threading.Thread(target=run, daemon=True).start()

@eel.expose
def on_chart_opened():
    def run():
        try:
            if not LOGIN_SUCCESS:
                return
            future = asyncio.run_coroutine_threadsafe(chart_opened_loader(CURRENT_ASSET), ASYNC_LOOP)
            future.result(timeout=30)
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()

@eel.expose
def change_asset(asset_display: str):
    def run():
        try:
            if not LOGIN_SUCCESS:
                time.sleep(2)
            future = asyncio.run_coroutine_threadsafe(start_streaming(asset_display), ASYNC_LOOP)
            future.result(timeout=15)
        except Exception:
            pass
    threading.Thread(target=run, daemon=True).start()

@eel.expose
def change_timeframe(tf: str):
    global CURRENT_TIMEFRAME
    if tf not in TIMEFRAMES:
        return
    CURRENT_TIMEFRAME = tf
    if tf in CANDLES.get(CURRENT_ASSET, {}):
        send_to_ui(CURRENT_ASSET, tf)
        return
    def load():
        try:
            future = asyncio.run_coroutine_threadsafe(
                load_timeframe_data(CURRENT_ASSET, tf, TIMEFRAMES[tf]), ASYNC_LOOP)
            future.result(timeout=15)
            send_to_ui(CURRENT_ASSET, tf)
        except:
            pass
    threading.Thread(target=load, daemon=True).start()

@eel.expose
def get_asset_categories():
    return ASSET_CATEGORIES

@eel.expose
def get_timeframes():
    return list(TIMEFRAMES.keys())

@eel.expose
def apply_candle_colors(colors: dict):
    """✅ تحديث ألوان الشموع - تم إصلاح الخطأ بحذف السطر المسبب للمشكلة"""
    global CANDLE_COLORS
    CANDLE_COLORS = colors
    # ✅ تم حذف السطر التالي لأنه كان يسبب الخطأ:
    # eel.updateCandleColors(colors)()
    # التحديث يتم في الواجهة الأمامية مباشرة عبر applySettings() في app.js
    log(f"🎨 Candle colors updated: {colors}", level=2)

@eel.expose
def get_candle_colors():
    return CANDLE_COLORS

@eel.expose
def get_connection_status():
    if CLIENT and CLIENT.api:
        return {
            "connected": is_websocket_connected(),
            "assets_loaded": ASSETS_LOADED,
            "current_asset": CURRENT_ASSET,
            "current_timeframe": CURRENT_TIMEFRAME,
            "login_success": LOGIN_SUCCESS,
            "realtime_running": REALTIME_RUNNING,
            "chart_opened": CHART_OPENED,
            "is_reconnecting": IS_RECONNECTING,
            "last_tick_age": time.time() - LAST_TICK_TIME
        }
    return {"connected": False, "assets_loaded": False, "login_success": False}

# ======================
# Main
# ======================
if __name__ == '__main__':
    if CONSOLE_LEVEL >= 1:
        print("🚀 Quotex Pro Trader — Separated Architecture")
        print("✅ Backend (engine.py) | Frontend (frontend/)")
    
    os.makedirs("frontend", exist_ok=True)
    eel.init('frontend')
    eel.start('login/login.html', size=(1280, 720), port=0, mode='chrome')
