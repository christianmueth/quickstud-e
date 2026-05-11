# UX Review Playbook

Use this playbook after deployment to evaluate QuickStud-E as a lived tutoring experience rather than as a set of individual screens.

The goal is not more abstract polish. The goal is to observe real interaction flow, find continuity breaks, and improve the behavioral feel of the product without widening authority.

## Review Principle

At this stage, the most important question is not "does each component look fine?"

The most important question is:

```text
does the product feel like one calm adaptive tutor across a full session?
```

## What To Review

Run real sessions that include:

- first sign-in or return after time away
- entering the study workspace
- choosing a learning space
- completing a guided session
- asking for tutor help
- grading uncertain prompts
- reaching the end-of-session reflection
- checking the progress dashboard
- coming back the next day or after a break

Do not review isolated screens only. Review the flow across time.

## Core Review Questions

During each session, ask:

- does the session feel guided?
- does the tutor voice stay consistent?
- does the pacing feel calm or rushed?
- do recommendations feel interpretable?
- do transitions feel intentional?
- do empty, loading, and error moments stay supportive?
- does the system feel like a tutor or like software tooling?

## High-Value Test Scenarios

### 1. First Guided Session

Path:

- sign in
- land on `/app`
- open a recommended learning space
- complete 5 to 10 prompts
- trigger tutor help at least once
- finish the session and read the reflection

Observe:

- whether pre-session framing feels helpful
- whether tutor help feels timely
- whether the reflection feels like a natural end to the session

### 2. Weak-Topic Recovery Loop

Path:

- open a recommended concept from progress
- intentionally struggle on a few prompts
- use tutor help
- continue until a recovery reflection appears

Observe:

- whether the product stays encouraging without becoming vague
- whether the tutor explains why the concept is back
- whether the student can tell what improved and what still needs work

### 3. Interrupted Session

Path:

- start a guided session
- leave midway
- return later
- resume the same learning space

Observe:

- whether continuity is preserved
- whether the return feels like resuming a tutor relationship rather than reopening software

### 4. Empty Or Low-Data Session

Path:

- use a new account or one with minimal history
- explore workspace, study, and progress

Observe:

- whether low-data states still feel supportive
- whether the system explains that guidance will improve with use
- whether anything feels cold or incomplete

### 5. Error And Recovery Path

Path:

- hit auth expiry, network issues, or a temporarily unavailable page if reproducible

Observe:

- whether the language stays calm and study-oriented
- whether the next step is obvious
- whether technical wording leaks through the tutor experience

## Continuity Breaks To Log

A continuity break is any moment where the product stops feeling like one guided tutoring experience.

Log all moments where:

- a screen suddenly sounds SaaS-like
- a modal sounds CRUD-like
- an error becomes technical
- a button label feels mechanical
- the tutor voice disappears between surfaces
- a recommendation appears without enough explanation
- a transition feels abrupt or emotionally flat

For each break, record:

- route or component
- exact triggering action
- exact visible text
- why it broke continuity
- severity: high, medium, or low
- proposed wording or flow fix

## Session Rhythm Review

Watch for pacing problems such as:

- too many prompts without reflection
- tutor help appearing too late
- dashboard feeling analytical instead of actionable
- workspace feeling busy before study begins
- session ending too abruptly after the last prompt

If the product feels intelligent but tiring, the issue is often rhythm, not capability.

## What Not To Do During Review

Do not respond to UX discomfort by expanding authority.

Do not use review findings to justify:

- planner authority
- online RL
- hidden autonomy
- wider adaptive override scope
- opaque ranking changes without replay evidence

The right first response is usually better expression, pacing, or continuity.

## Recommended Review Cadence

For the first post-launch phase:

- run at least 3 full self-directed study sessions
- run at least 1 weak-topic recovery loop
- run at least 1 interrupted-session return test
- log continuity breaks after each session
- batch fixes by severity, not by random page order

## Review Output Format

Use a simple review log with these columns:

| Date | Scenario | Surface | Break or friction | Severity | Proposed fix |
| --- | --- | --- | --- | --- | --- |

Keep fixes concrete. Example:

- change "Delete all decks" to "Remove all study sets"
- add a return-state reminder on `/app`
- shorten the tutor reflection if the session already felt long

## Success Definition

This phase succeeds when:

- the product feels like one tutor across a full session
- the student can understand why the next step is recommended
- low-data and failure states still feel supportive
- the session starts, flows, and ends with clear educational intent

The success condition is not more autonomy.

The success condition is coherent adaptive learning feel.