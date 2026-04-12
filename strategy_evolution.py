"""
Strategy Evolution — tygodniowy backtest 100 kombinacji parametrów.
Uruchom przez cron: 0 7 * * 1 cd /home/signal-bot && python3 strategy_evolution.py
Lub ręcznie: python3 strategy_evolution.py
"""

import os, json, itertools
from datetime import datetime, timezone
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_CREDENTIALS_PATH", "firebase-key.json"))
firebase_admin.initialize_app(cred)
db = firestore.client()

INITIAL_CAPITAL = 200.0

def fetch_data():
    """Pobierz zamknięte pozycje i statystyki kanałów."""
    pos_docs = db.collection("simulation_positions")\
        .where("status", "==", "CLOSED")\
        .order_by("closed_at").stream()
    positions = [{**d.to_dict(), "id": d.id} for d in pos_docs]

    ch_docs = db.collection("channel_stats").stream()
    channel_wr = {}
    for d in ch_docs:
        data = d.to_dict()
        ch = str(data.get("channel","")).replace("-100","").lstrip("-")
        channel_wr[ch] = data.get("win_rate", 0)

    return positions, channel_wr

def simulate(positions, channel_wr, params):
    """
    Symuluje strategię na historycznych danych.
    params: {risk_pct, max_leverage, min_channel_wr, exclude_hours, long_only, short_only}
    """
    capital   = INITIAL_CAPITAL
    wins = losses = 0
    total_pnl = 0.0
    max_drawdown = 0.0
    peak_capital = INITIAL_CAPITAL
    trades_taken = 0

    for pos in positions:
        # Filtry strategii
        lev = pos.get("leverage", 1)
        if lev > params["max_leverage"]:
            continue

        ch_id = str(pos.get("channel","")).replace("-100","").lstrip("-")
        ch_wr = channel_wr.get(ch_id, 50)
        if ch_wr < params["min_channel_wr"] and ch_wr > 0:
            continue

        sig_type = pos.get("signal_type","")
        if params["long_only"] and sig_type not in ("LONG","SPOT_BUY"):
            continue
        if params["short_only"] and sig_type != "SHORT":
            continue

        try:
            h = datetime.fromisoformat(pos.get("opened_at","").replace("Z","+00:00")).hour
            if h in params["exclude_hours"]:
                continue
        except: pass

        # Oblicz P&L z tym ryzykiem
        orig_alloc = pos.get("allocated_usd", 0)
        orig_cap_at_trade = orig_alloc / (float(os.getenv("SIM_RISK_PCT","3")) / 100) if orig_alloc else INITIAL_CAPITAL
        orig_pnl = pos.get("realized_pnl", 0)

        if orig_alloc > 0 and orig_cap_at_trade > 0:
            pnl_pct_of_alloc = orig_pnl / orig_alloc if orig_alloc else 0
            new_alloc = capital * (params["risk_pct"] / 100)
            new_pnl   = new_alloc * pnl_pct_of_alloc
        else:
            continue

        capital   = max(0, capital + new_pnl)
        total_pnl += new_pnl
        trades_taken += 1

        if new_pnl >= 0: wins += 1
        else:            losses += 1

        if capital > peak_capital:
            peak_capital = capital
        drawdown = (peak_capital - capital) / peak_capital * 100 if peak_capital > 0 else 0
        if drawdown > max_drawdown:
            max_drawdown = drawdown

    total = wins + losses
    win_rate = round(wins/total*100, 1) if total else 0
    roi      = round((capital - INITIAL_CAPITAL) / INITIAL_CAPITAL * 100, 2)

    return {
        "final_capital": round(capital, 2),
        "total_pnl":     round(total_pnl, 2),
        "roi_pct":       roi,
        "win_rate":      win_rate,
        "trades_taken":  trades_taken,
        "wins":          wins,
        "losses":        losses,
        "max_drawdown":  round(max_drawdown, 1),
    }

def run_evolution():
    print("[EVOLUTION] Pobieranie danych...")
    positions, channel_wr = fetch_data()

    if len(positions) < 15:
        print(f"[EVOLUTION] Za mało danych ({len(positions)}/15). Pomijam.")
        db.collection("strategy_evolution").document("latest").set({
            "status": "insufficient_data",
            "message": f"Za mało danych ({len(positions)}/15).",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        return

    print(f"[EVOLUTION] Testuję kombinacje na {len(positions)} pozycjach...")

    # Siatka parametrów — ~108 kombinacji
    risk_pcts       = [1.0, 2.0, 3.0, 5.0]
    max_leverages   = [10, 20, 50, 999]
    min_channel_wrs = [0, 40, 55]
    direction_modes = [
        {"long_only": False, "short_only": False},
        {"long_only": True,  "short_only": False},
        {"long_only": False, "short_only": True},
    ]
    exclude_hours_options = [
        [],
        [0,1,2,3,4,22,23],   # bez godzin nocnych
    ]

    results = []
    for risk, max_lev, min_wr, direction, excl_h in itertools.product(
        risk_pcts, max_leverages, min_channel_wrs, direction_modes, exclude_hours_options
    ):
        params = {
            "risk_pct":        risk,
            "max_leverage":    max_lev,
            "min_channel_wr":  min_wr,
            "exclude_hours":   excl_h,
            **direction,
        }
        result = simulate(positions, channel_wr, params)
        if result["trades_taken"] < 5:
            continue

        result["params"] = {
            "risk_pct":       risk,
            "max_leverage":   f"{max_lev}x" if max_lev < 999 else "bez limitu",
            "min_channel_wr": f"{min_wr}%" if min_wr > 0 else "wszystkie",
            "exclude_hours":  "bez nocnych" if excl_h else "całą dobę",
            "direction":      "tylko LONG" if direction["long_only"] else "tylko SHORT" if direction["short_only"] else "LONG+SHORT",
        }
        results.append(result)

    if not results:
        print("[EVOLUTION] Brak wyników — za mało tradów.")
        return

    # Sortuj po ROI, ale też sprawdź max_drawdown
    results.sort(key=lambda r: (r["roi_pct"], -r["max_drawdown"]), reverse=True)

    top10    = results[:10]
    worst10  = results[-10:]
    baseline = next((r for r in results if
        r["params"]["risk_pct"] == 3.0 and
        r["params"]["max_leverage"] == "bez limitu" and
        r["params"]["min_channel_wr"] == "wszystkie" and
        r["params"]["direction"] == "LONG+SHORT"), None)

    best = top10[0]
    print(f"[EVOLUTION] ✅ Najlepsza strategia: ROI {best['roi_pct']}% | WR {best['win_rate']}% | {best['trades_taken']} tradów")
    print(f"[EVOLUTION]    Parametry: {best['params']}")

    doc = {
        "status":         "ok",
        "updated_at":     datetime.now(timezone.utc).isoformat(),
        "positions_analyzed": len(positions),
        "combinations_tested": len(results),
        "baseline":       baseline,
        "best_strategy":  best,
        "top10":          top10,
        "worst10":        worst10,
        "summary": {
            "best_roi":       best["roi_pct"],
            "best_params":    best["params"],
            "baseline_roi":   baseline["roi_pct"] if baseline else 0,
            "improvement":    round(best["roi_pct"] - (baseline["roi_pct"] if baseline else 0), 2),
        }
    }
    db.collection("strategy_evolution").document("latest").set(doc)
    print(f"[EVOLUTION] Zapisano. Poprawa vs baseline: +{doc['summary']['improvement']}%")

if __name__ == "__main__":
    run_evolution()
