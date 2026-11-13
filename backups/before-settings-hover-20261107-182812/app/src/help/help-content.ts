/**
 * Central inline-help registry (docs/specs/0015). One place for all help
 * prose — plain words, no EMSWe jargon (design law 2). Blank line = new
 * paragraph. FI translations land here later (docs/07 law 7); usage sites
 * only ever reference a topic key.
 */

export interface HelpContent {
  title: string;
  body: string;
}

export const HELP: Record<string, HelpContent> = {
  'login.methods': {
    title: 'Which sign-in do I use?',
    body:
      'Office users: press “SSO Login” and sign in the same way as to your ' +
      'work email.\n\n' +
      'Captains and ship crew: Use SSO if you have a company email, or ' +
      'username and password that you have received from the office.\n\n' +
      'No account yet? Sign in once with SSO Login — your admin is notified ' +
      'and approves your access.',
  },
  'platform.customers': {
    title: 'Customers',
    body:
      'The organizations on this NEMOLink platform. Open one to work inside ' +
      'it — you then see and can edit exactly what that customer’s own ' +
      'admins see, and everything you do is recorded in their audit log ' +
      'under your name.\n\n' +
      'The orange chip in the top bar always shows which customer you are ' +
      'in; close it to come back here. Customer data is never visible ' +
      'without opening a customer first.',
  },
  'platform.audit': {
    title: 'The platform audit log',
    body:
      'Platform-level events across all customers: sign-ins, customer ' +
      'onboarding, reference-data syncs, contract checks — and every time ' +
      'a platform admin opens or leaves a customer.\n\n' +
      'The records are tamper-evident, chained together so history cannot ' +
      'be quietly changed. Actions done inside a customer are additionally ' +
      'recorded in that customer’s own audit log.',
  },
  'platform.ships': {
    title: 'The master list',
    body:
      'Every ship NEMOLink knows, whichever organization brought it in. ' +
      'One record per ship, like NEMO’s own ship database.\n\n' +
      'Sources: the customers’ own systems push what they know; the daily ' +
      '“Ship master list” sync reads Digitraffic’s port call feed (the ' +
      'NEMO data) for new ships and asks NEMO’s ship database about ships ' +
      'with upcoming calls; “Refresh from NEMO” does that for one ship now. ' +
      'A customer system always outranks those reference sources for the ' +
      'fields it sends.\n\n' +
      '“In fleets” lists the organizations that have the ship in their ' +
      'fleet. Deactivating hides a ship for everyone; nothing is deleted.',
  },
  'platform.gisis': {
    title: 'The GISIS facility list',
    body:
      'IMO’s GISIS register lists every security-approved (ISPS) port ' +
      'facility in the world with its official code and name. NEMOLink ' +
      'uses it to put names on facility codes — in port views and when ' +
      'checking the codes ships write on their security forms.\n\n' +
      'GISIS sits behind a login, so the list cannot fetch itself. Sign ' +
      'in at gisis.imo.org, open Maritime Security, choose “Check online ' +
      'for latest” under port facilities, export the CSV and upload it ' +
      'here — one country or the whole world, both work. An upload ' +
      'replaces the list for exactly the countries in the file. Codes ' +
      'that have disappeared from the newest file are kept but marked ' +
      'retired: they still show up when looking at old documents, the ' +
      'checks flag them as not for new reports, and they are never ' +
      'offered as suggestions.\n\n' +
      'Upload a fresh export at least every 3 months. When the list gets ' +
      'older than that, the platform alert address gets a daily reminder ' +
      'email until someone uploads a new one.',
  },
  'home.fleet': {
    title: 'Port calls',
    body:
      'The calls are grouped by where the ship is: Upcoming first, then ' +
      'Moored, then Departed, the newest on top in each. Upcoming shows ' +
      'every call ahead, however far off. A call whose times are all past and that never reached ' +
      'NEMO is not shown — it is too late to report it.\n\n' +
      'Each block is one port call, and it shows two things at once.\n\n' +
      'First, where the ship is. The two lines give the arrival and the ' +
      'departure: the estimate (ETA, ETD) flips to the bold actual (ATA, ' +
      'ATD) once that time is recorded. The chip on the right is the ' +
      'status NEMO itself keeps for the call: Unconfirmed (the call has ' +
      'been created), Arriving (the pre-arrival details are reported), ' +
      'Moored (the ship has arrived), Departed, or Cancelled.\n\n' +
      'Second, the reports the call owes NEMO — the small code chips ' +
      'under the block. Red means not started, amber shows how many ' +
      'items are still missing, teal means everything we can fill is ' +
      'filled, and green means sent. The most pressing deadline sits ' +
      'next to them.\n\n' +
      'Times reported by the ship or the logbook are only suggestions: ' +
      'nothing changes until you confirm or reject them. Confirming ' +
      'records the actual time and moves the call forward.\n\n' +
      'Tap a block to open it: the place (port, area, berth), the ' +
      'estimated times and the actual ones, each with the reports it is ' +
      'declared in. Admins edit the times right there and press Save ' +
      'times. The full history of the call sits behind the Audit log ' +
      'button, and Edit details opens the rest of the call.',
  },
  'call.noa': {
    title: 'The pre-arrival notice (NOA)',
    body:
      'The NOA tells NEMO the ship is coming: when, from where, why and who is ' +
      'on board. It lists only what Fintraffic marks compulsory. Send to NEMO: ' +
      'NOA opens a two-step wizard. Step 1 asks the facts of this call — ' +
      'purpose, draught, crew, persons on board, the master, and the type of ' +
      'voyage when the last port is Finnish — and names what is still missing ' +
      'in the port call, the ship data (ship registry, port of registry) or ' +
      'your organisation settings (the agent). The fairway dues language is ' +
      'always English, and the next port always goes as ZZUKN, unknown, and ' +
      'is corrected once known.\n\n' +
      'Step 2 shows what NEMO receives. The DUE, the fairway and port dues ' +
      'with your agency as the liable party, goes with the NOA until NEMO has ' +
      'one. The NOA goes unconfirmed: the arrival is confirmed to Customs ' +
      '(ST-FI-01) with the ATA, once the ship is alongside. After every send ' +
      'NEMOLink reads NEMO’s copy back and says whether NEMO holds what was ' +
      'sent.',
  },
  'call.ata': {
    title: 'The actual arrival (ATA)',
    body:
      'Tell NEMO the ship has arrived. The time starts at now, rounded to five ' +
      'minutes; − and + move it five minutes, and “Different day or exact ' +
      'minute” sets it exactly. An arrival cannot be in the future.\n\n' +
      'NEMO takes the ATA only after the NOA and the DUE, and only once the ' +
      'NOA carries the customs confirmation (ST-FI-01). When it does not yet, ' +
      'this step sends that confirmation first, as an update of the NOA; it ' +
      'cannot be withdrawn. From an accepted ATA on, NEMO takes no more ' +
      'changes to the NOA. A later ATA corrects the time.',
  },
  'call.nod': {
    title: 'The pre-departure notice (NOD)',
    body:
      'The NOD tells NEMO the ship is about to leave. NEMO checks four things: ' +
      'the estimated departure and the next port, both from the port call ' +
      '(the next port goes as ZZUKN, unknown, when the call has none), and the ' +
      'crew and persons on board, the same numbers the NOA carries. What is ' +
      'missing is filled here and saved on the call.\n\n' +
      'The NOD goes unconfirmed: the departure is confirmed to Customs ' +
      '(ST-FI-02) with the ATD, when the ship leaves.',
  },
  'call.atd': {
    title: 'The actual departure (ATD)',
    body:
      'Tell NEMO the ship has left. The time starts at now, rounded to five ' +
      'minutes; − and + move it five minutes, and “Different day or exact ' +
      'minute” sets it exactly. A departure cannot be in the future or before ' +
      'the arrival.\n\n' +
      'NEMO takes the ATD only after the ATA and the NOD, and only once the NOD ' +
      'carries the departure confirmation (ST-FI-02). When it does not yet, ' +
      'this step sends that confirmation first, as an update of the NOD; it ' +
      'cannot be withdrawn.',
  },
  'call.reports': {
    title: 'The reports a port call owes',
    body:
      'Reporting a port call to NEMO starts with the port call itself — ' +
      'creating it here is the VID, the visit id every other report hangs ' +
      'on. After that, an arrival always needs the pre-arrival notice ' +
      '(NOA), the fairway and port dues (DUE) and the actual arrival ' +
      '(ATA); a departure needs the pre-departure notice (NOD) and the ' +
      'actual departure (ATD).\n\n' +
      'Until the port call is in NEMO, the block shows only an amber VID: ' +
      'nothing else can be sent before it. Tap it to open Send to NEMO, a ' +
      'wizard in NEMO’s order — step 1 creates the port call (the VID), ' +
      'step 2 sends the ship data (SID + SHP) — where Ctrl+Enter does each ' +
      'step in turn. Step 1 lists what the VID carries and, below it, the ' +
      'required ship fields still missing, so they are edited before ' +
      'anything goes: without the registered owner or the lessee name NEMO ' +
      'refuses the SHP. The ship data goes with every port call — NEMO’s ' +
      'ship record is shared by every declarant in Finland — and can be ' +
      'sent again any time from the SID and SHP chips of a call that is in ' +
      'NEMO, which open the wizard at step 2.\n\n' +
      'The colours: red — nothing filled yet; amber with a number — that ' +
      'many items still missing; teal — everything NEMOLink can pre-fill ' +
      'is filled; green — sent to NEMO; grey — waits for the VID, which ' +
      'every other report needs first. Tap a chip to see every item with ' +
      'the value that would go to NEMO, where it comes from (this call, ' +
      'the ship data or your organisation), and for ship fields whether ' +
      'NEMO’s ship database holds the same.\n\n' +
      'Deadlines: the pre-arrival notice must be sent at the latest 24 ' +
      'hours before the ETA — or as soon as possible if the voyage itself ' +
      'is shorter than that. The chip warns you when the deadline is ' +
      'close and turns red once it has passed.\n\n' +
      'Ship data (SID, SHP, CRT) describes the ship itself — it comes ' +
      'from the ship record in the admin area and travels with a port ' +
      'call whenever NEMO does not already have it.\n\n' +
      'The rest of the reports — crew and passenger lists, cargo, ' +
      'dangerous goods, security, health, waste, stores, statistics — are ' +
      'given as the situation requires. They are listed as "as ' +
      'applicable" until the declaration features arrive.',
  },
  'users.statuses': {
    title: 'User statuses',
    body:
      'Awaiting approval: this person signed in with their company account ' +
      'but cannot use NEMOLink until you approve them and pick a role.\n\n' +
      'Active: they can sign in and work with the access their role gives.\n\n' +
      'Rejected: they cannot sign in. Revoking an active user signs them ' +
      'out immediately. You can always re-approve someone later.\n\n' +
      '“Locked until …” means someone typed a wrong password five times in ' +
      'a row for that username-and-password account. The lock opens by ' +
      'itself after 15 minutes — no action needed.',
  },
  'org.declarant': {
    title: 'NEMO declarant details',
    body:
      'Facts about your company that go on every declaration to the ' +
      'authorities: your business ID, EORI number, and the agent contact ' +
      'details (who the authorities call about a port call).\n\n' +
      'These rarely change — set them once and every new declaration is ' +
      'pre-filled with them. Phone numbers need the country prefix, ' +
      'for example +358…\n\n' +
      'Every change here is recorded in the audit log.',
  },
  'org.nemoKey': {
    title: 'Your NEMO API key',
    body:
      'The key your organization uses to file declarations with NEMO. It is ' +
      'yours, not NEMOLink’s: you apply for it from Fintraffic and enter it ' +
      'here, and NEMOLink files on your behalf with it.\n\n' +
      'Staging is Fintraffic’s test environment — nothing filed there is a ' +
      'real declaration. Production files for real. You may hold both at ' +
      'once; each is entered separately.\n\n' +
      'The key is stored encrypted and is never shown again after you save ' +
      'it, not even to you. If you lose it, get a new one from Fintraffic ' +
      'and replace it here.\n\n' +
      'Every call to NEMO names the organisation the key belongs to, by the ' +
      'client ID. With Fintraffic’s shared staging key that is the test ' +
      'organisation, not yours — exactly what staging expects. Your own ' +
      'business ID from the declarant details above goes on the declarations ' +
      'themselves.\n\n' +
      'Setting, replacing and removing a key are all recorded in the audit log.',
  },
  'admin.ships': {
    title: 'Your fleet',
    body:
      'This is your fleet: the ships your organization works with. Port ' +
      'calls and NEMO declarations are always made for one of them.\n\n' +
      'Ships come from the master list, which NEMOLink shares with every ' +
      'organization — one record per ship, just as NEMO keeps one record ' +
      'per ship for everyone. It is fed by the systems that push to ' +
      'NEMOLink, by NEMO’s own ship database and by Digitraffic’s port call ' +
      'feed. “Add ship” searches it by name or IMO; create a new ship only ' +
      'when the search finds nothing. In a ship’s details the External ' +
      'column is the master list, the override column is yours alone, and ' +
      'To NEMO is what your declarations carry. If another organization ' +
      'registered or pushed a ship, you see the values but not who: it says ' +
      '“Other organisation”. Everything about a ship is edited in that one ' +
      'dialog: values in the override column (they save as you type), the ' +
      'switch “FIN fields / All fields” to go beyond what Finland requires ' +
      '(FIN fields: the identity, the eight particulars and the four the ' +
      'pre-arrival notice needs — ship type, flag state, ship registry and ' +
      'port of registry) ' +
      'and reach a particular nobody has sent yet, certificates added ' +
      'and removed below the data, and the IMO number in its own row under ' +
      'the name — only the organisation that registered the ship changes ' +
      'it.\n\n' +
      'The IMO number is the ship’s permanent international identity — ' +
      'authorities match everything by it. Its seventh digit is a check ' +
      'digit computed from the first six, and NEMO refuses a number that ' +
      'fails it, so NEMOLink refuses it too, wherever it is typed; a value ' +
      'a system synced that fails it is shown in red on the row. MMSI and ' +
      'call sign help match reports from other systems.\n\n' +
      'Ship data is not sent from this dialog: NEMO takes it only as part ' +
      'of a port call — the identity (SID) and the particulars (SHP) under ' +
      'its visit id. It goes when a port call of the ship is created in ' +
      'NEMO, and again from the SID and SHP chips of any call that is in ' +
      'NEMO.\n\n' +
      'Removing a ship from your fleet hides it from your work but keeps ' +
      'your overrides and its history; add it back any time. Nothing is ' +
      'ever deleted.\n\n' +
      '“Not in NEMO’s ship database yet” means no one has filed a first VID ' +
      'for the ship. NEMOLink creates it with the first VID; if NEMO refuses, ' +
      'the first VID report is made by hand in the NEMO user interface — the ' +
      'link is right there.\n\n' +
      'Certificates: keep the ship’s certificates (safety, load line, ' +
      'insurance and so on) here with their expiry dates. The list warns ' +
      'in orange 60 days before the earliest expiry and in red once ' +
      'something has expired — authorities check these at port calls.\n\n' +
      'NEMO gets them as certificate reports (CRT) with every port call, one ' +
      'per certificate, the newest of each type. NEMO asks for the issue ' +
      'date, the expiry date, the issuer type and who the issuer is — a flag ' +
      'state, a society from the list, or a name — and the certificate ' +
      'itself as a file (PDF, XML, JPG or PNG, up to 10 MB). Attach the file ' +
      'on the certificate row; a row says what NEMO still needs.',
  },
  'ships.iceClass': {
    title: 'Ice class — Traficom confirms it',
    body:
      'The ice class you enter here is your statement: NEMOLink sends it ' +
      'with the ship data report (SHP). It is not the class that counts ' +
      'until Traficom has confirmed it.\n\n' +
      'How it gets confirmed: the ship’s classification certificate (CL) ' +
      'is sent to NEMO as a certificate report (CRT) with the file attached ' +
      'and “request ice class confirmation” ticked. NEMO passes it to ' +
      'Traficom, who check the class notation and the certificates — ' +
      'registry, tonnage, load line and classification; for a class above ' +
      'II also the ice class draughts and the minimum engine power, from ' +
      'the certificate or its annex. When Traficom answers, NEMO records ' +
      'the class as confirmed with its validity date. If Traficom does not ' +
      'get everything it needs, the ship is confirmed as class II.\n\n' +
      'Why it matters: the fairway dues (DUE) and icebreaker assistance ' +
      'are set by the confirmed class, never by what was sent. Until then ' +
      'NEMO shows the class as not valid; while Traficom is checking, as ' +
      'waiting.\n\n' +
      'The In NEMO column shows the state NEMO holds: not confirmed, ' +
      'awaiting Traficom, or confirmed with the validity date. NEMOLink ' +
      'sends the CL certificate with its file and asks for the confirmation ' +
      'by itself, with the ship data of a port call, until NEMO shows the ' +
      'class confirmed. Questions ' +
      'about a ship’s ice class: iceclass@traficom.fi.',
  },
  'ships.sendToNemo': {
    title: 'Send ship data to NEMO',
    body:
      'NEMO takes ship data only as two reports of a port call: the identity ' +
      '(SID) and the particulars (SHP), under the call’s visit id. There is ' +
      'no other way to send it, so this is step 2 of Send to NEMO — right ' +
      'after the port call is created (step 1), and any time later from the ' +
      'call’s SID and SHP chips. We send it with every port call: NEMO’s ' +
      'ship record is shared by every declarant in Finland, and anyone may ' +
      'have changed it since we last sent. The ship must exist in NEMO’s ' +
      'ship database for the VID; if NEMO refuses, the first VID is made by ' +
      'hand in the NEMO user interface.\n\n' +
      'The table is exactly what NEMO will receive: each field with its value, ' +
      'its NEMO ID and the report that carries it. Every ship particular ' +
      'NEMOLink holds is sent, so NEMO’s shared record matches ours; Finland ' +
      'requires the identity and eight particulars, and a missing one is ' +
      'flagged before anything goes. The elements of the notices (type, flag, ' +
      'tonnages, dimensions) travel with the NOA and NOD. Raw JSON shows the ' +
      'exact message.\n\n' +
      'Sending again updates the reports NEMO already has. A report that ' +
      'cannot go says why — the SHP needs the registered owner or the lessee ' +
      'name — with a link to the ship data. NEMO’s answer shows per report — ' +
      'accepted, or rejected with the reasons — and the call’s timeline and ' +
      'the audit log (NEMO only) keep the exact request and answer.',
  },
  'admin.locations': {
    title: 'Locations',
    body:
      'Ports and places worldwide, each with its international LOCODE (like ' +
      'FIHEL for Helsinki). Declarations always name places by these codes, ' +
      'so NEMOLink keeps its own up-to-date copy for checking and lookups.\n\n' +
      'The list fills and refreshes itself from the official published ' +
      'dataset — you don’t maintain it. The Sync tab shows when it was last ' +
      'refreshed.\n\n' +
      'Tap a row for details — Finnish ports carry their port areas, berths ' +
      'and security (ISPS) facility codes.',
  },
  'admin.codelists': {
    title: 'Codelists',
    body:
      'Many declaration fields only accept values from an official list — ' +
      'cargo operations, certificate types, waste types and so on. These are ' +
      'those lists, with names in English, Finnish and Swedish.\n\n' +
      '“FI preferred” marks the values most commonly used in Finland — all ' +
      'values in a list are accepted, but these are the usual picks.\n\n' +
      'They come from the official NEMO site and refresh automatically — you ' +
      'don’t maintain them. This page is for looking a code up when you ' +
      'wonder what it means.',
  },
  'admin.hsmap': {
    title: 'Cargo HS map',
    body:
      'Cargo declarations name goods with an international HS code. In ' +
      'Finland, everyday cargo types (sawn timber, pulp, grain and so on) ' +
      'each have an official representative HS code — this table is that ' +
      'mapping, straight from the authorities.\n\n' +
      'When you know the cargo type, this gives you the code to use. The ' +
      'grey text under each code is the official description of what the ' +
      'code covers.\n\n' +
      'The list refreshes automatically — you don’t maintain it.',
  },
  'admin.hazmat': {
    title: 'Dangerous goods',
    body:
      'The official reference list of dangerous goods: UN number, proper ' +
      'shipping name and hazard class. Dangerous-goods declarations must ' +
      'name cargo from this list.\n\n' +
      'The list fills and refreshes itself from the authorities’ service — ' +
      'you don’t maintain it. Until the NEMO connection is set up it can be ' +
      'empty; the Sync tab shows the state.',
  },
  'admin.sync': {
    title: 'Reference data sync',
    body:
      'NEMOLink keeps its own copy of the official reference data — ' +
      'codelists, locations and dangerous-goods information — and refreshes ' +
      'it automatically every day.\n\n' +
      '“Waiting for configuration” means that dataset’s source isn’t ' +
      'connected yet (for example, the authorities’ service address arrives ' +
      'with NEMO onboarding). Nothing is wrong — it starts syncing once ' +
      'connected.\n\n' +
      '“Run now” fetches the latest data immediately. Every run is recorded ' +
      'below and in the audit log.\n\n' +
      '“NEMO contracts” watches the official schemas and specifications ' +
      'NEMOLink is built against. If the authorities publish a change, the ' +
      'check flags it here and emails your admin — the system keeps using ' +
      'its reviewed copies until the update has been checked and deployed.',
  },
  'admin.audit': {
    title: 'The audit log',
    body:
      'Every important action in NEMOLink is recorded here: who did what, ' +
      'and when. User approvals, sign-in attempts, sent emails, changes to ' +
      'ships and declarations.\n\n' +
      'The records are tamper-evident — each entry is cryptographically ' +
      'chained to the previous one, so history cannot be quietly changed.\n\n' +
      'You only see your own organization’s events — plus changes to ships, ' +
      'which are shared: when another organization changed a ship, the entry ' +
      'says “Other organisation” and shows what changed, never who. Tap a row ' +
      'for details.\n\n' +
      '“NEMO only” shows the NEMO log: every exchange with NEMO that someone ' +
      'here started — the port call created or refused, each report sent — ' +
      'with what NEMO said in plain words, and NEMOLink’s request and ' +
      'NEMO’s answer whole under “Raw event data”.',
  },
  'captain.pec': {
    title: 'Your PEC',
    body:
      'Your Pilotage Exemption Certificate: the number (up to 10 ' +
      'characters, from the certificate itself), whether it is restricted ' +
      'or unrestricted, what it covers — whole VTS areas or single Finnish ' +
      'ports — and how long it is valid.\n\n' +
      'No PEC for Finland? Flip the switch and you will not be asked ' +
      'again.\n\n' +
      'NEMOLink shows the number in the header while you are signed in and ' +
      'uses these details to pre-fill the pilotage exemption part of ' +
      'arrival and departure notices.\n\n' +
      'You can skip this for now — you will be asked again next time.',
  },
  'call.documents': {
    title: 'Ship documents',
    body:
      'Drop the ship’s filled forms straight onto a port call — or press ' +
      'Add files. On a phone, Add files opens the camera roll and file ' +
      'picker.\n\n' +
      'NEMOLink reads the standard Excel forms by itself: the NSW crew ' +
      'list, passenger list, security, waste and health declaration forms, ' +
      'and the IMO FAL forms 1–7 (.xls and .xlsx). The block shows what ' +
      'was read — for example “9 crew members” — and the details open with ' +
      'a tap.\n\n' +
      'PDFs are stored with the call, but data cannot be read from them — ' +
      'when a form arrives as a PDF (often a scan), ask for the Excel ' +
      'version too and upload that.\n\n' +
      'What was read is also checked: port codes against the official ' +
      'port list, security facility codes against that port’s published ' +
      'facilities, dates for readability, and the ship name and IMO ' +
      'against the ship of the call. A file whose IMO belongs to another ' +
      'ship is refused outright — drop it on the right call instead. ' +
      'Anything else doubtful is marked — the file shows “2 to check” ' +
      'and the marked values open with a tap to say what we read and ' +
      'what looks wrong. Port values also show that port’s areas, berths ' +
      'and security facility codes, and you can correct a value right ' +
      'there — ports and facility codes are picked from the official ' +
      'lists (a retired facility code is flagged and never offered), ' +
      'dates and names are typed. The correction is stored beside the ' +
      'file (never in it) and recorded in the audit log.\n\n' +
      'Coded values must be ones NEMO accepts: stores and crew effects ' +
      'types, waste types, security levels, ranks, nationalities and ' +
      'units (KGM, LTR, MTQ, NAR or TNE — bottles, cans and pieces are ' +
      'counted as NAR). What the ship wrote in its own words — “Rum”, ' +
      '“Ch.Off”, “85 m3” — is read for you; anything else is marked and ' +
      'picked from the NEMO list, and your pick is remembered for the ' +
      'next file.\n\n' +
      'Dropping files opens the forms wizard: first the files, then one ' +
      'step per form showing only what needs you, then the forms back as ' +
      'files in NEMO codes and units — one by one or as a zip. The same ' +
      '“Download for NEMO” is on each form afterwards. A form that names ' +
      'no IMO (the NSW security form has no ship field) counts for the ' +
      'call only once you confirm it is this ship’s.\n\n' +
      'Uploading a newer version of the same form replaces the older one ' +
      '(the audit log keeps the history). Every upload, read and removal ' +
      'is recorded, and nothing read from a file changes the port call by ' +
      'itself — the data waits for the declaration it belongs to.',
  },
  'users.captain-ship': {
    title: 'A captain’s ship',
    body:
      'Each captain account is linked to one ship. The captain then sees ' +
      'that ship’s port calls on their front page and can upload the ' +
      'ship’s forms — crew lists, waste, security and the rest — straight ' +
      'to the right call, from a phone too.\n\n' +
      'Without a linked ship a captain sees an empty page. The link ' +
      'applies from their very next click, no new sign-in needed.',
  },
  'users.roles': {
    title: 'What the roles mean',
    body:
      'Admin: manages users and settings for your organization — and can do ' +
      'everything an editor can.\n\n' +
      'Editor: prepares, checks and sends declarations.\n\n' +
      'Viewer: sees everything, changes nothing.\n\n' +
      'Captain: the ship’s master — fills in their own ship’s tasks (like ' +
      'crew and waste lists) and nothing else.\n\n' +
      'You can change an active user’s role at any time; the change applies ' +
      'from their very next click, no new sign-in needed. You cannot change ' +
      'your own role — ask another admin.',
  },
};
