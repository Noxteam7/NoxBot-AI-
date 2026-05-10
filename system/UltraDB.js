import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

class UltraDB {
  #path;
  #saveTimer = null;

  constructor() {
    this.#path = path.join(__dirname, "database.json");
    const dir  = path.dirname(this.#path);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    this.data = this.#load();
    return this.#createProxy();
  }

  #load() {
    try {
      if (existsSync(this.#path)) {
        const raw = readFileSync(this.#path, "utf-8");
        if (raw.trim()) {
          const parsed = JSON.parse(raw);
          if (!parsed.groups) parsed.groups = {};
          if (!parsed.users)  parsed.users  = {};
          if (!parsed.chats) parsed.chats = {};
          if (!parsed.stats) parsed.stats = {};
          if (!parsed.msgs) parsed.msgs = {};
          if (!parsed.sticker) parsed.sticker = {};
          if (!parsed.error) parsed.error = {};
          if (!parsed.settings) parsed.settings = {};
          if (parsed.dev === undefined) parsed.dev = false;
          return parsed;
        }
      }
    } catch (e) {}
    return {
      groups: {},
      users: {},
      chats: {},
      stats: {},
      msgs: {},
      sticker: {},
      error: {},
      settings: {},
      dev: false
    };
  }

  #save() {
    if (this.#saveTimer) clearTimeout(this.#saveTimer);
    this.#saveTimer = setTimeout(() => {
      try { writeFileSync(this.#path, JSON.stringify(this.data, null, 2)); }
      catch (e) {}
      this.#saveTimer = null;
    }, 50);
  }

  #isValidId(id) {
    return typeof id === "string" && id.length > 0;
  }

  #createProxy() {
    const self = this;

    const makeInnerProxy = (target, parentTarget, parentId, saveRef) => {
      return new Proxy(target, {
        set(obj, key, val) {
          if (val === undefined) {
            delete obj[key];
          } else {
            obj[key] = val;
          }
          if (Object.keys(obj).length === 0) delete parentTarget[parentId];
          saveRef();
          return true;
        },
        deleteProperty(obj, key) {
          delete obj[key];
          if (Object.keys(obj).length === 0) delete parentTarget[parentId];
          saveRef();
          return true;
        }
      });
    };

    const makeCollectionProxy = (collectionTarget) => {
      return new Proxy(collectionTarget, {
        get(target, id) {
          if (!self.#isValidId(id)) return undefined;
          if (!target[id]) { target[id] = {}; self.#save(); }
          return makeInnerProxy(target[id], target, id, () => self.#save());
        },
        set(target, id, val) {
          if (!self.#isValidId(id)) return false;
          if (val && typeof val === "object" && Object.keys(val).length > 0) {
            target[id] = val;
          } else {
            delete target[id];
          }
          self.#save();
          return true;
        },
        deleteProperty(target, id) {
          delete target[id];
          self.#save();
          return true;
        }
      });
    };

    let rootProxy;
    rootProxy = new Proxy(this.data, {
      get(target, prop) {
        if (prop === "data") return rootProxy;
        if (prop === "groups") return makeCollectionProxy(target.groups);
        if (prop === "users")  return makeCollectionProxy(target.users);
        if (prop === "chats") return makeCollectionProxy(target.chats);
        if (prop === "settings") return makeCollectionProxy(target.settings);
        if (prop === "dev")    return target.dev;
        return target[prop];
      },
      set(target, prop, val) {
        if (prop === "data") return false;
        if (prop === "groups" || prop === "users" || prop === "chats" || prop === "settings") return false;
        target[prop] = val;
        self.#save();
        return true;
      }
    });
    return rootProxy;
  }
}

export default UltraDB;
