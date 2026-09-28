/**
 * Discord Live Voice Channel Bot
 * - Joins Voice Channel (!join)
 * - Speaks live in voice call with Type2Talk Edge Neural TTS (!say, !ask)
 * - Powered by Groq AI & Street-Smart Hinglish Personality
 */

import { Client, GatewayIntentBits } from "discord.js";
import { 
  joinVoiceChannel, 
  createAudioPlayer, 
  createAudioResource, 
  AudioPlayerStatus, 
  StreamType, 
  entersState, 
  VoiceConnectionStatus 
} from "@discordjs/voice";
import { Readable } from "stream";
import http from "http";
import dotenv from "dotenv";
import ffmpegPath from "ffmpeg-static";
import sodium from "libsodium-wrappers";

process.env.FFMPEG_PATH = ffmpegPath;
dotenv.config();

// Ensure sodium encryption engine is ready before voice packets are processed
await sodium.ready;

const BOT_TOKEN = process.env.DISCORD_BOT_TOKEN;
const AI_API_KEY = process.env.AI_API_KEY;
let CURRENT_MODEL = process.env.AI_MODEL || "openai/gpt-oss-120b";
let CURRENT_VOICE = "hi-IN-MadhurNeural"; // Type2Talk default

if (!AI_API_KEY) {
  console.warn("⚠️ AI_API_KEY is missing in environment variables!");
}

let SYSTEM_PROMPT = process.env.SYSTEM_PROMPT || 
  "You are a savage, witty, hilarious, and street-smart AI buddy in a Discord voice call. Your vibe is that of an unfiltered, brutally funny Indian college friend or gaming buddy who roasts people for fun, gives sharp sarcastic comebacks, and drops hilarious banter. You speak in pure, punchy, conversational Hinglish (mixing Hindi and English naturally). Use authentic colloquial slang like 'bhai tu rehne de', 'kya bakwas hai yaar', 'kya scene hai', 'overacting band kar', 'dimag ka dahi mat kar', 'arrey bhai bhai', 'chal nikal', 'top tier clown moment', 'bindaas bol'. Never sound like a formal, polite, robotic corporate assistant. Be bold, funny, sarcastic, and playfully roasting while keeping it entertaining and engaging. Keep replies relatively concise (1-3 sentences) so they sound punchy and natural when spoken aloud in the call.";

// Edge TTS Constants
const TRUSTED_CLIENT_TOKEN = "6A5AA1D4EAFF4E9FB37E23D68491D6F4";
const CHROMIUM_FULL_VERSION = "143.0.3650.75";
const CHROMIUM_MAJOR_VERSION = CHROMIUM_FULL_VERSION.split(".")[0];
const SEC_MS_GEC_VERSION = `1-${CHROMIUM_FULL_VERSION}`;

if (!BOT_TOKEN) {
  console.error("❌ DISCORD_BOT_TOKEN is missing in .env!");
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent
  ]
});

// Voice connection management
let voiceConnection = null;
const audioPlayer = createAudioPlayer();

audioPlayer.on(AudioPlayerStatus.Playing, () => {
  console.log("▶️ AudioPlayer started playing voice in call!");
});

audioPlayer.on(AudioPlayerStatus.Idle, () => {
  console.log("⏹️ AudioPlayer finished playing.");
});

audioPlayer.on("error", (error) => {
  console.error("❌ AudioPlayer Error:", error.message);
});

audioPlayer.on("stateChange", (oldState, newState) => {
  console.log(`🎵 AudioPlayer state: ${oldState.status} -> ${newState.status}`);
});

client.once("ready", () => {
  console.log("--------------------------------------------------");
  console.log(`🤖 Voice Bot is ONLINE as: ${client.user.tag}`);
  console.log(`🧠 AI Model: ${CURRENT_MODEL}`);
  console.log(`🗣️ Type2Talk Voice: ${CURRENT_VOICE}`);
  console.log("--------------------------------------------------");
});

// HTTP Health Check Server (Required for Render, Railway, Fly.io)
const PORT = process.env.PORT || 3000;
const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({
    status: "ok",
    service: "discord-voice-bot",
    bot: client.user ? client.user.tag : "connecting",
    uptime: Math.floor(process.uptime()),
    voiceConnected: !!voiceConnection
  }));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`🌐 Health check HTTP server listening on 0.0.0.0:${PORT}`);
});

client.on("messageCreate", async (message) => {
  if (message.author.bot) return;

  const rawContent = message.content.trim();
  const isMention = message.mentions.has(client.user);
  const clean = rawContent.replace(/<@!?\d+>/g, "").trim();

  if (!clean && !isMention) return;

  console.log(`📩 Message from ${message.author.tag}: "${rawContent}" (clean: "${clean}") [isMention: ${isMention}]`);

  // Command: !join (or @Bot join / join)
  if (clean === "!join" || clean.toLowerCase() === "join" || clean.toLowerCase() === "!join") {
    console.log("➡️ Processing JOIN command...");
    const channel = message.member?.voice.channel;
    if (!channel) {
      await message.reply("⚠️ Bhai pehle kisi voice channel me ghuso, tabhi toh join karunga!");
      return;
    }

    try {
      voiceConnection = joinVoiceChannel({
        channelId: channel.id,
        guildId: channel.guild.id,
        adapterCreator: channel.guild.voiceAdapterCreator,
        selfDeaf: false,
        selfMute: false
      });

      voiceConnection.on("stateChange", (oldState, newState) => {
        console.log(`🔊 Voice connection state: ${oldState.status} -> ${newState.status}`);
      });

      voiceConnection.on("debug", (msg) => {
        console.log(`[Voice Debug]: ${msg}`);
      });

      voiceConnection.subscribe(audioPlayer);

      console.log("⏳ Handshaking with Discord voice server (DAVE E2EE)...");
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 20_000);
      console.log("✅ Voice connection is READY!");

      await message.reply(`🔊 Joined **${channel.name}**! Bol bhai ab kya scene hai?`);
      await speakInVoice("Haan bhai, main voice call me aa gaya!");
    } catch (err) {
      console.error("Join error:", err);
      await message.reply(`❌ Voice channel join nahi kar paya: ${err.message}`);
    }
    return;
  }

  // Command: !leave (or @Bot leave / leave)
  if (clean === "!leave" || clean.toLowerCase() === "leave" || clean.toLowerCase() === "!leave") {
    if (voiceConnection) {
      voiceConnection.destroy();
      voiceConnection = null;
      await message.reply("👋 Call se nikal gaya bhai, jab zarurat ho `!join` bol dena!");
    } else {
      await message.reply("Main kisi voice channel me nahi hoon bhai.");
    }
    return;
  }

  // Command: !voice <name>
  if (clean.startsWith("!voice") || clean.startsWith("voice ")) {
    const parts = clean.split(" ");
    if (parts.length < 2) {
      await message.reply("🎙️ **Available Voices:**\n- `hi-IN-MadhurNeural` (Madhur - Hindi Male)\n- `hi-IN-SwaraNeural` (Swara - Hindi Female)\n- `en-IN-PrabhatNeural` (Prabhat - Indian English Male)\n- `en-US-ChristopherNeural` (Christopher - US English Male)\n\nUsage: `!voice hi-IN-SwaraNeural`");
      return;
    }
    CURRENT_VOICE = parts[1].trim();
    await message.reply(`✅ Voice switched to: \`${CURRENT_VOICE}\`!`);
    await speakInVoice("Haan bhai, meri nayi aawaz kaisi lag rahi hai?");
    return;
  }

  // Command: !model or !models (Switch or view AI model)
  if (clean.startsWith("!model") || clean.startsWith("model ") || clean === "models" || clean === "!models") {
    const parts = clean.split(/\s+/);
    if (parts.length < 2 || clean === "!model" || clean === "model" || clean === "!models" || clean === "models") {
      await message.reply(
        `🧠 **Current AI Model:** \`${CURRENT_MODEL}\`\n\n` +
        `**Available Fast Models:**\n` +
        `- \`openai/gpt-oss-120b\` (Default: Smartest reasoning)\n` +
        `- \`openai/gpt-oss-20b\` (Ultra-fast low latency)\n` +
        `- \`qwen/qwen3.8-27b\` (Qwen multilingual)\n` +
        `- \`gpt-4o-mini\` / \`gpt-4o\` (Official OpenAI)\n\n` +
        `**To Switch Model:**\n` +
        `\`!model openai/gpt-oss-20b\``
      );
      return;
    }
    const requestedModel = parts[1].trim();
    CURRENT_MODEL = requestedModel;
    await message.reply(`✅ AI Model switched to: \`${CURRENT_MODEL}\`!`);
    return;
  }

  // Command: !roast <target> (Hilarious street-smart roast)
  if (clean.startsWith("!roast") || clean.startsWith("roast ")) {
    const target = clean.replace(/^(!roast|roast)\s*/i, "").trim() || "is bande ko";
    console.log(`🔥 Roasting target: "${target}"`);
    await message.channel.sendTyping();
    try {
      const roastPrompt = `Roast "${target}" in brutal, hilarious, sarcastic, street-smart Indian college/gaming Hinglish slang. Give a savage, witty one-liner or punchy comeback. Don't be polite or formal. Maximum 2 short sentences.`;
      const roastReply = await callGroqAi(roastPrompt);
      await message.reply(roastReply);
      if (voiceConnection) {
        await speakInVoice(roastReply);
      }
    } catch (err) {
      await message.reply(`⚠️ Roast nahi ho paya: ${err.message}`);
    }
    return;
  }

  // Command: !say <text> (Speaks exact text)
  if (clean.startsWith("!say") || clean.startsWith("say ")) {
    const textToSay = clean.replace(/^(!say|say)\s*/i, "").trim();
    if (!textToSay) {
      await message.reply("⚠️ Usage: `!say <kuch bhi bolo>`");
      return;
    }

    if (!voiceConnection) {
      await message.reply("⚠️ Main abhi voice channel me nahi hoon! Pehle `!join` bolo.");
      return;
    }

    await message.react("🗣️");
    await speakInVoice(textToSay);
    return;
  }

  // AI Commands: !ask, !speak, !chat, or @Bot mention, or any !prefix
  const isAiTrigger = isMention || 
    clean.startsWith("!ask") || clean.startsWith("ask ") ||
    clean.startsWith("!speak") || clean.startsWith("speak ") ||
    clean.startsWith("!chat") || clean.startsWith("chat ") ||
    clean.startsWith("!");

  if (isAiTrigger) {
    let prompt = clean
      .replace(/^(!ask|ask)\s*/i, "")
      .replace(/^(!speak|speak)\s*/i, "")
      .replace(/^(!chat|chat)\s*/i, "")
      .replace(/^!/, "")
      .trim();

    if (!prompt) {
      await message.reply("Bol bhai, kya sawal hai?");
      return;
    }

    console.log(`🧠 Asking AI (${CURRENT_MODEL}): "${prompt}"`);
    await message.channel.sendTyping();

    try {
      // 1. Call AI
      const aiReply = await callGroqAi(prompt);

      // 2. Reply in text
      await message.reply(aiReply);

      // 3. Speak in voice channel if connected!
      if (voiceConnection) {
        await speakInVoice(aiReply);
      }
    } catch (err) {
      console.error("AI error:", err);
      await message.reply(`⚠️ Bhai error aa gaya: \`${err.message}\``);
    }
  }
});

/**
 * Calls Groq AI or official OpenAI
 */
async function callGroqAi(prompt) {
  // If OpenAI key is supplied (starts with sk- and not gsk_), use OpenAI API endpoint
  const isOfficialOpenAI = AI_API_KEY && AI_API_KEY.startsWith("sk-") && !AI_API_KEY.startsWith("gsk_");
  const endpoint = isOfficialOpenAI 
    ? "https://api.openai.com/v1/chat/completions" 
    : "https://api.groq.com/openai/v1/chat/completions";

  const res = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${AI_API_KEY}`
    },
    body: JSON.stringify({
      model: CURRENT_MODEL,
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: prompt }
      ],
      temperature: 0.8
    })
  });

  if (!res.ok) {
    throw new Error(`AI API error (${res.status}): ${await res.text()}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content || "No reply generated.";
}

/**
 * Synthesizes Type2Talk Edge Neural TTS and streams it live into Discord Voice Call
 */
async function speakInVoice(text) {
  if (!voiceConnection) return;

  // Ensure connection is Ready
  if (voiceConnection.state?.status !== VoiceConnectionStatus.Ready) {
    console.log(`⏳ Waiting for voice connection to reach Ready state (currently: ${voiceConnection.state?.status})...`);
    try {
      await entersState(voiceConnection, VoiceConnectionStatus.Ready, 15_000);
      console.log("✅ Voice connection is Ready, proceeding to play audio.");
    } catch (err) {
      console.error("❌ Cannot play audio: Voice connection not ready (" + voiceConnection.state?.status + ")");
      return;
    }
  }

  console.log(`🎙️ Speaking in voice call: "${text.substring(0, 100)}" with voice "${CURRENT_VOICE}"`);

  // Clean text for speech
  let clean = text
    .replace(/```[\s\S]*?```/g, "")
    .replace(/`.*?`/g, "")
    .replace(/[*_#~[\]()]/g, "")
    .trim();

  // Take first 3 sentences or up to 350 chars
  const sentences = clean.split(/[.?!।\n]+/);
  let snippet = sentences.slice(0, 3).join(". ").trim();
  if (!snippet || snippet.length < 10) snippet = clean.substring(0, 300);
  if (snippet.length > 350) snippet = snippet.substring(0, 350);

  try {
    const audioBytes = await generateEdgeTts(snippet, CURRENT_VOICE);
    console.log(`🎵 Edge TTS generated ${audioBytes.length} bytes. Playing audio in voice call...`);
    const stream = Readable.from(Buffer.from(audioBytes));
    const resource = createAudioResource(stream, { inputType: StreamType.Arbitrary });
    resource.playStream.on("error", (err) => console.error("❌ Audio resource stream error:", err.message));
    audioPlayer.play(resource);
  } catch (err) {
    console.error("Voice playback error:", err);
  }
}

/**
 * Microsoft Edge TTS Generator
 */
function escapeXml(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

function removeInvalidXmlCharacters(text) {
  return text.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, " ");
}

function ttsTimestamp() {
  return new Date().toISOString().replace(/[-:.]/g, "").slice(0, -1);
}

async function makeSecMsGec() {
  const winEpoch = 11644473600;
  const secondsToNs = 1e9;
  let ticks = Date.now() / 1000;
  ticks += winEpoch;
  ticks -= ticks % 300;
  ticks *= secondsToNs / 100;
  const payload = `${ticks.toFixed(0)}${TRUSTED_CLIENT_TOKEN}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, "0")).join("").toUpperCase();
}

function parseBinaryAudioFrame(data) {
  const headerLength = (data[0] << 8) | data[1];
  const headerText = new TextDecoder().decode(data.slice(2, 2 + headerLength));
  const headers = {};
  for (const line of headerText.split("\r\n")) {
    const colonIndex = line.indexOf(":");
    if (colonIndex > 0) headers[line.slice(0, colonIndex)] = line.slice(colonIndex + 1).trim();
  }
  return { headers, body: data.slice(2 + headerLength) };
}

async function generateEdgeTts(text, voice) {
  const connectionId = crypto.randomUUID().replace(/-/g, "");
  const secMsGec = await makeSecMsGec();
  const wssUrl = `wss://speech.platform.bing.com/consumer/speech/synthesize/readaloud/edge/v1?TrustedClientToken=${TRUSTED_CLIENT_TOKEN}&Sec-MS-GEC=${secMsGec}&Sec-MS-GEC-Version=${SEC_MS_GEC_VERSION}&ConnectionId=${connectionId}`;

  const requestId = crypto.randomUUID().replace(/-/g, "");
  const speechConfigMsg = 
    `X-Timestamp:${ttsTimestamp()}\r\n` +
    "Content-Type:application/json; charset=utf-8\r\n" +
    "Path:speech.config\r\n\r\n" +
    '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"false","wordBoundaryEnabled":"true"},"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n';

  const ssml = 
    "<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'>" +
    `<voice name='${voice}'><prosody pitch='+0Hz' rate='+0%' volume='+0%'>${escapeXml(removeInvalidXmlCharacters(text))}</prosody></voice></speak>`;

  const ssmlMsg = 
    `X-RequestId:${requestId}\r\n` +
    "Content-Type:application/ssml+xml\r\n" +
    `X-Timestamp:${ttsTimestamp()}Z\r\n` +
    "Path:ssml\r\n\r\n" +
    ssml;

  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wssUrl, {
      headers: {
        "User-Agent": `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${CHROMIUM_MAJOR_VERSION}.0.0.0 Safari/537.36 Edg/${CHROMIUM_MAJOR_VERSION}.0.0.0`,
        "Pragma": "no-cache",
        "Cache-Control": "no-cache",
        "Origin": "chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold"
      }
    });

    const audioChunks = [];

    ws.onopen = () => {
      ws.send(speechConfigMsg);
      ws.send(ssmlMsg);
    };

    ws.onmessage = async (event) => {
      let data = event.data;
      if (typeof data === "string") {
        if (data.includes("Path:turn.end")) {
          try { ws.close(); } catch(e){}
          const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
          const merged = new Uint8Array(totalLength);
          let offset = 0;
          for (const c of audioChunks) {
            merged.set(c, offset);
            offset += c.length;
          }
          resolve(merged);
        }
      } else {
        if (data instanceof Blob) data = new Uint8Array(await data.arrayBuffer());
        else if (data instanceof ArrayBuffer) data = new Uint8Array(data);
        if (data.length >= 2) {
          const { headers, body } = parseBinaryAudioFrame(data);
          if (headers.Path === "audio" && body.length > 0) audioChunks.push(body);
        }
      }
    };

    ws.onerror = (err) => reject(new Error("Edge TTS WS Error: " + err.message));
    ws.onclose = () => {
      if (audioChunks.length > 0) {
        const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const c of audioChunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        resolve(merged);
      } else {
        reject(new Error("WebSocket closed without returning audio"));
      }
    };

    setTimeout(() => {
      try { ws.close(); } catch(e){}
      if (audioChunks.length > 0) {
        const totalLength = audioChunks.reduce((acc, c) => acc + c.length, 0);
        const merged = new Uint8Array(totalLength);
        let offset = 0;
        for (const c of audioChunks) {
          merged.set(c, offset);
          offset += c.length;
        }
        resolve(merged);
      } else {
        reject(new Error("Edge TTS timeout"));
      }
    }, 15000);
  });
}

client.login(BOT_TOKEN);
