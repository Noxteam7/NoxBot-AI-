// sub.js - نظام البوتات الفرعية (متوافق مع Baileys وطباعة NOXE1234)

async function sub(sock) {
  console.log("🔄 [SubSystem] جاري تهيئة البوتات الفرعية...");

  // كائن وهمي يحاكي SubBots مع دعم طباعة كود التنصيب NOXE1234
  const mockSubBots = {
    _listeners: new Map(),

    async setConfig(config) {
      console.log("⚙️ [SubSystem] تم استلام إعدادات البوتات الفرعية");
      // يمكن تخزين الإعدادات لاستخدامها لاحقًا
    },

    async load() {
      console.log("📦 [SubSystem] لا توجد جلسات فرعية مخزنة (سيتم تفعيل نظام الاقتران لاحقًا)");
      return 0;
    },

    on(event, callback) {
      if (!this._listeners.has(event)) this._listeners.set(event, []);
      this._listeners.get(event).push(callback);

      if (event === 'pair') {
        // عند تسجيل حدث pair، ننشئ كود الاقتران الجديد ونطبعه في الكونسول
        setTimeout(() => {
          const pairingCode = "NOXE1234";
          console.log(`🔐 [SubBot Virtual] كود التنصيب الفرعي: ${pairingCode}`);
          // نمرر UID وهمي والكود إلى المستمع
          callback("virtual_uid", pairingCode);
        }, 1500);
      }
    },

    emit(event, ...args) {
      if (this._listeners.has(event)) {
        for (const cb of this._listeners.get(event)) cb(...args);
      }
    },

    get(uid) {
      return this._bots?.get(uid);
    }
  };

  global.subBots = mockSubBots;

  // محاكاة بدء الاقتران فورًا (يمكن تعديل هذا لاحقًا ليكون ديناميكيًا)
  setTimeout(() => {
    global.subBots.emit('pair', 'virtual_uid', 'NOXE1234');
  }, 2000);

  console.log("✅ [SubSystem] نظام البوتات الفرعية جاهز (باستخدام كود NOXE1234)");
  return global.subBots;
}

export default sub;
