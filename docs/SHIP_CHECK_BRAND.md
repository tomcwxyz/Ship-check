# Ship Check visual identity

Ship Check should look related to the Good Ship family without looking interchangeable with the other products.

The visual idea is **inspection instrument**: the sort of marks, plates and annotations used when something is being checked before it is trusted to go into service. It borrows lightly from maritime survey/load-line language without turning the interface into a literal nautical theme.

## Character

Ship Check is:

- calm, exact and practical;
- evidence-led rather than alarmist;
- technical without becoming a cyber-security dashboard;
- warm enough to remain recognisably Good Ship;
- explicit about uncertainty and scope.

It should not feel like:

- a generic rounded SaaS dashboard;
- a hacker/cyber-security product;
- a compliance certification product;
- a ship-themed novelty interface.

## Mark

The in-product mark is an abstract **survey ring**: a circle crossed by a horizontal inspection line, held inside a square signal-orange plate.

It is intentionally adjacent to maritime load-line/survey marks rather than a literal reproduction of a regulatory certification mark. The square plate makes it read as a tool/instrument symbol and gives Ship Check a recognisable silhouette at small sizes.

For alpha.8 the mark is rendered in CSS in the desktop header. A future packaged-app icon should use the same geometry rather than reverting to the old checkmark motif.

## Palette

Core tokens are defined in `apps/desktop/ui/ship-check-brand.css`.

| Role | Value | Use |
| --- | --- | --- |
| Graphite | `#18211f` | Primary type, hard borders, instrument structure |
| Salt paper | `#f6f3ea` / `#fffdf7` | Working surfaces |
| Signal orange | `#f2633a` | Brand mark, primary action, inspection accents |
| Survey green | `#236650` | Local/ready/verified contextual signals |
| Inspection yellow | `#f2e5aa` | Questions and caution without implying a defect |

Orange is a signal, not a warning colour to be sprayed across the interface. Severity continues to use its own evidence/status semantics.

## Shape and layout

- Prefer 2–4px corner radii over soft rounded cards.
- Use hard one- or two-pixel graphite rules to organise the interface.
- Use offset hard shadows sparingly on the two primary working surfaces.
- Use vertical colour rails for finding/question context rather than large tinted cards.
- Keep generous whitespace: the interface is an inspection sheet, not a dense SOC console.

## Typography

- Product and explanatory copy use the system sans-serif stack.
- Evidence metadata, state labels, section markers and IDs use the system monospace stack.
- Large editorial serif display type is deliberately removed from Ship Check; that is one of the strongest distinctions from other Good Ship products.

## Language and status

The visual identity must reinforce the product's evidence contract:

- **finding** — a concrete repository-supported concern;
- **question / unverified** — something that needs checking, not a defect;
- **observation** — useful project context, not a safety claim;
- **coverage** — bounded assessment, never a score.

Avoid visual devices that imply certification, a percentage-safe score, or a binary pass/fail for the whole application.

## Implementation

The brand layer is isolated in `apps/desktop/ui/ship-check-brand.css` and imported by the alpha.8 stylesheet after the existing structural stylesheets. This keeps behaviour and layout logic separate from identity and makes later iteration relatively low-risk.
