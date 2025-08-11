class PitchDetector extends AudioWorkletProcessor {
    constructor() {
      super();
      this.bufSize = 2048;        // 解析フレーム
      this.hop = 1024;            // 更新間隔
      this.buffer = new Float32Array(this.bufSize);
      this.idx = 0;
      this.overrun = false;
    }
    static get parameterDescriptors() { return []; }
  
    process(inputs) {
      const input = inputs[0];
      if (!input || !input[0]) return true;
      const ch = input[0];
  
      // 書き込み
      for (let i=0; i<ch.length; i++) {
        this.buffer[this.idx++] = ch[i];
        if (this.idx >= this.bufSize) {
          // 解析
          const out = this.analyze(this.buffer);
          this.port.postMessage(out);
          // ホップ分左へ
          this.buffer.copyWithin(0, this.hop, this.bufSize);
          this.idx = this.bufSize - this.hop;
        }
      }
      return true;
    }
  
    analyze(frame) {
      const N = frame.length;
      // RMS
      let s=0; for (let i=0;i<N;i++) s += frame[i]*frame[i];
      const rms = Math.sqrt(s/N);
      if (rms < 1e-4) return { f0: 0, conf: 0, rms };
  
      // 窓掛け（Hann）
      const w = 2*Math.PI/(N-1);
      for (let i=0;i<N;i++) frame[i] = frame[i]*(0.5 - 0.5*Math.cos(w*i));
  
      // 差分関数 d(tau)
      const maxTau = Math.floor(sampleRate/65);   // 下限65Hz（E弦上:調整可）
      const minTau = Math.floor(sampleRate/1000); // 上限1kHz 付近
      const d = new Float32Array(maxTau+1);
      for (let tau=minTau; tau<=maxTau; tau++) {
        let sum=0;
        for (let i=0;i<N-tau;i++) {
          const diff = frame[i]-frame[i+tau];
          sum += diff*diff;
        }
        d[tau]=sum;
      }
  
      // 累積平均正規化差関数 CMND
      const cmnd = new Float32Array(maxTau+1);
      let runsum = 0;
      for (let tau=minTau; tau<=maxTau; tau++) {
        runsum += d[tau];
        cmnd[tau] = d[tau] * tau / (runsum || 1);
      }
  
      // 最初の明確な極小点を探す
      let tauBest = -1, thresh = 0.1;
      for (let tau=minTau+2; tau<=maxTau-1; tau++) {
        if (cmnd[tau] < thresh && cmnd[tau] < cmnd[tau-1] && cmnd[tau] <= cmnd[tau+1]) {
          tauBest = tau; break;
        }
      }
      // 見つからなければ最小値
      if (tauBest < 0) {
        let minV = 1e9, minI = -1;
        for (let tau=minTau; tau<=maxTau; tau++) {
          if (cmnd[tau] < minV) { minV = cmnd[tau]; minI = tau; }
        }
        tauBest = minI;
      }
  
      // 放物線補間で微調整
      const x0 = tauBest-1, x1 = tauBest, x2 = tauBest+1;
      const y0 = cmnd[x0] || cmnd[x1], y1 = cmnd[x1], y2 = cmnd[x2] || cmnd[x1];
      const denom = (y0 - 2*y1 + y2) || 1;
      const delta = (y0 - y2) / (2*denom);
      const tauRefined = tauBest + delta;
  
      const f0 = sampleRate / tauRefined;
      // 信頼度（簡易）：ピークの鋭さから逆算
      const conf = Math.max(0, Math.min(1, 1 - y1));
  
      return { f0: (f0&&isFinite(f0)? f0:0), conf, rms, dropped: false };
    }
  }
  
  registerProcessor('pitch-detector', PitchDetector);
  