// Transcrição com Whisper rodando 100% no navegador (transformers.js). Roda num Worker para não travar a página.
import { pipeline } from "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1";

const LANGS = { en: "english", es: "spanish", fr: "french", de: "german", it: "italian", ja: "japanese", ko: "korean", zh: "chinese", ru: "russian", pt: "portuguese" };
let asr = null, loadedModel = "";

self.onmessage = async ({ data }) => {
  const { audio, model, lang } = data;
  try {
    if (!asr || loadedModel !== model) {
      const files = {};
      asr = await pipeline("automatic-speech-recognition", model, {
        progress_callback: p => {
          if (p.status === "progress" && p.total) {
            files[p.file] = p;
            const done = Object.values(files).reduce((s, f) => s + f.loaded, 0);
            const total = Object.values(files).reduce((s, f) => s + f.total, 0);
            self.postMessage({ type: "progress", text: `Baixando modelo (só na 1ª vez): ${(done / 1e6).toFixed(0)} de ${(total / 1e6).toFixed(0)} MB` });
          }
        },
      });
      loadedModel = model;
    }
    self.postMessage({ type: "progress", text: "Transcrevendo... (pode levar alguns segundos por minuto de áudio)" });
    const out = await asr(audio, {
      language: LANGS[lang] || null, task: "transcribe",
      chunk_length_s: 30, stride_length_s: 5, return_timestamps: true,
    });
    self.postMessage({ type: "result", text: out.text, chunks: out.chunks || [] });
  } catch (e) {
    self.postMessage({ type: "error", text: String(e?.message || e) });
  }
};
