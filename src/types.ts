export interface Env {
  AI: Ai;
  CHAT_AGENT: DurableObjectNamespace;
  SUMMARIZE_WORKFLOW: Workflow;
  ASSETS: Fetcher;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface ChatState {
  messages: Message[];
  summary: string | null;
  lastActiveAt: number;
  totalMessagesEver: number;
}

export interface SummarizeParams {
  sessionId: string;
  messages: Message[];
}
