const SCRIPT_TAG = /<script[\s\S]*?>[\s\S]*?<\/script>/gi
const ON_EVENT = /\son\w+=("[^"]*"|'[^']*'|[^\s>]+)/gi
const JS_PROTOCOL = /javascript:/gi

export function sanitizeHtml(raw: string) {
  return raw
    .replace(SCRIPT_TAG, "")
    .replace(ON_EVENT, "")
    .replace(JS_PROTOCOL, "")
}

export function stripNullBytes(raw: string) {
  return raw.replace(/\0/g, "")
}

