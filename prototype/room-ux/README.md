# Room UX prototype

Throwaway UI prototype for the **Minimal Browser Room UX** decision. It has three structurally different variants on one route:

- `?variant=A` — Calm focus: centered timeline
- `?variant=B` — Agent workbench: participants, timeline, and agent context panes
- `?variant=C` — Briefing room: editorial brief with design reference
- `?variant=D` — Review workspace: room context, read-only shared plan, and discussion pane inspired by Plannotator

Run it with one command from the repository root:

```sh
python3 -m http.server 4173 --directory prototype/room-ux
```

Then open `http://localhost:4173/?variant=A`. Use the bottom switcher or keyboard arrows to compare variants. The interactions are fake and in-memory; this is not production code.
