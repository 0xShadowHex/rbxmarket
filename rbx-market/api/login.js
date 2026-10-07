import { checkPassword, createSession, isAdmin, readBody } from "./_lib.js";

export default async function handler(req, res) {
  if (req.method === "GET") {
    return res.status(200).json({ admin: isAdmin(req) });
  }

  if (req.method === "POST") {
    const { password } = readBody(req);
    if (!checkPassword(password)) {
      return res.status(401).json({ error: "Wrong password" });
    }
    createSession(res);
    return res.status(200).json({ admin: true });
  }

  res.setHeader("Allow", "GET, POST");
  return res.status(405).json({ error: "Method not allowed" });
}
