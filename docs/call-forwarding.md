# Call forwarding — Sarah's dashboard controls the phone

(Tony Nov 19, 2026 — Grok Bot's call-forwarding build, preview branch
`cooper/call-forwarding-preview`. Nothing here is live until Tony says so.)

## The idea in one line

Sarah's dashboard decides whether a call goes to the AI agent or
forward to her phone — the agent takes all bookings and passes on
messages. The voice agent checks live before every transfer.

## Transfer modes (Call answering → "Who answers the phone?")

| Mode | What happens |
| --- | --- |
| **AI assistant answers, puts calls through when needed** (`agent_then_transfer`, default) | The AI answers first; it puts the caller through only when it can't help. |
| **AI assistant only — never put calls through** (`message_only`) | The assistant always takes a message; no call is ever put through. |
| **Calls go straight to me** (`ring_me_first`) | Every caller goes straight to Sarah's phone while transfers are on. |

The old `agentMode` ("agent" | "direct") is kept as a derived field so
the Retell prompt — which reads `agentMode` from `GET /api/transfer-status`
— keeps working. Old saved settings that only have `agentMode` are mapped,
never lost.

## Forward my calls to / Send messages to

- **Forward my calls to** — Sarah's phone number, editable on the
  dashboard. It is NEVER in the public `GET /api/transfer-status`
  response. The agent only learns it from the Retell webhook's
  `dynamic_variables`, and only while a transfer is allowed.
- **Send messages to** — email list that gets every caller message
  (comma-separated, max 5). Blank = the usual studio emails
  (`ADMIN_EMAIL`).

## Private Hours split

The day is split: regular call hours (the weekly table) and Private
Hours (7–10 AM and 5–9 PM). During Private Hours the rule is separate:

- **Take a message** (default) — the assistant never puts a call
  through then.
- **Same as my regular hours** — Private Hours follow the transfer mode.

A day switched off in the weekly table is off all day, Private Hours
included. Sundays are closed (off by default). Pausing still beats
everything: while paused, the agent takes messages.

`GET /api/transfer-status` reports `period` (`regular` |
`private_hours` | `off`) and `reason` (`on` | `paused` |
`outside_hours` | `message_only` | `private_hours`).

## Retell webhook — `POST /api/transfer-status`

Same function as the agent's take_message (no new Vercel function —
the site is at 11/12 on the Hobby limit). Told apart by header:
`x-retell-signature` → webhook; `x-agent-key` → take_message.

**Setup in the Retell dashboard** (not done by this branch — a
follow-up step): point the agent's webhook at
`https://www.boltonfacials.com/api/transfer-status` for events
`call_started`, `call_ended`, `call_analyzed`.

**Signature:** `x-retell-signature` is HMAC-SHA256 (hex) of the raw
request body, keyed by `RETELL_WEBHOOK_SECRET` or, when that is unset,
`AGENT_API_KEY` (Retell signs with the API key). A `sha256=` prefix is
accepted. No secret configured → 503. Wrong signature → 401.

**`call_started`** answers `200 { dynamic_variables: {
transfer_allowed, transfer_mode, agent_mode, period, studio_now,
forward_to? } }`. `forward_to` is present only while a transfer is
allowed. The call is also written to the Recent calls log.

**`call_ended` / `call_analyzed`** — the safety net. If a transfer
failed, the call failed, or a callback was promised but no message
exists for the call, a "Missed call" message is saved, emailed, and
pushed so nobody slips through. Clean ends save nothing. One callId
makes at most one message, however many times Retell retries.

## Recent calls + messages

- **Recent calls** (dashboard, signed-in only): every call Retell
  reported, newest first, with outcome (started / put through /
  message taken / missed call / call ended), a short summary, and
  transcript / recording links where Retell supplied them. Those links
  live only in the admin `?view=calls` response — never public.
- **Messages** carry a source (`agent` | `missed-call` | `test`) and a
  one-line summary. **Send test message** runs the whole path at once
  (save → email → pop-up) so Sarah can check it reaches her.
- New call messages ride the existing push path (pop-up + chime +
  banner), same as bookings and payments.

## Tests

`scripts/test-admin.js` section 20 covers the modes, the Private Hours
split, forward-to privacy, the webhook signature, dynamic variables,
the missed-call safety net, dedupe by callId, the test message, and
the calls log. `scripts/test-talk.js` covers the Talk commands
("calls go straight to me", "messages only", "AI assistant answers").
All 10 suites stay green.
