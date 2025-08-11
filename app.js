// app.js（変更あり）
import { A4, getKeys, makeExerciseAll, letterFreqWithAcc } from "./scales.js";
import { renderTwoBars } from "./score.js";

const $ = (s)=>document.querySelector(s);
const $$ = (s)=>document.querySelectorAll(s);
const clamp=(x,a,b)=>Math.min(b,Math.max(a,x));
const now=()=>performance.now();

const errors = new Set();
function pushErr(msg){ const line = `${new Date().toISOString()} : ${msg}`; if(!errors.has(line)) errors.add(line); }
function showToast(msg,type="info",tiny=false){
  const t=$("#toast"); if(!t) return;
  t.textContent = msg; t.className = tiny?`show tiny ${type}`:`show ${type}`;
  setTimeout(()=>{ t.className=""; }, 2000);
}

// 0.5秒で戻すフラッシュ
let flashTimer=0;
function hudFlash(color="rgba(34,197,94,.45)", intensity=1){
  const el=$("#hud-flash");
  el.style.background = color;
  el.style.opacity = String(Math.min(0.55, 0.25 + 0.30*intensity));
  el.classList.add("show");
  clearTimeout(flashTimer);
  flashTimer = setTimeout(()=>{
    el.classList.remove("show");
    el.style.background = "transparent";
    el.style.opacity = "0";
  }, 500);
}

// DOM
const ui = {
  scaleType: $$('input[name="scaleType"]'),
  level: $$('input[name="level"]'),
  keySel: $("#key-select"),
  diffSel: $("#difficulty"),
  db: $("#db-indicator"),
  ver: $("#app-version"),

  start: $("#start"), stop: $("#stop"), game: $("#game"),

  bigScore: $("#big-score"), advice: $("#advice"),
  bar: $("#cents-bar"), barNeedle: $("#bar-needle"),

  staffWrap: $("#staff-wrap"), spark: $("#spark"),
  prog: $("#prog"), pageLabel: $("#page-label"),

  gate: $("#gate"),
  result: $("#result"), praise: $("#praise"), details: $("#details"),
  again: $("#again"), close: $("#close"),

  noSleep: $("#nosleep"),

  modeName: $("#mode-name"), timer: $("#timer"),
};

// 状態
const difficultyToCents = { "s-easy":9, easy:7, normal:5, hard:3, oni:2 };
let state = {
  visible: document.visibilityState === "visible",
  running: false,
  mode: "scale",
  stream: null,
  ac: null,
  analyser: null,
  source: null,
  hpf: null, peak: null,
  buf: null,
  lastT: 0,
  scaleType: "major",
  level: "intermediate",
  key: null,
  notes: [],
  total: 0,
  totalBars: 0,
  offset: 0,
  idx: 0,
  lockUntil: 0,
  passRecorded: [],
  rmsThresh: 0.0015,
  diffCents: difficultyToCents[$("#difficulty").value],
  rafId: 0,
  startClock: 0,
  endClock: 0,
};

// ===== 可視・離脱監視：即停止（iOS対策の監視タイマ付き） =====
function stopAllTracks(){ try{ state.stream?.getTracks?.().forEach(t=>{ try{ t.stop(); }catch{} }); }catch{} }
function closeAudio(){ try{ state.ac?.suspend?.(); }catch{} try{ state.ac?.close?.(); }catch{} }
function hardStop(reason=""){
  try{ cancelAnimationFrame(state.rafId); }catch{}
  try{ state.source?.disconnect(); state.hpf?.disconnect(); state.peak?.disconnect(); }catch{}
  stopAllTracks(); closeAudio();
  state.stream = null; state.ac=null; state.analyser=null; state.buf=null;
  state.source=null; state.hpf=null; state.peak=null;
  state.running=false; document.body.classList.remove("running");
  ui.stop.disabled = true; // 開始は常に操作可（配色で状態表示）
  // 取りこぼしガード（背面でも止める）
  setTimeout(()=>{ stopAllTracks(); closeAudio(); }, 600);
  setTimeout(()=>{ stopAllTracks(); closeAudio(); }, 1200);
  if(reason) pushErr(reason);
}
["visibilitychange","webkitvisibilitychange","pagehide","freeze","blur","beforeunload"].forEach(ev=>{
  const handler = ()=>{
    state.visible = document.visibilityState === "visible";
    if(!state.visible || ev==="pagehide" || ev==="beforeunload" || ev==="freeze" || ev==="blur"){
      if(state.running) hardStop("非可視/離脱で停止");
    }
  };
  const target = (ev==="visibilitychange"||ev==="webkitvisibilitychange") ? document : window;
  target.addEventListener(ev, handler, {passive:true,capture:true});
});
// 背面監視タイマ（1秒ごと）
setInterval(()=>{ if(document.hidden && state.running){ hardStop("背面監視タイマで停止"); } }, 1000);

// 譜面非表示でも停止
const screenObserver = new IntersectionObserver((entries)=>{
  entries.forEach(e=>{
    if(state.running && !e.isIntersecting) hardStop("譜面が非表示で停止");
  });
},{ threshold:0.15 });
screenObserver.observe(ui.staffWrap);

// スケールUI
function populateKeys(){
  const st = state.scaleType, lv = state.level;
  const keys = getKeys(st, lv);
  ui.keySel.innerHTML = keys.map(k=>`<option value="${k}">${k}</option>`).join("");
  if(!state.key || !keys.includes(state.key)) state.key = keys[0];
  ui.keySel.value = state.key;
}
function onScaleParamChange(){
  const st = [...ui.scaleType].find(i=>i.checked)?.value || "major";
  const lv = [...ui.level].find(i=>i.checked)?.value || "intermediate";
  state.scaleType = st; state.level = lv;
  populateKeys();
  state.key = ui.keySel.value;
  loadExercise();
}
ui.keySel.addEventListener("change", ()=>{ state.key = ui.keySel.value; loadExercise(); });
ui.scaleType.forEach(r=>r.addEventListener("change", onScaleParamChange));
ui.level.forEach(r=>r.addEventListener("change", onScaleParamChange));
ui.diffSel.addEventListener("change", ()=>{ state.diffCents = difficultyToCents[ui.diffSel.value]; });

// 🎮アーケード（32問、C6以下・G3以上、直前と同じ音名は不可）
function makeArcadeSet(){
  const C6 =  letterFreqWithAcc({letter:"C",acc:"",octave:6}, A4);
  const G3 =  letterFreqWithAcc({letter:"G",acc:"",octave:3}, A4);
  const all = makeExerciseAll(state.scaleType, state.level, state.key).filter(n=>{
    const f = letterFreqWithAcc(n, A4);
    return f>=G3 && f<=C6;
  });
  const keyOf = (n)=>`${n.letter}${n.acc||""}`; // オクターブ無視
  const pick=()=>all[(Math.random()*all.length)|0];
  const out=[]; let prevKey="";
  for(let i=0;i<32;i++){
    let p=pick(), k=keyOf(p), tries=0;
    while(k===prevKey && tries++<64){ p=pick(); k=keyOf(p); }
    out.push(p); prevKey=k;
  }
  return out;
}

function loadExercise(){
  if(state.mode==="arcade"){ state.notes = makeArcadeSet(); }
  else { state.notes = makeExerciseAll(state.scaleType, state.level, state.key); }
  state.total = state.notes.length;
  state.totalBars = Math.ceil(state.total/8);
  state.offset = 0; state.idx = 0;
  state.passRecorded = Array(state.total).fill(null);
  ui.prog.textContent = `音 1/${state.total}`;
  renderPage(); updateProgressUI();
  ui.modeName.textContent = state.mode==="arcade" ? "🎮 32問" : "音階";
  resetClock();
}
function resetClock(){ state.startClock=0; state.endClock=0; ui.timer.textContent = "00:00.000"; }
function fmtTime(ms){ const m = Math.floor(ms/60000), s = Math.floor((ms%60000)/1000), x = Math.floor(ms%1000); return `${String(m).padStart(2,"0")}:${String(s).padStart(2,"0")}.${String(x).padStart(3,"0")}`; }

let pageAPI = null;
function renderPage(){
  pageAPI = renderTwoBars({ key: state.key, notes: state.notes, offset: state.offset });
  for(let i=0;i<16;i++) pageAPI.recolor(i, "note-normal");
  highlightCurrentNote();
}
function updateProgressUI(){
  ui.prog.textContent = `音 ${state.idx+1}/${state.total}`;
  const firstBar = Math.floor(state.offset/8)+1;
  const lastBar = Math.min(firstBar+1, state.totalBars);
  ui.pageLabel.textContent = `小節 ${firstBar}–${lastBar} / 全 ${state.totalBars} 小節`;
}
function highlightCurrentNote(){
  const rel = state.idx - state.offset;
  for(let i=0;i<16;i++) pageAPI.recolor(i, i===rel ? "note-target" : "note-normal");
}

// 許可イベント（開始ボタン → ゲート表示 → 許可時のみ start()）
window.addEventListener("app-permit", async ()=>{
  try { await start(); } catch(err){ pushErr(err.message||String(err)); }
});

// ボタン
ui.stop.addEventListener("click", ()=>{
  hardStop("停止ボタン");
  loadExercise(); // 初期化
});
ui.game.addEventListener("click", ()=>{
  const pressed = ui.game.getAttribute("aria-pressed")==="true";
  if(pressed){
    ui.game.setAttribute("aria-pressed","false");
    document.body.classList.remove("arcade");
    state.mode = "scale";
    loadExercise();
    showToast("🎼 通常スケール", "info", true);
  }else{
    ui.game.setAttribute("aria-pressed","true");
    document.body.classList.add("arcade");
    state.mode = "arcade";
    loadExercise();
    showToast("🎮 ランダム32問（C6まで・連続同音名禁止）", "info", true);
  }
});

// 完了
$("#again").addEventListener("click", ()=>{
  $("#result").classList.remove("show"); $("#result").setAttribute("aria-hidden","true");
  loadExercise();
});
$("#close").addEventListener("click", ()=>{ $("#result").classList.remove("show"); $("#result").setAttribute("aria-hidden","true"); });

// 音声開始（ここでのみマイクON）
async function start(){
  if(!state.visible){ showToast("画面が見えていません","warn"); return; }
  if(state.running) return;

  ui.noSleep.play().catch(()=>{});
  const ac = new (window.AudioContext||window.webkitAudioContext)({ latencyHint: "interactive" });

  // 許可ダイアログ
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, sampleRate: ac.sampleRate, echoCancellation:false, noiseSuppression:false, autoGainControl:false }
  });

  const src = ac.createMediaStreamSource(stream);
  const hpf = ac.createBiquadFilter(); hpf.type="highpass"; hpf.frequency.value=90; hpf.Q.value=0.7;
  const peak = ac.createBiquadFilter(); peak.type="peaking"; peak.frequency.value=2500; peak.Q.value=1; peak.gain.value=5;
  const analyser = ac.createAnalyser(); analyser.fftSize = 2048; analyser.smoothingTimeConstant = 0.0;

  src.connect(hpf); hpf.connect(peak); peak.connect(analyser);

  state.ac = ac; state.stream = stream; state.analyser = analyser;
  state.source = src; state.hpf = hpf; state.peak = peak;
  state.buf = new Float32Array(analyser.fftSize);
  state.running = true; document.body.classList.add("running");
  ui.stop.disabled = false;
  // ゲートは閉じる（念のため）
  const g=document.getElementById("gate"); if(g){ g.classList.remove("show"); g.setAttribute("aria-hidden","true"); }
  loop();
}

const fMin=110, fMax=2200;
function hamming(i,N){ return 0.54 - 0.46 * Math.cos(2*Math.PI*i/(N-1)); }
function autoCorrelate(buf,sr){
  const N = buf.length;
  let rms=0; for(let i=0;i<N;i++){ const s=buf[i]*hamming(i,N); buf[i]=s; rms+=s*s; }
  rms = Math.sqrt(rms/N);
  const db = Math.round(clamp(20*Math.log10(Math.max(rms,1e-9)) + 94, 0, 120));
  updateDB(db);
  if(rms < state.rmsThresh) return {freq:0, rms, db, alive:false};

  let bestOfs=-1, best=0;
  const startOfs = Math.floor(sr/fMax), endOfs = Math.floor(sr/fMin);
  for(let ofs=startOfs; ofs<endOfs; ofs++){
    let sum=0; for(let i=0;i<N-ofs;i++) sum += buf[i]*buf[i+ofs];
    if(sum>best){ best=sum; bestOfs=ofs; }
  }
  if(bestOfs<0) return {freq:0, rms, db, alive:false};
  const s1=acf(bestOfs-1), s2=acf(bestOfs), s3=acf(bestOfs+1);
  const denom=(s1-2*s2+s3); const shift=denom?0.5*(s1-s3)/denom:0;
  const T=(bestOfs+shift)/sr; const freq=1/T;
  return {freq, rms, db, alive:true};
  function acf(ofs){ let sum=0; for(let i=0;i<N-ofs;i++) sum+=buf[i]*buf[i+ofs]; return sum; }
}
function updateDB(db){
  const el = ui.db;
  el.textContent = `${db} dB`;
  el.style.background = db>=80?"#3b0e0e": db>=70?"#3b2a0e": db>=40?"#0e2f1f":"#0d1117";
}
function setAdvice(c){
  const abs=Math.abs(c); const a=ui.advice;
  if(abs>50){ a.className="bad"; a.textContent="頑張ろう！"; }
  else if(abs>15){ a.className="warn"; a.textContent=`${Math.round(abs)}c ${c>0?"高い":"低い"}`; }
  else { a.className="good"; a.textContent="いい感じ！"; }
}
function targetFreq(){ return letterFreqWithAcc(state.notes[state.idx], A4); }
function isWrongOctave(freq, fRef, passBand){
  if(freq<=0||fRef<=0) return false;
  const k = Math.round(Math.log2(freq / fRef));
  if(k===0) return false;
  const fAlt = fRef * Math.pow(2, k);
  const cents = 1200*Math.log2(freq / fAlt);
  return Math.abs(cents) <= passBand;
}

// ============ 花火：五線譜の左右中央・やや下で発火（座標の取りこぼし防止） ============
const sparks = [];
let sparkRunning = false;
function ensureSparkLoop(){
  if(sparkRunning) return; sparkRunning = true;
  const cvs = ui.spark; const ctx = cvs.getContext("2d");
  function loop(){
    if(!sparkRunning) return;
    const W = cvs.width=cvs.clientWidth; const H=cvs.height=cvs.clientHeight;
    ctx.clearRect(0,0,W,H);
    const t = now();
    for(let i=sparks.length-1;i>=0;i--){
      const p = sparks[i];
      if(t - p.t0 > p.life){ sparks.splice(i,1); continue; }
      p.vy += 0.010; p.x += p.vx; p.y += p.vy;
      p.size *= 0.996; p.alpha *= 0.985;
      ctx.globalCompositeOperation = "lighter";
      if(p.type==="emoji"){
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.font = `${p.size*6}px system-ui,Apple Color Emoji,Segoe UI Emoji`;
        ctx.fillText("🐙", p.x, p.y);
      }else{
        ctx.globalAlpha = Math.max(0, p.alpha);
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(0.6,p.size), 0, Math.PI*2); ctx.fill();
      }
    }
    if(sparks.length===0){ sparkRunning=false; return; }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);
}
function addBurst(x,y,{count=460, life=2100, color="hsl(140,100%,65%)", big=1.6}={}){
  const cvs = ui.spark;
  // 直前にキャンバス実寸を確定（0,0起点防止）
  cvs.width = cvs.clientWidth; cvs.height = cvs.clientHeight;
  const spread = 1 + big*0.9;
  for(let i=0;i<count;i++){
    const ang = Math.random()*Math.PI*2;
    const speed = spread*(1.2 + Math.random()*5.6);
    sparks.push({
      type:"dot",
      x: x + (Math.random()-0.5)*20, y: y + (Math.random()-0.5)*12,
      vx:Math.cos(ang)*speed, vy:Math.sin(ang)*speed - 1.5*big,
      size: 2.0 + Math.random()*4.2*big, alpha: 1.0,
      t0: now(), life: life + Math.random()*700, color
    });
  }
  ensureSparkLoop();
}
function addOcto(x,y,many=false){
  const cvs = ui.spark; cvs.width = cvs.clientWidth; cvs.height = cvs.clientHeight;
  const n = many? 46 : 20;
  for(let i=0;i<n;i++){
    sparks.push({
      type:"emoji", x: x + (Math.random()-0.5)*60, y: y+8,
      vx:(Math.random()-0.5)*2.1, vy:-2.0 - Math.random()*1.2,
      size: 5+Math.random()*3.6, alpha:1, t0:now(), life:2500+Math.random()*600
    });
  }
  ensureSparkLoop();
}
function fireworkFor(score, centsAbs){
  // 五線譜の左右中央・やや下（60%）で発火
  const W = ui.spark.width = ui.spark.clientWidth;
  const H = ui.spark.height = ui.spark.clientHeight;
  const cx = W * 0.5;
  const cy = H * 0.62;
  const base = Math.round(50 * Math.exp((score-85)/5.3));
  const count = clamp(base, 50, 900);
  let col, flash;
  if(centsAbs<=1){ col="hsl(5,100%,63%)"; flash="rgba(255,80,80,.50)"; }
  else if(centsAbs<=3){ col="hsl(210,100%,65%)"; flash="rgba(110,170,255,.50)"; }
  else { col="hsl(140,100%,62%)"; flash="rgba(90,230,170,.50)"; }
  addBurst(cx, cy, {count, life: 2400, color: col, big: (score>=98?2.0:1.5)});
  hudFlash(flash, score>=99?1: score>=95?0.85:0.65);
  if(centsAbs<=0.5){ addOcto(cx, cy-10, true); }
}

// メインループ
function loop(){
  if(!state.running || !state.analyser){ return; }
  state.rafId = requestAnimationFrame(loop);
  if(state.startClock){ ui.timer.textContent = fmtTime(performance.now()-state.startClock); }

  state.analyser.getFloatTimeDomainData(state.buf);
  const res = autoCorrelate(state.buf, state.ac.sampleRate);
  const freq = res.freq||0;

  // バー
  const fRef = targetFreq();
  const cents = 1200*Math.log2((freq||fRef)/fRef);
  const x = clamp((cents+50)/100, 0, 1); ui.barNeedle.style.left = `calc(${x*100}% - 1px)`;
  ui.bar.classList.toggle("hint-low", cents<-7); ui.bar.classList.toggle("hint-high", cents>7);

  if(!res.alive){ ui.bigScore.textContent="—"; ui.advice.textContent="待機中…"; return; }

  const score = clamp(100 - Math.abs(cents)*2, 0, 100)|0;
  ui.bigScore.textContent = String(score);
  setAdvice(cents);

  if(!state.startClock && Math.abs(cents) <= state.diffCents){ state.startClock = performance.now(); }

  const rel = state.idx - state.offset; if(rel<0 || rel>15) return;
  if(performance.now() < state.lockUntil) return;

  const passBand = state.diffCents;
  const abs = Math.abs(cents);

  if(isWrongOctave(freq, fRef, passBand)){
    pageAPI.recolor(rel, "note-failed");
    return;
  }

  if(abs <= passBand){
    if(state.passRecorded[state.idx]==null){
      state.passRecorded[state.idx] = score;
      fireworkFor(score, abs);
      if(rel===15){ state.lockUntil = performance.now() + 180; goNextNote(); return; }
      state.lockUntil = performance.now() + 200;
      goNextNote(); return;
    }
  }
}

function goNextNote(){
  state.idx++;
  if(state.idx >= state.total){
    state.endClock = performance.now();
    const ok = state.passRecorded.filter(v=>typeof v==="number").length;
    const avg = Math.round(state.passRecorded.reduce((a,b)=>a+(b||0),0)/Math.max(1,ok));
    const t = state.startClock? fmtTime(state.endClock - state.startClock) : "—";
    const modeStr = state.mode==="arcade" ? "モード: 🎮 ランダム32問" : "モード: 音階";
    const diffText = $("#difficulty").selectedOptions[0]?.textContent || "";
    $("#result-title").textContent = state.mode==="arcade" ? "🎮 ランダム32問 完了" : "音階 完了";
    ui.praise.textContent = ok===state.total ? "音階マスター！ 🎉" : "Good job! ✅";
    ui.details.textContent = `${modeStr} / 難易度: ${diffText} / 合格 ${ok}/${state.total} 音、平均 ${isFinite(avg)?avg:0} 点、クリアタイム ${t}`;
    $("#result").classList.add("show"); $("#result").setAttribute("aria-hidden","false");
    hardStop("完了"); // 結果の間はマイクOFF
    return;
  }
  const rel = state.idx - state.offset;
  if(rel<0 || rel>15){ state.offset = Math.floor(state.idx/16)*16; renderPage(); }
  highlightCurrentNote(); updateProgressUI();
}

// バージョン
ui.ver.textContent = "v1.0.0";

// 初期ロード（中級をデフォルト）
function populateAndLoad(){
  state.scaleType="major"; state.level="intermediate";
  populateKeys(); loadExercise();
}
populateAndLoad();
