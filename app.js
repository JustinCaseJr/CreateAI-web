const $=id=>document.getElementById(id);
const tabs=[...document.querySelectorAll('.tab')];
const panels={chat:$('chatPanel'),character:$('characterPanel'),image:$('imagePanel'),video:$('videoPanel'),library:$('libraryPanel')};
const status=$('status'),chatLog=$('chatLog'),chatInput=$('chatInput'),chatForm=$('chatForm');
const CHAR_KEY='create-ai-characters-v1',HIST_KEY='create-ai-chat-v2',MEM_KEY='create-ai-memory-v1',LIB_KEY='create-ai-library-v1',CONV_KEY='create-ai-conversation-v1';
let characters=JSON.parse(localStorage.getItem(CHAR_KEY)||'[]'),selectedCharacter=localStorage.getItem('create-ai-selected-character')||'',chatHistory=JSON.parse(localStorage.getItem(HIST_KEY)||'[]'),memory=JSON.parse(localStorage.getItem(MEM_KEY)||'[]'),library=JSON.parse(localStorage.getItem(LIB_KEY)||'[]'),conversationId=localStorage.getItem(CONV_KEY)||crypto.randomUUID();

async function persistConversation(){
  try {
    await fetch('/api/conversation',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({conversationId,messages:chatHistory})});
  } catch {}
}
async function restoreConversation(){
  try {
    const r=await fetch(`/api/conversation?conversationId=${encodeURIComponent(conversationId)}`);
    if(!r.ok)return; const d=await r.json();
    if(Array.isArray(d.messages)&&d.messages.length){ chatHistory=d.messages; save(); renderChat(); }
  } catch {}
}

function save(){localStorage.setItem(CHAR_KEY,JSON.stringify(characters));localStorage.setItem(HIST_KEY,JSON.stringify(chatHistory.slice(-30)));localStorage.setItem(MEM_KEY,JSON.stringify(memory.slice(-30)));localStorage.setItem(LIB_KEY,JSON.stringify(library.slice(-30)));localStorage.setItem('create-ai-selected-character',selectedCharacter);localStorage.setItem(CONV_KEY,conversationId)}
function showTab(n){tabs.forEach(t=>t.classList.toggle('active',t.dataset.tab===n));Object.entries(panels).forEach(([k,p])=>p.hidden=k!==n);if(n==='library')renderLibrary()}
tabs.forEach(t=>t.onclick=()=>showTab(t.dataset.tab));
function selected(){return characters.find(c=>c.id===selectedCharacter)||null}
function renderCharacterStatus(){const c=selected();$('activeCharacter').textContent=c?`Character: ${c.name} — ${c.personality}`:'No character selected'}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]))}
function renderCharacters(){const list=$('characterList');list.innerHTML='';characters.forEach(c=>{const card=document.createElement('div');card.className='character-card';card.innerHTML=`<h3>${escapeHtml(c.name)}</h3><p>${escapeHtml(c.personality)}</p><p>${escapeHtml(c.description||'')}</p>`;const use=document.createElement('button');use.className='secondary';use.type='button';use.textContent=selectedCharacter===c.id?'Selected':'Use character';use.onclick=()=>{selectedCharacter=c.id;save();renderCharacters();renderCharacterStatus();showTab('chat')};const del=document.createElement('button');del.className='secondary';del.type='button';del.textContent='Delete';del.onclick=()=>{characters=characters.filter(x=>x.id!==c.id);if(selectedCharacter===c.id)selectedCharacter='';save();renderCharacters();renderCharacterStatus()};card.append(use,del);list.appendChild(card)})}
function addMessage(role,text){const e=document.createElement('div');e.className=`message ${role}`;e.textContent=text;chatLog.appendChild(e);chatLog.scrollTop=chatLog.scrollHeight}
function renderChat(){chatLog.innerHTML='';if(!chatHistory.length){addMessage('assistant','Hi! Choose a character or tell me what you want to create.');return}chatHistory.slice(-20).forEach(x=>addMessage(x.role,x.content))}
function renderLibrary(){const list=$('libraryList');if(!list)return;list.innerHTML='';if(!library.length){list.innerHTML='<p class="library-empty">No creations saved yet. Generate an image and it will appear here.</p>';return}library.forEach(item=>{const card=document.createElement('article');card.className='creation-card';card.innerHTML=`<img src="${item.url}" alt="${escapeHtml(item.prompt)}"><div class="creation-info"><strong>${escapeHtml(item.prompt)}</strong><small>${new Date(item.createdAt).toLocaleString()}</small><div class="action-row"><a class="secondary link-button" href="${item.url}" download="${escapeHtml(item.filename)}">Download</a><button class="secondary delete-creation" type="button">Delete</button></div></div>`;card.querySelector('.delete-creation').onclick=()=>{library=library.filter(x=>x.id!==item.id);save();renderLibrary()};list.appendChild(card)})}
$('characterForm').onsubmit=e=>{e.preventDefault();const name=$('characterName').value.trim(),personality=$('characterPersonality').value.trim();if(!name||!personality)return;const c={id:crypto.randomUUID(),name,personality,description:$('characterDescription').value.trim()};characters.push(c);selectedCharacter=c.id;save();e.target.reset();renderCharacters();renderCharacterStatus();showTab('chat')};
$('cancelCharacter').onclick=()=>$('characterForm').reset();
$('newChat').onclick=()=>{chatHistory=[];conversationId=crypto.randomUUID();save();renderChat();status.textContent='New conversation ready'};
$('memoryButton').onclick=()=>addMessage('assistant',memory.length?`Saved memory:\n${memory.join('\n')}`:'No saved memory yet.');

async function runAgent(message){
  const c=selected();
  const r=await fetch('/api/agent',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({
    message,
    history:chatHistory.slice(-12),
    memory:memory.join('\n'),
    character:c?{name:c.name,personality:c.personality,description:c.description||''}:null,
    characters,
    creations:library
  })});
  const d=await r.json().catch(()=>({}));
  if(!r.ok)throw Error(d.error||`Agent request failed (${r.status})`);
  return d;
}

async function streamChat(message,c){
  const contextual=message;
  const r=await fetch('/api/chat-stream',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({message:contextual,history:chatHistory.slice(-16),memory:memory.join('\n'),conversationId,character:c?{name:c.name,personality:c.personality,description:c.description||''}:null})});
  if(!r.ok) throw Error((await r.json().catch(()=>({}))).error||`Streaming request failed (${r.status})`);
  const el=document.createElement('div'); el.className='message assistant'; chatLog.appendChild(el); chatLog.scrollTop=chatLog.scrollHeight;
  const reader=r.body.getReader(), decoder=new TextDecoder(); let buffer='',full='';
  while(true){const {value,done}=await reader.read(); if(done) break; buffer+=decoder.decode(value,{stream:true}); const lines=buffer.split(/\r?\n/); buffer=lines.pop()||'';
    for(const line of lines){if(!line.startsWith('data:')) continue; const payload=line.slice(5).trim(); if(!payload||payload==='[DONE]') continue; try{const d=JSON.parse(payload); const chunk=d.response??d.response?.text??d.text??d.content??''; if(chunk){full+=chunk; el.textContent=full; chatLog.scrollTop=chatLog.scrollHeight;}}catch{}}
  }
  if(!full) throw Error('The stream ended without a response.');
  return full;
}
chatForm.onsubmit=async e=>{e.preventDefault();const message=chatInput.value.trim();if(!message)return;const c=selected();if(message.startsWith('/agent ')){addMessage('user',message);chatHistory.push({role:'user',content:message});chatInput.value='';chatInput.disabled=true;status.textContent='Running tools…';try{const d=await runAgent(message.slice(7));addMessage('assistant',d.reply);chatHistory.push({role:'assistant',content:d.reply});for(const a of (d.actions||[])){if(a.name==='remember'&&a.result?.saved&&!memory.includes(a.result.text))memory.push(a.result.text)}save();status.textContent='Ready'}catch(err){addMessage('assistant',`Agent error: ${err.message}`);status.textContent='Error'}finally{chatInput.disabled=false;chatInput.focus()}return;}addMessage('user',message);chatHistory.push({role:'user',content:message});chatInput.value='';chatInput.disabled=true;status.textContent='Streaming…';try{const reply=await streamChat(message,c);chatHistory.push({role:'assistant',content:reply});save();status.textContent='Ready'}catch(err){addMessage('assistant',`I couldn't reach the AI yet: ${err.message}`);status.textContent='Error'}finally{chatInput.disabled=false;chatInput.focus()}};
$('generate').onclick=async()=>{const p=$('prompt').value.trim();if(!p)return;$('generate').disabled=true;status.textContent='Generating…';try{const style=$('style').value,ratio=$('ratio').value,quality=$('quality').value,negative=$('negativePrompt').value.trim();let final=p;if(style)final+=`, ${style}`;final+=`, composition ${ratio}, ${quality} quality`;if(negative)final+=`, avoid: ${negative}`;const r=await fetch('/api/generate-image',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({prompt:final,size:Number($('size').value)})});if(!r.ok)throw Error(await r.text()||`Request failed (${r.status})`);const blob=await r.blob();const url=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(blob)});$('generated').src=url;$('download').href=url;$('result').hidden=false;$('message').textContent='Image generated and saved to My Creations.';library.unshift({id:crypto.randomUUID(),type:'image',url,prompt:p,style,ratio,quality,negativePrompt:negative,size:Number($('size').value),createdAt:new Date().toISOString(),filename:`create-ai-${Date.now()}.jpg`});save();status.textContent='Ready'}catch(e){$('message').textContent=`Generation failed: ${e.message}`;status.textContent='Error'}finally{$('generate').disabled=false}};

const DEVICE_ID_KEY='create-ai-device-id-v1';
let deviceId=localStorage.getItem(DEVICE_ID_KEY);
if(!deviceId){deviceId=crypto.randomUUID();localStorage.setItem(DEVICE_ID_KEY,deviceId)}
async function syncCloudMemory(){
  const button=$('syncMemory'); if(!button)return;
  button.disabled=true; status.textContent='Syncing memory…';
  try{
    const get=await fetch(`/api/memory?userId=${encodeURIComponent(deviceId)}`);
    if(get.ok){const data=await get.json();if(data.enabled&&Array.isArray(data.memory)){const merged=[...data.memory.map(x=>x.memory_text).filter(Boolean),...memory];memory=[...new Set(merged)].slice(-100);save();}}
    const post=await fetch('/api/memory',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({userId:deviceId,memory:memory.map((text,i)=>({memory_key:`memory-${i}`,memory_text:text}))})});
    if(post.status===503){status.textContent='Cloud memory not configured';addMessage('assistant','Cloud memory is not configured on the server yet. Your local memory is still safe on this device.');return}
    if(!post.ok)throw Error((await post.text())||`Request failed (${post.status})`);
    status.textContent='Cloud memory synced'; addMessage('assistant','Your saved memory has been synced with the configured cloud database.');
  }catch(e){status.textContent='Sync error';addMessage('assistant',`Cloud memory sync failed: ${e.message}`)}finally{button.disabled=false}
}
$('syncMemory')?.addEventListener('click',syncCloudMemory);


$("generateVideo").onclick=async()=>{const prompt=$("videoPrompt").value.trim();if(!prompt)return;const btn=$("generateVideo");btn.disabled=true;$("videoMessage").textContent="Generating video…";try{const r=await fetch("/api/generate-video",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({prompt,duration:Number($("videoDuration").value),ratio:$("videoRatio").value})});if(!r.ok){const d=await r.json().catch(()=>({}));throw Error(d.error||`Request failed (${r.status})`)}const blob=await r.blob();const url=URL.createObjectURL(blob);$("generatedVideo").src=url;$("generatedVideo").hidden=false;$("downloadVideo").href=url;$("downloadVideo").hidden=false;$("videoMessage").textContent="Video generated."}catch(e){$("videoMessage").textContent=`Video generation failed: ${e.message}`}finally{btn.disabled=false}};
renderCharacters();renderCharacterStatus();renderChat();renderLibrary();
$('agentHelp')?.addEventListener('click',()=>addMessage('assistant','Agent mode: start a message with /agent. Examples: “/agent what characters do I have?”, “/agent show my recent creations”, or “/agent remember that I prefer cinematic lighting.”'));

restoreConversation();

// Durable Agent WebSocket bridge. Existing HTTP chat remains available as a fallback.
let durableAgentSocket = null;
function connectDurableAgent() {
  try {
    const scheme = location.protocol === 'https:' ? 'wss:' : 'ws:';
    durableAgentSocket = new WebSocket(`${scheme}//${location.host}/api/agent/ws?id=${encodeURIComponent(conversationId)}`);
    durableAgentSocket.onopen = () => { if (typeof status !== 'undefined') status.textContent = 'Agent connected'; };
    durableAgentSocket.onmessage = event => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'state' && data.state?.messages) {
          localStorage.setItem(HIST_KEY, JSON.stringify(data.state.messages));
        }
      } catch {}
    };
    durableAgentSocket.onclose = () => setTimeout(connectDurableAgent, 2500);
  } catch {}
}
if (location.protocol === 'http:' || location.protocol === 'https:') connectDurableAgent();
