export type Cue = { startMs: number; endMs: number; text: string };

export function toWebVTT(cues: Cue[]): string {
  const out = ["WEBVTT", ""];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    out.push(
      String(i + 1),
      `${fmtVTT(c.startMs)} --> ${fmtVTT(c.endMs)}`,
      c.text,
      ""
    );
  }
  return out.join("\n");
}

export function toSRT(cues: Cue[]): string {
  const out: string[] = [];
  for (let i = 0; i < cues.length; i++) {
    const c = cues[i];
    out.push(
      String(i + 1),
      `${fmtSRT(c.startMs)} --> ${fmtSRT(c.endMs)}`,
      c.text,
      ""
    );
  }
  return out.join("\n");
}

export function toTXT(cues: Cue[]): string {
  return cues.map(c => c.text).join("\n");
}

function fmtVTT(ms: number) {
  const t = toHMSms(ms);
  return `${t.hh}:${t.mm}:${t.ss}.${t.mmm}`;
}

function fmtSRT(ms: number) {
  const t = toHMSms(ms);
  return `${t.hh}:${t.mm}:${t.ss},${t.mmm}`;
}

function toHMSms(ms: number) {
  const total = Math.max(0, Math.round(ms));
  const hh = Math.floor(total / 3_600_000);
  const mm = Math.floor((total % 3_600_000) / 60_000);
  const ss = Math.floor((total % 60_000) / 1_000);
  const mmm = total % 1000;
  return {
    hh: String(hh).padStart(2, "0"),
    mm: String(mm).padStart(2, "0"),
    ss: String(ss).padStart(2, "0"),
    mmm: String(mmm).padStart(3, "0"),
  };
}