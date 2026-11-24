const storageKey = 'luma-conversations-v1';
const $ = id => document.getElementById(id);
const prompt = $('prompt');
const messagesEl = $('messages');
const welcome = $('welcome');
const sendButton = $('send');
const modelSelect = $('model-select');
let conversations = [];
let currentId = null;
let requestController = null;
let engine = null;
let advancedEngine = null;
let ai5Engine = null;
let ai5Unlocked = false;
const contextLength = 192;

try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) conversations = saved.filter(chat => chat && typeof chat.id === 'string' && Array.isArray(chat.messages));
} catch (error) {
  console.error('Could not load saved conversations:', error);
}

function save() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(conversations));
  } catch (error) {
    console.error('Could not save conversations:', error);
    showNotice('Could not save conversations in this browser.');
  }
}

function currentChat() {
  return conversations.find(chat => chat.id === currentId);
}

function createChat() {
  currentId = null;
  prompt.value = '';
  resizePrompt();
  render();
  closeSidebar();
  prompt.focus();
}

function showNotice(text) {
  $('connection-status').textContent = text;
  document.querySelector('.status-dot').classList.add('offline');
}

function renderHistory() {
  const history = $('history');
  history.replaceChildren();
  $('chat-count').textContent = conversations.length;
  if (!conversations.length) {
    const empty = document.createElement('div');
    empty.className = 'history-empty';
    empty.textContent = 'Your conversations will appear here.';
    history.append(empty);
    return;
  }
  for (const chat of conversations) {
    const item = document.createElement('div');
    item.className = 'history-item' + (chat.id === currentId ? ' active' : '');
    const select = document.createElement('button');
    select.className = 'history-select';
    select.textContent = chat.title;
    select.title = chat.title;
    select.onclick = () => {
      if (requestController) return;
      currentId = chat.id;
      render();
      closeSidebar();
    };
    const remove = document.createElement('button');
    remove.className = 'history-delete';
    remove.setAttribute('aria-label', `Delete ${chat.title}`);
    remove.innerHTML = '<svg><use href="#trash"></use></svg>';
    remove.onclick = () => {
      if (requestController) return;
      if (!confirm('Delete this conversation?')) return;
      conversations = conversations.filter(item => item.id !== chat.id);
      if (currentId === chat.id) currentId = null;
      save();
      render();
    };
    item.append(select, remove);
    history.append(item);
  }
}

function renderText(container, text) {
  container.replaceChildren();
  const blocks = text.split(/```/);
  blocks.forEach((block, index) => {
    if (index % 2) {
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = block.replace(/^[^\n]*\n/, '').replace(/\n$/, '');
      pre.append(code);
      container.append(pre);
    } else {
      const parts = block.split(/(`[^`\n]+`|\*\*[^*\n]+\*\*)/g);
      for (const part of parts) {
        if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
          const code = document.createElement('code');
          code.textContent = part.slice(1, -1);
          container.append(code);
        } else if (part.startsWith('**') && part.endsWith('**') && part.length > 4) {
          const strong = document.createElement('strong');
          strong.textContent = part.slice(2, -2);
          container.append(strong);
        } else container.append(document.createTextNode(part));
      }
    }
  });
}

function renderMessages() {
  const chat = currentChat();
  const hasMessages = chat && chat.messages.length;
  welcome.hidden = Boolean(hasMessages);
  messagesEl.classList.toggle('visible', Boolean(hasMessages));
  messagesEl.replaceChildren();
  if (!hasMessages) return;
  chat.messages.forEach((message, index) => {
    const row = document.createElement('div');
    row.className = 'message';
    const avatar = document.createElement('div');
    avatar.className = message.role === 'user' ? 'user-avatar' : 'message-avatar';
    if (message.role === 'user') avatar.textContent = 'Y';
    else avatar.innerHTML = '<svg><use href="#spark"></use></svg>';
    const content = document.createElement('div');
    content.className = 'message-content';
    const header = document.createElement('div');
    header.className = 'message-header';
    header.textContent = message.role === 'user' ? 'You' : ({ ai4: 'AI 4', ai5: 'AI 5' }[message.model] || 'AI 3');
    const text = document.createElement('div');
    text.className = 'message-text' + (message.error ? ' error-text' : '');
    if (message.pending && !message.content) text.innerHTML = '<span class="typing"><i></i><i></i><i></i></span>';
    else renderText(text, message.content);
    content.append(header, text);
    if (message.role === 'assistant' && message.content && !message.pending && !message.error) {
      const tools = document.createElement('div');
      tools.className = 'message-tools';
      const copy = document.createElement('button');
      copy.className = 'text-button';
      copy.innerHTML = '<svg><use href="#copy"></use></svg>Copy';
      copy.onclick = async () => {
        try {
          await navigator.clipboard.writeText(message.content);
          copy.textContent = 'Copied!';
          setTimeout(() => { copy.innerHTML = '<svg><use href="#copy"></use></svg>Copy'; }, 1800);
        } catch {
          copy.textContent = 'Copy failed';
        }
      };
      tools.append(copy);
      content.append(tools);
    }
    if (message.error && index === chat.messages.length - 1) {
      const retry = document.createElement('button');
      retry.className = 'text-button';
      retry.textContent = '↻ Try again';
      retry.onclick = () => {
        if (message.model === 'ai5' && !ai5Unlocked) {
          showNotice('Unlock AI 5 before retrying this response.');
          return;
        }
        chat.messages.pop();
        sendRequest(chat, message.model || 'ai3');
      };
      content.append(retry);
    }
    row.append(avatar, content);
    messagesEl.append(row);
  });
}

function render() {
  renderHistory();
  renderMessages();
}

function resizePrompt() {
  prompt.style.height = 'auto';
  prompt.style.height = Math.min(prompt.scrollHeight, 160) + 'px';
}

function scrollBottom() {
  $('chat-scroll').scrollTop = $('chat-scroll').scrollHeight;
}

async function sendRequest(chat, mode = modelSelect.value) {
  if (requestController) return;
  if (mode === 'ai5' && !ai5Unlocked) {
    showNotice('Unlock AI 5 before retrying this response.');
    return;
  }
  const outgoing = chat.messages.filter(message => !message.error && !message.pending).map(({ role, content }) => ({ role, content }));
  const answer = { role: 'assistant', content: '', pending: true, model: mode };
  chat.messages.push(answer);
  const request = { cancelled: false };
  requestController = request;
  modelSelect.disabled = true;
  sendButton.classList.add('stop');
  sendButton.textContent = '■';
  sendButton.setAttribute('aria-label', 'Stop generating');
  render();
  scrollBottom();
  try {
    if (mode === 'ai5') {
      if (advancedEngine) {
        await advancedEngine.generator.model.dispose();
        advancedEngine = null;
      }
      if (!ai5Engine) {
        if (!navigator.gpu) throw new Error('AI 5 needs a browser with WebGPU enabled. Try a current version of Chrome or Edge.');
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error('No compatible WebGPU adapter is available.');
        const dtype = adapter.features.has('shader-f16') ? 'q4f16' : 'q4f32';
        $('connection-status').textContent = 'Loading AI 5; first use downloads over 1 GB…';
        const { CreateMLCEngine } = await import('https://cdn.jsdelivr.net/npm/@mlc-ai/web-llm@0.2.79/lib/index.js');
        ai5Engine = await CreateMLCEngine(`Qwen2.5-1.5B-Instruct-${dtype}_1-MLC`, {
          initProgressCallback: progress => {
            $('connection-status').textContent = `Loading AI 5: ${Math.round(progress.progress * 100)}%`;
          },
        });
      }
      if (request.cancelled) throw new Error('Response stopped.');
      $('connection-status').textContent = 'AI 5 generating on your device';
      document.querySelector('.status-dot').classList.remove('offline');
      request.stop = () => ai5Engine.interruptGenerate();
      const recent = outgoing.slice(-4).map(message => ({ ...message, content: message.content.slice(-1500) }));
      const chunks = await ai5Engine.chat.completions.create({ messages: recent, max_tokens: 256, temperature: 0, stream: true });
      for await (const chunk of chunks) {
        answer.content += chunk.choices[0]?.delta?.content || '';
        renderMessages();
        scrollBottom();
      }
    } else if (mode === 'ai4') {
      const modelName = mode === 'ai5' ? 'AI 5' : 'AI 4';
      if (ai5Engine) {
        await ai5Engine.unload();
        ai5Engine = null;
      }
      if (!advancedEngine) {
        if (!navigator.gpu) throw new Error(`${modelName} needs a browser with WebGPU enabled. Try a current version of Chrome or Edge, or choose AI 3.`);
        const dtype = 'q4';
        $('connection-status').textContent = `Loading ${modelName} (about 388 MB)…`;
        const { pipeline, TextStreamer, InterruptableStoppingCriteria } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
        const generator = await pipeline('text-generation', 'HuggingFaceTB/SmolLM2-360M-Instruct', {
          device: 'webgpu',
          dtype,
          progress_callback: progress => {
            if (progress.status === 'progress' && progress.file && progress.file.endsWith(`model_${dtype}.onnx`) && Number.isFinite(progress.progress)) {
              $('connection-status').textContent = `Downloading ${modelName}: ${Math.round(progress.progress)}%`;
            }
          },
        });
        advancedEngine = { mode, generator, TextStreamer, InterruptableStoppingCriteria };
      }
      if (request.cancelled) throw new Error('Response stopped.');
      $('connection-status').textContent = `${modelName} generating on your device`;
      document.querySelector('.status-dot').classList.remove('offline');
      const stopping = new advancedEngine.InterruptableStoppingCriteria();
      request.stop = () => stopping.interrupt();
      const streamer = new advancedEngine.TextStreamer(advancedEngine.generator.tokenizer, {
        skip_prompt: true,
        callback_function: text => {
          answer.content += text;
          renderMessages();
          scrollBottom();
        },
      });
      const recent = outgoing.slice(-8).map(message => ({ ...message, content: message.content.slice(-4000) }));
      await advancedEngine.generator(recent, {
        max_new_tokens: 256,
        do_sample: false,
        streamer,
        stopping_criteria: stopping,
      });
    } else {
    if (!engine) {
      $('connection-status').textContent = 'Loading your model…';
      const response = await fetch('./model.onnx');
      if (!response.ok) throw new Error('Your model has not been exported yet. Train it and run export_model.py first.');
      const ort = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/ort.wasm.min.mjs');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.21.0/dist/';
      const session = await ort.InferenceSession.create(await response.arrayBuffer(), { executionProviders: ['wasm'] });
      engine = { ort, session };
      $('connection-status').textContent = 'AI ready on your device';
      $('connection-status').title = 'Your exported model runs in this browser.';
      document.querySelector('.status-dot').classList.remove('offline');
    }
    if (request.cancelled) throw new Error('Response stopped.');
    const text = outgoing.map(message => `${message.role === 'user' ? 'User' : 'Assistant'}: ${message.content}\n`).join('') + 'Assistant: ';
    const tokens = Array.from(new TextEncoder().encode(text)).slice(-contextLength);
    const decoder = new TextDecoder();
    for (let i = 0; i < 160; i++) {
      if (request.cancelled) break;
      const input = BigInt64Array.from(tokens.slice(-contextLength), value => BigInt(value));
      const result = await engine.session.run({ input_ids: new engine.ort.Tensor('int64', input, [1, input.length]) });
      const logits = result.logits.data;
      const offset = logits.length - 256;
      const candidates = Array.from({ length: 256 }, (_, id) => ({ id, logit: logits[offset + id] }))
        .sort((a, b) => b.logit - a.logit).slice(0, 30);
      const max = candidates[0].logit;
      const weights = candidates.map(item => Math.exp((item.logit - max) / 0.4));
      let choice = Math.random() * weights.reduce((sum, weight) => sum + weight, 0);
      let selected = candidates[candidates.length - 1].id;
      for (let j = 0; j < candidates.length; j++) {
        choice -= weights[j];
        if (choice <= 0) { selected = candidates[j].id; break; }
      }
      tokens.push(selected);
      answer.content += decoder.decode(new Uint8Array([selected]), { stream: true });
      if (answer.content.includes('\n\n') || answer.content.includes('\nUser:')) {
        answer.content = answer.content.split(/\n\n|\nUser:/)[0];
        break;
      }
      renderMessages();
      scrollBottom();
    }
    }
    if (request.cancelled && !answer.content) throw new Error('Response stopped.');
    if (!answer.content.trim()) throw new Error('The AI returned an empty response. Please try again.');
  } catch (error) {
    console.error('Model request failed:', error);
    answer.content = error instanceof Error ? error.message : String(error || 'Something went wrong. Please try again.');
    answer.error = true;
    if (!request.cancelled) showNotice(`${{ ai3: 'AI 3', ai4: 'AI 4', ai5: 'AI 5' }[mode]} unavailable`);
  } finally {
    answer.pending = false;
    requestController = null;
    modelSelect.disabled = false;
    if (!answer.error || request.cancelled) updateModelStatus();
    sendButton.classList.remove('stop');
    sendButton.innerHTML = '<svg><use href="#arrow"></use></svg>';
    sendButton.setAttribute('aria-label', 'Send message');
    save();
    render();
    scrollBottom();
    prompt.focus();
  }
}

function submit() {
  if (requestController) {
    requestController.cancelled = true;
    if (requestController.stop) requestController.stop();
    $('connection-status').textContent = 'Stopping; a model download may need to finish first…';
    return;
  }
  const text = prompt.value.trim();
  if (!text) return;
  let chat = currentChat();
  if (!chat) {
    chat = { id: crypto.randomUUID(), title: text.slice(0, 42) + (text.length > 42 ? '…' : ''), messages: [] };
    conversations.unshift(chat);
    currentId = chat.id;
  }
  if (chat.messages.at(-1)?.error) chat.messages.pop();
  chat.messages.push({ role: 'user', content: text });
  prompt.value = '';
  resizePrompt();
  save();
  sendRequest(chat);
}

function closeSidebar() {
  $('sidebar').classList.remove('open');
  $('sidebar-overlay').classList.remove('open');
}

$('new-chat').onclick = () => { if (!requestController) createChat(); };
$('open-sidebar').onclick = () => { $('sidebar').classList.add('open'); $('sidebar-overlay').classList.add('open'); };
$('close-sidebar').onclick = closeSidebar;
$('sidebar-overlay').onclick = closeSidebar;
sendButton.onclick = submit;
prompt.addEventListener('input', resizePrompt);
prompt.addEventListener('keydown', event => {
  if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!requestController) submit();
  }
});
document.querySelectorAll('.suggestion').forEach(button => {
  button.onclick = () => { prompt.value = button.dataset.prompt; submit(); };
});

function updateModelStatus() {
  const mode = modelSelect.value;
  const names = { ai3: 'AI 3', ai4: 'AI 4', ai5: 'AI 5' };
  const notices = {
    ai3: 'AI 3 is our tiny model trained from scratch. It is experimental and often makes mistakes.',
    ai4: 'AI 4 uses a pretrained model by Hugging Face, not our scratch-trained model. First use downloads about 388 MB and needs WebGPU. It can still make mistakes.',
    ai5: 'AI 5 requires WebGPU and downloads over 1 GB on first use. A powerful device and sufficient memory are needed. It can still make mistakes.',
  };
  $('model-notice').textContent = notices[mode];
  $('model-credit').hidden = mode !== 'ai5';
  const loaded = mode === 'ai3' ? Boolean(engine) : mode === 'ai4' ? Boolean(advancedEngine) : Boolean(ai5Engine);
  $('connection-status').textContent = loaded ? `${names[mode]} ready on your device` : `${names[mode]} ${mode === 'ai3' ? 'loads' : 'downloads'} on first use`;
  document.querySelector('.status-dot').classList.remove('offline');
}
modelSelect.addEventListener('change', updateModelStatus);

$('unlock-form').addEventListener('submit', event => {
  event.preventDefault();
  if (requestController) {
    $('unlock-status').textContent = 'Wait for the current response to finish.';
    return;
  }
  const code = $('unlock-code');
  if (code.value !== 'jet644') {
    code.value = '';
    $('unlock-status').textContent = 'Incorrect code. Try again.';
    return;
  }
  code.value = '';
  if (!ai5Unlocked) {
    const option = document.createElement('option');
    option.value = 'ai5';
    option.textContent = 'AI 5';
    modelSelect.append(option);
    ai5Unlocked = true;
  }
  modelSelect.value = 'ai5';
  $('unlock-status').textContent = 'AI 5 unlocked for this page session.';
  updateModelStatus();
});

let brandTaps = 0;
const secretDialog = $('secret-dialog');
let zombieDoor = 0;
function resetZombieGame() {
  zombieDoor = Math.floor(Math.random() * 9);
  $('zombie-status').textContent = 'Choose a door to start.';
  $('zombie-grid').replaceChildren();
  for (let i = 0; i < 9; i++) {
    const door = document.createElement('button');
    door.className = 'zombie-door';
    door.textContent = '?';
    door.setAttribute('aria-label', `Open door ${i + 1}`);
    door.onclick = () => {
      door.disabled = true;
      if (i === zombieDoor) {
        door.textContent = '🧟';
        door.setAttribute('aria-label', `Door ${i + 1}: friendly zombie found`);
        $('zombie-status').textContent = 'You found the friendly zombie!';
        $('zombie-grid').querySelectorAll('button').forEach(button => { button.disabled = true; });
      } else {
        door.textContent = '·';
        door.setAttribute('aria-label', `Door ${i + 1}: empty`);
        $('zombie-status').textContent = 'Not here. Try another door!';
      }
    };
    $('zombie-grid').append(door);
  }
}
$('brand-mark').addEventListener('click', () => {
  if (++brandTaps === 7) {
    brandTaps = 0;
    resetZombieGame();
    secretDialog.showModal();
  }
});
$('close-secret').addEventListener('click', () => secretDialog.close());
$('zombie-again').addEventListener('click', resetZombieGame);

fetch('./model.onnx', { method: 'HEAD' }).then(response => {
  if (!response.ok) throw new Error('Model not available');
  if (!requestController && modelSelect.value === 'ai3') updateModelStatus();
}).catch(() => {
  if (!requestController && modelSelect.value === 'ai3') showNotice('AI 3 model unavailable');
  $('connection-status').title = 'Train and export your model before chatting.';
});
render();
