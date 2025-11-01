// Silent-voice: Google Meet overlay content script
(() => {
  if (!/(^|\.)meet\.google\.com$/.test(location.hostname)) return;

  class PoseClient {
    constructor() { this.port = null; }
    ensurePort() { if (!this.port) this.port = chrome.runtime.connect({ name: 'sv-port' }); }
    fetch(words, onChunk, onDone, onError) {
      this.ensurePort();
      const handler = (msg) => {
        if (msg?.type === 'POSE_CHUNK') onChunk?.(msg.frames || []);
        else if (msg?.type === 'POSE_DONE') { this.port.onMessage.removeListener(handler); onDone?.(); }
        else if (msg?.type === 'POSE_ERROR') { this.port.onMessage.removeListener(handler); onError?.(msg.message || 'error'); }
      };
      this.port.onMessage.addListener(handler);
      this.port.postMessage({ type: 'FETCH_POSE', words });
    }
  }

  class Animator {
    constructor(canvas, wordEl) {
      this.c = canvas; this.ctx = canvas.getContext('2d'); this.wordEl = wordEl;
      this.queue = []; this.i = 0; this.run = false; this.raf = null; this.last = 0; this.fps = 30;
    }
    enqueue(fr) { if (Array.isArray(fr) && fr.length) { this.queue.push(...fr); if (!this.run) this.start(); } }
    clear() { this.queue = []; this.i = 0; this.ctx?.clearRect(0,0,this.c.width,this.c.height); }
    start() { if (this.run) return; this.run = true; this.last = performance.now(); const tick = (t) => {
      if (!this.run) return; const elapsed = t - this.last, step = 1000/this.fps; if (elapsed >= step) {
        this.last = t - (elapsed % step); if (this.queue.length) { const f = this.queue[this.i++ % this.queue.length]; this.draw(f); }
      } this.raf = requestAnimationFrame(tick); }; this.raf = requestAnimationFrame(tick); }
    stop() { this.run = false; if (this.raf) cancelAnimationFrame(this.raf); this.raf = null; }
    pts(pts, col) { if (!pts) return; this.ctx.fillStyle = col; for (const p of pts) { if (!p) continue; const x = (p.x??0)*this.c.width, y=(p.y??0)*this.c.height; this.ctx.beginPath(); this.ctx.arc(x,y,2,0,Math.PI*2); this.ctx.fill(); } }
    draw(f) {
      if (!f||!this.ctx) return;
      // Update current word label (debug clarity)
      if (this.wordEl && f.word) this.wordEl.textContent = String(f.word);
      this.ctx.clearRect(0,0,this.c.width,this.c.height);
      this.pts(f.left_hand_landmarks,'#2dd4bf');
      this.pts(f.right_hand_landmarks,'#60a5fa');
      this.pts(f.pose_landmarks,'#a78bfa');
      this.pts(f.face_landmarks,'#fca5a5');
    }
  }

  class MeetController {
    constructor() {
      this.ui = null; this.canvas = null; this.anim = null; this.pose = new PoseClient();
      this.active = false; this.paused = false; this.source = 'none';
      this.captionObs = null; this.seen = new Set(); this.ttl = 8000; // de-dup window
      this.rec = null; // web speech
      this.captionsAvailable = false; // becomes true when we hook caption regions
      this.micWanted = false; // whether we intend to use mic fallback
      this.srBackoff = 800; // ms
      this.srMaxBackoff = 5000;
      this.debounced = this.debounce((t)=>this.request(t), 300);
    }
  init() { this.mountUI(); }
    mountUI() {
      if (this.ui) return; const box = document.createElement('div'); this.ui = box; box.id='sv-meet-ui'; box.style.cssText = `
        position:fixed; right:16px; bottom:16px; z-index:2147483647; background:rgba(0,0,0,.72); color:#fff;
        padding:10px; border-radius:10px; display:flex; flex-direction:column; gap:8px; min-width:260px; font:13px/1.2 system-ui,sans-serif;`;
      const title=document.createElement('div'); title.textContent='Silent Voice — Meet'; title.style.cssText='font-weight:600; opacity:.9;';
      const row=document.createElement('div'); row.style.cssText='display:flex; gap:8px;';
      const btn=(t)=>{const b=document.createElement('button'); b.textContent=t; b.style.cssText=this.btnStyle(); return b;};
      const enable=btn('Enable'); const pause=btn('Pause'); pause.disabled=true;
      enable.onclick=()=>{ if(!this.active){ this.start(); enable.textContent='Disable'; pause.disabled=false; } else { this.stop(); enable.textContent='Enable'; pause.disabled=true; } };
      pause.onclick=()=>{ if(!this.paused){ this.pause(); pause.textContent='Resume'; } else { this.resume(); pause.textContent='Pause'; } };
      const status=document.createElement('div'); status.id='sv-meet-status'; status.textContent='Source: —'; status.style.cssText='opacity:.8;';
  this.canvas=document.createElement('canvas'); this.canvas.width=360; this.canvas.height=240; this.canvas.style.cssText='background:#101014;border-radius:8px;';
  const word=document.createElement('div'); word.id='sv-meet-word'; word.textContent='—'; word.style.cssText='font-size:12px;opacity:.85;min-height:16px;';
  this.anim=new Animator(this.canvas, word);
  row.append(enable,pause); box.append(title,row,status,this.canvas,word); document.documentElement.appendChild(box);
    }
    btnStyle(){return ['padding:6px 10px','background:#1f2937','color:#fff','border:1px solid #334155','border-radius:6px','cursor:pointer'].join(';');}
    setStatus(s){const el=document.getElementById('sv-meet-status'); if(el) el.textContent=s;}
    start(){ if(this.active) return; this.active=true; this.paused=false; this.anim.clear();
      this.captionsAvailable = false; this.micWanted = false; this.srBackoff = 800;
      const ok=this.startCaptions();
      if(ok){ this.source='captions'; this.setStatus('Source: Meet captions'); }
      else {
        this.source='none';
        this.setStatus('Waiting for Meet captions…');
        // Give captions a moment to appear before falling back to mic
        setTimeout(()=>{ if(this.active && !this.captionsAvailable && !this.micWanted){
          if(this.startWebSpeech()){ this.source='webspeech'; this.setStatus('Source: Web Speech API (fallback)'); }
          else { this.setStatus('Source: unavailable (turn on Meet captions or allow mic)'); }
        } }, 1500);
      }
    }
    stop(){ this.active=false; this.paused=false; this.stopCaptions(); this.stopWebSpeech(); this.anim.stop(); this.anim.clear(); this.setStatus('Source: —'); }
    pause(){ if(!this.active||this.paused) return; this.paused=true; this.anim.stop(); }
    resume(){ if(!this.active||!this.paused) return; this.paused=false; this.anim.start(); }
    clean(t){ if(!t) return ''; return t.replace(/\[[^\]]+\]/g,' ').replace(/\b(uh|um|erm|like)\b/gi,' ').replace(/\s+/g,' ').trim(); }
    request(text){ if(!text||this.paused) return; this.pose.fetch(text,(chunk)=>this.anim.enqueue(chunk),()=>{},(e)=>console.warn('[sv][meet]',e)); }
    debounce(fn,ms){let h=null; return (...a)=>{ clearTimeout(h); h=setTimeout(()=>fn.apply(this,a),ms);}; }

    // Captions
    startCaptions(){ try {
      const live = () => [...document.querySelectorAll('[aria-live="polite"],[aria-live="assertive"],[role="status"]')].filter(n=>n.offsetParent!==null);
      const regs = live(); if(!regs.length){ this.captionObs=new MutationObserver(()=>{ const rs=live(); if(rs.length){ this.captionObs.disconnect(); this.observeRegs(rs); }}); this.captionObs.observe(document.body,{childList:true,subtree:true}); return false; }
      this.observeRegs(regs); return true; } catch { return false; }
    }
    observeRegs(regs){
      // Captions just became available: switch off mic fallback if running
      this.captionsAvailable = true;
      if (this.micWanted) { this.stopWebSpeech(); this.source='captions'; this.setStatus('Source: Meet captions'); }

      const handle=(t)=>{ const s=this.clean(t); if(!s) return; const key=s.slice(-160); if(this.seen.has(key)) return; this.seen.add(key); setTimeout(()=>this.seen.delete(key), this.ttl); this.debounced(s); };
      const pick=(node)=>{ const txt=(node.textContent||'').trim(); if(txt.length>=2) handle(txt); };
      this.captionObs=new MutationObserver((muts)=>{ for(const m of muts){ for(const n of m.addedNodes){ if(n.nodeType===Node.TEXT_NODE) pick(n.parentNode||n); else if(n.nodeType===Node.ELEMENT_NODE) pick(n); } } });
      regs.forEach(r=>this.captionObs.observe(r,{childList:true,subtree:true}));
    }
    stopCaptions(){ this.captionObs?.disconnect(); this.captionObs=null; }

    // Web Speech fallback
    startWebSpeech(){ try { const SR=window.SpeechRecognition||window.webkitSpeechRecognition; if(!SR) return false; this.rec=new SR(); this.micWanted = true; this.rec.lang=document.documentElement.lang||'en-US'; this.rec.continuous=true; this.rec.interimResults=false;
      this.rec.onresult=(e)=>{ if(!this.active) return; let buff=''; for(let i=e.resultIndex;i<e.results.length;i++){ const r=e.results[i]; if(r.isFinal) buff+=r[0]?.transcript||''; } const s=this.clean(buff); if(s) this.debounced(s); };
      this.rec.onerror=(ev)=>{
        const err = ev && (ev.error || ev.message) || 'error';
        // Stop trying if permission is denied or service not allowed
        if (err === 'not-allowed' || err === 'service-not-allowed') {
          this.stopWebSpeech();
          if (!this.captionsAvailable) this.setStatus('Microphone blocked. Turn on Meet captions.');
          return;
        }
        // Backoff restart only if we still want the mic and captions aren’t available
        if (this.active && this.rec && this.micWanted && !this.captionsAvailable) {
          const wait = Math.min(this.srBackoff, this.srMaxBackoff);
          this.srBackoff = Math.min(this.srBackoff * 1.6, this.srMaxBackoff);
          setTimeout(()=>{ try{ this.rec && this.rec.start(); }catch{} }, wait);
        }
      };
      this.rec.onend=()=>{
        if (this.active && this.rec && this.micWanted && !this.captionsAvailable) {
          const wait = Math.min(this.srBackoff, this.srMaxBackoff);
          this.srBackoff = Math.min(this.srBackoff * 1.6, this.srMaxBackoff);
          try { setTimeout(()=>{ try{ this.rec && this.rec.start(); }catch{} }, wait); } catch {}
        }
      };
      this.rec.start(); return true; } catch { return false; }
    }
    stopWebSpeech(){ this.micWanted = false; try{ this.rec?.onresult=null; this.rec?.onerror=null; this.rec?.onend=null; this.rec?.stop(); }catch{} this.rec=null; this.srBackoff=800; }
  }

  const controller = new MeetController();
  controller.init();

  // Allow popup to toggle/show the panel explicitly
  chrome.runtime.onMessage.addListener((msg) => {
    if (!msg) return;
    if (msg.type === 'SV_TOGGLE_MEET_PANEL') {
      controller.mountUI();
      // If requested to enable immediately
      if (msg.enable === true && !controller.active) {
        controller.start();
      }
    }
  });
})();
