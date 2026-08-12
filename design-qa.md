# v4.0.0 Design QA

## Comparison target

- Source visual truth: `reference-v9-student.png` and `reference-v9-teacher.png`, captured from the user-provided `xinban-ai-pet-v9-offline-demo.html`.
- Browser-rendered implementation: `implementation-v4-student-final.png` (student) and `implementation-v4-teacher-viewport.png` (teacher), rendered from `http://localhost:4173/` and `/teacher`.
- Side-by-side evidence: `qa-student-comparison.png` and `qa-teacher-comparison.png`.
- Viewport: in-app browser default 1280 × 720 CSS px, device scale factor 1. Source teacher capture is 1280 × 720 px; source student crop is 1264 × 930 px. Implementation viewport captures are 1265 × 712 px because the browser content area excludes its outer chrome. The side-by-side canvases normalize each image into equal 1280 × 720 slots without stretching.
- State: signed-out/pseudonymous default state; no real student records; teacher dashboard uses explicitly labelled fictional sample data.

## Full-view comparison evidence

The student implementation preserves the source's soft lavender palette, generous whitespace, large greeting, two-column pet-and-task composition, rounded low-elevation surfaces, and a visually dominant companion stage. The task surface intentionally replaces v9's unrestricted chat and progression mechanics with a daily mood check-in, optional one-shot AI response, explicit human-support path, and a clear end to the session.

The teacher implementation preserves the source's white header, left workbench navigation, pale background, compact metric cards, adult-facing density, and restrained purple tokens. It intentionally removes named students and ordinary conversation text; only pseudonymous identifiers, aggregates, and structured support cues remain.

## Focused fidelity review

- Fonts and typography: Chinese system sans-serif stacks render cleanly at the target viewport. The implementation matches the source's oversized dark display headings, compact uppercase eyebrow labels, and subdued explanatory copy. No clipped or overlapping text was visible.
- Spacing and layout rhythm: both surfaces retain broad page gutters, large section gaps, rounded cards, light borders, and minimal shadows. The student form is denser than the source chat pane because it includes research consent and support controls; hierarchy remains clear and is an intentional functional deviation.
- Colors and tokens: primary violet, white/lavender surfaces, dark navy text, muted grey secondary text, and restrained green/red semantic cues remain consistent with the source direction. Contrast and active-state visibility are adequate in the inspected states.
- Image quality and assets: the implementation uses the existing real `public/dog.svg` asset for the logo and companion stage. It does not replace the source animal with CSS art, emoji, placeholder boxes, or a handcrafted inline SVG. The dog remains sharp at display size and integrates with the lavender stage.
- Copy and content: student copy is brief, age-appropriate, non-diagnostic, and repeatedly clarifies that the AI may be wrong and that human help is available. Teacher copy frames signals as leads requiring human verification, not diagnosis or ranking.
- Interaction states: verified mood radio selection, text entry, optional-AI checkbox, voice disclosure panel, student-to-teacher navigation, teacher example/live toggle presentation, queue filters, and keyboard-semantic roles through the browser DOM. Cloud TTS endpoint was probed without a secret and failed closed with HTTP 503; automated provider mocks cover configured success.
- Console: no application error logs were present after the final reload. Development-only Vite/React informational messages were ignored.

## Findings and comparison history

### Iteration 1

- [P1] Earlier v3 public demo did not present the requested full student/teacher experience. Fix: v4 restores both full-stack routes and redesigns both surfaces as a paired product.
- [P1] Earlier interface lacked the user's v9 visual energy and strong companion stage. Fix: adopted the source's lavender art direction, whitespace, two-column student stage, and compact teacher workbench.
- [P1] Server-side Qwen TTS route existed but had no student-facing control. Fix: added an explicit, user-initiated Qwen cloud-read button with loading/play/pause/stop/error states; device reading remains a folded fallback; urgent content never exposes speech controls.
- [P2] Initial SSR test incorrectly required the conditional TTS button in the empty server-rendered state. Fix: removed the false static assertion and retained API/mock coverage plus browser state verification.

### Post-fix evidence

- `implementation-v4-student-final.png`: revised student surface after cloud speech wiring and hot reload.
- `implementation-v4-teacher-viewport.png`: revised teacher surface at the same browser viewport.
- `qa-student-comparison.png` and `qa-teacher-comparison.png`: normalized source/implementation comparisons.
- Production build passes; 15/15 SSR/API/provider mock tests pass.

## Remaining P3 follow-up polish

- The student route is deliberately more information-dense below the fold than the v9 chat-only reference because it includes privacy, support, voice, and consent controls.
- A later visual round could add a separately illustrated, licensed companion pose set, provided it preserves equal feedback across moods and avoids streak, level, or dependency mechanics.
- Live microphone capture and real Qwen audio output still require the user's browser permission and an Alibaba Model Studio Beijing server key, respectively.

## Final result

final result: passed
