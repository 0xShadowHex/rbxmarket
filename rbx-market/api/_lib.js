import crypto from "crypto";
import { put, list, del } from "@vercel/blob";

const COOKIE = "rbx_admin";
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const ALLOWED = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
};

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/* ---------- Request body ---------- */
export function readBody(req) {
  if (!req.body) return {};
  if (typeof req.body === "string") {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return req.body;
}

/* ---------- Auth ---------- */
function sign(value) {
  return crypto
    .createHmac("sha256", "some-random-string-123")
    .update(value)
    .digest("hex");
}

function parseCookies(header) {
  return Object.fromEntries(
    header
      .split(";")
      .map(c => c.trim().split("="))
      .filter(p => p.length === 2)
  );
}

export function checkPassword(input) {
  const expected = "oct31haha";
  if (!expected || typeof input !== "string") return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(expected).digest();
  return crypto.timingSafeEqual(a, b);
}

export function createSession(res) {
  const token = "admin." + sign("admin");
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=${token}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`
  );
}

export function clearSession(res) {
  res.setHeader(
    "Set-Cookie",
    `${COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`
  );
}

export function isAdmin(req) {
  const token = parseCookies(req.headers.cookie || "")[COOKIE] || "";
  const expected = "admin." + sign("admin");
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ---------- Storage (Vercel Blob) ----------
   Each offer is two blobs:
     offers/<id>.json   metadata (description, price, image url)
     images/<id>.<ext>  picture
   Every visitor reads the same public blobs. */

async function findBlob(pathname) {
  const { blobs } = await list({ prefix: pathname });
  return blobs.find(b => b.pathname === pathname) || null;
}

export async function listOffers() {
  const { blobs } = await list({ prefix: "offers/" });
  const metaFiles = blobs.filter(b => b.pathname.endsWith(".json"));
  const offers = await Promise.all(
    metaFiles.map(async b => {
      try {
        const r = await fetch(b.url, { cache: "no-store" });
        return r.ok ? await r.json() : null;
      } catch {
        return null;
      }
    })
  );
  return offers.filter(Boolean).sort((a, b) => b.createdAt - a.createdAt);
}

export async function addOffer({ description, price, image }) {
  const desc = typeof description === "string" ? description.trim().slice(0, 500) : "";
  const cost = Number(price);

  if (!desc) throw new HttpError(400, "Description is required");
  if (!Number.isFinite(cost) || cost < 0 || cost > 100000) {
    throw new HttpError(400, "Invalid price");
  }

  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(image || "");
  if (!m || !ALLOWED[m[1].toLowerCase()]) {
    throw new HttpError(400, "Upload a JPG, PNG, WEBP or GIF image");
  }

  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(400, "Image is too large");

  const id = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");
  const ext = ALLOWED[m[1].toLowerCase()];

  const imageBlob = await put(`images/${id}.${ext}`, buffer, {
    access: "public",
    contentType: m[1].toLowerCase(),
    addRandomSuffix: false,
  });

  const offer = {
    id,
    description: desc,
    price: Math.round(cost * 100) / 100,
    image: imageBlob.url,
    createdAt: Date.now(),
  };

  await put(`offers/${id}.json`, JSON.stringify(offer), {
    access: "public",
    contentType: "application/json",
    addRandomSuffix: false,
  });

  return offer;
}

export async function deleteOffer(id) {
  if (!/^[a-z0-9]+$/i.test(id || "")) throw new HttpError(400, "Invalid id");

  const meta = await findBlob(`offers/${id}.json`);
  if (!meta) throw new HttpError(404, "Offer not found");

  const urls = [meta.url];
  try {
    const r = await fetch(meta.url, { cache: "no-store" });
    const offer = r.ok ? await r.json() : null;
    if (offer && offer.image) urls.push(offer.image);
  } catch {
    /* metadata unreadable: still remove what we can */
  }

  await del(urls);
}
