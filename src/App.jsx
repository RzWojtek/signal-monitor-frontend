import { useState, useEffect } from "react";
import { initializeApp } from "firebase/app";
import {
  getFirestore, collection, query, orderBy,
  limit, onSnapshot, doc, setDoc, getDocs,
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

// ─── helpers ──────────────────────────────────────────────────────────────────
const fmt   = (n, d=2) => n != null ? Number(n).toFixed(d) : "—";
const fmtK  = (n) => n != null ? `$${Number(n).toFixed(2)}` : "—";
const pct   = (n) => n != null ? `${Number(n).toFixed(2)}%` : "—";
const ago   = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const s = Math.floor((Date.now()-d)/1000);
  if (s<60) return `${s}s temu`;
  if (s<3600) return `${Math.floor(s/60)}m temu`;
  if (s<86400) return `${Math.floor(s/3600)}h temu`;
  return d.toLocaleDateString("pl-PL");
};
const fmtDt = (ts) => {
  if (!ts) return "—";
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleString("pl-PL");
};

const GREEN="#00ff90",RED="#ff4d6d",BLUE="#00cfff",PURPLE="#a78bfa",
      YELLOW="#ffdb4d",ORANGE="#ff9f43",BG="#070b10",CARD="#0d1117",BORDER="#1e2530";

const Pill=({label,color=GREEN})=>(
  <span style={{background:color+"22",color,border:`1px solid ${color}44`,
    borderRadius:4,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:1,fontFamily:"monospace"}}>
    {label}
  </span>
);

const StatCard=({label,value,sub,color="#fff"})=>(
  <div style={{background:CARD,border:`1px solid ${BORDER}`,borderRadius:10,padding:"14px 18px",minWidth:120}}>
    <div style={{color:"#444",fontSize:10,letterSpacing:2,textTransform:"uppercase",marginBottom:4}}>{label}</div>
    <div style={{color,fontFamily:"monospace",fontSize:22,fontWeight:800,lineHeight:1}}>{value}</div>
    {sub&&<div style={{color:"#555",fontSize:11,marginTop:4}}>{sub}</div>}
  </div>
);

// ─── Portfolio Header ──────────────────────────────────────────────────────────
function PortfolioHeader({portfolio}){
  if(!portfolio) return <div style={{color:"#333",padding:20,textAlign:"center"}}>Ładowanie portfela...</div>;
  const pnl=portfolio.total_pnl??0, pnlPct=portfolio.total_pnl_pct??0;
  const capital=portfolio.current_capital??0, initial=portfolio.initial_capital??500;
  const wins=portfolio.wins??0, losses=portfolio.losses??0, total=portfolio.total_trades??0;
  const wr=total>0?((wins/total)*100).toFixed(0):0;
  const isPos=pnl>=0;
  return(
    <div style={{background:CARD,border:`1px solid ${isPos?GREEN+"40":RED+"40"}`,borderRadius:12,padding:"20px 24px",marginBottom:24}}>
      <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:16,flexWrap:"wrap"}}>
        <span style={{fontSize:22}}>💼</span>
        <div>
          <div style={{color:"#fff",fontWeight:800,fontSize:15,letterSpacing:2}}>PORTFEL SYMULACJI</div>
          <div style={{color:"#444",fontSize:11}}>Start: {fmtDt(portfolio.created_at)} · Kapitał startowy: {fmtK(initial)}</div>
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
          <div style={{color:"#444",fontSize:10,letterSpacing:2,marginBottom:8}}>KAPITAŁ VS START</div>
          <div style={{background:"#1a1f2a",borderRadius:4,height:8,overflow:"hidden"}}>
            <div style={{width:`${Math.min(Math.max((capital/initial)*100,0),200)}%`,height:"100%",
              background:isPos?`linear-gradient(90deg,${GREEN}80,${GREEN})`:`linear-gradient(90deg,${RED}80,${RED})`,
              borderRadius:4,transition:"width 1s ease"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:6,fontSize:11,fontFamily:"monospace"}}>
            <span style={{color:"#444"}}>$0</span>
            <span style={{color:isPos?GREEN:RED}}>{fmtK(capital)}</span>
            <span style={{color:"#444"}}>{fmtK(initial*2)}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Positions Table ───────────────────────────────────────────────────────────
function PositionsTable({positions,channelNames}){
  const [expandedId,setExpandedId]=useState(null);
  if(!positions.length) return(
    <div style={{color:"#333",padding:30,textAlign:"center",fontSize:13}}>Brak pozycji</div>
  );
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:12}}>
        <thead>
          <tr style={{borderBottom:`1px solid ${BORDER}`}}>
            {["Symbol","Typ","Entry","Aktualnie","SL","TP","Alloc.","Unrealized P&L","Kanał","Otwarto"].map(h=>(
              <th key={h} style={{color:"#444",fontSize:10,letterSpacing:1,padding:"8px 10px",
                textAlign:"left",textTransform:"uppercase",whiteSpace:"nowrap"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(pos=>{
            const pnl=pos.unrealized_pnl??0, pnlPct=pos.unrealized_pnl_pct??0;
            const isPos=pnl>=0, isLong=["LONG","SPOT_BUY"].includes(pos.signal_type);
            const accent=isLong?GREEN:RED;
            const tpsHit=pos.tps_hit?.length??0, tpsTotal=pos.take_profits?.length??0;
            const slMoved=pos.sl_moved_to_be;
            const chName=channelNames[pos.channel]||pos.channel_name||pos.channel||"?";
            return(<>
              <tr key={pos.id}
                onClick={()=>setExpandedId(expandedId===pos.id?null:pos.id)}
                style={{borderBottom:`1px solid ${BORDER}`,cursor:"pointer"}}
                onMouseEnter={e=>e.currentTarget.style.background="#ffffff05"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"10px 10px",color:"#fff",fontWeight:700}}>
                  <span style={{borderLeft:`3px solid ${accent}`,paddingLeft:8}}>{pos.symbol}</span>
                </td>
                <td style={{padding:"10px 10px"}}><Pill label={pos.signal_type} color={accent}/></td>
                <td style={{padding:"10px 10px",color:"#888"}}>${fmt(pos.entry_price,4)}</td>
                <td style={{padding:"10px 10px",color:isPos?GREEN:RED}}>${fmt(pos.current_price,4)}</td>
                <td style={{padding:"10px 10px"}}>
                  <span style={{color:RED+"bb"}}>{pos.stop_loss?`$${fmt(pos.stop_loss,4)}`:"—"}</span>
                  {slMoved&&<span style={{color:YELLOW,fontSize:10,marginLeft:4}}>BE</span>}
                </td>
                <td style={{padding:"10px 10px"}}>
                  {tpsTotal>0?<span style={{color:tpsHit>0?GREEN:"#555"}}>{tpsHit}/{tpsTotal}</span>:<span style={{color:"#333"}}>—</span>}
                </td>
                <td style={{padding:"10px 10px",color:"#666"}}>
                  {fmtK(pos.allocated_usd)}
                  {pos.leverage>1&&<span style={{color:YELLOW,marginLeft:4}}>x{pos.leverage}</span>}
                </td>
                <td style={{padding:"10px 10px"}}>
                  <span style={{color:isPos?GREEN:RED,fontWeight:700}}>{isPos?"+":""}{fmtK(pnl)}</span>
                  <span style={{color:isPos?GREEN+"88":RED+"88",marginLeft:6,fontSize:11}}>({isPos?"+":""}{pct(pnlPct)})</span>
                </td>
                <td style={{padding:"10px 10px",color:PURPLE,fontSize:11,maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}
                  title={chName}>{chName}</td>
                <td style={{padding:"10px 10px",color:"#444",fontSize:11}}>{ago(pos.opened_at)}</td>
              </tr>
              {expandedId===pos.id&&(
                <tr key={pos.id+"_exp"}>
                  <td colSpan={10} style={{padding:"0 10px 12px 10px",background:"#0a0f16"}}>
                    <div style={{padding:12,borderRadius:8,border:`1px solid ${accent}22`,display:"flex",gap:24,flexWrap:"wrap"}}>
                      <div>
                        <div style={{color:"#444",fontSize:10,marginBottom:4}}>TAKE PROFITS</div>
                        {pos.take_profits?.length?pos.take_profits.map(tp=>(
                          <div key={tp.level} style={{color:pos.tps_hit?.includes(tp.level)?GREEN:"#555",fontSize:12}}>
                            {pos.tps_hit?.includes(tp.level)?"✓ ":"○ "}TP{tp.level}: ${fmt(tp.price,4)}
                          </div>
                        )):<span style={{color:"#444"}}>Brak TP</span>}
                      </div>
                      <div>
                        <div style={{color:"#444",fontSize:10,marginBottom:4}}>PARTIAL CLOSES</div>
                        {pos.partial_closes?.length?pos.partial_closes.map((pc,i)=>(
                          <div key={i} style={{color:GREEN,fontSize:11}}>TP{pc.tp_level}: +${fmt(pc.pnl,2)} @ ${fmt(pc.price,4)}</div>
                        )):<span style={{color:"#444",fontSize:12}}>Brak</span>}
                      </div>
                      <div>
                        <div style={{color:"#444",fontSize:10,marginBottom:4}}>SZCZEGÓŁY</div>
                        <div style={{color:"#555",fontSize:12}}>Qty total: {pos.quantity}</div>
                        <div style={{color:"#555",fontSize:12}}>Qty remaining: {pos.quantity_remaining||pos.quantity}</div>
                        <div style={{color:"#555",fontSize:12}}>Ryzyko: {pos.risk_pct}%</div>
                        <div style={{color:"#555",fontSize:12}}>SL original: {pos.original_stop_loss?`$${fmt(pos.original_stop_loss,4)}`:"—"}</div>
                        <div style={{color:slMoved?YELLOW:"#555",fontSize:12}}>SL aktualny: {pos.stop_loss?`$${fmt(pos.stop_loss,4)}`:"—"} {slMoved?"(BE)":""}</div>
                      </div>
                      <div>
                        <div style={{color:"#444",fontSize:10,marginBottom:4}}>OTWARTO</div>
                        <div style={{color:"#555",fontSize:12}}>{fmtDt(pos.opened_at)}</div>
                        <div style={{color:"#555",fontSize:12}}>Kanał: {chName}</div>
                      </div>
                    </div>
                  </td>
                </tr>
              )}
            </>);
          })}
        </tbody>
      </table>
    </div>
  );
}

// ─── Closed Positions ──────────────────────────────────────────────────────────
function ClosedTable({positions,channelNames}){
  if(!positions.length) return <div style={{color:"#333",textAlign:"center",padding:20,fontSize:13}}>Brak zamkniętych pozycji</div>;
  return(
    <div style={{overflowX:"auto"}}>
      <table style={{width:"100%",borderCollapse:"collapse",fontFamily:"monospace",fontSize:12}}>
        <thead>
          <tr style={{borderBottom:`1px solid ${BORDER}`}}>
            {["Symbol","Typ","Entry","Exit","P&L $","P&L %","Powód","Kanał","Czas"].map(h=>(
              <th key={h} style={{color:"#444",fontSize:10,letterSpacing:1,padding:"8px 10px",textAlign:"left",textTransform:"uppercase"}}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {positions.map(pos=>{
            const pnl=pos.realized_pnl??0, pnlPct=pos.realized_pnl_pct??0;
            const isPos=pnl>=0, isLong=["LONG","SPOT_BUY"].includes(pos.signal_type);
            const chName=channelNames[pos.channel]||pos.channel_name||pos.channel||"?";
            return(
              <tr key={pos.id} style={{borderBottom:`1px solid ${BORDER}22`}}
                onMouseEnter={e=>e.currentTarget.style.background="#ffffff04"}
                onMouseLeave={e=>e.currentTarget.style.background="transparent"}>
                <td style={{padding:"8px 10px",color:"#888",fontWeight:600}}>{pos.symbol}</td>
                <td style={{padding:"8px 10px"}}><Pill label={pos.signal_type} color={isLong?GREEN:RED}/></td>
                <td style={{padding:"8px 10px",color:"#555"}}>${fmt(pos.entry_price,4)}</td>
                <td style={{padding:"8px 10px",color:"#555"}}>${fmt(pos.close_price,4)}</td>
                <td style={{padding:"8px 10px",fontWeight:700,color:isPos?GREEN:RED}}>{isPos?"+":""}{fmtK(pnl)}</td>
                <td style={{padding:"8px 10px",color:isPos?GREEN+"99":RED+"99"}}>{isPos?"+":""}{pct(pnlPct)}</td>
                <td style={{padding:"8px 10px"}}>
                  <Pill label={pos.close_reason||"?"} color={pos.close_reason?.includes("TP")?GREEN:pos.close_reason==="SL_HIT"?RED:"#666"}/>
                </td>
                <td style={{padding:"8px 10px",color:PURPLE,fontSize:11}}>{chName}</td>
                <td style={{padding:"8px 10px",color:"#444",fontSize:11}}>{ago(pos.closed_at)}</td>
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
  const [editing,setEditing]=useState(null);
  const [editVal,setEditVal]=useState("");

  const startEdit=(id,current)=>{
    setEditing(id);
    setEditVal(current||"");
  };
  const saveEdit=async(id)=>{
    await onRename(id,editVal);
    setEditing(null);
  };

  if(!channelStats.length) return(
    <div style={{color:"#333",padding:40,textAlign:"center",fontSize:13}}>
      Brak danych — pojawią się po zamknięciu pierwszych pozycji
    </div>
  );

  return(
    <div>
      <div style={{color:"#444",fontSize:11,letterSpacing:2,marginBottom:16}}>
        RANKING KANAŁÓW — opłacalność sygnałów
      </div>
      {channelStats.sort((a,b)=>(b.total_pnl||0)-(a.total_pnl||0)).map(ch=>{
        const isPos=(ch.total_pnl||0)>=0;
        const wr=ch.win_rate||0;
        const wrColor=wr>=60?GREEN:wr>=40?YELLOW:RED;
        const chId=ch.channel||"?";
        const displayName=channelNames[chId]||ch.channel_name||chId;
        return(
          <div key={ch.id||chId} style={{
            background:CARD,border:`1px solid ${isPos?GREEN+"25":RED+"25"}`,
            borderLeft:`3px solid ${isPos?GREEN:RED}`,
            borderRadius:8,padding:"16px 20px",marginBottom:10,
          }}>
            <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:12,flexWrap:"wrap"}}>
              {editing===chId?(
                <div style={{display:"flex",gap:6,alignItems:"center"}}>
                  <input value={editVal} onChange={e=>setEditVal(e.target.value)}
                    onKeyDown={e=>e.key==="Enter"&&saveEdit(chId)}
                    style={{background:"#1a1f2a",border:`1px solid ${BLUE}`,borderRadius:4,
                      padding:"4px 10px",color:"#fff",fontFamily:"monospace",fontSize:13}}
                    autoFocus/>
                  <button onClick={()=>saveEdit(chId)} style={{
                    background:GREEN+"22",color:GREEN,border:`1px solid ${GREEN}44`,
                    borderRadius:4,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>
                    Zapisz
                  </button>
                  <button onClick={()=>setEditing(null)} style={{
                    background:"transparent",color:"#555",border:"1px solid #333",
                    borderRadius:4,padding:"4px 10px",cursor:"pointer",fontSize:11,fontFamily:"monospace"}}>
                    Anuluj
                  </button>
                </div>
              ):(
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <span style={{color:"#fff",fontWeight:700,fontSize:14,fontFamily:"monospace"}}>{displayName}</span>
                  <button onClick={()=>startEdit(chId,displayName)} style={{
                    background:"transparent",color:"#444",border:"1px solid #2a3040",
                    borderRadius:4,padding:"2px 8px",cursor:"pointer",fontSize:10,fontFamily:"monospace"}}>
                    ✏ zmień nazwę
                  </button>
                </div>
              )}
              <span style={{marginLeft:"auto",color:isPos?GREEN:RED,fontFamily:"monospace",fontWeight:700,fontSize:16}}>
                {isPos?"+":""}{fmtK(ch.total_pnl)}
              </span>
            </div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(100px,1fr))",gap:10}}>
              <MiniStat label="Win Rate" value={`${wr}%`} color={wrColor}/>
              <MiniStat label="Trades" value={ch.total_trades||0} color={BLUE}/>
              <MiniStat label="Wins" value={ch.wins||0} color={GREEN}/>
              <MiniStat label="Losses" value={ch.losses||0} color={RED}/>
              <MiniStat label="SL trafione" value={ch.sl_hits||0} color={RED}/>
              <MiniStat label="TP trafione" value={ch.tp_hits||0} color={GREEN}/>
              <MiniStat label="Avg P&L" value={fmtK(ch.avg_pnl)} color={isPos?GREEN:RED}/>
              <MiniStat label="Najlepszy" value={fmtK(ch.best_trade)} color={GREEN}/>
              <MiniStat label="Najgorszy" value={fmtK(ch.worst_trade)} color={RED}/>
            </div>
            {/* Rekomendacja */}
            <div style={{marginTop:10,padding:"6px 12px",borderRadius:6,
              background:wr>=55&&isPos?"#00ff9010":wr<40||!isPos?"#ff4d6d10":"#ffdb4d10",
              border:`1px solid ${wr>=55&&isPos?GREEN+"30":wr<40||!isPos?RED+"30":YELLOW+"30"}`,
              fontSize:11,color:wr>=55&&isPos?GREEN:wr<40||!isPos?RED:YELLOW}}>
              {wr>=55&&isPos?"✅ Warto kopiować sygnały":wr<40||!isPos?"❌ Słabe wyniki — rozważ usunięcie kanału":"⚠ Neutralne wyniki — obserwuj dalej"}
            </div>
          </div>
        );
      })}
    </div>
  );
}

const MiniStat=({label,value,color})=>(
  <div>
    <div style={{color:"#444",fontSize:9,letterSpacing:1,textTransform:"uppercase"}}>{label}</div>
    <div style={{color,fontFamily:"monospace",fontSize:13,fontWeight:600}}>{value}</div>
  </div>
);

// ─── Signal Feed ───────────────────────────────────────────────────────────────
function SignalCard({signal,channelNames}){
  const [expanded,setExpanded]=useState(false);
  const isLong=signal.signal_type==="LONG", isShort=signal.signal_type==="SHORT";
  const accent=isLong?GREEN:isShort?RED:BLUE;
  const chName=channelNames[signal.channel]||signal.channel_name||signal.channel||"?";
  return(
    <div onClick={()=>setExpanded(!expanded)} style={{
      background:CARD,border:`1px solid ${accent}22`,borderLeft:`3px solid ${accent}`,
      borderRadius:8,padding:"12px 14px",marginBottom:8,cursor:"pointer"}}>
      <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
        <span style={{color:"#fff",fontWeight:700,fontFamily:"monospace",fontSize:13}}>{signal.symbol||"???"}</span>
        <Pill label={signal.signal_type||"?"} color={accent}/>
        <span style={{color:"#333",fontSize:10,fontFamily:"monospace"}}>[{signal.entry_type||"?"}]</span>
        <span style={{marginLeft:"auto",color:"#333",fontSize:11}}>{ago(signal.timestamp)}</span>
        <span style={{color:PURPLE,fontSize:11,padding:"1px 6px",border:`1px solid ${BORDER}`,borderRadius:3}}>{chName}</span>
      </div>
      <div style={{display:"flex",gap:16,marginTop:8,flexWrap:"wrap"}}>
        <span style={{color:"#666",fontSize:11}}>Entry: <span style={{color:accent}}>
          {signal.entry_range?`$${fmt(signal.entry_range.min,4)}–$${fmt(signal.entry_range.max,4)}`:
           signal.entry_price?`$${fmt(signal.entry_price,4)}`:"—"}
        </span></span>
        <span style={{color:"#666",fontSize:11}}>SL: <span style={{color:RED+"bb"}}>{signal.stop_loss?`$${fmt(signal.stop_loss,4)}`:"—"}</span></span>
        {signal.leverage&&<span style={{color:"#666",fontSize:11}}>Dźwignia: <span style={{color:YELLOW}}>{signal.leverage}x</span></span>}
        {signal.take_profits?.length>0&&<span style={{color:"#666",fontSize:11}}>TPs: <span style={{color:GREEN+"bb"}}>{signal.take_profits.length}</span></span>}
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
          <pre style={{background:"#050810",color:"#3a4a5a",padding:10,borderRadius:6,fontSize:10,
            whiteSpace:"pre-wrap",wordBreak:"break-word",border:`1px solid ${BORDER}`,maxHeight:160,overflow:"auto",margin:0}}>
            {signal.raw_message}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Event Log ─────────────────────────────────────────────────────────────────
function EventLog({events,channelNames}){
  const colorMap={OPEN:BLUE,CLOSE:PURPLE,TP_PARTIAL:GREEN,SL_TO_BE:YELLOW,UPDATE:YELLOW,TP_HIT:GREEN};
  if(!events.length) return <div style={{color:"#333",textAlign:"center",padding:30,fontSize:13}}>Log pusty</div>;
  return events.map(e=>{
    const chName=channelNames[e.channel]||e.channel||"?";
    return(
      <div key={e.id} style={{display:"flex",gap:10,alignItems:"flex-start",
        padding:"8px 0",borderBottom:`1px solid ${BORDER}22`,fontSize:12,flexWrap:"wrap"}}>
        <Pill label={e.event_type} color={colorMap[e.event_type]||"#666"}/>
        <span style={{color:"#fff",fontFamily:"monospace",fontWeight:600,minWidth:80}}>{e.symbol}</span>
        <span style={{color:PURPLE,fontSize:11,minWidth:80}}>{chName}</span>
        <span style={{color:"#555",flex:1}}>{e.message}</span>
        <span style={{color:"#333",fontSize:11,whiteSpace:"nowrap"}}>{ago(e.timestamp)}</span>
      </div>
    );
  });
}

// ─── Tab Bar ───────────────────────────────────────────────────────────────────
const TABS=[
  {id:"portfolio",label:"📊 Portfolio"},
  {id:"open",label:"🔓 Otwarte"},
  {id:"closed",label:"🔒 Zamknięte"},
  {id:"channels",label:"📈 Kanały"},
  {id:"signals",label:"📡 Sygnały"},
  {id:"log",label:"📝 Log"},
];
function TabBar({active,onChange}){
  return(
    <div style={{display:"flex",gap:4,borderBottom:`1px solid ${BORDER}`,marginBottom:20,overflowX:"auto"}}>
      {TABS.map(t=>(
        <button key={t.id} onClick={()=>onChange(t.id)} style={{
          background:active===t.id?BLUE+"15":"transparent",
          color:active===t.id?BLUE:"#555",border:"none",
          borderBottom:active===t.id?`2px solid ${BLUE}`:"2px solid transparent",
          padding:"10px 16px",cursor:"pointer",fontFamily:"monospace",fontSize:12,fontWeight:600,whiteSpace:"nowrap"}}>
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
  useEffect(()=>{
    const load=async()=>{
      try{
        const snap=await getDocs(collection(db,"channel_names"));
        const names={};
        snap.forEach(d=>{
          const data=d.to_dict?d.to_dict():d.data();
          // doc id is channel id with - replaced by m
          const rawId=d.id.replace(/^m/,"-");
          names[rawId]=data.name;
          names[d.id]=data.name;
        });
        setChannelNames(names);
      }catch(e){console.error(e);}
    };
    load();
  },[]);

  const handleRename=async(channelId,newName)=>{
    const docId=channelId.replace("-","m").replace(/^m/,"m");
    await setDoc(doc(db,"channel_names",docId),{
      name:newName, channel:channelId, updated_at:new Date().toISOString()
    },{merge:true});
    setChannelNames(prev=>({...prev,[channelId]:newName}));
  };

  useEffect(()=>onSnapshot(doc(db,"simulation","portfolio"),snap=>{
    if(snap.exists()) setPortfolio(snap.data());
  }),[]);

  useEffect(()=>{
    const q=query(collection(db,"simulation_positions"),orderBy("opened_at","desc"),limit(100));
    return onSnapshot(q,snap=>{
      const all=snap.docs.map(d=>({id:d.id,...d.data()}));
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

  const Card=({children,color,title,count})=>(
    <div style={{background:CARD,border:`1px solid ${color||BORDER}`,borderRadius:10,padding:"16px 20px",marginBottom:20}}>
      {title&&<div style={{color:color||"#444",fontSize:11,letterSpacing:2,marginBottom:14}}>{title}{count!=null&&` (${count})`}</div>}
      {children}
    </div>
  );

  return(
    <div style={{minHeight:"100vh",background:BG,color:"#ccc",fontFamily:"'IBM Plex Mono','Fira Code',monospace",padding:"0 0 60px"}}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700;800&display=swap');
        *{box-sizing:border-box;} body{margin:0;}
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}
        ::-webkit-scrollbar{width:5px;height:5px;}
        ::-webkit-scrollbar-track{background:${BG};}
        ::-webkit-scrollbar-thumb{background:#1e2530;border-radius:3px;}
        input:focus{outline:none;}
      `}</style>

      {/* Navbar */}
      <div style={{borderBottom:`1px solid ${BORDER}`,padding:"14px 24px",display:"flex",alignItems:"center",gap:10,background:CARD}}>
        <span style={{fontSize:18}}>📡</span>
        <div>
          <span style={{color:"#fff",fontWeight:800,fontSize:14,letterSpacing:2}}>SIGNAL MONITOR</span>
          <span style={{color:"#333",fontSize:11,marginLeft:12}}>Telegram → Firebase · Simulation · $500 · 3%</span>
        </div>
        <div style={{marginLeft:"auto",display:"flex",gap:16,fontSize:11,fontFamily:"monospace"}}>
          <span style={{color:"#333"}}>Otwarte: <span style={{color:BLUE}}>{openPos.length}</span></span>
          <span style={{color:"#333"}}>Sygnały: <span style={{color:PURPLE}}>{signals.length}</span></span>
          <span style={{color:"#333"}}>Kanały: <span style={{color:ORANGE}}>{channelStats.length}</span></span>
        </div>
      </div>

      <div style={{maxWidth:1100,margin:"0 auto",padding:"24px 16px"}}>
        <TabBar active={tab} onChange={setTab}/>

        {tab==="portfolio"&&(<>
          <PortfolioHeader portfolio={portfolio}/>
          {openPos.length>0&&<Card color={BLUE} title="OTWARTE POZYCJE" count={openPos.length}>
            <PositionsTable positions={openPos} channelNames={channelNames}/>
          </Card>}
          {closedPos.length>0&&<Card color={PURPLE} title="OSTATNIE ZAMKNIĘTE" count={closedPos.length}>
            <ClosedTable positions={closedPos.slice(0,5)} channelNames={channelNames}/>
          </Card>}
        </>)}

        {tab==="open"&&<Card color={BLUE} title="OTWARTE POZYCJE" count={openPos.length}>
          <PositionsTable positions={openPos} channelNames={channelNames}/>
        </Card>}

        {tab==="closed"&&<Card color={PURPLE} title="ZAMKNIĘTE POZYCJE" count={closedPos.length}>
          <ClosedTable positions={closedPos} channelNames={channelNames}/>
        </Card>}

        {tab==="channels"&&<Card color={ORANGE} title="STATYSTYKI KANAŁÓW">
          <ChannelStats channelStats={channelStats} channelNames={channelNames} onRename={handleRename}/>
        </Card>}

        {tab==="signals"&&<div>
          <div style={{color:"#444",fontSize:11,marginBottom:14,letterSpacing:2}}>OSTATNIE SYGNAŁY ({signals.length})</div>
          {signals.map(s=><SignalCard key={s.id} signal={s} channelNames={channelNames}/>)}
        </div>}

        {tab==="log"&&<Card color="#444" title="LOG ZDARZEŃ" count={logEvents.length}>
          <EventLog events={logEvents} channelNames={channelNames}/>
        </Card>}
      </div>
    </div>
  );
}
