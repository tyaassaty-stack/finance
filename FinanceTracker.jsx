import { useState, useEffect, useCallback, useMemo } from "react";
import { AreaChart, Area, PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from "recharts";

/* ═══════════════════════════════════════════════════════════════
   CONSTANTS
═══════════════════════════════════════════════════════════════ */
const INCOME_CATS = [
  { id:"salary",            label:"Salary",            icon:"💼", color:"#34d399" },
  { id:"investment_in",     label:"Investment",        icon:"📈", color:"#2dd4bf" },
  { id:"incoming_transfer", label:"Incoming Transfer", icon:"⬇️", color:"#60a5fa" },
  { id:"other_income",      label:"Other Income",      icon:"✨", color:"#a78bfa" },
];
const EXPENSE_CATS = [
  { id:"food",              label:"Food & Beverage",   icon:"🍜", color:"#f87171" },
  { id:"transport",         label:"Transportation",    icon:"🚗", color:"#fb923c" },
  { id:"entertain",         label:"Entertainment",     icon:"🎬", color:"#fbbf24" },
  { id:"bills",             label:"Bills & Utilities", icon:"⚡", color:"#c084fc" },
  { id:"shopping",          label:"Shopping",          icon:"🛍️", color:"#f472b6" },
  { id:"health",            label:"Health",            icon:"❤️", color:"#fb7185" },
  { id:"home",              label:"Home Maintenance",  icon:"🏠", color:"#38bdf8" },
  { id:"education",         label:"Education",         icon:"📚", color:"#4ade80" },
  { id:"gifts",             label:"Gifts",             icon:"🎁", color:"#e879f9" },
  { id:"investment_out",    label:"Investment",        icon:"📊", color:"#818cf8" },
  { id:"outgoing_transfer", label:"Outgoing Transfer", icon:"⬆️", color:"#94a3b8" },
  { id:"other_expense",     label:"Other Expenses",    icon:"📦", color:"#64748b" },
];
const ALL_CATS = [...INCOME_CATS, ...EXPENSE_CATS];
const MONTHS = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
const CURRENCIES = [
  { code:"IDR", symbol:"Rp",  name:"Indonesian Rupiah" },
  { code:"USD", symbol:"$",   name:"US Dollar" },
  { code:"EUR", symbol:"€",   name:"Euro" },
  { code:"GBP", symbol:"£",   name:"British Pound" },
  { code:"SGD", symbol:"S$",  name:"Singapore Dollar" },
  { code:"MYR", symbol:"RM",  name:"Malaysian Ringgit" },
  { code:"JPY", symbol:"¥",   name:"Japanese Yen" },
  { code:"AUD", symbol:"A$",  name:"Australian Dollar" },
  { code:"CAD", symbol:"C$",  name:"Canadian Dollar" },
  { code:"CNY", symbol:"¥",   name:"Chinese Yuan" },
];
const NOW = new Date();

/* ═══════════════════════════════════════════════════════════════
   STORAGE
═══════════════════════════════════════════════════════════════ */
const KEY = "fintrack_v3";
const loadData  = async () => { try { const r = await window.storage.get(KEY); return r ? JSON.parse(r.value) : null; } catch { return null; } };
const saveData  = async (d)  => { try { await window.storage.set(KEY, JSON.stringify(d)); } catch {} };
const makeDefault = () => ({ transactions:[], budgets:{}, goals:[], currency:"IDR", recurringTemplates:[] });

/* ═══════════════════════════════════════════════════════════════
   UTILS
═══════════════════════════════════════════════════════════════ */
const catById  = (id) => ALL_CATS.find(c => c.id === id);
const isIncome = (id) => !!INCOME_CATS.find(c => c.id === id);

// IDR uses no decimals and dot-thousands; all others use standard format
const fmtFull = (n, sym, code) => {
  const abs = Math.abs(n);
  const noDecimal = code === "IDR" || code === "JPY";
  const str = abs.toLocaleString(code === "IDR" ? "id-ID" : "en-US", {
    minimumFractionDigits: noDecimal ? 0 : 2,
    maximumFractionDigits: noDecimal ? 0 : 2,
  });
  return `${sym || ""}${str}`;
};
const fmtAmt = (n, sym, code) => {
  const abs = Math.abs(n);
  const noDecimal = code === "IDR" || code === "JPY";
  if (abs >= 1_000_000_000) return `${sym}${(abs/1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000)     return `${sym}${(abs/1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)         return `${sym}${(abs/1_000).toFixed(noDecimal?0:1)}K`;
  return fmtFull(n, sym, code);
};

const monthTxs  = (txs,y,m)  => txs.filter(t => { const d=new Date(t.date); return d.getFullYear()===y && d.getMonth()===m; });
const sumIncome  = (txs)      => txs.filter(t => isIncome(t.category)).reduce((s,t) => s+t.amount,0);
const sumExpense = (txs)      => txs.filter(t => !isIncome(t.category)).reduce((s,t) => s+t.amount,0);
const prevMonth  = (y,m)      => m===0 ? [y-1,11] : [y,m-1];
const pctChange  = (cur,prev) => prev===0 ? null : Math.round((cur-prev)/prev*100);
const uid        = ()         => Date.now().toString(36)+Math.random().toString(36).slice(2,6);

/* ═══════════════════════════════════════════════════════════════
   RECOMMENDATION ENGINE
═══════════════════════════════════════════════════════════════ */
function buildInsights(data, curY, curM, sym, code) {
  const [pY,pM] = prevMonth(curY,curM);
  const cur  = monthTxs(data.transactions,curY,curM);
  const prev = monthTxs(data.transactions,pY,pM);
  const budgets = data.budgets||{};
  const curIncome=sumIncome(cur), curExpense=sumExpense(cur);
  const savingsRate = curIncome>0 ? (curIncome-curExpense)/curIncome : 0;
  const tighten=[],loosen=[],expand=[],opportunities=[];

  EXPENSE_CATS.forEach(c => {
    const ca=cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
    const pa=prev.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
    const bud=budgets[c.id]||0; const pct=bud>0?ca/bud:null; const chg=pctChange(ca,pa);
    if(!ca) return;
    if(pct!==null&&pct>0.9)   tighten.push({cat:c,curAmt:ca,budget:bud,pct,reason:pct>=1?`Over budget by ${fmtFull(ca-bud,sym,code)}`:`${Math.round(pct*100)}% of budget used`,urgency:pct>=1?"high":"medium",tip:getTightenTip(c.id)});
    else if(chg!==null&&chg>25) tighten.push({cat:c,curAmt:ca,prevAmt:pa,chg,reason:`Up ${chg}% vs last month`,urgency:chg>50?"high":"medium",tip:getTightenTip(c.id)});
    else if(curExpense>0&&ca/curExpense>0.25&&!tighten.find(x=>x.cat.id===c.id)) tighten.push({cat:c,curAmt:ca,reason:`${Math.round(ca/curExpense*100)}% of total spending`,urgency:"low",tip:getTightenTip(c.id)});
    if(bud>0&&pct!==null&&pct<0.5) loosen.push({cat:c,curAmt:ca,budget:bud,pct,reason:`Only ${Math.round(pct*100)}% used — ${fmtFull(bud-ca,sym,code)} headroom`,tip:getLoosenTip(c.id)});
  });

  INCOME_CATS.forEach(c => {
    const ca=cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
    const pa=prev.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
    if(c.id==="salary"&&ca>0&&INCOME_CATS.filter(ic=>cur.find(t=>t.category===ic.id)).length===1)
      expand.push({cat:c,curAmt:ca,reason:"Salary is your only income source",tip:"Consider adding investment or freelance income.",urgency:"medium"});
    if(c.id==="investment_in"&&ca===0)
      expand.push({cat:c,curAmt:0,reason:"No investment income this month",tip:"Even a small monthly investment compounds over time.",urgency:"low"});
    if(pa>0&&ca<pa*0.8)
      expand.push({cat:c,curAmt:ca,prevAmt:pa,reason:`Down ${Math.abs(pctChange(ca,pa))}% vs last month`,tip:`Look into stabilising your ${c.label.toLowerCase()}.`,urgency:"high"});
  });

  if(savingsRate<0.1&&curIncome>0) opportunities.push({icon:"🎯",title:"Savings Rate Below 10%",detail:`You're saving ${Math.round(savingsRate*100)}% of income. Target 20%+.`,urgency:"high"});
  if(savingsRate>=0.2) opportunities.push({icon:"🚀",title:"Great Savings Rate!",detail:`${Math.round(savingsRate*100)}% saved this month. Consider moving surplus to investments.`,urgency:"positive"});
  const top=EXPENSE_CATS.map(c=>({c,amt:cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0)})).sort((a,b)=>b.amt-a.amt)[0];
  if(top&&top.amt>0&&curExpense>0&&top.amt/curExpense>0.3) {
    const s=Math.round(top.amt*0.15);
    opportunities.push({icon:"✂️",title:`Cut ${top.c.label} by 15%`,detail:`Save ${fmtFull(s,sym,code)}/month — ${fmtFull(s*12,sym,code)}/year.`,urgency:"medium"});
  }
  if(sumExpense(prev)>0&&curExpense<sumExpense(prev)) opportunities.push({icon:"📉",title:"Expenses Down From Last Month",detail:`You spent ${fmtFull(sumExpense(prev)-curExpense,sym,code)} less than last month.`,urgency:"positive"});

  return {tighten:tighten.slice(0,5),loosen:loosen.slice(0,4),expand:expand.slice(0,4),opportunities:opportunities.slice(0,4),savingsRate};
}
const getTightenTip = id => ({food:"Meal-prep 3×/week saves 20–30%.",transport:"Combine errands or use transit passes.",entertain:"Set a weekly cash envelope for entertainment.",bills:"Audit subscriptions — cancel anything unused 60+ days.",shopping:"Apply a 48-hour rule before non-essential purchases.",health:"Check if preventive care is covered by insurance.",home:"Batch small fixes into one maintenance day.",gifts:"Set per-person gift budgets at the year's start.",investment_out:"Review portfolio fees — 0.5% difference compounds a lot."}[id]||"Review recent transactions and identify non-essentials.");
const getLoosenTip  = id => ({health:"Consider preventive check-ups or dental.",education:"Use the budget for an online course or certification."}[id]||"You're well within budget — room to spend freely if needed.");

function buildSummary(data, curY, curM, sym, code) {
  const [pY,pM]=prevMonth(curY,curM);
  const cur=monthTxs(data.transactions,curY,curM), prev=monthTxs(data.transactions,pY,pM);
  const ci=sumIncome(cur), ce=sumExpense(cur), pe=sumExpense(prev);
  if(!cur.length) return [{type:"neutral",text:"No transactions yet this month. Tap + to add your first one."}];
  const net=ci-ce; const chg=pctChange(ce,pe);
  const lines=[
    {type:net>=0?"positive":"negative",text:net>=0?`You're ${fmtFull(net,sym,code)} ahead — income covers all expenses.`:`You're ${fmtFull(Math.abs(net),sym,code)} in the red — expenses exceed income.`},
  ];
  if(chg!==null) lines.push({type:chg>0?"warning":"positive",text:chg>0?`Spending up ${chg}% vs last month — watch your top categories.`:`Spending down ${Math.abs(chg)}% vs last month — great discipline.`});
  const top=EXPENSE_CATS.map(c=>({c,amt:cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0)})).sort((a,b)=>b.amt-a.amt)[0];
  if(top?.amt>0) lines.push({type:"neutral",text:`${top.c.icon} ${top.c.label} is your biggest expense at ${fmtFull(top.amt,sym,code)} (${ce>0?Math.round(top.amt/ce*100):0}% of spending).`});
  return lines.slice(0,3);
}

/* ═══════════════════════════════════════════════════════════════
   ROOT APP
═══════════════════════════════════════════════════════════════ */
export default function App() {
  const [data,setData]     = useState(null);
  const [view,setView]     = useState("home");
  const [selY,setSelY]     = useState(NOW.getFullYear());
  const [selM,setSelM]     = useState(NOW.getMonth());
  const [modal,setModal]   = useState(null);
  const [toast,setToast]   = useState(null);
  const [drillCat,setDrillCat] = useState(null);

  useEffect(()=>{ loadData().then(d=>setData(d||makeDefault())); },[]);
  const persist = useCallback(async(next)=>{ setData(next); await saveData(next); },[]);
  const showToast = (msg,type="ok")=>{ setToast({msg,type}); setTimeout(()=>setToast(null),2800); };

  const currObj = useMemo(()=> CURRENCIES.find(c=>c.code===(data?.currency||"IDR"))||CURRENCIES[0], [data?.currency]);
  const sym  = currObj.symbol;
  const code = currObj.code;

  const cur  = useMemo(()=> data ? monthTxs(data.transactions,selY,selM) : [], [data,selY,selM]);
  const [pY,pM] = prevMonth(selY,selM);
  const prev = useMemo(()=> data ? monthTxs(data.transactions,pY,pM) : [], [data,pY,pM]);
  const totalIncome  = sumIncome(cur);
  const totalExpense = sumExpense(cur);
  const balance      = totalIncome - totalExpense;

  const openModal=(type,payload=null)=>setModal({type,payload});
  const closeModal=()=>setModal(null);

  const saveTx=(tx)=>{
    const txs=modal?.payload?.id ? data.transactions.map(t=>t.id===modal.payload.id?tx:t) : [tx,...data.transactions];
    persist({...data,transactions:txs}); closeModal(); showToast(modal?.payload?.id?"Transaction updated":"Transaction added");
  };
  const deleteTx=(id)=>{ persist({...data,transactions:data.transactions.filter(t=>t.id!==id)}); closeModal(); showToast("Deleted"); };

  if(!data) return (
    <div style={{minHeight:"100vh",background:"#030d07",display:"flex",alignItems:"center",justifyContent:"center"}}>
      <div style={{fontFamily:"'Sora',sans-serif",color:"#10b981",fontSize:16}}>Loading…</div>
    </div>
  );

  const insights = buildInsights(data,selY,selM,sym,code);

  return (
    <div style={{fontFamily:"'Plus Jakarta Sans',sans-serif",background:"#030d07",minHeight:"100vh",color:"#d1fae5"}}>
      <Styles/>
      <div style={{display:"flex"}}>
        <Sidebar view={view} setView={setView} selY={selY} selM={selM} setSelY={setSelY} setSelM={setSelM}
          onAdd={()=>openModal("tx",null)} data={data} sym={sym} code={code}
          onSettings={()=>openModal("settings")} balance={balance}/>

        <main style={{marginLeft:245,flex:1,minHeight:"100vh",padding:"36px 32px 80px"}}>
          {view==="home"     && <MyMonth cur={cur} prev={prev} balance={balance} totalIncome={totalIncome} totalExpense={totalExpense} data={data} selY={selY} selM={selM} sym={sym} code={code} insights={insights} onEditTx={tx=>openModal("tx",tx)} onAdd={()=>openModal("tx",null)} onGoals={()=>openModal("goals")}/>}
          {view==="spending" && <Spending cur={cur} prev={prev} data={data} selY={selY} selM={selM} sym={sym} code={code} totalExpense={totalExpense} drillCat={drillCat} setDrillCat={setDrillCat} onEditTx={tx=>openModal("tx",tx)} onBudgets={()=>openModal("budgets")}/>}
          {view==="budget"   && <BudgetPage data={data} cur={cur} selY={selY} selM={selM} sym={sym} code={code} totalExpense={totalExpense} onSaveBudgets={b=>{ persist({...data,budgets:b}); showToast("Budgets saved"); }}/>}
          {view==="insights" && <Insights insights={insights} data={data} cur={cur} prev={prev} selY={selY} selM={selM} sym={sym} code={code} totalIncome={totalIncome} totalExpense={totalExpense}/>}
        </main>

        <button className="fab" onClick={()=>openModal("tx",null)}>＋</button>
      </div>

      {modal?.type==="tx"       && <TxModal tx={modal.payload} onClose={closeModal} onSave={saveTx} onDelete={deleteTx} selY={selY} selM={selM} sym={sym} code={code}/>}
      {modal?.type==="budgets"  && <BudgetModal budgets={data.budgets} onClose={closeModal} onSave={b=>{ persist({...data,budgets:b}); closeModal(); showToast("Budgets saved"); }} sym={sym} code={code}/>}
      {modal?.type==="goals"    && <GoalsModal goals={data.goals} onClose={closeModal} onSave={g=>{ persist({...data,goals:g}); closeModal(); showToast("Goals updated"); }} sym={sym} code={code}/>}
      {modal?.type==="settings" && <SettingsModal currency={data.currency} onClose={closeModal} onSave={c=>{ persist({...data,currency:c}); closeModal(); showToast("Settings saved"); }}/>}

      {toast && <div className={`toast toast-${toast.type}`}>{toast.type==="ok"?"✓":"✗"} {toast.msg}</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SIDEBAR
═══════════════════════════════════════════════════════════════ */
function Sidebar({view,setView,selY,selM,setSelY,setSelM,onAdd,sym,code,onSettings,balance}) {
  const nav=[
    {id:"home",    icon:"◉", label:"My Month"},
    {id:"spending",icon:"◎", label:"Spending"},
    {id:"budget",  icon:"🎯", label:"Budget"},
    {id:"insights",icon:"◈", label:"Insights"},
  ];
  const go=(dir)=>{ const d=new Date(selY,selM+dir); setSelM(d.getMonth()); setSelY(d.getFullYear()); };
  return (
    <aside style={{width:245,background:"rgba(3,13,7,0.98)",borderRight:"1px solid rgba(16,185,129,0.1)",position:"fixed",height:"100vh",display:"flex",flexDirection:"column",zIndex:20}}>
      {/* Logo */}
      <div style={{padding:"26px 20px 0"}}>
        <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:26}}>
          <div style={{width:38,height:38,borderRadius:12,background:"linear-gradient(135deg,#10b981,#059669)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,boxShadow:"0 4px 16px rgba(16,185,129,0.35)"}}>💰</div>
          <div>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:16,color:"#d1fae5",letterSpacing:"-0.02em"}}>FinTrack</div>
            <div style={{fontSize:10,color:"#2d6b50",marginTop:1}}>Smart Finance</div>
          </div>
        </div>

        {/* Period */}
        <div style={{background:"rgba(16,185,129,0.07)",border:"1px solid rgba(16,185,129,0.15)",borderRadius:14,padding:"12px 14px",marginBottom:22}}>
          <div style={{fontSize:10,color:"#2d6b50",textTransform:"uppercase",letterSpacing:"0.08em",marginBottom:8}}>Period</div>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}>
            <button className="nav-arrow" onClick={()=>go(-1)}>‹</button>
            <span style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:14,color:"#d1fae5"}}>{MONTHS[selM]} {selY}</span>
            <button className="nav-arrow" onClick={()=>go(1)}>›</button>
          </div>
          <div style={{marginTop:10,paddingTop:10,borderTop:"1px solid rgba(16,185,129,0.1)"}}>
            <div style={{fontSize:10,color:"#2d6b50",marginBottom:3}}>Net Balance</div>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:20,color:balance>=0?"#34d399":"#f87171"}}>
              {balance<0?"-":""}{fmtFull(Math.abs(balance),sym,code)}
            </div>
          </div>
        </div>
      </div>

      <nav style={{flex:1,padding:"0 10px"}}>
        {nav.map(item=>(
          <button key={item.id} className={`nav-item ${view===item.id?"active":""}`} onClick={()=>setView(item.id)}>
            <span style={{fontSize:15,width:20,textAlign:"center"}}>{item.icon}</span>
            <span>{item.label}</span>
          </button>
        ))}
      </nav>

      <div style={{padding:"10px 12px 24px",display:"flex",flexDirection:"column",gap:8}}>
        <button className="nav-item" onClick={onSettings} style={{opacity:0.55}}>
          <span>⚙️</span><span style={{fontSize:13}}>Settings</span>
        </button>
        <button className="btn-mint" onClick={onAdd}>＋ Add Transaction</button>
      </div>
    </aside>
  );
}

/* ═══════════════════════════════════════════════════════════════
   MY MONTH
═══════════════════════════════════════════════════════════════ */
function MyMonth({cur,prev,balance,totalIncome,totalExpense,data,selY,selM,sym,code,insights,onEditTx,onAdd,onGoals}) {
  const incChg=pctChange(totalIncome,sumIncome(prev));
  const expChg=pctChange(totalExpense,sumExpense(prev));
  const savRate=totalIncome>0?Math.round((balance/totalIncome)*100):0;
  const summary=buildSummary(data,selY,selM,sym,code);
  const grouped={};
  [...cur].sort((a,b)=>b.date.localeCompare(a.date)).forEach(tx=>{
    if(!grouped[tx.date]) grouped[tx.date]=[];
    grouped[tx.date].push(tx);
  });
  const goals=data.goals||[];

  return (
    <div className="view-enter">
      <PageHeader label="This Month" title="My Month" subtitle={`${MONTHS[selM]} ${selY}`}/>

      {/* RECAP */}
      <div className="recap-card">
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:20,marginBottom:22}}>
          <div>
            <div style={{fontSize:11,color:"#2d6b50",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>Net Balance</div>
            <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:28,color:balance>=0?"#34d399":"#f87171",lineHeight:1}}>
              {balance<0?"-":""}{fmtFull(Math.abs(balance),sym,code)}
            </div>
            <div style={{fontSize:12,color:"#2d6b50",marginTop:6}}>{balance>=0?"✓ Income covers expenses":"⚠ Overspent this month"}</div>
          </div>
          <MetricBlock label="Income" value={totalIncome} change={incChg} color="#34d399" sym={sym} code={code} sign="+"/>
          <MetricBlock label="Expenses" value={totalExpense} change={expChg} color="#f87171" sym={sym} code={code} sign="-"/>
        </div>
        <div style={{background:"rgba(0,0,0,0.3)",borderRadius:12,padding:"14px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:8}}>
            <span style={{fontSize:12,color:"#4d8068"}}>Savings Rate</span>
            <span style={{fontSize:13,fontFamily:"'Sora',sans-serif",fontWeight:700,color:savRate>=20?"#34d399":savRate>=10?"#fbbf24":"#f87171"}}>{totalIncome>0?`${savRate}%`:"—"}</span>
          </div>
          <div style={{height:8,borderRadius:99,background:"rgba(255,255,255,0.06)",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:99,width:`${Math.min(100,Math.max(0,savRate))}%`,background:savRate>=20?"linear-gradient(90deg,#10b981,#059669)":savRate>=10?"linear-gradient(90deg,#fbbf24,#f59e0b)":"linear-gradient(90deg,#f87171,#ef4444)",transition:"width 0.6s ease"}}/>
          </div>
          <div style={{fontSize:11,color:"#1a4a32",marginTop:6}}>Target: 20% · {savRate<20?`${fmtFull(totalIncome*0.2-balance,sym,code)} more needed`:"You're on target! 🎉"}</div>
        </div>
      </div>

      {/* SMART SUMMARY */}
      <div style={{marginBottom:20}}>
        {summary.map((line,i)=>(
          <div key={i} className={`summary-line summary-${line.type}`}>
            <span style={{fontSize:14,flexShrink:0}}>{line.type==="positive"?"✦":line.type==="warning"?"▲":"◉"}</span>
            <span style={{fontSize:13,lineHeight:1.5}}>{line.text}</span>
          </div>
        ))}
      </div>

      {/* GOALS */}
      {goals.length>0&&(
        <div className="section-card" style={{marginBottom:20}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:16}}>
            <SectionTitle icon="🎯" title="Savings Goals"/>
            <button className="link-btn" onClick={onGoals}>Manage</button>
          </div>
          {goals.map(g=>{const pct=Math.min(100,Math.round(g.saved/g.target*100));return(
            <div key={g.id} style={{marginBottom:12}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
                <span style={{fontSize:13,color:"#d1fae5",fontWeight:500}}>{g.icon} {g.name}</span>
                <span style={{fontSize:12,color:"#4d8068"}}>{fmtAmt(g.saved,sym,code)} / {fmtAmt(g.target,sym,code)}</span>
              </div>
              <div style={{height:6,borderRadius:99,background:"rgba(255,255,255,0.06)",overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:"linear-gradient(90deg,#10b981,#34d399)",transition:"width 0.6s"}}/>
              </div>
              <div style={{fontSize:10,color:"#1a4a32",marginTop:3}}>{pct}% of goal reached</div>
            </div>
          );})}
        </div>
      )}
      {goals.length===0&&<button className="ghost-cta" onClick={onGoals} style={{marginBottom:20}}>🎯 Set a savings goal — track progress here</button>}

      {/* TIMELINE */}
      <div className="section-card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <SectionTitle icon="↕" title="Transaction History"/>
          <button className="link-btn" onClick={onAdd}>+ Add</button>
        </div>
        {Object.keys(grouped).length===0
          ? <EmptyState msg="No transactions yet — tap + to add your first" onAction={onAdd} actionLabel="Add Transaction"/>
          : Object.keys(grouped).map(date=>(
            <div key={date} style={{marginBottom:16}}>
              <div style={{fontSize:11,color:"#1a4a32",fontWeight:600,letterSpacing:"0.05em",marginBottom:8,paddingBottom:6,borderBottom:"1px solid rgba(16,185,129,0.07)"}}>{formatDate(date)}</div>
              {grouped[date].map(tx=><TxRow key={tx.id} tx={tx} sym={sym} code={code} onClick={()=>onEditTx(tx)}/>)}
            </div>
          ))
        }
      </div>
    </div>
  );
}

function MetricBlock({label,value,change,color,sym,code,sign}) {
  return (
    <div>
      <div style={{fontSize:11,color:"#2d6b50",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:6}}>{label}</div>
      <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:20,color,lineHeight:1}}>{sign}{fmtFull(value,sym,code)}</div>
      {change!==null
        ? <div style={{fontSize:11,marginTop:6,color:(label==="Income"?change>=0:change<=0)?"#34d399":"#f87171"}}>{change>0?"▲":"▼"} {Math.abs(change)}% vs last month</div>
        : <div style={{fontSize:11,marginTop:6,color:"#1a4a32"}}>No prior data</div>}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BUDGET PAGE (new dedicated view)
═══════════════════════════════════════════════════════════════ */
function BudgetPage({data,cur,selY,selM,sym,code,totalExpense,onSaveBudgets}) {
  const [budgets,setBudgets] = useState({...( data.budgets||{} )});
  const [dirty,setDirty]     = useState(false);
  const [editingId,setEditingId] = useState(null);

  // reset when month changes or data reloads
  useEffect(()=>{ setBudgets({...(data.budgets||{})}); setDirty(false); },[data.budgets]);

  const setValue=(id,val)=>{
    setBudgets(b=>({...b,[id]:val===""?0:parseFloat(val)||0}));
    setDirty(true);
  };

  const totalBudget = EXPENSE_CATS.reduce((s,c)=>s+(budgets[c.id]||0),0);
  const overallPct  = totalBudget>0?Math.min(100,Math.round(totalExpense/totalBudget*100)):0;
  const totalRemaining = totalBudget - totalExpense;

  return (
    <div className="view-enter">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:28}}>
        <PageHeader label="Planning" title="Monthly Budget" subtitle={`${MONTHS[selM]} ${selY}`}/>
        {dirty&&<button className="btn-mint" style={{padding:"9px 20px"}} onClick={()=>{onSaveBudgets(budgets);setDirty(false);}}>💾 Save Budgets</button>}
      </div>

      {/* OVERVIEW SUMMARY */}
      <div className="recap-card" style={{marginBottom:20}}>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:20,marginBottom:18}}>
          {[
            {label:"Total Budget",   val:fmtAmt(totalBudget,sym,code),    color:"#34d399"},
            {label:"Total Spent",    val:fmtAmt(totalExpense,sym,code),   color:"#f87171"},
            {label:"Remaining",      val:fmtAmt(Math.abs(totalRemaining),sym,code), color:totalRemaining>=0?"#34d399":"#f87171", prefix:totalRemaining<0?"-":""},
            {label:"Budget Used",    val:totalBudget>0?`${overallPct}%`:"—", color:overallPct>100?"#f87171":overallPct>80?"#fbbf24":"#34d399"},
          ].map(({label,val,color,prefix=""})=>(
            <div key={label}>
              <div style={{fontSize:11,color:"#2d6b50",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>{label}</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:22,color}}>{prefix}{val}</div>
            </div>
          ))}
        </div>
        <div style={{height:10,borderRadius:99,background:"rgba(0,0,0,0.3)",overflow:"hidden"}}>
          <div style={{height:"100%",borderRadius:99,width:`${overallPct}%`,background:overallPct>100?"linear-gradient(90deg,#f87171,#ef4444)":overallPct>80?"linear-gradient(90deg,#fbbf24,#f59e0b)":"linear-gradient(90deg,#10b981,#34d399)",transition:"width 0.6s"}}/>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
          <span style={{fontSize:11,color:"#1a4a32"}}>{totalBudget===0?"Set budgets below to start tracking":"Overall budget utilization"}</span>
          <span style={{fontSize:11,color:"#1a4a32"}}>{overallPct>100?"⚠ Over budget":overallPct>80?"⚡ Almost at limit":"✓ On track"}</span>
        </div>
      </div>

      {/* CATEGORY TABLE */}
      <div className="section-card">
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:18}}>
          <SectionTitle icon="📋" title="Category Budgets & Remaining Saldo"/>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-ghost" style={{padding:"6px 12px",fontSize:12}} onClick={()=>{const z={};EXPENSE_CATS.forEach(c=>z[c.id]=0);setBudgets(z);setDirty(true);}}>Clear All</button>
            {dirty&&<span style={{fontSize:11,color:"#10b981",display:"flex",alignItems:"center",gap:4}}>● Unsaved changes</span>}
          </div>
        </div>

        {/* Header row */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 160px 140px 140px 100px",gap:8,padding:"8px 12px",background:"rgba(16,185,129,0.05)",borderRadius:10,marginBottom:8}}>
          {["Category","Monthly Budget","Spent","Remaining Saldo","Used %"].map(h=>(
            <div key={h} style={{fontSize:10,color:"#2d6b50",fontWeight:700,textTransform:"uppercase",letterSpacing:"0.06em"}}>{h}</div>
          ))}
        </div>

        {/* Category rows */}
        {EXPENSE_CATS.map(c=>{
          const spent   = cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
          const budget  = budgets[c.id]||0;
          const remaining = budget - spent;
          const pct     = budget>0?Math.min(100,Math.round(spent/budget*100)):null;
          const over    = budget>0&&spent>budget;
          const isEditing = editingId===c.id;
          return (
            <div key={c.id} style={{display:"grid",gridTemplateColumns:"1fr 160px 140px 140px 100px",gap:8,padding:"10px 12px",borderRadius:12,marginBottom:4,background:over?"rgba(248,113,113,0.04)":isEditing?"rgba(16,185,129,0.04)":"transparent",border:`1px solid ${over?"rgba(248,113,113,0.15)":isEditing?"rgba(16,185,129,0.15)":"transparent"}`,transition:"all 0.15s"}}>
              {/* Category */}
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:34,height:34,borderRadius:9,background:`${c.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:17,flexShrink:0}}>{c.icon}</div>
                <span style={{fontSize:13,fontWeight:500,color:"#d1fae5"}}>{c.label}</span>
              </div>
              {/* Budget input */}
              <div style={{display:"flex",alignItems:"center"}}>
                <div style={{position:"relative",width:"100%"}} onClick={()=>setEditingId(c.id)}>
                  <span style={{position:"absolute",left:10,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#2d6b50",pointerEvents:"none"}}>{sym}</span>
                  <input
                    className="input-field budget-input"
                    type="number" min="0" step={code==="IDR"?"1000":"1"}
                    placeholder="0"
                    value={budgets[c.id]||""}
                    onChange={e=>setValue(c.id,e.target.value)}
                    onFocus={()=>setEditingId(c.id)}
                    onBlur={()=>setEditingId(null)}
                    style={{paddingLeft:28,paddingTop:8,paddingBottom:8,fontSize:13,fontWeight:600,color:"#d1fae5"}}
                  />
                </div>
              </div>
              {/* Spent */}
              <div style={{display:"flex",alignItems:"center"}}>
                <span style={{fontSize:13,fontWeight:600,color:spent>0?"#f87171":"#1a4a32"}}>{spent>0?fmtFull(spent,sym,code):"—"}</span>
              </div>
              {/* Remaining saldo */}
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                {budget===0
                  ? <span style={{fontSize:12,color:"#1a4a32"}}>No budget set</span>
                  : <>
                      <span style={{fontSize:13,fontWeight:700,color:over?"#f87171":"#34d399"}}>{over?"-":""}{fmtFull(Math.abs(remaining),sym,code)}</span>
                      {over&&<span style={{fontSize:10,background:"rgba(248,113,113,0.15)",color:"#f87171",padding:"2px 6px",borderRadius:99,fontWeight:700}}>OVER</span>}
                    </>
                }
              </div>
              {/* % used */}
              <div style={{display:"flex",flexDirection:"column",justifyContent:"center",gap:4}}>
                {pct!==null
                  ? <>
                      <span style={{fontSize:13,fontWeight:700,color:over?"#f87171":pct>80?"#fbbf24":"#34d399"}}>{pct}%</span>
                      <div style={{height:4,borderRadius:99,background:"rgba(255,255,255,0.06)",overflow:"hidden"}}>
                        <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:over?"#f87171":pct>80?"#fbbf24":c.color,transition:"width 0.4s"}}/>
                      </div>
                    </>
                  : <span style={{fontSize:11,color:"#1a4a32"}}>—</span>
                }
              </div>
            </div>
          );
        })}

        {/* Total footer */}
        <div style={{display:"grid",gridTemplateColumns:"1fr 160px 140px 140px 100px",gap:8,padding:"14px 12px",marginTop:8,borderTop:"1px solid rgba(16,185,129,0.12)",background:"rgba(16,185,129,0.04)",borderRadius:12}}>
          <div style={{fontSize:13,fontWeight:700,color:"#10b981"}}>TOTAL</div>
          <div style={{fontSize:13,fontWeight:700,color:"#d1fae5"}}>{fmtFull(totalBudget,sym,code)}</div>
          <div style={{fontSize:13,fontWeight:700,color:"#f87171"}}>{fmtFull(totalExpense,sym,code)}</div>
          <div style={{fontSize:13,fontWeight:700,color:totalRemaining>=0?"#34d399":"#f87171"}}>
            {totalRemaining<0?"-":""}{fmtFull(Math.abs(totalRemaining),sym,code)}
          </div>
          <div style={{fontSize:13,fontWeight:700,color:overallPct>100?"#f87171":overallPct>80?"#fbbf24":"#34d399"}}>{totalBudget>0?`${overallPct}%`:"—"}</div>
        </div>
      </div>

      {dirty&&(
        <div style={{position:"fixed",bottom:28,left:"50%",transform:"translateX(-50%)",background:"rgba(16,185,129,0.95)",borderRadius:14,padding:"12px 28px",display:"flex",alignItems:"center",gap:14,boxShadow:"0 8px 32px rgba(16,185,129,0.3)",zIndex:40}}>
          <span style={{fontSize:14,fontWeight:700,color:"#011a0f"}}>You have unsaved budget changes</span>
          <button onClick={()=>{onSaveBudgets(budgets);setDirty(false);}} style={{background:"#011a0f",border:"none",color:"#34d399",borderRadius:10,padding:"7px 16px",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:13}}>Save Now</button>
        </div>
      )}
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SPENDING
═══════════════════════════════════════════════════════════════ */
function Spending({cur,prev,data,selY,selM,sym,code,totalExpense,drillCat,setDrillCat,onEditTx,onBudgets}) {
  const budgets=data.budgets||{};
  const catData=EXPENSE_CATS.map(c=>{
    const ca=cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
    const pa=prev.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0);
    const bud=budgets[c.id]||0;
    return {...c,curAmt:ca,prevAmt:pa,budget:bud,pct:bud>0?ca/bud:0,chg:pctChange(ca,pa)};
  }).sort((a,b)=>b.curAmt-a.curAmt);
  const activeData=catData.filter(c=>c.curAmt>0);
  const pieData=activeData.slice(0,6);
  const totalBudget=Object.values(budgets).reduce((s,v)=>s+(v||0),0);
  const overallPct=totalBudget>0?Math.round(totalExpense/totalBudget*100):null;
  const drillTxs=drillCat?[...cur.filter(t=>t.category===drillCat)].sort((a,b)=>b.date.localeCompare(a.date)):[];
  const drillInfo=drillCat?catData.find(c=>c.id===drillCat):null;

  return (
    <div className="view-enter">
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-end",marginBottom:28}}>
        <PageHeader label="Categories" title="Spending"/>
        <button className="btn-mint" style={{padding:"9px 18px"}} onClick={onBudgets}>✏️ Set Budgets</button>
      </div>

      {overallPct!==null&&(
        <div className="recap-card" style={{marginBottom:20,padding:"18px 24px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
            <div>
              <div style={{fontSize:11,color:"#2d6b50",textTransform:"uppercase",letterSpacing:"0.07em",marginBottom:4}}>Total Budget Used</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:26,color:overallPct>100?"#f87171":overallPct>80?"#fbbf24":"#34d399"}}>{overallPct}%</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:12,color:"#2d6b50"}}>Spent</div>
              <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:18,color:"#f87171"}}>{fmtFull(totalExpense,sym,code)}</div>
              <div style={{fontSize:11,color:"#1a4a32"}}>of {fmtFull(totalBudget,sym,code)}</div>
            </div>
          </div>
          <div style={{height:10,borderRadius:99,background:"rgba(0,0,0,0.3)",overflow:"hidden"}}>
            <div style={{height:"100%",borderRadius:99,width:`${Math.min(100,overallPct)}%`,background:overallPct>100?"linear-gradient(90deg,#f87171,#ef4444)":overallPct>80?"linear-gradient(90deg,#fbbf24,#f59e0b)":"linear-gradient(90deg,#10b981,#34d399)",transition:"width 0.6s"}}/>
          </div>
          <div style={{display:"flex",justifyContent:"space-between",marginTop:8}}>
            <span style={{fontSize:11,color:"#1a4a32"}}>Remaining: <strong style={{color:totalBudget-totalExpense>=0?"#34d399":"#f87171"}}>{fmtFull(Math.abs(totalBudget-totalExpense),sym,code)}</strong></span>
            <span style={{fontSize:11,color:"#1a4a32"}}>{overallPct>100?"⚠ Over budget":overallPct>80?"⚡ Almost there":"✓ On track"}</span>
          </div>
        </div>
      )}

      <div style={{display:"grid",gridTemplateColumns:"1fr 260px",gap:20,alignItems:"start"}}>
        <div className="section-card">
          <SectionTitle icon="◎" title="Category Breakdown"/>
          <div style={{marginTop:16,display:"flex",flexDirection:"column",gap:4}}>
            {activeData.length===0?<EmptyState msg="No expenses this month"/>:activeData.map(c=>(
              <CatRow key={c.id} c={c} totalExpense={totalExpense} sym={sym} code={code} active={drillCat===c.id} onClick={()=>setDrillCat(drillCat===c.id?null:c.id)}/>
            ))}
            {catData.filter(c=>c.curAmt===0).length>0&&(
              <div style={{marginTop:8,paddingTop:8,borderTop:"1px solid rgba(16,185,129,0.06)",fontSize:12,color:"#1a4a32"}}>
                {catData.filter(c=>c.curAmt===0).length} categories with no activity
              </div>
            )}
          </div>
        </div>

        <div style={{display:"flex",flexDirection:"column",gap:16}}>
          {pieData.length>0&&(
            <div className="section-card" style={{padding:"18px 16px"}}>
              <div style={{fontSize:12,fontWeight:600,color:"#4d8068",marginBottom:12}}>Share of Expenses</div>
              <ResponsiveContainer width="100%" height={140}>
                <PieChart>
                  <Pie data={pieData} dataKey="curAmt" cx="50%" cy="50%" innerRadius={38} outerRadius={62} strokeWidth={0}>
                    {pieData.map((c,i)=><Cell key={i} fill={c.color} opacity={drillCat&&drillCat!==c.id?0.25:1}/>)}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              {pieData.map(c=>(
                <div key={c.id} style={{display:"flex",alignItems:"center",gap:6,marginBottom:5}}>
                  <div style={{width:7,height:7,borderRadius:"50%",background:c.color,flexShrink:0}}/>
                  <span style={{fontSize:11,color:"#4d8068",flex:1}}>{c.label}</span>
                  <span style={{fontSize:11,fontWeight:600,color:"#d1fae5"}}>{totalExpense>0?Math.round(c.curAmt/totalExpense*100):0}%</span>
                </div>
              ))}
            </div>
          )}

          {drillCat&&drillInfo&&(
            <div className="section-card" style={{padding:"18px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:14}}>
                <div style={{fontSize:13,fontWeight:700,color:"#d1fae5"}}>{drillInfo.icon} {drillInfo.label}</div>
                <button onClick={()=>setDrillCat(null)} style={{background:"none",border:"none",color:"#2d6b50",cursor:"pointer",fontSize:16}}>×</button>
              </div>
              <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:22,color:drillInfo.color,marginBottom:4}}>{fmtFull(drillInfo.curAmt,sym,code)}</div>
              {drillInfo.chg!==null&&<div style={{fontSize:11,color:drillInfo.chg>0?"#f87171":"#34d399",marginBottom:12}}>{drillInfo.chg>0?"▲":"▼"} {Math.abs(drillInfo.chg)}% vs last month</div>}
              {drillInfo.budget>0&&(
                <div style={{marginBottom:12,padding:"8px 10px",background:"rgba(16,185,129,0.06)",borderRadius:8}}>
                  <div style={{fontSize:11,color:"#2d6b50",marginBottom:4}}>Remaining Saldo</div>
                  <div style={{fontSize:16,fontWeight:700,color:drillInfo.curAmt>drillInfo.budget?"#f87171":"#34d399"}}>
                    {drillInfo.curAmt>drillInfo.budget?"-":""}{fmtFull(Math.abs(drillInfo.budget-drillInfo.curAmt),sym,code)}
                  </div>
                </div>
              )}
              <div style={{display:"flex",flexDirection:"column",gap:2}}>
                {drillTxs.slice(0,8).map(tx=>(
                  <div key={tx.id} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"7px 0",borderBottom:"1px solid rgba(16,185,129,0.06)",cursor:"pointer"}} onClick={()=>onEditTx(tx)}>
                    <span style={{color:"#4d8068"}}>{tx.note||drillInfo.label} · {formatDate(tx.date,true)}</span>
                    <span style={{color:"#f87171",fontWeight:600}}>{fmtFull(tx.amount,sym,code)}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CatRow({c,totalExpense,sym,code,active,onClick}) {
  const pct=c.budget>0?Math.min(100,Math.round(c.pct*100)):null;
  const share=totalExpense>0?Math.round(c.curAmt/totalExpense*100):0;
  const over=pct!==null&&c.curAmt>c.budget;
  return (
    <div className={`cat-row ${active?"cat-row-active":""}`} onClick={onClick}>
      <div style={{display:"flex",alignItems:"center",gap:10,minWidth:0}}>
        <div style={{width:36,height:36,borderRadius:10,background:`${c.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{c.icon}</div>
        <div style={{minWidth:0,flex:1}}>
          <div style={{display:"flex",justifyContent:"space-between",marginBottom:5}}>
            <span style={{fontSize:13,fontWeight:500,color:"#d1fae5",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.label}</span>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}>
              {c.chg!==null&&<span style={{fontSize:10,color:c.chg>0?"#f87171":"#34d399"}}>{c.chg>0?"▲":"▼"}{Math.abs(c.chg)}%</span>}
              <span style={{fontSize:13,fontWeight:700,color:"#f87171"}}>{fmtFull(c.curAmt,sym,code)}</span>
            </div>
          </div>
          {pct!==null?(
            <div>
              <div style={{height:4,borderRadius:99,background:"rgba(255,255,255,0.06)",overflow:"hidden"}}>
                <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:over?"#f87171":c.color,transition:"width 0.5s"}}/>
              </div>
              <div style={{display:"flex",justifyContent:"space-between",marginTop:3}}>
                <span style={{fontSize:10,color:"#1a4a32"}}>{pct}% of budget{over?" ⚠":""}</span>
                <span style={{fontSize:10,color:"#1a4a32"}}>{share}% of spend</span>
              </div>
            </div>
          ):(
            <div style={{fontSize:10,color:"#1a4a32"}}>{share}% of total spending · No budget set</div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   INSIGHTS
═══════════════════════════════════════════════════════════════ */
function Insights({insights,data,cur,prev,selY,selM,sym,code,totalIncome,totalExpense}) {
  const {tighten,loosen,expand,opportunities,savingsRate}=insights;
  const trendData=Array.from({length:6},(_,i)=>{
    const d=new Date(selY,selM-(5-i));
    const txs=monthTxs(data.transactions,d.getFullYear(),d.getMonth());
    return {name:MONTHS[d.getMonth()],income:sumIncome(txs),expense:sumExpense(txs)};
  });
  const incomeSources=INCOME_CATS.map(c=>({...c,amt:cur.filter(t=>t.category===c.id).reduce((s,t)=>s+t.amount,0)})).filter(c=>c.amt>0);

  return (
    <div className="view-enter">
      <PageHeader label="AI Analysis" title="Insights" subtitle={`${MONTHS[selM]} ${selY}`}/>

      {opportunities.length>0&&(
        <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:24}}>
          {opportunities.map((o,i)=>(
            <div key={i} className={`opp-card opp-${o.urgency}`}>
              <span style={{fontSize:22,flexShrink:0}}>{o.icon}</span>
              <div>
                <div style={{fontSize:13,fontWeight:700,color:"#d1fae5",marginBottom:3}}>{o.title}</div>
                <div style={{fontSize:12,color:"#4d8068",lineHeight:1.5}}>{o.detail}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 6-month trend */}
      <div className="section-card" style={{marginBottom:20}}>
        <SectionTitle icon="📈" title="6-Month Trend"/>
        <div style={{marginTop:16}}>
          <ResponsiveContainer width="100%" height={180}>
            <AreaChart data={trendData}>
              <defs>
                <linearGradient id="gi" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#10b981" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                </linearGradient>
                <linearGradient id="ge" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%"  stopColor="#f87171" stopOpacity={0.3}/>
                  <stop offset="95%" stopColor="#f87171" stopOpacity={0}/>
                </linearGradient>
              </defs>
              <XAxis dataKey="name" tick={{fill:"#1a4a32",fontSize:11}} axisLine={false} tickLine={false}/>
              <YAxis tick={{fill:"#1a4a32",fontSize:10}} axisLine={false} tickLine={false} tickFormatter={v=>fmtAmt(v,sym,code)} width={60}/>
              <Tooltip contentStyle={{background:"#061a12",border:"1px solid rgba(16,185,129,0.2)",borderRadius:10,color:"#d1fae5",fontSize:12}} formatter={(v,n)=>[fmtFull(v,sym,code),n.charAt(0).toUpperCase()+n.slice(1)]}/>
              <Area type="monotone" dataKey="income"  stroke="#10b981" fill="url(#gi)" strokeWidth={2} name="income"/>
              <Area type="monotone" dataKey="expense" stroke="#f87171" fill="url(#ge)" strokeWidth={2} name="expense"/>
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:20,marginBottom:20}}>
        <div className="section-card">
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
            <span style={{fontSize:18}}>✂️</span>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#f87171"}}>Tighten These</div>
              <div style={{fontSize:11,color:"#1a4a32"}}>Review & reduce</div>
            </div>
          </div>
          {tighten.length===0?<div style={{fontSize:13,color:"#1a4a32",textAlign:"center",padding:"16px 0"}}>✓ All categories look healthy</div>
          :tighten.map((item,i)=><InsightItem key={i} item={item} type="tighten" sym={sym} code={code}/>)}
        </div>
        <div className="section-card">
          <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
            <span style={{fontSize:18}}>✅</span>
            <div>
              <div style={{fontSize:14,fontWeight:700,color:"#34d399"}}>Comfortable</div>
              <div style={{fontSize:11,color:"#1a4a32"}}>Well within budget</div>
            </div>
          </div>
          {loosen.length===0?<div style={{fontSize:13,color:"#1a4a32",textAlign:"center",padding:"16px 0"}}>Set budgets to see headroom</div>
          :loosen.map((item,i)=><InsightItem key={i} item={item} type="loosen" sym={sym} code={code}/>)}
        </div>
      </div>

      <div className="section-card" style={{marginBottom:20}}>
        <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:16}}>
          <span style={{fontSize:18}}>🚀</span>
          <div>
            <div style={{fontSize:14,fontWeight:700,color:"#34d399"}}>Expand Income</div>
            <div style={{fontSize:11,color:"#1a4a32"}}>Growth opportunities</div>
          </div>
        </div>
        {expand.length===0?<div style={{fontSize:13,color:"#1a4a32",padding:"8px 0"}}>✓ Income streams look diversified this month.</div>
        :expand.map((item,i)=><InsightItem key={i} item={item} type="expand" sym={sym} code={code}/>)}
        {incomeSources.length>0&&(
          <div style={{marginTop:16,paddingTop:16,borderTop:"1px solid rgba(16,185,129,0.08)"}}>
            <div style={{fontSize:12,color:"#2d6b50",marginBottom:10}}>Income Composition</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(150px,1fr))",gap:8}}>
              {incomeSources.map(c=>(
                <div key={c.id} style={{background:`${c.color}0f`,border:`1px solid ${c.color}22`,borderRadius:10,padding:"10px 12px"}}>
                  <div style={{fontSize:12,color:"#4d8068",marginBottom:4}}>{c.icon} {c.label}</div>
                  <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:15,color:c.color}}>{fmtFull(c.amt,sym,code)}</div>
                  <div style={{fontSize:10,color:"#1a4a32"}}>{totalIncome>0?Math.round(c.amt/totalIncome*100):0}% of income</div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="section-card">
        <SectionTitle icon="💡" title="Financial Health Score"/>
        <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginTop:16}}>
          <HealthMetric label="Savings Rate" value={`${Math.round(savingsRate*100)}%`} target="20%+" status={savingsRate>=0.2?"good":savingsRate>=0.1?"warn":"bad"}/>
          <HealthMetric label="Income Sources" value={`${incomeSources.length}`} target="2+ ideal" status={incomeSources.length>=2?"good":incomeSources.length===1?"warn":"bad"}/>
          <HealthMetric label="Budget Coverage" value={`${EXPENSE_CATS.filter(c=>(data.budgets||{})[c.id]>0).length}/12`} target="All cats" status={EXPENSE_CATS.filter(c=>(data.budgets||{})[c.id]>0).length>=8?"good":EXPENSE_CATS.filter(c=>(data.budgets||{})[c.id]>0).length>=4?"warn":"bad"}/>
        </div>
      </div>
    </div>
  );
}

function InsightItem({item,type,sym,code}) {
  const [open,setOpen]=useState(false);
  const accent=type==="tighten"?"#f87171":type==="loosen"?"#34d399":"#34d399";
  return (
    <div style={{marginBottom:8,borderRadius:10,border:`1px solid ${accent}18`,overflow:"hidden"}}>
      <div style={{display:"flex",alignItems:"center",gap:10,padding:"10px 12px",cursor:"pointer",background:`${accent}06`}} onClick={()=>setOpen(!open)}>
        <div style={{width:30,height:30,borderRadius:8,background:`${item.cat.color}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16,flexShrink:0}}>{item.cat.icon}</div>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontSize:12,fontWeight:600,color:"#d1fae5"}}>{item.cat.label}</div>
          <div style={{fontSize:11,color:"#2d6b50"}}>{item.reason}</div>
        </div>
        <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0}}>
          {item.urgency&&item.urgency!=="low"&&<span style={{fontSize:9,fontWeight:700,padding:"2px 6px",borderRadius:99,background:item.urgency==="high"?"rgba(239,68,68,0.15)":"rgba(251,191,36,0.15)",color:item.urgency==="high"?"#f87171":"#fbbf24",textTransform:"uppercase"}}>{item.urgency}</span>}
          <span style={{fontSize:11,color:"#1a4a32"}}>{open?"▲":"▼"}</span>
        </div>
      </div>
      {open&&<div style={{padding:"10px 12px",background:"rgba(0,0,0,0.2)",borderTop:`1px solid ${accent}12`}}><div style={{fontSize:12,color:"#4d8068",lineHeight:1.6}}>💡 {item.tip}</div></div>}
    </div>
  );
}

function HealthMetric({label,value,target,status}) {
  const colors={good:"#34d399",warn:"#fbbf24",bad:"#f87171"};
  return (
    <div style={{background:"rgba(0,0,0,0.2)",borderRadius:12,padding:"14px",border:`1px solid ${colors[status]}22`}}>
      <div style={{fontSize:10,color:"#1a4a32",textTransform:"uppercase",letterSpacing:"0.06em",marginBottom:6}}>{label}</div>
      <div style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:22,color:colors[status],marginBottom:4}}>{value}</div>
      <div style={{fontSize:10,color:"#1a4a32"}}>{target}</div>
    </div>
  );
}

/* ═══════════════════════════════════════════════════════════════
   TX MODAL
═══════════════════════════════════════════════════════════════ */
function TxModal({tx,onClose,onSave,onDelete,selY,selM,sym,code}) {
  const today=new Date(selY,selM,Math.min(new Date().getDate(),new Date(selY,selM+1,0).getDate()));
  const todayStr=today.toISOString().split("T")[0];
  const initType=tx?(isIncome(tx.category)?"income":"expense"):"expense";
  const [type,setType]         = useState(initType);
  const [category,setCategory] = useState(tx?.category||"food");
  const [amount,setAmount]     = useState(tx?.amount?.toString()||"");
  const [note,setNote]         = useState(tx?.note||"");
  const [date,setDate]         = useState(tx?.date||todayStr);
  const [recurring,setRecurring]=useState(tx?.recurring||false);
  const cats=type==="income"?INCOME_CATS:EXPENSE_CATS;

  useEffect(()=>{ if(!cats.find(c=>c.id===category)) setCategory(cats[0].id); },[type]);
  const valid=amount&&!isNaN(parseFloat(amount))&&parseFloat(amount)>0;
  const handleSave=()=>{ if(!valid) return; onSave({id:tx?.id||uid(),category,amount:parseFloat(amount),note,date,recurring}); };

  return (
    <ModalWrap onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <h2 style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:20,color:"#d1fae5"}}>{tx?"Edit Transaction":"New Transaction"}</h2>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#2d6b50",cursor:"pointer",fontSize:22,lineHeight:1}}>×</button>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:20}}>
        {[["expense","Expense","#f87171"],["income","Income","#34d399"]].map(([v,l,c])=>(
          <button key={v} onClick={()=>setType(v)} style={{padding:"11px",border:`1.5px solid ${type===v?c:"rgba(255,255,255,0.07)"}`,borderRadius:12,background:type===v?`${c}18`:"transparent",color:type===v?c:"#2d6b50",cursor:"pointer",fontFamily:"inherit",fontWeight:700,fontSize:14,transition:"all 0.15s"}}>{l}</button>
        ))}
      </div>
      <div style={{marginBottom:18}}>
        <label style={{fontSize:11,color:"#2d6b50",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Amount</label>
        <div style={{position:"relative"}}>
          <span style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",fontSize:14,color:"#2d6b50",fontFamily:"'Sora',sans-serif"}}>{sym}</span>
          <input className="input-field" type="number" min="0" step={code==="IDR"?"1000":"0.01"} placeholder="0" value={amount} onChange={e=>setAmount(e.target.value)}
            style={{paddingLeft:sym.length>1?36:28,fontSize:24,fontWeight:800,fontFamily:"'Sora',sans-serif",color:type==="income"?"#34d399":"#f87171"}} autoFocus/>
        </div>
      </div>
      <div style={{marginBottom:18}}>
        <label style={{fontSize:11,color:"#2d6b50",display:"block",marginBottom:8,textTransform:"uppercase",letterSpacing:"0.06em"}}>Category</label>
        <div style={{display:"grid",gridTemplateColumns:"repeat(4,1fr)",gap:6}}>
          {cats.map(c=>(
            <button key={c.id} onClick={()=>setCategory(c.id)} title={c.label}
              style={{padding:"10px 4px 8px",border:`1.5px solid ${category===c.id?c.color:"rgba(255,255,255,0.07)"}`,borderRadius:10,background:category===c.id?`${c.color}18`:"rgba(255,255,255,0.02)",cursor:"pointer",display:"flex",flexDirection:"column",alignItems:"center",gap:3,transition:"all 0.15s"}}>
              <span style={{fontSize:18}}>{c.icon}</span>
              <span style={{fontSize:9,color:category===c.id?c.color:"#1a4a32",textAlign:"center",lineHeight:1.2,fontWeight:600}}>{c.label}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:14}}>
        <div>
          <label style={{fontSize:11,color:"#2d6b50",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Note</label>
          <input className="input-field" type="text" placeholder="Optional note…" value={note} onChange={e=>setNote(e.target.value)}/>
        </div>
        <div>
          <label style={{fontSize:11,color:"#2d6b50",display:"block",marginBottom:6,textTransform:"uppercase",letterSpacing:"0.06em"}}>Date</label>
          <input className="input-field" type="date" value={date} onChange={e=>setDate(e.target.value)}/>
        </div>
      </div>
      <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:22,padding:"10px 14px",background:"rgba(16,185,129,0.05)",borderRadius:10,border:"1px solid rgba(16,185,129,0.1)",cursor:"pointer"}} onClick={()=>setRecurring(!recurring)}>
        <div style={{width:36,height:20,borderRadius:99,background:recurring?"#10b981":"rgba(255,255,255,0.08)",position:"relative",transition:"background 0.2s",flexShrink:0}}>
          <div style={{width:16,height:16,borderRadius:"50%",background:"white",position:"absolute",top:2,left:recurring?18:2,transition:"left 0.2s"}}/>
        </div>
        <div>
          <div style={{fontSize:12,fontWeight:600,color:"#4d8068"}}>Recurring Monthly</div>
          <div style={{fontSize:10,color:"#1a4a32"}}>Mark as a monthly fixed transaction</div>
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        {tx&&onDelete&&<button className="btn-danger" onClick={()=>onDelete(tx.id)}>Delete</button>}
        <button className="btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
        <button className="btn-mint" style={{flex:2,opacity:valid?1:0.4}} onClick={handleSave} disabled={!valid}>{tx?"Save Changes":"Add Transaction"}</button>
      </div>
    </ModalWrap>
  );
}

/* ═══════════════════════════════════════════════════════════════
   BUDGET MODAL (quick modal from Spending page)
═══════════════════════════════════════════════════════════════ */
function BudgetModal({budgets,onClose,onSave,sym,code}) {
  const [vals,setVals]=useState({...budgets});
  return (
    <ModalWrap onClose={onClose} wide>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <h2 style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:20,color:"#d1fae5"}}>Set Monthly Budgets</h2>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#2d6b50",cursor:"pointer",fontSize:22}}>×</button>
      </div>
      <p style={{fontSize:13,color:"#2d6b50",marginBottom:20}}>Set spending limits per category. Blank or 0 means no limit.</p>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10,marginBottom:24}}>
        {EXPENSE_CATS.map(c=>(
          <div key={c.id} style={{display:"flex",alignItems:"center",gap:10,background:"rgba(255,255,255,0.02)",borderRadius:10,padding:"10px 12px",border:"1px solid rgba(16,185,129,0.08)"}}>
            <span style={{fontSize:20,flexShrink:0}}>{c.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{fontSize:11,color:"#4d8068",marginBottom:4,whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{c.label}</div>
              <div style={{position:"relative"}}>
                <span style={{position:"absolute",left:8,top:"50%",transform:"translateY(-50%)",fontSize:11,color:"#1a4a32"}}>{sym}</span>
                <input className="input-field" type="number" min="0" step={code==="IDR"?"1000":"1"} placeholder="0" value={vals[c.id]||""}
                  onChange={e=>setVals(v=>({...v,[c.id]:e.target.value?parseFloat(e.target.value):0}))}
                  style={{paddingLeft:sym.length>1?28:20,padding:`7px 10px 7px ${sym.length>1?28:20}px`,fontSize:13,fontWeight:600}}/>
              </div>
            </div>
          </div>
        ))}
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
        <button className="btn-mint" style={{flex:2}} onClick={()=>onSave(vals)}>Save Budgets</button>
      </div>
    </ModalWrap>
  );
}

/* ═══════════════════════════════════════════════════════════════
   GOALS MODAL
═══════════════════════════════════════════════════════════════ */
const GOAL_ICONS=["🏠","🚗","✈️","💍","🎓","📱","💻","🏖️","🏥","🎯","💰","🌟"];
function GoalsModal({goals,onClose,onSave,sym,code}) {
  const [list,setList]=useState([...goals]);
  const [adding,setAdding]=useState(false);
  const [form,setForm]=useState({name:"",target:"",saved:"",icon:"🎯"});
  const addGoal=()=>{
    if(!form.name||!form.target) return;
    setList(l=>[...l,{id:uid(),name:form.name,target:parseFloat(form.target),saved:parseFloat(form.saved||0),icon:form.icon}]);
    setForm({name:"",target:"",saved:"",icon:"🎯"}); setAdding(false);
  };
  return (
    <ModalWrap onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <h2 style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:20,color:"#d1fae5"}}>Savings Goals</h2>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#2d6b50",cursor:"pointer",fontSize:22}}>×</button>
      </div>
      <div style={{display:"flex",flexDirection:"column",gap:10,marginBottom:16}}>
        {list.map(g=>{const pct=Math.min(100,Math.round(g.saved/g.target*100));return(
          <div key={g.id} style={{display:"flex",alignItems:"center",gap:12,background:"rgba(16,185,129,0.04)",borderRadius:12,padding:"12px 14px",border:"1px solid rgba(16,185,129,0.1)"}}>
            <span style={{fontSize:24}}>{g.icon}</span>
            <div style={{flex:1,minWidth:0}}>
              <div style={{display:"flex",justifyContent:"space-between",marginBottom:4}}>
                <span style={{fontSize:13,fontWeight:600,color:"#d1fae5"}}>{g.name}</span>
                <span style={{fontSize:12,color:"#10b981",fontWeight:700}}>{pct}%</span>
              </div>
              <div style={{height:5,borderRadius:99,background:"rgba(255,255,255,0.06)",overflow:"hidden",marginBottom:4}}>
                <div style={{height:"100%",borderRadius:99,width:`${pct}%`,background:"linear-gradient(90deg,#10b981,#34d399)"}}/>
              </div>
              <div style={{fontSize:11,color:"#1a4a32"}}>{fmtFull(g.saved,sym,code)} saved of {fmtFull(g.target,sym,code)}</div>
            </div>
            <button onClick={()=>setList(l=>l.filter(x=>x.id!==g.id))} style={{background:"none",border:"none",color:"#1a4a32",cursor:"pointer",fontSize:16}}>×</button>
          </div>
        );})}
        {list.length===0&&!adding&&<EmptyState msg="No goals yet"/>}
      </div>
      {adding?(
        <div style={{background:"rgba(16,185,129,0.04)",border:"1px solid rgba(16,185,129,0.15)",borderRadius:14,padding:"16px",marginBottom:14}}>
          <div style={{display:"flex",gap:6,flexWrap:"wrap",marginBottom:12}}>
            {GOAL_ICONS.map(ic=><button key={ic} onClick={()=>setForm(f=>({...f,icon:ic}))} style={{fontSize:20,background:form.icon===ic?"rgba(16,185,129,0.15)":"transparent",border:"1px solid",borderColor:form.icon===ic?"#10b981":"transparent",borderRadius:8,padding:"4px 6px",cursor:"pointer"}}>{ic}</button>)}
          </div>
          <input className="input-field" placeholder="Goal name (e.g. Vacation)" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))} style={{marginBottom:8}}/>
          <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8,marginBottom:12}}>
            <input className="input-field" type="number" placeholder={`Target (${sym})`} value={form.target} onChange={e=>setForm(f=>({...f,target:e.target.value}))}/>
            <input className="input-field" type="number" placeholder={`Already saved`} value={form.saved} onChange={e=>setForm(f=>({...f,saved:e.target.value}))}/>
          </div>
          <div style={{display:"flex",gap:8}}>
            <button className="btn-ghost" style={{flex:1}} onClick={()=>setAdding(false)}>Cancel</button>
            <button className="btn-mint" style={{flex:2}} onClick={addGoal}>Add Goal</button>
          </div>
        </div>
      ):(
        <button className="ghost-cta" onClick={()=>setAdding(true)} style={{marginBottom:14}}>+ Add New Goal</button>
      )}
      <div style={{display:"flex",gap:8}}>
        <button className="btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
        <button className="btn-mint" style={{flex:2}} onClick={()=>onSave(list)}>Save Goals</button>
      </div>
    </ModalWrap>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SETTINGS MODAL
═══════════════════════════════════════════════════════════════ */
function SettingsModal({currency,onClose,onSave}) {
  const [cur,setCur]=useState(currency||"IDR");
  return (
    <ModalWrap onClose={onClose}>
      <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:22}}>
        <h2 style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:20,color:"#d1fae5"}}>Settings</h2>
        <button onClick={onClose} style={{background:"none",border:"none",color:"#2d6b50",cursor:"pointer",fontSize:22}}>×</button>
      </div>
      <div style={{marginBottom:20}}>
        <label style={{fontSize:11,color:"#2d6b50",display:"block",marginBottom:10,textTransform:"uppercase",letterSpacing:"0.06em"}}>Currency</label>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
          {CURRENCIES.map(c=>(
            <button key={c.code} onClick={()=>setCur(c.code)}
              style={{padding:"10px 12px",border:`1.5px solid ${cur===c.code?"#10b981":"rgba(255,255,255,0.07)"}`,borderRadius:10,background:cur===c.code?"rgba(16,185,129,0.1)":"rgba(255,255,255,0.02)",color:cur===c.code?"#d1fae5":"#2d6b50",cursor:"pointer",fontFamily:"inherit",fontSize:13,fontWeight:500,display:"flex",gap:8,alignItems:"center",transition:"all 0.15s"}}>
              <span style={{fontWeight:800,fontSize:14,minWidth:20}}>{c.symbol}</span>
              <span>{c.code} — {c.name}</span>
            </button>
          ))}
        </div>
      </div>
      <div style={{display:"flex",gap:8}}>
        <button className="btn-ghost" style={{flex:1}} onClick={onClose}>Cancel</button>
        <button className="btn-mint" style={{flex:2}} onClick={()=>onSave(cur)}>Save Settings</button>
      </div>
    </ModalWrap>
  );
}

/* ═══════════════════════════════════════════════════════════════
   SHARED COMPONENTS
═══════════════════════════════════════════════════════════════ */
function ModalWrap({children,onClose,wide}) {
  return (
    <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.8)",display:"flex",alignItems:"center",justifyContent:"center",zIndex:100,backdropFilter:"blur(6px)",animation:"fadeIn 0.18s ease"}}
      onClick={e=>{if(e.target===e.currentTarget) onClose();}}>
      <div style={{background:"#071510",border:"1px solid rgba(16,185,129,0.15)",borderRadius:22,padding:28,width:wide?580:440,maxWidth:"95vw",animation:"slideUp 0.22s ease",maxHeight:"92vh",overflowY:"auto"}}>
        {children}
      </div>
    </div>
  );
}

function TxRow({tx,sym,code,onClick}) {
  const cat=catById(tx.category); const inc=isIncome(tx.category);
  return (
    <div style={{display:"flex",alignItems:"center",gap:12,padding:"11px 8px",borderRadius:10,cursor:"pointer",transition:"background 0.12s"}}
      onMouseEnter={e=>e.currentTarget.style.background="rgba(16,185,129,0.04)"}
      onMouseLeave={e=>e.currentTarget.style.background="transparent"}
      onClick={onClick}>
      <div style={{width:38,height:38,borderRadius:10,background:`${cat?.color||"#64748b"}18`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>{cat?.icon}</div>
      <div style={{flex:1,minWidth:0}}>
        <div style={{fontSize:13,fontWeight:500,color:"#d1fae5",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{tx.note||cat?.label}</div>
        <div style={{fontSize:11,color:"#1a4a32"}}>{cat?.label}{tx.recurring?" · 🔁":""}</div>
      </div>
      <div style={{fontFamily:"'Sora',sans-serif",fontWeight:700,fontSize:15,color:inc?"#34d399":"#f87171",flexShrink:0}}>{inc?"+":"-"}{fmtFull(tx.amount,sym,code)}</div>
    </div>
  );
}

function PageHeader({label,title,subtitle}) {
  return (
    <div style={{marginBottom:28}}>
      <div style={{fontSize:11,color:"#1a4a32",textTransform:"uppercase",letterSpacing:"0.1em",marginBottom:6}}>{label}</div>
      <div style={{display:"flex",alignItems:"baseline",gap:12}}>
        <h1 style={{fontFamily:"'Sora',sans-serif",fontWeight:800,fontSize:30,color:"#d1fae5",margin:0,letterSpacing:"-0.02em"}}>{title}</h1>
        {subtitle&&<span style={{fontSize:13,color:"#2d6b50"}}>{subtitle}</span>}
      </div>
    </div>
  );
}

function SectionTitle({icon,title}) {
  return <div style={{display:"flex",alignItems:"center",gap:8,fontSize:14,fontWeight:700,color:"#a7f3d0"}}><span>{icon}</span>{title}</div>;
}

function EmptyState({msg,onAction,actionLabel}) {
  return (
    <div style={{textAlign:"center",padding:"28px 0",color:"#1a4a32"}}>
      <div style={{fontSize:32,marginBottom:10}}>📭</div>
      <div style={{fontSize:13,marginBottom:onAction?12:0}}>{msg}</div>
      {onAction&&<button className="btn-mint" style={{padding:"8px 20px"}} onClick={onAction}>{actionLabel}</button>}
    </div>
  );
}

function formatDate(dateStr,short=false) {
  const d=new Date(dateStr+"T12:00:00");
  if(short) return d.toLocaleDateString("en-US",{month:"short",day:"numeric"});
  const today=new Date(); today.setHours(0,0,0,0);
  const yesterday=new Date(today); yesterday.setDate(yesterday.getDate()-1);
  const dDay=new Date(d); dDay.setHours(0,0,0,0);
  if(dDay.getTime()===today.getTime()) return "Today";
  if(dDay.getTime()===yesterday.getTime()) return "Yesterday";
  return d.toLocaleDateString("en-US",{weekday:"short",month:"short",day:"numeric"});
}

/* ═══════════════════════════════════════════════════════════════
   GLOBAL STYLES — MINT GREEN THEME
═══════════════════════════════════════════════════════════════ */
function Styles() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@300;400;500;600;700;800&family=Sora:wght@300;400;600;700;800&display=swap');
      *, *::before, *::after { box-sizing:border-box; margin:0; padding:0; }
      ::-webkit-scrollbar { width:4px; }
      ::-webkit-scrollbar-track { background:transparent; }
      ::-webkit-scrollbar-thumb { background:rgba(16,185,129,0.2); border-radius:99px; }

      .view-enter { animation:fadeSlide 0.28s ease both; }
      @keyframes fadeSlide { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      @keyframes fadeIn    { from{opacity:0} to{opacity:1} }
      @keyframes slideUp   { from{opacity:0;transform:translateY(16px)} to{opacity:1;transform:translateY(0)} }

      /* Sidebar nav */
      .nav-item { display:flex;align-items:center;gap:10;width:100%;padding:11px 14px;background:transparent;border:none;color:#2d6b50;cursor:pointer;border-radius:12px;margin-bottom:3px;font-family:inherit;font-size:14px;font-weight:500;border-left:2px solid transparent;text-align:left;transition:all 0.15s ease; }
      .nav-item:hover  { background:rgba(16,185,129,0.07); color:#6ee7b7; }
      .nav-item.active { background:rgba(16,185,129,0.12); color:#34d399; border-left-color:#10b981; }
      .nav-arrow { background:none;border:1px solid rgba(16,185,129,0.15);color:#2d6b50;border-radius:6px;padding:2px 8px;cursor:pointer;font-size:14px;transition:all 0.15s; }
      .nav-arrow:hover { border-color:#10b981;color:#10b981; }

      /* Cards */
      .recap-card { background:linear-gradient(135deg,rgba(7,25,15,0.95),rgba(5,15,10,0.95));border:1px solid rgba(16,185,129,0.2);border-radius:20px;padding:28px;margin-bottom:20px;position:relative;overflow:hidden; }
      .recap-card::before { content:'';position:absolute;top:-40px;right:-40px;width:220px;height:220px;background:radial-gradient(circle,rgba(16,185,129,0.08) 0%,transparent 70%);pointer-events:none; }
      .section-card { background:rgba(7,21,13,0.85);border:1px solid rgba(16,185,129,0.1);border-radius:18px;padding:22px; }

      /* Summary lines */
      .summary-line     { display:flex;align-items:flex-start;gap:10;padding:10px 14px;border-radius:10px;margin-bottom:8px; }
      .summary-positive { background:rgba(16,185,129,0.08);border:1px solid rgba(16,185,129,0.15);color:#6ee7b7; }
      .summary-warning  { background:rgba(251,191,36,0.07);border:1px solid rgba(251,191,36,0.12);color:#fcd34d; }
      .summary-negative { background:rgba(248,113,113,0.07);border:1px solid rgba(248,113,113,0.12);color:#fca5a5; }
      .summary-neutral  { background:rgba(16,185,129,0.03);border:1px solid rgba(16,185,129,0.08);color:#4d8068; }

      /* Opportunity cards */
      .opp-card     { display:flex;align-items:flex-start;gap:14;padding:14px 18px;border-radius:14px; }
      .opp-high     { background:rgba(239,68,68,0.07);  border:1px solid rgba(239,68,68,0.15);  }
      .opp-medium   { background:rgba(251,191,36,0.07); border:1px solid rgba(251,191,36,0.12); }
      .opp-low      { background:rgba(16,185,129,0.05); border:1px solid rgba(16,185,129,0.1);  }
      .opp-positive { background:rgba(16,185,129,0.08); border:1px solid rgba(16,185,129,0.15); }

      /* Category rows */
      .cat-row        { padding:10px 8px;border-radius:12px;cursor:pointer;transition:background 0.12s;border:1px solid transparent; }
      .cat-row:hover  { background:rgba(16,185,129,0.04); }
      .cat-row-active { background:rgba(16,185,129,0.07);border-color:rgba(16,185,129,0.18); }

      /* Inputs */
      .input-field { background:rgba(16,185,129,0.04);border:1px solid rgba(16,185,129,0.12);border-radius:10px;padding:10px 14px;color:#d1fae5;font-family:inherit;font-size:14px;width:100%;outline:none;transition:border 0.15s; }
      .input-field:focus { border-color:#10b981;background:rgba(16,185,129,0.07); }
      .input-field option { background:#071510; }
      .budget-input { text-align:right; }

      /* Buttons */
      .btn-mint  { background:linear-gradient(135deg,#10b981,#059669);border:none;color:#011a0f;border-radius:12px;padding:11px 22px;cursor:pointer;font-family:inherit;font-weight:800;font-size:14px;transition:all 0.18s;letter-spacing:-0.01em; }
      .btn-mint:hover  { transform:translateY(-1px);box-shadow:0 6px 20px rgba(16,185,129,0.35); }
      .btn-ghost { background:transparent;border:1px solid rgba(16,185,129,0.15);color:#2d6b50;border-radius:12px;padding:10px 18px;cursor:pointer;font-family:inherit;font-size:14px;transition:all 0.15s; }
      .btn-ghost:hover { border-color:rgba(16,185,129,0.35);color:#34d399; }
      .btn-danger { background:rgba(239,68,68,0.1);border:1px solid rgba(239,68,68,0.2);color:#f87171;border-radius:12px;padding:10px 16px;cursor:pointer;font-family:inherit;font-size:14px;transition:all 0.15s; }
      .btn-danger:hover { background:rgba(239,68,68,0.18); }
      .link-btn { background:none;border:none;color:#10b981;cursor:pointer;font-family:inherit;font-size:12px;font-weight:600;padding:0;transition:opacity 0.15s; }
      .link-btn:hover { opacity:0.7; }
      .ghost-cta { width:100%;padding:14px;background:transparent;border:1.5px dashed rgba(16,185,129,0.2);border-radius:14px;color:#2d6b50;cursor:pointer;font-family:inherit;font-size:13px;transition:all 0.15s;display:block; }
      .ghost-cta:hover { border-color:rgba(16,185,129,0.5);color:#34d399;background:rgba(16,185,129,0.04); }

      /* FAB */
      .fab { position:fixed;bottom:28px;right:28px;width:54px;height:54px;border-radius:50%;background:linear-gradient(135deg,#10b981,#059669);border:none;color:#011a0f;font-size:24px;font-weight:800;cursor:pointer;box-shadow:0 6px 24px rgba(16,185,129,0.45);transition:all 0.2s;z-index:50;display:flex;align-items:center;justify-content:center; }
      .fab:hover { transform:scale(1.08) translateY(-2px);box-shadow:0 10px 32px rgba(16,185,129,0.55); }

      /* Toast */
      .toast     { position:fixed;bottom:24px;left:50%;transform:translateX(-50%);background:#061a12;border:1px solid rgba(16,185,129,0.2);border-radius:12px;padding:10px 22px;font-size:13px;font-weight:600;z-index:200;animation:slideUp 0.2s ease;box-shadow:0 8px 28px rgba(0,0,0,0.4);white-space:nowrap; }
      .toast-ok  { color:#34d399;border-color:rgba(52,211,153,0.25); }
      .toast-err { color:#f87171;border-color:rgba(248,113,113,0.25); }
    `}</style>
  );
}
