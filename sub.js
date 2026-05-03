async function sub(sock) {
  console.log("🔄 [SubSystem] Sub system ready (mock mode)");
  
  // كائن وهمي يحاكي SubBots
  const mockSubBots = {
    _listeners: new Map(),
    setConfig: async (cfg) => console.log("⚙️ [SubBots] Config received"),
    load: async () => { console.log("📦 [SubBots] Loaded 0 sub bots"); return 0; },
    on: (event, cb) => {
      if (event === 'pair') {
        setTimeout(() => {
          console.log("🔐 [SubBot] Pairing code: NOXE1234");
          cb("virtual_uid", "NOXE1234");
        }, 1000);
      }
    },
    emit: (event, ...args) => {}
  };
  
  global.subBots = mockSubBots;
  return mockSubBots;
}

export default sub;
