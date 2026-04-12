"""
AI Mentor — analizuje wzorce tradingowe przez Groq raz dziennie.
Uruchom przez cron: 0 6 * * * cd /home/signal-bot && python3 ai_mentor.py
Lub ręcznie: python3 ai_mentor.py
"""

import os, json, re
from datetime import datetime, timezone
from dotenv import load_dotenv
import firebase_admin
from firebase_admin import credentials, firestore
from groq import Groq

load_dotenv()
cred = credentials.Certificate(os.getenv("FIREBASE_CREDENTIALS_PATH", "firebase-key.json"))
firebase_admin.initialize_app(cred)
db  = firestore.client()
groq = Groq(api_key=os.getenv("GROQ_API_KEY"))

def fetch_closed_positions():
    docs = db.collection("simulation_positions")\
        .where("status", "==", "CLOSED")\
        .order_by("closed_at", direction=firestore.Query.DESCENDING)\
        .limit(100).stream()
    return [{**d.to_dict(), "id": d.id} for d in docs]

def build_stats(positions):
    """Buduje zwięzłe statystyki do analizy — bez wysyłania surowych danych."""
    if not positions:
        return None

    total = len(positions)
    wins  = [p for p in positions if (p.get("realized_pnl") or 0) >= 0]
    losses= [p for p in positions if (p.get("realized_pnl") or 0) < 0]

    def wr(arr): return round(len([p for p in arr if (p.get("realized_pnl") or 0) >= 0]) / len(arr) * 100, 1) if arr else 0
    def avg_pnl(arr): return round(sum(p.get("realized_pnl",0) for p in arr) / len(arr), 2) if arr else 0

    # Per godzina UTC
    by_hour = {}
    for p in positions:
        try:
            h = datetime.fromisoformat(p.get("opened_at","").replace("Z","+00:00")).hour
            if h not in by_hour: by_hour[h] = []
            by_hour[h].append(p)
        except: pass

    hour_stats = {h: {"total": len(arr), "wr": wr(arr), "avg_pnl": avg_pnl(arr)}
                  for h, arr in by_hour.items()}

    # Per dzień
    by_day = {}
    days = ["Niedziela","Poniedziałek","Wtorek","Środa","Czwartek","Piątek","Sobota"]
    for p in positions:
        try:
            d = datetime.fromisoformat(p.get("opened_at","").replace("Z","+00:00")).weekday()
            d_name = days[(d+1)%7]
            if d_name not in by_day: by_day[d_name] = []
            by_day[d_name].append(p)
        except: pass

    day_stats = {d: {"total": len(arr), "wr": wr(arr), "avg_pnl": avg_pnl(arr)}
                 for d, arr in by_day.items()}

    # Per kanał
    by_channel = {}
    for p in positions:
        ch = p.get("channel_name") or p.get("channel") or "?"
        if ch not in by_channel: by_channel[ch] = []
        by_channel[ch].append(p)

    channel_stats = {ch: {"total": len(arr), "wr": wr(arr), "avg_pnl": avg_pnl(arr)}
                     for ch, arr in by_channel.items() if len(arr) >= 2}

    # Per dźwignia
    by_lev = {}
    for p in positions:
        lev = p.get("leverage", 1)
        bucket = "1-10x" if lev<=10 else "11-20x" if lev<=20 else "21-30x" if lev<=30 else "31-50x" if lev<=50 else "50x+"
        if bucket not in by_lev: by_lev[bucket] = []
        by_lev[bucket].append(p)

    lev_stats = {b: {"total": len(arr), "wr": wr(arr), "avg_pnl": avg_pnl(arr)}
                 for b, arr in by_lev.items()}

    # LONG vs SHORT
    longs  = [p for p in positions if p.get("signal_type") in ("LONG","SPOT_BUY")]
    shorts = [p for p in positions if p.get("signal_type") == "SHORT"]

    # Serie strat
    sorted_pos = sorted(positions, key=lambda p: p.get("closed_at",""))
    max_streak = cur_streak = 0
    for p in sorted_pos:
        if (p.get("realized_pnl") or 0) < 0:
            cur_streak += 1
            max_streak = max(max_streak, cur_streak)
        else:
            cur_streak = 0

    # Najgorsze straty
    worst = sorted(losses, key=lambda p: p.get("realized_pnl",0))[:5]
    worst_list = [{"symbol": p.get("symbol"), "channel": p.get("channel_name","?"),
                   "pnl": round(p.get("realized_pnl",0),2), "leverage": p.get("leverage",1),
                   "reason": p.get("close_reason","")} for p in worst]

    return {
        "total_trades":   total,
        "win_rate":       round(len(wins)/total*100, 1),
        "avg_pnl":        avg_pnl(positions),
        "total_pnl":      round(sum(p.get("realized_pnl",0) for p in positions), 2),
        "long_wr":        wr(longs),
        "short_wr":       wr(shorts),
        "long_count":     len(longs),
        "short_count":    len(shorts),
        "max_loss_streak": max_streak,
        "by_hour":        hour_stats,
        "by_day":         day_stats,
        "by_channel":     channel_stats,
        "by_leverage":    lev_stats,
        "worst_trades":   worst_list,
    }

def ask_groq(stats):
    """Jeden call do Groq — pełna analiza i rekomendacje."""
    prompt = f"""Jesteś doświadczonym traderem i mentorem. Analizujesz wyniki symulacji tradingowej i dajesz konkretne, praktyczne wnioski.

DANE TRADINGOWE:
{json.dumps(stats, ensure_ascii=False, indent=2)}

Przeanalizuj te dane i zwróć TYLKO JSON w formacie:
{{
  "overall_assessment": "Ogólna ocena (2-3 zdania)",
  "score": 75,
  "key_insights": [
    "Konkretny wniosek 1 oparty na danych",
    "Konkretny wniosek 2",
    "Konkretny wniosek 3"
  ],
  "critical_mistakes": [
    "Błąd krytyczny 1 z konkretną liczbą/procentem",
    "Błąd krytyczny 2"
  ],
  "action_plan": [
    {{
      "priority": "HIGH",
      "action": "Konkretna akcja do podjęcia",
      "reason": "Dlaczego — z danymi"
    }},
    {{
      "priority": "MEDIUM",
      "action": "Konkretna akcja",
      "reason": "Dlaczego"
    }},
    {{
      "priority": "LOW",
      "action": "Konkretna akcja",
      "reason": "Dlaczego"
    }}
  ],
  "best_setup": "Opis najlepszego setupu tradingowego na podstawie danych (godzina, kanał, typ, dźwignia)",
  "worst_pattern": "Opis najgorszego wzorca który należy unikać",
  "next_week_focus": "Jeden konkretny cel na następny tydzień"
}}

ZASADY:
- Używaj konkretnych liczb z danych (np. '62% win rate w godzinach 8-12 UTC')
- Nie powtarzaj ogólników — każdy wniosek musi mieć liczby
- Bądź bezpośredni i konkretny jak dobry mentor
- Odpowiedź po polsku"""

    resp = groq.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3,
        max_tokens=1500,
    )
    raw = re.sub(r"```(?:json)?", "", resp.choices[0].message.content.strip()).strip()
    return json.loads(raw)

def main():
    print("[AI MENTOR] Uruchamiam analizę...")
    positions = fetch_closed_positions()

    if len(positions) < 10:
        print(f"[AI MENTOR] Za mało danych ({len(positions)} pozycji, min. 10). Pomijam.")
        db.collection("ai_mentor").document("latest").set({
            "status": "insufficient_data",
            "positions_count": len(positions),
            "message": f"Za mało danych ({len(positions)}/10). Zbieraj więcej tradów.",
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })
        return

    stats = build_stats(positions)
    print(f"[AI MENTOR] Analizuję {len(positions)} pozycji przez Groq...")

    try:
        analysis = ask_groq(stats)
        doc = {
            "status":       "ok",
            "analysis":     analysis,
            "stats":        stats,
            "positions_count": len(positions),
            "updated_at":   datetime.now(timezone.utc).isoformat(),
            "model":        "llama-3.3-70b-versatile",
        }
        db.collection("ai_mentor").document("latest").set(doc)
        print(f"[AI MENTOR] ✅ Analiza zapisana. Score: {analysis.get('score')}/100")
        print(f"[AI MENTOR] Kluczowe wnioski:")
        for insight in analysis.get("key_insights", []):
            print(f"  → {insight}")
    except Exception as e:
        print(f"[AI MENTOR] ❌ Błąd Groq: {e}")
        db.collection("ai_mentor").document("latest").set({
            "status":     "error",
            "error":      str(e),
            "updated_at": datetime.now(timezone.utc).isoformat(),
        })

if __name__ == "__main__":
    main()
