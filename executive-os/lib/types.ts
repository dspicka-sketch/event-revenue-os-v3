export type Priority = "high" | "medium" | "low";
export type TaskStatus = "open" | "waiting" | "done";
export type EmailCategory = "urgent" | "reply" | "fyi" | "ignore";

export interface Task {
  id: string;
  title: string;
  notes: string | null;
  due_date: string | null;
  priority: Priority;
  status: TaskStatus;
  source: string;
  created_at: string;
}

export interface EmailTriage {
  message_id: string;
  thread_id: string;
  sender: string;
  subject: string;
  snippet: string | null;
  received_at: string | null;
  category: EmailCategory;
  summary: string | null;
  draft_id: string | null;
  triaged_at: string;
}

export interface Briefing {
  id: string;
  content: string;
  created_at: string;
}

export interface Activity {
  id: string;
  kind: string;
  summary: string;
  created_at: string;
}

export interface EmailMessage {
  id: string;
  threadId: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  snippet: string;
  body?: string;
  messageIdHeader?: string;
}
