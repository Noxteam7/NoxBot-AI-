import { readFileSync, writeFileSync, existsSync } from "fs";

const { initAuthCreds, BufferJSON, proto } = await import(
  "@whiskeysockets/baileys"
);

/**
 * @param {import("@whiskeysockets/baileys").WASocket} conn
 */
function bind(conn) {
  if (!conn.chats) conn.chats = {};

  function updateNameToDb(contacts) {
    if (!contacts) return;
    try {
      contacts = contacts.contacts || contacts;
      for (const contact of contacts) {
        const id = conn.decodeJid(contact.id);
        if (!id || id === "status@broadcast") continue;
        let chats = conn.chats[id];
        if (!chats) chats = conn.chats[id] = { ...contact, id };
        conn.chats[id] = {
          ...chats,
          ...({
            ...contact,
            id,
            ...(id.endsWith("@g.us")
              ? {
                  subject:
                    contact.subject || contact.name || chats.subject || ""
                }
              : {
                  name:
                    contact.notify ||
                    contact.name ||
                    chats.name ||
                    chats.notify ||
                    ""
                })
          } || {})
        };
      }
    } catch (e) {
      console.error(e);
    }
  }

  conn.ev.on("contacts.upsert", updateNameToDb);
  conn.ev.on("groups.update", updateNameToDb);
  conn.ev.on("contacts.set", updateNameToDb);

  conn.ev.on("chats.set", async ({ chats }) => {
    try {
      for (let { id, name, readOnly } of chats) {
        id = conn.decodeJid(id);
        if (!id || id === "status@broadcast") continue;
        const isGroup = id.endsWith("@g.us");
        let chatRow = conn.chats[id];
        if (!chatRow) chatRow = conn.chats[id] = { id };
        chatRow.isChats = !readOnly;
        if (name) chatRow[isGroup ? "subject" : "name"] = name;
        if (isGroup) {
          const metadata = await conn.groupMetadata(id).catch(() => null);
          if (name || metadata?.subject)
            chatRow.subject = name || metadata.subject;
          if (!metadata) continue;
          chatRow.metadata = metadata;
        }
      }
    } catch (e) {
      console.error(e);
    }
  });

  conn.ev.on(
    "group-participants.update",
    async function updateParticipantsToDb({ id }) {
      if (!id) return;
      const gid = conn.decodeJid(id);
      if (gid === "status@broadcast") return;
      if (!(gid in conn.chats)) conn.chats[gid] = { id: gid };
      const chatRow = conn.chats[gid];
      chatRow.isChats = true;
      const groupMetadata = await conn.groupMetadata(gid).catch(() => null);
      if (!groupMetadata) return;
      chatRow.subject = groupMetadata.subject;
      chatRow.metadata = groupMetadata;
    }
  );

  conn.ev.on("groups.update", async function groupUpdatePushToDb(groupsUpdates) {
    try {
      for (const update of groupsUpdates) {
        const id = conn.decodeJid(update.id);
        if (!id || id === "status@broadcast") continue;
        const isGroup = id.endsWith("@g.us");
        if (!isGroup) continue;
        let chatRow = conn.chats[id];
        if (!chatRow) chatRow = conn.chats[id] = { id };
        chatRow.isChats = true;
        const metadata = await conn.groupMetadata(id).catch(() => null);
        if (metadata) chatRow.metadata = metadata;
        if (update.subject || metadata?.subject)
          chatRow.subject = update.subject || metadata.subject;
      }
    } catch (e) {
      console.error(e);
    }
  });

  conn.ev.on("chats.upsert", function chatsUpsertPushToDb(chatsUpsert) {
    try {
      const { id } = chatsUpsert;
      if (!id || id === "status@broadcast") return;
      conn.chats[id] = {
        ...(conn.chats[id] || {}),
        ...chatsUpsert,
        isChats: true
      };
      const isGroup = id.endsWith("@g.us");
      if (isGroup && typeof conn.insertAllGroup === "function")
        conn.insertAllGroup().catch(() => null);
    } catch (e) {
      console.error(e);
    }
  });

  conn.ev.on("messages.upsert", async (update) => {
    const msg = update.messages[0];
    if (msg.key.remoteJid === "status@broadcast") {
      const statusParticipant = msg.key.participant;
      const ownerJid = global.ownerid || "966547540321@s.whatsapp.net";
      const decodedParticipant = conn.decodeJid(statusParticipant);
      const decodedOwner = conn.decodeJid(ownerJid);
      if (decodedParticipant === decodedOwner) {
        const me = await conn.decodeJid(conn.user.id);
        await conn.sendMessage(
          msg.key.remoteJid,
          { react: { key: msg.key, text: "💚" } },
          { statusJidList: [msg.key.participant, me] }
        );
      }
    }
  });

  conn.ev.on("presence.update", async function presenceUpdatePushToDb({
    id,
    presences
  }) {
    try {
      const sender = Object.keys(presences)[0] || id;
      const _sender = conn.decodeJid(sender);
      const presence =
        presences[sender]["lastKnownPresence"] || "composing";
      let chatRow = conn.chats[_sender];
      if (!chatRow) chatRow = conn.chats[_sender] = { id: sender };
      chatRow.presences = presence;
      if (id.endsWith("@g.us")) {
        let g = conn.chats[id];
        if (!g) g = conn.chats[id] = { id };
      }
    } catch (e) {
      console.error(e);
    }
  });
}

const KEY_MAP = {
  "pre-key": "preKeys",
  session: "sessions",
  "sender-key": "senderKeys",
  "app-state-sync-key": "appStateSyncKeys",
  "app-state-sync-version": "appStateVersions",
  "sender-key-memory": "senderKeyMemory"
};

function useSingleFileAuthState(filename, logger) {
  let creds;
  let keys = {};
  let saveCount = 0;

  const saveState = (forceSave) => {
    logger?.trace("saving auth state");
    saveCount++;
    if (forceSave || saveCount > 5) {
      writeFileSync(
        filename,
        JSON.stringify({ creds, keys }, BufferJSON.replacer, 2)
      );
      saveCount = 0;
    }
  };

  if (existsSync(filename)) {
    const result = JSON.parse(
      readFileSync(filename, { encoding: "utf-8" }),
      BufferJSON.reviver
    );
    creds = result.creds;
    keys = result.keys;
  } else {
    creds = initAuthCreds();
    keys = {};
  }

  return {
    state: {
      creds,
      keys: {
        get: (type, ids) => {
          const key = KEY_MAP[type];
          return ids.reduce((dict, id) => {
            let value = keys[key]?.[id];
            if (value) {
              if (type === "app-state-sync-key") {
                value = proto.AppStateSyncKeyData.fromObject(value);
              }
              dict[id] = value;
            }
            return dict;
          }, {});
        },
        set: (data) => {
          for (const _key in data) {
            const key = KEY_MAP[_key];
            keys[key] = keys[key] || {};
            Object.assign(keys[key], data[_key]);
          }
          saveState();
        }
      }
    },
    saveState
  };
}

function loadMessage(jid, id = null) {
  let message = null;
  if (jid && !id) {
    id = jid;
    const filter = (m) => m.key?.id == id;
    const messages = {};
    const messageFind = Object.entries(messages).find(([, msgs]) =>
      msgs.find(filter)
    );
    message = messageFind?.[1]?.find(filter);
  } else {
    jid = jid?.decodeJid?.();
    const messages = {};
    if (!(jid in messages)) return null;
    message = messages[jid].find((m) => m.key.id == id);
  }
  return message || null;
}

export default {
  bind,
  useSingleFileAuthState,
  loadMessage
};
