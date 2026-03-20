const express = require("express");
const { createClient } = require("@supabase/supabase-js");
const crypto = require("crypto");
const path = require("path");

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, "public")));

// ── Supabase ──────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_KEY
);

const ADMIN_SECRET = process.env.ADMIN_SECRET || "admin123";

// ── Helpers ───────────────────────────────────────────────
function generateKey() {
  const seg = () => crypto.randomBytes(3).toString("hex").toUpperCase();
  return `${seg()}-${seg()}-${seg()}-${seg()}`;
}

function adminGuard(req, res, next) {
  const secret = req.headers["x-admin-secret"];
  if (secret !== ADMIN_SECRET)
    return res.status(403).json({ success: false, message: "غير مصرح" });
  next();
}

// ═══════════════════════════════════════════════════════════
//  PUBLIC ENDPOINTS  (يستخدمها التطبيق APK)
// ═══════════════════════════════════════════════════════════

// ✅ تفعيل المفتاح مع ربطه بالجهاز
app.post("/api/activate", async (req, res) => {
  const { key, device_id } = req.body;
  if (!key || !device_id)
    return res.status(400).json({ success: false, message: "البيانات ناقصة" });

  const { data, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("key", key.toUpperCase())
    .single();

  if (error || !data)
    return res.json({ success: false, message: "الكود غير صحيح" });

  if (data.status === "disabled")
    return res.json({ success: false, message: "الكود معطل" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.json({ success: false, message: "انتهت صلاحية الكود" });

  if (data.device_id && data.device_id !== device_id)
    return res.json({ success: false, message: "الكود مستخدم على جهاز آخر" });

  if (!data.device_id) {
    await supabase
      .from("licenses")
      .update({ device_id, status: "active", activated_at: new Date().toISOString() })
      .eq("key", key.toUpperCase());
  }

  return res.json({
    success: true,
    message: "تم التفعيل بنجاح",
    expires_at: data.expires_at,
    plan: data.plan,
  });
});

// ✅ التحقق من صلاحية الكود
app.post("/api/verify", async (req, res) => {
  const { key, device_id } = req.body;
  if (!key || !device_id)
    return res.status(400).json({ success: false, message: "البيانات ناقصة" });

  const { data, error } = await supabase
    .from("licenses")
    .select("*")
    .eq("key", key.toUpperCase())
    .eq("device_id", device_id)
    .single();

  if (error || !data)
    return res.json({ success: false, message: "التفعيل غير صالح" });

  if (data.status === "disabled")
    return res.json({ success: false, message: "الكود معطل" });

  if (data.expires_at && new Date(data.expires_at) < new Date())
    return res.json({ success: false, message: "انتهت الصلاحية" });

  return res.json({
    success: true,
    message: "الكود ساري",
    expires_at: data.expires_at,
    plan: data.plan,
  });
});

// ═══════════════════════════════════════════════════════════
//  ADMIN ENDPOINTS  (محمية بـ ADMIN_SECRET)
// ═══════════════════════════════════════════════════════════

app.post("/api/admin/generate", adminGuard, async (req, res) => {
  const { count = 1, plan = "basic", days = null } = req.body;
  const keys = [];
  for (let i = 0; i < Math.min(count, 100); i++) {
    const key = generateKey();
    const expires_at = days
      ? new Date(Date.now() + days * 86400000).toISOString()
      : null;
    const { error } = await supabase
      .from("licenses")
      .insert({ key, plan, expires_at, status: "pending" });
    if (!error) keys.push(key);
  }
  res.json({ success: true, keys });
});

app.get("/api/admin/keys", adminGuard, async (req, res) => {
  const { status, plan } = req.query;
  let query = supabase
    .from("licenses")
    .select("*")
    .order("created_at", { ascending: false });
  if (status) query = query.eq("status", status);
  if (plan) query = query.eq("plan", plan);
  const { data, error } = await query;
  if (error) return res.status(500).json({ success: false });
  res.json({ success: true, keys: data });
});

app.post("/api/admin/disable", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .update({ status: "disabled" })
    .eq("key", req.body.key.toUpperCase());
  res.json({ success: true, message: "تم التعطيل" });
});

app.post("/api/admin/enable", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .update({ status: "active" })
    .eq("key", req.body.key.toUpperCase());
  res.json({ success: true, message: "تم التفعيل" });
});

app.post("/api/admin/delete", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .delete()
    .eq("key", req.body.key.toUpperCase());
  res.json({ success: true, message: "تم الحذف" });
});

app.post("/api/admin/reset-device", adminGuard, async (req, res) => {
  await supabase
    .from("licenses")
    .update({ device_id: null, status: "pending", activated_at: null })
    .eq("key", req.body.key.toUpperCase());
  res.json({ success: true, message: "تم إعادة ضبط الجهاز" });
});

app.get("/api/admin/stats", adminGuard, async (req, res) => {
  const { data } = await supabase.from("licenses").select("status, plan");
  const stats = {
    total: data.length,
    active: data.filter((k) => k.status === "active").length,
    pending: data.filter((k) => k.status === "pending").length,
    disabled: data.filter((k) => k.status === "disabled").length,
  };
  res.json({ success: true, stats });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));
