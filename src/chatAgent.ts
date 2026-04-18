import { DurableObject } from 'cloudflare:workers';
import { Env, Message, ChatState, SummarizeParams } from './types';

const MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast';
const MAX_MESSAGES_BEFORE_SUMMARY = 30;
const KEEP_MESSAGES_AFTER_SUMMARY = 10;

export class ChatAgent extends DurableObject<Env> {
  private state: ChatState;
  private initialized = false;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.state = {
      messages: [],
      summary: null,
      lastActiveAt: Date.now(),
      totalMessagesEver: 0,
    };

    this.ctx.blockConcurrencyWhile(async () => {
      const stored = await this.ctx.storage.get<ChatState>('chatState');
      if (stored) {
        this.state = stored;
      }
      this.initialized = true;
    });
  }

  private async persist() {
    await this.ctx.storage.put('chatState', this.state);
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const cors = {
      'Access-Control-Allow-Origin': '*',
      'Content-Type': 'application/json',
    };

    // POST /chat — send a user message, get AI response
    if (url.pathname === '/chat' && request.method === 'POST') {
      try {
        const { message } = await request.json<{ message: string }>();
        if (!message?.trim()) {
          return Response.json({ error: 'Message is required' }, { status: 400, headers: cors });
        }

        // Add user message
        this.state.messages.push({ role: 'user', content: message.trim(), timestamp: Date.now() });
        this.state.totalMessagesEver++;
        this.state.lastActiveAt = Date.now();

        // Build context for LLM
        const systemPrompt = this.buildSystemPrompt();
        const recentMessages = this.state.messages.slice(-20);

        // Stream response from Workers AI
        const aiResponse = await this.env.AI.run(MODEL, {
          messages: [
            { role: 'system', content: systemPrompt },
            ...recentMessages.map(m => ({ role: m.role, content: m.content })),
          ],
          max_tokens: 1024,
          stream: false,
        }) as { response: string };

        const assistantContent = aiResponse.response?.trim() ?? 'Sorry, I could not generate a response.';

        // Add assistant message
        this.state.messages.push({
          role: 'assistant',
          content: assistantContent,
          timestamp: Date.now(),
        });
        this.state.totalMessagesEver++;

        await this.persist();

        // Trigger summarization workflow if conversation is long
        if (this.state.messages.length >= MAX_MESSAGES_BEFORE_SUMMARY) {
          const sessionId = this.ctx.id.toString();
          await this.env.SUMMARIZE_WORKFLOW.create({
            params: {
              sessionId,
              messages: this.state.messages.slice(0, -KEEP_MESSAGES_AFTER_SUMMARY),
            } as SummarizeParams,
          });
        }

        return Response.json(
          {
            message: assistantContent,
            totalMessages: this.state.totalMessagesEver,
            hasSummary: !!this.state.summary,
          },
          { headers: cors }
        );
      } catch (err) {
        console.error('Chat error:', err);
        return Response.json({ error: 'Failed to process message' }, { status: 500, headers: cors });
      }
    }

    // GET /history — return full conversation history
    if (url.pathname === '/history' && request.method === 'GET') {
      return Response.json(
        {
          messages: this.state.messages,
          summary: this.state.summary,
          totalMessagesEver: this.state.totalMessagesEver,
          lastActiveAt: this.state.lastActiveAt,
        },
        { headers: cors }
      );
    }

    // POST /clear — reset conversation
    if (url.pathname === '/clear' && request.method === 'POST') {
      this.state = {
        messages: [],
        summary: null,
        lastActiveAt: Date.now(),
        totalMessagesEver: 0,
      };
      await this.persist();
      return Response.json({ success: true }, { headers: cors });
    }

    // POST /apply-summary — called by Workflow to update summary
    if (url.pathname === '/apply-summary' && request.method === 'POST') {
      const { summary } = await request.json<{ summary: string }>();
      this.state.summary = summary;
      // Keep only recent messages after summarization
      this.state.messages = this.state.messages.slice(-KEEP_MESSAGES_AFTER_SUMMARY);
      await this.persist();
      return Response.json({ success: true }, { headers: cors });
    }

    return new Response('Not Found', { status: 404 });
  }

  private buildSystemPrompt(): string {
    const date = new Date().toLocaleDateString('en-GB', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    let prompt = `You are Memo, a brilliant and friendly AI assistant with persistent memory. 
You remember everything from our current conversation and can reference earlier messages naturally.
You are helpful, concise, and thoughtful. You avoid unnecessary filler phrases.
Today is ${date}.`;

    if (this.state.summary) {
      prompt += `\n\n## Earlier in our conversation:\n${this.state.summary}\n\n(This is a summary of earlier messages — refer to it naturally if relevant.)`;
    }

    return prompt;
  }
}
