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

Select **Review a raid**. The bot freezes the proposed group and opens one raid message. The raid message shows each requester, goal, and note. The bot does not assign a leader, start an attempt, or call a requester during review.

The planned raid message has these controls:

- **Call and start raid**;
- **Pull requester up**;
- **Move requester to next raid**;
- **Remove requester**.

Use **Move requester to next raid** or **Remove requester** before you call the raid when the proposed group must change. Automatic grouping and requester limits do not change. A reviewed raid does not accept a new automatic requester.

Use the **Pull requester up** list to fill an open requester place from a later raid with the same mode and map. The list is in the raid review message. It shows each Twitch name and goal. Select one requester after you review the goals. The list is disabled and shows **No compatible requester available** when no suitable later request exists.

The pull does not call a requester, assign a leader, or start an attempt. A priority raid can pull one selected ordinary requester. Only that selected request becomes priority.

If someone deletes a planned raid review message, select **Refresh** or select that raid from **Review a raid**. The bot removes the old board link. It does not create a replacement message. Select **Review a raid** later to open new details.

If someone deletes the details for an active raid, select **Refresh**. The bot restores the active message because it contains the raid result controls.

After the pull, the bot can move all requesters who remain in the source raid to the next compatible raid. The bot makes this move only when all remaining requesters fit. Otherwise, the source raid stays in its current place.

Select **Call and start raid** when the group is correct. The staff member who selects this control becomes the leader. The bot starts attempt one and calls only the current requesters. The bot sends a Discord call with the mode and map. The bot also sends a Twitch call with the mode and map when the streamer is the leader.

The active raid message has these controls:

- **Record a raid result**;
- **Postpone requester**;
- **Remove requester**.

The default attempt limit is three. Before the last attempt, staff can record **Helped** or **Record unsuccessful attempt**. On the last attempt, staff can record **Helped** or **Postpone raid**.

**Postpone raid** moves the same raid to the end of the priority queue. **Postpone requester** moves one requester to a dedicated raid after the current raid. **Move requester to next raid** does the same operation before the raid starts. **Remove requester** cancels the help request.

Staff can use the board at any time. The Twitch schedule does not hide the board or stop requests.
