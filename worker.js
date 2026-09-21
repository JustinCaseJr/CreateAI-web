import { CreateAIAgent } from './agent.js';

export { CreateAIAgent };

export default {
  async fetch(request, env) {
    const u = new URL(request.url);
    if (u.pathname === '/api/agent/ws') {
      const id = u.searchParams.get('id')?.trim();
      if (!id) return new Response('id is required', { status: 400, headers: cors() });
      if (!env.CREATE_AI_AGENT) return json({ error: 'Durable Agent binding is not configured.' }, 500);
      const stub = env.CREATE_AI_AGENT.get(env.CREATE_AI_AGENT.idFromName(id));
      return stub.fetch(request);
    }
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors() });

    if (u.pathname === '/api/memory' && request.method === 'GET') {
      if (!env.DB) return json({ enabled: false, memory: [] });
      const userId = u.searchParams.get('userId')?.trim();
      if (!userId) return json({ error: 'userId is required.' }, 400);
      const rows = await env.DB.prepare('SELECT memory_key, memory_text, created_at, updated_at FROM user_memory WHERE user_id = ? ORDER BY updated_at DESC LIMIT 100').bind(userId).all();
      return json({ enabled: true, memory: rows.results || [] });
    }

    if (u.pathname === '/api/memory' && request.method === 'POST') {
      if (!env.DB) return json({ error: 'Cloud memory is not configured yet.' }, 503);
      try {
        const b = await request.json();
        const userId = typeof b.userId === 'string' ? b.userId.trim() : '';
        const items = Array.isArray(b.memory) ? b.memory : [];
        if (!userId) return json({ error: 'userId is required.' }, 400);
        if (userId.length > 120) return json({ error: 'Invalid userId.' }, 400);
        const now = new Date().toISOString();
        const statements = items.slice(0, 100).map((item, i) => {
          const text = typeof item === 'string' ? item.trim() : String(item?.memory_text || '').trim();
          const key = typeof item?.memory_key === 'string' && item.memory_key.trim() ? item.memory_key.trim() : `memory-${i}`;
          return env.DB.prepare(`INSERT INTO user_memory (user_id, memory_key, memory_text, created_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, memory_key) DO UPDATE SET memory_text=excluded.memory_text, updated_at=excluded.updated_at`).bind(userId, key.slice(0, 160), text.slice(0, 1000), now, now);
        }).filter(Boolean);
        if (statements.length) await env.DB.batch(statements);
        return json({ saved: statements.length });
      } catch (e) { return json({ error: e.message || 'Memory save failed.' }, 500); }
    }



    if (u.pathname === '/api/agent' && request.method === 'POST') {
      if (!env.AI) return json({ error: 'Workers AI binding AI is not configured.' }, 500);
      try {
        const b = await request.json();
        const message = typeof b.message === 'string' ? b.message.trim() : '';
        const history = Array.isArray(b.history) ? b.history.slice(-12) : [];
        const memory = typeof b.memory === 'string' ? b.memory.slice(0, 6000) : '';
        const character = b.character && typeof b.character === 'object' ? b.character : null;
        if (!message) return json({ error: 'Message is required.' }, 400);

        const tools = [
          { name: 'list_characters', description: 'List the user characters currently supplied by the app. Use when the user asks what characters are available.', parameters: { type: 'object', properties: {} } },
          { name: 'list_creations', description: 'List the user creations currently supplied by the app. Use when the user asks what creations they have.', parameters: { type: 'object', properties: {} } },
          { name: 'remember', description: 'Save a memory item. Use only when the user explicitly asks you to remember something.', parameters: { type: 'object', properties: { text: { type: 'string', description: 'The memory to save.' } }, required: ['text'] } }
        ];
        const supplied = {
          messages: [
            { role: 'system', content: `You are Create AI, an action-oriented creative assistant. Use tools only when useful. Never claim an action happened unless the tool result confirms it. Character: ${character ? JSON.stringify(character).slice(0,3000) : 'none'}\nMemory:\n${memory || 'none'}` },
            ...history.filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string').map(x => ({ role: x.role, content: x.content.slice(0,4000) })),
            { role: 'user', content: message }
          ],
          tools
        };
        const result = await env.AI.run('@cf/zai-org/glm-4.7-flash', supplied);
        const calls = Array.isArray(result.tool_calls) ? result.tool_calls : [];
        if (!calls.length) return json({ reply: result.response || 'I could not generate a response.', actions: [] });

        const actions = [];
        for (const call of calls.slice(0, 3)) {
          const args = call.arguments || {};
          if (call.name === 'list_characters') actions.push({ name: call.name, result: { characters: Array.isArray(b.characters) ? b.characters.slice(0,30) : [] } });
          else if (call.name === 'list_creations') actions.push({ name: call.name, result: { creations: Array.isArray(b.creations) ? b.creations.slice(0,30).map(x => ({ id:x.id, type:x.type, prompt:x.prompt, createdAt:x.createdAt })) : [] } });
          else if (call.name === 'remember') {
            const text = typeof args.text === 'string' ? args.text.trim().slice(0,1000) : '';
            if (text) actions.push({ name: call.name, result: { saved: true, text } });
          }
        }
        const follow = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
          messages: [
            { role: 'system', content: 'You are Create AI. Answer the user using the tool results below. Be concise and do not claim tools did anything beyond their returned results.' },
            { role: 'user', content: message },
            { role: 'assistant', content: JSON.stringify({ actions }) },
          ],
          max_tokens: 700
        });
        return json({ reply: follow.response || 'Action completed.', actions });
      } catch (e) { return json({ error: e.message || 'Agent request failed.' }, 500); }
    }

    if (u.pathname === '/api/chat-stream' && request.method === 'POST') {
      if (!env.AI) return json({error:'Workers AI binding AI is not configured.'},500);
      try {
        const b=await request.json();
        const m=typeof b.message==='string'?b.message.trim():'';
        const h=Array.isArray(b.history)?b.history.slice(-16):[];
        const mem=typeof b.memory==='string'?b.memory.slice(0,6000):'';
        const c=b.character&&typeof b.character==='object'?b.character:null;
        if(!m) return json({error:'Message is required.'},400);
        const system=`You are Create AI, a helpful creative assistant. Maintain the supplied character personality when present. Use supplied memory but never invent memories. Stream a natural response.\n\nMemory:\n${mem||'none'}\n\nCharacter:\n${c?JSON.stringify(c):'none'}`;
        const stream=await env.AI.run('@cf/zai-org/glm-4.7-flash',{messages:[{role:'system',content:system},...h.filter(x=>x&&(x.role==='user'||x.role==='assistant')&&typeof x.content==='string').map(x=>({role:x.role,content:x.content.slice(0,4000)})),{role:'user',content:m}],max_tokens:900,stream:true});
        return new Response(stream,{headers:{'content-type':'text/event-stream; charset=utf-8','cache-control':'no-cache','connection':'keep-alive',...cors()}});
      }catch(e){return json({error:e.message||'Streaming chat failed.'},500)}
    }

    if (u.pathname === '/api/chat' && request.method === 'POST') {
      if (!env.AI) return json({ error: 'Workers AI binding AI is not configured.' }, 500);
      try {
        const b = await request.json();
        const m = typeof b.message === 'string' ? b.message.trim() : '';
        const conversationId = typeof b.conversationId === 'string' ? b.conversationId.trim() : '';
        const character = b.character && typeof b.character === 'object' ? b.character : null;
        const h = Array.isArray(b.history) ? b.history.slice(-12) : [];
        const mem = typeof b.memory === 'string' ? b.memory.slice(0, 6000) : '';
        if (!m) return json({ error: 'Message is required.' }, 400);
        const r = await env.AI.run('@cf/zai-org/glm-4.7-flash', {
          messages: [
            { role: 'system', content: `You are Create AI, a helpful creative assistant. Maintain continuity, follow the supplied character profile when present, and never invent memories. Keep responses natural and useful.\nConversation ID: ${conversationId || 'local'}\nCharacter: ${character ? JSON.stringify(character).slice(0, 3000) : 'none'}\nMemory:\n${mem || 'none'}` },
            ...h.filter(x => x && (x.role === 'user' || x.role === 'assistant') && typeof x.content === 'string').map(x => ({ role: x.role, content: x.content.slice(0, 4000) })),
            { role: 'user', content: m }
          ], max_tokens: 900
        });
        return json({ reply: r.response || 'I could not generate a response.' });
      } catch (e) { return json({ error: e.message || 'Chat generation failed.' }, 500); }
    }

    if (u.pathname === '/api/generate-image' && request.method === 'POST') {
      if (!env.AI) return json({ error: 'Workers AI binding AI is not configured.' }, 500);
      try {
        const b = await request.json();
        const p = typeof b.prompt === 'string' ? b.prompt.trim() : '';
        if (!p) return json({ error: 'Prompt is required.' }, 400);
        const o = await env.AI.run('@cf/black-forest-labs/flux-1-schnell', { prompt: p, steps: 4 });
        const bin = atob(o.image);
        const bytes = Uint8Array.from(bin, x => x.charCodeAt(0));
        return new Response(bytes, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'no-store', ...cors() } });
      } catch (e) { return json({ error: e.message || 'Generation failed.' }, 500); }
    }

    return env.ASSETS ? env.ASSETS.fetch(request) : new Response('Create AI is running.', { headers: cors() });
  }
};
function cors() { return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'Content-Type' }; }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json', ...cors() } }); }
