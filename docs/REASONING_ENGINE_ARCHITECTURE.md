# QuickStud-E Reasoning Engine Architecture

## Mission

QuickStud-E is a reasoning-time search/planning engine for education.

The system combines:

- an LLM policy prior that proposes candidate reasoning trajectories
- search logic that expands and prunes trajectories
- learned value and reranking logic that scores partial and final candidates
- structured output contracts that keep frontend integrations stable

QuickStud-E is not a single-pass chatbot and not a frontend wrapper around raw model text.

## Core Loop

Every reasoning mode should follow this backend loop:

1. Generate multiple candidate trajectories.
2. Score trajectories with a learned value model.
3. Prune weak trajectories.
4. Expand promising trajectories.
5. Select the best final reasoning path.
6. Return a structured response.

Beam-style search is the default search shape. The exact branching factor, beam width, and stopping criteria can vary by mode, but the controller should always make explicit generate, score, prune, expand, and select decisions.

## Architectural Separation

Keep the reasoning engine modular.

Frontend code must never directly depend on:

- research scripts
- training artifacts
- experimental notebooks
- dormant RH or GR code
- ad hoc local experiment outputs

Allowed integration boundary:

- stable API routes
- shared contracts under `lib/reasoningEngine/`
- stable domain modules such as flashcards, tutoring, analytics, and users

The current Next.js repo layout remains valid, but product code should map conceptually to the following backend domains:

```text
backend/
  api/
  reasoning_engine/
  flashcards/
  tutoring/
  analytics/
  users/

research/
artifacts/
old_experiments/
```

In this repository today, `app/api/*` provides the API layer and `lib/reasoningEngine/*` is the stable reasoning-engine contract surface.

## Responsibility Split

### Reasoning Engine

The reasoning engine owns:

- candidate generation
- beam search
- reranking
- value estimation
- trajectory pruning
- reasoning verification
- confidence estimation

### LLM

The LLM is treated as:

- a policy prior
- a reasoning generator
- a trajectory proposal model

The LLM is not the final authority.

### Value Model

The value or reranking model evaluates:

- reasoning quality
- completion quality
- consistency
- correctness likelihood
- trajectory usefulness

The value model guides search and final selection.

## Search Logic

Use beam-style search over reasoning trajectories.

At each step:

1. Expand candidate trajectories.
2. Score partial trajectories.
3. Keep the top-k beams.
4. Continue rollout until a stop condition is met.

This is the product approximation of MuZero or LightZero-style search for educational reasoning tasks. Keep it pragmatic: search quality, verification quality, and output quality matter more than speculative large-scale RL infrastructure.

## Required Structured Outputs

All reasoning responses must return structured JSON with this shape:

```json
{
  "final_answer": "...",
  "reasoning": "...",
  "confidence": 0.0,
  "trajectory_score": 0.0,
  "search_depth": 0
}
```

Do not return giant raw text blobs to the frontend.

Mode-specific outputs may extend this object, but every reasoning response should preserve these core fields.

## Flashcard Mode

Flashcard generation should:

1. generate multiple candidate cards
2. rerank candidates
3. verify correctness
4. estimate difficulty
5. select the highest-quality outputs

Flashcard generation is therefore a specialized reasoning mode, not a single-shot completion task.

## Verification Mode

The reasoning engine should support:

- answer verification
- explanation comparison
- reasoning critique
- misconception detection
- tutoring guidance

## Student State

Maintain lightweight student knowledge state that can influence search and planning:

- weak topics
- prior mistakes
- confidence
- retention estimates
- reasoning patterns

Use this state to guide future search, verification, and tutoring decisions.

## Adaptive Authority Governance

QuickStud-E now treats adaptive tutoring as a governed production policy subsystem, not as an offline experiment beside the product.

The adaptive layer must be:

- serialized
- versioned
- inspectable
- replay-visible
- flag-gated
- telemetry-backed

The operating rule is:

unsafe adaptive behavior must become observable before it can become authoritative.

That means disagreement drift, calibration collapse, local pathology, and unstable candidate geometry must be visible in replay and analytics before the adaptive layer is allowed to affect users.

This rule applies to all future MuZero, Muon, and LightZero-inspired components, including:

- candidate generation
- value prediction
- reranking
- search and planning
- future online tuning

No such component gains authority unless it remains observable, replayable, abstainable, bounded, and reversible.

The enduring constitutional asymmetry of the platform is:

```text
capability may evolve
authority must be earned
```

Operationally, that means capability growth never implies authority growth. Authority increases require sustained replay evidence, healthy review cadence, stable recovery monitoring, and bounded rollout discipline over time.

## MuZero And LightZero Integration Pattern

Use MuZero and LightZero as the planning and evaluation pattern, not as unchecked authority.

The current product mapping is:

| MuZero / LightZero concept | QuickStud-E role |
| --- | --- |
| policy prior | Qwen/DeepSeek tutoring candidates |
| state | `StudentState` plus misconception history |
| action | tutoring strategy or hint style |
| value | predicted `confidence_delta` or recovery value |
| replay buffer | `ReasoningRun` plus candidate replay |
| search/evaluation | offline reranking plus replay console |
| rollout governance | shadow mode plus readiness gates |

This is the correct current integration boundary.

Do not force full MCTS tutoring search yet.

## Muon Role

Use Muon-style ideas as a low-authority trust and value-correction layer.

The intended shape is:

```text
heuristic controller
  + sparse learned correction
  + disagreement and abstention governance
```

That means Muon-like behavior in this system should currently mean:

- low-authority value correction
- candidate-local trust signal
- replay-tested scoring
- not a hard controller

The deployable scoring shape remains:

```text
final_score = heuristic_score + small_weight * learned_value_score
```

and only under:

- shadow logging first
- override budget
- abstention threshold
- rollback flag

## Real Shadow Evidence Pipeline

The next concrete LightZero and MuZero-compatible work should happen in this order:

1. Collect real shadow traces.
2. Export those traces from persisted `tutor_guidance` runs.
3. Analyze disagreement geometry, abstention, score margins, misconception concentration, and strategy concentration.
4. Build `real_shadow_dataset_v1` from live traces, not synthetic-only traces.
5. Train and evaluate value models on real traces using `confidence_delta` or recovery proxy targets.
6. Only then consider bounded active override experiments.

At the current stage, the real shadow dataset is more valuable than additional synthetic expansion.

## Operational Review Cadence

Once the public product loop is live, the next governing loop is operational rather than architectural.

That recurring loop should review:

- shadow telemetry exports
- replay disagreement clusters
- recovery-pattern monitoring from persisted `study_recovery` events
- drift in strategy and misconception concentration
- whether bounded authority discipline is still being preserved

The operational runbook for that phase lives in `docs/OPERATIONAL_REVIEW_CADENCE.md`.

Do not treat the dashboard, recovery timeline, and replay surfaces as isolated UX or debugging features. They are part of the live operational evidence system.

## Deferred Planning Authority

Full MuZero-style planning may enter later, but only after shadow telemetry stabilizes and the governance loop proves durable under real traffic.

The future shape can be:

```text
StudentState
  -> candidate tutoring actions
  -> predicted next student state
  -> predicted confidence or recovery value
  -> bounded search over 1-3 steps
  -> replay-visible recommendation
```

But that future layer must still remain:

- shadow-first
- replay-visible
- override-budgeted
- abstainable
- reversible

## Not Yet

Do not add these yet as authoritative product behavior:

- online RL updates
- live MCTS authority
- automatic policy replacement
- disabling heuristic fallback
- widening override budgets because offline numbers improve
- planner complexity before real shadow telemetry is understood

## Deployment Posture

For the concrete pre-launch verification sequence, use `docs/GO_LIVE_CHECKLIST.md`.

The current safe rollout pattern is:

1. Live candidate scoring enabled.
2. Shadow telemetry enabled.
3. Adaptive authority disabled.
4. Heuristic controller remains authoritative.
5. Replay governance evaluates whether authority has been earned.

The first real deployment mode for adaptive tutoring should therefore be shadow-only, where the system:

- scores tutoring candidates with a frozen serialized artifact
- compares heuristic and adaptive selections
- logs disagreements, abstentions, and hypothetical overrides
- persists those traces for replay inspection
- serves the heuristic-selected tutoring path to users

Do not skip directly from offline evaluation to live adaptive control.

## Replay And Interpretability Boundary

The replay console is not only a debugging viewer.

It is the interpretability boundary for adaptive authority.

It should answer:

- why adaptive disagreed
- why abstention occurred
- which candidate lost
- what scores were compared
- whether the disagreement was understandable

Authority escalation decisions should be justified from replay-visible evidence, not from isolated aggregate metrics or intuition.

## Adaptive Governance Loop

The intended lifecycle is:

1. Offline policy evaluation.
2. Serialized deployment artifact selection.
3. Shadow live scoring.
4. Replay-visible telemetry collection.
5. Human interpretability review.
6. Readiness gating.
7. Bounded authority escalation.

This is the correct bridge from synthetic evaluation to real adaptive behavior.

## Rollout States

Adaptive rollout maturity should be treated as progressive, not binary.

- hold shadow mode: evidence is unsafe or insufficient
- continue shadow collection: evidence is incomplete
- eligible for bounded trial: evidence is sufficient for a constrained override experiment

These states are better than a simple enabled or disabled toggle because they separate evidence accumulation from authority escalation.

## Primary Operational Risks

Once the adaptive layer is live in shadow mode, the dominant risks are operational rather than architectural.

Monitor for:

- disagreement clustering
- abstention collapse
- score-margin compression
- unexplained overrides
- misconception concentration
- strategy-mode dominance

The system should protect against local failure modes that can be hidden by safe-looking global averages.

## Shadow Readiness Criteria

The most important shadow-phase checks are:

- disagreement is sparse and stable
- abstention remains common
- override clusters are interpretable
- candidate-score spread is non-collapsed
- misconception concentration is not pathological
- strategy concentration does not show policy collapse
- replay traces remain human-explainable
- synthetic-to-real distribution drift looks sane

Raw lift alone is not enough to justify enabling adaptive authority.

## Engineering Review Checklist

For implementation-time review of any adaptive change that increases capability or authority, use `docs/ADAPTIVE_CHANGE_REVIEW.md`.

That checklist is intentionally short and strict. It turns the architectural doctrine into a concrete gate for implementation review, rollout review, and future policy upgrades.

## Strategic Constraint

Prioritize:

- search
- planning
- verification
- trajectory selection
- educational usefulness

Do not prioritize:

- giant foundation-model training
- speculative physics-inspired architecture
- massive RL infrastructure before product value is proven

At the current stage, do not prioritize:

- online retuning before shadow evidence exists
- widening adaptive authority before replay evidence exists
- optimizing for disagreement frequency instead of safe correction quality

## Immediate Engineering Priorities

1. Shadow telemetry collection on real tutoring traffic.
2. Replay inspection of disagreement and abstention behavior.
3. Synthetic-to-real feature and score-distribution comparison.
4. Bounded adaptive rollout gating.
5. Only then, consider a tightly constrained override trial.

## Operational Rule

When adding new backend features, first ask:

1. Where is the stable API boundary?
2. What reasoning trajectory is being generated and scored?
3. What value or reranking signal decides selection?
4. What structured JSON contract will the frontend consume?
5. Does the change accidentally couple product code to research or artifact directories?
6. Can unsafe adaptive behavior be observed in telemetry and replay before it can affect users?
7. What explicit gate prevents authority creep if the adaptive layer behaves badly under real traffic?

If those questions are unanswered, the implementation is not complete.