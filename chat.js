// Copyright (c) Microsoft. All rights reserved.
// Licensed under the MIT license.

// Global objects
var speechRecognizer;
var avatarSynthesizer;
var peerConnection;
var peerConnectionDataChannel;
var messages = [];
var messageInitiated = false;
var sentenceLevelPunctuations = ['.', '?', '!', ':', ';', '。', '？', '！', '：', '；'];
var enableDisplayTextAlignmentWithSpeech = true;
var isSpeaking = false;
var isReconnecting = false;
var speakingText = "";
var spokenTextQueue = [];
var repeatSpeakingSentenceAfterReconnection = true;
var sessionActive = false;
var userClosedSession = false;
var lastInteractionTime = new Date();
var lastSpeakTime;
var pendingQueries = [];
var config;

// Load config async (replace with your config file logic)
async function loadConfig() {
  console.log("Loading configuration...");
  try {
    // Placeholder: Replace with fetch('config.json')
    config = await Promise.resolve({
      cogSvcRegion: "eastus2",
      cogSvcSubKey: "Cz4BbPc7lZ9XlsBO0qUVgqLsvmoSa1Nq4dgoxmAurG7lFgVubdyTJQQJ99BHACHYHv6XJ3w3AAAAACOGowZU",
      talkingAvatarCharacter: "lisa",
      talkingAvatarStyle: "casual-sitting",
      ttsVoice: "en-US-JennyNeural",
      sttLocales: ["en-US"],
      directLineSpeechKey = "BdsHeJgHXOgRmX3aSdDpRKbR5ut2FGtO7XklHXHQGtQNJvtugeTUJQQJ99BIAC77bzfAArohAAABAZBSFkZS.4zTM1t4fLmDFwoHeddVrAB5GoameRdCZ3e8td13meMkLDwNa4pXeJQQJ99BIAC77bzfAArohAAABAZBS2JZW",
      directLineRegion = "eastus2", 
      systemPrompt: "You are a helpful assistant."
    });
    console.log("Configuration loaded:", config);
  } catch (error) {
    console.error("Failed to load config:", error);
    alert("Failed to load configuration. Check console.");
  }
}

// Verify Azure Speech SDK
function htmlEncode(text) {
  const entityMap = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '/': '&#x2F;' };
  return String(text).replace(/[&<>"'\/]/g, match => entityMap[match]);
}

// =======================
// Speech / Avatar Setup
// =======================
function checkDirectLineSDK() {
  if (typeof WebChat === 'undefined') {
    console.error("BotFramework WebChat not loaded.");
    alert("WebChat SDK not loaded. Check network.");
    return false;
  }
  console.log("WebChat SDK loaded.");
  return true;
}

async function connectAvatar() {
  console.log("Starting avatar session...");
  document.getElementById('startSession').innerHTML = "Starting...";
  document.getElementById('startSession').disabled = true;
  document.getElementById('chatHistory').innerHTML = '<div class="system-message"><span>Session starting...</span></div>';
  document.getElementById('chatHistory').hidden = false;

  if (!config) await loadConfig();

  if (!checkDirectLineSDK()) {
    document.getElementById('startSession').innerHTML = "Start Session";
    document.getElementById('startSession').disabled = false;
    document.getElementById('chatHistory').innerHTML = '<div class="system-message"><span>Failed to start session. Check console.</span></div>';
    return;
  }

  try {
    // =======================
    // Direct Line Speech Setup
    // =======================
    const speechConfig = {
      directLine: {
        secret: directLineSpeechKey,
        region: directLineRegion
      }
    };

    avatarSynthesizer = WebChat.createDirectLineSpeechAdapter(speechConfig);

    // Audio playback handling
    avatarSynthesizer.on('speak', event => {
      if (event.audio) {
        const audioElement = new Audio(URL.createObjectURL(event.audio));
        audioElement.play().catch(err => console.error("Audio play failed:", err));
      }
    });

    // Initialize messages
    if (!messageInitiated) {
      initMessages();
      messageInitiated = true;
    }

    // Simulate WebRTC setup
    setupWebRTC(null, null, null);

    // Enable buttons
    document.getElementById('microphone').disabled = false;
    document.getElementById('stopSession').disabled = false;
    document.getElementById('userMessageBox').disabled = false;
    document.getElementById('chatHistory').innerHTML = '';
    sessionActive = true;
    console.log("Avatar session active (Direct Line Speech).");

  } catch (error) {
    console.error("Error initializing avatar:", error);
    alert("Failed to initialize avatar. Check console.");
    document.getElementById('startSession').innerHTML = "Start Session";
    document.getElementById('startSession').disabled = false;
    document.getElementById('chatHistory').innerHTML = '<div class="system-message"><span>Failed to start session. Check console.</span></div>';
  }
}

// =======================
// Disconnect / Cleanup
// =======================
function disconnectAvatar() {
  console.log("Disconnecting avatar session...");
  if (avatarSynthesizer) {
    avatarSynthesizer.close();
    avatarSynthesizer = null;
  }
  if (speechRecognizer) {
    speechRecognizer.stopContinuousRecognitionAsync();
    speechRecognizer.close();
    speechRecognizer = null;
  }
  if (peerConnection) {
    peerConnection.close();
    peerConnection = null;
  }
  sessionActive = false;
  userClosedSession = true;
  pendingQueries = [];
  document.getElementById('microphone').disabled = true;
  document.getElementById('stopSession').disabled = true;
  document.getElementById('userMessageBox').disabled = true;
  document.getElementById('chatHistory').hidden = true;
  document.getElementById('startSession').innerHTML = "Start Session";
  document.getElementById('startSession').disabled = false;
}

// =======================
// WebRTC Setup (stub)
// =======================
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
  console.log("Simulated WebRTC setup (Direct Line Speech handles audio).");
}

// =======================
// Session / Mic Handling
// =======================
window.startSession = () => {
  lastInteractionTime = new Date();
  userClosedSession = false;
  connectAvatar();
};

window.stopSession = () => {
  lastInteractionTime = new Date();
  document.getElementById('microphone').disabled = true;
  document.getElementById('stopSession').disabled = true;
  document.getElementById('userMessageBox').disabled = true;
  document.getElementById('chatHistory').hidden = true;
  document.getElementById('startSession').innerHTML = "Start Session";
  document.getElementById('startSession').disabled = false;
  userClosedSession = true;
  disconnectAvatar();
};

window.microphone = () => {
  if (!avatarSynthesizer) return;

  const micBtn = document.getElementById('microphone');

  if (micBtn.innerHTML === 'Stop Microphone') {
    avatarSynthesizer.stopListening();
    micBtn.innerHTML = '🎤 Mic';
    micBtn.disabled = false;
    return;
  }

  micBtn.disabled = true;
  avatarSynthesizer.startListening().then(() => {
    micBtn.innerHTML = 'Stop Microphone';
    micBtn.disabled = false;
  }).catch(err => {
    console.error("Failed to start recognition:", err);
    micBtn.disabled = false;
  });

  avatarSynthesizer.onRecognized = e => {
    if (e.text && e.text.trim()) {
      const transcriptionDiv = document.getElementById("transcriptionText");
      transcriptionDiv.innerHTML += `<div><b>User:</b> ${htmlEncode(e.text)}<br></div><br>`;
      transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
      handleUserQuery(e.text.trim());
    }
  };
};

// =======================
// TTS Handling
// =======================
function speak(text, endingSilenceMs = 0) {
  if (!avatarSynthesizer) return;
  if (isSpeaking) {
    spokenTextQueue.push(text);
    return;
  }
  speakNext(text, endingSilenceMs);
}

function speakNext(text, endingSilenceMs = 0, skipUpdatingChatHistory = false) {
  if (!avatarSynthesizer) return;

  if (!skipUpdatingChatHistory) {
    const chatHistoryTextArea = document.getElementById('chatHistory');
    chatHistoryTextArea.innerHTML += `<div class="assistant-message"><span>${text.replace(/\n/g, '<br/>')}</span></div>`;
    chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;
  }

  isSpeaking = true;
  speakingText = text;
  avatarSynthesizer.speakTextAsync(text).then(() => {
    if (spokenTextQueue.length > 0) {
      speakNext(spokenTextQueue.shift());
    } else {
      isSpeaking = false;
    }
  }).catch(err => {
    console.error("Error speaking text:", err);
    isSpeaking = false;
  });
}

function stopSpeaking() {
  if (!avatarSynthesizer) return;
  avatarSynthesizer.stopSpeakingAsync();
  isSpeaking = false;
}

// =======================
// User Query Handling
// =======================
function handleUserQuery(userQuery) {
  if (!sessionActive) {
    pendingQueries.push(userQuery);
    document.getElementById('chatHistory').innerHTML += '<div class="system-message"><span>Session starting, query queued...</span></div>';
    return;
  }

  const chatHistoryTextArea = document.getElementById('chatHistory');
  chatHistoryTextArea.innerHTML += `<div class="user-message"><span>${htmlEncode(userQuery)}</span></div>`;
  chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;

  fetch("https://avatar-v4ja.onrender.com/ask_agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "demo-session", message: userQuery })
  })
  .then(res => res.json())
  .then(data => {
    const assistantReply = data.text;
    if (assistantReply) {
      chatHistoryTextArea.innerHTML += `<div class="assistant-message"><span>${htmlEncode(assistantReply)}</span></div>`;
      chatHistoryTextArea.scrollTop = chatHistoryTextArea.scrollHeight;
      speak(assistantReply);
    }
  })
  .catch(err => console.error("Error from /ask_agent:", err));
}

// =======================
// Messages / UI
// =======================
function initMessages() {
  messages = [{ role: 'system', content: config.systemPrompt }];
}

function toggleChat() {
  const panel = document.getElementById("chatHistoryPanel");
  const toggleBtn = document.getElementById("toggleChat");
  if (panel.style.display === "none" || panel.style.display === "") {
    panel.style.display = "block";
    toggleBtn.textContent = "📝 Hide Transcriptions";
  } else {
    panel.style.display = "none";
    toggleBtn.textContent = "📝 Show Transcriptions";
  }
}

function showLiveCaption(text) {
  const captionDiv = document.getElementById("liveCaption");
  captionDiv.textContent = text;
  captionDiv.hidden = false;
  clearTimeout(captionDiv._hideTimeout);
  captionDiv._hideTimeout = setTimeout(() => captionDiv.hidden = true, 4000);
}

// =======================
// On Load
// =======================
window.onload = async () => {
  await loadConfig();
  setInterval(checkHung, 2000);

  document.getElementById('userMessageBox').addEventListener('keyup', (e) => {
    if (e.key === 'Enter') {
      handleUserQuery(e.target.value);
      e.target.value = '';
    }
  });

  document.getElementById('startSession').addEventListener('click', window.startSession);
  document.getElementById('stopSession').addEventListener('click', window.stopSession);
  document.getElementById('microphone').addEventListener('click', window.microphone);
  document.getElementById('stopSpeaking').addEventListener('click', stopSpeaking);
  document.getElementById('toggleChat').addEventListener('click', toggleChat);
};

// =======================
// Health / Reconnect
// =======================
function checkHung() {
  if (!sessionActive) return;
  const now = new Date();
  if (lastInteractionTime && now - lastInteractionTime > 60000 && !isReconnecting) {
    console.log("Session seems inactive, reconnecting avatar...");
    isReconnecting = true;
    disconnectAvatar();
    setTimeout(() => {
      isReconnecting = false;
      if (!userClosedSession) connectAvatar();
    }, 2000);
  }
}
