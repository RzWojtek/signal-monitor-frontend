# Instrukcja odtworzenia bota od zera na świeżym Ubuntu VPS

---

## 1. Pierwsze logowanie i aktualizacja systemu

```bash
apt update && apt upgrade -y
apt install -y git python3 python3-pip python3-venv nano curl wget ufw
```

---

## 2. Instalacja Node.js i PM2

```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
apt install -y nodejs
npm install -g pm2
```

---

## 3. Konfiguracja firewall

```bash
ufw allow 22      # SSH
ufw allow 8765    # HTTP API bota
ufw enable
ufw status
```

---

## 4. Instalacja bibliotek Python

```bash
pip install --break-system-packages \
  telethon \
  groq \
  firebase-admin \
  python-dotenv \
  aiohttp \
  websockets \
  requests
```

---

## 5. Pobranie kodu z GitHub

```bash
cd /home
git clone https://github.com/RzWojtek/NAZWA_REPO signal-bot
cd /home/signal-bot
```

> Zastąp `NAZWA_REPO` właściwą nazwą repozytorium signal-bota.

---

## 6. Plik firebase-key.json

Skopiuj plik `firebase-key.json` z bezpiecznego miejsca na VPS:

```bash
# Z lokalnego komputera (nie z VPS):
scp firebase-key.json root@TWOJE_IP_VPS:/home/signal-bot/firebase-key.json
```

Lub wklej zawartość ręcznie:
```bash
nano /home/signal-bot/firebase-key.json
# Wklej zawartość klucza Firebase, Ctrl+X, Y, Enter
```

---

## 7. Plik .env

```bash
nano /home/signal-bot/.env
```

Wklej i uzupełnij wszystkie wartości:

```env
TELEGRAM_API_ID=TWOJE_API_ID
TELEGRAM_API_HASH=TWOJ_API_HASH
TELEGRAM_PHONE=TWOJ_NUMER_TELEFONU
GROQ_API_KEY=TWOJ_KLUCZ_GROQ
FIREBASE_CREDENTIALS_PATH=firebase-key.json

TELEGRAM_CHANNELS=1700533698,1982472141,1552004524,1456872361,1553551852,1756316676,1743387695,1652601224,1598691683,1505272164,1594522150,3697222236

SIM_CAPITAL=200
SIM_RISK_PCT=4.0
SIM_SLIPPAGE_PCT=0.5
SIM_BE_AFTER_TP=2
SIM_MAX_POSITIONS=0
SIM_MIN_CAPITAL=0

BYBIT_API_KEY=TWOJ_KLUCZ_BYBIT
BYBIT_API_SECRET=TWOJ_SECRET_BYBIT
BYBIT_TESTNET=false
```

---

## 8. Pierwsze uruchomienie bota (logowanie Telegram)

Pierwsze uruchomienie wymaga autoryzacji Telegrama — **musisz to zrobić ręcznie, nie przez PM2**:

```bash
cd /home/signal-bot
python3 bot.py
```

Telegram wyśle kod SMS na Twój numer — wpisz go w terminalu. Po zalogowaniu zostanie zapisany plik `signal_session.session`. Zatrzymaj bota przez `Ctrl+C`.

---

## 9. Uruchomienie przez PM2

```bash
cd /home/signal-bot

# Główny bot
pm2 start bot.py --name signal-bot --interpreter python3

# Market regime (analiza BTC/Fear&Greed)
pm2 start market_regime.py --name market-regime --interpreter python3

# Shadow portfolio
pm2 start shadow_portfolio.py --name shadow-portfolio --interpreter python3

# Zapisz konfigurację PM2
pm2 save

# Ustaw autostart po restarcie VPS
pm2 startup
# Wykonaj komendę którą PM2 wyświetli (zaczyna się od "sudo env PATH=...")
```

---

## 10. Weryfikacja że wszystko działa

```bash
pm2 status
```

Powinno pokazać:
```
signal-bot       online
market-regime    online
shadow-portfolio online
```

```bash
# Sprawdź logi
pm2 logs signal-bot --lines 30
```

Powinieneś zobaczyć:
```
[BOT] ✅ Groq API działa
[BOT] ✅ Telegram connected
[BOT] Kanały: 12 | Handlery: 12
[BYBIT] ✅ Trader zainicjalizowany (MAINNET)
[WS] ✅ Połączono z wss://stream.bybit.com/v5/public/linear
[API] ✅ HTTP server uruchomiony na porcie 8765
[PRICE] ✅ Price updater uruchomiony
[POLL] ✅ Polling loop uruchomiony
```

---

## 11. Test Bybit API

```bash
cd /home/signal-bot
python3 test_bybit.py
```

Powinno pokazać saldo ~$200 na Demo Trading.

---

## 12. Reset Firebase (opcjonalnie — jeśli chcesz zacząć od zera)

```bash
cd /home/signal-bot
python3 reset_all.py
```

---

## 13. Cron jobs (opcjonalnie)

```bash
crontab -e
```

Dodaj:
```
0 6 * * * cd /home/signal-bot && python3 ai_mentor.py >> logs/mentor.log 2>&1
0 7 * * 1 cd /home/signal-bot && python3 strategy_evolution.py >> logs/evolution.log 2>&1
```

---

## 14. Frontend (App.jsx)

Frontend jest na GitHub → Vercel (auto-deploy). Nic nie trzeba robić — działa niezależnie od VPS.

Sprawdź reguły Firestore (Firebase Console → Firestore → Rules):
```
match /bybit_positions/{doc} { allow read, write: if true; }
match /bybit_portfolio/{doc} { allow read, write: if true; }
match /bybit_log/{doc}       { allow read, write: if true; }
```

---

## Ważne zasady deploymentu

| Zasada | Komenda |
|--------|---------|
| Reload bota (NIE restart) | `pm2 reload signal-bot` |
| Reload z nowymi zmiennymi .env | `pm2 reload signal-bot --update-env` |
| Tylko po 22:00 UTC (= 00:00 PL) | — |
| Nigdy `pm2 restart` | używaj `pm2 reload` |

---

## Pliki krytyczne — backup lokalnie

Trzymaj kopię tych plików poza VPS:

| Plik | Opis |
|------|------|
| `firebase-key.json` | Klucz Firebase — bez niego nic nie działa |
| `.env` | Wszystkie klucze API |
| `signal_session.session` | Sesja Telegram — bez niej trzeba logować się od nowa |

```bash
# Backup z VPS na lokalny komputer:
scp root@TWOJE_IP:/home/signal-bot/firebase-key.json ./backup/
scp root@TWOJE_IP:/home/signal-bot/.env ./backup/
scp root@TWOJE_IP:/home/signal-bot/signal_session.session ./backup/
```

---

## Szybka diagnostyka problemów

```bash
# Bot nie startuje
pm2 logs signal-bot --lines 50

# Groq rate limit
grep "GROQ\|rate_limit\|fallback" /home/signal-bot/logs/bot-out.log | tail -10

# Bybit nie działa
python3 /home/signal-bot/test_bybit.py

# Otwarte pozycje w Firebase
python3 -c "
from dotenv import load_dotenv; load_dotenv()
import firebase_admin
from firebase_admin import credentials, firestore
cred = credentials.Certificate('firebase-key.json')
firebase_admin.initialize_app(cred)
db = firestore.client()
docs = db.collection('simulation_positions').where('status','==','OPEN').stream()
for d in docs:
    data = d.to_dict()
    print(f'{d.id} | {data.get(\"symbol\")} | {data.get(\"signal_type\")} | entry: {data.get(\"entry_price\")}')
"

# Sprawdź model Groq
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
else:
    print('Primary model aktywny')
"
```
