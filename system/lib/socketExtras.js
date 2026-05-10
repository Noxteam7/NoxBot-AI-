import path from 'path';
import {toAudio} from './converter.js';
import chalk from 'chalk';
import FormData from 'form-data';
import fetch from 'node-fetch';
import crypto from 'crypto';
import PhoneNumber from 'awesome-phonenumber';
import fs from 'fs';
import util from 'util';
import {fileTypeFromBuffer} from 'file-type';
import {format} from 'util';
import {fileURLToPath} from 'url';
import store from './store.js';
import '../../index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** تحميل اختياري — مشروع NOX/test يستخدم index.js وليس شرطاً config.js في المجلد الأب */
try {
  await import(new URL('../index.js', import.meta.url).href);
} catch {
  /* no-op */
}

/** توافق مع global.db من UltraDB ومع الإعدادات الاختيارية */
function defaultWm() {
  return global.wm ?? global.config?.info?.nameBot ?? '';
}

const safeDecodeJid = (jid, conn) => {
  try {
    if (!jid || typeof jid !== "string") return "";
    let decoded = (typeof jid.decodeJid === 'function') ? jid.decodeJid() : jid;
    if (typeof decoded === 'string' && decoded.endsWith('@lid')) {
      const storeContact = store && store.contacts ? store.contacts[decoded] : null;
      if (storeContact && storeContact.id && !storeContact.id.endsWith('@lid')) return storeContact.id;
      
      const contact = conn?.chats?.[decoded] || conn?.contacts?.[decoded];
      if (contact && contact.id && !contact.id.endsWith('@lid')) return contact.id;
      
      const realJid = Object.keys(conn?.chats || {}).find(k => conn.chats[k] && conn.chats[k].lid === decoded) || 
                      Object.keys(conn?.contacts || {}).find(k => conn.contacts[k] && conn.contacts[k].lid === decoded) ||
                      (store && store.contacts ? Object.keys(store.contacts).find(k => store.contacts[k] && store.contacts[k].lid === decoded) : null);
      if (realJid && !realJid.endsWith('@lid')) return realJid;
    }
    return decoded;
  } catch (e) {
    console.error("Error in safeDecodeJid:", e);
    return jid;
  }
};

function formatText(text = '') {
  if (typeof text !== 'string') return text;
  if (typeof global.getfingerprint !== 'function') return text + "\n\n> " + global.getfingerprint();
  const fingerprint = global.getfingerprint() || "اهلا";
  if (fingerprint == null || fingerprint === '') return text;
  return `${text}\n\n> ${fingerprint}`;
}

/* ⦓        ⦓ baileys ⦔       ⦔ */
const baileysModule = await import("@whiskeysockets/baileys");
const baileysDefault = baileysModule.default || baileysModule;

const {
    default: _makeWaSocket,
    makeWALegacySocket,
    proto,
    downloadContentFromMessage,
    jidDecode,
    areJidsSameUser,
    generateWAMessage,
    generateForwardMessageContent,
    generateWAMessageFromContent,
    WAMessageStubType,
    extractMessageContent,
    makeInMemoryStore,
    getAggregateVotesInPollMessage,
    prepareWAMessageMedia,
    WA_DEFAULT_EPHEMERAL,
    S_WHATSAPP_NET = '@s.whatsapp.net',
} = baileysDefault;

/* ⦓         ⦓ makeWASocket ⦔        ⦔ */

/**
 * يطبّق نفس التعديلات على اتصال Baileys جاهز (مثل sock في main.js لمشروع test).
 * آمن للاستدعاء مرة واحدة؛ يتخطى إن وُجد العلامة __simpleExtensionsApplied.
 */
function ensureBaileysMessageLayer() {
  if (global.__noxBaileysMsgLayer) return;
  serialize();
  protoType();
  global.__noxBaileysMsgLayer = true;
}

export function applySimpleSocketExtensions(conn, options = {}) {
  ensureBaileysMessageLayer();
  return finalizeSimpleSocket(conn, options);
}

/** اسم قديم — main.js يستورد applySocketExtras */
export const applySocketExtras = applySimpleSocketExtensions;

export function makeWASocket(connectionOptions, options = {}) {
  global.opts = global.opts || {};
  const useLegacy =
    global.opts.legacy === true &&
    typeof makeWALegacySocket === 'function';
  const conn = (useLegacy ? makeWALegacySocket : _makeWaSocket)(connectionOptions);
  return finalizeSimpleSocket(conn, options);
}

function finalizeSimpleSocket(conn, options = {}) {
  if (conn.__simpleExtensionsApplied) return conn;
  conn.__simpleExtensionsApplied = true;

  const _sendMessage = conn.sendMessage.bind(conn);

  conn.sendMessage = async function (jid, content = {}, options = {}) {
  
    if (typeof content.text === 'string') {
      content.text = formatText(content.text)
    }
  
    if (typeof content.caption === 'string') {
      content.caption = formatText(content.caption)
    }
  
    if (content?.interactiveMessage?.body?.text) {
      content.interactiveMessage.body.text =
        formatText(content.interactiveMessage.body.text)
    }
  
    if (content?.extendedTextMessage?.text) {
      content.extendedTextMessage.text =
        formatText(content.extendedTextMessage.text)
    }
  
    const text =
      content.text ||
      content.caption ||
      content?.interactiveMessage?.body?.text ||
      content?.extendedTextMessage?.text ||
      ""
  
    content.contextInfo = {
      ...(content.contextInfo || {}),
  
      mentionedJid: await conn.parseMention(text),
  
      isForwarded: true,
      forwardingScore: 1,
  
      forwardedNewsletterMessageInfo: {
        newsletterJid:
          global.randomchannelId ||
          "120363225356834044@newsletter",
  
        newsletterName:
          global.randomchannelName ||
          "𝐛𝐨𝐭 ☁︎˚𝐣𝐚𝐱",
  
        serverMessageId: 100,
      },
    }
  
    if (content?.interactiveMessage) {
  
      const bodyText =
        content?.interactiveMessage?.body?.text || ""
  
      const footerText =
        content?.interactiveMessage?.footer?.text || ""
  
      content.interactiveMessage = {
        ...content.interactiveMessage,
  
        body: {
          text: bodyText,
        },
  
        footer: {
          text: footerText,
        },
  
        header: {
          hasMediaAttachment: false,
          imageMessage:
            content?.interactiveMessage?.header?.imageMessage || null,
  
          videoMessage:
            content?.interactiveMessage?.header?.videoMessage || null,
        },
  
        contextInfo: {
          mentionedJid: await conn.parseMention(bodyText),
  
          isForwarded: true,
          forwardingScore: 1,
  
          forwardedNewsletterMessageInfo: {
            newsletterJid:
              global.randomchannelId ||
              "120363225356834044@newsletter",
  
            newsletterName:
              global.randomchannelName ||
              "",
  
            serverMessageId: 100,
          },
        },
      }
    }
  
    return _sendMessage(jid, content, options)
  }


/*          ⦓ sock ⦔         */

  const _groupMetadata = conn.groupMetadata.bind(conn);
  conn.groupMetadata = async function(jid) {
    const metadata = await _groupMetadata(jid);
    if (metadata && metadata.participants) {
      metadata.participants = metadata.participants.map(p => {
        if (p.jid && p.id) {
          p.id = p.jid;
        }
        return p;
      });
    }
    return metadata;
  };

  const sock = Object.defineProperties(conn, {
  
  /*          ⦓ conn : chats ⦔         */
  
    chats: {
      value: {...(options.chats || {})},
      writable: true,
    },
    
    /*          ⦓ conn : decodeJid ⦔         */
    
    decodeJid: {
      value(jid) {
        if (!jid || typeof jid !== 'string') return (!nullish(jid) && jid) || null;
        return safeDecodeJid(jid, this);
      },
    },
    
    /*        ⦓ conn : getFile ⦔       */
    
    getFile: {
      async value(PATH, saveToFile = false) {
        let res; let filename;
        const data = Buffer.isBuffer(PATH) ? PATH : PATH instanceof ArrayBuffer ? PATH.toBuffer() : /^data:.*?\/.*?;base64,/i.test(PATH) ? Buffer.from(PATH.split`,`[1], 'base64') : /^https?:\/\//.test(PATH) ? await (res = await fetch(PATH)).buffer() : fs.existsSync(PATH) ? (filename = PATH, fs.readFileSync(PATH)) : typeof PATH === 'string' ? PATH : Buffer.alloc(0);
        if (!Buffer.isBuffer(data)) throw new TypeError('Result is not a buffer');
        const type = await fileTypeFromBuffer(data) || {
          mime: 'application/octet-stream',
          ext: '.bin',
        };
        if (data && saveToFile && !filename) (filename = path.join(__dirname, '../tmp/' + new Date * 1 + '.' + type.ext), await fs.promises.writeFile(filename, data));
        return {
          res,
          filename,
          ...type,
          data,
          deleteFile() {
            return filename && fs.promises.unlink(filename);
          },
        };
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : getTranslate ⦔         */
    
    getTranslate: {
   async value(text = '', lang = 'ar') {
   try {
     const tr = (await import('@vitalets/google-translate-api').catch(() => null))?.translate;
     if (typeof tr !== 'function') return text;
     const result = await tr(text, { to: lang, autoCorrect: true }).catch(() => null);
     return result?.text ?? text;
   } catch {
     return text;
   }
    },
    enumerable: true,
    },
    decodeJid2: {
async value(jid) {
    if (!jid) return jid;
    if (/:\d+@/gi.test(jid)) {
      let decode = jidDecode(jid) || {};
      return (
        (decode.user && decode.server && decode.user + "@" + decode.server) ||
        jid
      );
    } else return jid;
  },
  enumerable: true,
    },

/*
*/
    /*        ⦓ conn : waitEvent ⦔       */
    
    waitEvent: {
      value(eventName, is = () => true, maxTries = 25) { 
        return new Promise((resolve, reject) => {
          let tries = 0;
          const on = (...args) => {
            if (++tries > maxTries) reject('Max tries reached');
            else if (is()) {
              conn.ev.off(eventName, on);
              resolve(...args);
            }
          };
          conn.ev.on(eventName, on);
        });
      },
    },
    
    /*          ⦓ conn : logger ⦔         */
    
    logger: {
      get() {
        return {
          info(...args) {
            console.log(
                chalk.bold.bgRgb(51, 204, 51)('INFO '),
                `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                chalk.cyan(format(...args)),
            );
          },
          error(...args) {
            console.log(
                chalk.bold.bgRgb(247, 38, 33)('ERROR '),
                `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                chalk.rgb(255, 38, 0)(format(...args)),
            );
          },
          warn(...args) {
            console.log(
                chalk.bold.bgRgb(255, 153, 0)('WARNING '),
                `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                chalk.redBright(format(...args)),
            );
          },
          trace(...args) {
            console.log(
                chalk.grey('TRACE '),
                `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                chalk.white(format(...args)),
            );
          },
          debug(...args) {
            console.log(
                chalk.bold.bgRgb(66, 167, 245)('DEBUG '),
                `[${chalk.rgb(255, 255, 255)(new Date().toUTCString())}]:`,
                chalk.white(format(...args)),
            );
          },
        };
      },
      enumerable: true,
    },
    
    /*        ⦓ conn : sendFile ⦔       */
    
    sendFile: {
      async value(jid, path, filename = '', caption = '', quoted, ptt = false, options = {}) {
        const type = await conn.getFile(path, true);
        let {res, data: file, filename: pathFile} = type;
        if (res && res.status !== 200 || file.length <= 65536) {
          try {
            throw {json: JSON.parse(file.toString())};
          } catch (e) {
            if (e.json) throw e.json;
          }
        }
        
        const opt = {};
        if (quoted) opt.quoted = quoted;
        if (!type) options.asDocument = true;
        let mtype = ''; let mimetype = options.mimetype || type.mime; let convert;
        if (/webp/.test(type.mime) || (/image/.test(type.mime) && options.asSticker)) mtype = 'sticker';
        else if (/image/.test(type.mime) || (/webp/.test(type.mime) && options.asImage)) mtype = 'image';
        else if (/video/.test(type.mime)) mtype = 'video';
        else if (/audio/.test(type.mime)) {
          (
            convert = await toAudio(file, type.ext),
            file = convert.data,
            pathFile = convert.filename,
            mtype = 'audio',
            mimetype = options.mimetype || 'audio/mpeg; codecs=opus'
          );
        } else mtype = 'document';
        if (options.asDocument) mtype = 'document';

        delete options.asSticker;
        delete options.asLocation;
        delete options.asVideo;
        delete options.asDocument;
        delete options.asImage;

        const message = {
          ...options,
          caption,
          ptt,
          [mtype]: {url: pathFile},
          mimetype,
          fileName: filename || pathFile.split('/').pop(),
        };
        
        let m;
        try {
          m = await conn.sendMessage(jid, message, {...opt, ...options});
        } catch (e) {
          console.error(e);
          m = null;
        } finally {
          if (!m) m = await conn.sendMessage(jid, {...message, [mtype]: file}, {...opt, ...options});
          file = null; 
          return m;
        }
      },
      enumerable: true,
    },
    
    /*        ⦓ conn : sendoldButton ⦔       */
    
    sendoldButton: {
   async value(jid, text = '', footer = defaultWm(), buffer, buttons, quoted, options = {}) {
    let img, video;

    if (/^https?:\/\//i.test(buffer)) {
        try {
            const response = await fetch(buffer);
            const contentType = response.headers.get('content-type');
            if (/^image\//i.test(contentType)) {
                img = { url: buffer };
            } else if (/^video\//i.test(contentType)) {
                video = { url: buffer };
            } else {
                console.error("Unsupported MIME type : ", contentType);
            }
        } catch (error) {
            console.error("Error getting MIME type : ", error);
        }
    } else {
        try {
            const type = await conn.getFile(buffer);
            if (/^image\//i.test(type.mime)) {
                img = buffer;
            } else if (/^video\//i.test(type.mime)) {
                video = buffer;
            }
        } catch (error) {
            console.error("Error getting file type : ", error);
        }
    }

    const dynamicButtons = buttons.map(btn => ({
        buttonId: btn[1],
        buttonText: { displayText: btn[0] },
        type: 1,
    }));

    let message = {
        footer: footer,
        buttons: dynamicButtons,
        headerType: 1,
        viewOnce: true
    };

    if (img) {
        message.image = img;
        message.caption = text;
    } else if (video) {
        message.video = video;
        message.caption = text;
    } else {
        message.text = text;
    }

    return await conn.sendMessage(jid, message, { quoted });
  },
   enumerable: true,
    },
      
        /*        ⦓ conn : sendoldList ⦔       */
    
    sendoldList: {
    async value(jid, text = '', footer = defaultWm(), buffer, buttons = [], lists = null, quoted, options = {}) {
    let img, video;

    if (/^https?:\/\//i.test(buffer)) {
        try {
            const response = await fetch(buffer);
            const contentType = response.headers.get('content-type');
            if (/^image\//i.test(contentType)) {
                img = { url: buffer };
            } else if (/^video\//i.test(contentType)) {
                video = { url: buffer };
            } else {
                console.error("Unsupported MIME type:", contentType);
            }
        } catch (error) {
            console.error("Error getting MIME type:", error);
        }
    } else {
        try {
            const type = await conn.getFile(buffer);
            if (/^image\//i.test(type.mime)) {
                img = buffer;
            } else if (/^video\//i.test(type.mime)) {
                video = buffer;
            }
        } catch (error) {
            console.error("Error getting file type:", error);
        }
    }

    const dynamicButtons = buttons.map(btn => ({
        buttonId: btn[1],
        buttonText: { displayText: btn[0] },
        type: 1,
    }));

    if (lists && Array.isArray(lists) && lists.length >= 4) {
        const [title, sectionTitle, highlightLabel, rows] = lists;
        
        if (Array.isArray(rows)) {
            dynamicButtons.push({
                nativeFlowInfo: {
                    name: 'single_select',
                    paramsJson: JSON.stringify({
                        title: title,
                        sections: [{
                            title: sectionTitle,
                            highlight_label: highlightLabel,
                            rows: rows.map(row => ({
                                header: row[0] || "",
                                title: row[1] || "",
                                description: row[2] || "", 
                                id: row[3] || "",
                            })),
                        }],
                    }),
                },
                type: 4,
            });
        } else {
            console.error("Error: 'lists[3]' يجب أن يكون مصفوفة تحتوي على العناصر.");
        }
    }

    let message = {
        footer: footer,
        buttons: dynamicButtons,
        headerType: 1,
        viewOnce: true
    };

    if (img) {
        message.image = img;
        message.caption = text;
    } else if (video) {
        message.video = video;
        message.caption = text;
    } else {
        message.text = text;
    }

    return await conn.sendMessage(jid, message, { quoted });
   },
   enumerable: true,
    },
      
    /*          ⦓ conn : toUrl ⦔         */
        
    toUrl: {
  async value(buffer) {
    
    const { ext, mime: fileMime } = await fileTypeFromBuffer(buffer);
    const form = new FormData();
    form.append('fileToUpload', buffer, `file.${ext}`);
    form.append('reqtype', 'fileupload');

    try {
      const response = await fetch('https://catbox.moe/user/api.php', {
        method: 'POST',
        body: form,
      });
      const text = await response.text();
      if (text.startsWith('https://')) {
        return text;
      } else {
        throw new Error('فشل في رفع الملف إلى Catbox: ' + text);
      }
    } catch (error) {
      return `فشل في رفع الملف: ${error.message}`;
    }
  },

  enumerable: true,
},
      
    /*        ⦓ conn : sendButton ⦔       */
    
    sendButton: {
    async value(jid, text = '', footer = '', buffer, buttons, copy, urls, quoted, options) {
        let img, video

    
        if (/^https?:\/\//i.test(buffer)) {
            try {
                const response = await fetch(buffer)
                const contentType = response.headers.get('content-type')
                if (/^image\//i.test(contentType)) {
                    img = await prepareWAMessageMedia({ image: { url: buffer } }, { upload: conn.waUploadToServer })
                } else if (/^video\//i.test(contentType)) {
                    video = await prepareWAMessageMedia({ video: { url: buffer } }, { upload: conn.waUploadToServer })
                } else {
                    console.error("Unsupported MIME type : ", contentType)
                }
            } catch (error) {
                console.error("Error getting MIME type : ", error)
            }
        } else {
            
            try {
                const type = await conn.getFile(buffer)
               if (/^image\//i.test(type.mime)) {
                    img = await prepareWAMessageMedia({ image: { url: buffer } }, { upload: conn.waUploadToServer })
                } else if (/^video\//i.test(type.mime)) {
                    video = await prepareWAMessageMedia({ video: { url: buffer } }, { upload: conn.waUploadToServer })
                }
            } catch (error) {
                console.error("Error getting file type : ", error);
            }
        }

        const dynamicButtons = buttons.map(btn => ({
            name: 'quick_reply',
            buttonParamsJson: JSON.stringify({
                display_text: btn[0],
                id: btn[1]
            }),
        }));

       
        if (copy && Array.isArray(copy)) {
            
            copy.forEach(cp => {
            dynamicButtons.push({
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                    display_text: cp[0],
                    copy_code: cp[1]
                })
            })
            });
        }

        if (urls && Array.isArray(urls)) {
            urls.forEach(url => {
                dynamicButtons.push({
                    name: 'cta_url',
                    buttonParamsJson: JSON.stringify({
                        display_text: url[0],
                        url: url[1],
                        merchant_url: url[1]
                    })
                })
            })
        }


        const interactiveMessage = {
            body: { text: text },
            footer: { text: footer },
            header: {
                hasMediaAttachment: false,
                imageMessage: img ? img.imageMessage : null,
                videoMessage: video ? video.videoMessage : null
            },
           contextInfo: {
        mentionedJid: await conn.parseMention(text),
        isForwarded: true, 
        forwardingScore: 1, 
        forwardedNewsletterMessageInfo: {
        newsletterJid: global.randomchannelId ?? '120363225356834044@newsletter',
        newsletterName: global.randomchannelName ?? '',
        serverMessageId: 100
        },
        /*externalAdReply: {
        showAdAttribution: true,
          title: '◈─┄┄┄┄┄┄〘 𝐇𝐎𝐌𝐄 𝐒𝐔𝐏𝐏𝐎𝐑𝐓 〙┄┄┄┄┄┄─◈',
          body: '⎆┄┄┄┄〔 قنــاة الــدعم 〕┄┄┄┄⌲',
          thumbnailUrl: global.postarIcon,
          mediaUrl: global.postarIcon,
          mediaType: buffer? 2 : 1,
          sourceUrl: global.channelUrl,
          renderLargerThumbnail: buffer? false : true
        }*/
      }, 
            nativeFlowMessage: {
                buttons: dynamicButtons,
                messageParamsJson: ''
            }
        }

              
        let msgL = generateWAMessageFromContent(jid, {
            viewOnceMessage: {
                message: {
                    interactiveMessage } } }, { userJid: conn.user.jid, quoted })
        
       conn.relayMessage(jid, msgL.message, { messageId: msgL.key.id, ...options })
            
    },
    enumerable: true,
    }, 
    
    /*        ⦓ conn : sendNyanCat ⦔       */
    
    sendNyanCat: {
      async value(jid, text = '', buffer, title, body, url, quoted, options) {
        let type;
        if (buffer) {
          try {
            (type = await conn.getFile(buffer), buffer = type.data);
          } catch {
            buffer = buffer;
          }
        }
	     const prep = generateWAMessageFromContent(jid, {extendedTextMessage: {text: text, contextInfo: {externalAdReply: {title: title, body: body, thumbnail: buffer, sourceUrl: url}, mentionedJid: await conn.parseMention(text)}}}, {quoted: quoted});
        return conn.relayMessage(jid, prep.message, {messageId: prep.key.id});
      },
    },
    
    /*        ⦓ conn : sendPayment ⦔       */
    
    sendPayment: {
      async value(jid, amount, currency, text, quoted, options) {
        conn.relayMessage(jid, {
          requestPaymentMessage: {
            currencyCodeIso4217: currency,
            amount1000: amount,
            requestFrom: quoted.sender || null,
            noteMessage: {
              extendedTextMessage: {
                text: text,
                contextInfo: {
                  externalAdReply: {
                    showAdAttribution: true,
                  }, mentionedJid: conn.parseMention(text)}}}}}, {});
      },
    },
    
    
    
    
    
    /*        ⦓ conn : relayWAMessage ⦔       */
    
    relayWAMessage: {
      async value(pesanfull) {
        if (pesanfull.message.audioMessage) {
          await conn.sendPresenceUpdate('recording', pesanfull.key.remoteJid);
        } else {
          await conn.sendPresenceUpdate('composing', pesanfull.key.remoteJid);
        }
        const mekirim = await conn.relayMessage(pesanfull.key.remoteJid, pesanfull.message, {messageId: pesanfull.key.id});
        conn.ev.emit('messages.upsert', {messages: [pesanfull], type: 'append'});
        return mekirim;
      },
      
    },
    
    
    
    sendContact: {
      /**
             * Send Contact
             * @param {String} jid
             * @param {String[][]|String[]} data
             * @param {import("baileys").proto.WebMessageInfo} quoted
             * @param {Object} options
             */
      async value(jid, data, quoted, options) {
        if (!Array.isArray(data[0]) && typeof data[0] === 'string') data = [data];
        const contacts = [];
        for (let [number, name] of data) {
          number = number.replace(/[^0-9]/g, '');
          const njid = number + '@s.whatsapp.net';
          const biz = await conn.getBusinessProfile(njid).catch((_) => null) || {};
          const vcard = `
BEGIN:VCARD
VERSION:3.0
N:;${name.replace(/\n/g, '\\n')};;;
FN:${name.replace(/\n/g, '\\n')}
TEL;type=CELL;type=VOICE;waid=${number}:${PhoneNumber('+' + number).getNumber('international')}${biz.description ? `
X-WA-BIZ-NAME:${(conn.chats[njid]?.vname || conn.getName(njid) || name).replace(/\n/, '\\n')}
X-WA-BIZ-DESCRIPTION:${biz.description.replace(/\n/g, '\\n')}
`.trim() : ''}
END:VCARD
        `.trim();
          contacts.push({vcard, displayName: name});
        }
        return await conn.sendMessage(jid, {
          ...options,
          contacts: {
            ...options,
            displayName: (contacts.length >= 2 ? `${contacts.length} kontak` : contacts[0].displayName) || null,
            contacts,
          },
        }, {quoted, ...options});
      },
      enumerable: true,
    },
    reply: {
/**
* Reply to a message
* @param {String} jid
* @param {String|Buffer} text
* @param {import('@adiwajshing/baileys').proto.WebMessageInfo} quoted
* @param {Object} options
*/

async value(jid, text = '', quoted, options) {
if (Buffer.isBuffer(text)) {
return conn.sendFile(jid, text, 'file', '', quoted, false, options)
} else {

const contextInfo = {
mentionedJid: await conn.parseMention(text),
isForwarded: true,
forwardingScore: 1, 
forwardedNewsletterMessageInfo: {
newsletterJid: global.randomchannelId ?? '120363225356834044@newsletter',
newsletterName: global.randomchannelName ?? '',
serverMessageId: 100
},
/*externalAdReply: {
        title: '◈─┄┄┄┄┄┄〘 𝐇𝐎𝐌𝐄 𝐒𝐔𝐏𝐏𝐎𝐑𝐓 〙┄┄┄┄┄┄─◈',
        body: '⎆┄┄┄┄〔 قنــاة الــدعم 〕┄┄┄┄⌲',
        sourceUrl: global.channelUrl,
        thumbnailUrl: global.postarIcon,
        mediaUrl: global.postarIcon,
        mediaType: 1,
        showAdAttribution: true,
        renderLargerThumbnail: true
      }*/
}
        
const messageOptions = { ...options, text, contextInfo }
return conn.sendMessage(jid, messageOptions, { quoted, ...options })
}}
},
    reply2: {
      /**
             * Reply to a message
             * @param {String} jid
             * @param {String|Buffer} text
             * @param {import("baileys").proto.WebMessageInfo} quoted
             * @param {Object} options
             */
      value(jid, text = '', quoted, options) {
        return Buffer.isBuffer(text) ? conn.sendFile(jid, text, 'file', '', quoted, false, options) : conn.sendMessage(jid, {...options, text}, {quoted, ...options});
      },
    },
    
   /**
     * Send nativeFlowMessage
     * By: https://github.com/GataNina-Li
     */

    sendButtonMessages: {
      async value(jid, messages, quoted, options) {
        messages.length > 1 ? await conn.sendCarousel(jid, messages, quoted, options) : await conn.sendNCarousel(
          jid, ...messages[0], quoted, options);
      }
    },
    
/**
     * Send nativeFlowMessage
     */
         
    sendNCarousel: {
      async value(jid, text = '', footer = '', buffer, buttons, copy, urls, list, quoted, options) {
        let img, video;
        if (buffer) {
          if (/^https?:\/\//i.test(buffer)) {
            try {
              const response = await fetch(buffer);
              const contentType = response.headers.get('content-type');
              if (/^image\//i.test(contentType)) {
                img = await prepareWAMessageMedia({
                  image: {
                    url: buffer
                  }
                }, {
                  upload: conn.waUploadToServer,
                  ...options
                });
              } else if (/^video\//i.test(contentType)) {
                video = await prepareWAMessageMedia({
                  video: {
                    url: buffer
                  }
                }, {
                  upload: conn.waUploadToServer,
                  ...options
                });
              } else {
                console.error("Incompatible MIME type:", contentType);
              }
            } catch (error) {
              console.error("Failed to get MIME type:", error);
            }
          } else {
            try {
              const type = await conn.getFile(buffer);
              if (/^image\//i.test(type.mime)) {
                img = await prepareWAMessageMedia({
                  image: (/^https?:\/\//i.test(buffer)) ? {
                    url: buffer
                  } : (type && type?.data)
                }, {
                  upload: conn.waUploadToServer,
                  ...options
                });
              } else if (/^video\//i.test(type.mime)) {
                video = await prepareWAMessageMedia({
                  video: (/^https?:\/\//i.test(buffer)) ? {
                    url: buffer
                  } : (type && type?.data)
                }, {
                  upload: conn.waUploadToServer,
                  ...options
                });
              }
            } catch (error) {
              console.error("Failed to get file type:", error);
            }
          }
        }
        const dynamicButtons = buttons.map(btn => ({
          name: 'quick_reply',
          buttonParamsJson: JSON.stringify({
            display_text: btn[0],
            id: btn[1]
          }),
        }));
        dynamicButtons.push(
          (copy && (typeof copy === 'string' || typeof copy === 'number')) ? {
            name: 'cta_copy',
            buttonParamsJson: JSON.stringify({
              display_text: 'Copy',
              copy_code: copy
            })
          } : null);
        urls?.forEach(url => {
          dynamicButtons.push({
            name: 'cta_url',
            buttonParamsJson: JSON.stringify({
              display_text: url[0],
              url: url[1],
              merchant_url: url[1]
            })
          });
        });
        list?.forEach(lister => {
          dynamicButtons.push({
            name: 'single_select',
            buttonParamsJson: JSON.stringify({
              title: lister[0],
              sections: lister[1]
            })
          });
        })
        const interactiveMessage = {
          body: {
            text: text || ''
          },
          footer: {
            text: footer || defaultWm()
          },
          header: {
            hasMediaAttachment: img?.imageMessage || video?.videoMessage ? true : false,
            imageMessage: img?.imageMessage || null,
            videoMessage: video?.videoMessage || null
          },
          nativeFlowMessage: {
            buttons: dynamicButtons.filter(Boolean),
            messageParamsJson: ''
          },
          ...Object.assign({
            mentions: typeof text === 'string' ? conn.parseMention(text || '@0') : [],
            contextInfo: {
              mentionedJid: typeof text === 'string' ? conn.parseMention(text || '@0') : [],
            }
          }, {
            ...(options || {}),
            ...(conn.temareply?.contextInfo && {
              contextInfo: {
                ...(options?.contextInfo || {}),
                ...conn.temareply?.contextInfo,
                externalAdReply: {
                  ...(options?.contextInfo?.externalAdReply || {}),
                  ...conn.temareply?.contextInfo?.externalAdReply,
                },
              },
            })
          })
        };
        const messageContent = proto.Message.fromObject({
          viewOnceMessage: {
            message: {
              messageContextInfo: {
                deviceListMetadata: {},
                deviceListMetadataVersion: 2
              },
              interactiveMessage
            }
          }
        });
        const msgs = await generateWAMessageFromContent(jid, messageContent, {
          userJid: conn.user.jid,
          quoted: quoted,
          upload: conn.waUploadToServer,
          ephemeralExpiration: WA_DEFAULT_EPHEMERAL
        });
        await conn.relayMessage(jid, msgs.message, {
          messageId: msgs.key.id
        });
      }
    },
    /**
     * Send carouselMessage
     */
    sendCarousel: {
      async value(jid, text = '', footer = '', text2 = '', messages, quoted, options) {
        if (messages.length > 1) {
          const cards = await Promise.all(messages.map(async ([text = '', footer = '', buffer, buttons, copy,
            urls, list
          ]) => {
            let img, video;
            if (/^https?:\/\//i.test(buffer)) {
              try {
                const response = await fetch(buffer);
                const contentType = response.headers.get('content-type');
                if (/^image\//i.test(contentType)) {
                  img = await prepareWAMessageMedia({
                    image: {
                      url: buffer
                    }
                  }, {
                    upload: conn.waUploadToServer,
                    ...options
                  });
                } else if (/^video\//i.test(contentType)) {
                  video = await prepareWAMessageMedia({
                    video: {
                      url: buffer
                    }
                  }, {
                    upload: conn.waUploadToServer,
                    ...options
                  });
                } else {
                  console.error("Incompatible MIME types:", contentType);
                }
              } catch (error) {
                console.error("Failed to get MIME type:", error);
              }
            } else {
              try {
                const type = await conn.getFile(buffer);
                if (/^image\//i.test(type.mime)) {
                  img = await prepareWAMessageMedia({
                    image: (/^https?:\/\//i.test(buffer)) ? {
                      url: buffer
                    } : (type && type?.data)
                  }, {
                    upload: conn.waUploadToServer,
                    ...options
                  });
                } else if (/^video\//i.test(type.mime)) {
                  video = await prepareWAMessageMedia({
                    video: (/^https?:\/\//i.test(buffer)) ? {
                      url: buffer
                    } : (type && type?.data)
                  }, {
                    upload: conn.waUploadToServer,
                    ...options
                  });
                }
              } catch (error) {
                console.error("Failed to get file type:", error);
              }
            }
            const dynamicButtons = buttons.map(btn => ({
              name: 'quick_reply',
              buttonParamsJson: JSON.stringify({
                display_text: btn[0],
                id: btn[1]
              }),
            }));
            /*dynamicButtons.push(
              (copy && (typeof copy === 'string' || typeof copy === 'number')) && {
                name: 'cta_copy',
                buttonParamsJson: JSON.stringify({
                  display_text: 'Copy',
                  copy_code: copy
                })
              });*/
copy = Array.isArray(copy) ? copy : [copy]
	    copy.map(copy => {
                dynamicButtons.push({
                    name: 'cta_copy',
                    buttonParamsJson: JSON.stringify({
                        display_text: 'Copy',
                        copy_code: copy[0]
                    })
                });
            });
            urls?.forEach(url => {
              dynamicButtons.push({
                name: 'cta_url',
                buttonParamsJson: JSON.stringify({
                  display_text: url[0],
                  url: url[1],
                  merchant_url: url[1]
                })
              });
            });

	          list?.forEach(lister => {
              dynamicButtons.push({
                name: 'single_select',
                buttonParamsJson: JSON.stringify({
                  title: lister[0],
                  sections: lister[1]
                })
              });
            })
           
		/*list?.forEach(lister => {
    dynamicButtons.push({
        name: 'single_select',
        buttonParamsJson: JSON.stringify({
            title: lister[0],
            sections: [{
		    title: lister[1],
                rows: [{
                    header: lister[2],
                    title: lister[3],
                    description: lister[4], 
                    id: lister[5]
                }]
            }]
        })
    });
});*/

            return {
              body: proto.Message.InteractiveMessage.Body.fromObject({
                text: text || ''
              }),
              footer: proto.Message.InteractiveMessage.Footer.fromObject({
                text: footer || defaultWm()
              }),
              header: proto.Message.InteractiveMessage.Header.fromObject({
                title: text2,
                subtitle: text || '',
                hasMediaAttachment: img?.imageMessage || video?.videoMessage ? true : false,
                imageMessage: img?.imageMessage || null,
                videoMessage: video?.videoMessage || null
              }),
              nativeFlowMessage: proto.Message.InteractiveMessage.NativeFlowMessage.fromObject({
                buttons: dynamicButtons.filter(Boolean),
                messageParamsJson: ''
              }),
              ...Object.assign({
                mentions: typeof text === 'string' ? conn.parseMention(text || '@0') : [],
                contextInfo: {
                  mentionedJid: typeof text === 'string' ? conn.parseMention(text || '@0') : [],
                }
              }, {
                ...(options || {}),
                ...(conn.temareply?.contextInfo && {
                  contextInfo: {
                    ...(options?.contextInfo || {}),
                    ...conn.temareply?.contextInfo,
                    externalAdReply: {
                      ...(options?.contextInfo?.externalAdReply || {}),
                      ...conn.temareply?.contextInfo?.externalAdReply,
                    },
                  },
                })
              })
            };
          }));
          const interactiveMessage = proto.Message.InteractiveMessage.create({
            body: proto.Message.InteractiveMessage.Body.fromObject({
              text: text || ''
            }),
            footer: proto.Message.InteractiveMessage.Footer.fromObject({
              text: footer || defaultWm()
            }),
            header: proto.Message.InteractiveMessage.Header.fromObject({
              title: text || '',
              subtitle: text || '',
              hasMediaAttachment: false
            }),
            carouselMessage: proto.Message.InteractiveMessage.CarouselMessage.fromObject({
              cards,
            }),
            ...Object.assign({
              mentions: typeof text === 'string' ? conn.parseMention(text || '@0') : [],
              contextInfo: {
                mentionedJid: typeof text === 'string' ? conn.parseMention(text || '@0') : [],
              }
            }, {
              ...(options || {}),
              ...(conn.temareply?.contextInfo && {
                contextInfo: {
                  ...(options?.contextInfo || {}),
                  ...conn.temareply?.contextInfo,
                  externalAdReply: {
                    ...(options?.contextInfo?.externalAdReply || {}),
                    ...conn.temareply?.contextInfo?.externalAdReply,
                  },
                },
              })
            })
          });
          const messageContent = proto.Message.fromObject({
            viewOnceMessage: {
              message: {
                messageContextInfo: {
                  deviceListMetadata: {},
                  deviceListMetadataVersion: 2
                },
                interactiveMessage
              }
            }
          });
          const msgs = await generateWAMessageFromContent(jid, messageContent, {
            userJid: conn.user.jid,
            quoted: quoted,
            upload: conn.waUploadToServer,
            ephemeralExpiration: WA_DEFAULT_EPHEMERAL
          });
          await conn.relayMessage(jid, msgs.message, {
            messageId: msgs.key.id
          });
        } else {
          await conn.sendNCarousel(jid, ...messages[0], quoted, options);
        }
      }
    },
    
    
    sendOldButton: {
      /**
             * send Old Button
             * @param {String} jid
             * @param {String} text
             * @param {String} footer
             * @param {Buffer} buffer
             * @param {String[] | String[][]} buttons
             * @param {import("baileys").proto.WebMessageInfo} quoted
             * @param {Object} options
             */
      async value(jid, text = '', footer = '', buffer, buttons, quoted, options) {
        let type;
        if (Array.isArray(buffer)) (options = quoted, quoted = buttons, buttons = buffer, buffer = null);
        else if (buffer) {
          try {
            (type = await conn.getFile(buffer), buffer = type.data);
          } catch {
            buffer = null;
          }
        }
        if (!Array.isArray(buttons[0]) && typeof buttons[0] === 'string') buttons = [buttons];
        if (!options) options = {};
        const message = {
          ...options,
          [buffer ? 'caption' : 'text']: text || '',
          footer,
          buttons: buttons.map((btn) => ({
            buttonId: !nullish(btn[1]) && btn[1] || !nullish(btn[0]) && btn[0] || '',
            buttonText: {
              displayText: !nullish(btn[0]) && btn[0] || !nullish(btn[1]) && btn[1] || '',
            },
          })),
          ...(buffer ?
                        options.asLocation && /image/.test(type.mime) ? {
                          location: {
                            ...options,
                            jpegThumbnail: buffer,
                          },
                        } : {
                          [/video/.test(type.mime) ? 'video' : /image/.test(type.mime) ? 'image' : 'document']: buffer,
                        } : {}),
        };

        return await conn.sendMessage(jid, message, {
          quoted,
          upload: conn.waUploadToServer,
          ...options,
        });
      },
      enumerable: true,
    },
    

    


sendList: {
    async value(jid, title, text, buffer, buttonText, listSections, quoted, options = {}) {
        const sections = Array.isArray(listSections) ? listSections : [];
        
        let img, video
    
        if (/^https?:\/\//i.test(buffer)) {
            try {
                const response = await fetch(buffer)
                const contentType = response.headers.get('content-type')
                if (/^image\//i.test(contentType)) {
                    img = await prepareWAMessageMedia({ image: { url: buffer } }, { upload: conn.waUploadToServer })
                } else if (/^video\//i.test(contentType)) {
                    video = await prepareWAMessageMedia({ video: { url: buffer } }, { upload: conn.waUploadToServer })
                } else {
                    console.error("Tipo MIME no compatible:", contentType)
                }
            } catch (error) {
                console.error("Error al obtener el tipo MIME:", error)
            }
        } else {
            
            try {
                const type = await conn.getFile(buffer)
               if (/^image\//i.test(type.mime)) {
                    img = await prepareWAMessageMedia({ image: { url: buffer } }, { upload: conn.waUploadToServer })
                } else if (/^video\//i.test(type.mime)) {
                    video = await prepareWAMessageMedia({ video: { url: buffer } }, { upload: conn.waUploadToServer })
                }
            } catch (error) {
                console.error("Error al obtener el tipo de archivo:", error);
            }
        }
        
        const message = {
            interactiveMessage: {
                header: {
                    title: title,
                    hasMediaAttachment: false,
                imageMessage: img ? img.imageMessage : null,
                videoMessage: video ? video.videoMessage : null
                } ,
                footer: { text: defaultWm() },
                body: {text: text}, 
                contextInfo: {
        mentionedJid: await conn.parseMention(text), 
        isForwarded: true, 
        forwardingScore: 1, 
        forwardedNewsletterMessageInfo: {
        newsletterJid: global.randomchannelId ?? '120363425878747150@newsletter,
        newsletterName: global.randomchannelName ?? '',
        serverMessageId: 100
        },
        /*externalAdReply: {
        showAdAttribution: true,
          title: '◈─┄┄┄┄┄┄〘 nox 〙┄┄┄┄┄┄─◈',
          body: '⎆┄┄┄┄〔 قنــاة الــدعم 〕┄┄┄┄⌲',
          thumbnailUrl: global.postarIcon,
          mediaUrl: global.postarIcon,
          mediaType: buffer? 2 : 1,
          sourceUrl: global.channelUrl,
          renderLargerThumbnail: buffer? false : true
        }*/
      },
                nativeFlowMessage: {
                    buttons: [
                        {
                            name: 'single_select',
                            buttonParamsJson: JSON.stringify({
                                title: buttonText,
                                sections
                            })
                        }
                    ],
                    messageParamsJson: ''
                }
            }
        };
        await conn.relayMessage(jid, { viewOnceMessage: { message } }, {});
    }
},

sendEvent: {
            async value(jid, text, des, loc, link) {
let msg = generateWAMessageFromContent(jid, {
        messageContextInfo: {
            messageSecret: randomBytes(32)
        },
        eventMessage: {
            isCanceled: false,
            name: text,
            description: des,
            location: {
                degreesLatitude: 0,
                degreesLongitude: 0,
                name: loc
            },
            joinLink: link,
            startTime: 'm.messageTimestamp'
        }
    }, {});

    conn.relayMessage(jid, msg.message, {
          messageId: msg.key.id,
        })
            },
            enumerable: true
        },
      
      
      
    sendPoll: {
      async value(jid, name = '', optiPoll, options) {
        if (!Array.isArray(optiPoll[0]) && typeof optiPoll[0] === 'string') optiPoll = [optiPoll];
        if (!options) options = {};
        const pollMessage = {
          name: name,
          options: optiPoll.map((btn) => ({
            optionName: !nullish(btn[0]) && btn[0] || '',
          })),
          selectableOptionsCount: 1,
        };
        return conn.relayMessage(jid, {pollCreationMessage: pollMessage}, {...options});
      },
    },
    
    
    
    sendHydrated: {
      /**
             *
             * @param {String} jid
             * @param {String} text
             * @param {String} footer
             * @param {fs.PathLike} buffer
             * @param {String|string[]} url
             * @param {String|string[]} urlText
             * @param {String|string[]} call
             * @param {String|string[]} callText
             * @param {String[][]} buttons
             * @param {import("baileys").proto.WebMessageInfo} quoted
             * @param {Object} options
             */
      async value(jid, text = '', footer = '', buffer, url, urlText, call, callText, buttons, quoted, options) {
        let type;
        if (buffer) {
          try {
            (type = await conn.getFile(buffer), buffer = type.data);
          } catch {
            buffer = buffer;
          }
        }
        if (buffer && !Buffer.isBuffer(buffer) && (typeof buffer === 'string' || Array.isArray(buffer))) (options = quoted, quoted = buttons, buttons = callText, callText = call, call = urlText, urlText = url, url = buffer, buffer = null);
        if (!options) options = {};
        const templateButtons = [];
        if (url || urlText) {
          if (!Array.isArray(url)) url = [url];
          if (!Array.isArray(urlText)) urlText = [urlText];
          templateButtons.push(...(
            url.map((v, i) => [v, urlText[i]])
                .map(([url, urlText], i) => ({
                  index: templateButtons.length + i + 1,
                  urlButton: {
                    displayText: !nullish(urlText) && urlText || !nullish(url) && url || '',
                    url: !nullish(url) && url || !nullish(urlText) && urlText || '',
                  },
                })) || []
          ));
        }
        if (call || callText) {
          if (!Array.isArray(call)) call = [call];
          if (!Array.isArray(callText)) callText = [callText];
          templateButtons.push(...(
            call.map((v, i) => [v, callText[i]])
                .map(([call, callText], i) => ({
                  index: templateButtons.length + i + 1,
                  callButton: {
                    displayText: !nullish(callText) && callText || !nullish(call) && call || '',
                    phoneNumber: !nullish(call) && call || !nullish(callText) && callText || '',
                  },
                })) || []
          ));
        }
        if (buttons.length) {
          if (!Array.isArray(buttons[0])) buttons = [buttons];
          templateButtons.push(...(
            buttons.map(([text, id], index) => ({
              index: templateButtons.length + index + 1,
              quickReplyButton: {
                displayText: !nullish(text) && text || !nullish(id) && id || '',
                id: !nullish(id) && id || !nullish(text) && text || '',
              },
            })) || []
          ));
        }
        const message = {
          ...options,
          [buffer ? 'caption' : 'text']: text || '',
          footer,
          templateButtons,
          ...(buffer ?
                        options.asLocation && /image/.test(type.mime) ? {
                          location: {
                            ...options,
                            jpegThumbnail: buffer,
                          },
                        } : {
                          [/video/.test(type.mime) ? 'video' : /image/.test(type.mime) ? 'image' : 'document']: buffer,
                        } : {}),
        };
        return await conn.sendMessage(jid, message, {
          quoted,
          upload: conn.waUploadToServer,
          ...options,
        });
      },
      enumerable: true,
    },
    
    
    
    sendHydrated2: {
      async value(jid, text = '', footer = '', buffer, url, urlText, url2, urlText2, buttons, quoted, options) {
        let type;
        if (buffer) {
          try {
            (type = await conn.getFile(buffer), buffer = type.data);
          } catch {
            buffer = buffer;
          }
        }
        if (buffer && !Buffer.isBuffer(buffer) && (typeof buffer === 'string' || Array.isArray(buffer))) (options = quoted, quoted = buttons, buttons = callText, callText = call, call = urlText, urlText = url, url = buffer, buffer = null);
        if (!options) options = {};
        const templateButtons = [];
        if (url || urlText) {
          if (!Array.isArray(url)) url = [url];
          if (!Array.isArray(urlText)) urlText = [urlText];
          templateButtons.push(...(
            url.map((v, i) => [v, urlText[i]])
                .map(([url, urlText], i) => ({
                  index: templateButtons.length + i + 1,
                  urlButton: {
                    displayText: !nullish(urlText) && urlText || !nullish(url) && url || '',
                    url: !nullish(url) && url || !nullish(urlText) && urlText || '',
                  },
                })) || []
          ));
        }
        if (url2 || urlText2) {
          if (!Array.isArray(url2)) url2 = [url2];
          if (!Array.isArray(urlText2)) urlText2 = [urlText2];
          templateButtons.push(...(
            url2.map((v, i) => [v, urlText2[i]])
                .map(([url2, urlText2], i) => ({
                  index: templateButtons.length + i + 1,
                  urlButton: {
                    displayText: !nullish(urlText2) && urlText2 || !nullish(url2) && url2 || '',
                    url: !nullish(url2) && url2 || !nullish(urlText2) && urlText2 || '',
                  },
                })) || []
          ));
        }
        if (buttons.length) {
          if (!Array.isArray(buttons[0])) buttons = [buttons];
          templateButtons.push(...(
            buttons.map(([text, id], index) => ({
              index: templateButtons.length + index + 1,
              quickReplyButton: {
                displayText: !nullish(text) && text || !nullish(id) && id || '',
                id: !nullish(id) && id || !nullish(text) && text || '',
              },
            })) || []
          ));
        }
        const message = {
          ...options,
          [buffer ? 'caption' : 'text']: text || '',
          footer,
          templateButtons,
          ...(buffer ?
                        options.asLocation && /image/.test(type.mime) ? {
                          location: {
                            ...options,
                            jpegThumbnail: buffer,
                          },
                        } : {
                          [/video/.test(type.mime) ? 'video' : /image/.test(type.mime) ? 'image' : 'document']: buffer,
                        } : {}),
        };
        return await conn.sendMessage(jid, message, {
          quoted,
          upload: conn.waUploadToServer,
          ...options,
        });
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : cMod ⦔         */
    
    cMod: {
      value(jid, message, text = '', sender = conn.user.jid, options = {}) {
        if (options.mentions && !Array.isArray(options.mentions)) options.mentions = [options.mentions];
        const copy = message.toJSON();
        delete copy.message.messageContextInfo;
        delete copy.message.senderKeyDistributionMessage;
        const mtype = Object.keys(copy.message)[0];
        const msg = copy.message;
        const content = msg[mtype];
        if (typeof content === 'string') msg[mtype] = text || content;
        else if (content.caption) content.caption = text || content.caption;
        else if (content.text) content.text = text || content.text;
        if (typeof content !== 'string') {
          msg[mtype] = {...content, ...options};
          msg[mtype].contextInfo = {
            ...(content.contextInfo || {}),
            mentionedJid: options.mentions || content.contextInfo?.mentionedJid || [],
          };
        }
        if (copy.participant) sender = copy.participant = sender || copy.participant;
        else if (copy.key.participant) sender = copy.key.participant = sender || copy.key.participant;
        if (copy.key.remoteJid.includes('@s.whatsapp.net')) sender = sender || copy.key.remoteJid;
        else if (copy.key.remoteJid.includes('@broadcast')) sender = sender || copy.key.remoteJid;
        copy.key.remoteJid = jid;
        copy.key.fromMe = areJidsSameUser(sender, conn.user.id) || false;
        return proto.WebMessageInfo.fromObject(copy);
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : copyNForward ⦔         */
    
    copyNForward: {
      async value(jid, message, forwardingScore = true, options = {}) {
        let vtype;
        if (options.readViewOnce && message.message.viewOnceMessage?.message) {
          vtype = Object.keys(message.message.viewOnceMessage.message)[0];
          delete message.message.viewOnceMessage.message[vtype].viewOnce;
          message.message = proto.Message.fromObject(
              JSON.parse(JSON.stringify(message.message.viewOnceMessage.message)),
          );
          message.message[vtype].contextInfo = message.message.viewOnceMessage.contextInfo;
        }
        const mtype = Object.keys(message.message)[0];
        let m = generateForwardMessageContent(message, !!forwardingScore);
        const ctype = Object.keys(m)[0];
        if (forwardingScore && typeof forwardingScore === 'number' && forwardingScore > 1) m[ctype].contextInfo.forwardingScore += forwardingScore;
        m[ctype].contextInfo = {
          ...(message.message[mtype].contextInfo || {}),
          ...(m[ctype].contextInfo || {}),
        };
        m = generateWAMessageFromContent(jid, m, {
          ...options,
          userJid: conn.user.jid,
        });
        await conn.relayMessage(jid, m.message, {messageId: m.key.id, additionalAttributes: {...options}});
        return m;
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : fakeReply ⦔         */
    
    fakeReply: {
      value(jid, text = '', fakeJid = this.user.jid, fakeText = '', fakeGroupJid, options) {
        return conn.reply(jid, text, {key: {fromMe: areJidsSameUser(fakeJid, conn.user.id), participant: fakeJid, ...(fakeGroupJid ? {remoteJid: fakeGroupJid} : {})}, message: {conversation: fakeText}, ...options});
      },
    },
    
    /*          ⦓ conn : downloadM ⦔         */
    
    downloadM: {
      async value(m, type, saveToFile) {
        let filename;
        if (!m || !(m.url || m.directPath)) return Buffer.alloc(0);
        const stream = await downloadContentFromMessage(m, type);
        let buffer = Buffer.from([]);
        for await (const chunk of stream) {
          buffer = Buffer.concat([buffer, chunk]);
        }
        if (saveToFile) ({filename} = await conn.getFile(buffer, true));
        return saveToFile && fs.existsSync(filename) ? filename : buffer;
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : parseMention ⦔         */
    
    parseMention: {
      value(text = '') {
        if (typeof text !== 'string') {
          text = String(text || '');
        }
        try {
          const matches = text.matchAll(/@([0-9]{5,16}|0)/g);
          if (!matches) return [];
          return Array.from(matches).map((v) => v[1] + '@s.whatsapp.net');
        } catch (e) {
          return [];
        }
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : getName ⦔         */
    
    getName: {
      value(jid = '', withoutContact = false) {
        jid = conn.decodeJid(jid);
        const isGroup = jid.endsWith('@g.us');
        withoutContact = conn.withoutContact || withoutContact;
        let v;
        if (isGroup) {
          return new Promise(async (resolve) => {
            v = conn.chats[jid] || {};
            if (!(v.name || v.subject)) v = await conn.groupMetadata(jid) || {};
            resolve(v.name || v.subject || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international'));
          });
        } else {
          v = jid === '0@s.whatsapp.net' ? {
            jid,
            vname: 'WhatsApp',
          } : areJidsSameUser(jid, conn.user.id) ?
                    conn.user :
                    (conn.chats[jid] || {});
        }
        return (withoutContact ? '' : v.name) || v.subject || v.vname || v.notify || v.verifiedName || PhoneNumber('+' + jid.replace('@s.whatsapp.net', '')).getNumber('international');
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : loadMessage ⦔         */
    
    loadMessage: {
      value(messageID) {
        return Object.entries(conn.chats)
            .filter(([_, {messages}]) => typeof messages === 'object')
            .find(([_, {messages}]) => Object.entries(messages)
                .find(([k, v]) => (k === messageID || v.key?.id === messageID)))
            ?.[1].messages?.[messageID];
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : sendGroupV4Invite ⦔         */
    
    sendGroupV4Invite: {
      async value(jid, participant, inviteCode, inviteExpiration, groupName = 'unknown subject', caption = 'Invitation to join my WhatsApp group', jpegThumbnail, options = {}) {
      
        const msg = proto.Message.fromObject({
          groupInviteMessage: proto.GroupInviteMessage.fromObject({
            inviteCode,
            inviteExpiration: parseInt(inviteExpiration) || + new Date(new Date + (3 * 86400000)),
            groupJid: jid,
            groupName: (groupName ? groupName : await conn.getName(jid)) || null,
            jpegThumbnail: Buffer.isBuffer(jpegThumbnail) ? jpegThumbnail : null,
            caption,
          }),
        });
        const message = generateWAMessageFromContent(participant, msg, options);
        await conn.relayMessage(participant, message.message, {messageId: message.key.id, additionalAttributes: {...options}});
        return message;
      },
      enumerable: true,
    },
    
    /*          ⦓ conn : processMessageStubType ⦔         */
    
    processMessageStubType: {
      async value(m) {
        if (!m.messageStubType) return;
        const chat = conn.decodeJid(m.key.remoteJid || m.message?.senderKeyDistributionMessage?.groupId || '');
        const isGroup = chat.endsWith('@g.us');

        if (m.messageStubParameters) {
          m.messageStubParameters = m.messageStubParameters.map(p => conn.decodeJid(p));
          
          if (isGroup && m.messageStubParameters.some(p => p.endsWith('@lid'))) {
            m.messageStubParameters = m.messageStubParameters.map(p => {
              if (p.endsWith('@lid')) {
                const cached = Object.values(conn.chats || {}).find(c => c.lid === p);
                if (cached && cached.id && !cached.id.endsWith('@lid')) return cached.id;
                const contact = conn.contacts?.[p];
                if (contact && contact.id && !contact.id.endsWith('@lid')) return contact.id;
              }
              return p;
            });

            if (m.messageStubParameters.some(p => p.endsWith('@lid'))) {
              const metadata = await conn.groupMetadata(chat).catch(() => null);
              const historicalParticipants = conn.chats[chat]?.metadata?.participants || [];
              const allPossibleParticipants = [...(metadata?.participants || []), ...historicalParticipants];

              m.messageStubParameters = m.messageStubParameters.map(p => {
                if (p.endsWith('@lid')) {
                  const found = allPossibleParticipants.find(part => part.lid === p || part.id === p);
                  if (found && found.id && !found.id.endsWith('@lid')) {
                    if (!conn.chats[p]) conn.chats[p] = { id: found.id, lid: p };
                    if (conn.contacts) conn.contacts[p] = { ...(conn.contacts[p] || {}), id: found.id, lid: p };
                    return found.id;
                  }
                }
                return p;
              });
            }
          }
        }
        if (!chat || chat === 'status@broadcast') return;
        const emitGroupUpdate = (update) => {
          conn.ev.emit('groups.update', [{id: chat, ...update}]);
        };
        switch (m.messageStubType) {
          case WAMessageStubType.REVOKE:
          case WAMessageStubType.GROUP_CHANGE_INVITE_LINK:
            emitGroupUpdate({revoke: m.messageStubParameters[0]});
            break;
          case WAMessageStubType.GROUP_CHANGE_ICON:
            emitGroupUpdate({icon: m.messageStubParameters[0]});
            break;
          default: {
            console.log({
              messageStubType: m.messageStubType,
              messageStubParameters: m.messageStubParameters,
              type: WAMessageStubType[m.messageStubType],
            });
            break;
          }
        }
        
        if (!isGroup) return;
        let chats = conn.chats[chat];
        if (!chats) chats = conn.chats[chat] = {id: chat};
        chats.isChats = true;
        const metadata = await conn.groupMetadata(chat).catch((_) => null);
        if (!metadata) return;
        chats.subject = metadata.subject;
        chats.metadata = metadata;
      },
    },
    
    /*          ⦓ conn : insertAllGroup ⦔         */
    
    insertAllGroup: {
      async value() {
        const groups = await conn.groupFetchAllParticipating().catch((_) => null) || {};
        for (const group in groups) conn.chats[group] = {...(conn.chats[group] || {}), id: group, subject: groups[group].subject, isChats: true, metadata: groups[group]};
        return conn.chats;
      },
    },
    
    /*        ⦓ conn : pushMessage ⦔       */
    
    pushMessage: {
      async value(m) {
        if (!m) return;
        if (!Array.isArray(m)) m = [m];
        for (const message of m) {
          try {
            if (!message) continue;
            if (message.messageStubType && message.messageStubType != WAMessageStubType.CIPHERTEXT) conn.processMessageStubType(message).catch(console.error);
            const _mtype = Object.keys(message.message || {});
            
            const mtype = (!['senderKeyDistributionMessage', 'messageContextInfo'].includes(_mtype[0]) && _mtype[0]) ||
                            (_mtype.length >= 3 && _mtype[1] !== 'messageContextInfo' && _mtype[1]) ||
                            _mtype[_mtype.length - 1];
            
            const chat = conn.decodeJid(message.key.remoteJid || message.message?.senderKeyDistributionMessage?.groupId || '');
            
            if (message.message?.[mtype]?.contextInfo?.quotedMessage) {
              const context = message.message[mtype].contextInfo;
              let participant = conn.decodeJid(context.participant);
              const remoteJid = conn.decodeJid(context.remoteJid || participant);
              const quoted = message.message[mtype].contextInfo.quotedMessage;
              if ((remoteJid && remoteJid !== 'status@broadcast') && quoted) {
                let qMtype = Object.keys(quoted)[0];
                if (qMtype == 'conversation') {
                  quoted.extendedTextMessage = {text: quoted[qMtype]};
                  delete quoted.conversation;
                  qMtype = 'extendedTextMessage';
                }
                if (!quoted[qMtype].contextInfo) quoted[qMtype].contextInfo = {};
                quoted[qMtype].contextInfo.mentionedJid = context.mentionedJid || quoted[qMtype].contextInfo.mentionedJid || [];
                const isGroup = remoteJid.endsWith('g.us');
                if (isGroup && !participant) participant = remoteJid;
                const qM = {
                  key: {
                    remoteJid,
                    fromMe: areJidsSameUser(conn.user.jid, remoteJid),
                    id: context.stanzaId,
                    participant,
                  },
                  message: JSON.parse(JSON.stringify(quoted)),
                  ...(isGroup ? {participant} : {}),
                };
                let qChats = conn.chats[participant];
                if (!qChats) qChats = conn.chats[participant] = {id: participant, isChats: !isGroup};
                if (!qChats.messages) qChats.messages = {};
                if (!qChats.messages[context.stanzaId] && !qM.key.fromMe) qChats.messages[context.stanzaId] = qM;
                let qChatsMessages;
                if ((qChatsMessages = Object.entries(qChats.messages)).length > 40) qChats.messages = Object.fromEntries(qChatsMessages.slice(30, qChatsMessages.length)); 
              }
            }
            if (!chat || chat === 'status@broadcast') continue;
            const isGroup = chat.endsWith('@g.us');
            let chats = conn.chats[chat];
            if (!chats) {
              if (isGroup) await conn.insertAllGroup().catch(console.error);
              chats = conn.chats[chat] = {id: chat, isChats: true, ...(conn.chats[chat] || {})};
            }
            let metadata; let sender;
            if (isGroup) {
              if (!chats.subject || !chats.metadata) {
                metadata = await conn.groupMetadata(chat).catch((_) => ({})) || {};
                if (!chats.subject) chats.subject = metadata.subject || '';
                if (!chats.metadata) chats.metadata = metadata;
              }
              sender = conn.decodeJid(message.key?.fromMe && conn.user.id || message.participant || message.key?.participant || chat || '');
              if (sender !== chat) {
                let chats = conn.chats[sender];
                if (!chats) chats = conn.chats[sender] = {id: sender};
                if (!chats.name) chats.name = message.pushName || chats.name || '';
              }
            } else if (!chats.name) chats.name = message.pushName || chats.name || '';
            if (['senderKeyDistributionMessage', 'messageContextInfo'].includes(mtype)) continue;
            chats.isChats = true;
            if (!chats.messages) chats.messages = {};
            const fromMe = message.key.fromMe || areJidsSameUser(sender || chat, conn.user.id);
            if (!['protocolMessage'].includes(mtype) && !fromMe && message.messageStubType != WAMessageStubType.CIPHERTEXT && message.message) {
              delete message.message.messageContextInfo;
              delete message.message.senderKeyDistributionMessage;
              chats.messages[message.key.id] = JSON.parse(JSON.stringify(message, null, 2));
              let chatsMessages;
              if ((chatsMessages = Object.entries(chats.messages)).length > 40) chats.messages = Object.fromEntries(chatsMessages.slice(30, chatsMessages.length));
            }
          } catch (e) {
            console.error(e);
          }
        }
      },
    },
    
    /*        ⦓ conn : serializeM ⦔       */
    
    serializeM: {
      value(m) {
        return smsg(conn, m);
      },
    },
    
    ...(typeof conn.chatRead !== 'function' ? {
    
      chatRead: {
        value(jid, participant = conn.user.jid, messageID) {
          return conn.sendReadReceipt(jid, participant, [messageID]);
        },
        enumerable: true,
      },
    
    } : {}),
    
    ...(typeof conn.setStatus !== 'function' ? {
    
      setStatus: {
        value(status) {
          return conn.query({
            tag: 'iq',
            attrs: {
              to: S_WHATSAPP_NET,
              type: 'set',
              xmlns: 'status',
            },
            content: [
              {
                tag: 'status',
                attrs: {},
                content: Buffer.from(status, 'utf-8'),
              },
            ],
          });
        },
        enumerable: true,
      },
      
    } : {}),
  });
  
  if (sock.user?.id) sock.user.jid = sock.decodeJid(sock.user.id);
  try {
    if (typeof store?.bind === 'function') store.bind(sock);
  } catch (e) {
    console.error('store.bind:', e);
  }
  return sock;
}

/*        ⦓  ⦔       */

export function smsg(conn, m, hasParent) {
  ensureBaileysMessageLayer();
  if (!m) return m;

  const M = proto.WebMessageInfo;
  m = M.fromObject(m);
  m.conn = conn;
  let protocolMessageKey;
  
  if (m.message) {
    if (m.mtype == 'protocolMessage' && m.msg.key) {
      protocolMessageKey = m.msg.key;
      if (protocolMessageKey == 'status@broadcast') protocolMessageKey.remoteJid = m.chat;
      if (!protocolMessageKey.participant || protocolMessageKey.participant == 'status_me') protocolMessageKey.participant = m.sender;
      protocolMessageKey.fromMe = conn.decodeJid(protocolMessageKey.participant) === conn.decodeJid(conn.user.id);
      if (!protocolMessageKey.fromMe && protocolMessageKey.remoteJid === conn.decodeJid(conn.user.id)) protocolMessageKey.remoteJid = m.sender;
    }
    if (m.quoted) if (!m.quoted.mediaMessage) delete m.quoted.download;
  }
  if (!m.mediaMessage) delete m.download;

  try {
    if (protocolMessageKey && m.mtype == 'protocolMessage') conn.ev.emit('message.delete', protocolMessageKey);
  } catch (e) {
    console.error(e);
  }
  return m;
}

/*        ⦓  ⦔       */

export function serialize() {

  const MediaType = ['imageMessage', 'videoMessage', 'audioMessage', 'stickerMessage', 'documentMessage'];
  
  return Object.defineProperties(proto.WebMessageInfo.prototype, {
  
    conn: {
      value: undefined,
      enumerable: false,
      writable: true,
    },
    
    id: {
      get() {
        return this.key?.id;
      },
    },
    
    isBaileys: {
      get() {
        //return (this.id.startsWith('-') || this.id.startsWith('FELZ') || this.id.startsWith('BAE5') || this.id.startsWith('NEK0') || this?.fromMe || areJidsSameUser(this.conn?.user.id, this.sender)) && this.id.startsWith('3EB0') && (this.id.length === 20 || this.id.length === 22 || this.id.length === 12) || false;
        
        const prefixesID = ['-', 'FELZ', 'BAE5', 'NEK0', 'ArabDevs'];
        return prefixesID.some(p => this.id.startsWith(p));
        
      },
    },
    
    chat: {
      get() {
        const senderKeyDistributionMessage = this.message?.senderKeyDistributionMessage?.groupId;
        const rawJid = this.key?.remoteJidAlt ||
          this.key?.remoteJid ||
          (senderKeyDistributionMessage &&
            senderKeyDistributionMessage !== 'status@broadcast'
          ) || '';
        return safeDecodeJid(rawJid, this.conn);
      },
    },
    
    isGroup: {
      get() {
        return this.chat.endsWith('@g.us');
      },
      enumerable: true,
    },
    
    sender: {
      get() {
        const rawSender = this.key?.fromMe && this.conn?.user.id || this.key?.remoteJidAlt || this.participant || this.key.participant || this.chat || '';
        return safeDecodeJid(rawSender, this.conn);
      },
      enumerable: true,
    },
    
    fromMe: {
      get() {
        return this.key?.fromMe || areJidsSameUser(this.conn?.user.id, this.sender) || false;
      },
    },
    
    messageStubParameters: {
      get() {
        const params = this._messageStubParameters || [];
        if (params.length > 0 && this.conn) {
          return params.map(p => this.conn.decodeJid(p));
        }
        return params;
      },
      set(v) {
        this._messageStubParameters = v;
      },
      enumerable: true,
    },
    
    mtype: {
      get() {
        if (!this.message) return '';
        const type = Object.keys(this.message);
        return (!['senderKeyDistributionMessage', 'messageContextInfo'].includes(type[0]) && type[0]) || (type.length >= 3 && type[1] !== 'messageContextInfo' && type[1]) || type[type.length - 1];
      },
      enumerable: true,
    },
    
    msg: {
      get() {
        if (!this.message) return null;
        return this.message[this.mtype];
      },
    },
    
    mediaMessage: {
      get() {
        if (!this.message) return null;
        const Message = ((this.msg?.url || this.msg?.directPath) ? {...this.message} : extractMessageContent(this.message)) || null;
        if (!Message) return null;
        const mtype = Object.keys(Message)[0];
        return MediaType.includes(mtype) ? Message : null;
      },
      enumerable: true,
    },
    
    mediaType: {
      get() {
        let message;
        if (!(message = this.mediaMessage)) return null;
        return Object.keys(message)[0];
      },
      enumerable: true,
    },
    
    /* */
    
    _text: {
      value: null,
      writable: true,
    },
    
    text: {
      get() {
        const msg = this.msg;
        const text = (typeof msg === 'string' ? msg : msg?.text) || msg?.caption || msg?.contentText || '';
        return typeof this._text === 'string' ? this._text : '' || (typeof text === 'string' ? text : (
                    text?.selectedDisplayText ||
                    text?.hydratedTemplate?.hydratedContentText ||
                    text
                )) || '';
      },
      set(str) {
        return this._text = str;
      },
      enumerable: true,
    },
    
    mentionedJid: {
      get() {
        return this.msg?.contextInfo?.mentionedJid?.length && this.msg.contextInfo.mentionedJid || [];
      },
      enumerable: true,
    },
    
    name: {
      get() {
        return !nullish(this.pushName) && this.pushName || this.conn?.getName(this.sender);
      },
      enumerable: true,
    },
    
    download: {
      value(saveToFile = false) {
        const mtype = this.mediaType;
        return this.conn?.downloadM(this.mediaMessage[mtype], mtype.replace(/message/i, ''), saveToFile);
      },
      enumerable: true,
      configurable: true,
    },
    
    reply: {
      value(text, chatId, options) {
        return this.conn?.reply(chatId ? chatId : this.chat, text, this, options);
      },
    },
    
    copy: {
      value() {
        const M = proto.WebMessageInfo;
        return smsg(this.conn, M.fromObject(M.toObject(this)));
      },
      enumerable: true,
    },
    
    forward: {
      value(jid, force = false, options = {}) {
        return this.conn?.sendMessage(jid, {
          forward: this, force, ...options,
        }, {...options});
      },
      enumerable: true,
    },
    
    copyNForward: {
      value(jid, forceForward = false, options = {}) {
        return this.conn?.copyNForward(jid, this, forceForward, options);
      },
      enumerable: true,
    },
    
    cMod: {
      value(jid, text = '', sender = this.sender, options = {}) {
        return this.conn?.cMod(jid, this, text, sender, options);
      },
      enumerable: true,
    },
    
    getQuotedObj: {
      value() {
        if (!this.quoted.id) return null;
        const q = proto.WebMessageInfo.fromObject(this.conn?.loadMessage(this.quoted.id) || this.quoted.vM);
        return smsg(this.conn, q);
      },
      enumerable: true,
    },
    
    getQuotedMessage: {
      get() {
        return this.getQuotedObj;
      },
    },
    
    delete: {
      value() {
        return this.conn?.sendMessage(this.chat, {delete: this.key});
      },
      enumerable: true,
    },
    
    react: {
      value(text) {
         return this.conn?.sendMessage(this.chat, { react: { text, key: this.key } });
      },
       enumerable: true
    },
      
    translate: {
      value(text, lang) {
      const language = lang ? lang : global.db?.data?.users?.[this.sender]?.language;
      return language ? this.conn?.getTranslate(text, language) : text;
      },
       enumerable: true
    },
    
        /*
    
    */
    
    quoted: {
      get() {
        const self = this;
        const msg = self.msg;
        const contextInfo = msg?.contextInfo;
        const quoted = contextInfo?.quotedMessage;
        if (!msg || !contextInfo || !quoted) return null;
        const type = Object.keys(quoted)[0];
        const q = quoted[type];
        const text = typeof q === 'string' ? q : q.text;
        return Object.defineProperties(JSON.parse(JSON.stringify(typeof q === 'string' ? {text: q} : q)), {
        
          mtype: {
            get() {
              return type;
            },
            enumerable: true,
          },
          
          mediaMessage: {
            get() {
              const Message = ((q.url || q.directPath) ? {...quoted} : extractMessageContent(quoted)) || null;
              if (!Message) return null;
              const mtype = Object.keys(Message)[0];
              return MediaType.includes(mtype) ? Message : null;
            },
            enumerable: true,
          },
          
          mediaType: {
            get() {
              let message;
              if (!(message = this.mediaMessage)) return null;
              return Object.keys(message)[0];
            },
            enumerable: true,
          },
          
          id: {
            get() {
              return contextInfo.stanzaId;
            },
            enumerable: true,
          },
          
          chat: {
            get() {
              const remoteJid = contextInfo.remoteJid || self.chat;
              return safeDecodeJid(remoteJid, self.conn);
            },
            enumerable: true,
          },
          
          isBaileys: {
            get() {  	         
	          const prefixesID = ['-', 'FELZ', 'BAE5', 'NEK0', 'ArabDevs'];
              return prefixesID.some(p => this.id.startsWith(p));
	         
            },
            enumerable: true,
          },
          
          sender: {
            get() {
              const rawParticipant = contextInfo.participant;
              
              if (rawParticipant) {
                const decoded = safeDecodeJid(rawParticipant, self.conn);
                if (decoded && !decoded.endsWith('@lid')) {
                  return decoded;
                }
                const chat = contextInfo.remoteJid || self.chat;
                const decodedChat = safeDecodeJid(chat, self.conn);
                if (decodedChat && !decodedChat.endsWith('@lid') && !decodedChat.endsWith('@g.us')) {
                  return decodedChat;
                }
                return decoded;
              }
              
              const chat = contextInfo.remoteJid || self.chat;
              const decodedChat = safeDecodeJid(chat, self.conn);
              const isFromMe = this.key?.fromMe || areJidsSameUser(decodedChat, self.conn?.user?.id || "");
              
              if (isFromMe) {
                return safeDecodeJid(self.conn?.user?.id || self.conn?.user?.jid, self.conn);
              } else {
                return decodedChat;
              }
            },
            enumerable: true,
          },
          

    
          text: {
            get() {
              return text || this.caption || this.contentText || this.selectedDisplayText || '';
            },
            enumerable: true,
          },
          
          mentionedJid: {
            get() {
              return q.contextInfo?.mentionedJid || self.getQuotedObj()?.mentionedJid || [];
            },
            enumerable: true,
          },
          
          name: {
            get() {
              const sender = this.sender;
              return sender ? self.conn?.getName(sender) : null;
            },
            enumerable: true,
          },
          
          vM: {
            get() {
              return proto.WebMessageInfo.fromObject({
              
                key: {
                  fromMe: this.fromMe,
                  remoteJid: this.chat,
                  id: this.id,
                },
                message: quoted,
                ...(self.isGroup ? {participant: this.sender} : {}),
              });
            },
          },
          
          fakeObj: {
            get() {
              return this.vM;
            },
          },
          
          download: {
            value(saveToFile = false) {
              const mtype = this.mediaType;
              return self.conn?.downloadM(this.mediaMessage[mtype], mtype.replace(/message/i, ''), saveToFile);
            },
            enumerable: true,
            configurable: true,
          },
          
          reply: {
            value(text, chatId, options) {
              return self.conn?.reply(chatId ? chatId : this.chat, text, this.vM, options);
            },
            enumerable: true,
          },
          
          copy: {
            value() {
              const M = proto.WebMessageInfo;
              return smsg(conn, M.fromObject(M.toObject(this.vM)));
            },
            enumerable: true,
          },
          
          forward: {
            value(jid, force = false, options) {
              return self.conn?.sendMessage(jid, {
                forward: this.vM, force, ...options,
              }, {...options});
            },
            enumerable: true,
          },
          
          copyNForward: {
            value(jid, forceForward = false, options) {
              return self.conn?.copyNForward(jid, this.vM, forceForward, options);
            },
            enumerable: true,

          },
          
          cMod: {
            value(jid, text = '', sender = this.sender, options = {}) {
              return self.conn?.cMod(jid, this.vM, text, sender, options);
            },
            enumerable: true,

          },
          
          delete: {
            value() {
              return self.conn?.sendMessage(this.chat, {delete: this.vM.key});
            },
            enumerable: true,
          },
          
          react: {
            value(text) {
              return self.conn?.sendMessage(this.chat, { react: { text, key: this.vM.key } });
            },
            enumerable: true,
          },
          
        });
      },
      enumerable: true,
    },
    
    /*
    */
    
  });
}

/*        ⦓  ⦔       */

export function logic(check, inp, out) {
  if (inp.length !== out.length) throw new Error('Input and Output must have same length');
  for (const i in inp) if (util.isDeepStrictEqual(check, inp[i])) return out[i];
  return null;
}

/*        ⦓  ⦔       */

export function protoType() {

  Buffer.prototype.toArrayBuffer = function toArrayBufferV2() {
    const ab = new ArrayBuffer(this.length);
    const view = new Uint8Array(ab);
    for (let i = 0; i < this.length; ++i) {
      view[i] = this[i];
    }
    return ab;
  };


  Buffer.prototype.toArrayBufferV2 = function toArrayBuffer() {
    return this.buffer.slice(this.byteOffset, this.byteOffset + this.byteLength);
  };


  ArrayBuffer.prototype.toBuffer = function toBuffer() {
    return Buffer.from(new Uint8Array(this));
  };

/*
  Buffer.prototype.toUtilFormat = ArrayBuffer.prototype.toUtilFormat = Object.prototype.toUtilFormat = Array.prototype.toUtilFormat = function toUtilFormat() {
     return util.format(this)
  }
*/

  Uint8Array.prototype.getFileType = ArrayBuffer.prototype.getFileType = Buffer.prototype.getFileType = async function getFileType() {
    return await fileTypeFromBuffer(this);
  };


  String.prototype.isNumber = Number.prototype.isNumber = isNumber;


  String.prototype.capitalize = function capitalize() {
    return this.charAt(0).toUpperCase() + this.slice(1, this.length);
  };


  String.prototype.capitalizeV2 = function capitalizeV2() {
    const str = this.split(' ');
    return str.map((v) => v.capitalize()).join(' ');
  };


  String.prototype.decodeJid = function decodeJid() {
    if (!this) return this;
    const str = this.toString();
    if (!str) return str;
    if (/:\d+@/gi.test(str)) {
      const decode = jidDecode(str) || {};
      return (decode.user && decode.server && decode.user + '@' + decode.server || str).trim();
    } else if (str.endsWith('@lid')) {
      return str.trim();
    } else return str.trim();
  };

  String.prototype.resolveLidToRealJid = async function() {
    return this.toString().includes("@") ? this.toString() : `${this.toString()}@s.whatsapp.net`;
  };


  Number.prototype.toTimeString = function toTimeString() {
    
    const seconds = Math.floor((this / 1000) % 60);
    const minutes = Math.floor((this / (60 * 1000)) % 60);
    const hours = Math.floor((this / (60 * 60 * 1000)) % 24);
    const days = Math.floor((this / (24 * 60 * 60 * 1000)));
    return (
      (days ? `${days} day(s) ` : '') +
            (hours ? `${hours} hour(s) ` : '') +
            (minutes ? `${minutes} minute(s) ` : '') +
            (seconds ? `${seconds} second(s)` : '')
    ).trim();
  };

  Number.prototype.getRandom = String.prototype.getRandom = Array.prototype.getRandom = getRandom;

}

/*        ⦓  ⦔       */

function isNumber() {
  const int = parseInt(this);
  return typeof int === 'number' && !isNaN(int);
}

/*        ⦓  ⦔       */

function getRandom() {
  if (Array.isArray(this) || this instanceof String) return this[Math.floor(Math.random() * this.length)];
  return Math.floor(Math.random() * this);
}

/*        ⦓  ⦔       */

function nullish(args) {
  return !(args !== null && args !== undefined);
}

function randomBytes(size) {
  const buffer = new Uint8Array(size);
  crypto.getRandomValues(buffer);
  return buffer;
};
