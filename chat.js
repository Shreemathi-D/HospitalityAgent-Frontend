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
      systemPrompt: "You are a helpful assistant."
    });
    console.log("Configuration loaded:", config);
  } catch (error) {
    console.error("Failed to load config:", error);
    alert("Failed to load configuration. Check console.");
  }
}

// Verify Azure Speech SDK
function checkSpeechSDK() {
  console.log("Checking Azure Speech SDK...");
  if (typeof SpeechSDK === 'undefined') {
    console.error("Azure Speech SDK not loaded.");
    alert("Failed to load Azure Speech SDK. Check network or browser.");
    return false;
  }
  console.log("Azure Speech SDK loaded.");
  return true;
}

function htmlEncode(text) {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
    '/': '&#x2F;'
  };
  return String(text).replace(/[&<>"'\/]/g, match => entityMap[match]);
}

// -------------------- Avatar Session --------------------
async function connectAvatar() {
  console.log("Starting avatar session...");
  document.getElementById('startSession').innerHTML = "Starting...";
  document.getElementById('startSession').disabled = true;
  document.getElementById('chatHistory').innerHTML = '<div class="system-message"><span>Session starting...</span></div>';
  document.getElementById('chatHistory').hidden = false;

  if (!config) await loadConfig();
  if (!checkSpeechSDK()) {
    document.getElementById('startSession').innerHTML = "Start Session";
    document.getElementById('startSession').disabled = false;
    document.getElementById('chatHistory').innerHTML = '<div class="system-message"><span>Failed to start session. Check console.</span></div>';
    return;
  }

  try {
    const speechConfig = SpeechSDK.SpeechConfig.fromSubscription(config.cogSvcSubKey, config.cogSvcRegion);
    const avatarConfig = new SpeechSDK.AvatarConfig(config.talkingAvatarCharacter, config.talkingAvatarStyle);
    avatarSynthesizer = new SpeechSDK.AvatarSynthesizer(speechConfig, avatarConfig);

    avatarSynthesizer.avatarEventReceived = (s, e) => {
      console.log(`Event received: ${e.description}, offset: ${e.offset / 10000}ms`);
    };

    const speechRecognitionConfig = SpeechSDK.SpeechConfig.fromEndpoint(
      new URL(`wss://${config.cogSvcRegion}.stt.speech.microsoft.com/speech/universal/v2`),
      config.cogSvcSubKey
    );
    speechRecognitionConfig.setProperty(SpeechSDK.PropertyId.SpeechServiceConnection_LanguageIdMode, "Continuous");
    const autoDetectSourceLanguageConfig = SpeechSDK.AutoDetectSourceLanguageConfig.fromLanguages(config.sttLocales);
    speechRecognizer = SpeechSDK.SpeechRecognizer.FromConfig(
      speechRecognitionConfig,
      autoDetectSourceLanguageConfig,
      SpeechSDK.AudioConfig.fromDefaultMicrophoneInput()
    );

    if (!messageInitiated) {
      initMessages();
      messageInitiated = true;
    }

    const xhr = new XMLHttpRequest();
    xhr.open("GET", `https://${config.cogSvcRegion}.tts.speech.microsoft.com/cognitiveservices/avatar/relay/token/v1`);
    xhr.setRequestHeader("Ocp-Apim-Subscription-Key", config.cogSvcSubKey);
    xhr.onreadystatechange = function () {
      if (this.readyState === 4) {
        if (this.status === 200) {
          const responseData = JSON.parse(this.responseText);
          setupWebRTC(responseData.Urls[0], responseData.Username, responseData.Password);
        } else {
          console.error(`Failed to fetch WebRTC token: ${this.status}`);
          alert(`Failed to connect to avatar service. Check credentials.`);
          resetSessionUI();
        }
      }
    };
    xhr.send();
  } catch (error) {
    console.error("Error initializing avatar:", error);
    alert("Failed to initialize avatar. Check console.");
    resetSessionUI();
  }
}

function disconnectAvatar() {
  console.log("Disconnecting avatar session...");
  if (avatarSynthesizer) avatarSynthesizer.close();
  if (speechRecognizer) {
    speechRecognizer.stopContinuousRecognitionAsync();
    speechRecognizer.close();
  }
  if (peerConnection) peerConnection.close();
  sessionActive = false;
  userClosedSession = true;
  pendingQueries = [];
  resetSessionUI();
}

function resetSessionUI() {
  document.getElementById('microphone').disabled = true;
  document.getElementById('stopSession').disabled = true;
  document.getElementById('userMessageBox').disabled = true;
  document.getElementById('chatHistory').hidden = true;
  document.getElementById('startSession').innerHTML = "Start Session";
  document.getElementById('startSession').disabled = false;
}

// -------------------- WebRTC --------------------
function setupWebRTC(iceServerUrl, iceServerUsername, iceServerCredential) {
  console.log("Setting up WebRTC...");
  peerConnection = new RTCPeerConnection({
    iceServers: [{ urls: [iceServerUrl], username: iceServerUsername, credential: iceServerCredential }]
  });

  peerConnection.ontrack = (event) => {
    const kind = event.track.kind;
    const stream = event.streams[0];
    let mediaElement;

    if (kind === 'audio') {
      mediaElement = document.createElement('audio');
      mediaElement.autoplay = true;
    } else if (kind === 'video') {
      mediaElement = document.createElement('video');
      mediaElement.autoplay = true;
      mediaElement.playsInline = true;
      mediaElement.style.width = '640px';
    }

    if (mediaElement) {
      mediaElement.srcObject = stream;
      mediaElement.id = `${kind}Player`;
      const container = document.getElementById('remoteVideo');
      Array.from(container.children).forEach(c => { if (c.localName === kind) container.removeChild(c); });
      container.appendChild(mediaElement);

      if (kind === 'video') {
        document.getElementById('microphone').disabled = false;
        document.getElementById('stopSession').disabled = false;
        document.getElementById('userMessageBox').disabled = false;
        document.getElementById('chatHistory').innerHTML = '';
        document.getElementById('chatHistory').hidden = false;
        sessionActive = true;
        pendingQueries.forEach(q => handleUserQuery(q));
        pendingQueries = [];
      }
    }
  };

  peerConnection.addEventListener("datachannel", event => {
    peerConnectionDataChannel = event.channel;
    peerConnectionDataChannel.onmessage = e => console.log(`[${(new Date()).toISOString()}] WebRTC event: ${e.data}`);
  });

  peerConnection.createDataChannel("eventChannel");
  peerConnection.oniceconnectionstatechange = () => console.log(`WebRTC status: ${peerConnection.iceConnectionState}`);
  peerConnection.addTransceiver('video', { direction: 'sendrecv' });
  peerConnection.addTransceiver('audio', { direction: 'sendrecv' });

  avatarSynthesizer.startAvatarAsync(peerConnection).then(r => {
    if (r.reason === SpeechSDK.ResultReason.SynthesizingAudioCompleted) {
      console.log(`Avatar started. Result ID: ${r.resultId}`);
    } else {
      console.error(`Unable to start avatar. Result ID: ${r.resultId}`);
      resetSessionUI();
    }
  }).catch(error => {
    console.error(`Avatar failed to start: ${error}`);
    alert("Failed to start avatar. Check console.");
    resetSessionUI();
  });
}

// -------------------- Text + Speech --------------------
function initMessages() {
  messages = [{ role: 'system', content: config.systemPrompt }];
}

function speak(text, endingSilenceMs = 0) {
  if (isSpeaking) { spokenTextQueue.push(text); return; }
  speakNext(text, endingSilenceMs);
}

function speakNext(text, endingSilenceMs = 0) {
  let ssml = `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xmlns:mstts='http://www.w3.org/2001/mstts' xml:lang='en-US'><voice name='${config.ttsVoice}'><mstts:leadingsilence-exact value='0'/>${htmlEncode(text)}${endingSilenceMs>0 ? `<break time='${endingSilenceMs}ms'/>` : ''}</voice></speak>`;

  if (enableDisplayTextAlignmentWithSpeech) {
    const chatHistory = document.getElementById('chatHistory');
    chatHistory.innerHTML += `<div class="assistant-message"><span>${text.replace(/\n/g,'<br/>')}</span></div>`;
    chatHistory.scrollTop = chatHistory.scrollHeight;
  }

  isSpeaking = true;
  speakingText = text;
  document.getElementById('stopSpeaking').disabled = false;

  avatarSynthesizer.speakSsmlAsync(ssml).then(result => {
    speakingText = '';
    if (spokenTextQueue.length > 0) speakNext(spokenTextQueue.shift());
    else { isSpeaking = false; document.getElementById('stopSpeaking').disabled = true; }
  }).catch(error => {
    console.error(`Error speaking SSML: ${error}`);
    speakingText = '';
    if (spokenTextQueue.length > 0) speakNext(spokenTextQueue.shift());
    else { isSpeaking = false; document.getElementById('stopSpeaking').disabled = true; }
  });
}

function stopSpeaking() {
  spokenTextQueue = [];
  if (avatarSynthesizer) {
    avatarSynthesizer.stopSpeakingAsync().then(() => {
      isSpeaking = false;
      document.getElementById('stopSpeaking').disabled = true;
      console.log(`[${(new Date()).toISOString()}] Stop speaking request sent.`);
    }).catch(err => console.error("Error stopping speaking:", err));
  }
}

// -------------------- User Query --------------------
function handleUserQuery(userQuery) {
  console.log("Handling user query:", userQuery);
  if (!sessionActive) {
    pendingQueries.push(userQuery);
    document.getElementById('chatHistory').innerHTML = '<div class="system-message"><span>Session starting, query queued...</span></div>';
    return;
  }

  lastInteractionTime = new Date();
  messages.push({ role: 'user', content: userQuery });

  const chatHistory = document.getElementById('chatHistory');
  chatHistory.innerHTML += `<div class="user-message"><span>${htmlEncode(userQuery)}</span></div>`;
  chatHistory.scrollTop = chatHistory.scrollHeight;

  if (isSpeaking) stopSpeaking();

  fetch("https://avatar-v4ja.onrender.com/ask_agent", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ session_id: "demo-session", message: userQuery })
  }).then(res => res.ok ? res.json() : res.text().then(txt => { throw new Error(txt); }))
    .then(data => {
      const assistantReply = data.text;
      if (!assistantReply) return;

      messages.push({ role: 'assistant', content: assistantReply });

      let spokenSentence = '';
      let displaySentence = '';
      const tokens = assistantReply.split(/([.!?;:。？！：；])/);
      tokens.forEach(token => {
        spokenSentence += token; displaySentence += token;
        if (sentenceLevelPunctuations.includes(token)) {
          if (spokenSentence.trim()) speak(spokenSentence);
          spokenSentence = '';
          if (!enableDisplayTextAlignmentWithSpeech) {
            chatHistory.innerHTML += `<div class="assistant-message"><span>${displaySentence.replace(/\n/g,'<br/>')}</span></div>`;
            chatHistory.scrollTop = chatHistory.scrollHeight;
            displaySentence = '';
          }
        }
      });
      if (spokenSentence.trim()) speak(spokenSentence);
      if (!enableDisplayTextAlignmentWithSpeech && displaySentence) {
        chatHistory.innerHTML += `<div class="assistant-message"><span>${displaySentence.replace(/\n/g,'<br/>')}</span></div>`;
        chatHistory.scrollTop = chatHistory.scrollHeight;
      }
    }).catch(err => {
      console.error("Error from /ask_agent:", err);
      alert(`Failed to get response: ${err.message}`);
      chatHistory.innerHTML += `<div class="system-message"><span>Error: ${htmlEncode(err.message)}</span></div>`;
      chatHistory.scrollTop = chatHistory.scrollHeight;
    });
}

// -------------------- Microphone --------------------
window.microphone = async () => {
  lastInteractionTime = new Date();
  const micButton = document.getElementById('microphone');

  if (micButton.innerHTML === 'Stop Microphone') {
    speechRecognizer.stopContinuousRecognitionAsync(() => { micButton.innerHTML = '🎤 Mic'; micButton.disabled = false; }, err => { console.error(err); micButton.disabled = false; });
    return;
  }

  micButton.disabled = true;

  try { await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch(err) { console.error("Mic access denied:", err); alert("Please allow microphone access."); micButton.disabled = false; return; }

  speechRecognizer.startContinuousRecognitionAsync(() => { micButton.innerHTML = 'Stop Microphone'; micButton.disabled = false; }, err => { console.error(err); micButton.disabled = false; });

  speechRecognizer.recognized = (s, e) => {
    if (e.result.reason === SpeechSDK.ResultReason.RecognizedSpeech) {
      let userQuery = e.result.text.trim();
      if (userQuery) {
        if (isSpeaking) stopSpeaking();
        const transcriptionDiv = document.getElementById("transcriptionText");
        transcriptionDiv.innerHTML += `<div><b>User:</b> ${htmlEncode(userQuery)}<br></div><br>`;
        transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
        handleUserQuery(userQuery);
      }
    }
  };
};

// -------------------- Toggle Chat --------------------
window.toggleChat = () => {
  const panel = document.getElementById("chatHistoryPanel");
  const toggleBtn = document.getElementById("toggleChat");
  if (panel.style.display === "none" || panel.style.display === "") {
    panel.style.display = "block"; toggleBtn.textContent = "📝 Hide Transcriptions";
  } else {
    panel.style.display = "none"; toggleBtn.textContent = "📝 Show Transcriptions";
  }
};

// -------------------- Live Caption --------------------
function showLiveCaption(text) {
  const captionDiv = document.getElementById("liveCaption");
  captionDiv.textContent = text;
  captionDiv.hidden = false;
  clearTimeout(captionDiv._hideTimeout);
  captionDiv._hideTimeout = setTimeout(() => { captionDiv.hidden = true; }, 4000);
}

// -------------------- Check Hung --------------------
function checkHung() {
  let videoElement = document.getElementById('videoPlayer');
  if (videoElement && sessionActive) {
    let videoTime = videoElement.currentTime;
    setTimeout(() => {
      if (videoElement.currentTime === videoTime && sessionActive) {
        console.log(`[${(new Date()).toISOString()}] Video disconnected, reconnecting...`);
        sessionActive = false;
        if (peerConnectionDataChannel) peerConnectionDataChannel.onmessage = null;
        if (avatarSynthesizer) avatarSynthesizer.close();
        connectAvatar();
      }
    }, 2000);
  }
}

// -------------------- Window Events --------------------
window.onload = async () => {
  await loadConfig();
  setInterval(checkHung, 2000);
  document.getElementById('userMessageBox').addEventListener('keyup', e => {
    if (e.key === 'Enter') {
      const userQuery = document.getElementById('userMessageBox').value.trim();
      if (userQuery) {
        const transcriptionDiv = document.getElementById("transcriptionText");
        transcriptionDiv.innerHTML += `<div><b>User:</b> ${htmlEncode(userQuery)}<br></div><br>`;
        transcriptionDiv.scrollTop = transcriptionDiv.scrollHeight;
        handleUserQuery(userQuery);
        document.getElementById('userMessageBox').value = '';
      }
    }
  });
};

window.startSession = () => { lastInteractionTime = new Date(); userClosedSession = false; connectAvatar(); };
window.stopSession = () => { lastInteractionTime = new Date(); userClosedSession = true; disconnectAvatar(); };
window.stopSpeaking = stopSpeaking;
