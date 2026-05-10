/*
Creates a minimal "PPTX-like" zip that our server-side PPTX extractor can read.

Why minimal works here:
- The server extracts slide text by unzipping and reading files named:
    ppt/slides/slide1.xml, slide2.xml, ...
- It does NOT require a fully valid Office Open XML PowerPoint package for extraction.

Usage:
  node scripts/make-pptx-fixture.mjs --out tmp/pptx-smoketest.pptx

Notes:
  - Writes binary output.
*/

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import JSZip from "jszip";

function parseArgs(argv) {
  const out = { out: "tmp/pptx-smoketest.pptx" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--out" && argv[i + 1]) out.out = argv[++i];
    else if (a === "--help" || a === "-h") return { help: true };
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(
    [
      "make-pptx-fixture.mjs",
      "",
      "Options:",
      "  --out <path>    Output path (default: tmp/pptx-smoketest.pptx)",
      "",
      "Example:",
      "  node scripts/make-pptx-fixture.mjs --out tmp/pptx-smoketest.pptx",
    ].join("\n")
  );
  process.exit(0);
}

const slideXml = (lines) => `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">
  <p:cSld>
    <p:spTree>
      <p:sp>
        <p:txBody>
          ${lines
            .map(
              (t) =>
                `<a:p><a:r><a:t>${String(t)
                  .replaceAll("&", "&amp;")
                  .replaceAll("<", "&lt;")
                  .replaceAll(">", "&gt;")}</a:t></a:r></a:p>`
            )
            .join("\n")}
        </p:txBody>
      </p:sp>
    </p:spTree>
  </p:cSld>
</p:sld>`;

const slides = [
  [
    "Topic: Photosynthesis",
    "Photosynthesis converts light energy into chemical energy stored in glucose.",
    "It occurs mainly in the chloroplasts of plant cells and algae.",
    "Overall equation: 6 CO2 + 6 H2O + light -> C6H12O6 + 6 O2.",
  ],
  [
    "Light-dependent reactions",
    "Take place in the thylakoid membranes.",
    "Produce ATP and NADPH using energy from photons.",
    "Split water (photolysis) and release oxygen as a byproduct.",
  ],
  [
    "Calvin cycle (light-independent reactions)",
    "Occurs in the stroma of the chloroplast.",
    "Uses ATP and NADPH to fix CO2 into sugars.",
    "Key enzyme: RuBisCO helps attach CO2 to RuBP.",
  ],
];

const zip = new JSZip();
for (let i = 0; i < slides.length; i++) {
  zip.file(`ppt/slides/slide${i + 1}.xml`, slideXml(slides[i]));
}

const outPath = path.resolve(process.cwd(), args.out);
fs.mkdirSync(path.dirname(outPath), { recursive: true });

const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
fs.writeFileSync(outPath, buf);

console.log(`Wrote PPTX fixture: ${outPath} (${buf.length} bytes)`);
