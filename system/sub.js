async function sub(sock) {
  console.log("🔄 [Sub] نظام البوتات الفرعية جاهز");

  const listeners = new Map();

  const subBots = {
    _listeners: listeners,
    on(event, cb) {
      if (!listeners.has(event)) listeners.set(event, []);
      listeners.get(event).push(cb);
      if (event === "pair") {
        setTimeout(() => {
          const realCode = global.pairingCode || "UNKNOWN";
          console.log(`🔐 [SubBot] Pairing code: ${realCode}`);
          cb(`subbot_${Date.now()}`, realCode);
        }, 1000);
      }
    },
    emit(event, ...args) {
      for (const cb of listeners.get(event) || []) {
        try { cb(...args); } catch {}
      }
    },
    setConfig: async () => {},
    load: async () => {
      console.log("📦 [Sub] 0 بوت فرعي");
      return 0;
    },
    sendMessage: async (jid, content) => {
      if (!sock) return;
      try { return await sock.sendMessage(jid, content); }
      catch (e) { console.error("[Sub]", e.message); }
    }
  };

  global.subBots = subBots;
  await subBots.load();
  return subBots;
}

export default sub;
