import Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { z } from "zod";
import { createEvent, listEvents } from "./calendar";
import { createReplyDraft, getEmail, gmailConfigured, searchEmail } from "./gmail";
import { getPulse, getShow, revosConfigured, summarizePulse } from "./revos";
import { getStore } from "./store";

const client = new Anthropic();
export const MODEL = "claude-opus-5-5";

function systemPrompt(): string {
  const name = process.env.EXEC_NAME || "the executive";
  return `You are the executive assistant for ${name}. Context about them: ${process.env.EXEC_CONTEXT || "(none provided)"}

Your job: keep their inbox triaged, their commitments tracked, and their day clear.
- Email triage: classify each message as urgent (needs action today), reply (needs a response, not today), fyi, or ignore. Record every classification with triage_email, with a one-line summary.
- Drafts: when a reply is needed, write it in ${name}'s voice (warm, brief, decisive) and save it with draft_reply. You can only create drafts; ${name} reviews and sends them. Never claim an email was sent.
- Tasks: when an email or conversation contains a commitment or deadline, create a task with a due date. Check list_tasks first so you don't duplicate one.
- Calendar: check list_events before proposing times, and prefer gaps that keep focus blocks intact. Only add events with create_event when ${name} asks for it, and send invites to other people only when ${name} explicitly says to.
- Revenue: RevOS (revos_pulse, revos_show) is the source of truth for ticket sales, revenue, pace, targets and which marketing is driving sales. Money values are integer minor units (cents) with a currency: divide by 100 for USD-style currencies, never add different currencies, and treat null as unknown, not zero. Say "gross after refunds", never "net revenue". If a measure is partial or data is stale, say so. If the organization is fixture data, say the numbers are sample data.
- Be concise. Lead with what needs ${name}'s decision. Use short markdown lists.
Now: ${new Date().toISOString()} (UTC).${process.env.EXEC_TIMEZONE ? ` ${name}'s time zone is ${process.env.EXEC_TIMEZONE}; give times in it and write event times with its UTC offset.` : ""}`;
}

const tools = () => {
  const store = getStore();
  return [
    betaZodTool({
      name: "search_email",
      description: "Search the inbox with Gmail query syntax (e.g. 'is:unread newer_than:2d', 'from:acme'). Returns id, sender, subject, date, snippet.",
      inputSchema: z.object({ query: z.string(), max: z.number().int().min(1).max(30).optional() }),
      run: async ({ query, max }) => JSON.stringify(await searchEmail(query, max)),
    }),
    betaZodTool({
      name: "read_email",
      description: "Read the full body of one email by id.",
      inputSchema: z.object({ id: z.string() }),
      run: async ({ id }) => JSON.stringify(await getEmail(id)),
    }),
    betaZodTool({
      name: "triage_email",
      description: "Record the triage decision for an email so it shows on the dashboard.",
      inputSchema: z.object({
        id: z.string(),
        category: z.enum(["urgent", "reply", "fyi", "ignore"]),
        summary: z.string().describe("One line: what it is and what's needed"),
      }),
      run: async ({ id, category, summary }) => {
        const m = await getEmail(id);
        const receivedAt = m.date ? new Date(m.date) : null;
        await store.upsertTriage({
          message_id: m.id, thread_id: m.threadId, sender: m.from, subject: m.subject, snippet: m.snippet,
          received_at: receivedAt && !isNaN(+receivedAt) ? receivedAt.toISOString() : null,
          category, summary, draft_id: null,
        });
        return `Triaged ${id} as ${category}`;
      },
    }),
    betaZodTool({
      name: "draft_reply",
      description: "Save a reply draft to the email's thread in Gmail. Does not send.",
      inputSchema: z.object({ id: z.string(), body: z.string() }),
      run: async ({ id, body }) => {
        const draftId = await createReplyDraft(id, body);
        const existing = (await store.listTriage()).find((t) => t.message_id === id);
        if (existing) await store.upsertTriage({ ...existing, draft_id: draftId });
        await store.log("draft", `Drafted reply: ${existing?.subject ?? id}`);
        return `Draft saved (${draftId})`;
      },
    }),
    betaZodTool({
      name: "list_events",
      description: "List calendar events between two ISO datetimes (inclusive of overlapping events).",
      inputSchema: z.object({ from: z.string().describe("ISO 8601 datetime"), to: z.string().describe("ISO 8601 datetime") }),
      run: async ({ from, to }) => JSON.stringify(await listEvents(new Date(from), new Date(to))),
    }),
    betaZodTool({
      name: "create_event",
      description: "Add an event to the primary calendar. Invites go out only if send_invites is true.",
      inputSchema: z.object({
        title: z.string(),
        start: z.string().describe("ISO 8601 datetime with offset"),
        end: z.string().describe("ISO 8601 datetime with offset"),
        description: z.string().optional(),
        location: z.string().optional(),
        attendees: z.array(z.string()).describe("Email addresses").optional(),
        send_invites: z.boolean().optional(),
      }),
      run: async ({ send_invites, ...e }) => {
        const ev = await createEvent({ ...e, sendInvites: send_invites });
        await store.log("calendar", `Added event: ${ev.title}`);
        return JSON.stringify(ev);
      },
    }),
    ...(revosConfigured() ? [
      betaZodTool({
        name: "revos_pulse",
        description: "RevOS overview: upcoming shows with paid tickets, gross after refunds, 7-day pace vs the previous 7 days, targets, top marketing drivers and items needing attention.",
        inputSchema: z.object({}),
        run: async () => JSON.stringify(summarizePulse(await getPulse())),
      }),
      betaZodTool({
        name: "revos_show",
        description: "RevOS detail for one show (id from revos_pulse): revenue breakdown, ticket classes, marketing drivers, sync history.",
        inputSchema: z.object({ id: z.string() }),
        run: async ({ id }) => {
          const { event, card, ticketClasses } = await getShow(id);
          return JSON.stringify({ card, revenue: event.revenue, marketing: event.marketing, marketingLast7Days: event.marketingLast7Days, ticketClasses, freshness: event.freshness });
        },
      }),
    ] : []),
    betaZodTool({
      name: "list_tasks",
      description: "List tasks. status 'active' = open + waiting.",
      inputSchema: z.object({ status: z.enum(["active", "open", "waiting", "done"]).optional() }),
      run: async ({ status }) => JSON.stringify(await store.listTasks({ status: status ?? "active" })),
    }),
    betaZodTool({
      name: "create_task",
      description: "Create a task / follow-up.",
      inputSchema: z.object({
        title: z.string(),
        notes: z.string().optional(),
        due_date: z.string().describe("YYYY-MM-DD").optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        source: z.string().describe("Where it came from, e.g. 'email: <subject>'").optional(),
      }),
      run: async (t) => {
        const task = await store.createTask({ ...t, source: t.source ?? "assistant" });
        await store.log("task", `Created task: ${task.title}`);
        return JSON.stringify(task);
      },
    }),
    betaZodTool({
      name: "update_task",
      description: "Update a task's status, due date, priority or notes.",
      inputSchema: z.object({
        id: z.string(),
        status: z.enum(["open", "waiting", "done"]).optional(),
        due_date: z.string().optional(),
        priority: z.enum(["high", "medium", "low"]).optional(),
        notes: z.string().optional(),
      }),
      run: async ({ id, ...patch }) => JSON.stringify(await store.updateTask(id, patch)),
    }),
  ];
};

export async function runAssistant(messages: Anthropic.Beta.BetaMessageParam[]): Promise<string> {
  const final = await client.beta.messages.toolRunner({
    model: MODEL,
    max_tokens: 16000,
    output_config: { effort: "medium" },
    // Route refusals to a fallback model instead of failing the request.
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    system: systemPrompt(),
    tools: tools(),
    messages,
    max_iterations: 25,
  } as Parameters<typeof client.beta.messages.toolRunner>[0]);
  if (final.stop_reason === "refusal") return "I can't help with that request.";
  return final.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
}

export async function runTriage(): Promise<string> {
  const text = await runAssistant([{
    role: "user",
    content: "Triage my inbox: look at unread mail from the last 2 days (query 'in:inbox newer_than:2d'), triage every message, draft replies for anything urgent or needing a reply, and create tasks for any commitments. Then give me a 3-line summary.",
  }]);
  await getStore().log("triage", "Inbox triage run" + (gmailConfigured() ? "" : " (sample inbox)"));
  return text;
}

export async function runBriefing(): Promise<string> {
  const text = await runAssistant([{
    role: "user",
    content: "Write my daily briefing. First triage new inbox mail (in:inbox newer_than:1d), check my active tasks, list today's and tomorrow's calendar events, and (if the revos_pulse tool is available) check RevOS. Then write the briefing in markdown with sections: **Top 3 priorities today**, **Schedule** (today's meetings with a one-line prep note each, and conflicts or back-to-backs), **Decisions needed**, **Revenue** (only if RevOS is available: shows in the next 14 days, ticket pace this week vs last, anything behind target or needing attention), **Overdue / due soon**, **Inbox** (urgent items + drafts waiting for my review). Keep it under 250 words. Output only the briefing.",
  }]);
  const store = getStore();
  await store.saveBriefing(text);
  await store.log("briefing", "Daily briefing generated");
  return text;
}
