import { isAdmin, listOffers, addOffer, deleteOffer, readBody } from "./_lib.js";

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const offers = await listOffers();
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json({ offers });
    }

    if (!isAdmin(req)) {
      return res.status(401).json({ error: "Not authorized" });
    }

    if (req.method === "POST") {
      const offer = await addOffer(readBody(req));
      return res.status(201).json({ offer });
    }

    if (req.method === "DELETE") {
      await deleteOffer(req.query.id);
      return res.status(200).json({ ok: true });
    }

    res.setHeader("Allow", "GET, POST, DELETE");
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message || "Server error" });
  }
}
