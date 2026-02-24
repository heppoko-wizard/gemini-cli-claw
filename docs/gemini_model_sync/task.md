# Task: Gemini CLI Claw - Dynamic Model Selection Integration

## Objective
Integrate dynamic model selection (Flash, Pro, Auto) into OpenClaw's UI and `gemini-cli-claw`.

## Steps
- [x] **Research Phase**
  - [x] Investigate OpenClaw's model listing architecture (`models.json`, `loadModelCatalog`, etc.).
  - [x] Formulate integration plan.
- [x] **Implementation Phase**
  - [x] Modify `gemini-cli-claw/src/server.js` to return multiple available models dynamically sourced from `@google/gemini-cli-core` in the `/v1/models` endpoint.
  - [x] Ensure `server.js` transparently passes the chosen model string from `req.body.model` to `geminiClient`.
  - [x] Create a Node script in `gemini-cli-claw/scripts/update_models.js` that fetches the models from the Gemini CLI core and updates `~/.openclaw/agent/models.json`. Update `setup.js` to call this script.
- [x] **Verification Phase**
  - [x] Restart OpenClaw gateway and adapter.
  - [x] Verify that UI shows multiple models under `gemini-adapter`.
  - [x] Verify that selecting `gemini-2.5-flash` correctly routes the request to the adapter, and the adapter uses that model in the inference engine.
- [x] **Logging & Monitoring Phase**
  - [x] Update `src/server.js` and `src/runner.js` to log the specific Gemini model ID used for each request in `adapter.log`.
  - [x] Verify that model selection is correctly recorded during inference.
- [ ] **Documentation Phase**
  - [ ] Create `docs/gemini_model_sync/walkthrough.md` summarizing the changes (Japanese).
  - [ ] Create `docs/gemini_model_sync/resource_paths.md` listing all relevant file and log paths (Japanese).
  - [ ] Copy current `task.md` and `implementation_plan.md` to the documentation folder.
