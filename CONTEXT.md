# CONTEXT.md — Telegram Signal Bot / Trading Simulation System

## 1. Czym jest aplikacja

System monitorowania sygnałów tradingowych z Telegrama + symulacja portfela tradingowego.

**Flow:**
1. Bot Python (Telethon) nasłuchuje 11 kanałów Telegram
2. Każda wiadomość przechodzi przez pre-filter (reguły) → Groq AI (parsowanie)
3. Sygnały trafiają do Firebase Firestore
4. Symulacja otwiera/zamyka pozycje i śledzi P&L
5. React frontend wyświetla dane w czasie rzeczywistym

**Tryb:** DRY RUN — brak realnych zleceń, tylko symulacja na $200 kapitału

---

## 2. Stack technologiczny

| Warstwa | Technologia |
|---------|-------------|
| Bot | Python 3.12, Telethon (Telegram MTProto) |
| AI Parser | Groq API (llama-3.3-70b-versatile) |
| Baza danych | Firebase Firestore (plan Blaze) |
| Frontend | React + Vite, vanilla JS, Tailwind |
| Hosting frontend | Vercel (GitHub → auto-deploy) |
| VPS | Ubuntu, PM2 process manager |
| Ceny | MEXC public API (bez klucza) |

---

## 3. Struktura plików

### VPS `/home/signal-bot/`
```
bot.py                    ← główny bot (Telethon + polling + keepalive)
simulation.py             ← silnik symulacji (open/close pozycji, P&L)
price_updater.py          ← pobiera ceny MEXC co 30s, sprawdza TP/SL
health_monitor.py         ← heartbeat, liczniki tokenów, channel stats
market_regime.py          ← BTC/Fear&Greed/dominacja co 1h (PM2: market-regime)
shadow_portfolio.py       ← 6 strategii shadow (PM2: shadow-portfolio)
ai_mentor.py              ← analiza Groq raz dziennie (cron 6:00 UTC)
strategy_evolution.py     ← backtest 100 kombinacji (cron poniedziałek 7:00 UTC)
reset_firebase.py         ← reset portfela do $200
safe_restart.sh           ← ostrzeżenie przed restartem w godzinach 6-22 UTC

channels/
  base_channel.py         ← klasa bazowa
  registry.py             ← rejestr handlerów
  crypto_beast.py         ← 1982472141
  crypto_monk.py          ← 1552004524
  crypto_world.py         ← 1652601224
  binance_360.py          ← 1553551852
  predictum.py            ← 1456872361
  boom_boom.py            ← 1756316676
  crypto_hustle.py        ← 1743387695
  crypto_bulls.py         ← 1700533698
  crypto_devil.py         ← 1598691683
  crypto_conquered.py     ← 1505272164
  whales_pump.py          ← 1594522150

logs/                     ← PM2 logi
firebase-key.json         ← credentials Firebase
.env                      ← zmienne środowiskowe
```

### GitHub repo → Vercel
```
src/
  App.jsx                 ← cały frontend (~3100 linii, jeden plik)
  main.jsx
  index.css
index.html
vite.config.js
```

---

## 4. PM2 Ecosystem

```
ID | Nazwa              | Status
0  | signal-bot         | online  ← główny bot
1  | kurator-server     | online  ← osobny projekt
2  | market-regime      | online
3  | shadow-portfolio   | online
```

**Komendy:**
```bash
pm2 reload signal-bot          # ← ZAWSZE używaj reload, nie restart
pm2 logs signal-bot --lines 100
pm2 status
```

**ZASADA: Restartuj bota TYLKO po 22:00 UTC (= po 00:00 czasu polskiego)**

---

## 5. Kanały Telegram (11 sztuk)

| ID | Nazwa | Specyfika |
|----|-------|-----------|
| 1700533698 | Crypto Bulls | standardowy |
| 1982472141 | Crypto BEAST | zapowiedź ($TOKEN SHORT NOW) + edycja na pełny sygnał |
| 1552004524 | Crypto MONK | po angielsku (bot widzi oryginał), format #SHORT/#LONG PREMIUM |
| 1456872361 | Predictum | standardowy |
| 1553551852 | Binance 360 | odrzuca VIP Scalp/MTC forwarded (reklamy) |
| 1756316676 | Boom Boom | format PAIR:/Position:/Entry Zone:/Leverage:/Take Profit Targets:/Stop Loss: |
| 1743387695 | Crypto Hustle | standardowy |
| 1652601224 | Crypto World | najbardziej złożony — wiele formatów, zapowiedzi + pełne sygnały |
| 1598691683 | Crypto Devil | format Coin:#SYMBOL + Target 1-6 + StopLoss |
| 1505272164 | Crypto Conquered | standardowy |
| 1594522150 | Whales Pump | format z **, separator _, dźwignia zawsze 20x |

---

## 6. Firebase Firestore — kolekcje

| Kolekcja | Zawartość | Reguły |
|----------|-----------|--------|
| signals | sparsowane sygnały | read: true |
| signals_summary | skrót sygnału | read: true |
| non_signals | odrzucone wiadomości | read: true |
| simulation | portfolio (doc: portfolio) | read,write: true |
| simulation_positions | otwarte/zamknięte pozycje | read,write: true |
| simulation_log | log zdarzeń (OPEN/CLOSE/TP/SL/REJECT) | read,write: true |
| channel_stats | statystyki per kanał | read: true |
| channel_names | mapowanie ID→nazwa | read,write: true |
| bot_health | heartbeat bota | read: true |
| market_regime | BTC/F&G/dominacja | read: true |
| shadow_portfolios | 6 strategii shadow | read: true |
| shadow_positions | pozycje shadow | read: true |
| ai_mentor | analiza AI | read: true |
| strategy_evolution | backtest wyniki | read: true |

---

## 7. Parametry symulacji

```
Kapitał początkowy:  $200
Ryzyko per trade:    4% = $8
Slippage:            0.5%
Max otwarte pozycje: bez limitu
Min kapitał:         0 (wyłączone)
```

**Front-loaded TP (nowe pozycje):**
- 1 TP → 100%
- 2 TP → 65% / 35%
- 3 TP → 50% / 30% / 20%
- 4 TP → 40% / 30% / 20% / 10%
- 5 TP → 35% / 25% / 20% / 15% / 5%
- 6 TP → 30% / 25% / 20% / 15% / 7% / 3%

*Wyjątek: gdy sygnał jawnie podaje różne % (np. Close 80%/20%) — zachowaj oryginalne*

**3-stopniowy Trailing SL:**
- Po TP1 → SL = (entry + original_SL) / 2 (połowa drogi)
- Po TP2 → SL = entry (Break-Even)
- Po TP3 → SL = cena TP1 (zysk zabezpieczony)

**DCA (Entry Range):**
- LONG: wejście po MAX, DCA po MIN gdy cena spadnie
- SHORT: wejście po MIN, DCA po MAX gdy cena wzrośnie
- DCA kwota: 2% kapitału ($4)
- Po DCA: nowa cena wejścia = VWAP (średnia ważona)

**Walidacja MEXC:**
- Jeśli cena MEXC różni się >1.5x od entry sygnału → odrzuć pozycję
- Auto-mapping symboli: BROCCOLI714 → BROCCOLI (usuwa cyfry z końca)

---

## 8. Mechanizm odbierania wiadomości (dual-track)

### Track 1: Telethon Events (szybki)
- Eventy w czasie rzeczywistym
- Problem: czasem "milczy" przez długi czas (bug Telethon)

### Track 2: Polling Loop (backup)
- Co 60 sekund odpytuje każdy kanał o ostatnie 10 wiadomości
- Przetwarza wiadomości nie starsze niż 10 minut
- Deduplication przez `_processed_ids` set
- W logach: `[POLL] 🔄 Odzyskano wiadomość CHANNEL_ID msg_id=X (wiek: Xs)`

### Keepalive
- Co 30 sekund: `GetDialogsRequest` do Telegrama
- Wymusza dostarczenie pending updates
- W logach: `[BOT] ✓ Keepalive OK`

---

## 9. Logika zapowiedzi → pełny sygnał

Niektóre kanały (BEAST, Crypto World) wysyłają najpierw zapowiedź bez TP/SL,
potem pełny sygnał (edycja lub nowa wiadomość).

**Bot aktualizuje istniejącą pozycję gdy:**
1. Pozycja nie ma SL, a nowy sygnał ma SL
2. Pozycja ma ≤1 TP bez SL, a nowy sygnał ma ≥2 TP z SL
3. Klasyczna zapowiedź (0 TP, 0 SL) → cokolwiek z TP lub SL

---

## 10. Frontend — struktura zakładek

```
App.jsx (~3100 linii, jeden plik)

Zakładki:
1. 📊 Portfolio    ← RiskPanel (drawdown alert), statystyki, ostatnie zamknięte
2. 🔓 Otwarte     ← tabela pozycji z rozwijalnymi szczegółami TP/SL
3. 🔒 Zamknięte   ← ClosedTable z ClosedPositionDetail (klik → historia TP/SL)
4. 📈 Kanały      ← ChannelStats — win rate, trades per kanał
5. 📡 Sygnały     ← lista sygnałów z Firebase
6. 📝 Log         ← AdvancedLog — filtry po kanale/typie, statystyki dnia
7. 🔧 Debug       ← raw data Firebase
8. 🧠 Intelligence← Market Regime, AI Mentor, Strategy Evolution, Anatomia Przegranej
9. 🎵 Sentiment   ← temperatura rynku, histogram 24h
10. 👥 Shadow     ← 6 kart strategii shadow, ranking P&L
```

**Dane Firebase w App.jsx (onSnapshot — real-time):**
- `simulation/portfolio` → kapitał, P&L, W/L
- `simulation_positions` → otwarte i zamknięte pozycje
- `simulation_log` → log zdarzeń (limit 300)
- `channel_stats` → statystyki kanałów
- `signals` → lista sygnałów
- `shadow_portfolios` + `shadow_positions` → shadow
- `market_regime` → reżim rynku
- `ai_mentor` → analiza AI
- `channel_names` → mapowanie ID→nazwa

---

## 11. Shadow Portfolio — 6 strategii

| ID | Nazwa | Ryzyko | Specyfika |
|----|-------|--------|-----------|
| conservative | 🛡️ Konserwatywna | 1% | max 20x, kanały WR>50% |
| current | ⚖️ Obecna (3%) | 3% | mirror starej strategii |
| aggressive | 🚀 Agresywna | 5% | wszystkie kanały |
| breakeven | 🔒 Break-Even | 5% | SL→BE po TP1 |
| front_loaded | 💰 Front-Loaded | 3% | TP1=40%, TP2=35%, TP3=25% |
| sniper | 🎯 Sniper | 2% | max 30x, WR>55%, BE po TP1 |

---

## 12. UI Conventions

- **Kolory:** cyan `#00e5ff` (akcent), purple `#ce93d8`, zielony `#00e676`, czerwony `#ff5252`
- **Tło:** `#0d0f17` (główne), `#1c2030` (karty), `#2e3350` (border)
- **Font:** monospace dla liczb i cen
- **Styl:** dark neon, cyan/purple palette
- **Formatowanie:** inline styles (bez zewnętrznego CSS), Tailwind NIE używany w App.jsx
- **Komponenty:** funkcyjne React z hooks, jeden plik App.jsx

---

## 13. Co zostało zrobione w tej sesji

### Krytyczne naprawy:
1. **Polling loop** — backup dla eventów Telethon, odpytuje kanały co 60s
2. **Keepalive co 30s** — `GetDialogsRequest` zamiast `get_me()`
3. **Walidacja ceny MEXC** — ratio 1.5x przed otwarciem i podczas aktualizacji
4. **Auto-mapping symboli** — BROCCOLI714→BROCCOLI, auto-discovery cyfr

### Symulacja:
5. **Front-loaded TP** — malejące % zamiast równego podziału
6. **3-stopniowy Trailing SL** — 50% → BE → TP1
7. **DCA** — wejście po pierwszej cenie + dokładanie po drugiej
8. **Naprawa tp_close_pct** — UnboundLocalError gdy 0 TP
9. **Naprawa has_custom** — Groq dodawał równe % które były traktowane jako custom
10. **Aktualizacja zapowiedzi** — rozszerzono warunki (1 TP bez SL → pełny sygnał)

### Handlery kanałów:
11. **Whales Pump** — nowy handler, obsługa `**` markdown, separator `_`, dźwignia 20x
12. **Boom Boom** — przepisany handler dla nowego formatu
13. **Crypto World** — dodano formaty SIGNAL ALERT, link bitunix nie blokuje
14. **Binance 360** — blokada VIP Scalp/MTC forwarded

### Frontend:
15. **AdvancedLog** — filtry po kanale/typie, statystyki dnia, preview odrzuconych
16. **ClosedPositionDetail** — rozwijane szczegóły zamkniętych pozycji (TP historia, SL, słowne podsumowanie)
17. **Throttling odrzuceń** — max 1 zapis do Firebase per kanał co 5 minut
18. **Import React** — naprawiony crash `React.Fragment`
19. **channel_names** — mapowanie ID→nazwy w Firebase

---

## 14. Aktualny stan

### ✅ Działa:
- Polling loop (co 60s, okno 10 minut)
- Keepalive co 30s
- Front-loaded TP dla nowych pozycji
- 3-stopniowy Trailing SL
- DCA dla entry range
- Walidacja MEXC 1.5x
- Wszystkie 11 handlerów kanałów
- AdvancedLog z filtrami
- ClosedPositionDetail z historią

### ⚠️ Do monitorowania:
- Polling skutecznie odzyskuje pominięte sygnały (weryfikuj w logach)
- Aktualizacja zapowiedzi→pełny sygnał (nowa logika, wymaga testów)
- Crypto World link bitunix (Groq może nadal odrzucać)

### ❌ Znane problemy:
- Sygnały podczas restartu bota są nieodwracalnie tracone
- Okno polling 10 minut nie pomoże gdy restart trwa >10 minut

### 📋 Pending (cron jobs do ustawienia):
```bash
0 6 * * * cd /home/signal-bot && python3 ai_mentor.py >> logs/mentor.log 2>&1
0 7 * * 1 cd /home/signal-bot && python3 strategy_evolution.py >> logs/evolution.log 2>&1
```

---

## 15. Przydatne komendy

### VPS — monitoring:
```bash
pm2 status
pm2 logs signal-bot --lines 100
pm2 logs signal-bot --lines 200 | grep -E "POLL|Keepalive|OPEN|SIM|ERROR"
pm2 logs signal-bot --lines 500 | grep -v "PRICE\|Brak" | head -50
```

### VPS — deployment (tylko po 22:00 UTC!):
```bash
pm2 reload signal-bot          # NIE używaj pm2 restart
```

### Firebase — diagnostyka:
```bash
cd /home/signal-bot
python3 -c "
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv; load_dotenv()
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
print(db.collection('simulation').document('portfolio').get().to_dict())
"
```

### Firebase — reset portfela:
```bash
python3 reset_firebase.py
```

### Firebase — manual fix pozycji:
```bash
python3 -c "
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv; load_dotenv()
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
# Aktualizuj pozycję po ID:
db.collection('simulation_positions').document('POSITION_ID').update({
    'stop_loss': 0.1234,
    'take_profits': [{'level':1,'price':0.15,'close_pct':80},{'level':2,'price':0.18,'close_pct':20}],
})
print('OK')
"
```

### Firebase — channel_names (jeśli pokazują numerki):
```bash
python3 -c "
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv; load_dotenv()
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
names = {
    '1505272164':'Crypto Conquered','1598691683':'Crypto Devil',
    '1594522150':'Whales Pump','1756316676':'Boom Boom',
    '1700533698':'Crypto Bulls','1982472141':'Crypto BEAST',
    '1552004524':'Crypto MONK','1456872361':'Predictum',
    '1553551852':'Binance 360','1743387695':'Crypto Hustle',
    '1652601224':'Crypto World',
}
for ch_id, name in names.items():
    db.collection('channel_names').document(ch_id).set({'name':name,'channel_id':ch_id})
    print(f'OK {name}')
"
```

---

## 16. Zmienne środowiskowe (.env)

```
TELEGRAM_API_ID=...
TELEGRAM_API_HASH=...
TELEGRAM_PHONE=...
GROQ_API_KEY=...
FIREBASE_CREDENTIALS_PATH=firebase-key.json
TELEGRAM_CHANNELS=1700533698,1982472141,1552004524,1456872361,1553551852,1756316676,1743387695,1652601224,1598691683,1505272164,1594522150
SIM_CAPITAL=200
SIM_RISK_PCT=4.0
SIM_SLIPPAGE_PCT=0.5
SIM_BE_AFTER_TP=2
SIM_MAX_OPEN=0
SIM_MIN_CAPITAL=0
```

---

## 17. Ważne decyzje projektowe

- **Jeden plik App.jsx** — cały frontend w jednym pliku, brak osobnych komponentów
- **Inline styles** — nie używamy zewnętrznych plików CSS ani Tailwind klas w App.jsx
- **Groq zamiast OpenAI** — szybszy, tańszy, wystarczający do parsowania
- **MEXC API** — brak klucza, tylko publiczne endpointy
- **Telethon user account** — nie bot API, bo kanały są prywatne/publiczne z ograniczeniami
- **Firebase Firestore** — real-time updates przez onSnapshot w React
- **Vercel** — auto-deploy z GitHub przy każdym commicie
- **PM2** — process manager na VPS, auto-restart po crashu
- **DRY RUN** — symulacja, nie prawdziwy trading

---
## 18. Sesja 16.04.2026

### Diagnoza i weryfikacja systemu:
- Potwierdzono że obliczanie ryzyka działa poprawnie — bot pobiera 4% z `current_capital`
  (wolnego kapitału w momencie otwarcia pozycji), nie z equity. To zamierzone zachowanie.
- Potwierdzono że ekspozycja ($22.63) = suma `allocated_usd` otwartych pozycji ✅
- TP1 XRP = +$0.00 to był tylko problem wyświetlania — `.toFixed(2)` zaokrągla małe kwoty.
  Wartość w Firestore jest poprawna. Naprawa kosmetyczna w App.jsx (`.toFixed(4)`).
- TP1 XRP był prawie zerowy bo sygnał SHORT miał TP1 ($1.3929) ≈ entry ($1.3930) — słaby
  sygnał z Binance 360, nie bug kodu.

### Nowe skrypty na VPS (/home/signal-bot/):

**fix_position.py** — uniwersalny skrypt do ręcznej aktualizacji pozycji gdy bot nie
zaktualizuje jej automatycznie. Edytuj tylko sekcję KONFIGURACJA na górze pliku:
- POSITION_ID — ID z Firestore (zakładka Debug lub skrypt poniżej)
- SYMBOL, DIRECTION, ENTRY, LEVERAGE, STOP_LOSS
- TAKE_PROFITS — lista (poziom, cena, % zamknięcia), suma % musi = 100
- RESET_SL_STAGE, RESET_TPS_HIT, RESET_PARTIAL_CLOSES — opcjonalne flagi

Uruchomienie:
```bash
cd /home/signal-bot
python3 fix_position.py
```

**Sprawdzenie otwartych pozycji w Firestore:**
```bash
cd /home/signal-bot
python3 -c "
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv; load_dotenv()
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
docs = db.collection('simulation_positions').where('status','==','OPEN').stream()
for d in docs:
    data = d.to_dict()
    print(f'{d.id} | {data.get(\"symbol\")} | {data.get(\"signal_type\")} | entry: {data.get(\"entry_price\")} | alloc: {data.get(\"allocated_usd\")}')
"
```

### Uwagi:
- ID pozycji w zakładce Debug może pokazywać ID dokumentu sygnału, nie pozycji —
  zawsze weryfikuj ID przez skrypt powyżej
- Bot Crypto World nie zaktualizował automatycznie pozycji ORDI/USDT (brak TP/SL
  w momencie otwarcia) — użyto fix_position.py do ręcznego uzupełnienia danych

## 19. Sesja 17.04.2026

### Diagnoza i weryfikacja systemu (cd.):
- Potwierdzono że obliczanie ryzyka działa poprawnie — $10.05 = 4% z $251.21 ✅
- TP1 XRP = +$0.00 to był tylko problem wyświetlania `.toFixed(2)` — wartość w Firestore poprawna

### Naprawy simulation.py:
1. **should_update rozszerzony o 4. warunek** — nowy pełny sygnał dla istniejącej pozycji
   (inne entry/leverage/liczba TP) teraz aktualizuje pozycję zamiast ją pomijać.
   Dotychczas Crypto World wysyłał kilka wersji ORDI z różnymi parametrami — bot odrzucał
   wszystkie po pierwszym. Teraz aktualizuje entry, leverage, TP, SL.
2. **SYM_MAP rozszerzony o tokeny z prefiksem 1000** — 1000SATS/USDT → SATSUSDT na MEXC.
   Dotychczas price_updater nie znajdował ceny → pozycja nie aktualizowała TP/SL.
   Dodane: 1000SATS, 1000PEPE, 1000FLOKI, 1000BONK, 1000X, 1000CAT, 1000MOG, 1000BABYDOGE

### Naprawy price_updater.py:
3. **SYMBOL_MAP rozszerzony** — ta sama lista co w simulation.py (muszą być zsynchronizowane)
4. **Auto-discovery prefix 1000** — jeśli symbol zaczyna się od "1000" i nie ma go na MEXC,
   automatycznie próbuje bez prefixu i zapamiętuje mapowanie w runtime

### Naprawy handlerów kanałów:
5. **crypto_world.py** — dodany TYP 7 w prompcie: kilka pełnych sygnałów dla tego samego
   symbolu (np. ORDI x3) traktowane jako osobne LONG/SHORT, nie UPDATE
6. **crypto_devil.py** — dodany FORMAT 2 (uproszczony bez Coin/Leverage):
   "AVAX/USD SELL / Entry : $ 9.51 / Target1: $ 9.20 / SL : $ 9.80"
   pre_filter rozszerzony o: "SYMBOL/USD SELL", "SL :", "Target1:"
7. **crypto_monk.py** — preprocess_text usuwa emoji ze WSZYSTKICH linii (nie tylko z keyword-lines).
   Dodany Przykład 4 (NEAR/USDT SHORT 30x). Doprecyzowane parsowanie:
   emoji między tagami nie przeszkadzają, "Take Profit Targets:" z lub bez spacji przed ":"
8. **whales_pump.py** — dodane Przykłady 5 i 6 (format bez ** z separatorem "-", 4 targety,
   symbol jednoliterowy "M"). Reguły: symbol może być 1-literowy → dodaj /USDT,
   Target z separatorem "-" parsuj tak samo jak "_"

### Nowe skrypty na VPS:
9. **fix_position.py** — uniwersalny skrypt do ręcznej aktualizacji pozycji.
   Edytuj sekcję KONFIGURACJA (POSITION_ID, SYMBOL, DIRECTION, ENTRY, LEVERAGE,
   STOP_LOSS, TAKE_PROFITS), waliduje sumę % TP, pokazuje stan przed zapisem.
   Uruchomienie: `python3 fix_position.py`

### Diagnostyka — sprawdzenie otwartych pozycji:
```bash
cd /home/signal-bot
python3 -c "
import firebase_admin
from firebase_admin import credentials, firestore
from dotenv import load_dotenv; load_dotenv()
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
docs = db.collection('simulation_positions').where('status','==','OPEN').stream()
for d in docs:
    data = d.to_dict()
    print(f'{d.id} | {data.get(\"symbol\")} | {data.get(\"signal_type\")} | entry: {data.get(\"entry_price\")} | alloc: {data.get(\"allocated_usd\")}')
"
```

### Uwagi:
- ID pozycji w zakładce Debug może pokazywać ID sygnału, nie pozycji —
  zawsze weryfikuj przez skrypt powyżej
- SYM_MAP w simulation.py i price_updater.py muszą być zawsze zsynchronizowane —
  gdy dodajesz nowy wyjątek, dodaj go w obu plikach
- Tokeny z prefiksem 1000 (konwencja Binance/Bybit) MEXC notuje bez prefixu


## 20. Sesja 18-19.04.2026

### Nowe pliki na VPS:

**bybit_trader.py** — silnik tradingu Bybit Demo Trading:
- REST API Bybit v5 z podpisem HMAC
- UNIFIED account type (Demo Trading)
- BASE_URL: api-demo.bybit.com
- 4% z dostępnego kapitału, slippage 0.5%, cross margin
- Front-loaded TP identyczny jak simulation.py
- **SL exchange-side** — `set_sl_on_bybit()` przez `/v5/position/trading-stop`
- **TP exchange-side** — `set_tp_orders_on_bybit()` — wszystkie TP jako zlecenia limit reduce-only
- Po każdym TP: anuluje stare zlecenia TP, wystawia nowe dla pozostałej qty
- **Trailing SL na Bybit** — po TP1→50%, po TP2→BE, po TP3→TP1 price (aktualizowane exchange-side)
- `close_position()` nie wysyła zlecenia gdy `CLOSED_ON_EXCHANGE`
- **Sync loop z podwójną weryfikacją** — pozycja musi być nieobecna 2× z rzędu zanim Firebase ją zamknie
- Firebase: kolekcje `bybit_positions`, `bybit_portfolio`, `bybit_log`

**bybit_ws.py** — WebSocket ceny co ~1s:
- URL: wss://stream.bybit.com/v5/public/linear (mainnet publiczny, działa z Demo)
- Subskrypcja tickerów dla otwartych pozycji
- Exponential backoff przy rozłączeniu (5s→10s→...→60s)
- Dynamiczne dodawanie nowych symboli przy otwarciu pozycji
- Sprawdza TP/SL co 1 sekundę przez `check_tp_sl()`

**reset_all.py** — reset wszystkiego do zera:
- Czyści: signals, signals_summary, non_signals, simulation_positions,
  simulation_log, channel_stats, shadow_positions, shadow_portfolios,
  bybit_positions, bybit_log
- Resetuje portfolio symulacji ($200) i bybit_portfolio

**fix_position.py** — ręczna aktualizacja pozycji symulacji (bez zmian)

**crypto_future_signals.py** — nowy handler kanału:
- ID: 3697222236
- Formaty: zapowiedź krótka (Long #ORDI 9.330 / Tp / Sl),
  pełny sygnał (#VIC LONG 0.081 / Leverage 40X / Tp1-3 / Sl),
  aktualizacje (Set sl X, Set tp 1 now X, Close on entry, Manually Cancelled)
- Deployment: dodać do TELEGRAM_CHANNELS w .env + `pm2 reload --update-env`

### Zmiany w istniejących plikach:

**bot.py**:
- `load_dotenv()` przeniesiony przed importy (fix BYBIT_TESTNET=false nie działało)
- Import i integracja bybit_trader + bybit_ws
- `init_bybit(db)` przy starcie
- `process_signal_for_bybit()` wywoływane równolegle z simulation
- `bybit_ws_loop()` jako osobny task
- HTTP server na porcie 8765 (aiohttp) — endpoint `/api/bybit/close` i `/api/health`
- `_bybit_sync_loop()` co 5s sprawdza czy pozycje nadal otwarte na Bybit
- Polling limit: 20 wiadomości (było 10), okno 15 minut (było 10)

**channels/base_channel.py**:
- Throttling 2s między requestami Groq (class variable `_last_groq_call`)
- Retry z exponential backoff (3 próby, 15s/30s)
- **Auto-fallback modelu**: primary `llama-3.3-70b-versatile` (100k/dzień),
  fallback `llama-3.1-8b-instant` (1M/dzień)
- Przy błędzie `tokens per day` → automatyczne przełączenie na fallback
- Po północy UTC → test primary co 10 minut → powrót gdy dostępny
- Status zapisywany do `bot_health/groq_model` w Firebase (jeden dokument)

**channels/crypto_beast.py**:
- `pre_filter`: usuwa `**` markdown przed sprawdzaniem
- Wzmocniony hard_spam filter (t.me/+, join fast, paid group, admin birthday itp.)

**channels/crypto_world.py**:
- TYP 7 w prompcie: kilka pełnych sygnałów dla tego samego symbolu → osobne LONG/SHORT

**channels/crypto_devil.py**:
- FORMAT 2: uproszczony (AVAX/USD SELL / Entry : $ X / Target1: $ X / SL : $ X)

**channels/crypto_monk.py**:
- preprocess_text usuwa emoji ze wszystkich linii
- Przykład 4 (NEAR/USDT SHORT 30x)

**channels/crypto_future_signals.py**:
- hard_spam filter (paid group, hurry up, join fast itp.)

**simulation.py**:
- `should_update` — 4. warunek: nowy pełny sygnał z innymi parametrami aktualizuje pozycję
- `SYM_MAP` rozszerzony: 1000SATS, 1000PEPE, 1000FLOKI, 1000BONK, 1000X, 1000CAT, 1000MOG

**price_updater.py**:
- `SYMBOL_MAP` zsynchronizowany z simulation.py (tokeny 1000-prefix)
- Auto-discovery prefix 1000 w runtime

### App.jsx — zakładka Bybit (🟡):
- Pozycja zaraz po Portfolio w tab barze
- Metryki: Wallet Balance, Dostępny Margin, Margin w użyciu, Całkowity P&L,
  Zrealizowany, Niezrealizowany, Win Rate, Trades, Otwarte poz.
- Error banner gdy Bybit odrzuci zlecenie
- Sub-zakładki: Pozycje / Historia / Log
- Status modelu Groq w zakładce Debug (zielony=primary, żółty=fallback)

### Komendy VPS:

```bash
# Sprawdź aktualny model Groq
grep "fallback\|primary\|GROQ\|wyczerpany" /home/signal-bot/logs/bot-out.log | tail -10

# Sprawdź status modelu w Firebase
python3 -c "
from dotenv import load_dotenv; load_dotenv()
import firebase_admin
from firebase_admin import credentials, firestore
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
doc = db.collection('bot_health').document('groq_model').get()
if doc.exists:
    d = doc.to_dict()
    print(f'Model: {d.get(\"current_model\")}')
    print(f'Fallback: {d.get(\"using_fallback\")}')
    print(f'Od: {d.get(\"fallback_since\")}')
else:
    print('Primary model aktywny (brak przełączeń)')
"

# Test Bybit API
cd /home/signal-bot && python3 test_bybit.py

# Reset wszystkiego
cd /home/signal-bot && python3 reset_all.py
```

### Uwagi:
- Bybit Demo Trading: api-demo.bybit.com, BYBIT_TESTNET=false w .env
- WebSocket ceny: wss://stream.bybit.com/v5/public/linear (publiczny mainnet)
- SYM_MAP w simulation.py i price_updater.py muszą być zsynchronizowane
- Groq primary reset o północy UTC — bot automatycznie wraca do primary
- Port 8765 otwarty na firewall (ufw allow 8765) — HTTP API dla zamykania pozycji
- Crypto Future Signals (3697222236) dodany do TELEGRAM_CHANNELS w .env


## 21. Sesja 19-20.04.2026

### Bybit trader — naprawy krytyczne:

**bybit_trader.py:**
- **TP exchange-side** — `set_tp_orders_on_bybit()` wystawia wszystkie TP jako zlecenia
  limit reduce-only na Bybit przy otwarciu pozycji
- **Anulowanie TP** — `cancel_tp_orders_on_bybit()` anuluje stare zlecenia przed
  wystawieniem nowych (po każdym partial close)
- **Re-order TP** — po TP1 bot anuluje TP2-5 i wystawia nowe z zaktualizowaną qty
- **SL exchange-side** — `set_sl_on_bybit()` z walidacją ceny (nie ustawia SL gdy
  jest po złej stronie aktualnej ceny rynkowej)
- **Trailing SL na Bybit** — po TP1→50%, po TP2→BE, po TP3→TP1 price — każda zmiana
  wysyłana do Bybit przez `/v5/position/trading-stop`
- **Sync loop podwójna weryfikacja** — pozycja musi być nieobecna 2× z rzędu zanim
  Firebase ją zamknie (chroni przed chwilowymi lagami API)
- **close_position** nie wysyła zlecenia gdy `CLOSED_ON_EXCHANGE`
- **Mała pozycja** — gdy qty < min_qty przy partial close, pomija zlecenie (nie crashuje)

### Nowe narzędzia testowe:

**test_signal.py** — otwiera testową pozycję ETH/USDT z aktualnymi cenami:
- Pobiera aktualną cenę z Bybit API
- Lewar x15 (wystarczająca qty na partial close)
- 5 TP: +2%/+4%/+6%/+8%/+10%, SL: -3%
- Otwiera równolegle w symulacji i Bybit
```bash
cd /home/signal-bot && python3 test_signal.py
```

**sim_tp.py** — interaktywny symulator TP:
- Pokazuje aktualny stan pozycji (entry, qty, SL, TP trafione/oczekujące)
- Wyjaśnia co się stanie po każdym TP (ile % zamknie, jak zmieni się SL)
- Pyta czy wykonać TP1/TP2/TP3/TP4/TP5
- Wykonuje w obu systemach (Bybit + symulacja)
```bash
cd /home/signal-bot && python3 sim_tp.py
```

**Czyszczenie pozycji testowych:**
```bash
python3 -c "
from dotenv import load_dotenv; load_dotenv()
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
for col in ['bybit_positions', 'simulation_positions']:
    docs = db.collection(col).where('status','==','OPEN').stream()
    for d in docs:
        if d.to_dict().get('channel') == 'test':
            d.reference.update({'status':'CLOSED','close_reason':'TEST_CLEANUP',
                'closed_at':datetime.now(timezone.utc).isoformat()})
            print(f'Zamknięto: {d.id}')
print('OK')
"
```

### Wyniki testów symulacji:
- TP1 ✅ zamknął 35%, SL przesunął się do 50%, ustawiony na Bybit
- TP2 ✅ zamknął 25%, SL→BE, ustawiony na Bybit
- TP3 ✅ zamknął 20%, SL→TP1 price
- TP4/TP5 — przy małym kapitale ($8×x15) qty po TP3 < min_qty (0.01 ETH)
  Na prawdziwych sygnałach nie będzie problemu

### Groq auto-fallback:

**base_channel.py:**
- Throttling 2s między requestami (class variable — współdzielony)
- Retry 3× z backoff 15s/30s
- **Auto-fallback**: gdy błąd `tokens per day` → przełącza na `llama-3.1-8b-instant`
- **Auto-powrót**: po północy UTC co 10 minut testuje primary, wraca gdy dostępny
- Status zapisywany do `bot_health/groq_model` (jeden dokument, nadpisywany)
- Zielony/żółty banner w zakładce Debug

**crypto_beast.py:**
- Hard-spam filter: t.me/+, join fast, paid group, admin birthday itp.
- Usuwanie `**` markdown przed pre_filter

**crypto_future_signals.py:**
- Hard-spam filter identyczny jak BEAST

### Nowy kanał:

**Crypto Future Signals (ID: 3697222236):**
- Handler: `/home/signal-bot/channels/crypto_future_signals.py`
- Dodać do .env: `TELEGRAM_CHANNELS=...,3697222236`
- Reload: `pm2 reload signal-bot --update-env`
- Formaty: zapowiedź krótka, pełny sygnał z Leverage 40X,
  aktualizacje (Set sl/tp, Close on entry, Manually Cancelled)

### App.jsx — poprawki UI:

**Zakładka Bybit → Historia:**
- Rozwijane wiersze zamkniętych pozycji jak w Portfolio/Zamknięte
- Ten sam `ClosedPositionDetail` — TP lista, SL, podsumowanie słowne, szczegóły
- Kliknięcie w wiersz rozwija/zwija szczegóły

**Naprawy mobilne:**
- CSS `@media(max-width:600px)` z klasą `.col-hide`
- Na telefonach ukryte kolumny: Kanał, Otwarto, Alloc.
- Zostają: Symbol, Typ, Entry, Aktualnie, SL, TP, P&L, Zamknij
- Rozwinięte pozycje **nie zamykają się** przy odświeżaniu Firebase:
  - `ClosedTable` używa `expandedRef` (przeżywa re-rendery)
  - `BybitClosedRow` — `expanded` state w rodzicu `BybitDashboard` jako Map

### Instrukcja VPS od zera:
- Plik: `INSTALACJA_VPS.md` w repozytorium GitHub
- Kroki: apt, Node.js, PM2, Python libs, git clone, firebase-key, .env,
  pierwsze logowanie Telegram (ręcznie!), pm2 start, pm2 save, pm2 startup


## 22. Sesja 20.04.2026 — Naprawa systemu Bybit

### Krytyczne bugi naprawione w bybit_trader.py:

1. **Sync loop za szybki** — co 5s → co 30s (pierwsze sprawdzenie po 15s)
   Powód: Bybit API lag > 5s powodował fałszywe CLOSED_ON_EXCHANGE

2. **WebSocket duplikował zamknięcia TP** — usunięto market order przy TP
   Teraz: TP wykonywane exchange-side przez Bybit, bot tylko rejestruje fakt

3. **qty_to_close z Firebase ≠ Bybit** — pobieramy qty z get_bybit_position() przed obliczeniem
   Powód: Bybit może zamknąć więcej niż Firebase wie

4. **cancel_tp warunkowo** → zawsze cancel-all bez warunku if

5. **Walidacja ceny blokowała trailing SL→TP1** — usunięto walidację ceny w set_sl_on_bybit

6. **Edycja sygnału nie trafiała na Bybit** — dodano process_signal_for_bybit() przy edycji w bot.py

7. **round() zamiast round_qty()** — poprawione dla qty_to_close

8. **tp_order_ids nie zapisywane przy otwarciu** — dodane do dokumentu Firebase

9. **bybit_qty None vs 0** — get_bybit_position() zwraca {} (truthy) gdy brak pozycji
   Fix: sprawdzamy obecność klucza "size" bezpośrednio

10. **bybit_qty==0 natychmiastowe zamknięcie** — gdy Bybit zamknął całą pozycję

11. **close_position nie wysyła market order dla TP_HIT** — Bybit już zamknął exchange-side

12. **Fallback TP wyłączony** — gdy bybit_qty is None (brak połączenia), czekamy na reconnect

13. **cancel-all zamiast per-order** — anuluje wszystkie zlecenia dla symbolu naraz

### bybit_ws.py:
- `ping_interval=None, ping_timeout=None` — Bybit sam wysyła ping, nie biblioteka
- PnL aktualizacja co 10s zamiast co 1s — mniej obciążenia Firebase
- check_tp_sl i update_pnl bez run_in_executor (powodował wyścig wątków)

### bot.py:
- `process_signal_for_bybit()` → `run_in_executor` — nie blokuje asyncio event loop
- `sync_positions_with_bybit()` → `run_in_executor`
- Edycja sygnału (is_edit=True) → aktualizuje też Bybit
- Sync loop co 30s (było 5s)

### health_monitor.py:
- Reset licznika tokenów co minutę przez `_check_midnight_token_reset()`
- Limit tokenów dynamiczny: 100k (primary) lub 1M (fallback)
- Heartbeat wysyła `groq_current_model` i `groq_using_fallback`
- Helpers: `_get_groq_model()`, `_get_groq_fallback()`

### App.jsx:
- **TokenBar** — pokazuje aktualny model Groq (primary ✅ / fallback ⚠)
- **PositionCard** — karty zamiast tabeli (mobile-friendly, bez poziomego scrolla)
- **ClosedTable** — karty z `expandedRef` w App level (nie resetuje się przy Firebase update)
- **BybitClosedRow** — ikony wyniku (✅/⚠/❌), partial closes widoczne bez rozwijania
- Kanał pokazywany wszędzie (CHANNEL_FALLBACKS uzupełniony o wszystkie 12 kanałów)

### Diagnostyka:
```bash
# Sprawdź kiedy ostatnio zaktualizowały się ceny Bybit
python3 -c "
from dotenv import load_dotenv; load_dotenv()
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
from google.cloud.firestore_v1.base_query import FieldFilter
docs = db.collection('bybit_positions').where(filter=FieldFilter('status','==','OPEN')).stream()
now = datetime.now(timezone.utc)
for d in docs:
    data = d.to_dict()
    upd = data.get('price_updated_at','')
    if upd:
        dt = datetime.fromisoformat(upd)
        age = int((now-dt).total_seconds())
        print(f'{data.get(\"symbol\")}: {age}s temu | cena={data.get(\"current_price\")}')
"

# Sprawdź WebSocket status
grep "WS\].*Błąd\|WS\].*Łączę" /home/signal-bot/logs/bot-out.log | tail -10

# Reset licznika tokenów Groq
python3 -c "
from dotenv import load_dotenv; load_dotenv()
import firebase_admin
from firebase_admin import credentials, firestore
from datetime import datetime, timezone
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
db.collection('bot_health').document('token_counter').set({
    'date': datetime.now(timezone.utc).strftime('%Y-%m-%d'),
    'tokens_used': 0,
    'updated_at': datetime.now(timezone.utc).isoformat(),
})
print('Reset OK')
"
```

### Znane problemy pozostałe:
- WebSocket Bybit Demo rozłącza się co ~12 minut (keepalive ping timeout)
  Po reconnekcie (~5s) ceny wracają normalnie
- SUPER/USDT brak ceny na MEXC (price_updater pomija)
- Pozycje otwarte na Bybit ale zamknięte w Firebase wymagają ręcznego zamknięcia na giełdzie
  



## PROMPT STARTOWY

Wklej to jako pierwszą wiadomość w nowym czacie:


Kontynuujemy pracę nad projektem "Telegram Signal Bot" — systemem monitorowania sygnałów tradingowych.

STACK:
- Bot: Python 3.12 + Telethon na VPS Ubuntu, PM2 (procesy: signal-bot, market-regime, shadow-portfolio)
- AI: Groq API (llama-3.3-70b-versatile) do parsowania sygnałów
- DB: Firebase Firestore (plan Blaze)
- Frontend: React/Vite → Vercel, jeden plik App.jsx (~3100 linii)
- Ceny: MEXC public API

PLIKI NA VPS /home/signal-bot/:
bot.py, simulation.py, price_updater.py, health_monitor.py + channels/ (11 handlerów)

KANAŁY (11): Crypto Bulls(1700533698), Crypto BEAST(1982472141), Crypto MONK(1552004524), 
Predictum(1456872361), Binance 360(1553551852), Boom Boom(1756316676), Crypto Hustle(1743387695), 
Crypto World(1652601224), Crypto Devil(1598691683), Crypto Conquered(1505272164), Whales Pump(1594522150)

PARAMETRY SYMULACJI: $200 kapitał, 4% ryzyko=$8/trade, slippage 0.5%

FRONT-LOADED TP: 3TP→50/30/20%, 4TP→40/30/20/10%, 5TP→35/25/20/15/5%, 6TP→30/25/20/15/7/3%
3-STOPNIOWY SL: po TP1→50% drogi, po TP2→BE, po TP3→SL na cenę TP1
DCA: entry range → wejście po pierwszej cenie, dokładanie 2% po drugiej
WALIDACJA MEXC: ratio 1.5x max między ceną MEXC a entry sygnału

MECHANIZM: dual-track — Telethon events + polling co 60s (backup), keepalive co 30s (GetDialogsRequest)

FRONTEND (zakładki): Portfolio, Otwarte, Zamknięte (z historią TP/SL po kliknięciu), 
Kanały, Sygnały, Log (AdvancedLog z filtrami), Debug, Intelligence, Sentiment, Shadow (6 strategii)

DEPLOYMENT: pm2 reload signal-bot (NIE restart!), tylko po 22:00 UTC
App.jsx → GitHub → Vercel auto-deploy

Co chcesz dzisiaj zrobić?
```
