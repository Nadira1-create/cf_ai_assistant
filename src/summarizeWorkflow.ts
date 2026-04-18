import { WorkflowEntrypoint, WorkflowEvent, WorkflowStep } from 'cloudflare:workers';
import { Env, Message, SummarizeParams } from './types';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';

/**
 * SummarizeWorkflow
 *
 * Triggered when a session's conversation exceeds MAX_MESSAGES_BEFORE_SUMMARY.
 * It:
 *   1. Summarizes the older portion of the conversation using the LLM
 *   2. Posts the summary back to the ChatAgent Durable Object so it can
 *      compress its stored history and free up context window space.
 *
 * Running this in a Workflow means it has automatic retries, persistent state,
 * and doesn't block the main chat response.
 */
export class SummarizeWorkflow extends WorkflowEntrypoint<Env, SummarizeParams> {
  async run(event: WorkflowEvent<SummarizeParams>, step: WorkflowStep) {
    const { sessionId, messages } = event.payload;

    // Step 1: Build a summary of the provided messages
    const summary = await step.do('summarize-messages', async () => {
      const conversation = messages
        .map(m => `${m.role === 'user' ? 'User' : 'Assistant'}: ${m.content}`)
        .join('\n');

      const response = await this.env.AI.run(MODEL, {
        messages: [
          {
            role: 'system',
            content: `You are a concise summarizer. Given a conversation excerpt, produce a compact but information-dense summary (max 300 words) that captures:
- Key topics discussed
- Important facts, decisions, or preferences the user mentioned
- Any tasks or follow-ups that were agreed upon
Write in third-person ("The user asked about...", "The assistant explained..."). Be factual and brief.`,
          },
          {
            role: 'user',
            content: `Summarize this conversation:\n\n${conversation}`,
          },
        ],
        max_tokens: 512,
        stream: false,
      }) as { response: string };

      return response.response?.trim() ?? 'No summary available.';
    });

    // Step 2: Push the summary back to the ChatAgent Durable Object
    await step.do('apply-summary-to-agent', async () => {
      const id = this.env.CHAT_AGENT.idFromString(sessionId);
      const agent = this.env.CHAT_AGENT.get(id);

      const res = await agent.fetch('http://internal/apply-summary', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ summary }),
      });

      if (!res.ok) {
        throw new Error(`Failed to apply summary: ${res.status}`);
      }

      return { applied: true };
    });

    return { success: true, summaryLength: summary.length };
  }
}
