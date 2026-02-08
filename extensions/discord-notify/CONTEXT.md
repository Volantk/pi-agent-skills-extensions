# Discord Notify — Pi Extension

## Overview
Two-way Discord ↔ pi integration. Sends notifications when pi needs input, receives text and voice messages from Discord back into pi. Each pi session gets its own Discord forum thread.

## Architecture
- Single extension file: `index.ts`
- Uses `discord.js` for bot connection and message handling
- Uses `@huggingface/transformers` with `onnx-community/whisper-base` for local voice transcription
- Uses `ffmpeg` to convert Discord's ogg/opus voice messages to 16kHz WAV
- Config persisted in `~/.pi/agent/discord-notify.json`
- Thread mappings persisted in `~/.pi/agent/discord-threads.json`

## Current Features
- [x] Bot connects on session start, disconnects on shutdown
- [x] Forum channel auto-detection, 1 thread per session
- [x] Thread reuse across restarts (persisted thread map)
- [x] Archived threads auto-unarchived
- [x] Agent responses mirrored to Discord thread as plain text
- [x] Long tasks (>15s) get an attention-grabbing embed notification
- [x] Text replies from Discord piped back into pi
- [x] Voice messages transcribed locally via Whisper base, piped into pi
- [x] Transcription echoed back in Discord so user can verify
- [x] Handles agent busy/idle state for message delivery (`followUp` vs immediate)
- [x] Commands: `/discord-setup`, `/discord-test`, `/discord-toggle`, `/discord-config`, `/discord-rename`, `/discord-unmute`
- [x] Reaction controls: 🔇 mute thread, 🗑️ mute + delete thread
- [x] Muted threads persisted in `~/.pi/agent/discord-muted.json`
- [x] Auto-rename thread when session name changes (via `pi.setSessionName()`)
- [x] Auto-generate thread name from conversation context via LLM (on first agent response)
- [x] Manual thread rename via `/discord-rename [name]` (empty = auto-generate from context)
- [x] Status indicator in footer (🔔 Discord)

- [x] Image attachments from Discord forwarded to pi as image input (base64)
- [x] Multiple images per message supported, combined with text
- [x] Image files read/written by pi uploaded to Discord thread

## Planned Improvements

### 2. Notification mentions
Add @mention or @everyone to long-task notifications so the user's phone pings.
- Add `mentionUser` config option, store user's Discord ID
- Include `<@userId>` in notification messages

### 3. Progress updates
Post to thread when pi starts working, not just when it finishes.
- Hook into `agent_start` to post "🔨 Working on: ..."
- Optionally hook into `tool_call` to post tool activity

### 4. Session context in thread
Post a summary/context when creating a new thread.
- Use compaction summary or first user message as thread starter

### 5. ~~Auto thread naming~~ ✅ DONE
~~Update thread title when session name changes or topic becomes clear.~~
- Thread auto-renames on `agent_end` when `pi.getSessionName()` changes
- On first `agent_end`, uses LLM (`completeSimple`) to generate a name from conversation context
- Manual rename via `/discord-rename [name]` (empty = LLM auto-generate)

### 6. ~~Reaction controls~~ ✅ DONE (partial)
~~React with emojis to control pi: ⏸️ pause notifications, ❌ abort task, etc.~~
- 🔇 mute thread (persisted, skip all sends)
- 🗑️ mute + delete thread (cleanup mapping + delete)
- `/discord-unmute` to resume
- Future: ⏸️ pause, ❌ abort, etc.

### 7. Multi-session thread routing
Reply in an older thread → switch pi to that session.
- Reverse-lookup threadId → sessionFile, trigger session switch

### 8. Code formatting
Wrap code blocks in Discord messages with proper syntax highlighting.
- Parse agent responses for markdown code blocks, preserve them
- Truncate long messages into multiple Discord messages (2000 char limit)

### 9. File attachments
When pi writes/edits files, attach them or post diffs to Discord.
- Hook into `tool_result` for write/edit tools, post diffs

### 10. Remote commands
Type commands in Discord like `!compact`, `!model sonnet`, `!abort`.
- Parse message prefixes, map to pi commands/actions

## Tech Notes
- Discord message limit: 2000 chars (need to split long messages)
- Discord embed description limit: 4096 chars
- Discord file upload limit: 25MB (free), 50MB (boost)
- Voice messages are ogg/opus, need ffmpeg conversion
- Whisper base model is ~200MB, cached after first download
- Bot needs intents: Guilds, GuildMessages, MessageContent
- For reactions: also need GuildMessageReactions intent
