-- Protect 104: inherited evidence baseline (as of 2026-10-26).
-- This seeds concise references only — no confidential documents, full emails, or donor data.
-- Inherited findings are marked inherited_unverified and need_review until someone retrieves
-- the underlying source into this project. Nothing here is an approved decision except the
-- mission itself (F01, a recorded user instruction).

create or replace function public.seed_protect104_baseline(p_project uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s_user uuid; s01 uuid; s02 uuid; s03 uuid; s04 uuid; s05 uuid; s06 uuid; s07 uuid; s08 uuid; s09 uuid; s10 uuid; s11 uuid;
  f01 uuid; f02 uuid; f03 uuid; f04 uuid; f05 uuid; f06 uuid; f07 uuid; f08 uuid; f09 uuid; f10 uuid; f11 uuid; f12 uuid;
  t_owner uuid; t_listing uuid; t_leases uuid; t_rentroll uuid; t_model uuid; t_aaa uuid; t_protect uuid; t_board uuid;
  t_cast uuid; t_funding uuid; t_broker uuid; t_limits uuid; t_det uuid;
  inh constant text := 'inherited:chatgpt-session-2026-10-26';
begin
  if auth.uid() is not null and not public.is_owner(p_project) then
    raise exception 'only the project owner can seed the baseline' using errcode = '42501';
  end if;
  if exists (select 1 from public.sources where project_id = p_project and register_code = 'S01') then
    raise exception 'baseline already seeded for this project';
  end if;
  perform set_config('app.actor_kind', 'seed', true);

  -- Sources ------------------------------------------------------------------
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, access_classification, availability, inherited, retrieval_task, coverage_note)
  values (p_project, 'U01', 'user_instruction', 'User clarification: mission and boundaries', '2026-10-26', '2026-10-26T00:00:00Z', 'Daniel Spicka (recorded instruction)', 'internal', 'available', false, null,
          'Recorded user decision on community nonprofit ownership, board governance and protected cultural use.')
  returning id into s_user;

  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S01','document','Protect_104_N_Main_Street_Project_Handoff.docx',null,'2026-10-26T00:00:00Z',inh,'chatgpt-library:libfile_e6cffdd987f881919220c56c3c52c3c1',null,'confidential','unavailable',true,
   'Upload the handoff .docx through Evidence → Upload. ChatGPT Library IDs do not transfer.','Attached baseline handoff, read in originating session')
  returning id into s01;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S02','email','Paul Schwartz email with "104 N. Main St. Brochure Update 1-28-26.pdf"','2026-01-29','2026-10-26T00:00:00Z',inh,null,'https://mail.google.com/mail/u/0/#all/19c0bc2ac55cfbf0','confidential','unavailable',true,
   'Upload the brochure PDF (or connect read-only Gmail). Rent-roll page is image-based and needs human-checkable extraction.','Text extraction read; image-based rent roll not inspected')
  returning id into s02;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S03','email','Daniel to Paul — option proposal (September 5, 2026)','2026-09-05','2026-10-26T00:00:00Z',inh,null,'https://mail.google.com/mail/u/0/#all/1a0737d6d7c8eb77','restricted','unavailable',true,
   'Upload or import the outbound email. Contains a confidentiality request — keep restricted.','Full outbound email read; confidentiality request included')
  returning id into s03;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S04','document','(FINAL) Wax Poetic, LLC Sublease Agreement .docx.pdf',null,'2026-10-26T00:00:00Z',inh,'chatgpt-library:libfile_43849b9a97e88191aa97774758ab394f',null,'confidential','unavailable',true,
   'Upload the sublease PDF; obtain the executed copy, any amendments, and the master lease.','Full extracted text read, ten pages; signatures not established')
  returning id into s04;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S05','email','LegalZoom 1023-EZ submission confirmation','2026-10-08','2026-10-26T00:00:00Z',inh,null,'https://mail.google.com/mail/u/0/#all/1a11a7ff89c814d8','confidential','unavailable',true,
   'Upload or import the confirmation email.','Filing confirmation email read')
  returning id into s05;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S06','document','104 N Main Street Investor Deck.pdf (QUARANTINED from underwriting)',null,null,inh,'chatgpt-library:libfile_b04d17bed62081918f9fa7145578a6e2',null,'confidential','unavailable',true,
   'Upload only if needed for the critique; never use as an underwriting input.','Historical deck; quarantine from underwriting')
  returning id into s06;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S07','web_page','CAST — CounterPulse partnership and About',null,'2026-10-26T00:00:00Z',inh,null,'https://cast-sf.org/partnership/counterpulse/','public','pending_retrieval',true,
   'Retrieve https://cast-sf.org/partnership/counterpulse/ and https://cast-sf.org/about-us/ and record access date.','Ownership/deed-restriction precedent')
  returning id into s07;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S08','web_page','CAST — How we work (services and eligibility)',null,'2026-10-26T00:00:00Z',inh,null,'https://cast-sf.org/how-we-work/','public','pending_retrieval',true,
   'Retrieve current criteria; mark stale if changed.','Services and eligibility')
  returning id into s08;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S09','web_page','NIVA — Join and About',null,'2026-10-26T00:00:00Z',inh,null,'https://www.nivassoc.org/about','public','pending_retrieval',true,
   'Retrieve https://www.nivassoc.org/join and https://www.nivassoc.org/about.','Membership and organization distinction')
  returning id into s09;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S10','web_page','California AG — Charitable trust transactions',null,null,inh,null,'https://oag.ca.gov/charities/transactions','public','pending_retrieval',true,
   'Retrieve the official page.','Official nonprofit transaction oversight resource')
  returning id into s10;
  insert into public.sources (project_id, register_code, kind, title, source_date, retrieved_at, retrieved_by, provider_id, original_url, access_classification, availability, inherited, retrieval_task, coverage_note) values
  (p_project,'S11','statute','California Corporations Code section 5812',null,null,inh,null,'https://leginfo.legislature.ca.gov/faces/codes_displaySection.xhtml?lawCode=CORP&sectionNum=5812.','public','unavailable',true,
   'Official page retrieval failed in kickoff; retrieve and have qualified counsel interpret.','Statutory interpretation still requires verification')
  returning id into s11;

  -- Claims -------------------------------------------------------------------
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified, verified_by, verified_at)
  values (p_project,'F01','Daniel approved community nonprofit ownership, board governance, and protected cultural use as the mission.',
          'Duration, protected uses, board design, enforcement, entity, financing and Daniel''s exposure limits remain undecided.',
          'mission','user_reported','accepted','user',false,'Daniel Spicka','2026-10-26T00:00:00Z')
  returning id into f01;
  insert into public.claim_sources (project_id, claim_id, source_id, locator) values (p_project, f01, s_user, 'User clarification October 26, 2026');

  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified, conflict_group) values
  (p_project,'F02','January 28, 2026 broker brochure lists $1,050,000; APN 004-243-021; approximately 4,342 SF; four short-term leases.',
   'Historical broker representations — not verified title, current price, measured area, or current tenancy. APN is a lead for official records, not proof of title. Rent-roll page not extracted; no income figures established.',
   'property','documented_historical','needs_review','inherited',true,'price')
  returning id into f02;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified, conflict_group) values
  (p_project,'F03','Daniel proposed a 12-month exclusive option below $800,000, assignable to a preservation/acquisition entity, with credited option payment and possible seller financing.',
   'Verified contents of an outbound proposal; NO seller acceptance established.',
   'acquisition','documented_historical','needs_review','inherited',true,'price')
  returning id into f03;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F04','No later reply from Paul''s email address was found in the targeted search.',
   'Search limited to the retrieved account/query; not proof of no phone, text, or other communication.',
   'acquisition','documented_historical','needs_review','inherited',true)
  returning id into f04;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F05','Reviewed sublease states $1,300 monthly base rent plus optional $500 theater addendum and qualifying $300 event charges.',
   'Document terms only; current execution, elections, amendments and invoices unresolved.',
   'tenancy','documented_historical','needs_review','inherited',true)
  returning id into f05;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F06','Reviewed sublease states a June 1, 2026 start, month-to-month term, three months'' termination notice, and concurrent termination with the master lease unless otherwise agreed.',
   'Document terms, not a legal opinion; extracted signature lines blank; obtain executed copy and master lease. Does not establish secure occupancy.',
   'tenancy','documented_historical','needs_review','inherited',true)
  returning id into f06;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F07','LegalZoom says AAA''s Form 1023-EZ was submitted October 8, 2026.',
   'Filing confirmation, NOT an IRS determination; current federal exemption and state status unresolved.',
   'nonprofit','documented_historical','needs_review','inherited',true)
  returning id into f07;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F08','The prior investor deck has conflicting income figures and generated financial content.',
   'Handoff''s documented critique; underlying deck not re-read. Deck is quarantined from underwriting.',
   'finance','documented_historical','needs_review','inherited',true)
  returning id into f08;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F09','CAST reports a CounterPulse pathway to ownership and a deed restriction requiring a future buyer to be an arts nonprofit.',
   'Organizational account of precedent; not a legal template or a commitment to 104.',
   'precedent','documented_historical','needs_review','inherited',true)
  returning id into f09;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified, next_check_at) values
  (p_project,'F10','CAST describes Bay Area/Denver eligibility with at least one year of programming and prioritizes nonprofits/sponsored projects with three years.',
   'Website criteria read October 26, 2026; applicability to this project unconfirmed. Re-check before relying on it.',
   'funding','documented_historical','needs_review','inherited',true,'2027-01-26T00:00:00Z')
  returning id into f10;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F11','NIVA offers independent venue representation; NIVF is its affiliated charitable foundation.',
   'Distinct organizations; no membership, funding, or endorsement established.',
   'network','documented_historical','needs_review','inherited',true)
  returning id into f11;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified) values
  (p_project,'F12','The September 5 proposal requested that acquisition discussions remain among Daniel, Paul and the owners unless otherwise agreed.',
   'Confidentiality request by Daniel; flag any audience change. Confidential terms are excluded from stakeholder outreach by default.',
   'confidentiality','documented_historical','needs_review','inherited',true)
  returning id into f12;
  insert into public.claims (project_id, code, statement, limits, topic, evidence_class, review_state, origin, inherited_unverified, conflict_group) values
  (p_project,'U02','Earlier account that the seller was willing to consider about $800,000.',
   'User-reported historical context; undated; not a current price or seller position.',
   'acquisition','user_reported','needs_review','user',false,'price');

  insert into public.claim_sources (project_id, claim_id, source_id, locator) values
   (p_project,f02,s02,'brochure p.2'),(p_project,f03,s03,'email body'),(p_project,f04,s03,'targeted email search'),
   (p_project,f05,s04,'pp.3, 7–9'),(p_project,f06,s04,'pp.1–3, 6–10'),(p_project,f07,s05,'email body'),
   (p_project,f08,s01,'deck critique'),(p_project,f08,s06,'underlying deck (not re-read)'),(p_project,f09,s07,'CounterPulse page'),
   (p_project,f10,s08,'eligibility section'),(p_project,f11,s09,'about/join pages'),(p_project,f12,s03,'email body');

  -- Property -----------------------------------------------------------------
  insert into public.price_observations (project_id, observed_on, kind, amount_cents, comparator, status_note, claim_id) values
   (p_project,'2026-01-28','broker_list',105000000,'exact','Historical broker brochure list price; not current, not agreed.',f02),
   (p_project,'2026-09-05','outbound_proposal',80000000,'below','Daniel''s outbound option proposal; no seller acceptance established.',f03);
  insert into public.price_observations (project_id, observed_on, observed_on_note, kind, amount_cents, comparator, status_note) values
   (p_project,null,'undated, user-reported','user_reported',80000000,'approximately','Earlier user-reported account of seller willingness; historical context only.');

  insert into public.property_checks (project_id, area, item, status, claim_ids, note) values
   (p_project,'apn','APN 004-243-021 (lead from brochure)','not_established',array[f02],'Confirm against Sonoma County official records.'),
   (p_project,'ownership','Current owner of record and seller authority','not_established','{}','May 8 owner-authorization email was a signature request to MTME; it does not establish ownership or executed consent.'),
   (p_project,'title','Title report and encumbrances','not_established','{}',null),
   (p_project,'leases','Executed occupancy agreements and master lease','not_established',array[f05,f06],'Extracted sublease signature lines were blank.'),
   (p_project,'leases','Current rent roll','not_established',array[f02],'Brochure rent-roll page is image-based and not extracted.'),
   (p_project,'condition','Building condition and repair needs','not_established','{}',null),
   (p_project,'zoning','Zoning and permitted uses','not_established','{}',null);

  -- Work queue (all dates unset) ----------------------------------------------
  insert into public.tasks (project_id, title, assigned_role, secondary_role, completion_evidence, origin) values
   (p_project,'Verify current ownership, APN and seller authority','general_counsel','data_engineer','Official record and source date; counsel/title review where needed','seed') returning id into t_owner;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Locate current listing, broker reply and diligence package','chief_of_staff','Actual retrieved records or explicit missing-source tasks','seed') returning id into t_listing;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Obtain executed occupancy agreements and master lease','general_counsel','Executed copies and amendments, execution review','seed') returning id into t_leases;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Extract broker rent-roll image, then request updated records','data_engineer','Human-checkable extraction; current rent roll still separately verified','seed') returning id into t_rentroll;
  insert into public.tasks (project_id, title, assigned_role, secondary_role, completion_evidence, origin) values
   (p_project,'Rebuild property operating model','strategist','fundraising','Actual rent/expense inputs, repair assumptions and downside scenarios','seed') returning id into t_model;
  insert into public.tasks (project_id, title, assigned_role, secondary_role, completion_evidence, origin) values
   (p_project,'Compare AAA with separate owner nonprofit','general_counsel','strategist','Governance, conflicts, capacity, tax/status and administrative tradeoffs','seed') returning id into t_aaa;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Compare protection terms and independent enforcement','general_counsel','Options for counsel, transfer/default/foreclosure analysis','seed') returning id into t_protect;
  insert into public.tasks (project_id, title, assigned_role, secondary_role, completion_evidence, origin) values
   (p_project,'Develop representative board options','community_outreach','strategist','Proposed composition and selection process, no appointments implied','seed') returning id into t_board;
  insert into public.tasks (project_id, title, assigned_role, secondary_role, completion_evidence, origin) values
   (p_project,'Assess CAST assistance and NIVA resources','strategist','niva_liaison','Current criteria, appropriate inquiry draft, no assumed affiliation','seed') returning id into t_cast;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Qualify funding prospects','fundraising','Current eligibility and restrictions; no assumed available capital','seed') returning id into t_funding;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Prepare confidential broker follow-up','chief_of_staff','Reviewable unsent draft grounded in September email','seed') returning id into t_broker;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, origin) values
   (p_project,'Establish Daniel''s exposure limits','chief_of_staff','Recorded sponsor decision on cash, guarantees and time','seed') returning id into t_limits;
  insert into public.tasks (project_id, title, assigned_role, completion_evidence, next_action, origin) values
   (p_project,'Confirm IRS determination and state status for AAA','general_counsel','IRS determination letter or TEOS record; state registration record','A 1023-EZ submission (F07) is not a determination.','seed') returning id into t_det;

  insert into public.task_dependencies (project_id, task_id, depends_on_id) values
   (p_project, t_model, t_rentroll), (p_project, t_model, t_leases), (p_project, t_broker, t_listing);

  -- Retrieval gaps are first-class tasks.
  insert into public.tasks (project_id, title, assigned_role, next_action, origin)
  select p_project, 'Retrieve source ' || s.register_code || ': ' || s.title, 'data_engineer', s.retrieval_task, 'seed'
    from public.sources s where s.project_id = p_project and s.availability <> 'available' and s.register_code <> 'S06';

  -- Risks (each tied to an inherited finding) --------------------------------
  insert into public.risks (project_id, title, description, likelihood, impact, mitigation, owner_role, claim_ids, task_ids, origin) values
   (p_project,'Sublease ends with the master lease','Reviewed sublease terminates concurrently with the master lease unless otherwise agreed; month-to-month with three months'' notice.','unknown','high','Obtain executed sublease and master lease; counsel review.','general_counsel',array[f06],array[t_leases],'seed'),
   (p_project,'No seller response to the option proposal','No later reply found in the targeted email search.','unknown','high','Confidential broker follow-up draft; check other channels.','chief_of_staff',array[f04],array[t_broker],'seed'),
   (p_project,'Nonprofit exemption not yet determined','1023-EZ submitted; determination and state status unknown.','unknown','medium','Confirm determination before relying on exempt status in funding asks.','general_counsel',array[f07],array[t_det],'seed'),
   (p_project,'Unreliable historical financials','Prior deck has conflicting income figures and generated content.','high','medium','Quarantine deck; rebuild model from actual rent and expense inputs.','strategist',array[f08],array[t_model],'seed');

  -- Unresolved decisions (open, no recommendation seeded) -------------------
  insert into public.decisions (project_id, question, alternatives, owner, origin) values
   (p_project,'Duration of protection for theater, music, education and community gathering','[{"label":"Fixed term (length to be determined)"},{"label":"Perpetual protection"}]','Daniel','seed'),
   (p_project,'Precise protected uses and access obligations','[{"label":"Narrow enumerated uses"},{"label":"Broad cultural-use category with access commitments"}]','Daniel','seed'),
   (p_project,'Board selection and composition','[{"label":"Operator-representative seats"},{"label":"Community-elected seats"},{"label":"Mixed appointed/elected"}]','Daniel','seed'),
   (p_project,'Independent enforcement rights for protected use','[{"label":"Deed restriction enforceable by a third-party nonprofit"},{"label":"Recorded covenant with public agency"},{"label":"Bylaw protections only"}]','Daniel','seed'),
   (p_project,'Owner entity: AAA or a separate owner nonprofit','[{"label":"AAA owns the property"},{"label":"Separate owner nonprofit"}]','Daniel','seed'),
   (p_project,'Acquisition financing approach','[{"label":"Seller financing"},{"label":"Mission lender / CDFI"},{"label":"Philanthropic capital campaign"},{"label":"Aligned interim owner"}]','Daniel','seed'),
   (p_project,'Daniel''s cash, guarantee and time limits','[{"label":"No personal guarantee"},{"label":"Limited guarantee with cap"},{"label":"Cash contribution with cap"}]','Daniel','seed');

  insert into public.governance_options (project_id, dimension, label, description) values
   (p_project,'owner_entity','AAA as owner','Use the existing AAA entity (1023-EZ submitted; determination pending).'),
   (p_project,'owner_entity','Separate owner nonprofit','A new single-purpose owner entity with its own board.'),
   (p_project,'protection_duration','Fixed term','Protection for a defined number of years (length unset).'),
   (p_project,'protection_duration','Perpetual','Protection without an end date.'),
   (p_project,'enforcement','Third-party deed restriction','Precedent: CAST/CounterPulse arts-nonprofit buyer restriction (F09) — precedent only, not a template.'),
   (p_project,'board_design','Representative board','Seats for operators and community users; selection process unset.');

  insert into public.integrations (project_id, provider, state, note) values
   (p_project,'ai_gateway','not_configured','Set AI_GATEWAY_API_KEY and AGENT_MODEL; status turns connected only after a verified test call.'),
   (p_project,'gmail_readonly','not_configured','ChatGPT connectors do not transfer. Requires a verified read-only OAuth app.'),
   (p_project,'google_drive_readonly','not_configured','Requires a verified read-only OAuth app.'),
   (p_project,'web_research','disabled','Official-source fetching is disabled until enabled in Settings; SSRF protections apply.'),
   (p_project,'recurring_research','disabled','Disabled until Daniel selects cadence and budget.');
end $$;

revoke execute on function public.seed_protect104_baseline(uuid) from public, anon;
grant execute on function public.seed_protect104_baseline(uuid) to authenticated;
