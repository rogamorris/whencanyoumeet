# Agent-Native Group Scheduling
## Product Requirements Document — v0.2

**Date:** September 17, 2026  
**Status:** Proposed product concept and validation plan; not a validated market specification.  
**Working descriptor:** A shared scheduling poll that people and their agents can operate interchangeably.  
**Initial commercial constraint:** Free for ordinary use, with explicit fair-use limits and bounded operating costs.

## 1. Mission and product thesis

Enable a group to find a mutually workable meeting time with minimal human coordination, using one shareable link and whichever agent, calendar, or manual workflow each participant already uses.

**Product promise:** Create a poll. Share one link. Let people—or their agents—answer. See what works. Choose a time.

The product is a coordination service, not a new personal assistant. Participants’ agents interpret their calendars and preferences. The service owns the event constraints, submitted answers, aggregation, and recorded decision. Its core workflow does not require access to participants’ calendars or run its own language model.

The ambition to become a common agent integration is a distribution objective, not a launch prerequisite. A group must obtain value even when only its organizer or one participant uses an agent.

### Initial market hypothesis

Start with trusted groups of roughly 3–20 people who schedule occasional meetings across organizations, calendar systems, or time zones. At least one member already delegates tasks to an agent. Examples include project groups, community organizers, collaborators, and small teams.

The organizer is the initial adopter; invited participants determine whether the experience succeeds. Agent developers and platform integrators are a secondary stakeholder group. Enterprise identity administrators and high-volume scheduling operators are not the first design center.

### Boundaries

Version 1 finds a time for **one meeting of a specified duration within concrete date/time windows**. It does not solve recurring schedules, staff shifts, rooms/resources, appointment sales, attendance management, or general event management.

A response is an availability statement—not a calendar hold, booking, or attendance RSVP. A finalized poll records the organizer’s choice; it does not prove that an invitation was delivered or that participants’ calendars remain unchanged.

## 2. Development approach and evidence status

Ulrich, Eppinger, and Yang’s framework separates customer needs from product specifications and places concept generation, selection, and testing before final specifications. Economic analysis, competitive benchmarking, and prototypes accompany that process. This document applies that sequence rather than treating a feature list as established demand.[^1][^2]

The customer-needs method translates statements about solutions into statements about desired outcomes: what the product accomplishes rather than how it is implemented.[^3]

**Evidence available:** The founder’s brief and the explicitly stated WhenIsGood reference experience. WhenIsGood describes a no-signup flow of marking proposed times, sharing a link, collecting answers, and reviewing overlap.[^4]

**Evidence not yet available:** Observed participant behavior, measured importance rankings, real agent-completion rates, production economics, and comparative task benchmarks. Need priorities, limits, and numeric targets below are proposed decisions for testing—not research findings or published industry benchmarks.

## 3. Customer needs hierarchy

Priorities mean **Essential** (failure defeats the initial product promise), **Important** (materially improves resolution), or **Later** (useful but not required for the first proof). “Brief” identifies a need directly expressed or closely paraphrased from the founder’s request; “Hypothesis” identifies a proposed latent need.

| ID | Primary need / supporting need | User | Priority | Basis |
|---|---|---|---|---|
| N1 | **Low-effort coordination:** The product carries one scheduling request across the group’s existing communication channels. | Organizer | Essential | Brief |
| N2 | The product lets an authorized delegate complete the scheduling workflow without requiring manual user interaction or brittle UI automation. | Organizer and participant | Essential | Brief |
| N3 | The product accepts participation through different agents and through a simple manual interface. | Group | Essential | Brief |
| N4 | **Faithful availability:** The product preserves the organizer’s date, time-window, and duration constraints. | Organizer | Essential | Brief + duration hypothesis |
| N5 | The product captures a participant’s actual willingness to meet, including uncertainty, rather than equating an empty calendar with consent. | Participant | Essential | Hypothesis |
| N6 | The product lets participants understand, revise, and withdraw what was submitted for them. | Participant | Essential | Hypothesis |
| N7 | **Trustworthy decisions:** The product reveals workable meeting-length options and distinguishes absent answers from negative answers. | Organizer | Essential | Hypothesis |
| N8 | The product makes the chosen time and the status of the decision unambiguous. | Group | Important | Hypothesis |
| N9 | **Low participation burden and disclosure:** The product completes ordinary participation without a new account or central calendar connection and limits disclosure to the scheduling task. | Participant | Essential | Hypothesis |
| N10 | The product remains easy to use across time zones, mobile devices, keyboards, and assistive technology. | Group | Essential | Hypothesis |
| N11 | The product gives integrators predictable behavior, recoverable failures, and stable interfaces. | Integrator and agent user | Essential | Derived from N2 |
| N12 | The product can fill availability directly from a connected calendar for people not using an agent. | Participant | Later | Brief: optional enhancement |

### Important distinctions

**User and delegate are not the same stakeholder.** The human needs control and a trustworthy result. The agent needs precise data, sufficient authority, and recoverable operations. API convenience cannot substitute for human comprehension.

**No calendar access is not the same as no availability.** An agent that cannot inspect a relevant calendar should report the limitation or ask its user—not submit an empty response as though every time were unavailable.

**Calendar-free is not preference-free.** Focus time, travel, caregiving, meal breaks, and willingness to meet may affect an answer. Those decisions remain with the person or their delegate. The service receives only their chosen availability states.

## 4. Concept exploration and provisional selection

Concept selection should compare alternatives against needs and combine useful qualities, rather than merely defend the first concept. These are design judgments to test, not measured competitor ratings.[^5]

| Concept | Useful quality | Important limitation | Decision |
|---|---|---|---|
| Manual shared poll | Lightweight link and shared overlap | Participants still inspect and transcribe availability | Retain as the human interface and benchmark |
| Centrally connected calendars | Automatic free/busy collection | Requires new calendar authorization; preferences still need interpretation | Optional later input method |
| Email-based agent negotiation | Fits existing communication channels | Requires a clear strategy for preserving group state and supporting manual responses | Do not make this the first coordination mechanism |
| Shared poll with delegated responses | Preserves one shared event while letting each person use their own delegate | Success depends on real write-capable integrations and careful authority handling | Preferred initial concept |

**Selected combination:** Familiar manual poll + one shared event record + structured read/write access + browser-native WebMCP tools where supported + delegates using their existing calendar access. WebMCP is a preferred browser-agent path, not the only integration surface.

This selection does not establish that the implementation must be built from scratch. Before committing engineering effort, run the same core acceptance scenario against plausible existing projects. Reuse, extension, and a small new implementation remain legitimate technical choices.

## 5. Core experiences

### 5.1 Organizer creates and shares a poll

Example request to an agent:

> Find a 60-minute time for our planning group next week. Offer weekdays from 9 a.m. to 6 p.m. in America/New_York. Give me a link to share.

The agent resolves relative dates to concrete dates, resolves required missing information, creates the poll, and returns the public invitation link. The creation receipt also contains private management authority, clearly separated from the public link.

The organizer can optionally specify expected participants and a response deadline. These are not prerequisites for creating an open-link poll.

The organizer’s own availability is a separate response. Defining the times the group may consider does not automatically assert that the organizer is personally available throughout them.

A human organizer can perform the same creation and management actions in the web interface.

### 5.2 Participant delegates a response

Example request:

> Please answer this scheduling poll using my calendars. Protect my existing focus blocks and leave 15 minutes between meetings.

A supported agent retrieves the current event constraints and permitted actions, checks its user’s calendar and preferences through existing tools, and submits one bounded availability response. The service confirms the saved answer and provides authority for retrieving, editing, or withdrawing that response.

The agent reports what it actually did, for example:

> Submitted eight available options and two tentative options. I did not reserve time or book a meeting.

If the agent lacks calendar access or a write-capable integration, it explains the missing capability. It does not claim to have submitted, invent availability, or require the user to discover an invisible failure.

### 5.3 Participant answers manually

The shared page shows the event purpose, duration, date range, and a prominent, changeable display time zone. Participants enter a name, mark availability in a familiar grid or accessible list, and submit.

The page explains what unselected times mean before submission. It returns a visible confirmation and an edit/recovery link. No account or calendar connection is required.

The manual experience is a first-class participation route, not a technical fallback page.

### 5.4 Organizer reviews and chooses

The organizer—or an authorized organizer agent—can inspect response progress, workable full-duration options, tentative alternatives, and missing responses.

The organizer chooses a time or determines that no suitable time exists. Finalizing records a specific interval against a specific event/results version and updates the shared page.

The final page offers a calendar file and a copyable announcement. In version 1, the organizer or their existing agent distributes the outcome through existing channels. The service does not claim that a downloadable calendar file is a delivered invitation.

## 6. Event, time, and response semantics

### 6.1 Event constraints

A poll defines a title, meeting duration, concrete candidate date/time windows, and the time zone in which those windows were authored. Optional fields include short context, location, expected participants, and a response deadline.

Support one date range with weekday/time filters and per-date exceptions. Allow disjoint windows and exclusion of individual dates. The web form can offer simple defaults; the underlying model must preserve the resulting exact windows.

Every candidate meeting must fit entirely inside an allowed window. A 60-minute meeting cannot start at 5:30 p.m. if the window ends at 6 p.m.

**Duration and selection granularity are different.** A 60-minute meeting can have starts spaced 15 minutes apart. Proposed initial limits are 15–240-minute durations, 15-minute start increments, a 60-day candidate horizon, and 100 participants. These are operating assumptions to validate, not claims of unlimited support.

### 6.2 Time correctness

Use unambiguous timestamps for actual intervals and preserve an IANA time-zone identifier for authoring/display context. The agent and human views must refer to the same instants.

Changing a display zone changes presentation, not the meeting. Relative dates and unspecified zones must be resolved before the event becomes shareable. Ambiguous or nonexistent local times around daylight-saving transitions require explicit resolution rather than silent shifting.

Test date-boundary crossings, overnight windows, fractional-offset zones, and daylight-saving changes. Neither organizer geography nor a browser’s guessed zone is sufficient to silently decide participants’ working-hour preferences.

### 6.3 Availability states

Use four distinct states:

- **Available:** The participant is willing to meet for the full proposed interval, subject to subsequent schedule changes.
- **Tentative:** The interval may work but is not a firm yes.
- **Unavailable:** The interval does not work.
- **Unknown:** It has not been evaluated or answered.

No response is unknown. A participant can explicitly submit “none of these work.” Those cases must never be combined.

The interface can translate painted free-time ranges into whole-duration answers, but must not combine short fragments into a nonexistent meeting-length overlap. Each candidate’s availability depends on continuous coverage of its full duration.

Bulk submissions must have explicit coverage semantics. Omitted times remain unknown unless the submission explicitly declares that it evaluated the entire offered range and defines the remaining times as unavailable. The manual submit action can make that declaration after clearly explaining the rule to the participant.

Do not collect calendar-event titles, reasons for being busy, or raw calendar exports. A narrow response schema should reject unrelated metadata rather than encouraging agents to disclose it.

### 6.4 Identity and editability

Participants receive separate response identifiers and private edit authority. A display name is not an authentication mechanism. Two people with the same name must not be merged, and another participant cannot gain edit rights by reusing a name.

The default is a trusted, low-friction group with self-asserted names. Do not label those identities verified. If expected participants are listed, ambiguous mappings or duplicate names require organizer resolution rather than silently marking an invitee as answered.

Email-based verified identities and restricted invitations are potential later capabilities. The initial product is not intended for polls requiring strong identity assurance.

## 7. Results, lifecycle, and finalization

### 7.1 Honest aggregation

With an explicit expected-participant roster, distinguish answered, missing, and ambiguous responses. In version 1, all listed expected participants are required; required/optional distinctions can follow later.

Without a roster, use language such as “all five respondents are available.” Do not claim “everyone is available,” “all invitees replied,” or “ready to schedule” based on an unknown invitation list. A manually entered expected count alone does not establish participant identities.

An all-required-person option needs a firm yes covering the full duration from every expected participant. Tentative and unknown answers cannot be promoted to yes.

When there is no fully supported option, show the best partial options with transparent counts and missing/tentative information. Do not silently exclude someone, change the duration, or widen the dates. Offer those as explicit organizer decisions.

Where equally feasible options exist, use a deterministic, disclosed ordering such as chronological order. More elaborate preference ranking is not required to prove the product.

### 7.2 Poll lifecycle

Support **open**, **closed without a decision**, **finalized**, and **cancelled** states. Response deadlines can close collection without choosing a time. Data-retention expiry is a separate concern.

The organizer can edit, close, reopen, finalize, cancel, or delete the poll. Participants can edit or withdraw their responses while collection is open. A finalized poll is not silently reopened by a late response.

Changes to constraints create a new event version. Added windows are unknown, never inherited as yes. Unchanged intervals may retain their answers where meaning is unchanged; changes to duration or meeting meaning require re-evaluation. The implementation must document and test its invalidation rules.

### 7.3 Decision authority and freshness

Submitting availability does not authorize an agent to choose the final time, send messages, or write calendars. Organizer management rights and the user’s delegation policy govern finalization separately.

An organizer can explicitly select a partial option, but the product must display and record the exceptions. Automatic agent finalization requires an explicit policy authorizing that choice; the product does not infer one from an invitation to gather availability.

Finalization must check the event and result versions atomically. If someone changes an answer between review and selection, return a recoverable conflict rather than finalizing against stale poll data.

The service still cannot guarantee that external calendars remain free. Show when answers were last updated and make the distinction explicit. Rechecking calendars, sending invitations, and reserving time belong to a separately authorized calendar workflow.

## 8. Agent interface and compatibility

### 8.1 Definition of “100% agent-usable”

Every normal organizer and participant operation is available through a structured interface without requiring manual user interaction or brittle UI automation: creation, retrieval, response submission/editing/withdrawal, result inspection, event modification, closure/reopening, finalization, cancellation, and deletion. Opening the event page so an agent can discover and invoke page-provided WebMCP tools is a supported structured interaction, not UI automation.

User consent and host permission prompts are not defects. A hidden need to click a website button to complete an otherwise supported operation is a defect.

MCP exposes tools through schemas, but host applications control how tools are presented and authorized; the protocol does not prescribe one universal interaction model. Therefore, an MCP server alone is not proof that a pasted link works in every agent.[^6]

### 8.2 Recommended interfaces

Use one domain model and validation layer across every surface. Do not maintain different meanings of availability in the UI, WebMCP tools, HTTP API, or remote MCP tools.

**Preferred browser-agent path: WebMCP.** The event page should expose its core actions as structured WebMCP tools in compatible browsers so an agent can operate the same product state the human sees instead of scraping the DOM, interpreting screenshots, or simulating clicks. WebMCP is specifically designed to let web applications expose JavaScript functions or HTML-form functionality as typed tools to AI agents while preserving the visible page and shared browser context.[^8][^9]

For a participant page, useful WebMCP tools should include at minimum:

- `get_event` — return the event constraints, duration, time zone, lifecycle state, and participant-specific current response if authorized.
- `submit_availability` — atomically submit a bounded set of Available/Tentative/Unavailable states with explicit coverage semantics.
- `update_availability` — revise the participant's existing response with version checking.
- `withdraw_response` — withdraw that participant's response.

Organizer pages should expose corresponding creation, results, lifecycle, and finalization tools appropriate to organizer authority. Tool success must mean the operation was persisted and return a verifiable receipt; it must not merely alter an unsaved form.

WebMCP is **not** a prerequisite for participation and must not become the only agent interface. It is a browser-native complement to backend integrations, and its current design is centered on tool execution in a browser context rather than replacing server-side APIs.[^8][^9] Provide a versioned HTTP API with an OpenAPI description and a remote MCP adapter exposing the same underlying capabilities for agents that operate outside a compatible browser.

A generic HTTP-capable agent can use the API when it has authorized write access. A remote MCP-capable agent can use the installed backend integration. A WebMCP-capable browser agent can open the shared link, discover the page's tools, and invoke them. A read-only web-fetch agent can inspect a poll but is not a supported submitter merely because it can read the page.

Calendar access remains separate. WebMCP lets the agent interact with this scheduling product; it does not itself give the scheduling product or the page permission to inspect the participant's Google, Microsoft, or other calendars. The participant's agent uses its already-authorized calendar tools, computes an answer locally, and submits only the bounded availability response.

Publishing documentation or an `llms.txt` file is useful discovery material, not a grant of write capabilities. Do not design around agents running arbitrary code supplied in event descriptions.

### 8.3 Reliability contract

Expose stable identifiers, event/response/result versions, explicit time semantics, machine-readable errors, compact results, and action receipts. Mutations need idempotency and concurrency protection. Retrying after a timeout must not create an extra poll or count a participant twice.

Receipts must distinguish persisted success from proposed actions and support verification of the current stored state. Errors must distinguish permission failures, stale versions, closed polls, out-of-range submissions, and rate limits.

The common response path should support one event read, local availability evaluation, and one bulk submission. Large polls should have compact interval representations or pagination rather than forcing agents to transcribe thousands of individual cells.

### 8.4 Compatibility verification

Initially certify at least two materially different agent clients, including at least one real WebMCP-capable browser-agent path, and exercise a backend path (remote MCP or direct HTTP) separately. Record tested client/browser versions, required setup, authorization steps, calendar preconditions, successful operations, and known limitations. The current WebMCP ecosystem is still evolving, so compatibility must be demonstrated in named clients rather than inferred from protocol support alone.[^9]

Use real supported tool flows in acceptance testing. For WebMCP, verify that the agent discovers the tools from the event page, invokes them with the correct schema, persists the response, and sees the same state reflected in the human UI. Hand-written requests by the developer prove interface behavior, not the end-to-end agent experience.

Build optional account-backed recovery or host-specific authorization only where it is needed for a supported integration. A one-time integration setup is distinct from per-poll signup; measure and disclose both.

## 9. Privacy, authority, and abuse controls

### 9.1 Separate authority by role

The shared invitation link permits viewing the invitation and creating a response. A private response capability permits managing one response. A private organizer capability permits managing the poll and viewing organizer-level results.

The public invitation link must never contain organizer or another participant’s edit authority. Private links/tokens require strong entropy, revocation, expiry appropriate to their role, and protection from analytics, referrers, error reports, and logs. Loss of a saved capability may make recovery impossible without an optional recovery mechanism; disclose this rather than pretending a display name can recover it.

### 9.2 Default visibility

The organizer sees named availability. Participants see their own answer and overall response progress, not other people’s individual availability. The invitation page exposes the meeting’s stated constraints to anyone possessing its link; it is unlisted, not a verified-members-only space.

Explain disclosure before submission. Calendar access is not required, but availability is still information about a person. The product should not imply that absence of calendar titles makes the response nonsensitive.

### 9.3 Safe operations

Opening, previewing, crawling, or prefetching a link must not vote, withdraw, finalize, or delete. Use safe HTTP methods for reads and explicit authorized mutations for actions. HTTP’s safe-method semantics specifically protect automated retrieval from unintended requested actions.[^7]

Treat event titles, descriptions, names, and links as untrusted data. Keep them distinct from platform-authored tool instructions. Adversarial tests must verify that an invitation cannot instruct a delegate to disclose calendar details, send unrelated messages, or access unrelated services.

The server must enforce permissions and validate submissions independently of any agent claim of authority. Browser mutations need appropriate session and cross-site-request protection. The service cannot guarantee every third-party model will resist prompt injection, so constrain what its own interfaces accept and expose.

### 9.4 Abuse and retention

Implement per-client/event limits, payload limits, response caps, bounded retries, link revocation, and an organizer route to remove spam without rewriting legitimate answers. Normal supported use should not require solving a visual CAPTCHA; exceptional abuse controls may require human verification and must be reported honestly.

A public invitation link is not proof of one unique human. High-assurance voting or attendance decisions are outside the initial trust model.

Proposed default: expire invitation access and delete identifiable scheduling content 30 days after the last candidate date, with immediate user-initiated deletion and a documented bounded backup-expiry policy. Keep only nonidentifying aggregate product metrics afterward. Avoid poll-title, name, and availability contents in analytics.

## 10. Target specifications and measurement

These are provisional marginal/ideal targets for concept testing, not measured performance. Safety/correctness invariants are release gates; convenience targets can be revised based on observation.

| Specification | Need | Initial acceptance target | Ideal / measurement note |
|---|---|---|---|
| Agent functional coverage | N2, N11 | Every in-scope operation has a structured path | No browser interaction beyond host authorization |
| Supported-agent completion | N2, N3 | At least 95% successful task completion in a documented test set after setup | 99%; never count a verbal “done” without persisted state |
| Human effort to delegate a response | N2 | Median 30 seconds or less after setup | One instruction; measure human effort separately from agent runtime |
| Manual response usability | N3, N10 | At least 90% of pilot participants finish unaided; median under 2 minutes on a five-day poll | Median under 1 minute; include mobile and keyboard users |
| First-time agent connection | N2, N11 | Measure time, failures, and permission burden separately; one documented supported route per certified client | No per-poll setup and no developer-written code |
| Duration/time-zone correctness | N4, N7 | All defined correctness fixtures pass; zero knowingly false “all available” results | Do not trade this off against speed |
| Mutation safety | N6, N11 | Retry, concurrent edit, and stale-finalization tests pass | No duplicate votes or silent overwrites in fault tests |
| Ordinary service latency | N1, N11 | 95th percentile below 1 second at the proposed 100-person/60-day envelope | Below 300 milliseconds; exclude external agent/calendar latency |
| Unnecessary disclosure | N9 | Core schemas and normal workflow request no calendar credentials or event details | Verify actual payloads and logs, not only UI copy |
| Group coordination effort | N1, N7 | At least 50% less total active human effort than the same group’s normal approach in a small pilot | Also measure elapsed time and abandonment; do not infer these from faster agent replies |

After concept testing, revise the marginal and ideal specifications using observed user priorities, measured technical behavior, and operating cost. Only then treat them as the release specification.

## 11. First release and deferred scope

WebMCP support is part of the first-release agent experience, provided through the same domain operations as the manual UI and backend interfaces. It is preferred for compatible browser agents but is not a launch dependency for every participant or every client.

### Required for the first public release

One bounded meeting poll; a unique public link; separate private management and response authority; accountless manual creation and response; full agent operation through supported integrations; time-zone-correct full-duration overlap; tentative/unknown handling; response edits and withdrawal; optional expected-participant tracking; honest missing-response reporting; organizer finalization/cancellation; a final event page and calendar-file export; basic safety, privacy, abuse protection, and operational instrumentation.

Accountless operation is the baseline product path, not a promise to bypass an agent host’s required authorization. Supported hosts may need a one-time connection.

### Deferred until the core hypothesis is demonstrated

Direct Google/Microsoft calendar connection, automatic calendar writes, automatic email invitation/reminder delivery, always-on monitoring of changing calendars, advanced preference ranking, optional-attendee/quorum policies, recurring meetings, date-only trips, team workspaces, contacts/social graphs, conference-link generation, federation, payments, and a proprietary scheduling assistant.

The service should not build its own language-model orchestration or become responsible for interpreting every participant’s life. It can add convenient input and distribution adapters later without changing the central coordination contract.

## 12. Validation plan and development sequence

Prototypes should answer identified risk questions, initially targeting individual uncertainties rather than constructing the entire product at once.[^5]

### Step A — Observe the actual job

Start with 8–12 interviews or contextual observations across frequent organizers, agent users, and people who would answer manually. Include groups with different time zones and people who do not already share calendars. This is an initial qualitative sample, not a statistically representative study or a claim of needs saturation.

Ask people to reconstruct their last real scheduling episode: the invitation, their calendar checks, reminders, compromises, and final confirmation. Observe an actual response where possible. Do not begin by pitching the product or asking whether an “agentic poll” sounds useful.

Preserve raw observations separately from interpreted needs. Have participants compare the importance of speed, flexibility, privacy, certainty, and setup burden. Record new needs and disagreements instead of averaging different user groups into one imaginary person.

### Step B — Prove the delegated-response interaction

Implement the smallest real shared event and mutation flow. Have one supported agent create a poll, a different agent retrieve it and answer from calendar fixtures, and a human add a manual response. Aggregate, revise one answer, and finalize.

Test ordinary prompts, not carefully tuned developer instructions. Record permission/setup friction and all cases requiring website rescue. Confirm that the organizer’s private capability is not shared with respondents.

### Step C — Test realistic use and alternatives

Run roughly 20–30 real scheduling episodes across at least 10 independent organizers. Include agent-heavy groups, mixed groups, and groups where only the organizer uses an agent.

Compare with each group’s actual previous approach or alternate approaches across comparable episodes where practical. Measure total human attention across the group, response completion, elapsed time to decision, abandonment, and later corrections. Treat this small pilot as directional evidence, not causal proof from a large randomized study.

For calendar-connected users, compare an agent-assisted prototype against a direct calendar-prefill concept. If delegation adds setup but little useful preference handling, revise the positioning or integration plan rather than assuming the agent route is inherently better.

### Step D — Test reliability and operating burden

Exercise retries, concurrent changes, large candidate ranges, identity ambiguity, permission boundaries, malicious event text, and privacy-sensitive payloads. Measure costs from real traffic, including abandoned events and rejected requests.

The exit criterion is not merely a functioning heatmap. It is a mixed group completing the end-to-end task with lower human effort and no hidden technical support.

## 13. Acceptance scenarios

| Scenario | Required result |
|---|---|
| Agent A creates, Agent B responds, human C responds | One event and one consistent aggregate; no manual website rescue for either supported agent |
| WebMCP agent opens a participant link | Agent discovers structured page tools without DOM scraping and can read the same event state shown to the human |
| WebMCP agent submits or revises availability | Mutation is persisted, returns a verifiable receipt, and the human page immediately reflects the same stored response |
| WebMCP is unavailable in the participant's client | Manual response and a documented backend agent path remain usable; the poll does not depend on WebMCP support |
| Organizer opens the public link | Public representation still contains no organizer secret |
| Same participant name is submitted twice | Distinct identities unless explicitly resolved; no unauthorized overwriting |
| Agent lacks one relevant calendar | Uncertainty or a user clarification; no invented availability |
| Agent submits time outside the event range | Clear validation failure; no silent widening |
| Two 30-minute free fragments are separated by a conflict | Not offered as a 60-minute meeting |
| Different zones show different local dates | Both refer to the same underlying interval |
| Daylight-saving transition creates ambiguous local time | Explicit resolution or rejection; no silent reinterpretation |
| Participant submits no acceptable times | Stored negative response, distinguishable from no response |
| Some intervals are unevaluated | Unknown, not unavailable or available |
| Expected participant never responds | Missing participant remains visible; no false unanimous option |
| Poll has no expected roster | Results describe respondents, not all invitees |
| Response request succeeds but the network reply is lost | Retry/recovery verifies the original write without duplication |
| Agent and human concurrently edit the same response | Conflict detection or explicit revision behavior, not silent data loss |
| Organizer adds candidate dates after responses | New dates remain unknown until answered |
| Participant changes availability just before finalization | Atomic version check rejects stale selection for review |
| Link-preview crawler opens all invitation links | No votes, bookings, withdrawals, or other domain mutations |
| Malicious description requests full calendar export | Supported reference workflow ignores it; service schema does not solicit unrelated calendar content |
| Participant obtains another participant’s display name | No edit access to the other response |
| Organizer selects a time with a missing/negative participant | Explicit exception is shown and recorded; no claim of universal availability |
| Poll is finalized | Shared page records a decision; it does not claim a meeting invite was sent |
| User withdraws or deletes | Correct authority is checked, visibility updates, and retention behavior is followed |

## 14. Product metrics and economics

### Primary outcome

**Resolved scheduling episodes with low human effort.** An episode resolves when the organizer selects a documented time or reaches an explicit, adequately supported no-overlap decision. Track these outcomes separately; do not inflate “meetings scheduled” with no-overlap results.

A premature closure with many missing answers is not a successful no-overlap determination. A model’s success message is not evidence of a saved response.

Supporting measures: invitation-to-response conversion, first-time versus repeat integration setup, total active human minutes per episode, time to enough responses, time to final decision, mixed-group completion, edits after submission, finalization conflicts, unplanned human rescue, and repeat organizer use when another scheduling need occurs.

Do not use daily active users as the main success measure for an episodic product. Segment by agent-assisted versus manual participants and by first-time versus configured agents. Exclude previews and known bot fetches from engagement measures.

### Operating model

Keep the core deterministic: store bounded event/response data, compute overlap, and serve views. No service-side model call is required for the core loop. External agent usage remains subject to the user’s agent-provider costs; a free poll is not a promise that their agent usage is free.

Measure monthly cost as fixed infrastructure plus event storage/writes, reads/results computation, notification delivery if added, abuse traffic, and operational support. Include unfinished polls in the cost numerator rather than calculating only the cheap successful cases.

Before public launch, set an actual operating budget, volume limits, cost alerts, and a graceful way to throttle new creation while preserving access to existing polls. Do not equate “free” with “unlimited” or silently incur uncapped costs.

### Possible later monetization

Keep ordinary participation and the core agent interface free. Paid value could center on organizer-heavy features: persistent team administration, verified/restricted invitations, advanced workflows, high-volume usage, organizational controls, or service commitments. Validate those needs before building billing or promising them publicly.

## 15. Distribution and standardization

A successful public contract could become widely integrated, but compatibility and adoption are separate problems.

Start with a dependable hosted service, WebMCP tools on the event and organizer pages, a small documented HTTP API, a remote MCP adapter, and reference integrations. Publish precise semantics and conformance tests so independent developers can implement clients without private guidance. Maintain a documented version/deprecation policy. The WebMCP implementation should reuse the same domain operations as the backend interfaces rather than becoming a separate browser-only business-logic layer.

The invitation page can explain that the link also works with supported agents and provide setup instructions. Do not require all participants to install the same agent or integration before anyone obtains value.

Measure whether an independent developer can build an integration and whether ordinary users return without founder support. Wider ecosystem distribution comes after those results. Do not begin with a new federation protocol, standards organization, or a universal agent marketplace.

## 16. Open decisions and release gate

The first unresolved decisions are which real agent clients to certify, whether participants trust capability-link recovery, how well people distinguish tentative from available, whether expected-participant tracking warrants its initial complexity, and the practical operating limits/retention default.

The recommended first vertical slice is:

> One real poll, created by an agent, answered by one WebMCP-capable browser agent, one backend-integrated agent, and one human, revised once through an agent path, then finalized correctly—with no shared calendar integration and no hidden developer intervention.

That experiment tests the product promise more directly than a polished scheduling grid or a large plugin catalog.

**Release only when** the full structured/manual loop works, correctness and authority tests pass, a named WebMCP-capable browser-agent path and at least one materially different backend agent path are verified, the mixed-group pilot demonstrates reduced human work, and cost/abuse limits are in place. Revise the concept if setup merely moves coordination work from answering the poll into configuring the agent.

---

## Source notes

The product recommendations, priorities, targets, limits, and experiments are original proposals for this concept. Sources below support the development method, reference experience, and protocol constraints—not evidence of product-market fit.

[^1]: Ulrich, Karl T.; Eppinger, Steven D.; Yang, Maria C. *Product Design and Development*. Author-maintained companion site and chapter sequence. https://www.pdd-resources.net/
[^2]: MIT OpenCourseWare, *15.783J Product Design and Development*, “Product Specifications and Concept Generation,” concept-development process diagram, slide 3. https://ocw.mit.edu/courses/15-783j-product-design-and-development-spring-2006/aa38be3463667d088c7a51c73712382e_clas7_cncpt_genr.pdf
[^3]: MIT OpenCourseWare, same course, “Identifying Customer Needs,” customer-needs process and needs-statement guidelines, slides 5 and 13. https://ocw.mit.edu/courses/15-783j-product-design-and-development-spring-2006/e2e05a01049815a875b5d8b87f4cbc34_cls4_cstmr_ned.pdf
[^4]: WhenIsGood, product homepage. https://whenisgood.net/
[^5]: MIT OpenCourseWare, same course, “Concept Selection,” concept selection/refinement, sensitivity to customer groups and priorities, and risk-focused prototyping, slides 5, 11–12, and 14. https://ocw.mit.edu/courses/15-783j-product-design-and-development-spring-2006/4a44d148fc00f946862177da626cb069_cls9_cncpt_sel_6.pdf
[^6]: Model Context Protocol specification, Tools, user interaction model, structured tool definitions/results, and security considerations. The cited 2025-11-25 version documents these principles; implementations must separately verify versions supported by their target clients. https://modelcontextprotocol.io/specification/2025-11-25/server/tools
[^7]: IETF RFC 9110, *HTTP Semantics*, section 9.2.1, Safe Methods. https://www.rfc-editor.org/rfc/rfc9110.html#name-safe-methods
[^8]: Web Machine Learning Community Group, *WebMCP Explainer*. WebMCP exposes web application functionality as structured tools for AI agents and is designed to complement, not replace, backend integrations such as MCP. https://github.com/webmachinelearning/webmcp
[^9]: Chrome for Developers, *WebMCP*. Documents WebMCP's structured tool model, current browser-context requirement, and Chrome origin-trial status. https://developer.chrome.com/docs/ai/webmcp
