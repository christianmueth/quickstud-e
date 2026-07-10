import { NextResponse } from "next/server";
import PptxGenJS from "pptxgenjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type PresentationPlan = {
  title?: string;
  audience?: string;
  objective?: string;
  outline?: Array<{
    slideTitle?: string;
    purpose?: string;
    bullets?: string[];
    speakerGuidance?: string;
    suggestedVisual?: string;
  }>;
  presenterChecklist?: string[];
};

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as { plan?: PresentationPlan };
    const plan = body.plan;
    if (!plan?.outline?.length) {
      return NextResponse.json({ error: "Presentation plan is required." }, { status: 400 });
    }

    const pptx = new PptxGenJS();
    pptx.layout = "LAYOUT_WIDE";
    pptx.author = "QuickStud-E";
    pptx.company = "QuickStud-E";
    pptx.subject = plan.objective || "Workspace presentation";
    pptx.title = plan.title || "Workspace presentation";
    pptx.lang = "en-US";
    pptx.theme = {
      headFontFace: "Aptos Display",
      bodyFontFace: "Aptos",
      lang: "en-US",
    };

    const titleSlide = pptx.addSlide();
    titleSlide.background = { color: "F8FAFC" };
    titleSlide.addText(plan.title || "Workspace presentation", {
      x: 0.7, y: 0.6, w: 11.8, h: 0.8,
      fontFace: "Aptos Display", fontSize: 24, bold: true, color: "0F172A",
    });
    titleSlide.addText(`Audience: ${plan.audience || "General"}`, {
      x: 0.75, y: 1.55, w: 5.5, h: 0.35, fontSize: 12, color: "334155",
    });
    titleSlide.addText(plan.objective || "", {
      x: 0.75, y: 2.0, w: 11.4, h: 1.2, fontSize: 18, color: "1E293B", margin: 0.04,
    });

    for (const [index, slide] of plan.outline.entries()) {
      const pptSlide = pptx.addSlide();
      pptSlide.background = { color: index % 2 === 0 ? "FFFFFF" : "F8FAFC" };
      pptSlide.addText(slide.slideTitle || `Slide ${index + 1}`, {
        x: 0.6, y: 0.45, w: 6.9, h: 0.6,
        fontFace: "Aptos Display", fontSize: 22, bold: true, color: "0F172A",
      });
      pptSlide.addText(slide.purpose || "", {
        x: 0.65, y: 1.15, w: 6.8, h: 0.75,
        fontSize: 14, color: "334155", margin: 0.04,
      });

      const bulletText = (slide.bullets || []).map((bullet) => ({ text: bullet, options: { bullet: { indent: 18 } } }));
      if (bulletText.length) {
        pptSlide.addText(bulletText, {
          x: 0.75, y: 2.05, w: 6.1, h: 3.6,
          fontSize: 18, color: "0F172A", breakLine: false, paraSpaceAfterPt: 10,
          margin: 0.06, valign: "top",
        });
      }

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x: 7.45, y: 1.1, w: 5.1, h: 2.2,
        rectRadius: 0.08,
        fill: { color: "E0F2FE" },
        line: { color: "7DD3FC", pt: 1.2 },
      });
      pptSlide.addText("Speaker guidance", {
        x: 7.7, y: 1.3, w: 2.1, h: 0.3, fontSize: 12, bold: true, color: "075985",
      });
      pptSlide.addText(slide.speakerGuidance || "", {
        x: 7.7, y: 1.65, w: 4.55, h: 1.25, fontSize: 14, color: "0F172A", margin: 0.04,
      });

      pptSlide.addShape(pptx.ShapeType.roundRect, {
        x: 7.45, y: 3.6, w: 5.1, h: 1.65,
        rectRadius: 0.08,
        fill: { color: "FAE8FF" },
        line: { color: "E879F9", pt: 1.2 },
      });
      pptSlide.addText("Suggested visual", {
        x: 7.7, y: 3.82, w: 2.1, h: 0.3, fontSize: 12, bold: true, color: "86198F",
      });
      pptSlide.addText(slide.suggestedVisual || "", {
        x: 7.7, y: 4.15, w: 4.55, h: 0.8, fontSize: 14, color: "0F172A", margin: 0.04,
      });
    }

    if (plan.presenterChecklist?.length) {
      const closingSlide = pptx.addSlide();
      closingSlide.background = { color: "FFF7ED" };
      closingSlide.addText("Presenter checklist", {
        x: 0.7, y: 0.6, w: 5.6, h: 0.55, fontFace: "Aptos Display", fontSize: 23, bold: true, color: "7C2D12",
      });
      closingSlide.addText(plan.presenterChecklist.map((item) => ({ text: item, options: { bullet: { indent: 18 } } })), {
        x: 0.85, y: 1.5, w: 10.8, h: 4.6, fontSize: 20, color: "431407", margin: 0.08, paraSpaceAfterPt: 14,
      });
    }

    const file = await pptx.write({ outputType: PptxGenJS.OutputType.nodebuffer });
    const buffer = Buffer.isBuffer(file) ? file : Buffer.from(file as ArrayBuffer);

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "Content-Disposition": `attachment; filename="${slugify(plan.title || "workspace-presentation")}.pptx"`,
      },
    });
  } catch (error: any) {
    return NextResponse.json({ error: error?.message || "PPTX export failed." }, { status: 500 });
  }
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "workspace-presentation";
}