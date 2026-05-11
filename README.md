This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://nextjs.org/docs/app/api-reference/cli/create-next-app).

## Product Architecture

QuickStud-E is a reasoning-time search/planning system, not a single-pass chatbot wrapper.

Product positioning: QuickStud-E is a replay-governed adaptive tutoring platform. It uses LLMs for tutoring, persistent student-state modeling for personalization, and MuZero/LightZero-inspired replay and value evaluation to improve tutoring decisions under strict governance.

Avoid claiming that the product is already a full autonomous MuZero agent. The correct claim is that the product uses MuZero-style principles such as policy priors, candidate actions, value estimation, replay, and governed rollout evaluation.

The implementation contract for that architecture lives in `docs/REASONING_ENGINE_ARCHITECTURE.md`.

The student-facing product roadmap and bounded feature rollout plan live in `docs/PRODUCT_FEATURE_MAP.md`.

The visual companion to that roadmap lives in `docs/VISUAL_PRODUCT_ARCHITECTURE_MAP.md`.

Two repo rules follow from that contract:

- App and frontend code only interact with stable product APIs and shared contracts.
- Research code, training artifacts, notebooks, and dormant experiments are not product dependencies.

Adaptive capability changes are also governed by an explicit review and rollout doctrine. Contributors should read `CONTRIBUTING.md` and `docs/ADAPTIVE_CHANGE_REVIEW.md` before changing adaptive behavior or authority.

Real adaptive shadow telemetry exports are operationalized in `docs/SHADOW_EXPORT_WORKFLOW.md`.

Recurring post-launch replay, shadow, drift, and recovery monitoring is defined in `docs/OPERATIONAL_REVIEW_CADENCE.md`.

Pre-launch deployment verification is defined in `docs/GO_LIVE_CHECKLIST.md`.

The executable weekly governance bundle can be generated with `npm run reasoning:report:weekly`.

## Deployment Posture

The current production posture is:

- `TUTORING_ADAPTIVE_RERANK_SHADOW=1`
- `TUTORING_ADAPTIVE_RERANK_ENABLED=0`
- `INTERNAL_OPERATOR_CLERK_USER_IDS=<comma-separated Clerk user ids for replay/governance access>`

That means the website ships as a complete tutoring product with live adaptive shadow scoring, while heuristic tutoring remains authoritative until replay evidence justifies a bounded trial.

The replay console and governance APIs are intended to remain internal-only. In production, operator access is restricted by `INTERNAL_OPERATOR_CLERK_USER_IDS`.

Deployable product features now include:

- AI tutoring and hints
- student-state memory
- misconception tracking
- recovery tracking
- replay analytics
- adaptive shadow scoring
- readiness dashboard
- exportable shadow datasets

Full MCTS or autonomous planner authority is intentionally not yet authoritative in the live product.

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

## Flashcards Local Smoketest

Run this to verify RunPod output is parseable (bypasses auth using `FLASHCARDS_TEST_KEY`).

1) Terminal A:

```bash
npm run dev
```

2) Terminal B:

```bash
set FLASHCARDS_TEST_KEY=localtest
npm run flashcards:smoketest -- --text "Water expands when it freezes..."
```

PowerShell equivalent:

```powershell
$env:FLASHCARDS_TEST_KEY = "localtest"
npm run flashcards:smoketest -- --text "Water expands when it freezes..."
```

To test a deployed endpoint (including YouTube URL → transcript → flashcards):

```powershell
$env:FLASHCARDS_TEST_KEY = "localtest"
npm run flashcards:smoketest -- --base "https://YOUR_DEPLOYED_DOMAIN" --url "https://www.youtube.com/watch?v=VIDEO_ID" --cards 10
```

Confirm the response shows `origin="youtube"` and includes `timings` like `supadata_ms`, `llm_flashcards_ms`, and `total_ms`.

If the AI endpoint is misbehaving, the response will include an error code like `AI_NO_FLASHCARDS`.

You can start editing the page by modifying `app/page.tsx`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.
