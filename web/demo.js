// Helper: Get element by ID
const el = (id) => document.getElementById(id);

// State management for local demo environment
const state = {
  demoMode: true,
  questions: [],
  activeQuestionIndex: 0,
  drafts: {},
  runWs: null
};

// Event logging helper
const logEvent = (value) => {
  console.log('[Demo Log]:', value);
  const term = el('terminalOutput');
  if (term) {
    term.textContent += (term.textContent ? '\n' : '') + (typeof value === 'string' ? value : JSON.stringify(value));
    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
  }
};

// Save current tab state to memory drafts
const saveCurrentTabState = () => {
  const activeQ = state.questions[state.activeQuestionIndex];
  if (activeQ) {
    state.drafts[activeQ.id] = {
      code: el('codeEditor').value,
      language: el('languageSelect').value,
      terminal: el('terminalOutput').textContent,
      terminalColor: el('terminalOutput').style.color,
    };
  }
};

// Load tab state into UI
const loadTabState = (index) => {
  state.activeQuestionIndex = index;
  const q = state.questions[index];
  if (!q) return;

  el('questionLabel').textContent = `Question ${q.number || (index + 1)}`;
  el('questionTitle').textContent = q.title || `Program ${index + 1}`;
  el('questionPrompt').textContent = q.prompt || 'Your question prompt will appear here.';

  const attachDiv = el('studentAttachments');
  if (attachDiv) {
    if (q.localFiles && q.localFiles.length > 0) {
      attachDiv.innerHTML = q.localFiles.map(file => {
        const lower = file.filename.toLowerCase();
        const isImage = lower.endsWith('.png') || lower.endsWith('.jpg') || lower.endsWith('.jpeg') || lower.endsWith('.gif') || lower.endsWith('.webp');
        if (isImage) {
          return `
            <div style="display: flex; flex-direction: column; gap: 6px; width: 100%; margin-bottom: 8px;">
              <img class="student-attachment-image" src="${file.dataUrl}" alt="${file.filename}" style="max-width: 100%; max-height: 350px; border-radius: 8px; border: 1.5px solid #e4e4e7; object-fit: contain; background: #f8fafc; cursor: zoom-in;" />
            </div>
          `;
        }
        return `<a href="${file.dataUrl}" download="${file.filename}" style="font-size: 0.85rem; background: #e0f2fe; color: #0369a1; padding: 4px 10px; border-radius: 8px; text-decoration: none; font-weight: 600; display: inline-flex; align-items: center; gap: 4px;">📎 ${file.filename}</a>`;
      }).join('');

      attachDiv.querySelectorAll('.student-attachment-image').forEach(img => {
        img.addEventListener('click', () => openImageLightbox(img.src));
      });
    } else {
      attachDiv.innerHTML = '';
    }
  }

  const draft = state.drafts[q.id] || {
    code: '',
    language: q.language || 'python',
    terminal: 'Terminal ready. Write code and click Run Code.',
    terminalColor: '#10b981',
  };

  el('codeEditor').value = draft.code;
  el('languageSelect').value = draft.language;
  el('terminalOutput').textContent = draft.terminal;
  el('terminalOutput').style.color = draft.terminalColor;

  document.querySelectorAll('.tab-btn').forEach((btn, idx) => {
    btn.classList.toggle('active', idx === index);
  });

  el('demoQTitle').value = q.title || '';
  el('demoQPrompt').value = q.prompt || '';
  el('demoQFiles').value = '';
};

// Render program tab bar
const renderTabs = () => {
  const tabsContainer = el('studentTabs');
  if (!tabsContainer) return;
  tabsContainer.innerHTML = '';

  state.questions.forEach((q, idx) => {
    const btn = document.createElement('button');
    btn.className = 'tab-btn';
    btn.style.position = 'relative';
    btn.style.display = 'inline-flex';
    btn.style.alignItems = 'center';
    btn.style.gap = '8px';
    if (idx === state.activeQuestionIndex) btn.classList.add('active');

    const label = document.createElement('span');
    label.textContent = q.title || `Program ${idx + 1}`;
    btn.appendChild(label);

    const closeBtn = document.createElement('span');
    closeBtn.textContent = '✕';
    closeBtn.style.cursor = 'pointer';
    closeBtn.style.fontSize = '0.75rem';
    closeBtn.style.opacity = '0.6';
    closeBtn.style.padding = '2px 4px';
    closeBtn.style.borderRadius = '4px';
    closeBtn.style.transition = 'all 0.2s';
    closeBtn.addEventListener('mouseenter', () => {
      closeBtn.style.opacity = '1';
      closeBtn.style.background = 'rgba(239, 68, 68, 0.2)';
      closeBtn.style.color = '#ef4444';
    });
    closeBtn.addEventListener('mouseleave', () => {
      closeBtn.style.opacity = '0.6';
      closeBtn.style.background = 'transparent';
      closeBtn.style.color = 'inherit';
    });
    closeBtn.addEventListener('click', (e) => {
      e.stopPropagation();

      if (!confirm(`Are you sure you want to close ${q.title || `Program ${idx + 1}`}? All draft code for this program will be lost.`)) {
        return;
      }

      state.questions.splice(idx, 1);
      delete state.drafts[q.id];

      if (state.activeQuestionIndex === idx) {
        state.activeQuestionIndex = Math.max(0, idx - 1);
      } else if (state.activeQuestionIndex > idx) {
        state.activeQuestionIndex--;
      }

      if (state.questions.length > 0) {
        loadTabState(state.activeQuestionIndex);
      } else {
        el('activeQuestionCard').classList.add('hidden');
        el('editorArea').classList.add('hidden');
      }
      renderTabs();
    });
    btn.appendChild(closeBtn);

    btn.addEventListener('click', (e) => {
      if (e.target.textContent === '✕') return;
      saveCurrentTabState();
      loadTabState(idx);
      renderTabs();
    });
    tabsContainer.appendChild(btn);
  });

  // Add '+' button if tabs count < 10
  if (state.questions.length < 10) {
    const addBtn = document.createElement('button');
    addBtn.className = 'tab-btn-add';
    addBtn.textContent = '+';
    addBtn.type = 'button';
    addBtn.style.padding = '4px 14px';
    addBtn.style.background = '#10b981';
    addBtn.style.border = 'none';
    addBtn.style.borderRadius = '8px';
    addBtn.style.color = '#ffffff';
    addBtn.style.fontWeight = 'bold';
    addBtn.style.cursor = 'pointer';
    addBtn.style.fontSize = '1.1rem';
    addBtn.style.marginLeft = '8px';
    addBtn.style.transition = 'all 0.2s';
    addBtn.addEventListener('click', () => {
      const nextQuestionNumber = state.questions.length + 1;
      const newQ = {
        id: `demo-q-${Date.now()}`,
        number: nextQuestionNumber,
        title: `Program ${nextQuestionNumber}`,
        prompt: `Write your instructions here...`,
        localFiles: []
      };
      saveCurrentTabState();
      state.questions.push(newQ);
      state.drafts[newQ.id] = {
        code: '',
        language: 'python',
        terminal: 'Terminal ready. Write code and click Run Code.',
        terminalColor: '#10b981',
      };
      state.activeQuestionIndex = state.questions.length - 1;
      loadTabState(state.activeQuestionIndex);
      el('activeQuestionCard').classList.remove('hidden');
      el('editorArea').classList.remove('hidden');
      renderTabs();
    });
    tabsContainer.appendChild(addBtn);
  }
};

// Lightbox image viewer controllers
const openImageLightbox = (src) => {
  el('lightboxImage').src = src;
  el('lightboxDownloadBtn').href = src;
  el('imageLightboxModal').classList.remove('hidden');
};

el('closeLightboxBtn').addEventListener('click', () => {
  el('imageLightboxModal').classList.add('hidden');
  el('lightboxImage').src = '';
});

// Configure keyboard shortcut intercept for codeEditor
const codeEditor = el('codeEditor');
if (codeEditor) {
  codeEditor.addEventListener('keydown', (e) => {
    const start = codeEditor.selectionStart;
    const end = codeEditor.selectionEnd;
    const value = codeEditor.value;

    if (e.key === 'Tab') {
      e.preventDefault();
      codeEditor.value = value.substring(0, start) + '    ' + value.substring(end);
      codeEditor.selectionStart = codeEditor.selectionEnd = start + 4;
    }

    if (e.key === 'Enter') {
      const lines = value.substring(0, start).split('\n');
      const currentLine = lines[lines.length - 1];
      const match = currentLine.match(/^(\s+)/);
      if (match) {
        e.preventDefault();
        const indent = match[1];
        const beforeCursor = value.substring(0, start);
        const afterCursor = value.substring(start);
        const newlineWithIndent = '\n' + indent;
        codeEditor.value = beforeCursor + newlineWithIndent + afterCursor;
        codeEditor.selectionStart = codeEditor.selectionEnd = start + newlineWithIndent.length;
      }
    }
  });

  codeEditor.addEventListener('input', () => {
    const q = state.questions[state.activeQuestionIndex];
    if (q && state.drafts[q.id]) {
      state.drafts[q.id].code = codeEditor.value;
    }
  });
}

// Clear terminal output
el('clearTerminalBtn').addEventListener('click', () => {
  el('terminalOutput').textContent = '';
});

// Stdin input piping
el('terminalInput').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const inputVal = el('terminalInput').value;
    el('terminalInput').value = '';
    el('terminalOutput').textContent += inputVal + '\n';
    if (window.electronAPI) {
      window.electronAPI.sendStdin(inputVal);
    }
  }
});

// Apply changes in Demo Question Builder
el('applyDemoQBtn').addEventListener('click', async () => {
  const btn = el('applyDemoQBtn');
  const originalText = btn.textContent;
  const originalBg = btn.style.background;
  const originalColor = btn.style.color;

  const q = state.questions[state.activeQuestionIndex];
  if (!q) return;

  const newTitle = el('demoQTitle').value.trim();
  const newPrompt = el('demoQPrompt').value.trim();

  if (!newTitle) {
    btn.disabled = true;
    btn.textContent = '✖ Title Required';
    btn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    btn.style.color = '#ffffff';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = originalBg;
      btn.style.color = originalColor;
      btn.disabled = false;
    }, 2500);
    return;
  }

  btn.disabled = true;
  btn.textContent = 'Applying...';

  q.title = newTitle;
  q.prompt = newPrompt;

  const fileInput = el('demoQFiles');
  if (fileInput && fileInput.files.length > 0) {
    const localFiles = [];
    const readPromises = Array.from(fileInput.files).map(file => {
      return new Promise(resolve => {
        const reader = new FileReader();
        reader.onload = (e) => {
          const base64Data = e.target.result.split(',')[1];
          localFiles.push({
            filename: file.name,
            content: base64Data,
            dataUrl: e.target.result
          });
          resolve();
        };
        reader.readAsDataURL(file);
      });
    });
    await Promise.all(readPromises);
    q.localFiles = localFiles;
  }

  loadTabState(state.activeQuestionIndex);
  
  btn.textContent = '✔ Question Updated!';
  btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
  btn.style.color = '#ffffff';
  setTimeout(() => {
    btn.textContent = originalText;
    btn.style.background = originalBg;
    btn.style.color = originalColor;
    btn.disabled = false;
  }, 2500);
});

// Run Code logic
el('runCodeBtn').addEventListener('click', () => {
  const code = el('codeEditor').value;
  const term = el('terminalOutput');
  const runBtn = el('runCodeBtn');
  const lang = el('languageSelect').value;

  if (state.runWs) {
    if (window.electronAPI) {
      window.electronAPI.stopCode();
    }
    state.runWs = null;
    return;
  }

  if (!window.electronAPI) {
    term.style.color = '#f87171';
    term.textContent = '[Error]: Code execution is only available in the desktop app.';
    return;
  }

  if (!code.trim()) {
    term.style.color = '#f87171';
    term.textContent = '[Error]: Please write some code first.';
    return;
  }

  state.runWs = true;

  // Clear previous outputs
  if (el('terminalOutputs')) {
    el('terminalOutputs').classList.add('hidden');
  }
  if (el('outputsContainer')) {
    el('outputsContainer').innerHTML = '';
  }

  term.textContent = `Running ${lang.toUpperCase()} code...\n`;
  term.style.color = '#a3e635';
  runBtn.textContent = 'Stop';
  runBtn.style.background = '#ef4444';
  runBtn.style.color = '#ffffff';

  el('terminalInputRow').classList.remove('hidden');
  el('terminalInput').value = '';
  el('terminalInput').focus();

  const cleanupRunState = () => {
    runBtn.disabled = false;
    runBtn.textContent = 'Run Code';
    runBtn.style.removeProperty('background');
    runBtn.style.removeProperty('color');
    state.runWs = null;
    window.electronAPI.removeCodeListeners();
    el('terminalInputRow').classList.add('hidden');
  };

  window.electronAPI.removeCodeListeners();

  window.electronAPI.onCodeOutput((data) => {
    term.textContent += data.data;
    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
    if (data.stream === 'stderr') {
      term.style.color = '#f87171';
    }
  });

  window.electronAPI.onCodeExit((data) => {
    if (data.error) {
      term.style.color = '#f87171';
      term.textContent += '\n' + data.error;
    } else if (data.exitCode === 0) {
      term.style.color = '#10b981';
      if (!term.textContent.trim()) {
        term.textContent = 'Program finished with no output.';
      }
    } else if (data.exitCode === -1) {
      term.style.color = '#f87171';
      term.textContent += '\n[Stopped by user]';
    } else {
      if (!term.style.color || term.style.color === 'rgb(163, 230, 53)') {
        term.style.color = '#f87171';
      }
    }

    if (data.generatedFiles && data.generatedFiles.length > 0) {
      const outputsDiv = el('terminalOutputs');
      const container = el('outputsContainer');
      if (outputsDiv && container) {
        container.innerHTML = '';
        data.generatedFiles.forEach(file => {
          const wrapper = document.createElement('div');
          wrapper.style.background = '#ffffff';
          wrapper.style.padding = '16px';
          wrapper.style.borderRadius = '10px';
          wrapper.style.border = '1px solid #cbd5e1';
          wrapper.style.display = 'flex';
          wrapper.style.flexDirection = 'column';
          wrapper.style.gap = '8px';
          wrapper.style.width = '100%';
          wrapper.style.boxSizing = 'border-box';

          const title = document.createElement('span');
          title.textContent = `📊 ${file.filename}`;
          title.style.color = '#0f172a';
          title.style.fontWeight = 'bold';
          title.style.fontSize = '0.9rem';
          title.style.fontFamily = 'system-ui, -apple-system, sans-serif';
          wrapper.appendChild(title);

          if (file.type === 'application/pdf') {
            const embed = document.createElement('embed');
            embed.src = `data:application/pdf;base64,${file.content}`;
            embed.type = 'application/pdf';
            embed.style.width = '100%';
            embed.style.height = '500px';
            embed.style.borderRadius = '6px';
            embed.style.border = '1px solid #cbd5e1';
            wrapper.appendChild(embed);
          } else {
            const img = document.createElement('img');
            img.src = `data:${file.type};base64,${file.content}`;
            img.style.maxWidth = '100%';
            img.style.maxHeight = '550px';
            img.style.objectFit = 'contain';
            img.style.borderRadius = '6px';
            img.style.border = '1px solid #cbd5e1';
            img.style.cursor = 'zoom-in';
            img.addEventListener('click', () => openImageLightbox(img.src));
            wrapper.appendChild(img);
          }
          container.appendChild(wrapper);
        });
        outputsDiv.classList.remove('hidden');
      }
    }

    el('terminalOutputContainer').scrollTop = el('terminalOutputContainer').scrollHeight;
    cleanupRunState();
  });

  const q = state.questions[state.activeQuestionIndex];
  let attachments = [];
  if (q && q.localFiles) {
    attachments = q.localFiles.map(file => ({
      filename: file.filename,
      content: file.content,
      isLocal: true
    }));
  }

  window.electronAPI.runCode(code, lang, attachments);
});

// Submit Solution (local feedback, no server request)
el('submitBtn').addEventListener('click', () => {
  const btn = el('submitBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Submitting...';

  setTimeout(() => {
    btn.textContent = '✔ Submitted successfully!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.color = '#ffffff';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 3000);
  }, 1000);
});

// Save locally
el('saveLocalBtn').addEventListener('click', async () => {
  const btn = el('saveLocalBtn');
  const originalText = btn.textContent;
  btn.disabled = true;
  btn.textContent = 'Saving...';

  const q = state.questions[state.activeQuestionIndex];
  const activeTitle = q ? q.title.replace(/[^a-z0-9]/gi, '_').toLowerCase() : 'untitled';
  const folderName = `SecureLab_Saved_Code/${activeTitle}`;
  const lang = el('languageSelect').value;
  const ext = lang === 'python' ? 'py' : lang === 'r' ? 'R' : lang === 'mysql' ? 'sql' : lang;
  const filename = `${activeTitle}.${ext}`;
  const code = el('codeEditor').value;

  try {
    if (!window.electronAPI) throw new Error('Available in desktop app only.');
    
    // 1. Save code file
    await window.electronAPI.saveLocalFile(folderName, filename, code);
    
    // 2. Save question metadata and prompt description
    if (q) {
      const questionContent = `Title: ${q.title}\nLanguage: ${lang}\n\nDescription/Prompt:\n${q.prompt || ''}\n`;
      await window.electronAPI.saveLocalFile(folderName, `${activeTitle}_question.txt`, questionContent);
      
      // 3. Save attached local files (CSV, PDF, Images, etc.)
      if (q.localFiles && q.localFiles.length > 0) {
        for (const file of q.localFiles) {
          await window.electronAPI.saveLocalFile(folderName, file.filename, file.content, 'base64');
        }
      }
    }

    btn.textContent = '✔ Saved!';
    btn.style.background = 'linear-gradient(135deg, #10b981, #059669)';
    btn.style.color = '#ffffff';
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2500);
  } catch (err) {
    btn.textContent = '✖ Error';
    btn.style.background = 'linear-gradient(135deg, #dc2626, #b91c1c)';
    btn.style.color = '#ffffff';
    alert(err.message);
    setTimeout(() => {
      btn.textContent = originalText;
      btn.style.background = '';
      btn.style.color = '';
      btn.disabled = false;
    }, 2500);
  }
});

// Exit button
el('exitDemoBtn').addEventListener('click', () => {
  window.location.href = 'index.html';
});

// Window controls listeners
if (window.electronAPI) {
  let isFullscreen = false;

  el('demoMinimizeBtn').addEventListener('click', () => {
    window.electronAPI.minimizeApp();
  });

  el('demoFullscreenBtn').addEventListener('click', () => {
    isFullscreen = !isFullscreen;
    window.electronAPI.requestFullscreen(isFullscreen);
  });

  el('demoCloseBtn').addEventListener('click', () => {
    if (confirm('Are you sure you want to close SecureLab? Any unsaved changes will be lost.')) {
      window.electronAPI.exitApp();
    }
  });
}

// Initialize with tab setup
renderTabs();
