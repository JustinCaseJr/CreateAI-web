import { Agent } from 'agents';

export class CreateAIAgent extends Agent {
  initialState = { messages: [], updatedAt: null };

  async onStart() {
    if (!this.state?.messages) this.setState({ messages: [], updatedAt: null });
  }

  async onMessage(connection, raw) {
    let payload;
    try { payload = typeof raw === 'string' ? JSON.parse(raw) : raw; }
    catch { connection.send(JSON.stringify({ type: 'error', error: 'Invalid message.' })); return; }
    const message = typeof payload?.message === 'string' ? payload.message.trim() : '';
    if (!message) return;
    const messages = [...(this.state.messages || []), { role: 'user', content: message }].slice(-40);
    this.setState({ messages, updatedAt: new Date().toISOString() });
    connection.send(JSON.stringify({ type: 'ack', message }));

    if (!this.env.AI) {
      connection.send(JSON.stringify({ type: 'error', error: 'Workers AI binding is not configured.' }));
      return;
    }
    try {
      const result = await this.env.AI.run('@cf/zai-org/glm-4.7-flash', {
        messages: [
          { role: 'system', content: 'You are Create AI, a helpful creative assistant. Maintain continuity and be natural.' },
          ...messages.map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }))
        ],
        max_tokens: 900
      });
      const reply = result.response || 'I could not generate a response.';
      const next = [...messages, { role: 'assistant', content: reply }].slice(-40);
      this.setState({ messages: next, updatedAt: new Date().toISOString() });
      connection.send(JSON.stringify({ type: 'assistant', content: reply }));
      connection.send(JSON.stringify({ type: 'state', state: this.state }));
    } catch (error) {
      connection.send(JSON.stringify({ type: 'error', error: error?.message || 'Generation failed.' }));
    }
  }
}
