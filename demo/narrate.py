#!/usr/bin/env python3
"""Agrega narracion con voz (edge-tts) a demo/output/demo.mp4 -> demo-narrado.mp4.

Cada texto de narration.json arranca en el startSec de su paso (output/steps.json).
Si un audio no entra en la duracion de su paso, se acelera lo justo.
Uso (dentro de WSL): /opt/tts/bin/python demo/narrate.py [guion.json] [salida.mp4]
"""
import asyncio
import json
import subprocess
import sys
from pathlib import Path

import edge_tts

DEMO = Path(__file__).resolve().parent
OUT = DEMO / "output"
SCRIPT = DEMO / (sys.argv[1] if len(sys.argv) > 1 else "narration.json")
TARGET = OUT / (sys.argv[2] if len(sys.argv) > 2 else "demo-narrado.mp4")
AUDIO = OUT / f"audio-{SCRIPT.stem}"
MARGIN = 0.8  # silencio minimo antes del paso siguiente


def duration(path):
    r = subprocess.run(
        ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
        capture_output=True, text=True, check=True)
    return float(r.stdout.strip())


async def main():
    narration = json.loads(SCRIPT.read_text(encoding="utf-8"))
    steps = json.loads((OUT / "steps.json").read_text(encoding="utf-8"))
    marks = steps["marks"]
    AUDIO.mkdir(exist_ok=True)

    inputs, filters, labels = [], [], []
    for i, mark in enumerate(marks):
        text = narration["steps"].get(str(mark["step"]))
        if not text:
            continue
        mp3 = AUDIO / f"step{mark['step']:02d}.mp3"
        await edge_tts.Communicate(text, narration["voice"]).save(str(mp3))

        end = marks[i + 1]["startSec"] if i + 1 < len(marks) else steps["durationSec"]
        slot = end - mark["startSec"] - MARGIN
        dur = duration(mp3)
        tempo = max(1.0, dur / slot)
        print(f"paso {mark['step']:>2}: audio {dur:5.1f}s, hueco {slot:5.1f}s, tempo {tempo:.2f}")

        idx = len(labels) + 1  # 0 es el video
        inputs += ["-i", str(mp3)]
        delay = int(mark["startSec"] * 1000)
        filters.append(f"[{idx}:a]atempo={tempo:.3f},adelay={delay}:all=1[a{idx}]")
        labels.append(f"[a{idx}]")

    # Dos etapas: mezclar a un wav y despues muxear. En una sola pasada el
    # muxer mp4 rechaza los timestamps que salen de amix.
    filters.append(
        f"{''.join(labels)}amix=inputs={len(labels)}:normalize=0,"
        f"aresample=48000,asetpts=N/SR/TB[aout]")
    wav = AUDIO / "narration.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-f", "lavfi", "-i", "anullsrc=r=48000:cl=mono", *inputs,
         "-filter_complex", ";".join(filters), "-map", "[aout]",
         "-t", str(steps["durationSec"]), str(wav)],
        check=True)
    out = TARGET
    subprocess.run(
        ["ffmpeg", "-y", "-v", "error", "-i", str(OUT / "demo.mp4"), "-i", str(wav),
         "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-b:a", "160k", str(out)],
        check=True)
    print(f"listo: {out} ({duration(out):.0f}s)")


asyncio.run(main())
