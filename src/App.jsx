import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, query, orderBy,
  limit, onSnapshot, doc,
} from "firebase/firestore";

const firebaseConfig = {
  apiKey:            import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain:        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:         import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:     import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId:             import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

// ─── helpers ────────────────────────────────────────────────────────────────
const fmt  = (n, d = 2) => n != null ? Number(n).toFixed(d) : "—";
const fmtK = (n) => n != null ? `$${Number(n).toFixed(2)}` : "—";
const pct  = (n) => n != null ? `${Number(n).toFixed(2)}%` : "—";
const ago  = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now() - d) / 1000);
  if (s < 60) return `${s}s temu`;
  if (s < 3600) return `${Math.floor(s/60)}m temu`;
  if (s < 86400) return `${Math.floor(s/3600)}h temu`;
  return d.toLocaleDateString("pl-PL");
};
const fmtDt = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("pl-PL");
};

const GREEN  = "#00ff90";
const RED    = "#ff4d6d";
const BLUE   = "#00cfff";
const PURPLE = "#a78bfa";
const YELLOW = "#ffdb4d";
const BG     = "#070b10";
const CARD   = "#0d1117";
const BORDER = "#1e2530";

// ─── tiny components ────────────────────────────────────────────────────────
const Pill = ({ label, color = GREEN }) => (
  <span style={{
    background: color + "22", color, border: `1px solid ${color}44`,
    borderRadius: 4, padding: "2px 8px", fontSize: 11,
    fontWeight: 700, letterSpacing: 1, fontFamily: "monospace",
  }}>{label}</span>
);

const StatCard = ({ label, value, sub, color = "#fff" }) => (
  <div style={{
    background: CARD, border: `1px solid ${BORDER}`,
    borderRadius: 10, padding: "14px 18px", minWidth: 120,
  }}>
    <div style={{ color: "#444", fontSize: 10, letterSpacing: 2, textTransform: "uppercase", marginBottom: 4 }}>
      {label}
    </div>
    <div style={{ color, fontFamily: "monospace", fontSize: 22, fontWeight: 800, lineHeight: 1 }}>
      {value}
    </div>
    {sub && <div style={{ color: "#555", fontSize: 11, marginTop: 4 }}>{sub}</div>}
  </div>
);

// ─── PORTFOLIO HEADER ────────────────────────────────────────────────────────
function PortfolioHeader({ portfolio }) {
  if (!portfolio) return (
    <div style={{ color: "#333", padding: 20, textAlign: "center" }}>
      Ładowanie portfela...
    </div>
  );

  const pnl     = portfolio.total_pnl ?? 0;
  const pnlPct  = portfolio.total_pnl_pct ?? 0;
  const capital = portfolio.current_capital ?? 0;
  const initial = portfolio.initial_capital ?? 200;
  const wins    = portfolio.wins ?? 0;
  const losses  = portfolio.losses ?? 0;
  const total   = portfolio.total_trades ?? 0;
  const wr      = total > 0 ? ((wins / total) * 100).toFixed(0) : 0;
  const isPos   = pnl >= 0;

  return (
    <div style={{
      background: CARD,
      border: `1px solid ${isPos ? GREEN + "40" : RED + "40"}`,
      borderRadius: 12,
      padding: "20px 24px",
      marginBottom: 24,
    }}>
      {/* Top row */}
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16, flexWrap: "wrap" }}>
        <span style={{ fontSize: 22 }}>💼</span>
        <div>
          <div style={{ color: "#fff", fontWeight: 800, fontSize: 15, letterSpacing: 2 }}>
            PORTFEL SYMULACJI
          </div>
          <div style={{ color: "#444", fontSize: 11 }}>
            Start: {fmtDt(portfolio.created_at)} · Kapital startowy: {fmtK(initial)}
          </div>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{
            width: 8, height: 8, borderRadius: "50%", background: GREEN,
            display: "inline-block", animation: "pulse 2s infinite",
          }} />
          <span style={{ color: GREEN, fontSize: 12, fontFamily: "monospace" }}>DRY RUN</span>
        </div>
      </div>

      {/* Stats grid */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
        <StatCard label="Wolny Kapitał"  value={fmtK(capital)}  color="#fff" />
        <StatCard
          label="Całkowity P&L"
          value={`${isPos ? "+" : ""}${fmtK(pnl)}`}
          sub={`${isPos ? "▲" : "▼"} ${pct(Math.abs(pnlPct))} od startu`}
          color={isPos ? GREEN : RED}
        />
        <StatCard label="Zyski / Straty"
          value={`${wins}W / ${losses}L`}
          sub={`Win rate: ${wr}%`}
          color={wins >= losses ? GREEN : RED}
        />
        <StatCard label="Wszystkie Trade'y" value={total} color={BLUE} />

        {/* Progress bar */}
        <div style={{
          flex: 1, minWidth: 200,
          background: CARD, border: `1px solid ${BORDER}`,
          borderRadius: 10, padding: "14px 18px",
        }}>
          <div style={{ color: "#444", fontSize: 10, letterSpacing: 2, marginBottom: 8 }}>
            KAPITAŁ VS START
          </div>
          <div style={{ background: "#1a1f2a", borderRadius: 4, height: 8, overflow: "hidden" }}>
            <div style={{
              width: `${Math.min(Math.max((capital / initial) * 100, 0), 200)}%`,
              height: "100%",
              background: isPos
                ? `linear-gradient(90deg, ${GREEN}80, ${GREEN})`
                : `linear-gradient(90deg, ${RED}80, ${RED})`,
              borderRadius: 4,
              transition: "width 1s ease",
            }} />
          </div>
          <div style={{
            display: "flex", justifyContent: "space-between",
            marginTop: 6, fontSize: 11, fontFamily: "monospace",
          }}>
            <span style={{ color: "#444" }}>$0</span>
            <span style={{ color: isPos ? GREEN : RED }}>{fmtK(capital)}</span>
            <span style={{ color: "#444" }}>{fmtK(initial * 2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── OPEN POSITIONS TABLE ────────────────────────────────────────────────────
function PositionsTable({ positions }) {
  const [expandedId, setExpandedId] = useState(null);

  if (positions.length === 0) return (
    <div style={{
      background: CARD, border: `1px solid ${BORDER}`,
      borderRadius: 10, padding: 30, textAlign: "center",
      color: "#333", fontSize: 13,
    }}>
      Brak otwartych pozycji
    </div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{
        width: "100%", borderCollapse: "collapse",
        fontFamily: "monospace", fontSize: 12,
      }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["Symbol", "Typ", "Entry", "Aktualnie", "SL", "TP Hit", "Alloc.", "Unrealized P&L", "Otwarto"].map(h => (
              <th key={h} style={{
                color: "#444", fontSize: 10, letterSpacing: 1,
                padding: "8px 10px", textAlign: "left",
                textTransform: "uppercase", whiteSpace: "nowrap",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(pos => {
            const pnl    = pos.unrealized_pnl ?? 0;
            const pnlPct = pos.unrealized_pnl_pct ?? 0;
            const isPos  = pnl >= 0;
            const isLong = pos.signal_type === "LONG" || pos.signal_type === "SPOT_BUY";
            const tpsHit = pos.tps_hit?.length ?? 0;
            const tpsTotal = pos.take_profits?.length ?? 0;
            const accent = isLong ? GREEN : RED;

            return (
              <>
                <tr
                  key={pos.id}
                  onClick={() => setExpandedId(expandedId === pos.id ? null : pos.id)}
                  style={{
                    borderBottom: `1px solid ${BORDER}`,
                    cursor: "pointer",
                    transition: "background 0.15s",
                  }}
                  onMouseEnter={e => e.currentTarget.style.background = "#ffffff05"}
                  onMouseLeave={e => e.currentTarget.style.background = "transparent"}
                >
                  {/* Symbol */}
                  <td style={{ padding: "10px 10px", color: "#fff", fontWeight: 700 }}>
                    <span style={{ borderLeft: `3px solid ${accent}`, paddingLeft: 8 }}>
                      {pos.symbol}
                    </span>
                  </td>
                  {/* Typ */}
                  <td style={{ padding: "10px 10px" }}>
                    <Pill label={pos.signal_type} color={accent} />
                  </td>
                  {/* Entry */}
                  <td style={{ padding: "10px 10px", color: "#888" }}>
                    ${fmt(pos.entry_price, 4)}
                  </td>
                  {/* Current */}
                  <td style={{ padding: "10px 10px", color: isPos ? GREEN : RED }}>
                    ${fmt(pos.current_price, 4)}
                  </td>
                  {/* SL */}
                  <td style={{ padding: "10px 10px", color: RED + "bb" }}>
                    {pos.stop_loss ? `$${fmt(pos.stop_loss, 4)}` : "—"}
                  </td>
                  {/* TP hit */}
                  <td style={{ padding: "10px 10px" }}>
                    {tpsTotal > 0
                      ? <span style={{ color: tpsHit > 0 ? GREEN : "#555" }}>
                          {tpsHit}/{tpsTotal}
                        </span>
                      : <span style={{ color: "#333" }}>—</span>
                    }
                  </td>
                  {/* Allocated */}
                  <td style={{ padding: "10px 10px", color: "#666" }}>
                    {fmtK(pos.allocated_usd)}
                    {pos.leverage > 1 && (
                      <span style={{ color: YELLOW, marginLeft: 4 }}>x{pos.leverage}</span>
                    )}
                  </td>
                  {/* PnL */}
                  <td style={{ padding: "10px 10px" }}>
                    <span style={{ color: isPos ? GREEN : RED, fontWeight: 700 }}>
                      {isPos ? "+" : ""}{fmtK(pnl)}
                    </span>
                    <span style={{ color: isPos ? GREEN + "88" : RED + "88", marginLeft: 6, fontSize: 11 }}>
                      ({isPos ? "+" : ""}{pct(pnlPct)})
                    </span>
                  </td>
                  {/* Date */}
                  <td style={{ padding: "10px 10px", color: "#444", fontSize: 11 }}>
                    {ago(pos.opened_at)}
                  </td>
                </tr>
                {/* Expanded row */}
                {expandedId === pos.id && (
                  <tr key={pos.id + "_exp"}>
                    <td colSpan={9} style={{ padding: "0 10px 12px 10px", background: "#0a0f16" }}>
                      <div style={{
                        padding: "12px", borderRadius: 8,
                        border: `1px solid ${accent}22`, display: "flex", gap: 24, flexWrap: "wrap",
                      }}>
                        <div>
                          <div style={{ color: "#444", fontSize: 10, marginBottom: 4 }}>TAKE PROFITS</div>
                          {pos.take_profits?.length ? pos.take_profits.map(tp => (
                            <div key={tp.level} style={{
                              color: pos.tps_hit?.includes(tp.level) ? GREEN : "#555",
                              fontSize: 12,
                            }}>
                              {pos.tps_hit?.includes(tp.level) ? "✓ " : "○ "}
                              TP{tp.level}: ${fmt(tp.price, 4)}
                            </div>
                          )) : <span style={{ color: "#444" }}>Brak TP</span>}
                        </div>
                        <div>
                          <div style={{ color: "#444", fontSize: 10, marginBottom: 4 }}>SZCZEGÓŁY</div>
                          <div style={{ color: "#555", fontSize: 12 }}>Qty: {pos.quantity}</div>
                          <div style={{ color: "#555", fontSize: 12 }}>Pos size (z dźw.): {fmtK(pos.position_size_usd)}</div>
                          <div style={{ color: "#555", fontSize: 12 }}>Ryzyko: {pos.risk_pct}%</div>
                          <div style={{ color: "#555", fontSize: 12 }}>Kanał: {pos.channel}</div>
                        </div>
                        <div>
                          <div style={{ color: "#444", fontSize: 10, marginBottom: 4 }}>OTWARTO</div>
                          <div style={{ color: "#555", fontSize: 12 }}>{fmtDt(pos.opened_at)}</div>
                        </div>
                      </div>
                    </td>
                  </tr>
                )}
              </>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── CLOSED POSITIONS TABLE ───────────────────────────────────────────────────
function ClosedTable({ positions }) {
  if (positions.length === 0) return (
    <div style={{
      color: "#333", textAlign: "center", padding: 20, fontSize: 13,
    }}>Brak zamkniętych pozycji</div>
  );

  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace", fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: `1px solid ${BORDER}` }}>
            {["Symbol", "Typ", "Entry", "Exit", "P&L $", "P&L %", "Powód", "Czas"].map(h => (
              <th key={h} style={{
                color: "#444", fontSize: 10, letterSpacing: 1,
                padding: "8px 10px", textAlign: "left", textTransform: "uppercase",
              }}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(pos => {
            const pnl = pos.realized_pnl ?? 0;
            const pnlPct = pos.realized_pnl_pct ?? 0;
            const isPos = pnl >= 0;
            const isLong = pos.signal_type === "LONG" || pos.signal_type === "SPOT_BUY";

            return (
              <tr key={pos.id} style={{ borderBottom: `1px solid ${BORDER}22` }}
                onMouseEnter={e => e.currentTarget.style.background = "#ffffff04"}
                onMouseLeave={e => e.currentTarget.style.background = "transparent"}
              >
                <td style={{ padding: "8px 10px", color: "#888", fontWeight: 600 }}>{pos.symbol}</td>
                <td style={{ padding: "8px 10px" }}>
                  <Pill label={pos.signal_type} color={isLong ? GREEN : RED} />
                </td>
                <td style={{ padding: "8px 10px", color: "#555" }}>${fmt(pos.entry_price, 4)}</td>
                <td style={{ padding: "8px 10px", color: "#555" }}>${fmt(pos.close_price, 4)}</td>
                <td style={{ padding: "8px 10px", fontWeight: 700, color: isPos ? GREEN : RED }}>
                  {isPos ? "+" : ""}{fmtK(pnl)}
                </td>
                <td style={{ padding: "8px 10px", color: isPos ? GREEN + "99" : RED + "99" }}>
                  {isPos ? "+" : ""}{pct(pnlPct)}
                </td>
                <td style={{ padding: "8px 10px" }}>
                  <Pill
                    label={pos.close_reason || "?"}
                    color={pos.close_reason?.includes("TP") ? GREEN : pos.close_reason === "SL_HIT" ? RED : "#666"}
                  />
                </td>
                <td style={{ padding: "8px 10px", color: "#444", fontSize: 11 }}>{ago(pos.closed_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── SIGNALS FEED ─────────────────────────────────────────────────────────────
function SignalCard({ signal }) {
  const [expanded, setExpanded] = useState(false);
  const isLong  = signal.signal_type === "LONG";
  const isShort = signal.signal_type === "SHORT";
  const accent  = isLong ? GREEN : isShort ? RED : BLUE;

  return (
    <div
      onClick={() => setExpanded(!expanded)}
      style={{
        background: CARD, border: `1px solid ${accent}22`,
        borderLeft: `3px solid ${accent}`,
        borderRadius: 8, padding: "12px 14px", marginBottom: 8, cursor: "pointer",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#fff", fontWeight: 700, fontFamily: "monospace", fontSize: 13 }}>
          {signal.symbol || "???"}
        </span>
        <Pill label={signal.signal_type || "?"} color={accent} />
        <span style={{ color: "#333", fontSize: 10, fontFamily: "monospace" }}>
          [{signal.entry_type || "?"}]
        </span>
        <span style={{ marginLeft: "auto", color: "#333", fontSize: 11 }}>{ago(signal.timestamp)}</span>
        <span style={{ color: "#2a3040", fontSize: 11, padding: "1px 6px", border: `1px solid ${BORDER}`, borderRadius: 3 }}>
          {signal.channel}
        </span>
      </div>

      <div style={{ display: "flex", gap: 16, marginTop: 8, flexWrap: "wrap" }}>
        <span style={{ color: "#666", fontSize: 11 }}>
          Entry: <span style={{ color: accent }}>
            {signal.entry_range
              ? `$${fmt(signal.entry_range.min, 4)} – $${fmt(signal.entry_range.max, 4)}`
              : signal.entry_price ? `$${fmt(signal.entry_price, 4)}` : "—"}
          </span>
        </span>
        <span style={{ color: "#666", fontSize: 11 }}>
          SL: <span style={{ color: RED + "bb" }}>{signal.stop_loss ? `$${fmt(signal.stop_loss, 4)}` : "—"}</span>
        </span>
        {signal.leverage && (
          <span style={{ color: "#666", fontSize: 11 }}>
            Dźwignia: <span style={{ color: YELLOW }}>{signal.leverage}x</span>
          </span>
        )}
        {signal.take_profits?.length > 0 && (
          <span style={{ color: "#666", fontSize: 11 }}>
            TPs: <span style={{ color: GREEN + "bb" }}>{signal.take_profits.length}</span>
          </span>
        )}
      </div>

      {expanded && (
        <div style={{ marginTop: 10, borderTop: `1px solid ${BORDER}`, paddingTop: 10 }}>
          {signal.take_profits?.length > 0 && (
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
              {signal.take_profits.map(tp => (
                <span key={tp.level} style={{
                  background: GREEN + "15", color: GREEN + "cc",
                  border: `1px solid ${GREEN}30`, borderRadius: 4,
                  padding: "1px 7px", fontSize: 11, fontFamily: "monospace",
                }}>
                  TP{tp.level}: ${fmt(tp.price, 4)}
                </span>
              ))}
            </div>
          )}
          <pre style={{
            background: "#050810", color: "#3a4a5a",
            padding: 10, borderRadius: 6, fontSize: 10,
            whiteSpace: "pre-wrap", wordBreak: "break-word",
            border: `1px solid ${BORDER}`, maxHeight: 160, overflow: "auto", margin: 0,
          }}>{signal.raw_message}</pre>
        </div>
      )}
    </div>
  );
}

// ─── TABS ─────────────────────────────────────────────────────────────────────
const TABS = [
  { id: "portfolio",  label: "📊 Portfolio" },
  { id: "open",       label: "🔓 Otwarte" },
  { id: "closed",     label: "🔒 Zamknięte" },
  { id: "signals",    label: "📡 Sygnały" },
  { id: "log",        label: "📝 Log" },
];

function TabBar({ active, onChange }) {
  return (
    <div style={{
      display: "flex", gap: 4, borderBottom: `1px solid ${BORDER}`,
      marginBottom: 20, overflowX: "auto",
    }}>
      {TABS.map(t => (
        <button key={t.id} onClick={() => onChange(t.id)} style={{
          background: active === t.id ? BLUE + "15" : "transparent",
          color:      active === t.id ? BLUE : "#555",
          border: "none",
          borderBottom: active === t.id ? `2px solid ${BLUE}` : "2px solid transparent",
          padding: "10px 16px", cursor: "pointer",
          fontFamily: "monospace", fontSize: 12, fontWeight: 600,
          whiteSpace: "nowrap",
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── EVENT LOG ───────────────────────────────────────────────────────────────
function EventLog({ events }) {
  const colorMap = {
    OPEN:    BLUE,
    CLOSE:   PURPLE,
    TP_HIT:  GREEN,
    SL_HIT:  RED,
    UPDATE:  YELLOW,
  };
  return (
    <div>
      {events.length === 0 ? (
        <div style={{ color: "#333", textAlign: "center", padding: 30, fontSize: 13 }}>
          Log zdarzeń jest pusty
        </div>
      ) : events.map(e => (
        <div key={e.id} style={{
          display: "flex", gap: 12, alignItems: "flex-start",
          padding: "8px 0", borderBottom: `1px solid ${BORDER}22`, fontSize: 12,
        }}>
          <Pill label={e.event_type} color={colorMap[e.event_type] || "#666"} />
          <span style={{ color: "#fff", fontFamily: "monospace", fontWeight: 600 }}>{e.symbol}</span>
          <span style={{ color: "#555", flex: 1 }}>{e.message}</span>
          <span style={{ color: "#333", fontSize: 11, whiteSpace: "nowrap" }}>{ago(e.timestamp)}</span>
        </div>
      ))}
    </div>
  );
}

// ─── ROOT APP ─────────────────────────────────────────────────────────────────
export default function App() {
  const [tab,       setTab]       = useState("portfolio");
  const [portfolio, setPortfolio] = useState(null);
  const [openPos,   setOpenPos]   = useState([]);
  const [closedPos, setClosedPos] = useState([]);
  const [signals,   setSignals]   = useState([]);
  const [logEvents, setLogEvents] = useState([]);

  // portfolio
  useEffect(() => {
    return onSnapshot(doc(db, "simulation", "portfolio"), (snap) => {
      if (snap.exists()) setPortfolio(snap.data());
    });
  }, []);

  // open positions
  useEffect(() => {
    const q = query(
      collection(db, "simulation_positions"),
      orderBy("opened_at", "desc"),
      limit(50)
    );
    return onSnapshot(q, (snap) => {
      const all = snap.docs.map(d => ({ id: d.id, ...d.data() }));
      setOpenPos(all.filter(p => p.status === "OPEN"));
      setClosedPos(all.filter(p => p.status === "CLOSED"));
    });
  }, []);

  // signals
  useEffect(() => {
    const q = query(collection(db, "signals"), orderBy("timestamp", "desc"), limit(60));
    return onSnapshot(q, (snap) => {
      setSignals(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  // log
  useEffect(() => {
    const q = query(collection(db, "simulation_log"), orderBy("timestamp", "desc"), limit(80));
    return onSnapshot(q, (snap) => {
      setLogEvents(snap.docs.map(d => ({ id: d.id, ...d.data() })));
    });
  }, []);

  return (
    <div style={{
      minHeight: "100vh", background: BG,
      color: "#ccc", fontFamily: "'IBM Plex Mono', 'Fira Code', monospace",
      padding: "0 0 60px",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&display=swap');
        * { box-sizing: border-box; }
        body { margin: 0; }
        @keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
        ::-webkit-scrollbar { width: 5px; height: 5px; }
        ::-webkit-scrollbar-track { background: ${BG}; }
        ::-webkit-scrollbar-thumb { background: #1e2530; border-radius: 3px; }
      `}</style>

      {/* Navbar */}
      <div style={{
        borderBottom: `1px solid ${BORDER}`, padding: "14px 24px",
        display: "flex", alignItems: "center", gap: 10,
        background: CARD,
      }}>
        <span style={{ fontSize: 18 }}>📡</span>
        <div>
          <span style={{ color: "#fff", fontWeight: 800, fontSize: 14, letterSpacing: 2 }}>
            SIGNAL MONITOR
          </span>
          <span style={{ color: "#333", fontSize: 11, marginLeft: 12 }}>
            Telegram → Firebase · Simulation
          </span>
        </div>
        <div style={{ marginLeft: "auto", display: "flex", gap: 16, fontSize: 11, fontFamily: "monospace" }}>
          <span style={{ color: "#333" }}>
            Otwarte: <span style={{ color: BLUE }}>{openPos.length}</span>
          </span>
          <span style={{ color: "#333" }}>
            Sygnały: <span style={{ color: PURPLE }}>{signals.length}</span>
          </span>
        </div>
      </div>

      <div style={{ maxWidth: 960, margin: "0 auto", padding: "24px 16px" }}>
        <TabBar active={tab} onChange={setTab} />

        {/* ── PORTFOLIO TAB ── */}
        {tab === "portfolio" && (
          <>
            <PortfolioHeader portfolio={portfolio} />

            {/* Open positions quick view */}
            {openPos.length > 0 && (
              <div style={{
                background: CARD, border: `1px solid ${BORDER}`,
                borderRadius: 10, padding: "16px 20px", marginBottom: 20,
              }}>
                <div style={{ color: BLUE, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>
                  OTWARTE POZYCJE ({openPos.length})
                </div>
                <PositionsTable positions={openPos} />
              </div>
            )}

            {/* Recent closed */}
            {closedPos.length > 0 && (
              <div style={{
                background: CARD, border: `1px solid ${BORDER}`,
                borderRadius: 10, padding: "16px 20px",
              }}>
                <div style={{ color: PURPLE, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>
                  OSTATNIE ZAMKNIĘTE ({closedPos.length})
                </div>
                <ClosedTable positions={closedPos.slice(0, 5)} />
              </div>
            )}
          </>
        )}

        {/* ── OPEN POSITIONS TAB ── */}
        {tab === "open" && (
          <div style={{
            background: CARD, border: `1px solid ${BORDER}`,
            borderRadius: 10, padding: "16px 20px",
          }}>
            <div style={{ color: BLUE, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>
              OTWARTE POZYCJE ({openPos.length})
            </div>
            <PositionsTable positions={openPos} />
          </div>
        )}

        {/* ── CLOSED POSITIONS TAB ── */}
        {tab === "closed" && (
          <div style={{
            background: CARD, border: `1px solid ${BORDER}`,
            borderRadius: 10, padding: "16px 20px",
          }}>
            <div style={{ color: PURPLE, fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>
              ZAMKNIĘTE POZYCJE ({closedPos.length})
            </div>
            <ClosedTable positions={closedPos} />
          </div>
        )}

        {/* ── SIGNALS TAB ── */}
        {tab === "signals" && (
          <div>
            <div style={{ color: "#444", fontSize: 11, marginBottom: 14, letterSpacing: 2 }}>
              OSTATNIE SYGNAŁY ({signals.length})
            </div>
            {signals.map(s => <SignalCard key={s.id} signal={s} />)}
          </div>
        )}

        {/* ── LOG TAB ── */}
        {tab === "log" && (
          <div style={{
            background: CARD, border: `1px solid ${BORDER}`,
            borderRadius: 10, padding: "16px 20px",
          }}>
            <div style={{ color: "#444", fontSize: 11, letterSpacing: 2, marginBottom: 14 }}>
              LOG ZDARZEŃ ({logEvents.length})
            </div>
            <EventLog events={logEvents} />
          </div>
        )}
      </div>
    </div>
  );
}
