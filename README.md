# Virtual Office

A 2D pixel-art office where five AI agents work through a sprint backlog in front of you. Each character has a role — Scrum Master, System Architect, Senior Backend, Frontend, QA and Security — walks between rooms on a waypoint graph, and reports progress on the board as the pipeline advances.

It is a visual front end for an agent pipeline: you write the backlog, the agents pick tasks in order, and the office shows who is doing what, where, and why.

## What it does

- **Top-down office** rendered on HTML5 Canvas: pantry, war room, developer cubicles, and a QA/server room, each with its own furniture, lighting, and idle behaviour.
- **Five agents** with distinct outfits, roles, and status labels that follow them around the room.
- **Waypoint navigation** — agents walk corridors and doorways along shortest paths rather than teleporting between desks.
- **Sprint pipeline** — a sequential handoff from planning to architecture to implementation to review, driven by the backlog you enter.
- **Kanban and burndown** — sticky notes and a velocity chart on the war-room wall reflect the current sprint.
- **Live log** — every agent action is written to the side panel as it happens.

## Stack

| Layer | Choice |
| --- | --- |
| Rendering | HTML5 Canvas, hand-written sprite and pathfinding code |
| Frontend | Vanilla JavaScript, CSS, no framework or build step |
| Server | Node (`server.js`) for the agent API, with a Python fallback server (`server.py`) for static serving |
| Model access | OpenRouter-compatible endpoint; the API key is entered in the UI and kept in `localStorage` |

## Running

```bash
node server.js
```

Then open <http://localhost:3000>.

If you only want the office without the agent pipeline, serve the folder statically:

```bash
python server.py
```

Open the settings panel in the app, paste your own OpenRouter API key, and choose a model. Nothing is sent anywhere except to the endpoint you configure.

## Project layout

```
index.html                 Single-page application shell
css/                       Styles for the office, panels, and overlays
js/
  app.js                   Application wiring
  config.js                Storage keys and default model settings
  renderer.js              Canvas rendering, rooms, furniture
  characters.js            Agent definitions and sprites
  character-manager.js     Agent state and movement
  waypoints.js             Waypoint graph and pathfinding
  sprint-manager.js        Backlog, pipeline, burndown
  meetings.js              War-room meeting behaviour
  llm-client.js            Model calls
  integrations.js          Server bridge
  simulation-data.js       Seed data
server.js                  Agent API proxy
server.py                  Static server fallback
```

## Notes

The agents produce code suggestions; nothing is executed automatically. Review anything an agent generates before you use it. Your API key stays in browser storage and is never written to disk on the server.

## Licence

Personal project. Not licensed for redistribution.
