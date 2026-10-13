"""Erzeugt den mitgelieferten Erinnerungston (www/sounds/oregano.wav): ein dezentes Zwei-Ton-Glöckchen,
ca. 1,4 Sekunden, mono, 22,05 kHz, komplett synthetisch (keine fremden Audiodaten, keine Urheberrechtsfragen).
Aufruf: python -I tools/sound.py"""
import math, struct, wave, pathlib

RATE = 22050
out = pathlib.Path(__file__).parent.parent / "www" / "sounds" / "oregano.wav"
out.parent.mkdir(parents=True, exist_ok=True)

def bell(freq, start, dur, gain):
    """Weicher Glockenton: Grundton + leicht verstimmte Obertöne, schneller Anschlag, exponentielles Ausklingen."""
    n = int(dur * RATE)
    s0 = int(start * RATE)
    parts = [(1.0, 1.0, 3.2), (2.0, 0.35, 4.5), (3.01, 0.12, 6.0), (4.2, 0.05, 8.0)]
    for i in range(n):
        t = i / RATE
        env = min(1.0, t / 0.006)                      # 6 ms Anschlag gegen Knacken
        v = 0.0
        for mult, amp, decay in parts:
            v += amp * math.exp(-decay * t) * math.sin(2 * math.pi * freq * mult * t)
        yield s0 + i, gain * env * v

total = int(1.5 * RATE)
buf = [0.0] * total
for freq, start, gain in ((659.25, 0.0, 0.5), (987.77, 0.22, 0.45)):   # E5 → H5
    for idx, v in bell(freq, start, 1.25, gain):
        if idx < total:
            buf[idx] += v
peak = max(abs(x) for x in buf) or 1.0
fade = int(0.08 * RATE)
with wave.open(str(out), "wb") as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(RATE)
    frames = bytearray()
    for i, x in enumerate(buf):
        x = x / peak * 0.8
        if i > total - fade:                           # sanftes Ausblenden am Ende
            x *= (total - i) / fade
        frames += struct.pack("<h", int(max(-1, min(1, x)) * 32767))
    w.writeframes(bytes(frames))
print("OK", out, round(total / RATE, 2), "s,", out.stat().st_size // 1024, "KB")
