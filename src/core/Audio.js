/**
 * Audio — every sound in this site is synthesised with the Web Audio API.
 * No samples, no downloads: a room hum, key clicks, a floppy drive and the
 * little thump of a CRT waking up.
 */
export class Audio {
  constructor(opts = {}) {
    this.opts = opts
    this.enabled = false
    this.ready = false
    this.ctx = null
    this.master = null
    this.humOn = false
    this._noise = null
  }

  _init() {
    if (this.ctx) return
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    this.ctx = new Ctx()
    this.master = this.ctx.createGain()
    this.master.gain.value = this.opts.volume ?? 0.6
    this.master.connect(this.ctx.destination)
    this.ready = true
  }

  async enable() {
    this._init()
    if (!this.ctx) return false
    if (this.ctx.state === 'suspended') await this.ctx.resume()
    this.master.gain.value = this.opts.volume ?? 0.6
    this.enabled = true
    this.startHum()
    return true
  }

  disable() {
    this.enabled = false
    if (this.master) this.master.gain.value = 0
  }

  setPower(on) {
    if (!this.ctx) return
    this.humGain?.gain.setTargetAtTime(
      on ? (this.opts.hum ?? 0.55) * 0.05 : 0,
      this.ctx.currentTime,
      0.12,
    )
    this.fanGain?.gain.setTargetAtTime(
      on ? 0.012 : 0,
      this.ctx.currentTime,
      0.12,
    )
  }

  toggle() {
    if (this.enabled) {
      this.disable()
      return false
    }
    this.enable()
    return true
  }

  _noiseBuffer(seconds = 1) {
    if (this._noise) return this._noise
    const len = this.ctx.sampleRate * seconds
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate)
    const data = buf.getChannelData(0)
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1
    this._noise = buf
    return buf
  }

  _burst({
    dur = 0.05,
    type = 'bandpass',
    freq = 1200,
    q = 1,
    gain = 0.3,
    delay = 0,
  }) {
    const ctx = this.ctx
    const src = ctx.createBufferSource()
    src.buffer = this._noiseBuffer()
    const filter = ctx.createBiquadFilter()
    filter.type = type
    filter.frequency.value = freq
    filter.Q.value = q
    const g = ctx.createGain()
    const t0 = ctx.currentTime + delay
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain, t0 + 0.004)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    src.connect(filter).connect(g).connect(this.master)
    src.start(t0)
    src.stop(t0 + dur + 0.02)
  }

  _tone({
    freq = 440,
    dur = 0.2,
    gain = 0.2,
    type = 'sine',
    delay = 0,
    sweep = 0,
  }) {
    const ctx = this.ctx
    const osc = ctx.createOscillator()
    osc.type = type
    const g = ctx.createGain()
    const t0 = ctx.currentTime + delay
    osc.frequency.setValueAtTime(freq, t0)
    if (sweep)
      osc.frequency.exponentialRampToValueAtTime(freq + sweep, t0 + dur)
    g.gain.setValueAtTime(0, t0)
    g.gain.linearRampToValueAtTime(gain, t0 + 0.01)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    osc.connect(g).connect(this.master)
    osc.start(t0)
    osc.stop(t0 + dur + 0.02)
  }

  startHum() {
    if (!this.ready || this.humOn) return
    this.humOn = true
    const ctx = this.ctx
    const g = ctx.createGain()
    g.gain.value = (this.opts.hum ?? 0.55) * 0.05
    this.humGain = g
    g.connect(this.master)

    const lp = ctx.createBiquadFilter()
    lp.type = 'lowpass'
    lp.frequency.value = 320
    lp.connect(g)

    const a = ctx.createOscillator()
    a.type = 'sine'
    a.frequency.value = 58
    const b = ctx.createOscillator()
    b.type = 'triangle'
    b.frequency.value = 116
    a.connect(lp)
    b.connect(lp)
    a.start()
    b.start()

    // fan noise
    const fan = ctx.createBufferSource()
    fan.buffer = this._noiseBuffer(2)
    fan.loop = true
    const fanFilter = ctx.createBiquadFilter()
    fanFilter.type = 'bandpass'
    fanFilter.frequency.value = 420
    fanFilter.Q.value = 0.6
    const fanGain = ctx.createGain()
    this.fanGain = fanGain
    fanGain.gain.value = 0.012
    fan.connect(fanFilter).connect(fanGain).connect(this.master)
    fan.start()

    this._humNodes = [a, b, fan]
  }

  play(name) {
    if (!this.ready || !this.enabled) return
    switch (name) {
      case 'power-off':
        this._burst({ dur: 0.04, freq: 600, gain: 0.14 })
        this._tone({ freq: 740, dur: 0.28, gain: 0.07, sweep: -640 })
        break
      case 'key':
        this._burst({ dur: 0.035, freq: 2400, q: 2.4, gain: 0.22 })
        this._tone({ freq: 780, dur: 0.05, gain: 0.05, type: 'square' })
        break
      case 'click':
        this._burst({ dur: 0.03, freq: 1800, q: 1.6, gain: 0.18 })
        break
      case 'insert':
        this._burst({ dur: 0.09, freq: 520, q: 1.2, gain: 0.3 })
        this._tone({ freq: 70, dur: 0.16, gain: 0.12, type: 'triangle' })
        // the grinder
        for (let i = 0; i < 6; i++) {
          this._burst({
            dur: 0.055,
            freq: 320 + i * 12,
            q: 2,
            gain: 0.14,
            delay: 0.18 + i * 0.09,
          })
        }
        break
      case 'read':
        for (let i = 0; i < 7; i++) {
          this._burst({
            dur: 0.02,
            freq: 1500,
            q: 3,
            gain: 0.12,
            delay: 0.1 + i * 0.11,
          })
        }
        this._tone({ freq: 880, dur: 0.12, gain: 0.05, delay: 0.9 })
        break
      case 'eject':
        this._tone({ freq: 120, dur: 0.12, gain: 0.14, type: 'triangle' })
        this._burst({ dur: 0.16, freq: 700, q: 1.1, gain: 0.22, delay: 0.05 })
        break
      case 'power':
        this._tone({
          freq: 90,
          dur: 0.35,
          gain: 0.08,
          type: 'sine',
          sweep: 260,
        })
        this._burst({ dur: 0.2, freq: 260, q: 0.9, gain: 0.16 })
        this._tone({
          freq: 15700,
          dur: 0.6,
          gain: 0.006,
          type: 'sine',
          delay: 0.2,
        })
        break
      case 'boot':
        this._tone({
          freq: 220,
          dur: 0.25,
          gain: 0.12,
          type: 'sine',
          sweep: 120,
        })
        break
      case 'hover':
        this._tone({ freq: 1320, dur: 0.03, gain: 0.02, type: 'square' })
        break
    }
  }
}
