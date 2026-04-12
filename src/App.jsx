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
    ok:"#00e5ff", error:"#ff5c7a", warning:"#ffe066",
    rate_limited:"#ff9f43", starting:"#9898b8", no_handler:"#ffe066",
  };
  const labels = {
    ok:"OK", error:"BŁĄD", warning:"UWAGA",
    rate_limited:"LIMIT", starting:"START", no_handler:"BRAK HANDLERA",
  };
  const c = colors[status]||"#9898b8";
  return (
    <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
      <span style={{width:9,height:9,borderRadius:"50%",background:c,
        boxShadow:`0 0 6px ${c}`,display:"inline-block",
        animation:status==="ok"?"pulse 2s infinite":"none"}}/>
      <span style={{color:c,fontSize:11,fontFamily:"monospace",fontWeight:700}}>
        {labels[status]||status}
      </span>
    </span>
  );
}

function HealthRow({label, status, detail, last_ok}) {
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,
      padding:"8px 12px",borderBottom:`1px solid #5c5c7a22`,flexWrap:"wrap"}}>
      <span style={{color:"#e8e8f0",fontFamily:"monospace",fontSize:12,minWidth:160}}>{label}</span>
      <StatusDot status={status}/>
      {detail&&<span style={{color:"#ff5c7a",fontSize:11,flex:1,wordBreak:"break-all"}}>{detail}</span>}
      {last_ok&&!detail&&(
        <span style={{color:"#7878a0",fontSize:10,marginLeft:"auto"}}>
          ostatni OK: {new Date(last_ok).toLocaleTimeString("pl-PL")}
        </span>
      )}
    </div>
  );
}

function EventFeed({events}) {
  const icons = {
    signal:"📡", rejected:"✗", prefilter:"⏭", error:"❌",
    rate_limit:"⚠", position_open:"🔓", tp_hit:"🎯", sl_hit:"🛑",
  };
  const colors = {
    success:"#00e5ff", error:"#ff5c7a", warning:"#ffe066",
    muted:"#5a5a7a", info:"#a0a0c0",
  };
  if (!events||!events.length) return (
    <div style={{color:"#7878a0",padding:"12px",fontSize:12}}>Brak zdarzeń w tej sesji</div>
  );
  return (
    <div style={{maxHeight:280,overflowY:"auto"}}>
      {events.map((e,i)=>{
        const c = colors[e.level]||"#a0a0c0";
        const ts = new Date(e.timestamp).toLocaleTimeString("pl-PL");
        return (
          <div key={i} style={{display:"flex",alignItems:"center",gap:8,
            padding:"5px 12px",borderBottom:`1px solid #5c5c7a15`,
            background:i===0?"#3a3a5210":"transparent"}}>
            <span style={{fontSize:13}}>{icons[e.type]||"•"}</span>
            <span style={{color:c,fontFamily:"monospace",fontSize:12,flex:1}}>
              {e.message}
            </span>
            {e.channel&&<span style={{color:"#5a5a7a",fontSize:10}}>{e.channel}</span>}
            <span style={{color:"#5a5a7a",fontSize:10,whiteSpace:"nowrap"}}>{ts}</span>
          </div>
        );
      })}
    </div>
  );
}

function AlertBanner({alerts}) {
  if (!alerts||!alerts.length) return null;
  return (
    <div style={{display:"flex",flexDirection:"column",gap:6,marginBottom:16}}>
      {alerts.map(a=>(
        <div key={a.key} style={{
          background:a.level==="error"?"#ff5c7a18":"#ffe06618",
          border:`1px solid ${a.level==="error"?"#ff5c7a":"#ffe066"}55`,
          borderRadius:8,padding:"10px 16px",
          display:"flex",alignItems:"center",gap:10,
        }}>
          <span style={{fontSize:18}}>{a.level==="error"?"🚨":"⚠️"}</span>
          <span style={{color:a.level==="error"?"#ff5c7a":"#ffe066",
            fontFamily:"monospace",fontSize:12,fontWeight:700}}>
            {a.message}
          </span>
          <span style={{color:"#7878a0",fontSize:10,marginLeft:"auto"}}>
            {new Date(a.timestamp).toLocaleTimeString("pl-PL")}
          </span>
        </div>
      ))}
    </div>
  );
}

function TokenBar({used, limit, pct}) {
  const color = pct>90?"#ff5c7a":pct>70?"#ffe066":"#00e5ff";
  return (
    <div>
      <div style={{display:"flex",justifyContent:"space-between",marginBottom:5,fontSize:11,fontFamily:"monospace"}}>
        <span style={{color:"#9898b8"}}>Zużyto dziś</span>
        <span style={{color}}>
          {used?.toLocaleString()||0} / {limit?.toLocaleString()||"100,000"} tokenów ({pct||0}%)
        </span>
      </div>
      <div style={{background:"#2e2e46",borderRadius:4,height:8,overflow:"hidden"}}>
        <div style={{
          width:`${Math.min(pct||0,100)}%`,height:"100%",
          background:`linear-gradient(90deg,${color}80,${color})`,
          borderRadius:4,transition:"width 1s ease",
        }}/>
      </div>
      <div style={{color:"#7878a0",fontSize:10,marginTop:4}}>
        Pozostało: <span style={{color}}>{(limit-used)?.toLocaleString()||"?"} tokenów</span>
        {" · "}Reset: codziennie o północy UTC
      </div>
    </div>
  );
}

function BotHealthDashboard({health, channelNames, openPos}) {
  if (!health) return (
    <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,
      padding:30,textAlign:"center",color:"#7878a0",fontSize:13}}>
      Brak danych — bot musi działać min. 1 minutę aby pojawił się heartbeat
    </div>
  );

  const overall = health.overall_status;
  const overallColor = overall==="ok"?GREEN:overall==="warning"?YELLOW:RED;
  const ts = health.timestamp_iso ? new Date(health.timestamp_iso) : null;
  const secondsAgo = ts ? Math.floor((Date.now()-ts)/1000) : null;
  const isStale = secondsAgo > 120;

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* Alerty */}
      <AlertBanner alerts={health.alerts}/>

      {/* Główny status */}
      <div style={{background:CARD,
        border:`2px solid ${isStale?RED:overallColor}55`,
        borderRadius:10,padding:"14px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:14,flexWrap:"wrap"}}>
          <span style={{fontSize:22}}>{overall==="ok"?"🟢":overall==="warning"?"🟡":"🔴"}</span>
          <div>
            <div style={{color:"#fff",fontWeight:800,fontSize:14,letterSpacing:2}}>STATUS BOTA</div>
            <div style={{color:"#9898b8",fontSize:11}}>
              Uptime: <span style={{color:GREEN}}>{health.uptime||"—"}</span>
              {" · "}
              Heartbeat: <span style={{color:isStale?RED:GREEN}}>
                {secondsAgo!=null?`${secondsAgo}s temu`:"—"}
              </span>
              {isStale&&<span style={{color:RED,marginLeft:8,fontWeight:700}}>
                ⚠ BOT MOŻE BYĆ ZAWIESZONY!
              </span>}
            </div>
          </div>
          <div style={{marginLeft:"auto"}}><StatusDot status={isStale?"error":overall}/></div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>

        {/* Komponenty */}
        <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,overflow:"hidden"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,
            padding:"10px 12px",borderBottom:`1px solid ${BORDER}`}}>KOMPONENTY</div>
          <HealthRow label="📡 Telegram" status={health.telegram_status||"unknown"}
            detail={health.telegram_error} last_ok={health.telegram_last_ok}/>
          <HealthRow label="🤖 Groq AI"
            status={health.groq_rate_limited?"rate_limited":(health.groq_status||"unknown")}
            detail={health.groq_rate_limited?`LIMIT TOKENÓW — ${health.groq_error?.substring(health.groq_error?.indexOf("Please"),health.groq_error?.indexOf("Please")+50)||""}`:health.groq_error}
            last_ok={health.groq_last_ok}/>
          <HealthRow label="🔥 Firebase" status={health.firebase_status||"unknown"}/>
          <HealthRow label="💹 Price Updater" status={health.price_updater_status||"unknown"}
            last_ok={health.price_updater_last_ok}/>
          {/* Groq szczegóły */}
          <div style={{padding:"10px 12px",borderBottom:`1px solid #5c5c7a22`}}>
            <TokenBar used={health.groq_tokens_used} limit={health.groq_tokens_limit}
              pct={health.groq_tokens_pct}/>
            {health.groq_avg_response_ms>0&&(
              <div style={{color:"#9898b8",fontSize:11,marginTop:6}}>
                Śr. czas odpowiedzi Groq:{" "}
                <span style={{color:health.groq_avg_response_ms>3000?"#ffe066":"#00e5ff",
                  fontFamily:"monospace",fontWeight:700}}>
                  {health.groq_avg_response_ms} ms
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Live feed */}
        <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,overflow:"hidden"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,
            padding:"10px 12px",borderBottom:`1px solid ${BORDER}`}}>
            OSTATNIE ZDARZENIA
          </div>
          <EventFeed events={health.recent_events}/>
        </div>
      </div>

      {/* Statystyki sesji */}
      <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"14px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,marginBottom:12}}>STATYSTYKI SESJI</div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:12}}>
          {[
            {l:"Wiadomości",v:health.messages_received||0,c:"#e8e8f0"},
            {l:"Sygnały",v:health.signals_parsed||0,c:GREEN},
            {l:"Odrzucone",v:health.signals_rejected||0,c:"#7878a0"},
            {l:"Groq wywołania",v:health.groq_calls||0,c:BLUE},
            {l:"Groq błędy",v:health.groq_errors||0,c:health.groq_errors>0?RED:"#7878a0"},
            {l:"Aktualizacje cen",v:health.price_updates||0,c:PURPLE},
            {l:"Otwarte pozycje",v:health.positions_open||0,c:YELLOW},
          ].map(s=>(
            <div key={s.l}>
              <div style={{color:"#9898b8",fontSize:10,letterSpacing:1,marginBottom:3}}>{s.l}</div>
              <div style={{color:s.c,fontFamily:"monospace",fontSize:20,fontWeight:700}}>{s.v}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Kanały — szczegóły */}
      <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,overflow:"hidden"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:2,
          padding:"10px 12px",borderBottom:`1px solid ${BORDER}`}}>
          KANAŁY — AKTYWNOŚĆ
        </div>
        {health.channels&&Object.entries(health.channels).map(([id,ch])=>{
          const name = channelNames[id]||ch.name||id;
          const lastMsg = ch.last_message ? (() => {
            try {
              const d = ch.last_message.toDate ? ch.last_message.toDate() : new Date(ch.last_message);
              return Math.floor((Date.now()-d.getTime())/1000);
            } catch(e) { return null; }
          })() : null;
          const lastMsgStr = lastMsg!=null
            ? lastMsg<60?`${lastMsg}s temu`
              :lastMsg<3600?`${Math.floor(lastMsg/60)}m temu`
              :`${Math.floor(lastMsg/3600)}h temu`
            : "brak wiadomości";
          const isSilent = lastMsg!=null && lastMsg>43200; // 12h zamiast 6h
          return (
            <div key={id} style={{padding:"10px 12px",borderBottom:`1px solid #5c5c7a22`}}>
              <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:4}}>
                <span style={{color:"#e8e8f0",fontFamily:"monospace",fontSize:12,fontWeight:600,minWidth:140}}>
                  {name}
                </span>
                <StatusDot status={isSilent?"warning":(ch.status||"unknown")}/>
                <span style={{marginLeft:"auto",display:"flex",gap:16,fontSize:11,fontFamily:"monospace"}}>
                  <span style={{color:"#9898b8"}}>
                    Wiad: <span style={{color:"#e8e8f0"}}>{ch.messages||0}</span>
                  </span>
                  <span style={{color:"#9898b8"}}>
                    Sygn: <span style={{color:GREEN}}>{ch.signals||0}</span>
                  </span>
                </span>
              </div>
              <div style={{display:"flex",gap:20,fontSize:10}}>
                <span style={{color:isSilent?"#ffe066":"#7878a0"}}>
                  Ostatnia wiad: {lastMsgStr}
                </span>
                {ch.last_signal_text&&(
                  <span style={{color:"#5a5a7a"}}>
                    Ostatni sygnał: <span style={{color:"#a0a0c0"}}>{ch.last_signal_text}</span>
                    {ch.last_signal&&(
                      <span style={{color:"#5a5a7a",marginLeft:4}}>
                        ({Math.floor((Date.now()-new Date(ch.last_signal))/60000)}m temu)
                      </span>
                    )}
                  </span>
                )}
              </div>
              {ch.error&&<div style={{color:"#ff5c7a",fontSize:10,marginTop:3}}>{ch.error}</div>}
            </div>
          );
        })}
        {(!health.channels||Object.keys(health.channels).length===0)&&(
          <div style={{color:"#7878a0",padding:20,textAlign:"center",fontSize:12}}>
            Brak danych o kanałach
          </div>
        )}
      </div>

      {/* Debug nazwy — zwinięte */}
      <details style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"12px 16px"}}>
        <summary style={{color:"#9898b8",fontSize:11,cursor:"pointer",letterSpacing:1}}>
          🔧 DEBUG — MAPOWANIE NAZW ({Object.keys(channelNames).length} wpisów)
        </summary>
        <div style={{marginTop:10,fontFamily:"monospace",fontSize:11}}>
          {Object.entries(channelNames).map(([k,v])=>(
            <div key={k} style={{padding:"2px 0",color:"#7878a0"}}>
              <span style={{color:"#9898b8"}}>{k}</span>
              <span style={{color:"#5c5c7a"}}> → </span>
              <span style={{color:GREEN}}>{v}</span>
            </div>
          ))}
          <div style={{marginTop:8,color:"#9898b8",borderTop:`1px solid ${BORDER}`,paddingTop:8}}>
            ID w otwartych pozycjach:
          </div>
          {openPos.map(p=>(
            <div key={p.id} style={{padding:"2px 0"}}>
              <span style={{color:BLUE}}>{p.symbol}</span>
              <span style={{color:"#5c5c7a"}}> ch: </span>
              <span style={{color:ORANGE}}>"{p.channel}"</span>
              <span style={{color:"#5c5c7a"}}> → </span>
              <span style={{color:GREEN}}>"{lookupName(p.channel,channelNames)}"</span>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}


// ─── 🔬 FORENSIC LOSS ANALYSIS — Anatomia Przegranej ─────────────────────────
function ForensicLossAnalysis({positions, channelNames}) {
  const losses = positions.filter(p => (p.realized_pnl||0) < 0);
  const wins   = positions.filter(p => (p.realized_pnl||0) >= 0);
  const total  = positions.length;

  if (total < 5) return (
    <div style={{color:"#9898b8",padding:40,textAlign:"center",fontSize:13,fontFamily:"monospace"}}>
      Potrzeba min. 5 zamkniętych pozycji do analizy. Masz: {total}
    </div>
  );

  // ── Helpers ──────────────────────────────────────────────────────────────────
  const wr = (arr) => {
    const w = arr.filter(p=>(p.realized_pnl||0)>=0).length;
    return arr.length ? Math.round(w/arr.length*100) : 0;
  };
  const avgPnl = (arr) => arr.length
    ? (arr.reduce((s,p)=>s+(p.realized_pnl||0),0)/arr.length).toFixed(2)
    : 0;
  const getHour = (p) => {
    if (!p.opened_at) return null;
    return new Date(p.opened_at).getUTCHours();
  };
  const getDay = (p) => {
    if (!p.opened_at) return null;
    return new Date(p.opened_at).getUTCDay(); // 0=niedziela
  };
  const dayName = d => ["Niedz","Pon","Wt","Śr","Czw","Pt","Sob"][d];
  const bareId = id => String(id||"").replace(/^-100/,"");

  // ── Analiza po godzinie UTC ───────────────────────────────────────────────────
  const byHour = {};
  positions.forEach(p => {
    const h = getHour(p);
    if (h===null) return;
    const slot = `${String(h).padStart(2,"0")}:00`;
    if (!byHour[slot]) byHour[slot] = [];
    byHour[slot].push(p);
  });
  const hourStats = Object.entries(byHour)
    .map(([h,arr])=>({hour:h, total:arr.length, wr:wr(arr), avg:avgPnl(arr)}))
    .sort((a,b)=>a.hour.localeCompare(b.hour));
  const bestHour  = [...hourStats].filter(h=>h.total>=2).sort((a,b)=>b.wr-a.wr)[0];
  const worstHour = [...hourStats].filter(h=>h.total>=2).sort((a,b)=>a.wr-b.wr)[0];

  // ── Analiza po dniu tygodnia ──────────────────────────────────────────────────
  const byDay = {};
  positions.forEach(p => {
    const d = getDay(p);
    if (d===null) return;
    if (!byDay[d]) byDay[d] = [];
    byDay[d].push(p);
  });
  const dayStats = Object.entries(byDay)
    .map(([d,arr])=>({day:Number(d), name:dayName(Number(d)), total:arr.length, wr:wr(arr), avg:avgPnl(arr)}))
    .sort((a,b)=>a.day-b.day);
  const bestDay  = [...dayStats].filter(d=>d.total>=2).sort((a,b)=>b.wr-a.wr)[0];
  const worstDay = [...dayStats].filter(d=>d.total>=2).sort((a,b)=>a.wr-b.wr)[0];

  // ── Analiza po dźwigni ────────────────────────────────────────────────────────
  const levBuckets = {"1-10x":[],"11-20x":[],"21-30x":[],"31-50x":[],"50x+":[]};
  positions.forEach(p => {
    const lev = p.leverage||1;
    if (lev<=10) levBuckets["1-10x"].push(p);
    else if (lev<=20) levBuckets["11-20x"].push(p);
    else if (lev<=30) levBuckets["21-30x"].push(p);
    else if (lev<=50) levBuckets["31-50x"].push(p);
    else levBuckets["50x+"].push(p);
  });
  const levStats = Object.entries(levBuckets)
    .filter(([,arr])=>arr.length>0)
    .map(([lev,arr])=>({lev, total:arr.length, wr:wr(arr), avg:avgPnl(arr)}));

  // ── Analiza LONG vs SHORT ─────────────────────────────────────────────────────
  const longs  = positions.filter(p=>["LONG","SPOT_BUY"].includes(p.signal_type));
  const shorts = positions.filter(p=>p.signal_type==="SHORT");

  // ── Analiza po kanale ─────────────────────────────────────────────────────────
  const byChannel = {};
  positions.forEach(p => {
    const ch = bareId(p.channel) || "?";
    if (!byChannel[ch]) byChannel[ch] = [];
    byChannel[ch].push(p);
  });
  const chStats = Object.entries(byChannel)
    .map(([ch,arr])=>({ch, name:lookupName(ch,channelNames), total:arr.length, wr:wr(arr), avg:Number(avgPnl(arr))}))
    .filter(c=>c.total>=2)
    .sort((a,b)=>b.wr-a.wr);

  // ── Analiza serii strat ───────────────────────────────────────────────────────
  const sorted = [...positions].sort((a,b)=>new Date(a.closed_at||0)-new Date(b.closed_at||0));
  let maxStreak=0, curStreak=0, streakAfterLoss=0, totalAfterLoss=0;
  sorted.forEach((p,i) => {
    if ((p.realized_pnl||0)<0) { curStreak++; maxStreak=Math.max(maxStreak,curStreak); }
    else curStreak=0;
    if (i>0 && (sorted[i-1].realized_pnl||0)<0) {
      totalAfterLoss++;
      if ((p.realized_pnl||0)<0) streakAfterLoss++;
    }
  });
  const pAfterLoss = totalAfterLoss > 0 ? Math.round(streakAfterLoss/totalAfterLoss*100) : 0;

  // ── Analiza weekendy vs weekdays ──────────────────────────────────────────────
  const weekends = positions.filter(p=>{ const d=getDay(p); return d===0||d===6; });
  const weekdays = positions.filter(p=>{ const d=getDay(p); return d>0&&d<6; });

  // ── Generuj rekomendacje ──────────────────────────────────────────────────────
  const recs = [];

  if (bestHour && worstHour && bestHour.hour !== worstHour.hour) {
    recs.push({
      level: "success",
      icon: "⏰",
      title: `Najlepsza godzina: ${bestHour.hour} UTC`,
      body: `Win rate ${bestHour.wr}% na ${bestHour.total} tradach. Najgorsza: ${worstHour.hour} UTC (${worstHour.wr}% na ${worstHour.total} tradach). Rozważ ignorowanie sygnałów w ${worstHour.hour} UTC.`
    });
  }

  if (bestDay && worstDay && bestDay.day !== worstDay.day) {
    recs.push({
      level: worstDay.wr < 35 ? "danger" : "warning",
      icon: "📅",
      title: `Uważaj na ${worstDay.name}`,
      body: `Win rate ${worstDay.wr}% vs ${bestDay.wr}% w ${bestDay.name}. ${worstDay.wr<30?"Rozważ całkowite wstrzymanie tradingu w ten dzień.":"Zmniejsz rozmiar pozycji o 50% w ten dzień."}`
    });
  }

  if (wr(longs) > wr(shorts) + 15 && shorts.length >= 3) {
    recs.push({
      level: "warning",
      icon: "📉",
      title: `SHORT słabszy o ${wr(longs)-wr(shorts)}pp`,
      body: `LONG: ${wr(longs)}% win rate (${longs.length} tradów). SHORT: ${wr(shorts)}% win rate (${shorts.length} tradów). Rozważ pomijanie sygnałów SHORT lub zmniejszenie ich rozmiaru o 50%.`
    });
  } else if (wr(shorts) > wr(longs) + 15 && longs.length >= 3) {
    recs.push({
      level: "warning",
      icon: "📈",
      title: `LONG słabszy o ${wr(shorts)-wr(longs)}pp`,
      body: `SHORT: ${wr(shorts)}% win rate. LONG: ${wr(longs)}% win rate. Rynek jest bearish — rozważ priorytet dla SHORT.`
    });
  }

  const badLev = levStats.filter(l=>l.wr<40&&l.total>=2);
  if (badLev.length) {
    recs.push({
      level: "danger",
      icon: "⚡",
      title: `Dźwignia ${badLev.map(l=>l.lev).join(", ")} niszczy kapitał`,
      body: `Win rate przy ${badLev[0].lev}: ${badLev[0].wr}% na ${badLev[0].total} tradach. Średni P&L: $${badLev[0].avg}. Unikaj tej dźwigni.`
    });
  }

  if (maxStreak >= 3) {
    recs.push({
      level: "danger",
      icon: "🔴",
      title: `Maksymalna seria strat: ${maxStreak}`,
      body: `Po stracie prawdopodobieństwo kolejnej straty: ${pAfterLoss}%. ${pAfterLoss>50?"Zatrzymaj trading po 2 stratach z rzędu i wróć następnego dnia.":"Seria strat to normalność — nie zwiększaj ryzyka żeby odrobić."}`
    });
  }

  if (weekends.length >= 3 && wr(weekends) < wr(weekdays) - 15) {
    recs.push({
      level: "warning",
      icon: "🏖️",
      title: `Weekendy słabsze o ${wr(weekdays)-wr(weekends)}pp`,
      body: `Weekend: ${wr(weekends)}% win rate. Dni robocze: ${wr(weekdays)}% win rate. Rynek weekendowy zachowuje się inaczej — rozważ pauzę Sob-Niedz.`
    });
  }

  const badChannels = chStats.filter(c=>c.wr<40&&c.total>=3);
  if (badChannels.length) {
    recs.push({
      level: "danger",
      icon: "📡",
      title: `Kanał do rozważenia: ${badChannels[0].name}`,
      body: `Win rate: ${badChannels[0].wr}% na ${badChannels[0].total} tradach. Średni P&L: $${badChannels[0].avg.toFixed(2)}. Ten kanał traci Twój kapitał.`
    });
  }

  if (recs.length === 0) {
    recs.push({
      level: "success",
      icon: "✅",
      title: "Brak wyraźnych wzorców strat",
      body: `Na ${total} tradach nie wykryto systematycznych błędów. Zbieraj więcej danych — optymalna próba to 50+ zamkniętych pozycji.`
    });
  }

  const levelColor = {
    success: {bg:"rgba(0,230,118,.08)", border:"rgba(0,230,118,.3)", text:"#00e676"},
    warning: {bg:"rgba(255,215,64,.08)", border:"rgba(255,215,64,.3)", text:"#ffd740"},
    danger:  {bg:"rgba(255,82,82,.08)",  border:"rgba(255,82,82,.3)",  text:"#ff5252"},
  };

  // ── Mini bar chart helper ─────────────────────────────────────────────────────
  const BarRow = ({label, val, total, color}) => {
    const pct = total > 0 ? Math.round(val/total*100) : 0;
    return (
      <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:5}}>
        <div style={{width:60,fontSize:10,color:"#9898b8",fontFamily:"monospace",textAlign:"right",flexShrink:0}}>{label}</div>
        <div style={{flex:1,background:"#1c2030",borderRadius:3,height:14,overflow:"hidden"}}>
          <div style={{width:`${pct}%`,height:"100%",background:color,borderRadius:3,
            transition:"width .5s ease",display:"flex",alignItems:"center",paddingLeft:4}}>
            {pct>15&&<span style={{fontSize:9,color:"#000",fontWeight:700}}>{pct}%</span>}
          </div>
        </div>
        <div style={{width:55,fontSize:10,color:"#9898b8",fontFamily:"monospace",flexShrink:0}}>
          {val}/{total} ({pct}%)
        </div>
      </div>
    );
  };

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Header */}
      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
        <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:8}}>
          <span style={{fontSize:20}}>🔬</span>
          <div>
            <div style={{color:"#e8eaf6",fontWeight:800,fontSize:14,letterSpacing:2,fontFamily:"monospace"}}>
              ANATOMIA PRZEGRANEJ
            </div>
            <div style={{color:"#9898b8",fontSize:11}}>
              Analiza {total} zamkniętych pozycji · {losses.length} strat · {wins.length} zysków
            </div>
          </div>
          <div style={{marginLeft:"auto",display:"flex",gap:20}}>
            <div style={{textAlign:"center"}}>
              <div style={{color:"#00e676",fontFamily:"monospace",fontSize:20,fontWeight:700}}>{wr(positions)}%</div>
              <div style={{color:"#9898b8",fontSize:10}}>Win Rate</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{color:Number(avgPnl(positions))>=0?"#00e676":"#ff5252",fontFamily:"monospace",fontSize:20,fontWeight:700}}>
                ${avgPnl(positions)}
              </div>
              <div style={{color:"#9898b8",fontSize:10}}>Śr. P&L</div>
            </div>
          </div>
        </div>
      </div>

      {/* Rekomendacje */}
      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
          🎯 Rekomendacje AI
        </div>
        <div style={{display:"flex",flexDirection:"column",gap:10}}>
          {recs.map((r,i) => {
            const c = levelColor[r.level];
            return (
              <div key={i} style={{background:c.bg,border:`1px solid ${c.border}`,borderLeft:`3px solid ${c.text}`,
                borderRadius:8,padding:"12px 16px"}}>
                <div style={{color:c.text,fontWeight:700,fontSize:13,fontFamily:"monospace",marginBottom:4}}>
                  {r.icon} {r.title}
                </div>
                <div style={{color:"#b8b8d0",fontSize:12,lineHeight:1.5}}>{r.body}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Wykresy: 2 kolumny */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>

        {/* LONG vs SHORT */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
            LONG vs SHORT
          </div>
          <BarRow label="LONG" val={wr(longs)*longs.length/100|0} total={longs.length} color="#00e676"/>
          <BarRow label="SHORT" val={wr(shorts)*shorts.length/100|0} total={shorts.length} color="#ff5252"/>
          <div style={{marginTop:10,display:"flex",gap:20}}>
            <div>
              <div style={{color:"#9898b8",fontSize:10}}>LONG win rate</div>
              <div style={{color:"#00e676",fontFamily:"monospace",fontSize:16,fontWeight:700}}>{wr(longs)}%</div>
            </div>
            <div>
              <div style={{color:"#9898b8",fontSize:10}}>SHORT win rate</div>
              <div style={{color:"#ff5252",fontFamily:"monospace",fontSize:16,fontWeight:700}}>{wr(shorts)}%</div>
            </div>
          </div>
        </div>

        {/* Dźwignia */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
            WIN RATE WG DŹWIGNI
          </div>
          {levStats.map(l => {
            const c = l.wr>=55?"#00e676":l.wr>=40?"#ffd740":"#ff5252";
            return (
              <div key={l.lev} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                <div style={{width:55,fontSize:10,color:"#9898b8",fontFamily:"monospace",flexShrink:0}}>{l.lev}</div>
                <div style={{flex:1,background:"#0d0f17",borderRadius:3,height:14,overflow:"hidden"}}>
                  <div style={{width:`${l.wr}%`,height:"100%",background:c,borderRadius:3}}/>
                </div>
                <div style={{width:70,fontSize:10,color:c,fontFamily:"monospace",flexShrink:0,textAlign:"right"}}>
                  {l.wr}% ({l.total}tr)
                </div>
              </div>
            );
          })}
        </div>

        {/* Dni tygodnia */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
            WIN RATE WG DNIA TYGODNIA (UTC)
          </div>
          {dayStats.map(d => {
            const c = d.wr>=55?"#00e676":d.wr>=40?"#ffd740":"#ff5252";
            return (
              <div key={d.day} style={{display:"flex",alignItems:"center",gap:8,marginBottom:7}}>
                <div style={{width:45,fontSize:10,color:"#9898b8",fontFamily:"monospace",flexShrink:0}}>{d.name}</div>
                <div style={{flex:1,background:"#0d0f17",borderRadius:3,height:14,overflow:"hidden"}}>
                  <div style={{width:`${d.wr}%`,height:"100%",background:c,borderRadius:3}}/>
                </div>
                <div style={{width:70,fontSize:10,color:c,fontFamily:"monospace",flexShrink:0,textAlign:"right"}}>
                  {d.wr}% ({d.total}tr)
                </div>
              </div>
            );
          })}
        </div>

        {/* Godziny UTC */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
            WIN RATE WG GODZINY UTC
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:3,height:80,marginBottom:8}}>
            {hourStats.map(h => {
              const c = h.wr>=55?"#00e676":h.wr>=40?"#ffd740":"#ff5252";
              return (
                <div key={h.hour} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:2}}>
                  <div style={{width:"100%",background:c+"40",borderRadius:"2px 2px 0 0",
                    height:`${h.wr*0.7}%`,minHeight:2,border:`1px solid ${c}`,
                    position:"relative"}} title={`${h.hour}: ${h.wr}% (${h.total} tradów)`}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#5c6494",fontFamily:"monospace"}}>
            <span>00:00</span><span>06:00</span><span>12:00</span><span>18:00</span><span>23:00</span>
          </div>
          {bestHour&&<div style={{marginTop:8,fontSize:11,color:"#9898b8"}}>
            Szczyt: <span style={{color:"#00e676",fontFamily:"monospace"}}>{bestHour.hour} UTC ({bestHour.wr}% WR)</span>
            {" · "}Dno: <span style={{color:"#ff5252",fontFamily:"monospace"}}>{worstHour.hour} UTC ({worstHour.wr}% WR)</span>
          </div>}
        </div>
      </div>

      {/* Ranking kanałów */}
      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
          RANKING KANAŁÓW (min. 2 trady)
        </div>
        <div style={{overflowX:"auto"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:12}}>
            <thead>
              <tr style={{borderBottom:"1px solid #2e3350"}}>
                {["#","Kanał","Trades","Win Rate","Śr. P&L","Najlepszy","Najgorszy","Ocena"].map(h=>(
                  <th key={h} style={{color:"#9898b8",fontSize:10,padding:"6px 10px",textAlign:"left",
                    textTransform:"uppercase",letterSpacing:"0.08em",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {chStats.map((c,i) => {
                const wrColor = c.wr>=55?"#00e676":c.wr>=40?"#ffd740":"#ff5252";
                const bestT = [...(byChannel[c.ch]||[])].sort((a,b)=>(b.realized_pnl||0)-(a.realized_pnl||0))[0];
                const worstT = [...(byChannel[c.ch]||[])].sort((a,b)=>(a.realized_pnl||0)-(b.realized_pnl||0))[0];
                return (
                  <tr key={c.ch} style={{borderBottom:"1px solid rgba(46,51,80,.4)"}}>
                    <td style={{padding:"7px 10px",color:"#5c6494"}}>{i+1}</td>
                    <td style={{padding:"7px 10px",color:"#e8eaf6",fontWeight:700}}>{c.name}</td>
                    <td style={{padding:"7px 10px",color:"#9898b8"}}>{c.total}</td>
                    <td style={{padding:"7px 10px"}}>
                      <div style={{display:"flex",alignItems:"center",gap:6}}>
                        <div style={{width:50,background:"#0d0f17",borderRadius:3,height:8,overflow:"hidden"}}>
                          <div style={{width:`${c.wr}%`,height:"100%",background:wrColor,borderRadius:3}}/>
                        </div>
                        <span style={{color:wrColor,fontWeight:700}}>{c.wr}%</span>
                      </div>
                    </td>
                    <td style={{padding:"7px 10px",color:c.avg>=0?"#00e676":"#ff5252",fontWeight:600}}>
                      {c.avg>=0?"+":""}{c.avg.toFixed(2)}$
                    </td>
                    <td style={{padding:"7px 10px",color:"#00e676"}}>
                      +${(bestT?.realized_pnl||0).toFixed(2)}
                    </td>
                    <td style={{padding:"7px 10px",color:"#ff5252"}}>
                      ${(worstT?.realized_pnl||0).toFixed(2)}
                    </td>
                    <td style={{padding:"7px 10px"}}>
                      <span style={{
                        background:c.wr>=55&&c.avg>0?"rgba(0,230,118,.15)":c.wr<40||c.avg<0?"rgba(255,82,82,.15)":"rgba(255,215,64,.15)",
                        color:c.wr>=55&&c.avg>0?"#00e676":c.wr<40||c.avg<0?"#ff5252":"#ffd740",
                        border:`1px solid ${c.wr>=55&&c.avg>0?"rgba(0,230,118,.3)":c.wr<40||c.avg<0?"rgba(255,82,82,.3)":"rgba(255,215,64,.3)"}`,
                        borderRadius:4,padding:"2px 8px",fontSize:10,fontWeight:700
                      }}>
                        {c.wr>=55&&c.avg>0?"✓ Kopiuj":c.wr<40||c.avg<0?"✕ Pomiń":"~ Obserwuj"}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Serie strat */}
      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
          PSYCHOLOGIA STRAT
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))",gap:16}}>
          {[
            {l:"Maks. seria strat",v:maxStreak,c:maxStreak>=4?"#ff5252":maxStreak>=2?"#ffd740":"#00e676",s:"z rzędu"},
            {l:"P(strata po stracie)",v:`${pAfterLoss}%`,c:pAfterLoss>55?"#ff5252":pAfterLoss>45?"#ffd740":"#00e676",s:`na ${totalAfterLoss} przypadkach`},
            {l:"Weekendy vs weekdays",v:`${wr(weekends)}% vs ${wr(weekdays)}%`,c:wr(weekends)<wr(weekdays)-10?"#ffd740":"#00e676",s:"win rate"},
            {l:"Łączne straty $",v:`$${losses.reduce((s,p)=>s+(p.realized_pnl||0),0).toFixed(2)}`,c:"#ff5252",s:`${losses.length} przegranych tradów`},
          ].map(s=>(
            <div key={s.l} style={{background:"#0d0f17",borderRadius:8,padding:"12px 14px"}}>
              <div style={{color:"#9898b8",fontSize:10,marginBottom:6}}>{s.l}</div>
              <div style={{color:s.c,fontFamily:"monospace",fontSize:18,fontWeight:700}}>{s.v}</div>
              <div style={{color:"#5c6494",fontSize:10,marginTop:3}}>{s.s}</div>
            </div>
          ))}
        </div>
      </div>

    </div>
  );
}


// ─── 🎵 SENTIMENT HARMONIA ────────────────────────────────────────────────────
function SentimentHarmonia({signals, openPos, closedPos}) {
  const [now, setNow] = useState(Date.now());

  // Odświeżaj co minutę
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 60000);
    return () => clearInterval(t);
  }, []);

  if (signals.length < 10) return (
    <div style={{color:"#9898b8",padding:40,textAlign:"center",fontSize:13,fontFamily:"monospace"}}>
      Potrzeba min. 10 sygnałów do analizy rytmu. Masz: {signals.length}
    </div>
  );

  // ── Pomocnicze ────────────────────────────────────────────────────────────────
  const tsOf = (s) => {
    if (!s.timestamp) return 0;
    try { return s.timestamp.toDate ? s.timestamp.toDate().getTime() : new Date(s.timestamp).getTime(); }
    catch(e) { return 0; }
  };

  const sorted = [...signals].sort((a,b) => tsOf(a)-tsOf(b));

  // ── Sygnały w ostatnich 24h ────────────────────────────────────────────────
  const last24h = sorted.filter(s => now - tsOf(s) < 86400000);
  const last1h  = sorted.filter(s => now - tsOf(s) < 3600000);
  const last30m = sorted.filter(s => now - tsOf(s) < 1800000);

  // ── Normalna częstotliwość (historyczna mediana na godzinę) ───────────────
  const hourBuckets = {};
  sorted.forEach(s => {
    const h = Math.floor(tsOf(s) / 3600000);
    if (!hourBuckets[h]) hourBuckets[h] = 0;
    hourBuckets[h]++;
  });
  const bucketVals = Object.values(hourBuckets).sort((a,b)=>a-b);
  const medianPerHour = bucketVals.length
    ? bucketVals[Math.floor(bucketVals.length/2)]
    : 2;
  const avgPerHour = bucketVals.length
    ? (bucketVals.reduce((s,v)=>s+v,0)/bucketVals.length).toFixed(1)
    : 2;

  // ── Temperatura rynku ────────────────────────────────────────────────────────
  const ratio = medianPerHour > 0 ? last1h.length / medianPerHour : 1;
  let temp, tempColor, tempLabel, tempAdvice, tempIcon;
  if (ratio >= 3) {
    temp="GORĄCZKA"; tempColor="#ff5252"; tempIcon="🔥🔥🔥";
    tempLabel=`${last1h.length} sygnałów/h vs norma ${medianPerHour}/h`;
    tempAdvice="UWAGA: Rynek w gorączce! Historycznie takie momenty kończą się odwróceniem. Bot zmniejsza pozycje o 50%.";
  } else if (ratio >= 2) {
    temp="PODGORĄCZKOWY"; tempColor="#ff9f43"; tempIcon="🔥🔥";
    tempLabel=`${last1h.length} sygnałów/h vs norma ${medianPerHour}/h`;
    tempAdvice="Zwiększona aktywność. Zachowaj ostrożność — wchódź tylko w najsilniejsze sygnały.";
  } else if (ratio >= 1.3) {
    temp="AKTYWNY"; tempColor="#ffd740"; tempIcon="🔥";
    tempLabel=`${last1h.length} sygnałów/h vs norma ${medianPerHour}/h`;
    tempAdvice="Rynek powyżej normy. Normalna aktywność tradingowa.";
  } else if (ratio < 0.3 && last1h.length === 0) {
    temp="MARTWY"; tempColor="#9898b8"; tempIcon="💤";
    tempLabel="0 sygnałów w ostatniej godzinie";
    tempAdvice="Rynek śpi. Brak nowych sygnałów — czekaj na przebudzenie.";
  } else {
    temp="NORMALNY"; tempColor="#00e676"; tempIcon="✓";
    tempLabel=`${last1h.length} sygnałów/h vs norma ${medianPerHour}/h`;
    tempAdvice="Rytm rynku w normie. Bot działa z pełnym ryzykiem.";
  }

  // ── Histogram 24h (co 2 godziny) ─────────────────────────────────────────────
  const histogram = [];
  for (let i = 23; i >= 0; i--) {
    const start = now - (i+1)*3600000;
    const end   = now - i*3600000;
    const cnt   = sorted.filter(s => tsOf(s)>=start && tsOf(s)<end).length;
    const t = new Date(end);
    histogram.push({
      label: `${String(t.getUTCHours()).padStart(2,"0")}:00`,
      count: cnt,
      isCurrent: i === 0,
    });
  }
  const maxCount = Math.max(...histogram.map(h=>h.count), 1);

  // ── Aktywność per kanał (ostatnie 24h) ───────────────────────────────────────
  const channelActivity = {};
  last24h.forEach(s => {
    const ch = s.channel_name || s.channel || "?";
    if (!channelActivity[ch]) channelActivity[ch] = {signals:0, last:0};
    channelActivity[ch].signals++;
    const t = tsOf(s);
    if (t > channelActivity[ch].last) channelActivity[ch].last = t;
  });
  const chAct = Object.entries(channelActivity)
    .map(([name,v])=>({name, ...v}))
    .sort((a,b)=>b.signals-a.signals);

  // ── Wzorzec dzienny (ostatnie 7 dni, po godzinie UTC) ────────────────────────
  const dayPattern = Array(24).fill(0);
  const last7d = sorted.filter(s => now - tsOf(s) < 7*86400000);
  last7d.forEach(s => {
    const h = new Date(tsOf(s)).getUTCHours();
    dayPattern[h]++;
  });
  const maxDay = Math.max(...dayPattern, 1);

  // ── Trend (rośnie/spada/stabilny) ────────────────────────────────────────────
  const first12h = sorted.filter(s => {
    const age = now - tsOf(s);
    return age >= 12*3600000 && age < 24*3600000;
  }).length;
  const second12h = sorted.filter(s => now - tsOf(s) < 12*3600000).length;
  const trend = second12h > first12h * 1.3 ? "rosnący 📈"
    : second12h < first12h * 0.7 ? "malejący 📉"
    : "stabilny ➡️";
  const trendColor = second12h > first12h * 1.3 ? "#ffd740"
    : second12h < first12h * 0.7 ? "#00e676"
    : "#9898b8";

  // ── Sygnały LONG vs SHORT ostatnie 24h ───────────────────────────────────────
  const longs24  = last24h.filter(s=>s.signal_type==="LONG").length;
  const shorts24 = last24h.filter(s=>s.signal_type==="SHORT").length;
  const bias = longs24 > shorts24 * 1.5 ? "BYCZYNA 🐂"
    : shorts24 > longs24 * 1.5 ? "NIEDŹWIEDZIA 🐻"
    : "NEUTRALNA ⚖️";
  const biasColor = longs24 > shorts24 * 1.5 ? "#00e676"
    : shorts24 > longs24 * 1.5 ? "#ff5252"
    : "#9898b8";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>

      {/* Header — temperatura */}
      <div style={{background:"#1c2030",border:`2px solid ${tempColor}44`,borderRadius:12,padding:"20px 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div>
            <div style={{fontSize:32}}>{tempIcon}</div>
          </div>
          <div style={{flex:1}}>
            <div style={{color:tempColor,fontWeight:800,fontSize:18,fontFamily:"monospace",letterSpacing:"0.08em"}}>
              RYNEK: {temp}
            </div>
            <div style={{color:"#9898b8",fontSize:12,marginTop:4}}>{tempLabel}</div>
            <div style={{color:"#b8b8d0",fontSize:12,marginTop:6,padding:"8px 12px",
              background:tempColor+"15",borderRadius:6,borderLeft:`3px solid ${tempColor}`}}>
              {tempAdvice}
            </div>
          </div>
          <div style={{display:"flex",gap:20,flexWrap:"wrap"}}>
            {[
              {l:"Ostatnia 1h",v:last1h.length,c:last1h.length>medianPerHour*2?"#ff5252":"#00e676"},
              {l:"Ostatnie 30m",v:last30m.length,c:"#9898b8"},
              {l:"Ostatnie 24h",v:last24h.length,c:"#82b1ff"},
              {l:"Norma/h",v:medianPerHour,c:"#9898b8"},
            ].map(s=>(
              <div key={s.l} style={{textAlign:"center"}}>
                <div style={{color:s.c,fontFamily:"monospace",fontSize:22,fontWeight:700}}>{s.v}</div>
                <div style={{color:"#5c6494",fontSize:10}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Histogram 24h + wzorzec dzienny */}
      <div style={{display:"grid",gridTemplateColumns:"2fr 1fr",gap:14}}>

        {/* Histogram 24h */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",
            marginBottom:4,fontWeight:600}}>Aktywność — ostatnie 24h (UTC)</div>
          <div style={{color:"#5c6494",fontSize:10,marginBottom:12}}>
            Trend: <span style={{color:trendColor}}>{trend}</span>
            {" · "}Śr. {avgPerHour} sygnałów/h
          </div>
          <div style={{display:"flex",alignItems:"flex-end",gap:2,height:100}}>
            {histogram.map((h,i) => {
              const pct = h.count/maxCount*100;
              const isHigh = h.count > medianPerHour * 2;
              const barColor = h.isCurrent ? "#00e5ff" : isHigh ? "#ff5252" : "#3d4468";
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",
                  alignItems:"center",gap:2,height:"100%",justifyContent:"flex-end"}}>
                  <div title={`${h.label}: ${h.count} sygnałów`} style={{
                    width:"100%",background:barColor,borderRadius:"2px 2px 0 0",
                    height:`${Math.max(pct,2)}%`,minHeight:h.count>0?3:0,
                    opacity:h.isCurrent?1:0.8,transition:"height .3s",
                    border:h.isCurrent?`1px solid #00e5ff`:"none",
                  }}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6,
            fontSize:9,color:"#5c6494",fontFamily:"monospace"}}>
            {["24h temu","18h temu","12h temu","6h temu","teraz"].map(l=>(
              <span key={l}>{l}</span>
            ))}
          </div>
          <div style={{display:"flex",gap:12,marginTop:8,fontSize:10}}>
            <span style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:8,height:8,background:"#00e5ff",borderRadius:2,display:"inline-block"}}/>
              <span style={{color:"#9898b8"}}>Bieżąca godzina</span>
            </span>
            <span style={{display:"flex",alignItems:"center",gap:4}}>
              <span style={{width:8,height:8,background:"#ff5252",borderRadius:2,display:"inline-block"}}/>
              <span style={{color:"#9898b8"}}>Powyżej 2x normy</span>
            </span>
          </div>
        </div>

        {/* Wzorzec tygodniowy */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",
            marginBottom:4,fontWeight:600}}>Wzorzec 7-dniowy</div>
          <div style={{color:"#5c6494",fontSize:10,marginBottom:12}}>Sygnały wg godziny UTC</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:1,height:80}}>
            {dayPattern.map((cnt,h) => {
              const pct = cnt/maxDay*100;
              const isActive = new Date().getUTCHours() === h;
              return (
                <div key={h} style={{flex:1,display:"flex",flexDirection:"column",
                  alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
                  <div title={`${String(h).padStart(2,"0")}:00 UTC — ${cnt} sygnałów`} style={{
                    width:"100%",
                    background:isActive?"#00e5ff":cnt>maxDay*0.7?"#ffd740":cnt>maxDay*0.4?"#82b1ff":"#2e3350",
                    borderRadius:"2px 2px 0 0",
                    height:`${Math.max(pct,2)}%`,minHeight:cnt>0?2:0,
                  }}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:4,
            fontSize:9,color:"#5c6494",fontFamily:"monospace"}}>
            <span>00</span><span>06</span><span>12</span><span>18</span><span>23</span>
          </div>
          <div style={{marginTop:10,fontSize:11,color:"#9898b8"}}>
            Szczyt aktywności:{" "}
            <span style={{color:"#ffd740",fontFamily:"monospace"}}>
              {String(dayPattern.indexOf(Math.max(...dayPattern))).padStart(2,"0")}:00 UTC
            </span>
          </div>
        </div>
      </div>

      {/* Sentiment row */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:14}}>

        {/* LONG/SHORT bias */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",
            marginBottom:14,fontWeight:600}}>Nastrój rynku (24h)</div>
          <div style={{color:biasColor,fontFamily:"monospace",fontSize:18,fontWeight:700,marginBottom:10}}>
            {bias}
          </div>
          <div style={{display:"flex",height:8,borderRadius:4,overflow:"hidden",marginBottom:8}}>
            <div style={{flex:longs24||1,background:"#00e676",transition:"flex .5s"}}/>
            <div style={{flex:shorts24||1,background:"#ff5252",transition:"flex .5s"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:11,fontFamily:"monospace"}}>
            <span style={{color:"#00e676"}}>🐂 LONG: {longs24}</span>
            <span style={{color:"#ff5252"}}>🐻 SHORT: {shorts24}</span>
          </div>
        </div>

        {/* Aktywność kanałów */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",
            marginBottom:14,fontWeight:600}}>Aktywność kanałów (24h)</div>
          {chAct.slice(0,5).map(ch => {
            const maxSig = chAct[0]?.signals||1;
            const pct = Math.round(ch.signals/maxSig*100);
            const agoMs = now - ch.last;
            const agoStr = agoMs < 3600000
              ? `${Math.floor(agoMs/60000)}m temu`
              : `${Math.floor(agoMs/3600000)}h temu`;
            return (
              <div key={ch.name} style={{marginBottom:8}}>
                <div style={{display:"flex",justifyContent:"space-between",
                  fontSize:10,fontFamily:"monospace",marginBottom:3}}>
                  <span style={{color:"#e8eaf6"}}>{ch.name}</span>
                  <span style={{color:"#5c6494"}}>{ch.signals} sygn · {agoStr}</span>
                </div>
                <div style={{background:"#0d0f17",borderRadius:3,height:6,overflow:"hidden"}}>
                  <div style={{width:`${pct}%`,height:"100%",background:"#82b1ff",borderRadius:3}}/>
                </div>
              </div>
            );
          })}
        </div>

        {/* Pozycje vs sygnały */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.12em",textTransform:"uppercase",
            marginBottom:14,fontWeight:600}}>Stan portfela</div>
          {[
            {l:"Otwarte pozycje",v:openPos.length,c:openPos.length>5?"#ff5252":openPos.length>2?"#ffd740":"#00e676",
              bar:Math.min(openPos.length/10*100,100)},
            {l:"Zamknięte (all)",v:closedPos.length,c:"#82b1ff",bar:Math.min(closedPos.length/100*100,100)},
            {l:"Sygnały ogółem",v:signals.length,c:"#9898b8",bar:Math.min(signals.length/200*100,100)},
            {l:"Konwersja sygn→trade",
              v:signals.length>0?`${Math.round((closedPos.length+openPos.length)/signals.length*100)}%`:"—",
              c:"#ce93d8",bar:signals.length>0?(closedPos.length+openPos.length)/signals.length*100:0},
          ].map(s=>(
            <div key={s.l} style={{marginBottom:10}}>
              <div style={{display:"flex",justifyContent:"space-between",
                fontSize:10,fontFamily:"monospace",marginBottom:3}}>
                <span style={{color:"#9898b8"}}>{s.l}</span>
                <span style={{color:s.c,fontWeight:700}}>{s.v}</span>
              </div>
              <div style={{background:"#0d0f17",borderRadius:3,height:5,overflow:"hidden"}}>
                <div style={{width:`${s.bar}%`,height:"100%",background:s.c,borderRadius:3}}/>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Uwaga o Gorączce */}
      {ratio >= 2 && (
        <div style={{background:"rgba(255,82,82,.08)",border:"1px solid rgba(255,82,82,.3)",
          borderLeft:"3px solid #ff5252",borderRadius:8,padding:"14px 18px"}}>
          <div style={{color:"#ff5252",fontWeight:700,fontSize:13,fontFamily:"monospace",marginBottom:6}}>
            🔥 AKTYWNY ALERT: Gorączka rynku wykryta
          </div>
          <div style={{color:"#b8b8d0",fontSize:12,lineHeight:1.6}}>
            W ostatniej godzinie pojawiło się <strong style={{color:"#ff5252"}}>{last1h.length} sygnałów</strong> przy
            normalnej częstotliwości {medianPerHour}/h. Historycznie okresy gorączki kończą się
            odwróceniem lub fałszywymi sygnałami. Rozważ zmniejszenie rozmiaru pozycji
            lub wstrzymanie nowych wejść do czasu uspokojenia rytmu.
          </div>
        </div>
      )}

    </div>
  );
}


// ─── 🌊 MARKET REGIME DETECTOR ───────────────────────────────────────────────
function MarketRegimeWidget({regime}) {
  if (!regime) return (
    <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,
      padding:"20px",textAlign:"center",color:"#9898b8",fontSize:12,fontFamily:"monospace"}}>
      ⏳ Oczekiwanie na dane... <br/>
      <span style={{fontSize:10,color:"#5c6494"}}>market_regime.py musi być uruchomiony na VPS</span>
    </div>
  );

  const rc = regime.regime_color || "#9898b8";
  const score = regime.regime_score || 50;
  const btc = regime.btc || {};
  const fng = regime.fear_greed || {};
  const dom = regime.dominance || {};
  const updatedAt = regime.updated_at
    ? new Date(regime.updated_at).toLocaleTimeString("pl-PL")
    : "—";

  const fngColor = fng.value >= 75 ? "#ff5252"
    : fng.value >= 55 ? "#ffd740"
    : fng.value <= 25 ? "#00e676"
    : fng.value <= 45 ? "#82b1ff"
    : "#9898b8";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* Główny wskaźnik reżimu */}
      <div style={{background:"#1c2030",border:`2px solid ${rc}44`,borderRadius:12,padding:"20px 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div style={{textAlign:"center",minWidth:80}}>
            <div style={{
              width:70,height:70,borderRadius:"50%",margin:"0 auto",
              background:`conic-gradient(${rc} ${score}%, #2e3350 ${score}%)`,
              display:"flex",alignItems:"center",justifyContent:"center",
              position:"relative",
            }}>
              <div style={{width:54,height:54,borderRadius:"50%",background:"#1c2030",
                display:"flex",alignItems:"center",justifyContent:"center"}}>
                <span style={{color:rc,fontFamily:"monospace",fontSize:16,fontWeight:800}}>{score}</span>
              </div>
            </div>
            <div style={{color:"#5c6494",fontSize:9,marginTop:4}}>Bull score</div>
          </div>
          <div style={{flex:1}}>
            <div style={{color:rc,fontWeight:800,fontSize:20,fontFamily:"monospace",letterSpacing:"0.06em"}}>
              {regime.regime}
            </div>
            <div style={{color:"#b8b8d0",fontSize:12,marginTop:4}}>{regime.regime_label}</div>
            <div style={{color:"#5c6494",fontSize:10,marginTop:4}}>
              Aktualizacja: {updatedAt} UTC · co 60 minut
            </div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
            <div style={{textAlign:"center"}}>
              <div style={{color:"#e8eaf6",fontFamily:"monospace",fontSize:16,fontWeight:700}}>
                ${(btc.price||0).toLocaleString("pl-PL",{maximumFractionDigits:0})}
              </div>
              <div style={{color:btc.change24h>=0?"#00e676":"#ff5252",fontSize:11,fontFamily:"monospace"}}>
                {btc.change24h>=0?"+":""}{btc.change24h}% (24h)
              </div>
              <div style={{color:"#5c6494",fontSize:10}}>BTC/USDT</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{color:fngColor,fontFamily:"monospace",fontSize:16,fontWeight:700}}>
                {fng.value||"—"}
              </div>
              <div style={{color:fngColor,fontSize:11}}>{fng.label||"—"}</div>
              <div style={{color:"#5c6494",fontSize:10}}>Fear & Greed</div>
            </div>
          </div>
        </div>
      </div>

      {/* Dane szczegółowe */}
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>

        {/* BTC metryki */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"14px 16px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
            textTransform:"uppercase",marginBottom:12,fontWeight:600}}>BTC Metryki</div>
          {[
            {l:"Cena",v:`$${(btc.price||0).toLocaleString()}`,c:"#e8eaf6"},
            {l:"Zmiana 24h",v:`${btc.change24h>=0?"+":""}${btc.change24h}%`,
              c:btc.change24h>=0?"#00e676":"#ff5252"},
            {l:"Zakres 24h",v:`${btc.range24h_pct||0}%`,
              c:(btc.range24h_pct||0)>5?"#ff9f43":"#9898b8"},
            {l:"Wolumen 24h",v:`$${((btc.volume24h||0)/1e9).toFixed(1)}B`,c:"#82b1ff"},
          ].map(s=>(
            <div key={s.l} style={{display:"flex",justifyContent:"space-between",
              padding:"4px 0",borderBottom:"1px solid rgba(46,51,80,.4)"}}>
              <span style={{color:"#5c6494",fontSize:11}}>{s.l}</span>
              <span style={{color:s.c,fontSize:11,fontFamily:"monospace",fontWeight:600}}>{s.v}</span>
            </div>
          ))}
        </div>

        {/* Fear & Greed historia */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"14px 16px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
            textTransform:"uppercase",marginBottom:12,fontWeight:600}}>Fear & Greed (7 dni)</div>
          <div style={{display:"flex",alignItems:"flex-end",gap:4,height:60,marginBottom:8}}>
            {(fng.history_7d||[]).slice().reverse().map((v,i)=>{
              const c = v>=75?"#ff5252":v>=55?"#ffd740":v<=25?"#00e676":v<=45?"#82b1ff":"#9898b8";
              return (
                <div key={i} style={{flex:1,display:"flex",flexDirection:"column",
                  alignItems:"center",justifyContent:"flex-end",height:"100%"}}>
                  <div title={`${v}`} style={{
                    width:"100%",background:c,borderRadius:"2px 2px 0 0",
                    height:`${v}%`,opacity:i===(fng.history_7d||[]).length-1?1:0.6,
                  }}/>
                </div>
              );
            })}
          </div>
          <div style={{display:"flex",justifyContent:"space-between",fontSize:9,color:"#5c6494"}}>
            <span>7 dni temu</span><span>dziś</span>
          </div>
          <div style={{marginTop:8,fontSize:11,color:"#9898b8"}}>
            Trend: <span style={{color:fng.trend==="rosnący"?"#00e676":fng.trend==="malejący"?"#ff5252":"#9898b8"}}>
              {fng.trend==="rosnący"?"📈 rosnący":fng.trend==="malejący"?"📉 malejący":"➡️ stabilny"}
            </span>
          </div>
        </div>

        {/* Czynniki + dominacja */}
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"14px 16px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
            textTransform:"uppercase",marginBottom:12,fontWeight:600}}>Czynniki reżimu</div>
          {(regime.regime_factors||[]).map((f,i)=>(
            <div key={i} style={{fontSize:11,color:"#b8b8d0",padding:"3px 0",
              borderBottom:"1px solid rgba(46,51,80,.4)",display:"flex",alignItems:"center",gap:6}}>
              <span style={{color:rc,fontSize:8}}>●</span>{f}
            </div>
          ))}
          {dom.btc_dominance && (
            <div style={{marginTop:10}}>
              <div style={{color:"#9898b8",fontSize:10,marginBottom:4}}>BTC Dominacja</div>
              <div style={{background:"#0d0f17",borderRadius:4,height:8,overflow:"hidden"}}>
                <div style={{width:`${dom.btc_dominance}%`,height:"100%",
                  background:"#f7931a",borderRadius:4}}/>
              </div>
              <div style={{color:"#f7931a",fontFamily:"monospace",fontSize:12,
                fontWeight:700,marginTop:4}}>{dom.btc_dominance}%</div>
            </div>
          )}
        </div>
      </div>

      {/* Rekomendacje tradingowe */}
      <div style={{background:"#1c2030",border:`1px solid ${rc}44`,borderRadius:10,padding:"16px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
          textTransform:"uppercase",marginBottom:12,fontWeight:600}}>
          🎯 Rekomendacje dla reżimu {regime.regime}
        </div>
        {(regime.recommendations||[]).map((r,i)=>(
          <div key={i} style={{display:"flex",alignItems:"flex-start",gap:10,
            padding:"8px 0",borderBottom:"1px solid rgba(46,51,80,.4)"}}>
            <span style={{color:rc,fontSize:14,flexShrink:0}}>→</span>
            <span style={{color:"#b8b8d0",fontSize:12,lineHeight:1.5}}>{r}</span>
          </div>
        ))}
      </div>

    </div>
  );
}

// ─── 🧠 INTELLIGENCE DASHBOARD — łączy Forensic + Market Regime ───────────────
function IntelligenceDashboard({closedPos, channelNames, marketRegime, aiMentor, strategyEvolution}) {
  const [activeSection, setActiveSection] = useState("regime");
  const sections = [
    {id:"regime",    label:"🌊 Market Regime"},
    {id:"mentor",    label:"🧠 AI Mentor"},
    {id:"evolution", label:"🤖 Strategy Evolution"},
    {id:"forensic",  label:"🔬 Anatomia Przegranej"},
  ];
  return (
    <div>
      <div style={{display:"flex",gap:8,marginBottom:20,borderBottom:"1px solid #2e3350",paddingBottom:12,flexWrap:"wrap"}}>
        {sections.map(s=>(
          <button key={s.id} onClick={()=>setActiveSection(s.id)} style={{
            background:activeSection===s.id?"rgba(0,229,255,.1)":"transparent",
            color:activeSection===s.id?"#00e5ff":"#9898b8",
            border:activeSection===s.id?"1px solid rgba(0,229,255,.3)":"1px solid #2e3350",
            borderRadius:8,padding:"8px 18px",cursor:"pointer",
            fontFamily:"monospace",fontSize:12,fontWeight:activeSection===s.id?700:400,
            transition:"all .15s",
          }}>{s.label}</button>
        ))}
      </div>
      {activeSection==="regime"    && <MarketRegimeWidget regime={marketRegime}/>}
      {activeSection==="mentor"    && <AiMentorWidget mentor={aiMentor}/>}
      {activeSection==="evolution" && <StrategyEvolutionWidget evolution={strategyEvolution}/>}
      {activeSection==="forensic"  && <ForensicLossAnalysis positions={closedPos} channelNames={channelNames}/>}
    </div>
  );
}


// ─── 👥 SHADOW PORTFOLIO DASHBOARD ────────────────────────────────────────────
function ShadowPortfolioDashboard({portfolios, positions, realPortfolio}) {
  const STRATEGY_META = {
    conservative: {name:"🛡️ Konserwatywna", color:"#82b1ff", desc:"1% ryzyko · max dźwignia 20x · tylko kanały z WR >50%"},
    current:      {name:"⚖️ Obecna (3%)",   color:"#00e5ff", desc:"Mirror starej strategii · 3% ryzyko · wszystkie kanały"},
    aggressive:   {name:"🚀 Agresywna",     color:"#ff9f43", desc:"5% ryzyko · wszystkie kanały · pełna dźwignia"},
    breakeven:    {name:"🔒 Break-Even",    color:"#ce93d8", desc:"5% ryzyko · SL → cena wejścia po TP1 · agresywna z ochroną BE"},
    front_loaded: {name:"💰 Front-Loaded",  color:"#69f0ae", desc:"3% ryzyko · TP1=40% · TP2=35% · TP3=25% · malejąca realizacja zysku"},
    sniper:       {name:"🎯 Sniper",        color:"#ffd740", desc:"2% ryzyko · max 30x · kanały WR >55% · BE po TP1 · jakość > ilość"},
  };

  const [activeStrategy, setActiveStrategy] = useState(null);

  if (!portfolios.length) return (
    <div style={{color:"#9898b8",padding:32,textAlign:"center",fontSize:13,fontFamily:"monospace"}}>
      ⏳ Oczekiwanie na dane...<br/>
      <span style={{fontSize:10,color:"#5c6494",display:"block",marginTop:8}}>
        shadow_portfolio.py musi być uruchomiony na VPS
      </span>
    </div>
  );

  const fmt  = (n,d=2) => n!=null?(Number(n)>=0?"+":"")+Number(n).toFixed(d):"—";
  const wr   = p => { const t=(p.wins||0)+(p.losses||0); return t>0?Math.round((p.wins||0)/t*100):0; };

  const enriched = portfolios
    .map(p=>({...p, meta: STRATEGY_META[p.strategy_id]||{name:p.strategy_id,color:"#9898b8",desc:""}}))
    .sort((a,b)=>(b.total_pnl||0)-(a.total_pnl||0));

  const real    = realPortfolio || {};
  const realPnl = real.total_pnl || 0;

  const selPortfolio = activeStrategy ? enriched.find(p=>p.strategy_id===activeStrategy) : null;
  const selPositions = activeStrategy ? positions.filter(p=>p.strategy_id===activeStrategy) : [];

  return (
    <div style={{display:"flex",flexDirection:"column",gap:14}}>

      {/* Twój portfel — zawsze na górze */}
      <div style={{background:"#1c2030",border:"2px solid rgba(0,229,255,.3)",borderRadius:12,padding:"14px 16px"}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",flexWrap:"wrap",gap:8}}>
          <div>
            <div style={{color:"#00e5ff",fontFamily:"monospace",fontSize:13,fontWeight:700}}>📊 Twój portfel (aktywny)</div>
            <div style={{color:"#5c6494",fontSize:10,marginTop:2}}>{real.risk_pct||4}% ryzyko · rzeczywiste transakcje</div>
          </div>
          <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
            <div style={{textAlign:"center"}}>
              <div style={{color:realPnl>=0?"#00e676":"#ff5252",fontFamily:"monospace",fontSize:18,fontWeight:800}}>
                {fmt(realPnl)}$
              </div>
              <div style={{color:"#5c6494",fontSize:10}}>P&L łącznie</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{color:"#e8eaf6",fontFamily:"monospace",fontSize:18,fontWeight:700}}>
                ${(real.current_capital||500).toFixed(0)}
              </div>
              <div style={{color:"#5c6494",fontSize:10}}>Kapitał</div>
            </div>
            <div style={{textAlign:"center"}}>
              <div style={{color:"#9898b8",fontFamily:"monospace",fontSize:18,fontWeight:700}}>
                {real.wins||0}W/{real.losses||0}L
              </div>
              <div style={{color:"#5c6494",fontSize:10}}>W/L</div>
            </div>
          </div>
        </div>
      </div>

      {/* Karty strategii — responsywna siatka */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:10}}>
        {enriched.map(p=>{
          const pnl  = p.total_pnl || 0;
          const diff = pnl - realPnl;
          const isSelected = activeStrategy === p.strategy_id;
          const wrVal = wr(p);
          const wrColor = wrVal>=55?"#00e676":wrVal>=40?"#ffd740":"#ff5252";
          return (
            <div key={p.strategy_id}
              onClick={()=>setActiveStrategy(isSelected?null:p.strategy_id)}
              style={{
                background: isSelected ? p.meta.color+"18" : "#1c2030",
                borderRadius:10, cursor:"pointer",
                border: isSelected ? `2px solid ${p.meta.color}` : "1px solid #2e3350",
                transition:"all .2s", overflow:"hidden",
              }}>
              {/* Header karty */}
              <div style={{padding:"12px 14px",borderBottom:"1px solid rgba(46,51,80,.5)"}}>
                <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8}}>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{color:p.meta.color,fontWeight:700,fontSize:13,fontFamily:"monospace"}}>
                      {p.meta.name}
                    </div>
                    <div style={{color:"#5c6494",fontSize:10,marginTop:3,lineHeight:1.4}}>
                      {p.meta.desc}
                    </div>
                  </div>
                  <div style={{textAlign:"right",flexShrink:0}}>
                    <div style={{color:pnl>=0?"#00e676":"#ff5252",
                      fontFamily:"monospace",fontSize:18,fontWeight:800,lineHeight:1}}>
                      {fmt(pnl)}$
                    </div>
                    <div style={{fontSize:10,fontFamily:"monospace",
                      color:diff>=0?"#00e676":"#ff5252",marginTop:2}}>
                      vs real: {diff>=0?"+":""}{diff.toFixed(2)}$
                    </div>
                  </div>
                </div>
              </div>
              {/* Metryki karty */}
              <div style={{padding:"10px 14px",display:"flex",gap:12,flexWrap:"wrap"}}>
                <div style={{textAlign:"center"}}>
                  <div style={{color:wrColor,fontFamily:"monospace",fontSize:14,fontWeight:700}}>{wrVal}%</div>
                  <div style={{color:"#5c6494",fontSize:9}}>Win Rate</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{color:"#9898b8",fontFamily:"monospace",fontSize:14}}>{p.total_trades||0}</div>
                  <div style={{color:"#5c6494",fontSize:9}}>Trades</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{color:"#00e676",fontFamily:"monospace",fontSize:14}}>{p.wins||0}</div>
                  <div style={{color:"#5c6494",fontSize:9}}>Wins</div>
                </div>
                <div style={{textAlign:"center"}}>
                  <div style={{color:"#ff5252",fontFamily:"monospace",fontSize:14}}>{p.losses||0}</div>
                  <div style={{color:"#5c6494",fontSize:9}}>Losses</div>
                </div>
                <div style={{marginLeft:"auto",textAlign:"right"}}>
                  <div style={{color:isSelected?p.meta.color:"#5c6494",fontSize:10}}>
                    {isSelected?"▲ zwiń":"▼ szczegóły"}
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      {/* Wykres porównawczy */}
      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"14px 16px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
          textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
          Ranking P&L
        </div>
        {[
          {name:"📊 Twój portfel", pnl:realPnl, color:"#00e5ff"},
          ...enriched.map(p=>({name:p.meta.name, pnl:p.total_pnl||0, color:p.meta.color}))
        ].sort((a,b)=>b.pnl-a.pnl).map((s,i)=>{
          const allPnls = [realPnl,...enriched.map(p=>p.total_pnl||0)];
          const maxAbs  = Math.max(...allPnls.map(Math.abs), 1);
          const barW    = Math.min(Math.abs(s.pnl)/maxAbs*80, 80);
          return (
            <div key={i} style={{display:"flex",alignItems:"center",gap:8,marginBottom:8}}>
              <div style={{width:130,fontSize:10,color:"#b8b8d0",fontFamily:"monospace",
                flexShrink:0,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
                {s.name}
              </div>
              <div style={{flex:1,background:"#0d0f17",borderRadius:3,height:16,overflow:"hidden",position:"relative"}}>
                <div style={{
                  position:"absolute",
                  left: s.pnl>=0?"50%":"auto",
                  right: s.pnl<0?"50%":"auto",
                  width:`${barW/2}%`,height:"100%",
                  background:s.color,borderRadius:3,
                }}/>
                <div style={{position:"absolute",left:"50%",top:0,width:1,height:"100%",background:"#3d4468"}}/>
              </div>
              <div style={{width:65,fontSize:11,fontFamily:"monospace",
                color:s.pnl>=0?"#00e676":"#ff5252",textAlign:"right",flexShrink:0,fontWeight:700}}>
                {fmt(s.pnl)}$
              </div>
            </div>
          );
        })}
      </div>

      {/* Szczegóły wybranej strategii */}
      {selPortfolio && (
        <div style={{background:"#1c2030",border:`1px solid ${selPortfolio.meta.color}44`,
          borderRadius:10,padding:"14px 16px"}}>
          <div style={{color:selPortfolio.meta.color,fontSize:13,fontWeight:700,
            fontFamily:"monospace",marginBottom:12}}>
            {selPortfolio.meta.name} — szczegóły
          </div>
          <div style={{color:"#9898b8",fontSize:11,marginBottom:14,lineHeight:1.5}}>
            {selPortfolio.meta.desc}
          </div>

          {/* Metryki */}
          <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(110px,1fr))",gap:10,marginBottom:14}}>
            {[
              {l:"Kapitał",v:`$${(selPortfolio.current_capital||500).toFixed(2)}`,c:"#e8eaf6"},
              {l:"P&L",v:fmt(selPortfolio.total_pnl)+"$",c:(selPortfolio.total_pnl||0)>=0?"#00e676":"#ff5252"},
              {l:"Win Rate",v:`${wr(selPortfolio)}%`,c:wr(selPortfolio)>=55?"#00e676":wr(selPortfolio)>=40?"#ffd740":"#ff5252"},
              {l:"vs Twój bot",v:fmt((selPortfolio.total_pnl||0)-realPnl)+"$",
                c:((selPortfolio.total_pnl||0)-realPnl)>=0?"#00e676":"#ff5252"},
            ].map(s=>(
              <div key={s.l} style={{background:"#0d0f17",borderRadius:8,padding:"10px 12px"}}>
                <div style={{color:"#5c6494",fontSize:10,marginBottom:4}}>{s.l}</div>
                <div style={{color:s.c,fontFamily:"monospace",fontSize:14,fontWeight:700}}>{s.v}</div>
              </div>
            ))}
          </div>

          {/* Otwarte pozycje */}
          {selPositions.filter(p=>p.status==="OPEN").length > 0 && (
            <>
              <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
                textTransform:"uppercase",marginBottom:8,fontWeight:600}}>
                Otwarte ({selPositions.filter(p=>p.status==="OPEN").length})
              </div>
              <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
                <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",
                  fontSize:11,minWidth:400}}>
                  <thead>
                    <tr style={{borderBottom:"1px solid #2e3350"}}>
                      {["Symbol","Typ","Entry","P&L","Dźwignia"].map(h=>(
                        <th key={h} style={{color:"#5c6494",fontSize:9,padding:"6px 8px",
                          textAlign:"left",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {selPositions.filter(p=>p.status==="OPEN").map(p=>{
                      const pnl = p.unrealized_pnl||0;
                      const isL = ["LONG","SPOT_BUY"].includes(p.signal_type);
                      return (
                        <tr key={p.id} style={{borderBottom:"1px solid rgba(46,51,80,.3)"}}>
                          <td style={{padding:"6px 8px",color:"#e8eaf6",fontWeight:700}}>{p.symbol}</td>
                          <td style={{padding:"6px 8px"}}>
                            <span style={{background:isL?"rgba(0,230,118,.15)":"rgba(255,82,82,.15)",
                              color:isL?"#00e676":"#ff5252",padding:"1px 6px",borderRadius:3,fontSize:9}}>
                              {p.signal_type}
                            </span>
                          </td>
                          <td style={{padding:"6px 8px",color:"#9898b8"}}>${p.entry_price?.toPrecision(4)||"—"}</td>
                          <td style={{padding:"6px 8px",fontWeight:700,
                            color:pnl>=0?"#00e676":"#ff5252"}}>{pnl>=0?"+":""}{pnl.toFixed(2)}$</td>
                          <td style={{padding:"6px 8px",color:"#ffd740"}}>x{p.leverage}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}

      <div style={{background:"#141720",border:"1px solid #2e3350",borderRadius:8,
        padding:"10px 14px",fontSize:11,color:"#5c6494",lineHeight:1.6}}>
        💡 Kliknij kartę żeby zobaczyć szczegóły. Shadow portfolio śledzi te same sygnały co bot
        z różnymi parametrami — bez realnych pieniędzy.
      </div>
    </div>
  );
}



// ─── 🛡️ RISK PANEL — informacyjny dashboard ryzyka ──────────────────────────
function RiskPanel({portfolio, openPos}) {
  if (!portfolio) return null;

  const capital      = portfolio.current_capital || 200;
  const initial      = portfolio.initial_capital || 200;
  const riskPct      = portfolio.risk_pct || 4;
  const slippage     = portfolio.slippage_pct || 0.5;
  const riskPerTrade = round2(capital * riskPct / 100);
  const exposedUsd   = openPos.reduce((s,p)=>s+(p.allocated_usd||0),0);
  const exposedPct   = round2(exposedUsd / initial * 100);
  const drawdown     = round2((1 - capital/initial)*100);
  const capitalPct   = Math.min(Math.round(capital/initial*100),100);
  const isWarning    = drawdown > 20;
  const isDanger     = drawdown > 35;

  const liquidationRisks = openPos
    .filter(p => p.liquidation_price)
    .map(p => {
      const liq  = p.liquidation_price;
      const curr = p.current_price || p.entry_price;
      const isL  = ["LONG","SPOT_BUY"].includes(p.signal_type);
      const distPct = isL
        ? round2((curr - liq) / curr * 100)
        : round2((liq - curr) / curr * 100);
      return {...p, liq, distPct};
    })
    .filter(p => p.distPct < 15)
    .sort((a,b) => a.distPct - b.distPct);

  return (
    <div style={{background:"#1c2030",
      border:`1px solid ${isDanger?"#ff5252":isWarning?"#ffd740":"#2e3350"}`,
      borderRadius:10,padding:"14px 16px",marginBottom:14}}>

      {/* Alert drawdown — tylko informacyjny */}
      {isDanger && (
        <div style={{background:"rgba(255,82,82,.08)",border:"1px solid rgba(255,82,82,.3)",
          borderLeft:"3px solid #ff5252",borderRadius:6,padding:"10px 14px",marginBottom:12}}>
          <div style={{color:"#ff5252",fontWeight:700,fontSize:12,fontFamily:"monospace"}}>
            ⚠️ Drawdown {drawdown}% — duże straty, sprawdź które kanały zawodzą
          </div>
        </div>
      )}
      {isWarning && !isDanger && (
        <div style={{background:"rgba(255,215,64,.06)",border:"1px solid rgba(255,215,64,.25)",
          borderLeft:"3px solid #ffd740",borderRadius:6,padding:"8px 14px",marginBottom:12}}>
          <div style={{color:"#ffd740",fontSize:11,fontFamily:"monospace"}}>
            📉 Drawdown {drawdown}% — obserwuj wyniki kanałów
          </div>
        </div>
      )}

      <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",
        textTransform:"uppercase",marginBottom:12,fontWeight:600}}>
        🛡️ Panel ryzyka
      </div>

      {/* Metryki */}
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,marginBottom:14}}>
        {[
          {l:"Kapitał",        v:`$${capital.toFixed(2)}`,                   c:isDanger?"#ff5252":isWarning?"#ffd740":"#00e676"},
          {l:"Ryzyko/trade",   v:`$${riskPerTrade.toFixed(2)} (${riskPct}%)`,c:"#00e5ff"},
          {l:"Otwarte poz.",   v:`${openPos.length}`,                        c:"#9898b8"},
          {l:"Ekspozycja",     v:`$${exposedUsd.toFixed(2)} (${exposedPct}%)`,c:exposedPct>80?"#ff9f43":"#9898b8"},
          {l:"Drawdown",       v:`${drawdown > 0 ? drawdown : 0}%`,          c:isDanger?"#ff5252":isWarning?"#ffd740":"#00e676"},
          {l:"Slippage sim.",  v:`${slippage}%`,                             c:"#5c6494"},
        ].map(s=>(
          <div key={s.l} style={{background:"#0d0f17",borderRadius:8,padding:"10px 12px"}}>
            <div style={{color:"#5c6494",fontSize:10,marginBottom:4}}>{s.l}</div>
            <div style={{color:s.c,fontFamily:"monospace",fontSize:13,fontWeight:700}}>{s.v}</div>
          </div>
        ))}
      </div>

      {/* Pasek kapitału */}
      <div style={{marginBottom: liquidationRisks.length > 0 ? 12 : 0}}>
        <div style={{display:"flex",justifyContent:"space-between",
          fontSize:10,color:"#5c6494",marginBottom:4}}>
          <span>Kapitał: <span style={{color:"#e8eaf6",fontFamily:"monospace"}}>${capital.toFixed(2)}</span></span>
          <span>Start: <span style={{color:"#9898b8",fontFamily:"monospace"}}>${initial.toFixed(2)}</span></span>
        </div>
        <div style={{background:"#0d0f17",borderRadius:4,height:10,overflow:"hidden"}}>
          <div style={{
            width:`${capitalPct}%`,height:"100%",
            background:isDanger?"#ff5252":isWarning?"#ffd740":"#00e676",
            borderRadius:4,transition:"width .5s ease",
          }}/>
        </div>
        <div style={{textAlign:"right",fontSize:10,color:"#5c6494",marginTop:3}}>
          {capitalPct}% pozostało
        </div>
      </div>

      {/* Liquidation alert */}
      {liquidationRisks.length > 0 && (
        <div style={{background:"rgba(255,82,82,.06)",border:"1px solid rgba(255,82,82,.2)",
          borderRadius:6,padding:"10px 14px"}}>
          <div style={{color:"#ff9f43",fontSize:10,fontWeight:700,
            fontFamily:"monospace",marginBottom:6}}>
            ⚡ Pozycje bliskie likwidacji (&lt;15% od ceny liq.)
          </div>
          {liquidationRisks.map(p=>(
            <div key={p.id} style={{display:"flex",justifyContent:"space-between",
              alignItems:"center",fontSize:11,fontFamily:"monospace",
              padding:"4px 0",borderBottom:"1px solid rgba(46,51,80,.3)"}}>
              <span style={{color:"#e8eaf6",fontWeight:700}}>{p.symbol}</span>
              <span style={{color:"#9898b8"}}>liq: ${p.liq?.toPrecision(4)}</span>
              <span style={{
                color:p.distPct<5?"#ff5252":"#ff9f43",
                fontWeight:700
              }}>{p.distPct}% dystans</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── 🧠 AI MENTOR WIDGET ─────────────────────────────────────────────────────
function AiMentorWidget({mentor}) {
  if (!mentor) return (
    <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,
      padding:40,textAlign:"center",color:"#9898b8",fontSize:13,fontFamily:"monospace"}}>
      ⏳ Brak analizy AI Mentora<br/>
      <span style={{fontSize:10,color:"#5c6494",display:"block",marginTop:8}}>
        Uruchom: <code style={{color:"#00e5ff"}}>python3 ai_mentor.py</code>
      </span>
    </div>
  );
  if (mentor.status === "insufficient_data") return (
    <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,
      padding:30,textAlign:"center",color:"#9898b8",fontSize:13}}>
      📊 {mentor.message}
    </div>
  );
  if (mentor.status === "error") return (
    <div style={{background:"rgba(255,82,82,.08)",border:"1px solid rgba(255,82,82,.3)",
      borderRadius:10,padding:20,color:"#ff5252",fontSize:12}}>
      ❌ Błąd AI: {mentor.error}
    </div>
  );

  const a = mentor.analysis || {};
  const score = a.score || 0;
  const scoreColor = score>=70?"#00e676":score>=50?"#ffd740":"#ff5252";
  const updatedAt = mentor.updated_at ? new Date(mentor.updated_at).toLocaleString("pl-PL") : "—";
  const priorityColor = p => p==="HIGH"?"#ff5252":p==="MEDIUM"?"#ffd740":"#82b1ff";
  const priorityBg    = p => p==="HIGH"?"rgba(255,82,82,.1)":p==="MEDIUM"?"rgba(255,215,64,.1)":"rgba(130,177,255,.1)";

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:"#1c2030",border:`2px solid ${scoreColor}44`,borderRadius:12,padding:"20px 24px"}}>
        <div style={{display:"flex",alignItems:"center",gap:16,flexWrap:"wrap"}}>
          <div style={{textAlign:"center",minWidth:80}}>
            <div style={{width:70,height:70,borderRadius:"50%",margin:"0 auto",
              background:`conic-gradient(${scoreColor} ${score}%, #2e3350 ${score}%)`,
              display:"flex",alignItems:"center",justifyContent:"center"}}>
              <div style={{width:54,height:54,borderRadius:"50%",background:"#1c2030",
                display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column"}}>
                <span style={{color:scoreColor,fontFamily:"monospace",fontSize:18,fontWeight:800}}>{score}</span>
                <span style={{color:"#5c6494",fontSize:8}}>/100</span>
              </div>
            </div>
            <div style={{color:"#5c6494",fontSize:9,marginTop:4}}>Trading score</div>
          </div>
          <div style={{flex:1}}>
            <div style={{color:"#e8eaf6",fontSize:13,lineHeight:1.6,marginBottom:6}}>{a.overall_assessment||"Brak oceny"}</div>
            <div style={{color:"#5c6494",fontSize:10}}>Analiza {mentor.positions_count||0} pozycji · {updatedAt}</div>
          </div>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
            💡 Kluczowe wnioski
          </div>
          {(a.key_insights||[]).map((insight,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid rgba(46,51,80,.4)"}}>
              <span style={{color:"#00e5ff",flexShrink:0}}>→</span>
              <span style={{color:"#b8b8d0",fontSize:12,lineHeight:1.5}}>{insight}</span>
            </div>
          ))}
        </div>
        <div style={{background:"#1c2030",border:"1px solid rgba(255,82,82,.2)",borderRadius:10,padding:"16px 20px"}}>
          <div style={{color:"#ff5252",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
            ⚠️ Błędy krytyczne
          </div>
          {(a.critical_mistakes||[]).map((m,i)=>(
            <div key={i} style={{display:"flex",gap:10,padding:"8px 0",borderBottom:"1px solid rgba(255,82,82,.15)"}}>
              <span style={{color:"#ff5252",flexShrink:0}}>✕</span>
              <span style={{color:"#b8b8d0",fontSize:12,lineHeight:1.5}}>{m}</span>
            </div>
          ))}
        </div>
      </div>

      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,padding:"16px 20px"}}>
        <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:14,fontWeight:600}}>
          🎯 Plan działania
        </div>
        {(a.action_plan||[]).map((item,i)=>(
          <div key={i} style={{background:priorityBg(item.priority),
            border:`1px solid ${priorityColor(item.priority)}33`,
            borderLeft:`3px solid ${priorityColor(item.priority)}`,
            borderRadius:8,padding:"12px 16px",marginBottom:10}}>
            <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
              <span style={{background:priorityColor(item.priority)+"22",color:priorityColor(item.priority),
                fontSize:9,fontWeight:700,padding:"2px 7px",borderRadius:4,fontFamily:"monospace"}}>
                {item.priority}
              </span>
              <span style={{color:"#e8eaf6",fontSize:13,fontWeight:600}}>{item.action}</span>
            </div>
            <div style={{color:"#9898b8",fontSize:11,lineHeight:1.5}}>{item.reason}</div>
          </div>
        ))}
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        {[
          {l:"✓ Najlepszy setup",  v:a.best_setup,      c:"rgba(0,230,118,.06)",  bc:"rgba(0,230,118,.2)",  tc:"#00e676"},
          {l:"✕ Unikaj",          v:a.worst_pattern,   c:"rgba(255,82,82,.06)",  bc:"rgba(255,82,82,.2)",  tc:"#ff5252"},
          {l:"🎯 Cel na tydzień", v:a.next_week_focus, c:"rgba(255,215,64,.06)", bc:"rgba(255,215,64,.2)", tc:"#ffd740"},
        ].map(s=>(
          <div key={s.l} style={{background:s.c,border:`1px solid ${s.bc}`,borderRadius:10,padding:"14px 16px"}}>
            <div style={{color:s.tc,fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,fontWeight:600}}>{s.l}</div>
            <div style={{color:"#b8b8d0",fontSize:12,lineHeight:1.6}}>{s.v||"—"}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── 🤖 STRATEGY EVOLUTION WIDGET ────────────────────────────────────────────
function StrategyEvolutionWidget({evolution}) {
  const [showAll, setShowAll] = useState(false);
  if (!evolution) return (
    <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,
      padding:40,textAlign:"center",color:"#9898b8",fontSize:13,fontFamily:"monospace"}}>
      ⏳ Brak wyników ewolucji<br/>
      <span style={{fontSize:10,color:"#5c6494",display:"block",marginTop:8}}>
        Uruchom: <code style={{color:"#00e5ff"}}>python3 strategy_evolution.py</code>
      </span>
    </div>
  );
  if (evolution.status === "insufficient_data") return (
    <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,
      padding:30,textAlign:"center",color:"#9898b8",fontSize:13}}>
      📊 {evolution.message}
    </div>
  );

  const best     = evolution.best_strategy || {};
  const baseline = evolution.baseline || {};
  const top10    = evolution.top10 || [];
  const summary  = evolution.summary || {};
  const updatedAt = evolution.updated_at ? new Date(evolution.updated_at).toLocaleString("pl-PL") : "—";
  const improvement = summary.improvement || 0;
  const improvColor = improvement > 0 ? "#00e676" : "#ff5252";

  const ParamBadge = ({label, val}) => (
    <span style={{background:"rgba(0,229,255,.1)",color:"#00e5ff",fontSize:10,
      padding:"2px 8px",borderRadius:4,fontFamily:"monospace",marginRight:6,
      marginBottom:4,display:"inline-block"}}>
      {label}: {val}
    </span>
  );

  return (
    <div style={{display:"flex",flexDirection:"column",gap:16}}>
      <div style={{background:"#1c2030",border:`2px solid ${improvColor}44`,borderRadius:12,padding:"20px 24px"}}>
        <div style={{display:"flex",alignItems:"flex-start",gap:16,flexWrap:"wrap"}}>
          <div style={{flex:1}}>
            <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",marginBottom:8,fontWeight:600}}>
              🤖 Optymalna strategia
            </div>
            <div style={{display:"flex",flexWrap:"wrap",gap:4,marginBottom:10}}>
              <ParamBadge label="Ryzyko" val={`${best.params?.risk_pct}%`}/>
              <ParamBadge label="Max lev" val={best.params?.max_leverage}/>
              <ParamBadge label="Min WR" val={best.params?.min_channel_wr}/>
              <ParamBadge label="Kierunek" val={best.params?.direction}/>
              <ParamBadge label="Godziny" val={best.params?.exclude_hours}/>
            </div>
            <div style={{color:"#5c6494",fontSize:10}}>{evolution.combinations_tested} kombinacji · {evolution.positions_analyzed} pozycji · {updatedAt}</div>
          </div>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
            {[
              {l:"ROI optymalny",    v:`${best.roi_pct}%`,       c:best.roi_pct>=0?"#00e676":"#ff5252"},
              {l:"ROI baseline",     v:`${baseline.roi_pct||0}%`,c:(baseline.roi_pct||0)>=0?"#00e676":"#ff5252"},
              {l:"Poprawa",          v:`${improvement>=0?"+":""}${improvement}%`, c:improvColor},
              {l:"WR optymalny",     v:`${best.win_rate}%`,      c:best.win_rate>=55?"#00e676":"#ffd740"},
            ].map(s=>(
              <div key={s.l} style={{background:"#0d0f17",borderRadius:8,padding:"8px 12px",textAlign:"center"}}>
                <div style={{color:s.c,fontFamily:"monospace",fontSize:16,fontWeight:800}}>{s.v}</div>
                <div style={{color:"#5c6494",fontSize:9,marginTop:2}}>{s.l}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div style={{background:"#1c2030",border:"1px solid #2e3350",borderRadius:10,overflow:"hidden"}}>
        <div style={{padding:"12px 18px",borderBottom:"1px solid #2e3350",
          display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div style={{color:"#9898b8",fontSize:10,letterSpacing:"0.1em",textTransform:"uppercase",fontWeight:600}}>
            Top {showAll?top10.length:5} strategii
          </div>
          <button onClick={()=>setShowAll(p=>!p)} style={{
            background:"transparent",border:"1px solid #2e3350",color:"#9898b8",
            fontSize:10,padding:"4px 10px",borderRadius:4,cursor:"pointer",fontFamily:"monospace"}}>
            {showAll?"Mniej":"Wszystkie 10"}
          </button>
        </div>
        <div style={{overflowX:"auto",WebkitOverflowScrolling:"touch"}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:11,minWidth:500}}>
            <thead>
              <tr style={{borderBottom:"1px solid #2e3350",background:"#141720"}}>
                {["#","Ryzyko","Max lev","Min WR","Kierunek","ROI","WR","Trades","Max DD"].map(h=>(
                  <th key={h} style={{color:"#5c6494",fontSize:9,padding:"7px 8px",
                    textAlign:"left",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {top10.slice(0,showAll?10:5).map((r,i)=>(
                <tr key={i} style={{borderBottom:"1px solid rgba(46,51,80,.3)",
                  background:i===0?"rgba(0,230,118,.04)":"transparent"}}>
                  <td style={{padding:"6px 8px",color:i===0?"#00e676":"#5c6494",fontWeight:i===0?700:400}}>
                    {i===0?"🏆":i+1}
                  </td>
                  <td style={{padding:"6px 8px",color:"#e8eaf6"}}>{r.params?.risk_pct}%</td>
                  <td style={{padding:"6px 8px",color:"#9898b8"}}>{r.params?.max_leverage}</td>
                  <td style={{padding:"6px 8px",color:"#9898b8"}}>{r.params?.min_channel_wr}</td>
                  <td style={{padding:"6px 8px",color:"#9898b8"}}>{r.params?.direction}</td>
                  <td style={{padding:"6px 8px",fontWeight:700,color:r.roi_pct>=0?"#00e676":"#ff5252"}}>{r.roi_pct}%</td>
                  <td style={{padding:"6px 8px",color:r.win_rate>=55?"#00e676":r.win_rate>=40?"#ffd740":"#ff5252"}}>{r.win_rate}%</td>
                  <td style={{padding:"6px 8px",color:"#9898b8"}}>{r.trades_taken}</td>
                  <td style={{padding:"6px 8px",color:r.max_drawdown>20?"#ff5252":"#9898b8"}}>{r.max_drawdown}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{background:"#141720",border:"1px solid #2e3350",borderRadius:8,
        padding:"10px 14px",fontSize:11,color:"#5c6494",lineHeight:1.6}}>
        ⚠️ Wyniki historyczne — nie gwarantują przyszłych zysków. Bot nie zmienia parametrów automatycznie.
      </div>
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
  {id:"intelligence",label:"🧠 Intelligence"},
  {id:"sentiment",label:"🎵 Sentiment"},
  {id:"shadow",label:"👥 Shadow"},
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
      setOpenPos(all.filter(p=>p.status==="OPEN"));
      // Zamknięte sortuj po closed_at desc (najnowsze pierwsze)
      const closed = all.filter(p=>p.status==="CLOSED").sort((a,b)=>{
        const ta = a.closed_at ? new Date(a.closed_at).getTime() : 0;
        const tb = b.closed_at ? new Date(b.closed_at).getTime() : 0;
        return tb - ta;
      });
      setClosedPos(closed);
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
      // Deduplikuj — Firebase może mieć docs z ID "1700533698" i "-1001700533698"
      const all = snap.docs.map(d=>({id:d.id,...d.data()}));
      const seen = new Map();
      all.forEach(ch => {
        const bare = String(ch.channel||ch.id||"").replace(/^-100/,"");
        const existing = seen.get(bare);
        // Zostaw ten z większą liczbą tradów
        if (!existing || (ch.total_trades||0) > (existing.total_trades||0)) {
          seen.set(bare, ch);
        }
      });
      setChannelStats(Array.from(seen.values()));
    });
  },[]);

  const [health, setHealth] = useState(null);
  useEffect(()=>{
    return onSnapshot(doc(db,"bot_health","status"), snap=>{
      if(snap.exists()) setHealth(snap.data());
    });
  },[]);

  const [marketRegime, setMarketRegime] = useState(null);
  const [aiMentor, setAiMentor] = useState(null);
  const [strategyEvolution, setStrategyEvolution] = useState(null);
  useEffect(()=>{
    return onSnapshot(doc(db,"ai_mentor","latest"), snap=>{
      if(snap.exists()) setAiMentor(snap.data());
    });
  },[]);
  useEffect(()=>{
    return onSnapshot(doc(db,"strategy_evolution","latest"), snap=>{
      if(snap.exists()) setStrategyEvolution(snap.data());
    });
  },[]);
  const [shadowPortfolios, setShadowPortfolios] = useState([]);
  const [shadowPositions, setShadowPositions] = useState([]);
  useEffect(()=>{
    return onSnapshot(collection(db,"shadow_portfolios"), snap=>{
      setShadowPortfolios(snap.docs.map(d=>({id:d.id,...d.data()})).filter(d=>d.strategy_id));
    });
  },[]);
  useEffect(()=>{
    const q=query(collection(db,"shadow_positions"),orderBy("opened_at","desc"),limit(200));
    return onSnapshot(q, snap=>{
      setShadowPositions(snap.docs.map(d=>({id:d.id,...d.data()})));
    });
  },[]);
  useEffect(()=>{
    return onSnapshot(doc(db,"market_regime","current"), snap=>{
      if(snap.exists()) setMarketRegime(snap.data());
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
          <span style={{color:"#9898b8",fontSize:11,marginLeft:12}}>Telegram → Firebase · ${portfolio?.initial_capital||200} · {portfolio?.risk_pct||4}% / trade</span>
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
          <RiskPanel portfolio={portfolio} openPos={openPos}/>
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

        {tab==="intelligence"&&<IntelligenceDashboard closedPos={closedPos} channelNames={channelNames} marketRegime={marketRegime} aiMentor={aiMentor} strategyEvolution={strategyEvolution}/>}

        {tab==="sentiment"&&<SentimentHarmonia signals={signals} openPos={openPos} closedPos={closedPos}/>}
        {tab==="shadow"&&<ShadowPortfolioDashboard portfolios={shadowPortfolios} positions={shadowPositions} realPortfolio={portfolio}/>}
      </div>
    </div>
  );
}
