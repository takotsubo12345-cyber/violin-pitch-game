// score.js
// 2小節=16音ページング。VexFlow優先／自前SVGフォールバック。バッジ機能は廃止。
import { toVexKeys } from "./scales.js";

const staffDiv = document.getElementById("staff");
let cache = null;

function mkSvg(w,h){ const ns="http://www.w3.org/2000/svg"; const s=document.createElementNS(ns,"svg"); s.setAttribute("viewBox",`0 0 ${w} ${h}`); s.setAttribute("width","100%"); s.setAttribute("height","100%"); return s; }
function line(svg,x1,y1,x2,y2,stroke="#e8eef7",w=1){ const ns="http://www.w3.org/2000/svg"; const l=document.createElementNS(ns,"line");
  l.setAttribute("x1",x1); l.setAttribute("y1",y1); l.setAttribute("x2",x2); l.setAttribute("y2",y2);
  l.setAttribute("stroke",stroke); l.setAttribute("stroke-width",w); svg.appendChild(l); return l; }
function text(svg,x,y,str,size=12,weight="700",anchor="middle",fill="#a7c7dd"){
  const ns="http://www.w3.org/2000/svg"; const t=document.createElementNS(ns,"text");
  t.setAttribute("x",x); t.setAttribute("y",y); t.setAttribute("fill",fill);
  t.setAttribute("font-size",size); t.setAttribute("font-weight",weight); t.setAttribute("text-anchor",anchor);
  t.setAttribute("font-family",'system-ui,"Noto Music","Bravura","Petaluma",sans-serif'); t.textContent=str; svg.appendChild(t); return t;
}
function notehead(svg,x,y,cls="note-normal",rX=6.2,rY=4.2,rot=-20){
  const ns="http://www.w3.org/2000/svg"; const e=document.createElementNS(ns,"ellipse");
  e.setAttribute("cx",x); e.setAttribute("cy",y); e.setAttribute("rx",rX); e.setAttribute("ry",rY);
  e.setAttribute("transform",`rotate(${rot},${x},${y})`); e.setAttribute("class",cls); svg.appendChild(e); return e;
}
function stem(svg,x,y,len=22,cls="note-normal"){ const st=line(svg,x+7,y-3,x+7,y-3-len,"#e8eef7",1.5); st.setAttribute("class",cls); return st; }

function renderKeySignature(svg, key, left, top, space){
  const keyMap = {"C":{s:0},"G":{s:1},"D":{s:2},"A":{s:3},"E":{s:4},"B":{s:5},"F#":{s:6},
    "F":{f:1},"Bb":{f:2},"Eb":{f:3},"Ab":{f:4},"Db":{f:5}};
  const k=keyMap[key]||{s:0};
  const SHARP_POS=[{L:'F',o:5},{L:'C',o:5},{L:'G',o:5},{L:'D',o:5},{L:'A',o:4},{L:'E',o:5},{L:'B',o:4}];
  const FLAT_POS =[{L:'B',o:4},{L:'E',o:5},{L:'A',o:4},{L:'D',o:5},{L:'G',o:4},{L:'C',o:5},{L:'F',o:4}];
  const yFor=(letter,oct)=>{ const idx=(L)=>["C","D","E","F","G","A","B"].indexOf(L);
    const steps=(oct-4)*7 + (idx(letter)-idx("E")); const bottom=top+space*4; return bottom - (steps*space/2); };
  let x=left;
  const drawSharp=(L,o)=>{ text(svg,x, yFor(L,o)+4, "♯", 18, "800","left","#e8eef7"); x+=12; };
  const drawFlat =(L,o)=>{ text(svg,x, yFor(L,o)+4, "♭", 18, "800","left","#e8eef7"); x+=12; };
  if(k.s){ for(let i=0;i<k.s;i++){ const p=SHARP_POS[i]; drawSharp(p.L,p.o); } }
  if(k.f){ for(let i=0;i<k.f;i++){ const p=FLAT_POS[i]; drawFlat(p.L,p.o); } }
  return x-left;
}

function renderFallback({ key, notes16 }){
  staffDiv.innerHTML="";
  const w=staffDiv.clientWidth||780, h=staffDiv.clientHeight||300;
  let top=62, space=15, left=14, right=w-14;

  // 高音見切れ防止
  const yTrial=(L,O,top0)=>{ const idx=(l)=>["C","D","E","F","G","A","B"].indexOf(l); const s=(O-4)*7+(idx(L)-idx("E")); return (top0+space*4)-(s*space/2); };
  let minY=1e9; for(const n of notes16){ const y=yTrial(n.letter,n.octave,top); if(y<minY) minY=y; }
  if(minY<22){ top += 22-minY; }

  const svg=mkSvg(w,h); staffDiv.appendChild(svg);
  for(let i=0;i<5;i++) line(svg,left, top+space*i, right, top+space*i, "#e8eef7", 1.15);

  const ksW = renderKeySignature(svg,key,left+2, top, space);
  const innerLeft = left+2+ksW+8, innerRight=right-8;
  const stepX=(innerRight-innerLeft)/16;
  const bottom2=top+space*4;
  const yFor=(L,O)=>{ const idx=(l)=>["C","D","E","F","G","A","B"].indexOf(l); const s=(O-4)*7+(idx(L)-idx("E")); return bottom2-(s*space/2); };

  const nodes=[];
  notes16.forEach((n,i)=>{
    const x = innerLeft + stepX*(i+0.5);
    const y = yFor(n.letter, n.octave);
    const head = notehead(svg,x,y,"note-normal");
    stem(svg,x,y,22,"note-normal");
    if((i+1)%8===0 && i<16) line(svg, innerLeft+stepX*(i+1), top, innerLeft+stepX*(i+1), bottom2, "#7aa2c1",1.1);
    nodes.push(head);
    const pos = (bottom2 - y)/(space/2);
    if(pos<-2){ for(let k=-2;k>=pos; k-=2){ line(svg, x-10, bottom2 + (Math.abs(k)/2-1)*space, x+10, bottom2 + (Math.abs(k)/2-1)*space, "#e8eef7",1.05); } }
    else if(pos>10){ for(let k=10;k<=pos; k+=2){ line(svg, x-10, top - ((k-10)/2+1)*space, x+10, top - ((k-10)/2+1)*space, "#e8eef7",1.05); } }
  });

  cache={ mode:"svg", svg, nodes };
  return api();
}

function renderVex({ key, vexKeys16 }){
  staffDiv.innerHTML="";
  const VF = window.Vex?.Flow;
  const renderer = new VF.Renderer(staffDiv, VF.Renderer.Backends.SVG);
  const w=staffDiv.clientWidth||780, h=staffDiv.clientHeight||300; renderer.resize(w,h);
  const ctx = renderer.getContext();

  const stave = new VF.Stave(12,56,w-24);
  stave.addKeySignature(key);
  stave.setContext(ctx).draw();

  const notes = vexKeys16.map(k=>new VF.StaveNote({keys:[k],duration:"8",clef:"treble"}));
  const voice = new VF.Voice({num_beats:16,beat_value:4}).setMode(VF.Voice.Mode.SOFT).addTickables(notes);
  new VF.Formatter().joinVoices([voice]).format([voice], w-54);
  voice.draw(ctx,stave);

  cache={ mode:"vex", VF, renderer, ctx, stave, notes };
  return api();
}

function api(){
  return {
    mode: cache.mode,
    recolor(i, cls){
      if(cache.mode==="vex"){
        const n=cache.notes[i]; if(!n) return;
        const color = cls==="note-target"?"#22c55e":(cls==="note-failed"?"#ef4444":"#e8eef7");
        n.setStyle({fillStyle:color, strokeStyle:color});
        cache.ctx.clear(); cache.stave.setContext(cache.ctx).draw();
        const voice=new cache.VF.Voice({num_beats:16,beat_value:4}).setMode(cache.VF.Voice.Mode.SOFT).addTickables(cache.notes);
        new cache.VF.Formatter().joinVoices([voice]).format([voice], staffDiv.clientWidth-54);
        voice.draw(cache.ctx,cache.stave);
      }else{
        const el = cache.nodes[i]; if(!el) return; el.setAttribute("class", cls);
      }
    },
    badge(){ /* 廃止 */ },
    getXY(i){
      if(cache.mode==="vex"){
        const bb = cache.notes[i]?.getBoundingBox(); if(!bb) return {x:0,y:0};
        return {x: bb.getX()+bb.getW()/2, y: bb.getY()+bb.getH()/2};
      }else{
        const el = cache.nodes[i]; if(!el) return {x:0,y:0};
        const b = el.getBBox(); return {x:b.x+b.width/2, y:b.y+b.height/2};
      }
    }
  };
}

export function renderTwoBars({ key, notes, offset=0 }){
  const slice = notes.slice(offset, offset+16);
  const vex = toVexKeys(slice);
  const okVex = !!window.Vex?.Flow;
  return okVex ? renderVex({key, vexKeys16:vex}) : renderFallback({key, notes16:slice});
}
