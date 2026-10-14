import crypto from "crypto";
import { put, list, del } from "@vercel/blob";

const COOKIE = "rbx_admin";
const MAX_IMAGES = 8;
const MAX_IMAGE_BYTES = 3 * 1024 * 1024;
const MAX_TOTAL_BYTES = 3.2 * 1024 * 1024; // Vercel request bodies are capped at 4.5 MB (base64 adds ~33%)
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
const SECRET = "some-random-string-123";
const PASSWORD = "oct31haha";

function sign(value) {
  return crypto.createHmac("sha256", SECRET).update(value).digest("hex");
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
  if (typeof input !== "string") return false;
  const a = crypto.createHash("sha256").update(input).digest();
  const b = crypto.createHash("sha256").update(PASSWORD).digest();
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
   Each offer is stored as:
     offers/<id>.json      metadata (description, prices, image urls)
     images/<id>-<n>.<ext> pictures
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
  return offers
    .filter(Boolean)
    .map(o => ({
      ...o,
      // Offers created before multi-image support only have `image`
      images: o.images || (o.image ? [o.image] : []),
      price: o.price ?? null,
      robux: o.robux ?? null,
    }))
    .sort((a, b) => b.createdAt - a.createdAt);
}

function parseImage(dataUrl) {
  const m = /^data:(image\/[a-z]+);base64,(.+)$/i.exec(dataUrl || "");
  const type = m && m[1].toLowerCase();
  if (!m || !ALLOWED[type]) {
    throw new HttpError(400, "Upload JPG, PNG, WEBP or GIF images");
  }
  const buffer = Buffer.from(m[2], "base64");
  if (buffer.length > MAX_IMAGE_BYTES) throw new HttpError(400, "An image is too large");
  return { buffer, type, ext: ALLOWED[type] };
}

function parseUsd(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 100000) throw new HttpError(400, "Invalid USD price");
  return Math.round(n * 100) / 100;
}

function parseRobux(value) {
  if (value === "" || value == null) return null;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1 || n > 100000000) throw new HttpError(400, "Invalid Robux price");
  return n;
}

export async function addOffer({ description, price, robux, images }) {
  const desc = typeof description === "string" ? description.trim().slice(0, 500) : "";
  if (!desc) throw new HttpError(400, "Description is required");

  const usd = parseUsd(price);
  const rbx = parseRobux(robux);
  if (usd === null && rbx === null) throw new HttpError(400, "Enter a USD or Robux price");

  const list = Array.isArray(images) ? images : [];
  if (!list.length) throw new HttpError(400, "Upload at least one image");
  if (list.length > MAX_IMAGES) throw new HttpError(400, `Up to ${MAX_IMAGES} images per offer`);

  const parsed = list.map(parseImage);
  const total = parsed.reduce((sum, p) => sum + p.buffer.length, 0);
  if (total > MAX_TOTAL_BYTES) throw new HttpError(400, "Images are too large together. Use fewer or smaller pictures");

  const id = Date.now().toString(36) + crypto.randomBytes(3).toString("hex");

  const urls = [];
  for (let i = 0; i < parsed.length; i++) {
    const p = parsed[i];
    const blob = await put(`images/${id}-${i}.${p.ext}`, p.buffer, {
      access: "public",
      contentType: p.type,
      addRandomSuffix: false,
    });
    urls.push(blob.url);
  }

  const offer = {
    id,
    description: desc,
    price: usd,
    robux: rbx,
    images: urls,
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
    if (offer) {
      const imgs = offer.images || (offer.image ? [offer.image] : []);
      urls.push(...imgs);
    }
  } catch {
    /* metadata unreadable: still remove the metadata blob */
  }

  await del(urls);
}
