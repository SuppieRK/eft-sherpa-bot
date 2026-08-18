# Bot operation

## Viewer commands

Twitch is the primary request path.

- Use `!request [mode] [map] [goal]` to ask for help.
- Use `!queue` to see your next request and the raids before it.
- Use `/request` in Discord to open the request form.
- Use `/queue` in Discord to see your next request.
- Use `/link-twitch` in Discord to link your Discord account to your Twitch name.

Use `seasonal`, `pvp-seasonal`, or `pvp seasonal` for PvP Seasonal. Use `pvp` for PvP. Use `pve` for PvE.

The Twitch goal is optional. The bot uses `General raid help` when the viewer does not give a goal.

The Discord `/request` command requires a game mode. Discord does not open the form until the viewer selects PvP Seasonal, PvP, or PvE.

The form asks for a Twitch name, an Escape from Tarkov name, a map, a goal, and optional notes. The goal has a limit of 150 characters. The notes have a limit of 250 characters.

The bot groups requests only when the mode and map are the same. One viewer can have one active request for each mode and map. Queue position is for the selected mode. The raids-ahead value uses the same fair order as the staff board.

## Staff controls

Use `/board` in the staff channel. The board shows up to three priority raids and seven ordinary raids. Each non-empty mode gets at least one visible raid in each section. The bot then fills the other places in FIFO order.

Select **Start a raid** to assign the caller as the leader. The bot sends a Discord call with the mode and map. The bot also sends a Twitch call with the mode and map when the streamer is the leader.

The raid message has these controls:

- **Record a raid result**;
- **Postpone requester**;
- **Remove requester**.

The default attempt limit is three. Before the last attempt, staff can record **Helped** or **Record unsuccessful attempt**. On the last attempt, staff can record **Helped** or **Postpone raid**.

**Postpone raid** moves the same raid to the end of the priority queue. **Postpone requester** moves one requester to a dedicated raid after the current raid. **Remove requester** cancels the help request.

Staff can use the board at any time. The Twitch schedule does not hide the board or stop requests.
