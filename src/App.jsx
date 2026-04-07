import { useState, useEffect, useRef, useCallback } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, query, orderBy,
  limit, onSnapshot, doc, setDoc, getDocs, updateDoc, getDoc,
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

const round2 = (n) => Math.round(n * 10000) / 10000;

// ─── Close position from frontend ─────────────────────────────────────────────
async function closePositionManually(positionId, currentPrice) {
  try {
    const posRef = doc(db, "simulation_positions", positionId);
    const posSnap = await getDoc(posRef);
    if (!posSnap.exists()) return;
    const pos = posSnap.data();
    if (pos.status !== "OPEN") return;

    const entry = pos.entry_price;
    const qty = pos.quantity_remaining || pos.quantity;
    const allocated = pos.allocated_usd;
    const isLong = ["LONG","SPOT_BUY"].includes(pos.signal_type);
    const pnl = isLong ? (currentPrice-entry)*qty : (entry-currentPrice)*qty;
    const totalPnl = round2((pos.realized_pnl||0) + pnl);
    const pnlPct = allocated ? round2((totalPnl/allocated)*100) : 0;
    const now = new Date().toISOString();

    await updateDoc(posRef, {
      status:"CLOSED", close_price:currentPrice, close_reason:"MANUAL_CLOSE",
      realized_pnl:totalPnl, realized_pnl_pct:pnlPct, unrealized_pnl:0, closed_at:now,
    });

    const portRef = doc(db,"simulation","portfolio");
    const portSnap = await getDoc(portRef);
    const port = portSnap.exists() ? portSnap.data() : {};
    const newCap = round2((port.current_capital||0) + allocated + pnl);
    const newReal = round2((port.realized_pnl||0) + pnl);
    const initial = port.initial_capital||500;
    await updateDoc(portRef, {
      current_capital:newCap, realized_pnl:newReal, total_pnl:newReal,
      total_pnl_pct:round2((newReal/initial)*100),
      wins: pnl>=0 ? (port.wins||0)+1 : (port.wins||0),
      losses: pnl<0 ? (port.losses||0)+1 : (port.losses||0),
    });

    await setDoc(doc(db,"simulation_log",Date.now().toString()),{
      event_type:"CLOSE", position_id:positionId, symbol:pos.symbol,
      signal_type:pos.signal_type, channel:pos.channel||"?",
      message:`Manual close @ ${currentPrice} | PnL: $${totalPnl}`,
      timestamp_iso:now,
    });
  } catch(e) {
    alert("Błąd zamykania: " + e.message);
  }
}

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n,d=2) => n!=null ? Number(n).toFixed(d) : "—";
const fmtK  = (n) => n!=null ? `$${Number(n).toFixed(2)}` : "—";
const pct   = (n) => n!=null ? `${Number(n).toFixed(2)}%` : "—";
const ago   = (ts) => {
  if(!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now()-d)/1000);
  if(s<60) return `${s}s temu`;
  if(s<3600) return `${Math.floor(s/60)}m temu`;
  if(s<86400) return `${Math.floor(s/3600)}h temu`;
  return d.toLocaleDateString("pl-PL");
};
const fmtDt = (ts) => {
  if(!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("pl-PL");
};

const GREEN="#00e5ff",RED="#ff5c7a",BLUE="#00e5ff",PURPLE="#c4b5fd",
      YELLOW="#ffe066",ORANGE="#ffb347",BG="#484862",CARD="#3a3a52",BORDER="#5c5c7a";

// ─── Inline channel rename ─────────────────────────────────────────────────────
function normalizeId(id) {
  // Try all variants: as-is, without leading minus, without -100 prefix
  return String(id||"");
}
// Fallback nazwy kanałów — gdy Firebase nie ma wpisu
const CHANNEL_FALLBACKS = {
  "1700533698":   "Crypto Bulls",
  "1982472141":   "Crypto BEAST",
  "1552004524":   "Crypto MONK",
  "1456872361":   "Predictum",
  "1553551852":   "Binance 360",
  "1756316676":   "Boom Boom",
  "1743387695":   "Crypto Hustle",
  "1652601224":   "Crypto World",
};

function lookupName(channelId, channelNames) {
  const id = String(channelId||"");
  const bare = id.replace(/^-100/, "");

  // 1. Sprawdź Firebase (wszystkie warianty)
  if (channelNames[id]) return channelNames[id];
  if (channelNames[bare]) return channelNames[bare];
  if (channelNames["-100"+bare]) return channelNames["-100"+bare];
  const mVariant = bare.replace(/^-/, "m");
  if (channelNames[mVariant]) return channelNames[mVariant];

  // 2. Fallback z hardcoded
  if (CHANNEL_FALLBACKS[bare]) return CHANNEL_FALLBACKS[bare];
  if (CHANNEL_FALLBACKS[id]) return CHANNEL_FALLBACKS[id];

  return id;
}

function ChannelTag({channelId, channelNames, onRename}) {
  const [editing, setEditing] = useState(false);
  const [val, setVal] = useState("");
  const inputRef = useRef(null);
  const name = lookupName(channelId, channelNames);

  const startEdit = (e) => {
    e.stopPropagation();
    setVal(name);
    setEditing(true);
    setTimeout(() => inputRef.current?.focus(), 50);
  };
  const save = async (e) => {
    e?.stopPropagation();
    if (val.trim()) await onRename(channelId, val.trim());
    setEditing(false);
  };
  const onKey = (e) => {
    e.stopPropagation();
    if (e.key === "Enter") save();
    if (e.key === "Escape") setEditing(false);
  };

  if (editing) return (
    <div style={{display:"flex",gap:4,alignItems:"center"}} onClick={e=>e.stopPropagation()}>
      <input ref={inputRef} value={val}
        onChange={e=>setVal(e.target.value)} onKeyDown={onKey}
        style={{background:"#2a2a42",border:`1px solid ${GREEN}`,borderRadius:4,
          padding:"2px 6px",color:"#fff",fontFamily:"monospace",fontSize:11,width:110}}/>
      <button onClick={save}
        style={{background:GREEN+"33",color:GREEN,border:`1px solid ${GREEN}55`,
          borderRadius:3,padding:"1px 6px",cursor:"pointer",fontSize:10,fontFamily:"monospace"}}>✓</button>
      <button onClick={e=>{e.stopPropagation();setEditing(false);}}
        style={{background:"transparent",color:"#888",border:"1px solid #5c5c7a",
          borderRadius:3,padding:"1px 6px",cursor:"pointer",fontSize:10,fontFamily:"monospace"}}>✕</button>
    </div>
  );

  return (
    <span onClick={startEdit} title="Kliknij aby zmienić nazwę" style={{
      color:PURPLE,fontSize:11,cursor:"pointer",borderBottom:`1px dashed ${PURPLE}55`,
      whiteSpace:"nowrap",maxWidth:120,overflow:"hidden",textOverflow:"ellipsis",display:"inline-block",
    }}>{name}</span>
  );
}

const Pill=({label,color=GREEN})=>(
  <span style={{background:color+"22",color,border:`1px solid ${color}44`,
    borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:1,fontFamily:"monospace"}}>
    {label}
  </span>
);

const StatCard=({label,value,sub,color="#fff"})=>(
  <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"14px 18px",minWidth:120}}>
    <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{label}</div>
    <div style={{color,fontFamily:"monospace",fontSize:22,fontWeight:800,lineHeight:1}}>{value}</div>
    {sub&&<div style={{color:"#a0a0c0",fontSize:11,marginTop:4}}>{sub}</div>}
  </div>
);

// ─── Portfolio Header ──────────────────────────────────────────────────────────
function PortfolioHeader({portfolio}){
  if(!portfolio) return <div style={{color:"#9898b8",padding:20,textAlign:"center"}}>Ładowanie...</div>;
  const pnl=portfolio.total_pnl??0,pnlPct=portfolio.total_pnl_pct??0;
  const capital=portfolio.current_capital??0,initial=portfolio.initial_capital??500;
  const wins=portfolio.wins??0,losses=portfolio.losses??0,total=portfolio.total_trades??0;
  const wr=total>0?((wins/total)*100).toFixed(0):0;
  const isPos=pnl>=0;
  return(
    <div style={{background:CARD,border:`1px solid ${isPos?GREEN+"50":RED+"50"}`,borderRadius:12,padding:"20px 24px",marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <span style={{fontSize:22}}>💼</span>
        <div>
          <div style={{color:"#fff",fontWeight:800,fontSize:15,letterSpacing:2}}>PORTFEL SYMULACJI</div>
          <div style={{color:"#9898b8",fontSize:11}}>Start: {fmtDt(portfolio.created_at)} · Kapitał: {fmtK(initial)}</div>
        </div>
        <div style={{marginLeft:"auto",display:"flex",alignItems:"center",gap:6}}>
          <span style={{width:8,height:8,borderRadius:"50%",background:GREEN,display:"inline-block",animation:"pulse 2s infinite"}}/>
          <span style={{color:GREEN,fontSize:12,fontFamily:"monospace"}}>DRY RUN · 3% / trade</span>
        </div>
      </div>
      <div style={{display:"flex",gap:12,flexWrap:"wrap"}}>
        <StatCard label="Wolny Kapitał" value={fmtK(capital)} color="#fff"/>
        <StatCard label="Całkowity P&L" value={`${isPos?"+":""}${fmtK(pnl)}`}
          sub={`${isPos?"▲":"▼"} ${pct(Math.abs(pnlPct))} od startu`} color={isPos?GREEN:RED}/>
        <StatCard label="Zyski / Straty" value={`${wins}W / ${losses}L`}
          sub={`Win rate: ${wr}%`} color={wins>=losses?GREEN:RED}/>
        <StatCard label="Trade'y" value={total} color={BLUE}/>
        <div style={{flex:1,minWidth:200,background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"14px 18px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,marginBottom:8}}>KAPITAŁ VS START</div>
          <div style={{background:"#2e2e46",borderRadius:4,height:8,overflow:"hidden"}}>
            <div style={{width:`${Math.min(Math.max((capital/initial)*100,0),200)}%`,height:"100%",
              background:isPos?`linear-gradient(90deg,${GREEN}80,${GREEN})`:`linear-gradient(90deg,${RED}80,${RED})`,
              borderRadius:4,transition:"width 1s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:11,fontFamily:"monospace"}}>
            <span style={{color:"#9898b8"}}>$0</span>
            <span style={{color:isPos?GREEN:RED}}>{fmtK(capital)}</span>
            <span style={{color:"#9898b8"}}>{fmtK(initial*2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Position Row — memoized to prevent collapse on re-render ─────────────────
const PositionRow = ({ pos, channelNames, onRename, onClose }) => {
  const pnl=pos.unrealized_pnl??0,pnlPct=pos.unrealized_pnl_pct??0;
  const isPos=pnl>=0,isLong=["LONG","SPOT_BUY"].includes(pos.signal_type);
  const accent=isLong?GREEN:RED;
  const tpsHit=pos.tps_hit?.length??0,tpsTotal=pos.take_profits?.length??0;
  const slMoved=pos.sl_moved_to_be;

  return(<>
    {/* Główny wiersz */}
    <tr style={{borderBottom:`1px solid ${BORDER}22`}}
      onMouseEnter={e=>e.currentTarget.style.background="#ffffff05"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
      <td style={{padding:"10px 10px",color:"#fff",fontWeight:700}}>
        <span style={{borderLeft:`3px solid ${accent}`,paddingLeft:8}}>{pos.symbol}</span>
      </td>
      <td style={{padding:"10px 10px"}}><Pill label={pos.signal_type} color={accent}/></td>
      <td style={{padding:"10px 10px",color:"#b8b8d0"}}>${fmt(pos.entry_price,4)}</td>
      <td style={{padding:"10px 10px",color:isPos?GREEN:RED,fontWeight:600}}>${fmt(pos.current_price,4)}</td>
      <td style={{padding:"10px 10px"}}>
        <span style={{color:RED+"cc"}}>{pos.stop_loss?`$${fmt(pos.stop_loss,4)}`:"—"}</span>
        {slMoved&&<span style={{color:YELLOW,fontSize:10,marginLeft:4}}>BE</span>}
      </td>
      <td style={{padding:"10px 10px"}}>
        {tpsTotal>0
          ?<span style={{color:tpsHit>0?GREEN:"#7878a0"}}>{tpsHit}/{tpsTotal}</span>
          :<span style={{color:"#7878a0"}}>—</span>}
      </td>
      <td style={{padding:"10px 10px",color:"#a8a8c8"}}>
        {fmtK(pos.allocated_usd)}
        {pos.leverage>1&&<span style={{color:YELLOW,marginLeft:4}}>x{pos.leverage}</span>}
      </td>
      <td style={{padding:"10px 10px"}}>
        <span style={{color:isPos?GREEN:RED,fontWeight:700}}>{isPos?"+":""}{fmtK(pnl)}</span>
        <span style={{color:isPos?GREEN+"88":RED+"88",marginLeft:6,fontSize:11}}>({isPos?"+":""}{pct(pnlPct)})</span>
      </td>
      <td style={{padding:"10px 10px"}}>
        <ChannelTag channelId={pos.channel} channelNames={channelNames} onRename={onRename}/>
      </td>
      <td style={{padding:"10px 10px",color:"#9898b8",fontSize:11}}>{ago(pos.opened_at)}</td>
      <td style={{padding:"10px 10px"}}>
        <button onClick={()=>{
          if(window.confirm(`Zamknąć ${pos.symbol} @ $${pos.current_price}?`))
            onClose(pos.id, pos.current_price||pos.entry_price);
        }} style={{background:RED+"22",color:RED,border:`1px solid ${RED}44`,
          borderRadius:4,padding:"3px 10px",cursor:"pointer",fontSize:10,
          fontFamily:"monospace",whiteSpace:"nowrap"}}>✕ Zamknij</button>
      </td>
    </tr>
    {/* Panel szczegółów — zawsze widoczny */}
    <tr>
      <td colSpan={11} style={{padding:"0 10px 10px 10px",background:"#2e2e46"}}>
        <div style={{
          padding:"10px 14px",borderRadius:6,
          border:`1px solid ${accent}22`,
          display:"flex",gap:28,flexWrap:"wrap",
        }}>
          {/* TAKE PROFITS */}
          <div>
            <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:6}}>
              TAKE PROFITS
              {tpsTotal>0&&<span style={{color:tpsHit>0?GREEN:"#7878a0",marginLeft:6}}>({tpsHit}/{tpsTotal})</span>}
            </div>
            {pos.take_profits?.length?(
              <div style={{display:"flex",flexDirection:"column",gap:3}}>
                {pos.take_profits.map(tp=>{
                  const hit=pos.tps_hit?.includes(tp.level);
                  return(
                    <div key={tp.level} style={{
                      color:hit?GREEN:"#7878a0",
                      fontSize:12,fontFamily:"monospace",
                    }}>
                      {hit?"✓":"○"} TP{tp.level}: ${fmt(tp.price,4)}
                      {tp.close_pct&&tp.close_pct!==50&&(
                        <span style={{color:hit?GREEN+"88":"#5a5a7a",fontSize:10,marginLeft:6}}>
                          ({tp.close_pct}%)
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ):<span style={{color:"#7878a0",fontSize:12}}>Brak TP</span>}
          </div>

          {/* STOP LOSS */}
          <div>
            <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:6}}>STOP LOSS</div>
            <div style={{color:RED+"cc",fontFamily:"monospace",fontSize:13,fontWeight:600}}>
              {pos.stop_loss?`$${fmt(pos.stop_loss,4)}`:"—"}
              {slMoved&&<span style={{color:YELLOW,fontSize:11,marginLeft:8}}>● BE</span>}
            </div>
            {pos.original_stop_loss&&slMoved&&(
              <div style={{color:"#7878a0",fontSize:10,marginTop:2}}>
                Orig: ${fmt(pos.original_stop_loss,4)}
              </div>
            )}
          </div>

          {/* PARTIAL CLOSES */}
          {pos.partial_closes?.length>0&&(
            <div>
              <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:6}}>CZĘŚCIOWE ZAMKNIĘCIA</div>
              {pos.partial_closes.map((pc,i)=>(
                <div key={i} style={{color:GREEN,fontSize:11,fontFamily:"monospace"}}>
                  TP{pc.tp_level}: +${fmt(pc.pnl,2)} @ ${fmt(pc.price,4)}
                </div>
              ))}
            </div>
          )}

          {/* SZCZEGÓŁY */}
          <div>
            <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:6}}>SZCZEGÓŁY</div>
            <div style={{color:"#a0a0c0",fontSize:11,fontFamily:"monospace"}}>Qty: {fmt(pos.quantity_remaining||pos.quantity,6)}</div>
            <div style={{color:"#a0a0c0",fontSize:11,fontFamily:"monospace"}}>Ryzyko: {pos.risk_pct}%</div>
            <div style={{color:"#a0a0c0",fontSize:11,fontFamily:"monospace"}}>Typ: {pos.entry_type}</div>
          </div>

          {/* OTWARTO */}
          <div>
            <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:6}}>OTWARTO</div>
            <div style={{color:"#a0a0c0",fontSize:11,fontFamily:"monospace"}}>{fmtDt(pos.opened_at)}</div>
          </div>
        </div>
      </td>
    </tr>
  </>);
};

// ─── Positions Table ───────────────────────────────────────────────────────────
function PositionsTable({positions,channelNames,onRename,onClose}){
  if(!positions.length) return(
    <div style={{color:"#7878a0",padding:30,textAlign:"center",fontSize:13}}>Brak pozycji</div>
  );
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:12}}>
        <thead>
          <tr style={{borderBottom:`1px solid ${BORDER}`}}>
            {["Symbol","Typ","Entry","Aktualnie","SL","TP","Alloc.","Unrealized P&L","Kanał","Otwarto",""].map(h=>(
              <th key={h} style={{color:"#9898b8",fontSize:10,letterSpacing:1,padding:"8px 10px",
                textAlign:"left",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(pos=>(
            <PositionRow key={pos.id} pos={pos} channelNames={channelNames}
              onRename={onRename} onClose={onClose}/>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Closed Positions ──────────────────────────────────────────────────────────
function ClosedTable({positions,channelNames,onRename}){
  if(!positions.length) return <div style={{color:"#7878a0",textAlign:"center",padding:20,fontSize:13}}>Brak zamkniętych</div>;
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:12}}>
        <thead>
          <tr style={{borderBottom:`1px solid ${BORDER}`}}>
            {["Symbol","Typ","Entry","Exit","P&L $","P&L %","Powód","Kanał","Czas"].map(h=>(
              <th key={h} style={{color:"#9898b8",fontSize:10,letterSpacing:1,padding:"8px 10px",
                textAlign:"left",textTransform:"uppercase"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(pos=>{
            const pnl=pos.realized_pnl??0,pnlPct=pos.realized_pnl_pct??0;
            const isPos=pnl>=0,isLong=["LONG","SPOT_BUY"].includes(pos.signal_type);
            return(
              <tr key={pos.id} style={{borderBottom:`1px solid ${BORDER}22`}}
                onMouseEnter={e=>e.currentTarget.style.background="#ffffff05"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"8px 10px",color:"#e8e8f0",fontWeight:600}}>{pos.symbol}</td>
                <td style={{padding:"8px 10px"}}><Pill label={pos.signal_type} color={isLong?GREEN:RED}/></td>
                <td style={{padding:"8px 10px",color:"#a0a0c0"}}>${fmt(pos.entry_price,4)}</td>
                <td style={{padding:"8px 10px",color:"#a0a0c0"}}>${fmt(pos.close_price,4)}</td>
                <td style={{padding:"8px 10px",fontWeight:700,color:isPos?GREEN:RED}}>{isPos?"+":""}{fmtK(pnl)}</td>
                <td style={{padding:"8px 10px",color:isPos?GREEN+"99":RED+"99"}}>{isPos?"+":""}{pct(pnlPct)}</td>
                <td style={{padding:"8px 10px"}}>
                  <Pill label={pos.close_reason||"?"} color={pos.close_reason?.includes("TP")?GREEN:pos.close_reason==="SL_HIT"?RED:"#888"}/>
                </td>
                <td style={{padding:"8px 10px"}} onClick={e=>e.stopPropagation()}>
                  <ChannelTag channelId={pos.channel} channelNames={channelNames} onRename={onRename}/>
                </td>
                <td style={{padding:"8px 10px",color:"#9898b8",fontSize:11}}>{ago(pos.closed_at)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Channel Stats ─────────────────────────────────────────────────────────────
function ChannelStats({channelStats,channelNames,onRename}){
  if(!channelStats.length) return(
    <div style={{color:"#7878a0",padding:40,textAlign:"center",fontSize:13}}>
      Brak danych — pojawią się po zamknięciu pierwszych pozycji
    </div>
  );
  return(
    <div>
      <div style={{color:"#9898b8",fontSize:11,letterSpacing:2,marginBottom:16}}>RANKING KANAŁÓW</div>
      {[...channelStats].sort((a,b)=>(b.total_pnl||0)-(a.total_pnl||0)).map(ch=>{
        const isPos=(ch.total_pnl||0)>=0,wr=ch.win_rate||0;
        const wrColor=wr>=60?GREEN:wr>=40?YELLOW:RED;
        const chId=ch.channel||"?";
        return(
          <div key={ch.id||chId} style={{
            background:CARD,border:`1px solid ${isPos?GREEN+"25":RED+"25"}`,
            borderLeft:`3px solid ${isPos?GREEN:RED}`,
            borderRadius:8,padding:"16px 20px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
              <ChannelTag channelId={chId} channelNames={channelNames} onRename={onRename}/>
              <span style={{color:"#9898b8",fontSize:11}}>({chId})</span>
              <span style={{marginLeft:"auto",color:isPos?GREEN:RED,fontFamily:"monospace",fontWeight:700,fontSize:16}}>
                {isPos?"+":""}{fmtK(ch.total_pnl)}
              </span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:10}}>
              {[
                {l:"Win Rate",v:`${wr}%`,c:wrColor},
                {l:"Trades",v:ch.total_trades||0,c:BLUE},
                {l:"Wins",v:ch.wins||0,c:GREEN},
                {l:"Losses",v:ch.losses||0,c:RED},
                {l:"SL trafione",v:ch.sl_hits||0,c:RED},
                {l:"TP trafione",v:ch.tp_hits||0,c:GREEN},
                {l:"Avg P&L",v:fmtK(ch.avg_pnl),c:isPos?GREEN:RED},
                {l:"Najlepszy",v:fmtK(ch.best_trade),c:GREEN},
                {l:"Najgorszy",v:fmtK(ch.worst_trade),c:RED},
              ].map(s=>(
                <div key={s.l}>
                  <div style={{color:"#9898b8",fontSize:9,letterSpacing:1,textTransform:"uppercase"}}>{s.l}</div>
                  <div style={{color:s.c,fontFamily:"monospace",fontSize:13,fontWeight:600}}>{s.v}</div>
                </div>
              ))}
            </div>
            <div style={{marginTop:10,padding:"6px 12px",borderRadius:6,
              background:wr>=55&&isPos?GREEN+"15":wr<40||!isPos?RED+"15":YELLOW+"15",
              border:`1px solid ${wr>=55&&isPos?GREEN+"30":wr<40||!isPos?RED+"30":YELLOW+"30"}`,
              fontSize:11,color:wr>=55&&isPos?GREEN:wr<40||!isPos?RED:YELLOW}}>
              {wr>=55&&isPos?"✅ Warto kopiować":wr<40||!isPos?"❌ Słabe wyniki — rozważ usunięcie":"⚠ Neutralne — obserwuj dalej"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Signal Card ───────────────────────────────────────────────────────────────
function SignalCard({signal,channelNames,onRename}){
  const [expanded,setExpanded]=useState(false);
  const isLong=signal.signal_type==="LONG",isShort=signal.signal_type==="SHORT";
  const accent=isLong?GREEN:isShort?RED:BLUE;
  return(
    <div onClick={()=>setExpanded(p=>!p)} style={{
      background:CARD,border:`1px solid ${accent}22`,borderLeft:`3px solid ${accent}`,
      borderRadius:8,padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{color:"#fff",fontWeight:700,fontFamily:"monospace",fontSize:13}}>{signal.symbol||"???"}</span>
        <Pill label={signal.signal_type||"?"} color={accent}/>
        <span style={{color:"#7878a0",fontSize:10,fontFamily:"monospace"}}>[{signal.entry_type||"?"}]</span>
        <span style={{marginLeft:"auto",color:"#7878a0",fontSize:11}}>{ago(signal.timestamp)}</span>
        <span onClick={e=>e.stopPropagation()}>
          <ChannelTag channelId={signal.channel} channelNames={channelNames} onRename={onRename}/>
        </span>
      </div>
      <div style={{display:"flex",gap:16,marginTop:8,flexWrap:"wrap"}}>
        <span style={{color:"#a8a8c8",fontSize:11}}>Entry: <span style={{color:accent}}>
          {signal.entry_range?`$${fmt(signal.entry_range.min,4)}–$${fmt(signal.entry_range.max,4)}`:
           signal.entry_price?`$${fmt(signal.entry_price,4)}`:"—"}
        </span></span>
        <span style={{color:"#a8a8c8",fontSize:11}}>SL: <span style={{color:RED+"cc"}}>{signal.stop_loss?`$${fmt(signal.stop_loss,4)}`:"—"}</span></span>
        {signal.leverage&&<span style={{color:"#a8a8c8",fontSize:11}}>Dźwignia: <span style={{color:YELLOW}}>{signal.leverage}x</span></span>}
        {signal.take_profits?.length>0&&<span style={{color:"#a8a8c8",fontSize:11}}>TPs: <span style={{color:GREEN}}>{signal.take_profits.length}</span></span>}
      </div>
      {expanded&&(
        <div style={{marginTop:10,borderTop:`1px solid ${BORDER}`,paddingTop:10}}>
          {signal.take_profits?.length>0&&(
            <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:8}}>
              {signal.take_profits.map(tp=>(
                <span key={tp.level} style={{background:GREEN+"15",color:GREEN+"cc",
                  border:`1px solid ${GREEN}30`,borderRadius:4,padding:"1px 7px",fontSize:11,fontFamily:"monospace"}}>
                  TP{tp.level}: ${fmt(tp.price,4)}
                </span>
              ))}
            </div>
          )}
          <pre style={{background:"#2a2a40",color:"#9898b8",padding:10,borderRadius:6,fontSize:10,
            whiteSpace:"pre-wrap",wordBreak:"break-word",border:`1px solid ${BORDER}`,maxHeight:160,overflow:"auto",margin:0}}>
            {signal.raw_message}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Event Log ─────────────────────────────────────────────────────────────────
function EventLog({events,channelNames,onRename}){
  const colorMap={OPEN:BLUE,CLOSE:PURPLE,TP_PARTIAL:GREEN,SL_TO_BE:YELLOW,UPDATE:YELLOW};
  if(!events.length) return <div style={{color:"#7878a0",textAlign:"center",padding:30}}>Log pusty</div>;
  return events.map(e=>(
    <div key={e.id} style={{display:"flex",gap:10,alignItems:"center",
      padding:"8px 0",borderBottom:`1px solid ${BORDER}22`,fontSize:12,flexWrap:"wrap"}}>
      <Pill label={e.event_type} color={colorMap[e.event_type]||"#888"}/>
      <span style={{color:"#fff",fontFamily:"monospace",fontWeight:600,minWidth:80}}>{e.symbol}</span>
      <span onClick={e2=>e2.stopPropagation()}>
        <ChannelTag channelId={e.channel} channelNames={channelNames} onRename={onRename}/>
      </span>
      <span style={{color:"#a0a0c0",flex:1}}>{e.message}</span>
      <span style={{color:"#7878a0",fontSize:11,whiteSpace:"nowrap"}}>{ago(e.timestamp)}</span>
    </div>
  ));
}


// ─── Bot Health Dashboard ──────────────────────────────────────────────────────
function StatusDot({status}) {
  const colors = {
    ok: "#00e5ff",
    error: "#ff5c7a",
    warning: "#ffe066",
    rate_limited: "#ff9f43",
    starting: "#9898b8",
    no_handler: "#ffe066",
  };
  const labels = {
    ok: "OK", error: "BŁĄD", warning: "UWAGA",
    rate_limited: "LIMIT", starting: "START", no_handler: "BRAK HANDLERA",
  };
  const c = colors[status] || "#9898b8";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
      <span style={{
        width:9,height:9,borderRadius:"50%",background:c,
        boxShadow:`0 0 6px ${c}`,display:"inline-block",
        animation: status==="ok" ? "pulse 2s infinite" : "none",
      }}/>
      <span style={{color:c,fontSize:11,fontFamily:"monospace",fontWeight:700}}>
        {labels[status]||status}
      </span>
    </span>
  );
}

function HealthRow({label, status, detail, last_ok}) {
  return (
    <div style={{
      display:"flex",alignItems:"center",gap:12,
      padding:"8px 12px",borderBottom:`1px solid #5c5c7a22`,
      flexWrap:"wrap",
    }}>
      <span style={{color:"#e8e8f0",fontFamily:"monospace",fontSize:12,minWidth:160}}>{label}</span>
      <StatusDot status={status}/>
      {detail && <span style={{color:"#ff5c7a",fontSize:11,flex:1}}>{detail}</span>}
      {last_ok && !detail && (
        <span style={{color:"#7878a0",fontSize:10,marginLeft:"auto"}}>
          ostatni OK: {new Date(last_ok).toLocaleTimeString("pl-PL")}
        </span>
      )}
    </div>
  );
}

function BotHealthDashboard({health, channelNames, openPos}) {
  if (!health) return (
    <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:30,textAlign:"center"}}>
      <div style={{color:"#7878a0",fontSize:13}}>Brak danych health — bot musi działać min. 1 minutę</div>
    </div>
  );

  const overall = health.overall_status;
  const overallColor = overall==="ok"?GREEN:overall==="warning"?YELLOW:RED;
  const ts = health.timestamp_iso ? new Date(health.timestamp_iso) : null;
  const secondsAgo = ts ? Math.floor((Date.now()-ts)/1000) : null;
  const isStale = secondsAgo > 120; // brak heartbeat > 2 minuty = problem

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Główny status */}
      <div style={{
        background:CARD,
        border:`2px solid ${isStale?RED:overallColor}55`,
        borderRadius:10,padding:"16px 20px",
      }}>
        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <span style={{fontSize:24}}>{overall==="ok"?"🟢":overall==="warning"?"🟡":"🔴"}</span>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:15,letterSpacing:2}}>
              STATUS BOTA
            </div>
            <div style={{color:"#9898b8",fontSize:11}}>
              Uptime: <span style={{color:GREEN}}>{health.uptime||"—"}</span>
              {" · "}
              Heartbeat: <span style={{color:isStale?RED:GREEN}}>
                {secondsAgo!=null ? `${secondsAgo}s temu` : "—"}
              </span>
              {isStale && <span style={{color:RED,marginLeft:8}}>⚠ BOT MOŻE BYĆ ZAWIESZONY!</span>}
            </div>
          </div>
          <div style={{marginLeft:"auto"}}>
            <StatusDot status={isStale?"error":overall}/>
          </div>
        </div>
      </div>

      {/* Komponenty */}
      <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,overflow:"hidden"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,padding:"10px 12px",
          borderBottom:`1px solid ${BORDER}`}}>KOMPONENTY</div>
        <HealthRow label="📡 Telegram" status={health.telegram_status||"unknown"}
          detail={health.telegram_error} last_ok={health.telegram_last_ok}/>
        <HealthRow label="🤖 Groq AI"
          status={health.groq_rate_limited?"rate_limited":(health.groq_status||"unknown")}
          detail={health.groq_rate_limited
            ? `LIMIT TOKENÓW: ${health.groq_error?.substring(0,80)||""}...`
            : health.groq_error}
          last_ok={health.groq_last_ok}/>
        <HealthRow label="🔥 Firebase" status={health.firebase_status||"unknown"}/>
        <HealthRow label="💹 Price Updater" status={health.price_updater_status||"unknown"}
          last_ok={health.price_updater_last_ok}/>
      </div>

      {/* Kanały */}
      <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,overflow:"hidden"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,padding:"10px 12px",
          borderBottom:`1px solid ${BORDER}`}}>KANAŁY TELEGRAM</div>
        {health.channels && Object.entries(health.channels).map(([id, ch])=>{
          const name = channelNames[id] || ch.name || id;
          const lastMsg = ch.last_message
            ? Math.floor((Date.now()-new Date(ch.last_message))/1000)
            : null;
          return (
            <div key={id} style={{
              display:"flex",alignItems:"center",gap:12,
              padding:"8px 12px",borderBottom:`1px solid #5c5c7a22`,flexWrap:"wrap",
            }}>
              <span style={{color:"#e8e8f0",fontFamily:"monospace",fontSize:12,minWidth:160}}>
                {name}
              </span>
              <StatusDot status={ch.status||"unknown"}/>
              {ch.error && <span style={{color:RED,fontSize:11}}>{ch.error}</span>}
              <span style={{marginLeft:"auto",color:"#7878a0",fontSize:10}}>
                {lastMsg!=null
                  ? lastMsg < 3600
                    ? `ostatnia wiad. ${lastMsg < 60 ? lastMsg+"s" : Math.floor(lastMsg/60)+"m"} temu`
                    : `ostatnia wiad. ${Math.floor(lastMsg/3600)}h temu`
                  : "brak wiadomości"}
              </span>
            </div>
          );
        })}
        {(!health.channels || Object.keys(health.channels).length===0) && (
          <div style={{color:"#7878a0",padding:20,textAlign:"center",fontSize:12}}>
            Brak danych o kanałach
          </div>
        )}
      </div>

      {/* Statystyki */}
      <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"16px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,marginBottom:14}}>STATYSTYKI SESJI</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",gap:12}}>
          {[
            {l:"Wiadomości",v:health.messages_received||0,c:"#e8e8f0"},
            {l:"Sygnały złapane",v:health.signals_parsed||0,c:GREEN},
            {l:"Odrzucone",v:health.signals_rejected||0,c:"#7878a0"},
            {l:"Groq wywołania",v:health.groq_calls||0,c:BLUE},
            {l:"Groq błędy",v:health.groq_errors||0,c:health.groq_errors>0?RED:"#7878a0"},
            {l:"Aktualizacje cen",v:health.price_updates||0,c:PURPLE},
            {l:"Otwarte pozycje",v:health.positions_open||0,c:YELLOW},
          ].map(s=>(
            <div key={s.l}>
              <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:3}}>{s.l}</div>
              <div style={{color:s.c,fontFamily:"monospace",fontSize:18,fontWeight:700}}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Nazwy kanałów debug */}
      <details style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"12px 16px"}}>
        <summary style={{color:"#9898b8",fontSize:11,cursor:"pointer",letterSpacing:1}}>
          🔧 DEBUG — MAPOWANIE NAZW KANAŁÓW ({Object.keys(channelNames).length} wpisów)
        </summary>
        <div style={{marginTop:10,fontFamily:"monospace",fontSize:11}}>
          {Object.entries(channelNames).map(([k,v])=>(
            <div key={k} style={{padding:"2px 0",color:"#7878a0"}}>
              <span style={{color:"#9898b8"}}>{k}</span>
              <span style={{color:"#5c5c7a"}}> → </span>
              <span style={{color:GREEN}}>{v}</span>
            </div>
          ))}
          <div style={{marginTop:10,color:"#9898b8",borderTop:`1px solid ${BORDER}`,paddingTop:8}}>
            ID w pozycjach:
          </div>
          {openPos.map(p=>(
            <div key={p.id} style={{padding:"2px 0"}}>
              <span style={{color:BLUE}}>{p.symbol}</span>
              <span style={{color:"#5c5c7a"}}> ch: </span>
              <span style={{color:ORANGE}}>"{p.channel}"</span>
              <span style={{color:"#5c5c7a"}}> → </span>
              <span style={{color:GREEN}}>"{lookupName(p.channel, channelNames)}"</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

// ─── Tab Bar ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:"portfolio",label:"📊 Portfolio"},
  {id:"open",label:"🔓 Otwarte"},
  {id:"closed",label:"🔒 Zamknięte"},
  {id:"channels",label:"📈 Kanały"},
  {id:"signals",label:"📡 Sygnały"},
  {id:"log",label:"📝 Log"},
  {id:"debug",label:"🔧 Debug"},
];

function TabBar({active,onChange}){
  return(
    <div style={{display:"flex",gap:2,borderBottom:`1px solid ${BORDER}`,marginBottom:20,overflowX:"auto"}}>
      {TABS.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)} style={{
          background:active===t.id?BLUE+"20":"transparent",
          color:active===t.id?GREEN:"#ffffff",
          border:"none",
          borderBottom:active===t.id?`2px solid ${GREEN}`:"2px solid transparent",
          padding:"10px 18px",cursor:"pointer",fontFamily:"monospace",
          fontSize:12,fontWeight:active===t.id?700:500,whiteSpace:"nowrap",
          transition:"all 0.15s",
        }}>
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Main App ──────────────────────────────────────────────────────────────────
export default function App(){
  const [tab,setTab]=useState("portfolio");
  const [portfolio,setPortfolio]=useState(null);
  const [openPos,setOpenPos]=useState([]);
  const [closedPos,setClosedPos]=useState([]);
  const [signals,setSignals]=useState([]);
  const [logEvents,setLogEvents]=useState([]);
  const [channelStats,setChannelStats]=useState([]);
  const [channelNames,setChannelNames]=useState({});

  // Load channel names from Firebase
  const loadChannelNames = useCallback(async()=>{
    try{
      const snap=await getDocs(collection(db,"channel_names"));
      const names={};
      snap.forEach(d=>{
        const data=d.data();
        const name=data.name;
        if(!name) return;
        // Store under all possible variants
        const bare = String(data.channel||"").replace(/^-100/,"");
        names[bare] = name;                    // e.g. 1553551852
        names["-100"+bare] = name;             // e.g. -1001553551852
        names[d.id] = name;                    // Firebase doc ID
        if(data.channel) names[data.channel]=name;
        if(data.channel_full) names[data.channel_full]=name;
      });
      setChannelNames(names);
    }catch(e){console.error(e);}
  },[]);

  useEffect(()=>{ loadChannelNames(); },[]);

  const handleRename = useCallback(async(channelId,newName)=>{
    const id = String(channelId);
    const without100 = id.replace(/^-100/, "");
    const docId = without100.replace(/-/g,"m");
    // Save with the bare ID (without -100) as the key
    await setDoc(doc(db,"channel_names",docId),{
      name:newName,
      channel: without100,
      channel_full: id,
      updated_at:new Date().toISOString()
    },{merge:true});
    // Update local state for all variants
    setChannelNames(prev=>({
      ...prev,
      [id]:newName,
      [without100]:newName,
      [docId]:newName,
      ["-100"+without100]:newName,
    }));
  },[]);

  // Firebase listeners — use refs to keep stable data
  useEffect(()=>onSnapshot(doc(db,"simulation","portfolio"),snap=>{
    if(snap.exists()) setPortfolio(snap.data());
  }),[]);

  useEffect(()=>{
    const q=query(collection(db,"simulation_positions"),orderBy("opened_at","desc"),limit(100));
    return onSnapshot(q,snap=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}));
      // Use functional updates to avoid triggering child re-renders unnecessarily
      setOpenPos(all.filter(p=>p.status==="OPEN"));
      setClosedPos(all.filter(p=>p.status==="CLOSED"));
    });
  },[]);

  useEffect(()=>{
    const q=query(collection(db,"signals"),orderBy("timestamp","desc"),limit(80));
    return onSnapshot(q,snap=>setSignals(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  useEffect(()=>{
    const q=query(collection(db,"simulation_log"),orderBy("timestamp","desc"),limit(100));
    return onSnapshot(q,snap=>setLogEvents(snap.docs.map(d=>({id:d.id,...d.data()}))));
  },[]);

  useEffect(()=>{
    return onSnapshot(collection(db,"channel_stats"),snap=>{
      setChannelStats(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
  },[]);

  const [health, setHealth] = useState(null);
  useEffect(()=>{
    return onSnapshot(doc(db,"bot_health","status"), snap=>{
      if(snap.exists()) setHealth(snap.data());
    });
  },[]);

  const Card=({children,color,title,count})=>(
    <div style={{background:CARD,border:`1px solid ${color||BORDER}`,borderRadius:10,padding:"16px 20px",marginBottom:20}}>
      {title&&<div style={{color:color||"#9898b8",fontSize:11,letterSpacing:2,marginBottom:14,fontFamily:"monospace"}}>
        {title}{count!=null&&` (${count})`}
      </div>}
      {children}
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:BG,color:"#e8e8f0",fontFamily:"'IBM Plex Mono','Fira Code',monospace",padding:"0 0 60px"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;} body{margin:0;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:${BG};}
        ::-webkit-scrollbar-thumb{background:#5c5c7a;border-radius:3px;}
        input:focus{outline:none;}
        button:hover{opacity:0.85;}
      `}</style>

      {/* Navbar */}
      <div style={{borderBottom:`1px solid ${BORDER}`,padding:"14px 24px",
        display:"flex",alignItems:"center",gap:10,background:CARD}}>
        <span style={{fontSize:18}}>📡</span>
        <div>
          <span style={{color:"#fff",fontWeight:800,fontSize:14,letterSpacing:2}}>SIGNAL MONITOR</span>
          <span style={{color:"#9898b8",fontSize:11,marginLeft:12}}>Telegram → Firebase · $500 · 3% / trade</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:16,fontSize:11,fontFamily:"monospace"}}>
          <span style={{color:"#b8b8d0"}}>Otwarte: <span style={{color:GREEN}}>{openPos.length}</span></span>
          <span style={{color:"#b8b8d0"}}>Sygnały: <span style={{color:PURPLE}}>{signals.length}</span></span>
          <span style={{color:"#b8b8d0"}}>Kanały: <span style={{color:ORANGE}}>{channelStats.length}</span></span>
          <span style={{color:"#b8b8d0"}}>Nazwy: <span style={{color:YELLOW}}>{Object.keys(channelNames).length}</span></span>
        </div>
      </div>

      <div style={{maxWidth:1200,margin:"0 auto",padding:"24px 16px"}}>
        <TabBar active={tab} onChange={setTab}/>

        {tab==="portfolio"&&(<>
          <PortfolioHeader portfolio={portfolio}/>
          {openPos.length>0&&<Card color={BLUE} title="OTWARTE POZYCJE" count={openPos.length}>
            <PositionsTable positions={openPos} channelNames={channelNames}
              onRename={handleRename} onClose={closePositionManually}/>
          </Card>}
          {closedPos.length>0&&<Card color={PURPLE} title="OSTATNIE ZAMKNIĘTE">
            <ClosedTable positions={closedPos.slice(0,5)} channelNames={channelNames} onRename={handleRename}/>
          </Card>}
        </>)}

        {tab==="open"&&<Card color={BLUE} title="OTWARTE POZYCJE" count={openPos.length}>
          <PositionsTable positions={openPos} channelNames={channelNames}
            onRename={handleRename} onClose={closePositionManually}/>
        </Card>}

        {tab==="closed"&&<Card color={PURPLE} title="ZAMKNIĘTE POZYCJE" count={closedPos.length}>
          <ClosedTable positions={closedPos} channelNames={channelNames} onRename={handleRename}/>
        </Card>}

        {tab==="channels"&&<Card color={ORANGE} title="STATYSTYKI KANAŁÓW">
          <ChannelStats channelStats={channelStats} channelNames={channelNames} onRename={handleRename}/>
        </Card>}

        {tab==="signals"&&<div>
          <div style={{color:"#9898b8",fontSize:11,marginBottom:14,letterSpacing:2}}>SYGNAŁY ({signals.length})</div>
          {signals.map(s=><SignalCard key={s.id} signal={s} channelNames={channelNames} onRename={handleRename}/>)}
        </div>}

        {tab==="log"&&<Card color="#9898b8" title="LOG ZDARZEŃ" count={logEvents.length}>
          <EventLog events={logEvents} channelNames={channelNames} onRename={handleRename}/>
        </Card>}

        {tab==="debug"&&<BotHealthDashboard health={health} channelNames={channelNames} openPos={openPos}/>}
      </div>
    </div>
  );
}
